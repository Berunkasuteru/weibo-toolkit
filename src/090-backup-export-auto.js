
  function exportTimestamp(exportedAt) {
    return exportedAt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .replace(/\.\d{3}Z$/, "");
  }

  function backupFilename(ownerUid, exportedAt) {
    return `weibo-toolkit-friend-radar-${ownerUid}-${exportTimestamp(
      exportedAt
    )}.json`;
  }

  function eventExportFilename(ownerUid, exportedAt, extension) {
    return `weibo-toolkit-friend-radar-events-${ownerUid}-${exportTimestamp(
      exportedAt
    )}.${extension}`;
  }

  // followerState is always present in v2: an object reproduces the durable
  // follower state, and an explicit null records that none existed at backup
  // time. A missing field can only come from v1, where the format simply had no
  // concept of follower state.
  function createBackup(ownerUid, state, followerState, exportedAt) {
    if (state.ownerUid !== ownerUid) {
      throw new Error("Backup owner UID mismatch");
    }
    if (followerState !== null && followerState.ownerUid !== ownerUid) {
      throw new Error("Backup follower owner UID mismatch");
    }
    return {
      backupFormat: BACKUP_FORMAT,
      backupVersion: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      appVersion: APP_VERSION,
      ownerUid,
      state,
      followerState,
    };
  }

  function serializeBackup(backup) {
    return `${JSON.stringify(backup, null, 2)}\n`;
  }

  // CSV and Markdown are human/analysis exports of observed event history.
  // The JSON backup above remains the only recovery format.
  const UTF8_BOM = String.fromCharCode(0xfeff);
  const EVENT_EXPORT_COLUMNS = Object.freeze([
    "检测时间",
    "事件类型",
    "事件说明",
    "UID",
    "记录昵称",
    "变化前",
    "变化后",
    "状态",
  ]);

  const EXPORT_SCOPE_NOTES = Object.freeze([
    "本文件仅包含 Weibo Toolkit 实际观察并保存的关系事件，不是微博上的完整真实关系历史。",
    "关系雷达只读取接口可见的关注列表，不会抓取完整粉丝列表，因此“开始关注你 / 停止关注你”只覆盖它能观察到的账号。",
    "“从你的可见关注列表消失”只表示该账号不再出现在可见关注列表中，本工具无法判断原因。",
  ]);

  function eventExportRow(event) {
    const transition = eventTransition(event);
    return [
      event.detectedAt,
      event.type,
      EVENT_LABELS[event.type] || event.type,
      event.subjectUid,
      event.displayName,
      transition ? transition.previous : "",
      transition ? transition.current : "",
      event.read ? "已读" : "未读",
    ];
  }

  // A stored nickname beginning with =, +, - or @ would be evaluated as a formula
  // by Excel/WPS, so exported cells starting that way are kept as literal text.
  function neutralizeSpreadsheetFormula(text) {
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  }

  function csvField(value) {
    return `"${neutralizeSpreadsheetFormula(String(value)).replace(/"/g, '""')}"`;
  }

  function buildEventCsv(events) {
    const rows = [
      EVENT_EXPORT_COLUMNS,
      ...sortEventsNewestFirst(events).map(eventExportRow),
    ];
    // The BOM stops Excel/WPS from guessing a legacy codepage; CRLF follows RFC 4180.
    const body = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
    return `${UTF8_BOM}${body}\r\n`;
  }

  function markdownCell(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  }

  function buildEventMarkdown(ownerUid, events, exportedAt) {
    const ordered = sortEventsNewestFirst(events);
    const lines = [
      "# Weibo Toolkit 关系事件导出",
      "",
      `- 账号 UID：${ownerUid}`,
      `- 导出时间：${exportedAt.toISOString()}`,
      `- 已存事件数：${ordered.length}`,
      `- Weibo Toolkit 版本：${APP_VERSION}`,
      "",
      EXPORT_SCOPE_NOTES.map((note) => `> ${note}`).join("\n>\n"),
      "",
      "## 已观察事件（按检测时间从新到旧）",
      "",
    ];
    if (ordered.length === 0) {
      lines.push("暂无已存事件。", "");
      return lines.join("\n");
    }
    lines.push(
      `| ${EVENT_EXPORT_COLUMNS.join(" | ")} |`,
      `| ${EVENT_EXPORT_COLUMNS.map(() => "---").join(" | ")} |`
    );
    for (const event of ordered) {
      lines.push(`| ${eventExportRow(event).map(markdownCell).join(" | ")} |`);
    }
    lines.push("");
    return lines.join("\n");
  }

  const EVENT_EXPORT_FORMATS = Object.freeze({
    csv: {
      label: "CSV",
      extension: "csv",
      mimeType: "text/csv;charset=utf-8",
      build: (ownerUid, events) => buildEventCsv(events),
    },
    markdown: {
      label: "Markdown",
      extension: "md",
      mimeType: "text/markdown;charset=utf-8",
      build: buildEventMarkdown,
    },
  });

  function loadAutoInterval(ownerUid) {
    try {
      const value = GM_getValue(`${AUTO_INTERVAL_PREFIX}${ownerUid}`, 0);
      if (!AUTO_INTERVAL_HOURS.includes(value)) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "AUTO_INTERVAL_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveAutoInterval(ownerUid, value) {
    const key = `${AUTO_INTERVAL_PREFIX}${ownerUid}`;
    try {
      GM_setValue(key, value);
      if (GM_getValue(key, null) !== value) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
        rollbackSucceeded: false,
      };
    }
  }

  function loadLastAutomaticAttempt(ownerUid) {
    try {
      const value = GM_getValue(`${AUTO_ATTEMPT_PREFIX}${ownerUid}`, null);
      if (value === null || typeof value === "undefined") {
        return { ok: true, value: null };
      }
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "AUTO_ATTEMPT_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveLastAutomaticAttempt(ownerUid, attemptedAt) {
    const key = `${AUTO_ATTEMPT_PREFIX}${ownerUid}`;
    try {
      GM_setValue(key, attemptedAt);
      if (GM_getValue(key, null) !== attemptedAt) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
        rollbackSucceeded: false,
      };
    }
  }

  const AUTOMATIC_OUTCOME_VALUES = Object.freeze([
    "SUCCESS",
    "FAILURE",
    "SKIPPED",
  ]);
  const AUTOMATIC_SKIP_FAILURE_KINDS = Object.freeze([
    "STALE_SCAN",
  ]);
  const AUTOMATIC_OUTCOME_REASON_LABELS = Object.freeze({
    STALE_SCAN: "已有更新的快照",
    NETWORK_ERROR: "网络请求失败",
    HTTP_ERROR: "接口请求失败",
    LOGIN_REQUIRED: "登录状态失效",
    CHALLENGE_OR_UNEXPECTED_RESPONSE: "遇到验证页面或异常响应",
    NON_JSON_RESPONSE: "接口响应异常",
    UNEXPECTED_CONTENT_TYPE: "接口响应类型异常",
    UNEXPECTED_SCHEMA: "接口数据校验失败",
    PAGINATION_FAILURE: "分页完整性校验失败",
    MAX_REQUESTS_REACHED: "达到请求安全上限",
    FOLLOWER_REQUEST_CEILING_REACHED: "达到请求安全上限",
    ACCOUNT_CHANGED_DURING_SCAN: "扫描期间账号发生变化",
    STORAGE_ERROR: "本地数据读取失败",
    PERSISTENCE_ERROR: "本地保存失败",
    CONCURRENT_MODIFICATION: "检测到并发修改",
    LOCK_UNAVAILABLE: "浏览器锁不可用",
    LOCK_REQUEST_FAILED: "浏览器锁请求失败",
    UNKNOWN_FAILURE: "未能确认原因",
  });

  function sanitizedAutomaticOutcomeCode(value) {
    return typeof value === "string" &&
      value.length <= 64 &&
      /^[A-Z0-9_]+$/.test(value)
      ? value
      : null;
  }

  function automaticOutcomeFromResult(attemptedAt, result) {
    const failureKind = sanitizedAutomaticOutcomeCode(result.failureKind);
    const reason = sanitizedAutomaticOutcomeCode(result.reason);
    return {
      attemptedAt,
      outcome: result.ok
        ? "SUCCESS"
        : AUTOMATIC_SKIP_FAILURE_KINDS.includes(failureKind)
          ? "SKIPPED"
          : "FAILURE",
      ...(failureKind === null ? {} : { failureKind }),
      ...(reason === null ? {} : { reason }),
    };
  }

  function loadAutomaticOutcome(prefix, ownerUid) {
    try {
      const value = GM_getValue(prefix + ownerUid, null);
      if (value === null || typeof value === "undefined") {
        return { ok: true, value: null };
      }
      if (
        !isPlainObject(value) ||
        typeof value.attemptedAt !== "string" ||
        !Number.isFinite(Date.parse(value.attemptedAt)) ||
        !AUTOMATIC_OUTCOME_VALUES.includes(value.outcome) ||
        (hasOwn(value, "failureKind") &&
          sanitizedAutomaticOutcomeCode(value.failureKind) === null) ||
        (hasOwn(value, "reason") &&
          sanitizedAutomaticOutcomeCode(value.reason) === null)
      ) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "AUTO_OUTCOME_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveAutomaticOutcome(prefix, ownerUid, attemptedAt, result) {
    const key = prefix + ownerUid;
    const value = automaticOutcomeFromResult(attemptedAt, result);
    try {
      GM_setValue(key, value);
      if (JSON.stringify(GM_getValue(key, null)) !== JSON.stringify(value)) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
        rollbackSucceeded: false,
      };
    }
  }

  function describeAutomaticOutcome(value) {
    if (value === null) return "—";
    if (value.outcome === "SUCCESS") return "成功";
    const code = value.failureKind || value.reason || null;
    const detail =
      AUTOMATIC_OUTCOME_REASON_LABELS[code] || "原因未能确认";
    return value.outcome === "SKIPPED"
      ? "已跳过（" + detail + "）"
      : "失败（" + detail + "）";
  }

  function evaluateAutomaticUpdateEligibility(ownerUid, nowMilliseconds) {
    const interval = loadAutoInterval(ownerUid);
    if (!interval.ok) return interval;
    if (interval.value === 0) {
      return { ok: true, eligible: false, reason: "DISABLED" };
    }

    const loaded = loadState(ownerUid);
    if (!loaded.ok) return loaded;
    if (loaded.state.latestSnapshot === null) {
      return { ok: true, eligible: false, reason: "NO_SUCCESSFUL_BASELINE" };
    }
    const successfulAt = Date.parse(loaded.state.latestSnapshot.capturedAt);
    const thresholdMilliseconds = interval.value * 60 * 60 * 1000;
    if (nowMilliseconds - successfulAt < thresholdMilliseconds) {
      return { ok: true, eligible: false, reason: "THRESHOLD_NOT_REACHED" };
    }

    const lastAttempt = loadLastAutomaticAttempt(ownerUid);
    if (!lastAttempt.ok) return lastAttempt;
    if (
      lastAttempt.value !== null &&
      nowMilliseconds - Date.parse(lastAttempt.value) <
        AUTO_ATTEMPT_COOLDOWN_MS
    ) {
      return { ok: true, eligible: false, reason: "ATTEMPT_COOLDOWN" };
    }
    return {
      ok: true,
      eligible: true,
      intervalHours: interval.value,
      lastSuccessfulAt: loaded.state.latestSnapshot.capturedAt,
    };
  }

  function loadFollowerAutoInterval(ownerUid) {
    try {
      const value = GM_getValue(
        FOLLOWER_AUTO_INTERVAL_PREFIX + ownerUid,
        0
      );
      if (!AUTO_INTERVAL_HOURS.includes(value)) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_AUTO_INTERVAL_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveFollowerAutoInterval(ownerUid, value) {
    const key = FOLLOWER_AUTO_INTERVAL_PREFIX + ownerUid;
    try {
      GM_setValue(key, value);
      if (GM_getValue(key, null) !== value) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
        rollbackSucceeded: false,
      };
    }
  }

  function loadFollowerLastAutomaticAttempt(ownerUid) {
    try {
      const value = GM_getValue(
        FOLLOWER_AUTO_ATTEMPT_PREFIX + ownerUid,
        null
      );
      if (value === null || typeof value === "undefined") {
        return { ok: true, value: null };
      }
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_AUTO_ATTEMPT_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveFollowerLastAutomaticAttempt(ownerUid, attemptedAt) {
    const key = FOLLOWER_AUTO_ATTEMPT_PREFIX + ownerUid;
    try {
      GM_setValue(key, attemptedAt);
      if (GM_getValue(key, null) !== attemptedAt) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
        rollbackSucceeded: false,
      };
    }
  }

  function evaluateFollowerAutomaticUpdateEligibility(
    ownerUid,
    nowMilliseconds
  ) {
    const interval = loadFollowerAutoInterval(ownerUid);
    if (!interval.ok) return interval;
    if (interval.value === 0) {
      return { ok: true, eligible: false, reason: "DISABLED" };
    }
    const loaded = loadFollowerState(ownerUid);
    if (!loaded.ok) return loaded;
    if (loaded.state.latestSnapshot !== null) {
      const successfulAt = Date.parse(
        loaded.state.latestSnapshot.capturedAt
      );
      const thresholdMilliseconds = interval.value * 60 * 60 * 1000;
      if (nowMilliseconds - successfulAt < thresholdMilliseconds) {
        return {
          ok: true,
          eligible: false,
          reason: "THRESHOLD_NOT_REACHED",
        };
      }
    }
    const lastAttempt = loadFollowerLastAutomaticAttempt(ownerUid);
    if (!lastAttempt.ok) return lastAttempt;
    if (
      lastAttempt.value !== null &&
      nowMilliseconds - Date.parse(lastAttempt.value) <
        AUTO_ATTEMPT_COOLDOWN_MS
    ) {
      return { ok: true, eligible: false, reason: "ATTEMPT_COOLDOWN" };
    }
    return {
      ok: true,
      eligible: true,
      intervalHours: interval.value,
      lastSuccessfulAt:
        loaded.state.latestSnapshot === null
          ? null
          : loaded.state.latestSnapshot.capturedAt,
    };
  }
