
  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (part) => String(part).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
      )} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
        date.getSeconds()
      )}`
    );
  }

  // Minute precision for compact headers; the stored timestamp is untouched.
  function formatMinute(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (part) => String(part).padStart(2, "0");
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
      )} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )}`;
  }

  function describeEvent(event) {
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      return `${event.previous.screenName} → ${event.current.screenName}`;
    }
    return EVENT_LABELS[event.type] || event.type;
  }

  // Both sides of a mutual-follow transition are only stated for records that are
  // present in the API-visible following list, where "you follow them" is known.
  const MUTUAL_FOLLOW_MEANING = "互相关注";
  const ONE_WAY_FOLLOW_MEANING = "你关注对方，对方未关注你";
  const VISIBLE_PRESENT_MEANING = "在你的可见关注列表中";
  const VISIBLE_ABSENT_MEANING = "不在你的可见关注列表中";

  function eventTransition(event) {
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      return {
        previous: event.previous.screenName,
        current: event.current.screenName,
      };
    }
    if (event.type === EVENT.FOLLOW_ME_GAINED) {
      return { previous: ONE_WAY_FOLLOW_MEANING, current: MUTUAL_FOLLOW_MEANING };
    }
    if (event.type === EVENT.FOLLOW_ME_LOST) {
      return { previous: MUTUAL_FOLLOW_MEANING, current: ONE_WAY_FOLLOW_MEANING };
    }
    if (
      event.type === EVENT.VISIBLE_FOLLOWING_ADDED ||
      event.type === EVENT.VISIBLE_FOLLOWING_DISAPPEARED
    ) {
      const meaning = (visible) =>
        visible ? VISIBLE_PRESENT_MEANING : VISIBLE_ABSENT_MEANING;
      return {
        previous: meaning(event.previous.visible),
        current: meaning(event.current.visible),
      };
    }
    return null;
  }

  function sortEventsNewestFirst(events) {
    return [...events].sort(
      (a, b) =>
        b.detectedAt.localeCompare(a.detectedAt) || b.id.localeCompare(a.id)
    );
  }

  // Identity is the stable UID only: a renamed account keeps one timeline, and two
  // accounts sharing a nickname never merge.
  function eventsForSubject(events, subjectUid) {
    return sortEventsNewestFirst(
      events.filter((event) => event.subjectUid === subjectUid)
    );
  }

  function bestDisplayName(state, subjectUid) {
    const snapshot = state.latestSnapshot;
    if (snapshot) {
      const record = snapshot.records.find((entry) => entry.uid === subjectUid);
      if (record) return record.screenName;
    }
    const history = eventsForSubject(state.events, subjectUid);
    return history.length > 0 ? history[0].displayName : subjectUid;
  }

  function matchesEventQuery(event, query, notesByUid = null) {
    const needle = String(query).trim().toLowerCase();
    if (needle === "") return true;
    if (
      notesByUid !== null &&
      hasOwn(notesByUid, event.subjectUid) &&
      friendNoteMatchesSearchText(notesByUid[event.subjectUid], needle)
    ) {
      return true;
    }
    return (
      event.subjectUid.includes(needle) ||
      event.displayName.toLowerCase().includes(needle) ||
      (event.type === EVENT.SCREEN_NAME_CHANGED &&
        typeof event.previous?.screenName === "string" &&
        event.previous.screenName.toLowerCase().includes(needle))
    );
  }

  function filterEvents(
    events,
    query,
    notesByUid = null,
    typeFilter = "ALL",
    unreadOnly = false
  ) {
    const allowedType =
      typeof typeFilter === "string" && hasOwn(EVENT_LABELS, typeFilter)
        ? typeFilter
        : "ALL";
    return events.filter(
      (event) =>
        (allowedType === "ALL" || event.type === allowedType) &&
        (!unreadOnly || !event.read) &&
        matchesEventQuery(event, query, notesByUid)
    );
  }

  async function persistEventsReadByIds(ownerUid, eventIds) {
    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== ownerUid) {
      return { ok: false, failureKind: "UID_UNAVAILABLE" };
    }
    return withFriendRadarStateLock(ownerUid, async () => {
      const fresh = loadState(ownerUid);
      if (!fresh.ok) return fresh;
      const nextState = markEventsReadByIds(fresh.state, eventIds);
      const written = persistState(ownerUid, nextState);
      if (!written.ok) return written;
      return { ok: true, state: nextState };
    });
  }

  function renderEvents(ownerUid, state, notice, initialQueryOrView = "") {
    const rawView = isPlainObject(initialQueryOrView) ? initialQueryOrView : {};
    const view =
      typeof initialQueryOrView === "string"
        ? {
            query: initialQueryOrView,
            type: "ALL",
            unreadOnly: false,
            shown: FRIEND_NOTES_PAGE_SIZE,
            scrollTop: 0,
          }
        : {
            query: typeof rawView.query === "string" ? rawView.query : "",
            type:
              typeof rawView.type === "string" && hasOwn(EVENT_LABELS, rawView.type)
                ? rawView.type
                : "ALL",
            unreadOnly: rawView.unreadOnly === true,
            shown:
              typeof rawView.shown === "number" &&
              Number.isFinite(rawView.shown) &&
              rawView.shown >= FRIEND_NOTES_PAGE_SIZE
                ? rawView.shown
                : FRIEND_NOTES_PAGE_SIZE,
            scrollTop:
              typeof rawView.scrollTop === "number" &&
              Number.isFinite(rawView.scrollTop)
                ? rawView.scrollTop
                : 0,
          };
    const body = showPanel("关系事件", true);
    if (notice) body.append(createElement("p", notice, "wfr-success"));
    // Opening the list only reflects read state; it never changes it.
    const unread = countUnreadEvents(state.events);
    showUnreadBadge(unread);
    addLine(body, "事件总数", state.events.length);
    addLine(body, "未读", unread);

    let search = null;
    let typeSelect = null;
    let unreadInput = null;
    let shown = 0;
    const captureSavedView = () => ({
      query: String(search ? search.value || "" : view.query),
      type: typeSelect ? typeSelect.value : view.type,
      unreadOnly: unreadInput ? unreadInput.checked : view.unreadOnly,
      shown: Math.max(FRIEND_NOTES_PAGE_SIZE, shown || view.shown),
      scrollTop: Number(body.scrollTop) || 0,
    });

    if (unread > 0) {
      const markButton = createElement("button", "全部标为已读", "wfr-button wfr-primary");
      markButton.type = "button";
      markButton.addEventListener("click", async () => {
        markButton.disabled = true;
        const currentUid = determineCurrentUid();
        if (!currentUid.ok || currentUid.uid !== ownerUid) {
          showFailure("标记失败", {
            failureKind: "UID_UNAVAILABLE",
          });
          return;
        }
        const saved = await withFriendRadarStateLock(ownerUid, async () => {
          const fresh = loadState(ownerUid);
          if (!fresh.ok) return fresh;
          const nextState = markAllEventsRead(fresh.state);
          const written = persistState(ownerUid, nextState);
          if (!written.ok) return written;
          return { ok: true, state: nextState };
        });
        if (!saved.ok) {
          showFailure("标记失败", saved);
          return;
        }
        renderEvents(ownerUid, saved.state, "全部事件已标为已读。", captureSavedView());
      });
      body.append(markButton);
    }

    if (state.events.length === 0) {
      body.append(createElement("p", "暂无事件。", "wfr-muted wfr-empty"));
      return;
    }

    const exportActions = createElement("div", null, "wfr-actions");
    for (const [format, text] of [
      ["csv", "导出 CSV"],
      ["markdown", "导出 Markdown"],
    ]) {
      const button = createElement("button", text, "wfr-button");
      button.type = "button";
      button.addEventListener("click", () => exportEvents(ownerUid, state, format));
      exportActions.append(button);
    }
    body.append(exportActions);
    body.append(
      createElement(
        "p",
        "恢复数据请使用 JSON 备份。",
        "wfr-muted"
      )
    );

    search = createElement("input", null, "wfr-search");
    search.type = "search";
    search.placeholder = "搜索昵称、旧昵称、UID 或友人备注/标签";
    search.setAttribute("aria-label", "搜索昵称、旧昵称、UID 或友人备注/标签");
    search.value = view.query;
    body.append(search);

    const filterRow = createElement("div", null, "wfr-filter-row");
    typeSelect = createElement("select", null, "wfr-select");
    typeSelect.setAttribute("aria-label", "按事件类型筛选");
    for (const [value, label] of [
      ["ALL", "全部事件类型"],
      ...Object.entries(EVENT_LABELS),
    ]) {
      const option = createElement("option", label);
      option.value = value;
      typeSelect.append(option);
    }
    typeSelect.value = view.type;
    const unreadLabel = createElement("label", null, "wfr-hygiene-check");
    unreadInput = createElement("input");
    unreadInput.type = "checkbox";
    unreadInput.checked = view.unreadOnly;
    unreadLabel.append(unreadInput, createElement("span", "仅看未读"));
    filterRow.append(typeSelect, unreadLabel);
    body.append(filterRow);

    const summary = createElement("p", "", "wfr-muted");
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    const list = createElement("div", null, "wfr-event-list");
    const moreActions = createElement("div", null, "wfr-actions");
    const moreButton = createElement("button", "加载更多", "wfr-button");
    moreButton.type = "button";
    moreActions.append(moreButton);
    body.append(summary, list, moreActions);

    const newestFirst = sortEventsNewestFirst(state.events);
    const totalAccounts = new Set(newestFirst.map((event) => event.subjectUid)).size;
    // Read once per render of the page; the cards only need to know whether a
    // note exists. Unreadable notes simply mean no shortcut is offered.
    const notesLoaded = loadFriendNotesState(ownerUid);
    const notedUids = notesLoaded.ok ? notesLoaded.state.notes : null;
    const captureReturnToEvents = () => {
      const savedView = captureSavedView();
      return () => {
        const fresh = loadState(ownerUid);
        renderEvents(ownerUid, fresh.ok ? fresh.state : state, null, savedView);
      };
    };

    let groupList = [];

    function renderMore(batchSize = FRIEND_NOTES_PAGE_SIZE) {
      const next = groupList.slice(shown, shown + batchSize);
      for (const group of next) {
        list.append(
          buildEventCard(
            ownerUid,
            state,
            group,
            notedUids,
            captureReturnToEvents,
            async (cardEventIds) => {
              const savedView = captureSavedView();
              const saved = await persistEventsReadByIds(ownerUid, cardEventIds);
              if (!saved.ok) {
                showFailure("标记失败", saved);
                return;
              }
              renderEvents(ownerUid, saved.state, null, savedView);
            }
          )
        );
      }
      shown += next.length;
      const remaining = groupList.length - shown;
      moreActions.hidden = remaining <= 0;
      moreButton.textContent = `加载更多（还有 ${remaining} 条）`;
    }

    function renderList(initialLimit = FRIEND_NOTES_PAGE_SIZE) {
      clearNode(list);
      shown = 0;
      const matching = filterEvents(
        newestFirst,
        search.value || "",
        notedUids,
        typeSelect.value,
        unreadInput.checked
      );
      // One card per account, placed where its newest matching event falls.
      // The card shows that newest event; the rest are one click away in the
      // account's timeline, so an account that changed often no longer fills
      // the list.
      const groups = new Map();
      for (const event of matching) {
        const group = groups.get(event.subjectUid);
        if (group) group.push(event);
        else groups.set(event.subjectUid, [event]);
      }
      groupList = [...groups.values()];
      summary.textContent =
        matching.length === newestFirst.length
          ? `共 ${totalAccounts} 个账号（${newestFirst.length} 条事件）`
          : `共 ${totalAccounts} 个账号（${newestFirst.length} 条事件），匹配 ${groupList.length} 个账号（${matching.length} 条事件）`;
      if (groupList.length === 0) {
        list.append(createElement("p", "没有匹配的事件。", "wfr-muted wfr-empty"));
      }
      renderMore(initialLimit);
    }

    search.addEventListener("input", () => renderList());
    typeSelect.addEventListener("change", () => renderList());
    unreadInput.addEventListener("change", () => renderList());
    moreButton.addEventListener("click", () => renderMore());
    renderList(view.shown);
    if (view.scrollTop > 0) body.scrollTop = view.scrollTop;
  }

  // group: the matching events of one account, newest first.
  function buildEventCard(
    ownerUid,
    state,
    group,
    notedUids,
    captureReturn,
    onMarkRead
  ) {
    const captureReturnToEvents =
      typeof captureReturn === "function"
        ? captureReturn
        : () => () => renderEvents(ownerUid, state, null);
    const event = group[0];
    const read = group.every((entry) => entry.read);
    const item = createElement(
      "article",
      null,
      read ? "wfr-event" : "wfr-event wfr-event-unread"
    );
    item.append(
      createElement(
        "h3",
        `${read ? "已读" : "未读"} · ${EVENT_LABELS[event.type] || event.type}`
      )
    );
    addLine(item, "时间", formatTime(event.detectedAt));
    addLine(item, "名称", event.displayName);
    addLine(item, "UID", event.subjectUid);
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      addLine(item, "变化", describeEvent(event));
    }
    if (notedUids !== null && hasOwn(notedUids, event.subjectUid)) {
      appendFriendNoteInlineSummary(item, notedUids[event.subjectUid]);
    }
    const actions = createElement("div", null, "wfr-actions");
    const detailButton = createElement("button", "详情", "wfr-button");
    detailButton.type = "button";
    detailButton.addEventListener("click", () =>
      showEventDetail(ownerUid, state, event, captureReturnToEvents())
    );
    actions.append(detailButton);
    if (!read && typeof onMarkRead === "function") {
      const readButton = createElement("button", "标为已读", "wfr-button");
      readButton.type = "button";
      const unreadIds = new Set(
        group.filter((entry) => !entry.read).map((entry) => entry.id)
      );
      readButton.addEventListener("click", async () => {
        readButton.disabled = true;
        await onMarkRead(unreadIds);
      });
      actions.append(readButton);
    }
    // The whole stored history of the account, not just what the search
    // matched: that is what the timeline behind the button shows.
    const historyCount = eventsForSubject(state.events, event.subjectUid).length;
    if (historyCount > 1) {
      const moreButton = createElement(
        "button",
        `关系时间线（${historyCount} 条事件）`,
        "wfr-button"
      );
      moreButton.type = "button";
      moreButton.addEventListener("click", () =>
        showTimeline(ownerUid, state, event.subjectUid, captureReturnToEvents())
      );
      actions.append(moreButton);
    }
    actions.append(createFriendNoteProfileLink(event.subjectUid));
    if (notedUids !== null) {
      const noteButton = createElement(
        "button",
        hasOwn(notedUids, event.subjectUid) ? "友人档案" : "写档案",
        "wfr-button"
      );
      noteButton.type = "button";
      noteButton.addEventListener("click", () =>
        showFriendNoteDetail(ownerUid, event.subjectUid, null, captureReturnToEvents())
      );
      actions.append(noteButton);
    }
    item.append(actions);
    return item;
  }

  function showEventDetail(ownerUid, state, event, onBack) {
    const backToEvents =
      typeof onBack === "function"
        ? onBack
        : () => renderEvents(ownerUid, state, null);
    const body = showPanel("事件详情", backToEvents);
    body.append(
      createElement("h3", EVENT_LABELS[event.type] || event.type)
    );
    addLine(body, "名称", event.displayName);
    addLine(body, "UID", event.subjectUid);
    addLine(body, "检测时间", formatTime(event.detectedAt));
    addLine(body, "状态", event.read ? "已读" : "未读");

    const transition = eventTransition(event);
    if (transition) {
      addLine(body, "变化前", transition.previous);
      addLine(body, "变化后", transition.current);
    }
    const historyCount = eventsForSubject(state.events, event.subjectUid).length;
    addLine(body, "该 UID 的已存事件", historyCount);

    if (event.type === EVENT.VISIBLE_FOLLOWING_DISAPPEARED) {
      body.append(
        createElement(
          "p",
          "无法判断消失的原因。",
          "wfr-muted"
        )
      );
    }

    const actions = createElement("div", null, "wfr-actions");
    const timelineButton = createElement(
      "button",
      `关系时间线（${historyCount} 条事件）`,
      "wfr-button wfr-primary"
    );
    timelineButton.type = "button";
    const reopenDetail = () => {
      const fresh = loadState(ownerUid);
      const latestState = fresh.ok ? fresh.state : state;
      const latestEvent =
        latestState.events.find((entry) => entry.id === event.id) || event;
      showEventDetail(ownerUid, latestState, latestEvent, backToEvents);
    };
    timelineButton.addEventListener("click", () =>
      showTimeline(ownerUid, state, event.subjectUid, reopenDetail)
    );
    actions.append(timelineButton);
    if (!event.read) {
      const readButton = createElement("button", "标为已读", "wfr-button");
      readButton.type = "button";
      readButton.addEventListener("click", async () => {
        readButton.disabled = true;
        const saved = await persistEventsReadByIds(ownerUid, new Set([event.id]));
        if (!saved.ok) {
          showFailure("标记失败", saved);
          return;
        }
        const updated =
          saved.state.events.find((entry) => entry.id === event.id) || {
            ...event,
            read: true,
          };
        showEventDetail(ownerUid, saved.state, updated, backToEvents);
      });
      actions.append(readButton);
    }
    actions.append(createFriendNoteProfileLink(event.subjectUid));
    const notesLoaded = loadFriendNotesState(ownerUid);
    if (notesLoaded.ok) {
      const noteButton = createElement(
        "button",
        hasOwn(notesLoaded.state.notes, event.subjectUid) ? "友人档案" : "写档案",
        "wfr-button"
      );
      noteButton.type = "button";
      noteButton.addEventListener("click", () =>
        showFriendNoteDetail(ownerUid, event.subjectUid, null, reopenDetail)
      );
      actions.append(noteButton);
    }
    body.append(actions);
  }

  function showTimeline(ownerUid, state, subjectUid, onBack) {
    const history = eventsForSubject(state.events, subjectUid);
    const backAction =
      typeof onBack === "function"
        ? onBack
        : () => renderEvents(ownerUid, state, null);
    const body = showPanel(
      `${bestDisplayName(state, subjectUid)} · 关系时间线`,
      backAction
    );
    addLine(body, "UID", subjectUid);
    addLine(body, "历史事件", history.length);
    const actions = createElement("div", null, "wfr-actions wfr-compact-actions");
    actions.append(createFriendNoteProfileLink(subjectUid));
    const notesLoaded = loadFriendNotesState(ownerUid);
    if (notesLoaded.ok) {
      const noteButton = createElement(
        "button",
        hasOwn(notesLoaded.state.notes, subjectUid) ? "友人档案" : "写档案",
        "wfr-button"
      );
      noteButton.type = "button";
      noteButton.addEventListener("click", () =>
        showFriendNoteDetail(ownerUid, subjectUid, null, () =>
          showTimeline(ownerUid, state, subjectUid, backAction)
        )
      );
      actions.append(noteButton);
    }
    body.append(actions);

    if (history.length === 0) {
      body.append(createElement("p", "暂无事件。", "wfr-muted wfr-empty"));
      return;
    }

    const list = createElement("div", null, "wfr-event-list");
    for (const event of history) {
      const item = createElement("article", null, "wfr-event");
      item.append(createElement("h3", formatDate(event.detectedAt)));
      item.append(
        createElement("p", EVENT_LABELS[event.type] || event.type, "wfr-row")
      );
      if (event.type === EVENT.SCREEN_NAME_CHANGED) {
        item.append(createElement("p", describeEvent(event), "wfr-row"));
      }
      list.append(item);
    }
    body.append(list);
  }

  function viewEvents() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("关系事件", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("关系事件", loaded);
      return;
    }
    renderEvents(uidResult.uid, loaded.state, null);
  }

  function viewStatus() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("关系雷达状态", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("关系雷达状态", loaded);
      return;
    }

    const body = showPanel("关系雷达状态", true);
    const snapshot = loaded.state.latestSnapshot;
    const unread = countUnreadEvents(loaded.state.events);
    showUnreadBadge(unread);
    addLine(body, "已有快照", snapshot ? "是" : "否");
    if (snapshot) {
      addLine(body, "上次成功更新", formatTime(snapshot.capturedAt));
      addLine(body, "API 可见关注", snapshot.visibleCount);
      addLine(body, "接口总数", snapshot.reportedTotal);
      addLine(
        body,
        "未解析关系差值",
        snapshot.unresolvedRelationCount
      );
    }
    addLine(body, "事件总数", loaded.state.events.length);
    addLine(body, "未读事件", unread);
  }
