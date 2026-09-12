  let pageFeedReconcileHandle = null;
  let pageFeedReconcileUsesAnimationFrame = false;
  const PAGE_FEED_ROOT_DISCOVERY_DELAY_MS = 250;
  const PAGE_FEED_ROOT_DISCOVERY_MAX_ATTEMPTS = 20;
  const AUTO_EXPAND_SCROLL_IDLE_MS = 120;
  const AUTO_EXPAND_VIEWPORT_INTENT_MS = 280;
  const AUTO_EXPAND_POINTER_FAST_IDLE_MS = 120;
  const AUTO_EXPAND_SAFE_ZONE_TOP_RATIO = 0.35;
  const AUTO_EXPAND_SAFE_ZONE_BOTTOM_RATIO = 0.85;
  const AUTO_EXPAND_GEOMETRY_STABLE_DELTA_PX = 8;
  let pageFeedRootDiscoveryTimer = null;
  let pageFeedRootDiscoveryAttempts = 0;
  let pageFeedRootDiscoveryRouteKey = null;
  let autoExpandScrollTargets = [];
  let autoExpandScrollIdleTimer = null;
  let autoExpandScrollEpoch = 0;
  let autoExpandExpandedEpoch = -1;
  let autoExpandScrollIsIdle = false;
  let autoExpandPointerTarget = null;
  let autoExpandPointerKnown = false;
  let autoExpandPointerX = 0;
  let autoExpandPointerY = 0;
  let autoExpandViewportIntentTimer = null;
  let autoExpandDominantCandidate = null;
  let autoExpandViewportIntentGeneration = 0;
  let autoExpandGeometryFrameHandle = null;
  let autoExpandGeometryCandidate = null;
  let autoExpandGeometryGeneration = 0;

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
      strongFeedPromotionFilter: loadPageCleanupPreference(
        STRONG_FEED_PROMOTION_FILTER_KEY
      ),
      autoExpandLongPosts: loadPageCleanupPreference(
        AUTO_EXPAND_LONG_POSTS_KEY
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
    const rules = [];
    if (preferences.hideHotSearch) selectors.push(".hotBand");
    if (preferences.hideRightSidebar) selectors.push("#__sidebar");
    if (preferences.hideTopRecommend) {
      selectors.push('.woo-tab-nav > a[href="/hot"]');
    }
    if (preferences.hideTopVideo) {
      selectors.push('.woo-tab-nav > a[href="/tv"]');
    }
    if (preferences.hideLatestRecommended) {
      rules.push(
        `.wbpro-scroller-item.${LATEST_RECOMMENDED_HIDDEN_CLASS} {`,
        "  height: 1px !important;",
        "  min-height: 1px !important;",
        "  max-height: 1px !important;",
        "  margin-block: 0 !important;",
        "  padding-block: 0 !important;",
        "  border-block-width: 0 !important;",
        "  overflow: hidden !important;",
        "  visibility: hidden !important;",
        "  pointer-events: none !important;",
        "}"
      );
      if (preferences.strongFeedPromotionFilter) {
        selectors.push(`.${STRONG_FEED_PROMOTION_HIDDEN_CLASS}`);
      }
    }
    if (selectors.length > 0) {
      rules.unshift(
        selectors.join(",\n") + " { display: none !important; }"
      );
    }
    return rules.join("\n");
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

  function canonicalPageEnhancementLatestUid() {
    if (
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN ||
      location.pathname !== "/mygroups" ||
      typeof location.href !== "string"
    ) {
      return null;
    }
    try {
      const gid = new URL(location.href).searchParams.get("gid");
      const match = /^11000([1-9]\d*)$/.exec(gid || "");
      return match ? match[1] : null;
    } catch (_) {
      return null;
    }
  }

  function isPageEnhancementFeedRoute() {
    if (
      typeof location === "undefined" ||
      location.origin !== WEIBO_MAIN_ORIGIN ||
      typeof location.pathname !== "string"
    ) {
      return false;
    }
    if (location.pathname === "/") return true;
    const routeUid = canonicalPageEnhancementLatestUid();
    if (routeUid === null) return false;
    const configured = determineCurrentUid();
    return !configured.ok || configured.uid === routeUid;
  }

  function isAutoExpandLongPostRoute() {
    if (isPageEnhancementFeedRoute()) return true;
    return Boolean(
      typeof location !== "undefined" &&
        location.origin === WEIBO_MAIN_ORIGIN &&
        typeof location.pathname === "string" &&
        /^\/u\/[1-9]\d*\/?$/.test(location.pathname)
    );
  }

  function promotionFilterIsActiveForRoute() {
    return Boolean(
      pageCleanupPreferences.hideLatestRecommended &&
        isPageEnhancementFeedRoute()
    );
  }

  function autoExpandIsActiveForRoute() {
    return Boolean(
      pageCleanupPreferences.autoExpandLongPosts &&
        isAutoExpandLongPostRoute()
    );
  }

  function pageFeedFeaturesAreActiveForRoute() {
    return promotionFilterIsActiveForRoute() || autoExpandIsActiveForRoute();
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

  function nearestAncestorTagBefore(node, boundary, tagName) {
    for (let current = node?.parentElement; current && current !== boundary; ) {
      if (current.tagName === tagName) return current;
      current = current.parentElement;
    }
    return null;
  }

  function directChildWithin(node, ancestor) {
    let current = node;
    while (current?.parentElement && current.parentElement !== ancestor) {
      current = current.parentElement;
    }
    return current?.parentElement === ancestor ? current : null;
  }

  function resolvePageFeedCardParts(card) {
    if (
      !hasClass(card, "wbpro-scroller-item") ||
      typeof card.querySelectorAll !== "function"
    ) {
      return null;
    }
    const articles = [];
    for (const article of [
      ...elementChildren(card).filter((child) => child.tagName === "ARTICLE"),
      ...card.querySelectorAll("article"),
    ]) {
      if (!articles.includes(article)) articles.push(article);
    }
    for (const article of articles) {
      if (
        hasAncestorClassBefore(article, card, "retweet") ||
        hasAncestorClassBefore(article, card, "wbpro-feed-reText") ||
        typeof article.querySelectorAll !== "function"
      ) {
        continue;
      }
      const headers = Array.from(article.querySelectorAll("header")).filter(
        (candidate) =>
          nearestAncestorTagBefore(candidate, card, "ARTICLE") === article &&
          !hasAncestorClassBefore(candidate, article, "retweet") &&
          !hasAncestorClassBefore(candidate, article, "wbpro-feed-reText")
      );
      const contents = Array.from(
        article.querySelectorAll(".wbpro-feed-content")
      ).filter(
        (candidate) =>
          nearestAncestorTagBefore(candidate, card, "ARTICLE") === article &&
          !hasAncestorClassBefore(candidate, article, "retweet") &&
          !hasAncestorClassBefore(candidate, article, "wbpro-feed-reText")
      );
      for (const content of contents) {
        const contentBranch = directChildWithin(content, article);
        const header =
          headers.find(
            (candidate) =>
              directChildWithin(candidate, article) === contentBranch
          ) || (headers.length === 1 ? headers[0] : null);
        if (header) return { card, article, header, content };
      }
    }
    return null;
  }

  function normalizedComponentText(node) {
    const ownText = normalizeLatestRecommendedBadgeText(node?.textContent);
    if (ownText !== "") return ownText;
    const leafTexts = [];
    walkElementSubtree(node, (descendant) => {
      if (descendant !== node && elementChildren(descendant).length === 0) {
        const text = normalizeLatestRecommendedBadgeText(
          descendant.textContent
        );
        if (text !== "") leafTexts.push(text);
      }
    });
    return normalizeLatestRecommendedBadgeText(leafTexts.join(" "));
  }

  function pageFeedTagComponents(header) {
    const components = [];
    walkElementSubtree(header, (node) => {
      if (
        node !== header &&
        elementClassTokens(node).some((token) =>
          token.startsWith("wbpro-tag")
        )
      ) {
        components.push(node);
      }
    });
    return components;
  }

  function effectiveStrongFeedPromotionFilter() {
    return Boolean(
      promotionFilterIsActiveForRoute() &&
        pageCleanupPreferences.strongFeedPromotionFilter
    );
  }

  function classifyLatestRecommendedCard(card, strongMode = false) {
    const parts = resolvePageFeedCardParts(card);
    if (!parts) return false;
    const tagMatch = pageFeedTagComponents(parts.header).some((component) => {
      const componentText = normalizedComponentText(component);
      const preciseMatch = componentText === "荐读";
      if (preciseMatch || !strongMode) return preciseMatch;
      return STRONG_FEED_PROMOTION_TAG_TEXTS.some((token) =>
        componentText.includes(token)
      );
    });
    if (tagMatch || !strongMode) return tagMatch;
    let hasFollowControl = false;
    let hasNegativeFeedbackSemantic = false;
    walkElementSubtree(parts.header, (node) => {
      if (
        node.hidden === true ||
        node.getAttribute?.("aria-hidden") === "true"
      ) {
        return;
      }
      const text = normalizeLatestRecommendedBadgeText(node.textContent);
      const role = node.getAttribute?.("role");
      if (
        (node.tagName === "A" ||
          node.tagName === "BUTTON" ||
          role === "button") &&
        (text === "关注" || text === "+关注")
      ) {
        hasFollowControl = true;
      }
      const title = normalizeLatestRecommendedBadgeText(
        node.getAttribute?.("title")
      );
      const accessibleLabel = normalizeLatestRecommendedBadgeText(
        node.getAttribute?.("aria-label")
      );
      if (title === "负反馈" || accessibleLabel === "负反馈") {
        hasNegativeFeedbackSemantic = true;
      }
    });
    return hasFollowControl && hasNegativeFeedbackSemantic;
  }

  function setToolkitClass(node, className, enabled) {
    if (!node || !node.classList) return false;
    const hasClassName = node.classList.contains(className);
    if (Boolean(enabled) === hasClassName) return false;
    if (enabled) node.classList.add(className);
    else node.classList.remove(className);
    return true;
  }

  function elementClassTokens(node) {
    if (!node || !node.classList) return [];
    try {
      const tokens = Array.from(node.classList).filter(
        (token) => typeof token === "string" && token !== ""
      );
      if (tokens.length > 0) return tokens;
    } catch (_) {
      // Fall back to a string className in minimal/legacy DOM implementations.
    }
    return typeof node.className === "string"
      ? node.className.split(/\s+/).filter(Boolean)
      : [];
  }

  function isStrongTipsAdModule(node) {
    return elementClassTokens(node).some((token) => token.startsWith("TipsAd"));
  }

  function walkElementSubtree(node, callback) {
    const element = node && node.nodeType === 1 ? node : node?.parentElement;
    if (!element) return;
    callback(element);
    for (const child of elementChildren(element)) {
      walkElementSubtree(child, callback);
    }
  }

  function cardContainsStrongTipsAd(card) {
    if (!card || !effectiveStrongFeedPromotionFilter()) return false;
    let containsTipsAd = false;
    walkElementSubtree(card, (node) => {
      if (!containsTipsAd && isStrongTipsAdModule(node)) {
        containsTipsAd = true;
      }
    });
    return containsTipsAd;
  }

  function shouldCollapsePageFeedCard(card) {
    if (!promotionFilterIsActiveForRoute()) return false;
    const strongMode = effectiveStrongFeedPromotionFilter();
    return Boolean(
      classifyLatestRecommendedCard(card, strongMode) ||
        (strongMode && cardContainsStrongTipsAd(card))
    );
  }

  function applyLatestRecommendedVisibility(card) {
    setToolkitClass(
      card,
      LATEST_RECOMMENDED_HIDDEN_CLASS,
      shouldCollapsePageFeedCard(card)
    );
  }

  function applyStrongTipsAdVisibility(node) {
    if (!node || !node.classList) return;
    const shouldHide = Boolean(
      isStrongTipsAdModule(node) &&
        effectiveStrongFeedPromotionFilter() &&
        latestRecommendedRoot &&
        latestRecommendedRoot.contains(node)
    );
    setToolkitClass(node, STRONG_FEED_PROMOTION_HIDDEN_CLASS, shouldHide);
  }

  function reconcileStrongTipsAdModules(root) {
    if (!root) return;
    walkElementSubtree(root, applyStrongTipsAdVisibility);
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

  function hasAncestorClassBefore(node, boundary, className) {
    for (let current = node?.parentElement; current && current !== boundary; ) {
      if (hasClass(current, className)) return true;
      current = current.parentElement;
    }
    return false;
  }

  function longPostIdentity(parts) {
    if (!parts || typeof parts.header.querySelectorAll !== "function") {
      return null;
    }
    for (const link of parts.header.querySelectorAll("a")) {
      const href =
        typeof link.href === "string" && link.href !== ""
          ? link.href
          : link.getAttribute?.("href");
      if (typeof href !== "string" || href === "") continue;
      try {
        const path = new URL(href, WEIBO_MAIN_ORIGIN).pathname;
        const match = /^\/([1-9]\d*)\/([A-Za-z0-9]+)\/?$/.exec(path);
        if (match) return `${match[1]}/${match[2]}`;
      } catch (_) {
        // A malformed/non-Weibo link is not a stable post identity.
      }
    }
    return null;
  }

  function longPostDedupIdentity(card, parts) {
    const postIdentity = longPostIdentity(parts);
    if (postIdentity !== null) return postIdentity;
    const dataIndex = card?.getAttribute?.("data-index");
    return typeof dataIndex === "string" && dataIndex !== ""
      ? `index:${dataIndex}`
      : card;
  }

  function validateLongPostExpandControl(control) {
    if (
      !pageCleanupPreferences.autoExpandLongPosts ||
      !isAutoExpandLongPostRoute() ||
      !latestRecommendedRoot ||
      !control ||
      control.nodeType !== 1 ||
      control.isConnected === false ||
      !hasClass(control, "expand") ||
      normalizeLatestRecommendedBadgeText(control.textContent) !== "展开"
    ) {
      return null;
    }
    const card = findLatestRecommendedCardAncestor(control);
    if (
      !card ||
      !latestRecommendedRoot.contains(card) ||
      !latestRecommendedRoot.contains(control) ||
      hasClass(card, LATEST_RECOMMENDED_HIDDEN_CLASS)
    ) {
      return null;
    }
    const parts = resolvePageFeedCardParts(card);
    if (
      !parts ||
      typeof card.querySelector !== "function" ||
      card.querySelector(".retweet") ||
      card.querySelector(".wbpro-feed-reText") ||
      !parts.content.contains(control) ||
      hasAncestorClassBefore(control, card, "wbpro-feed-reText") ||
      hasAncestorClassBefore(control, card, "retweet")
    ) {
      return null;
    }
    return {
      card,
      parts,
      identity: longPostDedupIdentity(card, parts),
    };
  }

  function visibleAreaRatio(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const width = Number(rect.width) || Number(rect.right) - Number(rect.left);
    const height = Number(rect.height) || Number(rect.bottom) - Number(rect.top);
    if (!(width > 0) || !(height > 0)) return null;
    const viewportWidth = Number(window?.innerWidth) || 0;
    const viewportHeight = Number(window?.innerHeight) || 0;
    if (!(viewportWidth > 0) || !(viewportHeight > 0)) return null;
    const visibleWidth = Math.max(
      0,
      Math.min(Number(rect.right), viewportWidth) - Math.max(Number(rect.left), 0)
    );
    const visibleHeight = Math.max(
      0,
      Math.min(Number(rect.bottom), viewportHeight) - Math.max(Number(rect.top), 0)
    );
    return (visibleWidth * visibleHeight) / (width * height);
  }

  function longPostControlIsMeaningfullyVisible(control, card) {
    const cardRatio = visibleAreaRatio(card);
    if (cardRatio !== null && cardRatio <= 0) return false;
    const controlRatio = visibleAreaRatio(control);
    if (controlRatio !== null) {
      return controlRatio >= AUTO_EXPAND_INTERSECTION_RATIO;
    }
    return (
      cardRatio !== null && cardRatio >= AUTO_EXPAND_INTERSECTION_RATIO
    );
  }

  function autoExpandSafeZoneGeometry(control) {
    if (!control || typeof control.getBoundingClientRect !== "function") {
      return null;
    }
    const viewportHeight = Number(window?.innerHeight) || 0;
    const rect = control.getBoundingClientRect();
    const top = Number(rect.top);
    const bottom = Number(rect.bottom);
    if (
      !(viewportHeight > 0) ||
      !Number.isFinite(top) ||
      !Number.isFinite(bottom) ||
      !(bottom > top)
    ) {
      return null;
    }
    const centerY = (top + bottom) / 2;
    if (
      centerY < viewportHeight * AUTO_EXPAND_SAFE_ZONE_TOP_RATIO ||
      centerY > viewportHeight * AUTO_EXPAND_SAFE_ZONE_BOTTOM_RATIO
    ) {
      return null;
    }
    return { centerY };
  }

  function clearAutoExpandScrollIdleTimer() {
    if (autoExpandScrollIdleTimer !== null) {
      clearTimeout(autoExpandScrollIdleTimer);
    }
    autoExpandScrollIdleTimer = null;
  }

  function clearAutoExpandViewportIntent() {
    if (autoExpandViewportIntentTimer !== null) {
      clearTimeout(autoExpandViewportIntentTimer);
    }
    autoExpandViewportIntentTimer = null;
    autoExpandDominantCandidate = null;
    autoExpandViewportIntentGeneration += 1;
  }

  function pageAllowsAutoExpandReadingIntent() {
    if (
      document.hidden === true ||
      document.visibilityState === "hidden" ||
      (typeof document.hasFocus === "function" && !document.hasFocus()) ||
      typeof window.getSelection !== "function"
    ) {
      return false;
    }
    try {
      const selection = window.getSelection();
      return Boolean(selection && selection.isCollapsed === true);
    } catch (_) {
      return false;
    }
  }

  function pointerElementIsInteractive(element, card) {
    const interactiveTags = new Set([
      "A",
      "BUTTON",
      "INPUT",
      "TEXTAREA",
      "SELECT",
      "SUMMARY",
    ]);
    for (let current = element; current; current = current.parentElement) {
      const role = current.getAttribute?.("role");
      if (
        interactiveTags.has(current.tagName) ||
        hasClass(current, "expand") ||
        role === "button" ||
        role === "link" ||
        current.getAttribute?.("contenteditable") === "true" ||
        current.isContentEditable === true
      ) {
        return true;
      }
      if (current === card) break;
    }
    return false;
  }

  function dominantAutoExpandCandidate() {
    if (
      autoExpandExpandedEpoch === autoExpandScrollEpoch ||
      !latestRecommendedRoot ||
      !pageCleanupPreferences.autoExpandLongPosts ||
      !isAutoExpandLongPostRoute()
    ) {
      return null;
    }
    const viewportHeight = Number(window?.innerHeight) || 0;
    if (!(viewportHeight > 0)) return null;
    let dominant = null;
    for (const card of latestRecommendedRoot.querySelectorAll(
      ".wbpro-scroller-item"
    )) {
      const cardRatio = visibleAreaRatio(card);
      if (
        cardRatio === null ||
        cardRatio < AUTO_EXPAND_INTERSECTION_RATIO ||
        typeof card.getBoundingClientRect !== "function" ||
        typeof card.querySelectorAll !== "function"
      ) {
        continue;
      }
      const rect = card.getBoundingClientRect();
      const visibleTop = Math.max(Number(rect.top), 0);
      const visibleBottom = Math.min(Number(rect.bottom), viewportHeight);
      if (!(visibleBottom > visibleTop)) continue;
      const score = Math.abs(
        (visibleTop + visibleBottom) / 2 - viewportHeight / 2
      );
      for (const control of card.querySelectorAll(".expand")) {
        const validated = validateLongPostExpandControl(control);
        if (
          validated &&
          longPostClickedControlStates.get(control) !== validated.identity &&
          longPostControlIsMeaningfullyVisible(control, validated.card) &&
          autoExpandSafeZoneGeometry(control) !== null &&
          (!dominant || score < dominant.score)
        ) {
          dominant = {
            root: latestRecommendedRoot,
            card,
            control,
            identity: validated.identity,
            score,
          };
        }
      }
    }
    return dominant;
  }

  function intentCandidatesMatch(left, right) {
    return Boolean(
      left &&
        right &&
        left.root === right.root &&
        left.card === right.card &&
        left.control === right.control &&
        left.identity === right.identity
    );
  }

  function currentPointerElement() {
    if (
      !autoExpandPointerKnown ||
      typeof document.elementFromPoint !== "function"
    ) {
      return null;
    }
    const pointed = document.elementFromPoint(
      autoExpandPointerX,
      autoExpandPointerY
    );
    return pointed && pointed.nodeType === 1 ? pointed : null;
  }

  function pointerBlocksDominantCandidate(candidate) {
    const pointed = currentPointerElement();
    if (!pointed || !candidate.card.contains(pointed)) return false;
    return pointerElementIsInteractive(pointed, candidate.card);
  }

  function pointerFastPathMatches(candidate) {
    const pointed = currentPointerElement();
    return Boolean(
      pointed &&
        candidate.card.contains(pointed) &&
        !pointerElementIsInteractive(pointed, candidate.card)
    );
  }

  function cancelAutoExpandGeometryConfirmation() {
    if (
      autoExpandGeometryFrameHandle !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(autoExpandGeometryFrameHandle);
    }
    autoExpandGeometryFrameHandle = null;
    autoExpandGeometryCandidate = null;
    autoExpandGeometryGeneration += 1;
  }

  function scheduleAutoExpandGeometryConfirmation(candidate) {
    if (!candidate || typeof requestAnimationFrame !== "function") {
      return false;
    }
    if (
      autoExpandGeometryFrameHandle !== null &&
      intentCandidatesMatch(candidate, autoExpandGeometryCandidate)
    ) {
      return true;
    }
    cancelAutoExpandGeometryConfirmation();
    const current = dominantAutoExpandCandidate();
    const firstGeometry = autoExpandSafeZoneGeometry(current?.control);
    if (
      !intentCandidatesMatch(current, candidate) ||
      !firstGeometry ||
      !autoExpandScrollIsIdle ||
      pointerBlocksDominantCandidate(current) ||
      !pageAllowsAutoExpandReadingIntent()
    ) {
      return false;
    }
    autoExpandGeometryCandidate = current;
    const generation = autoExpandGeometryGeneration;
    autoExpandGeometryFrameHandle = requestAnimationFrame(() => {
      autoExpandGeometryFrameHandle = null;
      if (generation !== autoExpandGeometryGeneration) return;
      const expected = autoExpandGeometryCandidate;
      const latest = dominantAutoExpandCandidate();
      const secondGeometry = autoExpandSafeZoneGeometry(latest?.control);
      const geometryStable = Boolean(
        secondGeometry &&
          Math.abs(secondGeometry.centerY - firstGeometry.centerY) <=
            AUTO_EXPAND_GEOMETRY_STABLE_DELTA_PX
      );
      if (
        !intentCandidatesMatch(latest, expected) ||
        !geometryStable ||
        !autoExpandScrollIsIdle ||
        pointerBlocksDominantCandidate(latest) ||
        !pageAllowsAutoExpandReadingIntent()
      ) {
        cancelAutoExpandGeometryConfirmation();
        clearAutoExpandViewportIntent();
        return;
      }
      const validated = validateLongPostExpandControl(latest.control);
      if (
        !validated ||
        validated.identity !== latest.identity ||
        !longPostControlIsMeaningfullyVisible(latest.control, validated.card) ||
        !autoExpandSafeZoneGeometry(latest.control)
      ) {
        cancelAutoExpandGeometryConfirmation();
        clearAutoExpandViewportIntent();
        return;
      }
      cancelAutoExpandGeometryConfirmation();
      clickValidatedLongPostControl(latest.control, validated);
    });
    return true;
  }

  function clickCurrentViewportIntentCandidate(candidate) {
    if (
      !candidate ||
      !autoExpandScrollIsIdle ||
      autoExpandExpandedEpoch === autoExpandScrollEpoch ||
      !pageAllowsAutoExpandReadingIntent()
    ) {
      return false;
    }
    const current = dominantAutoExpandCandidate();
    if (
      !intentCandidatesMatch(current, candidate) ||
      pointerBlocksDominantCandidate(current)
    ) {
      return false;
    }
    const validated = validateLongPostExpandControl(current.control);
    if (
      !validated ||
      validated.identity !== current.identity ||
      !longPostControlIsMeaningfullyVisible(current.control, validated.card) ||
      !autoExpandSafeZoneGeometry(current.control)
    ) {
      return false;
    }
    return scheduleAutoExpandGeometryConfirmation(current);
  }

  function reconcileAutoExpandViewportIntent() {
    const candidate = dominantAutoExpandCandidate();
    if (!candidate) {
      cancelAutoExpandGeometryConfirmation();
      clearAutoExpandViewportIntent();
      return false;
    }
    if (
      autoExpandGeometryCandidate &&
      !intentCandidatesMatch(candidate, autoExpandGeometryCandidate)
    ) {
      cancelAutoExpandGeometryConfirmation();
    }
    if (
      autoExpandGeometryFrameHandle !== null &&
      intentCandidatesMatch(candidate, autoExpandGeometryCandidate)
    ) {
      return true;
    }
    if (
      intentCandidatesMatch(candidate, autoExpandDominantCandidate) &&
      autoExpandScrollIsIdle &&
      AUTO_EXPAND_POINTER_FAST_IDLE_MS <= AUTO_EXPAND_SCROLL_IDLE_MS &&
      pointerFastPathMatches(candidate)
    ) {
      if (clickCurrentViewportIntentCandidate(candidate)) {
        clearAutoExpandViewportIntent();
        return true;
      }
    }
    if (
      intentCandidatesMatch(candidate, autoExpandDominantCandidate) &&
      autoExpandViewportIntentTimer !== null
    ) {
      return true;
    }
    clearAutoExpandViewportIntent();
    autoExpandDominantCandidate = candidate;
    const generation = autoExpandViewportIntentGeneration;
    autoExpandViewportIntentTimer = setTimeout(() => {
      autoExpandViewportIntentTimer = null;
      if (generation !== autoExpandViewportIntentGeneration) return;
      const current = dominantAutoExpandCandidate();
      if (!intentCandidatesMatch(current, candidate)) {
        clearAutoExpandViewportIntent();
        if (current) reconcileAutoExpandViewportIntent();
        return;
      }
      clearAutoExpandViewportIntent();
      clickCurrentViewportIntentCandidate(current);
    }, AUTO_EXPAND_VIEWPORT_INTENT_MS);
    return true;
  }

  function scheduleAutoExpandScrollIdle(resetDeadline = false) {
    const root = latestRecommendedRoot;
    if (
      !pageCleanupPreferences.autoExpandLongPosts ||
      !isAutoExpandLongPostRoute() ||
      !root
    ) {
      clearAutoExpandScrollIdleTimer();
      return false;
    }
    if (resetDeadline) clearAutoExpandScrollIdleTimer();
    if (autoExpandScrollIdleTimer !== null) return false;
    const epoch = autoExpandScrollEpoch;
    autoExpandScrollIdleTimer = setTimeout(() => {
      autoExpandScrollIdleTimer = null;
      if (
        epoch !== autoExpandScrollEpoch ||
        latestRecommendedRoot !== root ||
        !pageCleanupPreferences.autoExpandLongPosts ||
        !isAutoExpandLongPostRoute()
      ) {
        return;
      }
      autoExpandScrollIsIdle = true;
      reconcileCurrentPageFeed();
    }, AUTO_EXPAND_SCROLL_IDLE_MS);
    return true;
  }

  function handleAutoExpandRelevantScroll() {
    autoExpandScrollEpoch += 1;
    autoExpandScrollIsIdle = false;
    cancelAutoExpandGeometryConfirmation();
    clearAutoExpandViewportIntent();
    scheduleAutoExpandScrollIdle(true);
    schedulePageFeedReconcile();
  }

  function handleAutoExpandPointerMove(event) {
    if (
      !event ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return;
    }
    autoExpandPointerKnown = true;
    autoExpandPointerX = event.clientX;
    autoExpandPointerY = event.clientY;
    if (
      autoExpandScrollIsIdle &&
      autoExpandExpandedEpoch !== autoExpandScrollEpoch
    ) {
      schedulePageFeedReconcile();
    }
  }

  function teardownAutoExpandScrollTracking() {
    clearAutoExpandScrollIdleTimer();
    cancelAutoExpandGeometryConfirmation();
    clearAutoExpandViewportIntent();
    for (const target of autoExpandScrollTargets) {
      target.removeEventListener?.("scroll", handleAutoExpandRelevantScroll);
    }
    autoExpandScrollTargets = [];
    if (autoExpandPointerTarget) {
      autoExpandPointerTarget.removeEventListener?.(
        "pointermove",
        handleAutoExpandPointerMove
      );
    }
    autoExpandPointerTarget = null;
    autoExpandPointerKnown = false;
    autoExpandPointerX = 0;
    autoExpandPointerY = 0;
    autoExpandScrollEpoch = 0;
    autoExpandExpandedEpoch = -1;
    autoExpandScrollIsIdle = false;
  }

  function installAutoExpandScrollTracking() {
    const targets = [window, latestRecommendedRoot].filter(
      (target, index, all) =>
        target &&
        typeof target.addEventListener === "function" &&
        all.indexOf(target) === index
    );
    if (
      targets.length === autoExpandScrollTargets.length &&
      targets.every((target, index) => target === autoExpandScrollTargets[index])
    ) {
      return;
    }
    teardownAutoExpandScrollTracking();
    autoExpandScrollTargets = targets;
    for (const target of autoExpandScrollTargets) {
      target.addEventListener("scroll", handleAutoExpandRelevantScroll, {
        passive: true,
      });
    }
    autoExpandPointerTarget = window;
    autoExpandPointerTarget.addEventListener(
      "pointermove",
      handleAutoExpandPointerMove,
      { passive: true }
    );
    scheduleAutoExpandScrollIdle();
  }

  function clickValidatedLongPostControl(control, validated) {
    if (
      !validated ||
      !autoExpandScrollIsIdle ||
      autoExpandExpandedEpoch === autoExpandScrollEpoch ||
      longPostClickedControlStates.get(control) === validated.identity
    ) {
      return false;
    }
    autoExpandExpandedEpoch = autoExpandScrollEpoch;
    longPostClickedControlStates.set(control, validated.identity);
    if (longPostIntersectionObserver) {
      longPostIntersectionObserver.unobserve(control);
    }
    longPostObservedControls.delete(control);
    if (typeof control.click === "function") control.click();
    return true;
  }

  function registerLongPostControls(card) {
    if (!card || typeof card.querySelectorAll !== "function") {
      return;
    }
    for (const control of card.querySelectorAll(".expand")) {
      const validated = validateLongPostExpandControl(control);
      if (!validated) continue;
      if (longPostClickedControlStates.get(control) === validated.identity) {
        if (longPostIntersectionObserver) {
          longPostIntersectionObserver.unobserve(control);
        }
        longPostObservedControls.delete(control);
        continue;
      }
      if (!longPostIntersectionObserver || longPostObservedControls.has(control)) {
        continue;
      }
      longPostObservedControls.add(control);
      longPostIntersectionObserver.observe(control);
    }
  }

  function pruneLongPostControls() {
    if (!longPostIntersectionObserver) return;
    for (const control of [...longPostObservedControls]) {
      if (validateLongPostExpandControl(control)) continue;
      longPostIntersectionObserver.unobserve(control);
      longPostObservedControls.delete(control);
    }
  }

  function processLongPostIntersections(entries) {
    for (const entry of entries) {
      if (
        !entry.isIntersecting ||
        entry.intersectionRatio < AUTO_EXPAND_INTERSECTION_RATIO
      ) {
        continue;
      }
      const control = entry.target;
      const validated = validateLongPostExpandControl(control);
      if (!validated) continue;
      if (!autoExpandScrollIsIdle) scheduleAutoExpandScrollIdle();
      else schedulePageFeedReconcile();
    }
  }

  function teardownLongPostAutoExpand() {
    teardownAutoExpandScrollTracking();
    if (longPostIntersectionObserver) {
      longPostIntersectionObserver.disconnect();
    }
    longPostIntersectionObserver = null;
    longPostObservedControls.clear();
    longPostClickedControlStates = new WeakMap();
  }

  function syncLongPostAutoExpand() {
    if (
      !pageCleanupPreferences.autoExpandLongPosts ||
      !isAutoExpandLongPostRoute() ||
      !latestRecommendedRoot
    ) {
      teardownLongPostAutoExpand();
      return false;
    }
    if (
      !longPostIntersectionObserver &&
      typeof IntersectionObserver === "function"
    ) {
      longPostIntersectionObserver = new IntersectionObserver(
        processLongPostIntersections,
        { threshold: AUTO_EXPAND_INTERSECTION_RATIO }
      );
    }
    installAutoExpandScrollTracking();
    pruneLongPostControls();
    return true;
  }

  function reconcileCurrentPageFeed() {
    const root = latestRecommendedRoot;
    if (!root || !pageFeedFeaturesAreActiveForRoute()) {
      return false;
    }
    if (findLatestFeedRoot() !== root) {
      installLatestFeedRecommendationFilter();
      return false;
    }
    const autoExpandActive = syncLongPostAutoExpand();
    for (const card of root.querySelectorAll(".wbpro-scroller-item")) {
      applyLatestRecommendedVisibility(card);
      if (autoExpandActive) registerLongPostControls(card);
    }
    reconcileStrongTipsAdModules(root);
    if (autoExpandActive) reconcileAutoExpandViewportIntent();
    else clearAutoExpandViewportIntent();
    return true;
  }

  function cancelPageFeedReconcile() {
    if (pageFeedReconcileHandle === null) return;
    const handle = pageFeedReconcileHandle;
    const usedAnimationFrame = pageFeedReconcileUsesAnimationFrame;
    pageFeedReconcileHandle = null;
    pageFeedReconcileUsesAnimationFrame = false;
    if (
      usedAnimationFrame &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(handle);
    } else {
      clearTimeout(handle);
    }
  }

  function schedulePageFeedReconcile() {
    if (pageFeedReconcileHandle !== null) return false;
    const callback = () => {
      pageFeedReconcileHandle = null;
      pageFeedReconcileUsesAnimationFrame = false;
      reconcileCurrentPageFeed();
    };
    if (typeof requestAnimationFrame === "function") {
      pageFeedReconcileUsesAnimationFrame = true;
      pageFeedReconcileHandle = requestAnimationFrame(callback);
    } else {
      pageFeedReconcileHandle = setTimeout(callback, 0);
    }
    return true;
  }

  function processLatestRecommendedMutations() {
    schedulePageFeedReconcile();
  }

  function clearLatestRecommendedMarkers(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    for (const card of root.querySelectorAll(
      `.${LATEST_RECOMMENDED_HIDDEN_CLASS}`
    )) {
      setToolkitClass(card, LATEST_RECOMMENDED_HIDDEN_CLASS, false);
    }
    for (const module of root.querySelectorAll(
      `.${STRONG_FEED_PROMOTION_HIDDEN_CLASS}`
    )) {
      setToolkitClass(module, STRONG_FEED_PROMOTION_HIDDEN_CLASS, false);
    }
  }

  function findLatestFeedRoot() {
    if (typeof document.getElementById !== "function") return null;
    const root = document.getElementById("scroller");
    return hasClass(root, "vue-recycle-scroller") ? root : null;
  }

  function findPageFeedDiscoveryHost() {
    if (typeof document.querySelector !== "function") return null;
    if (
      resolveProfileRouteTargetUid() !== null &&
      autoExpandIsActiveForRoute()
    ) {
      return document.querySelector("main");
    }
    return document.querySelector(".homeWrap");
  }

  function currentPageFeedDiscoveryRouteKey() {
    return pageFeedFeaturesAreActiveForRoute() &&
      typeof location?.href === "string"
      ? location.href
      : null;
  }

  function cancelPageFeedRootDiscovery() {
    if (pageFeedRootDiscoveryTimer !== null) {
      clearTimeout(pageFeedRootDiscoveryTimer);
    }
    pageFeedRootDiscoveryTimer = null;
    pageFeedRootDiscoveryAttempts = 0;
    pageFeedRootDiscoveryRouteKey = null;
  }

  function schedulePageFeedRootDiscovery() {
    const routeKey = currentPageFeedDiscoveryRouteKey();
    if (routeKey === null || findLatestFeedRoot()) {
      cancelPageFeedRootDiscovery();
      return false;
    }
    if (
      pageFeedRootDiscoveryTimer !== null &&
      pageFeedRootDiscoveryRouteKey === routeKey
    ) {
      return false;
    }
    if (
      pageFeedRootDiscoveryTimer !== null ||
      pageFeedRootDiscoveryRouteKey !== routeKey
    ) {
      cancelPageFeedRootDiscovery();
    }
    pageFeedRootDiscoveryRouteKey = routeKey;
    pageFeedRootDiscoveryTimer = setTimeout(() => {
      pageFeedRootDiscoveryTimer = null;
      if (
        currentPageFeedDiscoveryRouteKey() !== routeKey ||
        !pageFeedFeaturesAreActiveForRoute()
      ) {
        cancelPageFeedRootDiscovery();
        return;
      }
      if (findLatestFeedRoot() || findPageFeedDiscoveryHost()) {
        pageFeedRootDiscoveryAttempts = 0;
        pageFeedRootDiscoveryRouteKey = null;
        installLatestFeedRecommendationFilter();
        return;
      }
      pageFeedRootDiscoveryAttempts += 1;
      if (
        pageFeedRootDiscoveryAttempts >=
        PAGE_FEED_ROOT_DISCOVERY_MAX_ATTEMPTS
      ) {
        cancelPageFeedRootDiscovery();
        return;
      }
      schedulePageFeedRootDiscovery();
    }, PAGE_FEED_ROOT_DISCOVERY_DELAY_MS);
    return true;
  }

  function disconnectLatestRecommendedDiscoveryObserver() {
    if (latestRecommendedDiscoveryObserver) {
      latestRecommendedDiscoveryObserver.disconnect();
    }
    latestRecommendedDiscoveryObserver = null;
    latestRecommendedDiscoveryHost = null;
  }

  function teardownLatestFeedRecommendationFilter() {
    if (
      !latestRecommendedObserver &&
      !latestRecommendedRoot &&
      !latestRecommendedDiscoveryObserver &&
      !latestRecommendedDiscoveryHost &&
      !longPostIntersectionObserver &&
      pageFeedRootDiscoveryTimer === null &&
      pageFeedReconcileHandle === null
    ) {
      return;
    }
    cancelPageFeedRootDiscovery();
    cancelPageFeedReconcile();
    teardownLongPostAutoExpand();
    if (latestRecommendedObserver) latestRecommendedObserver.disconnect();
    disconnectLatestRecommendedDiscoveryObserver();
    clearLatestRecommendedMarkers(latestRecommendedRoot);
    latestRecommendedObserver = null;
    latestRecommendedRoot = null;
  }

  function installLatestFeedRecommendationFilter() {
    if (!pageFeedFeaturesAreActiveForRoute()) {
      teardownLatestFeedRecommendationFilter();
      return false;
    }
    const root = findLatestFeedRoot();
    if (!root) {
      cancelPageFeedReconcile();
      if (latestRecommendedObserver) {
        latestRecommendedObserver.disconnect();
        clearLatestRecommendedMarkers(latestRecommendedRoot);
        latestRecommendedObserver = null;
        latestRecommendedRoot = null;
      }
      teardownLongPostAutoExpand();
      const discoveryHost = findPageFeedDiscoveryHost();
      if (
        latestRecommendedDiscoveryObserver &&
        (latestRecommendedDiscoveryHost !== discoveryHost ||
          latestRecommendedDiscoveryHost?.isConnected === false)
      ) {
        disconnectLatestRecommendedDiscoveryObserver();
      }
      if (
        !latestRecommendedDiscoveryObserver &&
        discoveryHost &&
        discoveryHost.isConnected !== false
      ) {
        cancelPageFeedRootDiscovery();
        latestRecommendedDiscoveryHost = discoveryHost;
        latestRecommendedDiscoveryObserver = new MutationObserver(() => {
          if (!pageFeedFeaturesAreActiveForRoute()) {
            teardownLatestFeedRecommendationFilter();
            return;
          }
          if (findLatestFeedRoot()) installLatestFeedRecommendationFilter();
        });
        latestRecommendedDiscoveryObserver.observe(discoveryHost, {
          childList: true,
          subtree: true,
        });
      } else if (!latestRecommendedDiscoveryObserver) {
        schedulePageFeedRootDiscovery();
      }
      return false;
    }
    cancelPageFeedRootDiscovery();
    disconnectLatestRecommendedDiscoveryObserver();
    if (latestRecommendedRoot === root && latestRecommendedObserver) {
      cancelPageFeedReconcile();
      reconcileCurrentPageFeed();
      return true;
    }
    cancelPageFeedReconcile();
    if (latestRecommendedObserver) latestRecommendedObserver.disconnect();
    teardownLongPostAutoExpand();
    clearLatestRecommendedMarkers(latestRecommendedRoot);
    latestRecommendedRoot = root;
    latestRecommendedObserver = new MutationObserver(
      processLatestRecommendedMutations
    );
    latestRecommendedObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-index", "data-active", "class"],
    });
    reconcileCurrentPageFeed();
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
