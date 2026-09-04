/**
 * Google AdSense integration — passive display ads only.
 *
 * Model: Hunny Invests earns from ad impressions/clicks shown to visitors.
 * Nothing is paid or credited to users for viewing an ad. That "watch an
 * ad, get a reward" model was deliberately not built: this app has no
 * backend (Firestore rules are the only access control), so any client-side
 * "ad finished, credit my wallet" event can be faked from the browser
 * console with no server to catch it. Passive ads carry no such risk —
 * the ad network itself is the one validating impressions/clicks.
 *
 * TO ACTIVATE:
 *   1. Sign up at https://www.google.com/adsense and get this site approved.
 *   2. Replace ADSENSE_CLIENT below with your real "ca-pub-XXXXXXXXXXXXXXXX" ID.
 *   3. Replace the placeholder values in AD_SLOTS with real ad unit IDs
 *      created in your AdSense dashboard (Ads > By ad unit > Display ads).
 *   4. Replace the placeholder pub- id in /ads.txt at the repo root too —
 *      AdSense requires that file to list this domain as an authorized seller.
 *
 * Until step 2 is done, every function here is a safe no-op: no ad script
 * is loaded, no ad slots render, no console errors — the site behaves
 * exactly as it does today.
 */

const ADSENSE_CLIENT = "ca-pub-0000000000000000"; // ← replace after AdSense approval

const AD_SLOTS = {
  footer: "0000000000",     // small ad in the shared public footer (every public page)
  homeInline: "0000000000", // inline banner on index.html
  oppInline: "0000000000"   // inline banner on opportunities.html
};

const isConfigured = () => ADSENSE_CLIENT !== "ca-pub-0000000000000000";

let scriptInjected = false;
function ensureAdSenseScript() {
  if (!isConfigured() || scriptInjected) return;
  scriptInjected = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
  s.crossOrigin = "anonymous";
  document.head.appendChild(s);
}

/**
 * Renders one AdSense unit into `container` (an element or element id).
 * If AdSense isn't configured yet (see TO ACTIVATE above), this leaves the
 * container empty instead of showing a broken/placeholder ad box.
 */
export function renderAdSlot(container, slotKey, { label = "Advertisement" } = {}) {
  const el = typeof container === "string" ? document.getElementById(container) : container;
  const slot = AD_SLOTS[slotKey];
  if (!el || !isConfigured() || !slot) return;
  ensureAdSenseScript();
  el.innerHTML = `
    <div class="ad-slot">
      <span class="ad-slot__label">${label}</span>
      <ins class="adsbygoogle"
        style="display:block"
        data-ad-client="${ADSENSE_CLIENT}"
        data-ad-slot="${slot}"
        data-ad-format="auto"
        data-full-width-responsive="true"></ins>
    </div>`;
  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch (e) {
    // Ad blocker or network hiccup — fail silently, never break the page.
  }
}
