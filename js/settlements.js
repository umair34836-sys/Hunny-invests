// settlements.js — maturity settlement engine & stock-purchase-deadline refunds.
// These move money across MULTIPLE users' wallets, so per spec §17/§27 they are
// restricted to admin-authenticated actions and enforced by firestore.rules
// (only admin/super_admin may write another user's wallet/investment payout fields).

import { db } from "./firebase-config.js";
import {
  COLLECTIONS, docRef, col, doc, runTransaction, serverTimestamp,
  getMany, getOne, where, createDoc, updateDocById
} from "./firestore.js";
import { round2 } from "./utils.js";
import { calculateSettlementOutcome, calculateTotalReturnObligation } from "./calculations.js";
import { notifyUser, notifyUsers } from "./notifications.js";

/**
 * Run final maturity settlement for an opportunity.
 * Determines payout per investor from calculateSettlementOutcome() using the
 * opportunity's total soldQuantity, and credits each investor's wallet.
 */
export async function adminRunSettlement(opportunityId, adminId) {
  const opp = await getOne(COLLECTIONS.OPPORTUNITIES, opportunityId);
  if (!opp) throw new Error("Opportunity not found.");
  if (!["settlement_pending", "matured", "active"].includes(opp.status)) {
    throw new Error("This opportunity is not ready for settlement.");
  }

  const investments = await getMany(COLLECTIONS.INVESTMENTS, where("opportunityId", "==", opportunityId), where("status", "==", "active"));
  if (investments.length === 0) throw new Error("No active investments found to settle.");

  let totalPrincipal = 0, totalPayout = 0, totalProfit = 0, totalFees = 0;
  const soldQuantity = Number(opp.soldQuantity || 0);

  for (const inv of investments) {
    const outcome = calculateSettlementOutcome(inv.investedAmount, inv.investorReturnPercent, soldQuantity, opp.zeroSaleRefundFeePercent);
    await settleOneInvestment(inv, outcome, adminId);
    totalPrincipal = round2(totalPrincipal + Number(inv.investedAmount));
    totalPayout = round2(totalPayout + outcome.payout);
    totalProfit = round2(totalProfit + outcome.profit);
    totalFees = round2(totalFees + outcome.fee);
  }

  const settlementId = await createDoc(COLLECTIONS.SETTLEMENTS, {
    opportunityId,
    type: "maturity",
    soldQuantity,
    investorCount: investments.length,
    totalPrincipal,
    totalPayout,
    totalProfit,
    totalFees,
    outcome: soldQuantity > 0 ? "profit" : "zero_sale_refund",
    processedBy: adminId,
    processedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });

  await updateDocById(COLLECTIONS.OPPORTUNITIES, opportunityId, {
    status: "completed",
    settledAt: serverTimestamp(),
    settlementId,
    updatedAt: serverTimestamp()
  });

  await notifyUser(opp.ownerId, {
    type: "settlement_completed",
    title: "Settlement completed",
    message: `Settlement for "${opp.title}" is complete. ${investments.length} investor(s) paid out.`,
    link: `owner-opportunity.html?id=${opportunityId}`,
    relatedId: opportunityId
  });

  return settlementId;
}

async function settleOneInvestment(inv, outcome, adminId) {
  const investmentRef = docRef(COLLECTIONS.INVESTMENTS, inv.id);
  const walletRef = docRef(COLLECTIONS.WALLETS, inv.investorId);
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  await runTransaction(db, async (tx) => {
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) throw new Error("Investor wallet not found.");
    const wallet = walletSnap.data();

    tx.update(investmentRef, {
      status: "completed",
      completedAt: serverTimestamp(),
      payoutAmount: outcome.payout,
      refundAmount: outcome.outcome === "zero_sale_refund" ? outcome.payout : null
    });

    tx.update(walletRef, {
      availableBalance: round2(Number(wallet.availableBalance) + outcome.payout),
      lockedBalance: round2(Number(wallet.lockedBalance || 0) - Number(inv.investedAmount)),
      totalProfit: round2(Number(wallet.totalProfit || 0) + outcome.profit),
      totalRefunded: outcome.outcome === "zero_sale_refund" ? round2(Number(wallet.totalRefunded || 0) + outcome.payout) : Number(wallet.totalRefunded || 0),
      updatedAt: serverTimestamp()
    });

    tx.set(walletTxRef, {
      userId: inv.investorId,
      type: outcome.outcome === "zero_sale_refund" ? "refund" : "profit",
      amount: outcome.payout,
      status: "completed",
      relatedOpportunityId: inv.opportunityId,
      relatedInvestmentId: inv.id,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      processedBy: adminId,
      description: outcome.outcome === "zero_sale_refund"
        ? `Zero-sale refund for "${inv.opportunityTitle}" (fee: ${outcome.fee} PKR)`
        : `Maturity payout for "${inv.opportunityTitle}" (profit: ${outcome.profit} PKR)`
    });
  });

  await notifyUser(inv.investorId, {
    type: outcome.outcome === "zero_sale_refund" ? "refund_processed" : "profit_credited",
    title: outcome.outcome === "zero_sale_refund" ? "Refund processed" : "Profit credited 🎉",
    message: outcome.outcome === "zero_sale_refund"
      ? `Your investment in "${inv.opportunityTitle}" matured with zero sales. Refund: ${outcome.payout} PKR.`
      : `Your investment in "${inv.opportunityTitle}" matured. Payout: ${outcome.payout} PKR (profit: ${outcome.profit} PKR).`,
    link: `investment.html?id=${inv.id}`,
    relatedId: inv.id
  });
}

/**
 * If the owner fails to purchase stock within the configured deadline,
 * refund all investors in full (no early-exit fee) — spec §15.
 */
export async function adminProcessDeadlineRefund(opportunityId, adminId) {
  const opp = await getOne(COLLECTIONS.OPPORTUNITIES, opportunityId);
  if (!opp) throw new Error("Opportunity not found.");
  if (opp.status !== "awaiting_stock_purchase") {
    throw new Error("Deadline refund only applies to opportunities awaiting stock purchase.");
  }

  await updateDocById(COLLECTIONS.OPPORTUNITIES, opportunityId, { status: "refund_pending", updatedAt: serverTimestamp() });

  const investments = await getMany(COLLECTIONS.INVESTMENTS, where("opportunityId", "==", opportunityId), where("status", "==", "invested"));
  let totalRefunded = 0;

  for (const inv of investments) {
    await refundOneInvestmentInFull(inv, adminId, "Stock purchase deadline expired — full refund, no fee.");
    totalRefunded = round2(totalRefunded + Number(inv.investedAmount));
  }

  await createDoc(COLLECTIONS.SETTLEMENTS, {
    opportunityId,
    type: "deadline_refund",
    investorCount: investments.length,
    totalPrincipal: totalRefunded,
    totalPayout: totalRefunded,
    totalProfit: 0,
    totalFees: 0,
    outcome: "deadline_refund",
    processedBy: adminId,
    processedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  });

  await updateDocById(COLLECTIONS.OPPORTUNITIES, opportunityId, { status: "refunded", updatedAt: serverTimestamp() });

  await notifyUsers(investments.map((i) => i.investorId), {
    type: "refund_processed",
    title: "Refund processed",
    message: `"${opp.title}" was refunded in full because the owner did not purchase stock within the allowed period.`,
    relatedId: opportunityId
  });
}

async function refundOneInvestmentInFull(inv, adminId, description) {
  const investmentRef = docRef(COLLECTIONS.INVESTMENTS, inv.id);
  const walletRef = docRef(COLLECTIONS.WALLETS, inv.investorId);
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  await runTransaction(db, async (tx) => {
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) throw new Error("Investor wallet not found.");
    const wallet = walletSnap.data();

    tx.update(investmentRef, {
      status: "refunded",
      completedAt: serverTimestamp(),
      refundAmount: inv.investedAmount,
      payoutAmount: inv.investedAmount
    });

    tx.update(walletRef, {
      availableBalance: round2(Number(wallet.availableBalance) + Number(inv.investedAmount)),
      lockedBalance: round2(Number(wallet.lockedBalance || 0) - Number(inv.investedAmount)),
      totalRefunded: round2(Number(wallet.totalRefunded || 0) + Number(inv.investedAmount)),
      updatedAt: serverTimestamp()
    });

    tx.set(walletTxRef, {
      userId: inv.investorId,
      type: "refund",
      amount: inv.investedAmount,
      status: "completed",
      relatedOpportunityId: inv.opportunityId,
      relatedInvestmentId: inv.id,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      processedBy: adminId,
      description
    });
  });
}

export async function getSettlementsForOpportunity(opportunityId) {
  return getMany(COLLECTIONS.SETTLEMENTS, where("opportunityId", "==", opportunityId));
}

export async function getAllSettlements() {
  return getMany(COLLECTIONS.SETTLEMENTS);
}

export { calculateTotalReturnObligation };
