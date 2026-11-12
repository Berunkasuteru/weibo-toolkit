"use strict";

const {
  assert, radarKey, followerKey, createSharedBrowser, openTab, createFakeDocument, findButton,
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

async function totalNumberDriftAndCeiling() {
  const mkPage = (users, total, prevCursor, nextCursor) => ({
    ok: true,
    status: 200,
    url: "https://weibo.com/ajax/friendships/friends",
    headers: { get: () => "application/json; charset=utf-8" },
    text: async () => JSON.stringify({
      ok: 1,
      users: users.map(([uid, screenName]) => ({
        id: Number(uid), idstr: uid, screen_name: screenName,
        following: true, follow_me: true, remark: "",
      })),
      total_number: total,
      previous_cursor: prevCursor,
      next_cursor: nextCursor,
    }),
  });

  // Upward total_number drift across valid pages succeeds with changed flag.
  {
    const browser = createSharedBrowser();
    let page = 0;
    const tab = openTab(browser, ["performUpdate", "MAX_REQUESTS", "FOLLOWER_MAX_DATA_PAGES"], {
      ownerUid: OWNER,
      context: {
        AbortController,
        setTimeout: (cb, ms) => setTimeout(cb, ms === 750 ? 0 : ms),
        fetch: async () => {
          page += 1;
          return page === 1
            ? mkPage([["2001", "甲"]], 2, 0, 2)
            : mkPage([["2002", "乙"]], 3, 2, 0);
        },
      },
    });
    assert(
      tab.product.MAX_REQUESTS === 500 && tab.product.FOLLOWER_MAX_DATA_PAGES === 500,
      "both following and follower safety ceilings are raised to 500 pages"
    );
    const result = await tab.product.performUpdate(null);
    assert(
      result.ok &&
        result.reportedTotalChanged === true &&
        result.snapshot.reportedTotal === 3 &&
        result.snapshot.visibleCount === 2 &&
        result.snapshot.unresolvedRelationCount === 1,
      `upward total drift finishes cleanly: ${JSON.stringify(result)}`
    );
  }

  // Slight downward drift (2 -> 1) while 2 distinct users were seen stays valid.
  {
    const browser = createSharedBrowser();
    let page = 0;
    const tab = openTab(browser, ["performUpdate"], {
      ownerUid: OWNER,
      context: {
        AbortController,
        setTimeout: (cb, ms) => setTimeout(cb, ms === 750 ? 0 : ms),
        fetch: async () => {
          page += 1;
          return page === 1
            ? mkPage([["2001", "甲"]], 2, 0, 2)
            : mkPage([["2002", "乙"]], 1, 2, 0);
        },
      },
    });
    const result = await tab.product.performUpdate(null);
    assert(
      result.ok &&
        result.reportedTotalChanged === true &&
        result.snapshot.reportedTotal === 2 &&
        result.snapshot.visibleCount === 2 &&
        result.snapshot.unresolvedRelationCount === 0,
      `downward total drift bounded by observed max keeps valid snapshot: ${JSON.stringify(result)}`
    );
  }

  // Collecting more distinct records than ANY reported total still fails closed.
  {
    const browser = createSharedBrowser();
    const tab = openTab(browser, ["performUpdate"], {
      ownerUid: OWNER,
      context: {
        AbortController,
        fetch: async () => mkPage([["2001", "甲"], ["2002", "乙"]], 1, 0, 0),
      },
    });
    const result = await tab.product.performUpdate(null);
    assert(
      !result.ok &&
        result.failureKind === "PAGINATION_FAILURE" &&
        result.reason === "VISIBLE_COUNT_EXCEEDS_REPORTED_TOTAL",
      `unbounded excess records still fail closed: ${JSON.stringify(result)}`
    );
  }
}

async function manualAllUpdateTests() {
  const mkFollowerPage = (users, prevCursor, nextCursor, nextPage) => ({
    ok: true,
    status: 200,
    url: "https://weibo.com/ajax/friendships/friends?relate=fans",
    headers: { get: () => "application/json; charset=utf-8" },
    text: async () =>
      JSON.stringify({
        ok: 1,
        users,
        previous_cursor: prevCursor,
        next_cursor: nextCursor,
        next_page: nextPage,
      }),
  });

  // 1) Sequential happy path from Home + reopening progress during Stage 1/2.
  {
    const browser = createSharedBrowser();
    const { document, MutationObserver } = createFakeDocument();
    const callOrder = [];
    let resolveStage1;
    let resolveStage2Page1;
    let stage1StartedResolve;
    const stage1Started = new Promise((resolve) => {
      stage1StartedResolve = resolve;
    });
    let stage2StartedResolve;
    const stage2Started = new Promise((resolve) => {
      stage2StartedResolve = resolve;
    });
    const tab = openTab(browser, [
      "showToolkitHome",
      "closePanel",
      "updateAllNow",
      "takeUnseenAllResult",
      "showFriendNotesManager",
    ], {
      ownerUid: OWNER,
      context: {
        document,
        MutationObserver,
        AbortController,
        setTimeout: (cb, ms) => setTimeout(cb, ms === 500 || ms === 750 ? 0 : ms),
        fetch: (url, options) => {
          const isFollower = String(url).includes("relate=fans");
          if (isFollower) {
            const parsed = new URL(url, "https://weibo.com");
            const page = Number(parsed.searchParams.get("page") || "1");
            callOrder.push(`followers:${page}`);
            if (page > 1) {
              return Promise.resolve(mkFollowerPage([], 1, 0, 0));
            }
            return new Promise((resolve, reject) => {
              resolveStage2Page1 = resolve;
              stage2StartedResolve();
              options.signal.addEventListener(
                "abort",
                () => {
                  const err = new Error("Aborted");
                  err.name = "AbortError";
                  reject(err);
                },
                { once: true }
              );
            });
          }
          callOrder.push("radar:1");
          return new Promise((resolve, reject) => {
            resolveStage1 = resolve;
            stage1StartedResolve();
            options.signal.addEventListener(
              "abort",
              () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true }
            );
          });
        },
      },
    });

    tab.product.showToolkitHome();
    assert(
      !findButton(document.body, "一键全部更新").disabled &&
        !findButton(document.body, "立即更新").disabled &&
        !findButton(document.body, "更新粉丝快照").disabled,
      "Home starts with all update buttons enabled"
    );

    findButton(document.body, "一键全部更新").click();
    await stage1Started;
    assert(
      document.body.textContent.includes("第 1 / 2 步") &&
        callOrder.length === 1 &&
        callOrder[0] === "radar:1",
      "all-update starts with Friend Radar stage before any follower request"
    );

    // Return to Home while Stage 1 runs: single updates disabled, no false auto-update text.
    tab.product.closePanel();
    tab.product.showToolkitHome();
    assert(
      findButton(document.body, "查看进度") !== null &&
        findButton(document.body, "立即更新").disabled &&
        findButton(document.body, "更新粉丝快照").disabled &&
        !document.body.textContent.includes("后台自动更新正在进行"),
      "Home blocks single-module updates and shows 查看进度 during 一键全部更新"
    );

    findButton(document.body, "查看进度").click();
    assert(
      document.body.textContent.includes("第 1 / 2 步"),
      "reopening progress during Stage 1 resumes Stage 1 view"
    );

    resolveStage1(pageResponse("关注昵称"));
    await stage2Started;
    assert(
      callOrder[1] === "followers:1" &&
        browser.storage.has(radarKey(OWNER)) &&
        document.body.textContent.includes("第 2 / 2 步") &&
        document.body.textContent.includes("第 1 步已完成"),
      "Stage 2 starts only after Stage 1 saves and transitions progress to step 2"
    );

    resolveStage2Page1(
      mkFollowerPage([{ id: 2001, idstr: "2001", screen_name: "粉丝甲" }], 0, 1, 2)
    );
    // Allow Stage 2 terminal verification page + persistence to finish.
    for (let i = 0; i < 15 && !document.body.textContent.includes("一键全部更新完成"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(
      document.body.textContent.includes("一键全部更新完成") &&
        document.body.textContent.includes("1. 关系雷达") &&
        document.body.textContent.includes("2. 粉丝快照") &&
        findButton(document.body, "查看事件") !== null &&
        findButton(document.body, "查看粉丝变化") !== null &&
        browser.storage.has(followerKey(OWNER)),
      "combined summary displays both stages and persists both baselines"
    );
  }

  // 2) Cancellation during Stage 1 stops before Stage 2; cancellation during Stage 2 keeps Stage 1.
  for (const cancelStage of [1, 2]) {
    const browser = createSharedBrowser();
    const { document, MutationObserver } = createFakeDocument();
    let followerCalls = 0;
    let resolveStage1;
    let stage1StartedResolve;
    const stage1Started = new Promise((resolve) => {
      stage1StartedResolve = resolve;
    });
    let stage2StartedResolve;
    const stage2Started = new Promise((resolve) => {
      stage2StartedResolve = resolve;
    });
    const tab = openTab(browser, ["updateAllNow", "closePanel", "showToolkitHome"], {
      ownerUid: OWNER,
      context: {
        document,
        MutationObserver,
        AbortController,
        setTimeout: (cb, ms) => setTimeout(cb, ms === 500 || ms === 750 ? 0 : ms),
        fetch: (url, options) => {
          const isFollower = String(url).includes("relate=fans");
          return new Promise((resolve, reject) => {
            if (isFollower) {
              followerCalls += 1;
              stage2StartedResolve();
            } else {
              resolveStage1 = resolve;
              stage1StartedResolve();
            }
            options.signal.addEventListener(
              "abort",
              () => {
                const err = new Error("Aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true }
            );
          });
        },
      },
    });
    const run = tab.product.updateAllNow();
    await stage1Started;
    if (cancelStage === 1) {
      findButton(document.body, "取消").click();
      await run;
      assert(
        followerCalls === 0 &&
          !browser.storage.has(radarKey(OWNER)) &&
          !browser.storage.has(followerKey(OWNER)) &&
          document.body.textContent.includes("一键全部更新已取消"),
        "cancelling Stage 1 aborts before follower stage and writes neither state"
      );
    } else {
      resolveStage1(pageResponse("已保存关注"));
      await stage2Started;
      findButton(document.body, "取消").click();
      await run;
      assert(
        followerCalls === 1 &&
          browser.storage.has(radarKey(OWNER)) &&
          !browser.storage.has(followerKey(OWNER)) &&
          document.body.textContent.includes("一键全部更新部分完成") &&
          document.body.textContent.includes("第 1 步关系雷达已完成并保存，第 2 步粉丝快照已取消"),
        "cancelling Stage 2 keeps saved Stage 1 radar snapshot while leaving follower baseline untouched"
      );
    }
  }

  // 3) Failure during Stage 1 stops before Stage 2; closing back to Home exposes 查看结果 & unseen state.
  {
    const browser = createSharedBrowser();
    const { document, MutationObserver } = createFakeDocument();
    let followerCalls = 0;
    const tab = openTab(browser, ["updateAllNow"], {
      ownerUid: OWNER,
      context: {
        document,
        MutationObserver,
        AbortController,
        setTimeout: (cb, ms) => setTimeout(cb, ms === 500 || ms === 750 ? 0 : ms),
        fetch: async (url) => {
          if (String(url).includes("relate=fans")) followerCalls += 1;
          throw new Error("network down");
        },
      },
    });
    await tab.product.updateAllNow();
    assert(
      followerCalls === 0 && document.body.textContent.includes("一键全部更新失败"),
      "Stage 1 failure prevents Stage 2 from starting"
    );
  }

  {
    const browser = createSharedBrowser();
    const { document, MutationObserver } = createFakeDocument();
    let resolveStage1;
    let resolveStage2;
    let stage1StartedResolve;
    const stage1Started = new Promise((resolve) => {
      stage1StartedResolve = resolve;
    });
    let stage2StartedResolve;
    const stage2Started = new Promise((resolve) => {
      stage2StartedResolve = resolve;
    });
    const tab = openTab(browser, [
      "showToolkitHome",
      "closePanel",
      "updateAllNow",
      "takeUnseenAllResult",
    ], {
      ownerUid: OWNER,
      context: {
        document,
        MutationObserver,
        AbortController,
        setTimeout: (cb, ms) => setTimeout(cb, ms === 500 || ms === 750 ? 0 : ms),
        fetch: (url) => {
          if (String(url).includes("relate=fans")) {
            const parsed = new URL(url, "https://weibo.com");
            if (Number(parsed.searchParams.get("page") || "1") > 1) {
              return Promise.resolve(mkFollowerPage([], 1, 0, 0));
            }
            return new Promise((resolve) => {
              resolveStage2 = resolve;
              stage2StartedResolve();
            });
          }
          return new Promise((resolve) => {
            resolveStage1 = resolve;
            stage1StartedResolve();
          });
        },
      },
    });
    const run = tab.product.updateAllNow();
    await stage1Started;
    tab.product.closePanel();
    tab.product.showToolkitHome();
    resolveStage1(pageResponse("背景完成"));
    await stage2Started;
    resolveStage2(
      mkFollowerPage([{ id: 2001, idstr: "2001", screen_name: "粉丝乙" }], 0, 1, 2)
    );
    await run;
    assert(
      !findButton(document.body, "一键全部更新").disabled &&
        !findButton(document.body, "立即更新").disabled &&
        !findButton(document.body, "更新粉丝快照").disabled &&
        findButton(document.body, "查看结果") !== null,
      "open Home refreshes with 查看结果 and re-enables all buttons on background completion"
    );
    findButton(document.body, "查看结果").click();
    assert(
      document.body.textContent.includes("一键全部更新完成") &&
        tab.product.takeUnseenAllResult(OWNER) === null,
      "clicking 查看结果 opens combined summary and consumes unseen result"
    );
  }
}

(async () => {
  await manualScanCompletionRefreshesHome();
  await manualAllUpdateTests();
  await totalNumberDriftAndCeiling();
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
