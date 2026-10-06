
  // Friend Notes: what the user wrote about another account, by hand. It is the
  // only durable module whose content Toolkit never observes for itself, so it is
  // kept in its own versioned state and never mixed with Friend Radar or follower
  // facts. Nicknames and relationship history shown beside a note are always
  // derived from those existing states at display time, never copied in here.
  const FRIEND_NOTES_SCHEMA_VERSION = 1;
  const FRIEND_NOTES_STORAGE_PREFIX = "weiboToolkit.friendNotes.v1.";
  const FRIEND_NOTES_LOCK_PREFIX = "weibo-toolkit-friend-notes-state-";
  const SHOW_PROFILE_FRIEND_NOTES_KEY =
    "weiboToolkit.page.showProfileFriendNotes.v1";
  const FRIEND_NOTE_MAX_LENGTH = 1000;
  const FRIEND_NOTE_TAG_MAX_LENGTH = 20;
  const FRIEND_NOTE_MAX_TAGS = 12;
  const FRIEND_NOTES_MAX_PROFILES = 2000;
  const FRIEND_NOTES_PAGE_SIZE = 20;
  const PROFILE_FRIEND_NOTES_ID = "wfr-profile-friend-notes";

  let friendNoteEditorSequence = 0;
  let friendNoteDetailView = null;
  let profileFriendNotesContext = null;
  let profileFriendNotesObserver = null;
  let profileFriendNotesObservedMain = null;
  let profileFriendNotesObservedHost = null;
  let profileFriendNotesDiscoveryTimer = null;
  let profileFriendNotesDiscoveryCount = 0;
  let profileFriendNotesEnsureScheduled = false;

  function friendNotesStorageKey(ownerUid) {
    return FRIEND_NOTES_STORAGE_PREFIX + ownerUid;
  }

  function emptyFriendNotesState(ownerUid) {
    return {
      schemaVersion: FRIEND_NOTES_SCHEMA_VERSION,
      ownerUid,
      notes: {},
    };
  }

  function normalizeFriendNoteText(value) {
    return typeof value === "string"
      ? value.replace(/\r\n?/g, "\n").trim()
      : null;
  }

  function normalizeFriendNoteTag(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
  }

  function friendNoteInvalid(reason) {
    return { ok: false, failureKind: "FRIEND_NOTE_INVALID", reason };
  }

  // Blank tags are dropped and duplicates collapse, so a draft can never turn
  // whitespace into a stored value. Lengths count UTF-16 units, which is exactly
  // what the editor's maxlength enforces.
  function validateFriendNoteDraft(draft) {
    if (!isPlainObject(draft)) return friendNoteInvalid("DRAFT_NOT_OBJECT");
    const note = normalizeFriendNoteText(draft.note);
    if (note === null) return friendNoteInvalid("NOTE_NOT_TEXT");
    if (note.length > FRIEND_NOTE_MAX_LENGTH) {
      return friendNoteInvalid("NOTE_TOO_LONG");
    }
    if (!Array.isArray(draft.tags)) return friendNoteInvalid("TAGS_NOT_LIST");
    const tags = [];
    for (const candidate of draft.tags) {
      const tag = normalizeFriendNoteTag(candidate);
      if (tag === null) return friendNoteInvalid("TAG_NOT_TEXT");
      if (tag === "" || tags.includes(tag)) continue;
      if (tag.length > FRIEND_NOTE_TAG_MAX_LENGTH) {
        return friendNoteInvalid("TAG_TOO_LONG");
      }
      tags.push(tag);
    }
    if (tags.length > FRIEND_NOTE_MAX_TAGS) {
      return friendNoteInvalid("TOO_MANY_TAGS");
    }
    return { ok: true, note, tags };
  }

  function isValidFriendNoteTimestamp(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value));
  }

  // A stored record must already be in the exact form a save would produce and
  // must carry content: an empty note with no tags is never a record.
  function isValidFriendNoteRecord(record) {
    if (
      !isPlainObject(record) ||
      !isValidFriendNoteTimestamp(record.createdAt) ||
      !isValidFriendNoteTimestamp(record.updatedAt)
    ) {
      return false;
    }
    const checked = validateFriendNoteDraft(record);
    return Boolean(
      checked.ok &&
        checked.note === record.note &&
        checked.tags.length === record.tags.length &&
        checked.tags.every((tag, index) => tag === record.tags[index]) &&
        (checked.note !== "" || checked.tags.length > 0)
    );
  }

  function isValidFriendNotesState(state, ownerUid) {
    if (
      !isPlainObject(state) ||
      state.schemaVersion !== FRIEND_NOTES_SCHEMA_VERSION ||
      state.ownerUid !== ownerUid ||
      !isPlainObject(state.notes)
    ) {
      return false;
    }
    const subjectUids = Object.keys(state.notes);
    if (subjectUids.length > FRIEND_NOTES_MAX_PROFILES) return false;
    return subjectUids.every(
      (uid) =>
        normalizeStableUid(uid) === uid &&
        isValidFriendNoteRecord(state.notes[uid])
    );
  }

  // Interprets one exact stored value. Absence is a valid empty state; anything
  // unreadable, malformed or written by a newer schema is a failure that callers
  // must surface, never a reason to start over from empty.
  function friendNotesStateFromRaw(raw, ownerUid) {
    if (raw === null || typeof raw === "undefined") {
      return { ok: true, state: emptyFriendNotesState(ownerUid), raw: null };
    }
    if (typeof raw !== "string") {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FRIEND_NOTES_NOT_STRING",
      };
    }
    let state;
    try {
      state = JSON.parse(raw);
    } catch (_) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FRIEND_NOTES_MALFORMED",
      };
    }
    if (
      isPlainObject(state) &&
      hasOwn(state, "schemaVersion") &&
      state.schemaVersion !== FRIEND_NOTES_SCHEMA_VERSION
    ) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FRIEND_NOTES_SCHEMA_UNSUPPORTED",
      };
    }
    if (!isValidFriendNotesState(state, ownerUid)) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FRIEND_NOTES_SCHEMA_INVALID",
      };
    }
    return { ok: true, state, raw };
  }

  function loadFriendNotesState(ownerUid) {
    let raw;
    try {
      raw = GM_getValue(friendNotesStorageKey(ownerUid), null);
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FRIEND_NOTES_UNREADABLE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
    return friendNotesStateFromRaw(raw, ownerUid);
  }

  function friendNotesLockUnavailable(reason, error) {
    const result = {
      ok: false,
      failureKind: "STATE_LOCK_UNAVAILABLE",
      reason,
    };
    if (error) result.errorName = error.name ? String(error.name) : "Error";
    return result;
  }

  // Owner-scoped cross-tab serialization, mirroring the other durable modules.
  // The transaction must stay local and short: no fetch, no delay, no UI wait.
  async function withFriendNotesLock(ownerUid, transaction) {
    const lockManager = pageLockManager();
    if (lockManager === null) {
      return friendNotesLockUnavailable("LOCK_UNAVAILABLE");
    }
    try {
      return await lockManager.request.call(
        lockManager,
        FRIEND_NOTES_LOCK_PREFIX + ownerUid,
        { mode: "exclusive" },
        async (lock) => {
          if (lock === null) {
            return friendNotesLockUnavailable("LOCK_NOT_ACQUIRED");
          }
          return await transaction();
        }
      );
    } catch (error) {
      return friendNotesLockUnavailable("LOCK_REQUEST_FAILED", error);
    }
  }

  // Unlocked helper: callers must already hold the Friend Notes lock. It writes
  // exact bytes (or restores absence) and verifies them. After a failed attempt
  // one bounded re-read is used solely to prove that the previous bytes are
  // still stored; it never retries and never upgrades a failure to success.
  function writeFriendNotesRaw(ownerUid, nextRaw, previousRaw) {
    const key = friendNotesStorageKey(ownerUid);
    const storedRaw = () => {
      const value = GM_getValue(key, null);
      return typeof value === "string" ? value : null;
    };
    let failure;
    try {
      if (nextRaw === null) GM_deleteValue(key);
      else GM_setValue(key, nextRaw);
      if (storedRaw() === nextRaw) return { ok: true };
      failure = {
        failureKind: "PERSISTENCE_ERROR",
        reason: "WRITE_NOT_VERIFIED",
      };
    } catch (error) {
      failure = {
        failureKind: "PERSISTENCE_ERROR",
        reason: "WRITE_FAILED",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
    let outcomeUnknown = true;
    try {
      outcomeUnknown = storedRaw() !== previousRaw;
    } catch (_) {
      // An unreadable value proves nothing about what is stored.
    }
    return { ...failure, ok: false, mutationAttempted: true, outcomeUnknown };
  }

  // Identity of one stored record as an editor saw it. A save carries the token
  // of the version it started from, so an edit based on a version another tab
  // has since replaced is detected instead of silently winning.
  function friendNoteRecordToken(record) {
    return record === null
      ? null
      : JSON.stringify([
          record.note,
          record.tags,
          record.createdAt,
          record.updatedAt,
        ]);
  }

  // The single write path for one profile. Everything that decides the outcome
  // is read inside the lock: the live owner, the stored state, and the version
  // the caller based its edit on. An empty draft removes the profile, so blank
  // input can never leave a meaningless record behind.
  async function saveFriendNote(
    ownerUid,
    subjectUid,
    draft,
    expectedToken,
    savedAt
  ) {
    if (
      typeof ownerUid !== "string" ||
      typeof subjectUid !== "string" ||
      normalizeStableUid(ownerUid) !== ownerUid ||
      normalizeStableUid(subjectUid) !== subjectUid
    ) {
      return friendNoteInvalid("SUBJECT_UID_UNAVAILABLE");
    }
    if (subjectUid === ownerUid) return friendNoteInvalid("SUBJECT_IS_OWNER");
    if (!isValidFriendNoteTimestamp(savedAt)) {
      return friendNoteInvalid("INVALID_TIMESTAMP");
    }
    const checked = validateFriendNoteDraft(draft);
    if (!checked.ok) return checked;
    const owner = determineCurrentUid();
    if (!owner.ok) return owner;
    if (owner.uid !== ownerUid) {
      return { ok: false, failureKind: "FRIEND_NOTE_OWNER_CHANGED" };
    }

    return await withFriendNotesLock(ownerUid, async () => {
      const lockedOwner = determineCurrentUid();
      if (!lockedOwner.ok || lockedOwner.uid !== ownerUid) {
        return { ok: false, failureKind: "FRIEND_NOTE_OWNER_CHANGED" };
      }
      const loaded = loadFriendNotesState(ownerUid);
      if (!loaded.ok) return loaded;
      const current = hasOwn(loaded.state.notes, subjectUid)
        ? loaded.state.notes[subjectUid]
        : null;
      if (friendNoteRecordToken(current) !== expectedToken) {
        return { ok: false, failureKind: "FRIEND_NOTE_CONFLICT", current };
      }

      const empty = checked.note === "" && checked.tags.length === 0;
      if (empty && current === null) {
        return { ok: true, record: null, token: null, changed: false };
      }
      if (
        current !== null &&
        current.note === checked.note &&
        current.tags.length === checked.tags.length &&
        current.tags.every((tag, index) => tag === checked.tags[index])
      ) {
        return { ok: true, record: current, token: expectedToken, changed: false };
      }

      const nextNotes = { ...loaded.state.notes };
      let record = null;
      if (empty) {
        delete nextNotes[subjectUid];
      } else {
        if (
          current === null &&
          Object.keys(nextNotes).length >= FRIEND_NOTES_MAX_PROFILES
        ) {
          return friendNoteInvalid("TOO_MANY_PROFILES");
        }
        record = {
          note: checked.note,
          tags: checked.tags,
          createdAt: current === null ? savedAt : current.createdAt,
          updatedAt: savedAt,
        };
        nextNotes[subjectUid] = record;
      }
      const written = writeFriendNotesRaw(
        ownerUid,
        JSON.stringify({
          schemaVersion: FRIEND_NOTES_SCHEMA_VERSION,
          ownerUid,
          notes: nextNotes,
        }),
        loaded.raw
      );
      if (!written.ok) return written;
      return {
        ok: true,
        record,
        token: friendNoteRecordToken(record),
        changed: true,
      };
    });
  }

  function friendNoteFailureText(result) {
    if (result.failureKind === "FRIEND_NOTE_INVALID") {
      const reasons = {
        NOTE_TOO_LONG: `备注不能超过 ${FRIEND_NOTE_MAX_LENGTH} 个字。`,
        TAG_TOO_LONG: `每个标签不能超过 ${FRIEND_NOTE_TAG_MAX_LENGTH} 个字。`,
        TOO_MANY_TAGS: `每个档案最多 ${FRIEND_NOTE_MAX_TAGS} 个标签。`,
        TOO_MANY_PROFILES: `友人档案已达到 ${FRIEND_NOTES_MAX_PROFILES} 条上限，请先删除不再需要的档案。`,
        SUBJECT_UID_UNAVAILABLE: "无法可靠识别目标账号的 UID，未保存。",
        SUBJECT_IS_OWNER: "不能为当前登录账号自己建立友人档案。",
      };
      return reasons[result.reason] || "备注或标签内容无效，未保存。";
    }
    if (result.failureKind === "PERSISTENCE_ERROR") {
      return result.outcomeUnknown === false
        ? "保存失败，已确认本地友人档案没有被更改。"
        : "保存结果无法确认。请重新打开此档案核对内容后，再决定是否重试。";
    }
    if (result.failureKind === "STORAGE_ERROR") {
      return result.reason === "FRIEND_NOTES_SCHEMA_UNSUPPORTED"
        ? "友人档案由更新版本的 Toolkit 写入，当前版本无法读取，未做任何更改。"
        : "友人档案本地数据无法读取。为避免覆盖，Toolkit 没有重置或更改这些数据。";
    }
    const labels = {
      UID_UNAVAILABLE: "无法可靠识别当前登录账号，未保存。",
      FRIEND_NOTE_OWNER_CHANGED: "当前登录账号已变化，未保存。请刷新页面后再试。",
      STATE_LOCK_UNAVAILABLE:
        "浏览器暂时无法提供跨标签页保护，未保存。请稍后重试。",
    };
    return labels[result.failureKind] || "保存失败，结果未能确认。";
  }

  // One row per saved profile. Names and relationship facts come from the same
  // derivation the profile page uses, read from the states as they are now, so
  // evidence that has been cleared or replaced stops matching immediately.
  function deriveFriendNoteEntries(notesState, friendState, followerState) {
    return Object.keys(notesState.notes)
      .map((uid) => {
        const facts = deriveProfileLocalFacts(uid, friendState, followerState);
        return {
          uid,
          record: notesState.notes[uid],
          facts,
          displayName: facts.currentName === null ? uid : facts.currentName,
        };
      })
      .sort(
        (left, right) =>
          right.record.updatedAt.localeCompare(left.record.updatedAt) ||
          left.uid.localeCompare(right.uid)
      );
  }

  function matchesFriendNoteQuery(entry, query) {
    const needle = String(query).trim().toLowerCase();
    if (needle === "") return true;
    const haystacks = [
      entry.uid,
      entry.record.note,
      ...entry.record.tags,
      ...entry.facts.historicalNames,
    ];
    if (entry.facts.currentName !== null) haystacks.push(entry.facts.currentName);
    return haystacks.some((text) => text.toLowerCase().includes(needle));
  }

  function filterFriendNoteEntries(entries, query, tag) {
    return entries.filter(
      (entry) =>
        (tag === null || entry.record.tags.includes(tag)) &&
        matchesFriendNoteQuery(entry, query)
    );
  }

  function collectFriendNoteTags(entries) {
    const counts = new Map();
    for (const entry of entries) {
      for (const tag of entry.record.tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    );
  }

  // Observed facts are worded as records with their own dates: a nickname seen
  // in an old snapshot is "last recorded", never the account's name right now.
  function friendNoteObservedRows(facts) {
    const rows = [];
    if (facts.currentName !== null) {
      rows.push({
        label: "最近记录昵称",
        value:
          facts.currentNameObservedAt === null
            ? facts.currentName
            : `${facts.currentName}（记录于 ${formatProfileDate(
                facts.currentNameObservedAt
              )}）`,
        exactTime: facts.currentNameObservedAt,
      });
    }
    if (facts.historicalNames.length > 0) {
      rows.push({
        label: "本地记录过的其他昵称",
        value: facts.historicalNames.join("、"),
        exactTime: null,
      });
    }
    if (facts.recentRelationshipEvent !== null) {
      rows.push({
        label: "最近关系记录",
        value: `${formatProfileDate(
          facts.recentRelationshipEvent.observedAt
        )} · ${facts.recentRelationshipEvent.label}`,
        exactTime: facts.recentRelationshipEvent.observedAt,
      });
    }
    if (facts.earliestLocalRecord !== null) {
      rows.push({
        label: "最早本地记录",
        value: formatProfileDate(facts.earliestLocalRecord),
        exactTime: facts.earliestLocalRecord,
      });
    }
    return rows;
  }

  function clearFriendNoteNode(node) {
    while (node.childNodes.length > 0) node.removeChild(node.childNodes[0]);
  }

  function focusFriendNoteControl(control) {
    if (control && typeof control.focus === "function") control.focus();
  }

  function createFriendNoteButton(text, className) {
    const button = createElement("button", text, className || "wfr-button");
    button.type = "button";
    return button;
  }

  function friendNoteProfileUrl(subjectUid) {
    return `${WEIBO_MAIN_ORIGIN}/u/${subjectUid}`;
  }

  function createFriendNoteProfileLink(subjectUid) {
    const link = createElement("a", "打开主页", "wfr-button wfr-note-link");
    link.href = friendNoteProfileUrl(subjectUid);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  }

  // User-written text is only ever assigned through textContent.
  function buildFriendNoteTagList(tags) {
    const list = createElement("ul", null, "wfr-note-tags");
    list.setAttribute("aria-label", "标签");
    for (const tag of tags) list.append(createElement("li", tag, "wfr-note-tag"));
    return list;
  }

  function appendFriendNoteRecord(container, record) {
    container.append(
      record.note === ""
        ? createElement("p", "（未写备注，仅有标签）", "wfr-muted")
        : createElement("p", record.note, "wfr-note-text")
    );
    if (record.tags.length > 0) {
      container.append(buildFriendNoteTagList(record.tags));
    }
    container.append(
      createElement(
        "p",
        `手写内容更新于 ${formatMinute(record.updatedAt)}`,
        "wfr-muted wfr-note-time"
      )
    );
  }

  // A key pressed while an input method is composing belongs to the IME: the
  // Enter that picks a candidate must not add a tag or save. Chrome, Edge and
  // Firefox mark those events with isComposing. Safari delivers the committing
  // Enter's keydown after compositionend, with isComposing already false, and
  // only keyCode 229 still identifies it.
  function isFriendNoteImeKeyEvent(event) {
    return Boolean(
      event && (event.isComposing === true || event.keyCode === 229)
    );
  }

  // The editors that can currently show one profile in this tab are the profile
  // panel, the Toolkit detail view and the feed card. After one of them has
  // stored a new version, the others are told directly, and only when they show
  // the same owner and subject; nothing else is rebuilt. The feed entries for
  // that subject are updated from the same saved record.
  function syncFriendNoteViews(ownerUid, subjectUid, record, sourceEditor) {
    const views = [];
    const context = profileFriendNotesContext;
    if (context !== null && context.editor) {
      views.push({
        ownerUid: context.ownerUid,
        subjectUid: context.targetUid,
        editor: context.editor,
      });
    }
    if (
      friendNoteDetailView !== null &&
      panelRoot !== null &&
      panelRoot.contains(friendNoteDetailView.editor.root)
    ) {
      views.push(friendNoteDetailView);
    }
    if (feedFriendNoteCard !== null) views.push(feedFriendNoteCard);
    applyFeedFriendNoteSaved(ownerUid, subjectUid, record);
    for (const view of views) {
      if (
        view.editor !== sourceEditor &&
        view.ownerUid === ownerUid &&
        view.subjectUid === subjectUid
      ) {
        view.editor.applySavedRecord(record);
      }
    }
  }

  // Shared by the profile panel and the Toolkit detail view. options.guard may
  // return a sentence explaining why saving is not allowed right now; a save is
  // otherwise always attempted through saveFriendNote and its lock.
  // options.onSaved is called only after a save or delete actually changed the
  // stored profile. options.startInEdit opens straight into the edit form.
  // Returns { root, applySavedRecord, isEditing, hasUnsavedChanges }.
  function buildFriendNoteEditor(options) {
    const ownerUid = options.ownerUid;
    const subjectUid = options.subjectUid;
    const root = createElement("div", null, "wfr-note-editor");
    const content = createElement("div", null, "wfr-note-content");
    const status = createElement("p", "", "wfr-muted wfr-note-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(content, status);

    let record = options.record;
    let baseToken = friendNoteRecordToken(record);
    let busy = false;
    let mode = "view";
    let draftChanged = null;

    const handle = {
      root,
      // True while typed input could be lost: an open edit form or a save or
      // delete still in flight.
      isEditing: () => busy || mode === "edit",
      // A save or delete is in flight. Unlike a draft, it cannot be discarded.
      isBusy: () => busy,
      hasUnsavedChanges: () =>
        busy || (mode === "edit" && draftChanged !== null && draftChanged()),
      // Another view in this tab has just stored this version. A view with
      // nothing unsaved simply shows it. An open edit keeps both the typed
      // input and the token it started from, so its own save still goes through
      // the stale-edit check instead of silently replacing the newer version.
      applySavedRecord(savedRecord) {
        if (busy) return;
        if (mode === "edit") {
          setStatus(
            "此档案刚在本页的其他位置保存了新内容。你的输入仍保留，保存时会进行冲突检查。"
          );
          return;
        }
        adopt(savedRecord);
        renderView(false);
        setStatus("");
      },
    };

    function notifySaved(savedRecord) {
      if (typeof options.onSaved === "function") {
        options.onSaved(ownerUid, subjectUid, savedRecord, handle);
      }
    }

    function setStatus(text, className) {
      status.textContent = text;
      status.className = `${className || "wfr-muted"} wfr-note-status`;
    }

    function adopt(nextRecord) {
      record = nextRecord;
      baseToken = friendNoteRecordToken(nextRecord);
    }

    function saveBlockedText() {
      return typeof options.guard === "function" ? options.guard() : null;
    }

    async function attemptSave(draft) {
      try {
        return await saveFriendNote(
          ownerUid,
          subjectUid,
          draft,
          baseToken,
          new Date().toISOString()
        );
      } catch (error) {
        return {
          ok: false,
          failureKind: "UNKNOWN_FAILURE",
          errorName: error && error.name ? String(error.name) : "Error",
        };
      }
    }

    function renderView(focusPrimary) {
      mode = "view";
      draftChanged = null;
      clearFriendNoteNode(content);
      if (record === null) {
        content.append(
          createElement("p", "还没有为此账号写下备注或标签。", "wfr-muted")
        );
      } else {
        appendFriendNoteRecord(content, record);
      }
      const actions = createElement(
        "div",
        null,
        "wfr-actions wfr-compact-actions"
      );
      const editButton = createFriendNoteButton(
        record === null ? "添加备注与标签" : "编辑"
      );
      editButton.addEventListener("click", beginEdit);
      actions.append(editButton);
      if (record !== null) {
        const deleteButton = createFriendNoteButton("删除档案");
        deleteButton.addEventListener("click", renderDeleteConfirm);
        actions.append(deleteButton);
      }
      content.append(actions);
      if (focusPrimary) focusFriendNoteControl(editButton);
    }

    // Editing always starts from the version stored right now, not from the one
    // this view happened to render, so an edit does not begin already stale.
    function beginEdit() {
      if (busy) return;
      const fresh = loadFriendNotesState(ownerUid);
      if (!fresh.ok) {
        setStatus(friendNoteFailureText(fresh), "wfr-error");
        return;
      }
      adopt(
        hasOwn(fresh.state.notes, subjectUid)
          ? fresh.state.notes[subjectUid]
          : null
      );
      setStatus("");
      renderEdit({
        note: record === null ? "" : record.note,
        tags: record === null ? [] : [...record.tags],
      });
    }

    function renderEdit(draft) {
      mode = "edit";
      clearFriendNoteNode(content);
      friendNoteEditorSequence += 1;
      const fieldId = `wfr-note-field-${friendNoteEditorSequence}`;
      const tags = [...draft.tags];

      const conflictSlot = createElement("div", null, "wfr-note-conflict-slot");

      const noteLabel = createElement(
        "label",
        "私人备注（仅保存在本浏览器）",
        "wfr-note-field-label"
      );
      noteLabel.setAttribute("for", `${fieldId}-note`);
      const textarea = createElement("textarea", null, "wfr-note-textarea");
      textarea.id = `${fieldId}-note`;
      textarea.maxLength = FRIEND_NOTE_MAX_LENGTH;
      textarea.rows = options.compact ? 3 : 5;
      textarea.placeholder = "例如：去年摄影展认识的阿岚，喜欢拍海边。";
      textarea.value = draft.note;
      const counter = createElement("p", "", "wfr-muted wfr-note-counter");
      const syncCounter = () => {
        counter.textContent = `${String(textarea.value).length} / ${FRIEND_NOTE_MAX_LENGTH}`;
      };
      textarea.addEventListener("input", syncCounter);
      syncCounter();

      const tagLabel = createElement("label", "标签", "wfr-note-field-label");
      tagLabel.setAttribute("for", `${fieldId}-tag`);
      const tagList = createElement("ul", null, "wfr-note-tags");
      tagList.setAttribute("aria-label", "已添加的标签");
      const tagRow = createElement("div", null, "wfr-note-tag-row");
      const tagInput = createElement("input", null, "wfr-note-tag-input");
      tagInput.type = "text";
      tagInput.id = `${fieldId}-tag`;
      tagInput.maxLength = FRIEND_NOTE_TAG_MAX_LENGTH;
      tagInput.placeholder = "输入标签后按回车";
      draftChanged = () =>
        String(textarea.value) !== draft.note ||
        String(tagInput.value) !== "" ||
        tags.length !== draft.tags.length ||
        tags.some((tag, index) => tag !== draft.tags[index]);
      const addTagButton = createFriendNoteButton("添加标签");
      tagRow.append(tagInput, addTagButton);
      const tagHint = createElement(
        "p",
        `最多 ${FRIEND_NOTE_MAX_TAGS} 个标签，每个不超过 ${FRIEND_NOTE_TAG_MAX_LENGTH} 个字。`,
        "wfr-muted wfr-note-counter"
      );

      function renderTags() {
        clearFriendNoteNode(tagList);
        tagList.hidden = tags.length === 0;
        for (const tag of tags) {
          const item = createElement("li", null, "wfr-note-tag");
          const removeButton = createElement(
            "button",
            "×",
            "wfr-note-tag-remove"
          );
          removeButton.type = "button";
          removeButton.setAttribute("aria-label", `移除标签 ${tag}`);
          removeButton.addEventListener("click", () => {
            if (busy) return;
            tags.splice(tags.indexOf(tag), 1);
            renderTags();
            focusFriendNoteControl(tagInput);
          });
          item.append(createElement("span", tag), removeButton);
          tagList.append(item);
        }
      }

      // Returns false only when pending input was rejected, so a save never
      // silently drops a tag the user had typed but not yet added.
      function addPendingTag() {
        const tag = normalizeFriendNoteTag(String(tagInput.value));
        if (tag === "") {
          tagInput.value = "";
          return true;
        }
        if (tag.length > FRIEND_NOTE_TAG_MAX_LENGTH) {
          setStatus(friendNoteFailureText(friendNoteInvalid("TAG_TOO_LONG")), "wfr-error");
          return false;
        }
        if (tags.includes(tag)) {
          tagInput.value = "";
          setStatus("已经有相同的标签。");
          return true;
        }
        if (tags.length >= FRIEND_NOTE_MAX_TAGS) {
          setStatus(friendNoteFailureText(friendNoteInvalid("TOO_MANY_TAGS")), "wfr-error");
          return false;
        }
        tags.push(tag);
        tagInput.value = "";
        renderTags();
        setStatus("");
        return true;
      }

      const actions = createElement(
        "div",
        null,
        "wfr-actions wfr-compact-actions"
      );
      const saveButton = createFriendNoteButton("保存", "wfr-button wfr-primary");
      const cancelButton = createFriendNoteButton("取消");
      actions.append(saveButton, cancelButton);

      function setControlsDisabled(disabled) {
        for (const control of [
          textarea,
          tagInput,
          addTagButton,
          saveButton,
          cancelButton,
        ]) {
          control.disabled = disabled;
        }
      }

      function showConflict(current) {
        clearFriendNoteNode(conflictSlot);
        const box = createElement("div", null, "wfr-note-conflict");
        box.append(
          createElement(
            "p",
            "此档案在你编辑期间已被其他标签页修改，你的内容尚未保存，仍保留在下方。",
            "wfr-error"
          ),
          createElement("p", "目前已保存的版本：", "wfr-muted")
        );
        if (current === null) {
          box.append(createElement("p", "（档案已被删除）", "wfr-muted"));
        } else {
          appendFriendNoteRecord(box, current);
        }
        const conflictActions = createElement(
          "div",
          null,
          "wfr-actions wfr-compact-actions"
        );
        const useSaved = createFriendNoteButton("放弃我的修改，使用已保存的版本");
        const overwrite = createFriendNoteButton("用我的内容覆盖");
        useSaved.addEventListener("click", () => {
          if (busy) return;
          adopt(current);
          renderView(true);
          setStatus("已载入已保存的版本。");
        });
        // An explicit decision made after seeing the other version: the edit is
        // re-based on exactly that version, so a third change is still detected.
        overwrite.addEventListener("click", () => {
          if (busy) return;
          adopt(current);
          clearFriendNoteNode(conflictSlot);
          void submit();
        });
        conflictActions.append(useSaved, overwrite);
        box.append(conflictActions);
        conflictSlot.append(box);
        focusFriendNoteControl(useSaved);
      }

      async function submit() {
        if (busy || !addPendingTag()) return;
        const draft = { note: String(textarea.value), tags: [...tags] };
        const checked = validateFriendNoteDraft(draft);
        if (!checked.ok) {
          setStatus(friendNoteFailureText(checked), "wfr-error");
          return;
        }
        if (checked.note === "" && checked.tags.length === 0) {
          setStatus(
            record === null
              ? "请先写下备注或添加标签。"
              : "备注和标签都为空。如需移除此档案，请取消后使用“删除档案”。",
            "wfr-error"
          );
          return;
        }
        const blocked = saveBlockedText();
        if (blocked) {
          setStatus(`${blocked}你的输入仍保留在这里。`, "wfr-error");
          return;
        }
        busy = true;
        setControlsDisabled(true);
        setStatus("正在保存…");
        const result = await attemptSave(draft);
        busy = false;
        if (result.ok) {
          adopt(result.record);
          renderView(true);
          setStatus("已保存。", "wfr-success");
          if (result.changed) notifySaved(result.record);
          return;
        }
        setControlsDisabled(false);
        if (result.failureKind === "FRIEND_NOTE_CONFLICT") {
          setStatus("保存未完成：检测到其他标签页的修改。", "wfr-error");
          showConflict(result.current);
          return;
        }
        setStatus(
          `${friendNoteFailureText(result)}你的输入仍保留在这里。`,
          "wfr-error"
        );
      }

      // The view returned to is the stored version, which may be newer than the
      // one this edit started from if another view saved in the meantime.
      function cancel() {
        if (busy) return;
        const fresh = loadFriendNotesState(ownerUid);
        if (fresh.ok) {
          adopt(
            hasOwn(fresh.state.notes, subjectUid)
              ? fresh.state.notes[subjectUid]
              : null
          );
        }
        renderView(true);
        setStatus("");
      }

      tagInput.addEventListener("keydown", (event) => {
        if (isFriendNoteImeKeyEvent(event)) return;
        if (event && event.key === "Enter") {
          if (typeof event.preventDefault === "function") event.preventDefault();
          addPendingTag();
        }
      });
      addTagButton.addEventListener("click", () => {
        if (normalizeFriendNoteTag(String(tagInput.value)) === "") {
          setStatus("请先输入标签内容。");
        } else {
          addPendingTag();
        }
        focusFriendNoteControl(tagInput);
      });
      textarea.addEventListener("keydown", (event) => {
        if (isFriendNoteImeKeyEvent(event)) return;
        if (event && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          if (typeof event.preventDefault === "function") event.preventDefault();
          void submit();
        }
      });
      saveButton.addEventListener("click", () => void submit());
      cancelButton.addEventListener("click", cancel);

      renderTags();
      content.append(
        conflictSlot,
        noteLabel,
        textarea,
        counter,
        tagLabel,
        tagList,
        tagRow,
        tagHint,
        actions
      );
      focusFriendNoteControl(textarea);
    }

    function renderDeleteConfirm() {
      if (busy || record === null) return;
      mode = "confirm-delete";
      clearFriendNoteNode(content);
      appendFriendNoteRecord(content, record);
      const confirmation = createElement("div", null, "wfr-removal-confirm");
      confirmation.append(
        createElement(
          "p",
          "删除这条友人档案？手写的备注和标签会从本浏览器移除，无法撤销；Toolkit 的关系记录不受影响。"
        )
      );
      const actions = createElement(
        "div",
        null,
        "wfr-actions wfr-compact-actions"
      );
      const cancelButton = createFriendNoteButton("取消");
      const confirmButton = createFriendNoteButton(
        "确认删除",
        "wfr-button wfr-danger"
      );
      cancelButton.addEventListener("click", () => {
        if (busy) return;
        renderView(true);
        setStatus("");
      });
      confirmButton.addEventListener("click", async () => {
        if (busy) return;
        const blocked = saveBlockedText();
        if (blocked) {
          setStatus(blocked, "wfr-error");
          return;
        }
        busy = true;
        cancelButton.disabled = true;
        confirmButton.disabled = true;
        setStatus("正在删除…");
        const result = await attemptSave({ note: "", tags: [] });
        busy = false;
        if (result.ok) {
          adopt(null);
          renderView(true);
          setStatus("档案已删除。", "wfr-success");
          if (result.changed) notifySaved(null);
          return;
        }
        if (result.failureKind === "FRIEND_NOTE_CONFLICT") {
          adopt(result.current);
          renderView(true);
          setStatus(
            result.current === null
              ? "此档案已在其他标签页被删除。"
              : "此档案刚被其他标签页修改，未删除。已显示最新内容。",
            "wfr-error"
          );
          return;
        }
        renderView(true);
        setStatus(friendNoteFailureText(result), "wfr-error");
      });
      actions.append(cancelButton, confirmButton);
      confirmation.append(actions);
      content.append(confirmation);
      focusFriendNoteControl(cancelButton);
    }

    renderView(false);
    if (options.startInEdit) beginEdit();
    return handle;
  }

  function loadFriendNoteSubjectView(ownerUid, subjectUid) {
    const notes = loadFriendNotesState(ownerUid);
    const friend = loadState(ownerUid);
    const follower = loadFollowerState(ownerUid);
    return {
      notes,
      friend,
      follower,
      facts: deriveProfileLocalFacts(
        subjectUid,
        friend.ok ? friend.state : null,
        follower.ok ? follower.state : null
      ),
    };
  }

  function appendFriendNotesUnreadable(body, failure) {
    body.append(
      createElement("p", friendNoteFailureText(failure), "wfr-error"),
      createElement(
        "p",
        "在数据恢复可读之前，友人档案无法查看或保存。可以通过“恢复备份”用包含友人档案的备份替换它。",
        "wfr-muted"
      )
    );
    if (failure.reason) addLine(body, "原因", failure.reason);
  }

  // The other-user profile currently open in this tab, if it can be identified
  // from the route alone. Used to offer a note without any relationship baseline.
  function friendNoteRouteSubject(ownerUid) {
    const targetUid = resolveProfileRouteTargetUid();
    return targetUid !== null && targetUid !== ownerUid ? targetUid : null;
  }

  function showFriendNotesManager(viewState) {
    // Search text and tag filter survive a round trip through a detail view.
    const view = viewState || { query: "", tag: null };
    const owner = determineCurrentUid();
    if (!owner.ok) {
      showFailure("友人档案", owner);
      return;
    }
    const ownerUid = owner.uid;
    const loaded = loadFriendNotesState(ownerUid);
    const body = showPanel("友人档案", true);
    if (!loaded.ok) {
      appendFriendNotesUnreadable(body, loaded);
      return;
    }
    const friend = loadState(ownerUid);
    const follower = loadFollowerState(ownerUid);
    const entries = deriveFriendNoteEntries(
      loaded.state,
      friend.ok ? friend.state : null,
      follower.ok ? follower.state : null
    );

    body.append(
      createElement(
        "p",
        "备注和标签仅保存在当前浏览器。",
        "wfr-muted"
      )
    );
    if (!friend.ok || !follower.ok) {
      body.append(
        createElement(
          "p",
          "部分关系雷达或粉丝快照本地数据无法读取，昵称记录可能缺失；手写档案不受影响。",
          "wfr-muted"
        )
      );
    }

    const routeSubject = friendNoteRouteSubject(ownerUid);
    if (routeSubject !== null) {
      const routeActions = createElement("div", null, "wfr-actions");
      const routeButton = createFriendNoteButton(
        hasOwn(loaded.state.notes, routeSubject)
          ? `查看当前主页的档案（UID ${routeSubject}）`
          : `为当前主页写档案（UID ${routeSubject}）`,
        "wfr-button wfr-primary"
      );
      routeButton.addEventListener("click", () =>
        showFriendNoteDetail(ownerUid, routeSubject, view)
      );
      routeActions.append(routeButton);
      body.append(routeActions);
    }

    if (entries.length === 0) {
      body.append(
        createElement("h3", "还没有友人档案"),
        createElement(
          "p",
          "打开某个人的微博主页（地址形如 weibo.com/u/数字 UID），再回到这里点“为当前主页写档案”，就可以写下备注并添加标签。不需要先更新关系雷达或粉丝快照。"
        ),
        createElement(
          "p",
          "也可以在“浏览体验 → 增强”中开启“在主页显示友人档案”，之后直接在对方主页上查看和编辑。",
          "wfr-muted"
        )
      );
      const emptyActions = createElement("div", null, "wfr-actions");
      const settingsButton = createFriendNoteButton("打开浏览体验设置");
      settingsButton.addEventListener("click", showPageSettings);
      emptyActions.append(settingsButton);
      body.append(emptyActions);
      return;
    }

    const tagCounts = collectFriendNoteTags(entries);
    if (view.tag !== null && !tagCounts.some(([tag]) => tag === view.tag)) {
      view.tag = null;
    }

    const search = createElement("input", null, "wfr-search");
    search.type = "search";
    search.placeholder = "搜索昵称、历史昵称、UID、备注或标签";
    search.setAttribute("aria-label", "搜索友人档案");
    search.value = view.query;
    body.append(search);

    const filterRow = createElement("label", "标签筛选：", "wfr-row");
    const tagSelect = createElement("select", null, "wfr-select");
    tagSelect.setAttribute("aria-label", "按标签筛选");
    const allOption = createElement("option", "全部标签");
    allOption.value = "";
    tagSelect.append(allOption);
    for (const [tag, count] of tagCounts) {
      const option = createElement("option", `${tag}（${count}）`);
      option.value = tag;
      option.selected = tag === view.tag;
      tagSelect.append(option);
    }
    tagSelect.value = view.tag === null ? "" : view.tag;
    filterRow.append(tagSelect);
    body.append(filterRow);

    const summary = createElement("p", "", "wfr-muted");
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    const list = createElement("div", null, "wfr-event-list");
    const moreActions = createElement("div", null, "wfr-actions");
    const moreButton = createFriendNoteButton("加载更多");
    moreActions.append(moreButton);
    body.append(summary, list, moreActions);

    let matching = [];
    let shown = 0;

    function buildCard(entry) {
      const item = createElement("article", null, "wfr-event");
      item.append(createElement("h3", entry.displayName));
      item.append(
        createElement(
          "p",
          entry.facts.currentName === null
            ? `UID ${entry.uid} · 暂无本地昵称记录`
            : `UID ${entry.uid}`,
          "wfr-muted wfr-row"
        )
      );
      const needle = view.query.trim().toLowerCase();
      const matchedOldNames =
        needle === ""
          ? []
          : entry.facts.historicalNames.filter((name) =>
              name.toLowerCase().includes(needle)
            );
      if (matchedOldNames.length > 0) {
        item.append(
          createElement(
            "p",
            `本地记录过的昵称：${matchedOldNames.join("、")}`,
            "wfr-muted wfr-row"
          )
        );
      }
      item.append(
        entry.record.note === ""
          ? createElement("p", "（未写备注，仅有标签）", "wfr-muted")
          : createElement("p", entry.record.note, "wfr-note-preview")
      );
      if (entry.record.tags.length > 0) {
        item.append(buildFriendNoteTagList(entry.record.tags));
      }
      const actions = createElement("div", null, "wfr-actions");
      const openButton = createFriendNoteButton("查看与编辑");
      openButton.addEventListener("click", () =>
        showFriendNoteDetail(ownerUid, entry.uid, view)
      );
      actions.append(openButton, createFriendNoteProfileLink(entry.uid));
      item.append(actions);
      return item;
    }

    function renderMore() {
      const next = matching.slice(shown, shown + FRIEND_NOTES_PAGE_SIZE);
      for (const entry of next) list.append(buildCard(entry));
      shown += next.length;
      const remaining = matching.length - shown;
      moreActions.hidden = remaining <= 0;
      moreButton.textContent = `加载更多（还有 ${remaining} 条）`;
    }

    function renderList() {
      clearFriendNoteNode(list);
      matching = filterFriendNoteEntries(entries, view.query, view.tag);
      shown = 0;
      summary.textContent =
        matching.length === entries.length
          ? `共 ${entries.length} 条档案`
          : `共 ${entries.length} 条档案，匹配 ${matching.length} 条`;
      if (matching.length === 0) {
        list.append(createElement("p", "没有匹配的档案", "wfr-muted wfr-empty"));
      }
      renderMore();
    }

    search.addEventListener("input", () => {
      view.query = String(search.value || "");
      renderList();
    });
    tagSelect.addEventListener("change", () => {
      view.tag = tagSelect.value === "" ? null : String(tagSelect.value);
      renderList();
    });
    moreButton.addEventListener("click", renderMore);
    renderList();
  }

  function showFriendNoteDetail(ownerUid, subjectUid, viewState) {
    const backToManager = () => showFriendNotesManager(viewState);
    const owner = determineCurrentUid();
    if (!owner.ok || owner.uid !== ownerUid) {
      showFailure("友人档案", { failureKind: "UID_UNAVAILABLE" });
      return;
    }
    const subject = loadFriendNoteSubjectView(ownerUid, subjectUid);
    const displayName =
      subject.facts.currentName === null ? subjectUid : subject.facts.currentName;
    const body = showPanel(`${displayName} · 友人档案`, backToManager);
    if (!subject.notes.ok) {
      appendFriendNotesUnreadable(body, subject.notes);
      return;
    }
    addLine(body, "UID", subjectUid);
    const linkActions = createElement(
      "div",
      null,
      "wfr-actions wfr-compact-actions"
    );
    linkActions.append(createFriendNoteProfileLink(subjectUid));
    body.append(linkActions);

    body.append(createElement("h3", "我的备注与标签（手写）"));
    const editor = buildFriendNoteEditor({
      ownerUid,
      subjectUid,
      record: hasOwn(subject.notes.state.notes, subjectUid)
        ? subject.notes.state.notes[subjectUid]
        : null,
      compact: false,
      onSaved: syncFriendNoteViews,
    });
    friendNoteDetailView = { ownerUid, subjectUid, editor };
    body.append(editor.root);

    body.append(createElement("h3", "Toolkit 本地观察记录"));
    const rows = friendNoteObservedRows(subject.facts);
    if (rows.length === 0) {
      body.append(
        createElement(
          "p",
          "Toolkit 尚未在关系雷达或粉丝快照中记录过此账号，这里只显示 UID。",
          "wfr-muted"
        )
      );
    }
    for (const row of rows) addLine(body, row.label, row.value);
    if (subject.friend.ok) {
      const eventCount = eventsForSubject(
        subject.friend.state.events,
        subjectUid
      ).length;
      const timelineActions = createElement("div", null, "wfr-actions");
      const timelineButton = createFriendNoteButton(
        `查看关系时间线（${eventCount} 条本地事件）`
      );
      timelineButton.addEventListener("click", () =>
        showTimeline(ownerUid, subject.friend.state, subjectUid, () =>
          showFriendNoteDetail(ownerUid, subjectUid, viewState)
        )
      );
      timelineActions.append(timelineButton);
      body.append(timelineActions);
    }
  }

  function removeProfileFriendNotesNode() {
    const context = profileFriendNotesContext;
    if (context && context.root && context.root.parentNode) {
      context.root.parentNode.removeChild(context.root);
    }
    if (typeof document.getElementById !== "function") return;
    const stray = document.getElementById(PROFILE_FRIEND_NOTES_ID);
    if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
  }

  function disconnectProfileFriendNotesObserver() {
    if (profileFriendNotesObserver) profileFriendNotesObserver.disconnect();
    profileFriendNotesObserver = null;
    profileFriendNotesObservedMain = null;
    profileFriendNotesObservedHost = null;
  }

  function cancelProfileFriendNotesDiscovery() {
    if (profileFriendNotesDiscoveryTimer !== null) {
      clearTimeout(profileFriendNotesDiscoveryTimer);
      profileFriendNotesDiscoveryTimer = null;
    }
    profileFriendNotesDiscoveryCount = 0;
  }

  // Dropping the context drops the panel and every listener attached inside it;
  // the panel never registers anything on document or window.
  function teardownProfileFriendNotes() {
    disconnectProfileFriendNotesObserver();
    cancelProfileFriendNotesDiscovery();
    removeProfileFriendNotesNode();
    profileFriendNotesContext = null;
  }

  function scheduleProfileFriendNotesEnsure() {
    if (profileFriendNotesEnsureScheduled) return;
    profileFriendNotesEnsureScheduled = true;
    setTimeout(() => {
      profileFriendNotesEnsureScheduled = false;
      ensureProfileFriendNotes();
    }, 0);
  }

  function observeProfileFriendNotesHost(point) {
    if (
      profileFriendNotesObserver &&
      profileFriendNotesObservedMain === point.main &&
      profileFriendNotesObservedHost === point.host
    ) {
      return;
    }
    disconnectProfileFriendNotesObserver();
    profileFriendNotesObserver = new MutationObserver(
      scheduleProfileFriendNotesEnsure
    );
    profileFriendNotesObserver.observe(point.main, { childList: true });
    if (point.host !== point.main) {
      profileFriendNotesObserver.observe(point.host, { childList: true });
    }
    profileFriendNotesObservedMain = point.main;
    profileFriendNotesObservedHost = point.host;
  }

  function scheduleProfileFriendNotesDiscovery() {
    if (
      profileFriendNotesDiscoveryTimer !== null ||
      profileFriendNotesDiscoveryCount >= 20
    ) {
      return;
    }
    profileFriendNotesDiscoveryTimer = setTimeout(() => {
      profileFriendNotesDiscoveryTimer = null;
      profileFriendNotesDiscoveryCount += 1;
      ensureProfileFriendNotes();
    }, 250);
  }

  function renderProfileFriendNotes(context) {
    const root = createElement(
      "section",
      null,
      "wfr-profile-notes wfr-root"
    );
    root.id = PROFILE_FRIEND_NOTES_ID;
    root.setAttribute("aria-label", "友人档案（Weibo Toolkit 本地）");
    applyThemeToRoot(root);
    const head = createElement("p", null, "wfr-profile-notes-head");
    head.append(
      createElement("strong", "友人档案"),
      createElement("span", "你手写的内容，仅保存在本浏览器", "wfr-muted")
    );
    root.append(head);

    if (context.ownerUid === null) {
      root.append(
        createElement(
          "p",
          "无法可靠识别当前登录账号，友人档案已禁用查看和保存。",
          "wfr-error"
        )
      );
      return root;
    }
    const subject = loadFriendNoteSubjectView(
      context.ownerUid,
      context.targetUid
    );
    if (!subject.notes.ok) {
      root.append(
        createElement(
          "p",
          `${friendNoteFailureText(subject.notes)}保存已禁用。`,
          "wfr-error"
        )
      );
      return root;
    }
    context.editor = buildFriendNoteEditor({
      ownerUid: context.ownerUid,
      subjectUid: context.targetUid,
      record: hasOwn(subject.notes.state.notes, context.targetUid)
        ? subject.notes.state.notes[context.targetUid]
        : null,
      compact: true,
      // The panel is bound to one owner and one target for its whole life. A
      // save is refused once this tab is no longer showing that target.
      guard: () =>
        profileFriendNotesContext === context &&
        resolveProfileRouteTargetUid() === context.targetUid
          ? null
          : "当前页面已不是该账号的主页，未保存。",
      onSaved: syncFriendNoteViews,
    });
    root.append(context.editor.root);

    // Profile Extras already shows these observed facts when it is enabled, so
    // they are rendered here only when it is not.
    if (!pageCleanupPreferences.showProfileExtras) {
      const rows = friendNoteObservedRows(subject.facts);
      if (rows.length > 0) {
        const observed = createElement(
          "div",
          null,
          "wfr-profile-notes-observed"
        );
        observed.append(
          createElement(
            "p",
            "Toolkit 本地观察记录（非实时）",
            "wfr-profile-notes-subhead"
          )
        );
        for (const row of rows) {
          addProfileLine(observed, row.label, row.value, row.exactTime);
        }
        root.append(observed);
      }
    }
    if (subject.friend.ok) {
      const eventCount = eventsForSubject(
        subject.friend.state.events,
        context.targetUid
      ).length;
      if (eventCount > 0) {
        const actions = createElement(
          "div",
          null,
          "wfr-actions wfr-compact-actions"
        );
        const timelineButton = createFriendNoteButton(
          `关系时间线（${eventCount} 条本地事件）`
        );
        timelineButton.addEventListener("click", () =>
          showTimeline(
            context.ownerUid,
            subject.friend.state,
            context.targetUid,
            () =>
              showFriendNoteDetail(context.ownerUid, context.targetUid, null)
          )
        );
        actions.append(timelineButton);
        root.append(actions);
      }
    }
    return root;
  }

  // Shows the panel for exactly the profile this tab is on. It reads local state
  // only: no request is sent, no visit is recorded, and Weibo's own nodes are
  // left untouched apart from one inserted sibling.
  function ensureProfileFriendNotes() {
    if (!pageCleanupPreferences.showProfileFriendNotes) {
      teardownProfileFriendNotes();
      return false;
    }
    const targetUid = resolveProfileRouteTargetUid();
    const owner = determineCurrentUid();
    if (targetUid === null || (owner.ok && owner.uid === targetUid)) {
      teardownProfileFriendNotes();
      return false;
    }
    const ownerUid = owner.ok ? owner.uid : null;
    if (
      profileFriendNotesContext === null ||
      profileFriendNotesContext.ownerUid !== ownerUid ||
      profileFriendNotesContext.targetUid !== targetUid
    ) {
      teardownProfileFriendNotes();
      profileFriendNotesContext = {
        ownerUid,
        targetUid,
        root: null,
        editor: null,
      };
    }
    const context = profileFriendNotesContext;

    const point = findProfileExtrasInsertionPoint();
    if (!point) {
      disconnectProfileFriendNotesObserver();
      scheduleProfileFriendNotesDiscovery();
      return false;
    }
    cancelProfileFriendNotesDiscovery();
    // The same node is re-attached if Weibo re-renders around it, so text being
    // edited survives a host refresh on the same profile.
    if (context.root === null) context.root = renderProfileFriendNotes(context);
    if (context.root.parentNode !== point.host) {
      point.host.insertBefore(context.root, point.before);
    }
    observeProfileFriendNotesHost(point);
    return true;
  }

  function rebuildProfileFriendNotes() {
    teardownProfileFriendNotes();
    return ensureProfileFriendNotes();
  }
