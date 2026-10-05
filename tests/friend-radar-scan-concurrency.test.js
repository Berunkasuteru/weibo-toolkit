"use strict";

const { assert, radarKey, createSharedBrowser, openTab } = require("./friend-notes-fixture");

const OWNER = "1001";
const SUBJECT = "2001";

const pageResponse = (screenName) => ({
  ok: true,
  status: 200,
  url: "https://weibo.com/ajax/friendships/friends",
  headers: { get: () => "application/json; charset=utf-8" },
  text: async () =>
    JSON.stringify({
      ok: 1,
      users: [
        {
          id: Number(SUBJECT),
          idstr: SUBJECT,
          screen_name: screenName,
          following: true,
          follow_me: false,
          remark: "",
        },
      ],
      total_number: 1,
      previous_cursor: 0,
      next_cursor: 0,
    }),
});

// A tab whose single scan request is answered only when the test says so.
function openScanningTab(browser) {
  let answer;
  const requested = new Promise((resolve) => {
    answer = resolve;
  });
  let pending;
  const tab = openTab(browser, ["performUpdate", "loadState"], {
    ownerUid: OWNER,
    context: {
      AbortController,
      fetch: () => {
        requested.started = true;
        return new Promise((resolve) => {
          pending = resolve;
          answer();
        });
      },
    },
  });
  return {
    tab,
    requested,
    respond: (screenName) => pending(pageResponse(screenName)),
  };
}

const storedState = (browser) => JSON.parse(browser.storage.get(radarKey(OWNER)));

(async () => {
  const browser = createSharedBrowser();

  // Baseline: the subject is known under its original name.
  const first = openScanningTab(browser);
  const baselineRun = first.tab.product.performUpdate(null);
  await first.requested;
  first.respond("原始昵称");
  assert((await baselineRun).ok, "the baseline scan must succeed");

  // Tab A reads the old name but its response is delayed. Tab B reads the new
  // name and commits first. A's late, older data must not be saved on top.
  const slow = openScanningTab(browser);
  const fast = openScanningTab(browser);
  const slowRun = slow.tab.product.performUpdate(null);
  await slow.requested;
  const fastRun = fast.tab.product.performUpdate(null);
  await fast.requested;
  fast.respond("更新后的昵称");
  const fastResult = await fastRun;
  assert(fastResult.ok && fastResult.newEvents.length === 1, "the fast scan records the rename");
  const afterFast = browser.storage.get(radarKey(OWNER));
  slow.respond("原始昵称");
  const slowResult = await slowRun;
  assert(
    !slowResult.ok && slowResult.failureKind === "CONCURRENT_MODIFICATION",
    `a scan whose baseline snapshot was replaced must be discarded: ${JSON.stringify(slowResult)}`
  );
  assert(
    browser.storage.get(radarKey(OWNER)) === afterFast,
    "a discarded scan writes nothing: no snapshot rollback, no reverse rename event"
  );

  // Marking events read during a scan is not a snapshot change: the scan is
  // still saved, and the read flag written meanwhile is kept.
  const reader = openScanningTab(browser);
  const readerRun = reader.tab.product.performUpdate(null);
  await reader.requested;
  const marked = storedState(browser);
  marked.events = marked.events.map((event) => ({ ...event, read: true }));
  browser.storage.set(radarKey(OWNER), JSON.stringify(marked));
  reader.respond("第三个昵称");
  const readerResult = await readerRun;
  assert(readerResult.ok, `read-state changes must not discard a scan: ${JSON.stringify(readerResult)}`);
  const finalState = storedState(browser);
  assert(
    finalState.events.length === 2 && finalState.events[0].read === true && finalState.events[1].read === false,
    "the earlier event stays read and the new one is appended"
  );

  // A state that cannot be read fails before any request is sent.
  browser.storage.set(radarKey(OWNER), "{");
  const blocked = openScanningTab(browser);
  const blockedResult = await blocked.tab.product.performUpdate(null);
  assert(
    !blockedResult.ok && blockedResult.failureKind === "STORAGE_ERROR" && blocked.requested.started !== true,
    "an unreadable baseline must stop the scan before the network"
  );

  console.log("friend radar scan concurrency invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
