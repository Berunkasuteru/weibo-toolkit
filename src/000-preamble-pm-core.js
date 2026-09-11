// ==UserScript==
// @name         Weibo Toolkit - Friend Radar
// @namespace    local.weibo-toolkit
// @version      0.9.3
// @description  Local-first Weibo toolkit for relationship tracking, follower tools, PM export, and optional page enhancements.
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
