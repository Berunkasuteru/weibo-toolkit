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
  "deriveUsageHistorySummary",
  "filterOverviewFollowingRecords",
  "matchesFollowerEventQuery",
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

const usageSummary = product.deriveUsageHistorySummary({
  version: 1,
  currentDay: {
    date: "2026-10-26",
    activeSeconds: 600,
    uniquePostIds: ["PostA1", "PostA2"],
  },
  days: {
    "2026-10-25": { activeSeconds: 1200, uniquePosts: 10 },
    "2026-10-24": { activeSeconds: 0, uniquePosts: 0 },
    "2026-10-10": { activeSeconds: 1800, uniquePosts: 25 },
    "2026-09-01": { activeSeconds: 300, uniquePosts: 4 },
  },
});
assert(
  usageSummary.last7Days.activeSeconds === 1800 &&
    usageSummary.last7Days.uniquePosts === 12 &&
    usageSummary.last7Days.activeDays === 2,
  "7-day usage summary must sum today and active days within the 7-day window"
);
assert(
  usageSummary.last30Days.activeSeconds === 3600 &&
    usageSummary.last30Days.uniquePosts === 37 &&
    usageSummary.last30Days.activeDays === 3,
  "30-day usage summary must include days within 30 days and exclude older history"
);
assert(
  JSON.stringify(usageSummary.historyDays.map((day) => day.date)) ===
    JSON.stringify(["2026-10-25", "2026-10-10", "2026-09-01"]),
  "historyDays must be sorted newest first and omit empty zero-activity days"
);

const overviewRecords = [
  { uid: "1001", screenName: "阿岚Lan", following: true, followsMe: true, remark: "摄影师" },
  { uid: "1002", screenName: "老薄", following: true, followsMe: false, remark: "" },
];
assert(
  product.filterOverviewFollowingRecords(overviewRecords, "MUTUAL", "").length === 1 &&
    product.filterOverviewFollowingRecords(overviewRecords, "ONE_WAY", "")[0].uid === "1002" &&
    product.filterOverviewFollowingRecords(overviewRecords, "ALL", "摄影").length === 1,
  "overview following filter must filter by relationship status and remark/name/UID query"
);
assert(
  product.matchesFollowerEventQuery({ uid: "2001", displayName: "海边的岚" }, "海边") === true &&
    product.matchesFollowerEventQuery({ uid: "2001", displayName: "海边的岚" }, "9999") === false,
  "follower event search must match displayName or UID"
);

console.log("core product invariants passed");
