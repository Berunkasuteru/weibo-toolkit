// ==UserScript==
// @name         Weibo Toolkit - Friend Radar
// @namespace    local.weibo-toolkit
// @version      0.3.0
// @description  Manual Friend Radar with an independent Weibo Toolkit launcher.
// @match        https://weibo.com/*
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
  const MAX_REQUESTS = 30;
  const APP_VERSION = "0.3.0";
  const SCHEMA_VERSION = 1;
  const STORAGE_PREFIX = "weiboToolkit.friendRadar.v1.";
  const BACKUP_FORMAT = "weibo-toolkit.friend-radar";
  const BACKUP_VERSION = 1;

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
    STORAGE_ERROR: "本地状态无法读取",
    BACKUP_EXPORT_ERROR: "备份导出失败",
    UPDATE_ALREADY_RUNNING: "更新正在进行",
    UNKNOWN_FAILURE: "未知失败",
  });

  const hasOwn = (value, key) =>
    Object.prototype.hasOwnProperty.call(value, key);

  let updateRunning = false;
  let panelRoot = null;

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

  async function scanFollowing(ownerUid) {
    const recordsByUid = new Map();
    const seenNextCursors = new Set();
    const seenPaginationStates = new Set();
    let reportedTotal = null;
    let previousPageNextCursor = null;
    let requestsMade = 0;

    for (let page = 1; page <= MAX_REQUESTS; page += 1) {
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

  function persistState(ownerUid, state, previousRaw) {
    const key = storageKey(ownerUid);
    const serialized = JSON.stringify(state);
    try {
      GM_setValue(key, serialized);
      const verified = GM_getValue(key, null);
      if (verified !== serialized) {
        throw new Error("Stored value verification failed");
      }
      return { ok: true };
    } catch (error) {
      let rollbackSucceeded = false;
      try {
        if (previousRaw === null) {
          GM_deleteValue(key);
        } else {
          GM_setValue(key, previousRaw);
        }
        rollbackSucceeded = GM_getValue(key, null) === previousRaw;
      } catch (_) {
        rollbackSucceeded = false;
      }
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
        rollbackSucceeded,
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

  async function performUpdate() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) return uidResult;

    const scan = await scanFollowing(uidResult.uid);
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

    const persisted = persistState(uidResult.uid, prepared.state, loaded.raw);
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
      backButton.addEventListener("click", showToolkitHome);
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
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "HARD_REQUEST_CEILING_REACHED"
    ) {
      return "本次扫描达到安全请求上限，未保存扫描结果。";
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
    if (typeof result.failedPage === "number") {
      addLine(body, "停止页", result.failedPage);
    }
    if (typeof result.requestsMade === "number") {
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

  async function updateNow() {
    if (updateRunning) {
      showFailure("关系雷达更新", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const progress = showPanel("关系雷达更新");
    progress.append(
      createElement(
        "p",
        "正在按顺序读取可见关注，请保持页面打开。"
      )
    );
    updateRunning = true;
    let result;
    try {
      result = await performUpdate();
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

  function describeEvent(event) {
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      return `${event.previous.screenName} → ${event.current.screenName}`;
    }
    return EVENT_LABELS[event.type] || event.type;
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
        const saved = persistState(ownerUid, nextState, fresh.raw);
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

    const list = createElement("div", null, "wfr-event-list");
    const newestFirst = [...state.events].sort((a, b) =>
      b.detectedAt.localeCompare(a.detectedAt) || b.id.localeCompare(a.id)
    );
    for (const event of newestFirst) {
      const item = createElement("article", null, "wfr-event");
      const title = createElement(
        "h3",
        `${event.read ? "已读" : "未读"} · ${EVENT_LABELS[event.type] || event.type}`
      );
      item.append(title);
      addLine(item, "时间", formatTime(event.detectedAt));
      addLine(item, "名称", event.displayName);
      if (event.type === EVENT.SCREEN_NAME_CHANGED) {
        addLine(item, "变化", describeEvent(event));
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
    for (const button of [updateButton, eventsButton, statusButton, exportButton]) {
      button.type = "button";
    }
    updateButton.addEventListener("click", () => void updateNow());
    eventsButton.addEventListener("click", viewEvents);
    statusButton.addEventListener("click", viewStatus);
    exportButton.addEventListener("click", exportBackup);
    actions.append(updateButton, eventsButton, statusButton, exportButton);
    body.append(actions);
  }

  function installToolkitLauncher() {
    if (!document.body) return;
    const button = createElement("button", "Weibo Toolkit", "wfr-button wfr-toolkit-launcher");
    button.type = "button";
    button.setAttribute("aria-label", "Weibo Toolkit");
    button.addEventListener("click", showToolkitHome);
    document.body.append(button);
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
})();
