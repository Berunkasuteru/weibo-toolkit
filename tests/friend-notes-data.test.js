"use strict";

const {
  assert,
  notesKey,
  radarKey,
  createSharedBrowser,
  openTab,
} = require("./friend-notes-fixture");

const NAMES = [
  "saveFriendNote",
  "loadFriendNotesState",
  "validateFriendNoteDraft",
  "friendNoteRecordToken",
  "deriveFriendNoteEntries",
  "filterFriendNoteEntries",
  "collectFriendNoteTags",
  "friendNoteObservedRows",
];

const OWNER = "1001";
const OTHER_OWNER = "2002";
const LAN = "3001";
const TWIN_A = "3002";
const TWIN_B = "3003";
const UNSEEN = "3004";
const T1 = "2026-09-01T08:00:00.000Z";
const T2 = "2026-09-02T08:00:00.000Z";
const T3 = "2026-09-03T08:00:00.000Z";
const LOCK = `weibo-toolkit-friend-notes-state-${OWNER}`;

const storedNotes = (browser, ownerUid) =>
  JSON.parse(browser.storage.get(notesKey(ownerUid))).notes;
const uids = (entries) => entries.map((entry) => entry.uid).sort().join(",");

async function ownerIsolationAndIdentity() {
  const browser = createSharedBrowser();
  const tab = openTab(browser, NAMES, { ownerUid: OWNER });
  const save = tab.product.saveFriendNote;

  const first = await save(
    OWNER,
    LAN,
    { note: "去年摄影展认识的阿岚，喜欢拍海边。", tags: ["摄影", "熟人"] },
    null,
    T1
  );
  assert(first.ok && first.changed, "a first note for a reliable UID must save");
  assert(browser.lockNames.includes(LOCK), "the save must run under the owner lock");
  assert(
    !browser.storage.has(radarKey(OWNER)),
    "a note must be savable with no Friend Radar baseline at all"
  );

  // A second account on the same browser sees nothing and changes nothing.
  const otherTab = openTab(browser, NAMES, { ownerUid: OTHER_OWNER });
  const otherLoaded = otherTab.product.loadFriendNotesState(OTHER_OWNER);
  assert(
    otherLoaded.ok && Object.keys(otherLoaded.state.notes).length === 0,
    "another owner must not see this owner's notes"
  );
  const ownerRawBefore = browser.storage.get(notesKey(OWNER));
  const otherSaved = await otherTab.product.saveFriendNote(
    OTHER_OWNER,
    LAN,
    { note: "另一个账号写的", tags: [] },
    null,
    T1
  );
  assert(otherSaved.ok, "the other owner must be able to keep its own note");
  assert(
    browser.storage.get(notesKey(OWNER)) === ownerRawBefore,
    "one owner's save must leave another owner's notes byte-identical"
  );
  assert(
    storedNotes(browser, OTHER_OWNER)[LAN].note === "另一个账号写的",
    "notes must be stored under the saving owner"
  );

  // A tab may only write for the account it is actually logged in as.
  const foreign = await save(OTHER_OWNER, LAN, { note: "x", tags: [] }, null, T2);
  assert(
    !foreign.ok && foreign.failureKind === "FRIEND_NOTE_OWNER_CHANGED",
    "saving under a UID that is not the live owner must be refused"
  );
  tab.ownerUid = null;
  const unknownOwner = await save(OWNER, LAN, { note: "x", tags: [] }, null, T2);
  tab.ownerUid = OWNER;
  assert(
    !unknownOwner.ok && unknownOwner.failureKind === "UID_UNAVAILABLE",
    "an unidentifiable owner must disable saving"
  );
  browser.beforeGrant = async () => {
    tab.ownerUid = OTHER_OWNER;
  };
  const switched = await save(OWNER, TWIN_A, { note: "x", tags: [] }, null, T2);
  browser.beforeGrant = null;
  tab.ownerUid = OWNER;
  assert(
    !switched.ok && switched.failureKind === "FRIEND_NOTE_OWNER_CHANGED",
    "the owner must be re-checked after the lock is acquired"
  );
  assert(
    browser.storage.get(notesKey(OWNER)) === ownerRawBefore,
    "refused saves must write nothing"
  );

  // The subject is identified by a canonical UID only, never guessed.
  for (const subject of ["", "abc", "0012", "阿岚", null, undefined, 12.5]) {
    const refused = await save(OWNER, subject, { note: "x", tags: [] }, null, T2);
    assert(
      !refused.ok && refused.reason === "SUBJECT_UID_UNAVAILABLE",
      `an unreliable subject UID must be refused: ${String(subject)}`
    );
  }
  const self = await save(OWNER, OWNER, { note: "x", tags: [] }, null, T2);
  assert(!self.ok && self.reason === "SUBJECT_IS_OWNER", "self notes are refused");

  // Identity is the UID: same nickname stays separate, a rename keeps the note.
  await save(OWNER, TWIN_A, { note: "同名的第一位", tags: ["同事"] }, null, T1);
  await save(OWNER, TWIN_B, { note: "同名的第二位", tags: ["熟人"] }, null, T2);
  await save(OWNER, UNSEEN, { note: "还没有任何本地记录的人", tags: [] }, null, T3);
  const notesState = tab.product.loadFriendNotesState(OWNER).state;
  const friendState = {
    latestSnapshot: {
      capturedAt: "2026-08-20T00:00:00.000Z",
      records: [
        { uid: LAN, screenName: "阿岚Lan" },
        { uid: TWIN_A, screenName: "同名" },
      ],
    },
    events: [
      {
        id: "e1",
        type: "SCREEN_NAME_CHANGED",
        detectedAt: "2026-08-20T00:00:00.000Z",
        subjectUid: LAN,
        displayName: "阿岚Lan",
        previous: { screenName: "海边的岚" },
        current: { screenName: "阿岚Lan" },
      },
    ],
  };
  const followerState = {
    latestSnapshot: {
      capturedAt: "2026-08-10T00:00:00.000Z",
      records: [{ uid: TWIN_B, screenName: "同名" }],
    },
    events: [],
  };
  const derive = tab.product.deriveFriendNoteEntries;
  const filter = tab.product.filterFriendNoteEntries;
  const entries = derive(notesState, friendState, followerState);
  assert(entries.length === 4, "one entry per saved profile");
  const byUid = new Map(entries.map((entry) => [entry.uid, entry]));

  assert(byUid.get(LAN).displayName === "阿岚Lan", "the latest recorded name is shown");
  assert(
    uids(filter(entries, "海边的岚", null)) === LAN,
    "a recorded former nickname must still find the profile after a rename"
  );
  assert(
    byUid.get(LAN).record.note === "去年摄影展认识的阿岚，喜欢拍海边。",
    "a rename must not detach the note from its UID"
  );
  const twins = filter(entries, "同名", null);
  assert(
    uids(twins) === `${TWIN_A},${TWIN_B}` &&
      byUid.get(TWIN_A).record.note !== byUid.get(TWIN_B).record.note,
    "accounts sharing a nickname must stay separate profiles"
  );
  assert(
    byUid.get(UNSEEN).displayName === UNSEEN &&
      byUid.get(UNSEEN).facts.currentName === null,
    "with no local nickname evidence the UID is the fallback label"
  );
  assert(uids(filter(entries, UNSEEN, null)) === UNSEEN, "search covers UID");
  assert(uids(filter(entries, "摄影展", null)) === LAN, "search covers note text");
  assert(uids(filter(entries, "熟人", null)) === `${LAN},${TWIN_B}`, "search covers tags");
  assert(uids(filter(entries, "", "熟人")) === `${LAN},${TWIN_B}`, "tag filter");
  assert(uids(filter(entries, "同名", "熟人")) === TWIN_B, "tag filter narrows a search");
  const tagCounts = tab.product.collectFriendNoteTags(entries);
  assert(
    tagCounts.length === 3 &&
      JSON.stringify(tagCounts[0]) === JSON.stringify(["熟人", 2]) &&
      new Map(tagCounts).get("同事") === 1 &&
      new Map(tagCounts).get("摄影") === 1,
    "tag counts come from saved profiles, most used first"
  );
  const rows = tab.product.friendNoteObservedRows(byUid.get(LAN).facts);
  assert(
    rows[0].label === "最近记录昵称" && rows[0].value.includes("记录于"),
    "an observed nickname must carry the date it was recorded"
  );

  // Evidence that no longer exists must stop matching: nothing is cached.
  const withoutEvents = derive(notesState, { ...friendState, events: [] }, followerState);
  assert(
    filter(withoutEvents, "海边的岚", null).length === 0,
    "search must not keep claiming a nickname whose evidence was removed"
  );
  assert(
    uids(filter(withoutEvents, "摄影展", null)) === LAN,
    "removing observed evidence must not remove the hand-written note"
  );

  // Deleting a note touches the notes state and nothing else.
  const radarRaw = JSON.stringify({ marker: "friend radar bytes" });
  browser.storage.set(radarKey(OWNER), radarRaw);
  browser.writes.length = 0;
  const token = tab.product.friendNoteRecordToken(notesState.notes[LAN]);
  const removed = await save(OWNER, LAN, { note: "", tags: [] }, token, T3);
  assert(removed.ok && removed.record === null, "an emptied profile is removed");
  assert(!(LAN in storedNotes(browser, OWNER)), "the removed profile is gone");
  assert(
    browser.storage.get(radarKey(OWNER)) === radarRaw &&
      browser.writes.every((key) => key === notesKey(OWNER)),
    "deleting a note must not touch relationship events"
  );
  assert(browser.fetchCalls === 0, "notes never use the network");
}

async function validation() {
  const browser = createSharedBrowser();
  const tab = openTab(browser, NAMES, { ownerUid: OWNER });
  const { validateFriendNoteDraft: validate, saveFriendNote: save } = tab.product;

  assert(validate({ note: "字".repeat(1000), tags: [] }).ok, "1000 characters fit");
  assert(
    validate({ note: "字".repeat(1001), tags: [] }).reason === "NOTE_TOO_LONG",
    "a note over the limit is rejected, not truncated"
  );
  assert(validate({ note: "x", tags: ["标".repeat(20)] }).ok, "a 20-character tag fits");
  assert(
    validate({ note: "x", tags: ["标".repeat(21)] }).reason === "TAG_TOO_LONG",
    "an over-long tag is rejected"
  );
  const twelve = Array.from({ length: 12 }, (_, index) => `标签${index}`);
  assert(validate({ note: "", tags: twelve }).ok, "12 tags fit");
  assert(
    validate({ note: "", tags: [...twelve, "第十三个"] }).reason === "TOO_MANY_TAGS",
    "a 13th tag is rejected"
  );
  for (const broken of [null, "text", { note: 1, tags: [] }, { note: "", tags: "a" }, { note: "", tags: [1] }]) {
    assert(!validate(broken).ok, `malformed draft accepted: ${JSON.stringify(broken)}`);
  }
  const cleaned = validate({
    note: "  第一行\r\n第二行  \n",
    tags: ["  摄影  ", "", "   ", "摄影", "海边\t 风光"],
  });
  assert(
    cleaned.ok &&
      cleaned.note === "第一行\n第二行" &&
      JSON.stringify(cleaned.tags) === JSON.stringify(["摄影", "海边 风光"]),
    "blank tags are dropped, duplicates collapse, whitespace is normalized"
  );

  // Blank input never becomes a stored record.
  const blank = await save(OWNER, LAN, { note: "  \n ", tags: ["", "  "] }, null, T1);
  assert(
    blank.ok && blank.record === null && blank.changed === false,
    "whitespace-only input must not create a profile"
  );
  assert(!browser.storage.has(notesKey(OWNER)), "blank input must write nothing");
  const invalid = await save(OWNER, LAN, { note: "字".repeat(1001), tags: [] }, null, T1);
  assert(!invalid.ok && !browser.storage.has(notesKey(OWNER)), "invalid input writes nothing");

  // Markup and control characters are data: stored and returned verbatim.
  const hostile = '<img src=x onerror="alert(1)"> & "引号" </script>\n第二行 😀';
  const saved = await save(OWNER, LAN, { note: hostile, tags: ["<b>粗体</b>"] }, null, T1);
  const reloaded = tab.product.loadFriendNotesState(OWNER).state.notes[LAN];
  assert(
    saved.ok && reloaded.note === hostile && reloaded.tags[0] === "<b>粗体</b>",
    "special characters must round-trip exactly"
  );
  assert(
    reloaded.createdAt === T1 && reloaded.updatedAt === T1,
    "creation and modification times are recorded"
  );
  const edited = await save(
    OWNER,
    LAN,
    { note: "改过的备注", tags: [] },
    tab.product.friendNoteRecordToken(reloaded),
    T2
  );
  assert(
    edited.ok && edited.record.createdAt === T1 && edited.record.updatedAt === T2,
    "an edit keeps the creation time and advances the modification time"
  );
}

async function concurrentSaves() {
  const browser = createSharedBrowser();
  const tabA = openTab(browser, NAMES, { ownerUid: OWNER });
  const tabB = openTab(browser, NAMES, { ownerUid: OWNER });

  // Two tabs, two different people, started before either has written.
  const [left, right] = await Promise.all([
    tabA.product.saveFriendNote(OWNER, LAN, { note: "A 标签页写给阿岚", tags: [] }, null, T1),
    tabB.product.saveFriendNote(OWNER, TWIN_A, { note: "B 标签页写给同名", tags: [] }, null, T1),
  ]);
  assert(left.ok && right.ok, "both concurrent saves must succeed");
  const notes = storedNotes(browser, OWNER);
  assert(
    notes[LAN].note === "A 标签页写给阿岚" && notes[TWIN_A].note === "B 标签页写给同名",
    "concurrent saves for different UIDs must both survive"
  );

  // Same profile, both tabs holding the same old version.
  const base = tabA.product.friendNoteRecordToken(notes[LAN]);
  const fromA = await tabA.product.saveFriendNote(OWNER, LAN, { note: "A 的新版本", tags: ["A"] }, base, T2);
  assert(fromA.ok, "the first editor saves");
  const rawAfterA = browser.storage.get(notesKey(OWNER));
  const fromB = await tabB.product.saveFriendNote(OWNER, LAN, { note: "B 的新版本", tags: ["B"] }, base, T3);
  assert(
    !fromB.ok && fromB.failureKind === "FRIEND_NOTE_CONFLICT",
    "a save based on a replaced version must be reported as a conflict"
  );
  assert(
    fromB.current.note === "A 的新版本",
    "the conflict must hand back the version that is actually stored"
  );
  assert(
    browser.storage.get(notesKey(OWNER)) === rawAfterA,
    "a stale save must not overwrite the other tab's note"
  );
  const staleDelete = await tabB.product.saveFriendNote(OWNER, LAN, { note: "", tags: [] }, base, T3);
  assert(
    !staleDelete.ok && staleDelete.failureKind === "FRIEND_NOTE_CONFLICT" &&
      browser.storage.get(notesKey(OWNER)) === rawAfterA,
    "a stale delete must not remove the other tab's note either"
  );

  // Having seen the stored version, B may deliberately replace it.
  const rebased = await tabB.product.saveFriendNote(
    OWNER,
    LAN,
    { note: "B 的新版本", tags: ["B"] },
    tabB.product.friendNoteRecordToken(fromB.current),
    T3
  );
  assert(rebased.ok && storedNotes(browser, OWNER)[LAN].note === "B 的新版本", "explicit overwrite");
  assert(
    storedNotes(browser, OWNER)[TWIN_A].note === "B 标签页写给同名",
    "resolving one profile's conflict must not disturb another profile"
  );

  // A profile deleted elsewhere is also a conflict for a pending edit.
  await tabA.product.saveFriendNote(OWNER, LAN, { note: "", tags: [] }, rebased.token, T3);
  const afterDelete = await tabB.product.saveFriendNote(OWNER, LAN, { note: "继续编辑", tags: [] }, rebased.token, T3);
  assert(
    !afterDelete.ok && afterDelete.failureKind === "FRIEND_NOTE_CONFLICT" && afterDelete.current === null,
    "editing a profile another tab deleted must not silently recreate it"
  );
}

async function failureModes() {
  const browser = createSharedBrowser();
  const tab = openTab(browser, NAMES, { ownerUid: OWNER });
  const save = tab.product.saveFriendNote;
  const draft = { note: "失败路径上的输入", tags: ["保留"] };

  await save(OWNER, LAN, { note: "已有档案", tags: [] }, null, T1);
  const goodRaw = browser.storage.get(notesKey(OWNER));

  // No reliable cross-tab lock: fail, never fall back to an unprotected write.
  browser.locksAvailable = false;
  const noLock = await save(OWNER, TWIN_A, draft, null, T2);
  browser.locksAvailable = true;
  assert(
    !noLock.ok && noLock.failureKind === "STATE_LOCK_UNAVAILABLE",
    "an unavailable lock must fail the save"
  );
  assert(browser.storage.get(notesKey(OWNER)) === goodRaw, "no unlocked write may happen");

  // Storage that cannot be read.
  browser.failRead = (key) => key === notesKey(OWNER);
  const unreadable = await save(OWNER, TWIN_A, draft, null, T2);
  browser.failRead = null;
  assert(
    !unreadable.ok && unreadable.failureKind === "STORAGE_ERROR" &&
      unreadable.reason === "FRIEND_NOTES_UNREADABLE",
    "a read failure must fail the save"
  );
  assert(browser.storage.get(notesKey(OWNER)) === goodRaw, "a read failure writes nothing");

  // Damaged, foreign or newer data is never reset or overwritten.
  const damaged = [
    ["{not json", "FRIEND_NOTES_MALFORMED"],
    [JSON.stringify({ schemaVersion: 2, ownerUid: OWNER, notes: {} }), "FRIEND_NOTES_SCHEMA_UNSUPPORTED"],
    [JSON.stringify({ schemaVersion: 1, ownerUid: OTHER_OWNER, notes: {} }), "FRIEND_NOTES_SCHEMA_INVALID"],
    [JSON.stringify({ schemaVersion: 1, ownerUid: OWNER, notes: { 昵称: {} } }), "FRIEND_NOTES_SCHEMA_INVALID"],
    [
      JSON.stringify({
        schemaVersion: 1,
        ownerUid: OWNER,
        notes: { [LAN]: { note: "", tags: [], createdAt: T1, updatedAt: T1 } },
      }),
      "FRIEND_NOTES_SCHEMA_INVALID",
    ],
    [{ schemaVersion: 1, ownerUid: OWNER, notes: {} }, "FRIEND_NOTES_NOT_STRING"],
  ];
  for (const [value, reason] of damaged) {
    browser.storage.set(notesKey(OWNER), value);
    const loaded = tab.product.loadFriendNotesState(OWNER);
    assert(!loaded.ok && loaded.reason === reason, `expected ${reason}, got ${loaded.reason}`);
    const refused = await save(OWNER, TWIN_A, draft, null, T2);
    assert(
      !refused.ok && refused.failureKind === "STORAGE_ERROR" && refused.reason === reason,
      `saving over ${reason} must be refused`
    );
    assert(
      browser.storage.get(notesKey(OWNER)) === value,
      `${reason} data must be left exactly as it is`
    );
  }
  browser.storage.set(notesKey(OWNER), goodRaw);

  // The write itself fails and provably did not land.
  browser.writeBehavior = (key) => (key === notesKey(OWNER) ? "throw" : undefined);
  const writeFailed = await save(OWNER, TWIN_A, draft, null, T2);
  assert(
    !writeFailed.ok && writeFailed.failureKind === "PERSISTENCE_ERROR" &&
      writeFailed.reason === "WRITE_FAILED" && writeFailed.outcomeUnknown === false,
    "a failed write that left the old bytes is a known non-change"
  );
  assert(browser.storage.get(notesKey(OWNER)) === goodRaw, "old data intact after a failed write");

  // The write returns but the value read back is not what was written.
  browser.writeBehavior = (key) => (key === notesKey(OWNER) ? "drop" : undefined);
  const unverified = await save(OWNER, TWIN_A, draft, null, T2);
  assert(
    !unverified.ok && unverified.reason === "WRITE_NOT_VERIFIED" &&
      unverified.outcomeUnknown === false,
    "an unverified write must never be reported as saved"
  );

  // The write throws after landing: the result must be reported as unknown.
  browser.writeBehavior = (key) => (key === notesKey(OWNER) ? "land-then-throw" : undefined);
  const uncertain = await save(OWNER, TWIN_A, draft, null, T2);
  browser.writeBehavior = null;
  assert(
    !uncertain.ok && uncertain.failureKind === "PERSISTENCE_ERROR" &&
      uncertain.outcomeUnknown === true,
    "a write whose effect cannot be ruled out must be reported as uncertain"
  );
}

(async () => {
  await ownerIsolationAndIdentity();
  await validation();
  await concurrentSaves();
  await failureModes();
  console.log("friend notes data invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
