// calculations.js — centralized financial calculation engine.
// Per spec section 31. All monetary math is rounded to 2 decimal places at
// every step to avoid unsafe floating point accumulation.

import { round2 } from "./utils.js";
import { ZERO_SALE_REFUND_FEE_PERCENT, EARLY_EXIT_FEE_PERCENT } from "./firebase-config.js";

/** profit = amount * returnPercent / 100 */
export function calculateInvestorProfit(amount, returnPercent) {
  return round2((Number(amount) || 0) * (Number(returnPercent) || 0) / 100);
}

/** payout = amount + profit */
export function calculateExpectedPayout(amount, returnPercent) {
  const profit = calculateInvestorProfit(amount, returnPercent);
  return round2((Number(amount) || 0) + profit);
}

/** stockSharePercent = amount / totalFunding * 100 */
export function calculateStockShare(investment, totalFunding) {
  if (!totalFunding || Number(totalFunding) <= 0) return 0;
  return round2((Number(investment) || 0) / Number(totalFunding) * 100);
}

/** Proportional stock units entitled to an investor. */
export function calculateStockUnits(investment, totalFunding, stockQuantity) {
  const sharePercent = calculateStockShare(investment, totalFunding);
  return round2((sharePercent / 100) * (Number(stockQuantity) || 0));
}

/** zeroSaleFee = amount * (ZERO_SALE_REFUND_FEE_PERCENT / 100) */
export function calculateZeroSaleFee(amount, feePercent = ZERO_SALE_REFUND_FEE_PERCENT) {
  return round2((Number(amount) || 0) * (Number(feePercent) || 0) / 100);
}

/** zeroSaleRefund = amount - zeroSaleFee */
export function calculateZeroSaleRefund(amount, feePercent = ZERO_SALE_REFUND_FEE_PERCENT) {
  const fee = calculateZeroSaleFee(amount, feePercent);
  return round2((Number(amount) || 0) - fee);
}

/** earlyExitFee = amount * (EARLY_EXIT_FEE_PERCENT / 100) */
export function calculateEarlyExitFee(amount, feePercent = EARLY_EXIT_FEE_PERCENT) {
  return round2((Number(amount) || 0) * (Number(feePercent) || 0) / 100);
}

/** earlyExitRefund = amount - earlyExitFee */
export function calculateEarlyExitRefund(amount, feePercent = EARLY_EXIT_FEE_PERCENT) {
  const fee = calculateEarlyExitFee(amount, feePercent);
  return round2((Number(amount) || 0) - fee);
}

/** fundingProgress = funded / target * 100 (capped at 100) */
export function calculateFundingProgress(funded, target) {
  if (!target || Number(target) <= 0) return 0;
  const pct = (Number(funded) || 0) / Number(target) * 100;
  return round2(Math.min(pct, 100));
}

/** remainingFunding = target - funded (never negative) */
export function calculateRemainingFunding(funded, target) {
  const remaining = (Number(target) || 0) - (Number(funded) || 0);
  return round2(Math.max(remaining, 0));
}

/**
 * Compute the maturity settlement outcome for a single investment.
 * soldQuantity is the opportunity's total units sold at maturity.
 */
export function calculateSettlementOutcome(investedAmount, investorReturnPercent, soldQuantity, zeroSaleFeePercent = ZERO_SALE_REFUND_FEE_PERCENT) {
  if (Number(soldQuantity) > 0) {
    const profit = calculateInvestorProfit(investedAmount, investorReturnPercent);
    const payout = calculateExpectedPayout(investedAmount, investorReturnPercent);
    return { outcome: "profit", profit, payout, fee: 0 };
  }
  const fee = calculateZeroSaleFee(investedAmount, zeroSaleFeePercent);
  const payout = calculateZeroSaleRefund(investedAmount, zeroSaleFeePercent);
  return { outcome: "zero_sale_refund", profit: 0, payout, fee };
}

/** Total investor return obligation across an opportunity's funded capital. */
export function calculateTotalReturnObligation(totalFunded, returnPercent) {
  return calculateInvestorProfit(totalFunded, returnPercent);
}

/** Validate an investment amount against opportunity constraints. */
export function validateInvestmentAmount({ amount, minInvestment, maxInvestment, availableBalance, remainingFunding }) {
  const amt = Number(amount);
  if (!amt || amt <= 0) return { valid: false, reason: "Enter a valid investment amount." };
  if (minInvestment != null && amt < Number(minInvestment)) {
    return { valid: false, reason: `Minimum investment is ${minInvestment}.` };
  }
  if (maxInvestment != null && amt > Number(maxInvestment)) {
    return { valid: false, reason: `Maximum investment per investor is ${maxInvestment}.` };
  }
  if (availableBalance != null && amt > Number(availableBalance)) {
    return { valid: false, reason: "Amount exceeds your available wallet balance." };
  }
  if (remainingFunding != null && amt > Number(remainingFunding)) {
    return { valid: false, reason: "Amount exceeds the remaining funding needed for this opportunity." };
  }
  return { valid: true };
}
