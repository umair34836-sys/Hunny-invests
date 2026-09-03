// notifications.js — in-app notification creation & retrieval (no push/email).

import {
  COLLECTIONS, createDoc, getMany, updateDocById, docRef, updateDoc,
  query, where, orderBy, fsLimit, col, getDocs, serverTimestamp
} from "./firestore.js";

/** Create a notification for a specific user. */
export async function notifyUser(userId, { type, title, message, link = null, relatedId = null }) {
  return createDoc(COLLECTIONS.NOTIFICATIONS, {
    userId,
    type,
    title,
    message,
    link,
    relatedId,
    read: false,
    createdAt: serverTimestamp()
  });
}

/** Create the same notification for many users (e.g. all investors in an opportunity). */
export async function notifyUsers(userIds, payload) {
  await Promise.all([...new Set(userIds)].filter(Boolean).map((uid) => notifyUser(uid, payload)));
}

/** Create a notification for every admin/super_admin (used sparingly; requires an admins list). */
export async function notifyAdmins(adminIds, payload) {
  return notifyUsers(adminIds, payload);
}

export async function getUserNotifications(userId, max = 50) {
  return getMany(
    COLLECTIONS.NOTIFICATIONS,
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    fsLimit(max)
  );
}

export async function getUnreadCount(userId) {
  const items = await getMany(
    COLLECTIONS.NOTIFICATIONS,
    where("userId", "==", userId),
    where("read", "==", false)
  );
  return items.length;
}

export async function markNotificationRead(notificationId) {
  return updateDocById(COLLECTIONS.NOTIFICATIONS, notificationId, { read: true });
}

export async function markAllRead(userId) {
  const items = await getMany(COLLECTIONS.NOTIFICATIONS, where("userId", "==", userId), where("read", "==", false));
  await Promise.all(items.map((n) => updateDocById(COLLECTIONS.NOTIFICATIONS, n.id, { read: true })));
}

/** Fetch the user IDs of all admin/super_admin accounts (used to route platform-wide alerts). */
export async function getAdminUserIds() {
  const admins = await getMany(COLLECTIONS.USERS, where("role", "in", ["admin", "super_admin"]));
  return admins.map((a) => a.id);
}
