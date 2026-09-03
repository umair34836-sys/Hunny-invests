// sales.js — manual sales recording and expense tracking (owner-managed).
// Every stock/revenue adjustment here is auditable per spec §16/§19.

import {
  COLLECTIONS, getOne, getMany, createDoc, updateDocById,
  where, orderBy, fsLimit, serverTimestamp, writeAuditLog, increment
} from "./firestore.js";
import { round2 } from "./utils.js";

/* ----------------------------------- Sales ---------------------------------- */

export async function recordSale(opportunityId, ownerId, { quantity, saleAmount, saleDate, notes }) {
  const opp = await getOne(COLLECTIONS.OPPORTUNITIES, opportunityId);
  if (!opp || opp.ownerId !== ownerId) throw new Error("Not authorized for this opportunity.");
  if (!["active", "matured"].includes(opp.status)) {
    throw new Error("Sales can only be recorded while the opportunity is active.");
  }
  const qty = Number(quantity);
  if (!(qty > 0)) throw new Error("Enter a valid quantity sold.");
  if (qty > Number(opp.remainingQuantity)) throw new Error("Quantity exceeds remaining stock.");
  const amount = round2(Number(saleAmount) || 0);

  const saleId = await createDoc(COLLECTIONS.SALES, {
    opportunityId,
    productId: opportunityId,
    quantity: qty,
    saleAmount: amount,
    saleDate: saleDate ? new Date(saleDate) : serverTimestamp(),
    recordedBy: ownerId,
    notes: notes || "",
    createdAt: serverTimestamp()
  });

  await updateDocById(COLLECTIONS.OPPORTUNITIES, opportunityId, {
    soldQuantity: increment(qty),
    remainingQuantity: increment(-qty),
    revenueTotal: round2(Number(opp.revenueTotal || 0) + amount),
    updatedAt: serverTimestamp()
  });

  await writeAuditLog({
    actorId: ownerId,
    actorRole: "owner",
    action: "sale_recorded",
    entityType: "opportunity",
    entityId: opportunityId,
    newValue: { quantity: qty, saleAmount: amount }
  });

  return saleId;
}

export async function editSale(saleId, ownerId, { saleAmount, notes }) {
  const sale = await getOne(COLLECTIONS.SALES, saleId);
  if (!sale || sale.recordedBy !== ownerId) throw new Error("Not authorized for this sale.");
  const opp = await getOne(COLLECTIONS.OPPORTUNITIES, sale.opportunityId);
  const delta = round2(Number(saleAmount) - Number(sale.saleAmount));

  await updateDocById(COLLECTIONS.SALES, saleId, {
    saleAmount: round2(Number(saleAmount)),
    notes: notes ?? sale.notes,
    editedAt: serverTimestamp()
  });
  await updateDocById(COLLECTIONS.OPPORTUNITIES, sale.opportunityId, {
    revenueTotal: round2(Number(opp.revenueTotal || 0) + delta),
    updatedAt: serverTimestamp()
  });
  await writeAuditLog({
    actorId: ownerId, actorRole: "owner", action: "sale_edited", entityType: "sale", entityId: saleId,
    oldValue: { saleAmount: sale.saleAmount }, newValue: { saleAmount }
  });
}

export async function getSalesForOpportunity(opportunityId) {
  return getMany(COLLECTIONS.SALES, where("opportunityId", "==", opportunityId), orderBy("createdAt", "desc"));
}

export async function getAllSales(max = 200) {
  return getMany(COLLECTIONS.SALES, orderBy("createdAt", "desc"), fsLimit(max));
}

/* --------------------------------- Expenses --------------------------------- */

const EXPENSE_CATEGORIES = ["purchase", "shipping", "customs", "packaging", "advertising", "delivery", "returns", "other"];
export { EXPENSE_CATEGORIES };

export async function recordExpense(opportunityId, ownerId, { category, amount, date, description, proofReference }) {
  const opp = await getOne(COLLECTIONS.OPPORTUNITIES, opportunityId);
  if (!opp || opp.ownerId !== ownerId) throw new Error("Not authorized for this opportunity.");
  const expenseId = await createDoc(COLLECTIONS.EXPENSES, {
    opportunityId,
    ownerId,
    category: EXPENSE_CATEGORIES.includes(category) ? category : "other",
    amount: round2(Number(amount) || 0),
    date: date ? new Date(date) : serverTimestamp(),
    description: description || "",
    proofReference: proofReference || "",
    approvalStatus: "pending",
    createdAt: serverTimestamp(),
    settled: false
  });
  await writeAuditLog({ actorId: ownerId, actorRole: "owner", action: "expense_recorded", entityType: "expense", entityId: expenseId, newValue: { category, amount } });
  return expenseId;
}

export async function getExpensesForOpportunity(opportunityId) {
  return getMany(COLLECTIONS.EXPENSES, where("opportunityId", "==", opportunityId), orderBy("createdAt", "desc"));
}

/** Admin reviews/approves an expense; expenses are immutable to the owner once settled (spec §19). */
export async function adminReviewExpense(expenseId, adminId, approve) {
  const expense = await getOne(COLLECTIONS.EXPENSES, expenseId);
  if (!expense) throw new Error("Expense not found.");
  if (expense.settled) throw new Error("This expense has already been settled and cannot be changed.");
  await updateDocById(COLLECTIONS.EXPENSES, expenseId, {
    approvalStatus: approve ? "approved" : "rejected",
    reviewedBy: adminId,
    reviewedAt: serverTimestamp()
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: approve ? "expense_approved" : "expense_rejected", entityType: "expense", entityId: expenseId });
}
