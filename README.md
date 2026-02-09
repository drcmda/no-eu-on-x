# No EU on X

A Brave/Chrome extension that filters posts from EU-based accounts on X (Twitter), using X's official "Account based in" transparency labels.

## Features

- **Country-based filtering** — Automatically hides posts from accounts based in any of the 27 EU member states (all enabled by default)
- **Region filtering** — Also catches accounts that show "Europe" instead of a specific country
- **Custom countries** — Add any additional country or region to the blocklist (e.g. Switzerland, United Kingdom)
- **Username blocklist** — Block specific users by (partial) @handle or display name (supports emoji matching)
- **Exclude people you follow** — People you follow are never filtered (on by default, can be toggled off)
- **Persistent cache** — Lookups are cached for 24 hours to minimize API calls
- **Rate limit handling** — Automatic backoff and retry when X's API rate limits are hit

## How it works

The extension uses X's internal `AboutAccountQuery` GraphQL endpoint — the same one that powers the "About this account" page — to look up each account's registered country. This is the X-verified country based on phone number, not the user-editable location field.

## Installation

1. Download or clone this repository
2. Open `brave://extensions` (or `chrome://extensions`)
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the `no-eu` folder
5. Navigate to [x.com](https://x.com) — the extension activates automatically

## Popup controls

- **Filter enabled** — Master on/off toggle
- **Exclude people I follow** — Skip filtering for accounts you follow
- **Blocked countries / regions** — Checkboxes for each EU country + Europe region
- **Custom countries / regions** — Add non-EU countries to filter
- **Blocked usernames** — Block by @handle, display name, or emoji
- **Clear cache & reset** — Wipe cached lookups and recheck all visible posts
