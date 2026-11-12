# Pre-Release Live Page Checklist

Automated tests and synthetic DOM fixtures do not replace live Weibo pages. Before publishing a release, walk through this checklist (~10 minutes) in a logged-in desktop browser. No real follower-removal request needs to be sent (stop at the confirmation dialog in Section 5).

## 1. Startup, Home & Unified Updates

- [ ] Open `https://weibo.com/`; the bottom-right **Weibo Toolkit** launcher button appears.
- [ ] Open Home; the **Update All** card, four module cards, and **Backup & Settings** section render without horizontal scrolling.
- [ ] Press `Escape` to close the panel; focus returns to the launcher button.
- [ ] Narrow the window to half width; no panel content is clipped.
- [ ] Start **Update All**; confirm Step 1 (Friend Radar) transitions cleanly into Step 2 (Follower Snapshot), single-module update buttons remain disabled mid-run, cancelling mid-Step 1 preserves both baselines, and cancelling mid-Step 2 preserves the saved Friend Radar snapshot.
- [ ] Close the progress panel mid-scan and reopen Home; the active card displays **View Progress**, and background completion enables **View Result**.

## 2. Friend Radar, Events & Overview

- [ ] Filter Relationship Events by type and unread-only status, search by nickname/UID/Friend Note, and test card/detail quick mark-as-read; verify search/filter/scroll state restores on return.
- [ ] Filter Follower Events by type and search by Friend Note, then export filtered Follower Events as CSV and Markdown.
- [ ] Search Relationship Overview by Friend Note content/tag and export the filtered following list as CSV and Markdown.

## 3. Friend Notes & Feed Bookmarks

- [ ] Open another user's `/u/<UID>` profile and save a note via **Friend Notes**.
- [ ] In the Friend Notes manager, use **Create / View by UID** to jump to a UID, verify invalid input errors, and export current filtered notes as CSV and Markdown.
- [ ] Start editing a note and click **Close** without saving; verify the unsaved-changes confirmation appears.
- [ ] Enable **Show Friend Notes on feed**; confirm compact icon-only bookmarks appear beside authors (solid when noted, dot badge for local historical nicknames) without layout jitter, and clicking opens a viewport-safe card in light/dark themes.

## 4. Browsing Experience & Stepmeter

- [ ] Toggle each switch under the **Cleanup** tab; the corresponding page element hides and restores immediately.
- [ ] Enable **Hide promoted feed posts** and scroll several screens; no layout jumps or blank gaps remain.
- [ ] Enable **Show profile mini-facts** and visit another user's profile; local facts and visit counts render as expected.

## 5. Follower Hygiene & Removal Log

- [ ] Filter by Friend Note status (`has note` / `no note`), Friend Note tag, minimum follower/post counts, and registration cutoff; verify sorting by follower/post counts descending keeps missing values last.
- [ ] Save a preset, reset filters, and re-apply the preset.
- [ ] Use **Select Page** and **Select in Order** across pages; confirm mutuals and noted accounts display skip notices and are excluded from bulk selection.
- [ ] Open **Removal Log**, check search and CSV export, then return to Hygiene; filters, page, and scroll position are restored.
- [ ] Click **Remove Selected Followers**; verify the confirmation list and exact count, then **Cancel (do not confirm)**.

## 6. Private Message Export

- [ ] Open a 1-on-1 conversation at `https://api.weibo.com/chat*`; the export controls render without overlapping native buttons and follow the active Toolkit theme.
- [ ] Export a short conversation; verify the downloaded `.md` filename includes the participant name/UID and matches the conversation history.

## 7. Backup & Restore (`Backup v4`)

- [ ] Click **Export Backup** to download a `v4` JSON file.
- [ ] Click **Restore Backup**, select the exported file, and verify preview counts across all seven domains match current state (including explicit `null` domain indicators), then **Back (do not confirm)**.
