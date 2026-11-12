# Weibo Toolkit

A local-first userscript toolkit for desktop web Weibo (`https://weibo.com/` and `https://api.weibo.com/chat*`). Once installed, a **Weibo Toolkit** button appears in the bottom-right corner of the page (in-page UI is in Chinese).

| Feature | Purpose |
|---|---|
| **Unified Updates** | Runs Friend Radar and Follower Snapshot sequentially from Home with two-stage progress and per-stage cancellation |
| **Friend Notes** | Private hand-written notes and tags bound to stable UIDs, with direct UID lookup, profile panels, feed bookmarks, and CSV/Markdown export |
| **Friend Radar** | Snapshots API-visible followings, diffs changes, filters and marks events, and exports Relationship Overview (CSV/Markdown) |
| **Follower Snapshot & Hygiene** | Snapshots API-visible followers, tracks and exports follower events (CSV/Markdown), and filters locally by Friend Notes/tags, counts, verification, and dates |
| **Follower Removal** | Removes selected followers singly or in confirmed batches (up to 200 per batch, ~3s spacing) with a searchable local removal log |
| **PM Export** | Exports the active 1-on-1 conversation at `api.weibo.com/chat*` to a participant-labeled Markdown file |
| **Browsing & Stepmeter** | Optional (default-off) feed/sidebar cleanup, promotion filtering, long-post auto-expand, profile visit counter, and local usage stats |

All data stays in your browser's local userscript storage. There is no project server, telemetry, or cloud sync.

## Quick Start

1. Install Tampermonkey (or a compatible userscript manager) on a desktop browser (tested on Chrome, Edge, Vivaldi, and Firefox; Mobile Safari / iOS / iPadOS are not supported).
2. Install this script, log in to `https://weibo.com/`, and refresh the page.
3. Click the **Weibo Toolkit** button in the bottom-right corner (or open it from the userscript extension menu).

All page-modifying and usage-tracking preferences are **off by default**.

## Safety & Data Boundaries

- **Only Follower Removal modifies real Weibo state:** Every removal requires explicit confirmation, processes at most 200 selected accounts per batch with ~3-second spacing, skips mutual followings and accounts with Friend Notes during bulk selection, never retries automatically, and stops immediately on failure or uncertain outcome.
- **API observation only:** Snapshots reflect only what Weibo's API returns at scan time. "Disappeared from visible list" records an API diff without inferring unfollow, block, closure, or API filtering.
- **Full local backups (`Backup v4`):** Export a plain-text JSON backup before clearing browser data, switching devices, or reinstalling. `Backup v4` covers Friend Radar, Follower Snapshot, Friend Notes, Removal Log, Hygiene Presets, Usage Stats, and Profile Visits while remaining backward-compatible with `v1`–`v3` files. Update the script in place rather than reinstalling so local storage is preserved.

## Source & Feedback

[GitHub Repository](https://github.com/Berunkasuteru/weibo-toolkit) · [Release Notes](https://github.com/Berunkasuteru/weibo-toolkit/releases) · [Issue Tracker](https://github.com/Berunkasuteru/weibo-toolkit/issues)

License: [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/)
