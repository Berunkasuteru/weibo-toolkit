"use strict";

const {
  assert,
  notesKey,
  radarKey,
  followerKey,
  createSharedBrowser,
  openTab,
} = require("./friend-notes-fixture");

const NAMES = [
  "createBackup",
  "serializeBackup",
  "validateBackupText",
  "restoreValidatedBackup",
  "loadState",
  "loadFollowerState",
  "loadFriendNotesState",
  "BACKUP_VERSION",
  "SUPPORTED_BACKUP_VERSIONS",
];

const OWNER = "1001";
const OTHER_OWNER = "2002";
const NOTES_LOCK = `weibo-toolkit-friend-notes-state-${OWNER}`;
const FOLLOWER_LOCK = `weibo-toolkit-follower-state-${OWNER}`;
const RADAR_LOCK = `weibo-toolkit-friend-radar-state-${OWNER}`;
const T = "2026-09-01T08:00:00.000Z";

const radarState = (label) => ({
  schemaVersion: 1,
  ownerUid: OWNER,
  latestSnapshot: null,
  events: [
    {
      id: `radar-${label}`,
      type: "FOLLOW_ME_LOST",
      detectedAt: T,
      subjectUid: "9001",
      displayName: label,
      read: false,
      previous: { followsMe: true },
      current: { followsMe: false },
    },
  ],
});
const followerState = (label) => ({
  schemaVersion: 1,
  ownerUid: OWNER,
  latestSnapshot: null,
  events: [
    {
      id: `follower-${label}`,
      type: "VISIBLE_FOLLOWER_ADDED",
      uid: "9002",
      observedAt: T,
      displayName: label,
    },
  ],
});
const notesState = (entries, ownerUid = OWNER) => ({
  schemaVersion: 1,
  ownerUid,
  notes: Object.fromEntries(
    entries.map(([uid, note, tags = []]) => [
      uid,
      { note, tags, createdAt: T, updatedAt: T },
    ])
  ),
});

const R_BACKUP = JSON.stringify(radarState("backup"));
const R_CURRENT = JSON.stringify(radarState("current"));
const R_NEWER = JSON.stringify(radarState("newer"));
const F_BACKUP = JSON.stringify(followerState("backup"));
const F_CURRENT = JSON.stringify(followerState("current"));
const F_NEWER = JSON.stringify(followerState("newer"));
const N_BACKUP = JSON.stringify(
  notesState([
    ["3001", "去年摄影展认识的阿岚，喜欢拍海边。", ["摄影", "熟人"]],
    ["3002", "", ["同事"]],
  ])
);
const N_CURRENT = JSON.stringify(notesState([["3003", "恢复前才写的备注"]]));
const N_NEWER = JSON.stringify(notesState([["3004", "另一个标签页刚保存的备注"]]));

function setCurrent(browser, radar = R_CURRENT, follower = F_CURRENT, notes = N_CURRENT) {
  browser.storage.clear();
  browser.storage.set(radarKey(OWNER), radar);
  if (follower !== null) browser.storage.set(followerKey(OWNER), follower);
  if (notes !== null) browser.storage.set(notesKey(OWNER), notes);
  browser.writes.length = 0;
  browser.lockNames.length = 0;
  browser.beforeGrant = null;
  browser.writeBehavior = null;
}

const stored = (browser, key) =>
  browser.storage.has(key) ? browser.storage.get(key) : null;

function assertStored(browser, radar, follower, notes, context) {
  assert(stored(browser, radarKey(OWNER)) === radar, `${context}: Friend Radar bytes`);
  assert(stored(browser, followerKey(OWNER)) === follower, `${context}: follower bytes`);
  assert(stored(browser, notesKey(OWNER)) === notes, `${context}: friend notes bytes`);
}

const fileV = (backupVersion, extra = {}) =>
  JSON.stringify({
    backupFormat: "weibo-toolkit.friend-radar",
    backupVersion,
    exportedAt: T,
    appVersion: "test",
    ownerUid: OWNER,
    state: JSON.parse(R_BACKUP),
    ...extra,
  });
const v3File = (overrides = {}) =>
  fileV(3, {
    followerState: JSON.parse(F_BACKUP),
    friendNotes: JSON.parse(N_BACKUP),
    ...overrides,
  });

// Runs after the n-th grant of one lock has been reached, i.e. "another tab
// committed this just before our transaction ran".
function onGrant(browser, lockName, occurrence, action) {
  let seen = 0;
  const previous = browser.beforeGrant;
  browser.beforeGrant = async (name) => {
    if (previous) await previous(name);
    if (name !== lockName) return;
    seen += 1;
    if (seen === occurrence) action();
  };
}

(async () => {
  const browser = createSharedBrowser();
  const tab = openTab(browser, NAMES, { ownerUid: OWNER });
  const { validateBackupText: validate, restoreValidatedBackup: restore } = tab.product;

  // ---- Format contract ----------------------------------------------------
  assert(tab.product.BACKUP_VERSION === 3, "new backups are v3");
  assert(
    JSON.stringify(tab.product.SUPPORTED_BACKUP_VERSIONS) === "[1,2,3]",
    "v1 and v2 must remain restorable"
  );
  setCurrent(browser, R_BACKUP, F_BACKUP, N_BACKUP);
  // Environment data that must never ride along in a backup.
  browser.storage.set(`weiboToolkit.profileVisits.v1.${OWNER}`, { 3001: { count: 9, lastVisitedAt: T } });
  browser.storage.set(`weiboToolkit.usage.v1.${OWNER}`, "usage-bytes");
  browser.storage.set("weiboToolkit.page.showProfileFriendNotes.v1", true);
  const radarLoaded = tab.product.loadState(OWNER);
  const followerLoaded = tab.product.loadFollowerState(OWNER);
  const notesLoaded = tab.product.loadFriendNotesState(OWNER);
  assert(radarLoaded.ok && followerLoaded.ok && notesLoaded.ok, "fixtures must be valid states");
  const exportedAt = new Date(T);
  let threw = false;
  try {
    tab.product.createBackup(OWNER, radarLoaded.state, followerLoaded.state, exportedAt);
  } catch (_) {
    threw = true;
  }
  assert(threw, "a backup that does not state its friend-notes coverage must be refused");
  threw = false;
  try {
    tab.product.createBackup(OWNER, radarLoaded.state, followerLoaded.state, exportedAt, notesState([], OTHER_OWNER));
  } catch (_) {
    threw = true;
  }
  assert(threw, "friend notes of another owner must not be exported");
  const backup = tab.product.createBackup(
    OWNER,
    radarLoaded.state,
    followerLoaded.state,
    exportedAt,
    notesLoaded.state
  );
  assert(
    JSON.stringify(Object.keys(backup).sort()) ===
      JSON.stringify([
        "appVersion",
        "backupFormat",
        "backupVersion",
        "exportedAt",
        "followerState",
        "friendNotes",
        "ownerUid",
        "state",
      ]),
    `backup carries exactly its declared fields: ${Object.keys(backup).join(",")}`
  );
  const backupText = tab.product.serializeBackup(backup);
  for (const leaked of ["profileVisits", "usage", "showProfileFriendNotes", "cookie", "XSRF", "token"]) {
    assert(!backupText.includes(leaked), `backup must not contain ${leaked}`);
  }
  const emptyBackup = tab.product.createBackup(OWNER, radarLoaded.state, null, exportedAt, null);
  assert(
    Object.prototype.hasOwnProperty.call(emptyBackup, "friendNotes") && emptyBackup.friendNotes === null,
    "the absence of friend notes is recorded explicitly"
  );
  assert(browser.writes.length === 0, "creating a backup writes nothing");

  // ---- v3 round trip ------------------------------------------------------
  setCurrent(browser);
  const validated = validate(backupText, OWNER);
  assert(
    validated.ok && validated.backupVersion === 3 && validated.followerCovered && validated.friendNotesCovered,
    "an exported v3 backup must validate with full coverage"
  );
  const restored = await restore(validated, R_CURRENT, F_CURRENT, N_CURRENT);
  assert(
    restored.ok && restored.followerRestored && restored.friendNotesRestored,
    `v3 restore must succeed: ${JSON.stringify(restored)}`
  );
  assertStored(browser, R_BACKUP, F_BACKUP, N_BACKUP, "v3 round trip");
  const reloaded = tab.product.loadFriendNotesState(OWNER);
  assert(
    reloaded.ok && JSON.stringify(reloaded.state) === N_BACKUP,
    "restored friend notes must load as a valid state"
  );
  assert(
    !("3003" in reloaded.state.notes),
    "restore replaces the notes; it does not merge profiles the backup lacks"
  );
  assert(browser.fetchCalls === 0, "restore never uses the network");

  // An explicit "no friend notes" backup reproduces that condition.
  setCurrent(browser);
  const none = validate(v3File({ friendNotes: null }), OWNER);
  assert(none.ok && none.friendNotesCovered && none.friendNotesState === null, "explicit null coverage");
  assert((await restore(none, R_CURRENT, F_CURRENT, N_CURRENT)).ok, "explicit-null restore succeeds");
  assertStored(browser, R_BACKUP, F_BACKUP, null, "explicit-null restore");

  // ---- v1 / v2 keep their meaning ----------------------------------------
  for (const [version, extra] of [
    [1, {}],
    [2, { followerState: JSON.parse(F_BACKUP) }],
  ]) {
    // Even unreadable local notes are none of an old backup's business.
    for (const localNotes of [N_CURRENT, "{damaged"]) {
      setCurrent(browser, R_CURRENT, F_CURRENT, localNotes);
      const legacy = validate(fileV(version, extra), OWNER);
      assert(legacy.ok, `v${version} must still validate`);
      assert(legacy.friendNotesCovered === false, `v${version} must not claim friend-notes coverage`);
      assert(legacy.followerCovered === (version === 2), `v${version} follower coverage unchanged`);
      const legacyRestored = await restore(legacy, R_CURRENT, F_CURRENT);
      assert(
        legacyRestored.ok && legacyRestored.friendNotesRestored === false,
        `v${version} must still restore`
      );
      assertStored(
        browser,
        R_BACKUP,
        version === 2 ? F_BACKUP : F_CURRENT,
        localNotes,
        `v${version} restore`
      );
      assert(
        !browser.writes.includes(notesKey(OWNER)) && !browser.lockNames.includes(NOTES_LOCK),
        `v${version} restore must not write or even lock friend notes`
      );
    }
  }
  // A friendNotes field smuggled into an old version is not coverage.
  const smuggled = validate(fileV(2, { followerState: null, friendNotes: JSON.parse(N_BACKUP) }), OWNER);
  assert(smuggled.ok && smuggled.friendNotesCovered === false, "v2 never covers friend notes");

  // ---- Rejected before any preview ---------------------------------------
  setCurrent(browser);
  const withoutNotes = JSON.parse(v3File());
  delete withoutNotes.friendNotes;
  const withoutFollower = JSON.parse(v3File());
  delete withoutFollower.followerState;
  const rejections = [
    [JSON.stringify(withoutNotes), OWNER, "MISSING_FRIEND_NOTES"],
    [JSON.stringify(withoutFollower), OWNER, "MISSING_FOLLOWER_STATE"],
    [v3File(), OTHER_OWNER, "OWNER_UID_MISMATCH"],
    [v3File({ backupVersion: 4 }), OWNER, "UNSUPPORTED_BACKUP_VERSION"],
    [v3File({ friendNotes: notesState([["3001", "x"]], OTHER_OWNER) }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: { schemaVersion: 2, ownerUid: OWNER, notes: {} } }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: { schemaVersion: 1, ownerUid: OWNER } }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: "notes" }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: notesState([["阿岚", "昵称不能当主键"]]) }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: notesState([["3001", "字".repeat(1001)]]) }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: notesState([["3001", "", []]]) }), OWNER, "INVALID_FRIEND_NOTES"],
    [v3File({ friendNotes: notesState([["3001", "x", ["重复", "重复"]]]) }), OWNER, "INVALID_FRIEND_NOTES"],
    [
      v3File({
        friendNotes: {
          schemaVersion: 1,
          ownerUid: OWNER,
          notes: { 3001: { note: "x", tags: [], createdAt: "昨天", updatedAt: T } },
        },
      }),
      OWNER,
      "INVALID_FRIEND_NOTES",
    ],
    [v3File({ followerState: { schemaVersion: 9 } }), OWNER, "INVALID_FOLLOWER_STATE"],
    [v3File({ state: { schemaVersion: 1 } }), OWNER, "INVALID_STATE"],
  ];
  for (const [text, currentOwner, reason] of rejections) {
    const rejected = validate(text, currentOwner);
    assert(
      !rejected.ok && rejected.failureKind === "BACKUP_RESTORE_ERROR" && rejected.reason === reason,
      `expected ${reason}, got ${JSON.stringify(rejected)}`
    );
  }
  assert(browser.writes.length === 0, "rejected backups write nothing");

  // The live owner is re-checked at confirmation time.
  tab.ownerUid = OTHER_OWNER;
  const ownerChanged = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  tab.ownerUid = OWNER;
  assert(!ownerChanged.ok && ownerChanged.reason === "OWNER_UID_MISMATCH", "owner re-check");
  assertStored(browser, R_CURRENT, F_CURRENT, N_CURRENT, "owner change");

  // ---- Changes made after the preview ------------------------------------
  // Notes edited in another tab while the preview was open: nothing is written.
  setCurrent(browser, R_CURRENT, F_CURRENT, N_NEWER);
  const stalePreview = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  assert(
    !stalePreview.ok && stalePreview.reason === "FRIEND_NOTES_CHANGED_SINCE_PREVIEW",
    `notes changed since preview must be refused: ${JSON.stringify(stalePreview)}`
  );
  assert(browser.writes.length === 0, "a refused restore performs zero writes");
  assertStored(browser, R_CURRENT, F_CURRENT, N_NEWER, "stale preview");

  // No lock, no restore: fail before the first write.
  setCurrent(browser);
  browser.locksAvailable = false;
  const noLock = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  browser.locksAvailable = true;
  assert(!noLock.ok && noLock.failureKind === "STATE_LOCK_UNAVAILABLE", "lock required");
  assert(browser.writes.length === 0, "no unlocked restore write");

  // Notes saved by another tab after the early check but before the notes
  // write: that note is kept, and both earlier writes are undone.
  setCurrent(browser);
  onGrant(browser, NOTES_LOCK, 2, () => browser.storage.set(notesKey(OWNER), N_NEWER));
  const raced = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  assert(!raced.ok, "a restore that lost the notes race must not report success");
  assert(
    raced.reason === "FRIEND_NOTES_RESTORE_FAILED_ROLLED_BACK" && raced.rollbackSucceeded === true,
    `a fully undone restore must say so: ${JSON.stringify(raced)}`
  );
  assertStored(browser, R_CURRENT, F_CURRENT, N_NEWER, "notes race");

  // Same race, but another tab has also committed a newer follower state
  // before the rollback: it is preserved and the result is reported as partial.
  setCurrent(browser);
  onGrant(browser, NOTES_LOCK, 2, () => browser.storage.set(notesKey(OWNER), N_NEWER));
  onGrant(browser, FOLLOWER_LOCK, 2, () => browser.storage.set(followerKey(OWNER), F_NEWER));
  const partialFollower = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  assert(
    !partialFollower.ok &&
      partialFollower.reason === "FRIEND_NOTES_RESTORE_FAILED_PARTIAL" &&
      partialFollower.rollbackSucceeded === false,
    `a rollback that met newer data must be reported as partial: ${JSON.stringify(partialFollower)}`
  );
  assertStored(browser, R_CURRENT, F_NEWER, N_NEWER, "rollback keeps a newer follower state");

  // And the same for a newer Friend Radar state.
  setCurrent(browser);
  onGrant(browser, NOTES_LOCK, 2, () => browser.storage.set(notesKey(OWNER), N_NEWER));
  onGrant(browser, RADAR_LOCK, 2, () => browser.storage.set(radarKey(OWNER), R_NEWER));
  const partialRadar = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  assert(
    !partialRadar.ok && partialRadar.reason === "FRIEND_NOTES_RESTORE_FAILED_PARTIAL",
    `newer Friend Radar data must make the result partial: ${JSON.stringify(partialRadar)}`
  );
  assertStored(browser, R_NEWER, F_CURRENT, N_NEWER, "rollback keeps a newer Friend Radar state");

  // ---- Write failures in the notes third ---------------------------------
  // Clean failure: notes provably untouched, everything else put back.
  setCurrent(browser);
  browser.writeBehavior = (key) => (key === notesKey(OWNER) ? "throw" : undefined);
  const cleanFailure = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  browser.writeBehavior = null;
  assert(
    !cleanFailure.ok && cleanFailure.reason === "FRIEND_NOTES_RESTORE_FAILED_ROLLED_BACK",
    `a clean notes failure must roll back: ${JSON.stringify(cleanFailure)}`
  );
  assertStored(browser, R_CURRENT, F_CURRENT, N_CURRENT, "clean notes failure");

  // The notes write may have landed: nothing is rolled back and nothing is
  // called a success or a cancellation.
  setCurrent(browser);
  browser.writeBehavior = (key) => (key === notesKey(OWNER) ? "land-then-throw" : undefined);
  const uncertain = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  browser.writeBehavior = null;
  assert(
    !uncertain.ok && uncertain.reason === "RESTORE_STATE_UNCERTAIN" && uncertain.rollbackSucceeded === false,
    `an unknown notes outcome must be reported as uncertain: ${JSON.stringify(uncertain)}`
  );
  assert(
    stored(browser, radarKey(OWNER)) === R_BACKUP && stored(browser, followerKey(OWNER)) === F_BACKUP,
    "an uncertain outcome must not be followed by a rollback that assumes failure"
  );

  // Rollback itself cannot be confirmed: uncertain, never "rolled back".
  setCurrent(browser);
  let radarWrites = 0;
  browser.writeBehavior = (key) => {
    if (key === notesKey(OWNER)) return "throw";
    if (key === radarKey(OWNER)) {
      radarWrites += 1;
      return radarWrites > 1 ? "throw" : undefined;
    }
    return undefined;
  };
  const rollbackFailed = await restore(validate(v3File(), OWNER), R_CURRENT, F_CURRENT, N_CURRENT);
  browser.writeBehavior = null;
  assert(
    !rollbackFailed.ok && rollbackFailed.reason === "RESTORE_STATE_UNCERTAIN" && rollbackFailed.rollbackSucceeded === false,
    `a failed rollback must be reported as uncertain: ${JSON.stringify(rollbackFailed)}`
  );

  // ---- Damaged current Friend Radar value ---------------------------------
  // A restore the user confirmed is the way out of a damaged value: its exact
  // bytes are the expected value, so the restore replaces it...
  const R_DAMAGED = '{"schemaVersion":1,"ownerUid":';
  setCurrent(browser, R_DAMAGED);
  assert(!tab.product.loadState(OWNER).ok, "the damaged value must not load");
  const overDamaged = await restore(validate(v3File(), OWNER), R_DAMAGED, F_CURRENT, N_CURRENT);
  assert(overDamaged.ok, `a damaged value must be replaceable: ${JSON.stringify(overDamaged)}`);
  assertStored(browser, R_BACKUP, F_BACKUP, N_BACKUP, "restore over a damaged value");

  // ...but only those bytes: a different damaged value is still a conflict,
  // and a value that cannot be read at all is never treated as absent.
  setCurrent(browser, R_DAMAGED + " ");
  const otherDamage = await restore(validate(v3File(), OWNER), R_DAMAGED, F_CURRENT, N_CURRENT);
  assert(
    !otherDamage.ok && otherDamage.failureKind === "CONCURRENT_MODIFICATION" && browser.writes.length === 0,
    `changed damaged bytes must be refused: ${JSON.stringify(otherDamage)}`
  );
  setCurrent(browser, R_DAMAGED);
  browser.failRead = (key) => key === radarKey(OWNER);
  const unreadable = await restore(validate(v3File(), OWNER), null, F_CURRENT, N_CURRENT);
  browser.failRead = null;
  assert(
    !unreadable.ok && unreadable.failureKind === "STORAGE_ERROR" && browser.writes.length === 0,
    `an unreadable value must stop the restore: ${JSON.stringify(unreadable)}`
  );

  console.log("friend notes backup v3 invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
