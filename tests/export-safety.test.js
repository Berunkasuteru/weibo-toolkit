"use strict";

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const { buildEventCsv } = loadProductFunctions(["buildEventCsv"]);
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

console.log("CSV export safety invariants passed");
