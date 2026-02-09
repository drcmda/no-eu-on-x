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

const toggle = document.getElementById("toggle");
const checkedEl = document.getElementById("checked");
const filteredEl = document.getElementById("filtered");
const clearBtn = document.getElementById("clear");
const countryListEl = document.getElementById("countryList");
const selectAllBtn = document.getElementById("selectAll");
const selectNoneBtn = document.getElementById("selectNone");
const usernameInput = document.getElementById("usernameInput");
const addUsernameBtn = document.getElementById("addUsername");
const usernameTagsEl = document.getElementById("usernameTags");
const excludeFollowingEl = document.getElementById("excludeFollowing");
const excludeOwnRepliesEl = document.getElementById("excludeOwnReplies");
const customCountryInput = document.getElementById("customCountryInput");
const addCustomCountryBtn = document.getElementById("addCustomCountry");
const customCountryTagsEl = document.getElementById("customCountryTags");

let blockedSet = new Set(EU_COUNTRY_LIST);
let blockedUsernames = new Set();
let customCountries = new Set();

// --- Country list ---

function buildCountryList() {
  countryListEl.innerHTML = "";
  for (const country of EU_COUNTRY_LIST) {
    const label = document.createElement("label");
    label.className = "country-item";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = blockedSet.has(country);
    cb.dataset.country = country;
    cb.addEventListener("change", () => {
      if (cb.checked) {
        blockedSet.add(country);
      } else {
        blockedSet.delete(country);
      }
      saveBlockedCountries();
    });

    const span = document.createElement("span");
    span.textContent = country;

    label.appendChild(cb);
    label.appendChild(span);
    countryListEl.appendChild(label);
  }
}

function saveBlockedCountries() {
  chrome.storage.local.set({ blockedCountries: [...blockedSet] });
}

function setAll(checked) {
  if (checked) {
    blockedSet = new Set(EU_COUNTRY_LIST);
  } else {
    blockedSet = new Set();
  }
  saveBlockedCountries();
  countryListEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.checked = checked;
  });
}

// --- Username blocklist ---

function renderUsernameTags() {
  usernameTagsEl.innerHTML = "";
  if (blockedUsernames.size === 0) {
    const empty = document.createElement("span");
    empty.className = "username-empty";
    empty.textContent = "No usernames blocked";
    usernameTagsEl.appendChild(empty);
    return;
  }
  // Sort for consistent display (locale-aware to handle emojis gracefully)
  const sorted = [...blockedUsernames].sort((a, b) => a.localeCompare(b));
  for (const name of sorted) {
    const tag = document.createElement("span");
    tag.className = "username-tag";

    const label = document.createElement("span");
    label.textContent = name;

    const remove = document.createElement("span");
    remove.className = "remove";
    remove.textContent = "\u00d7";
    remove.addEventListener("click", () => {
      blockedUsernames.delete(name);
      saveBlockedUsernames();
      renderUsernameTags();
    });

    tag.appendChild(label);
    tag.appendChild(remove);
    usernameTagsEl.appendChild(tag);
  }
}

function saveBlockedUsernames() {
  chrome.storage.local.set({ blockedUsernames: [...blockedUsernames] });
}

function addUsername() {
  let val = usernameInput.value.trim();
  if (!val) return;
  // Strip leading @ if present
  if (val.startsWith("@")) val = val.slice(1);
  if (!val) return;
  // Store lowercase for case-insensitive matching
  blockedUsernames.add(val.toLowerCase());
  saveBlockedUsernames();
  renderUsernameTags();
  usernameInput.value = "";
}

addUsernameBtn.addEventListener("click", addUsername);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUsername();
});

// --- Custom countries ---

function renderCustomCountryTags() {
  customCountryTagsEl.innerHTML = "";
  if (customCountries.size === 0) {
    const empty = document.createElement("span");
    empty.className = "username-empty";
    empty.textContent = "None added";
    customCountryTagsEl.appendChild(empty);
    return;
  }
  const sorted = [...customCountries].sort((a, b) => a.localeCompare(b));
  for (const name of sorted) {
    const tag = document.createElement("span");
    tag.className = "username-tag";

    const label = document.createElement("span");
    label.textContent = name;

    const remove = document.createElement("span");
    remove.className = "remove";
    remove.textContent = "\u00d7";
    remove.addEventListener("click", () => {
      customCountries.delete(name);
      saveCustomCountries();
      renderCustomCountryTags();
    });

    tag.appendChild(label);
    tag.appendChild(remove);
    customCountryTagsEl.appendChild(tag);
  }
}

function saveCustomCountries() {
  chrome.storage.local.set({ customCountries: [...customCountries] });
}

function addCustomCountry() {
  let val = customCountryInput.value.trim();
  if (!val) return;
  customCountries.add(val);
  saveCustomCountries();
  renderCustomCountryTags();
  customCountryInput.value = "";
}

addCustomCountryBtn.addEventListener("click", addCustomCountry);
customCountryInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCustomCountry();
});

// --- Load state ---

chrome.storage.local.get(["enabled", "blockedCountries", "blockedUsernames", "excludeFollowing", "excludeOwnReplies", "customCountries"], (data) => {
  toggle.checked = data.enabled !== false;
  excludeFollowingEl.checked = data.excludeFollowing !== false;
  excludeOwnRepliesEl.checked = data.excludeOwnReplies !== false;
  if (data.blockedCountries) {
    blockedSet = new Set(data.blockedCountries);
  }
  if (data.blockedUsernames) {
    blockedUsernames = new Set(data.blockedUsernames);
  }
  if (data.customCountries) {
    customCountries = new Set(data.customCountries);
  }
  buildCountryList();
  renderUsernameTags();
  renderCustomCountryTags();
});

// Ask content script for live stats
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]?.id) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: "getStats" }, (resp) => {
    if (chrome.runtime.lastError || !resp) return;
    checkedEl.textContent = resp.checked;
    filteredEl.textContent = resp.filtered;
  });
});

toggle.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: toggle.checked });
});

excludeFollowingEl.addEventListener("change", () => {
  chrome.storage.local.set({ excludeFollowing: excludeFollowingEl.checked });
});

excludeOwnRepliesEl.addEventListener("change", () => {
  chrome.storage.local.set({ excludeOwnReplies: excludeOwnRepliesEl.checked });
});

selectAllBtn.addEventListener("click", () => setAll(true));
selectNoneBtn.addEventListener("click", () => setAll(false));

clearBtn.addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]?.id) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "clearCache" }, () => {
      checkedEl.textContent = "0";
      filteredEl.textContent = "0";
    });
  });
});
