// Runs in MAIN world (page context) — has access to X's cookies and same-origin fetch.
// Communicates with content.js via window.postMessage.

const BEARER = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const resolved = new Map();

function getCt0() {
  return document.cookie.match(/ct0=([^;]+)/)?.[1] || "";
}

function log(...args) {
  console.log("[No EU]", ...args);
}

// ---------------------------------------------------------------------------
// 1) Passive collection — intercept X's own fetch calls for AboutAccountQuery
// ---------------------------------------------------------------------------
const _fetch = window.fetch;

window.fetch = async function (...args) {
  const response = await _fetch.apply(this, args);
  try {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (url && url.includes("/i/api/graphql/")) {
      // Capture AboutAccountQuery responses passively
      if (url.includes("AboutAccountQuery")) {
        const clone = response.clone();
        clone.json().then((data) => {
          try {
            const country = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in;
            const screenName = new URL(url, location.origin).searchParams.get("variables");
            if (screenName) {
              const vars = JSON.parse(screenName);
              const sn = (vars.screenName || vars.screen_name || "").toLowerCase();
              if (sn && country) {
                log("Passive:", sn, "->", country);
                resolved.set(sn, country);
                window.postMessage({ type: "noeu_passive", username: sn, country }, "*");
              }
            }
          } catch {}
        }).catch(() => {});
      }
      // Also harvest from other GraphQL responses (timeline data may include about_profile)
      const clone2 = response.clone();
      clone2.json().then(harvestUsers).catch(() => {});
    }
  } catch {}
  return response;
};

const knownFollowing = new Set();

function harvestUsers(obj, depth) {
  if (depth === undefined) depth = 0;
  if (!obj || typeof obj !== "object" || depth > 20) return;

  // Harvest follow status from timeline user objects
  if (obj.legacy && obj.legacy.screen_name) {
    const sn = obj.legacy.screen_name.toLowerCase();
    if (obj.legacy.following && !knownFollowing.has(sn)) {
      knownFollowing.add(sn);
      window.postMessage({ type: "noeu_following", username: sn }, "*");
    }
  }

  // Look for about_profile.account_based_in in any response
  if (obj.about_profile && obj.about_profile.account_based_in) {
    const sn = findScreenName(obj);
    if (sn) {
      const country = obj.about_profile.account_based_in;
      if (!resolved.has(sn)) {
        log("Passive harvest:", sn, "->", country);
        resolved.set(sn, country);
        window.postMessage({ type: "noeu_passive", username: sn, country }, "*");
      }
    }
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) harvestUsers(obj[i], depth + 1);
  } else {
    for (const v of Object.values(obj)) {
      if (typeof v === "object") harvestUsers(v, depth + 1);
    }
  }
}

function findScreenName(obj) {
  if (obj.legacy?.screen_name) return obj.legacy.screen_name.toLowerCase();
  if (obj.core?.user_results?.result?.legacy?.screen_name)
    return obj.core.user_results.result.legacy.screen_name.toLowerCase();
  if (typeof obj.screen_name === "string") return obj.screen_name.toLowerCase();
  return null;
}

// ---------------------------------------------------------------------------
// 2) Active lookup — content.js requests a specific user's country
//    Requests are queued and throttled to avoid 429 rate limits.
// ---------------------------------------------------------------------------
const lookupQueue = [];
let lookupRunning = false;
let throttleMs = 500; // ms between API calls — increases on 429
let rateLimitedUntil = 0; // timestamp when rate limit expires

window.addEventListener("message", (event) => {
  if (event.data?.type !== "noeu_lookup") return;
  const { username, rid } = event.data;

  // Serve from cache immediately
  if (resolved.has(username.toLowerCase())) {
    reply(rid, resolved.get(username.toLowerCase()));
    return;
  }

  lookupQueue.push({ username, rid });
  drainQueue();
});

async function drainQueue() {
  if (lookupRunning) return;
  lookupRunning = true;

  while (lookupQueue.length > 0) {
    // Wait if rate limited
    const now = Date.now();
    if (rateLimitedUntil > now) {
      const waitMs = rateLimitedUntil - now;
      log(`Rate limited, waiting ${Math.round(waitMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    const { username, rid } = lookupQueue.shift();

    // Re-check cache (may have been resolved while queued)
    if (resolved.has(username.toLowerCase())) {
      reply(rid, resolved.get(username.toLowerCase()));
      continue;
    }

    const result = await fetchAboutAccount(username);
    if (result.rateLimited) {
      // Put it back at the front of the queue to retry
      lookupQueue.unshift({ username, rid });
      rateLimitedUntil = Date.now() + 60000; // wait 60s
      throttleMs = Math.min(throttleMs * 2, 5000); // back off
      continue;
    }

    if (result.country) resolved.set(username.toLowerCase(), result.country);
    reply(rid, result.country);

    if (lookupQueue.length > 0) {
      await new Promise((r) => setTimeout(r, throttleMs));
    }
  }

  lookupRunning = false;
}

function reply(rid, country) {
  window.postMessage({ type: "noeu_result", rid, country }, "*");
}

// ---------------------------------------------------------------------------
// AboutAccountQuery — the actual endpoint X uses for "Account based in"
// ---------------------------------------------------------------------------
let _discoveredAboutQueryId = null;
let _discoveryPromise = null;

async function discoverAboutQueryId() {
  if (_discoveredAboutQueryId) return _discoveredAboutQueryId;
  if (_discoveryPromise) return _discoveryPromise;

  _discoveryPromise = (async () => {
    const scripts = document.querySelectorAll("script[src]");

    for (const s of scripts) {
      if (!s.src) continue;
      try {
        const text = await (await _fetch(s.src)).text();
        const needle = '"AboutAccountQuery"';
        const idx = text.indexOf(needle);
        if (idx === -1) continue;

        const start = Math.max(0, idx - 3000);
        const end = Math.min(text.length, idx + 3000);
        const context = text.substring(start, end);
        const opPos = idx - start;

        // Find closest queryId
        const allQids = [...context.matchAll(/queryId:"([^"]+)"/g)];
        let closestDist = Infinity;
        for (const m of allQids) {
          const dist = Math.abs(m.index - opPos);
          if (dist < closestDist) {
            closestDist = dist;
            _discoveredAboutQueryId = m[1];
          }
        }

        if (_discoveredAboutQueryId) {
          log("Discovered AboutAccountQuery queryId:", _discoveredAboutQueryId);
          return _discoveredAboutQueryId;
        }
      } catch {}
    }

    // Fallback to the known queryId
    log("Using fallback AboutAccountQuery queryId");
    _discoveredAboutQueryId = "zs_jFPFT78rBpXv9Z3U2YQ";
    return _discoveredAboutQueryId;
  })();

  return _discoveryPromise;
}

async function fetchAboutAccount(username) {
  try {
    const queryId = await discoverAboutQueryId();
    const ct0 = getCt0();
    if (!ct0) { log("No ct0 cookie"); return { country: null }; }

    const variables = JSON.stringify({ screenName: username });
    const url = `/i/api/graphql/${queryId}/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;

    const resp = await _fetch(url, {
      credentials: "include",
      headers: {
        authorization: BEARER,
        "x-csrf-token": ct0,
        "x-twitter-active-user": "yes",
        "x-twitter-auth-type": "OAuth2Session",
        "content-type": "application/json",
      },
    });

    if (resp.status === 429) {
      log("Rate limited (429) for", username);
      return { country: null, rateLimited: true };
    }

    if (!resp.ok) {
      log("AboutAccountQuery", resp.status, "for", username);
      return { country: null };
    }

    const data = await resp.json();
    const country = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in;
    if (country) {
      log("Found:", username, "->", country);
    }
    return { country: country || null };
  } catch (err) {
    log("AboutAccountQuery error:", err.message);
    return { country: null };
  }
}

log("injected.js loaded — passive interception active");
