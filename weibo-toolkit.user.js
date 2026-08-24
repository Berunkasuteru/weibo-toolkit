// ==UserScript==
// @name         Weibo Toolkit - Friend Radar
// @namespace    local.weibo-toolkit
// @version      0.7.0
// @description  Local Friend Radar and current-conversation PM Markdown export.
// @match        https://weibo.com/*
// @match        https://api.weibo.com/chat*
// @license      MPL-2.0
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  if (isPrivateMessageSurface()) {
    installPrivateMessageExportModule();
    return;
  }

  function isPrivateMessageSurface() {
    return (
      typeof location !== "undefined" &&
      location.origin === "https://api.weibo.com" &&
      typeof location.pathname === "string" &&
      location.pathname.startsWith("/chat")
    );
  }

  function normalizePrivateMessageId(value) {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    }
    if (typeof value === "string") {
      const candidate = value.trim();
      return /^[1-9]\d*$/.test(candidate) ? candidate : null;
    }
    return null;
  }

  function comparePrivateMessageIds(left, right) {
    return left.length === right.length
      ? left.localeCompare(right)
      : left.length - right.length;
  }

  function decrementPrivateMessageId(value) {
    try {
      const result = BigInt(value) - 1n;
      return result > 0n ? result.toString() : null;
    } catch (_) {
      return null;
    }
  }

  function registerPrivateMessageCursor(seenCursors, cursor) {
    if (seenCursors.has(cursor)) throw new Error("REPEATED_CURSOR");
    seenCursors.add(cursor);
  }

  function privateMessageParticipantChanged(expectedUid, currentUid) {
    const expected = normalizePrivateMessageId(expectedUid);
    const current = normalizePrivateMessageId(currentUid);
    return !expected || !current || expected !== current;
  }

  function privateMessageLongRunBoundary(
    successfulPages,
    restInterval = 100,
    emergencyFuse = 5000
  ) {
    if (
      !Number.isSafeInteger(successfulPages) ||
      successfulPages <= 0
    ) {
      return null;
    }
    if (successfulPages >= emergencyFuse) return "SAFETY_FUSE";
    if (successfulPages % restInterval === 0) return "AUTO_REST";
    return null;
  }

  function privateMessageSafetyFuseTermination(kind, action) {
    if (action === "cancel") return "CANCELLED";
    if (action === "export" && kind === "SAFETY_FUSE") return "SAFETY_FUSE";
    return "INVALID";
  }

  function classifyPrivateMessageSender(senderId, ownerUid, participantUid) {
    const sender = normalizePrivateMessageId(senderId);
    if (!sender) return null;
    if (sender === ownerUid) return "A";
    if (sender === participantUid) return "B";
    return null;
  }

  function normalizePrivateMessageText(value) {
    if (typeof value !== "string" || value.length === 0) return "";
    const template = document.createElement("template");
    template.innerHTML = value.replace(/<br\s*\/?>/gi, "\n");
    return (template.content.textContent || "").replace(/\r\n?/g, "\n");
  }

  function escapePrivateMessageLineField(value) {
    let escaped = "";
    for (const character of String(value).replace(/\r\n?/g, "\n")) {
      const code = character.codePointAt(0);
      if (character === "\\") escaped += "\\\\";
      else if (character === "\t") escaped += "\\t";
      else if (character === "\n") escaped += "\\n";
      else if (code < 0x20 || code === 0x7f) {
        escaped += `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`;
      } else escaped += character;
    }
    return escaped;
  }

  function safePrivateMessageTypeCode(value) {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      return value.trim();
    }
    return "未知";
  }

  function privateMessageCompactMarkers(message) {
    const markers = [];
    if (Array.isArray(message.pic_infos) && message.pic_infos.length > 0) {
      markers.push(`I${message.pic_infos.length}`);
    }
    if (Array.isArray(message.url_objects) && message.url_objects.length > 0) {
      markers.push("L");
    }
    if (
      Array.isArray(message.additional_messages) &&
      message.additional_messages.length > 0
    ) {
      markers.push("X:add");
    }
    if (
      Object.prototype.hasOwnProperty.call(message, "recall_status") &&
      message.recall_status !== null &&
      String(message.recall_status) !== "0"
    ) {
      markers.push("X:recall");
    }

    const dmType = safePrivateMessageTypeCode(message.dm_type);
    const subType = safePrivateMessageTypeCode(message.sub_type);
    const mediaType = safePrivateMessageTypeCode(message.media_type);
    if (dmType !== "1") {
      markers.push(`X:dm=${dmType}`);
    }
    if (subType !== "0") {
      markers.push(`X:sub=${subType}`);
    }
    if (!["0", "1"].includes(mediaType)) {
      markers.push(`X:media=${mediaType}`);
    } else if (mediaType === "1" && !markers.some((marker) => /^I\d+$/.test(marker))) {
      markers.push("X:media=1");
    }
    return [...new Set(markers)];
  }

  function parsePrivateMessageTimestamp(value) {
    if (
      !(
        (typeof value === "string" && value.trim()) ||
        (typeof value === "number" && Number.isFinite(value))
      )
    ) {
      return { source: "时间不可用", compact: false };
    }
    const source = String(value).replace(/[\r\n]+/g, " ").trim();
    const months = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
    };
    const weibo = source.match(
      /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+[+-]\d{4}\s+(\d{4})$/
    );
    if (weibo) {
      return {
        source,
        compact: true,
        date: `${weibo[6]}-${months[weibo[1]]}-${weibo[2].padStart(2, "0")}`,
        minute: `${weibo[3]}:${weibo[4]}`,
        second: `${weibo[3]}:${weibo[4]}:${weibo[5]}`,
      };
    }
    const iso = source.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
    );
    if (iso) {
      return {
        source,
        compact: true,
        date: `${iso[1]}-${iso[2]}-${iso[3]}`,
        minute: `${iso[4]}:${iso[5]}`,
        second: `${iso[4]}:${iso[5]}:${iso[6] || "00"}`,
      };
    }
    return { source, compact: false };
  }

  function normalizePrivateMessageRecord(message, ownerUid, participantUid) {
    const direction = classifyPrivateMessageSender(
      message.sender_id,
      ownerUid,
      participantUid
    );
    if (!direction) throw new Error("UNEXPECTED_SENDER");
    const body = normalizePrivateMessageText(message.text);
    const markers = privateMessageCompactMarkers(message);
    return {
      speaker: direction,
      timestamp: parsePrivateMessageTimestamp(message.created_at),
      body,
      markers,
    };
  }

  function privateMessageFilename(exportedAt) {
    const timestamp = exportedAt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .replace(/\.\d{3}Z$/, "");
    return `微博私信_${timestamp}.md`;
  }

  function validatePrivateMessagePage(data, expectedCursor, seenIds) {
    if (!data || typeof data !== "object" || !Array.isArray(data.direct_messages)) {
      throw new Error("UNEXPECTED_SCHEMA");
    }
    const messages = data.direct_messages;
    if (messages.length === 0) {
      return { messages, nextCursor: null, naturalEnd: true };
    }
    const ids = [];
    const withinPage = new Set();
    for (const message of messages) {
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        throw new Error("UNEXPECTED_SCHEMA");
      }
      const id = normalizePrivateMessageId(message.id);
      const sender = normalizePrivateMessageId(message.sender_id);
      if (!id || !sender) throw new Error("UNEXPECTED_SCHEMA");
      if (
        Object.prototype.hasOwnProperty.call(message, "mid") &&
        !normalizePrivateMessageId(message.mid)
      ) {
        throw new Error("UNEXPECTED_SCHEMA");
      }
      if (withinPage.has(id) || seenIds.has(id)) throw new Error("DUPLICATE_MESSAGE");
      if (expectedCursor !== "0" && comparePrivateMessageIds(id, expectedCursor) > 0) {
        throw new Error("PAGINATION_NOT_OLDER");
      }
      withinPage.add(id);
      ids.push(id);
    }
    for (let index = 1; index < ids.length; index += 1) {
      if (comparePrivateMessageIds(ids[index], ids[index - 1]) >= 0) {
        throw new Error("MESSAGE_ORDER_UNEXPECTED");
      }
    }
    const oldest = ids[ids.length - 1];
    const nextCursor = decrementPrivateMessageId(oldest);
    if (!nextCursor) throw new Error("PAGINATION_CURSOR_INVALID");
    if (
      expectedCursor !== "0" &&
      comparePrivateMessageIds(nextCursor, expectedCursor) >= 0
    ) {
      throw new Error("PAGINATION_NOT_PROGRESSING");
    }
    return { messages, ids, nextCursor, naturalEnd: false };
  }

  function privateMessageAi3TimeToken(record, useSeconds, context) {
    if (!record.timestamp.compact) {
      context.date = null;
      context.hour = null;
      context.minute = null;
      return `@T:${escapePrivateMessageLineField(record.timestamp.source)}`;
    }
    const exactTime = useSeconds
      ? record.timestamp.second
      : record.timestamp.minute;
    const [hour, minute, second] = exactTime.split(":");
    let token;
    if (context.date !== record.timestamp.date) {
      token = `@${record.timestamp.date} ${exactTime}`;
    } else if (context.hour !== hour) {
      token = `@${exactTime}`;
    } else if (context.minute !== minute) {
      token = exactTime.slice(3);
    } else if (useSeconds) {
      token = `:${second}`;
    } else {
      // A second record in the same minute would have made `useSeconds` true
      // for both. Keep this branch explicit rather than relying on that global
      // counting invariant for parseability.
      token = minute;
    }
    context.date = record.timestamp.date;
    context.hour = hour;
    context.minute = minute;
    return token;
  }

  function renderPrivateMessageAi3Record(record, timeToken) {
    const speakerAndFlags = [record.speaker, ...record.markers].join("|");
    return `${timeToken}\t${speakerAndFlags}\t${escapePrivateMessageLineField(record.body)}`;
  }

  function buildPrivateMessageMarkdown(records, termination) {
    const compactDates = records
      .map((record) => record.timestamp)
      .filter((timestamp) => timestamp.compact)
      .map((timestamp) => timestamp.date);
    const allDatesKnown = compactDates.length === records.length;
    const range =
      records.length > 0 && allDatesKnown
        ? `${compactDates[0]}~${compactDates[compactDates.length - 1]}`
        : "未知";
    const minuteCounts = new Map();
    for (const record of records) {
      if (!record.timestamp.compact) continue;
      const key = `${record.timestamp.date}|${record.timestamp.minute}`;
      minuteCounts.set(key, (minuteCounts.get(key) || 0) + 1);
    }
    const blocks = [
      "# 微博私信｜AI分析版",
      "FORMAT=WEIBO_PM_AI_3",
      "P=A,B",
      "IDENTITY_MAPPING=OMITTED",
      "T=@date/time anchor;MM[:SS]=same hour;:SS=same minute",
      "C=I<n>:图片数;L:链接/卡片;X:特殊或未支持消息",
      `N=${records.length}`,
      `RANGE=${range}`,
      `END=${termination}`,
      "SCOPE=仅包含本次导出时微博当前接口可访问并返回的该会话消息；已删除、撤回、不可访问或未被接口返回的内容可能缺失。",
      "",
    ];
    const timeContext = { date: null, hour: null, minute: null };
    for (const record of records) {
      const minuteKey = record.timestamp.compact
        ? `${record.timestamp.date}|${record.timestamp.minute}`
        : "";
      const useSeconds =
        record.timestamp.compact && minuteCounts.get(minuteKey) > 1;
      blocks.push(
        renderPrivateMessageAi3Record(
          record,
          privateMessageAi3TimeToken(record, useSeconds, timeContext)
        )
      );
    }
    return `${blocks.join("\n").trimEnd()}\n`;
  }

  function privateMessageConversationChanged(expectedParticipantUid) {
    const current = privateMessageConversationContext();
    return (
      !current.ok ||
      privateMessageParticipantChanged(
        expectedParticipantUid,
        current.participantUid
      )
    );
  }

  function privateMessageConversationContext() {
    const selected = document.querySelector(".sessionlist.active");
    const ownerUid = normalizePrivateMessageId(
      document.querySelector(".user .left .hidden, .user .hidden")?.textContent || ""
    );
    const participantUid = normalizePrivateMessageId(
      selected?.querySelector(".hidden")?.textContent || ""
    );
    const participantName = selected?.querySelector(".username")?.textContent?.trim() || "";
    const ordinaryAvatar = selected?.querySelector(".avatar.radius-c");
    const messageSurface = document.querySelector(".right-container .message");
    const composer = document.querySelector(".right-container textarea");
    if (
      !selected ||
      !ownerUid ||
      !participantUid ||
      ownerUid === participantUid ||
      !participantName ||
      !ordinaryAvatar ||
      !messageSurface ||
      !composer
    ) {
      return { ok: false, reason: "UNSUPPORTED_CONVERSATION" };
    }
    return {
      ok: true,
      ownerUid,
      participantUid,
      participantName: participantName.replace(/[\r\n]+/g, " ").trim(),
      messageSurface,
    };
  }

  function installPrivateMessageExportModule() {
    const ENDPOINT = "/webim/2/direct_messages/conversation.json";
    const PAGE_SIZE = 100;
    const REQUEST_DELAY_MS = 750;
    const AUTO_REST_PAGES = 100;
    const AUTO_REST_MS = 5000;
    // Final pathological-loop fuse: 5,000 proven 15-message pages is a
    // theoretical 75,000 records, not a supported-history guarantee.
    const MAX_PM_HISTORY_REQUESTS = 5000;
    const SOURCE = "209678993";
    const ROOT_ID = "wfr-pm-export-root";
    let generation = 0;
    let task = null;
    let root = null;
    let scheduled = false;
    let controlParticipantUid = null;

    function setUi(mode, text) {
      if (!root) return;
      const button = root.querySelector("button");
      const status = root.querySelector("span");
      const checkpoint = root.querySelector(".wfr-pm-export-checkpoint");
      if (!button || !status || !checkpoint) return;
      const disabled = mode === "disabled";
      const buttonText = mode === "running" ? "取消" : "导出 Markdown";
      const statusText = text || "";
      if (button.disabled !== disabled) button.disabled = disabled;
      if (button.textContent !== buttonText) button.textContent = buttonText;
      if (button.hidden !== (mode === "checkpoint")) {
        button.hidden = mode === "checkpoint";
      }
      if (checkpoint.hidden !== (mode !== "checkpoint")) {
        checkpoint.hidden = mode !== "checkpoint";
      }
      if (status.textContent !== statusText) status.textContent = statusText;
      if (root.dataset.mode !== mode) root.dataset.mode = mode;
    }

    // The File System Access API lives on the page realm. Userscript sandboxes do
    // not always mirror it, so the page window is preferred and the sandbox
    // window is the fallback. No new @grant is required: unsafeWindow is already
    // requested by this script.
    function privateMessagePickerWindow() {
      try {
        if (
          typeof unsafeWindow !== "undefined" &&
          unsafeWindow &&
          typeof unsafeWindow.showSaveFilePicker === "function"
        ) {
          return unsafeWindow;
        }
      } catch (_) {
        // A blocked page realm simply means the picker is unavailable.
      }
      try {
        if (
          typeof window !== "undefined" &&
          window &&
          typeof window.showSaveFilePicker === "function"
        ) {
          return window;
        }
      } catch (_) {
        // Same: unavailable, never fatal.
      }
      return null;
    }

    function ensureControl() {
      scheduled = false;
      const context = privateMessageConversationContext();
      const messageSurface = document.querySelector(".right-container .message");
      if (!messageSurface) {
        root = null;
        controlParticipantUid = null;
        return;
      }
      const existing = document.getElementById(ROOT_ID);
      if (existing && existing.parentNode !== messageSurface) existing.remove();
      root = document.getElementById(ROOT_ID);
      if (!root) {
        root = document.createElement("div");
        root.id = ROOT_ID;
        root.className = "wfr-pm-export-root";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wfr-pm-export-button";
        const status = document.createElement("span");
        status.className = "wfr-pm-export-status";
        const checkpoint = document.createElement("div");
        checkpoint.className = "wfr-pm-export-checkpoint";
        checkpoint.hidden = true;
        for (const [action, text] of [
          ["export", "导出当前已读取"],
          ["cancel", "取消"],
        ]) {
          const choice = document.createElement("button");
          choice.type = "button";
          choice.className = "wfr-pm-export-choice";
          choice.dataset.action = action;
          choice.textContent = text;
          choice.addEventListener("click", () => handleCheckpointAction(action));
          checkpoint.append(choice);
        }
        button.addEventListener("click", () => {
          if (task) cancelExport();
          else void beginExport();
        });
        root.append(button, status, checkpoint);
        messageSurface.append(root);
      }
      if (task?.cancelled) setUi("disabled", "正在取消…");
      else if (task?.checkpoint) setUi("checkpoint", task.progress);
      else if (task) setUi("running", task.progress);
      else if (context.ok) {
        const status =
          controlParticipantUid === context.participantUid
            ? root.querySelector("span")?.textContent || ""
            : "";
        controlParticipantUid = context.participantUid;
        setUi("idle", status);
      } else {
        controlParticipantUid = null;
        setUi("disabled", "仅支持当前普通单聊");
      }
    }

    function scheduleEnsure() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(ensureControl);
    }

    function requestUrl(participantUid, cursor) {
      const url = new URL(ENDPOINT, location.origin);
      url.searchParams.set("convert_emoji", "1");
      url.searchParams.set("count", String(PAGE_SIZE));
      url.searchParams.set("max_id", cursor);
      url.searchParams.set("uid", participantUid);
      url.searchParams.set("is_include_group", "0");
      url.searchParams.set("from_contacts", "1");
      url.searchParams.set("source", SOURCE);
      url.searchParams.set("t", String(Date.now()));
      return url;
    }

    async function requestPage(session, cursor, controller) {
      const response = await fetch(requestUrl(session.participantUid, cursor).href, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") || "";
      const body = await response.text();
      if (!response.ok) throw new Error(response.status === 401 ? "LOGIN_REQUIRED" : "HTTP_ERROR");
      if (!/(?:application|text)\/[^;]*json/i.test(contentType)) {
        throw new Error("UNEXPECTED_CONTENT_TYPE");
      }
      let data;
      try {
        data = JSON.parse(body);
      } catch (_) {
        throw new Error("NON_JSON_RESPONSE");
      }
      if (String(data?.error_code || "") === "21301") {
        throw new Error("LOGIN_REQUIRED");
      }
      return data;
    }

    function throwIfStale(session, token) {
      if (!task || task.token !== token || generation !== token) {
        throw new Error("USER_CANCELLED");
      }
      if (privateMessageConversationChanged(session.participantUid)) {
        throw new Error("CONVERSATION_CHANGED");
      }
      const owner = normalizePrivateMessageId(
        document.querySelector(".user .left .hidden, .user .hidden")?.textContent || ""
      );
      if (owner !== session.ownerUid) throw new Error("ACCOUNT_CHANGED");
    }

    function waitForSafetyFuse() {
      return new Promise((resolve) => {
        task.controller = null;
        task.checkpoint = { kind: "SAFETY_FUSE", resolve };
        task.progress = `已读取 ${task.recordsRead} 条 · 达到绝对安全上限`;
        setUi("checkpoint", task.progress);
      });
    }

    function waitForAutomaticRest(session, token, delayMs = AUTO_REST_MS) {
      throwIfStale(session, token);
      const activeTask = task;
      activeTask.controller = null;
      activeTask.resting = true;
      activeTask.progress = `已读取 ${activeTask.recordsRead} 条 · 长对话短暂休息中…`;
      setUi("running", activeTask.progress);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          activeTask.restCancel = null;
          activeTask.resting = false;
          try {
            throwIfStale(session, token);
            activeTask.progress = `正在读取：${activeTask.recordsRead} 条 · ${activeTask.pagesRead} 页`;
            setUi("running", activeTask.progress);
            resolve();
          } catch (error) {
            reject(error);
          }
        }, delayMs);
        activeTask.restCancel = () => {
          clearTimeout(timeout);
          activeTask.restCancel = null;
          activeTask.resting = false;
          reject(new Error("USER_CANCELLED"));
        };
      });
    }

    function handleCheckpointAction(action) {
      const checkpoint = task?.checkpoint;
      if (!checkpoint) return;
      const outcome = privateMessageSafetyFuseTermination(
        checkpoint.kind,
        action
      );
      if (outcome === "INVALID") return;
      task.checkpoint = null;
      if (outcome === "CANCELLED") {
        generation += 1;
        task.cancelled = true;
        setUi("disabled", "正在取消…");
      } else {
        setUi("disabled", "正在生成 Markdown…");
      }
      checkpoint.resolve(outcome);
    }

    async function collectHistory(session, token) {
      const seenIds = new Set();
      const seenCursors = new Set(["0"]);
      const newestToOldest = [];
      let cursor = "0";
      for (
        let requestNumber = 1;
        requestNumber <= MAX_PM_HISTORY_REQUESTS;
        requestNumber += 1
      ) {
        throwIfStale(session, token);
        if (requestNumber > 1) {
          await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS));
          throwIfStale(session, token);
        }
        const controller = new AbortController();
        task.controller = controller;
        const data = await requestPage(session, cursor, controller);
        throwIfStale(session, token);
        const page = validatePrivateMessagePage(data, cursor, seenIds);
        if (page.naturalEnd) {
          return {
            records: newestToOldest.reverse(),
            termination: "NATURAL_END",
          };
        }
        for (let index = 0; index < page.messages.length; index += 1) {
          const message = page.messages[index];
          const id = page.ids[index];
          const record = normalizePrivateMessageRecord(
            message,
            session.ownerUid,
            session.participantUid
          );
          seenIds.add(id);
          newestToOldest.push(record);
        }
        registerPrivateMessageCursor(seenCursors, page.nextCursor);
        cursor = page.nextCursor;
        task.pagesRead = requestNumber;
        task.recordsRead = newestToOldest.length;
        task.progress = `正在读取：${newestToOldest.length} 条 · ${requestNumber} 页`;
        setUi("running", task.progress);
        const boundary = privateMessageLongRunBoundary(
          requestNumber,
          AUTO_REST_PAGES,
          MAX_PM_HISTORY_REQUESTS
        );
        if (boundary === "AUTO_REST") {
          await waitForAutomaticRest(session, token);
          throwIfStale(session, token);
        } else if (boundary === "SAFETY_FUSE") {
          const outcome = await waitForSafetyFuse();
          if (outcome === "CANCELLED") throw new Error("USER_CANCELLED");
          if (outcome === "SAFETY_FUSE") {
            return {
              records: newestToOldest.reverse(),
              termination: outcome,
            };
          }
        }
      }
      throw new Error("REQUEST_CEILING");
    }

    function downloadMarkdown(markdown, filename) {
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
    }

    // Opened only once the Markdown exists, so no writable stream is left open
    // across the whole PM network read.
    async function writeMarkdownToChosenFile(fileHandle, markdown) {
      let writable;
      try {
        writable = await fileHandle.createWritable();
      } catch (_) {
        throw new Error("FILE_WRITE_FAILED");
      }
      try {
        await writable.write(markdown);
        await writable.close();
      } catch (_) {
        try {
          await writable.abort();
        } catch (__) {
          // The write already failed; cleanup errors add nothing.
        }
        throw new Error("FILE_WRITE_FAILED");
      }
    }

    // One action, best available save behavior. Where the browser offers a save
    // picker the user picks the destination first; everywhere else the original
    // browser-download path runs unchanged.
    //
    // Ordering matters: the picker is requested directly from the click, before
    // any network work, because the user activation would otherwise be gone by
    // the time a long conversation finished reading.
    async function beginExport() {
      const picker = privateMessagePickerWindow();
      if (picker === null) {
        await startExport();
        return;
      }
      const context = privateMessageConversationContext();
      if (!context.ok) {
        setUi("disabled", "仅支持当前普通单聊");
        return;
      }
      const startedAt = new Date();
      let fileHandle;
      try {
        fileHandle = await picker.showSaveFilePicker.call(picker, {
          suggestedName: privateMessageFilename(startedAt),
          types: [
            {
              description: "Markdown",
              accept: { "text/markdown": [".md"] },
            },
          ],
        });
      } catch (error) {
        // Cancelling is a normal outcome, not an export failure, and nothing is
        // written to Downloads instead.
        setUi(
          "idle",
          error?.name === "AbortError" ? "已取消" : "未能选择保存位置，未开始导出"
        );
        return;
      }
      await startExport({ fileHandle, startedAt });
    }

    function failureText(code) {
      const messages = {
        LOGIN_REQUIRED: "登录状态异常",
        HTTP_ERROR: "读取失败，未生成文件",
        UNEXPECTED_CONTENT_TYPE: "返回类型发生变化",
        NON_JSON_RESPONSE: "返回内容不是有效 JSON",
        UNEXPECTED_SCHEMA: "返回结构发生变化",
        DUPLICATE_MESSAGE: "检测到重复消息，已停止",
        MESSAGE_ORDER_UNEXPECTED: "消息顺序无法可靠确认",
        PAGINATION_CURSOR_INVALID: "分页游标无效",
        PAGINATION_NOT_PROGRESSING: "分页未继续向更早历史移动",
        PAGINATION_NOT_OLDER: "分页返回了超出历史边界的消息",
        REPEATED_CURSOR: "检测到重复分页状态",
        UNEXPECTED_SENDER: "消息发送者不属于当前单聊双方",
        CONVERSATION_CHANGED: "当前会话已切换，导出已停止",
        ACCOUNT_CHANGED: "登录账号发生变化，导出已停止",
        REQUEST_CEILING: "达到安全请求上限，未生成文件",
        FILE_WRITE_FAILED: "导出已读取完成，但写入所选文件失败",
        USER_CANCELLED: "已取消",
        AbortError: "已取消",
      };
      return messages[code] || "导出失败，未生成文件";
    }

    async function startExport(options = {}) {
      const context = privateMessageConversationContext();
      if (!context.ok) {
        setUi("disabled", "仅支持当前普通单聊");
        return;
      }
      const token = ++generation;
      const session = {
        ownerUid: context.ownerUid,
        participantUid: context.participantUid,
        participantName: context.participantName,
        // A chosen-location run keeps the moment the picker was opened, so the
        // written file matches the name the picker suggested.
        startedAt: options.startedAt || new Date(),
      };
      task = {
        token,
        controller: null,
        checkpoint: null,
        resting: false,
        restCancel: null,
        pagesRead: 0,
        recordsRead: 0,
        progress: "正在读取：0 条 · 0 页",
      };
      setUi("running", task.progress);
      try {
        const result = await collectHistory(session, token);
        throwIfStale(session, token);
        // One formatter, one filename rule: both destinations write exactly the
        // same bytes.
        const markdown = buildPrivateMessageMarkdown(
          result.records,
          result.termination
        );
        const filename = privateMessageFilename(session.startedAt);
        if (options.fileHandle) {
          await writeMarkdownToChosenFile(options.fileHandle, markdown);
        } else {
          downloadMarkdown(markdown, filename);
        }
        const characterCount = [...markdown].length;
        const bytes = new Blob([markdown]).size;
        const size =
          bytes >= 1024 * 1024
            ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.ceil(bytes / 1024)} KB`;
        setUi(
          "idle",
          `${result.termination === "NATURAL_END" ? "已导出" : "已导出当前已读取"} ${result.records.length.toLocaleString()} 条 · ${characterCount.toLocaleString()} 字符 · ${size}`
        );
      } catch (error) {
        const code =
          error?.name === "AbortError"
            ? "AbortError"
            : error?.message || error?.name;
        if (task?.token === token) {
          const visible = privateMessageConversationContext();
          if (visible.ok) controlParticipantUid = visible.participantUid;
          setUi("idle", failureText(code));
        }
      } finally {
        if (task?.token === token) task = null;
        scheduleEnsure();
      }
    }

    function cancelExport() {
      if (!task) return;
      if (task.checkpoint) {
        handleCheckpointAction("cancel");
        return;
      }
      generation += 1;
      task.cancelled = true;
      task.restCancel?.();
      task.controller?.abort();
      setUi("disabled", "正在取消…");
    }

    const style = document.createElement("style");
    style.id = "wfr-pm-export-style";
    style.textContent = `
      .wfr-pm-export-root { position: absolute; top: 10px; right: 58px; z-index: 20; display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; max-width: 520px; font: 12px/1.3 system-ui, sans-serif; }
      .wfr-pm-export-button { padding: 5px 9px; border: 1px solid #d9d9d9; border-radius: 5px; background: #fff; color: #333; cursor: pointer; }
      .wfr-pm-export-button:hover:not(:disabled) { border-color: #ff8200; color: #ff8200; }
      .wfr-pm-export-button:disabled { opacity: .55; cursor: default; }
      .wfr-pm-export-button[hidden] { display: none; }
      .wfr-pm-export-status { max-width: 260px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .wfr-pm-export-checkpoint { display: inline-flex; align-items: center; gap: 5px; }
      .wfr-pm-export-checkpoint[hidden] { display: none; }
      .wfr-pm-export-choice { padding: 4px 7px; border: 1px solid #d9d9d9; border-radius: 5px; background: #fff; color: #333; cursor: pointer; }
    `;
    document.head.append(style);
    ensureControl();
    const observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const ENDPOINT = "/ajax/friendships/friends";
  const REQUEST_DELAY_MS = 750;
  const OBJECT_URL_REVOKE_DELAY_MS = 1000;
  const MAX_REQUESTS = 100;
  const APP_VERSION = "0.7.0";
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
  const FOLLOWER_AUTO_INTERVAL_PREFIX =
    "weiboToolkit.followerSnapshot.autoInterval.v1.";
  const FOLLOWER_AUTO_ATTEMPT_PREFIX =
    "weiboToolkit.followerSnapshot.autoAttempt.v1.";
  const AUTO_STARTUP_DELAY_MS = 5000;
  const AUTO_ATTEMPT_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  const AUTO_STATUS_DURATION_MS = 5000;
  const AUTO_INTERVAL_HOURS = Object.freeze([0, 24, 48, 72, 168, 360]);
  const LAUNCHER_LABEL = "Weibo Toolkit";
  // Toolkit-level appearance preference, deliberately outside the versioned
  // Friend Radar state and outside backup v1.
  const THEME_KEY = "weiboToolkit.theme.v1";
  const DEFAULT_THEME = "system";
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

  function normalizeFollowerOptionalBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }

  function normalizeFollowerOptionalCount(value) {
    return normalizeNonNegativeInteger(value);
  }

  function normalizeFollowerOptionalVerifiedType(value) {
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
      const parsed = Number(value.trim());
      return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
  }

  function normalizeFollowerOptionalDate(value) {
    if (typeof value !== "string") return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function normalizeFollowerOptionalString(value) {
    return typeof value === "string" ? value : null;
  }

  function normalizeFollowerRecord(user) {
    if (!isPlainObject(user)) {
      return { ok: false, reason: "USER_RECORD_NOT_OBJECT" };
    }
    if (!hasOwn(user, "id") || !hasOwn(user, "idstr")) {
      return { ok: false, reason: "MEMBERSHIP_IDENTIFIER_MISSING" };
    }
    const id = normalizeStableUid(user.id);
    const idstr = normalizeStableUid(user.idstr);
    if (id === null || idstr === null || id !== idstr) {
      return { ok: false, reason: "UNUSABLE_OR_CONFLICTING_STABLE_UID" };
    }
    const sourceText =
      isPlainObject(user.origin_source_info) &&
      typeof user.origin_source_info.text === "string"
        ? user.origin_source_info.text
        : null;
    return {
      ok: true,
      record: {
        uid: idstr,
        screenName: normalizeFollowerOptionalString(user.screen_name),
        ownerFollowing: normalizeFollowerOptionalBoolean(user.following),
        followMe: normalizeFollowerOptionalBoolean(user.follow_me),
        followersCount: normalizeFollowerOptionalCount(user.followers_count),
        friendsCount: normalizeFollowerOptionalCount(user.friends_count),
        statusesCount: normalizeFollowerOptionalCount(user.statuses_count),
        createdAt: normalizeFollowerOptionalDate(user.created_at),
        verified: normalizeFollowerOptionalBoolean(user.verified),
        verifiedType: normalizeFollowerOptionalVerifiedType(user.verified_type),
        sourceText,
        optionalMetadataConflict: false,
      },
    };
  }

  const FOLLOWER_OPTIONAL_RECORD_FIELDS = Object.freeze([
    "screenName",
    "ownerFollowing",
    "followMe",
    "followersCount",
    "friendsCount",
    "statusesCount",
    "createdAt",
    "verified",
    "verifiedType",
    "sourceText",
  ]);

  function mergeFollowerRecords(existing, incoming) {
    let conflictObserved = existing.record.optionalMetadataConflict;
    for (const field of FOLLOWER_OPTIONAL_RECORD_FIELDS) {
      if (existing.conflicts.has(field)) continue;
      const before = existing.record[field];
      const after = incoming[field];
      if (before === null) {
        existing.record[field] = after;
      } else if (after !== null && before !== after) {
        existing.record[field] = null;
        existing.conflicts.add(field);
        conflictObserved = true;
      }
    }
    existing.record.optionalMetadataConflict = conflictObserved;
    return conflictObserved;
  }

  function buildFollowerRequestUrl(ownerUid, page) {
    const url = new URL(ENDPOINT, location.origin);
    url.searchParams.set("uid", ownerUid);
    url.searchParams.set("relate", "fans");
    url.searchParams.set("type", "fans");
    url.searchParams.set("fansSortType", "followTime");
    url.searchParams.set("count", String(FOLLOWER_PAGE_SIZE));
    url.searchParams.set("page", String(page));
    return url;
  }

  async function requestFollowerPage(ownerUid, page) {
    const url = buildFollowerRequestUrl(ownerUid, page);
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
      // Classified below.
    }
    if (looksLikeLoginUrl(response.url) || response.status === 401) {
      return { ok: false, failureKind: "LOGIN_REQUIRED", httpStatus: response.status };
    }
    if (!response.ok || response.status !== 200) {
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
      return {
        ok: false,
        failureKind: "NON_JSON_RESPONSE",
        httpStatus: response.status,
      };
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

  function createFollowerTriStateTracker() {
    return { anyTrue: false, observedFalse: 0, unknown: false };
  }

  function observeFollowerTriState(tracker, data, field) {
    if (!hasOwn(data, field) || typeof data[field] !== "boolean") {
      tracker.unknown = true;
      return;
    }
    if (data[field] === true) tracker.anyTrue = true;
    else tracker.observedFalse += 1;
  }

  function finishFollowerTriState(tracker) {
    if (tracker.anyTrue) return FOLLOWER_FILTER_STATE.TRUE;
    if (!tracker.unknown && tracker.observedFalse > 0) {
      return FOLLOWER_FILTER_STATE.FALSE;
    }
    return FOLLOWER_FILTER_STATE.UNKNOWN;
  }

  function createFollowerTotalTracker() {
    return { observed: false, invalid: false, conflict: false, value: null };
  }

  function observeFollowerTotal(tracker, data, field) {
    if (!hasOwn(data, field)) return;
    const value = normalizeNonNegativeInteger(data[field]);
    if (value === null) {
      tracker.invalid = true;
      return;
    }
    if (!tracker.observed) {
      tracker.observed = true;
      tracker.value = value;
    } else if (tracker.value !== value) {
      tracker.conflict = true;
    }
  }

  function finishFollowerTotal(tracker) {
    return tracker.observed && !tracker.invalid && !tracker.conflict
      ? tracker.value
      : null;
  }

  function validateFollowerPageData(data, page) {
    if (!isPlainObject(data)) {
      return { ok: false, reason: "TOP_LEVEL_NOT_OBJECT" };
    }
    if (!hasOwn(data, "ok") || ![1, "1", true].includes(data.ok)) {
      return { ok: false, reason: "API_OK_INDICATOR_NOT_SUCCESS" };
    }
    if (!Array.isArray(data.users)) {
      return { ok: false, reason: "USERS_ARRAY_MISSING_OR_INVALID" };
    }
    const previousCursor = hasOwn(data, "previous_cursor")
      ? normalizeNonNegativeInteger(data.previous_cursor)
      : null;
    const nextCursor = hasOwn(data, "next_cursor")
      ? normalizeNonNegativeInteger(data.next_cursor)
      : null;
    if (previousCursor === null || nextCursor === null) {
      return { ok: false, reason: "INVALID_CURSOR_VALUE" };
    }
    if (page === 1 && previousCursor !== 0) {
      return { ok: false, reason: "FIRST_PAGE_PREVIOUS_CURSOR_NOT_ZERO" };
    }
    const nextPage = hasOwn(data, "next_page")
      ? normalizeNonNegativeInteger(data.next_page)
      : null;
    if (hasOwn(data, "next_page") && nextPage === null) {
      return { ok: false, reason: "INVALID_NEXT_PAGE_VALUE" };
    }
    return { ok: true, previousCursor, nextCursor, nextPage };
  }

  function reportFollowerScanProgress(onProgress, progress) {
    if (typeof onProgress !== "function") return;
    try {
      onProgress(progress);
    } catch (_) {
      // Presentation cannot affect scan integrity.
    }
  }

  async function scanFollowers(ownerUid, onProgress, isCancelled, options = {}) {
    const recordsByUid = new Map();
    const seenPaginationStates = new Set();
    const hasFilteredFans = createFollowerTriStateTracker();
    const sinkStrategy = createFollowerTriStateTracker();
    const totalNumber = createFollowerTotalTracker();
    const displayTotalNumber = createFollowerTotalTracker();
    const followersCount = createFollowerTotalTracker();
    let requestsMade = 0;
    let dataPagesRead = 0;
    let terminalVerificationRequests = 0;
    let rawRecordCount = 0;
    let crossPageDuplicateCount = 0;
    let optionalMetadataConflictObserved = false;
    let previousPageWasNonempty = false;
    const finalRequestPage =
      FOLLOWER_MAX_DATA_PAGES + FOLLOWER_MAX_TERMINAL_VERIFICATION_REQUESTS;

    for (let page = 1; page <= finalRequestPage; page += 1) {
      if (typeof isCancelled === "function" && isCancelled()) {
        return { ok: false, failureKind: "FOLLOWER_SCAN_CANCELLED", requestsMade };
      }
      if (requestsMade > 0) await delay(FOLLOWER_REQUEST_DELAY_MS);
      if (typeof isCancelled === "function" && isCancelled()) {
        return { ok: false, failureKind: "FOLLOWER_SCAN_CANCELLED", requestsMade };
      }
      const ownerBeforeRequest = determineCurrentUid();
      if (!ownerBeforeRequest.ok || ownerBeforeRequest.uid !== ownerUid) {
        return {
          ok: false,
          failureKind: "ACCOUNT_CHANGED_DURING_SCAN",
          requestsMade,
          failedPage: page,
        };
      }

      requestsMade += 1;
      const request = await requestFollowerPage(ownerUid, page);
      if (!request.ok) return { ...request, requestsMade, failedPage: page };
      if (typeof isCancelled === "function" && isCancelled()) {
        return { ok: false, failureKind: "FOLLOWER_SCAN_CANCELLED", requestsMade };
      }
      const validation = validateFollowerPageData(request.data, page);
      if (!validation.ok) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: validation.reason,
          requestsMade,
          failedPage: page,
        };
      }
      const paginationState =
        String(validation.previousCursor) +
        ":" +
        String(validation.nextCursor) +
        ":" +
        String(request.data.users.length);
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

      observeFollowerTriState(
        hasFilteredFans,
        request.data,
        "has_filtered_fans"
      );
      observeFollowerTriState(
        sinkStrategy,
        request.data,
        "use_sink_stragety"
      );
      observeFollowerTotal(totalNumber, request.data, "total_number");
      observeFollowerTotal(
        displayTotalNumber,
        request.data,
        "display_total_number"
      );
      observeFollowerTotal(followersCount, request.data, "followers_count");

      if (page === 1 && options.automatic === true) {
        const visibleEstimate =
          normalizeNonNegativeInteger(request.data.display_total_number) ??
          normalizeNonNegativeInteger(request.data.total_number);
        if (
          visibleEstimate !== null &&
          Math.ceil(visibleEstimate / FOLLOWER_PAGE_SIZE) >
            FOLLOWER_MAX_DATA_PAGES
        ) {
          return {
            ok: false,
            failureKind: "FOLLOWER_AUTO_CAPACITY_EXCEEDED",
            requestsMade,
            estimatedDataPages: Math.ceil(
              visibleEstimate / FOLLOWER_PAGE_SIZE
            ),
          };
        }
      }

      if (request.data.users.length === 0) {
        terminalVerificationRequests += 1;
        if (!previousPageWasNonempty || validation.nextCursor !== 0) {
          return {
            ok: false,
            failureKind: "PAGINATION_FAILURE",
            reason: "UNEXPECTED_TERMINAL_PAGE",
            requestsMade,
            failedPage: page,
          };
        }
        const hasFilteredFansState = finishFollowerTriState(hasFilteredFans);
        const sinkStrategyState = finishFollowerTriState(sinkStrategy);
        const records = [...recordsByUid.values()]
          .map((entry) => entry.record)
          .sort((left, right) => left.uid.localeCompare(right.uid));
        return {
          ok: true,
          requestsMade,
          snapshot: {
            schemaVersion: FOLLOWER_SNAPSHOT_SCHEMA_VERSION,
            ownerUid,
            capturedAt: new Date().toISOString(),
            completion: FOLLOWER_COMPLETION,
            pageSizeRequested: FOLLOWER_PAGE_SIZE,
            dataPagesRead,
            terminalVerificationRequests,
            requestsMade,
            rawRecordCount,
            uniqueRecordCount: records.length,
            crossPageDuplicateCount,
            hasFilteredFansState,
            sinkStrategyState,
            filteredVisibilityObserved:
              hasFilteredFansState === FOLLOWER_FILTER_STATE.TRUE ||
              sinkStrategyState === FOLLOWER_FILTER_STATE.TRUE,
            optionalMetadataConflictObserved,
            totalNumber: finishFollowerTotal(totalNumber),
            displayTotalNumber: finishFollowerTotal(displayTotalNumber),
            followersCount: finishFollowerTotal(followersCount),
            terminalEvidence: {
              page,
              recordCount: 0,
              previousCursor: validation.previousCursor,
              nextCursor: validation.nextCursor,
              nextPage: validation.nextPage,
            },
            records,
          },
        };
      }

      if (page > FOLLOWER_MAX_DATA_PAGES) {
        return {
          ok: false,
          failureKind: "PAGINATION_FAILURE",
          reason: "FOLLOWER_SAFETY_CEILING_REACHED",
          requestsMade,
          failedPage: page,
          visibleRecordsCollected: recordsByUid.size,
        };
      }

      dataPagesRead += 1;
      previousPageWasNonempty = true;
      const pageUids = new Set();
      rawRecordCount += request.data.users.length;
      for (let index = 0; index < request.data.users.length; index += 1) {
        const normalized = normalizeFollowerRecord(request.data.users[index]);
        if (!normalized.ok) {
          return {
            ok: false,
            failureKind: "UNEXPECTED_SCHEMA",
            reason: normalized.reason,
            requestsMade,
            failedPage: page,
            failedRecordIndex: index,
          };
        }
        if (pageUids.has(normalized.record.uid)) {
          return {
            ok: false,
            failureKind: "PAGINATION_FAILURE",
            reason: "UNEXPECTED_WITHIN_PAGE_DUPLICATE",
            requestsMade,
            failedPage: page,
          };
        }
        pageUids.add(normalized.record.uid);
        const existing = recordsByUid.get(normalized.record.uid);
        if (existing) {
          crossPageDuplicateCount += 1;
          if (mergeFollowerRecords(existing, normalized.record)) {
            optionalMetadataConflictObserved = true;
          }
        } else {
          recordsByUid.set(normalized.record.uid, {
            record: normalized.record,
            conflicts: new Set(),
          });
        }
      }
      reportFollowerScanProgress(onProgress, {
        page,
        requestsMade,
        rawRecordCount,
        uniqueRecordCount: recordsByUid.size,
        crossPageDuplicateCount,
      });
    }

    return {
      ok: false,
      failureKind: "PAGINATION_FAILURE",
      reason: "FOLLOWER_SAFETY_CEILING_REACHED",
      requestsMade,
      visibleRecordsCollected: recordsByUid.size,
    };
  }

  function followerStorageKey(ownerUid) {
    return FOLLOWER_SNAPSHOT_STORAGE_PREFIX + ownerUid;
  }

  function emptyFollowerState(ownerUid) {
    return {
      schemaVersion: FOLLOWER_SNAPSHOT_SCHEMA_VERSION,
      ownerUid,
      latestSnapshot: null,
      events: [],
    };
  }

  function isValidFollowerOptionalValue(value, type) {
    return value === null || typeof value === type;
  }

  function isValidFollowerStoredRecord(record) {
    return Boolean(
      isPlainObject(record) &&
        typeof record.uid === "string" &&
        normalizeStableUid(record.uid) === record.uid &&
        isValidFollowerOptionalValue(record.screenName, "string") &&
        isValidFollowerOptionalValue(record.ownerFollowing, "boolean") &&
        isValidFollowerOptionalValue(record.followMe, "boolean") &&
        (record.followersCount === null ||
          (Number.isSafeInteger(record.followersCount) &&
            record.followersCount >= 0)) &&
        (record.friendsCount === null ||
          (Number.isSafeInteger(record.friendsCount) &&
            record.friendsCount >= 0)) &&
        (record.statusesCount === null ||
          (Number.isSafeInteger(record.statusesCount) &&
            record.statusesCount >= 0)) &&
        (record.createdAt === null ||
          (typeof record.createdAt === "string" &&
            Number.isFinite(Date.parse(record.createdAt)))) &&
        isValidFollowerOptionalValue(record.verified, "boolean") &&
        (record.verifiedType === null ||
          Number.isSafeInteger(record.verifiedType)) &&
        isValidFollowerOptionalValue(record.sourceText, "string") &&
        typeof record.optionalMetadataConflict === "boolean"
    );
  }

  function isValidFollowerFilterState(value) {
    return Object.values(FOLLOWER_FILTER_STATE).includes(value);
  }

  function isValidFollowerStoredSnapshot(snapshot) {
    if (
      !isPlainObject(snapshot) ||
      snapshot.schemaVersion !== FOLLOWER_SNAPSHOT_SCHEMA_VERSION ||
      typeof snapshot.ownerUid !== "string" ||
      normalizeStableUid(snapshot.ownerUid) !== snapshot.ownerUid ||
      typeof snapshot.capturedAt !== "string" ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) ||
      snapshot.completion !== FOLLOWER_COMPLETION ||
      snapshot.pageSizeRequested !== FOLLOWER_PAGE_SIZE ||
      !Number.isSafeInteger(snapshot.dataPagesRead) ||
      snapshot.dataPagesRead < 1 ||
      snapshot.dataPagesRead > FOLLOWER_MAX_DATA_PAGES ||
      snapshot.terminalVerificationRequests !== 1 ||
      !Number.isSafeInteger(snapshot.requestsMade) ||
      snapshot.requestsMade !==
        snapshot.dataPagesRead + snapshot.terminalVerificationRequests ||
      !Number.isSafeInteger(snapshot.rawRecordCount) ||
      snapshot.rawRecordCount < 1 ||
      !Number.isSafeInteger(snapshot.uniqueRecordCount) ||
      snapshot.uniqueRecordCount < 1 ||
      !Number.isSafeInteger(snapshot.crossPageDuplicateCount) ||
      snapshot.crossPageDuplicateCount < 0 ||
      snapshot.rawRecordCount - snapshot.uniqueRecordCount !==
        snapshot.crossPageDuplicateCount ||
      !isValidFollowerFilterState(snapshot.hasFilteredFansState) ||
      !isValidFollowerFilterState(snapshot.sinkStrategyState) ||
      typeof snapshot.filteredVisibilityObserved !== "boolean" ||
      snapshot.filteredVisibilityObserved !==
        (snapshot.hasFilteredFansState === FOLLOWER_FILTER_STATE.TRUE ||
          snapshot.sinkStrategyState === FOLLOWER_FILTER_STATE.TRUE) ||
      typeof snapshot.optionalMetadataConflictObserved !== "boolean" ||
      !isPlainObject(snapshot.terminalEvidence) ||
      !Number.isSafeInteger(snapshot.terminalEvidence.page) ||
      snapshot.terminalEvidence.page !== snapshot.dataPagesRead + 1 ||
      snapshot.terminalEvidence.recordCount !== 0 ||
      !Number.isSafeInteger(snapshot.terminalEvidence.previousCursor) ||
      snapshot.terminalEvidence.previousCursor < 0 ||
      snapshot.terminalEvidence.nextCursor !== 0 ||
      !(
        snapshot.terminalEvidence.nextPage === null ||
        (Number.isSafeInteger(snapshot.terminalEvidence.nextPage) &&
          snapshot.terminalEvidence.nextPage >= 0)
      ) ||
      !Array.isArray(snapshot.records) ||
      snapshot.records.length !== snapshot.uniqueRecordCount
    ) {
      return false;
    }
    for (const field of ["totalNumber", "displayTotalNumber", "followersCount"]) {
      if (
        snapshot[field] !== null &&
        (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0)
      ) {
        return false;
      }
    }
    const seen = new Set();
    for (const record of snapshot.records) {
      if (!isValidFollowerStoredRecord(record) || seen.has(record.uid)) {
        return false;
      }
      seen.add(record.uid);
    }
    return true;
  }

  function isValidFollowerStoredEvent(event) {
    return Boolean(
      isPlainObject(event) &&
        typeof event.id === "string" &&
        event.id.length > 0 &&
        Object.values(FOLLOWER_EVENT).includes(event.type) &&
        typeof event.uid === "string" &&
        normalizeStableUid(event.uid) === event.uid &&
        typeof event.observedAt === "string" &&
        Number.isFinite(Date.parse(event.observedAt)) &&
        isValidFollowerOptionalValue(event.displayName, "string")
    );
  }

  function isValidFollowerStoredState(state, ownerUid) {
    return Boolean(
      isPlainObject(state) &&
        state.schemaVersion === FOLLOWER_SNAPSHOT_SCHEMA_VERSION &&
        state.ownerUid === ownerUid &&
        (state.latestSnapshot === null ||
          (isValidFollowerStoredSnapshot(state.latestSnapshot) &&
            state.latestSnapshot.ownerUid === ownerUid)) &&
        Array.isArray(state.events) &&
        state.events.every(isValidFollowerStoredEvent)
    );
  }

  function loadFollowerState(ownerUid) {
    try {
      const key = followerStorageKey(ownerUid);
      const raw = GM_getValue(key, null);
      if (raw === null || typeof raw === "undefined") {
        return { ok: true, state: emptyFollowerState(ownerUid), raw: null };
      }
      if (typeof raw !== "string") {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_STATE_NOT_STRING",
        };
      }
      const state = JSON.parse(raw);
      if (!isValidFollowerStoredState(state, ownerUid)) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_STATE_SCHEMA_INVALID",
        };
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

  function persistFollowerState(ownerUid, state, expectedRaw) {
    const key = followerStorageKey(ownerUid);
    const serialized = JSON.stringify(state);
    try {
      const currentRaw = GM_getValue(key, null);
      if (currentRaw !== expectedRaw) {
        return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
      }
      GM_setValue(key, serialized);
      if (GM_getValue(key, null) !== serialized) {
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

  // Cross-tab serialization for the follower state's local read-modify-write
  // transactions. GM_getValue/GM_setValue offer no atomic compare-and-swap, so
  // the check-then-set inside persistFollowerState is an integrity check, not a
  // cross-tab guarantee: this lock is what actually serializes tabs.
  //
  // The lock is owner-scoped, so two accounts never block each other, and it is
  // held only for local storage work. Network scanning, follower-removal POSTs
  // and batch pacing all stay outside it.
  const FOLLOWER_STATE_LOCK_PREFIX = "weibo-toolkit-follower-state-";

  function followerStateLockUnavailable(reason, error) {
    const result = {
      ok: false,
      failureKind: "STATE_LOCK_UNAVAILABLE",
      reason,
    };
    if (error) result.errorName = error.name ? String(error.name) : "Error";
    return result;
  }

  // The transaction body must stay short and purely local. It is awaited while
  // the lock is held, so it must never fetch, wait, or open UI.
  async function withFollowerStateLock(ownerUid, transaction) {
    const lockManager = pageLockManager();
    if (lockManager === null) {
      return followerStateLockUnavailable("LOCK_UNAVAILABLE");
    }
    try {
      return await lockManager.request.call(
        lockManager,
        FOLLOWER_STATE_LOCK_PREFIX + ownerUid,
        { mode: "exclusive" },
        async (lock) => {
          if (lock === null) {
            return followerStateLockUnavailable("LOCK_NOT_ACQUIRED");
          }
          return await transaction();
        }
      );
    } catch (error) {
      return followerStateLockUnavailable("LOCK_REQUEST_FAILED", error);
    }
  }

  function followerRemovalPendingKey(ownerUid) {
    return FOLLOWER_REMOVAL_PENDING_STORAGE_PREFIX + ownerUid;
  }

  function isValidFollowerRemovalPendingEntry(entry) {
    return Boolean(
      isPlainObject(entry) &&
        typeof entry.confirmedAt === "number" &&
        Number.isFinite(entry.confirmedAt)
    );
  }

  function isValidFollowerRemovalPendingState(state, ownerUid) {
    if (
      !isPlainObject(state) ||
      state.schemaVersion !== FOLLOWER_REMOVAL_PENDING_SCHEMA_VERSION ||
      state.ownerUid !== ownerUid ||
      !isPlainObject(state.pending)
    ) {
      return false;
    }
    for (const uid of Object.keys(state.pending)) {
      if (
        normalizeStableUid(uid) !== uid ||
        !isValidFollowerRemovalPendingEntry(state.pending[uid])
      ) {
        return false;
      }
    }
    return true;
  }

  // Unreadable or malformed reconciliation state is treated as "nothing pending".
  // It must never block a removal or a Snapshot: the worst consequence is one
  // ordinary, neutral disappearance event.
  function loadFollowerRemovalPending(ownerUid) {
    try {
      const raw = GM_getValue(followerRemovalPendingKey(ownerUid), null);
      if (raw === null || typeof raw !== "string") return { pending: {}, raw: null };
      const state = JSON.parse(raw);
      if (!isValidFollowerRemovalPendingState(state, ownerUid)) {
        return { pending: {}, raw };
      }
      return { pending: state.pending, raw };
    } catch (_) {
      return { pending: {}, raw: null };
    }
  }

  function saveFollowerRemovalPending(ownerUid, pending) {
    try {
      const key = followerRemovalPendingKey(ownerUid);
      if (Object.keys(pending).length === 0) {
        GM_deleteValue(key);
        return { ok: true };
      }
      GM_setValue(
        key,
        JSON.stringify({
          schemaVersion: FOLLOWER_REMOVAL_PENDING_SCHEMA_VERSION,
          ownerUid,
          pending,
        })
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failureKind: "PERSISTENCE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function prunedFollowerRemovalPending(pending, nowMs) {
    const kept = {};
    for (const uid of Object.keys(pending)) {
      const entry = pending[uid];
      if (nowMs - entry.confirmedAt < FOLLOWER_REMOVAL_PENDING_TTL_MS) {
        kept[uid] = entry;
      }
    }
    return kept;
  }

  // Unlocked helper: the caller must already hold the follower state lock. The
  // read happens here, inside the transaction, so a concurrently recorded UID is
  // merged instead of overwritten.
  function mergeConfirmedFollowerRemoval(ownerUid, canonicalUid, nowMs) {
    const loaded = loadFollowerRemovalPending(ownerUid);
    const pending = prunedFollowerRemovalPending(loaded.pending, nowMs);
    pending[canonicalUid] = { confirmedAt: nowMs };
    return saveFollowerRemovalPending(ownerUid, pending);
  }

  // Called only after a removal response has been fully validated as successful.
  // A failure here is deliberately non-fatal: the Weibo mutation already
  // succeeded, so an unavailable lock only costs the later event suppression,
  // and the disappearance is then reported by ordinary neutral semantics.
  async function recordConfirmedFollowerRemoval(ownerUid, uid, nowMs) {
    const canonicalUid = normalizeStableUid(uid);
    if (canonicalUid === null || canonicalUid !== uid) return { ok: false };
    return await withFollowerStateLock(ownerUid, async () =>
      mergeConfirmedFollowerRemoval(ownerUid, canonicalUid, nowMs)
    );
  }

  function followerFilteringFingerprint(snapshot) {
    if (
      snapshot.hasFilteredFansState === FOLLOWER_FILTER_STATE.UNKNOWN ||
      snapshot.sinkStrategyState === FOLLOWER_FILTER_STATE.UNKNOWN
    ) {
      return null;
    }
    return (
      snapshot.hasFilteredFansState + "/" + snapshot.sinkStrategyState
    );
  }

  function makeFollowerEvent(type, record, observedAt, index) {
    return {
      id:
        observedAt +
        ":" +
        String(index + 1) +
        ":" +
        type +
        ":" +
        record.uid,
      type,
      uid: record.uid,
      observedAt,
      displayName: record.screenName,
    };
  }

  function diffFollowerSnapshots(previousSnapshot, currentSnapshot) {
    const previousFingerprint = followerFilteringFingerprint(previousSnapshot);
    const currentFingerprint = followerFilteringFingerprint(currentSnapshot);
    if (
      previousFingerprint === null ||
      currentFingerprint === null ||
      previousFingerprint !== currentFingerprint
    ) {
      return {
        events: [],
        suppressed: true,
        reason: "FILTERING_FINGERPRINT_CHANGED_OR_UNKNOWN",
      };
    }
    const previous = new Map(
      previousSnapshot.records.map((record) => [record.uid, record])
    );
    const current = new Map(
      currentSnapshot.records.map((record) => [record.uid, record])
    );
    const events = [];
    const added = [...current.keys()]
      .filter((uid) => !previous.has(uid))
      .sort();
    for (const uid of added) {
      events.push(
        makeFollowerEvent(
          FOLLOWER_EVENT.VISIBLE_FOLLOWER_ADDED,
          current.get(uid),
          currentSnapshot.capturedAt,
          events.length
        )
      );
    }
    const disappeared = [...previous.keys()]
      .filter((uid) => !current.has(uid))
      .sort();
    for (const uid of disappeared) {
      events.push(
        makeFollowerEvent(
          FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED,
          previous.get(uid),
          currentSnapshot.capturedAt,
          events.length
        )
      );
    }
    return { events, suppressed: false, reason: null };
  }

  // Reconciliation runs only for a fully validated successful Snapshot.
  //
  // A pending UID that is absent from the new Snapshot is consumed, because the
  // Toolkit already has direct evidence for why it left: it sent the removal for
  // that exact UID and Weibo validated it. Its ordinary disappearance event is
  // dropped and no replacement event is invented.
  //
  // A pending UID still present in the new Snapshot is kept: API membership may
  // simply not be reflected yet, and nothing is fabricated either way.
  //
  // When event generation is globally suppressed (filtering fingerprint changed
  // or unknown), an absent pending UID is still consumed. No ordinary event would
  // have been emitted for it anyway, so keeping the marker would only let it
  // suppress an unrelated future disappearance. The existing fingerprint guard
  // itself is untouched.
  function reconcileFollowerRemovalPending(pending, snapshot, disappearedUids, nowMs) {
    const live = prunedFollowerRemovalPending(pending, nowMs);
    const present = new Set(snapshot.records.map((record) => record.uid));
    const suppressedUids = new Set();
    const remaining = {};
    for (const uid of Object.keys(live)) {
      if (present.has(uid)) {
        remaining[uid] = live[uid];
        continue;
      }
      if (disappearedUids.has(uid)) suppressedUids.add(uid);
    }
    return {
      pending: remaining,
      suppressedUids,
      changed: Object.keys(remaining).length !== Object.keys(pending).length,
    };
  }

  function prepareSuccessfulFollowerUpdate(
    ownerUid,
    previousState,
    snapshot,
    pendingRemovals = {},
    nowMs = Date.now()
  ) {
    if (previousState.ownerUid !== ownerUid || snapshot.ownerUid !== ownerUid) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FOLLOWER_OWNER_UID_MISMATCH",
      };
    }
    const baselineCreated = previousState.latestSnapshot === null;
    const diff = baselineCreated
      ? { events: [], suppressed: false, reason: null }
      : diffFollowerSnapshots(previousState.latestSnapshot, snapshot);
    const disappearedUids = new Set(
      diff.events
        .filter(
          (event) => event.type === FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED
        )
        .map((event) => event.uid)
    );
    const reconciled = reconcileFollowerRemovalPending(
      pendingRemovals,
      snapshot,
      disappearedUids,
      nowMs
    );
    const keptEvents = diff.events.filter(
      (event) => !reconciled.suppressedUids.has(event.uid)
    );
    return {
      ok: true,
      baselineCreated,
      newEvents: keptEvents,
      eventsSuppressed: diff.suppressed,
      eventsSuppressedReason: diff.reason,
      reconciledRemovalUids: [...reconciled.suppressedUids].sort(),
      pendingRemovals: reconciled.pending,
      pendingRemovalsChanged: reconciled.changed,
      state: {
        schemaVersion: FOLLOWER_SNAPSHOT_SCHEMA_VERSION,
        ownerUid,
        latestSnapshot: snapshot,
        events: [...previousState.events, ...keptEvents],
      },
    };
  }

  async function performFollowerUpdate(onProgress, isCancelled, options = {}) {
    const ownerAtStart = determineCurrentUid();
    if (!ownerAtStart.ok) return ownerAtStart;
    const scan = await scanFollowers(
      ownerAtStart.uid,
      onProgress,
      isCancelled,
      options
    );
    if (!scan.ok) return scan;
    const ownerAfterScan = determineCurrentUid();
    if (!ownerAfterScan.ok || ownerAfterScan.uid !== ownerAtStart.uid) {
      return { ok: false, failureKind: "ACCOUNT_CHANGED_DURING_SCAN" };
    }
    // The whole scan is finished before the lock is taken. Everything below is a
    // short local transaction over freshly read state: nothing computed before
    // the lock is written back, so a removal another tab confirmed meanwhile is
    // merged rather than erased.
    const committed = await withFollowerStateLock(
      ownerAtStart.uid,
      async () => {
        const fresh = loadFollowerState(ownerAtStart.uid);
        if (!fresh.ok) return fresh;
        if (fresh.state.latestSnapshot !== null) {
          const storedTime = Date.parse(fresh.state.latestSnapshot.capturedAt);
          const scanTime = Date.parse(scan.snapshot.capturedAt);
          if (!Number.isFinite(storedTime) || storedTime > scanTime) {
            return {
              ok: false,
              failureKind: "STALE_SCAN",
              reason: "FOLLOWER_STALE_SCAN",
            };
          }
        }
        const pendingBefore = loadFollowerRemovalPending(ownerAtStart.uid);
        const prepared = prepareSuccessfulFollowerUpdate(
          ownerAtStart.uid,
          fresh.state,
          scan.snapshot,
          pendingBefore.pending,
          Date.now()
        );
        if (!prepared.ok) return prepared;
        const persisted = persistFollowerState(
          ownerAtStart.uid,
          prepared.state,
          fresh.raw
        );
        if (!persisted.ok) return persisted;
        // Only a persisted successful Snapshot may consume reconciliation state,
        // and it is stored separately from the Snapshot itself.
        if (prepared.pendingRemovalsChanged) {
          saveFollowerRemovalPending(
            ownerAtStart.uid,
            prepared.pendingRemovals
          );
        }
        return { ok: true, prepared };
      }
    );
    if (!committed.ok) return committed;
    const prepared = committed.prepared;
    return {
      ok: true,
      ownerUid: ownerAtStart.uid,
      snapshot: scan.snapshot,
      requestsMade: scan.requestsMade,
      baselineCreated: prepared.baselineCreated,
      newEvents: prepared.newEvents,
      eventsSuppressed: prepared.eventsSuppressed,
      eventsSuppressedReason: prepared.eventsSuppressedReason,
      reconciledRemovalUids: prepared.reconciledRemovalUids,
      totalStoredEvents: prepared.state.events.length,
    };
  }

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

  // Each Toolkit root (the launcher and the open overlay) carries the theme marker
  // itself, so no Weibo-owned node is ever touched.
  function applyThemeToRoot(node) {
    if (!node) return;
    const classNames = String(node.className)
      .split(/\s+/)
      .filter((name) => name.length > 0 && !name.startsWith("wfr-theme-"));
    classNames.push(`wfr-theme-${currentTheme}`);
    node.className = classNames.join(" ");
  }

  function applyTheme() {
    applyThemeToRoot(launcherButton);
    applyThemeToRoot(panelRoot);
  }

  function closePanel() {
    if (panelRoot && panelRoot.parentNode) panelRoot.parentNode.removeChild(panelRoot);
    panelRoot = null;
  }

  function showPanel(title, withBack = false) {
    closePanel();
    const root = createElement("div", null, "wfr-overlay wfr-root");
    applyThemeToRoot(root);
    const panel = createElement("section", null, "wfr-panel");
    const header = createElement("header", null, "wfr-header");
    const heading = createElement("h2", title);
    const closeButton = createElement("button", "关闭", "wfr-button");
    closeButton.type = "button";
    closeButton.addEventListener("click", closePanel);
    const body = createElement("div", null, "wfr-body");
    if (withBack) {
      const backButton = createElement("button", "← 返回", "wfr-button");
      backButton.type = "button";
      backButton.addEventListener(
        "click",
        typeof withBack === "function" ? withBack : showToolkitHome
      );
      header.append(backButton, heading, closeButton);
    } else {
      header.append(heading, closeButton);
    }
    panel.append(header, body);
    root.append(panel);
    document.body.append(root);
    panelRoot = root;
    return body;
  }

  function addLine(body, label, value) {
    const row = createElement("p", null, "wfr-row");
    const strong = createElement("strong", `${label}: `);
    const span = createElement("span", String(value));
    row.append(strong, span);
    body.append(row);
  }

  function failureText(result) {
    if (result.failureKind === "BACKUP_RESTORE_ERROR") {
      const restoreMessages = {
        MALFORMED_JSON: "备份文件不是有效的 JSON。",
        INVALID_TOP_LEVEL: "备份文件结构无效。",
        WRONG_BACKUP_FORMAT: "备份格式不匹配。",
        MISSING_FOLLOWER_STATE: "备份缺少粉丝快照部分，未恢复。",
        INVALID_FOLLOWER_STATE: "备份中的粉丝快照或粉丝变化记录无效，未恢复。",
        FOLLOWER_RESTORE_FAILED_ROLLED_BACK:
          "粉丝快照未能恢复，本次恢复已取消，关系雷达数据已回退到恢复前的状态。",
        RESTORE_STATE_UNCERTAIN:
          "恢复未能完成，且回退未能确认成功。本地数据可能处于不确定状态，请先导出并检查后再继续。",
        RESTORE_CONCURRENT_STATE_CHANGED:
          "恢复未能完整完成；关系雷达数据在恢复过程中已被其他操作更新，因此没有回退这些较新的数据。请先导出并检查当前数据后再重试。",
        UNSUPPORTED_BACKUP_VERSION: "此备份版本不受支持。",
        INVALID_OWNER_UID: "备份账号 UID 无效。",
        OWNER_UID_MISMATCH: "备份不属于当前登录账号，未恢复。",
        INVALID_EXPORTED_AT: "备份导出时间无效。",
        INVALID_STATE: "备份中的关系雷达数据无效或不完整。",
        FILE_READ_ERROR: "无法读取所选备份文件。",
      };
      return restoreMessages[result.reason] || FAILURE_LABELS.BACKUP_RESTORE_ERROR;
    }
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "HARD_REQUEST_CEILING_REACHED"
    ) {
      return "本次扫描达到本工具设定的单次请求上限，未保存扫描结果。";
    }
    const label = FAILURE_LABELS[result.failureKind] || FAILURE_LABELS.UNKNOWN_FAILURE;
    return result.reason ? `${label} (${result.reason})` : label;
  }

  function showFailure(title, result, withBack = true) {
    const body = showPanel(title, withBack);
    body.append(createElement("p", failureText(result), "wfr-error"));
    if (result.failureKind === "BACKUP_EXPORT_ERROR") {
      body.append(
        createElement(
          "p",
          "备份未能完成。关系雷达本地数据未被修改。",
          "wfr-muted"
        )
      );
      addLine(body, "失败阶段", result.backupStage);
      addLine(body, "错误类型", result.errorName);
      if (["CREATE_WRITABLE", "WRITE_FILE", "CLOSE_FILE"].includes(result.backupStage)) {
        body.append(
          createElement(
            "p",
            "目标位置可能存在未完成的备份文件。",
            "wfr-muted"
          )
        );
      }
      return;
    }
    if (result.failureKind === "EVENT_EXPORT_ERROR") {
      body.append(
        createElement(
          "p",
          "导出未能完成。关系雷达本地数据未被修改。",
          "wfr-muted"
        )
      );
      addLine(body, "失败阶段", result.exportStage);
      addLine(body, "错误类型", result.errorName);
      return;
    }
    if (result.failureKind === "CONCURRENT_MODIFICATION") return;
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "HARD_REQUEST_CEILING_REACHED"
    ) {
      addLine(body, "已请求", result.requestsMade);
      addLine(body, "已读取", result.visibleRecordsCollected);
      if (typeof result.reportedTotal === "number") {
        addLine(body, "接口报告总数", result.reportedTotal);
      }
    }
    if (typeof result.failedPage === "number") {
      addLine(body, "停止页", result.failedPage);
    }
    if (
      typeof result.requestsMade === "number" &&
      !(
        result.failureKind === "PAGINATION_FAILURE" &&
        result.reason === "HARD_REQUEST_CEILING_REACHED"
      )
    ) {
      addLine(body, "已发请求", result.requestsMade);
    }
    let stateMessage;
    let stateMessageClass = "wfr-muted";
    if (result.failureKind === "UNKNOWN_FAILURE") {
      stateMessage =
        "更新结果无法完全确认。重试前请先查看“关系雷达状态”。";
      stateMessageClass = "wfr-error";
    } else if (result.failureKind === "PERSISTENCE_ERROR") {
      if (result.rollbackSucceeded === true) {
        stateMessage =
          "保存失败，但上一次本地状态已恢复。";
      } else {
        stateMessage =
          "保存和恢复均未能确认成功。本地状态可能不确定或损坏，在检查或重新保存首次快照前请勿信任。";
        stateMessageClass = "wfr-error";
      }
    } else {
      stateMessage =
        "本次失败发生在保存之前，本地快照和事件记录未被更改。";
    }
    body.append(
      createElement(
        "p",
        stateMessage,
        stateMessageClass
      )
    );
  }

  function countEventTypes(events) {
    const counts = {};
    for (const event of events) counts[event.type] = (counts[event.type] || 0) + 1;
    return counts;
  }

  function showUpdateSuccess(result) {
    const body = showPanel("关系雷达更新", true);
    const message = result.baselineCreated
      ? "首次关注快照已保存，从下次更新开始记录变化。"
      : `更新完成，发现 ${result.newEvents.length} 个新事件。`;
    body.append(createElement("p", message, "wfr-success"));
    addLine(body, "API可见关注", result.snapshot.visibleCount);
    addLine(body, "接口总数", result.snapshot.reportedTotal);
    addLine(
      body,
      "未解析关系差值",
      result.snapshot.unresolvedRelationCount
    );
    addLine(body, "请求数", result.requestsMade);
    addLine(body, "新事件", result.newEvents.length);

    const counts = countEventTypes(result.newEvents);
    for (const type of Object.values(EVENT)) {
      addLine(body, EVENT_LABELS[type], counts[type] || 0);
    }
  }

  const PROGRESS_FIELDS = Object.freeze([
    ["page", "当前页"],
    ["requestsMade", "已请求"],
    ["visibleRecordsCollected", "已读取"],
    ["reportedTotal", "接口报告总数"],
  ]);

  function showScanProgress() {
    const body = showPanel("关系雷达更新");
    body.append(
      createElement("p", "正在读取可见关注，请保持页面打开。")
    );
    const values = new Map();
    for (const [key, label] of PROGRESS_FIELDS) {
      const row = createElement("p", null, "wfr-row");
      const value = createElement("span", "—");
      row.append(createElement("strong", `${label}：`), value);
      values.set(key, value);
      body.append(row);
    }
    return function reportProgress(progress) {
      for (const [key] of PROGRESS_FIELDS) {
        const value = values.get(key);
        const reported = progress[key];
        value.textContent =
          typeof reported === "number" ? String(reported) : "—";
      }
    };
  }

  async function updateNow() {
    if (updateRunning || followerUpdateRunning || followerRemovalInFlight) {
      showFailure("关系雷达更新", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const reportProgress = showScanProgress();
    updateRunning = true;
    let result;
    try {
      result = await performUpdate(reportProgress);
    } catch (error) {
      result = {
        ok: false,
        failureKind: "UNKNOWN_FAILURE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    } finally {
      updateRunning = false;
    }
    refreshUnreadBadge();
    if (result.ok) showUpdateSuccess(result);
    else showFailure("关系雷达更新失败", result);
  }

  function followerFailureText(result) {
    if (result.failureKind === "FOLLOWER_SCAN_CANCELLED") {
      return "读取已取消。";
    }
    if (
      result.failureKind === "PAGINATION_FAILURE" &&
      result.reason === "FOLLOWER_SAFETY_CEILING_REACHED"
    ) {
      return "达到本次安全上限，未更新粉丝快照。";
    }
    const labels = {
      UID_UNAVAILABLE: "无法可靠识别当前登录账号。",
      ACCOUNT_CHANGED_DURING_SCAN: "扫描期间登录账号发生变化。",
      LOGIN_REQUIRED: "登录已失效，请重新登录。",
      HTTP_ERROR: "接口返回 HTTP 错误。",
      CHALLENGE_OR_UNEXPECTED_RESPONSE: "收到验证页面或意外 HTML。",
      NON_JSON_RESPONSE: "接口未返回有效 JSON。",
      UNEXPECTED_CONTENT_TYPE: "接口响应类型异常。",
      UNEXPECTED_SCHEMA: "粉丝接口数据结构异常。",
      PAGINATION_FAILURE: "粉丝分页结果不可信。",
      NETWORK_ERROR: "网络请求失败。",
      STORAGE_ERROR: "粉丝快照本地状态无法读取。",
      PERSISTENCE_ERROR: "粉丝快照保存失败。",
      CONCURRENT_MODIFICATION: "检测到另一个标签页修改了粉丝快照状态。",
      STALE_SCAN: "扫描结果早于当前已保存粉丝快照。",
      UPDATE_ALREADY_RUNNING: "另一个关系扫描正在进行。",
      STATE_LOCK_UNAVAILABLE:
        "暂时无法安全地保存粉丝快照，本次结果未保存，已保留上一次成功的快照。",
      UNKNOWN_FAILURE: "更新结果无法完全确认。",
    };
    const label = labels[result.failureKind] || labels.UNKNOWN_FAILURE;
    return result.reason ? label + " (" + result.reason + ")" : label;
  }

  function showFollowerFailure(result) {
    const cancelled = result.failureKind === "FOLLOWER_SCAN_CANCELLED";
    const body = showPanel(
      cancelled ? "粉丝快照已取消" : "粉丝快照更新失败",
      true
    );
    body.append(
      createElement(
        "p",
        followerFailureText(result),
        cancelled ? "wfr-muted" : "wfr-error"
      )
    );
    if (typeof result.failedPage === "number") {
      addLine(body, "停止页", result.failedPage);
    }
    if (typeof result.requestsMade === "number") {
      addLine(body, "已发请求", result.requestsMade);
    }
    if (
      !cancelled &&
      !["PERSISTENCE_ERROR", "CONCURRENT_MODIFICATION", "UNKNOWN_FAILURE"].includes(
        result.failureKind
      )
    ) {
      body.append(
        createElement(
          "p",
          "读取未完成，已保留上一次成功快照，未生成粉丝变化事件。",
          "wfr-muted"
        )
      );
    }
    if (result.failureKind === "CONCURRENT_MODIFICATION") {
      body.append(
        createElement(
          "p",
          "未覆盖另一个标签页保存的粉丝快照状态。",
          "wfr-muted"
        )
      );
    }
    if (result.failureKind === "UNKNOWN_FAILURE") {
      body.append(
        createElement(
          "p",
          "更新结果无法完全确认，重试前请先查看粉丝变化状态。",
          "wfr-error"
        )
      );
    }
    if (
      result.failureKind === "PERSISTENCE_ERROR" &&
      result.rollbackSucceeded !== true
    ) {
      body.append(
        createElement(
          "p",
          "本地保存结果无法确认，请在重试前查看粉丝变化状态。",
          "wfr-error"
        )
      );
    }
  }

  function appendFollowerVisibilityNote(body, snapshot) {
    if (!snapshot || !snapshot.filteredVisibilityObserved) return;
    body.append(
      createElement(
        "p",
        "微博接口可能过滤部分粉丝；此处仅显示当前API可见结果。",
        "wfr-muted"
      )
    );
  }

  function showFollowerUpdateSuccess(result) {
    const body = showPanel("粉丝快照更新", true);
    if (result.baselineCreated) {
      body.append(
        createElement(
          "p",
          "首次粉丝快照已保存，从下次更新开始记录变化。",
          "wfr-success"
        )
      );
    } else if (result.eventsSuppressed) {
      body.append(
        createElement(
          "p",
          "粉丝快照已更新；因接口过滤状态变化或未知，本次未生成变化事件。",
          "wfr-muted"
        )
      );
    } else {
      const counts = countEventTypes(result.newEvents);
      body.append(createElement("p", "粉丝快照更新完成。", "wfr-success"));
      addLine(
        body,
        "新增可见粉丝",
        counts[FOLLOWER_EVENT.VISIBLE_FOLLOWER_ADDED] || 0
      );
      addLine(
        body,
        "从可见粉丝中消失",
        counts[FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED] || 0
      );
    }
    addLine(body, "API可见粉丝", result.snapshot.uniqueRecordCount);
    addLine(body, "读取记录", result.snapshot.rawRecordCount);
    addLine(body, "跨页重复", result.snapshot.crossPageDuplicateCount);
    addLine(body, "请求数", result.requestsMade);
    appendFollowerVisibilityNote(body, result.snapshot);
  }

  const FOLLOWER_PROGRESS_FIELDS = Object.freeze([
    ["page", "当前页"],
    ["requestsMade", "已请求"],
    ["rawRecordCount", "已读取"],
    ["uniqueRecordCount", "去重后"],
    ["crossPageDuplicateCount", "跨页重复"],
  ]);

  function showFollowerScanProgress() {
    const body = showPanel("粉丝快照更新");
    body.append(
      createElement("p", "正在读取API可见粉丝，请保持页面打开。")
    );
    const values = new Map();
    for (const [key, label] of FOLLOWER_PROGRESS_FIELDS) {
      const row = createElement("p", null, "wfr-row");
      const value = createElement("span", "—");
      row.append(createElement("strong", label + "："), value);
      values.set(key, value);
      body.append(row);
    }
    const cancelButton = createElement("button", "取消", "wfr-button");
    cancelButton.type = "button";
    cancelButton.addEventListener("click", () => {
      followerCancelRequested = true;
      cancelButton.disabled = true;
      cancelButton.textContent = "正在取消…";
    });
    body.append(cancelButton);
    return function reportProgress(progress) {
      for (const [key] of FOLLOWER_PROGRESS_FIELDS) {
        const reported = progress[key];
        values.get(key).textContent =
          typeof reported === "number" ? String(reported) : "—";
      }
    };
  }

  async function updateFollowersNow() {
    if (followerUpdateRunning || updateRunning || followerRemovalInFlight) {
      showFollowerFailure({ failureKind: "UPDATE_ALREADY_RUNNING" });
      return;
    }
    followerCancelRequested = false;
    const reportProgress = showFollowerScanProgress();
    followerUpdateRunning = true;
    let result;
    try {
      result = await performFollowerUpdate(
        reportProgress,
        () => followerCancelRequested
      );
    } catch (error) {
      result = {
        ok: false,
        failureKind: "UNKNOWN_FAILURE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    } finally {
      followerUpdateRunning = false;
      followerCancelRequested = false;
    }
    if (result.ok) showFollowerUpdateSuccess(result);
    else showFollowerFailure(result);
  }

  // Local notification housekeeping only, run inside the follower state lock. The
  // state is read fresh here, so a Snapshot or new events written by another tab
  // are preserved: latestSnapshot and every other baseline field are carried over
  // and only the requested events are dropped.
  async function writeFollowerEventsOnly(ownerUid, nextEvents) {
    return await withFollowerStateLock(ownerUid, async () => {
      const fresh = loadFollowerState(ownerUid);
      if (!fresh.ok) return fresh;
      const next = {
        schemaVersion: fresh.state.schemaVersion,
        ownerUid: fresh.state.ownerUid,
        latestSnapshot: fresh.state.latestSnapshot,
        events: nextEvents(fresh.state.events),
      };
      const persisted = persistFollowerState(ownerUid, next, fresh.raw);
      if (!persisted.ok) return persisted;
      return { ok: true, state: next };
    });
  }

  async function clearFollowerEvent(ownerUid, eventId) {
    return await writeFollowerEventsOnly(ownerUid, (events) =>
      events.filter((event) => event.id !== eventId)
    );
  }

  // Clears exactly the events the user confirmed, identified by the stored event
  // id. Anything that appeared after the confirmation was rendered — including
  // events another tab produced meanwhile — is kept, because the user never saw
  // it and never agreed to discard it.
  async function clearFollowerEvents(ownerUid, eventIds) {
    const targeted = new Set(eventIds);
    return await writeFollowerEventsOnly(ownerUid, (events) =>
      events.filter((event) => !targeted.has(event.id))
    );
  }

  function sortFollowerEventsNewestFirst(events) {
    return [...events].sort(
      (left, right) =>
        right.observedAt.localeCompare(left.observedAt) ||
        right.id.localeCompare(left.id)
    );
  }

  function renderFollowerEvents(ownerUid, state) {
    const body = showPanel("粉丝变化", true);
    const snapshot = state.latestSnapshot;
    addLine(body, "已有快照", snapshot ? "是" : "否");
    if (snapshot) {
      addLine(body, "上次成功更新", formatTime(snapshot.capturedAt));
      addLine(body, "API可见粉丝", snapshot.uniqueRecordCount);
      appendFollowerVisibilityNote(body, snapshot);
    }
    const countRow = createElement("p", null, "wfr-row");
    const countValue = createElement("span", String(state.events.length));
    countRow.append(createElement("strong", "变化事件: "), countValue);
    body.append(countRow);

    let events = state.events;
    const clearAllActions = createElement("div", null, "wfr-actions");
    const clearAllButton = createElement(
      "button",
      "清空变化事件",
      "wfr-button"
    );
    clearAllButton.type = "button";
    clearAllActions.append(clearAllButton);
    const clearAllPanel = createElement("div", null, "wfr-batch-panel");
    const status = createElement("p", "", "wfr-muted");
    const emptyNote = createElement("p", "暂无粉丝变化事件。", "wfr-muted");
    const list = createElement("div", null, "wfr-event-list");
    body.append(clearAllActions, clearAllPanel, status, emptyNote, list);

    function clearNode(node) {
      while (node.childNodes.length > 0) node.removeChild(node.childNodes[0]);
    }

    const renderedCards = new Map();

    // Reconciles the rendered cards with the freshly persisted event list. Cards
    // that survived keep their nodes; events another tab added since this view
    // opened appear instead of being silently dropped from the count.
    function syncList() {
      const desired = sortFollowerEventsNewestFirst(events);
      const desiredIds = new Set(desired.map((event) => event.id));
      for (const [id, node] of [...renderedCards]) {
        if (desiredIds.has(id)) continue;
        if (node.parentNode) node.parentNode.removeChild(node);
        renderedCards.delete(id);
      }
      for (const event of desired) {
        if (renderedCards.has(event.id)) continue;
        const card = buildEventCard(event);
        renderedCards.set(event.id, card);
        list.append(card);
      }
      renderCounts();
    }

    function renderCounts() {
      countValue.textContent = String(events.length);
      const empty = events.length === 0;
      emptyNote.hidden = !empty;
      list.hidden = empty;
      clearAllActions.hidden = empty;
      if (empty) clearNode(clearAllPanel);
    }

    // Local records only: clearing a notification never touches the Weibo
    // relationship, the stored Snapshot, or reconciliation state.
    function applyLocalWrite(result, failureText) {
      if (!result.ok) {
        status.textContent =
          result.failureKind === "STATE_LOCK_UNAVAILABLE"
            ? "变化事件暂时无法安全保存，请稍后重试。"
            : failureText;
        return false;
      }
      events = result.state.events;
      status.textContent = "";
      return true;
    }

    function buildEventCard(event) {
      const item = createElement("article", null, "wfr-event");
      item.append(
        createElement(
          "h3",
          FOLLOWER_EVENT_LABELS[event.type] || event.type
        )
      );
      addLine(item, "时间", formatTime(event.observedAt));
      addLine(item, "账号", event.displayName || event.uid);
      addLine(item, "UID", event.uid);
      if (event.type === FOLLOWER_EVENT.VISIBLE_FOLLOWER_DISAPPEARED) {
        item.append(
          createElement(
            "p",
            "仅表示该账号从API可见粉丝结果中消失，无法判断原因。",
            "wfr-muted"
          )
        );
      }
      const actions = createElement("div", null, "wfr-actions");
      const clearButton = createElement("button", "清除这条", "wfr-button");
      clearButton.type = "button";
      clearButton.addEventListener("click", async () => {
        clearButton.disabled = true;
        const result = await clearFollowerEvent(ownerUid, event.id);
        clearButton.disabled = false;
        if (!applyLocalWrite(result, "未能清除这条记录，本地数据未改变。")) {
          return;
        }
        // Targeted reconciliation: surviving cards keep their nodes and the
        // reading position stays where it is.
        syncList();
      });
      actions.append(clearButton);
      item.append(actions);
      return item;
    }

    clearAllButton.addEventListener("click", () => {
      clearNode(clearAllPanel);
      const confirmation = createElement("div", null, "wfr-removal-confirm");
      confirmation.append(
        createElement(
          "h3",
          "清空全部 " + String(events.length) + " 条粉丝变化事件？"
        ),
        createElement(
          "p",
          "这只会清除 Weibo Toolkit 保存在本地的变化记录，不会修改微博关系或粉丝快照。",
          "wfr-muted"
        )
      );
      const confirmActions = createElement("div", null, "wfr-actions");
      const cancel = createElement("button", "取消", "wfr-button");
      const confirm = createElement("button", "确认清空", "wfr-button");
      cancel.type = "button";
      confirm.type = "button";
      cancel.addEventListener("click", () => clearNode(clearAllPanel));
      // The identities the user is actually confirming, captured while the
      // confirmation is shown. Only these are cleared.
      const confirmedIds = events.map((event) => event.id);
      confirm.addEventListener("click", async () => {
        cancel.disabled = true;
        confirm.disabled = true;
        const result = await clearFollowerEvents(ownerUid, confirmedIds);
        clearNode(clearAllPanel);
        if (!applyLocalWrite(result, "未能清空变化记录，本地数据未改变。")) {
          return;
        }
        syncList();
      });
      confirmActions.append(cancel, confirm);
      confirmation.append(confirmActions);
      clearAllPanel.append(confirmation);
    });

    syncList();
  }

  function viewFollowerEvents() {
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
    renderFollowerEvents(owner.uid, loaded.state);
  }

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
    const followersMax = normalizeHygieneThreshold(raw.followersMax);
    const friendsMax = normalizeHygieneThreshold(raw.friendsMax);
    const createdAfter = normalizeHygieneDate(raw.createdAfter);
    const filters = {
      mode: raw.mode === "ANY" ? "ANY" : "ALL",
      ownerNotFollowing: raw.ownerNotFollowing === true,
      zeroStatuses: raw.zeroStatuses === true,
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
      Number(filters.zeroStatuses) +
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
    if (filters.zeroStatuses && record.statusesCount === 0) {
      reasons.push("API显示公开微博数为 0");
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
    const zeroStatuses = buildHygieneCheckbox("API显示公开微博数为 0");
    const unverified = buildHygieneCheckbox("未认证");
    controls.append(
      ownerNotFollowing.label,
      zeroStatuses.label,
      unverified.label
    );

    const followersMax = buildHygieneValueInput(
      "粉丝数 ≤",
      "number",
      "未启用"
    );
    const friendsMax = buildHygieneValueInput(
      "关注数 ≤",
      "number",
      "未启用"
    );
    const createdAfter = buildHygieneValueInput(
      "注册时间晚于",
      "date"
    );
    controls.append(
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
        zeroStatuses: zeroStatuses.input.checked,
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
      if (filters.zeroStatuses) parts.push("公开微博=0");
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
      zeroStatuses.input,
      unverified.input,
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

  function exportTimestamp(exportedAt) {
    return exportedAt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .replace(/\.\d{3}Z$/, "");
  }

  function backupFilename(ownerUid, exportedAt) {
    return `weibo-toolkit-friend-radar-${ownerUid}-${exportTimestamp(
      exportedAt
    )}.json`;
  }

  function eventExportFilename(ownerUid, exportedAt, extension) {
    return `weibo-toolkit-friend-radar-events-${ownerUid}-${exportTimestamp(
      exportedAt
    )}.${extension}`;
  }

  // followerState is always present in v2: an object reproduces the durable
  // follower state, and an explicit null records that none existed at backup
  // time. A missing field can only come from v1, where the format simply had no
  // concept of follower state.
  function createBackup(ownerUid, state, followerState, exportedAt) {
    if (state.ownerUid !== ownerUid) {
      throw new Error("Backup owner UID mismatch");
    }
    if (followerState !== null && followerState.ownerUid !== ownerUid) {
      throw new Error("Backup follower owner UID mismatch");
    }
    return {
      backupFormat: BACKUP_FORMAT,
      backupVersion: BACKUP_VERSION,
      exportedAt: exportedAt.toISOString(),
      appVersion: APP_VERSION,
      ownerUid,
      state,
      followerState,
    };
  }

  function serializeBackup(backup) {
    return `${JSON.stringify(backup, null, 2)}\n`;
  }

  // CSV and Markdown are human/analysis exports of observed event history.
  // The JSON backup above remains the only recovery format.
  const UTF8_BOM = String.fromCharCode(0xfeff);
  const EVENT_EXPORT_COLUMNS = Object.freeze([
    "检测时间",
    "事件类型",
    "事件说明",
    "UID",
    "记录昵称",
    "变化前",
    "变化后",
    "状态",
  ]);

  const EXPORT_SCOPE_NOTES = Object.freeze([
    "本文件仅包含 Weibo Toolkit 实际观察并保存的关系事件，不是微博上的完整真实关系历史。",
    "关系雷达只读取接口可见的关注列表，不会抓取完整粉丝列表，因此“开始关注你 / 停止关注你”只覆盖它能观察到的账号。",
    "“从你的可见关注列表消失”只表示该账号不再出现在可见关注列表中，本工具无法判断原因。",
  ]);

  function eventExportRow(event) {
    const transition = eventTransition(event);
    return [
      event.detectedAt,
      event.type,
      EVENT_LABELS[event.type] || event.type,
      event.subjectUid,
      event.displayName,
      transition ? transition.previous : "",
      transition ? transition.current : "",
      event.read ? "已读" : "未读",
    ];
  }

  // A stored nickname beginning with =, +, - or @ would be evaluated as a formula
  // by Excel/WPS, so exported cells starting that way are kept as literal text.
  function neutralizeSpreadsheetFormula(text) {
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  }

  function csvField(value) {
    return `"${neutralizeSpreadsheetFormula(String(value)).replace(/"/g, '""')}"`;
  }

  function buildEventCsv(events) {
    const rows = [
      EVENT_EXPORT_COLUMNS,
      ...sortEventsNewestFirst(events).map(eventExportRow),
    ];
    // The BOM stops Excel/WPS from guessing a legacy codepage; CRLF follows RFC 4180.
    const body = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
    return `${UTF8_BOM}${body}\r\n`;
  }

  function markdownCell(value) {
    return String(value)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  }

  function buildEventMarkdown(ownerUid, events, exportedAt) {
    const ordered = sortEventsNewestFirst(events);
    const lines = [
      "# Weibo Toolkit 关系事件导出",
      "",
      `- 账号 UID：${ownerUid}`,
      `- 导出时间：${exportedAt.toISOString()}`,
      `- 已存事件数：${ordered.length}`,
      `- Weibo Toolkit 版本：${APP_VERSION}`,
      "",
      EXPORT_SCOPE_NOTES.map((note) => `> ${note}`).join("\n>\n"),
      "",
      "## 已观察事件（按检测时间从新到旧）",
      "",
    ];
    if (ordered.length === 0) {
      lines.push("暂无已存事件。", "");
      return lines.join("\n");
    }
    lines.push(
      `| ${EVENT_EXPORT_COLUMNS.join(" | ")} |`,
      `| ${EVENT_EXPORT_COLUMNS.map(() => "---").join(" | ")} |`
    );
    for (const event of ordered) {
      lines.push(`| ${eventExportRow(event).map(markdownCell).join(" | ")} |`);
    }
    lines.push("");
    return lines.join("\n");
  }

  const EVENT_EXPORT_FORMATS = Object.freeze({
    csv: {
      label: "CSV",
      extension: "csv",
      mimeType: "text/csv;charset=utf-8",
      build: (ownerUid, events) => buildEventCsv(events),
    },
    markdown: {
      label: "Markdown",
      extension: "md",
      mimeType: "text/markdown;charset=utf-8",
      build: buildEventMarkdown,
    },
  });

  function loadAutoInterval(ownerUid) {
    try {
      const value = GM_getValue(`${AUTO_INTERVAL_PREFIX}${ownerUid}`, 0);
      if (!AUTO_INTERVAL_HOURS.includes(value)) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "AUTO_INTERVAL_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveAutoInterval(ownerUid, value) {
    const key = `${AUTO_INTERVAL_PREFIX}${ownerUid}`;
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

  function loadLastAutomaticAttempt(ownerUid) {
    try {
      const value = GM_getValue(`${AUTO_ATTEMPT_PREFIX}${ownerUid}`, null);
      if (value === null || typeof value === "undefined") {
        return { ok: true, value: null };
      }
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "AUTO_ATTEMPT_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveLastAutomaticAttempt(ownerUid, attemptedAt) {
    const key = `${AUTO_ATTEMPT_PREFIX}${ownerUid}`;
    try {
      GM_setValue(key, attemptedAt);
      if (GM_getValue(key, null) !== attemptedAt) {
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

  function evaluateAutomaticUpdateEligibility(ownerUid, nowMilliseconds) {
    const interval = loadAutoInterval(ownerUid);
    if (!interval.ok) return interval;
    if (interval.value === 0) {
      return { ok: true, eligible: false, reason: "DISABLED" };
    }

    const loaded = loadState(ownerUid);
    if (!loaded.ok) return loaded;
    if (loaded.state.latestSnapshot === null) {
      return { ok: true, eligible: false, reason: "NO_SUCCESSFUL_BASELINE" };
    }
    const successfulAt = Date.parse(loaded.state.latestSnapshot.capturedAt);
    const thresholdMilliseconds = interval.value * 60 * 60 * 1000;
    if (nowMilliseconds - successfulAt < thresholdMilliseconds) {
      return { ok: true, eligible: false, reason: "THRESHOLD_NOT_REACHED" };
    }

    const lastAttempt = loadLastAutomaticAttempt(ownerUid);
    if (!lastAttempt.ok) return lastAttempt;
    if (
      lastAttempt.value !== null &&
      nowMilliseconds - Date.parse(lastAttempt.value) <
        AUTO_ATTEMPT_COOLDOWN_MS
    ) {
      return { ok: true, eligible: false, reason: "ATTEMPT_COOLDOWN" };
    }
    return {
      ok: true,
      eligible: true,
      intervalHours: interval.value,
      lastSuccessfulAt: loaded.state.latestSnapshot.capturedAt,
    };
  }

  function loadFollowerAutoInterval(ownerUid) {
    try {
      const value = GM_getValue(
        FOLLOWER_AUTO_INTERVAL_PREFIX + ownerUid,
        0
      );
      if (!AUTO_INTERVAL_HOURS.includes(value)) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_AUTO_INTERVAL_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveFollowerAutoInterval(ownerUid, value) {
    const key = FOLLOWER_AUTO_INTERVAL_PREFIX + ownerUid;
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

  function loadFollowerLastAutomaticAttempt(ownerUid) {
    try {
      const value = GM_getValue(
        FOLLOWER_AUTO_ATTEMPT_PREFIX + ownerUid,
        null
      );
      if (value === null || typeof value === "undefined") {
        return { ok: true, value: null };
      }
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
        return {
          ok: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_AUTO_ATTEMPT_INVALID",
        };
      }
      return { ok: true, value };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function saveFollowerLastAutomaticAttempt(ownerUid, attemptedAt) {
    const key = FOLLOWER_AUTO_ATTEMPT_PREFIX + ownerUid;
    try {
      GM_setValue(key, attemptedAt);
      if (GM_getValue(key, null) !== attemptedAt) {
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

  function evaluateFollowerAutomaticUpdateEligibility(
    ownerUid,
    nowMilliseconds
  ) {
    const interval = loadFollowerAutoInterval(ownerUid);
    if (!interval.ok) return interval;
    if (interval.value === 0) {
      return { ok: true, eligible: false, reason: "DISABLED" };
    }
    const loaded = loadFollowerState(ownerUid);
    if (!loaded.ok) return loaded;
    if (loaded.state.latestSnapshot !== null) {
      const successfulAt = Date.parse(
        loaded.state.latestSnapshot.capturedAt
      );
      const thresholdMilliseconds = interval.value * 60 * 60 * 1000;
      if (nowMilliseconds - successfulAt < thresholdMilliseconds) {
        return {
          ok: true,
          eligible: false,
          reason: "THRESHOLD_NOT_REACHED",
        };
      }
    }
    const lastAttempt = loadFollowerLastAutomaticAttempt(ownerUid);
    if (!lastAttempt.ok) return lastAttempt;
    if (
      lastAttempt.value !== null &&
      nowMilliseconds - Date.parse(lastAttempt.value) <
        AUTO_ATTEMPT_COOLDOWN_MS
    ) {
      return { ok: true, eligible: false, reason: "ATTEMPT_COOLDOWN" };
    }
    return {
      ok: true,
      eligible: true,
      intervalHours: interval.value,
      lastSuccessfulAt:
        loaded.state.latestSnapshot === null
          ? null
          : loaded.state.latestSnapshot.capturedAt,
    };
  }

  function validateBackupText(text, currentOwnerUid) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch (_) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "MALFORMED_JSON",
      };
    }

    if (!isPlainObject(backup)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_TOP_LEVEL",
      };
    }
    if (backup.backupFormat !== BACKUP_FORMAT) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "WRONG_BACKUP_FORMAT",
      };
    }
    if (!SUPPORTED_BACKUP_VERSIONS.includes(backup.backupVersion)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "UNSUPPORTED_BACKUP_VERSION",
      };
    }
    if (
      typeof backup.ownerUid !== "string" ||
      normalizeStableUid(backup.ownerUid) !== backup.ownerUid
    ) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_OWNER_UID",
      };
    }
    if (backup.ownerUid !== currentOwnerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }
    if (
      hasOwn(backup, "exportedAt") &&
      (typeof backup.exportedAt !== "string" ||
        !Number.isFinite(Date.parse(backup.exportedAt)))
    ) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_EXPORTED_AT",
      };
    }
    if (!isValidStoredState(backup.state, backup.ownerUid)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_STATE",
      };
    }
    // v1 predates follower backup coverage: it says nothing about follower state,
    // so restoring it must leave the current follower state alone.
    let followerState = null;
    let followerCovered = false;
    if (backup.backupVersion >= 2) {
      if (!hasOwn(backup, "followerState")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_FOLLOWER_STATE",
        };
      }
      if (
        backup.followerState !== null &&
        !isValidFollowerStoredState(backup.followerState, backup.ownerUid)
      ) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_FOLLOWER_STATE",
        };
      }
      followerCovered = true;
      followerState = backup.followerState;
    }

    return {
      ok: true,
      backupVersion: backup.backupVersion,
      ownerUid: backup.ownerUid,
      exportedAt: hasOwn(backup, "exportedAt") ? backup.exportedAt : null,
      state: backup.state,
      stateSerialized: JSON.stringify(backup.state),
      followerCovered,
      followerState,
      followerStateSerialized:
        followerState === null ? null : JSON.stringify(followerState),
    };
  }

  function selectBackupFile() {
    return new Promise((resolve, reject) => {
      const input = createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.hidden = true;
      let settled = false;

      function finish(file) {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(file || null);
      }

      input.addEventListener("change", () => {
        finish(input.files && input.files.length > 0 ? input.files[0] : null);
      });
      input.addEventListener("cancel", () => finish(null));
      document.body.append(input);
      try {
        input.click();
      } catch (error) {
        if (input.parentNode) input.parentNode.removeChild(input);
        reject(error);
      }
    });
  }

  // Writes the follower half of a v2 restore. It runs inside the owner-scoped
  // follower state lock, reads the current value there, and writes exactly what
  // the backup represents: the stored state, or nothing at all when the backup
  // explicitly recorded that no durable follower state existed.
  async function restoreFollowerStateFromBackup(ownerUid, followerState) {
    return await withFollowerStateLock(ownerUid, async () => {
      const key = followerStorageKey(ownerUid);
      if (followerState === null) {
        try {
          GM_deleteValue(key);
          if (GM_getValue(key, null) !== null) {
            return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
          }
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            failureKind: "PERSISTENCE_ERROR",
            errorName: error && error.name ? String(error.name) : "Error",
          };
        }
      }
      const fresh = GM_getValue(key, null);
      const expectedRaw = typeof fresh === "string" ? fresh : null;
      return persistFollowerState(ownerUid, followerState, expectedRaw);
    });
  }

  // Two durable module states are replaced, so the write order is fixed: Friend
  // Radar first with its existing compare-and-verify persistence, then the
  // follower state inside its own short lock. Nothing else is held while that
  // lock is taken, and no lock is held while the user is deciding, so no cycle
  // is possible. If the follower half fails, the Friend Radar half is put back.
  async function restoreValidatedBackup(validated, expectedCurrentRaw) {
    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== validated.ownerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }

    // The value previewed to the user is not trusted after the wait: the current
    // state is read again inside the lock and the restore is refused if another
    // tab has legitimately changed it in the meantime.
    const initial = await withFriendRadarStateLock(
      validated.ownerUid,
      async () => {
        const fresh = loadState(validated.ownerUid);
        if (!fresh.ok) return fresh;
        if (fresh.raw !== expectedCurrentRaw) {
          return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
        }
        const persisted = persistState(validated.ownerUid, validated.state);
        if (!persisted.ok) return persisted;
        const reloaded = loadState(validated.ownerUid);
        if (!reloaded.ok) {
          return {
            ok: false,
            failureKind: "PERSISTENCE_ERROR",
            errorName: "RestoreVerificationError",
            rollbackSucceeded: false,
          };
        }
        if (reloaded.raw !== validated.stateSerialized) {
          return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
        }
        return {
          ok: true,
          state: reloaded.state,
          preRestoreRaw: fresh.raw,
          restoredRaw: reloaded.raw,
        };
      }
    );
    if (!initial.ok) return initial;

    // A v1 backup carries no follower information, so the current follower state
    // is deliberately left exactly as it is.
    if (!validated.followerCovered) {
      return { ok: true, state: initial.state, followerRestored: false };
    }

    // The Friend Radar lock is released before the follower lock is taken, so
    // the two module locks are never held at the same time.
    const followerWrite = await restoreFollowerStateFromBackup(
      validated.ownerUid,
      validated.followerState
    );
    if (followerWrite.ok) {
      return { ok: true, state: initial.state, followerRestored: true };
    }

    const rollback = await rollbackFriendRadarRestore(
      validated.ownerUid,
      initial.restoredRaw,
      initial.preRestoreRaw
    );
    return {
      ok: false,
      failureKind: "BACKUP_RESTORE_ERROR",
      reason: rollback.reason,
      rollbackSucceeded: rollback.reason === "FOLLOWER_RESTORE_FAILED_ROLLED_BACK",
      followerFailureKind: followerWrite.failureKind || "UNKNOWN_FAILURE",
    };
  }

  // Undoes this restore's Friend Radar write, and only this restore's write. The
  // whole read/compare/write/verify sequence happens inside one lock callback.
  //
  // If the stored bytes are no longer the ones this restore wrote, another tab
  // has committed something newer and legitimate since; that value is left
  // alone rather than overwritten, and the outcome is reported as such.
  async function rollbackFriendRadarRestore(ownerUid, restoredRaw, preRestoreRaw) {
    const outcome = await withFriendRadarStateLock(ownerUid, async () => {
      const currentRaw = GM_getValue(storageKey(ownerUid), null);
      if (currentRaw !== restoredRaw) {
        return { reason: "RESTORE_CONCURRENT_STATE_CHANGED" };
      }
      return writeFriendRadarRaw(ownerUid, preRestoreRaw)
        ? { reason: "FOLLOWER_RESTORE_FAILED_ROLLED_BACK" }
        : { reason: "RESTORE_STATE_UNCERTAIN" };
    });
    if (outcome && outcome.failureKind === "STATE_LOCK_UNAVAILABLE") {
      return { reason: "RESTORE_STATE_UNCERTAIN" };
    }
    return outcome;
  }

  function snapshotRecordCount(state) {
    return state.latestSnapshot ? state.latestSnapshot.records.length : 0;
  }

  function showRestorePreview(validated, currentLoaded) {
    const body = showPanel("恢复备份", true);
    body.append(
      createElement(
        "p",
        validated.followerCovered
          ? "恢复后，当前账号的关系雷达数据、粉丝快照和粉丝变化记录将被此备份完整替换。"
          : "恢复后，当前账号的关系雷达数据将被此备份完整替换；此备份不包含粉丝快照和粉丝变化记录，它们将保持不变。",
        "wfr-error"
      )
    );
    body.append(
      createElement(
        "p",
        "建议先导出当前数据作为备份。",
        "wfr-muted"
      )
    );
    addLine(body, "备份账号 UID", validated.ownerUid);
    if (validated.exportedAt !== null) {
      addLine(body, "备份导出时间", formatTime(validated.exportedAt));
    }
    addLine(body, "当前事件数", currentLoaded.state.events.length);
    addLine(body, "备份事件数", validated.state.events.length);
    addLine(body, "当前快照记录数", snapshotRecordCount(currentLoaded.state));
    addLine(body, "备份快照记录数", snapshotRecordCount(validated.state));
    if (validated.followerCovered) {
      addLine(
        body,
        "备份中的粉丝变化事件数",
        validated.followerState === null
          ? "无粉丝快照"
          : validated.followerState.events.length
      );
    }

    const actions = createElement("div", null, "wfr-actions");
    const exportButton = createElement("button", "先备份当前数据", "wfr-button");
    const confirmButton = createElement(
      "button",
      "确认完整替换",
      "wfr-button wfr-primary"
    );
    exportButton.type = "button";
    confirmButton.type = "button";
    exportButton.addEventListener("click", () => void exportBackup());
    confirmButton.addEventListener("click", async () => {
      exportButton.disabled = true;
      confirmButton.disabled = true;
      if (updateRunning) {
        showFailure("恢复备份失败", {
          failureKind: "UPDATE_ALREADY_RUNNING",
        });
        return;
      }
      const restored = await restoreValidatedBackup(
        validated,
        currentLoaded.raw
      );
      if (!restored.ok) {
        showFailure("恢复备份失败", restored);
        return;
      }
      showUnreadBadgeForState(restored.state);
      const success = showPanel("备份已恢复", true);
      success.append(createElement("p", "备份已恢复。", "wfr-success"));
      addLine(success, "事件数", restored.state.events.length);
      addLine(success, "快照记录数", snapshotRecordCount(restored.state));
      addLine(
        success,
        "粉丝快照和粉丝变化记录",
        restored.followerRestored ? "已一并恢复" : "未包含在此备份中，保持不变"
      );
    });
    actions.append(exportButton, confirmButton);
    body.append(actions);
  }

  async function restoreBackup() {
    if (updateRunning) {
      showFailure("恢复备份", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("恢复备份", uidResult);
      return;
    }
    const currentLoaded = loadState(uidResult.uid);
    if (!currentLoaded.ok) {
      showFailure("恢复备份", currentLoaded);
      return;
    }

    let file;
    try {
      file = await selectBackupFile();
    } catch (error) {
      showFailure("恢复备份", {
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "FILE_READ_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }
    if (file === null) {
      const cancelled = showPanel("恢复已取消", true);
      cancelled.append(createElement("p", "恢复已取消。", "wfr-muted"));
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      showFailure("恢复备份", {
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "FILE_READ_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }
    const validated = validateBackupText(text, uidResult.uid);
    if (!validated.ok) {
      showFailure("恢复备份", validated);
      return;
    }
    showRestorePreview(validated, currentLoaded);
  }

  function backupExportError(backupStage, error) {
    const tagged = new Error("Backup export failed");
    tagged.name = error && error.name ? String(error.name) : "Error";
    tagged.backupStage = backupStage;
    return tagged;
  }

  // Browser-managed Blob download, shared by the backup and event exports.
  // Failures reuse the export stage names so the failure UI stays consistent.
  function downloadFile(content, filename, mimeType) {
    let blob;
    try {
      blob = new Blob([content], { type: mimeType });
    } catch (error) {
      throw backupExportError("FALLBACK_CREATE_BLOB", error);
    }
    let objectUrl;
    try {
      objectUrl = URL.createObjectURL(blob);
    } catch (error) {
      throw backupExportError("FALLBACK_CREATE_URL", error);
    }
    try {
      const link = createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        if (link.parentNode) link.parentNode.removeChild(link);
        setTimeout(
          () => URL.revokeObjectURL(objectUrl),
          OBJECT_URL_REVOKE_DELAY_MS
        );
      }
    } catch (error) {
      throw backupExportError("FALLBACK_TRIGGER_DOWNLOAD", error);
    }
  }

  async function saveBackup(json, filename) {
    if (
      typeof unsafeWindow !== "undefined" &&
      typeof unsafeWindow.showSaveFilePicker === "function"
    ) {
      let fileHandle;
      try {
        fileHandle = await unsafeWindow.showSaveFilePicker.call(
          unsafeWindow,
          {
            suggestedName: filename,
            types: [
              {
                description: "JSON backup",
                accept: { "application/json": [".json"] },
              },
            ],
          }
        );
      } catch (error) {
        const errorName = error && error.name ? String(error.name) : "Error";
        if (errorName === "AbortError") return { cancelled: true };
        if (errorName !== "NotAllowedError" && errorName !== "SecurityError") {
          throw backupExportError("PICKER_OPEN", error);
        }
        downloadFile(json, filename, BACKUP_MIME);
        return { method: "browser-download", filename };
      }

      let writable;
      try {
        writable = await fileHandle.createWritable();
      } catch (error) {
        throw backupExportError("CREATE_WRITABLE", error);
      }
      try {
        await writable.write(json);
      } catch (error) {
        throw backupExportError("WRITE_FILE", error);
      }
      try {
        await writable.close();
      } catch (error) {
        throw backupExportError("CLOSE_FILE", error);
      }
      return {
        method: "save-picker",
        filename:
          typeof fileHandle.name === "string" && fileHandle.name.length > 0
            ? fileHandle.name
            : filename,
      };
    }

    downloadFile(json, filename, BACKUP_MIME);
    return { method: "browser-download", filename };
  }

  async function exportBackup() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("导出备份", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("导出备份", loaded);
      return;
    }
    // Only the last successfully persisted follower state is exported; an
    // unreadable one fails the export rather than silently backing up "none".
    const followerLoaded = loadFollowerState(uidResult.uid);
    if (!followerLoaded.ok) {
      showFailure("导出备份", followerLoaded);
      return;
    }
    const followerStateForBackup =
      followerLoaded.raw === null ? null : followerLoaded.state;

    const exportedAt = new Date();
    const filename = backupFilename(uidResult.uid, exportedAt);
    let saveResult;
    try {
      const backup = createBackup(
        uidResult.uid,
        loaded.state,
        followerStateForBackup,
        exportedAt
      );
      const json = serializeBackup(backup);
      saveResult = await saveBackup(json, filename);
    } catch (error) {
      showFailure("导出备份", {
        failureKind: "BACKUP_EXPORT_ERROR",
        backupStage: error && error.backupStage ? String(error.backupStage) : "PREPARE_BACKUP",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }

    if (saveResult.cancelled) {
      const body = showPanel("导出已取消", true);
      body.append(createElement("p", "导出已取消", "wfr-muted"));
      return;
    }

    const nativeSave = saveResult.method === "save-picker";
    const body = showPanel(
      nativeSave ? "备份已保存" : "已请求浏览器下载备份",
      true
    );
    if (!nativeSave) {
      body.append(
        createElement(
          "p",
          "备份已交给浏览器下载，保存位置及最终文件名由浏览器下载设置决定。",
          "wfr-success"
        )
      );
    }
    addLine(body, "账号 UID", uidResult.uid);
    addLine(
      body,
      "已有快照",
      loaded.state.latestSnapshot ? "是" : "否"
    );
    addLine(body, "事件数", loaded.state.events.length);
    addLine(
      body,
      "粉丝变化事件数",
      followerStateForBackup === null
        ? "无粉丝快照"
        : followerStateForBackup.events.length
    );
    addLine(body, nativeSave ? "文件名" : "建议文件名", saveResult.filename);
  }

  // Read-only: builds a document from the already loaded state and hands it to the
  // browser download path. Friend Radar storage is never touched.
  function exportEvents(ownerUid, state, format) {
    const spec = EVENT_EXPORT_FORMATS[format];
    const exportedAt = new Date();
    const filename = eventExportFilename(ownerUid, exportedAt, spec.extension);
    const backToEvents = () => renderEvents(ownerUid, state, null);
    try {
      downloadFile(
        spec.build(ownerUid, state.events, exportedAt),
        filename,
        spec.mimeType
      );
    } catch (error) {
      showFailure(
        "导出事件",
        {
          failureKind: "EVENT_EXPORT_ERROR",
          exportStage: error && error.backupStage ? String(error.backupStage) : "PREPARE_EXPORT",
          errorName: error && error.name ? String(error.name) : "Error",
        },
        backToEvents
      );
      return;
    }

    const body = showPanel("已请求浏览器下载事件", backToEvents);
    body.append(
      createElement(
        "p",
        "事件文件已交给浏览器下载，保存位置及最终文件名由浏览器下载设置决定。",
        "wfr-success"
      )
    );
    addLine(body, "格式", spec.label);
    addLine(body, "建议文件名", filename);
    addLine(body, "已导出事件数", state.events.length);
    body.append(
      createElement(
        "p",
        "导出内容仅为 Weibo Toolkit 已观察并保存的事件，本地数据未被修改。",
        "wfr-muted"
      )
    );
  }

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
          try {
            result = await performUpdate(null, () =>
              saveLastAutomaticAttempt(
                uidResult.uid,
                new Date().toISOString()
              )
            );
          } catch (error) {
            result = {
              ok: false,
              failureKind: "UNKNOWN_FAILURE",
              errorName: error && error.name ? String(error.name) : "Error",
            };
          } finally {
            updateRunning = false;
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
          if (
            !result.ok &&
            result.failureKind === "FOLLOWER_AUTO_CAPACITY_EXCEEDED"
          ) {
            setLauncherStatus(
              "粉丝数量超过当前自动更新安全范围，已跳过本次自动更新。",
              AUTO_STATUS_DURATION_MS
            );
          } else {
            setLauncherStatus(
              result.ok
                ? "粉丝快照自动更新完成"
                : "粉丝快照自动更新失败",
              AUTO_STATUS_DURATION_MS
            );
          }
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
      "关系雷达上次自动尝试",
      lastAttempt.value === null ? "—" : formatTime(lastAttempt.value)
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
      "粉丝快照上次自动尝试",
      followerLastAttempt.value === null
        ? "—"
        : formatTime(followerLastAttempt.value)
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
      .wfr-hygiene-control, .wfr-hygiene-check { display: flex; align-items: center; gap: 8px; }
      .wfr-hygiene-input { width: 100%; max-width: 160px; padding: 5px 8px; border: 1px solid var(--wfr-control-border); border-radius: 5px; background: var(--wfr-field-bg); color: var(--wfr-field-text); font: inherit; }
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
      .wfr-module { margin-top: 22px; }
      .wfr-body h3 { margin: 18px 0 6px; font-size: 15px; }
      .wfr-body h3:first-child { margin-top: 0; }
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

  currentTheme = loadTheme();
  installStyles();
  registerMenuCommands();
  installToolkitLauncher();
  setTimeout(
    () => void checkAutomaticUpdatesSequentially(),
    AUTO_STARTUP_DELAY_MS
  );
})();
