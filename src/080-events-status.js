
  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  // Minute precision for compact headers; the stored timestamp is untouched.
  function formatMinute(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const pad = (part) => String(part).padStart(2, "0");
    return (
      `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ` +
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

  function matchesEventQuery(event, query) {
    const needle = String(query).trim().toLowerCase();
    if (needle === "") return true;
    return (
      event.subjectUid.includes(needle) ||
      event.displayName.toLowerCase().includes(needle)
    );
  }

  function filterEvents(events, query) {
    return events.filter((event) => matchesEventQuery(event, query));
  }

  function renderEvents(ownerUid, state, notice) {
    const body = showPanel("关系事件", true);
    if (notice) body.append(createElement("p", notice, "wfr-success"));
    // Opening the list only reflects read state; it never changes it.
    const unread = countUnreadEvents(state.events);
    showUnreadBadge(unread);
    addLine(body, "事件总数", state.events.length);
    addLine(body, "未读", unread);

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
        renderEvents(ownerUid, saved.state, "全部事件已标为已读。");
      });
      body.append(markButton);
    }

    if (state.events.length === 0) {
      body.append(createElement("p", "暂无事件", "wfr-muted"));
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
        "CSV / Markdown 为已观察事件的导出，恢复数据请使用 JSON 备份。",
        "wfr-muted"
      )
    );

    const search = createElement("input", null, "wfr-search");
    search.type = "search";
    search.placeholder = "搜索昵称或 UID";
    search.setAttribute("aria-label", "搜索昵称或 UID");
    body.append(search);

    const list = createElement("div", null, "wfr-event-list");
    body.append(list);

    const newestFirst = sortEventsNewestFirst(state.events);
    function renderList(query) {
      while (list.childNodes.length > 0) list.removeChild(list.childNodes[0]);
      const matching = filterEvents(newestFirst, query);
      if (matching.length === 0) {
        list.append(createElement("p", "没有匹配的事件", "wfr-muted"));
        return;
      }
      for (const event of matching) {
        list.append(buildEventCard(ownerUid, state, event));
      }
    }
    search.addEventListener("input", () => renderList(search.value || ""));
    renderList("");
  }

  function buildEventCard(ownerUid, state, event) {
    const item = createElement("article", null, "wfr-event");
    item.append(
      createElement(
        "h3",
        `${event.read ? "已读" : "未读"} · ${EVENT_LABELS[event.type] || event.type}`
      )
    );
    addLine(item, "时间", formatTime(event.detectedAt));
    addLine(item, "名称", event.displayName);
    if (event.type === EVENT.SCREEN_NAME_CHANGED) {
      addLine(item, "变化", describeEvent(event));
    }
    const detailButton = createElement("button", "详情", "wfr-button");
    detailButton.type = "button";
    detailButton.addEventListener("click", () =>
      showEventDetail(ownerUid, state, event)
    );
    item.append(detailButton);
    return item;
  }

  function showEventDetail(ownerUid, state, event) {
    const body = showPanel("事件详情", () => renderEvents(ownerUid, state, null));
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
    addLine(
      body,
      "该 UID 的已存事件",
      eventsForSubject(state.events, event.subjectUid).length
    );

    if (event.type === EVENT.VISIBLE_FOLLOWING_DISAPPEARED) {
      body.append(
        createElement(
          "p",
          "本工具只能记录该账号从你的可见关注列表消失，无法判断消失的原因。",
          "wfr-muted"
        )
      );
    }

    const timelineButton = createElement(
      "button",
      "查看关系时间线",
      "wfr-button wfr-primary"
    );
    timelineButton.type = "button";
    timelineButton.addEventListener("click", () =>
      showTimeline(ownerUid, state, event.subjectUid)
    );
    body.append(timelineButton);
  }

  function showTimeline(ownerUid, state, subjectUid) {
    const history = eventsForSubject(state.events, subjectUid);
    const body = showPanel(
      `${bestDisplayName(state, subjectUid)} · 关系时间线`,
      () => renderEvents(ownerUid, state, null)
    );
    addLine(body, "UID", subjectUid);
    addLine(body, "历史事件", history.length);
    body.append(
      createElement(
        "p",
        "以下仅为 Weibo Toolkit 实际观察并保存的事件，不是微博上的完整真实关系历史。",
        "wfr-muted"
      )
    );

    if (history.length === 0) {
      body.append(createElement("p", "暂无事件", "wfr-muted"));
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
      addLine(body, "API可见关注", snapshot.visibleCount);
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
