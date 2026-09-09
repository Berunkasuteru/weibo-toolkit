
  function createElement(tag, text, className) {
    const element = document.createElement(tag);
    if (typeof text === "string") element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function normalizeTheme(value) {
    return THEME_VALUES.includes(value) ? value : DEFAULT_THEME;
  }

  function loadTheme() {
    try {
      return normalizeTheme(GM_getValue(THEME_KEY, DEFAULT_THEME));
    } catch (_) {
      // Appearance is cosmetic: an unreadable preference must never block the UI.
      return DEFAULT_THEME;
    }
  }

  function saveTheme(theme) {
    try {
      GM_setValue(THEME_KEY, theme);
      if (GM_getValue(THEME_KEY, null) !== theme) {
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

  function loadPageCleanupPreference(key) {
    try {
      return GM_getValue(key, false) === true;
    } catch (_) {
      // A missing or unreadable page preference must preserve Weibo's own UI.
      return false;
    }
  }

  function loadPageCleanupPreferences() {
    return {
      hideHotSearch: loadPageCleanupPreference(HIDE_HOT_SEARCH_KEY),
      hideRightSidebar: loadPageCleanupPreference(HIDE_RIGHT_SIDEBAR_KEY),
      hideTopRecommend: loadPageCleanupPreference(HIDE_TOP_RECOMMEND_KEY),
      hideTopVideo: loadPageCleanupPreference(HIDE_TOP_VIDEO_KEY),
      hideLatestRecommended: loadPageCleanupPreference(
        HIDE_LATEST_RECOMMENDED_KEY
      ),
      showProfileExtras: loadPageCleanupPreference(SHOW_PROFILE_EXTRAS_KEY),
    };
  }

  function savePageCleanupPreference(key, value) {
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

  function buildPageCleanupCss(preferences) {
    const selectors = [];
    if (preferences.hideHotSearch) selectors.push(".hotBand");
    if (preferences.hideRightSidebar) selectors.push("#__sidebar");
    if (preferences.hideTopRecommend) {
      selectors.push('.woo-tab-nav > a[href="/hot"]');
    }
    if (preferences.hideTopVideo) {
      selectors.push('.woo-tab-nav > a[href="/tv"]');
    }
    if (preferences.hideLatestRecommended) {
      selectors.push(`.${LATEST_RECOMMENDED_HIDDEN_CLASS}`);
    }
    return selectors.length === 0
      ? ""
      : selectors.join(",\n") + " { display: none !important; }";
  }

  function applyPageCleanupStyles() {
    const css = buildPageCleanupCss(pageCleanupPreferences);
    if (css !== "") {
      if (pagePreferenceStyleNode === null) {
        const style = document.createElement("style");
        style.id = PAGE_PREFERENCE_STYLE_ID;
        document.head.append(style);
        pagePreferenceStyleNode = style;
      }
      pagePreferenceStyleNode.textContent = css;
      return;
    }
    if (pagePreferenceStyleNode && pagePreferenceStyleNode.parentNode) {
      pagePreferenceStyleNode.parentNode.removeChild(pagePreferenceStyleNode);
    }
    pagePreferenceStyleNode = null;
  }

  function resolveLatestFeedUrl() {
    const owner = determineCurrentUid();
    if (!owner.ok) return null;
    const uid = normalizeStableUid(owner.uid);
    if (uid === null || uid !== owner.uid) return null;
    const target = new URL("/mygroups", WEIBO_MAIN_ORIGIN);
    target.searchParams.set("gid", "11000" + uid);
    return target.href;
  }

  function isCanonicalWeiboHome() {
    if (typeof location === "undefined") return false;
    return (
      location.origin === WEIBO_MAIN_ORIGIN &&
      location.pathname === "/"
    );
  }

  function isLatestFeedRoute() {
    if (
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN
    ) {
      return false;
    }
    const target = resolveLatestFeedUrl();
    if (target === null) return false;
    if (location.pathname === "/") return true;
    if (
      location.pathname !== "/mygroups" ||
      typeof location.href !== "string"
    ) {
      return false;
    }
    try {
      const currentUrl = new URL(location.href);
      const targetUrl = new URL(target);
      return (
        currentUrl.searchParams.get("gid") ===
        targetUrl.searchParams.get("gid")
      );
    } catch (_) {
      return false;
    }
  }

  function elementChildren(node) {
    return node && node.children ? Array.from(node.children) : [];
  }

  function hasClass(node, className) {
    return Boolean(
      node && node.classList && node.classList.contains(className)
    );
  }

  function normalizeLatestRecommendedBadgeText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function classifyLatestRecommendedCard(card) {
    const article = elementChildren(card).find(
      (child) => child.tagName === "ARTICLE"
    );
    if (!article) return false;
    const articleBody = elementChildren(article).find(
      (child) => child.tagName === "DIV"
    );
    if (!articleBody) return false;
    const header = elementChildren(articleBody).find(
      (child) => child.tagName === "HEADER"
    );
    if (!header || typeof header.querySelectorAll !== "function") return false;
    const badgeComponents = header.querySelectorAll(".wbpro-tag");
    return Array.from(badgeComponents).some((component) =>
      elementChildren(component).some(
        (badgeNode) =>
          badgeNode.tagName === "DIV" &&
          normalizeLatestRecommendedBadgeText(badgeNode.textContent) === "荐读"
      )
    );
  }

  function applyLatestRecommendedVisibility(card) {
    if (!card || !card.classList) return;
    if (classifyLatestRecommendedCard(card)) {
      card.classList.add(LATEST_RECOMMENDED_HIDDEN_CLASS);
    } else {
      card.classList.remove(LATEST_RECOMMENDED_HIDDEN_CLASS);
    }
  }

  function findLatestRecommendedCardAncestor(node) {
    let current = node && node.nodeType === 1 ? node : node?.parentElement;
    while (current) {
      if (hasClass(current, "wbpro-scroller-item")) return current;
      if (current === latestRecommendedRoot) return null;
      current = current.parentElement;
    }
    return null;
  }

  function collectLatestRecommendedCards(node, cards) {
    if (!node) return;
    const ancestor = findLatestRecommendedCardAncestor(node);
    if (ancestor) cards.add(ancestor);
    if (node.nodeType !== 1 || typeof node.querySelectorAll !== "function") {
      return;
    }
    if (hasClass(node, "wbpro-scroller-item")) cards.add(node);
    for (const card of node.querySelectorAll(".wbpro-scroller-item")) {
      cards.add(card);
    }
  }

  function processLatestRecommendedMutations(mutations) {
    const cards = new Set();
    for (const mutation of mutations) {
      collectLatestRecommendedCards(mutation.target, cards);
      for (const node of mutation.addedNodes || []) {
        collectLatestRecommendedCards(node, cards);
      }
    }
    for (const card of cards) applyLatestRecommendedVisibility(card);
  }

  function clearLatestRecommendedMarkers(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    for (const card of root.querySelectorAll(
      `.${LATEST_RECOMMENDED_HIDDEN_CLASS}`
    )) {
      card.classList.remove(LATEST_RECOMMENDED_HIDDEN_CLASS);
    }
  }

  function findLatestFeedRoot() {
    if (typeof document.getElementById !== "function") return null;
    const root = document.getElementById("scroller");
    return hasClass(root, "vue-recycle-scroller") ? root : null;
  }

  function teardownLatestFeedRecommendationFilter() {
    if (
      !latestRecommendedObserver &&
      !latestRecommendedRoot &&
      !latestRecommendedDiscoveryObserver
    ) {
      return;
    }
    if (latestRecommendedObserver) latestRecommendedObserver.disconnect();
    if (latestRecommendedDiscoveryObserver) {
      latestRecommendedDiscoveryObserver.disconnect();
    }
    clearLatestRecommendedMarkers(latestRecommendedRoot);
    latestRecommendedObserver = null;
    latestRecommendedRoot = null;
    latestRecommendedDiscoveryObserver = null;
  }

  function installLatestFeedRecommendationFilter() {
    if (!pageCleanupPreferences.hideLatestRecommended || !isLatestFeedRoute()) {
      teardownLatestFeedRecommendationFilter();
      return false;
    }
    const root = findLatestFeedRoot();
    if (!root) {
      if (latestRecommendedObserver) {
        latestRecommendedObserver.disconnect();
        clearLatestRecommendedMarkers(latestRecommendedRoot);
        latestRecommendedObserver = null;
        latestRecommendedRoot = null;
      }
      if (!latestRecommendedDiscoveryObserver) {
        const homeWrap =
          typeof document.querySelector === "function"
            ? document.querySelector(".homeWrap")
            : null;
        if (homeWrap) {
          latestRecommendedDiscoveryObserver = new MutationObserver(() => {
            if (
              !pageCleanupPreferences.hideLatestRecommended ||
              !isLatestFeedRoute()
            ) {
              teardownLatestFeedRecommendationFilter();
              return;
            }
            if (findLatestFeedRoot()) installLatestFeedRecommendationFilter();
          });
          latestRecommendedDiscoveryObserver.observe(homeWrap, {
            childList: true,
            subtree: true,
          });
        }
      }
      return false;
    }
    if (latestRecommendedDiscoveryObserver) {
      latestRecommendedDiscoveryObserver.disconnect();
      latestRecommendedDiscoveryObserver = null;
    }
    if (latestRecommendedRoot === root && latestRecommendedObserver) {
      for (const card of root.querySelectorAll(".wbpro-scroller-item")) {
        applyLatestRecommendedVisibility(card);
      }
      return true;
    }
    if (latestRecommendedObserver) latestRecommendedObserver.disconnect();
    clearLatestRecommendedMarkers(latestRecommendedRoot);
    latestRecommendedRoot = root;
    for (const card of root.querySelectorAll(".wbpro-scroller-item")) {
      applyLatestRecommendedVisibility(card);
    }
    latestRecommendedObserver = new MutationObserver(
      processLatestRecommendedMutations
    );
    latestRecommendedObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-index", "data-active"],
    });
    return true;
  }

  function resolveProfileRouteTargetUid() {
    if (
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN ||
      typeof location.pathname !== "string"
    ) {
      return null;
    }
    const match = /^\/u\/([1-9]\d*)\/?$/.exec(location.pathname);
    return match ? normalizeStableUid(match[1]) : null;
  }

  function profileVisitStorageKey(ownerUid) {
    return PROFILE_VISIT_STORAGE_PREFIX + ownerUid;
  }

  function isValidProfileVisitMap(value) {
    if (!isPlainObject(value)) return false;
    for (const [uid, record] of Object.entries(value)) {
      if (
        normalizeStableUid(uid) !== uid ||
        !isPlainObject(record) ||
        !Number.isSafeInteger(record.count) ||
        record.count < 1 ||
        typeof record.lastVisitedAt !== "string" ||
        !Number.isFinite(Date.parse(record.lastVisitedAt))
      ) {
        return false;
      }
    }
    return true;
  }

  function loadProfileVisits(ownerUid) {
    try {
      const stored = GM_getValue(profileVisitStorageKey(ownerUid), null);
      if (stored === null || typeof stored === "undefined") {
        return { ok: true, visits: {} };
      }
      return isValidProfileVisitMap(stored)
        ? { ok: true, visits: stored }
        : { ok: false, failureKind: "STORAGE_ERROR" };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function recordProfileVisit(ownerUid, targetUid, visitedAt) {
    const loaded = loadProfileVisits(ownerUid);
    if (!loaded.ok) return loaded;
    const previous = hasOwn(loaded.visits, targetUid)
      ? loaded.visits[targetUid]
      : null;
    if (previous !== null && previous.count >= Number.MAX_SAFE_INTEGER) {
      return { ok: false, failureKind: "STORAGE_ERROR" };
    }
    const nextRecord = {
      count: previous === null ? 1 : previous.count + 1,
      lastVisitedAt: visitedAt,
    };
    const nextVisits = { ...loaded.visits, [targetUid]: nextRecord };
    try {
      GM_setValue(profileVisitStorageKey(ownerUid), nextVisits);
      const saved = GM_getValue(profileVisitStorageKey(ownerUid), null);
      if (
        !isValidProfileVisitMap(saved) ||
        saved[targetUid].count !== nextRecord.count ||
        saved[targetUid].lastVisitedAt !== visitedAt
      ) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      return {
        ok: true,
        count: nextRecord.count,
        previousVisitedAt: previous === null ? null : previous.lastVisitedAt,
      };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function addProfileNameObservation(observations, name, observedAt, order) {
    if (
      typeof name !== "string" ||
      name.trim() === "" ||
      typeof observedAt !== "string" ||
      !Number.isFinite(Date.parse(observedAt))
    ) {
      return;
    }
    observations.push({ name, observedAt, order });
  }

  function deriveProfileLocalFacts(targetUid, friendState, followerState) {
    const names = [];
    const relationshipEvents = [];
    const evidenceTimes = [];
    let order = 0;
    let currentName = null;
    let currentNameObservedAt = Number.NEGATIVE_INFINITY;

    function observeName(name, observedAt) {
      addProfileNameObservation(names, name, observedAt, order);
      order += 1;
      if (
        typeof observedAt === "string" &&
        Number.isFinite(Date.parse(observedAt))
      ) {
        evidenceTimes.push(observedAt);
      }
    }

    function observeCurrentName(name, observedAt) {
      const observedTime = Date.parse(observedAt);
      if (
        typeof name === "string" &&
        name.trim() !== "" &&
        Number.isFinite(observedTime) &&
        observedTime > currentNameObservedAt
      ) {
        currentName = name;
        currentNameObservedAt = observedTime;
      }
    }

    if (friendState && friendState.latestSnapshot) {
      const snapshot = friendState.latestSnapshot;
      const record = snapshot.records.find((entry) => entry.uid === targetUid);
      if (record) {
        observeCurrentName(record.screenName, snapshot.capturedAt);
        observeName(record.screenName, snapshot.capturedAt);
      }
    }
    if (friendState) {
      for (const event of friendState.events) {
        if (event.subjectUid !== targetUid) continue;
        evidenceTimes.push(event.detectedAt);
        relationshipEvents.push({
          observedAt: event.detectedAt,
          label: EVENT_LABELS[event.type],
        });
        if (event.type === EVENT.SCREEN_NAME_CHANGED) {
          observeName(event.previous.screenName, event.detectedAt);
          observeName(event.current.screenName, event.detectedAt);
        } else {
          observeName(event.displayName, event.detectedAt);
        }
      }
    }

    if (followerState && followerState.latestSnapshot) {
      const snapshot = followerState.latestSnapshot;
      const record = snapshot.records.find((entry) => entry.uid === targetUid);
      if (record) {
        observeCurrentName(record.screenName, snapshot.capturedAt);
        observeName(record.screenName, snapshot.capturedAt);
      }
    }
    if (followerState) {
      for (const event of followerState.events) {
        if (event.uid !== targetUid) continue;
        evidenceTimes.push(event.observedAt);
        relationshipEvents.push({
          observedAt: event.observedAt,
          label: FOLLOWER_EVENT_LABELS[event.type],
        });
        observeName(event.displayName, event.observedAt);
      }
    }

    names.sort((left, right) => {
      const timeDifference =
        Date.parse(left.observedAt) - Date.parse(right.observedAt);
      return timeDifference || left.order - right.order;
    });
    if (currentName === null && names.length > 0) {
      currentName = names[names.length - 1].name;
    }
    const seenNames = new Set();
    const historicalNames = [];
    for (const observation of names) {
      if (
        observation.name === currentName ||
        seenNames.has(observation.name)
      ) {
        continue;
      }
      seenNames.add(observation.name);
      historicalNames.push(observation.name);
    }
    relationshipEvents.sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt)
    );
    const earliestLocalRecord = evidenceTimes.length
      ? new Date(
          Math.min(...evidenceTimes.map((value) => Date.parse(value)))
        ).toISOString()
      : null;
    return {
      currentName,
      historicalNames,
      earliestLocalRecord,
      recentRelationshipEvent: relationshipEvents[0] || null,
    };
  }

  function loadProfileLocalFacts(ownerUid, targetUid) {
    const friend = loadState(ownerUid);
    const follower = loadFollowerState(ownerUid);
    return deriveProfileLocalFacts(
      targetUid,
      friend.ok ? friend.state : null,
      follower.ok ? follower.state : null
    );
  }

  function normalizeProfileTabText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, "").trim() : "";
  }

  function collectProfileTabLabels(root, labels) {
    if (!root || root.nodeType !== 1) return;
    const children = elementChildren(root);
    if (children.length === 0) {
      const text = normalizeProfileTabText(root.textContent);
      if (PROFILE_TAB_LABELS.includes(text)) labels.add(text);
      return;
    }
    for (const child of children) collectProfileTabLabels(child, labels);
  }

  function findProfileExtrasInsertionPoint() {
    if (typeof document.querySelector !== "function") return null;
    const main = document.querySelector("main");
    if (!main) return null;
    const stack = [main];
    const weiboLabels = [];
    while (stack.length > 0) {
      const node = stack.pop();
      const children = elementChildren(node);
      if (
        children.length === 0 &&
        normalizeProfileTabText(node.textContent) === "微博"
      ) {
        weiboLabels.push(node);
      }
      stack.push(...children);
    }
    for (const label of weiboLabels) {
      let candidate = label.parentElement;
      for (let depth = 0; candidate && depth < 7; depth += 1) {
        const labels = new Set();
        collectProfileTabLabels(candidate, labels);
        if (labels.has("微博") && labels.size >= 3 && candidate.parentElement) {
          return { main, host: candidate.parentElement, before: candidate };
        }
        if (candidate === main) break;
        candidate = candidate.parentElement;
      }
    }
    return null;
  }

  function formatProfileDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(
      date.getDate()
    )}`;
  }

  function formatProfileVisitTime(value, nowValue = Date.now()) {
    const visited = new Date(value);
    const now = new Date(nowValue);
    if (Number.isNaN(visited.getTime()) || Number.isNaN(now.getTime())) {
      return formatMinute(value);
    }
    const visitedDay = Date.UTC(
      visited.getFullYear(),
      visited.getMonth(),
      visited.getDate()
    );
    const currentDay = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );
    const daysAgo = Math.round((currentDay - visitedDay) / 86400000);
    const time = `${String(visited.getHours()).padStart(2, "0")}:${String(
      visited.getMinutes()
    ).padStart(2, "0")}`;
    if (daysAgo === 0) return `今天 ${time}`;
    if (daysAgo === 1) return `昨天 ${time}`;
    if (daysAgo >= 2 && daysAgo <= 6) return `${daysAgo} 天前`;
    return formatProfileDate(value);
  }

  function addProfileLine(
    root,
    label,
    value,
    exactTime = null,
    valueTitle = null
  ) {
    const row = createElement("p", null, "wfr-profile-row");
    row.append(createElement("span", `${label}：`, "wfr-profile-label"));
    const displayedValue = createElement("span", String(value));
    if (exactTime !== null) {
      displayedValue.title = formatMinute(exactTime);
    } else if (valueTitle !== null) {
      displayedValue.title = valueTitle;
    }
    row.append(displayedValue);
    root.append(row);
  }

  function closeProfileNicknamePopover(restoreFocus = false) {
    const active = activeProfileNicknamePopover;
    if (active === null) return;
    activeProfileNicknamePopover = null;
    if (typeof document.removeEventListener === "function") {
      document.removeEventListener("click", active.onDocumentClick, true);
      document.removeEventListener("keydown", active.onKeydown);
    }
    if (active.root.parentNode) {
      active.root.parentNode.removeChild(active.root);
    }
    active.trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus && typeof active.trigger.focus === "function") {
      active.trigger.focus();
    }
  }

  function openProfileNicknamePopover(trigger, names) {
    if (!trigger || !trigger.parentNode || !Array.isArray(names)) return false;
    closeProfileNicknamePopover();
    const popover = createElement(
      "div",
      null,
      "wfr-profile-name-popover"
    );
    popover.id = "wfr-profile-name-popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "本地记录过的昵称");
    const header = createElement("div", null, "wfr-profile-name-popover-header");
    header.append(createElement("strong", "本地记录过的昵称"));
    const closeButton = createElement(
      "button",
      "关闭",
      "wfr-profile-name-close"
    );
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "关闭昵称列表");
    header.append(closeButton);
    const list = createElement("ul", null, "wfr-profile-name-list");
    for (const name of names) list.append(createElement("li", name));
    popover.append(header, list);
    trigger.parentNode.append(popover);
    trigger.setAttribute("aria-expanded", "true");

    const onDocumentClick = (event) => {
      const target = event && event.target;
      if (
        target &&
        (popover.contains(target) || trigger.contains(target))
      ) {
        return;
      }
      closeProfileNicknamePopover();
    };
    const onKeydown = (event) => {
      if (event && event.key === "Escape") {
        closeProfileNicknamePopover(true);
      }
    };
    activeProfileNicknamePopover = {
      root: popover,
      trigger,
      onDocumentClick,
      onKeydown,
    };
    closeButton.addEventListener("click", () => {
      closeProfileNicknamePopover(true);
    });
    if (typeof document.addEventListener === "function") {
      document.addEventListener("click", onDocumentClick, true);
      document.addEventListener("keydown", onKeydown);
    }
    return true;
  }

  function renderProfileExtras(context) {
    const root = createElement(
      "section",
      null,
      "wfr-profile-extras wfr-root"
    );
    root.id = PROFILE_EXTRAS_ID;
    root.setAttribute("aria-label", "Weibo Toolkit 本地记录");
    applyThemeToRoot(root);

    const facts = context.facts;
    if (facts.historicalNames.length > 0) {
      const row = createElement("div", null, "wfr-profile-name-row");
      const trigger = createElement(
        "button",
        `历史昵称：${facts.historicalNames.length} 个`,
        "wfr-profile-name-trigger"
      );
      trigger.type = "button";
      trigger.setAttribute("aria-expanded", "false");
      trigger.setAttribute("aria-haspopup", "dialog");
      trigger.setAttribute("aria-controls", "wfr-profile-name-popover");
      trigger.addEventListener("click", () => {
        if (
          activeProfileNicknamePopover &&
          activeProfileNicknamePopover.trigger === trigger
        ) {
          closeProfileNicknamePopover(true);
          return;
        }
        openProfileNicknamePopover(trigger, facts.historicalNames);
      });
      row.append(trigger);
      root.append(row);
    }
    if (facts.recentRelationshipEvent !== null) {
      addProfileLine(
        root,
        "最近记录",
        `${formatProfileDate(facts.recentRelationshipEvent.observedAt)} · ${facts.recentRelationshipEvent.label}`,
        facts.recentRelationshipEvent.observedAt
      );
    }
    if (facts.earliestLocalRecord !== null) {
      addProfileLine(
        root,
        "最早本地记录",
        formatProfileDate(facts.earliestLocalRecord),
        facts.earliestLocalRecord
      );
    }
    if (context.visit.ok && context.visit.previousVisitedAt !== null) {
      addProfileLine(
        root,
        "上次访问",
        formatProfileVisitTime(context.visit.previousVisitedAt),
        context.visit.previousVisitedAt
      );
    }
    if (context.visit.ok) {
      addProfileLine(
        root,
        "累计访问次数",
        `${context.visit.count} 次`,
        null,
        "当前浏览器中 Toolkit 记录的累计访问次数"
      );
    }
    return root;
  }

  function profileContextHasContent(context) {
    return Boolean(
      context &&
        (context.visit.ok ||
          context.facts.historicalNames.length > 0 ||
          context.facts.earliestLocalRecord !== null ||
          context.facts.recentRelationshipEvent !== null)
    );
  }

  function removeProfileExtrasNode() {
    closeProfileNicknamePopover();
    if (typeof document.getElementById !== "function") return;
    const node = document.getElementById(PROFILE_EXTRAS_ID);
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  function disconnectProfileExtrasObserver() {
    if (profileExtrasObserver) profileExtrasObserver.disconnect();
    profileExtrasObserver = null;
    profileExtrasObservedMain = null;
    profileExtrasObservedHost = null;
  }

  function cancelProfileExtrasDiscovery() {
    if (profileExtrasDiscoveryTimer !== null) {
      clearTimeout(profileExtrasDiscoveryTimer);
      profileExtrasDiscoveryTimer = null;
    }
    profileExtrasDiscoveryCount = 0;
  }

  function teardownProfileExtras(resetContext = true) {
    disconnectProfileExtrasObserver();
    cancelProfileExtrasDiscovery();
    removeProfileExtrasNode();
    if (resetContext) activeProfileContext = null;
  }

  function scheduleProfileExtrasEnsure() {
    if (profileExtrasEnsureScheduled) return;
    profileExtrasEnsureScheduled = true;
    setTimeout(() => {
      profileExtrasEnsureScheduled = false;
      ensureProfileExtras();
    }, 0);
  }

  function observeProfileExtrasHost(point) {
    if (
      profileExtrasObserver &&
      profileExtrasObservedMain === point.main &&
      profileExtrasObservedHost === point.host
    ) {
      return;
    }
    disconnectProfileExtrasObserver();
    profileExtrasObserver = new MutationObserver(scheduleProfileExtrasEnsure);
    profileExtrasObserver.observe(point.main, { childList: true });
    if (point.host !== point.main) {
      profileExtrasObserver.observe(point.host, { childList: true });
    }
    profileExtrasObservedMain = point.main;
    profileExtrasObservedHost = point.host;
  }

  function scheduleProfileExtrasDiscovery() {
    if (
      profileExtrasDiscoveryTimer !== null ||
      profileExtrasDiscoveryCount >= 20
    ) {
      return;
    }
    profileExtrasDiscoveryTimer = setTimeout(() => {
      profileExtrasDiscoveryTimer = null;
      profileExtrasDiscoveryCount += 1;
      ensureProfileExtras();
    }, 250);
  }

  function ensureProfileExtras() {
    if (!pageCleanupPreferences.showProfileExtras) {
      const targetUid = resolveProfileRouteTargetUid();
      const owner = determineCurrentUid();
      const sameRecordedRoute = Boolean(
        activeProfileContext &&
          owner.ok &&
          activeProfileContext.ownerUid === owner.uid &&
          activeProfileContext.targetUid === targetUid
      );
      teardownProfileExtras(!sameRecordedRoute);
      return false;
    }
    const targetUid = resolveProfileRouteTargetUid();
    const owner = determineCurrentUid();
    if (!owner.ok || targetUid === null || targetUid === owner.uid) {
      teardownProfileExtras();
      return false;
    }
    if (
      activeProfileContext === null ||
      activeProfileContext.ownerUid !== owner.uid ||
      activeProfileContext.targetUid !== targetUid
    ) {
      teardownProfileExtras();
      const visitedAt = new Date().toISOString();
      activeProfileContext = {
        ownerUid: owner.uid,
        targetUid,
        facts: loadProfileLocalFacts(owner.uid, targetUid),
        visit: recordProfileVisit(owner.uid, targetUid, visitedAt),
      };
    }

    if (!profileContextHasContent(activeProfileContext)) {
      removeProfileExtrasNode();
      disconnectProfileExtrasObserver();
      cancelProfileExtrasDiscovery();
      return false;
    }

    const point = findProfileExtrasInsertionPoint();
    if (!point) {
      removeProfileExtrasNode();
      disconnectProfileExtrasObserver();
      scheduleProfileExtrasDiscovery();
      return false;
    }
    if (profileExtrasDiscoveryTimer !== null) {
      clearTimeout(profileExtrasDiscoveryTimer);
      profileExtrasDiscoveryTimer = null;
    }
    profileExtrasDiscoveryCount = 0;
    let root = document.getElementById(PROFILE_EXTRAS_ID);
    if (!root || root.parentNode !== point.host) {
      removeProfileExtrasNode();
      root = renderProfileExtras(activeProfileContext);
      point.host.insertBefore(root, point.before);
    }
    observeProfileExtrasHost(point);
    return true;
  }

  function parseToolkitReleaseVersion(value) {
    if (typeof value !== "string") return null;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
      value
    );
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
  }

  function compareToolkitReleaseVersions(left, right) {
    const leftParts = parseToolkitReleaseVersion(left);
    const rightParts = parseToolkitReleaseVersion(right);
    if (leftParts === null || rightParts === null) return null;
    for (let index = 0; index < 3; index += 1) {
      if (leftParts[index] !== rightParts[index]) {
        return leftParts[index] < rightParts[index] ? -1 : 1;
      }
    }
    return 0;
  }

  function getBundledChangelog(version) {
    return parseToolkitReleaseVersion(version) !== null &&
      hasOwn(CHANGELOG_BY_VERSION, version)
      ? CHANGELOG_BY_VERSION[version]
      : null;
  }

  function bundledReleaseVersionsThrough(currentVersion) {
    if (parseToolkitReleaseVersion(currentVersion) === null) return [];
    return Object.keys(CHANGELOG_BY_VERSION)
      .filter((version) => {
        const comparison = compareToolkitReleaseVersions(
          version,
          currentVersion
        );
        return comparison !== null && comparison <= 0;
      })
      .sort((left, right) => compareToolkitReleaseVersions(right, left));
  }

  function loadSeenChangelogVersion() {
    try {
      const value = GM_getValue(CHANGELOG_SEEN_VERSION_KEY, null);
      return parseToolkitReleaseVersion(value) !== null ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveSeenChangelogVersion(version) {
    if (parseToolkitReleaseVersion(version) === null) return false;
    try {
      GM_setValue(CHANGELOG_SEEN_VERSION_KEY, version);
      return GM_getValue(CHANGELOG_SEEN_VERSION_KEY, null) === version;
    } catch (_) {
      return false;
    }
  }

  function shouldAutoShowBundledChangelog(version) {
    const rolloutComparison = compareToolkitReleaseVersions(
      version,
      AUTO_CHANGELOG_FROM_VERSION
    );
    return (
      rolloutComparison !== null &&
      rolloutComparison >= 0 &&
      getBundledChangelog(version) !== null &&
      loadSeenChangelogVersion() !== version
    );
  }

  function appendChangelogSections(body, changelog) {
    for (const [property, title] of [
      ["added", "新增"],
      ["improved", "改进"],
      ["fixed", "修复"],
    ]) {
      const entries = changelog[property];
      if (!Array.isArray(entries) || entries.length === 0) continue;
      body.append(createElement("h3", title));
      const list = createElement("ul", null, "wfr-changelog-list");
      for (const entry of entries) list.append(createElement("li", entry));
      body.append(list);
    }
  }

  function showBundledChangelog(version) {
    const changelog = getBundledChangelog(version);
    if (changelog === null) return false;
    let body;
    try {
      body = showPanel(`Weibo Toolkit v${version} 新功能`);
      appendChangelogSections(body, changelog);
      const actions = createElement("div", null, "wfr-actions");
      const acknowledge = createElement(
        "button",
        "知道了",
        "wfr-button wfr-primary"
      );
      acknowledge.type = "button";
      acknowledge.addEventListener("click", closePanel);
      actions.append(acknowledge);
      body.append(actions);
    } catch (_) {
      panelDismissHandler = null;
      closePanel();
      return false;
    }
    panelDismissHandler = () => {
      saveSeenChangelogVersion(version);
    };
    return true;
  }

  function showUpdateHistory(currentVersion = APP_VERSION) {
    const versions = bundledReleaseVersionsThrough(currentVersion);
    if (versions.length === 0) return false;
    const body = showPanel("更新记录", true);
    for (const version of versions) {
      const details = createElement("details", null, "wfr-release-history");
      details.open = version === currentVersion;
      details.append(createElement("summary", `v${version}`));
      const content = createElement(
        "div",
        null,
        "wfr-release-history-content"
      );
      appendChangelogSections(content, CHANGELOG_BY_VERSION[version]);
      details.append(content);
      body.append(details);
    }
    return true;
  }

  function maybeAutoShowBundledChangelog(version = APP_VERSION) {
    if (
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN ||
      panelRoot !== null ||
      !shouldAutoShowBundledChangelog(version)
    ) {
      return false;
    }
    return showBundledChangelog(version);
  }

  function scheduleBundledChangelogAutoShow() {
    if (!shouldAutoShowBundledChangelog(APP_VERSION)) return;
    setTimeout(() => {
      maybeAutoShowBundledChangelog(APP_VERSION);
    }, 1500);
  }
