# Weibo Toolkit

A local-first userscript toolkit for desktop web Weibo (`https://weibo.com/` and `https://api.weibo.com/chat*`). It unifies private UID-bound notes, following and follower change tracking, local follower hygiene and bounded removal, 1-on-1 private message export, and optional page enhancements inside a single launcher.

The in-page interface is in Chinese. All data stays in your browser's userscript storage—there is no project server, telemetry, or cloud sync.

**[Install from Greasy Fork](https://greasyfork.org/scripts/591269-weibo-toolkit-friend-radar)** · [GitHub Releases](https://github.com/Berunkasuteru/weibo-toolkit/releases/latest) · [v0.13.0 Release Notes](docs/releases/v0.13.0.md) · [Report an Issue](https://github.com/Berunkasuteru/weibo-toolkit/issues)

## Overview

| Feature | What it does | Data & network scope |
|---|---|---|
| **Unified Updates** | Runs Friend Radar and Follower Snapshot sequentially from Home with two-stage progress and per-stage cancellation | Reads Weibo API; stores locally |
| **Friend Notes** | Saves private notes and tags bound to stable UIDs, with direct UID lookup, profile panels, feed bookmarks, and CSV/Markdown export | Local storage only; zero network requests |
| **Friend Radar** | Snapshots API-visible followings, tracks diffs (adds, disappearances, follow-backs, renames), filters/marks events, and exports Relationship Overview (CSV/Markdown) | Reads Weibo API; stores locally |
| **Follower Snapshot & Hygiene** | Snapshots API-visible followers, filters/exports follower events (CSV/Markdown), and filters followers locally by Friend Notes/tags, counts, mutual status, verification, and dates | Snapshot reads Weibo API; filtering is 100% local |
| **Follower Removal** | Removes selected followers singly or in confirmed batches (up to 200, ~3s spacing; bulk fill skips mutuals and noted accounts) with a local log | **Modifies real Weibo relationships; cannot be undone** |
| **PM Export** | Exports the active 1-on-1 chat at `api.weibo.com/chat*` to a participant-labeled Markdown file (`WEIBO_PM_AI_3`) | Reads Weibo API; writes local file |
| **Browsing & Stepmeter** | Optional (default-off) feed/sidebar cleanup, promotion filtering, long-post expansion, profile visit counter, and local usage stats | Modifies page DOM; optional local stats |

Aside from **Follower Removal**, every feature is either read-only or modifies only local browser storage.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or a compatible userscript manager) in a desktop browser.
2. Install **Weibo Toolkit - Friend Radar** from [Greasy Fork](https://greasyfork.org/scripts/591269-weibo-toolkit-friend-radar) or `weibo-toolkit.user.js` from [GitHub Releases](https://github.com/Berunkasuteru/weibo-toolkit/releases/latest).
3. Log in to `https://weibo.com/`, refresh the page, and click the **Weibo Toolkit** button in the bottom-right corner.

**Updating:** Always update in place rather than uninstalling and reinstalling so local storage is preserved.

## Key Boundaries & Data Safety

- **Observation, not inference:** Following and follower snapshots reflect only what Weibo's API returns, which may differ from total counters. "Disappeared from visible list" records an API diff without inferring unfollow, block, closure, or API filtering.
- **Conservative automation:** Optional automatic snapshot checks (`24h` to `15d`) run sequentially when you open or refresh Weibo, never poll in the background, and never remove followers.
- **Plain-text backups (`Backup v4`):** Export a JSON backup before clearing browser data, switching devices, or reinstalling. `Backup v4` covers all seven per-UID storage domains (Friend Radar, Follower Snapshot, Friend Notes, Follower Removal Log, Hygiene Presets, Usage Stats, and Profile Visits), remains backward-compatible with `v1`–`v3` files, validates account ownership, and previews all changes before writing.
- **Browser support:** Tested on desktop Chrome, Edge, Vivaldi, and Firefox with Tampermonkey. Mobile Safari, iPhone, and iPad are not supported. Refresh the page after switching Weibo accounts.

## Repository Structure

```text
src/       Ordered userscript modules concatenated into the build artifact
tests/     Zero-dependency Node test suites and synthetic browser/DOM fixtures
scripts/   Deterministic userscript bundler and SHA256 verifier
docs/      Greasy Fork description, release checklist, and version release notes
```

## Development

Zero npm dependencies are required:

```bash
node scripts/build-userscript.mjs --check   # Verify src/ matches weibo-toolkit.user.js byte-for-byte
node scripts/build-userscript.mjs --write   # Rebuild weibo-toolkit.user.js from src/
node tests/run.js                           # Run build check + 13 offline test suites
```

## License

[Mozilla Public License 2.0](LICENSE)
