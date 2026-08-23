# Weibo Toolkit

A local-first userscript toolkit for Weibo. It currently includes Friend Radar and current-conversation private-message Markdown export.

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

### Relationship overview and event exports

The lower-right launcher shows a small unread-event badge when stored events remain unread. **关系概览** separates the current visible-following state from historical event-occurrence counts, so current account counts are not confused with the number of past changes.

Stored relationship events can be exported as UTF-8 CSV or Markdown for spreadsheet analysis, archival, or AI-assisted analysis. These exports contain only events Weibo Toolkit actually observed and stored; JSON backup remains the recovery format.

Toolkit-owned UI provides **跟随系统 / 浅色 / 深色** appearance options. The default follows the browser/system `prefers-color-scheme` preference, while explicit light or dark mode affects only Weibo Toolkit and does not modify Weibo's own theme.

## 私信 Markdown 导出

在微博网页版私信中手动打开一个普通一对一会话后，点击会话界面中的 **导出 Markdown**。Weibo Toolkit 会按顺序读取该会话当前接口可访问的历史消息，并在本地生成一个 `.md` 文件。

导出格式 `WEIBO_PM_AI_3` 使用紧凑的 A/B 对话记录，减少重复结构，同时保留消息顺序、正文、源时间语义以及图片、链接和未支持消息标记，便于交给支持 Markdown 或长文本的 AI 分析。Weibo Toolkit 本身不调用 AI API。

导出范围仅限用户当前手动选择的普通一对一会话。它不支持群聊、服务/公共消息文件夹、自动遍历全部会话、媒体文件下载、私信恢复或后台同步。文件只包含导出时微博接口实际可访问并返回的消息；已删除、撤回、不可访问或接口未返回的内容可能缺失。

私信历史通过同源 GET 请求读取。Toolkit 不发送、删除或撤回消息，不主动修改未读状态，不建立私信数据库，也不上传导出内容。

导出文件是本地明文。文件省略 A/B 与真实账号的身份映射，也不将 UID 或昵称写入导出元数据，但消息正文保持原样，正文自身仍可能包含个人或身份信息。用户之后如将文件提交给第三方 AI 服务，其数据处理属于用户与该服务之间的独立隐私边界。

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

Friend Radar can export the current account's complete validated state as a local JSON backup. On supported browsers export may show a native Save As dialog; otherwise the backup is handed to the browser's normal download system.

Restore accepts a Friend Radar backup JSON file, validates it before writing, requires the backup owner UID to match the current authenticated account, and shows a preview before confirmation. A confirmed restore completely replaces the current account's local Friend Radar snapshot and event history; it does not merge data. Export the current data first if you may need it later.

Existing v0.2.0-v0.5.2 state remains compatible with normal in-place upgrades, so a backup is not required merely to upgrade.

### Optional automatic updates

Automatic update is optional and defaults to **关闭**. Available intervals are 24 hours, 48 hours, 72 hours, 7 days, and 15 days. Eligibility is checked once after web Weibo is opened or reloaded; Friend Radar does not poll continuously in the browser background. The first baseline must still be established manually, manual update remains available, and a failed automatic attempt does not enter a continuous retry loop.

## Known Limitations

- The API-visible following list may differ from Weibo's reported total.
- Follow-me changes are observed only for accounts in the API-visible following list; the complete followers/fans list is never crawled, so this is not complete "who unfollowed me" monitoring.
- The reason an account disappeared cannot be determined.
- Relationship timelines cover only events Weibo Toolkit observed and stored, not the complete real-world history.
- A relationship change during a multi-page scan can theoretically create a transient observation.
- Automatic scans use narrow owner-scoped mutual exclusion; if reliable locking is unavailable, automatic scanning skips rather than racing.
- Manual operations from multiple Weibo tabs are not fully serialized. Detected conflicting writes fail safely, but last-writer-wins races remain possible; use one tab for manual updates, restore, and event changes.
- Reload Weibo after switching accounts.
- Local data is browser-local. Use backup export and matching-account restore for migration or recovery.
- A single scan stops at a 100-request safety ceiling and saves no scan result when that ceiling is reached. At 20 records per page this is roughly 2,000 visible records in typical responses, not a guaranteed exact account limit.
- 私信导出只代表导出当时当前会话接口实际返回的可访问历史，不是完整账号私信备份；不支持群聊、服务/公共文件夹或媒体文件下载。

## Status

v0.6.0 — current release. Adds current-conversation private-message Markdown export with an AI-friendly compact A/B format, sequential long-history reading, progress, cancellation, and fail-closed pagination validation. Friend Radar storage schema and backup format remain unchanged; no migration is involved.
