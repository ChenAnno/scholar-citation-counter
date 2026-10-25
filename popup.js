// shared.js (loaded first) provides the URL builders, toSeen, diffSinceSeen, lastLooked,
// settleSeen and updateBadge.

const COOLDOWN_MS = 60 * 60 * 1000;     // manual sync at most once an hour
const STALE_MS = 6 * 60 * 60 * 1000;    // sync on open when data is older than one background period
const STATE_KEYS = [...CONFIG_KEYS, "snapshot", "seen", "viewed", "history", "lastError"];

const ERROR_TEXT = { NETWORK: "Offline", HTTP: "Scholar error", PARSE: "Can't read Scholar" };

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const app = $("app");
const mainView = $("main");
const profileNameEl = $("profile-name");
const metricEl = $("metric");
const countEl = $("citation-count");
const deltaEl = $("citation-delta");
const newRowBtn = $("open-new");
const newTitleEl = $("new-title");
const newSubEl = $("new-sub");
const refreshBtn = $("refresh");
const statusEl = $("status");
const verifyLinkEl = $("verify-link");
const heroAlertEl = $("hero-alert");
const alertTextEl = $("alert-text");
const homeLinkEl = $("home-link");
const scholarLinkEl = $("scholar-link");
const scrim = $("scrim");

// New citations sheet.
const newSheet = $("new-sheet");
const newSheetSubEl = $("new-sheet-sub");
const paperListEl = $("paper-list");
const newActionsEl = $("new-actions");
const keepNoteEl = $("keep-note");
const markSeenBtn = $("mark-seen");

// Citation growth sheet.
const chartSheet = $("chart-sheet");
const chartBodyEl = $("chart-body");

// Settings sheet.
const settingsSheet = $("settings-sheet");
const settingsTitleEl = $("settings-title");
const settingsSubEl = $("settings-sub");
const settingsForm = $("settings-form");
const saveSettingsBtn = $("save-settings");
const scholarHintEl = $("scholar-hint");
const inputScholar = $("input-scholar");
const inputName = $("input-name");
const inputHome = $("input-home");

let state = {};          // STATE_KEYS as last read from storage
let syncing = false;
let flashMessage = "";
let flashTimer = null;
let openSheetEl = null;
let returnFocusTo = null;
let shownTotal = null;   // the total currently on screen, so a change can count up
let countFrame = 0;
let listedSnapshot = null; // the snapshot the open New citations list was built from

// ---- Formatting ----

const numberFormat = new Intl.NumberFormat("en-US");
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function plural(n, word) {
  return `${numberFormat.format(n)} ${word}${n === 1 ? "" : "s"}`;
}

function dayStart(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// "today 14:30", "yesterday", "Sep 28" or "Sep 28, 2025".
function formatWhen(ts) {
  const date = new Date(ts);
  const now = new Date();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (days === 0) return `today ${timeFormat.format(date)}`;
  if (days === 1) return "yesterday";
  return (date.getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(date);
}

// A time ahead: "today 18:00", "tomorrow 14:30" or "Sep 28".
function formatAhead(ts) {
  const date = new Date(ts);
  const days = Math.round((dayStart(date) - dayStart(new Date())) / 86400000);
  if (days <= 0) return `today ${timeFormat.format(date)}`;
  if (days === 1) return `tomorrow ${timeFormat.format(date)}`;
  return dayFormat.format(date);
}

function formatAgo(ts) {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return formatWhen(ts);
}

// Axis ticks: 0, 500, 1.5K, 300K, 1.2M.
function compactTick(v) {
  if (v < 1000) return String(v);
  if (v < 1e6) return `${+(v / 1000).toFixed(1)}K`;
  return `${+(v / 1e6).toFixed(1)}M`;
}

// Manual syncs wait an hour after a successful one. After a failure (say, a CAPTCHA the
// user just solved) a retry is allowed right away.
function isCoolingDown(snap) {
  return Boolean(snap) && !state.lastError && Date.now() - snap.time < COOLDOWN_MS;
}

function minutesUntilSync(snap) {
  return Math.max(1, Math.ceil((COOLDOWN_MS - (Date.now() - snap.time)) / 60000));
}

// ---- Config ----

// Parse a pasted Scholar profile URL (or bare user ID) into its parts.
function parseScholarInput(raw) {
  const value = (raw || "").trim();
  if (!value) return null;

  // Looks like a Scholar URL.
  if (value.includes("scholar.google")) {
    try {
      const url = new URL(value.startsWith("http") ? value : "https://" + value);
      const userId = url.searchParams.get("user");
      if (!userId) return null;
      return {
        userId,
        lang: url.searchParams.get("hl") || DEFAULT_LANG,
        domain: url.hostname || DEFAULT_DOMAIN
      };
    } catch (e) {
      return null;
    }
  }

  // Otherwise treat it as a bare user ID (optionally prefixed with "user=").
  const userId = value.replace(/^user=/, "");
  return /^[\w-]+$/.test(userId) ? { userId, lang: DEFAULT_LANG, domain: DEFAULT_DOMAIN } : null;
}

// "my-site.com" would otherwise resolve inside the extension.
function normalizeHomepage(raw) {
  const value = (raw || "").trim();
  if (!value) return "";
  return /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
}

// The snapshot, if it belongs to the configured profile.
function currentSnapshot() {
  const snap = state.snapshot;
  return snap && snap.userId === state.scholarUserId ? snap : null;
}

// The open (looked-at, not yet cleared) New citations list, if it belongs to this profile.
function currentViewed(snap) {
  const viewed = state.viewed;
  return snap && viewed && viewed.userId === snap.userId ? viewed : null;
}

async function loadState() {
  state = await chrome.storage.local.get(STATE_KEYS);
}

function isEmojiName(name) {
  const graphemes = [...new Intl.Segmenter().segment(name)].length;
  return graphemes <= 2 && /\p{Extended_Pictographic}/u.test(name);
}

// ---- DOM helpers ----

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function icon(templateId, className) {
  const svg = $(templateId).content.firstElementChild.cloneNode(true);
  if (className) svg.classList.add(className);
  return svg;
}

function setLink(link, href) {
  if (href) link.href = href;
  else link.removeAttribute("href");
}

// Restarts a one-shot CSS animation class.
function playOnce(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
  node.addEventListener("animationend", () => node.classList.remove(className), { once: true });
}

// ---- Main view ----

// Shows the total, counting up from the previous value when a sync changed it.
function showTotal(total) {
  cancelAnimationFrame(countFrame);
  const from = shownTotal;
  shownTotal = total;
  if (total == null) {
    countEl.textContent = "—";
    return;
  }
  if (from == null || from === total || reduceMotion.matches) {
    countEl.textContent = numberFormat.format(total);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 700);
    const eased = 1 - Math.pow(1 - t, 3);
    countEl.textContent = numberFormat.format(Math.round(from + (total - from) * eased));
    if (t < 1) countFrame = requestAnimationFrame(step);
  };
  countFrame = requestAnimationFrame(step);
}

function render() {
  const configured = Boolean(state.scholarUserId);
  const snap = currentSnapshot();
  const seen = state.seen;
  const viewed = currentViewed(snap);
  const { items, totalDelta } = diffSinceSeen(snap, seen);
  // Listed papers the user has not opened the list to see yet.
  const unread = viewed ? diffSinceSeen(snap, viewed).items.length : items.length;

  // Name: the user's choice, else the name on the Scholar profile. It is also the sync button;
  // a short emoji name (like 🚀) gets the flying animation.
  const name = state.displayName || (snap && snap.name) || (configured ? "My Scholar profile" : "Scholar Rocket");
  profileNameEl.textContent = name;
  profileNameEl.classList.toggle("is-emoji", isEmojiName(name));

  const total = snap ? numberFormat.format(snap.total) : "—";
  const delta = totalDelta > 0 ? `+${numberFormat.format(totalDelta)}` : "";
  showTotal(snap ? snap.total : null);
  countEl.classList.toggle("is-long", total.length >= 6);
  countEl.classList.toggle("is-empty", !snap);
  // Beside a big total, a big increase would run off the card, so it moves under the number.
  metricEl.classList.toggle("is-crowded", total.length + delta.length >= 11);

  deltaEl.hidden = !delta;
  deltaEl.textContent = delta;
  deltaEl.title = delta ? `${plural(totalDelta, "new citation")} since ${formatWhen(seen.time)}` : "";

  // New citations entry.
  let rowState;
  let title = "New citations";
  let sub;
  if (!configured) {
    rowState = "setup";
    title = "Set up";
    sub = "Add your Scholar link";
  } else if (!snap || !seen) {
    rowState = "waiting";
    sub = "After the first sync";
  } else if (items.length > 0 && unread > 0) {
    rowState = "fresh";
    sub = plural(items.length, "paper");
  } else if (items.length > 0) {
    // Already looked at; the list stays until it clears itself or the user clears it.
    rowState = "kept";
    sub = `${plural(items.length, "paper")} · seen`;
  } else {
    rowState = "quiet";
    sub = "Nothing new";
  }
  newRowBtn.dataset.state = rowState;
  newRowBtn.setAttribute("aria-disabled", String(rowState === "waiting"));
  newTitleEl.textContent = title;
  newSubEl.textContent = sub;

  // Homepage / Scholar buttons; each shows only when it has somewhere to go.
  const homepage = normalizeHomepage(state.homepageUrl);
  setLink(homeLinkEl, homepage);
  homeLinkEl.title = homepage;
  homeLinkEl.hidden = !homepage;
  setLink(scholarLinkEl, configured ? buildProfileUrl(state) : null);
  scholarLinkEl.hidden = !configured;
  renderStatus();
}

function renderStatus() {
  const snap = currentSnapshot();
  const error = state.lastError;
  const captcha = Boolean(error && error.code === "CAPTCHA");
  const cooling = isCoolingDown(snap);
  let text;

  if (flashMessage) text = flashMessage;
  else if (syncing) text = "Syncing…";
  else if (!state.scholarUserId) text = "Not set up yet";
  else if (captcha) text = "Scholar wants a CAPTCHA";
  else if (error) text = ERROR_TEXT[error.code] || "Sync failed";
  else if (snap) text = `Synced ${formatAgo(snap.time)}`;
  else text = "Not synced yet";

  // Tapping the name syncs, so its tooltip carries the status and what a tap will do.
  let action = "tap to sync";
  if (syncing) action = "";
  else if (!state.scholarUserId) action = "tap to set up";
  else if (cooling) action = `next sync in ${minutesUntilSync(snap)} min`;
  statusEl.textContent = text;
  refreshBtn.title = [text, action].filter(Boolean).join(" · ");
  refreshBtn.setAttribute("aria-label", `Sync. ${refreshBtn.title}`);
  refreshBtn.classList.toggle("is-warn", Boolean(error) && !syncing);
  refreshBtn.classList.toggle("is-syncing", syncing);

  // Errors get a small chip under the name; a link cannot sit inside the button.
  const showVerify = captcha && Boolean(error.url) && !syncing;
  const showText = Boolean(error) && !captcha && !syncing;
  verifyLinkEl.hidden = !showVerify;
  if (showVerify) verifyLinkEl.href = error.url;
  alertTextEl.hidden = !showText;
  if (showText) {
    alertTextEl.textContent = ERROR_TEXT[error.code] || "Sync failed";
    alertTextEl.title = [error.detail, "tap your name to retry"].filter(Boolean).join(" · ");
  }
  heroAlertEl.hidden = !showVerify && !showText;
}

// Shows a short message in the name's tooltip, then goes back to the normal status.
function flash(message) {
  flashMessage = message;
  renderStatus();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashMessage = "";
    renderStatus();
  }, 2500);
}

// ---- Sync (tap the name) ----

async function startSync() {
  if (syncing) return;
  syncing = true;
  renderStatus();
  try {
    await chrome.runtime.sendMessage({ type: "SYNC" });
  } catch (e) {
    // The background worker records failures in storage (lastError), which renderStatus shows.
  }
  syncing = false;
  await loadState();
  render();
  if (!state.lastError) playOnce(refreshBtn, "is-landing");
}

refreshBtn.addEventListener("click", () => {
  if (syncing) return;
  if (!state.scholarUserId) {
    openSettings();
    return;
  }
  const snap = currentSnapshot();
  if (isCoolingDown(snap)) {
    playOnce(refreshBtn, "is-nudged");
    flash(`Next sync in ${minutesUntilSync(snap)} min`);
    return;
  }
  startSync();
});

// ---- Sheets ----

function openSheet(sheet, focusTarget) {
  if (openSheetEl) closeSheet();
  returnFocusTo = document.activeElement;
  openSheetEl = sheet;
  sheet.classList.add("is-open");
  app.classList.add("has-sheet");
  mainView.inert = true;
  (focusTarget || sheet.querySelector("[data-close]")).focus({ preventScroll: true });
}

function closeSheet() {
  if (!openSheetEl) return;
  openSheetEl.classList.remove("is-open");
  openSheetEl = null;
  app.classList.remove("has-sheet");
  mainView.inert = false;
  if (returnFocusTo && returnFocusTo.isConnected) returnFocusTo.focus({ preventScroll: true });
  returnFocusTo = null;
}

for (const button of document.querySelectorAll("[data-close]")) {
  button.addEventListener("click", closeSheet);
}
scrim.addEventListener("click", closeSheet);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && openSheetEl) {
    event.preventDefault();
    closeSheet();
  }
});

// ---- New citations sheet ----

async function openNewCitations() {
  await settleSeen();
  await loadState();
  const snap = currentSnapshot();
  const seen = state.seen;
  if (!snap || !seen) return;

  const { items } = diffSinceSeen(snap, seen);
  const viewed = currentViewed(snap);
  // Papers that changed since the user last opened the list get a dot.
  const unread = viewed ? new Set(diffSinceSeen(snap, viewed).items.map((item) => item.id)) : null;
  const firstTime = viewed ? viewed.firstTime : Date.now();

  listedSnapshot = snap;
  renderPaperList(items, seen, unread, firstTime + KEEP_VIEWED_MS);
  openSheet(newSheet);

  if (items.length > 0) {
    // The list stays for a day from the first look; remember what has been looked at so far.
    await chrome.storage.local.set({ viewed: { ...toSeen(snap), firstTime } });
    await updateBadge();
  }
}

function renderPaperList(items, seen, unread, clearsAt) {
  const since = formatWhen(seen.time);
  newSheetSubEl.textContent = `Since ${since}`;
  paperListEl.replaceChildren();
  paperListEl.scrollTop = 0;
  newActionsEl.hidden = items.length === 0;

  if (items.length === 0) {
    const empty = el("div", "empty");
    empty.append(icon("tpl-check", "empty-icon"), el("p", "empty-title", "All caught up"));
    paperListEl.append(empty);
    return;
  }

  for (const item of items) paperListEl.append(paperRow(item, Boolean(unread && unread.has(item.id))));
  keepNoteEl.textContent = `Clears ${formatAhead(clearsAt)}`;
}

function paperRow(item, isUnread) {
  const href = buildCitedByUrl(state, item);
  const row = el(href ? "a" : "div", isUnread ? "paper is-unread" : "paper");
  if (href) {
    row.href = href;
    row.target = "_blank";
    row.rel = "noopener";
    row.title = "See who cited it, newest first";
  }

  const meta = [];
  if (item.year) meta.push(item.year);
  meta.push(item.isNew ? "new paper" : `${numberFormat.format(item.before)} → ${numberFormat.format(item.cites)}`);

  const body = el("span", "paper-body");
  body.append(el("span", "paper-title", item.title), el("span", "paper-meta", meta.join(" · ")));
  row.append(el("span", "paper-delta", `+${numberFormat.format(item.delta)}`), body);
  if (href) row.append(icon("tpl-arrow", "paper-go"));
  return row;
}

// Clears the list now instead of waiting a day: everything shown becomes the new baseline.
markSeenBtn.addEventListener("click", async () => {
  if (!listedSnapshot) return;
  const seen = toSeen(listedSnapshot);
  await chrome.storage.local.set({ seen });
  await chrome.storage.local.remove("viewed");
  renderPaperList([], seen, null, 0);
  await updateBadge();
});

newRowBtn.addEventListener("click", () => {
  const rowState = newRowBtn.dataset.state;
  if (rowState === "setup") openSettings();
  else if (rowState !== "waiting") openNewCitations();
});

// ---- Citation growth sheet ----

const DAY_MS = 24 * 60 * 60 * 1000;
const RANGES = [["30D", 30], ["1Y", 365], ["All", Infinity]];
const RANGE_KEY = "growthRange";   // the viewer's last choice, a per-browser convenience
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });

// Total citations at the end of each year. Scholar gives citations per year; counting back
// from today's total keeps the last point equal to the number on the card, even when the
// histogram does not reach back to the very first citation.
function growthPoints(byYear, total) {
  const points = [];
  let later = 0;
  for (let i = byYear.length - 1; i >= 0; i--) {
    points.unshift({ year: byYear[i].year, gain: byYear[i].cites, total: Math.max(0, total - later) });
    later += byYear[i].cites;
  }
  return points;
}

function dayToTime(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

// The curve: one point per day the extension recorded (today's is always the latest
// total), preceded by Scholar's year-end totals for the years before recording began.
function growthSeries(snap, history) {
  const days = history && history.userId === snap.userId ? history.days.slice() : [];
  const today = localDay(snap.time);
  if (days.length > 0 && days[days.length - 1].d === today) days[days.length - 1] = { d: today, t: snap.total };
  else days.push({ d: today, t: snap.total });

  const firstDay = dayToTime(days[0].d);
  const points = [];
  for (const p of snap.byYear ? growthPoints(snap.byYear, snap.total) : []) {
    const t = new Date(p.year, 11, 31).getTime();
    if (t < firstDay) points.push({ t, total: p.total, yearEnd: p.year });
  }
  for (const d of days) points.push({ t: dayToTime(d.d), total: d.t });
  points.forEach((p, i) => { p.gain = i > 0 ? p.total - points[i - 1].total : null; });
  return { points, firstDay, dailySpan: Math.round((dayToTime(days[days.length - 1].d) - firstDay) / DAY_MS) };
}

// Round axis bounds and step (1, 2, 2.5 or 5 × 10^k, about three steps, whole numbers).
function niceRange(lo, hi, fromZero) {
  if (fromZero) lo = 0;
  const span = hi - lo > 0 ? hi - lo : Math.max(3, hi * 0.02);
  const raw = span / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => st >= raw));
  const bottom = fromZero ? 0 : Math.floor(lo / step) * step;
  const top = Math.max(bottom + step, Math.ceil(hi / step) * step);
  return { bottom, top, step };
}

// Calendar-aligned ticks: years for long spans, months for medium, days for short.
function timeTicks(from, to) {
  const ticks = [];
  const end = new Date(to);
  if (to - from > 2 * 365 * DAY_MS) {
    const first = new Date(from).getFullYear() + 1;
    const step = Math.max(1, Math.ceil((end.getFullYear() - first + 1) / 4));
    for (let yr = end.getFullYear(); yr >= first; yr -= step) ticks.push({ t: new Date(yr, 0, 1).getTime(), label: String(yr) });
  } else if (to - from > 60 * DAY_MS) {
    const months = [];
    const a = new Date(from);
    for (let m = new Date(a.getFullYear(), a.getMonth() + 1, 1); m.getTime() <= to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) months.push(m);
    const step = Math.max(1, Math.ceil(months.length / 4));
    for (let i = months.length - 1; i >= 0; i -= step) {
      ticks.push({ t: months[i].getTime(), label: `${monthFormat.format(months[i])} ’${String(months[i].getFullYear()).slice(2)}` });
    }
  } else {
    const days = Math.max(1, Math.round((to - from) / DAY_MS));
    const step = Math.max(1, Math.ceil(days / 4));
    for (let k = 0; ; k += step) {
      const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - k);
      if (d.getTime() < from) break;
      ticks.push({ t: d.getTime(), label: dayFormat.format(d) });
    }
  }
  return ticks.reverse();
}

// A smooth curve through the points that never overshoots them (monotone cubic,
// Fritsch–Carlson), so a rising total is drawn rising everywhere.
function monotonePath(pts) {
  const n = pts.length;
  const f = (v) => v.toFixed(1);
  if (n === 2) return `M${f(pts[0].x)},${f(pts[0].y)} L${f(pts[1].x)},${f(pts[1].y)}`;
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const t = [slope[0]];
  for (let i = 1; i < n - 1; i++) t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  t[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const len = a * a + b * b;
    if (len > 9) { const k = 3 / Math.sqrt(len); t[i] = k * a * slope[i]; t[i + 1] = k * b * slope[i]; }
  }
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i].x + h)},${f(pts[i].y + t[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - t[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

function chartMessage(title) {
  const empty = el("div", "empty");
  empty.append(el("p", "empty-title", title));
  chartBodyEl.replaceChildren(empty);
}

function pointLabel(p) {
  if (p.yearEnd) return `End of ${p.yearEnd}`;
  if (localDay(p.t) === localDay(Date.now())) return "Today";
  const d = new Date(p.t);
  return (d.getFullYear() === new Date().getFullYear() ? dayFormat : dayYearFormat).format(d);
}

function savedRange() {
  try { return localStorage.getItem(RANGE_KEY); } catch (e) { return null; }
}

function renderChart(snap, rangeLabel) {
  if (!snap) {
    chartMessage("No data yet");
    return;
  }
  const { points, dailySpan } = growthSeries(snap, state.history);
  if (snap.total === 0 && points.length === 1) {
    chartMessage("No citations yet");
    return;
  }

  // Ranges only help once there is a week of daily data; before that, show everything.
  const rangesOn = dailySpan >= 7;
  let range = rangeLabel || savedRange() || "30D";
  if (!rangesOn || !RANGES.some(([label]) => label === range)) range = rangesOn ? "30D" : "All";
  const days = RANGES.find(([label]) => label === range)[1];
  const last = points[points.length - 1];
  const from = Number.isFinite(days) ? last.t - days * DAY_MS : points[0].t;
  const firstIn = points.findIndex((p) => p.t >= from);
  // The point just before the window lets the curve enter from the left edge.
  const shown = points.slice(Math.max(0, firstIn - 1));
  const inWindow = shown.filter((p) => p.t >= from);

  // ---- Geometry ----
  const W = 272;
  const H = rangesOn ? 192 : 222;   // fills the sheet; the range row takes the difference
  const M = { top: 22, right: 14, bottom: 20, left: 36 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  // All starts the axis at zero; a shorter range zooms to its own values so daily growth shows.
  const fromZero = range === "All";
  const values = inWindow.map((p) => p.total);
  const { bottom, top, step } = niceRange(Math.min(...values), Math.max(...values), fromZero);
  const x = (t) => (last.t === from ? M.left + plotW / 2 : M.left + ((t - from) / (last.t - from)) * plotW);
  const y = (v) => M.top + plotH - ((v - bottom) / (top - bottom)) * plotH;

  const svg = svgEl("svg", {
    class: "chart-svg",
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `Total citations, ${range === "All" ? "all time" : `last ${range}`}: ${numberFormat.format(inWindow[0].total)} to ${numberFormat.format(last.total)}`
  });
  const defs = svgEl("defs");
  const fill = svgEl("linearGradient", { id: "growth-fill", x1: 0, y1: 0, x2: 0, y2: 1 });
  fill.append(svgEl("stop", { class: "fill-top", offset: "0%" }), svgEl("stop", { class: "fill-bottom", offset: "100%" }));
  const clip = svgEl("clipPath", { id: "growth-clip" });
  clip.append(svgEl("rect", { x: M.left, y: M.top - 6, width: plotW + 6, height: plotH + 6 }));
  defs.append(fill, clip);
  svg.append(defs);

  // Recessive hairline grid with compact y ticks.
  for (let v = bottom; v <= top + step / 2; v += step) {
    svg.append(svgEl("line", { class: "chart-grid", x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) }));
    const label = svgEl("text", { x: M.left - 6, y: y(v), dy: "0.32em", "text-anchor": "end" });
    label.textContent = compactTick(v);
    svg.append(label);
  }
  for (const tick of timeTicks(from, last.t)) {
    const tx = x(tick.t);
    if (tx < M.left + 10 || tx > W - 4) continue;
    const label = svgEl("text", { x: tx, y: H - 4, "text-anchor": "middle" });
    label.textContent = tick.label;
    svg.append(label);
  }

  // Soft fading fill + 2px curve, clipped to the plot so an entering segment starts at its edge.
  const plotted = svgEl("g", { "clip-path": "url(#growth-clip)" });
  if (shown.length > 1) {
    const linePath = monotonePath(shown.map((p) => ({ x: x(p.t), y: y(p.total) })));
    const baseY = (M.top + plotH).toFixed(1);
    plotted.append(
      svgEl("path", { class: "chart-area", d: `${linePath} L${x(last.t).toFixed(1)},${baseY} L${x(shown[0].t).toFixed(1)},${baseY} Z` }),
      svgEl("path", { class: "chart-line", d: linePath })
    );
  }
  svg.append(plotted);
  // A dot per point while they are few; otherwise only the latest. The total is the one label.
  for (const p of inWindow.length <= 12 ? inWindow : [last]) {
    svg.append(svgEl("circle", { class: "chart-dot", cx: x(p.t), cy: y(p.total), r: 4 }));
  }
  const endLabel = svgEl("text", { class: "end-label", x: x(last.t) - 8, y: y(last.total) - 9, "text-anchor": "end" });
  endLabel.textContent = numberFormat.format(last.total);
  svg.append(endLabel);

  // ---- Hover / keyboard layer: crosshair snaps to the nearest point ----
  const cross = svgEl("line", { class: "chart-cross", y1: M.top, y2: M.top + plotH, visibility: "hidden" });
  const focusDot = svgEl("circle", { class: "chart-dot", r: 4, visibility: "hidden" });
  const hit = svgEl("rect", { x: M.left - 8, y: 0, width: plotW + 16, height: H, fill: "transparent" });
  svg.append(cross, focusDot, hit);

  const wrap = el("div", "chart-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("aria-label", "Citation growth chart. Use the left and right arrow keys to read each point.");
  const tip = el("div", "chart-tip");
  tip.hidden = true;
  const tipDate = el("div", "chart-tip-year");
  const tipValue = el("div", "chart-tip-value");
  const tipGain = el("div", "chart-tip-gain");
  tip.append(tipDate, tipValue, tipGain);
  wrap.append(svg, tip);

  let active = -1;
  const show = (i) => {
    active = Math.max(0, Math.min(inWindow.length - 1, i));
    const p = inWindow[active];
    const px = x(p.t);
    cross.setAttribute("x1", px);
    cross.setAttribute("x2", px);
    focusDot.setAttribute("cx", px);
    focusDot.setAttribute("cy", y(p.total));
    cross.setAttribute("visibility", "visible");
    focusDot.setAttribute("visibility", "visible");
    endLabel.setAttribute("visibility", "hidden");
    tipDate.textContent = pointLabel(p);
    tipValue.textContent = numberFormat.format(p.total);
    tipGain.textContent = p.gain == null ? "" : `+${numberFormat.format(Math.max(0, p.gain))}`;
    tipGain.hidden = p.gain == null;
    tip.hidden = false;
    // Keep the tooltip beside the crosshair, on whichever side has room.
    const tipW = tip.offsetWidth;
    tip.style.left = `${px + 10 + tipW <= W ? px + 10 : Math.max(0, px - 10 - tipW)}px`;
  };
  const hide = () => {
    active = -1;
    cross.setAttribute("visibility", "hidden");
    focusDot.setAttribute("visibility", "hidden");
    endLabel.removeAttribute("visibility");
    tip.hidden = true;
  };
  hit.addEventListener("pointermove", (event) => {
    const mx = event.clientX - svg.getBoundingClientRect().left;
    let nearest = 0;
    inWindow.forEach((p, i) => { if (Math.abs(x(p.t) - mx) < Math.abs(x(inWindow[nearest].t) - mx)) nearest = i; });
    show(nearest);
  });
  hit.addEventListener("pointerleave", hide);
  wrap.addEventListener("focus", () => show(inWindow.length - 1));
  wrap.addEventListener("blur", hide);
  wrap.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      show((active < 0 ? inWindow.length - 1 : active) + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });

  // ---- Range control (one row above the chart) ----
  const parts = [];
  if (rangesOn) {
    const seg = el("div", "range-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Range");
    for (const [label] of RANGES) {
      const btn = el("button", label === range ? "range-btn is-on" : "range-btn", label);
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(label === range));
      btn.addEventListener("click", () => {
        try { localStorage.setItem(RANGE_KEY, label); } catch (e) { /* per-viewer convenience only */ }
        renderChart(currentSnapshot(), label);
      });
      seg.append(btn);
    }
    parts.push(seg);
  }
  parts.push(wrap);

  // ---- Table view for screen readers: every point in the range, newest first ----
  const table = el("table", "year-table sr-only");
  const head = el("tr");
  head.append(el("th", null, "Date"), el("th", null, "New"), el("th", null, "Total"));
  table.append(head);
  for (const p of [...inWindow].reverse()) {
    const row = el("tr");
    row.append(
      el("td", null, pointLabel(p)),
      el("td", null, p.gain == null ? "—" : `+${numberFormat.format(Math.max(0, p.gain))}`),
      el("td", "muted", numberFormat.format(p.total))
    );
    table.append(row);
  }
  parts.push(table);

  chartBodyEl.replaceChildren(...parts);
}

async function openChart() {
  await loadState();
  renderChart(currentSnapshot());
  chartBodyEl.scrollTop = 0;
  openSheet(chartSheet);
}

$("open-chart").addEventListener("click", openChart);

// ---- Settings sheet ----

// Problems with the Scholar field replace its hint, right next to the input.
function setScholarError(message) {
  scholarHintEl.textContent = `· ${message || "URL or ID"}`;
  scholarHintEl.classList.toggle("is-error", Boolean(message));
  if (message) inputScholar.setAttribute("aria-invalid", "true");
  else inputScholar.removeAttribute("aria-invalid");
}

async function openSettings() {
  await loadState();
  const configured = Boolean(state.scholarUserId);
  const snap = currentSnapshot();

  settingsTitleEl.textContent = configured ? "Settings" : "Set up";
  settingsSubEl.textContent = configured ? "" : "Paste your Scholar profile link.";
  settingsSubEl.hidden = configured;
  inputScholar.value = configured ? buildProfileUrl(state) : "";
  setScholarError("");
  inputName.value = state.displayName || "";
  inputName.placeholder = (snap && snap.name) || "Your name";
  inputHome.value = state.homepageUrl || "";
  saveSettingsBtn.textContent = "Save";
  saveSettingsBtn.classList.remove("is-done");

  openSheet(settingsSheet, configured ? null : inputScholar);
}

$("open-settings").addEventListener("click", openSettings);
inputScholar.addEventListener("input", () => setScholarError(""));

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const parsed = parseScholarInput(inputScholar.value);
  if (!parsed) {
    setScholarError("not valid");
    inputScholar.focus();
    return;
  }

  // A different profile starts from scratch: the old snapshot and seen counts belong to someone else.
  const profileChanged = parsed.userId !== state.scholarUserId;
  if (profileChanged) await chrome.storage.local.remove(["snapshot", "seen", "viewed", "history", "lastError"]);

  await chrome.storage.local.set({
    scholarUserId: parsed.userId,
    scholarLang: parsed.lang,
    scholarDomain: parsed.domain,
    displayName: inputName.value.trim(),
    homepageUrl: normalizeHomepage(inputHome.value)
  });
  await loadState();
  render();
  await updateBadge();
  saveSettingsBtn.textContent = "Saved";
  saveSettingsBtn.classList.add("is-done");

  setTimeout(() => {
    closeSheet();
    if (profileChanged || !currentSnapshot()) startSync();
  }, 600);
});

// ---- Init ----

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  loadState().then(() => {
    render();
    if (openSheetEl === chartSheet && changes.snapshot) renderChart(currentSnapshot());
  });
});

// Keeps "Synced 5 min ago" current while the popup stays open.
setInterval(renderStatus, 30 * 1000);

(async function init() {
  await settleSeen();
  await loadState();
  render();

  if (!state.scholarUserId) {
    // First run: guide the user through setup.
    openSettings();
    return;
  }

  const snap = currentSnapshot();
  const failedRecently = state.lastError && Date.now() - state.lastError.time < COOLDOWN_MS;
  if ((!snap || Date.now() - snap.time > STALE_MS) && !failedRecently) startSync();
})();
