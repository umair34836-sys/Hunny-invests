// admin.js — admin-only workflows: deposits, withdrawals, role management,
// freezing/suspension, manual corrections, platform overview stats.
// These are UX conveniences; firestore.rules independently requires the
// caller's users/{uid}.role to be 'admin' or 'super_admin' for every write here.

import { db } from "./firebase-config.js";
import {
  COLLECTIONS, docRef, col, doc, runTransaction, serverTimestamp,
  getMany, getOne, where, orderBy, fsLimit, updateDocById, writeAuditLog
} from "./firestore.js";
import { round2 } from "./utils.js";
import { notifyUser } from "./notifications.js";
import { ROLES } from "./auth.js";

/* --------------------------------- Deposits --------------------------------- */

export async function approveDeposit(depositId, adminId) {
  const depositRef = docRef(COLLECTIONS.DEPOSIT_REQUESTS, depositId);
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  const result = await runTransaction(db, async (tx) => {
    const depSnap = await tx.get(depositRef);
    if (!depSnap.exists()) throw new Error("Deposit request not found.");
    const dep = depSnap.data();
    if (dep.status !== "pending") throw new Error("This deposit request has already been processed.");

    const walletRef = docRef(COLLECTIONS.WALLETS, dep.userId);
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) throw new Error("Investor wallet not found.");
    const wallet = walletSnap.data();

    tx.update(walletRef, {
      availableBalance: round2(Number(wallet.availableBalance) + Number(dep.amount)),
      totalDeposited: round2(Number(wallet.totalDeposited || 0) + Number(dep.amount)),
      updatedAt: serverTimestamp()
    });

    tx.update(depositRef, { status: "approved", processedAt: serverTimestamp(), processedBy: adminId });

    tx.set(walletTxRef, {
      userId: dep.userId,
      type: "deposit_approved",
      amount: dep.amount,
      status: "completed",
      relatedOpportunityId: null,
      relatedInvestmentId: null,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      processedBy: adminId,
      description: `Deposit approved via ${dep.paymentMethod || "bank transfer"}`
    });

    return { userId: dep.userId, amount: dep.amount };
  });

  await notifyUser(result.userId, {
    type: "deposit_approved",
    title: "Deposit approved",
    message: `Your deposit of ${result.amount} PKR has been approved and added to your wallet.`,
    link: "wallet.html"
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "deposit_approved", entityType: "depositRequest", entityId: depositId, newValue: result });
}

export async function rejectDeposit(depositId, adminId, reason) {
  const dep = await getOne(COLLECTIONS.DEPOSIT_REQUESTS, depositId);
  if (!dep) throw new Error("Deposit request not found.");
  if (dep.status !== "pending") throw new Error("This deposit request has already been processed.");
  await updateDocById(COLLECTIONS.DEPOSIT_REQUESTS, depositId, { status: "rejected", processedAt: serverTimestamp(), processedBy: adminId, rejectionReason: reason || "" });
  await notifyUser(dep.userId, {
    type: "deposit_rejected",
    title: "Deposit rejected",
    message: `Your deposit request of ${dep.amount} PKR was rejected. Reason: ${reason || "Not specified."}`,
    link: "wallet.html"
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "deposit_rejected", entityType: "depositRequest", entityId: depositId, reason });
}

export async function getPendingDeposits() {
  return getMany(COLLECTIONS.DEPOSIT_REQUESTS, where("status", "==", "pending"), orderBy("requestedAt", "asc"));
}

export async function getAllDeposits(max = 300) {
  return getMany(COLLECTIONS.DEPOSIT_REQUESTS, orderBy("requestedAt", "desc"), fsLimit(max));
}

/* -------------------------------- Withdrawals -------------------------------- */

export async function approveWithdrawal(withdrawalId, adminId) {
  const withdrawalRef = docRef(COLLECTIONS.WITHDRAWAL_REQUESTS, withdrawalId);
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  const result = await runTransaction(db, async (tx) => {
    const wSnap = await tx.get(withdrawalRef);
    if (!wSnap.exists()) throw new Error("Withdrawal request not found.");
    const w = wSnap.data();
    if (w.status !== "pending") throw new Error("This withdrawal request has already been processed.");

    const walletRef = docRef(COLLECTIONS.WALLETS, w.userId);
    const walletSnap = await tx.get(walletRef);
    if (!walletSnap.exists()) throw new Error("Investor wallet not found.");
    const wallet = walletSnap.data();
    if (Number(wallet.availableBalance) < Number(w.amount)) {
      throw new Error("Investor no longer has sufficient available balance for this withdrawal.");
    }

    tx.update(walletRef, {
      availableBalance: round2(Number(wallet.availableBalance) - Number(w.amount)),
      totalWithdrawn: round2(Number(wallet.totalWithdrawn || 0) + Number(w.amount)),
      updatedAt: serverTimestamp()
    });

    tx.update(withdrawalRef, { status: "approved", processedAt: serverTimestamp(), processedBy: adminId });

    tx.set(walletTxRef, {
      userId: w.userId,
      type: "withdrawal_approved",
      amount: w.amount,
      status: "completed",
      relatedOpportunityId: null,
      relatedInvestmentId: null,
      createdAt: serverTimestamp(),
      processedAt: serverTimestamp(),
      processedBy: adminId,
      description: `Withdrawal paid via ${w.paymentMethod || "bank transfer"}`
    });

    return { userId: w.userId, amount: w.amount };
  });

  await notifyUser(result.userId, {
    type: "withdrawal_approved",
    title: "Withdrawal approved",
    message: `Your withdrawal of ${result.amount} PKR has been processed.`,
    link: "wallet.html"
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "withdrawal_approved", entityType: "withdrawalRequest", entityId: withdrawalId, newValue: result });
}

export async function rejectWithdrawal(withdrawalId, adminId, reason) {
  const w = await getOne(COLLECTIONS.WITHDRAWAL_REQUESTS, withdrawalId);
  if (!w) throw new Error("Withdrawal request not found.");
  if (w.status !== "pending") throw new Error("This withdrawal request has already been processed.");
  await updateDocById(COLLECTIONS.WITHDRAWAL_REQUESTS, withdrawalId, { status: "rejected", processedAt: serverTimestamp(), processedBy: adminId, rejectionReason: reason || "" });
  await notifyUser(w.userId, {
    type: "withdrawal_rejected",
    title: "Withdrawal rejected",
    message: `Your withdrawal request of ${w.amount} PKR was rejected. Reason: ${reason || "Not specified."}`,
    link: "wallet.html"
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "withdrawal_rejected", entityType: "withdrawalRequest", entityId: withdrawalId, reason });
}

export async function getPendingWithdrawals() {
  return getMany(COLLECTIONS.WITHDRAWAL_REQUESTS, where("status", "==", "pending"), orderBy("requestedAt", "asc"));
}

export async function getAllWithdrawals(max = 300) {
  return getMany(COLLECTIONS.WITHDRAWAL_REQUESTS, orderBy("requestedAt", "desc"), fsLimit(max));
}

/* ------------------------------ Users & Owners ------------------------------- */

export async function getAllUsersByRole(role) {
  return getMany(COLLECTIONS.USERS, where("role", "==", role), orderBy("createdAt", "desc"));
}

export async function grantOwnerRole(userId, adminId) {
  const user = await getOne(COLLECTIONS.USERS, userId);
  if (!user) throw new Error("User not found.");
  await updateDocById(COLLECTIONS.USERS, userId, { role: ROLES.OWNER, ownerApprovedAt: serverTimestamp(), ownerApprovedBy: adminId });
  await notifyUser(userId, {
    type: "owner_approved",
    title: "Owner access granted",
    message: "You now have owner access and can create investment opportunities.",
    link: "owner-dashboard.html"
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "owner_role_granted", entityType: "user", entityId: userId });
}

export async function revokeOwnerRole(userId, adminId) {
  await updateDocById(COLLECTIONS.USERS, userId, { role: ROLES.INVESTOR });
  await notifyUser(userId, { type: "owner_revoked", title: "Owner access revoked", message: "Your owner access has been revoked by admin." });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "owner_role_revoked", entityType: "user", entityId: userId });
}

export async function grantAdminRole(userId, adminId) {
  await updateDocById(COLLECTIONS.USERS, userId, { role: ROLES.ADMIN });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "admin_role_granted", entityType: "user", entityId: userId });
}

export async function suspendUser(userId, adminId, reason) {
  await updateDocById(COLLECTIONS.USERS, userId, { status: "suspended", suspendedAt: serverTimestamp(), suspendedBy: adminId, suspensionReason: reason || "" });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "user_suspended", entityType: "user", entityId: userId, reason });
}

export async function reactivateUser(userId, adminId) {
  await updateDocById(COLLECTIONS.USERS, userId, { status: "active", suspendedAt: null, suspendedBy: null, suspensionReason: null });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "user_reactivated", entityType: "user", entityId: userId });
}

/* ------------------------------ Manual corrections ---------------------------- */

/** Admin-only manual wallet correction (spec §24 "Correct data where permitted"). */
export async function adjustWallet(userId, adminId, { field, amount, reason }) {
  const allowed = ["availableBalance", "lockedBalance", "totalDeposited", "totalInvested", "totalProfit", "totalWithdrawn", "totalRefunded"];
  if (!allowed.includes(field)) throw new Error("Invalid wallet field.");
  const walletRef = docRef(COLLECTIONS.WALLETS, userId);
  const walletTxRef = doc(col(COLLECTIONS.WALLET_TRANSACTIONS));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(walletRef);
    if (!snap.exists()) throw new Error("Wallet not found.");
    const wallet = snap.data();
    const newValue = round2(Number(wallet[field] || 0) + Number(amount));
    tx.update(walletRef, { [field]: newValue, updatedAt: serverTimestamp() });
    tx.set(walletTxRef, {
      userId, type: "adjustment", amount: Number(amount), status: "completed",
      relatedOpportunityId: null, relatedInvestmentId: null,
      createdAt: serverTimestamp(), processedAt: serverTimestamp(), processedBy: adminId,
      description: `Manual adjustment to ${field}: ${reason || "no reason given"}`
    });
  });

  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "wallet_adjustment", entityType: "wallet", entityId: userId, newValue: { field, amount }, reason });
}

/* ----------------------------------- Audit ----------------------------------- */

export async function getAuditLogs(max = 200) {
  return getMany(COLLECTIONS.AUDIT_LOGS, orderBy("timestamp", "desc"), fsLimit(max));
}

/* --------------------------------- Overview ----------------------------------- */

export async function getPlatformOverview() {
  const [investors, owners, opportunities, deposits, withdrawals, investments] = await Promise.all([
    getMany(COLLECTIONS.USERS, where("role", "==", "investor")),
    getMany(COLLECTIONS.USERS, where("role", "==", "owner")),
    getMany(COLLECTIONS.OPPORTUNITIES),
    getMany(COLLECTIONS.DEPOSIT_REQUESTS),
    getMany(COLLECTIONS.WITHDRAWAL_REQUESTS),
    getMany(COLLECTIONS.INVESTMENTS)
  ]);

  const activeOpportunities = opportunities.filter((o) => ["funding", "awaiting_stock_purchase", "active"].includes(o.status)).length;
  const maturedOpportunities = opportunities.filter((o) => ["matured", "settlement_pending"].includes(o.status)).length;
  const totalDeposits = deposits.filter((d) => d.status === "approved").reduce((s, d) => s + Number(d.amount), 0);
  const lockedInvestments = investments.filter((i) => ["invested", "active"].includes(i.status)).reduce((s, i) => s + Number(i.investedAmount), 0);
  const pendingDeposits = deposits.filter((d) => d.status === "pending").length;
  const pendingWithdrawals = withdrawals.filter((w) => w.status === "pending").length;
  const refundPending = opportunities.filter((o) => o.status === "refund_pending").length;

  return {
    totalUsers: investors.length + owners.length,
    investors: investors.length,
    owners: owners.length,
    activeOpportunities,
    totalWalletDeposits: round2(totalDeposits),
    lockedInvestments: round2(lockedInvestments),
    pendingDeposits,
    pendingWithdrawals,
    pendingRefunds: refundPending,
    maturedOpportunities
  };
}
