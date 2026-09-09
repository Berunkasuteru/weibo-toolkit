
  const ENDPOINT = "/ajax/friendships/friends";
  const REQUEST_DELAY_MS = 750;
  const OBJECT_URL_REVOKE_DELAY_MS = 1000;
  const MAX_REQUESTS = 100;
  const APP_VERSION = "0.9.1";
  const SCHEMA_VERSION = 1;
  const STORAGE_PREFIX = "weiboToolkit.friendRadar.v1.";
  const FOLLOWER_SNAPSHOT_SCHEMA_VERSION = 1;
  const FOLLOWER_SNAPSHOT_STORAGE_PREFIX =
    "weiboToolkit.followerSnapshot.v1.";
  const FOLLOWER_PAGE_SIZE = 20;
  const FOLLOWER_REQUEST_DELAY_MS = 500;
  const FOLLOWER_MAX_DATA_PAGES = 100;
  const FOLLOWER_MAX_TERMINAL_VERIFICATION_REQUESTS = 1;
  const FOLLOWER_COMPLETION = "COMPLETE_API_VISIBLE";
  const FOLLOWER_REMOVE_ENDPOINT = "/ajax/profile/destroyFollowers";
  // Temporary reconciliation state for removals this Toolkit itself performed and
  // validated. It is not a removal history: it holds only a UID and the moment
  // the success was validated, it is consumed by the next successful Snapshot,
  // and it expires on its own.
  const FOLLOWER_REMOVAL_PENDING_SCHEMA_VERSION = 1;
  const FOLLOWER_REMOVAL_PENDING_STORAGE_PREFIX =
    "weiboToolkit.followerRemovalPending.v1.";
  const FOLLOWER_REMOVAL_PENDING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const FOLLOWER_FILTER_STATE = Object.freeze({
    TRUE: "TRUE",
    FALSE: "FALSE",
    UNKNOWN: "UNKNOWN",
  });
  const FOLLOWER_EVENT = Object.freeze({
    VISIBLE_FOLLOWER_ADDED: "VISIBLE_FOLLOWER_ADDED",
    VISIBLE_FOLLOWER_DISAPPEARED: "VISIBLE_FOLLOWER_DISAPPEARED",
  });
  const FOLLOWER_EVENT_LABELS = Object.freeze({
    [FOLLOWER_EVENT.VISIBLE_FOLLOWER_ADDED]: "新增到API可见粉丝",
    [FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED]:
      "从API可见粉丝中消失",
  });
  const BACKUP_FORMAT = "weibo-toolkit.friend-radar";
  // v1 carried Friend Radar durable state only. v2 adds the Follower Snapshot
  // durable state as a sibling field; v1 files stay restorable forever.
  const BACKUP_VERSION = 2;
  const SUPPORTED_BACKUP_VERSIONS = Object.freeze([1, 2]);
  const BACKUP_MIME = "application/json;charset=utf-8";
  const AUTO_INTERVAL_PREFIX = "weiboToolkit.friendRadar.autoInterval.v1.";
  const AUTO_ATTEMPT_PREFIX = "weiboToolkit.friendRadar.autoAttempt.v1.";
  const AUTO_OUTCOME_PREFIX = "weiboToolkit.friendRadar.autoOutcome.v1.";
  const FOLLOWER_AUTO_INTERVAL_PREFIX =
    "weiboToolkit.followerSnapshot.autoInterval.v1.";
  const FOLLOWER_AUTO_ATTEMPT_PREFIX =
    "weiboToolkit.followerSnapshot.autoAttempt.v1.";
  const FOLLOWER_AUTO_OUTCOME_PREFIX =
    "weiboToolkit.followerSnapshot.autoOutcome.v1.";
  const AUTO_STARTUP_DELAY_MS = 5000;
  const AUTO_ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  const AUTO_STATUS_DURATION_MS = 5000;
  const AUTO_INTERVAL_HOURS = Object.freeze([0, 24, 48, 72, 168, 360]);
  const LAUNCHER_LABEL = "Weibo Toolkit";
  // Toolkit-level appearance preference, deliberately outside the versioned
  // Friend Radar state and outside backup v1.
  const THEME_KEY = "weiboToolkit.theme.v1";
  const DEFAULT_THEME = "system";
  const HIDE_HOT_SEARCH_KEY = "weiboToolkit.page.hideHotSearch.v1";
  const HIDE_RIGHT_SIDEBAR_KEY = "weiboToolkit.page.hideRightSidebar.v1";
  const HIDE_TOP_RECOMMEND_KEY = "weiboToolkit.page.hideTopRecommend.v1";
  const HIDE_TOP_VIDEO_KEY = "weiboToolkit.page.hideTopVideo.v1";
  const PREFER_LATEST_FEED_KEY = "weiboToolkit.page.preferLatestFeed.v1";
  const HIDE_LATEST_RECOMMENDED_KEY =
    "weiboToolkit.page.hideLatestRecommended.v1";
  const STRONG_FEED_PROMOTION_FILTER_KEY =
    "weiboToolkit.page.strongFeedPromotionFilter.v1";
  const AUTO_EXPAND_LONG_POSTS_KEY =
    "weiboToolkit.page.autoExpandLongPosts.v1";
  const SHOW_PROFILE_EXTRAS_KEY =
    "weiboToolkit.page.showProfileExtras.v1";
  const PROFILE_VISIT_STORAGE_PREFIX =
    "weiboToolkit.profileVisits.v1.";
  const CHANGELOG_SEEN_VERSION_KEY =
    "weiboToolkit.ui.lastSeenChangelogVersion.v1";
  const USAGE_ENABLED_KEY = "weiboToolkit.usage.enabled.v1";
  const USAGE_CORNER_KEY = "weiboToolkit.usage.corner.v1";
  const USAGE_STORAGE_PREFIX = "weiboToolkit.usage.v1.";
  const USAGE_LOCK_PREFIX = "weibo-toolkit-usage-state-";
  const USAGE_STATE_VERSION = 1;
  const USAGE_INACTIVITY_MS = 60 * 1000;
  const USAGE_HEARTBEAT_MS = 10 * 1000;
  const USAGE_MAX_HEARTBEAT_GAP_MS = 15 * 1000;
  const USAGE_FLUSH_MS = 20 * 1000;
  const USAGE_POST_DWELL_MS = 800;
  const USAGE_POST_VISIBILITY_RATIO = 0.5;
  const USAGE_RETENTION_DAYS = 90;
  const USAGE_CORNER_ID = "wfr-usage-corner";
  const LATEST_FEED_SESSION_MARKER =
    "weiboToolkit.page.latestFeedNormalized.v1";
  const PAGE_PREFERENCE_STYLE_ID = "wfr-page-preferences-style";
  const LATEST_RECOMMENDED_HIDDEN_CLASS =
    "wfr-latest-recommended-hidden";
  const STRONG_FEED_PROMOTION_HIDDEN_CLASS =
    "wfr-strong-feed-promotion-hidden";
  const STRONG_FEED_PROMOTION_TAG_TEXTS = Object.freeze([
    "荐读",
    "广告",
    "推荐",
    "推广",
  ]);
  const AUTO_EXPAND_INTERSECTION_RATIO = 0.25;
  const PROFILE_EXTRAS_ID = "wfr-profile-extras";
  const WEIBO_MAIN_ORIGIN = "https://weibo.com";
  const AUTO_CHANGELOG_FROM_VERSION = "0.8.1";
  const PROFILE_TAB_LABELS = Object.freeze([
    "精选",
    "微博",
    "视频",
    "音频",
    "相册",
  ]);
  const CHANGELOG_BY_VERSION = Object.freeze({
    "0.9.1": Object.freeze({
      added: Object.freeze([
        "新增可选“强力规则”，可进一步尝试隐藏推荐、广告等推广标签和明确广告模块",
        "新增“自动展开长微博”，可在首页和“最新微博”中自动展开进入视野的外层长微博",
      ]),
      improved: Object.freeze([
        "“页面设置”整理为“浏览体验”，并分为“信息流 / 增强 / 净化”三个页签",
        "整理页面功能与启动任务的生命周期边界，减少互相干扰",
      ]),
    }),
    "0.9.0": Object.freeze({
      improved: Object.freeze([
        "项目源码拆分为可维护的有序源码片段，发布脚本仍保持单文件",
        "新增可复现构建与源码/发布文件一致性校验",
      ]),
    }),
    "0.8.3": Object.freeze({
      improved: Object.freeze([
        "“隐藏荐读”现在同时支持首页和“最新微博”",
      ]),
      fixed: Object.freeze([
        "修复首页中明确标记为“荐读”的内容不会被该设置隐藏的问题",
      ]),
    }),
    "0.8.2": Object.freeze({
      improved: Object.freeze([
        "项目说明改为中文主导，安装、隐私与功能边界更清晰",
        "新增公开核心回归测试，便于验证关键数据语义与导出安全",
      ]),
    }),
    "0.8.1": Object.freeze({
      added: Object.freeze([
        "最新微博可隐藏明确标记为“荐读”的内容",
        "个人主页可显示 Toolkit 本地小档案",
        "新增“微博计步器”，可在本地查看网页版活跃时间和浏览数量",
      ]),
      improved: Object.freeze(["新增版本更新提示，可查看历史更新记录"]),
    }),
    "0.8.0": Object.freeze({
      added: Object.freeze([
        "新增默认关闭的“页面设置”",
        "每个标签页可优先一次进入按时间排序的“最新微博”",
        "可独立隐藏微博热搜、整个右侧栏、顶部推荐或顶部视频入口",
      ]),
    }),
    "0.7.1": Object.freeze({
      improved: Object.freeze([
        "自动更新设置可显示最近一次自动尝试的成功、失败或安全跳过结果",
        "粉丝体检筛选布局更清晰，并支持公开微博数上限",
      ]),
      fixed: Object.freeze([
        "粉丝快照自动更新不再依据不可靠的接口总数提前放弃扫描",
      ]),
    }),
    "0.7.0": Object.freeze({
      added: Object.freeze([
        "新增粉丝快照与中性的粉丝变化记录",
        "新增本地粉丝体检筛选",
        "支持逐个或最多 50 个一批、逐项确认并顺序执行的移除粉丝操作",
        "备份升级为 v2，可包含粉丝快照和粉丝变化记录",
        "私信 Markdown 导出可在支持的浏览器中先选择保存位置",
      ]),
    }),
    "0.6.0": Object.freeze({
      added: Object.freeze([
        "可将当前普通一对一私信会话导出为紧凑的 Markdown 对话记录",
        "支持顺序读取较长历史、进度显示、取消和分页完整性校验",
      ]),
    }),
    "0.5.2": Object.freeze({
      improved: Object.freeze([
        "Toolkit 外观可选择跟随系统、浅色或深色",
        "改善浅色模式下的启动器可读性，并集中显示自动更新与外观设置",
      ]),
    }),
    "0.5.1": Object.freeze({
      added: Object.freeze([
        "启动器新增未读事件提示，并可查看关系概览",
        "关系事件可导出为 CSV 或 Markdown",
      ]),
      improved: Object.freeze([
        "用户脚本菜单简化为一个“打开工具箱”入口",
        "Toolkit 自有界面支持跟随系统深色外观",
      ]),
    }),
    "0.5.0": Object.freeze({
      added: Object.freeze([
        "新增备份恢复：验证账号和文件后预览并完整替换本地关系雷达状态",
        "新增默认关闭的页面打开时自动更新，可选择多个固定间隔",
      ]),
    }),
    "0.4.0": Object.freeze({
      added: Object.freeze([
        "立即更新时显示当前页、请求数和已验证记录数",
        "新增事件详情和按 UID 归并的个人关系时间线",
        "事件列表可按昵称或 UID 搜索",
      ]),
    }),
    "0.3.2": Object.freeze({
      improved: Object.freeze([
        "单次关系雷达扫描请求上限从 30 提高到 100",
        "达到请求上限时显示已请求、已读取和接口报告总数",
      ]),
    }),
    "0.3.1": Object.freeze({
      improved: Object.freeze(["在用户脚本元数据中明确标注 MPL-2.0 许可"]),
    }),
    "0.3.0": Object.freeze({
      added: Object.freeze([
        "关系雷达可按稳定 UID 保存可见关注快照并比较后续变化",
        "记录新增、消失、关注你的状态变化和昵称变化",
        "提供独立的 Weibo Toolkit 启动器和用户脚本菜单入口",
        "可手动导出当前账号的本地 JSON 备份",
      ]),
    }),
  });
  const THEME_VALUES = Object.freeze(["system", "light", "dark"]);
  const THEME_CHOICES = Object.freeze([
    ["system", "跟随系统"],
    ["light", "浅色"],
    ["dark", "深色"],
  ]);

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
    EVENT_EXPORT_ERROR: "事件导出失败",
    UPDATE_ALREADY_RUNNING: "更新正在进行",
    STATE_LOCK_UNAVAILABLE:
      "暂时无法安全地保存本地数据，本次操作未保存。请稍后重试。",
    UNKNOWN_FAILURE: "未知失败",
  });

  const hasOwn = (value, key) =>
    Object.prototype.hasOwnProperty.call(value, key);

  let updateRunning = false;
  let followerUpdateRunning = false;
  let followerCancelRequested = false;
  let followerRemovalInFlight = false;
  let panelRoot = null;
  let launcherButton = null;
  let launcherLabel = null;
  let launcherBadge = null;
  let launcherStatusTimer = null;
  let currentTheme = DEFAULT_THEME;
  let pageCleanupPreferences = null;
  let pagePreferenceStyleNode = null;
  let preferLatestFeed = false;
  let pageRouteHookInstalled = false;
  let pageRouteSyncScheduled = false;
  let latestFeedNavigationPending = false;
  let latestRecommendedObserver = null;
  let latestRecommendedRoot = null;
  let latestRecommendedDiscoveryObserver = null;
  let longPostIntersectionObserver = null;
  let longPostObservedControls = new Set();
  let longPostClickedControlStates = new WeakMap();
  let profileExtrasObserver = null;
  let profileExtrasObservedMain = null;
  let profileExtrasObservedHost = null;
  let profileExtrasDiscoveryTimer = null;
  let profileExtrasDiscoveryCount = 0;
  let profileExtrasEnsureScheduled = false;
  let activeProfileContext = null;
  let activeProfileNicknamePopover = null;
  let usageEnabledPreference = false;
  let usageCornerPreference = false;
  let usageRuntimeOwnerUid = null;
  let usageState = null;
  let usageSessionOwnerUid = null;
  let usageSessionActiveSeconds = 0;
  let usageSessionPostIds = new Set();
  let usagePendingActiveSeconds = 0;
  let usagePendingPostIds = new Set();
  let usageLastActivityMonotonic = Number.NEGATIVE_INFINITY;
  let usageLastHeartbeatMonotonic = null;
  let usageHeartbeatTimer = null;
  let usageFlushTimer = null;
  let usageFlushInFlight = null;
  let usageListenersInstalled = false;
  let usageFeedRoot = null;
  let usageFeedObserver = null;
  let usageIntersectionObserver = null;
  let usageFeedDiscoveryTimer = null;
  let usageFeedDiscoveryCount = 0;
  let usageCardStates = new Map();
  let usageCornerButton = null;
  let panelDismissHandler = null;

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

  // Cross-tab serialization for the Friend Radar durable state, mirroring the
  // follower one. GM storage has no atomic compare-and-swap, so the check inside
  // persistState below is an integrity check only: this lock is what actually
  // serializes tabs. It is owner-scoped and held only for local storage work —
  // never across a scan, a delay, or a UI wait.
  const FRIEND_RADAR_STATE_LOCK_PREFIX = "weibo-toolkit-friend-radar-state-";

  function friendRadarStateLockUnavailable(reason, error) {
    const result = {
      ok: false,
      failureKind: "STATE_LOCK_UNAVAILABLE",
      reason,
    };
    if (error) result.errorName = error.name ? String(error.name) : "Error";
    return result;
  }

  async function withFriendRadarStateLock(ownerUid, transaction) {
    const lockManager = pageLockManager();
    if (lockManager === null) {
      return friendRadarStateLockUnavailable("LOCK_UNAVAILABLE");
    }
    try {
      return await lockManager.request.call(
        lockManager,
        FRIEND_RADAR_STATE_LOCK_PREFIX + ownerUid,
        { mode: "exclusive" },
        async (lock) => {
          if (lock === null) {
            return friendRadarStateLockUnavailable("LOCK_NOT_ACQUIRED");
          }
          return await transaction();
        }
      );
    } catch (error) {
      return friendRadarStateLockUnavailable("LOCK_REQUEST_FAILED", error);
    }
  }

  // Unlocked helper: callers must already hold the Friend Radar state lock. It
  // writes exact bytes (or restores absence) so a rollback reproduces the prior
  // value rather than a re-serialization of it.
  function writeFriendRadarRaw(ownerUid, raw) {
    const key = storageKey(ownerUid);
    try {
      if (raw === null) {
        GM_deleteValue(key);
        return GM_getValue(key, null) === null;
      }
      GM_setValue(key, raw);
      return GM_getValue(key, null) === raw;
    } catch (_) {
      return false;
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

  // Unread is derived from events[].read on demand. No unread counter is persisted,
  // and nothing here may change read state.
  function countUnreadEvents(events) {
    return events.filter((event) => !event.read).length;
  }

  function formatUnreadBadge(unreadEventCount) {
    if (!Number.isSafeInteger(unreadEventCount) || unreadEventCount <= 0) {
      return null;
    }
    return unreadEventCount > 99 ? "99+" : String(unreadEventCount);
  }

  // Read-only derivation over the already validated snapshot and stored events.
  // Current counts describe the latest snapshot; historical counts are event
  // occurrences, so one UID can contribute several times to the same type.
  function deriveRelationshipOverview(state) {
    const historicalEventCounts = {};
    for (const type of Object.values(EVENT)) historicalEventCounts[type] = 0;
    for (const event of state.events) {
      if (hasOwn(historicalEventCounts, event.type)) {
        historicalEventCounts[event.type] += 1;
      }
    }

    const snapshot = state.latestSnapshot;
    let current = null;
    if (snapshot !== null) {
      // Every snapshot record is an account the user follows, so "one-way" is
      // exactly the visible records not observed as following back.
      const mutual = snapshot.records.filter((record) => record.followsMe).length;
      current = {
        capturedAt: snapshot.capturedAt,
        visibleFollowing: snapshot.visibleCount,
        mutual,
        oneWay: snapshot.visibleCount - mutual,
      };
    }

    return {
      hasBaseline: snapshot !== null,
      current,
      totalEvents: state.events.length,
      unreadEvents: countUnreadEvents(state.events),
      historicalEventCounts,
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

    // The scan is finished before the lock is taken. Everything below is a short
    // local transaction over state read inside the lock, so a state another tab
    // committed meanwhile is seen by the freshness check instead of overwritten.
    const committed = await withFriendRadarStateLock(
      uidResult.uid,
      async () => {
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
        return { ok: true, prepared };
      }
    );
    if (!committed.ok) return committed;
    const prepared = committed.prepared;

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
