// guards.js — client-side route guards. NOTE: these are UX conveniences only;
// real enforcement happens in Firestore Security Rules (firestore.rules).

import { getCurrentSession } from "./auth.js";

/**
 * Require the current user to be signed in (and optionally have one of `roles`).
 * Redirects to login.html (or an appropriate page) when the requirement isn't met.
 * Returns { user, userRecord, profile } on success.
 */
export async function requireAuth(roles = null) {
  const session = await getCurrentSession();
  if (!session.user || !session.userRecord) {
    redirectToLogin();
    return null;
  }
  if (session.userRecord.status === "suspended" || session.userRecord.status === "frozen") {
    window.location.href = "account-suspended.html";
    return null;
  }
  if (roles && !roles.includes(session.userRecord.role)) {
    window.location.href = homeForRole(session.userRecord.role);
    return null;
  }
  return session;
}

/** For pages that behave differently when logged in vs not, without forcing redirect. */
export async function getOptionalSession() {
  return getCurrentSession();
}

export function redirectToLogin() {
  const redirect = encodeURIComponent(window.location.pathname.split("/").pop());
  window.location.href = `login.html?redirect=${redirect}`;
}

export function homeForRole(role) {
  switch (role) {
    case "admin":
    case "super_admin":
      return "admin-dashboard.html";
    case "owner":
      return "owner-dashboard.html";
    default:
      return "dashboard.html";
  }
}

export function isAdminRole(role) {
  return role === "admin" || role === "super_admin";
}
