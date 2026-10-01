// shared.js (loaded first) provides the URL builders, toSeen, diffSinceSeen and updateBadge.

const COOLDOWN_MS = 60 * 60 * 1000;     // manual sync at most once an hour
const STALE_MS = 6 * 60 * 60 * 1000;    // sync on open when data is older than one background period
const STATE_KEYS = [...CONFIG_KEYS, "snapshot", "seen", "lastError"];

const ERROR_TEXT = {
  NETWORK: "Couldn't reach Scholar",
  HTTP: "Scholar returned an error",
  PARSE: "Couldn't read the Scholar page"
};

const $ = (id) => document.getElementById(id);

const app = $("app");
const mainView = $("main");
const profileNameEl = $("profile-name");
const metricEl = $("metric");
const countEl = $("citation-count");
const deltaEl = $("citation-delta");
const hIndexEl = $("h-index");
const i10IndexEl = $("i10-index");
const newRowBtn = $("open-new");
const newTitleEl = $("new-title");
const newSubEl = $("new-sub");
const refreshBtn = $("refresh");
const statusEl = $("status");
const scholarLinkEl = $("scholar-link");
const scrim = $("scrim");

// New citations sheet.
const newSheet = $("new-sheet");
const newSheetSubEl = $("new-sheet-sub");
const paperListEl = $("paper-list");

// Settings sheet.
const settingsSheet = $("settings-sheet");
const settingsTitleEl = $("settings-title");
const settingsSubEl = $("settings-sub");
const settingsForm = $("settings-form");
const settingsStatusEl = $("settings-status");
const inputScholar = $("input-scholar");
const inputName = $("input-name");
const inputHome = $("input-home");

let state = {};          // STATE_KEYS as last read from storage
let syncing = false;
let flashMessage = "";
let flashTimer = null;
let openSheetEl = null;
let returnFocusTo = null;

// ---- Formatting ----

const numberFormat = new Intl.NumberFormat("en-US");
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function plural(n, word) {
  return `${numberFormat.format(n)} ${word}${n === 1 ? "" : "s"}`;
}

// "today 14:30", "yesterday 09:05", "Sep 28" or "Sep 28, 2025".
function formatWhen(ts) {
  const date = new Date(ts);
  const now = new Date();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(date)) / 86400000);
  if (days === 0) return `today ${timeFormat.format(date)}`;
  if (days === 1) return `yesterday ${timeFormat.format(date)}`;
  return (date.getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(date);
}

function formatAgo(ts) {
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return formatWhen(ts);
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

async function loadState() {
  state = await chrome.storage.local.get(STATE_KEYS);
}

// ---- DOM helpers ----

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
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

// ---- Main view ----

function render() {
  const configured = Boolean(state.scholarUserId);
  const snap = currentSnapshot();
  const seen = state.seen;
  const { items, totalDelta } = diffSinceSeen(snap, seen);

  // Name: the user's choice, else the name on the Scholar profile.
  profileNameEl.textContent =
    state.displayName || (snap && snap.name) || (configured ? "My Scholar profile" : "Scholar Rocket");
  setLink(profileNameEl, normalizeHomepage(state.homepageUrl));

  const total = snap ? numberFormat.format(snap.total) : "—";
  const delta = totalDelta > 0 ? `+${numberFormat.format(totalDelta)}` : "";
  countEl.textContent = total;
  countEl.classList.toggle("is-long", total.length >= 6);
  countEl.classList.toggle("is-empty", !snap);
  // Beside a big total, a big increase would run off the card, so it moves under the number.
  metricEl.classList.toggle("is-crowded", total.length + delta.length >= 11);

  deltaEl.hidden = !delta;
  deltaEl.textContent = delta;
  deltaEl.title = delta ? `${plural(totalDelta, "new citation")} since ${formatWhen(seen.time)}` : "";

  hIndexEl.textContent = snap && snap.hIndex != null ? numberFormat.format(snap.hIndex) : "—";
  i10IndexEl.textContent = snap && snap.i10Index != null ? numberFormat.format(snap.i10Index) : "—";

  // New citations entry.
  let rowState;
  let title = "New citations";
  let sub;
  if (!configured) {
    rowState = "setup";
    title = "Set up your profile";
    sub = "Paste your Google Scholar link to begin";
  } else if (!snap || !seen) {
    rowState = "waiting";
    sub = "Available after the first sync";
  } else if (items.length > 0) {
    rowState = "fresh";
    sub = `${plural(items.length, "paper")} · since ${formatWhen(seen.time)}`;
  } else {
    rowState = "quiet";
    sub = `Nothing new since ${formatWhen(seen.time)}`;
  }
  newRowBtn.dataset.state = rowState;
  newRowBtn.setAttribute("aria-disabled", String(rowState === "waiting"));
  newTitleEl.textContent = title;
  newSubEl.textContent = sub;

  setLink(scholarLinkEl, configured ? buildProfileUrl(state) : null);
  renderStatus();
}

function renderStatus() {
  const snap = currentSnapshot();
  const error = state.lastError;
  let text;
  let title = "";
  let link = null;
  let warn = false;

  if (flashMessage) {
    text = flashMessage;
  } else if (syncing) {
    text = "Syncing…";
  } else if (!state.scholarUserId) {
    text = "Not set up yet";
  } else if (error && error.code === "CAPTCHA") {
    text = "Verification needed";
    title = "Google Scholar asked for a CAPTCHA. Solve it, then sync again.";
    link = error.url || null;
    warn = true;
  } else if (error) {
    text = ERROR_TEXT[error.code] || "Sync failed";
    title = [error.detail, snap && `Showing data from ${formatWhen(snap.time)}`].filter(Boolean).join(" · ");
    warn = true;
  } else if (snap) {
    text = `Synced ${formatAgo(snap.time)}`;
    title = "Syncs automatically every 6 hours";
  } else {
    text = "Not synced yet";
  }

  statusEl.replaceChildren();
  if (link) {
    const a = el("a", null, text);
    a.href = link;
    a.target = "_blank";
    a.rel = "noopener";
    a.append(icon("tpl-arrow"));
    statusEl.append(a);
  } else {
    statusEl.textContent = text;
  }
  statusEl.title = title;
  statusEl.classList.toggle("is-warn", warn);

  const cooling = isCoolingDown(snap);
  refreshBtn.classList.toggle("is-spinning", syncing);
  refreshBtn.classList.toggle("is-cooling", cooling && !syncing);
  refreshBtn.title = syncing ? "Syncing…" : cooling ? `Next sync available in ${minutesUntilSync(snap)} min` : "Sync now";
}

// Shows a short message in the status line, then goes back to the normal status.
function flash(message) {
  flashMessage = message;
  renderStatus();
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flashMessage = "";
    renderStatus();
  }, 2500);
}

// ---- Sync ----

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
}

refreshBtn.addEventListener("click", () => {
  if (syncing) return;
  if (!state.scholarUserId) {
    openSettings();
    return;
  }
  const snap = currentSnapshot();
  if (isCoolingDown(snap)) {
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
  await loadState();
  const snap = currentSnapshot();
  const seen = state.seen;
  if (!snap || !seen) return;

  renderPaperList(diffSinceSeen(snap, seen).items, seen);
  openSheet(newSheet);

  // Everything listed now counts as seen, so the next visit only shows citations that arrive later.
  await chrome.storage.local.set({ seen: toSeen(snap) });
  await updateBadge();
}

function renderPaperList(items, seen) {
  const since = formatWhen(seen.time);
  newSheetSubEl.textContent = items.length > 0 ? `${plural(items.length, "paper")} · since ${since}` : `Since ${since}`;
  paperListEl.replaceChildren();
  paperListEl.scrollTop = 0;

  if (items.length === 0) {
    const empty = el("div", "empty");
    empty.append(
      icon("tpl-check", "empty-icon"),
      el("p", "empty-title", "You're all caught up"),
      el("p", "empty-sub", `No new citations since ${since}. Scholar Rocket checks again every 6 hours.`)
    );
    paperListEl.append(empty);
    return;
  }

  for (const item of items) paperListEl.append(paperRow(item));
  paperListEl.append(el("p", "list-note", "Marked as seen. Next time, only newer citations will show here."));
}

function paperRow(item) {
  const href = buildCitedByUrl(state, item);
  const row = el(href ? "a" : "div", "paper");
  if (href) {
    row.href = href;
    row.target = "_blank";
    row.rel = "noopener";
    row.title = "See who cited it, newest first";
  }

  const meta = [];
  if (item.year) meta.push(item.year);
  meta.push(item.isNew
    ? `New on your profile · ${plural(item.cites, "citation")}`
    : `${numberFormat.format(item.before)} → ${plural(item.cites, "citation")}`);

  const body = el("span", "paper-body");
  body.append(el("span", "paper-title", item.title), el("span", "paper-meta", meta.join(" · ")));
  row.append(el("span", "paper-delta", `+${numberFormat.format(item.delta)}`), body);
  if (href) row.append(icon("tpl-arrow", "paper-go"));
  return row;
}

newRowBtn.addEventListener("click", () => {
  const rowState = newRowBtn.dataset.state;
  if (rowState === "setup") openSettings();
  else if (rowState !== "waiting") openNewCitations();
});

// ---- Settings sheet ----

function setFormStatus(text, isError = false) {
  settingsStatusEl.textContent = text;
  settingsStatusEl.classList.toggle("is-error", isError);
}

async function openSettings() {
  await loadState();
  const configured = Boolean(state.scholarUserId);
  const snap = currentSnapshot();

  settingsTitleEl.textContent = configured ? "Settings" : "Set up Scholar Rocket";
  settingsSubEl.textContent = configured
    ? "Stored only in this browser."
    : "Paste your Scholar profile link to start.";
  inputScholar.value = configured ? buildProfileUrl(state) : "";
  inputScholar.removeAttribute("aria-invalid");
  inputName.value = state.displayName || "";
  inputName.placeholder = (snap && snap.name) || "Your name";
  inputHome.value = state.homepageUrl || "";
  setFormStatus("");

  openSheet(settingsSheet, configured ? null : inputScholar);
}

$("open-settings").addEventListener("click", openSettings);

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const parsed = parseScholarInput(inputScholar.value);
  if (!parsed) {
    inputScholar.setAttribute("aria-invalid", "true");
    setFormStatus("Enter a valid Scholar URL or user ID", true);
    inputScholar.focus();
    return;
  }
  inputScholar.removeAttribute("aria-invalid");

  // A different profile starts from scratch: the old snapshot and seen counts belong to someone else.
  const profileChanged = parsed.userId !== state.scholarUserId;
  if (profileChanged) await chrome.storage.local.remove(["snapshot", "seen", "lastError"]);

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
  setFormStatus("Saved");

  setTimeout(() => {
    closeSheet();
    if (profileChanged || !currentSnapshot()) startSync();
  }, 600);
});

// ---- Init ----

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") loadState().then(render);
});

// Keeps "Synced 5 min ago" current while the popup stays open.
setInterval(renderStatus, 30 * 1000);

(async function init() {
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
