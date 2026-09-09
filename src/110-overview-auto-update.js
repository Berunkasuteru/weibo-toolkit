
  function showRelationshipOverview() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("关系概览", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("关系概览", loaded);
      return;
    }
    showUnreadBadgeForState(loaded.state);

    const overview = deriveRelationshipOverview(loaded.state);
    const body = showPanel("关系概览", true);

    body.append(createElement("h3", "当前状态"));
    if (overview.current === null) {
      body.append(
        createElement(
          "p",
          "尚未保存首次关注快照，暂无当前关系状态可显示。请先完成一次关系雷达更新。",
          "wfr-muted"
        )
      );
    } else {
      addLine(body, "快照时间", formatTime(overview.current.capturedAt));
      addLine(body, "API可见关注", overview.current.visibleFollowing);
      addLine(body, "互相关注", overview.current.mutual);
      addLine(body, "单向关注", overview.current.oneWay);
      body.append(
        createElement(
          "p",
          "“单向关注”指你关注了对方，但在最近一次快照中未观察到对方关注你。",
          "wfr-muted"
        )
      );
      body.append(
        createElement(
          "p",
          "以上数字只覆盖接口可见的关注列表，不代表微博上的完整关注或粉丝情况。",
          "wfr-muted"
        )
      );
    }

    body.append(createElement("h3", "历史事件次数"));
    addLine(body, "事件总数", overview.totalEvents);
    addLine(body, "未读事件", overview.unreadEvents);
    for (const type of Object.values(EVENT)) {
      addLine(body, EVENT_LABELS[type], overview.historicalEventCounts[type]);
    }
    body.append(
      createElement(
        "p",
        "历史数字统计的是事件发生次数，不是人数：同一个账号反复变化会被多次计入。",
        "wfr-muted"
      )
    );
    body.append(
      createElement(
        "p",
        "以上仅为 Weibo Toolkit 实际观察并保存的事件，不是微博上的完整真实关系历史。",
        "wfr-muted"
      )
    );
  }

  // The button carries an explicit accessible name, so it has to be recomposed
  // whenever either the label or the badge changes.
  function syncLauncherAccessibleName() {
    if (!launcherButton || !launcherLabel || !launcherBadge) return;
    const unread = launcherBadge.hidden
      ? ""
      : `，${launcherBadge.textContent} 条未读事件`;
    launcherButton.setAttribute(
      "aria-label",
      `${launcherLabel.textContent}${unread}`
    );
  }

  function setLauncherLabel(text) {
    if (!launcherLabel) return;
    launcherLabel.textContent = text;
    syncLauncherAccessibleName();
  }

  function setLauncherStatus(text, resetAfterMilliseconds) {
    if (!launcherButton) return;
    if (launcherStatusTimer !== null) {
      clearTimeout(launcherStatusTimer);
      launcherStatusTimer = null;
    }
    setLauncherLabel(text);
    if (typeof resetAfterMilliseconds === "number") {
      launcherStatusTimer = setTimeout(() => {
        setLauncherLabel(LAUNCHER_LABEL);
        launcherStatusTimer = null;
      }, resetAfterMilliseconds);
    }
  }

  // Purely visual: the badge reads stored state and never writes it or fetches.
  function showUnreadBadge(unreadEventCount) {
    if (!launcherBadge) return;
    const badgeText = formatUnreadBadge(unreadEventCount);
    launcherBadge.textContent = badgeText === null ? "" : badgeText;
    launcherBadge.hidden = badgeText === null;
    syncLauncherAccessibleName();
  }

  function showUnreadBadgeForState(state) {
    showUnreadBadge(countUnreadEvents(state.events));
  }

  function refreshUnreadBadge() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showUnreadBadge(0);
      return;
    }
    const loaded = loadState(uidResult.uid);
    showUnreadBadge(loaded.ok ? countUnreadEvents(loaded.state.events) : 0);
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
          if (
            updateRunning ||
            followerUpdateRunning ||
            followerRemovalInFlight
          ) {
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
          let attemptedAt = null;
          try {
            result = await performUpdate(null, () => {
              attemptedAt = new Date().toISOString();
              return saveLastAutomaticAttempt(uidResult.uid, attemptedAt);
            });
          } catch (error) {
            result = {
              ok: false,
              failureKind: "UNKNOWN_FAILURE",
              errorName: error && error.name ? String(error.name) : "Error",
            };
          } finally {
            updateRunning = false;
          }
          if (attemptedAt !== null) {
            saveAutomaticOutcome(
              AUTO_OUTCOME_PREFIX,
              uidResult.uid,
              attemptedAt,
              result
            );
          }
          setLauncherStatus(
            result.ok ? "关系雷达自动更新完成" : "关系雷达自动更新失败",
            AUTO_STATUS_DURATION_MS
          );
          refreshUnreadBadge();
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

  async function checkAutomaticFollowerUpdate() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) return uidResult;
    const preliminary = evaluateFollowerAutomaticUpdateEligibility(
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
        "weibo-toolkit-friend-radar-auto-" + uidResult.uid,
        { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (lock === null) {
            return { ok: true, eligible: false, reason: "LOCK_NOT_ACQUIRED" };
          }
          const lockedEligibility =
            evaluateFollowerAutomaticUpdateEligibility(
              uidResult.uid,
              Date.now()
            );
          if (!lockedEligibility.ok || !lockedEligibility.eligible) {
            return lockedEligibility;
          }
          if (
            updateRunning ||
            followerUpdateRunning ||
            followerRemovalInFlight
          ) {
            return {
              ok: true,
              eligible: false,
              reason: "UPDATE_ALREADY_RUNNING",
            };
          }
          const currentUid = determineCurrentUid();
          if (!currentUid.ok || currentUid.uid !== uidResult.uid) {
            return {
              ok: false,
              failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
            };
          }
          const attemptedAt = new Date().toISOString();
          const attemptSaved = saveFollowerLastAutomaticAttempt(
            uidResult.uid,
            attemptedAt
          );
          if (!attemptSaved.ok) return attemptSaved;

          followerUpdateRunning = true;
          setLauncherStatus("粉丝快照正在自动更新…");
          let result;
          try {
            result = await performFollowerUpdate(
              null,
              () => false,
              { automatic: true }
            );
          } catch (error) {
            result = {
              ok: false,
              failureKind: "UNKNOWN_FAILURE",
              errorName: error && error.name ? String(error.name) : "Error",
            };
          } finally {
            followerUpdateRunning = false;
          }
          saveAutomaticOutcome(
            FOLLOWER_AUTO_OUTCOME_PREFIX,
            uidResult.uid,
            attemptedAt,
            result
          );
          setLauncherStatus(
            result.ok
              ? "粉丝快照自动更新完成"
              : "粉丝快照自动更新失败",
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

  async function checkAutomaticUpdatesSequentially() {
    const friendRadar = await checkAutomaticUpdate();
    const followerSnapshot = await checkAutomaticFollowerUpdate();
    return { friendRadar, followerSnapshot };
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
    const lastOutcome = loadAutomaticOutcome(
      AUTO_OUTCOME_PREFIX,
      uidResult.uid
    );
    if (!lastOutcome.ok) {
      showFailure("自动更新设置", lastOutcome);
      return;
    }
    const followerInterval = loadFollowerAutoInterval(uidResult.uid);
    if (!followerInterval.ok) {
      showFailure("自动更新设置", followerInterval);
      return;
    }
    const followerState = loadFollowerState(uidResult.uid);
    if (!followerState.ok) {
      showFailure("自动更新设置", followerState);
      return;
    }
    const followerLastAttempt = loadFollowerLastAutomaticAttempt(
      uidResult.uid
    );
    if (!followerLastAttempt.ok) {
      showFailure("自动更新设置", followerLastAttempt);
      return;
    }
    const followerLastOutcome = loadAutomaticOutcome(
      FOLLOWER_AUTO_OUTCOME_PREFIX,
      uidResult.uid
    );
    if (!followerLastOutcome.ok) {
      showFailure("自动更新设置", followerLastOutcome);
      return;
    }

    const body = showPanel("自动更新与外观", true);
    if (notice) body.append(createElement("p", notice, "wfr-success"));
    body.append(createElement("h3", "关系雷达自动更新"));
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
          "请先手动完成一次关系雷达更新，自动更新不会保存首次快照。",
          "wfr-muted"
        )
      );
    }
    const label = createElement("label", "自动更新间隔：", "wfr-row");
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
    addLine(body, "上次自动结果", describeAutomaticOutcome(lastOutcome.value));

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
      showAutoUpdateSettings("关系雷达自动更新设置已保存。");
    });
    body.append(saveButton);

    body.append(createElement("h3", "粉丝快照自动更新"));
    body.append(
      createElement(
        "p",
        "仅在打开网页版微博时检查，不会在浏览器后台定时运行。",
        "wfr-muted"
      )
    );
    if (followerState.state.latestSnapshot === null) {
      body.append(
        createElement(
          "p",
          "首次到期的自动更新会保存首次粉丝快照，不会生成历史变化事件。",
          "wfr-muted"
        )
      );
    }
    const followerIntervalLabel = createElement(
      "label",
      "自动更新间隔：",
      "wfr-row"
    );
    const followerIntervalSelect = createElement(
      "select",
      null,
      "wfr-select"
    );
    for (const [hours, text] of [
      [0, "关闭"],
      [24, "每 24 小时"],
      [48, "每 48 小时"],
      [72, "每 72 小时"],
      [168, "每 7 天"],
      [360, "每 15 天"],
    ]) {
      const option = createElement("option", text);
      option.value = String(hours);
      followerIntervalSelect.append(option);
    }
    followerIntervalSelect.value = String(followerInterval.value);
    followerIntervalLabel.append(followerIntervalSelect);
    body.append(followerIntervalLabel);
    addLine(
      body,
      "上次自动尝试",
      followerLastAttempt.value === null
        ? "—"
        : formatTime(followerLastAttempt.value)
    );
    addLine(
      body,
      "上次自动结果",
      describeAutomaticOutcome(followerLastOutcome.value)
    );
    body.append(
      createElement(
        "p",
        "首次启用建议选择每 72 小时。",
        "wfr-muted"
      )
    );
    const followerSaveButton = createElement(
      "button",
      "保存设置",
      "wfr-button wfr-primary"
    );
    followerSaveButton.type = "button";
    followerSaveButton.addEventListener("click", () => {
      const currentUid = determineCurrentUid();
      if (!currentUid.ok || currentUid.uid !== uidResult.uid) {
        showFailure("自动更新设置", {
          failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
        });
        return;
      }
      const selectedHours = Number(followerIntervalSelect.value);
      if (!AUTO_INTERVAL_HOURS.includes(selectedHours)) {
        showFailure("自动更新设置", {
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_AUTO_INTERVAL_INVALID",
        });
        return;
      }
      const saved = saveFollowerAutoInterval(
        uidResult.uid,
        selectedHours
      );
      if (!saved.ok) {
        showFailure("自动更新设置", saved);
        return;
      }
      showAutoUpdateSettings("粉丝快照自动更新设置已保存。");
    });
    body.append(followerSaveButton);

    body.append(createElement("h3", "外观"));
    body.append(buildAppearanceControl());
    body.append(
      createElement(
        "p",
        "外观仅影响 Weibo Toolkit 自己的界面，不会更改微博页面的主题，也不会跟随微博的主题设置。",
        "wfr-muted"
      )
    );
  }
