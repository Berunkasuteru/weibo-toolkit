# Weibo Toolkit

A local-first userscript toolkit for desktop web Weibo (`https://weibo.com/` and `https://api.weibo.com/chat*`). Once installed, a **Weibo Toolkit** button appears in the bottom-right corner of the page.

| Feature | Purpose |
|---|---|
| **Friend Notes (`友人档案`)** | Private hand-written notes and tags bound to stable UIDs, with optional profile panels and feed bookmarks |
| **Friend Radar (`关系雷达`)** | Snapshots API-visible followings, diffs changes (added/disappeared, follow-back status, renames), and lists mutual/one-way relationships |
| **Follower Snapshot & Hygiene (`粉丝快照与粉丝体检`)** | Snapshots API-visible followers, tracks changes, and filters locally by factual criteria |
| **Follower Removal (`移除粉丝`)** | Removes selected followers singly or in confirmed batches (up to 200 per batch, ~3s pacing) |
| **PM Export (`私信导出`)** | Exports the currently open 1-on-1 conversation at `api.weibo.com/chat*` to a local Markdown file |
| **Browsing & Stepmeter (`浏览体验与计步器`)** | Optional (default-off) feed/sidebar cleanup, promotion filtering, long-post auto-expand, profile visit counter, and local usage stats |

All data stays in your browser's local userscript storage. There is no project server, telemetry, or cloud sync.

## Quick Start

1. Install Tampermonkey (or a compatible userscript manager) on a desktop browser (tested on Chrome, Edge, Vivaldi, and Firefox; Mobile Safari / iOS / iPadOS are not supported).
2. Install this script, log in to `https://weibo.com/`, and refresh the page.
3. Click the **Weibo Toolkit** button in the bottom-right corner (or use **Weibo Toolkit：打开工具箱** from the userscript menu).

All page-modifying and usage-tracking preferences are **off by default**.

## Safety & Data Boundaries

- **Only Follower Removal modifies real Weibo state:** Every removal requires explicit confirmation, processes at most 200 selected accounts per batch with ~3-second spacing, skips mutual followings and accounts with Friend Notes during bulk selection, never retries automatically, and stops immediately on failure or uncertain outcome.
- **API observation only:** Snapshots reflect only what Weibo's API returns at the time of the scan. "Disappeared from visible list" records an API diff without inferring a cause (unfollow, block, closure, or API filtering).
- **Backups (`Backup v3`):** Export a plain-text JSON backup before clearing browser data, switching devices, or reinstalling. Update the script in place rather than reinstalling so local storage is preserved.

## Source & Feedback

[GitHub Repository](https://github.com/Berunkasuteru/weibo-toolkit) · [Release Notes](https://github.com/Berunkasuteru/weibo-toolkit/releases) · [Issue Tracker](https://github.com/Berunkasuteru/weibo-toolkit/issues)

License: [Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/)
