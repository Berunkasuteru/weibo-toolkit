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

## Installation

Current development and testing installation uses Tampermonkey or Violentmonkey:

1. Create or import a userscript.
2. Use the complete contents of `weibo-toolkit.user.js`.
3. Open authenticated `https://weibo.com/`.
4. Reload the page.
5. Use the lower-right **Weibo Toolkit** launcher.

Four concise **Weibo Toolkit** userscript menu commands remain available as fallback controls for update, events, status, and backup export. The project has not been published on Greasy Fork.

## Upgrade

To upgrade, open the existing installed **Weibo Toolkit** userscript, replace its contents with the new `weibo-toolkit.user.js`, and save it in place. Do not delete the existing script first, and do not create a second installed copy as an upgrade procedure.

Normal in-place upgrades preserve Friend Radar GM storage. Deleting or uninstalling the userscript may remove its storage or make that storage unavailable. Export a backup before uninstalling/reinstalling the userscript or moving to another browser or device.

## Data and Privacy

Data stays in userscript-local browser storage. There is no project server, telemetry, or automatic background scanning; updates are manual. Clearing browser or userscript storage deletes the local baseline and event history.

Friend Radar can manually export the current account's complete validated state as an optional local JSON backup. Existing v0.2.0 data is preserved automatically when upgrading, so a backup is not required for normal upgrades. On supported browsers the export action may show a native Save As dialog; otherwise the backup is handed to the browser's normal download system. Import/Restore is not yet implemented.

## Known Limitations

- The API-visible following list may differ from Weibo's reported total.
- The reason an account disappeared cannot be determined.
- A relationship change during a multi-page scan can theoretically create a transient observation.
- Simultaneous updates from multiple tabs are unsupported.
- Reload Weibo after switching accounts.
- Local data is browser-local; backup export is available, but Import/Restore is not yet implemented.
- A single scan stops at a 30-request safety ceiling and saves no scan result when that ceiling is reached. At 20 records per page this is roughly 600 visible records in typical responses, not a guaranteed exact account limit.

## Status

v0.3.0 — stable release

