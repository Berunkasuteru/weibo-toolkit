"use strict";

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const {
  buildEventCsv,
  buildExportCsv,
  buildExportMarkdownTable,
  buildFollowerEventExportRows,
  buildFollowerEventExportMarkdown,
  buildOverviewExportRows,
  buildOverviewExportMarkdown,
  OVERVIEW_EXPORT_COLUMNS,
  FOLLOWER_EVENT_EXPORT_COLUMNS,
} = loadProductFunctions([
  "buildEventCsv",
  "buildExportCsv",
  "buildExportMarkdownTable",
  "buildFollowerEventExportRows",
  "buildFollowerEventExportMarkdown",
  "buildOverviewExportRows",
  "buildOverviewExportMarkdown",
  "OVERVIEW_EXPORT_COLUMNS",
  "FOLLOWER_EVENT_EXPORT_COLUMNS",
]);
const events = [
  {
    id: "event-1",
    type: "SCREEN_NAME_CHANGED",
    detectedAt: "2026-01-02T00:00:00.000Z",
    subjectUid: "100",
    displayName: "=SUM(A1:A9)",
    read: false,
    previous: { screenName: "+旧昵称" },
    current: { screenName: "-新昵称" },
  },
  {
    id: "event-2",
    type: "FOLLOW_ME_GAINED",
    detectedAt: "2026-01-01T00:00:00.000Z",
    subjectUid: "200",
    displayName: "@提醒用户",
    read: true,
    previous: { followsMe: false },
    current: { followsMe: true },
  },
];
const csv = buildEventCsv(events);
assert(csv.charCodeAt(0) === 0xfeff, "CSV must keep its UTF-8 BOM");
for (const formula of ["'=SUM(A1:A9)", "'+旧昵称", "'-新昵称", "'@提醒用户"]) {
  assert(csv.includes(formula), `spreadsheet formula prefix was not neutralized: ${formula}`);
}
assert(!csv.includes('"=SUM(A1:A9)"'), "raw formula-capable nickname leaked into CSV");
assert(csv.endsWith("\r\n"), "CSV must retain CRLF row termination");

const sampleFollowerEvents = [
  {
    id: "fe-1",
    type: "VISIBLE_FOLLOWER_ADDED",
    observedAt: "2026-01-03T00:00:00.000Z",
    uid: "300",
    displayName: "=cmd|' /C calc'!A0\nline2",
  },
];
const sampleNotes = {
  "300": { note: "@danger|pipe\\slash\nline2", tags: ["+tag1", "普通标签"] },
};
const followerRows = buildFollowerEventExportRows(sampleFollowerEvents);
const followerCsv = buildExportCsv(FOLLOWER_EVENT_EXPORT_COLUMNS, followerRows);
assert(followerCsv.charCodeAt(0) === 0xfeff, "follower CSV must keep UTF-8 BOM");
assert(
  followerCsv.includes("'=cmd") && !followerCsv.includes('"=cmd'),
  "follower CSV must neutralize spreadsheet formulas in nickname"
);
const followerMd = buildFollowerEventExportMarkdown(
  "1001",
  sampleFollowerEvents,
  new Date("2026-01-03T00:00:00.000Z")
);
assert(
  followerMd.includes("账号 UID：1001") &&
    followerMd.includes("=cmd\\|' /C calc'!A0 line2"),
  "follower Markdown export must escape pipes and newlines"
);

const overviewRecords = [
  {
    uid: "300",
    screenName: "-evilName|bar\\baz",
    remark: "+evilRemark",
    following: true,
    followsMe: false,
  },
];
const overviewRows = buildOverviewExportRows(overviewRecords, sampleNotes);
const overviewCsv = buildExportCsv(OVERVIEW_EXPORT_COLUMNS, overviewRows);
assert(overviewCsv.charCodeAt(0) === 0xfeff, "overview CSV must keep UTF-8 BOM");
assert(
  overviewCsv.includes("'-evilName|bar\\baz") &&
    overviewCsv.includes("'+evilRemark") &&
    overviewCsv.includes("'+tag1") &&
    overviewCsv.includes("'@danger|pipe\\slash"),
  "overview CSV must neutralize formula-capable nicknames, remarks, tags, and Friend Notes"
);
const overviewMd = buildOverviewExportMarkdown(
  "1001",
  overviewRecords,
  sampleNotes,
  new Date("2026-01-03T00:00:00.000Z")
);
assert(
  overviewMd.includes("当前筛选账号数：1") &&
    overviewMd.includes("-evilName\\|bar\\\\baz") &&
    overviewMd.includes("@danger\\|pipe\\\\slash line2") &&
    overviewMd.includes("+tag1、普通标签"),
  "overview Markdown export must escape Markdown cells cleanly and include Friend Notes"
);

console.log("CSV export safety invariants passed");
