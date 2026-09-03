# Hunny Invests — Investment Opportunity Platform

A mobile-first, Firebase-powered investment marketplace connecting investors
with real, small-batch business opportunities in Pakistan. Built exactly to
the accompanying product/technical specification: static HTML5/CSS3/vanilla
JS (ES Modules), Firebase Authentication + Firestore only — **no** Firebase
Storage, **no** Cloud Functions, **no** Node/PHP/other backend. Deployable
as-is to GitHub Pages.

> ⚠️ **This is a product-stage MVP, not a legally-reviewed real-money
> platform.** Read [§ Known Limitations](#known-limitations--production-notes)
> before accepting real public funds. Obtain Pakistan-specific legal/compliance
> advice first (see `risk-disclosure.html` and `terms.html`).

---

## 1. Tech Stack

- HTML5 / CSS3 / Vanilla JavaScript (ES Modules) — no build step, no bundler
- Firebase Authentication (email/password)
- Firebase Firestore (Native mode)
- Firebase JS SDK **v12.18.0**, loaded from the `gstatic.com` CDN in
  `js/firebase-config.js`
- PKR currency throughout
- Mobile-first responsive design (bottom nav on mobile, sidebar on desktop)

## 2. Project Structure

```
/index.html, opportunities.html, opportunity.html, about.html,
 how-it-works.html, terms.html, privacy.html, risk-disclosure.html,
 contact.html, login.html, register.html, account-suspended.html   ← public

/dashboard.html, wallet.html, deposit.html, withdraw.html,
 investments.html, investment.html, transactions.html,
 notifications.html, profile.html                                  ← investor

/owner-dashboard.html, owner-opportunities.html,
 owner-create-opportunity.html, owner-opportunity.html,
 owner-stock.html, owner-sales.html, owner-settlement.html          ← owner

/admin-dashboard.html, admin-users.html, admin-owners.html,
 admin-opportunities.html, admin-investments.html, admin-deposits.html,
 admin-withdrawals.html, admin-refunds.html, admin-transactions.html,
 admin-sales.html, admin-settlements.html, admin-audit.html,
 admin-settings.html                                                ← admin

/js/
  firebase-config.js   Firebase init (exact config supplied), constants
  utils.js             formatting, dates, slugify, debounce, escaping
  calculations.js       centralized financial calculation engine
  validators.js         form validation helpers
  firestore.js          collection refs + generic CRUD + audit log helper
  auth.js               register/login/logout/session
  guards.js              client-side route guards (UX only — see rules)
  ui.js                  app shell (sidebar/topbar/bottom-nav), toasts,
                          modals, badges, progress bars, states
  notifications.js       in-app notification create/read/mark-read
  wallet.js               wallet reads, deposit/withdrawal REQUEST creation
  opportunities.js        opportunity CRUD + status-machine transitions
  investments.js          invest / early-exit (Firestore transactions)
  stock.js                 manual stock adjustment + stock items
  sales.js                 manual sales + expense recording
  settlements.js           maturity settlement + deadline-refund engine
  owner.js                 owner dashboard aggregation
  admin.js                 admin workflows (deposits/withdrawals/roles/etc.)

/css/style.css, dashboard.css, responsive.css

/assets/icons/, /assets/images/                                    (empty, ready for use)

firestore.rules            Firestore Security Rules (the real access boundary)
firestore.indexes.json     Required composite indexes
firebase.json, .firebaserc  Firebase CLI config (rules/indexes deploy + optional Hosting)
```

No page-specific JS files were split out beyond the modules above — each
HTML page has a small inline `<script type="module">` that imports what it
needs from `/js/*`, matching the module list in the specification (§30)
without duplicating markup into a templating system GitHub Pages can't run.

## 3. Firebase Setup

The app is pre-configured with the Firebase project you supplied
(`investment-platform-31cbf`). To finish wiring it up:

1. **Enable Authentication** → Firebase Console → Build → Authentication →
   Sign-in method → enable **Email/Password**.
2. **Create Firestore** → Build → Firestore Database → Create database →
   start in **production mode** (the security rules below apply immediately).
3. **Deploy the security rules & indexes** (recommended, via the Firebase CLI):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Or paste the contents of `firestore.rules` directly into
   Firebase Console → Firestore Database → Rules → publish, and create the
   composite indexes listed in `firestore.indexes.json` manually (Firestore
   will also prompt you with a direct "create index" link the first time a
   missing-index query runs — click it).
4. **Authorized domains**: Firebase Console → Authentication → Settings →
   Authorized domains → add your GitHub Pages domain
   (`<username>.github.io`) so login/register works once deployed.

No other Firebase products are used — Storage and Cloud Functions are
intentionally **not** enabled, per the specification.

## 4. GitHub Pages Deployment

This is a static site with zero build step — copy/push and go.

1. Push this repository to GitHub (already done if you're reading this from
   the repo).
2. Repository → Settings → Pages → Source → **Deploy from a branch** → pick
   `main` (or your default branch) and `/ (root)` → Save.
3. Wait a minute for GitHub Pages to build, then visit
   `https://<username>.github.io/<repo>/index.html`.
4. Add that domain to Firebase's **Authorized domains** (step 4 above) or
   auth requests will be blocked.

No environment variables or secrets are needed — the Firebase Web config in
`js/firebase-config.js` is meant to be public; Firestore Security Rules are
the actual access-control boundary (see `firestore.rules`).

## 5. Firestore Indexes

`firestore.indexes.json` lists every composite index the app's queries need
(deposit/withdrawal history, investments by investor/opportunity, opportunity
listings by status/owner, notifications, audit trail, sales/expenses per
opportunity, etc.). Deploy them with the Firebase CLI command above, or let
Firestore prompt you per-query the first time you hit a missing index (each
error includes a one-click "create index" link — convenient during manual
testing).

## 6. Test / Admin Setup Instructions

There is **no self-serve admin signup** — this is intentional (spec §5/§28).
To bootstrap your first admin account:

1. Open the deployed site (or run it locally — any static file server
   works, e.g. `npx serve .`) and **register a normal account** via
   `register.html` (this always creates an `investor`-role account).
2. In Firebase Console → Firestore Database → `users` collection, find the
   document with that account's UID (matches the UID in Authentication →
   Users).
3. Edit the document and change `role` from `"investor"` to `"super_admin"`.
   *(`admin` also works, but `super_admin` is required to grant other admins
   later from `admin-settings.html`.)*
4. Log out and back in — you'll land on the Admin dashboard.

**Granting owner access** (spec §5/§23 — never self-assigned): once you have
an admin account, go to **Investors** (`admin-users.html`) and click **Make
Owner** next to any investor account, or set `role: "owner"` directly on
their `users/{uid}` document in the console.

**Granting further admins**: as a `super_admin`, go to
`admin-settings.html` → Admin Management → paste the target user's Firebase
Auth UID → Grant Admin Access.

### Suggested end-to-end test flow

1. As **admin**: promote a test account to `owner`.
2. As **owner**: create an opportunity (`owner-create-opportunity.html`),
   submit it for review.
3. As **admin**: approve it (`admin-opportunities.html`).
4. As one or more **investors**: register, request a deposit
   (`deposit.html`), have admin approve it (`admin-deposits.html`), then
   invest in the opportunity until it reaches 100% funding.
5. As **owner**: once fully funded, go to the opportunity → "Stock
   Purchased — Start Investment" → enter purchase details.
6. As **owner**: record sales (`owner-sales.html`) and/or expenses
   (`owner-stock.html`).
7. As **owner**: after the maturity date, submit the opportunity for
   settlement (`owner-settlement.html`).
8. As **admin**: run the settlement (`admin-settlements.html`) — this pays
   out (or zero-sale-refunds) every investor automatically based on
   recorded sales.
9. As **investor**: request a withdrawal (`withdraw.html`); as **admin**,
   approve it (`admin-withdrawals.html`).

## 7. Business Logic Summary (implemented exactly per spec)

- Investor deposits are **manually verified and approved by admin** before
  the wallet's available balance increases (spec §7).
- Investing moves funds from *available* → *locked* balance immediately, in
  one atomic Firestore transaction alongside the opportunity's funded amount
  (spec §11/§33).
- The investment timer starts **only** once an opportunity is 100% funded
  **and** the owner records the stock purchase ("Stock Purchased — Start
  Investment") — never at the moment of investing (spec §1/§14).
- Investor return = `investedAmount × investorReturnPercent / 100`, paid
  **only if at least one unit sold** by maturity; otherwise the investor
  receives principal minus a 1% fee (spec §2/§17/§21). The return rate is
  copied onto the investment record at investment time so later opportunity
  edits never retroactively change it (spec §12).
- Early exit is allowed only **before** the investment period starts, for a
  2% fee (spec §20); once active, funds are locked until maturity.
- If the owner misses the stock-purchase deadline, every investor is
  refunded in full with **no** fee (spec §15).
- Every sensitive action (approvals, freezes, settlements, stock/sales
  edits, role grants) writes an entry to `auditLogs` (spec §34).
- All monetary math is centralized in `js/calculations.js` and rounded to 2
  decimal places at every step (a documented, simpler alternative to
  integer-paisa storage, per the spec's explicit allowance in §31).

## 8. Known Limitations & Production Notes

This mirrors the specification's own stated limitations (§27/§37/§38) —
please read them before trusting this build with real money at scale:

- **No Cloud Functions / trusted backend.** Deposit verification, withdrawal
  payout, and maturity settlement are *admin-controlled workflows*, not
  automated. Firestore Security Rules (`firestore.rules`) are the real
  enforcement boundary and do as much delta/shape validation as rules
  reasonably allow (including `getAfter()` cross-document checks so an
  investment record can't be fabricated without a paired wallet-lock +
  opportunity-funding write in the same transaction) — but a full audit by a
  security professional is strongly recommended before accepting public
  funds.
- **No scheduled/automatic deadline enforcement.** Nothing flips an
  opportunity to "matured" or refunds a missed stock-purchase deadline on
  its own — an admin reviews and triggers `admin-refunds.html` /
  `admin-settlements.html` manually. The UI surfaces overdue items clearly
  to make this easy.
- **No payment gateway.** Deposits/withdrawals are manual, bank-transfer
  style, verified by a human admin, exactly as specified.
- **No KYC.** Out of scope for this MVP per the spec's Phase 3 roadmap.
- **Stock settlement mechanism** (cash vs. physical) is intentionally left
  as a participation *record* (`stockSharePercent` on each investment), not
  a guarantee of physical delivery — per spec §13.

## 9. Troubleshooting

**"Could not load your dashboard" (or any list page) right after logging in.**
Every dashboard/list page now shows the underlying error beneath the message
— reload the page and read the red detail box. The two causes that produce
this on a fresh setup:

- **Missing Firestore index.** Detail box says `failed-precondition` and
  includes a **"Tap here to create it in Firebase Console"** link — click
  it, wait ~1 minute for the index to finish building, then reload. This
  happens because several pages filter *and* sort (e.g. "my investments,
  newest first"), which Firestore requires a composite index for; see
  `firestore.indexes.json` and § 5 above. Deploying that file up front via
  `firebase deploy --only firestore:indexes` (or creating the indexes it
  lists manually in Firebase Console → Firestore Database → Indexes) avoids
  hitting this one-by-one.
- **Firestore rules not published.** Detail box says `permission-denied`.
  Firebase Console → Firestore Database → Rules → paste in `firestore.rules`
  → **Publish**. A brand-new Firestore database denies all reads/writes
  until rules are published.

**A page is blank / stuck loading forever.** Open the browser's dev tools
console (or the debug view in Chrome for Android: `chrome://inspect` from a
desktop Chrome connected via USB) — a network or module-loading error will
be logged there.

## 10. Local Development

No build tooling required. Serve the folder with any static file server and
open it in a browser, e.g.:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then visit `http://localhost:8080/index.html`. Firebase Auth requires
`localhost` to be in Firebase's Authorized domains list — it is by default.
