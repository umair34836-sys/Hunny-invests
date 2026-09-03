// ui.js — shared layout shell, toasts, modals, loading/empty states, badges.

import { PLATFORM_NAME } from "./firebase-config.js";
import { logoutUser } from "./auth.js";
import { escapeHTML } from "./utils.js";

/* ---------------------------------- Toasts --------------------------------- */

let toastRoot = null;
function ensureToastRoot() {
  if (!toastRoot) {
    toastRoot = document.createElement("div");
    toastRoot.className = "toast-root";
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

export function toast(message, type = "info", duration = 4200) {
  const root = ensureToastRoot();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  const icon = { success: "✓", error: "✕", warning: "!", info: "i" }[type] || "i";
  el.innerHTML = `<span class="toast__icon">${icon}</span><span class="toast__msg">${escapeHTML(message)}</span>`;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--show"));
  setTimeout(() => {
    el.classList.remove("toast--show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

/* ---------------------------------- Modals --------------------------------- */

let modalRoot = null;
function ensureModalRoot() {
  if (!modalRoot) {
    modalRoot = document.createElement("div");
    modalRoot.className = "modal-root";
    document.body.appendChild(modalRoot);
  }
  return modalRoot;
}

export function openModal(innerHTML, { onClose } = {}) {
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="modal-backdrop" data-close="1">
      <div class="modal-card" role="dialog" aria-modal="true">
        <button class="modal-close" data-close="1" aria-label="Close">&times;</button>
        <div class="modal-content">${innerHTML}</div>
      </div>
    </div>`;
  root.classList.add("modal-root--open");
  root.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) closeModal();
    });
  });
  document.body.style.overflow = "hidden";
  if (onClose) root._onClose = onClose;
  return root.querySelector(".modal-card");
}

export function closeModal() {
  const root = ensureModalRoot();
  root.classList.remove("modal-root--open");
  document.body.style.overflow = "";
  if (root._onClose) {
    const cb = root._onClose;
    root._onClose = null;
    cb();
  }
  setTimeout(() => { root.innerHTML = ""; }, 200);
}

export function confirmModal(message, { title = "Please confirm", confirmText = "Confirm", cancelText = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    openModal(`
      <h3 class="modal-title">${escapeHTML(title)}</h3>
      <p class="modal-message">${escapeHTML(message)}</p>
      <div class="modal-actions">
        <button class="btn btn--ghost" id="modal-cancel-btn">${escapeHTML(cancelText)}</button>
        <button class="btn ${danger ? "btn--danger" : "btn--primary"}" id="modal-confirm-btn">${escapeHTML(confirmText)}</button>
      </div>
    `);
    document.getElementById("modal-cancel-btn").addEventListener("click", () => { closeModal(); resolve(false); });
    document.getElementById("modal-confirm-btn").addEventListener("click", () => { closeModal(); resolve(true); });
  });
}

export function promptModal(message, { title = "Provide details", placeholder = "", confirmText = "Submit", required = false } = {}) {
  return new Promise((resolve) => {
    openModal(`
      <h3 class="modal-title">${escapeHTML(title)}</h3>
      <p class="modal-message">${escapeHTML(message)}</p>
      <textarea class="input" id="prompt-modal-input" rows="3" placeholder="${escapeHTML(placeholder)}"></textarea>
      <div class="form-error" id="prompt-modal-error"></div>
      <div class="modal-actions">
        <button class="btn btn--ghost" id="prompt-cancel-btn">Cancel</button>
        <button class="btn btn--primary" id="prompt-submit-btn">${escapeHTML(confirmText)}</button>
      </div>
    `, { onClose: () => resolve(null) });
    document.getElementById("prompt-cancel-btn").addEventListener("click", () => { closeModal(); resolve(null); });
    document.getElementById("prompt-submit-btn").addEventListener("click", () => {
      const value = document.getElementById("prompt-modal-input").value.trim();
      if (required && !value) {
        document.getElementById("prompt-modal-error").textContent = "This field is required.";
        return;
      }
      const root = ensureModalRoot();
      root._onClose = null;
      closeModal();
      resolve(value);
    });
  });
}

/* ------------------------------ Loading / Empty ----------------------------- */

export function loadingHTML(message = "Loading…") {
  return `<div class="state-block state-block--loading"><div class="spinner"></div><p>${escapeHTML(message)}</p></div>`;
}

export function emptyHTML(message = "Nothing here yet.", { icon = "📭", actionHTML = "" } = {}) {
  return `<div class="state-block state-block--empty"><div class="state-icon">${icon}</div><p>${escapeHTML(message)}</p>${actionHTML}</div>`;
}

/**
 * Render an error state. Pass the caught error as the second argument to
 * surface a real, actionable detail beneath the friendly message — this
 * matters a lot while the app is still being wired up (missing Firestore
 * indexes / unpublished security rules are the two most common causes of a
 * page silently failing to load, and both are otherwise invisible to
 * someone without devtools open on a phone).
 */
export function errorHTML(message = "Something went wrong. Please try again.", error = null) {
  let detailHTML = "";
  if (error) {
    const raw = (error && (error.message || String(error))) || "";
    const indexLinkMatch = raw.match(/https:\/\/console\.firebase\.google\.com\S+/);
    if (error.code === "failed-precondition" && indexLinkMatch) {
      detailHTML = `<p class="error-detail">This screen needs a Firestore index that hasn't been created yet.
        <a href="${escapeHTML(indexLinkMatch[0])}" target="_blank" rel="noopener">Tap here to create it in Firebase Console</a>, wait a minute, then reload this page.</p>`;
    } else if (error.code === "permission-denied") {
      detailHTML = `<p class="error-detail"><strong>permission-denied</strong> — Firestore Security Rules blocked this read. Make sure <code>firestore.rules</code> has been published in Firebase Console → Firestore Database → Rules.</p>`;
    } else if (raw) {
      detailHTML = `<p class="error-detail">${escapeHTML(error.code ? `${error.code}: ${raw}` : raw)}</p>`;
    }
  }
  return `<div class="state-block state-block--error"><div class="state-icon">⚠️</div><p>${escapeHTML(message)}</p>${detailHTML}</div>`;
}

export function setContent(containerId, html) {
  const el = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
  if (el) el.innerHTML = html;
}

/* ---------------------------------- Badges ---------------------------------- */

const STATUS_CLASS_MAP = {
  draft: "badge--gray",
  pending_review: "badge--amber",
  funding: "badge--blue",
  fully_funded: "badge--teal",
  awaiting_stock_purchase: "badge--amber",
  active: "badge--green",
  matured: "badge--purple",
  settlement_pending: "badge--amber",
  completed: "badge--green",
  cancelled: "badge--gray",
  refund_pending: "badge--amber",
  refunded: "badge--gray",
  frozen: "badge--red",
  rejected: "badge--red",
  pending: "badge--amber",
  approved: "badge--green",
  rejected_status: "badge--red",
  paid: "badge--green"
};

export function statusBadge(status) {
  const cls = STATUS_CLASS_MAP[status] || "badge--gray";
  const label = String(status || "").split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return `<span class="badge ${cls}">${escapeHTML(label)}</span>`;
}

export function progressBar(percent, { showLabel = true } = {}) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="progress">
      <div class="progress__track"><div class="progress__fill" style="width:${pct}%"></div></div>
      ${showLabel ? `<span class="progress__label">${pct.toFixed(pct % 1 === 0 ? 0 : 1)}%</span>` : ""}
    </div>`;
}

/* --------------------------------- App Shell -------------------------------- */

const PUBLIC_NAV = [
  { key: "home", label: "Home", href: "index.html" },
  { key: "opportunities", label: "Opportunities", href: "opportunities.html" },
  { key: "how-it-works", label: "How It Works", href: "how-it-works.html" },
  { key: "about", label: "About", href: "about.html" },
  { key: "contact", label: "Contact", href: "contact.html" }
];

export function renderPublicNav(activeKey, session = null) {
  const header = document.getElementById("site-header");
  if (!header) return;
  const authArea = session?.user
    ? `<a class="btn btn--ghost btn--sm" href="${homeForRole(session.userRecord?.role)}">Dashboard</a>`
    : `<a class="btn btn--ghost btn--sm" href="login.html">Log in</a><a class="btn btn--primary btn--sm" href="register.html">Get Started</a>`;

  header.innerHTML = `
    <div class="nav-wrap">
      <a href="index.html" class="brand"><span class="brand__mark">H</span>${escapeHTML(PLATFORM_NAME)}</a>
      <button class="nav-toggle" id="nav-toggle" aria-label="Menu">☰</button>
      <nav class="public-nav" id="public-nav">
        ${PUBLIC_NAV.map((n) => `<a href="${n.href}" class="${n.key === activeKey ? "active" : ""}">${n.label}</a>`).join("")}
        <div class="public-nav__auth">${authArea}</div>
      </nav>
    </div>`;
  document.getElementById("nav-toggle")?.addEventListener("click", () => {
    document.getElementById("public-nav")?.classList.toggle("public-nav--open");
  });
  renderPublicFooter();
}

function homeForRole(role) {
  if (role === "admin" || role === "super_admin") return "admin-dashboard.html";
  if (role === "owner") return "owner-dashboard.html";
  return "dashboard.html";
}

function renderPublicFooter() {
  const footer = document.getElementById("site-footer");
  if (!footer) return;
  footer.innerHTML = `
    <div class="footer-wrap">
      <div class="footer-col">
        <div class="brand"><span class="brand__mark">H</span>${escapeHTML(PLATFORM_NAME)}</div>
        <p class="footer-note">A transparent marketplace connecting investors with real, small-batch business opportunities in Pakistan.</p>
      </div>
      <div class="footer-col">
        <h4>Platform</h4>
        <a href="opportunities.html">Opportunities</a>
        <a href="how-it-works.html">How It Works</a>
        <a href="about.html">About Us</a>
        <a href="contact.html">Contact</a>
      </div>
      <div class="footer-col">
        <h4>Legal</h4>
        <a href="terms.html">Terms of Service</a>
        <a href="privacy.html">Privacy Policy</a>
        <a href="risk-disclosure.html">Risk Disclosure</a>
      </div>
    </div>
    <div class="footer-bottom">© ${new Date().getFullYear()} ${escapeHTML(PLATFORM_NAME)}. All rights reserved. Investing involves risk — read our <a href="risk-disclosure.html">Risk Disclosure</a>.</div>`;
}

const NAV_BY_ROLE = {
  investor: [
    { key: "dashboard", label: "Dashboard", href: "dashboard.html", icon: "🏠" },
    { key: "opportunities", label: "Opportunities", href: "opportunities.html", icon: "📈" },
    { key: "investments", label: "My Investments", href: "investments.html", icon: "💼" },
    { key: "wallet", label: "Wallet", href: "wallet.html", icon: "👛" },
    { key: "transactions", label: "Transactions", href: "transactions.html", icon: "🧾" },
    { key: "notifications", label: "Notifications", href: "notifications.html", icon: "🔔" },
    { key: "profile", label: "Profile", href: "profile.html", icon: "👤" }
  ],
  owner: [
    { key: "owner-dashboard", label: "Dashboard", href: "owner-dashboard.html", icon: "🏠" },
    { key: "owner-opportunities", label: "Opportunities", href: "owner-opportunities.html", icon: "📦" },
    { key: "owner-create-opportunity", label: "Create New", href: "owner-create-opportunity.html", icon: "➕" },
    { key: "notifications", label: "Notifications", href: "notifications.html", icon: "🔔" },
    { key: "profile", label: "Profile", href: "profile.html", icon: "👤" }
  ],
  admin: [
    { key: "admin-dashboard", label: "Overview", href: "admin-dashboard.html", icon: "🏠" },
    { key: "admin-users", label: "Investors", href: "admin-users.html", icon: "👥" },
    { key: "admin-owners", label: "Owners", href: "admin-owners.html", icon: "🏭" },
    { key: "admin-opportunities", label: "Opportunities", href: "admin-opportunities.html", icon: "📦" },
    { key: "admin-investments", label: "Investments", href: "admin-investments.html", icon: "💼" },
    { key: "admin-deposits", label: "Deposits", href: "admin-deposits.html", icon: "⬇️" },
    { key: "admin-withdrawals", label: "Withdrawals", href: "admin-withdrawals.html", icon: "⬆️" },
    { key: "admin-refunds", label: "Refunds", href: "admin-refunds.html", icon: "↩️" },
    { key: "admin-transactions", label: "Transactions", href: "admin-transactions.html", icon: "🧾" },
    { key: "admin-sales", label: "Stock / Sales", href: "admin-sales.html", icon: "🛒" },
    { key: "admin-settlements", label: "Settlements", href: "admin-settlements.html", icon: "⚖️" },
    { key: "admin-audit", label: "Audit Logs", href: "admin-audit.html", icon: "📜" },
    { key: "admin-settings", label: "Settings", href: "admin-settings.html", icon: "⚙️" }
  ]
};

const MOBILE_NAV_BY_ROLE = {
  investor: ["dashboard", "opportunities", "investments", "wallet", "notifications"],
  owner: ["owner-dashboard", "owner-opportunities", "owner-create-opportunity", "notifications", "profile"],
  admin: ["admin-dashboard", "admin-opportunities", "admin-deposits", "admin-withdrawals", "admin-audit"]
};

/**
 * Render the authenticated app shell (sidebar + topbar + bottom nav).
 * Returns the #page-content element to render page-specific markup into.
 */
export function renderAppShell({ role, active, title, profile, unreadCount = 0 }) {
  const items = NAV_BY_ROLE[role] || NAV_BY_ROLE.investor;
  const mobileKeys = MOBILE_NAV_BY_ROLE[role] || MOBILE_NAV_BY_ROLE.investor;

  const shell = document.getElementById("app-shell");
  if (!shell) return null;

  shell.innerHTML = `
    <aside class="sidebar">
      <a href="index.html" class="brand brand--sidebar"><span class="brand__mark">H</span>${escapeHTML(PLATFORM_NAME)}</a>
      <nav class="sidebar-nav">
        ${items.map((n) => `<a href="${n.href}" class="sidebar-nav__item ${n.key === active ? "active" : ""}"><span class="sidebar-nav__icon">${n.icon}</span>${n.label}</a>`).join("")}
      </nav>
      <button class="sidebar-logout" id="logout-btn">⏻ Log out</button>
    </aside>
    <div class="app-main">
      <header class="topbar">
        <h1 class="topbar__title">${escapeHTML(title || "")}</h1>
        <div class="topbar__actions">
          <a href="notifications.html" class="icon-btn" aria-label="Notifications">
            🔔${unreadCount > 0 ? `<span class="icon-btn__dot">${unreadCount > 9 ? "9+" : unreadCount}</span>` : ""}
          </a>
          <a href="profile.html" class="topbar__user">
            <span class="avatar">${escapeHTML((profile?.fullName || profile?.email || "U").charAt(0).toUpperCase())}</span>
            <span class="topbar__username">${escapeHTML(profile?.fullName || profile?.email || "Account")}</span>
          </a>
        </div>
      </header>
      <main class="page-content" id="page-content"></main>
    </div>
    <nav class="bottom-nav">
      ${mobileKeys.map((key) => {
        const n = items.find((i) => i.key === key);
        if (!n) return "";
        return `<a href="${n.href}" class="bottom-nav__item ${n.key === active ? "active" : ""}"><span>${n.icon}</span><small>${n.label}</small></a>`;
      }).join("")}
    </nav>`;

  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    const ok = await confirmModal("Are you sure you want to log out?", { title: "Log out", confirmText: "Log out" });
    if (ok) {
      await logoutUser();
      window.location.href = "login.html";
    }
  });

  return document.getElementById("page-content");
}

export function skeletonCards(count = 3) {
  return Array.from({ length: count }).map(() => `<div class="skeleton-card"></div>`).join("");
}
