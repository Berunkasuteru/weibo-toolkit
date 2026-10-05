"use strict";

const {
  assert, followerKey, createSharedBrowser, openTab, createFakeDocument, findAll, findButton,
} = require("./friend-notes-fixture");

const OWNER = "1001";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const response = (body) => ({
  ok: true, status: 200,
  headers: { get: () => "application/json" },
  text: async () => body,
});

function openHygiene() {
  const browser = createSharedBrowser();
  const { document, MutationObserver } = createFakeDocument();
  document.cookie = "XSRF-TOKEN=test-token";
  // The shared DOM only models the methods its earlier tests need. Card updates
  // need native replaceChild semantics; add that method here, without a fixture.
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const node = createElement(tag);
    node.replaceChild = function (next, previous) {
      const index = this.childNodes.indexOf(previous);
      assert(index >= 0, "the replaced card must still be attached");
      next.detach();
      previous.parentNode = null;
      next.parentNode = this;
      this.childNodes[index] = next;
      return previous;
    };
    return node;
  };
  const records = Array.from({ length: 60 }, (_, index) => ({
    uid: String(2001 + index), screenName: `粉丝${2001 + index}`,
    ownerFollowing: false, followMe: true, followersCount: 0, friendsCount: 0,
    statusesCount: 0, createdAt: null, verified: false, verifiedType: -1,
    sourceText: null, optionalMetadataConflict: false,
  }));
  browser.storage.set(followerKey(OWNER), JSON.stringify({
    schemaVersion: 1, ownerUid: OWNER, events: [], latestSnapshot: {
      schemaVersion: 1, ownerUid: OWNER, capturedAt: "2026-10-06T00:00:00.000Z",
      completion: "COMPLETE_API_VISIBLE", pageSizeRequested: 20, dataPagesRead: 3,
      terminalVerificationRequests: 1, requestsMade: 4, rawRecordCount: 60,
      uniqueRecordCount: 60, crossPageDuplicateCount: 0,
      hasFilteredFansState: "FALSE", sinkStrategyState: "FALSE",
      filteredVisibilityObserved: false, optionalMetadataConflictObserved: false,
      totalNumber: 60, displayTotalNumber: 60, followersCount: 60,
      terminalEvidence: { page: 4, recordCount: 0, previousCursor: 60, nextCursor: 0, nextPage: 0 },
      records,
    },
  }));
  const calls = [];
  const menus = new Map();
  const tab = openTab(browser, [
    "showFollowerHygiene", "closePanel", "registerMenuCommands",
    "observeHygieneState: (observe) => { const build = buildFollowerHygieneCard; buildFollowerHygieneCard = (match, state) => { observe(state); return build(match, state); }; }",
  ], {
    ownerUid: OWNER,
    context: {
      document, MutationObserver,
      unsafeWindow: {
        $CONFIG: { uid: OWNER }, $VERSION: { CLIENT: "test", SERVER: "test" },
        navigator: { locks: browser.lockManager },
      },
      GM_registerMenuCommand: (label, callback) => menus.set(label, callback),
      fetch(href, options) {
        assert(new URL(href).pathname === "/ajax/profile/destroyFollowers", "only a removal is expected");
        assert(options.method === "POST", "removals must stay POST requests");
        return new Promise((resolve) => calls.push({ uid: options.body.get("uid"), resolve }));
      },
      setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds === 3000 ? 0 : milliseconds),
    },
  });
  let removalState;
  // Observe a real renderer argument, without replacing its UI or algorithms.
  tab.product.observeHygieneState((state) => { removalState = state; });
  tab.product.registerMenuCommands();
  tab.product.showFollowerHygiene();
  const cards = () => findAll(document.body, (node) => node.tagName === "ARTICLE");
  const checkbox = (card) => findAll(card, (node) => node.tagName === "INPUT" && node.type === "checkbox")[0];
  const overlay = () => findAll(document.body, (node) => node.classList.contains("wfr-overlay"))[0];
  const count = () => findAll(document.body, (node) => node.classList.contains("wfr-selection-count"))[0].textContent;
  const filter = findAll(document.body, (node) => node.tagName === "LABEL" && node.textContent === "未关注 TA")[0].childNodes[0];
  return { browser, document, tab, calls, menus, cards, checkbox, overlay, count, filter,
    state: () => removalState };
}

async function selectAcrossPages(view) {
  view.filter.checked = true;
  await view.filter.dispatch("change");
  let input = view.checkbox(view.cards()[0]);
  input.checked = true;
  await input.dispatch("change");
  await findButton(view.document.body, "下一页").click();
  input = view.checkbox(view.cards()[0]);
  input.checked = true;
  await input.dispatch("change");
  assert(view.count() === "已选择：2 / 200", "both reviewed pages contribute to the selection");
  return input;
}

async function heldBatchCanBeStopped() {
  const view = openHygiene();
  const oldInput = await selectAcrossPages(view);
  await findButton(view.document.body, "移除所选粉丝").click();
  const held = view.overlay();
  const running = findButton(view.document.body, "确认移除 2 个").click();
  await tick();
  assert(view.calls.length === 1 && view.calls[0].uid === "2001", "only the first POST is in flight");
  view.tab.product.closePanel();
  view.menus.get("Weibo Toolkit：打开工具箱")();
  assert(view.overlay() === held, "closePanel and the registered GM menu cannot replace a running batch");
  assert(view.cards().every((card) => !view.checkbox(card)), "running cards expose no selectable checkbox");
  oldInput.checked = false;
  await oldInput.dispatch("change");
  assert(view.count() === "已选择：2 / 200", "a queued event from an old checkbox cannot change the selection");
  const stop = findButton(held, "停止后续操作");
  for (let node = stop; node; node = node.parentNode) assert(!node.hidden, "the stop control stays visible");
  assert(!stop.disabled && view.document.body.contains(stop), "the stop control remains attached and usable");
  await stop.click();
  view.calls[0].resolve(response('{"ok":1}'));
  await running;
  assert(view.calls.length === 1, "stop prevents the remaining POST");
  assert(view.count() === "已选择：1 / 200" && view.checkbox(view.cards()[0]).checked,
    "the unexecuted account stays selected, including after the stale checkbox event");
  view.tab.product.closePanel();
  assert(!view.overlay(), "completion releases the panel exit lock");
}

async function uncertainSingleInvalidatesBatch() {
  const view = openHygiene();
  await selectAcrossPages(view);
  await findButton(view.document.body, "移除所选粉丝").click();
  const oldConfirm = findButton(view.document.body, "确认移除 2 个");
  await findButton(view.cards()[0], "移除粉丝").click();
  const single = findButton(view.cards()[0], "确认移除").click();
  await tick();
  assert(view.calls.length === 1 && view.calls[0].uid === "2051", "the single request targets the reviewed card");
  view.calls[0].resolve(response("malformed JSON"));
  await single;
  assert(view.cards()[0].textContent.includes("结果待确认"), "unknown results quarantine the card");
  assert(!view.document.body.contains(oldConfirm), "the earlier batch confirmation is invalidated");
  const stale = oldConfirm.click();
  await tick();
  assert(view.calls.length === 1, "a detached old confirmation cannot retry the uncertain UID");
  await stale;
  await findButton(view.document.body, "移除所选粉丝").click();
  const current = findAll(view.document.body, (node) => node.classList.contains("wfr-confirm-list"))[0];
  assert(current.textContent.includes("粉丝2001") && !current.textContent.includes("粉丝2051"),
    "the new plan includes only the remaining eligible selection");
}

async function finalConfirmationRechecksState() {
  for (const changed of ["selection", "eligibility"]) {
    const view = openHygiene();
    await selectAcrossPages(view);
    await findButton(view.document.body, "移除所选粉丝").click();
    const confirm = findButton(view.document.body, "确认移除 2 个");
    // Bypass the normal UI invalidation deliberately: the final guard must also
    // protect a still-attached confirmation if its captured plan became stale.
    if (changed === "selection") view.state().selectedUids.delete("2051");
    else view.state().uncertainRemovalUids.add("2051");
    const attempted = confirm.click();
    await tick();
    assert(view.calls.length === 0, `${changed} changes must be rechecked before any POST`);
    await attempted;
    assert(!view.document.body.contains(confirm), "a stale plan is replaced by another preview");
    findButton(view.document.body, "确认移除 1 个");
    const current = findAll(view.document.body, (node) => node.classList.contains("wfr-confirm-list"))[0];
    assert(current.textContent.includes("粉丝2001") && !current.textContent.includes("粉丝2051"),
      "the new preview contains only currently selected, eligible accounts");
  }
}

(async () => {
  await heldBatchCanBeStopped();
  await uncertainSingleInvalidatesBatch();
  await finalConfirmationRechecksState();
  console.log("follower removal UI safety invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
