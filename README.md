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

## 粉丝快照与粉丝变化

**更新粉丝快照** 会读取微博接口当前可见的粉丝结果，并在本地保存一份粉丝快照。快照记录的是**微博API当前可见的粉丝结果**，不一定等于完整的真实粉丝关系：微博接口可能过滤部分粉丝，界面中也会显示这一提示。

第一次成功更新只保存首次粉丝快照，不会生成历史变化。之后每次成功更新都会与上一次成功的快照比较，并记录两类中性事件：

- API可见粉丝新增；
- API可见粉丝消失。

“消失”只表示该账号不再出现在当前API可见结果中，Weibo Toolkit 无法仅凭此判断原因。工具不会把它解释为取关、拉黑或账号被删除。

**粉丝变化** 中可以逐条 **清除这条**，也可以 **清空变化事件**（需确认）。这只会清除本地保存的变化记录，不会修改微博关系或粉丝快照。

粉丝快照自动更新是独立设置，默认 **关闭**，可选每 24 小时、48 小时、72 小时、7 天或 15 天。它只在你打开或刷新微博网页版时检查一次，不会在浏览器后台常驻运行，也不会自动移除任何粉丝。如果可见粉丝数量超出自动更新的安全范围（约相当于 100 页、每页 20 条），本次自动更新会被跳过，已保存的粉丝快照保持不变，你仍可手动更新。

## 粉丝体检

**粉丝体检** 只在最近一次成功的粉丝快照上做本地筛选，本身不会再向微博发送任何请求。可用的筛选条件都是事实描述：

- 未关注 TA；
- API显示公开微博数为 0；
- 未认证；
- 粉丝数 ≤ / 关注数 ≤；
- 注册时间晚于；
- 关注来源：推荐、个人主页、搜索、其他来源、来源未知（可多选，属于其中任意一项即算命中）。

结果在本地分页显示，每页 50 条。选择只作用于当前页，翻页或改动筛选条件都会清空选择。工具**不提供**“移除全部筛选结果”或一键清理。卡片上始终显示微博接口返回的原始关注来源文本，来源分组只用于筛选和摘要。

Weibo Toolkit 只呈现事实，不给账号贴“僵尸粉”“机器人”之类的判断标签。

## 移除粉丝

粉丝体检结果中可以 **移除粉丝**（单个），也可以勾选后 **移除所选粉丝**（批量）。两者都会修改真实的微博关系，移除后这些账号将不再是你的粉丝，并且都需要显式确认。

批量移除的安全边界：

- 一次最多选择 50 个账号，且只能来自当前页；
- 请求逐个发送，不并发；
- 每次成功移除之后约等待 3 秒再进行下一个；
- 不自动重试；
- 一旦出现失败或结果无法确认，立即停止，剩余账号不再发送；
- 没有“移除全部筛选结果”，也没有任何自动清理。

Weibo Toolkit 不会自动撤销或重放移除操作。成功移除后，本地粉丝快照仍是操作前的数据，需要再次更新快照才会刷新。

## 私信 Markdown 导出

在微博网页版私信中手动打开一个普通一对一会话后，点击会话界面中的 **导出 Markdown**。Weibo Toolkit 会按顺序读取该会话当前接口可访问的历史消息，并在本地生成一个 `.md` 文件。

支持文件保存选择的浏览器会先弹出保存位置对话框，选定后才开始读取并导出；取消对话框则不会发起任何请求，也不会生成文件。不支持该能力的浏览器继续使用浏览器的普通下载流程，导出内容与文件名完全相同。

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

Weibo Toolkit can export the current account's validated local state as a JSON backup. On supported browsers export may show a native Save As dialog; otherwise the backup is handed to the browser's normal download system.

Backups created by v0.7.0 use backup version 2 and contain both durable modules: Friend Radar state, and the Follower Snapshot together with its follower-change events. 新格式备份会明确记录导出时是否存在粉丝快照，恢复时按备份中记录的状态恢复。

Existing version 1 backups remain restorable. A v1 file contains Friend Radar data only, so restoring it replaces Friend Radar state and **leaves the current Follower Snapshot and follower-change records untouched** — it never clears them. The restore preview states which data the selected file will replace.

Restore validates the whole file before writing anything, requires the backup owner UID to match the current authenticated account, and shows a preview before confirmation. A confirmed restore completely replaces the covered modules for that account; it does not merge data. Export the current data first if you may need it later.

Backups deliberately exclude environment-local and temporary information: automatic-update settings and their attempt/cooldown timestamps, the appearance preference, and the short-lived markers used to reconcile removals the Toolkit itself performed. 备份不包含登录凭据或请求认证信息。

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
- 多个微博标签页同时打开时，Weibo Toolkit 会协调本地状态的写入，尽量避免不同标签页互相覆盖数据；如果浏览器不提供可靠的协调能力，操作会安全失败而不是覆盖，本地数据保持不变。这不是数据库级别的事务保证。
- The Follower Snapshot records the API-visible follower result, which may be filtered by Weibo and is not necessarily the complete follower relationship.
- A follower disappearing from the API-visible result does not reveal why; Weibo Toolkit cannot tell unfollowing, blocking, and account removal apart.
- Follower removal modifies real Weibo relationships through Weibo's current web APIs, is never retried automatically, and is not undone or replayed by Weibo Toolkit.
- Automatic updates only run when the Weibo web page is opened or reloaded, never as a browser background service. A very large visible follower set exceeds the automatic Snapshot safety range and is skipped, leaving the last successful snapshot in place.
- Reload Weibo after switching accounts.
- Local data is browser-local. Use backup export and matching-account restore for migration or recovery.
- Friend Radar 单次扫描最多发起 100 次请求，达到该上限时不保存任何扫描结果。按每页 20 条估算约相当于 2,000 条可见记录，这是请求上限的估算，不是账号规模的精确限制。
- 粉丝快照单次更新最多读取 100 个非空数据页，并允许在其后额外发起 1 次终止验证请求（该请求只用于确认已到达列表末尾，不是又一页数据）。达到安全上限时本次结果不会保存，也不会用不完整的结果覆盖上一次成功的粉丝快照。
- 私信导出只代表导出当时当前会话接口实际返回的可访问历史，不是完整账号私信备份；不支持群聊、服务/公共文件夹或媒体文件下载。

## Status

v0.7.0 — current release. Adds Follower Snapshot with neutral follower-change records, local 粉丝体检 filtering, and explicit single/batch follower removal bounded at 50 selected accounts per batch. Backups move to version 2 and now cover Friend Radar plus the Follower Snapshot and its change records, while existing version 1 backups remain restorable and never clear follower data. Private-message Markdown export keeps its `WEIBO_PM_AI_3` format and gains a save-location step on browsers that support it. Friend Radar behavior and its storage schema are unchanged; no migration is involved.

v0.6.0 — added current-conversation private-message Markdown export with an AI-friendly compact A/B format, sequential long-history reading, progress, cancellation, and fail-closed pagination validation.
