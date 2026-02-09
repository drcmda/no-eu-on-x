// EU member states — all 27, with alternate names mapped to canonical
const EU_COUNTRIES_CANONICAL = {
  "Austria": "Austria",
  "Belgium": "Belgium",
  "Bulgaria": "Bulgaria",
  "Croatia": "Croatia",
  "Cyprus": "Cyprus",
  "Czech Republic": "Czechia",
  "Czechia": "Czechia",
  "Denmark": "Denmark",
  "Estonia": "Estonia",
  "Finland": "Finland",
  "France": "France",
  "Germany": "Germany",
  "Greece": "Greece",
  "Hungary": "Hungary",
  "Ireland": "Ireland",
  "Republic of Ireland": "Ireland",
  "Italy": "Italy",
  "Latvia": "Latvia",
  "Lithuania": "Lithuania",
  "Luxembourg": "Luxembourg",
  "Malta": "Malta",
  "Netherlands": "Netherlands",
  "The Netherlands": "Netherlands",
  "Poland": "Poland",
  "Portugal": "Portugal",
  "Romania": "Romania",
  "Slovakia": "Slovakia",
  "Slovenia": "Slovenia",
  "Spain": "Spain",
  "Sweden": "Sweden",
  // Region-level labels (user chose to show region instead of country)
  "Europe": "Europe",
};

// Sorted list of canonical country/region names (used as keys for settings)
const EU_COUNTRY_LIST = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus",
  "Czechia", "Denmark", "Estonia", "Finland", "France",
  "Germany", "Greece", "Hungary", "Ireland", "Italy",
  "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands",
  "Poland", "Portugal", "Romania", "Slovakia", "Slovenia",
  "Spain", "Sweden",
  // Regions
  "Europe",
];

// In-memory cache: username -> { country: string|null, ts: number }
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days for successful lookups
const CACHE_TTL_UNKNOWN = 1000 * 60 * 5; // 5 min for failed/unknown lookups
const pendingLookups = new Map();

let enabled = true;
// Default: all EU countries are blocked
let blockedCountries = new Set(EU_COUNTRY_LIST);
// Username blocklist — stored lowercase for case-insensitive matching
let blockedUsernames = new Set();
// Custom countries added by the user (e.g. "Switzerland", "United Kingdom")
let customCountries = new Set();
// Users we follow — harvested passively from X's timeline responses
const followedUsers = new Set();
let excludeFollowing = true; // default: don't filter people you follow
let stats = { filtered: 0, checked: 0 };

// Load persisted state on startup
chrome.storage.local.get(["euCache", "enabled", "stats", "blockedCountries", "blockedUsernames", "excludeFollowing", "customCountries"], (data) => {
  if (data.euCache) {
    for (const [k, v] of Object.entries(data.euCache)) {
      cache.set(k, v);
    }
  }
  if (data.enabled !== undefined) enabled = data.enabled;
  if (data.stats) stats = data.stats;
  if (data.blockedCountries) {
    blockedCountries = new Set(data.blockedCountries);
  }
  if (data.blockedUsernames) {
    blockedUsernames = new Set(data.blockedUsernames);
  }
  if (data.excludeFollowing !== undefined) excludeFollowing = data.excludeFollowing;
  if (data.customCountries) customCountries = new Set(data.customCountries);
});

// Listen for changes from popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled) {
    enabled = changes.enabled.newValue;
    if (enabled) {
      rescanAll();
    } else {
      unhideAll();
    }
  }
  if (changes.blockedCountries) {
    blockedCountries = new Set(changes.blockedCountries.newValue);
    rescanAll();
  }
  if (changes.blockedUsernames) {
    blockedUsernames = new Set(changes.blockedUsernames.newValue);
    rescanAll();
  }
  if (changes.excludeFollowing) {
    excludeFollowing = changes.excludeFollowing.newValue;
    rescanAll();
  }
  if (changes.customCountries) {
    customCountries = new Set(changes.customCountries.newValue);
    rescanAll();
  }
});

function isCountryBlocked(country) {
  if (!country) return false;
  // Check EU country list
  const canonical = EU_COUNTRIES_CANONICAL[country];
  if (canonical && blockedCountries.has(canonical)) return true;
  // Check custom countries (case-insensitive)
  const lower = country.toLowerCase();
  for (const custom of customCountries) {
    if (custom.toLowerCase() === lower) return true;
  }
  return false;
}

// Extract display name text including emojis (X renders emojis as <img alt="...">)
function getDisplayNameText(article) {
  const nameEl = article.querySelector('[data-testid="User-Name"]');
  if (!nameEl) return "";
  // The first <a> inside User-Name contains the display name
  const link = nameEl.querySelector("a");
  if (!link) return "";
  let text = "";
  const walk = (node) => {
    if (node.nodeType === 3) { // text node
      text += node.textContent;
    } else if (node.nodeName === "IMG" && node.alt) {
      text += node.alt; // emoji alt text
    } else {
      for (const child of node.childNodes) walk(child);
    }
  };
  walk(link);
  return text.trim().toLowerCase();
}

function isUsernameBlocked(username, article) {
  if (blockedUsernames.size === 0) return false;
  // Check @handle (case-insensitive)
  if (blockedUsernames.has(username.toLowerCase())) return true;
  // Check display name (includes emojis from <img alt>)
  const displayName = getDisplayNameText(article);
  if (displayName) {
    if (blockedUsernames.has(displayName)) return true;
    for (const blocked of blockedUsernames) {
      if (displayName.includes(blocked)) return true;
    }
  }
  return false;
}

function persistCache() {
  const obj = {};
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.ts < CACHE_TTL) obj[k] = v;
  }
  chrome.storage.local.set({ euCache: obj, stats });
}

// Listen for passive data from injected.js (intercepted from X's own API)
window.addEventListener("message", (event) => {
  if (event.data?.type === "noeu_passive") {
    const { username, country } = event.data;
    if (username && country) {
      cache.set(username, { country, ts: Date.now() });
      persistCache();
    }
  }
  if (event.data?.type === "noeu_following") {
    followedUsers.add(event.data.username);
  }
});

// Request a user lookup via injected.js (runs in page context with full auth)
let ridCounter = 0;
async function lookupUser(username) {
  if (cache.has(username)) {
    const entry = cache.get(username);
    const ttl = entry.country ? CACHE_TTL : CACHE_TTL_UNKNOWN;
    if (Date.now() - entry.ts < ttl) return entry.country;
  }

  if (pendingLookups.has(username)) {
    return pendingLookups.get(username);
  }

  const rid = `r${++ridCounter}_${username}`;
  const promise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener("message", handler);
      cache.set(username, { country: null, ts: Date.now() });
      pendingLookups.delete(username);
      resolve(null);
    }, 15000);

    function handler(event) {
      if (event.data?.type === "noeu_result" && event.data.rid === rid) {
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        const country = event.data.country || null;
        stats.checked++;
        cache.set(username, { country, ts: Date.now() });
        persistCache();
        pendingLookups.delete(username);
        resolve(country);
      }
    }
    window.addEventListener("message", handler);
    window.postMessage({ type: "noeu_lookup", username, rid }, "*");
  });

  pendingLookups.set(username, promise);
  return promise;
}

function getUsernameFromTweet(article) {
  const userLinks = article.querySelectorAll('a[href^="/"]');
  for (const link of userLinks) {
    const href = link.getAttribute("href");
    const m = href.match(/^\/([A-Za-z0-9_]{1,15})(\/|$)/);
    if (m) {
      const name = m[1].toLowerCase();
      const reserved = new Set([
        "home", "explore", "search", "notifications", "messages",
        "settings", "i", "compose", "hashtag", "lists", "bookmarks",
        "communities", "premium", "jobs", "help", "tos", "privacy",
      ]);
      if (!reserved.has(name)) return m[1];
    }
  }
  return null;
}

async function processTweet(article) {
  if (!enabled) return;

  const username = getUsernameFromTweet(article);
  if (!username) return;

  // Skip people we follow (if option enabled)
  if (excludeFollowing && followedUsers.has(username.toLowerCase())) {
    toggleHide(article, false);
    return;
  }

  // Username blocklist is instant — no fetch needed
  if (isUsernameBlocked(username, article)) {
    if (!article.dataset.euChecked) stats.filtered++;
    article.dataset.euChecked = "1";
    toggleHide(article, true);
    return;
  }

  // If we already looked this user up, re-evaluate with current blocked list
  if (article.dataset.euChecked) {
    const cached = cache.get(username);
    if (cached) {
      const shouldHide = isCountryBlocked(cached.country);
      toggleHide(article, shouldHide);
    }
    return;
  }

  article.dataset.euChecked = "1";

  const country = await lookupUser(username);
  if (!enabled) return;

  const shouldHide = isCountryBlocked(country);
  if (shouldHide) stats.filtered++;
  toggleHide(article, shouldHide);
  persistCache();
}

function toggleHide(article, hide) {
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  if (hide) {
    article.classList.add("no-eu-hidden");
    if (cell) cell.classList.add("no-eu-hidden");
  } else {
    article.classList.remove("no-eu-hidden");
    if (cell) cell.classList.remove("no-eu-hidden");
  }
}

function scanTimeline() {
  const articles = document.querySelectorAll('article[data-testid="tweet"]');
  for (const article of articles) {
    processTweet(article);
  }
}

function rescanAll() {
  // Clear the checked flag so processTweet re-evaluates
  document.querySelectorAll("[data-eu-checked]").forEach((el) => {
    delete el.dataset.euChecked;
  });
  unhideAll();
  scanTimeline();
}

function unhideAll() {
  document.querySelectorAll(".no-eu-hidden").forEach((el) => {
    el.classList.remove("no-eu-hidden");
  });
}

// Observe DOM for newly loaded tweets
const observer = new MutationObserver((mutations) => {
  if (!enabled) return;
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      const articles = node.querySelectorAll
        ? node.querySelectorAll('article[data-testid="tweet"]')
        : [];
      if (node.matches?.('article[data-testid="tweet"]')) {
        processTweet(node);
      }
      for (const article of articles) {
        processTweet(article);
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

scanTimeline();
setInterval(scanTimeline, 3000);

// Message handler for popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "getStats") {
    sendResponse({
      filtered: stats.filtered,
      checked: stats.checked,
      enabled,
      blockedCountries: [...blockedCountries],
    });
  }
  if (msg.type === "clearCache") {
    cache.clear();
    stats = { filtered: 0, checked: 0 };
    chrome.storage.local.remove(["euCache", "stats"]);
    rescanAll();
    sendResponse({ ok: true });
  }
});
