
  function normalizeFollowerOptionalBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }

  function normalizeFollowerOptionalCount(value) {
    return normalizeNonNegativeInteger(value);
  }

  function normalizeFollowerOptionalVerifiedType(value) {
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      const parsed = Number(value.trim());
      return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
  }

  function normalizeFollowerOptionalDate(value) {
    if (typeof value !== "string") return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function normalizeFollowerOptionalString(value) {
    return typeof value === "string" ? value : null;
  }

  function normalizeFollowerRecord(user) {
    if (!isPlainObject(user)) {
      return { ok: false, reason: "USER_RECORD_NOT_OBJECT" };
    }
    if (!hasOwn(user, "id") || !hasOwn(user, "idstr")) {
      return { ok: false, reason: "MEMBERSHIP_IDENTIFIER_MISSING" };
    }
    const id = normalizeStableUid(user.id);
    const idstr = normalizeStableUid(user.idstr);
    if (id === null || idstr === null || id !== idstr) {
      return { ok: false, reason: "UNUSABLE_OR_CONFLICTING_STABLE_UID" };
    }
    const sourceText =
      isPlainObject(user.origin_source_info) &&
      typeof user.origin_source_info.text === "string"
        ? user.origin_source_info.text
        : null;
    return {
      ok: true,
      record: {
        uid: idstr,
        screenName: normalizeFollowerOptionalString(user.screen_name),
        ownerFollowing: normalizeFollowerOptionalBoolean(user.following),
        followMe: normalizeFollowerOptionalBoolean(user.follow_me),
        followersCount: normalizeFollowerOptionalCount(user.followers_count),
        friendsCount: normalizeFollowerOptionalCount(user.friends_count),
        statusesCount: normalizeFollowerOptionalCount(user.statuses_count),
        createdAt: normalizeFollowerOptionalDate(user.created_at),
        verified: normalizeFollowerOptionalBoolean(user.verified),
        verifiedType: normalizeFollowerOptionalVerifiedType(user.verified_type),
        sourceText,
        optionalMetadataConflict: false,
      },
    };
  }

  const FOLLOWER_OPTIONAL_RECORD_FIELDS = Object.freeze([
    "screenName",
    "ownerFollowing",
    "followMe",
    "followersCount",
    "friendsCount",
    "statusesCount",
    "createdAt",
    "verified",
    "verifiedType",
    "sourceText",
  ]);

  function mergeFollowerRecords(existing, incoming) {
    let conflictObserved = existing.record.optionalMetadataConflict;
    for (const field of FOLLOWER_OPTIONAL_RECORD_FIELDS) {
      if (existing.conflicts.has(field)) continue;
      const before = existing.record[field];
      const after = incoming[field];
      if (before === null) {
        existing.record[field] = after;
      } else if (after !== null && before !== after) {
        existing.record[field] = null;
        existing.conflicts.add(field);
        conflictObserved = true;
      }
    }
    existing.record.optionalMetadataConflict = conflictObserved;
    return conflictObserved;
  }

  function buildFollowerRequestUrl(ownerUid, page) {
    const url = new URL(ENDPOINT, location.origin);
    url.searchParams.set("uid", ownerUid);
    url.searchParams.set("relate", "fans");
    url.searchParams.set("type", "fans");
    url.searchParams.set("fansSortType", "followTime");
    url.searchParams.set("count", String(FOLLOWER_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    return url;
  }

  async function requestFollowerPage(ownerUid, page) {
    const url = buildFollowerRequestUrl(ownerUid, page);
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
      // Classified below.
    }
    if (looksLikeLoginUrl(response.url) || response.status === 401) {
      return { ok: false, failureKind: "LOGIN_REQUIRED", httpStatus: response.status };
    }
    if (!response.ok || response.status !== 200) {
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
      return {
        ok: false,
        failureKind: "NON_JSON_RESPONSE",
        httpStatus: response.status,
      };
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

  function createFollowerTriStateTracker() {
    return { anyTrue: false, observedFalse: 0, unknown: false };
  }

  function observeFollowerTriState(tracker, data, field) {
    if (!hasOwn(data, field) || typeof data[field] !== "boolean") {
      tracker.unknown = true;
      return;
    }
    if (data[field] === true) tracker.anyTrue = true;
    else tracker.observedFalse += 1;
  }

  function finishFollowerTriState(tracker) {
    if (tracker.anyTrue) return FOLLOWER_FILTER_STATE.TRUE;
    if (!tracker.unknown && tracker.observedFalse > 0) {
      return FOLLOWER_FILTER_STATE.FALSE;
    }
    return FOLLOWER_FILTER_STATE.UNKNOWN;
  }

  function createFollowerTotalTracker() {
    return { observed: false, invalid: false, conflict: false, value: null };
  }

  function observeFollowerTotal(tracker, data, field) {
    if (!hasOwn(data, field)) return;
    const value = normalizeNonNegativeInteger(data[field]);
    if (value === null) {
      tracker.invalid = true;
      return;
    }
    if (!tracker.observed) {
      tracker.observed = true;
      tracker.value = value;
    } else if (tracker.value !== value) {
      tracker.conflict = true;
    }
  }

  function finishFollowerTotal(tracker) {
    return tracker.observed && !tracker.invalid && !tracker.conflict
      ? tracker.value
      : null;
  }

  function validateFollowerPageData(data, page) {
    if (!isPlainObject(data)) {
      return { ok: false, reason: "TOP_LEVEL_NOT_OBJECT" };
    }
    if (!hasOwn(data, "ok") || ![1, "1", true].includes(data.ok)) {
      return { ok: false, reason: "API_OK_INDICATOR_NOT_SUCCESS" };
    }
    if (!Array.isArray(data.users)) {
      return { ok: false, reason: "USERS_ARRAY_MISSING_OR_INVALID" };
    }
    const previousCursor = hasOwn(data, "previous_cursor")
      ? normalizeNonNegativeInteger(data.previous_cursor)
      : null;
    const nextCursor = hasOwn(data, "next_cursor")
      ? normalizeNonNegativeInteger(data.next_cursor)
      : null;
    if (previousCursor === null || nextCursor === null) {
      return { ok: false, reason: "INVALID_CURSOR_VALUE" };
    }
    if (page === 1 && previousCursor !== 0) {
      return { ok: false, reason: "FIRST_PAGE_PREVIOUS_CURSOR_NOT_ZERO" };
    }
    const nextPage = hasOwn(data, "next_page")
      ? normalizeNonNegativeInteger(data.next_page)
      : null;
    if (hasOwn(data, "next_page") && nextPage === null) {
      return { ok: false, reason: "INVALID_NEXT_PAGE_VALUE" };
    }
    return { ok: true, previousCursor, nextCursor, nextPage };
  }

  function reportFollowerScanProgress(onProgress, progress) {
    if (typeof onProgress !== "function") return;
    try {
      onProgress(progress);
    } catch (_) {
      // Presentation cannot affect scan integrity.
    }
  }

  async function scanFollowers(ownerUid, onProgress, isCancelled, options = {}) {
    const recordsByUid = new Map();
    const seenPaginationStates = new Set();
    const hasFilteredFans = createFollowerTriStateTracker();
    const sinkStrategy = createFollowerTriStateTracker();
    const totalNumber = createFollowerTotalTracker();
    const displayTotalNumber = createFollowerTotalTracker();
    const followersCount = createFollowerTotalTracker();
    let requestsMade = 0;
    let dataPagesRead = 0;
    let terminalVerificationRequests = 0;
    let rawRecordCount = 0;
    let crossPageDuplicateCount = 0;
    let optionalMetadataConflictObserved = false;
    let previousPageWasNonempty = false;
    const finalRequestPage =
      FOLLOWER_MAX_DATA_PAGES + FOLLOWER_MAX_TERMINAL_VERIFICATION_REQUESTS;

    for (let page = 1; page <= finalRequestPage; page += 1) {
      if (typeof isCancelled === "function" && isCancelled()) {
        return { ok: false, failureKind: "FOLLOWER_SCAN_CANCELLED", requestsMade };
      }
      if (requestsMade > 0) await delay(FOLLOWER_REQUEST_DELAY_MS);
      if (typeof isCancelled === "function" && isCancelled()) {
        return { ok: false, failureKind: "FOLLOWER_SCAN_CANCELLED", requestsMade };
      }
      const ownerBeforeRequest = determineCurrentUid();
      if (!ownerBeforeRequest.ok || ownerBeforeRequest.uid !== ownerUid) {
        return {
          ok: false,
          failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
          requestsMade,
          failedPage: page,
        };
      }

      requestsMade += 1;
      const request = await requestFollowerPage(ownerUid, page);
      if (!request.ok) return { ...request, requestsMade, failedPage: page };
      if (typeof isCancelled === "function" && isCancelled()) {
        return { ok: false, failureKind: "FOLLOWER_SCAN_CANCELLED", requestsMade };
      }
      const validation = validateFollowerPageData(request.data, page);
      if (!validation.ok) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: validation.reason,
          requestsMade,
          failedPage: page,
        };
      }
      const paginationState =
        String(validation.previousCursor) +
        ":" +
        String(validation.nextCursor) +
        ":" +
        String(request.data.users.length);
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

      observeFollowerTriState(
        hasFilteredFans,
        request.data,
        "has_filtered_fans"
      );
      observeFollowerTriState(
        sinkStrategy,
        request.data,
        "use_sink_stragety"
      );
      observeFollowerTotal(totalNumber, request.data, "total_number");
      observeFollowerTotal(
        displayTotalNumber,
        request.data,
        "display_total_number"
      );
      observeFollowerTotal(followersCount, request.data, "followers_count");

      if (request.data.users.length === 0) {
        terminalVerificationRequests += 1;
        if (!previousPageWasNonempty || validation.nextCursor !== 0) {
          return {
            ok: false,
            failureKind: "PAGINATION_FAILURE",
            reason: "UNEXPECTED_TERMINAL_PAGE",
            requestsMade,
            failedPage: page,
          };
        }
        const hasFilteredFansState = finishFollowerTriState(hasFilteredFans);
        const sinkStrategyState = finishFollowerTriState(sinkStrategy);
        const records = [...recordsByUid.values()]
          .map((entry) => entry.record)
          .sort((left, right) => left.uid.localeCompare(right.uid));
        return {
          ok: true,
          requestsMade,
          snapshot: {
            schemaVersion: FOLLOWER_SNAPSHOT_SCHEMA_VERSION,
            ownerUid,
            capturedAt: new Date().toISOString(),
            completion: FOLLOWER_COMPLETION,
            pageSizeRequested: FOLLOWER_PAGE_SIZE,
            dataPagesRead,
            terminalVerificationRequests,
            requestsMade,
            rawRecordCount,
            uniqueRecordCount: records.length,
            crossPageDuplicateCount,
            hasFilteredFansState,
            sinkStrategyState,
            filteredVisibilityObserved:
              hasFilteredFansState === FOLLOWER_FILTER_STATE.TRUE ||
              sinkStrategyState === FOLLOWER_FILTER_STATE.TRUE,
            optionalMetadataConflictObserved,
            totalNumber: finishFollowerTotal(totalNumber),
            displayTotalNumber: finishFollowerTotal(displayTotalNumber),
            followersCount: finishFollowerTotal(followersCount),
            terminalEvidence: {
              page,
              recordCount: 0,
              previousCursor: validation.previousCursor,
              nextCursor: validation.nextCursor,
              nextPage: validation.nextPage,
            },
            records,
          },
        };
      }

      if (page > FOLLOWER_MAX_DATA_PAGES) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "FOLLOWER_SAFETY_CEILING_REACHED",
          requestsMade,
          failedPage: page,
          visibleRecordsCollected: recordsByUid.size,
        };
      }

      dataPagesRead += 1;
      previousPageWasNonempty = true;
      const pageUids = new Set();
      rawRecordCount += request.data.users.length;
      for (let index = 0; index < request.data.users.length; index += 1) {
        const normalized = normalizeFollowerRecord(request.data.users[index]);
        if (!normalized.ok) {
          return {
            ok: false,
            failureKind: "UNEXPECTED_SCHEMA",
            reason: normalized.reason,
            requestsMade,
            failedPage: page,
            failedRecordIndex: index,
          };
        }
        if (pageUids.has(normalized.record.uid)) {
          return {
            ok: false,
            failureKind: "PAGINATION_FAILURE",
            reason: "UNEXPECTED_WITHIN_PAGE_DUPLICATE",
            requestsMade,
            failedPage: page,
          };
        }
        pageUids.add(normalized.record.uid);
        const existing = recordsByUid.get(normalized.record.uid);
        if (existing) {
          crossPageDuplicateCount += 1;
          if (mergeFollowerRecords(existing, normalized.record)) {
            optionalMetadataConflictObserved = true;
          }
        } else {
          recordsByUid.set(normalized.record.uid, {
            record: normalized.record,
            conflicts: new Set(),
          });
        }
      }
      reportFollowerScanProgress(onProgress, {
        page,
        requestsMade,
        rawRecordCount,
        uniqueRecordCount: recordsByUid.size,
        crossPageDuplicateCount,
      });
    }

    return {
      ok: false,
      failureKind: "PAGINATION_FAILURE",
      reason: "FOLLOWER_SAFETY_CEILING_REACHED",
      requestsMade,
      visibleRecordsCollected: recordsByUid.size,
    };
  }

  function followerStorageKey(ownerUid) {
    return FOLLOWER_SNAPSHOT_STORAGE_PREFIX + ownerUid;
  }

  function emptyFollowerState(ownerUid) {
    return {
      schemaVersion: FOLLOWER_SNAPSHOT_SCHEMA_VERSION,
      ownerUid,
      latestSnapshot: null,
      events: [],
    };
  }

  function isValidFollowerOptionalValue(value, type) {
    return value === null || typeof value === type;
  }

  function isValidFollowerStoredRecord(record) {
    return Boolean(
      isPlainObject(record) &&
        typeof record.uid === "string" &&
        normalizeStableUid(record.uid) === record.uid &&
        isValidFollowerOptionalValue(record.screenName, "string") &&
        isValidFollowerOptionalValue(record.ownerFollowing, "boolean") &&
        isValidFollowerOptionalValue(record.followMe, "boolean") &&
        (record.followersCount === null ||
          (Number.isSafeInteger(record.followersCount) &&
            record.followersCount >= 0)) &&
        (record.friendsCount === null ||
          (Number.isSafeInteger(record.friendsCount) &&
            record.friendsCount >= 0)) &&
        (record.statusesCount === null ||
          (Number.isSafeInteger(record.statusesCount) &&
            record.statusesCount >= 0)) &&
        (record.createdAt === null ||
          (typeof record.createdAt === "string" &&
            Number.isFinite(Date.parse(record.createdAt)))) &&
        isValidFollowerOptionalValue(record.verified, "boolean") &&
        (record.verifiedType === null ||
          Number.isSafeInteger(record.verifiedType)) &&
        isValidFollowerOptionalValue(record.sourceText, "string") &&
        typeof record.optionalMetadataConflict === "boolean"
    );
  }

  function isValidFollowerFilterState(value) {
    return Object.values(FOLLOWER_FILTER_STATE).includes(value);
  }

  function isValidFollowerStoredSnapshot(snapshot) {
    if (
      !isPlainObject(snapshot) ||
      snapshot.schemaVersion !== FOLLOWER_SNAPSHOT_SCHEMA_VERSION ||
      typeof snapshot.ownerUid !== "string" ||
      normalizeStableUid(snapshot.ownerUid) !== snapshot.ownerUid ||
      typeof snapshot.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      snapshot.completion !== FOLLOWER_COMPLETION ||
      snapshot.pageSizeRequested !== FOLLOWER_PAGE_SIZE ||
      !Number.isSafeInteger(snapshot.dataPagesRead) ||
      snapshot.dataPagesRead < 1 ||
      snapshot.dataPagesRead > FOLLOWER_MAX_DATA_PAGES ||
      snapshot.terminalVerificationRequests !== 1 ||
      !Number.isSafeInteger(snapshot.requestsMade) ||
      snapshot.requestsMade !==
        snapshot.dataPagesRead + snapshot.terminalVerificationRequests ||
      !Number.isSafeInteger(snapshot.rawRecordCount) ||
      snapshot.rawRecordCount < 1 ||
      !Number.isSafeInteger(snapshot.uniqueRecordCount) ||
      snapshot.uniqueRecordCount < 1 ||
      !Number.isSafeInteger(snapshot.crossPageDuplicateCount) ||
      snapshot.crossPageDuplicateCount < 0 ||
      snapshot.rawRecordCount - snapshot.uniqueRecordCount !==
        snapshot.crossPageDuplicateCount ||
      !isValidFollowerFilterState(snapshot.hasFilteredFansState) ||
      !isValidFollowerFilterState(snapshot.sinkStrategyState) ||
      typeof snapshot.filteredVisibilityObserved !== "boolean" ||
      snapshot.filteredVisibilityObserved !==
        (snapshot.hasFilteredFansState === FOLLOWER_FILTER_STATE.TRUE ||
          snapshot.sinkStrategyState === FOLLOWER_FILTER_STATE.TRUE) ||
      typeof snapshot.optionalMetadataConflictObserved !== "boolean" ||
      !isPlainObject(snapshot.terminalEvidence) ||
      !Number.isSafeInteger(snapshot.terminalEvidence.page) ||
      snapshot.terminalEvidence.page !== snapshot.dataPagesRead + 1 ||
      snapshot.terminalEvidence.recordCount !== 0 ||
      !Number.isSafeInteger(snapshot.terminalEvidence.previousCursor) ||
      snapshot.terminalEvidence.previousCursor < 0 ||
      snapshot.terminalEvidence.nextCursor !== 0 ||
      !(
        snapshot.terminalEvidence.nextPage === null ||
        (Number.isSafeInteger(snapshot.terminalEvidence.nextPage) &&
          snapshot.terminalEvidence.nextPage >= 0)
      ) ||
      !Array.isArray(snapshot.records) ||
      snapshot.records.length !== snapshot.uniqueRecordCount
    ) {
      return false;
    }
    for (const field of ["totalNumber", "displayTotalNumber", "followersCount"]) {
      if (
        snapshot[field] !== null &&
        (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0)
      ) {
        return false;
      }
    }
    const seen = new Set();
    for (const record of snapshot.records) {
      if (!isValidFollowerStoredRecord(record) || seen.has(record.uid)) {
        return false;
      }
      seen.add(record.uid);
    }
    return true;
  }

  function isValidFollowerStoredEvent(event) {
    return Boolean(
      isPlainObject(event) &&
        typeof event.id === "string" &&
        event.id.length > 0 &&
        Object.values(FOLLOWER_EVENT).includes(event.type) &&
        typeof event.uid === "string" &&
        normalizeStableUid(event.uid) === event.uid &&
        typeof event.observedAt === "string" &&
        Number.isFinite(Date.parse(event.observedAt)) &&
        isValidFollowerOptionalValue(event.displayName, "string")
    );
  }

  function isValidFollowerStoredState(state, ownerUid) {
    return Boolean(
      isPlainObject(state) &&
        state.schemaVersion === FOLLOWER_SNAPSHOT_SCHEMA_VERSION &&
        state.ownerUid === ownerUid &&
        (state.latestSnapshot === null ||
          (isValidFollowerStoredSnapshot(state.latestSnapshot) &&
            state.latestSnapshot.ownerUid === ownerUid)) &&
        Array.isArray(state.events) &&
        state.events.every(isValidFollowerStoredEvent)
    );
  }

  function loadFollowerState(ownerUid) {
    try {
      const key = followerStorageKey(ownerUid);
      const raw = GM_getValue(key, null);
      if (raw === null || typeof raw === "undefined") {
        return { ok: true, state: emptyFollowerState(ownerUid), raw: null };
      }
      if (typeof raw !== "string") {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_STATE_NOT_STRING",
        };
      }
      const state = JSON.parse(raw);
      if (!isValidFollowerStoredState(state, ownerUid)) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_STATE_SCHEMA_INVALID",
        };
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

  function persistFollowerState(ownerUid, state, expectedRaw) {
    const key = followerStorageKey(ownerUid);
    const serialized = JSON.stringify(state);
    try {
      const currentRaw = GM_getValue(key, null);
      if (currentRaw !== expectedRaw) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      GM_setValue(key, serialized);
      if (GM_getValue(key, null) !== serialized) {
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

  // Cross-tab serialization for the follower state's local read-modify-write
  // transactions. GM_getValue/GM_setValue offer no atomic compare-and-swap, so
  // the check-then-set inside persistFollowerState is an integrity check, not a
  // cross-tab guarantee: this lock is what actually serializes tabs.
  //
  // The lock is owner-scoped, so two accounts never block each other, and it is
  // held only for local storage work. Network scanning, follower-removal POSTs
  // and batch pacing all stay outside it.
  const FOLLOWER_STATE_LOCK_PREFIX = "weibo-toolkit-follower-state-";

  function followerStateLockUnavailable(reason, error) {
    const result = {
      ok: false,
      failureKind: "STATE_LOCK_UNAVAILABLE",
      reason,
    };
    if (error) result.errorName = error.name ? String(error.name) : "Error";
    return result;
  }

  // The transaction body must stay short and purely local. It is awaited while
  // the lock is held, so it must never fetch, wait, or open UI.
  async function withFollowerStateLock(ownerUid, transaction) {
    const lockManager = pageLockManager();
    if (lockManager === null) {
      return followerStateLockUnavailable("LOCK_UNAVAILABLE");
    }
    try {
      return await lockManager.request.call(
        lockManager,
        FOLLOWER_STATE_LOCK_PREFIX + ownerUid,
        { mode: "exclusive" },
        async (lock) => {
          if (lock === null) {
            return followerStateLockUnavailable("LOCK_NOT_ACQUIRED");
          }
          return await transaction();
        }
      );
    } catch (error) {
      return followerStateLockUnavailable("LOCK_REQUEST_FAILED", error);
    }
  }

  function followerRemovalPendingKey(ownerUid) {
    return FOLLOWER_REMOVAL_PENDING_STORAGE_PREFIX + ownerUid;
  }

  function isValidFollowerRemovalPendingEntry(entry) {
    return Boolean(
      isPlainObject(entry) &&
        typeof entry.confirmedAt === "number" &&
        Number.isFinite(entry.confirmedAt)
    );
  }

  function isValidFollowerRemovalPendingState(state, ownerUid) {
    if (
      !isPlainObject(state) ||
      state.schemaVersion !== FOLLOWER_REMOVAL_PENDING_SCHEMA_VERSION ||
      state.ownerUid !== ownerUid ||
      !isPlainObject(state.pending)
    ) {
      return false;
    }
    for (const uid of Object.keys(state.pending)) {
      if (
        normalizeStableUid(uid) !== uid ||
        !isValidFollowerRemovalPendingEntry(state.pending[uid])
      ) {
        return false;
      }
    }
    return true;
  }

  // Unreadable or malformed reconciliation state is treated as "nothing pending".
  // It must never block a removal or a Snapshot: the worst consequence is one
  // ordinary, neutral disappearance event.
  function loadFollowerRemovalPending(ownerUid) {
    try {
      const raw = GM_getValue(followerRemovalPendingKey(ownerUid), null);
      if (raw === null || typeof raw !== "string") return { pending: {}, raw: null };
      const state = JSON.parse(raw);
      if (!isValidFollowerRemovalPendingState(state, ownerUid)) {
        return { pending: {}, raw };
      }
      return { pending: state.pending, raw };
    } catch (_) {
      return { pending: {}, raw: null };
    }
  }

  function saveFollowerRemovalPending(ownerUid, pending) {
    try {
      const key = followerRemovalPendingKey(ownerUid);
      if (Object.keys(pending).length === 0) {
        GM_deleteValue(key);
        return { ok: true };
      }
      GM_setValue(
        key,
        JSON.stringify({
          schemaVersion: FOLLOWER_REMOVAL_PENDING_SCHEMA_VERSION,
          ownerUid,
          pending,
        })
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function prunedFollowerRemovalPending(pending, nowMs) {
    const kept = {};
    for (const uid of Object.keys(pending)) {
      const entry = pending[uid];
      if (nowMs - entry.confirmedAt < FOLLOWER_REMOVAL_PENDING_TTL_MS) {
        kept[uid] = entry;
      }
    }
    return kept;
  }

  // Unlocked helper: the caller must already hold the follower state lock. The
  // read happens here, inside the transaction, so a concurrently recorded UID is
  // merged instead of overwritten.
  function mergeConfirmedFollowerRemoval(ownerUid, canonicalUid, nowMs) {
    const loaded = loadFollowerRemovalPending(ownerUid);
    const pending = prunedFollowerRemovalPending(loaded.pending, nowMs);
    pending[canonicalUid] = { confirmedAt: nowMs };
    return saveFollowerRemovalPending(ownerUid, pending);
  }

  // Called only after a removal response has been fully validated as successful.
  // A failure here is deliberately non-fatal: the Weibo mutation already
  // succeeded, so an unavailable lock only costs the later event suppression,
  // and the disappearance is then reported by ordinary neutral semantics.
  async function recordConfirmedFollowerRemoval(ownerUid, uid, nowMs) {
    const canonicalUid = normalizeStableUid(uid);
    if (canonicalUid === null || canonicalUid !== uid) return { ok: false };
    return await withFollowerStateLock(ownerUid, async () =>
      mergeConfirmedFollowerRemoval(ownerUid, canonicalUid, nowMs)
    );
  }

  function followerFilteringFingerprint(snapshot) {
    if (
      snapshot.hasFilteredFansState === FOLLOWER_FILTER_STATE.UNKNOWN ||
      snapshot.sinkStrategyState === FOLLOWER_FILTER_STATE.UNKNOWN
    ) {
      return null;
    }
    return (
      snapshot.hasFilteredFansState + "/" + snapshot.sinkStrategyState
    );
  }

  function makeFollowerEvent(type, record, observedAt, index) {
    return {
      id:
        observedAt +
        ":" +
        String(index + 1) +
        ":" +
        type +
        ":" +
        record.uid,
      type,
      uid: record.uid,
      observedAt,
      displayName: record.screenName,
    };
  }

  function diffFollowerSnapshots(previousSnapshot, currentSnapshot) {
    const previousFingerprint = followerFilteringFingerprint(previousSnapshot);
    const currentFingerprint = followerFilteringFingerprint(currentSnapshot);
    if (
      previousFingerprint === null ||
      currentFingerprint === null ||
      previousFingerprint !== currentFingerprint
    ) {
      return {
        events: [],
        suppressed: true,
        reason: "FILTERING_FINGERPRINT_CHANGED_OR_UNKNOWN",
      };
    }
    const previous = new Map(
      previousSnapshot.records.map((record) => [record.uid, record])
    );
    const current = new Map(
      currentSnapshot.records.map((record) => [record.uid, record])
    );
    const events = [];
    const added = [...current.keys()]
      .filter((uid) => !previous.has(uid))
      .sort();
    for (const uid of added) {
      events.push(
        makeFollowerEvent(
          FOLLOWER_EVENT.VISIBLE_FOLLOWER_ADDED,
          current.get(uid),
          currentSnapshot.capturedAt,
          events.length
        )
      );
    }
    const disappeared = [...previous.keys()]
      .filter((uid) => !current.has(uid))
      .sort();
    for (const uid of disappeared) {
      events.push(
        makeFollowerEvent(
          FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED,
          previous.get(uid),
          currentSnapshot.capturedAt,
          events.length
        )
      );
    }
    return { events, suppressed: false, reason: null };
  }

  // Reconciliation runs only for a fully validated successful Snapshot.
  //
  // A pending UID that is absent from the new Snapshot is consumed, because the
  // Toolkit already has direct evidence for why it left: it sent the removal for
  // that exact UID and Weibo validated it. Its ordinary disappearance event is
  // dropped and no replacement event is invented.
  //
  // A pending UID still present in the new Snapshot is kept: API membership may
  // simply not be reflected yet, and nothing is fabricated either way.
  //
  // When event generation is globally suppressed (filtering fingerprint changed
  // or unknown), an absent pending UID is still consumed. No ordinary event would
  // have been emitted for it anyway, so keeping the marker would only let it
  // suppress an unrelated future disappearance. The existing fingerprint guard
  // itself is untouched.
  function reconcileFollowerRemovalPending(pending, snapshot, disappearedUids, nowMs) {
    const live = prunedFollowerRemovalPending(pending, nowMs);
    const present = new Set(snapshot.records.map((record) => record.uid));
    const suppressedUids = new Set();
    const remaining = {};
    for (const uid of Object.keys(live)) {
      if (present.has(uid)) {
        remaining[uid] = live[uid];
        continue;
      }
      if (disappearedUids.has(uid)) suppressedUids.add(uid);
    }
    return {
      pending: remaining,
      suppressedUids,
      changed: Object.keys(remaining).length !== Object.keys(pending).length,
    };
  }

  function prepareSuccessfulFollowerUpdate(
    ownerUid,
    previousState,
    snapshot,
    pendingRemovals = {},
    nowMs = Date.now()
  ) {
    if (previousState.ownerUid !== ownerUid || snapshot.ownerUid !== ownerUid) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FOLLOWER_OWNER_UID_MISMATCH",
      };
    }
    const baselineCreated = previousState.latestSnapshot === null;
    const diff = baselineCreated
      ? { events: [], suppressed: false, reason: null }
      : diffFollowerSnapshots(previousState.latestSnapshot, snapshot);
    const disappearedUids = new Set(
      diff.events
        .filter(
          (event) => event.type === FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED
        )
        .map((event) => event.uid)
    );
    const reconciled = reconcileFollowerRemovalPending(
      pendingRemovals,
      snapshot,
      disappearedUids,
      nowMs
    );
    const keptEvents = diff.events.filter(
      (event) => !reconciled.suppressedUids.has(event.uid)
    );
    return {
      ok: true,
      baselineCreated,
      newEvents: keptEvents,
      eventsSuppressed: diff.suppressed,
      eventsSuppressedReason: diff.reason,
      reconciledRemovalUids: [...reconciled.suppressedUids].sort(),
      pendingRemovals: reconciled.pending,
      pendingRemovalsChanged: reconciled.changed,
      state: {
        schemaVersion: FOLLOWER_SNAPSHOT_SCHEMA_VERSION,
        ownerUid,
        latestSnapshot: snapshot,
        events: [...previousState.events, ...keptEvents],
      },
    };
  }

  async function performFollowerUpdate(onProgress, isCancelled, options = {}) {
    const ownerAtStart = determineCurrentUid();
    if (!ownerAtStart.ok) return ownerAtStart;
    const scan = await scanFollowers(
      ownerAtStart.uid,
      onProgress,
      isCancelled,
      options
    );
    if (!scan.ok) return scan;
    const ownerAfterScan = determineCurrentUid();
    if (!ownerAfterScan.ok || ownerAfterScan.uid !== ownerAtStart.uid) {
      return { ok: false, failureKind: "ACCOUNT_CHANGED_DURING_SCAN" };
    }
    // The whole scan is finished before the lock is taken. Everything below is a
    // short local transaction over freshly read state: nothing computed before
    // the lock is written back, so a removal another tab confirmed meanwhile is
    // merged rather than erased.
    const committed = await withFollowerStateLock(
      ownerAtStart.uid,
      async () => {
        const fresh = loadFollowerState(ownerAtStart.uid);
        if (!fresh.ok) return fresh;
        if (fresh.state.latestSnapshot !== null) {
          const storedTime = Date.parse(fresh.state.latestSnapshot.capturedAt);
          const scanTime = Date.parse(scan.snapshot.capturedAt);
          if (!Number.isFinite(storedTime) || storedTime > scanTime) {
            return {
              ok: false,
              failureKind: "STALE_SCAN",
              reason: "FOLLOWER_STALE_SCAN",
            };
          }
        }
        const pendingBefore = loadFollowerRemovalPending(ownerAtStart.uid);
        const prepared = prepareSuccessfulFollowerUpdate(
          ownerAtStart.uid,
          fresh.state,
          scan.snapshot,
          pendingBefore.pending,
          Date.now()
        );
        if (!prepared.ok) return prepared;
        const persisted = persistFollowerState(
          ownerAtStart.uid,
          prepared.state,
          fresh.raw
        );
        if (!persisted.ok) return persisted;
        // Only a persisted successful Snapshot may consume reconciliation state,
        // and it is stored separately from the Snapshot itself.
        if (prepared.pendingRemovalsChanged) {
          saveFollowerRemovalPending(
            ownerAtStart.uid,
            prepared.pendingRemovals
          );
        }
        return { ok: true, prepared };
      }
    );
    if (!committed.ok) return committed;
    const prepared = committed.prepared;
    return {
      ok: true,
      ownerUid: ownerAtStart.uid,
      snapshot: scan.snapshot,
      requestsMade: scan.requestsMade,
      baselineCreated: prepared.baselineCreated,
      newEvents: prepared.newEvents,
      eventsSuppressed: prepared.eventsSuppressed,
      eventsSuppressedReason: prepared.eventsSuppressedReason,
      reconciledRemovalUids: prepared.reconciledRemovalUids,
      totalStoredEvents: prepared.state.events.length,
    };
  }
