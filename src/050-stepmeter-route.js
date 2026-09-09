
  function usageLocalDateKey(nowValue = Date.now()) {
    const date = new Date(nowValue);
    if (Number.isNaN(date.getTime())) return null;
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  }

  function isValidUsageDateKey(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function isValidUsagePostId(value) {
    return typeof value === "string" && /^[A-Za-z0-9]{5,32}$/.test(value);
  }

  function emptyUsageState(dateKey) {
    return {
      version: USAGE_STATE_VERSION,
      currentDay: {
        date: dateKey,
        activeSeconds: 0,
        uniquePostIds: [],
      },
      days: {},
    };
  }

  function isValidUsageState(state) {
    if (
      !isPlainObject(state) ||
      state.version !== USAGE_STATE_VERSION ||
      !isPlainObject(state.currentDay) ||
      !isValidUsageDateKey(state.currentDay.date) ||
      typeof state.currentDay.activeSeconds !== "number" ||
      !Number.isFinite(state.currentDay.activeSeconds) ||
      state.currentDay.activeSeconds < 0 ||
      state.currentDay.activeSeconds > 86400 ||
      !Array.isArray(state.currentDay.uniquePostIds) ||
      !isPlainObject(state.days)
    ) {
      return false;
    }
    const postIds = new Set();
    for (const postId of state.currentDay.uniquePostIds) {
      if (!isValidUsagePostId(postId) || postIds.has(postId)) return false;
      postIds.add(postId);
    }
    const dayEntries = Object.entries(state.days);
    if (dayEntries.length > USAGE_RETENTION_DAYS) return false;
    for (const [dateKey, day] of dayEntries) {
      if (
        !isValidUsageDateKey(dateKey) ||
        dateKey >= state.currentDay.date ||
        !isPlainObject(day) ||
        typeof day.activeSeconds !== "number" ||
        !Number.isFinite(day.activeSeconds) ||
        day.activeSeconds < 0 ||
        day.activeSeconds > 86400 ||
        !Number.isSafeInteger(day.uniquePosts) ||
        day.uniquePosts < 0
      ) {
        return false;
      }
    }
    return true;
  }

  function usageRetentionCutoff(nowValue) {
    const date = new Date(nowValue);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (USAGE_RETENTION_DAYS - 1));
    return usageLocalDateKey(date.getTime());
  }

  function rollUsageStateToDate(state, dateKey, nowValue = Date.now()) {
    if (state.currentDay.date === dateKey) return state;
    const days = {
      ...state.days,
      [state.currentDay.date]: {
        activeSeconds: state.currentDay.activeSeconds,
        uniquePosts: state.currentDay.uniquePostIds.length,
      },
    };
    const cutoff = usageRetentionCutoff(nowValue);
    for (const storedDate of Object.keys(days)) {
      if (storedDate < cutoff || storedDate >= dateKey) delete days[storedDate];
    }
    return {
      version: USAGE_STATE_VERSION,
      currentDay: {
        date: dateKey,
        activeSeconds: 0,
        uniquePostIds: [],
      },
      days,
    };
  }

  function usageStorageKey(ownerUid) {
    return USAGE_STORAGE_PREFIX + ownerUid;
  }

  function loadUsageState(ownerUid, nowValue = Date.now()) {
    const dateKey = usageLocalDateKey(nowValue);
    if (dateKey === null) return { ok: false, failureKind: "STORAGE_ERROR" };
    try {
      const raw = GM_getValue(usageStorageKey(ownerUid), null);
      if (raw === null || typeof raw === "undefined") {
        return { ok: true, state: emptyUsageState(dateKey), raw: null };
      }
      if (typeof raw !== "string") {
        return { ok: false, failureKind: "STORAGE_ERROR" };
      }
      const parsed = JSON.parse(raw);
      if (!isValidUsageState(parsed)) {
        return { ok: false, failureKind: "STORAGE_ERROR" };
      }
      return {
        ok: true,
        state: rollUsageStateToDate(parsed, dateKey, nowValue),
        raw,
      };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function persistUsageState(ownerUid, state) {
    if (!isValidUsageState(state)) {
      return { ok: false, failureKind: "PERSISTENCE_ERROR" };
    }
    try {
      const raw = JSON.stringify(state);
      GM_setValue(usageStorageKey(ownerUid), raw);
      return GM_getValue(usageStorageKey(ownerUid), null) === raw
        ? { ok: true, state, raw }
        : { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function usageLockUnavailable(reason, error) {
    const result = {
      ok: false,
      failureKind: "STATE_LOCK_UNAVAILABLE",
      reason,
    };
    if (error) result.errorName = error.name ? String(error.name) : "Error";
    return result;
  }

  async function withUsageStateLock(ownerUid, transaction) {
    const lockManager = pageLockManager();
    if (lockManager === null) return usageLockUnavailable("LOCK_UNAVAILABLE");
    try {
      return await lockManager.request.call(
        lockManager,
        USAGE_LOCK_PREFIX + ownerUid,
        { mode: "exclusive" },
        async (lock) => {
          if (lock === null) return usageLockUnavailable("LOCK_NOT_ACQUIRED");
          return await transaction();
        }
      );
    } catch (error) {
      return usageLockUnavailable("LOCK_REQUEST_FAILED", error);
    }
  }

  function usageMonotonicNow() {
    try {
      if (typeof performance !== "undefined" && performance.now) {
        return performance.now();
      }
    } catch (_) {
      // Date.now remains a monotonic-enough fallback only for this tab session.
    }
    return Date.now();
  }

  function mergeUsagePendingIntoState(state, activeSeconds, postIds) {
    const mergedIds = new Set(state.currentDay.uniquePostIds);
    for (const postId of postIds) mergedIds.add(postId);
    return {
      ...state,
      currentDay: {
        ...state.currentDay,
        activeSeconds: Math.min(
          86400,
          state.currentDay.activeSeconds + activeSeconds
        ),
        uniquePostIds: [...mergedIds].sort(),
      },
    };
  }

  async function flushUsageState() {
    if (usageFlushInFlight !== null) return await usageFlushInFlight;
    if (
      usageRuntimeOwnerUid === null ||
      usageState === null ||
      (usagePendingActiveSeconds <= 0 && usagePendingPostIds.size === 0)
    ) {
      return { ok: true, state: usageState };
    }
    const ownerUid = usageRuntimeOwnerUid;
    const pendingDate = usageState.currentDay.date;
    const activeSnapshot = usagePendingActiveSeconds;
    const postSnapshot = [...usagePendingPostIds];
    usageFlushInFlight = withUsageStateLock(ownerUid, async () => {
      const loaded = loadUsageState(ownerUid);
      if (!loaded.ok || loaded.state.currentDay.date !== pendingDate) {
        return loaded.ok
          ? { ok: false, failureKind: "CONCURRENT_MODIFICATION" }
          : loaded;
      }
      const merged = mergeUsagePendingIntoState(
        loaded.state,
        activeSnapshot,
        postSnapshot
      );
      return persistUsageState(ownerUid, merged);
    });
    const result = await usageFlushInFlight;
    usageFlushInFlight = null;
    if (result.ok && usageRuntimeOwnerUid === ownerUid) {
      usagePendingActiveSeconds = Math.max(
        0,
        usagePendingActiveSeconds - activeSnapshot
      );
      for (const postId of postSnapshot) usagePendingPostIds.delete(postId);
      usageState = mergeUsagePendingIntoState(
        result.state,
        usagePendingActiveSeconds,
        usagePendingPostIds
      );
      syncUsageCorner();
    }
    return result;
  }

  async function ensureUsageCurrentDay(nowValue = Date.now()) {
    if (usageState === null) return false;
    const dateKey = usageLocalDateKey(nowValue);
    if (dateKey === null) return false;
    if (usageState.currentDay.date === dateKey) return true;
    const flushed = await flushUsageState();
    if (!flushed.ok || usagePendingActiveSeconds > 0 || usagePendingPostIds.size) {
      return false;
    }
    usageState = rollUsageStateToDate(usageState, dateKey, nowValue);
    return true;
  }

  function isUsageFeedRoute() {
    return Boolean(
      typeof location !== "undefined" &&
        location.origin === WEIBO_MAIN_ORIGIN &&
        (location.pathname === "/" || location.pathname === "/mygroups")
    );
  }

  function extractUsagePostId(card) {
    if (!card || !hasClass(card, "wbpro-scroller-item")) return null;
    const article = elementChildren(card).find(
      (child) => child.tagName === "ARTICLE"
    );
    if (!article) return null;
    const articleBody = elementChildren(article).find(
      (child) => child.tagName === "DIV"
    );
    if (!articleBody) return null;
    const header = elementChildren(articleBody).find(
      (child) => child.tagName === "HEADER"
    );
    if (!header) return null;
    const stack = [header];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node.tagName === "A" && typeof node.href === "string") {
        try {
          const url = new URL(node.href, WEIBO_MAIN_ORIGIN);
          const match = /^\/[1-9]\d*\/([A-Za-z0-9]{5,32})\/?$/.exec(
            url.pathname
          );
          if (url.origin === WEIBO_MAIN_ORIGIN && match) return match[1];
        } catch (_) {
          // A malformed or unrelated header link is not a post identity.
        }
      }
      stack.push(...elementChildren(node));
    }
    return null;
  }

  function clearUsageCardDwell(cardState) {
    if (cardState && cardState.dwellTimer !== null) {
      clearTimeout(cardState.dwellTimer);
      cardState.dwellTimer = null;
    }
  }

  function cleanupDisconnectedUsageCards() {
    for (const [card, cardState] of usageCardStates) {
      if (
        card.isConnected === false ||
        !usageFeedRoot ||
        !usageFeedRoot.contains(card)
      ) {
        clearUsageCardDwell(cardState);
        if (usageIntersectionObserver) usageIntersectionObserver.unobserve(card);
        usageCardStates.delete(card);
      }
    }
  }

  function registerUsageCard(card) {
    if (!card || !usageIntersectionObserver) return;
    const postId = extractUsagePostId(card);
    const existing = usageCardStates.get(card);
    if (postId === null) {
      if (existing) {
        clearUsageCardDwell(existing);
        usageIntersectionObserver.unobserve(card);
        usageCardStates.delete(card);
      }
      return;
    }
    if (existing && existing.postId === postId) return;
    if (existing) {
      clearUsageCardDwell(existing);
      usageIntersectionObserver.unobserve(card);
    }
    usageCardStates.set(card, {
      postId,
      visibleRatio: 0,
      dwellTimer: null,
    });
    usageIntersectionObserver.observe(card);
  }

  function collectUsageCards(node, cards) {
    if (!node) return;
    let current = node.nodeType === 1 ? node : node.parentElement;
    while (current && current !== usageFeedRoot) {
      if (hasClass(current, "wbpro-scroller-item")) {
        cards.add(current);
        break;
      }
      current = current.parentElement;
    }
    if (node.nodeType !== 1 || typeof node.querySelectorAll !== "function") {
      return;
    }
    if (hasClass(node, "wbpro-scroller-item")) cards.add(node);
    for (const card of node.querySelectorAll(".wbpro-scroller-item")) {
      cards.add(card);
    }
  }

  function processUsageFeedMutations(mutations) {
    if (!usageEnabledPreference || !isUsageFeedRoute()) {
      teardownUsageFeedTracking();
      return;
    }
    const cards = new Set();
    for (const mutation of mutations) {
      collectUsageCards(mutation.target, cards);
      for (const node of mutation.addedNodes || []) collectUsageCards(node, cards);
    }
    for (const card of cards) registerUsageCard(card);
    cleanupDisconnectedUsageCards();
  }

  function isUsageCardStillHalfVisible(card) {
    if (!card || typeof card.getBoundingClientRect !== "function") return false;
    const rect = card.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    const viewportWidth =
      typeof window !== "undefined" && Number.isFinite(window.innerWidth)
        ? window.innerWidth
        : 0;
    const viewportHeight =
      typeof window !== "undefined" && Number.isFinite(window.innerHeight)
        ? window.innerHeight
        : 0;
    if (viewportWidth <= 0 || viewportHeight <= 0) return false;
    const visibleWidth = Math.max(
      0,
      Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
    );
    const visibleHeight = Math.max(
      0,
      Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
    );
    return (
      (visibleWidth * visibleHeight) / (rect.width * rect.height) >=
      USAGE_POST_VISIBILITY_RATIO
    );
  }

  function noteUsageActivity() {
    if (!usageEnabledPreference || usageRuntimeOwnerUid === null) return;
    usageLastActivityMonotonic = usageMonotonicNow();
  }

  async function recordQualifiedUsagePost(postId) {
    if (!usageEnabledPreference || !isValidUsagePostId(postId)) return false;
    const owner = determineCurrentUid();
    if (!owner.ok || owner.uid !== usageRuntimeOwnerUid) return false;
    if (!(await ensureUsageCurrentDay())) return false;
    noteUsageActivity();
    let changed = false;
    if (!usageSessionPostIds.has(postId)) {
      usageSessionPostIds.add(postId);
      changed = true;
    }
    if (!usageState.currentDay.uniquePostIds.includes(postId)) {
      usageState.currentDay.uniquePostIds.push(postId);
      usagePendingPostIds.add(postId);
      changed = true;
    }
    if (changed) syncUsageCorner();
    return changed;
  }

  async function finishUsageCardDwell(card, capturedPostId) {
    const cardState = usageCardStates.get(card);
    if (cardState) cardState.dwellTimer = null;
    const owner = determineCurrentUid();
    if (
      !usageEnabledPreference ||
      !isUsageFeedRoute() ||
      !owner.ok ||
      owner.uid !== usageRuntimeOwnerUid ||
      !cardState ||
      cardState.postId !== capturedPostId ||
      cardState.visibleRatio < USAGE_POST_VISIBILITY_RATIO ||
      card.isConnected === false ||
      !usageFeedRoot ||
      !usageFeedRoot.contains(card) ||
      extractUsagePostId(card) !== capturedPostId ||
      !isUsageCardStillHalfVisible(card)
    ) {
      return false;
    }
    return await recordQualifiedUsagePost(capturedPostId);
  }

  function processUsageIntersections(entries) {
    for (const entry of entries) {
      const cardState = usageCardStates.get(entry.target);
      if (!cardState) continue;
      cardState.visibleRatio =
        entry.isIntersecting === true && Number.isFinite(entry.intersectionRatio)
          ? entry.intersectionRatio
          : 0;
      clearUsageCardDwell(cardState);
      if (cardState.visibleRatio >= USAGE_POST_VISIBILITY_RATIO) {
        const capturedPostId = cardState.postId;
        cardState.dwellTimer = setTimeout(
          () => finishUsageCardDwell(entry.target, capturedPostId),
          USAGE_POST_DWELL_MS
        );
      }
    }
  }

  function teardownUsageFeedTracking(resetDiscovery = true) {
    if (usageFeedObserver) usageFeedObserver.disconnect();
    if (usageIntersectionObserver) usageIntersectionObserver.disconnect();
    if (resetDiscovery && usageFeedDiscoveryTimer !== null) {
      clearTimeout(usageFeedDiscoveryTimer);
    }
    for (const cardState of usageCardStates.values()) {
      clearUsageCardDwell(cardState);
    }
    usageFeedRoot = null;
    usageFeedObserver = null;
    usageIntersectionObserver = null;
    if (resetDiscovery) {
      usageFeedDiscoveryTimer = null;
      usageFeedDiscoveryCount = 0;
    }
    usageCardStates = new Map();
  }

  function scheduleUsageFeedDiscovery() {
    if (usageFeedDiscoveryTimer !== null || usageFeedDiscoveryCount >= 20) {
      return;
    }
    usageFeedDiscoveryTimer = setTimeout(() => {
      usageFeedDiscoveryTimer = null;
      usageFeedDiscoveryCount += 1;
      installUsageFeedTrackingForRoute();
    }, 250);
  }

  function installUsageFeedTrackingForRoute() {
    if (!usageEnabledPreference || usageRuntimeOwnerUid === null) {
      teardownUsageFeedTracking();
      return false;
    }
    if (!isUsageFeedRoute()) {
      teardownUsageFeedTracking();
      return false;
    }
    const root = findLatestFeedRoot();
    if (!root) {
      teardownUsageFeedTracking(false);
      scheduleUsageFeedDiscovery();
      return false;
    }
    if (
      usageFeedRoot === root &&
      usageFeedObserver &&
      usageIntersectionObserver
    ) {
      return true;
    }
    teardownUsageFeedTracking();
    if (
      typeof IntersectionObserver !== "function" ||
      typeof MutationObserver !== "function"
    ) {
      return false;
    }
    usageFeedRoot = root;
    usageIntersectionObserver = new IntersectionObserver(
      processUsageIntersections,
      { threshold: [0, USAGE_POST_VISIBILITY_RATIO, 1] }
    );
    usageFeedObserver = new MutationObserver(processUsageFeedMutations);
    for (const card of root.querySelectorAll(".wbpro-scroller-item")) {
      registerUsageCard(card);
    }
    usageFeedObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "data-index", "data-active"],
    });
    return true;
  }

  function usageDocumentIsActive(nowMonotonic) {
    if (
      !usageEnabledPreference ||
      usageRuntimeOwnerUid === null ||
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN ||
      document.visibilityState !== "visible" ||
      typeof document.hasFocus !== "function" ||
      !document.hasFocus()
    ) {
      return false;
    }
    return nowMonotonic - usageLastActivityMonotonic <= USAGE_INACTIVITY_MS;
  }

  async function runUsageHeartbeat(nowMonotonic = usageMonotonicNow()) {
    if (!usageEnabledPreference || usageRuntimeOwnerUid === null) return false;
    const owner = determineCurrentUid();
    if (!owner.ok || owner.uid !== usageRuntimeOwnerUid) {
      stopUsageTracking(false);
      usageRuntimeOwnerUid = null;
      usageState = null;
      return false;
    }
    if (!(await ensureUsageCurrentDay())) return false;
    if (usageLastHeartbeatMonotonic === null) {
      usageLastHeartbeatMonotonic = nowMonotonic;
      return false;
    }
    const elapsedMilliseconds = Math.max(
      0,
      nowMonotonic - usageLastHeartbeatMonotonic
    );
    usageLastHeartbeatMonotonic = nowMonotonic;
    if (!usageDocumentIsActive(nowMonotonic)) return false;
    const addedSeconds =
      Math.min(elapsedMilliseconds, USAGE_MAX_HEARTBEAT_GAP_MS) / 1000;
    if (addedSeconds <= 0) return false;
    usageState.currentDay.activeSeconds = Math.min(
      86400,
      usageState.currentDay.activeSeconds + addedSeconds
    );
    usageSessionActiveSeconds += addedSeconds;
    usagePendingActiveSeconds += addedSeconds;
    syncUsageCorner();
    return true;
  }

  function scheduleUsageHeartbeat() {
    if (usageHeartbeatTimer !== null || !usageEnabledPreference) return;
    usageHeartbeatTimer = setTimeout(async () => {
      usageHeartbeatTimer = null;
      await runUsageHeartbeat();
      scheduleUsageHeartbeat();
    }, USAGE_HEARTBEAT_MS);
  }

  function scheduleUsageFlush() {
    if (usageFlushTimer !== null || !usageEnabledPreference) return;
    usageFlushTimer = setTimeout(async () => {
      usageFlushTimer = null;
      await flushUsageState();
      scheduleUsageFlush();
    }, USAGE_FLUSH_MS);
  }

  function handleUsageVisibilityChange() {
    if (document.visibilityState !== "visible") void flushUsageState();
  }

  function handleUsagePageHide() {
    void flushUsageState();
  }

  function installUsageActivityListeners() {
    if (usageListenersInstalled) return;
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      document.addEventListener(type, noteUsageActivity, {
        passive: type === "wheel" || type === "touchstart",
      });
    }
    window.addEventListener("scroll", noteUsageActivity, { passive: true });
    document.addEventListener(
      "visibilitychange",
      handleUsageVisibilityChange
    );
    window.addEventListener("pagehide", handleUsagePageHide);
    usageListenersInstalled = true;
  }

  function removeUsageActivityListeners() {
    if (!usageListenersInstalled) return;
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
      document.removeEventListener(type, noteUsageActivity);
    }
    window.removeEventListener("scroll", noteUsageActivity);
    document.removeEventListener(
      "visibilitychange",
      handleUsageVisibilityChange
    );
    window.removeEventListener("pagehide", handleUsagePageHide);
    usageListenersInstalled = false;
  }

  function startUsageTracking(fromUserAction = false) {
    if (!usageEnabledPreference) return { ok: false, reason: "DISABLED" };
    const owner = determineCurrentUid();
    if (!owner.ok) return owner;
    if (pageLockManager() === null) {
      return { ok: false, failureKind: "STATE_LOCK_UNAVAILABLE" };
    }
    if (usageRuntimeOwnerUid === owner.uid && usageState !== null) {
      installUsageActivityListeners();
      installUsageFeedTrackingForRoute();
      scheduleUsageHeartbeat();
      scheduleUsageFlush();
      syncUsageCorner();
      if (fromUserAction) noteUsageActivity();
      return { ok: true };
    }
    const loaded = loadUsageState(owner.uid);
    if (!loaded.ok) return loaded;
    usageRuntimeOwnerUid = owner.uid;
    usageState = loaded.state;
    usagePendingActiveSeconds = 0;
    usagePendingPostIds = new Set();
    usageLastHeartbeatMonotonic = usageMonotonicNow();
    usageLastActivityMonotonic = Number.NEGATIVE_INFINITY;
    if (usageSessionOwnerUid !== owner.uid) {
      usageSessionOwnerUid = owner.uid;
      usageSessionActiveSeconds = 0;
      usageSessionPostIds = new Set();
    }
    installUsageActivityListeners();
    installUsageFeedTrackingForRoute();
    scheduleUsageHeartbeat();
    scheduleUsageFlush();
    if (fromUserAction) noteUsageActivity();
    syncUsageCorner();
    return { ok: true };
  }

  function stopUsageTracking(flushPending = true) {
    if (usageHeartbeatTimer !== null) clearTimeout(usageHeartbeatTimer);
    if (usageFlushTimer !== null) clearTimeout(usageFlushTimer);
    usageHeartbeatTimer = null;
    usageFlushTimer = null;
    removeUsageActivityListeners();
    teardownUsageFeedTracking();
    removeUsageCorner();
    usageLastHeartbeatMonotonic = null;
    usageLastActivityMonotonic = Number.NEGATIVE_INFINITY;
    if (flushPending) void flushUsageState();
  }

  function handleUsageRouteChange() {
    if (!usageEnabledPreference || usageRuntimeOwnerUid === null) return;
    void flushUsageState();
    installUsageFeedTrackingForRoute();
  }

  function latestFeedWasNormalizedInThisTab() {
    try {
      return (
        typeof sessionStorage !== "undefined" &&
        sessionStorage.getItem(LATEST_FEED_SESSION_MARKER) === "1"
      );
    } catch (_) {
      // An unavailable session boundary must disable automatic navigation.
      return true;
    }
  }

  function markLatestFeedNormalizedInThisTab() {
    try {
      if (typeof sessionStorage === "undefined") return false;
      sessionStorage.setItem(LATEST_FEED_SESSION_MARKER, "1");
      return sessionStorage.getItem(LATEST_FEED_SESSION_MARKER) === "1";
    } catch (_) {
      return false;
    }
  }

  function maybeNormalizeHomeToLatest() {
    if (!isCanonicalWeiboHome()) {
      latestFeedNavigationPending = false;
      return false;
    }
    if (
      !preferLatestFeed ||
      latestFeedNavigationPending ||
      latestFeedWasNormalizedInThisTab()
    ) {
      return false;
    }
    const target = resolveLatestFeedUrl();
    if (target === null || typeof location.assign !== "function") return false;
    const current =
      typeof location.href === "string"
        ? location.href
        : location.origin + location.pathname;
    if (current === target) return false;
    if (!markLatestFeedNormalizedInThisTab()) return false;
    latestFeedNavigationPending = true;
    try {
      location.assign(target);
      return true;
    } catch (_) {
      latestFeedNavigationPending = false;
      return false;
    }
  }

  function syncPageRouteFeatures() {
    maybeNormalizeHomeToLatest();
    installLatestFeedRecommendationFilter();
    ensureProfileExtras();
    handleUsageRouteChange();
  }

  function schedulePageRouteSync() {
    if (pageRouteSyncScheduled) return;
    pageRouteSyncScheduled = true;
    setTimeout(() => {
      pageRouteSyncScheduled = false;
      syncPageRouteFeatures();
    }, 0);
  }

  function installPageRouteHook() {
    if (
      pageRouteHookInstalled ||
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN
    ) {
      return;
    }
    let routeWindow;
    try {
      routeWindow =
        typeof unsafeWindow !== "undefined" && unsafeWindow
          ? unsafeWindow
          : window;
    } catch (_) {
      return;
    }
    const routeHistory = routeWindow && routeWindow.history;
    if (!routeHistory) return;
    pageRouteHookInstalled = true;
    for (const method of ["pushState", "replaceState"]) {
      const original = routeHistory[method];
      if (typeof original !== "function") continue;
      routeHistory[method] = function (...args) {
        const result = original.apply(this, args);
        schedulePageRouteSync();
        return result;
      };
    }
    if (typeof routeWindow.addEventListener === "function") {
      routeWindow.addEventListener("popstate", schedulePageRouteSync);
    }
  }
