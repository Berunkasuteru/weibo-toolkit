
  const FOLLOWER_HYGIENE_PAGE_SIZE = 50;
  // A Toolkit product safety limit on one deliberate manual batch, not a claim
  // about any Weibo server rate limit. It matches the local Hygiene page size, so
  // one reviewed page is the largest unit of work; fifty sequential writes spaced
  // by FOLLOWER_BATCH_REMOVE_DELAY_MS mean about 147 seconds of inter-write
  // pauses, which the execution-phase progress and stop control are built for.
  const FOLLOWER_BATCH_MAX_SELECTION = 50;
  const FOLLOWER_BATCH_REMOVE_DELAY_MS = 3000;

  function normalizeHygieneThreshold(value) {
    if (value === null || typeof value === "undefined" || value === "") {
      return null;
    }
    return normalizeNonNegativeInteger(value);
  }

  function normalizeHygieneDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    const timestamp = Date.parse(value + "T00:00:00.000Z");
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().slice(0, 10) === value
      ? value
      : null;
  }

  // UI-only grouping of the raw 关注来源 string. It never rewrites what the
  // Snapshot stored: cards keep showing the exact API string, and this table is
  // consulted only when filtering and when naming a match reason.
  //
  // Rules are deliberately narrow and explicit, derived from the source strings
  // actually observed in this repository's fixtures and probes
  // (兴趣推荐, 微博推荐, 搜索, HUAWEI Mate 40 Pro, 普通来源, 来源, 另一来源, 空值):
  //   RECOMMENDATION  exact 兴趣推荐/微博推荐/好友推荐, or a value ending in 推荐
  //   PROFILE         exact 个人主页/主页/他人主页
  //   SEARCH          exact 搜索/微博搜索/搜索结果, or a value ending in 搜索
  //   OTHER           any other known, non-empty value, device and client names
  //                   among them: the card already shows the exact string, so a
  //                   separate phone-client category earned nothing
  //   UNKNOWN         no source metadata at all (null/empty/blank)
  const FOLLOWER_SOURCE_UNKNOWN = "UNKNOWN";
  const FOLLOWER_SOURCE_CATEGORIES = Object.freeze([
    // Grouped labels only: the rule set covers every recommendation source, so
    // the category is 推荐 rather than the narrower 兴趣推荐.
    Object.freeze({ key: "RECOMMENDATION", label: "推荐" }),
    Object.freeze({ key: "PROFILE", label: "个人主页" }),
    Object.freeze({ key: "SEARCH", label: "搜索" }),
    Object.freeze({ key: "OTHER", label: "其他来源" }),
    Object.freeze({ key: FOLLOWER_SOURCE_UNKNOWN, label: "来源未知" }),
  ]);
  const FOLLOWER_SOURCE_CATEGORY_KEYS = Object.freeze(
    FOLLOWER_SOURCE_CATEGORIES.map((category) => category.key)
  );
  const FOLLOWER_SOURCE_RECOMMENDATION_ALIASES = Object.freeze([
    "兴趣推荐",
    "微博推荐",
    "好友推荐",
  ]);
  const FOLLOWER_SOURCE_PROFILE_ALIASES = Object.freeze([
    "个人主页",
    "主页",
    "他人主页",
  ]);
  const FOLLOWER_SOURCE_SEARCH_ALIASES = Object.freeze([
    "搜索",
    "微博搜索",
    "搜索结果",
  ]);

  function followerSourceCategoryLabel(key) {
    const category = FOLLOWER_SOURCE_CATEGORIES.find(
      (candidate) => candidate.key === key
    );
    return category ? category.label : key;
  }

  function classifyFollowerSource(sourceText) {
    const value = typeof sourceText === "string" ? sourceText.trim() : "";
    if (value === "") return FOLLOWER_SOURCE_UNKNOWN;
    if (
      FOLLOWER_SOURCE_RECOMMENDATION_ALIASES.includes(value) ||
      value.endsWith("推荐")
    ) {
      return "RECOMMENDATION";
    }
    if (FOLLOWER_SOURCE_PROFILE_ALIASES.includes(value)) return "PROFILE";
    if (
      FOLLOWER_SOURCE_SEARCH_ALIASES.includes(value) ||
      value.endsWith("搜索")
    ) {
      return "SEARCH";
    }
    return "OTHER";
  }

  function normalizeHygieneSourceCategories(raw) {
    if (!Array.isArray(raw)) return [];
    const selected = [];
    for (const key of FOLLOWER_SOURCE_CATEGORY_KEYS) {
      if (raw.includes(key)) selected.push(key);
    }
    return selected;
  }

  function normalizeHygieneFilters(raw) {
    const statusesMax = normalizeHygieneThreshold(raw.statusesMax);
    const followersMax = normalizeHygieneThreshold(raw.followersMax);
    const friendsMax = normalizeHygieneThreshold(raw.friendsMax);
    const createdAfter = normalizeHygieneDate(raw.createdAfter);
    const filters = {
      mode: raw.mode === "ANY" ? "ANY" : "ALL",
      ownerNotFollowing: raw.ownerNotFollowing === true,
      statusesMax,
      followersMax,
      friendsMax,
      createdAfter,
      unverified: raw.unverified === true,
      // The whole source group is one criterion: the selected categories are
      // OR-ed with each other, and that single outcome then takes part in the
      // global ALL/ANY combination.
      sourceCategories: normalizeHygieneSourceCategories(raw.sourceCategories),
    };
    filters.activeCount =
      Number(filters.ownerNotFollowing) +
      Number(filters.statusesMax !== null) +
      Number(filters.followersMax !== null) +
      Number(filters.friendsMax !== null) +
      Number(filters.createdAfter !== null) +
      Number(filters.unverified) +
      Number(filters.sourceCategories.length > 0);
    return filters;
  }

  function followerCreatedDate(record) {
    if (typeof record.createdAt !== "string") return null;
    const timestamp = Date.parse(record.createdAt);
    if (!Number.isFinite(timestamp)) return null;
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function getHygieneMatchReasons(record, filters) {
    const reasons = [];
    if (filters.ownerNotFollowing && record.ownerFollowing === false) {
      reasons.push("未关注 TA");
    }
    if (
      filters.statusesMax !== null &&
      record.statusesCount !== null &&
      record.statusesCount <= filters.statusesMax
    ) {
      reasons.push("API显示公开微博数 ≤ " + String(filters.statusesMax));
    }
    if (
      filters.followersMax !== null &&
      record.followersCount !== null &&
      record.followersCount <= filters.followersMax
    ) {
      reasons.push("API显示粉丝数 ≤ " + String(filters.followersMax));
    }
    if (
      filters.friendsMax !== null &&
      record.friendsCount !== null &&
      record.friendsCount <= filters.friendsMax
    ) {
      reasons.push("API显示关注数 ≤ " + String(filters.friendsMax));
    }
    const createdDate = followerCreatedDate(record);
    if (
      filters.createdAfter !== null &&
      createdDate !== null &&
      createdDate > filters.createdAfter
    ) {
      reasons.push("注册时间晚于 " + filters.createdAfter);
    }
    if (filters.unverified && record.verified === false) {
      reasons.push("API显示为未认证");
    }
    if (filters.sourceCategories.length > 0) {
      const category = classifyFollowerSource(record.sourceText);
      if (filters.sourceCategories.includes(category)) {
        // Exactly one reason for the whole group, so ALL keeps counting one
        // criterion per selected condition.
        reasons.push(
          category === FOLLOWER_SOURCE_UNKNOWN
            ? "来源未知"
            : "来源 " + followerSourceCategoryLabel(category)
        );
      }
    }
    return reasons;
  }

  function recordMatchesHygieneFilters(record, filters) {
    if (filters.activeCount === 0) return false;
    const reasons = getHygieneMatchReasons(record, filters);
    return filters.mode === "ANY"
      ? reasons.length > 0
      : reasons.length === filters.activeCount;
  }

  function filterFollowerSnapshot(snapshot, rawFilters) {
    const filters = normalizeHygieneFilters(rawFilters);
    if (filters.activeCount === 0) {
      return { filters, matches: [] };
    }
    const matches = [];
    for (const record of snapshot.records) {
      const reasons = getHygieneMatchReasons(record, filters);
      const matched =
        filters.mode === "ANY"
          ? reasons.length > 0
          : reasons.length === filters.activeCount;
      if (matched) matches.push({ record, reasons });
    }
    return { filters, matches };
  }

  function paginateFollowerHygieneMatches(matches, requestedPage) {
    const totalResults = matches.length;
    const totalPages =
      totalResults === 0
        ? 0
        : Math.ceil(totalResults / FOLLOWER_HYGIENE_PAGE_SIZE);
    const normalizedRequestedPage =
      Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    const page =
      totalPages === 0
        ? 1
        : Math.min(normalizedRequestedPage, totalPages);
    const start = (page - 1) * FOLLOWER_HYGIENE_PAGE_SIZE;
    return {
      totalResults,
      totalPages,
      page,
      records:
        totalPages === 0
          ? []
          : matches.slice(start, start + FOLLOWER_HYGIENE_PAGE_SIZE),
      hasPrevious: totalPages > 0 && page > 1,
      hasNext: totalPages > 0 && page < totalPages,
    };
  }

  function hygieneFact(value, formatter) {
    if (value === null || typeof value === "undefined") return "未知";
    return typeof formatter === "function" ? formatter(value) : String(value);
  }

  // Same facts as before, one wrapping line. Unknown stays unknown: a missing
  // count is never rendered as 0 and a missing flag is never rendered as false.
  function hygieneFactLine(record) {
    return [
      "公开微博 " + hygieneFact(record.statusesCount),
      "粉丝 " + hygieneFact(record.followersCount),
      "关注 " + hygieneFact(record.friendsCount),
      "注册 " +
        hygieneFact(record.createdAt, (value) => formatDate(value)),
      "认证 " +
        hygieneFact(record.verified, (value) => (value ? "是" : "否")),
      "来源 " +
        hygieneFact(record.sourceText === "" ? null : record.sourceText),
    ].join(" · ");
  }

  function readWeiboXsrfToken() {
    try {
      const match = document.cookie.match(
        /(?:^|;\s*)XSRF-TOKEN=([^;]*)/
      );
      if (!match) return null;
      const token = decodeURIComponent(match[1]);
      return token !== "" ? token : null;
    } catch (_) {
      return null;
    }
  }

  function normalizeWeiboVersionHeader(value) {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const normalized = String(value).trim();
    return normalized === "" ? null : normalized;
  }

  function resolveFollowerRemovalSecurityContext() {
    const xsrfToken = readWeiboXsrfToken();
    let clientVersion = null;
    let serverVersion = null;
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow.$VERSION) {
        clientVersion = normalizeWeiboVersionHeader(
          unsafeWindow.$VERSION.CLIENT
        );
        serverVersion = normalizeWeiboVersionHeader(
          unsafeWindow.$VERSION.SERVER
        );
      }
    } catch (_) {
      // Missing page-realm version metadata prevents the write.
    }
    if (
      xsrfToken === null ||
      clientVersion === null ||
      serverVersion === null
    ) {
      return {
        ok: false,
        failureKind: "REMOVAL_SECURITY_CONTEXT_UNAVAILABLE",
        requestSent: false,
      };
    }
    return { ok: true, xsrfToken, clientVersion, serverVersion };
  }

  async function removeSingleFollower(uid, expectedOwnerUid) {
    const canonicalUid = normalizeStableUid(uid);
    if (canonicalUid === null || canonicalUid !== uid) {
      return {
        ok: false,
        failureKind: "REMOVAL_INVALID_UID",
        requestSent: false,
      };
    }
    const ownerBefore = determineCurrentUid();
    if (!ownerBefore.ok || ownerBefore.uid !== expectedOwnerUid) {
      return {
        ok: false,
        failureKind: "ACCOUNT_CHANGED_DURING_REMOVAL",
        requestSent: false,
      };
    }
    const security = resolveFollowerRemovalSecurityContext();
    if (!security.ok) return security;

    const body = new URLSearchParams();
    body.set("uid", canonicalUid);
    let response;
    try {
      response = await fetch(
        new URL(FOLLOWER_REMOVE_ENDPOINT, location.origin).href,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            "X-XSRF-TOKEN": security.xsrfToken,
            "client-version": security.clientVersion,
            "server-version": security.serverVersion,
          },
          body,
          cache: "no-store",
          redirect: "error",
        }
      );
    } catch (error) {
      return {
        ok: false,
        failureKind: "REMOVAL_NETWORK_OUTCOME_UNKNOWN",
        requestSent: true,
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }

    const contentType = response.headers.get("content-type") || "";
    let responseBody;
    try {
      responseBody = await response.text();
    } catch (error) {
      return {
        ok: false,
        failureKind: "REMOVAL_RESPONSE_OUTCOME_UNKNOWN",
        requestSent: true,
        httpStatus: response.status,
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
    if (response.status !== 200 || !response.ok) {
      return {
        ok: false,
        failureKind: "REMOVAL_HTTP_OUTCOME_UNKNOWN",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    if (
      !/(?:application|text)\/[^;]*json/i.test(contentType) ||
      looksLikeHtml(contentType, responseBody)
    ) {
      return {
        ok: false,
        failureKind: "REMOVAL_RESPONSE_OUTCOME_UNKNOWN",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch (_) {
      return {
        ok: false,
        failureKind: "REMOVAL_RESPONSE_OUTCOME_UNKNOWN",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    if (!isPlainObject(data) || !hasOwn(data, "ok")) {
      return {
        ok: false,
        failureKind: "REMOVAL_RESPONSE_OUTCOME_UNKNOWN",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    if (typeof data.ok !== "number" || !Number.isFinite(data.ok)) {
      return {
        ok: false,
        failureKind: "REMOVAL_RESPONSE_OUTCOME_UNKNOWN",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    if (data.ok <= 0) {
      return {
        ok: false,
        failureKind: "REMOVAL_API_FAILURE",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    const ownerAfter = determineCurrentUid();
    if (!ownerAfter.ok || ownerAfter.uid !== expectedOwnerUid) {
      return {
        ok: false,
        failureKind: "ACCOUNT_CHANGED_DURING_REMOVAL",
        requestSent: true,
        httpStatus: response.status,
      };
    }
    // Direct evidence: this exact UID was sent, Weibo answered with a validated
    // numeric ok > 0, and the owner never changed. Recorded here so both the
    // single and the batch path share one definition of "confirmed success".
    // Awaited after the POST resolved, so the lock covers only the local write.
    // Its outcome never downgrades this validated success.
    await recordConfirmedFollowerRemoval(
      expectedOwnerUid,
      canonicalUid,
      Date.now()
    );
    return {
      ok: true,
      requestSent: true,
      httpStatus: response.status,
    };
  }

  function buildHygieneCheckbox(text) {
    const label = createElement("label", null, "wfr-hygiene-check");
    const input = createElement("input");
    input.type = "checkbox";
    label.append(input, createElement("span", text));
    return { label, input };
  }

  function buildHygieneValueInput(labelText, type, placeholder) {
    const label = createElement("label", null, "wfr-hygiene-control");
    label.append(createElement("span", labelText));
    const input = createElement("input", null, "wfr-hygiene-input");
    input.type = type;
    if (type === "number") {
      input.min = "0";
      input.step = "1";
    }
    if (placeholder) input.placeholder = placeholder;
    label.append(input);
    return { label, input };
  }

  function followerRemovalResultMessage(result) {
    if (
      result.failureKind === "REMOVAL_SECURITY_CONTEXT_UNAVAILABLE" ||
      result.failureKind === "REMOVAL_INVALID_UID"
    ) {
      return "无法取得当前微博请求所需的安全信息，未执行移除。";
    }
    if (
      result.failureKind === "ACCOUNT_CHANGED_DURING_REMOVAL" &&
      result.requestSent === false
    ) {
      return "当前登录账号已变化，未执行移除。";
    }
    if (result.failureKind === "REMOVAL_API_FAILURE") {
      return "移除未成功，微博接口返回了失败结果。";
    }
    return "请求结果无法确认。没有自动重试，请先在微博中确认当前状态。";
  }

  function followerRemovalOutcomeIsUncertain(result) {
    return Boolean(
      result.requestSent === true &&
        result.failureKind !== "REMOVAL_API_FAILURE"
    );
  }

  function reportFollowerBatchCallback(callback, value) {
    if (typeof callback !== "function") return;
    try {
      callback(value);
    } catch (_) {
      // Presentation callbacks cannot change mutation sequencing.
    }
  }

  async function runFollowerRemovalBatch(records, expectedOwnerUid, options) {
    const total = records.length;
    let success = 0;
    let failure = 0;
    let uncertain = 0;
    for (let index = 0; index < total; index += 1) {
      if (options.isStopRequested()) {
        return {
          outcome: "STOPPED",
          total,
          success,
          failure,
          uncertain,
          notExecuted: total - index,
          stoppedByUser: true,
        };
      }
      const record = records[index];
      reportFollowerBatchCallback(options.onProgress, {
        phase: "REQUESTING",
        current: index + 1,
        total,
        record,
      });
      let result;
      try {
        result = await removeSingleFollower(record.uid, expectedOwnerUid);
      } catch (error) {
        result = {
          ok: false,
          failureKind: "REMOVAL_NETWORK_OUTCOME_UNKNOWN",
          requestSent: true,
          errorName: error && error.name ? String(error.name) : "Error",
        };
      }
      reportFollowerBatchCallback(options.onResult, { record, result });
      if (!result.ok) {
        if (followerRemovalOutcomeIsUncertain(result)) uncertain += 1;
        else failure += 1;
        return {
          outcome:
            uncertain > 0 ? "UNCERTAIN_FAILURE" : "KNOWN_FAILURE",
          total,
          success,
          failure,
          uncertain,
          notExecuted: total - index - 1,
          stoppedByUser: false,
          failedRecord: record,
          failedResult: result,
        };
      }
      success += 1;
      if (options.isStopRequested()) {
        return {
          outcome: "STOPPED",
          total,
          success,
          failure,
          uncertain,
          notExecuted: total - index - 1,
          stoppedByUser: true,
        };
      }
      if (index < total - 1) {
        reportFollowerBatchCallback(options.onProgress, {
          phase: "WAITING",
          current: index + 1,
          total,
          record,
        });
        await delay(FOLLOWER_BATCH_REMOVE_DELAY_MS);
        if (options.isStopRequested()) {
          return {
            outcome: "STOPPED",
            total,
            success,
            failure,
            uncertain,
            notExecuted: total - index - 1,
            stoppedByUser: true,
          };
        }
      }
    }
    return {
      outcome: "COMPLETE",
      total,
      success,
      failure,
      uncertain,
      notExecuted: 0,
      stoppedByUser: false,
    };
  }

  async function startFollowerRemovalBatch(
    records,
    expectedOwnerUid,
    options
  ) {
    if (followerRemovalInFlight) {
      return {
        outcome: "BUSY",
        total: records.length,
        success: 0,
        failure: 0,
        uncertain: 0,
        notExecuted: records.length,
        stoppedByUser: false,
      };
    }
    if (updateRunning || followerUpdateRunning) {
      return {
        outcome: "SCAN_RUNNING",
        total: records.length,
        success: 0,
        failure: 0,
        uncertain: 0,
        notExecuted: records.length,
        stoppedByUser: false,
      };
    }
    followerRemovalInFlight = true;
    try {
      return await runFollowerRemovalBatch(
        records,
        expectedOwnerUid,
        options
      );
    } finally {
      followerRemovalInFlight = false;
    }
  }

  function buildFollowerHygieneCard(match, removalState) {
    const record = match.record;
    const item = createElement("article", null, "wfr-event");
    const canonicalUid = normalizeStableUid(record.uid);
    const removed = removalState.successfullyRemovedUids.has(record.uid);
    const uncertain = removalState.uncertainRemovalUids.has(record.uid);
    const selectionEligible =
      canonicalUid !== null &&
      canonicalUid === record.uid &&
      !removed &&
      !uncertain &&
      !followerRemovalInFlight &&
      !followerUpdateRunning &&
      !updateRunning;
    let selectionInput = null;
    let selectionLabel = null;
    if (selectionEligible) {
      selectionLabel = createElement("label", null, "wfr-hygiene-check");
      selectionInput = createElement("input");
      selectionInput.type = "checkbox";
      selectionInput.checked = removalState.selectedUids.has(record.uid);
      selectionInput.addEventListener("change", () => {
        removalState.changeSelection(
          record,
          selectionInput.checked,
          selectionInput
        );
      });
      selectionLabel.append(
        selectionInput,
        createElement("span", "选择此账号")
      );
    }
    // One identity row instead of three stacked lines: checkbox, screen name and
    // a muted UID that wraps to its own line only when the name is long.
    const head = createElement("div", null, "wfr-hygiene-head");
    if (selectionLabel !== null) head.append(selectionLabel);
    head.append(
      createElement(
        "span",
        record.screenName || "未知",
        "wfr-hygiene-name"
      ),
      createElement("span", "UID " + record.uid, "wfr-hygiene-uid")
    );
    item.append(head);
    const profile = createElement("a", "查看主页", "wfr-button");
    profile.href = "https://weibo.com/u/" + record.uid;
    profile.target = "_blank";
    profile.rel = "noopener noreferrer";
    const actions = createElement("div", null, "wfr-actions");
    actions.append(profile);
    if (removed) {
      const removedStatus = createElement(
        "p",
        "已移除（粉丝快照尚未更新）",
        "wfr-success"
      );
      item.append(removedStatus);
      item.append(
        createElement(
          "p",
          "移除已成功。当前粉丝快照仍是操作前的数据。",
          "wfr-muted"
        )
      );
      const refreshButton = createElement(
        "button",
        "更新粉丝快照",
        "wfr-button"
      );
      const removedButton = createElement("button", "已移除", "wfr-button");
      removedButton.type = "button";
      removedButton.disabled = true;
      refreshButton.type = "button";
      refreshButton.addEventListener("click", () => void updateFollowersNow());
      actions.append(removedButton, refreshButton);
    } else if (uncertain) {
      item.append(
        createElement(
          "p",
          removalState.messages.get(record.uid) ||
            "请求结果无法确认。请先在微博中确认当前状态。",
          "wfr-error"
        )
      );
      const uncertainButton = createElement(
        "button",
        "结果待确认",
        "wfr-button"
      );
      uncertainButton.type = "button";
      uncertainButton.disabled = true;
      actions.append(uncertainButton);
    } else if (canonicalUid !== null && canonicalUid === record.uid) {
      const removeButton = createElement(
        "button",
        "移除粉丝",
        "wfr-button wfr-danger"
      );
      removeButton.type = "button";
      removeButton.disabled = followerUpdateRunning || updateRunning;
      const status = createElement(
        "p",
        removalState.messages.get(record.uid) || "",
        "wfr-muted"
      );
      removeButton.addEventListener("click", () => {
        if (followerRemovalInFlight) {
          status.textContent = "请等待当前移除操作完成。";
          return;
        }
        removeButton.disabled = true;
        const confirmation = createElement(
          "div",
          null,
          "wfr-removal-confirm"
        );
        confirmation.append(
          createElement("h3", "确认移除这个粉丝？"),
          createElement(
            "p",
            "账号：" + (record.screenName || record.uid),
            "wfr-row"
          ),
          createElement(
            "p",
            "这会修改真实的微博关系，移除后对方将不再是你的粉丝。",
            "wfr-muted"
          ),
          createElement(
            "p",
            "Weibo Toolkit无法自动恢复这个操作。",
            "wfr-muted"
          )
        );
        const confirmationActions = createElement(
          "div",
          null,
          "wfr-actions"
        );
        const cancelButton = createElement("button", "取消", "wfr-button");
        const confirmButton = createElement(
          "button",
          "确认移除",
          "wfr-button wfr-danger"
        );
        cancelButton.type = "button";
        confirmButton.type = "button";
        cancelButton.addEventListener("click", () => {
          if (confirmation.parentNode) {
            confirmation.parentNode.removeChild(confirmation);
          }
          removeButton.disabled = false;
        });
        confirmButton.addEventListener("click", async () => {
          cancelButton.disabled = true;
          confirmButton.disabled = true;
          status.textContent = "正在移除…";
          await removalState.confirmRemoval(record);
        });
        confirmationActions.append(cancelButton, confirmButton);
        confirmation.append(confirmationActions);
        item.append(confirmation);
      });
      actions.append(removeButton);
      item.append(status);
    }
    // The page already says what this list is, so the per-card 匹配条件 / 当前事实
    // headings are dropped. Both stay fully readable as compact wrapping lines.
    if (match.reasons.length > 0) {
      item.append(
        createElement(
          "p",
          match.reasons.join(" · "),
          "wfr-hygiene-line wfr-hygiene-match"
        )
      );
    }
    item.append(
      createElement(
        "p",
        hygieneFactLine(record),
        "wfr-hygiene-line wfr-hygiene-facts wfr-muted"
      )
    );
    item.append(actions);
    if (record.optionalMetadataConflict) {
      item.append(
        createElement(
          "p",
          "部分附加信息在扫描时存在差异。",
          "wfr-muted"
        )
      );
    }
    // The owning view keeps a handle on each card so a single account's state can
    // be refreshed in place, instead of rebuilding the whole list and losing the
    // reader's scroll position.
    if (typeof removalState.registerCard === "function") {
      removalState.registerCard(record.uid, item, selectionInput);
    }
    return item;
  }

  function showFollowerHygiene() {
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
    const body = showPanel("粉丝体检", true);
    const snapshot = loaded.state.latestSnapshot;
    if (snapshot === null) {
      body.append(
        createElement("p", "还没有可用的粉丝快照。", "wfr-muted"),
        createElement(
          "p",
          "请先更新一次粉丝快照，再开始筛选。",
          "wfr-muted"
        )
      );
      const updateButton = createElement(
        "button",
        "更新粉丝快照",
        "wfr-button wfr-primary"
      );
      updateButton.type = "button";
      updateButton.addEventListener("click", () => void updateFollowersNow());
      body.append(updateButton);
      return;
    }
    const successfullyRemovedUids = new Set();
    const uncertainRemovalUids = new Set();
    const removalMessages = new Map();
    const selectedUids = new Set();
    let currentPage = 1;
    let currentPageMatches = [];
    let selectionMessage = "";
    let batchStopRequested = false;
    let batchStatus = null;
    let filterInputs = [];
    let currentPagination = null;
    // Live handles on the currently rendered page, so selection and per-account
    // result updates never rebuild the result list.
    const cardNodes = new Map();
    const cardMatches = new Map();
    const cardSelectionInputs = new Map();
    const removalState = {
      successfullyRemovedUids,
      uncertainRemovalUids,
      messages: removalMessages,
      confirmRemoval,
      selectedUids,
      changeSelection,
      registerCard,
    };

    function registerCard(uid, element, selectionInput) {
      cardNodes.set(uid, element);
      if (selectionInput) {
        cardSelectionInputs.set(uid, selectionInput);
      } else {
        cardSelectionInputs.delete(uid);
      }
    }

    // Replaces exactly one card node. The result list keeps its identity and its
    // height, so the scroll container has no reason to move.
    function refreshCard(uid) {
      const element = cardNodes.get(uid);
      const match = cardMatches.get(uid);
      if (!element || !match || !element.parentNode) return;
      const parent = element.parentNode;
      const replacement = buildFollowerHygieneCard(match, removalState);
      parent.replaceChild(replacement, element);
    }

    function refreshVisibleCards() {
      for (const uid of [...cardNodes.keys()]) refreshCard(uid);
    }

    function clearSelection() {
      selectedUids.clear();
      selectionMessage = "";
      for (const input of cardSelectionInputs.values()) input.checked = false;
    }

    function changeSelection(record, checked, input) {
      const canonicalUid = normalizeStableUid(record.uid);
      const eligible =
        canonicalUid !== null &&
        canonicalUid === record.uid &&
        !successfullyRemovedUids.has(record.uid) &&
        !uncertainRemovalUids.has(record.uid) &&
        !followerRemovalInFlight &&
        !followerUpdateRunning &&
        !updateRunning;
      if (!checked) {
        selectedUids.delete(record.uid);
        selectionMessage = "";
      } else if (!eligible) {
        input.checked = false;
      } else if (selectedUids.size >= FOLLOWER_BATCH_MAX_SELECTION) {
        input.checked = false;
        selectionMessage =
          "一次最多选择 " +
          String(FOLLOWER_BATCH_MAX_SELECTION) +
          " 个粉丝。";
      } else {
        selectedUids.add(record.uid);
        selectionMessage = "";
      }
      // Selection is ephemeral view state: nothing outside the toolbar depends on
      // it, so no card is rebuilt and the scroll position is untouched.
      renderSelectionToolbar();
    }

    async function confirmRemoval(record) {
      if (followerRemovalInFlight) {
        removalMessages.set(record.uid, "请等待当前移除操作完成。");
        refreshCard(record.uid);
        return;
      }
      if (followerUpdateRunning || updateRunning) {
        removalMessages.set(record.uid, "关系扫描进行中，暂时无法移除。");
        refreshCard(record.uid);
        return;
      }
      followerRemovalInFlight = true;
      let result;
      try {
        result = await removeSingleFollower(record.uid, owner.uid);
      } catch (error) {
        result = {
          ok: false,
          failureKind: "REMOVAL_NETWORK_OUTCOME_UNKNOWN",
          requestSent: true,
          errorName: error && error.name ? String(error.name) : "Error",
        };
      } finally {
        followerRemovalInFlight = false;
      }
      if (result.ok) {
        successfullyRemovedUids.add(record.uid);
        uncertainRemovalUids.delete(record.uid);
        removalMessages.delete(record.uid);
        selectedUids.delete(record.uid);
      } else {
        removalMessages.set(record.uid, followerRemovalResultMessage(result));
        if (followerRemovalOutcomeIsUncertain(result)) {
          uncertainRemovalUids.add(record.uid);
        }
        selectedUids.delete(record.uid);
      }
      refreshCard(record.uid);
      renderSelectionToolbar();
    }

    // One compact factual line instead of four stacked rows. The filtering
    // caveat keeps its own muted line: the API result is never claimed complete.
    const summaryLine = createElement("p", "", "wfr-row wfr-hygiene-summary");
    body.append(summaryLine);
    appendFollowerVisibilityNote(body, snapshot);

    // Collapsed by default, so the first cards start near the top. This is view
    // state only and is never persisted.
    let filtersExpanded = false;
    const filterBar = createElement("div", null, "wfr-hygiene-bar");
    const filterSummary = createElement("span", "", "wfr-hygiene-filter-summary");
    const filterToggle = createElement("button", "设置筛选", "wfr-button");
    filterToggle.type = "button";
    filterBar.append(filterSummary, filterToggle);
    body.append(filterBar);

    const controls = createElement("div", null, "wfr-hygiene-controls");
    const modeLabel = createElement("label", null, "wfr-hygiene-control");
    modeLabel.append(createElement("span", "匹配方式"));
    const mode = createElement("select", null, "wfr-select");
    for (const [value, text] of [
      ["ALL", "匹配全部条件"],
      ["ANY", "匹配任一条件"],
    ]) {
      const option = createElement("option", text);
      option.value = value;
      mode.append(option);
    }
    mode.value = "ALL";
    modeLabel.append(mode);
    controls.append(modeLabel);

    const ownerNotFollowing = buildHygieneCheckbox("未关注 TA");
    const unverified = buildHygieneCheckbox("未认证");
    controls.append(ownerNotFollowing.label, unverified.label);

    const statusesMax = buildHygieneValueInput(
      "公开微博数上限",
      "number",
      "未启用"
    );
    const followersMax = buildHygieneValueInput(
      "粉丝数上限",
      "number",
      "未启用"
    );
    const friendsMax = buildHygieneValueInput(
      "关注数上限",
      "number",
      "未启用"
    );
    const createdAfter = buildHygieneValueInput(
      "注册日期晚于",
      "date"
    );
    controls.append(
      statusesMax.label,
      followersMax.label,
      friendsMax.label,
      createdAfter.label
    );

    // Common source categories instead of a keyword the user would have to
    // guess. Selecting several means "any of these", never "all of these".
    const sourceGroup = createElement("div", null, "wfr-hygiene-group");
    sourceGroup.append(
      createElement("span", "关注来源", "wfr-hygiene-group-label")
    );
    const sourceOptions = createElement("div", null, "wfr-hygiene-grid");
    const sourceInputs = [];
    for (const category of FOLLOWER_SOURCE_CATEGORIES) {
      const option = buildHygieneCheckbox(category.label);
      sourceInputs.push({ key: category.key, input: option.input });
      sourceOptions.append(option.label);
    }
    sourceGroup.append(sourceOptions);
    controls.append(sourceGroup);
    controls.hidden = true;
    const collapseActions = createElement("div", null, "wfr-actions");
    const collapseButton = createElement("button", "收起筛选", "wfr-button");
    collapseButton.type = "button";
    collapseActions.append(collapseButton);
    controls.append(collapseActions);
    body.append(controls);

    const prompt = createElement(
      "p",
      "请先设置至少一个筛选条件。",
      "wfr-muted"
    );
    const paginationBar = createElement("div", null, "wfr-hygiene-bar");
    const paginationSummary = createElement("span", "", "wfr-muted");
    const paginationActions = createElement("div", null, "wfr-actions");
    const previousButton = createElement("button", "上一页", "wfr-button");
    const nextButton = createElement("button", "下一页", "wfr-button");
    previousButton.type = "button";
    nextButton.type = "button";
    paginationActions.append(previousButton, nextButton);
    paginationBar.append(paginationSummary, paginationActions);

    // The selection bar sticks to the bottom of the Toolkit scroll area so the
    // controls stay reachable while reading a 50-card page. It sits after the
    // list, so at the end of the page it simply rests in normal flow.
    const selectionMessageNode = createElement("p", "", "wfr-muted");
    const selectionToolbar = createElement("div", null, "wfr-selection-bar");
    const selectionControls = createElement("div", null, "wfr-selection-row");
    const selectionCountNode = createElement("span", "", "wfr-selection-count");
    const selectCurrentPageButton = createElement(
      "button",
      "选择当前页",
      "wfr-button"
    );
    const clearSelectionButton = createElement(
      "button",
      "清除选择",
      "wfr-button"
    );
    const batchRemoveButton = createElement(
      "button",
      "移除所选粉丝",
      "wfr-button wfr-danger"
    );
    selectCurrentPageButton.type = "button";
    clearSelectionButton.type = "button";
    batchRemoveButton.type = "button";
    selectionControls.append(
      selectCurrentPageButton,
      selectionCountNode,
      clearSelectionButton,
      batchRemoveButton
    );
    // Execution phase: progress and the stop control live in the same sticky bar,
    // so a fifty-account batch never leaves them scrolled out of reach. They are
    // the only stop control while a batch runs.
    const batchControls = createElement("div", null, "wfr-selection-row");
    const batchProgressNode = createElement("span", "", "wfr-selection-count");
    const stopBatchButton = createElement(
      "button",
      "停止后续操作",
      "wfr-button"
    );
    stopBatchButton.type = "button";
    batchControls.append(batchProgressNode, stopBatchButton);
    batchControls.hidden = true;
    selectionToolbar.append(
      selectionControls,
      batchControls,
      selectionMessageNode
    );
    selectionToolbar.hidden = true;

    const batchPanel = createElement("div", null, "wfr-batch-panel");
    const list = createElement("div", null, "wfr-event-list");
    body.append(
      prompt,
      paginationBar,
      batchPanel,
      list,
      selectionToolbar
    );

    function clearNode(node) {
      while (node.childNodes.length > 0) {
        node.removeChild(node.childNodes[0]);
      }
    }

    function readFilters() {
      return {
        mode: mode.value,
        ownerNotFollowing: ownerNotFollowing.input.checked,
        statusesMax: statusesMax.input.value,
        followersMax: followersMax.input.value,
        friendsMax: friendsMax.input.value,
        createdAfter: createdAfter.input.value,
        unverified: unverified.input.checked,
        sourceCategories: sourceInputs
          .filter((entry) => entry.input.checked)
          .map((entry) => entry.key),
      };
    }

    // Human-readable description of the active criteria, derived from the live
    // filter state; nothing internal leaks and nothing is persisted.
    function describeActiveFilters(filters) {
      const parts = [];
      if (filters.ownerNotFollowing) parts.push("未关注 TA");
      if (filters.statusesMax !== null) {
        parts.push("公开微博≤" + String(filters.statusesMax));
      }
      if (filters.followersMax !== null) {
        parts.push("粉丝≤" + String(filters.followersMax));
      }
      if (filters.friendsMax !== null) {
        parts.push("关注≤" + String(filters.friendsMax));
      }
      if (filters.createdAfter !== null) {
        parts.push("注册晚于 " + filters.createdAfter);
      }
      if (filters.unverified) parts.push("未认证");
      if (filters.sourceCategories.length > 0) {
        parts.push(
          "来源=" +
            filters.sourceCategories
              .map((key) => followerSourceCategoryLabel(key))
              .join("/")
        );
      }
      return parts.join(" · ");
    }

    function renderFilterBar(filters) {
      const summary = describeActiveFilters(filters);
      // ANY reads as one sentence rather than a chain of colons.
      filterSummary.textContent =
        summary === ""
          ? "筛选条件：未设置"
          : (filters.mode === "ANY" ? "匹配任一条件：" : "筛选条件：") + summary;
      filterToggle.textContent =
        filters.activeCount === 0 ? "设置筛选" : "修改筛选";
      filterToggle.hidden = filtersExpanded;
      controls.hidden = !filtersExpanded;
    }

    function renderPaginationState() {
      const batchActive = Boolean(batchStatus && batchStatus.active);
      if (currentPagination === null) {
        previousButton.disabled = true;
        nextButton.disabled = true;
        return;
      }
      previousButton.disabled = !currentPagination.hasPrevious || batchActive;
      nextButton.disabled = !currentPagination.hasNext || batchActive;
    }

    function eligibleVisibleUids() {
      return currentPageMatches
        .map((match) => match.record.uid)
        .filter((uid) => cardSelectionInputs.has(uid));
    }

    function renderSelectionToolbar() {
      const batchActive = Boolean(batchStatus && batchStatus.active);
      const busy =
        followerRemovalInFlight || followerUpdateRunning || updateRunning;
      selectionToolbar.hidden =
        currentPageMatches.length === 0 && !batchActive;
      selectionControls.hidden = batchActive;
      batchControls.hidden = !batchActive;
      selectionCountNode.textContent =
        "已选择：" +
        String(selectedUids.size) +
        " / " +
        String(FOLLOWER_BATCH_MAX_SELECTION);
      selectCurrentPageButton.disabled =
        busy ||
        selectedUids.size >= FOLLOWER_BATCH_MAX_SELECTION ||
        !eligibleVisibleUids().some((uid) => !selectedUids.has(uid));
      clearSelectionButton.disabled = selectedUids.size === 0;
      batchRemoveButton.disabled = selectedUids.size === 0 || busy;
      if (batchActive) {
        batchProgressNode.textContent =
          batchStatus.current > 0
            ? "正在移除：" +
              String(batchStatus.current) +
              " / " +
              String(batchStatus.total)
            : "正在准备批量移除…";
        stopBatchButton.textContent = batchStatus.stopRequested
          ? "正在停止…"
          : "停止后续操作";
        stopBatchButton.disabled = batchStatus.stopRequested;
        selectionMessageNode.textContent = batchStatus.currentName
          ? "当前账号：" + batchStatus.currentName
          : "";
        return;
      }
      selectionMessageNode.textContent = selectionMessage;
    }

    // Deliberate, local, current-page only. Ineligible cards carry no checkbox
    // and are simply skipped; fewer than a full page is not an error.
    function selectCurrentPage() {
      if (followerRemovalInFlight) {
        selectionMessage = "请等待当前移除操作完成。";
        renderSelectionToolbar();
        return;
      }
      if (followerUpdateRunning || updateRunning) {
        selectionMessage = "关系扫描进行中，暂时无法选择。";
        renderSelectionToolbar();
        return;
      }
      let refused = 0;
      for (const uid of eligibleVisibleUids()) {
        if (selectedUids.has(uid)) continue;
        if (selectedUids.size >= FOLLOWER_BATCH_MAX_SELECTION) {
          refused += 1;
          continue;
        }
        selectedUids.add(uid);
        const input = cardSelectionInputs.get(uid);
        if (input) input.checked = true;
      }
      selectionMessage =
        refused > 0
          ? "一次最多选择 " +
            String(FOLLOWER_BATCH_MAX_SELECTION) +
            " 个粉丝。"
          : "";
      renderSelectionToolbar();
    }

    function appendManualSnapshotRefresh(container) {
      const refreshButton = createElement(
        "button",
        "更新粉丝快照",
        "wfr-button"
      );
      refreshButton.type = "button";
      refreshButton.addEventListener("click", () => void updateFollowersNow());
      container.append(refreshButton);
    }

    function renderBatchPanel() {
      clearNode(batchPanel);
      if (batchStatus === null) return;
      // While a batch runs, progress and the stop control are shown by the sticky
      // bar only, so the one stop control is always reachable.
      if (batchStatus.active) return;

      const summary = batchStatus.summary;
      if (summary.outcome === "COMPLETE") {
        batchPanel.append(
          createElement(
            "p",
            "已完成：" +
              String(summary.success) +
              " / " +
              String(summary.total),
            "wfr-success"
          ),
          createElement(
            "p",
            "移除已成功。当前粉丝快照仍是操作前的数据。",
            "wfr-muted"
          )
        );
      } else if (summary.outcome === "STOPPED") {
        batchPanel.append(
          createElement("p", "已停止后续操作。", "wfr-muted")
        );
      } else {
        batchPanel.append(
          createElement("p", "批量移除已停止。", "wfr-error")
        );
      }
      addLine(batchPanel, "成功", summary.success);
      if (summary.failure > 0) {
        addLine(batchPanel, "失败", summary.failure);
      }
      if (summary.uncertain > 0) {
        addLine(batchPanel, "结果无法确认", summary.uncertain);
      }
      addLine(batchPanel, "未执行", summary.notExecuted);
      if (summary.success > 0) appendManualSnapshotRefresh(batchPanel);
    }

    function selectedVisibleRecords() {
      return currentPageMatches
        .filter((match) => selectedUids.has(match.record.uid))
        .map((match) => match.record);
    }

    function showBatchConfirmation() {
      if (followerRemovalInFlight) {
        selectionMessage = "请等待当前移除操作完成。";
        renderSelectionToolbar();
        return;
      }
      if (updateRunning || followerUpdateRunning) {
        selectionMessage = "关系扫描进行中，暂时无法移除。";
        renderSelectionToolbar();
        return;
      }
      const records = selectedVisibleRecords();
      if (
        records.length === 0 ||
        records.length > FOLLOWER_BATCH_MAX_SELECTION
      ) {
        return;
      }
      batchStatus = null;
      clearNode(batchPanel);
      const confirmation = createElement(
        "div",
        null,
        "wfr-removal-confirm"
      );
      confirmation.append(
        createElement(
          "h3",
          "确认移除这 " + String(records.length) + " 个粉丝？"
        ),
        createElement("p", "这会修改真实的微博关系。", "wfr-muted"),
        createElement(
          "p",
          "移除后，这些账号将不再是你的粉丝。",
          "wfr-muted"
        ),
        createElement(
          "p",
          "Weibo Toolkit无法自动恢复这些操作。",
          "wfr-muted"
        ),
        createElement(
          "p",
          "操作将逐个进行，每次成功后约等待 3 秒。",
          "wfr-muted"
        ),
        createElement(
          "p",
          "已选择账号（" + String(records.length) + "）",
          "wfr-row"
        )
      );
      // Every selected account stays inspectable, but the list scrolls inside the
      // confirmation so the cancel/confirm controls stay on screen at fifty names.
      const names = createElement("ul", null, "wfr-confirm-list");
      for (const record of records) {
        names.append(createElement("li", record.screenName || record.uid));
      }
      confirmation.append(names);
      const actions = createElement("div", null, "wfr-actions");
      const cancel = createElement("button", "取消", "wfr-button");
      const confirm = createElement(
        "button",
        "确认移除 " + String(records.length) + " 个",
        "wfr-button wfr-danger"
      );
      cancel.type = "button";
      confirm.type = "button";
      cancel.addEventListener("click", () => {
        clearNode(batchPanel);
        renderSelectionToolbar();
      });
      confirm.addEventListener("click", async () => {
        cancel.disabled = true;
        confirm.disabled = true;
        await beginBatchRemoval(records);
      });
      actions.append(cancel, confirm);
      confirmation.append(actions);
      batchPanel.append(confirmation);
      // Deliberate navigation for an explicit action, never a side effect of
      // selecting a card: the confirmation and the later progress/stop control
      // both live here.
      if (typeof batchPanel.scrollIntoView === "function") {
        batchPanel.scrollIntoView({ block: "nearest" });
      }
    }

    async function beginBatchRemoval(records) {
      batchStopRequested = false;
      batchStatus = {
        active: true,
        current: 0,
        total: records.length,
        currentName: "",
        stopRequested: false,
        summary: null,
      };
      for (const input of filterInputs) input.disabled = true;
      renderSelectionToolbar();
      renderPaginationState();
      renderBatchPanel();
      refreshVisibleCards();
      const batchPromise = startFollowerRemovalBatch(records, owner.uid, {
        isStopRequested: () => batchStopRequested,
        onProgress(progress) {
          batchStatus.current = progress.current;
          batchStatus.currentName =
            progress.record.screenName || progress.record.uid;
          renderSelectionToolbar();
        },
        onResult(entry) {
          const record = entry.record;
          const result = entry.result;
          selectedUids.delete(record.uid);
          if (result.ok) {
            successfullyRemovedUids.add(record.uid);
            uncertainRemovalUids.delete(record.uid);
            removalMessages.delete(record.uid);
          } else {
            removalMessages.set(
              record.uid,
              followerRemovalResultMessage(result)
            );
            if (followerRemovalOutcomeIsUncertain(result)) {
              uncertainRemovalUids.add(record.uid);
            }
          }
          refreshCard(record.uid);
          renderSelectionToolbar();
        },
      });
      const summary = await batchPromise;
      batchStatus = {
        active: false,
        current: summary.success + summary.failure + summary.uncertain,
        total: summary.total,
        currentName: "",
        stopRequested: summary.stoppedByUser,
        summary,
      };
      for (const input of filterInputs) input.disabled = false;
      renderSelectionToolbar();
      renderPaginationState();
      renderBatchPanel();
      refreshVisibleCards();
    }

    function renderResults(resetPage) {
      if (resetPage) {
        currentPage = 1;
        clearSelection();
        batchStatus = null;
        clearNode(batchPanel);
      }
      clearNode(list);
      cardNodes.clear();
      cardMatches.clear();
      cardSelectionInputs.clear();
      const result = filterFollowerSnapshot(snapshot, readFilters());
      summaryLine.textContent =
        "快照：" +
        formatMinute(snapshot.capturedAt) +
        " · API可见粉丝：" +
        String(snapshot.uniqueRecordCount) +
        (result.filters.activeCount === 0
          ? ""
          : " · 匹配：" + String(result.matches.length));
      renderFilterBar(result.filters);
      prompt.hidden = result.filters.activeCount !== 0;
      if (result.filters.activeCount === 0) {
        paginationSummary.textContent = "";
        paginationActions.hidden = true;
        paginationBar.hidden = true;
        currentPageMatches = [];
        currentPagination = null;
        renderPaginationState();
        renderSelectionToolbar();
        return;
      }
      if (result.matches.length === 0) {
        paginationSummary.textContent =
          "当前快照中没有符合筛选条件的API可见粉丝。";
        paginationActions.hidden = true;
        paginationBar.hidden = false;
        currentPageMatches = [];
        currentPagination = null;
        renderPaginationState();
        renderSelectionToolbar();
        return;
      }
      const pagination = paginateFollowerHygieneMatches(
        result.matches,
        currentPage
      );
      currentPage = pagination.page;
      currentPageMatches = pagination.records;
      currentPagination = pagination;
      paginationSummary.textContent =
        String(pagination.totalResults) +
        " 个结果 · 第 " +
        String(pagination.page) +
        " / " +
        String(pagination.totalPages) +
        " 页";
      paginationActions.hidden = false;
      paginationBar.hidden = false;
      renderPaginationState();
      for (const match of pagination.records) {
        cardMatches.set(match.record.uid, match);
        list.append(buildFollowerHygieneCard(match, removalState));
      }
      renderSelectionToolbar();
      renderBatchPanel();
    }

    previousButton.addEventListener("click", () => {
      if (batchStatus && batchStatus.active) return;
      if (currentPage <= 1) return;
      currentPage -= 1;
      clearSelection();
      batchStatus = null;
      renderResults(false);
    });
    nextButton.addEventListener("click", () => {
      if (batchStatus && batchStatus.active) return;
      currentPage += 1;
      clearSelection();
      batchStatus = null;
      renderResults(false);
    });
    selectCurrentPageButton.addEventListener("click", selectCurrentPage);
    clearSelectionButton.addEventListener("click", () => {
      clearSelection();
      renderSelectionToolbar();
    });
    stopBatchButton.addEventListener("click", () => {
      if (batchStatus === null || !batchStatus.active) return;
      batchStopRequested = true;
      batchStatus.stopRequested = true;
      renderSelectionToolbar();
    });
    batchRemoveButton.addEventListener("click", showBatchConfirmation);

    // Expanding or collapsing is pure view state: it never refilters, never
    // fetches and never writes.
    filterToggle.addEventListener("click", () => {
      filtersExpanded = true;
      renderFilterBar(normalizeHygieneFilters(readFilters()));
    });
    collapseButton.addEventListener("click", () => {
      filtersExpanded = false;
      renderFilterBar(normalizeHygieneFilters(readFilters()));
    });

    filterInputs = [
      mode,
      ownerNotFollowing.input,
      unverified.input,
      statusesMax.input,
      followersMax.input,
      friendsMax.input,
      createdAfter.input,
      ...sourceInputs.map((entry) => entry.input),
    ];
    for (const input of filterInputs) {
      input.addEventListener("change", () => renderResults(true));
      if (input.tagName === "INPUT" && input.type !== "checkbox") {
        input.addEventListener("input", () => renderResults(true));
      }
    }
    renderResults(true);
  }
