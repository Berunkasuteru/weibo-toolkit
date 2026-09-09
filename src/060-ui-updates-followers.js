
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
  }

  function closePanel() {
    const dismissHandler = panelDismissHandler;
    panelDismissHandler = null;
    if (panelRoot && panelRoot.parentNode) panelRoot.parentNode.removeChild(panelRoot);
    panelRoot = null;
    if (typeof dismissHandler === "function") dismissHandler();
  }

  function showPanel(title, withBack = false) {
    closePanel();
    const root = createElement("div", null, "wfr-overlay wfr-root");
    applyThemeToRoot(root);
    const panel = createElement("section", null, "wfr-panel");
    const header = createElement("header", null, "wfr-header");
    const heading = createElement("h2", title);
    const closeButton = createElement("button", "关闭", "wfr-button");
    closeButton.type = "button";
    closeButton.addEventListener("click", closePanel);
    const body = createElement("div", null, "wfr-body");
    if (withBack) {
      const backButton = createElement("button", "← 返回", "wfr-button");
      backButton.type = "button";
      backButton.addEventListener(
        "click",
        typeof withBack === "function" ? withBack : showToolkitHome
      );
      header.append(backButton, heading, closeButton);
    } else {
      header.append(heading, closeButton);
    }
    panel.append(header, body);
    root.append(panel);
    document.body.append(root);
    panelRoot = root;
    return body;
  }

  function addLine(body, label, value) {
    const row = createElement("p", null, "wfr-row");
    const strong = createElement("strong", `${label}: `);
    const span = createElement("span", String(value));
    row.append(strong, span);
    body.append(row);
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
      usageCornerButton.addEventListener("click", showUsageStatistics);
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

  function failureText(result) {
    if (result.failureKind === "BACKUP_RESTORE_ERROR") {
      const restoreMessages = {
        MALFORMED_JSON: "备份文件不是有效的 JSON。",
        INVALID_TOP_LEVEL: "备份文件结构无效。",
        WRONG_BACKUP_FORMAT: "备份格式不匹配。",
        MISSING_FOLLOWER_STATE: "备份缺少粉丝快照部分，未恢复。",
        INVALID_FOLLOWER_STATE: "备份中的粉丝快照或粉丝变化记录无效，未恢复。",
        FOLLOWER_RESTORE_FAILED_ROLLED_BACK:
          "粉丝快照未能恢复，本次恢复已取消，关系雷达数据已回退到恢复前的状态。",
        RESTORE_STATE_UNCERTAIN:
          "恢复未能完成，且回退未能确认成功。本地数据可能处于不确定状态，请先导出并检查后再继续。",
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
    const label = FAILURE_LABELS[result.failureKind] || FAILURE_LABELS.UNKNOWN_FAILURE;
    return result.reason ? `${label} (${result.reason})` : label;
  }

  function showFailure(title, result, withBack = true) {
    const body = showPanel(title, withBack);
    body.append(createElement("p", failureText(result), "wfr-error"));
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
      createElement("p", "正在读取可见关注，请保持页面打开。")
    );
    const values = new Map();
    for (const [key, label] of PROGRESS_FIELDS) {
      const row = createElement("p", null, "wfr-row");
      const value = createElement("span", "—");
      row.append(createElement("strong", `${label}：`), value);
      values.set(key, value);
      body.append(row);
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

  async function updateNow() {
    if (updateRunning || followerUpdateRunning || followerRemovalInFlight) {
      showFailure("关系雷达更新", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const reportProgress = showScanProgress();
    updateRunning = true;
    let result;
    try {
      result = await performUpdate(reportProgress);
    } catch (error) {
      result = {
        ok: false,
        failureKind: "UNKNOWN_FAILURE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    } finally {
      updateRunning = false;
    }
    refreshUnreadBadge();
    if (result.ok) showUpdateSuccess(result);
    else showFailure("关系雷达更新失败", result);
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
    const label = labels[result.failureKind] || labels.UNKNOWN_FAILURE;
    return result.reason ? label + " (" + result.reason + ")" : label;
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
        "微博接口可能过滤部分粉丝；此处仅显示当前API可见结果。",
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

  function showFollowerScanProgress() {
    const body = showPanel("粉丝快照更新");
    body.append(
      createElement("p", "正在读取API可见粉丝，请保持页面打开。")
    );
    const values = new Map();
    for (const [key, label] of FOLLOWER_PROGRESS_FIELDS) {
      const row = createElement("p", null, "wfr-row");
      const value = createElement("span", "—");
      row.append(createElement("strong", label + "："), value);
      values.set(key, value);
      body.append(row);
    }
    const cancelButton = createElement("button", "取消", "wfr-button");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => {
      followerCancelRequested = true;
      cancelButton.disabled = true;
      cancelButton.textContent = "正在取消…";
    });
    body.append(cancelButton);
    return function reportProgress(progress) {
      for (const [key] of FOLLOWER_PROGRESS_FIELDS) {
        const reported = progress[key];
        values.get(key).textContent =
          typeof reported === "number" ? String(reported) : "—";
      }
    };
  }

  async function updateFollowersNow() {
    if (followerUpdateRunning || updateRunning || followerRemovalInFlight) {
      showFollowerFailure({ failureKind: "UPDATE_ALREADY_RUNNING" });
      return;
    }
    followerCancelRequested = false;
    const reportProgress = showFollowerScanProgress();
    followerUpdateRunning = true;
    let result;
    try {
      result = await performFollowerUpdate(
        reportProgress,
        () => followerCancelRequested
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
    }
    if (result.ok) showFollowerUpdateSuccess(result);
    else showFollowerFailure(result);
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
      appendFollowerVisibilityNote(body, snapshot);
    }
    const countRow = createElement("p", null, "wfr-row");
    const countValue = createElement("span", String(state.events.length));
    countRow.append(createElement("strong", "变化事件: "), countValue);
    body.append(countRow);

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
    const emptyNote = createElement("p", "暂无粉丝变化事件。", "wfr-muted");
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
            "仅表示该账号从API可见粉丝结果中消失，无法判断原因。",
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
