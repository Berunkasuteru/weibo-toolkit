# Pre-Release Live Page Checklist

Automated tests and synthetic DOM fixtures do not replace live Weibo pages. Before publishing a release, walk through this checklist (~10 minutes) in a logged-in desktop browser. No real follower-removal request needs to be sent (stop at the confirmation dialog in Section 5).

## 1. Startup & Home

- [ ] Open `https://weibo.com/`; the bottom-right **Weibo Toolkit** launcher button appears.
- [ ] Open the Home panel; all four module cards and **备份与设置** render without horizontal scrolling.
- [ ] Press `Escape` to close the panel; focus returns to the launcher button.
- [ ] Narrow the window to half width; no panel content is clipped.

## 2. Friend Radar & Follower Snapshot

- [ ] Click **立即更新**; progress counters update and the animation runs.
- [ ] Close the panel while scanning and reopen Home; the button shows **查看进度** and reopens the progress view.
- [ ] Click **立即更新** or **更新粉丝快照**, then click **取消** mid-scan; the scan aborts cleanly within a few seconds without modifying the stored snapshot.
- [ ] Open **查看事件**; each account is grouped into a single card, and returns from detail/timeline/note views restore your search and scroll position.

## 3. Friend Notes

- [ ] Open another user's `/u/<UID>` profile and save a note via **友人档案**.
- [ ] Start editing a note and click **关闭** without saving; the unsaved-changes confirmation appears.
- [ ] Enable **在主页显示友人档案**; the note panel renders cleanly on the profile page.
- [ ] Enable **在信息流显示友人档案**; bookmarks appear beside authors on the home and latest feeds (solid when noted, hollow otherwise, with a dot indicator when previous local nicknames exist).
- [ ] Click a feed bookmark; the floating card stays within the viewport and remains legible in dark mode.

## 4. Browsing Experience

- [ ] Toggle each switch under the **净化** tab; the corresponding page element hides and restores immediately.
- [ ] Enable **隐藏信息流中的推广内容** and scroll several screens; no layout jumps or blank gaps remain.
- [ ] Enable **显示主页小档案** and visit another user's profile; local facts and visit counts render as expected.

## 5. Follower Hygiene

- [ ] Set filter criteria, save a preset, reset filters via **重置筛选**, and re-apply the preset.
- [ ] Click **选择当前页**, navigate to another page and back; selections persist.
- [ ] Click **按顺序选满**; the status line reports how many selected accounts are off-page.
- [ ] Mutual followings and accounts with Friend Notes display the skip notice and are skipped by bulk selection.
- [ ] Change **排序**; the list reorders and clears prior selections.
- [ ] Open **移除记录**, verify search and empty/populated states, then return to Hygiene; filters, page, and scroll position are restored.
- [ ] Click **移除所选粉丝**; the confirmation lists all selected accounts with the exact count on the confirm button. **Click 取消 (do not confirm).**

## 6. Private Message Export

- [ ] Open a 1-on-1 conversation at `https://api.weibo.com/chat*`; the **导出 Markdown** control renders at the top without overlapping native buttons and respects the active Toolkit theme.
- [ ] Export a short conversation; the generated `.md` file matches the conversation history.

## 7. Backup & Restore

- [ ] Click **导出备份** to download a JSON backup file.
- [ ] Click **恢复备份**, choose the exported file, and verify the preview counts match current state. **Click ← 返回 (do not confirm).**
