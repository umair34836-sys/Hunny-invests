// stock.js — manual stock quantity tracking & item-level records (owner-managed).

import {
  COLLECTIONS, getOne, getMany, createDoc, updateDocById,
  where, orderBy, serverTimestamp, writeAuditLog
} from "./firestore.js";

/** Owner manually corrects remaining stock (e.g. damaged/returned items). Always audited. */
export async function ownerAdjustStock(opportunityId, ownerId, { newRemainingQuantity, reason }) {
  const opp = await getOne(COLLECTIONS.OPPORTUNITIES, opportunityId);
  if (!opp || opp.ownerId !== ownerId) throw new Error("Not authorized for this opportunity.");
  if (!["active", "matured"].includes(opp.status)) {
    throw new Error("Stock can only be adjusted while the opportunity is active.");
  }
  const newRemaining = Math.max(0, Number(newRemainingQuantity));
  const oldRemaining = Number(opp.remainingQuantity);

  await updateDocById(COLLECTIONS.OPPORTUNITIES, opportunityId, {
    remainingQuantity: newRemaining,
    updatedAt: serverTimestamp()
  });

  await writeAuditLog({
    actorId: ownerId,
    actorRole: "owner",
    action: "stock_adjusted",
    entityType: "opportunity",
    entityId: opportunityId,
    oldValue: { remainingQuantity: oldRemaining },
    newValue: { remainingQuantity: newRemaining },
    reason
  });
}

/** Optional item-level stock record (batch/lot tracking) — future-ready, Phase 2. */
export async function createStockItem(opportunityId, ownerId, { name, quantity, unitCost, notes }) {
  return createDoc(COLLECTIONS.STOCK_ITEMS, {
    opportunityId,
    ownerId,
    name,
    quantity: Number(quantity) || 0,
    unitCost: Number(unitCost) || 0,
    notes: notes || "",
    createdAt: serverTimestamp()
  });
}

export async function getStockItems(opportunityId) {
  return getMany(COLLECTIONS.STOCK_ITEMS, where("opportunityId", "==", opportunityId), orderBy("createdAt", "desc"));
}
