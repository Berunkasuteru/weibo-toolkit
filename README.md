# Weibo Toolkit

A local-first userscript toolkit for Weibo. The current module is Friend Radar.

The visible product brand is **Weibo Toolkit**. The current product UI is Chinese-focused and does not yet provide a full internationalized interface or language selector.

## Current Feature: Friend Radar

Friend Radar manually snapshots the API-visible following list and compares successful snapshots by stable UID. It records when an account:

- appears in the visible following list;
- disappears from the visible following list;
- starts following you;
- stops following you;
- changes its screen name.

It does not guess why an account disappeared. The first successful run creates a baseline and no historical events.

### What "follow-me" changes actually cover

Friend Radar tracks only the following list that Weibo's API makes visible to you. Follow-me changes — *starts following you* and *stops following you* — are observed **only for accounts present in that API-visible following list**, that is, accounts you follow and that the API returns.

Friend Radar does **not** crawl your complete followers/fans list. If someone who follows you is not in your API-visible following list, Friend Radar never sees them, and their unfollowing you produces no event. This is therefore not complete "who unfollowed me" monitoring.

### While an update runs

During **立即更新**, Friend Radar shows live progress — current page, requests made, validated records read, and the total the API reports — updated only after a page has been received and validated. The reported total is shown as-is and is not treated as an exact completion percentage.

### Events, details and timelines

Each stored event opens a detail view showing its type, the stored display name, the stable UID, the detection time, and the truthful before/after relationship meaning. From there you can open a per-person **relationship timeline**, keyed on stable UID and ordered newest first. A nickname change keeps one timeline; two accounts sharing a nickname stay separate. The event list can be filtered with a plain nickname/UID search.

A timeline shows only events Weibo Toolkit actually observed and stored. It is not the complete real-world relationship history.

## Installation

Install with [Tampermonkey](https://www.tampermonkey.net/) and Greasy Fork:

1. Install the Tampermonkey extension in your browser.
2. Install **Weibo Toolkit - Friend Radar** from its Greasy Fork page.
3. Open authenticated `https://weibo.com/`.
4. Reload the page.
5. Use the lower-right **Weibo Toolkit** launcher.

Four concise **Weibo Toolkit** userscript menu commands remain available as fallback controls for update, events, status, and backup export.

### Manual source installation (developers / fallback)

If you are working from source or Greasy Fork is unavailable, install manually with Tampermonkey or Violentmonkey:

1. Create a new userscript.
2. Paste the complete contents of `weibo-toolkit.user.js`.
3. Save, then open authenticated `https://weibo.com/` and reload.

Manually installed copies do not receive automatic updates.

## Upgrade

To upgrade, open the existing installed **Weibo Toolkit** userscript, replace its contents with the new `weibo-toolkit.user.js`, and save it in place. Do not delete the existing script first, and do not create a second installed copy as an upgrade procedure.

Normal in-place upgrades preserve Friend Radar GM storage. Deleting or uninstalling the userscript may remove its storage or make that storage unavailable. Export a backup before uninstalling/reinstalling the userscript or moving to another browser or device.

## Data and Privacy

Data stays in userscript-local browser storage. There is no project server, telemetry, or automatic background scanning; updates are manual. Clearing browser or userscript storage deletes the local baseline and event history.

Friend Radar can manually export the current account's complete validated state as an optional local JSON backup. Existing v0.2.0 data is preserved automatically when upgrading, so a backup is not required for normal upgrades. On supported browsers the export action may show a native Save As dialog; otherwise the backup is handed to the browser's normal download system. Import/Restore is not yet implemented.

## Known Limitations

- The API-visible following list may differ from Weibo's reported total.
- Follow-me changes are observed only for accounts in the API-visible following list; the complete followers/fans list is never crawled, so this is not complete "who unfollowed me" monitoring.
- The reason an account disappeared cannot be determined.
- Relationship timelines cover only events Weibo Toolkit observed and stored, not the complete real-world history.
- A relationship change during a multi-page scan can theoretically create a transient observation.
- Simultaneous operations from multiple Weibo tabs are unsupported. Cross-tab writes are not fully serialized: a conflicting write is detected and reported rather than silently overwriting, but last-writer-wins races remain possible. Use one Weibo tab at a time.
- Reload Weibo after switching accounts.
- Local data is browser-local; backup export is available, but Import/Restore is not yet implemented.
- A single scan stops at a 100-request safety ceiling and saves no scan result when that ceiling is reached. At 20 records per page this is roughly 2,000 visible records in typical responses, not a guaranteed exact account limit.

## Status

v0.4.0 — current release. Adds live scan progress, event detail views, per-person relationship timelines, and nickname/UID search. Storage schema, storage keys, and backup format are unchanged from v0.1.0; no migration is involved.

