
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
