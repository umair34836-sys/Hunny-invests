// opportunities.js — opportunity CRUD, status-machine transitions, listing/filtering.
// Status machine (per spec §10):
// draft -> pending_review -> funding -> awaiting_stock_purchase -> active
//   -> matured -> settlement_pending -> completed
// Alt: awaiting_stock_purchase -> refund_pending -> refunded
// Admin can freeze/cancel/reject at appropriate stages.

import {
  COLLECTIONS, getOne, getMany, createDoc, updateDocById,
  where, orderBy, fsLimit, serverTimestamp, writeAuditLog
} from "./firestore.js";
import { slugify, addDays, formatPKR, formatPercent, escapeHTML, isValidImageUrl } from "./utils.js";
import { notifyUser, notifyUsers, getAdminUserIds } from "./notifications.js";
import { calculateFundingProgress } from "./calculations.js";
import { statusBadge, progressBar } from "./ui.js";

export const DEFAULT_STOCK_PURCHASE_WINDOW_DAYS = 30;

export async function getOpportunity(id) {
  return getOne(COLLECTIONS.OPPORTUNITIES, id);
}

export async function getOpportunityBySlug(slug) {
  const items = await getMany(COLLECTIONS.OPPORTUNITIES, where("slug", "==", slug), fsLimit(1));
  return items[0] || null;
}

export async function listPublicOpportunities({ category, sort = "newest" } = {}) {
  const clauses = [where("status", "in", ["funding", "awaiting_stock_purchase", "active", "matured", "completed"])];
  if (category) clauses.push(where("category", "==", category));
  clauses.push(orderBy(sort === "ending_soon" ? "fundingDeadline" : "createdAt", sort === "ending_soon" ? "asc" : "desc"));
  clauses.push(fsLimit(100));
  return getMany(COLLECTIONS.OPPORTUNITIES, ...clauses);
}

export async function listOwnerOpportunities(ownerId) {
  return getMany(COLLECTIONS.OPPORTUNITIES, where("ownerId", "==", ownerId), orderBy("createdAt", "desc"));
}

export async function listOpportunitiesByStatus(status, max = 200) {
  if (status === "all" || !status) {
    return getMany(COLLECTIONS.OPPORTUNITIES, orderBy("createdAt", "desc"), fsLimit(max));
  }
  return getMany(COLLECTIONS.OPPORTUNITIES, where("status", "==", status), orderBy("createdAt", "desc"), fsLimit(max));
}

export async function createOpportunityDraft(ownerId, data) {
  const slugBase = slugify(data.title);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const stockQuantity = Number(data.productQuantity) || 0;

  const id = await createDoc(COLLECTIONS.OPPORTUNITIES, {
    ownerId,
    title: data.title,
    slug,
    category: data.category || "general",
    description: data.description || "",
    imageUrl: data.imageUrl || "",
    productName: data.productName,
    productDetails: data.productDetails || "",
    productQuantity: stockQuantity,
    purchaseCost: Number(data.purchaseCost) || 0,
    requiredCapital: Number(data.requiredCapital),
    minimumInvestment: Number(data.minimumInvestment),
    maximumInvestmentPerInvestor: Number(data.maximumInvestmentPerInvestor),
    investorReturnPercent: Number(data.investorReturnPercent),
    durationMonths: Number(data.durationMonths),
    fundingDeadline: data.fundingDeadline || null,
    stockPurchaseWindowDays: Number(data.stockPurchaseWindowDays) || DEFAULT_STOCK_PURCHASE_WINDOW_DAYS,
    stockPurchaseDeadline: null,
    currency: "PKR",
    zeroSaleRefundFeePercent: 1,
    earlyExitFeePercent: 2,
    status: "draft",
    fundedAmount: 0,
    investorCount: 0,
    stockQuantity,
    soldQuantity: 0,
    remainingQuantity: stockQuantity,
    revenueTotal: 0,
    actualPurchaseCost: null,
    purchasedQuantity: null,
    stockPurchasedAt: null,
    activeAt: null,
    maturityAt: null,
    settledAt: null,
    rejectionReason: null,
    freezeReason: null,
    previousStatus: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await writeAuditLog({ actorId: ownerId, actorRole: "owner", action: "opportunity_created", entityType: "opportunity", entityId: id, newValue: { title: data.title } });
  return id;
}

export async function updateOpportunityDraft(id, data) {
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, {
    ...data,
    productQuantity: Number(data.productQuantity),
    stockQuantity: Number(data.productQuantity),
    remainingQuantity: Number(data.productQuantity),
    purchaseCost: Number(data.purchaseCost) || 0,
    requiredCapital: Number(data.requiredCapital),
    minimumInvestment: Number(data.minimumInvestment),
    maximumInvestmentPerInvestor: Number(data.maximumInvestmentPerInvestor),
    investorReturnPercent: Number(data.investorReturnPercent),
    durationMonths: Number(data.durationMonths),
    updatedAt: serverTimestamp()
  });
}

export async function submitForReview(id, ownerId) {
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, { status: "pending_review", updatedAt: serverTimestamp() });
  const admins = await getAdminUserIds();
  await notifyUsers(admins, {
    type: "opportunity_pending_review",
    title: "New opportunity pending review",
    message: "An owner submitted a new opportunity for approval.",
    link: `admin-opportunities.html?id=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: ownerId, actorRole: "owner", action: "opportunity_submitted_for_review", entityType: "opportunity", entityId: id });
}

export async function adminApproveOpportunity(id, adminId) {
  const opp = await getOpportunity(id);
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, {
    status: "funding",
    fundingStartAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  await notifyUser(opp.ownerId, {
    type: "opportunity_approved",
    title: "Opportunity approved",
    message: `Your opportunity "${opp.title}" is now live and open for funding.`,
    link: `owner-opportunity.html?id=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "opportunity_approved", entityType: "opportunity", entityId: id });
}

export async function adminRejectOpportunity(id, adminId, reason) {
  const opp = await getOpportunity(id);
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, { status: "rejected", rejectionReason: reason || "", updatedAt: serverTimestamp() });
  await notifyUser(opp.ownerId, {
    type: "opportunity_rejected",
    title: "Opportunity rejected",
    message: `Your opportunity "${opp.title}" was rejected. Reason: ${reason || "Not specified."}`,
    link: `owner-opportunity.html?id=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "opportunity_rejected", entityType: "opportunity", entityId: id, reason });
}

export async function adminFreezeOpportunity(id, adminId, reason) {
  const opp = await getOpportunity(id);
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, {
    status: "frozen",
    previousStatus: opp.status,
    freezeReason: reason || "",
    updatedAt: serverTimestamp()
  });
  await notifyUser(opp.ownerId, {
    type: "opportunity_frozen",
    title: "Opportunity frozen",
    message: `Your opportunity "${opp.title}" has been frozen by admin. Reason: ${reason || "Not specified."}`,
    link: `owner-opportunity.html?id=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "opportunity_frozen", entityType: "opportunity", entityId: id, reason });
}

export async function adminUnfreezeOpportunity(id, adminId) {
  const opp = await getOpportunity(id);
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, {
    status: opp.previousStatus || "funding",
    previousStatus: null,
    freezeReason: null,
    updatedAt: serverTimestamp()
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "opportunity_unfrozen", entityType: "opportunity", entityId: id });
}

export async function adminCancelOpportunity(id, adminId, reason) {
  const opp = await getOpportunity(id);
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, { status: "cancelled", freezeReason: reason || "", updatedAt: serverTimestamp() });
  await notifyUser(opp.ownerId, {
    type: "opportunity_cancelled",
    title: "Opportunity cancelled",
    message: `Your opportunity "${opp.title}" has been cancelled by admin.`,
    link: `owner-opportunity.html?id=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: adminId, actorRole: "admin", action: "opportunity_cancelled", entityType: "opportunity", entityId: id, reason });
}

/** Called internally right after an investment pushes fundedAmount to 100% (see investments.js). */
export async function markFullyFundedAndAwaitingStockPurchase(id) {
  const opp = await getOpportunity(id);
  const deadline = addDays(new Date(), opp.stockPurchaseWindowDays || DEFAULT_STOCK_PURCHASE_WINDOW_DAYS);
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, {
    status: "awaiting_stock_purchase",
    fullyFundedAt: serverTimestamp(),
    stockPurchaseDeadline: deadline,
    updatedAt: serverTimestamp()
  });
  await notifyUser(opp.ownerId, {
    type: "opportunity_fully_funded",
    title: "Opportunity fully funded! 🎉",
    message: `"${opp.title}" reached 100% funding. Please purchase stock and start the investment period.`,
    link: `owner-opportunity.html?id=${id}`,
    relatedId: id
  });
}

/**
 * Owner action: "Stock Purchased — Start Investment".
 * Moves awaiting_stock_purchase -> active, records purchase info, starts the timer.
 */
export async function ownerStartInvestment(id, ownerId, { actualPurchaseCost, purchasedQuantity, purchaseDate, referenceNote }) {
  const opp = await getOpportunity(id);
  if (!opp || opp.ownerId !== ownerId) throw new Error("Not authorized for this opportunity.");
  if (opp.status !== "awaiting_stock_purchase") {
    throw new Error("Stock can only be purchased once the opportunity is fully funded and awaiting purchase.");
  }
  const activeAt = new Date();
  const maturityAt = new Date(activeAt);
  maturityAt.setMonth(maturityAt.getMonth() + Number(opp.durationMonths || 0));

  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, {
    status: "active",
    actualPurchaseCost: Number(actualPurchaseCost) || 0,
    purchasedQuantity: Number(purchasedQuantity) || opp.stockQuantity,
    stockPurchasedAt: purchaseDate ? new Date(purchaseDate) : activeAt,
    purchaseReferenceNote: referenceNote || "",
    activeAt,
    maturityAt,
    updatedAt: serverTimestamp()
  });

  const investments = await getMany(COLLECTIONS.INVESTMENTS, where("opportunityId", "==", id), where("status", "==", "invested"));
  await Promise.all(investments.map((inv) => updateDocById(COLLECTIONS.INVESTMENTS, inv.id, {
    status: "active",
    activeAt,
    maturityAt
  })));

  const investorIds = await getOpportunityInvestorIds(id);
  await notifyUsers(investorIds, {
    type: "investment_started",
    title: "Investment period started",
    message: `"${opp.title}" has started. Maturity date: ${maturityAt.toDateString()}.`,
    link: `investment.html?opportunityId=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: ownerId, actorRole: "owner", action: "stock_purchased_investment_started", entityType: "opportunity", entityId: id, newValue: { actualPurchaseCost, purchasedQuantity } });
}

export async function getOpportunityInvestorIds(opportunityId) {
  const investments = await getMany(COLLECTIONS.INVESTMENTS, where("opportunityId", "==", opportunityId));
  return [...new Set(investments.map((i) => i.investorId))];
}

/** Owner confirms the opportunity has matured and final figures are ready for admin settlement. */
/** Shared opportunity-card markup used across the marketplace and dashboards. */
export function renderOpportunityCardHTML(opp, { linkBase = "opportunity.html?id=" } = {}) {
  const progress = calculateFundingProgress(opp.fundedAmount, opp.requiredCapital);
  const img = isValidImageUrl(opp.imageUrl)
    ? `<img class="opp-card__img" src="${escapeHTML(opp.imageUrl)}" alt="${escapeHTML(opp.productName || opp.title)}" loading="lazy">`
    : `<div class="opp-card__img opp-card__img--placeholder">📦</div>`;
  return `
    <a class="opp-card" href="${linkBase}${opp.id}" style="text-decoration:none;color:inherit;">
      ${img}
      <div class="opp-card__body">
        <div class="opp-card__tags">
          ${statusBadge(opp.status)}
          <span class="pill-tag">${escapeHTML(opp.category || "General")}</span>
        </div>
        <h3 class="opp-card__title">${escapeHTML(opp.title)}</h3>
        <div class="opp-card__figures">
          <span>Funded</span><b>${formatPKR(opp.fundedAmount)} / ${formatPKR(opp.requiredCapital)}</b>
        </div>
        ${progressBar(progress)}
        <div class="opp-card__footer">
          <div class="stat-pill"><strong>${formatPercent(opp.investorReturnPercent)}</strong>Return</div>
          <div class="stat-pill"><strong>${opp.durationMonths}mo</strong>Duration</div>
          <div class="stat-pill"><strong>${formatPKR(opp.minimumInvestment)}</strong>Min.</div>
        </div>
      </div>
    </a>`;
}

export async function ownerSubmitSettlement(id, ownerId) {
  const opp = await getOpportunity(id);
  if (!opp || opp.ownerId !== ownerId) throw new Error("Not authorized for this opportunity.");
  await updateDocById(COLLECTIONS.OPPORTUNITIES, id, { status: "settlement_pending", updatedAt: serverTimestamp() });
  const admins = await getAdminUserIds();
  await notifyUsers(admins, {
    type: "settlement_required",
    title: "Settlement required",
    message: `Opportunity "${opp.title}" has matured and is ready for final settlement.`,
    link: `admin-settlements.html?id=${id}`,
    relatedId: id
  });
  await writeAuditLog({ actorId: ownerId, actorRole: "owner", action: "settlement_submitted", entityType: "opportunity", entityId: id });
}
