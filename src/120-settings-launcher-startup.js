
  function showPageSettings() {
    const body = showPanel("浏览体验", true);
    const status = createElement("p", "", "wfr-muted wfr-browse-status");
    const tabList = createElement("div", null, "wfr-browse-tabs");
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "浏览体验分类");
    const tabs = [];

    function selectBrowseTab(tab) {
      for (const candidate of tabs) {
        const isSelected = candidate === tab;
        candidate.button.setAttribute(
          "aria-selected",
          isSelected ? "true" : "false"
        );
        candidate.button.setAttribute("tabindex", isSelected ? "0" : "-1");
        candidate.panel.hidden = !isSelected;
      }
    }

    function createBrowseTab(id, labelText, selected) {
      const button = createElement("button", labelText, "wfr-browse-tab");
      button.type = "button";
      button.id = `wfr-browse-tab-${id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `wfr-browse-panel-${id}`);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      const panel = createElement("section", null, "wfr-browse-panel");
      panel.id = `wfr-browse-panel-${id}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", button.id);
      panel.hidden = !selected;
      button.setAttribute("tabindex", selected ? "0" : "-1");
      const tab = { button, panel };
      tabs.push(tab);
      button.addEventListener("click", () => selectBrowseTab(tab));
      // The tab roles promise arrow-key movement; only the selected tab is in
      // the Tab order.
      button.addEventListener("keydown", (event) => {
        const index = tabs.indexOf(tab);
        let target = null;
        if (event.key === "ArrowRight") target = tabs[(index + 1) % tabs.length];
        else if (event.key === "ArrowLeft") {
          target = tabs[(index + tabs.length - 1) % tabs.length];
        } else if (event.key === "Home") target = tabs[0];
        else if (event.key === "End") target = tabs[tabs.length - 1];
        if (target === null) return;
        event.preventDefault();
        selectBrowseTab(target);
        target.button.focus();
      });
      tabList.append(button);
      return panel;
    }

    const feedPanel = createBrowseTab("feed", "信息流", true);
    const enhancementPanel = createBrowseTab("enhancement", "增强", false);
    const cleanupPanel = createBrowseTab("cleanup", "净化", false);
    body.append(tabList, feedPanel, enhancementPanel, cleanupPanel);

    function appendToggle(container, labelText, key, property, description) {
      const label = createElement(
        "label",
        null,
        "wfr-toggle wfr-row wfr-setting-label"
      );
      const input = createElement("input");
      input.type = "checkbox";
      input.checked = pageCleanupPreferences[property];
      input.setAttribute("aria-label", labelText);
      label.append(input, createElement("span", labelText));
      input.addEventListener("change", () => {
        const previous = pageCleanupPreferences[property];
        const next = input.checked === true;
        const saved = savePageCleanupPreference(key, next);
        if (!saved.ok) {
          input.checked = previous;
          status.textContent = "页面净化偏好未能保存，微博页面未改变。";
          return;
        }
        pageCleanupPreferences[property] = next;
        try {
          applyPageCleanupStyles();
        } catch (_) {
          pageCleanupPreferences[property] = previous;
          savePageCleanupPreference(key, previous);
          input.checked = previous;
          try {
            applyPageCleanupStyles();
          } catch (_) {
            // Preferences remain fail-closed if presentation recovery also fails.
          }
          status.textContent = "页面净化偏好未能应用，微博页面未改变。";
          return;
        }
        status.textContent = next ? "已隐藏所选页面组件。" : "已恢复所选页面组件。";
      });
      container.append(label);
      if (description) {
        container.append(
          createElement(
            "p",
            description,
            "wfr-muted wfr-setting-description"
          )
        );
      }
    }

    const latestLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const latestInput = createElement("input");
    latestInput.type = "checkbox";
    latestInput.checked = preferLatestFeed;
    latestInput.setAttribute("aria-label", "首页优先进入最新微博");
    latestLabel.append(latestInput, createElement("span", "首页优先进入最新微博"));
    latestInput.addEventListener("change", () => {
      const previous = preferLatestFeed;
      const next = latestInput.checked === true;
      const saved = savePageCleanupPreference(PREFER_LATEST_FEED_KEY, next);
      if (!saved.ok) {
        latestInput.checked = previous;
        status.textContent = "浏览体验偏好未能保存。";
        return;
      }
      preferLatestFeed = next;
      if (!next) latestFeedNavigationPending = false;
      status.textContent = next
        ? "每个标签页首次进入微博首页时将打开最新微博。"
        : "已停止自动进入最新微博。";
    });
    feedPanel.append(
      latestLabel,
      createElement(
        "p",
        "每个标签页首次打开微博首页时自动进入按时间排序的“最新微博”。",
        "wfr-muted wfr-setting-description"
      )
    );

    const latestRecommendedLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const latestRecommendedInput = createElement("input");
    latestRecommendedInput.type = "checkbox";
    latestRecommendedInput.checked =
      pageCleanupPreferences.hideLatestRecommended;
    latestRecommendedInput.setAttribute(
      "aria-label",
      "隐藏信息流中的推广内容"
    );
    latestRecommendedLabel.append(
      latestRecommendedInput,
      createElement("span", "隐藏信息流中的推广内容")
    );
    latestRecommendedInput.addEventListener("change", () => {
      const previous = pageCleanupPreferences.hideLatestRecommended;
      const next = latestRecommendedInput.checked === true;
      const saved = savePageCleanupPreference(
        HIDE_LATEST_RECOMMENDED_KEY,
        next
      );
      if (!saved.ok) {
        latestRecommendedInput.checked = previous;
        status.textContent = "浏览体验偏好未能保存。";
        return;
      }
      pageCleanupPreferences.hideLatestRecommended = next;
      try {
        applyPageCleanupStyles();
        installLatestFeedRecommendationFilter();
      } catch (_) {
        pageCleanupPreferences.hideLatestRecommended = previous;
        savePageCleanupPreference(HIDE_LATEST_RECOMMENDED_KEY, previous);
        latestRecommendedInput.checked = previous;
        try {
          applyPageCleanupStyles();
          installLatestFeedRecommendationFilter();
        } catch (_) {
          // The previous fail-closed state remains the recovery boundary.
        }
        status.textContent = "“荐读”隐藏设置未能应用，微博内容未改变。";
        return;
      }
      status.textContent = next
        ? "已隐藏首页和“最新微博”中明确标记为“荐读”的内容。"
        : "已停止隐藏信息流推广内容；强力规则偏好会保留但不生效。";
    });
    feedPanel.append(
      latestRecommendedLabel,
      createElement(
        "p",
        "默认仅隐藏明确标记为“荐读”的内容。",
        "wfr-muted wfr-setting-description"
      )
    );

    const strongPromotionLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label wfr-suboption"
    );
    const strongPromotionInput = createElement("input");
    strongPromotionInput.type = "checkbox";
    strongPromotionInput.checked =
      pageCleanupPreferences.strongFeedPromotionFilter;
    strongPromotionInput.setAttribute(
      "aria-label",
      "使用强力规则（可能误伤）"
    );
    strongPromotionLabel.append(
      strongPromotionInput,
      createElement("span", "使用强力规则（可能误伤）")
    );
    strongPromotionInput.addEventListener("change", () => {
      const previous = pageCleanupPreferences.strongFeedPromotionFilter;
      const next = strongPromotionInput.checked === true;
      const saved = savePageCleanupPreference(
        STRONG_FEED_PROMOTION_FILTER_KEY,
        next
      );
      if (!saved.ok) {
        strongPromotionInput.checked = previous;
        status.textContent = "强力过滤偏好未能保存。";
        return;
      }
      pageCleanupPreferences.strongFeedPromotionFilter = next;
      try {
        applyPageCleanupStyles();
        installLatestFeedRecommendationFilter();
      } catch (_) {
        pageCleanupPreferences.strongFeedPromotionFilter = previous;
        savePageCleanupPreference(STRONG_FEED_PROMOTION_FILTER_KEY, previous);
        strongPromotionInput.checked = previous;
        try {
          applyPageCleanupStyles();
          installLatestFeedRecommendationFilter();
        } catch (_) {
          // The previous fail-closed state remains the recovery boundary.
        }
        status.textContent = "强力过滤规则未能应用，微博内容未改变。";
        return;
      }
      status.textContent = next
        ? pageCleanupPreferences.hideLatestRecommended
          ? "已启用强力推广过滤。"
          : "已保存强力规则偏好；启用上方推广过滤后才会生效。"
        : "已停用强力规则，精确“荐读”规则保持不变。";
    });
    feedPanel.append(
      strongPromotionLabel,
      createElement(
        "p",
        "额外识别推荐、广告等推广标签和明确广告模块。",
        "wfr-muted wfr-setting-description wfr-suboption-description"
      )
    );

    const autoExpandLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const autoExpandInput = createElement("input");
    autoExpandInput.type = "checkbox";
    autoExpandInput.checked = pageCleanupPreferences.autoExpandLongPosts;
    autoExpandInput.setAttribute("aria-label", "自动展开原创长微博");
    autoExpandLabel.append(
      autoExpandInput,
      createElement("span", "自动展开原创长微博")
    );
    autoExpandInput.addEventListener("change", () => {
      const previous = pageCleanupPreferences.autoExpandLongPosts;
      const next = autoExpandInput.checked === true;
      const saved = savePageCleanupPreference(AUTO_EXPAND_LONG_POSTS_KEY, next);
      if (!saved.ok) {
        autoExpandInput.checked = previous;
        status.textContent = "自动展开偏好未能保存。";
        return;
      }
      pageCleanupPreferences.autoExpandLongPosts = next;
      try {
        installLatestFeedRecommendationFilter();
      } catch (_) {
        pageCleanupPreferences.autoExpandLongPosts = previous;
        savePageCleanupPreference(AUTO_EXPAND_LONG_POSTS_KEY, previous);
        autoExpandInput.checked = previous;
        try {
          installLatestFeedRecommendationFilter();
        } catch (_) {
          // The previous fail-closed state remains the recovery boundary.
        }
        status.textContent = "自动展开未能启动，微博正文未改变。";
        return;
      }
      status.textContent = next
        ? "已启用视口内长微博自动展开。"
        : "已停止后续自动展开；已经展开的正文不会被强制收起。";
    });
    feedPanel.append(
      autoExpandLabel,
      createElement(
        "p",
        "停下来阅读原创长微博时自动展开；转发微博保持折叠。",
        "wfr-muted wfr-setting-description"
      )
    );

    const profileExtrasLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const profileExtrasInput = createElement("input");
    profileExtrasInput.type = "checkbox";
    profileExtrasInput.checked = pageCleanupPreferences.showProfileExtras;
    profileExtrasInput.setAttribute("aria-label", "显示主页小档案");
    profileExtrasLabel.append(
      profileExtrasInput,
      createElement("span", "显示主页小档案")
    );
    profileExtrasInput.addEventListener("change", () => {
      const previous = pageCleanupPreferences.showProfileExtras;
      const next = profileExtrasInput.checked === true;
      const saved = savePageCleanupPreference(SHOW_PROFILE_EXTRAS_KEY, next);
      if (!saved.ok) {
        profileExtrasInput.checked = previous;
        status.textContent = "主页小档案设置未能保存。";
        return;
      }
      pageCleanupPreferences.showProfileExtras = next;
      if (next) {
        ensureProfileExtras();
      } else {
        teardownProfileExtras(false);
      }
      // The friend-notes panel shows observed facts only while Profile Extras is
      // off, so it is rebuilt to keep the two from repeating each other.
      rebuildProfileFriendNotes();
      status.textContent = next
        ? "已启用其他用户主页的 Toolkit 本地小档案与访问记录。"
        : "已停止显示主页小档案和记录主页访问。";
    });
    enhancementPanel.append(
      profileExtrasLabel,
      createElement(
        "p",
        "显示历史昵称等本地资料，并在本浏览器记录访问次数和上次访问时间。",
        "wfr-muted wfr-setting-description"
      )
    );

    const friendNotesLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const friendNotesInput = createElement("input");
    friendNotesInput.type = "checkbox";
    friendNotesInput.checked = pageCleanupPreferences.showProfileFriendNotes;
    friendNotesInput.setAttribute("aria-label", "在主页显示友人档案");
    friendNotesLabel.append(
      friendNotesInput,
      createElement("span", "在主页显示友人档案")
    );
    friendNotesInput.addEventListener("change", () => {
      const previous = pageCleanupPreferences.showProfileFriendNotes;
      const next = friendNotesInput.checked === true;
      const saved = savePageCleanupPreference(
        SHOW_PROFILE_FRIEND_NOTES_KEY,
        next
      );
      if (!saved.ok) {
        friendNotesInput.checked = previous;
        status.textContent = "友人档案显示设置未能保存。";
        return;
      }
      pageCleanupPreferences.showProfileFriendNotes = next;
      rebuildProfileFriendNotes();
      status.textContent = next
        ? "已在其他用户主页显示友人档案。"
        : "已停止在主页显示友人档案；已保存的备注和标签不受影响。";
    });
    enhancementPanel.append(
      friendNotesLabel,
      createElement(
        "p",
        "在其他用户的主页显示你手写的备注和标签，可直接编辑。",
        "wfr-muted wfr-setting-description"
      )
    );

    const feedFriendNotesLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const feedFriendNotesInput = createElement("input");
    feedFriendNotesInput.type = "checkbox";
    feedFriendNotesInput.checked = pageCleanupPreferences.showFeedFriendNotes;
    feedFriendNotesInput.setAttribute("aria-label", "在信息流显示友人档案");
    feedFriendNotesLabel.append(
      feedFriendNotesInput,
      createElement("span", "在信息流显示友人档案")
    );
    feedFriendNotesInput.addEventListener("change", () => {
      const previous = pageCleanupPreferences.showFeedFriendNotes;
      const next = feedFriendNotesInput.checked === true;
      const saved = savePageCleanupPreference(SHOW_FEED_FRIEND_NOTES_KEY, next);
      if (!saved.ok) {
        feedFriendNotesInput.checked = previous;
        status.textContent = "信息流友人档案设置未能保存。";
        return;
      }
      pageCleanupPreferences.showFeedFriendNotes = next;
      try {
        installLatestFeedRecommendationFilter();
      } catch (_) {
        pageCleanupPreferences.showFeedFriendNotes = previous;
        savePageCleanupPreference(SHOW_FEED_FRIEND_NOTES_KEY, previous);
        feedFriendNotesInput.checked = previous;
        try {
          installLatestFeedRecommendationFilter();
        } catch (_) {
          // The previous fail-closed state remains the recovery boundary.
        }
        status.textContent = "信息流友人档案未能启动，微博页面未改变。";
        return;
      }
      status.textContent = next
        ? "已在首页和“最新微博”的作者旁显示友人档案入口。"
        : "已停止在信息流显示友人档案；已保存的备注和标签不受影响。";
    });
    enhancementPanel.append(
      feedFriendNotesLabel,
      createElement(
        "p",
        "在作者旁显示小书签，已有档案时高亮，点击可查看和编辑。",
        "wfr-muted wfr-setting-description"
      )
    );

    const usageEnabledLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label"
    );
    const usageEnabledInput = createElement("input");
    usageEnabledInput.type = "checkbox";
    usageEnabledInput.checked = usageEnabledPreference;
    usageEnabledInput.setAttribute("aria-label", "记录网页版使用统计");
    usageEnabledLabel.append(
      usageEnabledInput,
      createElement("span", "记录网页版使用统计")
    );
    usageEnabledInput.addEventListener("change", () => {
      const previous = usageEnabledPreference;
      const next = usageEnabledInput.checked === true;
      const saved = savePageCleanupPreference(USAGE_ENABLED_KEY, next);
      if (!saved.ok) {
        usageEnabledInput.checked = previous;
        status.textContent = "使用统计设置未能保存。";
        return;
      }
      usageEnabledPreference = next;
      if (next) {
        const started = startUsageTracking(true);
        if (!started.ok) {
          usageEnabledPreference = previous;
          savePageCleanupPreference(USAGE_ENABLED_KEY, previous);
          usageEnabledInput.checked = previous;
          stopUsageTracking(false);
          status.textContent =
            "当前无法安全启动使用统计；设置未改变，也没有开始记录。";
          return;
        }
        status.textContent = "已开始在本浏览器记录网页版使用统计。";
      } else {
        stopUsageTracking(true);
        status.textContent = "已停止记录；已有统计会保留到手动清空。";
      }
      syncUsageCorner();
    });
    enhancementPanel.append(
      usageEnabledLabel,
      createElement(
        "p",
        "仅在当前浏览器记录估算活跃时间和浏览数量。",
        "wfr-muted wfr-setting-description"
      )
    );

    const usageCornerLabel = createElement(
      "label",
      null,
      "wfr-toggle wfr-row wfr-setting-label wfr-suboption"
    );
    const usageCornerInput = createElement("input");
    usageCornerInput.type = "checkbox";
    usageCornerInput.checked = usageCornerPreference;
    usageCornerInput.setAttribute("aria-label", "在页面角落显示今日统计");
    usageCornerLabel.append(
      usageCornerInput,
      createElement("span", "在页面角落显示今日统计")
    );
    usageCornerInput.addEventListener("change", () => {
      const previous = usageCornerPreference;
      const next = usageCornerInput.checked === true;
      const saved = savePageCleanupPreference(USAGE_CORNER_KEY, next);
      if (!saved.ok) {
        usageCornerInput.checked = previous;
        status.textContent = "角落统计设置未能保存。";
        return;
      }
      usageCornerPreference = next;
      syncUsageCorner();
      status.textContent = next
        ? usageEnabledPreference
          ? "已显示今日统计。"
          : "角落统计已准备；开启使用统计后显示。"
        : "已隐藏角落统计。";
    });
    const usageActions = createElement(
      "div",
      null,
      "wfr-actions wfr-compact-actions"
    );
    const usagePanelButton = createElement(
      "button",
      "查看微博计步器",
      "wfr-button"
    );
    usagePanelButton.type = "button";
    usagePanelButton.addEventListener("click", () => showUsageStatistics());
    usageActions.append(usagePanelButton);
    enhancementPanel.append(
      usageCornerLabel,
      createElement(
        "p",
        "开启记录后，可在页面角落显示今日分钟数和浏览数量。",
        "wfr-muted wfr-setting-description wfr-suboption-description"
      ),
      usageActions
    );

    cleanupPanel.append(createElement("h3", "侧栏"));
    appendToggle(
      cleanupPanel,
      "隐藏微博热搜",
      HIDE_HOT_SEARCH_KEY,
      "hideHotSearch",
      "隐藏右侧热搜模块，可随时恢复。"
    );
    appendToggle(
      cleanupPanel,
      "隐藏整个右侧栏",
      HIDE_RIGHT_SIDEBAR_KEY,
      "hideRightSidebar",
      "隐藏热搜、推荐、创作者中心等整个右侧区域。"
    );

    cleanupPanel.append(createElement("h3", "顶部导航"));
    appendToggle(
      cleanupPanel,
      "隐藏顶部推荐入口",
      HIDE_TOP_RECOMMEND_KEY,
      "hideTopRecommend"
    );
    appendToggle(
      cleanupPanel,
      "隐藏顶部视频入口",
      HIDE_TOP_VIDEO_KEY,
      "hideTopVideo"
    );
    body.append(status);
  }

  function showToolkitHome() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("Weibo Toolkit", uidResult, false);
      return;
    }
    // A module whose local data cannot be read fails on its own card. Home
    // itself stays usable: it is where "恢复备份" lives.
    const loaded = loadState(uidResult.uid);

    const body = showPanel("Weibo Toolkit", false, true);
    body.classList.add("wfr-home");
    const grid = createElement("div", null, "wfr-home-grid");
    body.append(grid);
    const radarSection = createElement("section", null, "wfr-home-module");
    grid.append(radarSection);
    const moduleTitle = createElement("h3", null, "wfr-home-module-title");
    moduleTitle.append(createElement("strong", "关系雷达"));
    radarSection.append(moduleTitle);
    if (!loaded.ok) {
      radarSection.append(
        createElement(
          "p",
          "关系雷达本地数据无法读取。可用下方的“恢复备份”以备份内容替换。",
          "wfr-error"
        )
      );
    } else {
      const snapshot = loaded.state.latestSnapshot;
      const unread = countUnreadEvents(loaded.state.events);
      showUnreadBadge(unread);
      addLine(
        radarSection,
        "上次成功更新",
        snapshot ? formatTime(snapshot.capturedAt) : "尚未建立快照"
      );
      addLine(radarSection, "API可见关注", snapshot ? snapshot.visibleCount : "—");
      addLine(radarSection, "未读事件", unread);
      if (!snapshot) {
        radarSection.append(
          createElement("p", "首次更新建立基线，下次开始记录变化。", "wfr-muted wfr-home-hint")
        );
      }
    }

    const actions = createElement("div", null, "wfr-actions");
    const updateButton = createElement("button", "立即更新", "wfr-button wfr-primary");
    const eventsButton = createElement("button", "查看事件", "wfr-button");
    const overviewButton = createElement("button", "关系概览", "wfr-button");
    const statusButton = createElement("button", "查看状态", "wfr-button");
    const exportButton = createElement("button", "导出备份", "wfr-button");
    const restoreButton = createElement("button", "恢复备份", "wfr-button");
    const autoSettingsButton = createElement(
      "button",
      "自动更新与外观",
      "wfr-button"
    );
    for (const button of [
      updateButton,
      eventsButton,
      overviewButton,
      statusButton,
      exportButton,
      restoreButton,
      autoSettingsButton,
    ]) {
      button.type = "button";
    }
    updateButton.addEventListener("click", () => void updateNow());
    eventsButton.addEventListener("click", viewEvents);
    overviewButton.addEventListener("click", showRelationshipOverview);
    statusButton.addEventListener("click", viewStatus);
    exportButton.addEventListener("click", exportBackup);
    restoreButton.addEventListener("click", () => void restoreBackup());
    autoSettingsButton.addEventListener("click", () => showAutoUpdateSettings());
    actions.append(
      updateButton,
      eventsButton,
      overviewButton,
      statusButton
    );
    radarSection.append(actions);

    const followerSection = createElement("section", null, "wfr-home-module");
    grid.append(followerSection);
    const followerModuleTitle = createElement("h3", null, "wfr-home-module-title");
    followerModuleTitle.append(createElement("strong", "粉丝变化"));
    followerSection.append(followerModuleTitle);
    const followerLoaded = loadFollowerState(uidResult.uid);
    if (!followerLoaded.ok) {
      followerSection.append(
        createElement(
          "p",
          "粉丝快照本地状态无法读取。",
          "wfr-error"
        )
      );
    } else {
      const followerSnapshot = followerLoaded.state.latestSnapshot;
      addLine(
        followerSection,
        "上次成功更新",
        followerSnapshot ? formatTime(followerSnapshot.capturedAt) : "尚未建立快照"
      );
      addLine(
        followerSection,
        "API可见粉丝",
        followerSnapshot ? followerSnapshot.uniqueRecordCount : "—"
      );
      addLine(followerSection, "变化事件", followerLoaded.state.events.length);
      appendFollowerVisibilityNote(followerSection, followerSnapshot);
    }
    const followerActions = createElement("div", null, "wfr-actions");
    const followerUpdateButton = createElement(
      "button",
      "更新粉丝快照",
      "wfr-button wfr-primary"
    );
    const followerEventsButton = createElement(
      "button",
      "查看粉丝变化",
      "wfr-button"
    );
    const followerHygieneButton = createElement(
      "button",
      "粉丝体检",
      "wfr-button"
    );
    followerUpdateButton.type = "button";
    followerEventsButton.type = "button";
    followerHygieneButton.type = "button";
    followerUpdateButton.addEventListener(
      "click",
      () => void updateFollowersNow()
    );
    followerEventsButton.addEventListener("click", viewFollowerEvents);
    followerHygieneButton.addEventListener("click", showFollowerHygiene);
    followerActions.append(
      followerUpdateButton,
      followerEventsButton,
      followerHygieneButton
    );
    followerSection.append(followerActions);

    // Always reachable from Home, whatever the profile-page option is set to.
    const friendNotesSection = createElement("section", null, "wfr-home-module wfr-home-shortcut");
    const friendNotesTitle = createElement("h3", null, "wfr-home-module-title");
    friendNotesTitle.append(createElement("strong", "友人档案"));
    friendNotesSection.append(friendNotesTitle);
    friendNotesSection.append(
      createElement("p", "用私人备注与标签，记住昵称背后的人。", "wfr-muted wfr-home-description")
    );
    const friendNotesLoaded = loadFriendNotesState(uidResult.uid);
    if (!friendNotesLoaded.ok) {
      friendNotesSection.append(
        createElement("p", "友人档案本地数据无法读取。", "wfr-error")
      );
    } else {
      addLine(
        friendNotesSection,
        "已保存档案",
        Object.keys(friendNotesLoaded.state.notes).length
      );
    }
    const friendNotesActions = createElement("div", null, "wfr-actions");
    const friendNotesButton = createElement("button", "友人档案", "wfr-button");
    friendNotesButton.type = "button";
    friendNotesButton.addEventListener("click", () => showFriendNotesManager());
    friendNotesActions.append(friendNotesButton);
    friendNotesSection.append(friendNotesActions);
    grid.append(friendNotesSection);

    const browseSection = createElement("section", null, "wfr-home-module wfr-home-shortcut");
    const browseTitle = createElement("h3", null, "wfr-home-module-title");
    browseTitle.append(createElement("strong", "浏览体验"));
    const browseActions = createElement("div", null, "wfr-actions");
    const browseButton = createElement("button", "浏览体验", "wfr-button");
    browseButton.type = "button";
    browseButton.addEventListener("click", showPageSettings);
    browseActions.append(browseButton);
    browseSection.append(
      browseTitle,
      createElement("p", "信息流、主页增强与页面净化，按你的习惯开启。", "wfr-muted wfr-home-description"),
      browseActions
    );
    grid.append(browseSection);

    const tools = createElement("section", null, "wfr-home-tools");
    tools.append(createElement("h3", "备份与设置", "wfr-home-module-title"));
    const toolActions = createElement("div", null, "wfr-actions");
    toolActions.append(exportButton, restoreButton, autoSettingsButton);
    tools.append(toolActions);
    body.append(tools);

    if (bundledReleaseVersionsThrough(APP_VERSION).length > 0) {
      const changelogFooter = createElement(
        "p",
        null,
        "wfr-changelog-footer wfr-muted"
      );
      const changelogButton = createElement(
        "button",
        `v${APP_VERSION} · 更新记录`,
        "wfr-button wfr-changelog-link"
      );
      changelogButton.type = "button";
      changelogButton.addEventListener("click", () => {
        showUpdateHistory(APP_VERSION);
      });
      changelogFooter.append(changelogButton);
      body.append(changelogFooter);
    }
  }

  // Toolkit-only appearance preference: it changes nothing but Toolkit styling.
  function buildAppearanceControl() {
    const row = createElement("label", "外观：", "wfr-row");
    const select = createElement("select", null, "wfr-select");
    select.setAttribute("aria-label", "外观");
    for (const [value, text] of THEME_CHOICES) {
      const option = createElement("option", text);
      option.value = value;
      option.selected = value === currentTheme;
      select.append(option);
    }
    select.value = currentTheme;
    select.addEventListener("change", () => {
      const chosen = normalizeTheme(select.value);
      const saved = saveTheme(chosen);
      if (!saved.ok) {
        showFailure("外观设置", saved);
        return;
      }
      currentTheme = chosen;
      applyTheme();
    });
    row.append(select);
    return row;
  }

  function installToolkitLauncher() {
    if (!document.body) return;
    const button = createElement(
      "button",
      null,
      "wfr-button wfr-toolkit-launcher wfr-root"
    );
    button.type = "button";
    button.setAttribute("aria-label", LAUNCHER_LABEL);
    applyThemeToRoot(button);
    launcherLabel = createElement("span", LAUNCHER_LABEL, "wfr-launcher-label");
    launcherBadge = createElement("span", "", "wfr-launcher-badge");
    launcherBadge.hidden = true;
    button.append(launcherLabel, launcherBadge);
    button.addEventListener("click", showToolkitHome);
    document.body.append(button);
    launcherButton = button;
    refreshUnreadBadge();
  }

  // Every Toolkit colour is a custom property carried by the Toolkit roots, so a
  // theme is selected purely by which token block wins on `.wfr-root`.
  const LIGHT_THEME_TOKENS =
    "color-scheme: light; --wfr-overlay-bg: rgba(25,27,30,.42); --wfr-panel-bg: #faf9f6; --wfr-panel-text: #292b2e; --wfr-panel-shadow: 0 24px 80px rgba(24,27,30,.2), 0 2px 8px rgba(24,27,30,.08); --wfr-border: #deddd7; --wfr-control-border: #cfcec7; --wfr-button-bg: #fffefd; --wfr-button-text: #30343a; --wfr-button-hover: #eeede8; --wfr-primary-bg: #30343a; --wfr-primary-text: #fffefd; --wfr-primary-hover: #454a52; --wfr-accent: #53776c; --wfr-danger-bg: #a53f37; --wfr-danger-text: #fff; --wfr-danger-border: #96382f; --wfr-danger-hover-bg: #89332c; --wfr-success: #34634e; --wfr-error: #a13832; --wfr-muted: #676a65; --wfr-field-bg: #fffefd; --wfr-field-text: #292b2e; --wfr-card-bg: #f3f2ee; --wfr-launcher-bg: rgba(250,249,246,.96); --wfr-launcher-text: #30343a; --wfr-launcher-border: #cfcec7; --wfr-launcher-hover-bg: #fffefd; --wfr-launcher-hover-border: #9a9e97; --wfr-badge-bg: #a53f37; --wfr-badge-text: #fff; --wfr-bar-shadow: 0 -6px 16px rgba(24,27,30,.08);";

  const DARK_THEME_TOKENS =
    "color-scheme: dark; --wfr-overlay-bg: rgba(8,10,12,.66); --wfr-panel-bg: #1b1d20; --wfr-panel-text: #ece8df; --wfr-panel-shadow: 0 24px 80px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.3); --wfr-border: #363a40; --wfr-control-border: #454a52; --wfr-button-bg: #25282d; --wfr-button-text: #ece8df; --wfr-button-hover: #30343a; --wfr-primary-bg: #ece8df; --wfr-primary-text: #202226; --wfr-primary-hover: #fffdf8; --wfr-accent: #b8d1c3; --wfr-danger-bg: #923b35; --wfr-danger-text: #fff; --wfr-danger-border: #b85449; --wfr-danger-hover-bg: #aa453c; --wfr-success: #a3c7b3; --wfr-error: #f1a69d; --wfr-muted: #a3a7af; --wfr-field-bg: #17191c; --wfr-field-text: #ece8df; --wfr-card-bg: #22252a; --wfr-launcher-bg: rgba(27,29,32,.96); --wfr-launcher-text: #ece8df; --wfr-launcher-border: #454a52; --wfr-launcher-hover-bg: #30343a; --wfr-launcher-hover-border: #787e87; --wfr-badge-bg: #d97b70; --wfr-badge-text: #211715; --wfr-bar-shadow: 0 -6px 16px rgba(0,0,0,.35);";

  function installStyles() {
    const style = createElement("style");
    style.textContent = `
      .wfr-root { ${LIGHT_THEME_TOKENS} --wfr-mono: "SFMono-Regular", Consolas, "Liberation Mono", system-ui, monospace; --wfr-radius-s: 6px; --wfr-radius-m: 8px; --wfr-radius-l: 12px; }
      .wfr-root.wfr-theme-dark { ${DARK_THEME_TOKENS} }
      @media (prefers-color-scheme: dark) {
        .wfr-root.wfr-theme-system { ${DARK_THEME_TOKENS} }
      }
      .wfr-overlay { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; background: var(--wfr-overlay-bg); backdrop-filter: blur(3px); padding: 32px; overflow: auto; box-sizing: border-box; }
      .wfr-panel { display: flex; flex-direction: column; width: 100%; max-width: 840px; max-height: calc(100vh - 64px); min-width: 0; margin: 0 auto; overflow: hidden; border: 1px solid var(--wfr-border); background: var(--wfr-panel-bg); color: var(--wfr-panel-text); border-radius: var(--wfr-radius-l); box-shadow: var(--wfr-panel-shadow); font: 14px/1.6 system-ui, sans-serif; }
      .wfr-panel:focus { outline: none; }
      .wfr-panel-fixed { align-self: start; min-height: min(640px, calc(100vh - 64px)); }
      .wfr-header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 24px; border-bottom: 1px solid var(--wfr-border); }
      .wfr-header h2 { min-width: 0; margin: 0; font-size: 16px; font-weight: 600; letter-spacing: -.025em; overflow-wrap: anywhere; }
      .wfr-header > .wfr-button { flex: 0 0 auto; }
      .wfr-body { flex: 1 1 auto; min-height: 0; padding: 24px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--wfr-control-border) transparent; }
      .wfr-row { margin: 8px 0; overflow-wrap: anywhere; }
      label.wfr-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .wfr-kv-group { margin: 12px 0; padding: 2px 14px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-card-bg); }
      .wfr-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 0; padding: 8px 0; }
      .wfr-kv + .wfr-kv { border-top: 1px solid var(--wfr-border); }
      .wfr-kv > strong { flex: 0 0 auto; color: var(--wfr-muted); font-weight: 400; }
      .wfr-kv > .wfr-value { min-width: 0; text-align: right; }
      .wfr-event .wfr-kv-group, .wfr-home-module .wfr-kv-group { margin: 0; padding: 0; border: 0; background: transparent; }
      .wfr-event .wfr-kv { display: grid; grid-template-columns: 3em minmax(0, 1fr); gap: 10px; margin: 3px 0; padding: 0; border-top: 0; }
      .wfr-event .wfr-kv > .wfr-value { text-align: left; }
      .wfr-body > .wfr-kv-group { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(190px, 100%), 1fr)); gap: 8px; padding: 0; border: 0; background: transparent; }
      .wfr-body > .wfr-kv-group > .wfr-kv { flex-direction: column; align-items: flex-start; justify-content: flex-start; gap: 4px; padding: 11px 14px 12px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-card-bg); }
      .wfr-body > .wfr-kv-group > .wfr-kv > strong { flex: 0 1 auto; font-size: 12px; line-height: 1.5; }
      .wfr-body > .wfr-kv-group > .wfr-kv > .wfr-value { font-size: 16px; font-weight: 600; line-height: 1.4; text-align: left; overflow-wrap: anywhere; }
      .wfr-failure-code { margin: -4px 0 12px; font: 12px/1.6 var(--wfr-mono); overflow-wrap: anywhere; }
      .wfr-progress { position: relative; height: 16px; margin: 12px 0; overflow: hidden; background: radial-gradient(circle, var(--wfr-muted) 1.5px, transparent 2px) 0 50% / 14px 100% repeat-x; }
      .wfr-progress::after { content: ""; position: absolute; top: 0; bottom: 0; left: 0; right: calc(100% - 8px); background: var(--wfr-panel-bg); animation: wfr-pac-eaten 5s linear infinite; }
      .wfr-progress::before { content: ""; position: absolute; z-index: 1; top: 0; left: 0; width: 16px; height: 16px; border-radius: 50%; background: #e8b004; clip-path: polygon(0 0, 100% 0, 100% 18%, 50% 50%, 100% 82%, 100% 100%, 0 100%); animation: wfr-pac-run 5s linear infinite, wfr-pac-chomp .26s ease-in-out infinite alternate; }
      @keyframes wfr-pac-run { 0% { left: 0; transform: scaleX(1); } 50% { left: calc(100% - 16px); transform: scaleX(1); } 50.01% { left: calc(100% - 16px); transform: scaleX(-1); } 100% { left: 0; transform: scaleX(-1); } }
      @keyframes wfr-pac-chomp { from { clip-path: polygon(0 0, 100% 0, 100% 18%, 50% 50%, 100% 82%, 100% 100%, 0 100%); } to { clip-path: polygon(0 0, 100% 0, 100% 50%, 50% 50%, 100% 50%, 100% 100%, 0 100%); } }
      @keyframes wfr-pac-eaten { 0% { left: 0; right: calc(100% - 8px); } 50% { left: 0; right: 8px; } 50.01% { left: calc(100% - 8px); right: 0; } 100% { left: 8px; right: 0; } }
      .wfr-empty { margin: 14px 0; padding: 40px 16px; border: 1px dashed var(--wfr-control-border); border-radius: var(--wfr-radius-m); text-align: center; }
      .wfr-value { font-variant-numeric: tabular-nums; }
      .wfr-button { appearance: none; box-sizing: border-box; border: 1px solid var(--wfr-control-border); border-radius: var(--wfr-radius-m); background: var(--wfr-button-bg); color: var(--wfr-button-text); padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 500; line-height: 1.45; cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease; }
      .wfr-button:hover:enabled { background: var(--wfr-button-hover); border-color: var(--wfr-muted); }
      .wfr-root :is(button, input, select, textarea, a, summary):focus-visible { outline: 2px solid var(--wfr-accent); outline-offset: 3px; }
      .wfr-button:disabled { opacity: .55; cursor: default; }
      .wfr-primary { margin: 10px 0 14px; background: var(--wfr-primary-bg); border-color: var(--wfr-primary-bg); color: var(--wfr-primary-text); }
      .wfr-primary:hover:enabled { background: var(--wfr-primary-hover); border-color: var(--wfr-primary-hover); }
      .wfr-danger { background: var(--wfr-danger-bg); border-color: var(--wfr-danger-border); color: var(--wfr-danger-text); font-weight: 600; }
      .wfr-danger:hover:enabled, .wfr-danger:focus-visible { background: var(--wfr-danger-hover-bg); border-color: var(--wfr-danger-hover-bg); }
      .wfr-success { color: var(--wfr-success); font-weight: 500; }
      .wfr-success:empty { display: none; }
      .wfr-error { color: var(--wfr-error); font-weight: 500; }
      .wfr-body > .wfr-success, .wfr-body > .wfr-error { margin: 0 0 12px; padding: 9px 12px; border-left: 2px solid currentColor; border-radius: var(--wfr-radius-s); background: color-mix(in srgb, currentColor 8%, transparent); }
      .wfr-muted { color: var(--wfr-muted); }
      .wfr-search { width: 100%; box-sizing: border-box; margin-top: 12px; padding: 9px 12px; border: 1px solid var(--wfr-control-border); border-radius: var(--wfr-radius-m); background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-search::placeholder { color: var(--wfr-muted); opacity: 1; }
      .wfr-select { max-width: 100%; padding: 7px 10px; border: 1px solid var(--wfr-control-border); border-radius: var(--wfr-radius-m); background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-toggle { display: flex; align-items: center; gap: 8px; }
      .wfr-browse-tabs { display: flex; flex-wrap: wrap; box-sizing: border-box; gap: 4px; width: fit-content; max-width: 100%; margin: 0 0 20px; padding: 4px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-card-bg); }
      .wfr-browse-tab { appearance: none; border: 1px solid transparent; border-radius: var(--wfr-radius-s); background: transparent; color: var(--wfr-muted); padding: 6px 15px; font: inherit; font-weight: 500; cursor: pointer; }
      .wfr-browse-tab:hover { color: var(--wfr-button-text); background: var(--wfr-card-bg); }
      .wfr-browse-tab[aria-selected="true"] { color: var(--wfr-button-text); border-color: var(--wfr-border); background: var(--wfr-panel-bg); box-shadow: 0 1px 3px rgba(0,0,0,.06); }
      .wfr-browse-tab:focus-visible { outline: 2px solid var(--wfr-accent); outline-offset: 2px; }
      .wfr-browse-panel { padding-top: 2px; }
      .wfr-browse-panel[hidden] { display: none; }
      .wfr-setting-label { margin: 16px 0 5px; font-weight: 500; }
      .wfr-setting-description { margin: 0 0 16px; padding-left: 23px; font-size: 13px; line-height: 1.65; }
      .wfr-suboption { margin-left: 22px; }
      .wfr-suboption-description { margin-left: 22px; }
      .wfr-browse-status { margin: 9px 0 0; }
      .wfr-browse-status:empty { display: none; }
      .wfr-event-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; margin-top: 14px; }
      .wfr-event { min-width: 0; overflow-wrap: anywhere; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); padding: 14px 16px; background: var(--wfr-card-bg); }
      .wfr-event h3 { margin: 0 0 6px; font-size: 14px; }
      .wfr-event-unread > h3::before { content: ""; display: inline-block; width: 6px; height: 6px; margin-right: 7px; border-radius: 999px; background: var(--wfr-accent); vertical-align: middle; }
      .wfr-root input[type="checkbox"], .wfr-root input[type="radio"] { flex: 0 0 auto; accent-color: var(--wfr-accent); width: 15px; height: 15px; margin: 0; }
      .wfr-hygiene-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr)); gap: 12px 16px; margin-top: 12px; padding: 16px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-card-bg); }
      .wfr-hygiene-controls[hidden] { display: none; }
      .wfr-hygiene-controls .wfr-hygiene-group, .wfr-hygiene-controls .wfr-actions { grid-column: 1 / -1; }
      .wfr-hygiene-controls .wfr-actions { margin-top: 2px; }
      .wfr-hygiene-group-label { font-weight: 600; }
      .wfr-hygiene-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(116px, 1fr)); gap: 6px 12px; margin-top: 5px; }
      .wfr-hygiene-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; }
      .wfr-hygiene-bar[hidden] { display: none; }
      .wfr-hygiene-bar .wfr-actions { margin-top: 0; }
      .wfr-hygiene-filter-summary { flex: 1 1 220px; overflow-wrap: anywhere; }
      .wfr-hygiene-summary { margin: 8px 0 2px; }
      .wfr-hygiene-control { display: flex; flex-direction: column; align-items: stretch; gap: 5px; }
      .wfr-hygiene-check { display: flex; align-items: center; gap: 8px; }
      .wfr-hygiene-input { width: 100%; max-width: none; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--wfr-control-border); border-radius: var(--wfr-radius-m); background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-hygiene-reasons { margin: 6px 0 10px; padding-left: 22px; }
      .wfr-event-list .wfr-event { padding: 9px 11px; }
      .wfr-hygiene-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
      .wfr-hygiene-head .wfr-hygiene-check { flex: 0 0 auto; }
      .wfr-hygiene-head .wfr-hygiene-check span { font-size: 13px; color: var(--wfr-muted); }
      .wfr-hygiene-name { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
      .wfr-hygiene-uid { flex: 0 0 auto; color: var(--wfr-muted); font: 12px/1.6 var(--wfr-mono); }
      .wfr-hygiene-line { margin: 5px 0 0; overflow-wrap: anywhere; }
      .wfr-hygiene-facts { font-size: 13px; }
      .wfr-event .wfr-actions { margin-top: 9px; }
      .wfr-removal-confirm { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); }
      .wfr-batch-panel { margin-top: 10px; }
      .wfr-selection-bar { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding: 9px 11px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-panel-bg); color: var(--wfr-panel-text); box-shadow: var(--wfr-bar-shadow); }
      .wfr-body.wfr-body-flush { padding-bottom: 0; }
      .wfr-body-flush > .wfr-event-list { margin-bottom: 24px; }
      .wfr-body-flush > .wfr-selection-bar { margin: 0 -24px; padding: 12px 24px; border-width: 1px 0 0; border-radius: 0; }
      .wfr-selection-bar[hidden], .wfr-selection-row[hidden] { display: none; }
      .wfr-selection-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .wfr-selection-count { font-weight: 600; }
      .wfr-selection-bar .wfr-muted { margin: 0; overflow-wrap: anywhere; }
      .wfr-selection-bar .wfr-muted:empty { display: none; }
      .wfr-selection-row .wfr-button:first-child + .wfr-selection-count { margin-right: auto; }
      .wfr-confirm-list { max-height: 190px; overflow-y: auto; margin: 6px 0 10px; padding: 6px 8px 6px 26px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); }
      .wfr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .wfr-actions .wfr-primary { margin: 0; }
      .wfr-compact-actions { margin-top: 6px; }
      .wfr-module { margin-top: 22px; }
      .wfr-body h3 { margin: 18px 0 6px; font-size: 16px; }
      .wfr-body h3:first-child { margin-top: 0; }
      .wfr-body > h3:not(:first-child) { margin-top: 26px; padding-top: 22px; border-top: 1px solid var(--wfr-border); }
      .wfr-home { padding-top: 20px; padding-bottom: 18px; }
      .wfr-home-description { margin: 0; font-size: 13px; line-height: 1.7; }
      .wfr-home-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .wfr-home-module { display: flex; flex-direction: column; min-width: 0; padding: 16px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-l); background: var(--wfr-card-bg); }
      .wfr-home .wfr-home-module-title { margin: 0 0 10px; font-size: 14px; font-weight: 600; letter-spacing: -.015em; }
      .wfr-home-module .wfr-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 3px 0; padding: 0; border-top: 0; }
      .wfr-home-module .wfr-row strong { flex: 0 0 auto; color: var(--wfr-muted); font-size: 13px; font-weight: 400; }
      .wfr-home-module .wfr-value { min-width: 0; font: 13px/1.7 var(--wfr-mono); text-align: right; }
      .wfr-home-module .wfr-home-description { margin-bottom: 10px; }
      .wfr-home-hint { margin: 9px 0 0; font-size: 13px; line-height: 1.6; }
      .wfr-home-module > .wfr-actions { margin-top: auto; padding-top: 12px; gap: 7px; }
      .wfr-home-module .wfr-button { padding: 6px 10px; font-size: 13px; }
      .wfr-home-shortcut { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-content: start; align-items: center; }
      .wfr-home .wfr-home-shortcut .wfr-home-module-title { margin: 0; }
      .wfr-home-shortcut > .wfr-home-description, .wfr-home-shortcut > .wfr-kv-group, .wfr-home-shortcut > .wfr-home-hint { grid-column: 1 / -1; margin: 0; }
      .wfr-home-shortcut > .wfr-actions { grid-column: 2; grid-row: 1; margin: 0; padding: 0; }
      .wfr-home-tools { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--wfr-border); }
      .wfr-home-tools .wfr-actions { margin-top: 0; }
      .wfr-home .wfr-changelog-footer { display: flex; justify-content: flex-end; margin: 12px 0 0; }
      .wfr-browse-panel h3 { margin: 10px 0 4px; }
      .wfr-browse-panel h3:first-child { margin-top: 2px; }
      .wfr-profile-extras { box-sizing: border-box; position: relative; margin: 0 0 7px; padding: 2px 16px 7px; background: transparent; color: var(--wfr-muted); font: 13px/1.35 system-ui, sans-serif; font-weight: 400; }
      .wfr-profile-row { margin: 2px 0; overflow-wrap: anywhere; font-weight: 400; }
      .wfr-profile-label { color: var(--wfr-muted); }
      .wfr-profile-name-row { position: relative; width: max-content; max-width: 100%; margin: 3px 0; }
      .wfr-profile-name-trigger { appearance: none; border: 0; padding: 0; background: transparent; color: var(--wfr-button-text); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
      .wfr-profile-name-trigger:focus-visible, .wfr-profile-name-close:focus-visible { outline: 2px solid var(--wfr-accent); outline-offset: 2px; }
      .wfr-profile-name-popover { position: absolute; top: calc(100% + 5px); left: 0; z-index: 20; box-sizing: border-box; min-width: min(220px, calc(100vw - 48px)); max-width: min(320px, calc(100vw - 48px)); padding: 12px 14px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-panel-bg); color: var(--wfr-panel-text); box-shadow: var(--wfr-panel-shadow); }
      .wfr-profile-name-popover-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .wfr-profile-name-close { appearance: none; border: 0; padding: 1px 3px; background: transparent; color: var(--wfr-muted); font: inherit; cursor: pointer; }
      .wfr-profile-name-list { max-height: 180px; margin: 7px 0 0; padding-left: 20px; overflow-y: auto; }
      .wfr-note-editor { min-width: 0; }
      .wfr-note-text { margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .wfr-note-preview { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 5px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      .wfr-note-time, .wfr-note-counter { margin: 4px 0; font: 12px/1.6 var(--wfr-mono); }
      .wfr-note-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 5px 0; padding: 0; list-style: none; }
      .wfr-note-tags[hidden] { display: none; }
      .wfr-note-tag { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; box-sizing: border-box; padding: 2px 8px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-s); background: var(--wfr-card-bg); color: var(--wfr-panel-text); font-size: 12px; overflow-wrap: anywhere; }
      .wfr-note-tag-remove { appearance: none; border: 0; padding: 0 2px; background: transparent; color: var(--wfr-muted); font: inherit; cursor: pointer; }
      .wfr-note-tag-remove:focus-visible, .wfr-note-textarea:focus-visible, .wfr-note-tag-input:focus-visible { outline: 2px solid var(--wfr-accent); outline-offset: 2px; }
      .wfr-note-field-label { display: block; margin: 7px 0 3px; font-weight: 600; }
      .wfr-note-textarea { display: block; width: 100%; min-height: 96px; box-sizing: border-box; resize: vertical; padding: 9px 12px; border: 1px solid var(--wfr-control-border); border-radius: var(--wfr-radius-m); background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-note-tag-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .wfr-note-tag-input { flex: 1 1 140px; min-width: 0; box-sizing: border-box; padding: 7px 10px; border: 1px solid var(--wfr-control-border); border-radius: var(--wfr-radius-m); background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-note-status { margin: 6px 0 0; }
      .wfr-note-status:empty { display: none; }
      .wfr-note-conflict { margin: 4px 0 8px; padding: 8px 10px; border: 1px solid var(--wfr-error); border-radius: var(--wfr-radius-m); }
      .wfr-note-conflict p { margin: 3px 0; }
      .wfr-note-link { display: inline-block; text-decoration: none; }
      .wfr-note-link:hover { background: var(--wfr-button-hover); border-color: var(--wfr-muted); }
      .wfr-actions[hidden] { display: none; }
      .wfr-profile-notes { box-sizing: border-box; margin: 0 0 8px; padding: 12px 16px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-m); background: var(--wfr-panel-bg); color: var(--wfr-panel-text); font: 14px/1.55 system-ui, sans-serif; font-weight: 400; overflow-wrap: anywhere; }
      .wfr-profile-notes p { margin: 3px 0; }
      .wfr-profile-notes-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; }
      .wfr-profile-notes-head .wfr-muted { font-size: 13px; }
      .wfr-profile-notes .wfr-button { padding: 3px 9px; font: inherit; font-size: 13px; }
      .wfr-profile-notes .wfr-removal-confirm { margin-top: 6px; }
      .wfr-profile-notes-observed { margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--wfr-border); color: var(--wfr-muted); font-size: 13px; }
      .wfr-profile-notes-subhead { font-weight: 600; }
      .wfr-feed-note { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 0; min-width: 0; max-width: 100%; margin-left: 5px; vertical-align: middle; color: inherit; font: 13px/1.5 system-ui, sans-serif; }
      .wfr-feed-note-entry { appearance: none; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: var(--wfr-radius-s); padding: 0; background: transparent; color: inherit; font-size: 0; opacity: .4; cursor: pointer; vertical-align: middle; }
      .wfr-feed-note-entry::before { content: ""; width: 14px; height: 14px; background: currentColor; -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 4h12v17l-6-4-6 4z' fill='none' stroke='white' stroke-width='1.7' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 4h12v17l-6-4-6 4z' fill='none' stroke='white' stroke-width='1.7' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
      .wfr-feed-note-entry:hover, .wfr-feed-note-entry:focus-visible, .wfr-feed-note-entry[aria-expanded="true"] { opacity: 1; }
      .wfr-feed-note-entry:focus-visible { outline: 2px solid var(--wfr-accent); outline-offset: 2px; }
      .wfr-feed-note-entry.wfr-feed-note-has::before { -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 4h12v17l-6-4-6 4z' fill='white' stroke='white' stroke-width='1.7' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 4h12v17l-6-4-6 4z' fill='white' stroke='white' stroke-width='1.7' stroke-linejoin='round'/%3E%3C/svg%3E") center / contain no-repeat; }
      .wfr-feed-note-entry.wfr-feed-note-has { color: var(--wfr-accent); opacity: 1; }
      .wfr-feed-note-hint { display: none; }
      .wfr-feed-note-hint[hidden] { display: none; }
      .wfr-feed-note-card { position: absolute; top: 0; left: 0; z-index: 2147482500; box-sizing: border-box; display: flex; flex-direction: column; width: min(360px, calc(100vw - 24px)); max-height: min(560px, calc(100vh - 24px)); overflow: hidden; padding: 14px 16px; border: 1px solid var(--wfr-border); border-radius: var(--wfr-radius-l); background: var(--wfr-panel-bg); color: var(--wfr-panel-text); box-shadow: var(--wfr-panel-shadow); font: 14px/1.55 system-ui, sans-serif; font-weight: 400; overflow-wrap: anywhere; }
      .wfr-feed-note-card:focus { outline: none; }
      .wfr-feed-note-card:focus-visible { outline: 2px solid var(--wfr-accent); outline-offset: 1px; }
      .wfr-feed-note-card p { margin: 3px 0; }
      .wfr-feed-note-card .wfr-button { padding: 3px 9px; font: inherit; font-size: 13px; }
      .wfr-feed-note-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
      .wfr-feed-note-card-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
      .wfr-feed-note-card-title .wfr-muted { font-size: 13px; }
      .wfr-feed-note-card-notice:empty { display: none; }
      .wfr-feed-note-card-head, .wfr-feed-note-card-notice { flex: 0 0 auto; }
      .wfr-feed-note-card-body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
      .wfr-feed-note-card.wfr-feed-note-card-docked { position: fixed; top: auto; left: 12px; bottom: 12px; }
      .wfr-changelog-list { margin: 7px 0; padding-left: 22px; }
      .wfr-changelog-footer { margin: 18px 0 0; }
      .wfr-changelog-link { padding: 3px 7px; border-color: transparent; background: transparent; color: var(--wfr-muted); font: 12px/1.5 var(--wfr-mono); }
      .wfr-release-history { padding: 8px 0; border-bottom: 1px solid var(--wfr-border); }
      .wfr-release-history:first-child { padding-top: 0; }
      .wfr-release-history summary { cursor: pointer; font-weight: 600; }
      .wfr-release-history-content { padding: 2px 0 2px 12px; }
      .wfr-release-history-content h3 { margin: 8px 0 3px; font-size: 14px; }
      .wfr-release-history-content .wfr-changelog-list { margin: 3px 0 5px; }
      .wfr-usage-corner { position: fixed; right: 18px; bottom: 62px; z-index: 2147482999; padding: 5px 9px; border: 1px solid var(--wfr-launcher-border); border-radius: var(--wfr-radius-m); background: var(--wfr-launcher-bg); color: var(--wfr-launcher-text); box-shadow: none; font: 12px/1.35 var(--wfr-mono); opacity: .8; cursor: pointer; }
      .wfr-usage-corner:hover, .wfr-usage-corner:focus-visible { opacity: 1; border-color: var(--wfr-launcher-hover-border); }
      .wfr-toolkit-launcher { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px; padding: 9px 13px; border: 1px solid var(--wfr-launcher-border); border-radius: var(--wfr-radius-m); background: var(--wfr-launcher-bg); color: var(--wfr-launcher-text); box-shadow: 0 4px 16px rgba(0,0,0,.08); font: 13px/1.35 var(--wfr-mono); opacity: .95; transition: background-color 120ms ease, border-color 120ms ease; }
      .wfr-toolkit-launcher:hover:enabled, .wfr-toolkit-launcher:focus-visible { border-color: var(--wfr-launcher-hover-border); background: var(--wfr-launcher-hover-bg); opacity: 1; }
      .wfr-launcher-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 19px; height: 19px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; background: var(--wfr-badge-bg); color: var(--wfr-badge-text); font-size: 12px; font-weight: 700; line-height: 1; }
      .wfr-launcher-badge[hidden] { display: none; }
      @media (max-width: 680px) {
        .wfr-overlay { padding: 16px; }
        .wfr-panel { max-height: calc(100vh - 32px); }
        .wfr-panel-fixed { min-height: min(640px, calc(100vh - 32px)); }
        .wfr-body-flush > .wfr-event-list { margin-bottom: 18px; }
        .wfr-body-flush > .wfr-selection-bar { margin: 0 -18px; padding: 10px 18px; }
        .wfr-header { gap: 10px; padding: 14px 18px; }
        .wfr-body { padding: 18px; }
        .wfr-home-grid { grid-template-columns: minmax(0, 1fr); }
        .wfr-home-module { padding: 16px; }
      }
      @media (max-width: 360px) {
        .wfr-header { flex-wrap: wrap; }
        .wfr-header > .wfr-button:last-child { margin-left: auto; }
        .wfr-header h2 { order: 3; flex: 1 0 100%; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
      }
      @media (prefers-reduced-motion: reduce) {
        .wfr-button, .wfr-toolkit-launcher { transition: none; }
        .wfr-progress::before, .wfr-progress::after { animation: none; }
      }
    `;
    document.head.append(style);
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== "function") return;
    // Single fallback entry: everything else lives in the Toolkit UI itself.
    GM_registerMenuCommand("Weibo Toolkit：打开工具箱", showToolkitHome);
  }

  function scheduleNormalSurfaceStartupCoordinators() {
    scheduleBundledChangelogAutoShow();
    setTimeout(
      () => void checkAutomaticUpdatesSequentially(),
      AUTO_STARTUP_DELAY_MS
    );
  }

  currentTheme = loadTheme();
  pageCleanupPreferences = loadPageCleanupPreferences();
  preferLatestFeed = loadPageCleanupPreference(PREFER_LATEST_FEED_KEY);
  usageEnabledPreference = loadPageCleanupPreference(USAGE_ENABLED_KEY);
  usageCornerPreference = loadPageCleanupPreference(USAGE_CORNER_KEY);
  installStyles();
  applyPageCleanupStyles();
  registerMenuCommands();
  installToolkitLauncher();
  installPageRouteHook();
  syncPageRouteFeatures();
  if (usageEnabledPreference) startUsageTracking(false);
  scheduleNormalSurfaceStartupCoordinators();
})();
