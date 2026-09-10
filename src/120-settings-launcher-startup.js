
  function showPageSettings() {
    const body = showPanel("浏览体验", true);
    const status = createElement("p", "", "wfr-muted wfr-browse-status");
    const tabList = createElement("div", null, "wfr-browse-tabs");
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "浏览体验分类");
    const tabs = [];

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
      const tab = { button, panel };
      tabs.push(tab);
      button.addEventListener("click", () => {
        for (const candidate of tabs) {
          const isSelected = candidate === tab;
          candidate.button.setAttribute(
            "aria-selected",
            isSelected ? "true" : "false"
          );
          candidate.panel.hidden = !isSelected;
        }
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
        "首页、“最新微博”和个人主页中，自动展开进入视野的原创长微博；转发微博保持折叠，展开时可能触发微博自身的正文加载。",
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
      status.textContent = next
        ? "已启用其他用户主页的 Toolkit 本地小档案与访问记录。"
        : "已停止显示主页小档案和记录主页访问。";
    });
    enhancementPanel.append(
      profileExtrasLabel,
      createElement(
        "p",
        "使用 Toolkit 已有本地关系记录显示历史昵称等资料，并记录当前浏览器的访问次数和上次访问时间；不新增个人主页请求。",
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
        "仅在当前浏览器记录估算活跃时间和浏览数量，不保存微博正文或详细浏览历史。",
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
    usagePanelButton.addEventListener("click", showUsageStatistics);
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
    cleanupPanel.append(
      createElement(
        "p",
        "仅隐藏明确列出的页面组件，不处理信息流内容。",
        "wfr-muted wfr-setting-description"
      )
    );
    body.append(status);
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
    const unread = countUnreadEvents(loaded.state.events);
    showUnreadBadge(unread);
    const moduleTitle = createElement("p", null, "wfr-row");
    moduleTitle.append(createElement("strong", "关系雷达"));
    body.append(moduleTitle);
    addLine(
      body,
      "上次成功更新",
      snapshot ? formatTime(snapshot.capturedAt) : "—"
    );
    addLine(body, "API可见关注", snapshot ? snapshot.visibleCount : "—");
    addLine(body, "未读事件", unread);

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
    autoSettingsButton.addEventListener("click", showAutoUpdateSettings);
    actions.append(
      updateButton,
      eventsButton,
      overviewButton,
      statusButton,
      exportButton,
      restoreButton,
      autoSettingsButton
    );
    body.append(actions);

    // The follower module is its own section, so the gap after the Friend Radar
    // actions belongs to the section and survives button wrapping.
    const followerSection = createElement("div", null, "wfr-module");
    body.append(followerSection);
    const followerModuleTitle = createElement("p", null, "wfr-row");
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
        followerSnapshot ? formatTime(followerSnapshot.capturedAt) : "—"
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

    const browseSection = createElement("div", null, "wfr-module");
    const browseTitle = createElement("p", null, "wfr-row");
    browseTitle.append(createElement("strong", "浏览体验"));
    const browseActions = createElement("div", null, "wfr-actions");
    const browseButton = createElement("button", "浏览体验", "wfr-button");
    browseButton.type = "button";
    browseButton.addEventListener("click", showPageSettings);
    browseActions.append(browseButton);
    browseSection.append(browseTitle, browseActions);
    body.append(browseSection);

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
    "color-scheme: light; --wfr-overlay-bg: rgba(0,0,0,.45); --wfr-panel-bg: #fff; --wfr-panel-text: #222; --wfr-panel-shadow: 0 12px 36px rgba(0,0,0,.25); --wfr-border: #ddd; --wfr-control-border: #bbb; --wfr-button-bg: #fff; --wfr-button-text: #222; --wfr-primary-bg: #1677ff; --wfr-primary-text: #fff; --wfr-danger-bg: #c9330d; --wfr-danger-text: #fff; --wfr-danger-border: #a52708; --wfr-danger-hover-bg: #a52708; --wfr-success: #176b2c; --wfr-error: #a11919; --wfr-muted: #666; --wfr-field-bg: #fff; --wfr-field-text: #222; --wfr-card-bg: transparent; --wfr-launcher-bg: rgba(255,255,255,.9); --wfr-launcher-text: #1f2328; --wfr-launcher-border: rgba(0,0,0,.18); --wfr-launcher-hover-bg: #fff; --wfr-launcher-hover-border: rgba(0,0,0,.32); --wfr-badge-bg: #d4380d; --wfr-badge-text: #fff;";

  const DARK_THEME_TOKENS =
    "color-scheme: dark; --wfr-overlay-bg: rgba(0,0,0,.6); --wfr-panel-bg: #1f2126; --wfr-panel-text: #e8e8ea; --wfr-panel-shadow: 0 12px 36px rgba(0,0,0,.55); --wfr-border: #3a3d44; --wfr-control-border: #4a4e56; --wfr-button-bg: #2a2d33; --wfr-button-text: #e8e8ea; --wfr-primary-bg: #2d7ff9; --wfr-primary-text: #fff; --wfr-danger-bg: #b23a2f; --wfr-danger-text: #fff; --wfr-danger-border: #d0574a; --wfr-danger-hover-bg: #c4483b; --wfr-success: #6bd18c; --wfr-error: #ff8f8f; --wfr-muted: #a6aab3; --wfr-field-bg: #2a2d33; --wfr-field-text: #e8e8ea; --wfr-card-bg: #24272d; --wfr-launcher-bg: rgba(33,35,40,.92); --wfr-launcher-text: #e8e8ea; --wfr-launcher-border: rgba(255,255,255,.22); --wfr-launcher-hover-bg: rgba(45,48,55,.96); --wfr-launcher-hover-border: rgba(255,255,255,.38); --wfr-badge-bg: #ff6b5e; --wfr-badge-text: #26100c;";

  function installStyles() {
    const style = createElement("style");
    style.textContent = `
      .wfr-root { ${LIGHT_THEME_TOKENS} }
      .wfr-root.wfr-theme-dark { ${DARK_THEME_TOKENS} }
      @media (prefers-color-scheme: dark) {
        .wfr-root.wfr-theme-system { ${DARK_THEME_TOKENS} }
      }
      .wfr-overlay { position: fixed; inset: 0; z-index: 2147483647; background: var(--wfr-overlay-bg); padding: 28px; overflow: auto; box-sizing: border-box; }
      .wfr-panel { max-width: 720px; margin: 0 auto; background: var(--wfr-panel-bg); color: var(--wfr-panel-text); border-radius: 8px; box-shadow: var(--wfr-panel-shadow); font: 14px/1.5 system-ui, sans-serif; }
      .wfr-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--wfr-border); }
      .wfr-header h2 { margin: 0; font-size: 18px; }
      .wfr-body { padding: 18px 20px 22px; }
      .wfr-row { margin: 7px 0; overflow-wrap: anywhere; }
      .wfr-button { border: 1px solid var(--wfr-control-border); border-radius: 5px; background: var(--wfr-button-bg); color: var(--wfr-button-text); padding: 6px 10px; cursor: pointer; }
      .wfr-button:disabled { opacity: .55; cursor: default; }
      .wfr-primary { margin: 10px 0 14px; background: var(--wfr-primary-bg); border-color: var(--wfr-primary-bg); color: var(--wfr-primary-text); }
      .wfr-danger { background: var(--wfr-danger-bg); border-color: var(--wfr-danger-border); color: var(--wfr-danger-text); font-weight: 600; }
      .wfr-danger:hover:enabled, .wfr-danger:focus-visible { background: var(--wfr-danger-hover-bg); border-color: var(--wfr-danger-hover-bg); }
      .wfr-success { color: var(--wfr-success); font-weight: 600; }
      .wfr-error { color: var(--wfr-error); font-weight: 600; }
      .wfr-muted { color: var(--wfr-muted); }
      .wfr-search { width: 100%; box-sizing: border-box; margin-top: 12px; padding: 6px 9px; border: 1px solid var(--wfr-control-border); border-radius: 5px; background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-select { margin-left: 8px; padding: 5px 8px; border: 1px solid var(--wfr-control-border); border-radius: 5px; background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-toggle { display: flex; align-items: center; gap: 8px; }
      .wfr-browse-tabs { display: flex; gap: 4px; margin: -4px 0 8px; border-bottom: 1px solid var(--wfr-border); }
      .wfr-browse-tab { appearance: none; border: 0; border-bottom: 2px solid transparent; border-radius: 4px 4px 0 0; background: transparent; color: var(--wfr-muted); padding: 6px 11px 5px; font: inherit; font-weight: 600; cursor: pointer; }
      .wfr-browse-tab:hover { color: var(--wfr-button-text); background: var(--wfr-card-bg); }
      .wfr-browse-tab[aria-selected="true"] { color: var(--wfr-button-text); border-bottom-color: var(--wfr-primary-bg); background: var(--wfr-card-bg); }
      .wfr-browse-tab:focus-visible { outline: 2px solid var(--wfr-primary-bg); outline-offset: 2px; }
      .wfr-browse-panel { padding-top: 2px; }
      .wfr-browse-panel[hidden] { display: none; }
      .wfr-setting-label { margin: 5px 0 1px; }
      .wfr-setting-description { margin: 0 0 7px; padding-left: 22px; font-size: 12.5px; line-height: 1.4; }
      .wfr-suboption { margin-left: 22px; }
      .wfr-suboption-description { margin-left: 22px; }
      .wfr-browse-status { margin: 9px 0 0; }
      .wfr-browse-status:empty { display: none; }
      .wfr-event-list { display: grid; gap: 10px; margin-top: 14px; }
      .wfr-event { border: 1px solid var(--wfr-border); border-radius: 6px; padding: 10px 12px; background: var(--wfr-card-bg); }
      .wfr-event h3 { margin: 0 0 6px; font-size: 14px; }
      .wfr-root input[type="checkbox"], .wfr-root input[type="radio"] { accent-color: var(--wfr-primary-bg); width: 14px; height: 14px; margin: 0; }
      .wfr-hygiene-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px 14px; margin-top: 10px; padding: 10px 12px; border: 1px solid var(--wfr-border); border-radius: 6px; }
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
      .wfr-hygiene-input { width: 100%; max-width: none; box-sizing: border-box; padding: 5px 8px; border: 1px solid var(--wfr-control-border); border-radius: 5px; background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
      .wfr-hygiene-reasons { margin: 6px 0 10px; padding-left: 22px; }
      .wfr-event-list .wfr-event { padding: 9px 11px; }
      .wfr-hygiene-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
      .wfr-hygiene-head .wfr-hygiene-check { flex: 0 0 auto; }
      .wfr-hygiene-head .wfr-hygiene-check span { font-size: 12px; color: var(--wfr-muted); }
      .wfr-hygiene-name { flex: 1 1 auto; min-width: 0; font-weight: 600; overflow-wrap: anywhere; }
      .wfr-hygiene-uid { flex: 0 0 auto; color: var(--wfr-muted); font-size: 12px; }
      .wfr-hygiene-line { margin: 5px 0 0; overflow-wrap: anywhere; }
      .wfr-hygiene-facts { font-size: 12px; }
      .wfr-event .wfr-actions { margin-top: 9px; }
      .wfr-removal-confirm { margin-top: 10px; padding: 10px 12px; border: 1px solid var(--wfr-border); border-radius: 6px; }
      .wfr-batch-panel { margin-top: 10px; }
      .wfr-selection-bar { position: sticky; bottom: 0; z-index: 1; display: flex; flex-direction: column; gap: 6px; margin-top: 14px; padding: 9px 11px; border: 1px solid var(--wfr-border); border-radius: 6px; background: var(--wfr-panel-bg); color: var(--wfr-panel-text); box-shadow: 0 -2px 10px rgba(0,0,0,.18); }
      .wfr-selection-bar[hidden], .wfr-selection-row[hidden] { display: none; }
      .wfr-selection-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .wfr-selection-count { font-weight: 600; }
      .wfr-selection-bar .wfr-muted { margin: 0; }
      .wfr-selection-bar .wfr-muted:empty { display: none; }
      .wfr-selection-row .wfr-button:first-child + .wfr-selection-count { margin-right: auto; }
      .wfr-confirm-list { max-height: 190px; overflow-y: auto; margin: 6px 0 10px; padding: 6px 8px 6px 26px; border: 1px solid var(--wfr-border); border-radius: 5px; }
      .wfr-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .wfr-actions .wfr-primary { margin: 0; }
      .wfr-compact-actions { margin-top: 6px; }
      .wfr-module { margin-top: 22px; }
      .wfr-body h3 { margin: 18px 0 6px; font-size: 15px; }
      .wfr-body h3:first-child { margin-top: 0; }
      .wfr-browse-panel h3 { margin: 10px 0 4px; }
      .wfr-browse-panel h3:first-child { margin-top: 2px; }
      .wfr-profile-extras { box-sizing: border-box; position: relative; margin: 0 0 7px; padding: 2px 16px 7px; background: transparent; color: var(--wfr-muted); font: 12px/1.35 system-ui, sans-serif; font-weight: 400; }
      .wfr-profile-row { margin: 2px 0; overflow-wrap: anywhere; font-weight: 400; }
      .wfr-profile-label { color: var(--wfr-muted); }
      .wfr-profile-name-row { position: relative; width: max-content; max-width: 100%; margin: 3px 0; }
      .wfr-profile-name-trigger { appearance: none; border: 0; padding: 0; background: transparent; color: var(--wfr-button-text); font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; text-decoration: underline dotted; text-underline-offset: 3px; }
      .wfr-profile-name-trigger:focus-visible, .wfr-profile-name-close:focus-visible { outline: 2px solid var(--wfr-primary-bg); outline-offset: 2px; }
      .wfr-profile-name-popover { position: absolute; top: calc(100% + 5px); left: 0; z-index: 20; box-sizing: border-box; min-width: 220px; max-width: min(320px, calc(100vw - 48px)); padding: 9px 11px; border: 1px solid var(--wfr-border); border-radius: 6px; background: var(--wfr-panel-bg); color: var(--wfr-panel-text); box-shadow: 0 6px 18px rgba(0,0,0,.18); }
      .wfr-profile-name-popover-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .wfr-profile-name-close { appearance: none; border: 0; padding: 1px 3px; background: transparent; color: var(--wfr-muted); font: inherit; cursor: pointer; }
      .wfr-profile-name-list { max-height: 180px; margin: 7px 0 0; padding-left: 20px; overflow-y: auto; }
      .wfr-changelog-list { margin: 7px 0; padding-left: 22px; }
      .wfr-changelog-footer { margin: 18px 0 0; }
      .wfr-changelog-link { padding: 3px 7px; font-size: 12px; opacity: .78; }
      .wfr-changelog-link:hover, .wfr-changelog-link:focus-visible { opacity: 1; }
      .wfr-release-history { padding: 8px 0; border-bottom: 1px solid var(--wfr-border); }
      .wfr-release-history:first-child { padding-top: 0; }
      .wfr-release-history summary { cursor: pointer; font-weight: 600; }
      .wfr-release-history-content { padding: 2px 0 2px 12px; }
      .wfr-release-history-content h3 { margin: 8px 0 3px; font-size: 13px; }
      .wfr-release-history-content .wfr-changelog-list { margin: 3px 0 5px; }
      .wfr-usage-corner { position: fixed; right: 18px; bottom: 58px; z-index: 2147482999; padding: 4px 8px; border: 1px solid var(--wfr-launcher-border); border-radius: 999px; background: var(--wfr-launcher-bg); color: var(--wfr-launcher-text); box-shadow: none; font: 11px/1.35 system-ui, sans-serif; opacity: .68; cursor: pointer; }
      .wfr-usage-corner:hover, .wfr-usage-corner:focus-visible { opacity: 1; border-color: var(--wfr-launcher-hover-border); }
      .wfr-toolkit-launcher { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border: 1px solid var(--wfr-launcher-border); border-radius: 999px; background: var(--wfr-launcher-bg); color: var(--wfr-launcher-text); box-shadow: none; font: 13px/1.35 system-ui, sans-serif; opacity: .9; transition: opacity 100ms ease, background-color 100ms ease, border-color 100ms ease; }
      .wfr-toolkit-launcher:hover, .wfr-toolkit-launcher:focus-visible { border-color: var(--wfr-launcher-hover-border); background: var(--wfr-launcher-hover-bg); opacity: 1; }
      .wfr-launcher-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 19px; height: 19px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; background: var(--wfr-badge-bg); color: var(--wfr-badge-text); font-size: 11px; font-weight: 700; line-height: 1; }
      .wfr-launcher-badge[hidden] { display: none; }
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
