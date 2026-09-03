// firestore.js — collection references and generic Firestore CRUD helpers.

import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  startAfter,
  onSnapshot,
  serverTimestamp,
  runTransaction,
  writeBatch,
  increment
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, fsLimit, startAfter, onSnapshot, serverTimestamp,
  runTransaction, writeBatch, increment
};

export const COLLECTIONS = {
  USERS: "users",
  PROFILES: "profiles",
  WALLETS: "wallets",
  WALLET_TRANSACTIONS: "walletTransactions",
  DEPOSIT_REQUESTS: "depositRequests",
  WITHDRAWAL_REQUESTS: "withdrawalRequests",
  OPPORTUNITIES: "opportunities",
  INVESTMENTS: "investments",
  STOCK_ITEMS: "stockItems",
  SALES: "sales",
  EXPENSES: "expenses",
  SETTLEMENTS: "settlements",
  NOTIFICATIONS: "notifications",
  AUDIT_LOGS: "auditLogs",
  PLATFORM_SETTINGS: "platformSettings",
  SUPPORT_TICKETS: "supportTickets"
};

export function col(name) {
  return collection(db, name);
}

export function docRef(name, id) {
  return doc(db, name, id);
}

export async function getOne(name, id) {
  const snap = await getDoc(docRef(name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getMany(name, ...clauses) {
  const q = query(col(name), ...clauses);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createDoc(name, data) {
  const ref = await addDoc(col(name), data);
  return ref.id;
}

export async function createDocWithId(name, id, data) {
  await setDoc(docRef(name, id), data);
  return id;
}

export async function updateDocById(name, id, data) {
  await updateDoc(docRef(name, id), data);
}

export async function writeAuditLog({ actorId, actorRole, action, entityType, entityId, oldValue, newValue, reason }) {
  return createDoc(COLLECTIONS.AUDIT_LOGS, {
    actorId: actorId || null,
    actorRole: actorRole || null,
    action,
    entityType,
    entityId: entityId || null,
    oldValue: oldValue !== undefined ? JSON.stringify(oldValue).slice(0, 2000) : null,
    newValue: newValue !== undefined ? JSON.stringify(newValue).slice(0, 2000) : null,
    reason: reason || null,
    timestamp: serverTimestamp()
  });
}
