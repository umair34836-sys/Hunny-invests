// utils.js — generic helpers shared across the app.

/** Round a monetary value to 2 decimal places using a safe strategy. */
export function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Format a number as PKR currency, e.g. 7800 -> "PKR 7,800" (2dp only if needed). */
export function formatPKR(value) {
  const n = round2(value || 0);
  const hasDecimals = Math.abs(n % 1) > 0.001;
  const formatted = n.toLocaleString("en-PK", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  });
  return `PKR ${formatted}`;
}

/** Format a plain number with thousands separators. */
export function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-PK");
}

/** Format a percent value, e.g. 5 -> "5%". */
export function formatPercent(value) {
  const n = Number(value || 0);
  return `${n % 1 === 0 ? n : n.toFixed(2)}%`;
}

/** Format a Firestore Timestamp / Date / millis into a readable date string. */
export function formatDate(value, opts = {}) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleDateString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts
  });
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("en-PK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Days remaining from now until a given date/timestamp. */
export function daysUntil(value) {
  const d = toDate(value);
  if (!d) return null;
  const diffMs = d.getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

/** Add N days to a Date and return a new Date. */
export function addDays(date, days) {
  const d = new Date(date instanceof Date ? date.getTime() : date);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

/** Simple client-generated ID (used only for local temp keys, not security-relevant). */
export function generateId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Turn a title into a URL-safe slug. */
export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

/** Escape a string for safe insertion into innerHTML. */
export function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/** Read query-string params from current location. */
export function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function setQueryParam(name, value) {
  const url = new URL(window.location.href);
  if (value === null || value === undefined || value === "") {
    url.searchParams.delete(name);
  } else {
    url.searchParams.set(name, value);
  }
  window.history.replaceState({}, "", url);
}

/** Debounce a function call. */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Basic image URL validator — only allow http(s) URLs pointing at common image extensions
 *  or known safe hosts, to reduce risk of embedding unsafe/unexpected content. */
export function isValidImageUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Human readable status label. */
export function statusLabel(status) {
  return String(status || "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
