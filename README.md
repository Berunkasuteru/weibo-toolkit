# Weibo Toolkit

A local-first userscript toolkit for Weibo. It currently includes Friend Radar, Follower Snapshot with follower-change tracking and local follower hygiene, and current-conversation private-message Markdown export.

The visible product brand is **Weibo Toolkit**. The current product UI is Chinese-focused and does not yet provide a full internationalized interface or language selector.

## Friend Radar

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

### Relationship overview and event exports

The lower-right launcher shows a small unread-event badge when stored events remain unread. **关系概览** separates the current visible-following state from historical event-occurrence counts, so current account counts are not confused with the number of past changes.

Stored relationship events can be exported as UTF-8 CSV or Markdown for spreadsheet analysis, archival, or AI-assisted analysis. These exports contain only events Weibo Toolkit actually observed and stored; JSON backup remains the recovery format.

Toolkit-owned UI provides **跟随系统 / 浅色 / 深色** appearance options. The default follows the browser/system `prefers-color-scheme` preference, while explicit light or dark mode affects only Weibo Toolkit and does not modify Weibo's own theme.

## Page Settings

**页面设置** contains optional, local preferences for Weibo's page UI. All five options default to **关闭**; a fresh install or normal upgrade leaves the page unchanged until you explicitly enable one.

Under **时间线**, **首页优先进入最新微博** may send the first eligible Home visit in each browser tab/session to Weibo's native, time-ordered **最新微博** route. It is a preference, not a permanent lock: after that one automatic entry you can switch to Weibo's native **全部关注** and remain there. Profile, Hot, Video, post-detail, private-message, and other non-Home routes are not forcibly redirected.

Under **页面净化**, you may independently enable **隐藏微博热搜**, **隐藏整个右侧栏**, **隐藏顶部推荐入口**, and **隐藏顶部视频入口**. Disabling an option restores normal page behavior immediately. **隐藏整个右侧栏** hides every sidebar module, including potentially useful content such as Creator Center and recommendations; it is not an advertisement-only filter.

Page Settings are stored only in userscript-local browser storage, add no telemetry or background API requests, and are excluded from Backup v2. They handle only explicitly identified page components and do not identify feed advertisements or filter post text.

## Follower Snapshot and follower changes

**更新粉丝快照** reads the follower result Weibo's API currently makes visible and stores it locally as a Follower Snapshot. A snapshot records **the API-visible follower result**, which is not necessarily the complete real follower relationship: Weibo's API may filter some followers, and the UI states this caveat.

The first successful update only stores the first snapshot and creates no historical changes. Every later successful update is compared against the previous successful snapshot and records two neutral event types:

- a follower appears in the API-visible result;
- a follower disappears from the API-visible result.

A disappearance only means the account is no longer present in the current API-visible result. Weibo Toolkit cannot determine the reason from that alone, and does not present it as unfollowing, blocking, or account deletion.

In **粉丝变化** you can clear a single record with **清除这条**, or clear them all with **清空变化事件** (confirmation required). This only removes the change records stored locally; it never modifies Weibo relationships or the stored snapshot.

Follower Snapshot automatic update is a separate setting, defaults to **关闭**, and offers 24 hours, 48 hours, 72 hours, 7 days, and 15 days. It is checked once when you open or reload web Weibo, does not run as a browser background service, and never removes followers. If the visible follower set exceeds the automatic-update safety range (roughly 100 pages at 20 records per page), that automatic run is skipped, the stored snapshot is left unchanged, and manual update remains available.

## Follower Hygiene

**粉丝体检** filters the latest successful Follower Snapshot locally and sends no further request to Weibo by itself. Every available condition is a factual description:

- the account is not followed by you;
- the API reports 0 public posts;
- the account is unverified;
- followers ≤ / following ≤ a chosen number;
- registered after a chosen date;
- follow source: Recommendation, Profile, Search, Other sources, or Unknown source (several may be selected; belonging to any one of them counts as a match).

Results are paginated locally at 50 per page. Selection applies to the current page only, and changing pages or filters clears it. There is **no** "remove all matched results" and no one-click cleanup. Cards always show the raw follow-source text returned by the API; the source groups exist only for filtering and for the filter summary.

Weibo Toolkit presents evidence, not judgement: it never labels accounts as bots, spam, or anything similar.

## Removing followers

From the Follower Hygiene results you can remove one account with **移除粉丝**, or select several and use **移除所选粉丝**. Both modify real Weibo relationships — the affected accounts stop being your followers — and both require explicit confirmation.

Batch removal stays inside these bounds:

- at most 50 selected accounts at a time, all from the current page;
- requests are sent one at a time, never concurrently;
- roughly 3 seconds pass after each validated successful removal before the next one;
- no automatic retry;
- a failure or an unconfirmable result stops the batch immediately, and the remaining accounts are never sent;
- there is no "remove all matched results" and no automatic cleanup.

Weibo Toolkit does not automatically undo or replay removals. After a successful removal the local snapshot still holds the pre-removal data; update the snapshot again to refresh it.

## Private-message Markdown export

Open an ordinary one-to-one conversation in Weibo's web private messages, then use **导出 Markdown** in that conversation. Weibo Toolkit reads the conversation history the API currently makes accessible, in order, and produces a local `.md` file.

Browsers that support choosing a save location show the save dialog first, and the export starts only after a destination is chosen; cancelling that dialog issues no request and creates no file. Browsers without that capability keep using the normal download flow, with identical content and filename.

The `WEIBO_PM_AI_3` format uses a compact A/B transcript that reduces repeated structure while preserving message order, message bodies, source time semantics, and markers for images, links, and unsupported messages, so the file can be handed to an AI that reads Markdown or long text. Weibo Toolkit itself never calls an AI API.

The export covers only the ordinary one-to-one conversation you manually selected. It does not support group chats, service/public message folders, automatically walking every conversation, media downloads, message recovery, or background sync. The file contains only the messages Weibo's API actually returned at export time; deleted, recalled, inaccessible, or unreturned content may be missing.

Conversation history is read with same-origin GET requests. The Toolkit does not send, delete, or recall messages, does not deliberately change read state, does not build a message database, and does not upload exports.

The exported file is local plain text. It omits any mapping between A/B and real accounts and writes no UID or nickname into the export metadata, but message bodies are kept as-is and may themselves contain personal or identifying information. If you later submit the file to a third-party AI service, that service's data handling is a separate privacy boundary between you and it.

## Installation

Install with [Tampermonkey](https://www.tampermonkey.net/) and Greasy Fork:

1. Install the Tampermonkey extension in your browser.
2. Install **Weibo Toolkit - Friend Radar** from its Greasy Fork page.
3. Open authenticated `https://weibo.com/`.
4. Reload the page.
5. Use the lower-right **Weibo Toolkit** launcher.
6. For PM export, open Weibo's web private-message page, select an ordinary one-to-one conversation, and use **导出 Markdown** in that conversation.

A single **Weibo Toolkit：打开工具箱** userscript menu command remains available as a fallback entry; individual functions are accessed from the Toolkit UI.

Tested with Tampermonkey on Chrome, Edge, Vivaldi, and Firefox. Violentmonkey is expected to be compatible but is not part of the current real-browser validation set.

For Edge and other Chromium browsers, if userscripts do not run after installing Tampermonkey, open the browser's extension settings and ensure userscript execution is allowed. Depending on the browser and extension version, enabling developer mode may also be required.

Install `.user.js` files through Tampermonkey, Violentmonkey, or Greasy Fork. Do not launch them by double-clicking in Windows Script Host.

### Manual source installation (developers / fallback)

If you are working from source or Greasy Fork is unavailable, install manually with Tampermonkey or Violentmonkey:

1. Create a new userscript.
2. Paste the complete contents of `weibo-toolkit.user.js`.
3. Save, then open authenticated `https://weibo.com/` and reload.

Manually installed copies do not receive automatic userscript-version updates.

## Upgrade

To upgrade, open the existing installed **Weibo Toolkit** userscript, replace its contents with the new `weibo-toolkit.user.js`, and save it in place. Do not delete the existing script first, and do not create a second installed copy as an upgrade procedure.

Normal in-place upgrades preserve Friend Radar GM storage. Deleting or uninstalling the userscript may remove its storage or make that storage unavailable. Export a backup before uninstalling/reinstalling the userscript or moving to another browser or device. Backup Restore is the supported migration/recovery path and requires signing in to the backup's matching Weibo account. Do not assume separately created userscript copies automatically share GM storage.

## Data and Privacy

Data stays in userscript-local browser storage. There is no project server, telemetry, or continuous background service. Updates are manual unless the user explicitly enables the page-open automatic-update option. Clearing browser or userscript storage deletes the local baseline and event history.

### Backup export and restore

Weibo Toolkit can export the current account's validated local state as a JSON backup. On supported browsers export may show a native Save As dialog; otherwise the backup is handed to the browser's normal download system.

Backups created by v0.7.0 use backup version 2 and contain both durable modules: Friend Radar state, and the Follower Snapshot together with its follower-change events. A version 2 file explicitly records whether a Follower Snapshot existed when it was exported, and restore reproduces exactly what the file records.

Existing version 1 backups remain restorable. A v1 file contains Friend Radar data only, so restoring it replaces Friend Radar state and **leaves the current Follower Snapshot and follower-change records untouched** — it never clears them. The restore preview states which data the selected file will replace.

Restore validates the whole file before writing anything, requires the backup owner UID to match the current authenticated account, and shows a preview before confirmation. A confirmed restore completely replaces the covered modules for that account; it does not merge data. Export the current data first if you may need it later.

Backups deliberately exclude environment-local and temporary information: automatic-update settings and their attempt/cooldown timestamps, appearance and Page Settings preferences, and the short-lived markers used to reconcile removals the Toolkit itself performed. Backups never contain login credentials or request authentication data.

Existing v0.2.0-v0.6.0 state remains compatible with normal in-place upgrades, so a backup is not required merely to upgrade.

### Optional automatic updates

Automatic update is optional and defaults to **关闭**. Available intervals are 24 hours, 48 hours, 72 hours, 7 days, and 15 days. Friend Radar and Follower Snapshot have separate settings. Eligibility is checked once after web Weibo is opened or reloaded; Weibo Toolkit does not poll continuously in the browser background. The first snapshot must still be established manually for Friend Radar, manual update remains available for both, a failed automatic attempt does not enter a continuous retry loop, and automatic updates never remove followers.

## Known Limitations

- The API-visible following list may differ from Weibo's reported total.
- Follow-me changes are observed only for accounts in the API-visible following list; the complete followers/fans list is never crawled, so this is not complete "who unfollowed me" monitoring.
- The reason an account disappeared cannot be determined.
- Relationship timelines cover only events Weibo Toolkit observed and stored, not the complete real-world history.
- A relationship change during a multi-page scan can theoretically create a transient observation.
- Automatic scans use narrow owner-scoped mutual exclusion; if reliable locking is unavailable, automatic scanning skips rather than racing.
- With several Weibo tabs open, Weibo Toolkit coordinates local state writes so tabs do not overwrite each other's data. If the browser offers no reliable coordination, an operation fails safely instead of overwriting, and local data is left unchanged. This is not a database-grade transactional guarantee.
- The Follower Snapshot records the API-visible follower result, which may be filtered by Weibo and is not necessarily the complete follower relationship.
- A follower disappearing from the API-visible result does not reveal why; Weibo Toolkit cannot tell unfollowing, blocking, and account removal apart.
- Follower removal modifies real Weibo relationships through Weibo's current web APIs, is never retried automatically, and is not undone or replayed by Weibo Toolkit.
- Automatic updates only run when the Weibo web page is opened or reloaded, never as a browser background service. A very large visible follower set exceeds the automatic Snapshot safety range and is skipped, leaving the last successful snapshot in place.
- Reload Weibo after switching accounts.
- Local data is browser-local. Use backup export and matching-account restore for migration or recovery.
- A single Friend Radar scan makes at most 100 requests and saves no scan result once that ceiling is reached. At 20 records per page this is roughly 2,000 visible records — an estimate derived from the request ceiling, not an exact account-size limit.
- A single Follower Snapshot update reads at most 100 non-empty data pages and may make one additional terminal-verification request after them (that request only confirms the end of the list; it is not another page of data). When the safety ceiling is reached the result is not saved, and an incomplete result never replaces the previous successful snapshot.
- A private-message export represents only the accessible history the conversation API actually returned at export time, not a complete account message backup; group chats, service/public folders, and media downloads are not supported.

## Status

v0.8.0 — current release. Adds local, default-off Page Settings: one per-tab preference for entering Weibo's native Latest Feed on the first eligible Home visit, plus reversible controls for hiding Hot Search, the whole right sidebar, and the top Recommendation or Video entries. These settings do not enter Backup v2 and do not add advertisement or post-content filtering.

v0.7.1 — maintenance release for Follower Snapshot automatic updates, automatic-result visibility, and Follower Hygiene filtering/layout.

v0.7.0 — added Follower Snapshot with neutral follower-change records, local Follower Hygiene filtering, and explicit single/batch follower removal bounded at 50 selected accounts per batch. Backups moved to version 2 and cover Friend Radar plus the Follower Snapshot and its change records, while existing version 1 backups remain restorable and never clear follower data. Private-message Markdown export kept its `WEIBO_PM_AI_3` format and gained a save-location step on browsers that support it. Friend Radar behavior and its storage schema were unchanged; no migration was involved.

v0.6.0 — added current-conversation private-message Markdown export with an AI-friendly compact A/B format, sequential long-history reading, progress, cancellation, and fail-closed pagination validation.
