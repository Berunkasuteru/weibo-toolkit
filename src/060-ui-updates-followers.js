
  // Each Toolkit root (the launcher and the open overlay) carries the theme marker
  // itself, so no Weibo-owned node is ever touched.
  function applyThemeToRoot(node) {
    if (!node) return;
    const classNames = String(node.className)
      .split(/\s+/)
      .filter((name) => name.length > 0 && !name.startsWith("wfr-theme-"));
    classNames.push(`wfr-theme-${currentTheme}`);
    node.className = classNames.join(" ");
  }

  function applyTheme() {
    applyThemeToRoot(launcherButton);
    applyThemeToRoot(usageCornerButton);
    applyThemeToRoot(panelRoot);
    applyThemeToRoot(document.getElementById(PROFILE_EXTRAS_ID));
    applyThemeToRoot(
      profileFriendNotesContext === null ? null : profileFriendNotesContext.root
    );
    applyFeedFriendNotesTheme();
  }

  function closePanel() {
    // Every way of removing the panel ends here, so this is where a locked
    // panel is held: buttons, Escape, the script menu and late callbacks alike.
    if (panelExitLocked) return;
    const dismissHandler = panelDismissHandler;
    const returnFocus = panelReturnFocus;
    panelDismissHandler = null;
    panelReturnFocus = null;
    if (panelRoot && panelRoot.parentNode) panelRoot.parentNode.removeChild(panelRoot);
    panelRoot = null;
    panelSizeFixed = false;
    panelHeaderButtons = [];
    panelExitLocked = false;
    // Scans, restores and event clearing all run from the panel, so the local
    // facts cached for the feed entries are re-read once it is really closed.
    markFeedFriendNotesStale();
    if (typeof dismissHandler === "function") dismissHandler();
    if (
      returnFocus &&
      typeof returnFocus.focus === "function" &&
      returnFocus.isConnected !== false
    ) {
      returnFocus.focus();
    }
  }

  // Holds the panel in place for the length of a short local transaction whose
  // outcome the user must see, such as a restore. closePanel and showPanel
  // enforce it; disabling the header buttons only makes the state visible.
  function setPanelExitLocked(locked) {
    panelExitLocked = locked;
    for (const button of panelHeaderButtons) button.disabled = locked;
  }

  function isTextEntryElement(node) {
    if (!node || typeof node.tagName !== "string") return false;
    const tag = node.tagName.toUpperCase();
    if (tag === "TEXTAREA" || node.isContentEditable === true) return true;
    return (
      tag === "INPUT" &&
      !["checkbox", "radio", "button", "submit", "file"].includes(node.type)
    );
  }

  function panelHoldsUnsavedNote() {
    return (
      friendNoteDetailView !== null &&
      panelRoot !== null &&
      panelRoot.contains(friendNoteDetailView.editor.root) &&
      friendNoteDetailView.editor.hasUnsavedChanges()
    );
  }

  // Closing or leaving a note that has unsaved edits asks first. Escape never
  // gets this far: it does nothing at all over an unsaved note.
  function confirmLeavingUnsavedNote() {
    if (!panelHoldsUnsavedNote()) return true;
    // A save or delete that is already under way cannot be abandoned: saying
    // "discard" and then storing it anyway would be a lie. Leaving waits.
    if (friendNoteDetailView.editor.isBusy()) {
      if (typeof alert === "function") alert("正在保存，请等待完成后再离开。");
      return false;
    }
    return (
      typeof confirm !== "function" ||
      confirm("这份友人档案还有未保存的修改。确定放弃这些修改吗？")
    );
  }

  // Escape is left alone wherever it could cost the user something: while an
  // input method is composing, inside a text field (where it cancels a
  // candidate or clears a search), over an unsaved note, and during a removal
  // batch, whose only stop control lives in this panel.
  function handlePanelKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
      return;
    }
    if (event.key === "Escape") {
      if (
        panelExitLocked ||
        followerRemovalInFlight ||
        isTextEntryElement(event.target) ||
        panelHoldsUnsavedNote()
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }
    if (event.key !== "Tab" || panelRoot === null) return;
    const focusable = [
      ...panelRoot.querySelectorAll(
        'button, a[href], input, select, textarea, summary, [tabindex="0"]'
      ),
    ].filter((node) => !node.disabled && node.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !focusable.includes(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // Pages reached by navigating inside the Toolkit share one panel size, so the
  // panel does not jump between them. A panel opened on its own (a notice, a
  // failure with nothing behind it) keeps the size of its content.
  function showPanel(title, withBack = false, fixedSize = Boolean(withBack)) {
    // A locked panel is not replaced. The caller still gets a body to fill, but
    // one that is never attached, so no entry point needs its own check.
    if (panelExitLocked) return createElement("div", null, "wfr-body");
    const keepSize = fixedSize || panelSizeFixed;
    // Focus goes back to whatever opened the first panel of this visit, not to
    // a node of a panel that this one replaces.
    const replacing = panelRoot !== null;
    const opener = replacing ? panelReturnFocus : document.activeElement;
    panelReturnFocus = null;
    closePanel();
    const root = createElement("div", null, "wfr-overlay wfr-root");
    applyThemeToRoot(root);
    root.addEventListener("keydown", handlePanelKeydown);
    const panel = createElement(
      "section",
      null,
      keepSize ? "wfr-panel wfr-panel-fixed" : "wfr-panel"
    );
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "wfr-panel-title");
    panel.setAttribute("tabindex", "-1");
    const header = createElement("header", null, "wfr-header");
    const heading = createElement("h2", title);
    heading.id = "wfr-panel-title";
    const closeButton = createElement("button", "关闭", "wfr-button");
    closeButton.type = "button";
    closeButton.addEventListener("click", () => {
      if (confirmLeavingUnsavedNote()) closePanel();
    });
    const body = createElement("div", null, "wfr-body");
    if (withBack) {
      const backButton = createElement("button", "← 返回", "wfr-button");
      backButton.type = "button";
      const goBack = typeof withBack === "function" ? withBack : showToolkitHome;
      backButton.addEventListener("click", () => {
        if (confirmLeavingUnsavedNote()) goBack();
      });
      header.append(backButton, heading, closeButton);
      panelHeaderButtons = [backButton, closeButton];
    } else {
      header.append(heading, closeButton);
      panelHeaderButtons = [closeButton];
    }
    panel.append(header, body);
    root.append(panel);
    document.body.append(root);
    panelRoot = root;
    panelSizeFixed = keepSize;
    panelReturnFocus = opener || null;
    panel.focus();
    return body;
  }

  // Consecutive lines share one group, so a run of facts reads as one list.
  function addLine(body, label, value) {
    const last = body.childNodes[body.childNodes.length - 1];
    let group =
      last && last.classList && last.classList.contains("wfr-kv-group")
        ? last
        : null;
    if (group === null) {
      group = createElement("div", null, "wfr-kv-group");
      body.append(group);
    }
    const row = createElement("p", null, "wfr-row wfr-kv");
    const strong = createElement("strong", label);
    const span = createElement("span", String(value), "wfr-value");
    row.append(strong, span);
    group.append(row);
    return span;
  }

  function formatUsageMinutes(seconds) {
    return Math.max(0, Math.round(seconds / 60));
  }

  function usageCornerText(state) {
    return `今日 ${formatUsageMinutes(
      state.currentDay.activeSeconds
    )} 分钟 · ${state.currentDay.uniquePostIds.length} 条`;
  }

  function removeUsageCorner() {
    if (usageCornerButton && usageCornerButton.parentNode) {
      usageCornerButton.parentNode.removeChild(usageCornerButton);
    }
    usageCornerButton = null;
  }

  function syncUsageCorner() {
    if (
      !usageEnabledPreference ||
      !usageCornerPreference ||
      usageRuntimeOwnerUid === null ||
      usageState === null ||
      !document.body
    ) {
      removeUsageCorner();
      return;
    }
    if (!usageCornerButton) {
      usageCornerButton = createElement(
        "button",
        null,
        "wfr-usage-corner wfr-root"
      );
      usageCornerButton.id = USAGE_CORNER_ID;
      usageCornerButton.type = "button";
      usageCornerButton.setAttribute("aria-label", "打开微博计步器");
      usageCornerButton.addEventListener("click", () => showUsageStatistics());
      applyThemeToRoot(usageCornerButton);
      document.body.append(usageCornerButton);
    }
    usageCornerButton.textContent = usageCornerText(usageState);
  }

  function usageStateForDisplay(ownerUid) {
    if (usageRuntimeOwnerUid === ownerUid && usageState !== null) {
      return { ok: true, state: usageState };
    }
    return loadUsageState(ownerUid);
  }

  async function clearUsageStatisticsForOwner(ownerUid) {
    const result = await withUsageStateLock(ownerUid, async () => {
      try {
        GM_deleteValue(usageStorageKey(ownerUid));
        return GM_getValue(usageStorageKey(ownerUid), null) === null
          ? { ok: true }
          : { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      } catch (error) {
        return {
          ok: false,
          failureKind: "PERSISTENCE_ERROR",
          errorName: error && error.name ? String(error.name) : "Error",
        };
      }
    });
    if (!result.ok) return result;
    if (usageRuntimeOwnerUid === ownerUid) {
      usageState = emptyUsageState(usageLocalDateKey());
      usagePendingActiveSeconds = 0;
      usagePendingPostIds = new Set();
    }
    if (usageSessionOwnerUid === ownerUid) {
      usageSessionActiveSeconds = 0;
      usageSessionPostIds = new Set();
    }
    syncUsageCorner();
    return { ok: true };
  }

  function appendUsageClearAction(body, ownerUid) {
    const actions = createElement("div", null, "wfr-actions");
    const clearButton = createElement(
      "button",
      "清空使用统计",
      "wfr-button wfr-danger"
    );
    clearButton.type = "button";
    clearButton.addEventListener("click", async () => {
      const confirmed = confirm(
        "清空当前账号在本浏览器中的使用统计？\n此操作不会影响微博数据。"
      );
      if (!confirmed) return;
      const currentOwner = determineCurrentUid();
      if (!currentOwner.ok || currentOwner.uid !== ownerUid) {
        showFailure("微博计步器", {
          failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
        });
        return;
      }
      const cleared = await clearUsageStatisticsForOwner(ownerUid);
      if (!cleared.ok) {
        showFailure("微博计步器", cleared);
        return;
      }
      showUsageStatistics("使用统计已清空。追踪偏好保持不变。");
    });
    actions.append(clearButton);
    body.append(actions);
  }

  function showUsageStatistics(statusText = null) {
    const owner = determineCurrentUid();
    if (!owner.ok) {
      showFailure("微博计步器", owner);
      return;
    }
    const loaded = usageStateForDisplay(owner.uid);
    if (!loaded.ok) {
      const body = showPanel("微博计步器", true);
      body.append(
        createElement(
          "p",
          "本地使用统计无法读取。请先检查或清空该账号的使用统计。",
          "wfr-error"
        )
      );
      appendUsageClearAction(body, owner.uid);
      return;
    }
    const body = showPanel("微博计步器", true);
    if (statusText) body.append(createElement("p", statusText, "wfr-success"));
    body.append(createElement("h3", "今日"));
    addLine(
      body,
      "活跃时间",
      `约 ${formatUsageMinutes(loaded.state.currentDay.activeSeconds)} 分钟`
    );
    addLine(
      body,
      "浏览微博",
      `${loaded.state.currentDay.uniquePostIds.length} 条不同微博`
    );
    body.append(createElement("h3", "本标签页"));
    addLine(
      body,
      "活跃时间",
      `约 ${formatUsageMinutes(
        usageSessionOwnerUid === owner.uid ? usageSessionActiveSeconds : 0
      )} 分钟`
    );
    addLine(
      body,
      "浏览微博",
      `${
        usageSessionOwnerUid === owner.uid ? usageSessionPostIds.size : 0
      } 条不同微博`
    );
    body.append(
      createElement(
        "p",
        "仅保存在当前浏览器，不记录微博正文或具体浏览历史。",
        "wfr-muted"
      )
    );
    appendUsageClearAction(body, owner.uid);
  }

  // A restore can fail after one or both durable writes were already attempted,
  // so it must never reuse the generic "failed before saving" note. Every reason
  // below states what is actually known about local state, and nothing is
  // appended that would contradict the reason line above it.
  const RESTORE_PRE_WRITE_REASONS = Object.freeze([
    "MALFORMED_JSON",
    "INVALID_TOP_LEVEL",
    "WRONG_BACKUP_FORMAT",
    "MISSING_FOLLOWER_STATE",
    "INVALID_FOLLOWER_STATE",
    "MISSING_FRIEND_NOTES",
    "INVALID_FRIEND_NOTES",
    "FRIEND_NOTES_CHANGED_SINCE_PREVIEW",
    "UNSUPPORTED_BACKUP_VERSION",
    "INVALID_OWNER_UID",
    "OWNER_UID_MISMATCH",
    "INVALID_EXPORTED_AT",
    "INVALID_STATE",
    "FILE_READ_ERROR",
  ]);

  const RESTORE_STATE_MESSAGES = Object.freeze({
    FOLLOWER_RESTORE_FAILED_ROLLED_BACK:
      "粉丝快照确认未被修改，关系雷达数据已还原为恢复前的内容。",
    RESTORE_CONCURRENT_STATE_CHANGED:
      "其他标签页写入的较新数据已被保留，未被本次恢复覆盖。",
    RESTORE_STATE_UNCERTAIN:
      "本地数据可能已被部分修改，且最终状态无法确认。请先导出当前数据并检查，再决定是否重试。",
    FRIEND_NOTES_RESTORE_FAILED_ROLLED_BACK:
      "友人档案确认未被修改，关系雷达数据、粉丝快照和粉丝变化记录已还原为恢复前的内容。",
    FRIEND_NOTES_RESTORE_FAILED_PARTIAL:
      "友人档案确认未被修改。其他标签页在恢复过程中写入的较新数据已被保留，因此已恢复的部分没有全部回退：当前本地数据处于部分恢复状态。请先导出并检查当前数据，再决定是否重试。",
  });

  const RESTORE_UNSETTLED_REASONS = Object.freeze([
    "RESTORE_STATE_UNCERTAIN",
    "FRIEND_NOTES_RESTORE_FAILED_PARTIAL",
  ]);

  function restoreStateMessage(reason) {
    if (RESTORE_PRE_WRITE_REASONS.includes(reason)) {
      return {
        text: "本次失败发生在写入之前，关系雷达数据、粉丝快照、粉丝变化记录和友人档案均未被更改。",
        className: "wfr-muted",
      };
    }
    const known = RESTORE_STATE_MESSAGES[reason];
    if (known) {
      return {
        text: known,
        className: RESTORE_UNSETTLED_REASONS.includes(reason)
          ? "wfr-error"
          : "wfr-muted",
      };
    }
    return {
      text: RESTORE_STATE_MESSAGES.RESTORE_STATE_UNCERTAIN,
      className: "wfr-error",
    };
  }

  function failureText(result) {
    if (result.failureKind === "BACKUP_RESTORE_ERROR") {
      const restoreMessages = {
        MALFORMED_JSON: "备份文件不是有效的 JSON。",
        INVALID_TOP_LEVEL: "备份文件结构无效。",
        WRONG_BACKUP_FORMAT: "备份格式不匹配。",
        MISSING_FOLLOWER_STATE: "备份缺少粉丝快照部分，未恢复。",
        INVALID_FOLLOWER_STATE: "备份中的粉丝快照或粉丝变化记录无效，未恢复。",
        MISSING_FRIEND_NOTES: "备份缺少友人档案部分，未恢复。",
        INVALID_FRIEND_NOTES: "备份中的友人档案无效，未恢复。",
        FRIEND_NOTES_CHANGED_SINCE_PREVIEW:
          "友人档案在预览之后已被修改，本次恢复没有写入任何数据。请重新选择备份文件并核对预览。",
        FRIEND_NOTES_RESTORE_FAILED_ROLLED_BACK:
          "友人档案未能恢复，本次恢复已取消，关系雷达与粉丝数据已回退到恢复前的状态。",
        FRIEND_NOTES_RESTORE_FAILED_PARTIAL:
          "恢复未能完整完成：友人档案未恢复，其他数据也未能全部回退。",
        FOLLOWER_RESTORE_FAILED_ROLLED_BACK:
          "粉丝快照未能恢复，本次恢复已取消，关系雷达数据已回退到恢复前的状态。",
        // Reached both when a rollback could not be confirmed and when a
        // follower mutation may already have landed, so the wording must not
        // assume a rollback was attempted.
        RESTORE_STATE_UNCERTAIN:
          "恢复未能完成，且最终状态无法确认。",
        RESTORE_CONCURRENT_STATE_CHANGED:
          "恢复未能完整完成；关系雷达数据在恢复过程中已被其他操作更新，因此没有回退这些较新的数据。请先导出并检查当前数据后再重试。",
        UNSUPPORTED_BACKUP_VERSION: "此备份版本不受支持。",
        INVALID_OWNER_UID: "备份账号 UID 无效。",
        OWNER_UID_MISMATCH: "备份不属于当前登录账号，未恢复。",
        INVALID_EXPORTED_AT: "备份导出时间无效。",
        INVALID_STATE: "备份中的关系雷达数据无效或不完整。",
        FILE_READ_ERROR: "无法读取所选备份文件。",
      };
      return restoreMessages[result.reason] || FAILURE_LABELS.BACKUP_RESTORE_ERROR;
    }
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "HARD_REQUEST_CEILING_REACHED"
    ) {
      return "本次扫描达到本工具设定的单次请求上限，未保存扫描结果。";
    }
    if (
      result.failureKind === "NETWORK_ERROR" &&
      result.reason === "REQUEST_TIMEOUT"
    ) {
      return "请求超时：微博接口在限定时间内没有响应。";
    }
    return FAILURE_LABELS[result.failureKind] || FAILURE_LABELS.UNKNOWN_FAILURE;
  }

  // The internal reason is kept for bug reports, on its own line below the
  // sentence that explains the failure. Restore reasons and timeouts already
  // have wording of their own.
  function appendFailureCode(body, result) {
    if (
      typeof result.reason !== "string" ||
      result.failureKind === "BACKUP_RESTORE_ERROR" ||
      result.reason === "REQUEST_TIMEOUT"
    ) {
      return;
    }
    body.append(
      createElement("p", `错误代码 ${result.reason}`, "wfr-muted wfr-failure-code")
    );
  }

  function showFailure(title, result, withBack = true) {
    const body = showPanel(title, withBack);
    body.append(createElement("p", failureText(result), "wfr-error"));
    appendFailureCode(body, result);
    if (result.failureKind === "BACKUP_EXPORT_ERROR") {
      body.append(
        createElement(
          "p",
          "备份未能完成。关系雷达本地数据未被修改。",
          "wfr-muted"
        )
      );
      addLine(body, "失败阶段", result.backupStage);
      addLine(body, "错误类型", result.errorName);
      if (["CREATE_WRITABLE", "WRITE_FILE", "CLOSE_FILE"].includes(result.backupStage)) {
        body.append(
          createElement(
            "p",
            "目标位置可能存在未完成的备份文件。",
            "wfr-muted"
          )
        );
      }
      return;
    }
    if (result.failureKind === "EVENT_EXPORT_ERROR") {
      body.append(
        createElement(
          "p",
          "导出未能完成。关系雷达本地数据未被修改。",
          "wfr-muted"
        )
      );
      addLine(body, "失败阶段", result.exportStage);
      addLine(body, "错误类型", result.errorName);
      return;
    }
    if (result.failureKind === "BACKUP_RESTORE_ERROR") {
      const restoreState = restoreStateMessage(result.reason);
      body.append(
        createElement("p", restoreState.text, restoreState.className)
      );
      return;
    }
    if (result.failureKind === "CONCURRENT_MODIFICATION") return;
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "HARD_REQUEST_CEILING_REACHED"
    ) {
      addLine(body, "已请求", result.requestsMade);
      addLine(body, "已读取", result.visibleRecordsCollected);
      if (typeof result.reportedTotal === "number") {
        addLine(body, "接口报告总数", result.reportedTotal);
      }
    }
    if (typeof result.failedPage === "number") {
      addLine(body, "停止页", result.failedPage);
    }
    if (
      typeof result.requestsMade === "number" &&
      !(
        result.failureKind === "PAGINATION_FAILURE" &&
        result.reason === "HARD_REQUEST_CEILING_REACHED"
      )
    ) {
      addLine(body, "已发请求", result.requestsMade);
    }
    let stateMessage;
    let stateMessageClass = "wfr-muted";
    if (result.failureKind === "UNKNOWN_FAILURE") {
      stateMessage =
        "更新结果无法完全确认。重试前请先查看“关系雷达状态”。";
      stateMessageClass = "wfr-error";
    } else if (result.failureKind === "PERSISTENCE_ERROR") {
      if (result.rollbackSucceeded === true) {
        stateMessage =
          "保存失败，但上一次本地状态已恢复。";
      } else {
        stateMessage =
          "保存和恢复均未能确认成功。本地状态可能不确定或损坏，在检查或重新保存首次快照前请勿信任。";
        stateMessageClass = "wfr-error";
      }
    } else {
      stateMessage =
        "本次失败发生在保存之前，本地快照和事件记录未被更改。";
    }
    body.append(
      createElement(
        "p",
        stateMessage,
        stateMessageClass
      )
    );
  }

  function countEventTypes(events) {
    const counts = {};
    for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
    return counts;
  }

  function showUpdateSuccess(result) {
    const body = showPanel("关系雷达更新", true);
    const message = result.baselineCreated
      ? "首次关注快照已保存，从下次更新开始记录变化。"
      : `更新完成，发现 ${result.newEvents.length} 个新事件。`;
    body.append(createElement("p", message, "wfr-success"));
    addLine(body, "API可见关注", result.snapshot.visibleCount);
    addLine(body, "接口总数", result.snapshot.reportedTotal);
    addLine(
      body,
      "未解析关系差值",
      result.snapshot.unresolvedRelationCount
    );
    addLine(body, "请求数", result.requestsMade);
    addLine(body, "新事件", result.newEvents.length);

    const counts = countEventTypes(result.newEvents);
    for (const type of Object.values(EVENT)) {
      addLine(body, EVENT_LABELS[type], counts[type] || 0);
    }
  }

  const PROGRESS_FIELDS = Object.freeze([
    ["page", "当前页"],
    ["requestsMade", "已请求"],
    ["visibleRecordsCollected", "已读取"],
    ["reportedTotal", "接口报告总数"],
  ]);

  function showScanProgress() {
    const body = showPanel("关系雷达更新");
    body.append(
      createElement("p", "正在读取可见关注，请保持页面打开。"),
      createElement("div", null, "wfr-progress")
    );
    const values = new Map();
    const rows = createElement("div", null, "wfr-kv-group");
    body.append(rows);
    for (const [key, label] of PROGRESS_FIELDS) {
      const row = createElement("p", null, "wfr-row wfr-kv");
      const value = createElement("span", "—", "wfr-value");
      row.append(createElement("strong", label), value);
      values.set(key, value);
      rows.append(row);
    }
    return function reportProgress(progress) {
      for (const [key] of PROGRESS_FIELDS) {
        const value = values.get(key);
        const reported = progress[key];
        value.textContent =
          typeof reported === "number" ? String(reported) : "—";
      }
    };
  }

  function showRadarUpdateResult(result) {
    if (result.ok) showUpdateSuccess(result);
    else showFailure("关系雷达更新失败", result);
  }

  // Opens (or reopens) the progress panel of the manual scan that is running
  // and replays the latest numbers into it.
  function attachRadarProgress(run) {
    run.render = showScanProgress();
    run.root = panelRoot;
    if (run.latest !== null) run.render(run.latest);
  }

  // The stored outcome of a manual scan belongs to the account it ran for. It
  // is handed out once, and only to that account. The caller's idea of the
  // account may be as old as the Home it was drawn on, so the logged-in
  // account is read again here; on any mismatch nothing is shown or consumed.
  function unseenResultBelongsToCurrentAccount(unseen, ownerUid) {
    if (unseen === null || unseen.ownerUid !== ownerUid) return false;
    const current = determineCurrentUid();
    return current.ok && current.uid === unseen.ownerUid;
  }

  function takeUnseenRadarResult(ownerUid) {
    const unseen = unseenManualRadarResult;
    if (!unseenResultBelongsToCurrentAccount(unseen, ownerUid)) return null;
    unseenManualRadarResult = null;
    return unseen.result;
  }

  function takeUnseenFollowerResult(ownerUid) {
    const unseen = unseenManualFollowerResult;
    if (!unseenResultBelongsToCurrentAccount(unseen, ownerUid)) return null;
    unseenManualFollowerResult = null;
    return unseen.result;
  }

  async function updateNow() {
    const startOwner = determineCurrentUid();
    if (manualRadarRun !== null) {
      // Only the account that started the scan may look into it.
      if (startOwner.ok && startOwner.uid === manualRadarRun.ownerUid) {
        attachRadarProgress(manualRadarRun);
      } else {
        showFailure("关系雷达更新", { failureKind: "UPDATE_ALREADY_RUNNING" });
      }
      return;
    }
    if (updateRunning || followerUpdateRunning || followerRemovalInFlight) {
      showFailure("关系雷达更新", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const run = {
      ownerUid: startOwner.ok ? startOwner.uid : null,
      latest: null,
      render: null,
      root: null,
    };
    manualRadarRun = run;
    unseenManualRadarResult = null;
    attachRadarProgress(run);
    updateRunning = true;
    let result;
    try {
      result = await performUpdate((progress) => {
        run.latest = progress;
        run.render(progress);
      });
    } catch (error) {
      result = {
        ok: false,
        failureKind: "UNKNOWN_FAILURE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    } finally {
      updateRunning = false;
      manualRadarRun = null;
    }
    refreshUnreadBadge();
    // The user may have closed the progress panel and opened something else,
    // possibly with typed input in it. That panel is theirs: the outcome is
    // announced on the launcher and kept for Home to show.
    if (panelRoot !== run.root) {
      unseenManualRadarResult = { ownerUid: run.ownerUid, result };
      setLauncherStatus(
        result.ok ? "关系雷达更新完成" : "关系雷达更新失败",
        AUTO_STATUS_DURATION_MS
      );
      return;
    }
    showRadarUpdateResult(result);
  }

  function followerFailureText(result) {
    if (result.failureKind === "FOLLOWER_SCAN_CANCELLED") {
      return "读取已取消。";
    }
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "FOLLOWER_SAFETY_CEILING_REACHED"
    ) {
      return "达到本次安全上限，未更新粉丝快照。";
    }
    const labels = {
      UID_UNAVAILABLE: "无法可靠识别当前登录账号。",
      ACCOUNT_CHANGED_DURING_SCAN: "扫描期间登录账号发生变化。",
      LOGIN_REQUIRED: "登录已失效，请重新登录。",
      HTTP_ERROR: "接口返回 HTTP 错误。",
      CHALLENGE_OR_UNEXPECTED_RESPONSE: "收到验证页面或意外 HTML。",
      NON_JSON_RESPONSE: "接口未返回有效 JSON。",
      UNEXPECTED_CONTENT_TYPE: "接口响应类型异常。",
      UNEXPECTED_SCHEMA: "粉丝接口数据结构异常。",
      PAGINATION_FAILURE: "粉丝分页结果不可信。",
      NETWORK_ERROR: "网络请求失败。",
      STORAGE_ERROR: "粉丝快照本地状态无法读取。",
      PERSISTENCE_ERROR: "粉丝快照保存失败。",
      CONCURRENT_MODIFICATION: "检测到另一个标签页修改了粉丝快照状态。",
      STALE_SCAN: "扫描结果早于当前已保存粉丝快照。",
      UPDATE_ALREADY_RUNNING: "另一个关系扫描正在进行。",
      STATE_LOCK_UNAVAILABLE:
        "暂时无法安全地保存粉丝快照，本次结果未保存，已保留上一次成功的快照。",
      UNKNOWN_FAILURE: "更新结果无法完全确认。",
    };
    if (
      result.failureKind === "NETWORK_ERROR" &&
      result.reason === "REQUEST_TIMEOUT"
    ) {
      return "请求超时：微博接口在限定时间内没有响应。";
    }
    return labels[result.failureKind] || labels.UNKNOWN_FAILURE;
  }

  function showFollowerFailure(result) {
    const cancelled = result.failureKind === "FOLLOWER_SCAN_CANCELLED";
    const body = showPanel(
      cancelled ? "粉丝快照已取消" : "粉丝快照更新失败",
      true
    );
    body.append(
      createElement(
        "p",
        followerFailureText(result),
        cancelled ? "wfr-muted" : "wfr-error"
      )
    );
    appendFailureCode(body, result);
    if (typeof result.failedPage === "number") {
      addLine(body, "停止页", result.failedPage);
    }
    if (typeof result.requestsMade === "number") {
      addLine(body, "已发请求", result.requestsMade);
    }
    if (
      !cancelled &&
      !["PERSISTENCE_ERROR", "CONCURRENT_MODIFICATION", "UNKNOWN_FAILURE"].includes(
        result.failureKind
      )
    ) {
      body.append(
        createElement(
          "p",
          "读取未完成，已保留上一次成功快照，未生成粉丝变化事件。",
          "wfr-muted"
        )
      );
    }
    if (result.failureKind === "CONCURRENT_MODIFICATION") {
      body.append(
        createElement(
          "p",
          "未覆盖另一个标签页保存的粉丝快照状态。",
          "wfr-muted"
        )
      );
    }
    if (result.failureKind === "UNKNOWN_FAILURE") {
      body.append(
        createElement(
          "p",
          "更新结果无法完全确认，重试前请先查看粉丝变化状态。",
          "wfr-error"
        )
      );
    }
    if (
      result.failureKind === "PERSISTENCE_ERROR" &&
      result.rollbackSucceeded !== true
    ) {
      body.append(
        createElement(
          "p",
          "本地保存结果无法确认，请在重试前查看粉丝变化状态。",
          "wfr-error"
        )
      );
    }
  }

  function appendFollowerVisibilityNote(body, snapshot) {
    if (!snapshot || !snapshot.filteredVisibilityObserved) return;
    body.append(
      createElement(
        "p",
        "微博接口可能过滤了部分粉丝。",
        "wfr-muted"
      )
    );
  }

  function showFollowerUpdateSuccess(result) {
    const body = showPanel("粉丝快照更新", true);
    if (result.baselineCreated) {
      body.append(
        createElement(
          "p",
          "首次粉丝快照已保存，从下次更新开始记录变化。",
          "wfr-success"
        )
      );
    } else if (result.eventsSuppressed) {
      body.append(
        createElement(
          "p",
          "粉丝快照已更新；因接口过滤状态变化或未知，本次未生成变化事件。",
          "wfr-muted"
        )
      );
    } else {
      const counts = countEventTypes(result.newEvents);
      body.append(createElement("p", "粉丝快照更新完成。", "wfr-success"));
      addLine(
        body,
        "新增可见粉丝",
        counts[FOLLOWER_EVENT.VISIBLE_FOLLOWER_ADDED] || 0
      );
      addLine(
        body,
        "从可见粉丝中消失",
        counts[FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED] || 0
      );
    }
    addLine(body, "API可见粉丝", result.snapshot.uniqueRecordCount);
    addLine(body, "读取记录", result.snapshot.rawRecordCount);
    addLine(body, "跨页重复", result.snapshot.crossPageDuplicateCount);
    addLine(body, "请求数", result.requestsMade);
    appendFollowerVisibilityNote(body, result.snapshot);
  }

  const FOLLOWER_PROGRESS_FIELDS = Object.freeze([
    ["page", "当前页"],
    ["requestsMade", "已请求"],
    ["rawRecordCount", "已读取"],
    ["uniqueRecordCount", "去重后"],
    ["crossPageDuplicateCount", "跨页重复"],
  ]);

  function showFollowerScanProgress(onCancel) {
    const body = showPanel("粉丝快照更新");
    body.append(
      createElement("p", "正在读取API可见粉丝，请保持页面打开。"),
      createElement("div", null, "wfr-progress")
    );
    const values = new Map();
    const rows = createElement("div", null, "wfr-kv-group");
    body.append(rows);
    for (const [key, label] of FOLLOWER_PROGRESS_FIELDS) {
      const row = createElement("p", null, "wfr-row wfr-kv");
      const value = createElement("span", "—", "wfr-value");
      row.append(createElement("strong", label), value);
      values.set(key, value);
      rows.append(row);
    }
    const cancelButton = createElement("button", "取消", "wfr-button");
    cancelButton.type = "button";
    // A reopened panel shows a cancellation that was already requested.
    if (followerCancelRequested) {
      cancelButton.disabled = true;
      cancelButton.textContent = "正在取消…";
    }
    cancelButton.addEventListener("click", () => {
      followerCancelRequested = true;
      cancelButton.disabled = true;
      cancelButton.textContent = "正在取消…";
      onCancel();
    });
    const actions = createElement("div", null, "wfr-actions");
    actions.append(cancelButton);
    body.append(actions);
    return function reportProgress(progress) {
      for (const [key] of FOLLOWER_PROGRESS_FIELDS) {
        const reported = progress[key];
        values.get(key).textContent =
          typeof reported === "number" ? String(reported) : "—";
      }
    };
  }

  function showFollowerUpdateResult(result) {
    if (result.ok) showFollowerUpdateSuccess(result);
    else showFollowerFailure(result);
  }

  function attachFollowerProgress(run) {
    run.render = showFollowerScanProgress(run.cancel);
    run.root = panelRoot;
    if (run.latest !== null) run.render(run.latest);
  }

  async function updateFollowersNow() {
    const startOwner = determineCurrentUid();
    if (manualFollowerRun !== null) {
      if (startOwner.ok && startOwner.uid === manualFollowerRun.ownerUid) {
        attachFollowerProgress(manualFollowerRun);
      } else {
        showFollowerFailure({ failureKind: "UPDATE_ALREADY_RUNNING" });
      }
      return;
    }
    if (followerUpdateRunning || updateRunning || followerRemovalInFlight) {
      showFollowerFailure({ failureKind: "UPDATE_ALREADY_RUNNING" });
      return;
    }
    followerCancelRequested = false;
    // Cancelling also ends the request in flight instead of waiting for it.
    const cancelController = new AbortController();
    const run = {
      ownerUid: startOwner.ok ? startOwner.uid : null,
      latest: null,
      render: null,
      root: null,
      cancel: () => cancelController.abort(),
    };
    manualFollowerRun = run;
    unseenManualFollowerResult = null;
    attachFollowerProgress(run);
    followerUpdateRunning = true;
    let result;
    try {
      result = await performFollowerUpdate(
        (progress) => {
          run.latest = progress;
          run.render(progress);
        },
        () => followerCancelRequested,
        { cancelSignal: cancelController.signal }
      );
    } catch (error) {
      result = {
        ok: false,
        failureKind: "UNKNOWN_FAILURE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    } finally {
      followerUpdateRunning = false;
      followerCancelRequested = false;
      manualFollowerRun = null;
    }
    if (panelRoot !== run.root) {
      // A cancellation the user asked for needs no later reminder.
      if (result.failureKind !== "FOLLOWER_SCAN_CANCELLED") {
        unseenManualFollowerResult = { ownerUid: run.ownerUid, result };
      }
      setLauncherStatus(
        result.ok
          ? "粉丝快照更新完成"
          : result.failureKind === "FOLLOWER_SCAN_CANCELLED"
            ? "粉丝快照已取消"
            : "粉丝快照更新失败",
        AUTO_STATUS_DURATION_MS
      );
      return;
    }
    showFollowerUpdateResult(result);
  }

  // Local notification housekeeping only, run inside the follower state lock. The
  // state is read fresh here, so a Snapshot or new events written by another tab
  // are preserved: latestSnapshot and every other baseline field are carried over
  // and only the requested events are dropped.
  async function writeFollowerEventsOnly(ownerUid, nextEvents) {
    return await withFollowerStateLock(ownerUid, async () => {
      const fresh = loadFollowerState(ownerUid);
      if (!fresh.ok) return fresh;
      const next = {
        schemaVersion: fresh.state.schemaVersion,
        ownerUid: fresh.state.ownerUid,
        latestSnapshot: fresh.state.latestSnapshot,
        events: nextEvents(fresh.state.events),
      };
      const persisted = persistFollowerState(ownerUid, next, fresh.raw);
      if (!persisted.ok) return persisted;
      return { ok: true, state: next };
    });
  }

  async function clearFollowerEvent(ownerUid, eventId) {
    return await writeFollowerEventsOnly(ownerUid, (events) =>
      events.filter((event) => event.id !== eventId)
    );
  }

  // Clears exactly the events the user confirmed, identified by the stored event
  // id. Anything that appeared after the confirmation was rendered — including
  // events another tab produced meanwhile — is kept, because the user never saw
  // it and never agreed to discard it.
  async function clearFollowerEvents(ownerUid, eventIds) {
    const targeted = new Set(eventIds);
    return await writeFollowerEventsOnly(ownerUid, (events) =>
      events.filter((event) => !targeted.has(event.id))
    );
  }

  function sortFollowerEventsNewestFirst(events) {
    return [...events].sort(
      (left, right) =>
        right.observedAt.localeCompare(left.observedAt) ||
        right.id.localeCompare(left.id)
    );
  }

  function renderFollowerEvents(ownerUid, state) {
    const body = showPanel("粉丝变化", true);
    const snapshot = state.latestSnapshot;
    addLine(body, "已有快照", snapshot ? "是" : "否");
    if (snapshot) {
      addLine(body, "上次成功更新", formatTime(snapshot.capturedAt));
      addLine(body, "API可见粉丝", snapshot.uniqueRecordCount);
    }
    const countValue = addLine(body, "变化事件", state.events.length);
    appendFollowerVisibilityNote(body, snapshot);

    let events = state.events;
    const clearAllActions = createElement("div", null, "wfr-actions");
    const clearAllButton = createElement(
      "button",
      "清空变化事件",
      "wfr-button"
    );
    clearAllButton.type = "button";
    clearAllActions.append(clearAllButton);
    const clearAllPanel = createElement("div", null, "wfr-batch-panel");
    const status = createElement("p", "", "wfr-muted");
    const emptyNote = createElement("p", "暂无粉丝变化事件。", "wfr-muted wfr-empty");
    const list = createElement("div", null, "wfr-event-list");
    body.append(clearAllActions, clearAllPanel, status, emptyNote, list);

    function clearNode(node) {
      while (node.childNodes.length > 0) node.removeChild(node.childNodes[0]);
    }

    const renderedCards = new Map();

    // Reconciles the rendered cards with the freshly persisted event list. Cards
    // that survived keep their nodes; events another tab added since this view
    // opened appear instead of being silently dropped from the count.
    function syncList() {
      const desired = sortFollowerEventsNewestFirst(events);
      const desiredIds = new Set(desired.map((event) => event.id));
      for (const [id, node] of [...renderedCards]) {
        if (desiredIds.has(id)) continue;
        if (node.parentNode) node.parentNode.removeChild(node);
        renderedCards.delete(id);
      }
      for (const event of desired) {
        if (renderedCards.has(event.id)) continue;
        const card = buildEventCard(event);
        renderedCards.set(event.id, card);
        list.append(card);
      }
      renderCounts();
    }

    function renderCounts() {
      countValue.textContent = String(events.length);
      const empty = events.length === 0;
      emptyNote.hidden = !empty;
      list.hidden = empty;
      clearAllActions.hidden = empty;
      if (empty) clearNode(clearAllPanel);
    }

    // Local records only: clearing a notification never touches the Weibo
    // relationship, the stored Snapshot, or reconciliation state.
    function applyLocalWrite(result, failureText) {
      if (!result.ok) {
        status.textContent =
          result.failureKind === "STATE_LOCK_UNAVAILABLE"
            ? "变化事件暂时无法安全保存，请稍后重试。"
            : failureText;
        return false;
      }
      events = result.state.events;
      status.textContent = "";
      return true;
    }

    function buildEventCard(event) {
      const item = createElement("article", null, "wfr-event");
      item.append(
        createElement(
          "h3",
          FOLLOWER_EVENT_LABELS[event.type] || event.type
        )
      );
      addLine(item, "时间", formatTime(event.observedAt));
      addLine(item, "账号", event.displayName || event.uid);
      addLine(item, "UID", event.uid);
      if (event.type === FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED) {
        item.append(
          createElement(
            "p",
            "无法判断消失的原因。",
            "wfr-muted"
          )
        );
      }
      const actions = createElement("div", null, "wfr-actions");
      const clearButton = createElement("button", "清除这条", "wfr-button");
      clearButton.type = "button";
      clearButton.addEventListener("click", async () => {
        clearButton.disabled = true;
        const result = await clearFollowerEvent(ownerUid, event.id);
        clearButton.disabled = false;
        if (!applyLocalWrite(result, "未能清除这条记录，本地数据未改变。")) {
          return;
        }
        // Targeted reconciliation: surviving cards keep their nodes and the
        // reading position stays where it is.
        syncList();
      });
      actions.append(clearButton);
      item.append(actions);
      return item;
    }

    clearAllButton.addEventListener("click", () => {
      clearNode(clearAllPanel);
      const confirmation = createElement("div", null, "wfr-removal-confirm");
      confirmation.append(
        createElement(
          "h3",
          "清空全部 " + String(events.length) + " 条粉丝变化事件？"
        ),
        createElement(
          "p",
          "这只会清除 Weibo Toolkit 保存在本地的变化记录，不会修改微博关系或粉丝快照。",
          "wfr-muted"
        )
      );
      const confirmActions = createElement("div", null, "wfr-actions");
      const cancel = createElement("button", "取消", "wfr-button");
      const confirm = createElement("button", "确认清空", "wfr-button");
      cancel.type = "button";
      confirm.type = "button";
      cancel.addEventListener("click", () => clearNode(clearAllPanel));
      // The identities the user is actually confirming, captured while the
      // confirmation is shown. Only these are cleared.
      const confirmedIds = events.map((event) => event.id);
      confirm.addEventListener("click", async () => {
        cancel.disabled = true;
        confirm.disabled = true;
        const result = await clearFollowerEvents(ownerUid, confirmedIds);
        clearNode(clearAllPanel);
        if (!applyLocalWrite(result, "未能清空变化记录，本地数据未改变。")) {
          return;
        }
        syncList();
      });
      confirmActions.append(cancel, confirm);
      confirmation.append(confirmActions);
      clearAllPanel.append(confirmation);
    });

    syncList();
  }

  function viewFollowerEvents() {
    const owner = determineCurrentUid();
    if (!owner.ok) {
      showFollowerFailure(owner);
      return;
    }
    const loaded = loadFollowerState(owner.uid);
    if (!loaded.ok) {
      showFollowerFailure(loaded);
      return;
    }
    renderFollowerEvents(owner.uid, loaded.state);
  }
