"use strict";

const {
  assert, radarKey, createSharedBrowser, openTab, createFakeDocument, findButton,
} = require("./friend-notes-fixture");

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
      fetch: (_url, init) => {
        requested.started = true;
        return new Promise((resolve, reject) => {
          pending = resolve;
          if (init && init.signal) {
            if (init.signal.aborted) {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
              return;
            }
            init.signal.addEventListener(
              "abort",
              () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true }
            );
          }
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

async function manualScanCompletionRefreshesHome() {
  for (const module of ["radar", "followers"]) {
    for (const outcome of ["success", "failure", "cancel", "other-view"]) {
      const browser = createSharedBrowser();
      const { document, MutationObserver } = createFakeDocument();
      let answer;
      let rejectRequest;
      let requests = 0;
      const tab = openTab(browser, [
        "updateNow", "updateFollowersNow", "closePanel", "showToolkitHome", "showFriendNotesManager",
        "takeUnseenRadarResult", "takeUnseenFollowerResult",
      ], { ownerUid: OWNER, context: {
        document, MutationObserver, AbortController,
        setTimeout: (callback, ms) => setTimeout(callback, ms === 500 ? 0 : ms),
        fetch: (_href, options) => {
          requests += 1;
          if (requests > 1) return Promise.resolve({
            ok: true, status: 200, headers: { get: () => "application/json" },
            text: async () => JSON.stringify({ ok: 1, users: [], previous_cursor: 1, next_cursor: 0, next_page: 0 }),
          });
          return new Promise((resolve, reject) => {
            answer = resolve;
            rejectRequest = reject;
            options.signal.addEventListener("abort", () => {
              const error = new Error("Aborted");
              error.name = "AbortError";
              reject(error);
            }, { once: true });
          });
        },
      } });
      const run = module === "radar" ? tab.product.updateNow() : tab.product.updateFollowersNow();
      let cancellation;
      if (outcome === "cancel") cancellation = findButton(document.body, "取消").click();
      tab.product.closePanel();
      if (outcome === "other-view") tab.product.showFriendNotesManager();
      else tab.product.showToolkitHome();
      const oldRoot = document.body.querySelector(".wfr-overlay");
      const otherLabel = module === "radar" ? "更新粉丝快照" : "立即更新";
      if (outcome !== "other-view") assert(findButton(oldRoot, otherLabel).disabled, "the other scan is blocked while the manual scan runs");
      if (outcome === "success") {
        if (module === "radar") answer(pageResponse("扫描昵称"));
        else answer({
          ok: true, status: 200, headers: { get: () => "application/json" },
          text: async () => JSON.stringify({
            ok: 1, users: [{ id: 2001, idstr: "2001", screen_name: "粉丝" }],
            previous_cursor: 0, next_cursor: 1, next_page: 2,
          }),
        });
      } else if (outcome !== "cancel") rejectRequest(new Error("simulated read failure"));
      await cancellation;
      await run;
      if (outcome === "other-view") {
        assert(document.body.contains(oldRoot) && oldRoot.textContent.includes("还没有友人档案"),
          "manual completion must not replace a different panel");
      } else {
        assert(!findButton(document.body, "立即更新").disabled && !findButton(document.body, "更新粉丝快照").disabled,
          `${module} ${outcome}: completion re-enables both Home update buttons`);
      }
      const result = module === "radar" ? tab.product.takeUnseenRadarResult(OWNER) : tab.product.takeUnseenFollowerResult(OWNER);
      assert(outcome === "cancel" ? result === null : result !== null && result.ok === (outcome === "success"),
        "refreshing Home preserves the manual outcome and keeps cancellations quiet");
    }
  }
}

(async () => {
  await manualScanCompletionRefreshesHome();
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

  // Manual cancellation aborts the in-flight request and leaves stored state untouched.
  const beforeCancel = browser.storage.get(radarKey(OWNER));
  const cancellable = openScanningTab(browser);
  const cancelController = new AbortController();
  let cancelled = false;
  const cancelRun = cancellable.tab.product.performUpdate(
    null,
    null,
    () => cancelled,
    { cancelSignal: cancelController.signal }
  );
  await cancellable.requested;
  cancelled = true;
  cancelController.abort();
  const cancelResult = await cancelRun;
  assert(
    !cancelResult.ok && cancelResult.failureKind === "RADAR_SCAN_CANCELLED",
    `manual cancellation must return RADAR_SCAN_CANCELLED: ${JSON.stringify(cancelResult)}`
  );
  assert(
    browser.storage.get(radarKey(OWNER)) === beforeCancel,
    "manual cancellation must not modify stored Friend Radar state"
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
