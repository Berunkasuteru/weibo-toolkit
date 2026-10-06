"use strict";

const {
  assert, followerKey, notesKey, createSharedBrowser, openTab, createFakeDocument, findAll, findButton,
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
  const runningBars = () => findAll(view.document.body, (node) => node.classList.contains("wfr-selection-bar-running"));
  assert(runningBars().length === 1, "a running batch marks its bar, so it keeps floating in a small window");
  await stop.click();
  view.calls[0].resolve(response('{"ok":1}'));
  await running;
  assert(view.calls.length === 1, "stop prevents the remaining POST");
  const kept = view.cards().find((card) => card.textContent.includes("粉丝2051"));
  assert(view.count() === "已选择：1 / 200" && kept && view.checkbox(kept).checked,
    "the unexecuted account stays selected, including after the stale checkbox event");
  assert(!view.cards().some((card) => card.textContent.includes("粉丝2001")),
    "the removed account drops out of the list without a new snapshot");
  assert(
    findAll(view.document.body, (node) => node.tagName === "BUTTON" && node.textContent === "选满下一批并预览").length === 0,
    "a batch the user stopped does not offer the next-batch shortcut"
  );
  assert(runningBars().length === 0, "the mark is gone once the batch has ended");
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

// Filling the selection takes accounts in result order, across pages, and what
// it selected is exactly what the confirmation then lists.
async function fillSelectsInResultOrder() {
  const view = openHygiene();
  view.filter.checked = true;
  await view.filter.dispatch("change");
  await findButton(view.document.body, "按顺序选满").click();
  assert(view.count() === "已选择：60 / 200", "every eligible match is selected, not only the visible page");
  assert(view.cards().every((card) => view.checkbox(card).checked), "visible cards reflect the filled selection");
  await findButton(view.document.body, "移除所选粉丝").click();
  const names = findAll(view.document.body, (node) => node.tagName === "LI").map((node) => node.textContent);
  assert(
    names.length === 60 && names[0] === "粉丝2001" && names[59] === "粉丝2060",
    "the confirmation lists every filled account in result order"
  );
  assert(view.calls.length === 0, "filling and previewing send nothing");
}

// A saved filter set decides which accounts get selected, so a stored value is
// never applied as found: it is normalised again, and malformed entries are
// dropped rather than guessed at.
async function presetsAreSavedAndNormalised() {
  const view = openHygiene();
  const key = "weiboToolkit.followerHygienePresets.v1." + OWNER;
  view.filter.checked = true;
  await view.filter.dispatch("change");
  const name = findAll(view.document.body, (node) => node.tagName === "INPUT" && node.placeholder === "方案名称")[0];
  name.value = "未关注";
  await findButton(view.document.body, "保存当前条件").click();
  const saved = JSON.parse(view.browser.storage.get(key)).presets;
  assert(
    saved.length === 1 && saved[0].name === "未关注" && saved[0].filters.ownerNotFollowing === true &&
      !("activeCount" in saved[0].filters),
    `the current conditions are stored under the given name: ${JSON.stringify(saved)}`
  );

  const browser = createSharedBrowser();
  browser.storage.set(key, JSON.stringify({ schemaVersion: 1, presets: [
    { name: "坏数据", filters: { mode: "NOPE", followersMax: "-5", statusesMax: "12", createdAfter: "2026-13-40", sourceCategories: "x", unverified: "yes" } },
    { name: "坏数据", filters: {} },
    { name: "", filters: {} },
    { name: "名".repeat(21), filters: {} },
    "not an object",
  ] }));
  const { loadHygienePresets } = openTab(browser, ["loadHygienePresets"], { ownerUid: OWNER }).product;
  const loaded = loadHygienePresets(OWNER);
  assert(loaded.length === 1 && loaded[0].name === "坏数据", `malformed and duplicate entries are dropped: ${JSON.stringify(loaded)}`);
  const filters = loaded[0].filters;
  assert(
    filters.mode === "ALL" && filters.followersMax === null && filters.statusesMax === 12 &&
      filters.createdAfter === null && filters.unverified === false && filters.sourceCategories.length === 0,
    `stored conditions are normalised, never applied as found: ${JSON.stringify(filters)}`
  );
  browser.storage.set(key, "{broken");
  assert(loadHygienePresets(OWNER).length === 0, "an unreadable preset list is an empty one");

  // Another tab saved meanwhile. This panel still holds the list it read when
  // it was opened; saving must add to the stored list, not write the old one back.
  const stored = () => JSON.parse(view.browser.storage.get(key)).presets.map((preset) => preset.name);
  const other = (label) => ({ name: label, filters: { unverified: true } });
  view.browser.storage.set(key, JSON.stringify({ schemaVersion: 1, presets: [...saved, other("另一个标签页的方案")] }));
  name.value = "第二个方案";
  await findButton(view.document.body, "保存当前条件").click();
  assert(
    JSON.stringify(stored()) === JSON.stringify(["未关注", "另一个标签页的方案", "第二个方案"]),
    `a save keeps what another tab stored: ${JSON.stringify(stored())}`
  );
  // A name this panel has never seen but another tab has just used is not replaced.
  const before = view.browser.storage.get(key);
  view.browser.storage.set(key, JSON.stringify({ schemaVersion: 1, presets: [...JSON.parse(before).presets, other("撞名方案")] }));
  const clashed = view.browser.storage.get(key);
  name.value = "撞名方案";
  await findButton(view.document.body, "保存当前条件").click();
  assert(view.browser.storage.get(key) === clashed, "a same-named set from another tab is not silently overwritten");
}

// After a batch the removed accounts leave the list by themselves, so the next
// batch can be picked without a new snapshot; and they stay out after the panel
// is reopened, because the snapshot still lists them.
async function nextBatchNeedsNoNewSnapshot() {
  const view = openHygiene();
  const names = () => view.cards().map((card) => card.textContent);
  const listed = (uid) => names().some((text) => text.includes("粉丝" + uid));
  view.filter.checked = true;
  await view.filter.dispatch("change");
  for (const index of [0, 1]) {
    const input = view.checkbox(view.cards()[index]);
    input.checked = true;
    await input.dispatch("change");
  }
  await findButton(view.document.body, "移除所选粉丝").click();
  const running = findButton(view.document.body, "确认移除 2 个").click();
  for (let done = 0; done < 2; done += 1) {
    while (view.calls.length <= done) await tick();
    view.calls[done].resolve(response('{"ok":1}'));
  }
  await running;
  assert(view.calls.length === 2, "both selected accounts were sent");
  assert(!listed(2001) && !listed(2002) && listed(2003), "removed accounts drop out and the next ones move up");
  assert(view.count() === "已选择：0 / 200", "nothing is left selected after a clean batch");
  // Removal cannot be undone, so each confirmed one leaves a local line.
  for (let turn = 0; turn < 5; turn += 1) await tick();
  const log = JSON.parse(view.browser.storage.get("weiboToolkit.followerRemovalLog.v1." + OWNER));
  assert(
    log.ownerUid === OWNER && log.entries.length === 2 &&
      log.entries.map((entry) => entry.screenName).sort().join() === "粉丝2001,粉丝2002" &&
      log.entries.every((entry) => Number.isFinite(Date.parse(entry.removedAt))),
    `confirmed removals are logged with name and time: ${JSON.stringify(log)}`
  );

  await findButton(view.document.body, "选满下一批并预览").click();
  const preview = findAll(view.document.body, (node) => node.tagName === "LI").map((node) => node.textContent);
  assert(
    preview.length === 58 && preview[0] === "粉丝2003" && !preview.includes("粉丝2001"),
    "the next batch is drawn from what is left, and is only a preview"
  );
  assert(view.calls.length === 2, "previewing the next batch sends nothing");

  await findButton(view.document.body, "取消").click();
  view.tab.product.closePanel();
  view.tab.product.showFollowerHygiene();
  const filter = findAll(view.document.body, (node) => node.tagName === "LABEL" && node.textContent === "未关注 TA")[0].childNodes[0];
  filter.checked = true;
  await filter.dispatch("change");
  assert(!listed(2001) && !listed(2002) && listed(2003), "a reopened panel still leaves the removed accounts out");
}

// The bulk selectors leave alone the accounts the user has written a note
// about. One of them can still be ticked by hand, and the confirmation says
// which it is.
async function bulkSelectionSkipsProtectedAccounts() {
  const view = openHygiene();
  const T = "2026-09-01T08:00:00.000Z";
  view.browser.storage.set(notesKey(OWNER), JSON.stringify({
    schemaVersion: 1, ownerUid: OWNER,
    notes: { 2002: { note: "老同学", tags: [], createdAt: T, updatedAt: T } },
  }));
  view.filter.checked = true;
  await view.filter.dispatch("change");
  const noted = () => view.cards().find((card) => card.textContent.includes("粉丝2002"));
  assert(noted().textContent.includes("有友人档案"), "the card says why bulk selection skips it");
  await findButton(view.document.body, "选择当前页").click();
  assert(view.count() === "已选择：49 / 200" && !view.checkbox(noted()).checked, "select-page skips the noted account");
  await findButton(view.document.body, "清除选择").click();
  await findButton(view.document.body, "按顺序选满").click();
  assert(view.count() === "已选择：59 / 200" && !view.checkbox(noted()).checked, "fill skips the noted account");
  const input = view.checkbox(noted());
  input.checked = true;
  await input.dispatch("change");
  assert(view.count() === "已选择：60 / 200", "a protected account can still be ticked by hand");
  await findButton(view.document.body, "移除所选粉丝").click();
  const names = findAll(view.document.body, (node) => node.tagName === "LI").map((node) => node.textContent);
  assert(names.includes("粉丝2002（有友人档案）"), "the confirmation marks the protected account");

  // Notes written elsewhere after the accounts were selected. Opening the
  // confirmation reads them again, and so does the final click: a list that no
  // longer says what it should is shown again instead of being carried out.
  const listed = () => findAll(view.document.body, (node) => node.tagName === "LI").map((node) => node.textContent);
  const writeNotes = (uids) => view.browser.storage.set(notesKey(OWNER), JSON.stringify({
    schemaVersion: 1, ownerUid: OWNER,
    notes: Object.fromEntries(uids.map((uid) => [uid, { note: "后来写的", tags: [], createdAt: T, updatedAt: T }])),
  }));
  await findButton(view.document.body, "取消").click();
  writeNotes(["2002", "2003"]);
  await findButton(view.document.body, "移除所选粉丝").click();
  assert(listed().includes("粉丝2003（有友人档案）"), "a note added after selection is marked when the confirmation opens");
  writeNotes(["2002", "2003", "2004"]);
  await findButton(view.document.body, "确认移除 60 个").click();
  assert(view.calls.length === 0, "a change in protection after the preview stops the final confirmation");
  assert(listed().includes("粉丝2004（有友人档案）"), "and the list is shown again with the new mark");
  await findButton(view.document.body, "取消").click();

  // Notes that can no longer be read weaken the protection. That must be said
  // on the page at the moment it starts to matter, not only after a redraw.
  await findButton(view.document.body, "清除选择").click();
  view.browser.storage.set(notesKey(OWNER), "{broken");
  await findButton(view.document.body, "选择当前页").click();
  const text = view.document.body.textContent;
  assert(text.includes("友人档案现在无法读取"), "the weakened protection is announced when a bulk selector runs");
  assert(!noted().textContent.includes("批量选择会跳过"), "the card no longer claims a protection that is gone");
  assert(view.count() === "已选择：50 / 200", "without readable notes the account is selected like any other");
  assert(view.calls.length === 0, "selecting and previewing send nothing");
}

// Sorting decides which accounts a fill takes first: unknown values go last
// and are never treated as zero.
function sortPutsUnknownValuesLast() {
  const { sortHygieneMatches } = openTab(createSharedBrowser(), ["sortHygieneMatches"], { ownerUid: OWNER }).product;
  const match = (uid, followersCount, createdAt) => ({ record: { uid, followersCount, createdAt } });
  const matches = [match("a", 5, "2020-01-01T00:00:00.000Z"), match("b", null, null), match("c", 0, "2024-01-01T00:00:00.000Z"), match("d", 5, "2022-01-01T00:00:00.000Z")];
  const order = (sort) => sortHygieneMatches(matches, sort).map((entry) => entry.record.uid).join("");
  assert(order("FOLLOWERS_ASC") === "cadb", `fewest followers first, ties in snapshot order, unknown last: ${order("FOLLOWERS_ASC")}`);
  assert(order("CREATED_DESC") === "cdab", `newest registration first, unknown last: ${order("CREATED_DESC")}`);
  assert(order("CREATED_ASC") === "adcb", `oldest registration first, unknown last: ${order("CREATED_ASC")}`);
  assert(order("SNAPSHOT") === "abcd" && order("nonsense") === "abcd", "the default keeps the snapshot order");
}

(async () => {
  sortPutsUnknownValuesLast();
  await bulkSelectionSkipsProtectedAccounts();
  await nextBatchNeedsNoNewSnapshot();
  await fillSelectsInResultOrder();
  await presetsAreSavedAndNormalised();
  await heldBatchCanBeStopped();
  await uncertainSingleInvalidatesBatch();
  await finalConfirmationRechecksState();
  console.log("follower removal UI safety invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
