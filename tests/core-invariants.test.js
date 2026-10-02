"use strict";

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const product = loadProductFunctions([
  "normalizeStableUid",
  "diffSnapshots",
  "diffFollowerSnapshots",
  "filterFollowerSnapshot",
]);

assert(product.normalizeStableUid(123) === "123", "safe numeric UID rejected");
assert(product.normalizeStableUid(" 123 ") === "123", "canonical string UID rejected");
for (const value of [null, undefined, 0, -1, 1.5, "", "001", "1.0", "1e3", "abc"]) {
  assert(product.normalizeStableUid(value) === null, `unsafe UID accepted: ${String(value)}`);
}
assert(
  product.normalizeStableUid(Number.MAX_SAFE_INTEGER + 1) === null,
  "unsafe large numeric UID accepted"
);

const record = (uid, screenName, followsMe) => ({
  uid,
  screenName,
  following: true,
  followsMe,
  remark: "",
});
const previous = {
  capturedAt: "2026-01-01T00:00:00.000Z",
  records: [record("100", "同名账号", false), record("200", "同名账号", true)],
};
const current = {
  capturedAt: "2026-01-02T00:00:00.000Z",
  records: [record("100", "新昵称", true), record("300", "同名账号", false)],
};
const radarEvents = product.diffSnapshots(previous, current);
const radarTypes = new Map(radarEvents.map((event) => [`${event.type}:${event.subjectUid}`, event]));
for (const key of [
  "VISIBLE_FOLLOWING_ADDED:300",
  "VISIBLE_FOLLOWING_DISAPPEARED:200",
  "SCREEN_NAME_CHANGED:100",
  "FOLLOW_ME_GAINED:100",
]) {
  assert(radarTypes.has(key), `missing UID-based Friend Radar event: ${key}`);
}
assert(radarEvents.length === 4, "nickname equality must not merge different UIDs");

const followerRecord = (uid) => ({ uid, screenName: `粉丝${uid}` });
const followerSnapshot = (capturedAt, records, filter = "FALSE/FALSE") => {
  const [hasFilteredFansState, sinkStrategyState] = filter.split("/");
  return { capturedAt, records, hasFilteredFansState, sinkStrategyState };
};
const followerDiff = product.diffFollowerSnapshots(
  followerSnapshot("2026-01-01T00:00:00.000Z", [followerRecord("10"), followerRecord("20")]),
  followerSnapshot("2026-01-02T00:00:00.000Z", [followerRecord("20"), followerRecord("30")])
);
assert(!followerDiff.suppressed, "stable follower filtering fingerprint suppressed diff");
assert(
  followerDiff.events.some((event) => event.type === "VISIBLE_FOLLOWER_ADDED" && event.uid === "30"),
  "neutral follower appearance event missing"
);
assert(
  followerDiff.events.some(
    (event) => event.type === "VISIBLE_FOLLOWER_DISAPPEARED" && event.uid === "10"
  ),
  "neutral follower disappearance event missing"
);
assert(
  product.diffFollowerSnapshots(
    followerSnapshot("2026-01-01T00:00:00.000Z", [followerRecord("10")]),
    followerSnapshot("2026-01-02T00:00:00.000Z", [followerRecord("10")], "TRUE/FALSE")
  ).suppressed,
  "changed filtering evidence must fail closed"
);

const hygieneSnapshot = {
  records: [
    { uid: "1", statusesCount: null },
    { uid: "2", statusesCount: 0 },
    { uid: "3", statusesCount: 5 },
  ],
};
const hygiene = product.filterFollowerSnapshot(hygieneSnapshot, {
  mode: "ALL",
  statusesMax: "0",
});
assert(
  hygiene.matches.length === 1 && hygiene.matches[0].record.uid === "2",
  "unknown public-post count must not match 公开微博数 ≤ 0"
);

console.log("core product invariants passed");
