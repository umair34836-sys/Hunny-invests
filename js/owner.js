// owner.js — owner dashboard aggregation & financial summaries.

import { round2 } from "./utils.js";
import { calculateTotalReturnObligation } from "./calculations.js";
import { listOwnerOpportunities } from "./opportunities.js";
import { getSalesForOpportunity, getExpensesForOpportunity } from "./sales.js";
import { getOpportunityInvestments } from "./investments.js";

export { listOwnerOpportunities };

export async function getOwnerStats(ownerId) {
  const opportunities = await listOwnerOpportunities(ownerId);

  const activeOpportunities = opportunities.filter((o) => ["funding", "awaiting_stock_purchase", "active"].includes(o.status)).length;
  const totalFundedCapital = round2(opportunities.reduce((s, o) => s + Number(o.fundedAmount || 0), 0));
  const stockPurchased = opportunities.filter((o) => o.stockPurchasedAt).length;
  const soldUnits = opportunities.reduce((s, o) => s + Number(o.soldQuantity || 0), 0);
  const revenue = round2(opportunities.reduce((s, o) => s + Number(o.revenueTotal || 0), 0));
  const pendingSettlements = opportunities.filter((o) => ["matured", "settlement_pending"].includes(o.status)).length;

  const totalCosts = round2(opportunities.reduce((s, o) => s + Number(o.actualPurchaseCost || o.purchaseCost || 0), 0));
  const totalInvestorObligation = round2(opportunities.reduce((s, o) => s + calculateTotalReturnObligation(o.fundedAmount || 0, o.investorReturnPercent || 0), 0));
  const businessProfitEstimate = round2(revenue - totalCosts - totalInvestorObligation);

  return {
    opportunities,
    activeOpportunities,
    totalFundedCapital,
    stockPurchased,
    soldUnits,
    revenue,
    businessProfitEstimate,
    pendingSettlements
  };
}

/** Full financial summary for a single opportunity, for the owner's detail/settlement pages. */
export async function getOpportunityFinancialSummary(opportunityId) {
  const [investments, sales, expenses] = await Promise.all([
    getOpportunityInvestments(opportunityId),
    getSalesForOpportunity(opportunityId),
    getExpensesForOpportunity(opportunityId)
  ]);

  const totalExpenses = round2(expenses.reduce((s, e) => s + Number(e.amount || 0), 0));
  const totalRevenue = round2(sales.reduce((s, s2) => s + Number(s2.saleAmount || 0), 0));

  return { investments, sales, expenses, totalExpenses, totalRevenue };
}
