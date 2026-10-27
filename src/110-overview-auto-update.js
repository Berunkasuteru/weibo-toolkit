
  function filterOverviewFollowingRecords(records, filter, query) {
    const mode =
      filter === "MUTUAL" || filter === "ONE_WAY" ? filter : "ALL";
    const needle = String(query || "").trim().toLowerCase();
    return records.filter((record) => {
      if (mode === "MUTUAL" && !record.followsMe) return false;
      if (mode === "ONE_WAY" && record.followsMe) return false;
      if (needle === "") return true;
      return [record.screenName, record.remark, record.uid].some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(needle)
      );
    });
  }

  function showRelationshipOverview(viewState) {
    const view =
      isPlainObject(viewState) &&
      typeof viewState.filter === "string" &&
      typeof viewState.query === "string"
        ? { filter: viewState.filter, query: viewState.query }
        : { filter: "ALL", query: "" };
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("关系概览", uidResult);
      return;
    }
    const ownerUid = uidResult.uid;
    const loaded = loadState(ownerUid);
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
        "统计的是事件次数，不是人数。",
        "wfr-muted"
      )
    );

    if (overview.current !== null && loaded.state.latestSnapshot !== null) {
      const records = loaded.state.latestSnapshot.records;
      const notesLoaded = loadFriendNotesState(ownerUid);
      const notedUids = notesLoaded.ok ? notesLoaded.state.notes : null;

      body.append(createElement("h3", "当前关注名单"));
      const filterRow = createElement("label", "关系筛选：", "wfr-row");
      const filterSelect = createElement("select", null, "wfr-select");
      filterSelect.setAttribute("aria-label", "按关系状态筛选");
      for (const [value, label] of [
        ["ALL", `全部可见关注（${overview.current.visibleFollowing}）`],
        ["MUTUAL", `互相关注（${overview.current.mutual}）`],
        ["ONE_WAY", `单向关注（${overview.current.oneWay}）`],
      ]) {
        const option = createElement("option", label);
        option.value = value;
        option.selected = value === view.filter;
        filterSelect.append(option);
      }
      filterSelect.value =
        view.filter === "MUTUAL" || view.filter === "ONE_WAY"
          ? view.filter
          : "ALL";
      filterRow.append(filterSelect);
      body.append(filterRow);

      const search = createElement("input", null, "wfr-search");
      search.type = "search";
      search.placeholder = "搜索昵称、微博备注或 UID";
      search.setAttribute("aria-label", "搜索当前关注名单");
      search.value = view.query;
      body.append(search);

      const summary = createElement("p", "", "wfr-muted");
      const list = createElement("div", null, "wfr-event-list");
      const moreActions = createElement("div", null, "wfr-actions");
      const moreButton = createElement("button", "加载更多", "wfr-button");
      moreButton.type = "button";
      moreActions.append(moreButton);
      body.append(summary, list, moreActions);

      let matching = [];
      let shown = 0;
      const returnToOverview = () =>
        showRelationshipOverview({
          filter: filterSelect.value,
          query: String(search.value || ""),
        });

      function buildRecordCard(record) {
        const item = createElement("article", null, "wfr-event");
        item.append(
          createElement(
            "h3",
            `${record.screenName} · ${
              record.followsMe ? "互相关注" : "单向关注"
            }`
          )
        );
        addLine(item, "UID", record.uid);
        if (typeof record.remark === "string" && record.remark.trim() !== "") {
          addLine(item, "微博备注", record.remark);
        }
        const actions = createElement("div", null, "wfr-actions");
        actions.append(createFriendNoteProfileLink(record.uid));
        const eventCount = eventsForSubject(
          loaded.state.events,
          record.uid
        ).length;
        if (eventCount > 0) {
          const timelineButton = createElement(
            "button",
            `关系时间线（${eventCount}）`,
            "wfr-button"
          );
          timelineButton.type = "button";
          timelineButton.addEventListener("click", () =>
            showTimeline(ownerUid, loaded.state, record.uid, returnToOverview)
          );
          actions.append(timelineButton);
        }
        if (notedUids !== null) {
          const noteButton = createElement(
            "button",
            hasOwn(notedUids, record.uid) ? "友人档案" : "写档案",
            "wfr-button"
          );
          noteButton.type = "button";
          noteButton.addEventListener("click", () =>
            showFriendNoteDetail(ownerUid, record.uid, null, returnToOverview)
          );
          actions.append(noteButton);
        }
        item.append(actions);
        return item;
      }

      function renderMore() {
        const next = matching.slice(shown, shown + FRIEND_NOTES_PAGE_SIZE);
        for (const record of next) list.append(buildRecordCard(record));
        shown += next.length;
        const remaining = matching.length - shown;
        moreActions.hidden = remaining <= 0;
        moreButton.textContent = `加载更多（还有 ${remaining} 个）`;
      }

      function renderList() {
        while (list.childNodes.length > 0) list.removeChild(list.childNodes[0]);
        matching = filterOverviewFollowingRecords(
          records,
          view.filter,
          view.query
        );
        shown = 0;
        summary.textContent =
          matching.length === records.length
            ? `共 ${records.length} 个关注账号`
            : `共 ${records.length} 个关注账号，匹配 ${matching.length} 个`;
        if (matching.length === 0) {
          list.append(
            createElement("p", "没有匹配的关注账号", "wfr-muted wfr-empty")
          );
        }
        renderMore();
      }

      filterSelect.addEventListener("change", () => {
        view.filter = filterSelect.value;
        renderList();
      });
      search.addEventListener("input", () => {
        view.query = String(search.value || "");
        renderList();
      });
      moreButton.addEventListener("click", renderMore);
      renderList();
    }
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
          // An outcome is only ever written for an attempt the storage layer
          // actually accepted, so a rejected attempt cannot leave an orphan
          // result behind for a run that never happened.
          let attemptedAt = null;
          let attemptRecorded = false;
          try {
            result = await performUpdate(null, () => {
              const candidate = new Date().toISOString();
              const saved = saveLastAutomaticAttempt(
                uidResult.uid,
                candidate
              );
              if (!saved.ok) return saved;
              attemptedAt = candidate;
              attemptRecorded = true;
              return saved;
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
          // Outcome metadata is advisory: a failed record never downgrades the
          // durable scan result, but it must not be reported as a clean run.
          const outcomeRecorded =
            !attemptRecorded ||
            saveAutomaticOutcome(
              AUTO_OUTCOME_PREFIX,
              uidResult.uid,
              attemptedAt,
              result
            ).ok;
          setLauncherStatus(
            result.ok
              ? outcomeRecorded
                ? "关系雷达自动更新完成"
                : "关系雷达自动更新完成，但结果记录未保存"
              : outcomeRecorded
                ? "关系雷达自动更新失败"
                : "关系雷达自动更新失败，且结果记录未保存",
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
          // The attempt above is only reached once it is durably recorded, so
          // this outcome always belongs to a real attempt; only its own
          // persistence can fail, and that stays visible without changing the
          // durable scan result.
          const outcomeSaved = saveAutomaticOutcome(
            FOLLOWER_AUTO_OUTCOME_PREFIX,
            uidResult.uid,
            attemptedAt,
            result
          );
          setLauncherStatus(
            result.ok
              ? outcomeSaved.ok
                ? "粉丝快照自动更新完成"
                : "粉丝快照自动更新完成，但结果记录未保存"
              : outcomeSaved.ok
                ? "粉丝快照自动更新失败"
                : "粉丝快照自动更新失败，且结果记录未保存",
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
    markFeedFriendNotesStale();
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
    // The snapshot states only feed the read-only lines below. When one cannot
    // be read, its section says so and the settings (and the appearance
    // control) stay reachable.
    const loaded = loadState(uidResult.uid);
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
        "仅在打开微博网页时检查。",
        "wfr-muted"
      )
    );
    if (!loaded.ok) {
      body.append(
        createElement("p", "关系雷达本地数据无法读取。", "wfr-error")
      );
    } else if (loaded.state.latestSnapshot === null) {
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
      "上次成功更新",
      !loaded.ok
        ? "无法读取"
        : loaded.state.latestSnapshot === null
          ? "—"
          : formatTime(loaded.state.latestSnapshot.capturedAt)
    );
    addLine(
      body,
      "上次自动尝试",
      lastAttempt.value === null ? "—" : formatTime(lastAttempt.value)
    );
    addLine(
      body,
      "上次自动结果",
      describeAutomaticOutcomeForAttempt(lastAttempt.value, lastOutcome.value)
    );

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
        "仅在打开微博网页时检查。",
        "wfr-muted"
      )
    );
    if (!followerState.ok) {
      body.append(
        createElement("p", "粉丝快照本地状态无法读取。", "wfr-error")
      );
    } else if (followerState.state.latestSnapshot === null) {
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
      "上次成功更新",
      !followerState.ok
        ? "无法读取"
        : followerState.state.latestSnapshot === null
          ? "—"
          : formatTime(followerState.state.latestSnapshot.capturedAt)
    );
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
      describeAutomaticOutcomeForAttempt(
        followerLastAttempt.value,
        followerLastOutcome.value
      )
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
        "仅影响 Toolkit 自己的界面。",
        "wfr-muted"
      )
    );
  }
