# Weibo Toolkit

A local-first userscript toolkit for desktop web Weibo (`https://weibo.com/` and `https://api.weibo.com/chat*`). It brings private UID-bound notes, following/follower change tracking, local follower filtering and bounded removal, 1-on-1 private message export, and optional page cleanup into a single bottom-right launcher.

The UI is in Chinese. All data stays in your browser's userscript storage—there is no project server, telemetry, or cloud sync.

**[Install from Greasy Fork](https://greasyfork.org/scripts/591269-weibo-toolkit-friend-radar)** · [GitHub Releases](https://github.com/Berunkasuteru/weibo-toolkit/releases/latest) · [v0.12.1 Release Notes](docs/releases/v0.12.1.md) · [Report an Issue](https://github.com/Berunkasuteru/weibo-toolkit/issues)

## Overview

| Feature | What it does | Data & network scope |
|---|---|---|
| **Friend Notes (`友人档案`)** | Private hand-written notes and tags bound to stable UIDs, with optional profile panels and feed bookmarks | Local storage only; zero network requests |
| **Friend Radar (`关系雷达`)** | Snapshots API-visible followings, diffs changes (added/disappeared, follow-back changes, renames), and lists mutual/one-way relationships | Reads Weibo API; stores locally |
| **Follower Snapshot & Hygiene (`粉丝快照与粉丝体检`)** | Snapshots API-visible followers, tracks changes, and filters locally by factual criteria (mutual status, counts, verification, registration date, source) | Snapshot reads Weibo API; filtering is 100% local |
| **Follower Removal (`移除粉丝`)** | Removes selected followers singly or in confirmed batches (up to 200, ~3s pacing, skips mutuals & noted accounts on bulk select) | **Modifies real Weibo relationships; cannot be undone** |
| **PM Export (`私信导出`)** | Exports the currently open 1-on-1 chat at `api.weibo.com/chat*` to a local Markdown file (`WEIBO_PM_AI_3`) | Reads Weibo API; writes local file |
| **Browsing & Stepmeter (`浏览体验与计步器`)** | Optional (default-off) feed/sidebar cleanup, promotion filtering, original long-post auto-expand, profile visit counter, and local usage stats | Modifies page DOM; optional local stats |

Aside from **Follower Removal**, every feature is either read-only or modifies only local browser storage.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or a compatible userscript manager) in a desktop browser.
2. Install **Weibo Toolkit - Friend Radar** from [Greasy Fork](https://greasyfork.org/scripts/591269-weibo-toolkit-friend-radar) or `weibo-toolkit.user.js` from [GitHub Releases](https://github.com/Berunkasuteru/weibo-toolkit/releases/latest).
3. Log in to `https://weibo.com/`, refresh the page, and click the **Weibo Toolkit** button in the bottom-right corner.

**Updating:** Always update the script in place rather than uninstalling and reinstalling, so your userscript storage is preserved.

## Key Boundaries & Data Safety

- **Observation, not inference:** Following and follower snapshots cover only what Weibo's API returns, which may differ from total counters. "Disappeared from visible list" means only that the API no longer returned the account (whether due to unfollow, block, account closure, or API filtering).
- **Conservative automation:** Optional automatic snapshot checks (24h to 15d) run only when you open or refresh a Weibo page, never poll in the background, and never remove followers.
- **Plain-text backups (`Backup v3`):** Export a JSON backup before clearing browser data, switching devices, or reinstalling. Backups include Friend Radar, Follower Snapshot, and Friend Notes for the current UID, and remain backward-compatible with `v1` and `v2` files. Restoring validates account ownership and previews all replacements before writing.
- **Browser support:** Tested on desktop Chrome, Edge, Vivaldi, and Firefox with Tampermonkey. Mobile Safari, iPhone, and iPad are not supported. Refresh the page after switching Weibo accounts.

## Development

Source files in `src/` are concatenated in fixed order into `weibo-toolkit.user.js` with zero npm dependencies:

```bash
node scripts/build-userscript.mjs --check   # Verify src/ matches weibo-toolkit.user.js byte-for-byte
node scripts/build-userscript.mjs --write   # Rebuild weibo-toolkit.user.js from src/
node tests/run.js                           # Run build check + 13 offline test suites
```

## License

[Mozilla Public License 2.0](LICENSE)
