// auth.js — registration, login, logout, session/role helpers.

import { auth } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { getOne, COLLECTIONS } from "./firestore.js";

const ROLES = { INVESTOR: "investor", OWNER: "owner", ADMIN: "admin", SUPER_ADMIN: "super_admin" };
export { ROLES };

/** Register a new investor account: Firebase Auth user + users doc + profiles doc + wallet doc. */
export async function registerInvestor({ fullName, email, phone, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  await setDoc(doc(db, COLLECTIONS.USERS, uid), {
    uid,
    email,
    role: ROLES.INVESTOR,
    status: "active",
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, COLLECTIONS.PROFILES, uid), {
    uid,
    fullName,
    phone,
    email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await setDoc(doc(db, COLLECTIONS.WALLETS, uid), {
    uid,
    availableBalance: 0,
    lockedBalance: 0,
    totalDeposited: 0,
    totalInvested: 0,
    totalProfit: 0,
    totalWithdrawn: 0,
    totalRefunded: 0,
    updatedAt: serverTimestamp()
  });

  return uid;
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

/** Wait for the initial auth state to resolve; resolves with the Firebase user or null. */
export function waitForAuthUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export function watchAuthUser(callback) {
  return onAuthStateChanged(auth, callback);
}

/** Fetch the current user's role/status doc (users/{uid}). */
export async function getUserRecord(uid) {
  return getOne(COLLECTIONS.USERS, uid);
}

/** Fetch the current user's profile (profiles/{uid}). */
export async function getUserProfile(uid) {
  return getOne(COLLECTIONS.PROFILES, uid);
}

/** Convenience: get {user, userRecord, profile} for the currently signed-in Firebase user. */
export async function getCurrentSession() {
  const user = await waitForAuthUser();
  if (!user) return { user: null, userRecord: null, profile: null };
  const [userRecord, profile] = await Promise.all([
    getUserRecord(user.uid),
    getUserProfile(user.uid)
  ]);
  return { user, userRecord, profile };
}
