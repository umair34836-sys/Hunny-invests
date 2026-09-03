// firebase-config.js
// Central Firebase initialization for the Investment Opportunity Platform.
// Firebase SDK v12.18.0 (loaded via CDN ES modules). No Firebase Storage, no Cloud Functions.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// Firebase Web configuration (public config — access control is enforced by
// Firestore Security Rules, not by hiding this object).
export const firebaseConfig = {
  apiKey: "AIzaSyDnKFkNOeHqMC_8MC-KDnZvlRClezP-GGQ",
  authDomain: "investment-platform-31cbf.firebaseapp.com",
  projectId: "investment-platform-31cbf",
  storageBucket: "investment-platform-31cbf.firebasestorage.app",
  messagingSenderId: "457748349619",
  appId: "1:457748349619:web:367cd239d85dd5c0c6e6c6"
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* ignore persistence errors (e.g. private browsing) */
});

let dbInstance;
try {
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) })
  });
} catch (e) {
  // Fallback for browsers without IndexedDB support / multiple tabs edge cases.
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js");
  dbInstance = getFirestore(app);
}
export const db = dbInstance;

// Platform-wide constants
export const CURRENCY = "PKR";
export const PLATFORM_NAME = "Hunny Invests";
export const ZERO_SALE_REFUND_FEE_PERCENT = 1;
export const EARLY_EXIT_FEE_PERCENT = 2;
