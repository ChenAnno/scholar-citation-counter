// Shared by the background service worker (via importScripts) and the popup.

// Default Scholar domain. Users in mainland China may prefer "scholar.google.com.hk".
const DEFAULT_DOMAIN = "scholar.google.com";
const DEFAULT_LANG = "en";

const CONFIG_KEYS = ["scholarUserId", "scholarLang", "scholarDomain", "displayName", "homepageUrl"];

// Badge text colors. The badge background stays transparent (no pill).
const BADGE_COLORS = {
  normal: "#4A6B82", // thin morandi deep-blue number
  fresh: "#4F8A5B",  // there are new citations the user hasn't looked at yet
  warn: "#C28A3D",
  muted: "#A1A9AD"
};

// Scholar profile URL for the saved configuration; `params` adds extra query parameters.
function buildProfileUrl(cfg, params = {}) {
  const url = new URL(`https://${cfg.scholarDomain || DEFAULT_DOMAIN}/citations`);
  url.searchParams.set("user", cfg.scholarUserId);
  url.searchParams.set("hl", cfg.scholarLang || DEFAULT_LANG);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url.toString();
}

// A paper's "Cited by" list on Scholar, newest first (scisbd=2), or null if Scholar gave no link.
function buildCitedByUrl(cfg, paper) {
  if (!paper.citesId) return null;
  const domain = cfg.scholarDomain || DEFAULT_DOMAIN;
  const lang = encodeURIComponent(cfg.scholarLang || DEFAULT_LANG);
  return `https://${domain}/scholar?cites=${paper.citesId}&hl=${lang}&scisbd=2`;
}

// What the user has seen: per-paper citation counts taken from a snapshot when they open the New citations list.
function toSeen(snapshot, time = Date.now()) {
  const cites = {};
  for (const [id, paper] of Object.entries(snapshot.papers)) cites[id] = paper.cites;
  return { userId: snapshot.userId, time, total: snapshot.total, cites };
}

// Papers whose citation count grew since the user last opened the New citations list.
function diffSinceSeen(snapshot, seen) {
  const result = { items: [], totalDelta: 0 };
  if (!snapshot || !seen || seen.userId !== snapshot.userId) return result;

  for (const [id, paper] of Object.entries(snapshot.papers)) {
    const before = seen.cites[id];
    if (before === undefined) {
      // Added to the profile since then, so every citation it has is new to the user.
      if (paper.cites > 0) result.items.push({ id, ...paper, before: 0, delta: paper.cites, isNew: true });
    } else if (paper.cites > before) {
      result.items.push({ id, ...paper, before, delta: paper.cites - before, isNew: false });
    }
  }

  result.items.sort((a, b) => b.delta - a.delta || b.cites - a.cites);
  result.totalDelta = snapshot.total - seen.total;
  return result;
}

// Shortens large numbers to fit the toolbar badge, which has room for about four characters.
function compactNumber(n) {
  if (n < 10000) return String(n);
  if (n < 1e6) return `${Math.floor(n / 1000)}k`;
  return `${Math.floor(n / 1e5) / 10}M`;
}

// Badge: "?" before setup, "!" when Scholar wants a CAPTCHA, otherwise the total
// (green while there are new citations the user hasn't seen yet).
async function updateBadge() {
  const s = await chrome.storage.local.get(["scholarUserId", "snapshot", "seen", "lastError"]);
  let text = "";
  let color = BADGE_COLORS.normal;

  if (!s.scholarUserId) {
    text = "?";
    color = BADGE_COLORS.muted;
  } else if (s.lastError && s.lastError.code === "CAPTCHA") {
    text = "!";
    color = BADGE_COLORS.warn;
  } else if (s.snapshot && s.snapshot.userId === s.scholarUserId) {
    text = compactNumber(s.snapshot.total);
    if (diffSinceSeen(s.snapshot, s.seen).items.length > 0) color = BADGE_COLORS.fresh;
  }

  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: [0, 0, 0, 0] }); // transparent, no pill
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color });
}
