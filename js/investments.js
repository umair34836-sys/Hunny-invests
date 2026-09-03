// investments.js — investing from wallet, viewing investments, early exit.
// The core money-moving actions (invest / early exit) run inside a single
// Firestore transaction so the wallet, opportunity and investment documents
// stay consistent, and firestore.rules independently re-validates the same
// deltas so a malicious client can't just skip this file.

import { db, EARLY_EXIT_FEE_PERCENT } from "./firebase-config.js";
import {
  COLLECTIONS, docRef, col, doc, runTransaction, serverTimestamp,
  getMany, getOne, where, orderBy, fsLimit, increment
} from "./firestore.js";
import { round2 } from "./utils.js";
import {
  calculateInvestorProfit, calculateExpectedPayout, calculateStockShare,
  validateInvestmentAmount, calculateEarlyExitFee, calculateEarlyExitRefund
} from "./calculations.js";
import { markFullyFundedAndAwaitingStockPurchase } from "./opportunities.js";
import { notifyUser } from "./notifications.js";

/**
 * Invest `amount` from the investor's wallet into an opportunity.
 * Throws with a user-facing message on any validation failure.
 */
export async function investInOpportunity({ opportunityId, investorId, amount }) {
  const amt = round2(Number(amount));
  const oppRef = docRef(COLLECTIONS.OPPORTUNITIES, opportunityId);
  const walletRef = docRef(COLLECTIONS.WALLETS, investorId);
  const investmentRef = doc(col(COLLECTIONS.INVESTMENTS));
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  const result = await runTransaction(db, async (tx) => {
    const oppSnap = await tx.get(oppRef);
    const walletSnap = await tx.get(walletRef);
    if (!oppSnap.exists()) throw new Error("Opportunity not found.");
    if (!walletSnap.exists()) throw new Error("Wallet not found.");
    const opp = oppSnap.data();
    const wallet = walletSnap.data();

    if (opp.status !== "funding") {
      throw new Error("This opportunity is not currently open for investment.");
    }
    const remaining = round2(Math.max(Number(opp.requiredCapital) - Number(opp.fundedAmount || 0), 0));
    const validation = validateInvestmentAmount({
      amount: amt,
      minInvestment: opp.minimumInvestment,
      maxInvestment: opp.maximumInvestmentPerInvestor,
      availableBalance: wallet.availableBalance,
      remainingFunding: remaining
    });
    if (!validation.valid) throw new Error(validation.reason);

    const newFunded = round2(Number(opp.fundedAmount || 0) + amt);
    if (newFunded > Number(opp.requiredCapital) + 0.01) {
      throw new Error("This investment would exceed the opportunity's funding target.");
    }
    const profit = calculateInvestorProfit(amt, opp.investorReturnPercent);
    const payout = calculateExpectedPayout(amt, opp.investorReturnPercent);
    const stockShare = calculateStockShare(amt, opp.requiredCapital);

    tx.set(investmentRef, {
      opportunityId,
      opportunityTitle: opp.title,
      investorId,
      investedAmount: amt,
      investorReturnPercent: Number(opp.investorReturnPercent),
      expectedProfit: profit,
      expectedMaturityAmount: payout,
      stockSharePercent: stockShare,
      zeroSaleRefundFeePercent: opp.zeroSaleRefundFeePercent ?? 1,
      earlyExitFeePercent: opp.earlyExitFeePercent ?? EARLY_EXIT_FEE_PERCENT,
      status: "invested",
      investedAt: serverTimestamp(),
      activeAt: null,
      maturityAt: null,
      completedAt: null,
      exitRequestedAt: null,
      exitFee: null,
      refundAmount: null,
      payoutAmount: null
    });

    tx.update(oppRef, {
      fundedAmount: newFunded,
      investorCount: increment(1),
      updatedAt: serverTimestamp()
    });

    tx.update(walletRef, {
      availableBalance: round2(Number(wallet.availableBalance) - amt),
      lockedBalance: round2(Number(wallet.lockedBalance || 0) + amt),
      totalInvested: round2(Number(wallet.totalInvested || 0) + amt),
      updatedAt: serverTimestamp()
    });

    tx.set(walletTxRef, {
      userId: investorId,
      type: "investment",
      amount: amt,
      status: "completed",
      relatedOpportunityId: opportunityId,
      relatedInvestmentId: investmentRef.id,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      processedBy: investorId,
      description: `Invested in ${opp.title}`
    });

    return { newFunded, requiredCapital: Number(opp.requiredCapital), investmentId: investmentRef.id, ownerId: opp.ownerId, title: opp.title };
  });

  if (result.newFunded >= result.requiredCapital) {
    // Best-effort: the money-moving transaction above already succeeded, so
    // don't fail this investment if this secondary status flip loses a race
    // with another investor's concurrent request (rules only allow the
    // 'funding' -> 'awaiting_stock_purchase' transition once).
    try {
      await markFullyFundedAndAwaitingStockPurchase(opportunityId);
    } catch (e) {
      console.warn("Funding-complete transition skipped:", e.message);
    }
  } else {
    await notifyUser(result.ownerId, {
      type: "new_investment",
      title: "New investment received",
      message: `Your opportunity "${result.title}" received a new investment.`,
      link: `owner-opportunity.html?id=${opportunityId}`,
      relatedId: opportunityId
    });
  }

  await notifyUser(investorId, {
    type: "investment_successful",
    title: "Investment successful",
    message: `You invested ${amt} PKR in "${result.title}".`,
    link: `investment.html?id=${result.investmentId}`,
    relatedId: result.investmentId
  });

  return result.investmentId;
}

/**
 * Early exit request — only valid while the investment's opportunity has not
 * yet started (status === 'invested'). Applies the configured early-exit fee.
 */
export async function requestEarlyExit({ investmentId, investorId }) {
  const investmentRef = docRef(COLLECTIONS.INVESTMENTS, investmentId);
  const walletRef = docRef(COLLECTIONS.WALLETS, investorId);
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  const result = await runTransaction(db, async (tx) => {
    const invSnap = await tx.get(investmentRef);
    const walletSnap = await tx.get(walletRef);
    if (!invSnap.exists()) throw new Error("Investment not found.");
    if (!walletSnap.exists()) throw new Error("Wallet not found.");
    const inv = invSnap.data();
    const wallet = walletSnap.data();

    if (inv.investorId !== investorId) throw new Error("Not authorized.");
    if (inv.status !== "invested") {
      throw new Error("Early exit is only available before the investment period starts.");
    }
    const feePercent = inv.earlyExitFeePercent ?? EARLY_EXIT_FEE_PERCENT;
    const fee = calculateEarlyExitFee(inv.investedAmount, feePercent);
    const refund = calculateEarlyExitRefund(inv.investedAmount, feePercent);

    tx.update(investmentRef, {
      status: "exited",
      exitRequestedAt: serverTimestamp(),
      exitFee: fee,
      refundAmount: refund,
      completedAt: serverTimestamp()
    });

    tx.update(walletRef, {
      availableBalance: round2(Number(wallet.availableBalance) + refund),
      lockedBalance: round2(Number(wallet.lockedBalance || 0) - Number(inv.investedAmount)),
      totalRefunded: round2(Number(wallet.totalRefunded || 0) + refund),
      updatedAt: serverTimestamp()
    });

    tx.set(walletTxRef, {
      userId: investorId,
      type: "early_exit_fee",
      amount: refund,
      status: "completed",
      relatedOpportunityId: inv.opportunityId,
      relatedInvestmentId: investmentId,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      processedBy: investorId,
      description: `Early exit from "${inv.opportunityTitle}" (fee: ${fee} PKR)`
    });

    const oppRef = docRef(COLLECTIONS.OPPORTUNITIES, inv.opportunityId);
    tx.update(oppRef, {
      fundedAmount: increment(-Number(inv.investedAmount)),
      investorCount: increment(-1),
      updatedAt: serverTimestamp()
    });

    return { fee, refund, title: inv.opportunityTitle };
  });

  await notifyUser(investorId, {
    type: "early_exit_processed",
    title: "Early exit processed",
    message: `You exited "${result.title}" early. Refund: ${result.refund} PKR (fee: ${result.fee} PKR).`,
    relatedId: investmentId
  });

  return result;
}

export async function getInvestment(id) {
  return getOne(COLLECTIONS.INVESTMENTS, id);
}

export async function getInvestorInvestments(investorId, max = 200) {
  return getMany(COLLECTIONS.INVESTMENTS, where("investorId", "==", investorId), orderBy("investedAt", "desc"), fsLimit(max));
}

export async function getOpportunityInvestments(opportunityId) {
  return getMany(COLLECTIONS.INVESTMENTS, where("opportunityId", "==", opportunityId), orderBy("investedAmount", "desc"));
}

export function filterInvestmentsByStage(investments, stage) {
  if (!stage || stage === "all") return investments;
  const map = {
    active: ["invested", "active"],
    matured: ["active"],
    completed: ["completed"],
    refunded: ["refunded", "exited"],
    cancelled: ["cancelled"]
  };
  const set = map[stage] || [stage];
  return investments.filter((i) => set.includes(i.status));
}
