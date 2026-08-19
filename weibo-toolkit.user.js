// ==UserScript==
// @name         Weibo Toolkit - Friend Radar
// @namespace    local.weibo-toolkit
// @version      0.5.0
// @description  Local Friend Radar with backup restore and opt-in automatic updates.
// @match        https://weibo.com/*
// @license      MPL-2.0
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const ENDPOINT = "/ajax/friendships/friends";
  const REQUEST_DELAY_MS = 750;
  const OBJECT_URL_REVOKE_DELAY_MS = 1000;
  const MAX_REQUESTS = 100;
  const APP_VERSION = "0.5.0";
  const SCHEMA_VERSION = 1;
  const STORAGE_PREFIX = "weiboToolkit.friendRadar.v1.";
  const BACKUP_FORMAT = "weibo-toolkit.friend-radar";
  const BACKUP_VERSION = 1;
  const AUTO_INTERVAL_PREFIX = "weiboToolkit.friendRadar.autoInterval.v1.";
  const AUTO_ATTEMPT_PREFIX = "weiboToolkit.friendRadar.autoAttempt.v1.";
  const AUTO_STARTUP_DELAY_MS = 5000;
  const AUTO_ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  const AUTO_STATUS_DURATION_MS = 5000;
  const AUTO_INTERVAL_HOURS = Object.freeze([0, 24, 48, 72, 168, 360]);

  const EVENT = Object.freeze({
    VISIBLE_FOLLOWING_ADDED: "VISIBLE_FOLLOWING_ADDED",
    VISIBLE_FOLLOWING_DISAPPEARED: "VISIBLE_FOLLOWING_DISAPPEARED",
    FOLLOW_ME_GAINED: "FOLLOW_ME_GAINED",
    FOLLOW_ME_LOST: "FOLLOW_ME_LOST",
    SCREEN_NAME_CHANGED: "SCREEN_NAME_CHANGED",
  });

  const EVENT_LABELS = Object.freeze({
    [EVENT.VISIBLE_FOLLOWING_ADDED]: "出现在你的可见关注列表",
    [EVENT.VISIBLE_FOLLOWING_DISAPPEARED]: "从你的可见关注列表消失",
    [EVENT.FOLLOW_ME_GAINED]: "开始关注你",
    [EVENT.FOLLOW_ME_LOST]: "停止关注你",
    [EVENT.SCREEN_NAME_CHANGED]: "昵称已更改",
  });

  const FAILURE_LABELS = Object.freeze({
    UID_UNAVAILABLE: "无法可靠识别当前登录账号",
    ACCOUNT_CHANGED_DURING_SCAN: "扫描期间登录账号发生变化",
    STALE_SCAN: "扫描结果早于当前已保存快照",
    LOGIN_REQUIRED: "登录已失效，请重新登录",
    HTTP_ERROR: "接口返回 HTTP 错误",
    CHALLENGE_OR_UNEXPECTED_RESPONSE: "收到验证页面或意外 HTML",
    NON_JSON_RESPONSE: "接口未返回有效 JSON",
    UNEXPECTED_CONTENT_TYPE: "接口响应类型异常",
    UNEXPECTED_SCHEMA: "接口数据结构异常",
    PAGINATION_FAILURE: "分页链不可信",
    NETWORK_ERROR: "网络请求失败",
    PERSISTENCE_ERROR: "本地保存失败",
    CONCURRENT_MODIFICATION:
      "检测到另一个微博标签页正在修改关系雷达数据，本次操作未保存。请在其中一个标签页重新操作。",
    STORAGE_ERROR: "本地状态无法读取",
    BACKUP_EXPORT_ERROR: "备份导出失败",
    BACKUP_RESTORE_ERROR: "备份恢复失败",
    UPDATE_ALREADY_RUNNING: "更新正在进行",
    UNKNOWN_FAILURE: "未知失败",
  });

  const hasOwn = (value, key) =>
    Object.prototype.hasOwnProperty.call(value, key);

  let updateRunning = false;
  let panelRoot = null;
  let launcherButton = null;
  let launcherStatusTimer = null;

  function normalizeStableUid(value) {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    if (typeof value === "string") {
      const candidate = value.trim();
      return /^[1-9]\d*$/.test(candidate) ? candidate : null;
    }
    return null;
  }

  function normalizeNonNegativeInteger(value) {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
      const parsed = Number(value.trim());
      return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
  }

  function determineCurrentUid() {
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow.$CONFIG) {
        const uid = normalizeStableUid(unsafeWindow.$CONFIG.uid);
        if (uid !== null) {
          return { ok: true, uid, method: "unsafeWindow.$CONFIG.uid" };
        }
      }
    } catch (_) {
      // A blocked or missing page global is not evidence of an authenticated UID.
    }
    return { ok: false, failureKind: "UID_UNAVAILABLE" };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function buildRequestUrl(ownerUid, page) {
    const url = new URL(ENDPOINT, location.origin);
    url.searchParams.set("uid", ownerUid);
    url.searchParams.set("page", String(page));
    return url;
  }

  function looksLikeLoginUrl(url) {
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname === "passport.weibo.com" ||
        /(^|\/)login(?:\/|$)/i.test(parsed.pathname)
      );
    } catch (_) {
      return false;
    }
  }

  function looksLikeHtml(contentType, body) {
    return (
      /text\/html|application\/xhtml\+xml/i.test(contentType) ||
      /^\s*(?:<!doctype\s+html|<html\b)/i.test(body)
    );
  }

  async function requestFollowingPage(ownerUid, page) {
    const url = buildRequestUrl(ownerUid, page);
    let response;
    try {
      response = await fetch(url.href, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "follow",
      });
    } catch (error) {
      return {
        ok: false,
        failureKind: "NETWORK_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }

    const contentType = response.headers.get("content-type") || "unavailable";
    let body;
    try {
      body = await response.text();
    } catch (error) {
      return {
        ok: false,
        failureKind: "NETWORK_ERROR",
        httpStatus: response.status,
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }

    let data = null;
    let validJson = false;
    try {
      data = JSON.parse(body);
      validJson = true;
    } catch (_) {
      // Classified below without treating malformed input as an empty result.
    }

    if (looksLikeLoginUrl(response.url) || response.status === 401) {
      return { ok: false, failureKind: "LOGIN_REQUIRED", httpStatus: response.status };
    }
    if (!response.ok) {
      return { ok: false, failureKind: "HTTP_ERROR", httpStatus: response.status };
    }
    if (looksLikeHtml(contentType, body)) {
      return {
        ok: false,
        failureKind: "CHALLENGE_OR_UNEXPECTED_RESPONSE",
        httpStatus: response.status,
      };
    }
    if (!validJson) {
      return { ok: false, failureKind: "NON_JSON_RESPONSE", httpStatus: response.status };
    }
    if (!/(?:application|text)\/[^;]*json/i.test(contentType)) {
      return {
        ok: false,
        failureKind: "UNEXPECTED_CONTENT_TYPE",
        httpStatus: response.status,
      };
    }
    return { ok: true, data };
  }

  function validateAndConvertUser(user) {
    if (!user || typeof user !== "object" || Array.isArray(user)) {
      return { ok: false, reason: "USER_RECORD_NOT_OBJECT" };
    }

    const requiredFields = [
      "id",
      "idstr",
      "screen_name",
      "following",
      "follow_me",
      "remark",
    ];
    for (const field of requiredFields) {
      if (!hasOwn(user, field)) {
        return { ok: false, reason: `MISSING_USER_FIELD:${field}` };
      }
    }

    const id = normalizeStableUid(user.id);
    const idstr = normalizeStableUid(user.idstr);
    if (id === null || idstr === null || id !== idstr) {
      return { ok: false, reason: "UNUSABLE_OR_CONFLICTING_STABLE_UID" };
    }
    if (typeof user.screen_name !== "string") {
      return { ok: false, reason: "INVALID_SCREEN_NAME" };
    }
    if (typeof user.following !== "boolean") {
      return { ok: false, reason: "INVALID_FOLLOWING_VALUE" };
    }
    if (typeof user.follow_me !== "boolean") {
      return { ok: false, reason: "INVALID_FOLLOW_ME_VALUE" };
    }
    if (typeof user.remark !== "string" && user.remark !== null) {
      return { ok: false, reason: "INVALID_REMARK_VALUE" };
    }

    return {
      ok: true,
      record: {
        uid: idstr,
        screenName: user.screen_name,
        following: user.following,
        followsMe: user.follow_me,
        remark: user.remark,
      },
    };
  }

  function validatePageData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, reason: "TOP_LEVEL_NOT_OBJECT" };
    }
    if (hasOwn(data, "ok") && ![1, "1", true].includes(data.ok)) {
      return { ok: false, reason: "API_OK_INDICATOR_NOT_SUCCESS" };
    }
    if (!Array.isArray(data.users)) {
      return { ok: false, reason: "USERS_ARRAY_MISSING_OR_INVALID" };
    }
    if (!hasOwn(data, "total_number")) {
      return { ok: false, reason: "TOTAL_NUMBER_MISSING" };
    }
    if (!hasOwn(data, "previous_cursor") || !hasOwn(data, "next_cursor")) {
      return { ok: false, reason: "CURSOR_FIELD_MISSING" };
    }
    return { ok: true };
  }

  function reportScanProgress(onProgress, progress) {
    if (typeof onProgress !== "function") return;
    try {
      onProgress(progress);
    } catch (_) {
      // Progress presentation is advisory only and must never affect the scan.
    }
  }

  async function scanFollowing(ownerUid, onProgress, beforeFirstRequest) {
    const recordsByUid = new Map();
    const seenNextCursors = new Set();
    const seenPaginationStates = new Set();
    let reportedTotal = null;
    let previousPageNextCursor = null;
    let requestsMade = 0;

    for (let page = 1; page <= MAX_REQUESTS; page += 1) {
      if (requestsMade === 0 && typeof beforeFirstRequest === "function") {
        const permission = beforeFirstRequest();
        if (!permission.ok) {
          return { ...permission, requestsMade: 0, failedPage: page };
        }
      }
      if (requestsMade > 0) await delay(REQUEST_DELAY_MS);
      requestsMade += 1;

      const response = await requestFollowingPage(ownerUid, page);
      if (!response.ok) {
        return { ...response, requestsMade, failedPage: page };
      }

      const validation = validatePageData(response.data);
      if (!validation.ok) {
        return {
          ok: false,
          failureKind: "UNEXPECTED_SCHEMA",
          reason: validation.reason,
          requestsMade,
          failedPage: page,
        };
      }

      const pageTotal = normalizeNonNegativeInteger(response.data.total_number);
      const previousCursor = normalizeNonNegativeInteger(
        response.data.previous_cursor
      );
      const nextCursor = normalizeNonNegativeInteger(response.data.next_cursor);
      if (pageTotal === null) {
        return {
          ok: false,
          failureKind: "UNEXPECTED_SCHEMA",
          reason: "INVALID_TOTAL_NUMBER",
          requestsMade,
          failedPage: page,
        };
      }
      if (previousCursor === null || nextCursor === null) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "INVALID_CURSOR_VALUE",
          requestsMade,
          failedPage: page,
        };
      }
      if (reportedTotal === null) reportedTotal = pageTotal;
      if (reportedTotal !== pageTotal) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "TOTAL_NUMBER_CHANGED",
          requestsMade,
          failedPage: page,
        };
      }
      if (
        (page === 1 && previousCursor !== 0) ||
        (page > 1 && previousCursor !== previousPageNextCursor)
      ) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "PREVIOUS_CURSOR_CHAIN_BROKEN",
          requestsMade,
          failedPage: page,
        };
      }

      const paginationState = `${page}:${previousCursor}:${nextCursor}`;
      if (seenPaginationStates.has(paginationState)) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "REPEATED_PAGINATION_STATE",
          requestsMade,
          failedPage: page,
        };
      }
      seenPaginationStates.add(paginationState);

      for (let index = 0; index < response.data.users.length; index += 1) {
        const converted = validateAndConvertUser(response.data.users[index]);
        if (!converted.ok) {
          return {
            ok: false,
            failureKind: "UNEXPECTED_SCHEMA",
            reason: converted.reason,
            requestsMade,
            failedPage: page,
            failedRecordIndex: index,
          };
        }
        if (recordsByUid.has(converted.record.uid)) {
          return {
            ok: false,
            failureKind: "PAGINATION_FAILURE",
            reason: "DUPLICATE_STABLE_UID",
            requestsMade,
            failedPage: page,
          };
        }
        recordsByUid.set(converted.record.uid, converted.record);
      }

      reportScanProgress(onProgress, {
        page,
        requestsMade,
        visibleRecordsCollected: recordsByUid.size,
        reportedTotal,
      });

      if (nextCursor === 0) {
        if (recordsByUid.size > reportedTotal) {
          return {
            ok: false,
            failureKind: "PAGINATION_FAILURE",
            reason: "VISIBLE_COUNT_EXCEEDS_REPORTED_TOTAL",
            requestsMade,
            failedPage: page,
          };
        }
        const records = [...recordsByUid.values()].sort((a, b) =>
          a.uid.localeCompare(b.uid)
        );
        return {
          ok: true,
          requestsMade,
          snapshot: {
            capturedAt: new Date().toISOString(),
            reportedTotal,
            visibleCount: records.length,
            unresolvedRelationCount: reportedTotal - records.length,
            records,
          },
        };
      }

      const cursorKey = String(nextCursor);
      if (seenNextCursors.has(cursorKey)) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "REPEATED_NEXT_CURSOR",
          requestsMade,
          failedPage: page,
        };
      }
      seenNextCursors.add(cursorKey);
      previousPageNextCursor = nextCursor;
    }

    return {
      ok: false,
      failureKind: "PAGINATION_FAILURE",
      reason: "HARD_REQUEST_CEILING_REACHED",
      requestsMade,
      visibleRecordsCollected: recordsByUid.size,
      reportedTotal,
    };
  }

  function storageKey(ownerUid) {
    return `${STORAGE_PREFIX}${ownerUid}`;
  }

  function emptyState(ownerUid) {
    return {
      schemaVersion: SCHEMA_VERSION,
      ownerUid,
      latestSnapshot: null,
      events: [],
    };
  }

  function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function isValidStoredRecord(record) {
    return Boolean(
      isPlainObject(record) &&
        typeof record.uid === "string" &&
        normalizeStableUid(record.uid) === record.uid &&
        typeof record.screenName === "string" &&
        typeof record.following === "boolean" &&
        typeof record.followsMe === "boolean" &&
        (typeof record.remark === "string" || record.remark === null)
    );
  }

  function isValidStoredSnapshot(snapshot) {
    if (
      !isPlainObject(snapshot) ||
      typeof snapshot.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      !Number.isSafeInteger(snapshot.reportedTotal) ||
      snapshot.reportedTotal < 0 ||
      !Number.isSafeInteger(snapshot.visibleCount) ||
      snapshot.visibleCount < 0 ||
      !Number.isSafeInteger(snapshot.unresolvedRelationCount) ||
      snapshot.unresolvedRelationCount < 0 ||
      !Array.isArray(snapshot.records) ||
      snapshot.visibleCount !== snapshot.records.length ||
      snapshot.reportedTotal - snapshot.visibleCount !==
        snapshot.unresolvedRelationCount
    ) {
      return false;
    }

    const seenUids = new Set();
    for (const record of snapshot.records) {
      if (!isValidStoredRecord(record) || seenUids.has(record.uid)) return false;
      seenUids.add(record.uid);
    }
    return true;
  }

  function isValidStoredEvent(event) {
    if (
      !isPlainObject(event) ||
      typeof event.id !== "string" ||
      event.id.length === 0 ||
      !Object.values(EVENT).includes(event.type) ||
      typeof event.detectedAt !== "string" ||
      !Number.isFinite(Date.parse(event.detectedAt)) ||
      typeof event.subjectUid !== "string" ||
      normalizeStableUid(event.subjectUid) !== event.subjectUid ||
      typeof event.displayName !== "string" ||
      typeof event.read !== "boolean" ||
      !isPlainObject(event.previous) ||
      !isPlainObject(event.current)
    ) {
      return false;
    }

    if (event.type === EVENT.VISIBLE_FOLLOWING_ADDED) {
      return event.previous.visible === false && event.current.visible === true;
    }
    if (event.type === EVENT.VISIBLE_FOLLOWING_DISAPPEARED) {
      return event.previous.visible === true && event.current.visible === false;
    }
    if (event.type === EVENT.FOLLOW_ME_GAINED) {
      return event.previous.followsMe === false && event.current.followsMe === true;
    }
    if (event.type === EVENT.FOLLOW_ME_LOST) {
      return event.previous.followsMe === true && event.current.followsMe === false;
    }
    return (
      typeof event.previous.screenName === "string" &&
      typeof event.current.screenName === "string"
    );
  }

  function isValidStoredState(state, ownerUid) {
    return Boolean(
      isPlainObject(state) &&
        state.schemaVersion === SCHEMA_VERSION &&
        state.ownerUid === ownerUid &&
        (state.latestSnapshot === null ||
          isValidStoredSnapshot(state.latestSnapshot)) &&
        Array.isArray(state.events) &&
        state.events.every(isValidStoredEvent)
    );
  }

  function loadState(ownerUid) {
    try {
      const key = storageKey(ownerUid);
      const raw = GM_getValue(key, null);
      if (raw === null || typeof raw === "undefined") {
        return { ok: true, state: emptyState(ownerUid), raw: null };
      }
      if (typeof raw !== "string") {
        return { ok: false, failureKind: "STORAGE_ERROR", reason: "STATE_NOT_STRING" };
      }
      const state = JSON.parse(raw);
      if (!isValidStoredState(state, ownerUid)) {
        return { ok: false, failureKind: "STORAGE_ERROR", reason: "STATE_SCHEMA_INVALID" };
      }
      return { ok: true, state, raw };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function persistState(ownerUid, state) {
    const key = storageKey(ownerUid);
    const serialized = JSON.stringify(state);
    try {
      GM_setValue(key, serialized);
      const verified = GM_getValue(key, null);
      if (verified !== serialized) {
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

  function snapshotMap(snapshot) {
    return new Map(snapshot.records.map((record) => [record.uid, record]));
  }

  function makeEvent(type, detectedAt, subjectUid, displayName, previous, current, index) {
    return {
      id: `${detectedAt}:${index + 1}:${type}:${subjectUid}`,
      type,
      detectedAt,
      subjectUid,
      displayName,
      read: false,
      previous,
      current,
    };
  }

  function diffSnapshots(previousSnapshot, currentSnapshot) {
    const previous = snapshotMap(previousSnapshot);
    const current = snapshotMap(currentSnapshot);
    const events = [];
    const detectedAt = currentSnapshot.capturedAt;

    const addedUids = [...current.keys()]
      .filter((uid) => !previous.has(uid))
      .sort();
    for (const uid of addedUids) {
      const record = current.get(uid);
      events.push(
        makeEvent(
          EVENT.VISIBLE_FOLLOWING_ADDED,
          detectedAt,
          uid,
          record.screenName,
          { visible: false },
          { visible: true },
          events.length
        )
      );
    }

    const disappearedUids = [...previous.keys()]
      .filter((uid) => !current.has(uid))
      .sort();
    for (const uid of disappearedUids) {
      const record = previous.get(uid);
      events.push(
        makeEvent(
          EVENT.VISIBLE_FOLLOWING_DISAPPEARED,
          detectedAt,
          uid,
          record.screenName,
          { visible: true },
          { visible: false },
          events.length
        )
      );
    }

    const sharedUids = [...current.keys()]
      .filter((uid) => previous.has(uid))
      .sort();
    for (const uid of sharedUids) {
      const before = previous.get(uid);
      const after = current.get(uid);

      if (before.screenName !== after.screenName) {
        events.push(
          makeEvent(
            EVENT.SCREEN_NAME_CHANGED,
            detectedAt,
            uid,
            after.screenName,
            { screenName: before.screenName },
            { screenName: after.screenName },
            events.length
          )
        );
      }
      if (before.followsMe === false && after.followsMe === true) {
        events.push(
          makeEvent(
            EVENT.FOLLOW_ME_GAINED,
            detectedAt,
            uid,
            after.screenName,
            { followsMe: false },
            { followsMe: true },
            events.length
          )
        );
      } else if (before.followsMe === true && after.followsMe === false) {
        events.push(
          makeEvent(
            EVENT.FOLLOW_ME_LOST,
            detectedAt,
            uid,
            after.screenName,
            { followsMe: true },
            { followsMe: false },
            events.length
          )
        );
      }
    }

    return events;
  }

  function prepareSuccessfulUpdate(ownerUid, previousState, snapshot) {
    if (previousState.ownerUid !== ownerUid) {
      return { ok: false, failureKind: "STORAGE_ERROR", reason: "OWNER_UID_MISMATCH" };
    }
    const baselineCreated = previousState.latestSnapshot === null;
    const newEvents = baselineCreated
      ? []
      : diffSnapshots(previousState.latestSnapshot, snapshot);
    return {
      ok: true,
      baselineCreated,
      newEvents,
      state: {
        schemaVersion: SCHEMA_VERSION,
        ownerUid,
        latestSnapshot: snapshot,
        events: [...previousState.events, ...newEvents],
      },
    };
  }

  function markAllEventsRead(state) {
    return {
      ...state,
      events: state.events.map((event) => ({ ...event, read: true })),
    };
  }

  function checkScanFreshness(state, snapshot) {
    if (state.latestSnapshot === null) return { ok: true };
    const storedTime = Date.parse(state.latestSnapshot.capturedAt);
    const scanTime = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(storedTime) || !Number.isFinite(scanTime)) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "INVALID_SNAPSHOT_TIMESTAMP",
      };
    }
    if (storedTime > scanTime) {
      return { ok: false, failureKind: "STALE_SCAN" };
    }
    return { ok: true };
  }

  async function performUpdate(onProgress, beforeFirstRequest) {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) return uidResult;

    const scan = await scanFollowing(
      uidResult.uid,
      onProgress,
      beforeFirstRequest
    );
    if (!scan.ok) return scan;

    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== uidResult.uid) {
      return { ok: false, failureKind: "ACCOUNT_CHANGED_DURING_SCAN" };
    }

    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) return loaded;

    const freshness = checkScanFreshness(loaded.state, scan.snapshot);
    if (!freshness.ok) return freshness;

    const prepared = prepareSuccessfulUpdate(
      uidResult.uid,
      loaded.state,
      scan.snapshot
    );
    if (!prepared.ok) return prepared;

    const persisted = persistState(uidResult.uid, prepared.state);
    if (!persisted.ok) return persisted;

    return {
      ok: true,
      ownerUid: uidResult.uid,
      snapshot: scan.snapshot,
      requestsMade: scan.requestsMade,
      baselineCreated: prepared.baselineCreated,
      newEvents: prepared.newEvents,
      totalStoredEvents: prepared.state.events.length,
    };
  }

  function createElement(tag, text, className) {
    const element = document.createElement(tag);
    if (typeof text === "string") element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function closePanel() {
    if (panelRoot && panelRoot.parentNode) panelRoot.parentNode.removeChild(panelRoot);
    panelRoot = null;
  }

  function showPanel(title, withBack = false) {
    closePanel();
    const root = createElement("div", null, "wfr-overlay");
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

  function failureText(result) {
    if (result.failureKind === "BACKUP_RESTORE_ERROR") {
      const restoreMessages = {
        MALFORMED_JSON: "备份文件不是有效的 JSON。",
        INVALID_TOP_LEVEL: "备份文件结构无效。",
        WRONG_BACKUP_FORMAT: "备份格式不匹配。",
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
          "保存和恢复均未能确认成功。本地状态可能不确定或损坏，在检查或重新创建基线前请勿信任。";
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
      ? `基线已创建，记录了 ${result.snapshot.visibleCount} 个可见关注。`
      : `更新完成，发现 ${result.newEvents.length} 个新事件。`;
    body.append(createElement("p", message, "wfr-success"));
    addLine(body, "可见关注", result.snapshot.visibleCount);
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
    if (updateRunning) {
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
    if (result.ok) showUpdateSuccess(result);
    else showFailure("关系雷达更新失败", result);
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  }

  function describeEvent(event) {
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      return `${event.previous.screenName} → ${event.current.screenName}`;
    }
    return EVENT_LABELS[event.type] || event.type;
  }

  // Both sides of a mutual-follow transition are only stated for records that are
  // present in the API-visible following list, where "you follow them" is known.
  const MUTUAL_FOLLOW_MEANING = "互相关注";
  const ONE_WAY_FOLLOW_MEANING = "你关注对方，对方未关注你";
  const VISIBLE_PRESENT_MEANING = "在你的可见关注列表中";
  const VISIBLE_ABSENT_MEANING = "不在你的可见关注列表中";

  function eventTransition(event) {
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      return {
        previous: event.previous.screenName,
        current: event.current.screenName,
      };
    }
    if (event.type === EVENT.FOLLOW_ME_GAINED) {
      return { previous: ONE_WAY_FOLLOW_MEANING, current: MUTUAL_FOLLOW_MEANING };
    }
    if (event.type === EVENT.FOLLOW_ME_LOST) {
      return { previous: MUTUAL_FOLLOW_MEANING, current: ONE_WAY_FOLLOW_MEANING };
    }
    if (
      event.type === EVENT.VISIBLE_FOLLOWING_ADDED ||
      event.type === EVENT.VISIBLE_FOLLOWING_DISAPPEARED
    ) {
      const meaning = (visible) =>
        visible ? VISIBLE_PRESENT_MEANING : VISIBLE_ABSENT_MEANING;
      return {
        previous: meaning(event.previous.visible),
        current: meaning(event.current.visible),
      };
    }
    return null;
  }

  function sortEventsNewestFirst(events) {
    return [...events].sort(
      (a, b) =>
        b.detectedAt.localeCompare(a.detectedAt) || b.id.localeCompare(a.id)
    );
  }

  // Identity is the stable UID only: a renamed account keeps one timeline, and two
  // accounts sharing a nickname never merge.
  function eventsForSubject(events, subjectUid) {
    return sortEventsNewestFirst(
      events.filter((event) => event.subjectUid === subjectUid)
    );
  }

  function bestDisplayName(state, subjectUid) {
    const snapshot = state.latestSnapshot;
    if (snapshot) {
      const record = snapshot.records.find((entry) => entry.uid === subjectUid);
      if (record) return record.screenName;
    }
    const history = eventsForSubject(state.events, subjectUid);
    return history.length > 0 ? history[0].displayName : subjectUid;
  }

  function matchesEventQuery(event, query) {
    const needle = String(query).trim().toLowerCase();
    if (needle === "") return true;
    return (
      event.subjectUid.includes(needle) ||
      event.displayName.toLowerCase().includes(needle)
    );
  }

  function filterEvents(events, query) {
    return events.filter((event) => matchesEventQuery(event, query));
  }

  function renderEvents(ownerUid, state, notice) {
    const body = showPanel("关系事件", true);
    if (notice) body.append(createElement("p", notice, "wfr-success"));
    const unread = state.events.filter((event) => !event.read).length;
    addLine(body, "事件总数", state.events.length);
    addLine(body, "未读", unread);

    if (unread > 0) {
      const markButton = createElement("button", "全部标为已读", "wfr-button wfr-primary");
      markButton.type = "button";
      markButton.addEventListener("click", async () => {
        markButton.disabled = true;
        const currentUid = determineCurrentUid();
        if (!currentUid.ok || currentUid.uid !== ownerUid) {
          showFailure("标记失败", {
            failureKind: "UID_UNAVAILABLE",
          });
          return;
        }
        const fresh = loadState(ownerUid);
        if (!fresh.ok) {
          showFailure("标记失败", fresh);
          return;
        }
        const nextState = markAllEventsRead(fresh.state);
        const saved = persistState(ownerUid, nextState);
        if (!saved.ok) {
          showFailure("标记失败", saved);
          return;
        }
        renderEvents(ownerUid, nextState, "全部事件已标为已读。");
      });
      body.append(markButton);
    }

    if (state.events.length === 0) {
      body.append(createElement("p", "暂无事件", "wfr-muted"));
      return;
    }

    const search = createElement("input", null, "wfr-search");
    search.type = "search";
    search.placeholder = "搜索昵称或 UID";
    search.setAttribute("aria-label", "搜索昵称或 UID");
    body.append(search);

    const list = createElement("div", null, "wfr-event-list");
    body.append(list);

    const newestFirst = sortEventsNewestFirst(state.events);
    function renderList(query) {
      while (list.childNodes.length > 0) list.removeChild(list.childNodes[0]);
      const matching = filterEvents(newestFirst, query);
      if (matching.length === 0) {
        list.append(createElement("p", "没有匹配的事件", "wfr-muted"));
        return;
      }
      for (const event of matching) {
        list.append(buildEventCard(ownerUid, state, event));
      }
    }
    search.addEventListener("input", () => renderList(search.value || ""));
    renderList("");
  }

  function buildEventCard(ownerUid, state, event) {
    const item = createElement("article", null, "wfr-event");
    item.append(
      createElement(
        "h3",
        `${event.read ? "已读" : "未读"} · ${EVENT_LABELS[event.type] || event.type}`
      )
    );
    addLine(item, "时间", formatTime(event.detectedAt));
    addLine(item, "名称", event.displayName);
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      addLine(item, "变化", describeEvent(event));
    }
    const detailButton = createElement("button", "详情", "wfr-button");
    detailButton.type = "button";
    detailButton.addEventListener("click", () =>
      showEventDetail(ownerUid, state, event)
    );
    item.append(detailButton);
    return item;
  }

  function showEventDetail(ownerUid, state, event) {
    const body = showPanel("事件详情", () => renderEvents(ownerUid, state, null));
    body.append(
      createElement("h3", EVENT_LABELS[event.type] || event.type)
    );
    addLine(body, "名称", event.displayName);
    addLine(body, "UID", event.subjectUid);
    addLine(body, "检测时间", formatTime(event.detectedAt));
    addLine(body, "状态", event.read ? "已读" : "未读");

    const transition = eventTransition(event);
    if (transition) {
      addLine(body, "变化前", transition.previous);
      addLine(body, "变化后", transition.current);
    }
    addLine(
      body,
      "该 UID 的已存事件",
      eventsForSubject(state.events, event.subjectUid).length
    );

    if (event.type === EVENT.VISIBLE_FOLLOWING_DISAPPEARED) {
      body.append(
        createElement(
          "p",
          "本工具只能记录该账号从你的可见关注列表消失，无法判断消失的原因。",
          "wfr-muted"
        )
      );
    }

    const timelineButton = createElement(
      "button",
      "查看关系时间线",
      "wfr-button wfr-primary"
    );
    timelineButton.type = "button";
    timelineButton.addEventListener("click", () =>
      showTimeline(ownerUid, state, event.subjectUid)
    );
    body.append(timelineButton);
  }

  function showTimeline(ownerUid, state, subjectUid) {
    const history = eventsForSubject(state.events, subjectUid);
    const body = showPanel(
      `${bestDisplayName(state, subjectUid)} · 关系时间线`,
      () => renderEvents(ownerUid, state, null)
    );
    addLine(body, "UID", subjectUid);
    addLine(body, "历史事件", history.length);
    body.append(
      createElement(
        "p",
        "以下仅为 Weibo Toolkit 实际观察并保存的事件，不是微博上的完整真实关系历史。",
        "wfr-muted"
      )
    );

    if (history.length === 0) {
      body.append(createElement("p", "暂无事件", "wfr-muted"));
      return;
    }

    const list = createElement("div", null, "wfr-event-list");
    for (const event of history) {
      const item = createElement("article", null, "wfr-event");
      item.append(createElement("h3", formatDate(event.detectedAt)));
      item.append(
        createElement("p", EVENT_LABELS[event.type] || event.type, "wfr-row")
      );
      if (event.type === EVENT.SCREEN_NAME_CHANGED) {
        item.append(createElement("p", describeEvent(event), "wfr-row"));
      }
      list.append(item);
    }
    body.append(list);
  }

  function viewEvents() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("关系事件", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("关系事件", loaded);
      return;
    }
    renderEvents(uidResult.uid, loaded.state, null);
  }

  function viewStatus() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("关系雷达状态", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("关系雷达状态", loaded);
      return;
    }

    const body = showPanel("关系雷达状态", true);
    const snapshot = loaded.state.latestSnapshot;
    const unread = loaded.state.events.filter((event) => !event.read).length;
    addLine(body, "已有基线", snapshot ? "是" : "否");
    if (snapshot) {
      addLine(body, "上次成功更新", formatTime(snapshot.capturedAt));
      addLine(body, "可见关注", snapshot.visibleCount);
      addLine(body, "接口总数", snapshot.reportedTotal);
      addLine(
        body,
        "未解析关系差值",
        snapshot.unresolvedRelationCount
      );
    }
    addLine(body, "事件总数", loaded.state.events.length);
    addLine(body, "未读事件", unread);
  }

  function backupFilename(ownerUid, exportedAt) {
    const timestamp = exportedAt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .replace(/\.\d{3}Z$/, "");
    return `weibo-toolkit-friend-radar-${ownerUid}-${timestamp}.json`;
  }

  function createBackup(ownerUid, state, exportedAt) {
    if (state.ownerUid !== ownerUid) {
      throw new Error("Backup owner UID mismatch");
    }
    return {
      backupFormat: BACKUP_FORMAT,
      backupVersion: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      appVersion: APP_VERSION,
      ownerUid,
      state,
    };
  }

  function serializeBackup(backup) {
    return `${JSON.stringify(backup, null, 2)}\n`;
  }

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

  function validateBackupText(text, currentOwnerUid) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch (_) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "MALFORMED_JSON",
      };
    }

    if (!isPlainObject(backup)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_TOP_LEVEL",
      };
    }
    if (backup.backupFormat !== BACKUP_FORMAT) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "WRONG_BACKUP_FORMAT",
      };
    }
    if (backup.backupVersion !== BACKUP_VERSION) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "UNSUPPORTED_BACKUP_VERSION",
      };
    }
    if (
      typeof backup.ownerUid !== "string" ||
      normalizeStableUid(backup.ownerUid) !== backup.ownerUid
    ) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_OWNER_UID",
      };
    }
    if (backup.ownerUid !== currentOwnerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }
    if (
      hasOwn(backup, "exportedAt") &&
      (typeof backup.exportedAt !== "string" ||
        !Number.isFinite(Date.parse(backup.exportedAt)))
    ) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_EXPORTED_AT",
      };
    }
    if (!isValidStoredState(backup.state, backup.ownerUid)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_STATE",
      };
    }

    return {
      ok: true,
      ownerUid: backup.ownerUid,
      exportedAt: hasOwn(backup, "exportedAt") ? backup.exportedAt : null,
      state: backup.state,
      stateSerialized: JSON.stringify(backup.state),
    };
  }

  function selectBackupFile() {
    return new Promise((resolve, reject) => {
      const input = createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.hidden = true;
      let settled = false;

      function finish(file) {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(file || null);
      }

      input.addEventListener("change", () => {
        finish(input.files && input.files.length > 0 ? input.files[0] : null);
      });
      input.addEventListener("cancel", () => finish(null));
      document.body.append(input);
      try {
        input.click();
      } catch (error) {
        if (input.parentNode) input.parentNode.removeChild(input);
        reject(error);
      }
    });
  }

  function restoreValidatedBackup(validated, expectedCurrentRaw) {
    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== validated.ownerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }

    const fresh = loadState(validated.ownerUid);
    if (!fresh.ok) return fresh;
    if (fresh.raw !== expectedCurrentRaw) {
      return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
    }

    const persisted = persistState(validated.ownerUid, validated.state);
    if (!persisted.ok) return persisted;

    const reloaded = loadState(validated.ownerUid);
    if (!reloaded.ok) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: "RestoreVerificationError",
        rollbackSucceeded: false,
      };
    }
    if (reloaded.raw !== validated.stateSerialized) {
      return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
    }
    return { ok: true, state: reloaded.state };
  }

  function snapshotRecordCount(state) {
    return state.latestSnapshot ? state.latestSnapshot.records.length : 0;
  }

  function showRestorePreview(validated, currentLoaded) {
    const body = showPanel("恢复备份", true);
    body.append(
      createElement(
        "p",
        "恢复后，当前账号的关系雷达本地数据将被此备份完整替换。",
        "wfr-error"
      )
    );
    body.append(
      createElement(
        "p",
        "建议先导出当前数据作为备份。",
        "wfr-muted"
      )
    );
    addLine(body, "备份账号 UID", validated.ownerUid);
    if (validated.exportedAt !== null) {
      addLine(body, "备份导出时间", formatTime(validated.exportedAt));
    }
    addLine(body, "当前事件数", currentLoaded.state.events.length);
    addLine(body, "备份事件数", validated.state.events.length);
    addLine(body, "当前快照记录数", snapshotRecordCount(currentLoaded.state));
    addLine(body, "备份快照记录数", snapshotRecordCount(validated.state));

    const actions = createElement("div", null, "wfr-actions");
    const exportButton = createElement("button", "先备份当前数据", "wfr-button");
    const confirmButton = createElement(
      "button",
      "确认完整替换",
      "wfr-button wfr-primary"
    );
    exportButton.type = "button";
    confirmButton.type = "button";
    exportButton.addEventListener("click", () => void exportBackup());
    confirmButton.addEventListener("click", () => {
      exportButton.disabled = true;
      confirmButton.disabled = true;
      if (updateRunning) {
        showFailure("恢复备份失败", {
          failureKind: "UPDATE_ALREADY_RUNNING",
        });
        return;
      }
      const restored = restoreValidatedBackup(validated, currentLoaded.raw);
      if (!restored.ok) {
        showFailure("恢复备份失败", restored);
        return;
      }
      const success = showPanel("备份已恢复", true);
      success.append(createElement("p", "备份已恢复。", "wfr-success"));
      addLine(success, "事件数", restored.state.events.length);
      addLine(success, "快照记录数", snapshotRecordCount(restored.state));
    });
    actions.append(exportButton, confirmButton);
    body.append(actions);
  }

  async function restoreBackup() {
    if (updateRunning) {
      showFailure("恢复备份", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("恢复备份", uidResult);
      return;
    }
    const currentLoaded = loadState(uidResult.uid);
    if (!currentLoaded.ok) {
      showFailure("恢复备份", currentLoaded);
      return;
    }

    let file;
    try {
      file = await selectBackupFile();
    } catch (error) {
      showFailure("恢复备份", {
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "FILE_READ_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }
    if (file === null) {
      const cancelled = showPanel("恢复已取消", true);
      cancelled.append(createElement("p", "恢复已取消。", "wfr-muted"));
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      showFailure("恢复备份", {
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "FILE_READ_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }
    const validated = validateBackupText(text, uidResult.uid);
    if (!validated.ok) {
      showFailure("恢复备份", validated);
      return;
    }
    showRestorePreview(validated, currentLoaded);
  }

  function backupExportError(backupStage, error) {
    const tagged = new Error("Backup export failed");
    tagged.name = error && error.name ? String(error.name) : "Error";
    tagged.backupStage = backupStage;
    return tagged;
  }

  function downloadBackup(json, filename) {
    let blob;
    try {
      blob = new Blob([json], { type: "application/json;charset=utf-8" });
    } catch (error) {
      throw backupExportError("FALLBACK_CREATE_BLOB", error);
    }
    let objectUrl;
    try {
      objectUrl = URL.createObjectURL(blob);
    } catch (error) {
      throw backupExportError("FALLBACK_CREATE_URL", error);
    }
    try {
      const link = createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        if (link.parentNode) link.parentNode.removeChild(link);
        setTimeout(
          () => URL.revokeObjectURL(objectUrl),
          OBJECT_URL_REVOKE_DELAY_MS
        );
      }
    } catch (error) {
      throw backupExportError("FALLBACK_TRIGGER_DOWNLOAD", error);
    }
  }

  async function saveBackup(json, filename) {
    if (
      typeof unsafeWindow !== "undefined" &&
      typeof unsafeWindow.showSaveFilePicker === "function"
    ) {
      let fileHandle;
      try {
        fileHandle = await unsafeWindow.showSaveFilePicker.call(
          unsafeWindow,
          {
            suggestedName: filename,
            types: [
              {
                description: "JSON backup",
                accept: { "application/json": [".json"] },
              },
            ],
          }
        );
      } catch (error) {
        const errorName = error && error.name ? String(error.name) : "Error";
        if (errorName === "AbortError") return { cancelled: true };
        if (errorName !== "NotAllowedError" && errorName !== "SecurityError") {
          throw backupExportError("PICKER_OPEN", error);
        }
        downloadBackup(json, filename);
        return { method: "browser-download", filename };
      }

      let writable;
      try {
        writable = await fileHandle.createWritable();
      } catch (error) {
        throw backupExportError("CREATE_WRITABLE", error);
      }
      try {
        await writable.write(json);
      } catch (error) {
        throw backupExportError("WRITE_FILE", error);
      }
      try {
        await writable.close();
      } catch (error) {
        throw backupExportError("CLOSE_FILE", error);
      }
      return {
        method: "save-picker",
        filename:
          typeof fileHandle.name === "string" && fileHandle.name.length > 0
            ? fileHandle.name
            : filename,
      };
    }

    downloadBackup(json, filename);
    return { method: "browser-download", filename };
  }

  async function exportBackup() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("导出备份", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("导出备份", loaded);
      return;
    }

    const exportedAt = new Date();
    const filename = backupFilename(uidResult.uid, exportedAt);
    let saveResult;
    try {
      const backup = createBackup(uidResult.uid, loaded.state, exportedAt);
      const json = serializeBackup(backup);
      saveResult = await saveBackup(json, filename);
    } catch (error) {
      showFailure("导出备份", {
        failureKind: "BACKUP_EXPORT_ERROR",
        backupStage: error && error.backupStage ? String(error.backupStage) : "PREPARE_BACKUP",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }

    if (saveResult.cancelled) {
      const body = showPanel("导出已取消", true);
      body.append(createElement("p", "导出已取消", "wfr-muted"));
      return;
    }

    const nativeSave = saveResult.method === "save-picker";
    const body = showPanel(
      nativeSave ? "备份已保存" : "已请求浏览器下载备份",
      true
    );
    if (!nativeSave) {
      body.append(
        createElement(
          "p",
          "备份已交给浏览器下载，保存位置及最终文件名由浏览器下载设置决定。",
          "wfr-success"
        )
      );
    }
    addLine(body, "账号 UID", uidResult.uid);
    addLine(
      body,
      "已有快照",
      loaded.state.latestSnapshot ? "是" : "否"
    );
    addLine(body, "事件数", loaded.state.events.length);
    addLine(body, nativeSave ? "文件名" : "建议文件名", saveResult.filename);
  }

  function setLauncherStatus(text, resetAfterMilliseconds) {
    if (!launcherButton) return;
    if (launcherStatusTimer !== null) {
      clearTimeout(launcherStatusTimer);
      launcherStatusTimer = null;
    }
    launcherButton.textContent = text;
    launcherButton.setAttribute("aria-label", text);
    if (typeof resetAfterMilliseconds === "number") {
      launcherStatusTimer = setTimeout(() => {
        launcherButton.textContent = "Weibo Toolkit";
        launcherButton.setAttribute("aria-label", "Weibo Toolkit");
        launcherStatusTimer = null;
      }, resetAfterMilliseconds);
    }
  }

  function pageLockManager() {
    try {
      if (
        typeof unsafeWindow !== "undefined" &&
        unsafeWindow.navigator &&
        unsafeWindow.navigator.locks &&
        typeof unsafeWindow.navigator.locks.request === "function"
      ) {
        return unsafeWindow.navigator.locks;
      }
    } catch (_) {
      // Automatic scanning fails safe when the page-realm LockManager is unavailable.
    }
    return null;
  }

  async function checkAutomaticUpdate() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) return uidResult;
    const preliminary = evaluateAutomaticUpdateEligibility(
      uidResult.uid,
      Date.now()
    );
    if (!preliminary.ok || !preliminary.eligible) return preliminary;

    const lockManager = pageLockManager();
    if (lockManager === null) {
      return { ok: true, eligible: false, reason: "LOCK_UNAVAILABLE" };
    }

    try {
      return await lockManager.request.call(
        lockManager,
        `weibo-toolkit-friend-radar-auto-${uidResult.uid}`,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock === null) {
            return { ok: true, eligible: false, reason: "LOCK_NOT_ACQUIRED" };
          }

          const lockedEligibility = evaluateAutomaticUpdateEligibility(
            uidResult.uid,
            Date.now()
          );
          if (!lockedEligibility.ok || !lockedEligibility.eligible) {
            return lockedEligibility;
          }
          if (updateRunning) {
            return { ok: true, eligible: false, reason: "UPDATE_ALREADY_RUNNING" };
          }
          const currentUid = determineCurrentUid();
          if (!currentUid.ok || currentUid.uid !== uidResult.uid) {
            return {
              ok: false,
              failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
            };
          }

          updateRunning = true;
          setLauncherStatus("关系雷达正在自动更新…");
          let result;
          try {
            result = await performUpdate(null, () =>
              saveLastAutomaticAttempt(
                uidResult.uid,
                new Date().toISOString()
              )
            );
          } catch (error) {
            result = {
              ok: false,
              failureKind: "UNKNOWN_FAILURE",
              errorName: error && error.name ? String(error.name) : "Error",
            };
          } finally {
            updateRunning = false;
          }
          setLauncherStatus(
            result.ok ? "关系雷达自动更新完成" : "关系雷达自动更新失败",
            AUTO_STATUS_DURATION_MS
          );
          return result;
        }
      );
    } catch (error) {
      return {
        ok: true,
        eligible: false,
        reason: "LOCK_REQUEST_FAILED",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function showAutoUpdateSettings(notice) {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("自动更新设置", uidResult);
      return;
    }
    const interval = loadAutoInterval(uidResult.uid);
    if (!interval.ok) {
      showFailure("自动更新设置", interval);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("自动更新设置", loaded);
      return;
    }
    const lastAttempt = loadLastAutomaticAttempt(uidResult.uid);
    if (!lastAttempt.ok) {
      showFailure("自动更新设置", lastAttempt);
      return;
    }

    const body = showPanel("自动更新设置", true);
    if (notice) body.append(createElement("p", notice, "wfr-success"));
    body.append(
      createElement(
        "p",
        "仅在打开网页版微博时检查，不会在浏览器后台定时运行。",
        "wfr-muted"
      )
    );
    if (loaded.state.latestSnapshot === null) {
      body.append(
        createElement(
          "p",
          "请先手动完成一次关系雷达更新，自动更新不会创建首个基线。",
          "wfr-muted"
        )
      );
    }
    const label = createElement("label", "自动更新：", "wfr-row");
    const select = createElement("select", null, "wfr-select");
    const choices = [
      [0, "关闭"],
      [24, "每 24 小时"],
      [48, "每 48 小时"],
      [72, "每 72 小时"],
      [168, "每 7 天"],
      [360, "每 15 天"],
    ];
    for (const [hours, text] of choices) {
      const option = createElement("option", text);
      option.value = String(hours);
      option.selected = hours === interval.value;
      select.append(option);
    }
    select.value = String(interval.value);
    label.append(select);
    body.append(label);
    addLine(
      body,
      "上次自动尝试",
      lastAttempt.value === null ? "—" : formatTime(lastAttempt.value)
    );

    const saveButton = createElement("button", "保存设置", "wfr-button wfr-primary");
    saveButton.type = "button";
    saveButton.addEventListener("click", () => {
      const currentUid = determineCurrentUid();
      if (!currentUid.ok || currentUid.uid !== uidResult.uid) {
        showFailure("自动更新设置", {
          failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
        });
        return;
      }
      const value = Number(select.value);
      if (!AUTO_INTERVAL_HOURS.includes(value)) {
        showFailure("自动更新设置", {
          failureKind: "STORAGE_ERROR",
          reason: "AUTO_INTERVAL_INVALID",
        });
        return;
      }
      const saved = saveAutoInterval(uidResult.uid, value);
      if (!saved.ok) {
        showFailure("自动更新设置", saved);
        return;
      }
      showAutoUpdateSettings("自动更新设置已保存。");
    });
    body.append(saveButton);
  }

  function showToolkitHome() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("Weibo Toolkit", uidResult, false);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("Weibo Toolkit", loaded, false);
      return;
    }

    const body = showPanel("Weibo Toolkit");
    const snapshot = loaded.state.latestSnapshot;
    const unread = loaded.state.events.filter((event) => !event.read).length;
    const moduleTitle = createElement("p", null, "wfr-row");
    moduleTitle.append(createElement("strong", "关系雷达"));
    body.append(moduleTitle);
    addLine(
      body,
      "上次成功更新",
      snapshot ? formatTime(snapshot.capturedAt) : "—"
    );
    addLine(body, "可见关注", snapshot ? snapshot.visibleCount : "—");
    addLine(body, "未读事件", unread);

    const actions = createElement("div", null, "wfr-actions");
    const updateButton = createElement("button", "立即更新", "wfr-button wfr-primary");
    const eventsButton = createElement("button", "查看事件", "wfr-button");
    const statusButton = createElement("button", "查看状态", "wfr-button");
    const exportButton = createElement("button", "导出备份", "wfr-button");
    const restoreButton = createElement("button", "恢复备份", "wfr-button");
    const autoSettingsButton = createElement(
      "button",
      "自动更新设置",
      "wfr-button"
    );
    for (const button of [
      updateButton,
      eventsButton,
      statusButton,
      exportButton,
      restoreButton,
      autoSettingsButton,
    ]) {
      button.type = "button";
    }
    updateButton.addEventListener("click", () => void updateNow());
    eventsButton.addEventListener("click", viewEvents);
    statusButton.addEventListener("click", viewStatus);
    exportButton.addEventListener("click", exportBackup);
    restoreButton.addEventListener("click", () => void restoreBackup());
    autoSettingsButton.addEventListener("click", showAutoUpdateSettings);
    actions.append(
      updateButton,
      eventsButton,
      statusButton,
      exportButton,
      restoreButton,
      autoSettingsButton
    );
    body.append(actions);
  }

  function installToolkitLauncher() {
    if (!document.body) return;
    const button = createElement("button", "Weibo Toolkit", "wfr-button wfr-toolkit-launcher");
    button.type = "button";
    button.setAttribute("aria-label", "Weibo Toolkit");
    button.addEventListener("click", showToolkitHome);
    document.body.append(button);
    launcherButton = button;
  }

  function installStyles() {
    const style = createElement("style");
    style.textContent = `
      .wfr-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(0,0,0,.45); padding: 28px; overflow: auto; box-sizing: border-box; }
      .wfr-panel { max-width: 720px; margin: 0 auto; background: #fff; color: #222; border-radius: 8px; box-shadow: 0 12px 36px rgba(0,0,0,.25); font: 14px/1.5 system-ui, sans-serif; }
      .wfr-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #ddd; }
      .wfr-header h2 { margin: 0; font-size: 18px; }
      .wfr-body { padding: 18px 20px 22px; }
      .wfr-row { margin: 7px 0; overflow-wrap: anywhere; }
      .wfr-button { border: 1px solid #bbb; border-radius: 5px; background: #fff; color: #222; padding: 6px 10px; cursor: pointer; }
      .wfr-button:disabled { opacity: .55; cursor: default; }
      .wfr-primary { margin: 10px 0 14px; background: #1677ff; border-color: #1677ff; color: #fff; }
      .wfr-success { color: #176b2c; font-weight: 600; }
      .wfr-error { color: #a11919; font-weight: 600; }
      .wfr-muted { color: #666; }
      .wfr-search { width: 100%; box-sizing: border-box; margin-top: 12px; padding: 6px 9px; border: 1px solid #bbb; border-radius: 5px; background: #fff; color: #222; font: inherit; }
      .wfr-select { margin-left: 8px; padding: 5px 8px; border: 1px solid #bbb; border-radius: 5px; background: #fff; color: #222; font: inherit; }
      .wfr-event-list { display: grid; gap: 10px; margin-top: 14px; }
      .wfr-event { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; }
      .wfr-event h3 { margin: 0 0 6px; font-size: 14px; }
      .wfr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .wfr-actions .wfr-primary { margin: 0; }
      .wfr-toolkit-launcher { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; padding: 4px 9px; border: 1px solid rgba(127,127,127,.18); border-radius: 999px; background: rgba(127,127,127,.1); color: inherit; box-shadow: none; font: inherit; font-size: 12px; line-height: 1.4; opacity: .62; transition: opacity 100ms ease, background-color 100ms ease, border-color 100ms ease; }
      .wfr-toolkit-launcher:hover, .wfr-toolkit-launcher:focus-visible { border-color: rgba(127,127,127,.3); background: rgba(127,127,127,.18); opacity: .96; }
    `;
    document.head.append(style);
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") return;
    GM_registerMenuCommand("Weibo Toolkit：立即更新", () => void updateNow());
    GM_registerMenuCommand("Weibo Toolkit：查看事件", viewEvents);
    GM_registerMenuCommand("Weibo Toolkit：查看状态", viewStatus);
    GM_registerMenuCommand("Weibo Toolkit：导出备份", exportBackup);
  }

  installStyles();
  registerMenuCommands();
  installToolkitLauncher();
  setTimeout(() => void checkAutomaticUpdate(), AUTO_STARTUP_DELAY_MS);
})();
