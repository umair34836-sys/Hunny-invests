// wallet.js — wallet reads and deposit/withdrawal REQUEST creation.
// Actual balance mutations for deposits/withdrawals happen only through admin
// approval (see admin.js) per the manual verification flow in the spec.
// Investment locking/unlocking is handled in investments.js via Firestore
// transactions (investor-initiated, delta-validated by firestore.rules).

import {
  COLLECTIONS, getOne, getMany, createDoc, updateDocById,
  where, serverTimestamp
} from "./firestore.js";
import { sortByField } from "./utils.js";

export async function getWallet(userId) {
  return getOne(COLLECTIONS.WALLETS, userId);
}

export async function createDepositRequest({ userId, amount, paymentMethod, referenceNote }) {
  if (!(Number(amount) > 0)) throw new Error("Enter a valid deposit amount.");
  return createDoc(COLLECTIONS.DEPOSIT_REQUESTS, {
    userId,
    amount: Number(amount),
    paymentMethod: paymentMethod || "bank_transfer",
    referenceNote: referenceNote || "",
    status: "pending",
    requestedAt: serverTimestamp(),
    processedAt: null,
    processedBy: null
  });
}

export async function cancelDepositRequest(depositId) {
  return updateDocById(COLLECTIONS.DEPOSIT_REQUESTS, depositId, { status: "cancelled" });
}

export async function getUserDepositRequests(userId, max = 50) {
  const items = await getMany(COLLECTIONS.DEPOSIT_REQUESTS, where("userId", "==", userId));
  return sortByField(items, "requestedAt", "desc", max);
}

export async function createWithdrawalRequest({ userId, amount, availableBalance, paymentMethod, accountTitle, accountNumber }) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error("Enter a valid withdrawal amount.");
  if (amt > Number(availableBalance || 0)) throw new Error("Withdrawal amount exceeds your available wallet balance.");
  return createDoc(COLLECTIONS.WITHDRAWAL_REQUESTS, {
    userId,
    amount: amt,
    paymentMethod: paymentMethod || "bank_transfer",
    accountTitle: accountTitle || "",
    accountNumber: accountNumber || "",
    status: "pending",
    requestedAt: serverTimestamp(),
    processedAt: null,
    processedBy: null
  });
}

export async function cancelWithdrawalRequest(withdrawalId) {
  return updateDocById(COLLECTIONS.WITHDRAWAL_REQUESTS, withdrawalId, { status: "cancelled" });
}

export async function getUserWithdrawalRequests(userId, max = 50) {
  const items = await getMany(COLLECTIONS.WITHDRAWAL_REQUESTS, where("userId", "==", userId));
  return sortByField(items, "requestedAt", "desc", max);
}

/** Sum of the user's currently-pending withdrawal requests (to avoid over-requesting). */
export async function getPendingWithdrawalTotal(userId) {
  const items = await getMany(COLLECTIONS.WITHDRAWAL_REQUESTS, where("userId", "==", userId), where("status", "==", "pending"));
  return items.reduce((sum, w) => sum + Number(w.amount || 0), 0);
}

export async function getUserWalletTransactions(userId, max = 100) {
  const items = await getMany(COLLECTIONS.WALLET_TRANSACTIONS, where("userId", "==", userId));
  return sortByField(items, "createdAt", "desc", max);
}
