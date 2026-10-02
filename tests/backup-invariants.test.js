"use strict";

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { validateBackupText } = loadProductFunctions(["validateBackupText"]);
const ownerUid = "123456";
const otherUid = "654321";
const radarState = {
  schemaVersion: 1,
  ownerUid,
  latestSnapshot: null,
  events: [],
};
const backup = (backupVersion, overrides = {}) => ({
  backupFormat: "weibo-toolkit.friend-radar",
  backupVersion,
  ownerUid,
  state: radarState,
  ...overrides,
});

const v1 = validateBackupText(JSON.stringify(backup(1)), ownerUid);
assert(v1.ok, "valid v1 backup rejected");
assert(v1.followerCovered === false, "v1 must cover Friend Radar only");
assert(v1.followerState === null, "v1 must preserve existing follower state");

const missingFollower = validateBackupText(JSON.stringify(backup(2)), ownerUid);
assert(
  !missingFollower.ok && missingFollower.reason === "MISSING_FOLLOWER_STATE",
  "v2 missing follower coverage must reject the whole file"
);

const v2WithoutSnapshot = validateBackupText(
  JSON.stringify(backup(2, { followerState: null })),
  ownerUid
);
assert(v2WithoutSnapshot.ok && v2WithoutSnapshot.followerCovered, "explicit v2 null coverage rejected");

const malformedFollower = validateBackupText(
  JSON.stringify(backup(2, { followerState: { schemaVersion: 999 } })),
  ownerUid
);
assert(
  !malformedFollower.ok && malformedFollower.reason === "INVALID_FOLLOWER_STATE",
  "malformed v2 follower state must reject the whole file"
);

const wrongOwner = validateBackupText(JSON.stringify(backup(1)), otherUid);
assert(
  !wrongOwner.ok && wrongOwner.reason === "OWNER_UID_MISMATCH",
  "backup owner mismatch must reject"
);

console.log("backup compatibility invariants passed");
