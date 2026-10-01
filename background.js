importScripts("shared.js");

const ALARM_NAME = "checkUpdate";
const SYNC_PERIOD_MIN = 360;   // background sync every 6 hours
const PAGE_SIZE = 100;         // the largest page Scholar serves
const MAX_PAGES = 10;          // tracks up to 1,000 papers
const PAGE_DELAY_MS = 1000;    // pause between pages to stay polite to Scholar

// Storage keys from v1.7 and earlier (title-keyed top-15 snapshot), dropped on update.
const LEGACY_KEYS = ["citationCount", "lastRefreshTime", "savedPapersMap", "newPapers"];

// ---- Parsing ----
// Service workers have no DOMParser, so the Scholar page is read with regexes.

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function cleanText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function toInt(text) {
  const digits = (text || "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

// Profile name plus the "All" column of the stats table: citations, h-index, i10-index.
function parseProfile(html) {
  const cells = [...html.matchAll(/class="gsc_rsb_std"[^>]*>([^<]*)</g)].map((m) => toInt(m[1]));
  if (cells.length === 0) return null;

  const name = html.match(/id="gsc_prf_in"[^>]*>([\s\S]*?)<\/div>/);
  return {
    name: name ? cleanText(name[1]) : "",
    total: cells[0],
    hIndex: cells.length > 2 ? cells[2] : null,
    i10Index: cells.length > 4 ? cells[4] : null
  };
}

// One entry per row of the papers table. Rows are split first so a regex can never
// match across two papers and misalign titles and counts.
function parsePapers(html) {
  const papers = [];
  for (const segment of html.split(/<tr[^>]*class="gsc_a_tr"[^>]*>/).slice(1)) {
    const row = segment.split("</tr>")[0];
    const titleMatch = row.match(/class="gsc_a_at"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;

    const title = cleanText(titleMatch[1]);
    const idMatch = row.match(/citation_for_view=([^"&]+)/);
    const citesMatch = row.match(/class="gsc_a_ac\b[^"]*"[^>]*>([^<]*)</);
    const citesIdMatch = row.match(/[?&;]cites=([\d,]+)/);
    const yearMatch = row.match(/class="gsc_a_h\b[^"]*"[^>]*>(\d{4})</);

    papers.push({
      // Scholar's per-paper ID is stable across title edits; the title is only a fallback.
      id: idMatch ? idMatch[1] : `title:${title.toLowerCase()}`,
      title,
      cites: citesMatch ? toInt(citesMatch[1]) : 0,
      citesId: citesIdMatch ? citesIdMatch[1] : "",
      year: yearMatch ? yearMatch[1] : ""
    });
  }
  return papers;
}

// ---- Sync ----

let inflight = null;

// At most one sync runs at a time; concurrent callers share its result.
function sync() {
  if (!inflight) inflight = runSync().finally(() => { inflight = null; });
  return inflight;
}

async function runSync() {
  const cfg = await chrome.storage.local.get(CONFIG_KEYS);
  if (!cfg.scholarUserId) {
    // Not configured yet: prompt the user to open the popup and set their profile.
    await updateBadge();
    return { success: false, error: "NO_CONFIG" };
  }

  try {
    let profile = null;
    const papers = {};

    // Read every page of the profile, so a paper's earlier count is always known and a
    // paper moving up the citation ranking is never mistaken for new citations.
    for (let page = 0; page < MAX_PAGES; page++) {
      if (page > 0) await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));

      const url = buildProfileUrl(cfg, { cstart: page * PAGE_SIZE, pagesize: PAGE_SIZE });
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' }
      });

      if (response.url.includes("google.com/sorry") || response.status === 429) {
        return fail("CAPTCHA", response.url);
      }
      if (!response.ok) return fail("HTTP", url, `HTTP ${response.status}`);

      const html = await response.text();
      if (page === 0) {
        profile = parseProfile(html);
        if (!profile) return fail("PARSE", url);
      }

      const rows = parsePapers(html);
      let added = 0;
      for (const { id, ...paper } of rows) {
        if (!(id in papers)) added++;
        papers[id] = paper;
      }
      // A short page is the last one. A page with nothing new means Scholar ignored cstart.
      if (rows.length < PAGE_SIZE || added === 0) break;
    }

    const snapshot = { userId: cfg.scholarUserId, time: Date.now(), ...profile, papers };
    const update = { snapshot };

    // First sync for this profile: start the New citations list from here, so it does not
    // report the whole existing record as new.
    const { seen } = await chrome.storage.local.get("seen");
    if (!seen || seen.userId !== snapshot.userId) update.seen = toSeen(snapshot, snapshot.time);

    await chrome.storage.local.set(update);
    await chrome.storage.local.remove("lastError");
    await updateBadge();
    return { success: true, count: snapshot.total };
  } catch (e) {
    return fail("NETWORK", null, e.message);
  }
}

// Records why the latest sync failed so the popup can explain it. The previous snapshot is kept.
async function fail(code, url, detail = null) {
  await chrome.storage.local.set({ lastError: { code, url, detail, time: Date.now() } });
  await updateBadge();
  return { success: false, error: code, url };
}

// ---- Lifecycle ----

async function ensureAlarm() {
  // Creating an alarm that already exists restarts its countdown. This worker starts many
  // times a day, so only create the alarm when it is missing.
  if (!(await chrome.alarms.get(ALARM_NAME))) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MIN });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SYNC") { sync().then(sendResponse); return true; }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) sync();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "update") await chrome.storage.local.remove(LEGACY_KEYS);
  await ensureAlarm();
  sync();
});

chrome.runtime.onStartup.addListener(async () => {
  const { snapshot } = await chrome.storage.local.get("snapshot");
  if (!snapshot || Date.now() - snapshot.time > SYNC_PERIOD_MIN * 60 * 1000) sync();
});

ensureAlarm();
