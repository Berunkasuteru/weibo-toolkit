# Weibo Toolkit

A local-first userscript toolkit for Weibo. The current module is Friend Radar.

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

The three Friend Radar userscript menu commands remain available as fallback controls. The project has not been published on Greasy Fork.

## Data and Privacy

Data stays in userscript-local browser storage. There is no project server, telemetry, or automatic background scanning; updates are manual. Clearing browser or userscript storage deletes the local baseline and event history.

Backup/import support is planned but is not implemented.

## Known Limitations

- The API-visible following list may differ from Weibo's reported total.
- The reason an account disappeared cannot be determined.
- A relationship change during a multi-page scan can theoretically create a transient observation.
- Simultaneous updates from multiple tabs are unsupported.
- Reload Weibo after switching accounts.
- Local data is browser-local and has no built-in backup or restore yet.

## Status

v0.2.0 — working development release / real-browser tested

## Project Philosophy

See [ENGINEERING_PHILOSOPHY.md](ENGINEERING_PHILOSOPHY.md) for the project's engineering principles.
