"use strict";

const {
  assert,
  notesKey,
  radarKey,
  createSharedBrowser,
  openTab,
  createFakeDocument,
  mountProfileSkeleton,
  findAll,
  findButton,
} = require("./friend-notes-fixture");

const NAMES = [
  "ensureProfileFriendNotes",
  "showFriendNotesManager",
  "showFriendNoteDetail",
  "buildFriendNoteEditor",
  "saveFriendNote",
  "friendNoteRecordToken",
  "loadFriendNotesState",
  "loadPageCleanupPreferences",
  // Startup is skipped by the test loader, so the preference object that
  // startup would have loaded is injected here.
  "setPagePreferences: (value) => { pageCleanupPreferences = value; }",
];

const OWNER = "1001";
const LAN = "3001";
const OTHER = "3002";
const T = "2026-09-01T08:00:00.000Z";
const PANEL_ID = "wfr-profile-friend-notes";
const HOSTILE = '<img src=x onerror="alert(1)"> & <b>阿岚</b>';

const notesState = (entries) => ({
  schemaVersion: 1,
  ownerUid: OWNER,
  notes: Object.fromEntries(
    entries.map(([uid, note, tags = []]) => [
      uid,
      { note, tags, createdAt: T, updatedAt: T },
    ])
  ),
});

function openProfileTab(browser, preferences = {}) {
  const dom = createFakeDocument();
  const skeleton = mountProfileSkeleton(dom.document);
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: { document: dom.document, MutationObserver: dom.MutationObserver },
  });
  tab.document = dom.document;
  tab.skeleton = skeleton;
  tab.product.setPagePreferences({
    showProfileExtras: false,
    showProfileFriendNotes: true,
    ...preferences,
  });
  tab.visit = (pathname) => {
    tab.location.pathname = pathname;
    tab.location.href = `https://weibo.com${pathname}`;
    return tab.product.ensureProfileFriendNotes();
  };
  tab.panels = () => findAll(dom.document.body, (node) => node.id === PANEL_ID);
  tab.panel = () => {
    const panels = tab.panels();
    assert(panels.length === 1, `expected one profile panel, found ${panels.length}`);
    return panels[0];
  };
  tab.connectedObservers = () =>
    dom.document.observers.filter((observer) => observer.connected).length;
  return tab;
}

const textarea = (root) => findAll(root, (node) => node.tagName === "TEXTAREA")[0];
const statusText = (root) =>
  findAll(root, (node) => node.getAttribute("role") === "status")
    .map((node) => node.textContent)
    .join(" ");

async function profilePanel() {
  const browser = createSharedBrowser();
  browser.storage.set(
    notesKey(OWNER),
    JSON.stringify(notesState([[LAN, HOSTILE, ["<i>摄影</i>"]]]))
  );
  browser.writes.length = 0;

  // The option is off by default, and off means nothing is inserted.
  const defaults = openTab(browser, NAMES, { ownerUid: OWNER });
  assert(
    defaults.product.loadPageCleanupPreferences().showProfileFriendNotes === false,
    "the profile-page option must default to off"
  );
  const disabled = openProfileTab(browser, { showProfileFriendNotes: false });
  assert(disabled.visit(`/u/${LAN}`) === false, "a disabled option renders nothing");
  assert(disabled.panels().length === 0, "no panel while the option is off");

  const tab = openProfileTab(browser);
  assert(tab.visit(`/u/${LAN}`) === true, "the panel renders on a supported profile");
  const lanPanel = tab.panel();
  assert(
    lanPanel.parentNode === tab.skeleton.host &&
      tab.skeleton.host.childNodes.indexOf(lanPanel) ===
        tab.skeleton.host.childNodes.indexOf(tab.skeleton.tabs) - 1,
    "the panel is inserted as a sibling next to the tab strip"
  );
  assert(
    tab.skeleton.header.textContent === "微博原生资料区",
    "Weibo's own nodes are left untouched"
  );

  // User text is text. Markup in a note or tag never becomes an element.
  assert(
    findAll(lanPanel, (node) => node.textContent === HOSTILE && node.childNodes.length === 0).length === 1,
    "the note is rendered verbatim as a single text node"
  );
  assert(
    findAll(lanPanel, (node) => node.textContent === "<i>摄影</i>" && node.childNodes.length === 0).length === 1,
    "a tag is rendered verbatim as text"
  );
  assert(
    findAll(tab.document.body, (node) => ["IMG", "B", "I", "SCRIPT"].includes(node.tagName)).length === 0,
    "no element may be created from user text"
  );

  // Another person's page never shows the previous person's note.
  assert(tab.visit(`/u/${OTHER}`) === true, "the panel follows the route");
  const otherPanel = tab.panel();
  assert(otherPanel !== lanPanel, "a new target gets a new panel");
  assert(
    !otherPanel.textContent.includes("阿岚") && !otherPanel.textContent.includes("摄影"),
    "one person's note must not be shown on another person's profile"
  );
  assert(
    otherPanel.textContent.includes("还没有为此账号写下备注或标签"),
    "a profile without a note shows the empty state"
  );

  // Add a note for the second person straight from the profile.
  await findButton(otherPanel, "添加备注与标签").click();
  textarea(otherPanel).value = "路由切换后写给第二个人的备注";
  await findButton(otherPanel, "保存").click();
  let stored = JSON.parse(browser.storage.get(notesKey(OWNER))).notes;
  assert(
    stored[OTHER].note === "路由切换后写给第二个人的备注" && stored[LAN].note === HOSTILE,
    "a save from the profile is stored under the profile's own UID only"
  );
  assert(statusText(otherPanel).includes("已保存"), "success is announced");

  // An editor left open for one person cannot save once the tab has moved on.
  await findButton(otherPanel, "编辑").click();
  textarea(otherPanel).value = "切走之后才点保存";
  const staleSave = findButton(otherPanel, "保存");
  tab.visit(`/u/${LAN}`);
  assert(tab.panel() !== otherPanel, "the old panel is replaced on a route change");
  assert(otherPanel.parentNode === null, "the old panel is removed from the page");
  const rawBeforeStale = browser.storage.get(notesKey(OWNER));
  await staleSave.click();
  assert(
    browser.storage.get(notesKey(OWNER)) === rawBeforeStale,
    "a stale editor must not save onto either profile"
  );
  assert(
    statusText(otherPanel).includes("未保存") && textarea(otherPanel).value === "切走之后才点保存",
    "the refused save keeps the typed text and says why"
  );

  // Failure keeps the input: no reliable lock.
  const panel = tab.panel();
  await findButton(panel, "编辑").click();
  textarea(panel).value = "锁不可用时输入的内容";
  browser.locksAvailable = false;
  await findButton(panel, "保存").click();
  browser.locksAvailable = true;
  assert(
    textarea(panel) && textarea(panel).value === "锁不可用时输入的内容",
    "a failed save must leave the editor open with the input intact"
  );
  assert(statusText(panel).includes("未保存"), "the failure is stated");
  assert(
    JSON.parse(browser.storage.get(notesKey(OWNER))).notes[LAN].note === HOSTILE,
    "a failed save changes nothing"
  );

  // Conflict keeps the input and offers an explicit choice.
  const otherTab = openTab(browser, NAMES, { ownerUid: OWNER });
  const current = otherTab.product.loadFriendNotesState(OWNER).state.notes[LAN];
  const elsewhere = await otherTab.product.saveFriendNote(
    OWNER,
    LAN,
    { note: "另一个标签页先保存的版本", tags: [] },
    otherTab.product.friendNoteRecordToken(current),
    T
  );
  assert(elsewhere.ok, "the other tab saves first");
  await findButton(panel, "保存").click();
  assert(
    JSON.parse(browser.storage.get(notesKey(OWNER))).notes[LAN].note === "另一个标签页先保存的版本",
    "the stale editor must not silently overwrite the other tab"
  );
  assert(
    textarea(panel).value === "锁不可用时输入的内容" &&
      panel.textContent.includes("另一个标签页先保存的版本") &&
      panel.textContent.includes("已被其他标签页修改"),
    "the conflict shows the stored version and keeps the user's input"
  );
  await findButton(panel, "用我的内容覆盖").click();
  assert(
    JSON.parse(browser.storage.get(notesKey(OWNER))).notes[LAN].note === "锁不可用时输入的内容",
    "an explicit overwrite after a conflict saves the user's version"
  );

  // Delete asks first, and cancelling keeps the note.
  await findButton(panel, "删除档案").click();
  await findButton(panel, "取消").click();
  assert(LAN in JSON.parse(browser.storage.get(notesKey(OWNER))).notes, "cancel keeps the note");
  await findButton(panel, "删除档案").click();
  await findButton(panel, "确认删除").click();
  stored = JSON.parse(browser.storage.get(notesKey(OWNER))).notes;
  assert(!(LAN in stored) && OTHER in stored, "a confirmed delete removes that profile only");

  // Leaving profile routes, the own profile, and turning the option off all
  // clean up the node and its observer.
  assert(tab.connectedObservers() === 1, "one observer while a panel is shown");
  for (const pathname of ["/", `/u/${OWNER}`, "/n/someone", `/u/${LAN}/extra`]) {
    tab.visit(`/u/${OTHER}`);
    assert(tab.panels().length === 1, "panel present before leaving");
    assert(tab.visit(pathname) === false, `no panel on ${pathname}`);
    assert(tab.panels().length === 0, `panel removed on ${pathname}`);
    assert(tab.connectedObservers() === 0, `observer released on ${pathname}`);
  }
  tab.visit(`/u/${OTHER}`);
  tab.product.setPagePreferences({ showProfileExtras: false, showProfileFriendNotes: false });
  tab.product.ensureProfileFriendNotes();
  assert(
    tab.panels().length === 0 && tab.connectedObservers() === 0,
    "turning the option off removes the panel and its observer"
  );
  tab.product.setPagePreferences({ showProfileExtras: false, showProfileFriendNotes: true });

  // Unknown owner: say so and offer no way to save.
  tab.ownerUid = null;
  assert(tab.visit(`/u/${OTHER}`) === true, "the disabled state is shown");
  const lockedOut = tab.panel();
  assert(
    lockedOut.textContent.includes("无法可靠识别当前登录账号") &&
      findAll(lockedOut, (node) => node.tagName === "BUTTON").length === 0 &&
      !lockedOut.textContent.includes("路由切换后写给第二个人的备注"),
    "without a reliable owner no note is shown and nothing can be saved"
  );
  tab.ownerUid = OWNER;

  // Unreadable notes: saving disabled, data untouched.
  browser.storage.set(notesKey(OWNER), "{damaged");
  tab.visit("/");
  tab.visit(`/u/${OTHER}`);
  assert(
    tab.panel().textContent.includes("无法读取") &&
      findAll(tab.panel(), (node) => node.tagName === "BUTTON").length === 0,
    "unreadable notes disable the panel instead of offering to overwrite"
  );
  assert(browser.storage.get(notesKey(OWNER)) === "{damaged", "damaged data is not reset");

  // Showing and editing profiles sent no request and wrote only friend notes:
  // no visit log, no usage statistics, no relationship state.
  assert(browser.fetchCalls === 0, "the profile panel must not send requests");
  assert(
    browser.writes.every((key) => key === notesKey(OWNER)),
    `only the friend-notes key may be written: ${[...new Set(browser.writes)].join(",")}`
  );
  assert(
    ![...browser.storage.keys()].some(
      (key) => key.includes("profileVisits") || key.includes("usage") || key === radarKey(OWNER)
    ),
    "the panel must not start visit tracking, usage statistics or relationship state"
  );
}

async function observedFactsAreNotDuplicated() {
  const browser = createSharedBrowser();
  browser.storage.set(
    radarKey(OWNER),
    JSON.stringify({
      schemaVersion: 1,
      ownerUid: OWNER,
      latestSnapshot: null,
      events: [
        {
          id: "e1",
          type: "SCREEN_NAME_CHANGED",
          detectedAt: T,
          subjectUid: LAN,
          displayName: "阿岚Lan",
          read: true,
          previous: { screenName: "海边的岚" },
          current: { screenName: "阿岚Lan" },
        },
      ],
    })
  );
  const alone = openProfileTab(browser);
  alone.visit(`/u/${LAN}`);
  assert(
    alone.panel().textContent.includes("海边的岚") &&
      alone.panel().textContent.includes("非实时") &&
      alone.panel().textContent.includes("记录于"),
    "without Profile Extras the panel shows dated, locally recorded nicknames"
  );
  const withExtras = openProfileTab(browser, { showProfileExtras: true });
  withExtras.visit(`/u/${LAN}`);
  assert(
    !withExtras.panel().textContent.includes("海边的岚"),
    "with Profile Extras on, the same history is not rendered a second time"
  );
  assert(browser.writes.length === 0, "rendering observed facts writes nothing");
}

async function manager() {
  const browser = createSharedBrowser();
  const dom = createFakeDocument();
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: { document: dom.document, MutationObserver: dom.MutationObserver },
  });
  const cards = () => findAll(dom.document.body, (node) => node.tagName === "ARTICLE");

  // First use: guidance, not an empty list.
  tab.product.showFriendNotesManager();
  assert(
    dom.document.body.textContent.includes("还没有友人档案") && cards().length === 0,
    "the empty state explains how to add the first profile"
  );

  // On someone's profile the manager offers a note for that UID directly,
  // with no relationship baseline and with the profile-page option off.
  tab.location.pathname = `/u/${LAN}`;
  tab.product.showFriendNotesManager();
  assert(
    findButton(dom.document.body, `为当前主页写档案（UID ${LAN}）`),
    "the manager offers a note for the profile currently open"
  );
  tab.location.pathname = "/";

  const entries = [];
  for (let index = 0; index < 45; index += 1) {
    entries.push([String(5000 + index), `第 ${index} 位的备注`, index % 2 === 0 ? ["偶数"] : []]);
  }
  browser.storage.set(notesKey(OWNER), JSON.stringify(notesState(entries)));
  browser.writes.length = 0;
  tab.product.showFriendNotesManager();
  assert(cards().length === 20, `the list renders one page at a time, got ${cards().length}`);
  await findAll(dom.document.body, (node) => node.tagName === "BUTTON" && node.textContent.startsWith("加载更多"))[0].click();
  assert(cards().length === 40, "load more appends the next page");
  await findAll(dom.document.body, (node) => node.tagName === "BUTTON" && node.textContent.startsWith("加载更多"))[0].click();
  assert(cards().length === 45, "the last page completes the list");

  const search = findAll(dom.document.body, (node) => node.tagName === "INPUT")[0];
  search.value = "第 7 位";
  await search.dispatch("input");
  assert(cards().length === 1 && cards()[0].textContent.includes("5007"), "search narrows the list");
  search.value = "";
  await search.dispatch("input");
  const select = findAll(dom.document.body, (node) => node.tagName === "SELECT")[0];
  select.value = "偶数";
  await select.dispatch("change");
  assert(
    dom.document.body.textContent.includes("匹配 23 条") && cards().length === 20,
    "the tag filter applies to the whole collection, still one page at a time"
  );
  const profileLink = findAll(cards()[0], (node) => node.tagName === "A")[0];
  assert(
    /^https:\/\/weibo\.com\/u\/5\d{3}$/.test(profileLink.href) && profileLink.rel.includes("noopener"),
    "each profile links to its Weibo page by UID"
  );
  assert(
    browser.writes.length === 0 && browser.fetchCalls === 0,
    "browsing and searching the manager neither writes nor sends requests"
  );
}

// Keys pressed while an input method is composing belong to the IME.
async function imeComposition() {
  const browser = createSharedBrowser();
  const dom = createFakeDocument();
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: { document: dom.document, MutationObserver: dom.MutationObserver },
  });
  const editor = tab.product.buildFriendNoteEditor({
    ownerUid: OWNER,
    subjectUid: LAN,
    record: null,
    compact: true,
  });
  dom.document.body.append(editor.root);
  await findButton(editor.root, "添加备注与标签").click();
  const tagInput = findAll(editor.root, (node) => node.tagName === "INPUT")[0];
  const note = textarea(editor.root);
  const tags = () =>
    findAll(editor.root, (node) => node.tagName === "LI").map(
      (node) => node.childNodes[0].textContent
    );
  let prevented = 0;
  const key = async (target, event) => {
    await target.dispatch("keydown", {
      preventDefault() {
        prevented += 1;
      },
      ...event,
    });
    await new Promise((resolve) => setImmediate(resolve));
  };

  // Chrome/Edge/Firefox report isComposing; Safari's committing Enter arrives
  // after compositionend with only keyCode 229 left to identify it.
  const composingEnters = [
    { key: "Enter", isComposing: true, keyCode: 229 },
    { key: "Enter", isComposing: true, keyCode: 13 },
    { key: "Enter", isComposing: false, keyCode: 229 },
    { key: "Process", isComposing: true, keyCode: 229 },
  ];
  note.value = "组词期间不应保存的备注";
  for (const event of composingEnters) {
    tagInput.value = "sheying";
    await key(tagInput, event);
    assert(
      tags().length === 0 && tagInput.value === "sheying" && prevented === 0,
      `a composing key must not add a tag or clear the input: ${JSON.stringify(event)}`
    );
    await key(note, { ...event, ctrlKey: true });
    await key(note, { ...event, metaKey: true });
    assert(
      prevented === 0 &&
        browser.writes.length === 0 &&
        browser.lockNames.length === 0 &&
        textarea(editor.root) === note,
      `a composing key must not start a save: ${JSON.stringify(event)}`
    );
  }

  // Once composition is over, Enter and the save shortcut work as before.
  tagInput.value = "摄影";
  await key(tagInput, { key: "Enter", isComposing: false, keyCode: 13 });
  assert(
    JSON.stringify(tags()) === JSON.stringify(["摄影"]) &&
      tagInput.value === "" &&
      prevented === 1,
    "a plain Enter after composition adds the tag"
  );
  await key(note, { key: "Enter", isComposing: false, keyCode: 13 });
  assert(browser.writes.length === 0, "a bare Enter in the note is just a newline");
  await key(note, { key: "Enter", isComposing: false, keyCode: 13, ctrlKey: true });
  const stored = JSON.parse(browser.storage.get(notesKey(OWNER))).notes[LAN];
  assert(
    stored.note === "组词期间不应保存的备注" &&
      JSON.stringify(stored.tags) === JSON.stringify(["摄影"]),
    "Ctrl+Enter outside composition saves the note and its tags"
  );
}

// A save made in one view of this tab reaches the other view of the same
// profile, and only that one.
async function sameTabSync() {
  const browser = createSharedBrowser();
  browser.storage.set(
    notesKey(OWNER),
    JSON.stringify(notesState([[LAN, "旧备注", ["旧标签"]], [OTHER, "第二个人的备注"]]))
  );
  const tab = openProfileTab(browser);
  const overlay = () =>
    findAll(tab.document.body, (node) => String(node.className).includes("wfr-overlay"))[0];
  const storedNote = (uid) => {
    const notes = JSON.parse(browser.storage.get(notesKey(OWNER))).notes;
    return uid in notes ? notes[uid].note : null;
  };
  const editInDetail = async (uid, text) => {
    tab.product.showFriendNoteDetail(OWNER, uid, null);
    await findButton(overlay(), "编辑").click();
    textarea(overlay()).value = text;
  };

  // Toolkit save -> the open profile panel shows the new note.
  tab.visit(`/u/${LAN}`);
  const panel = tab.panel();
  assert(panel.textContent.includes("旧备注"), "the panel starts with the stored note");
  await editInDetail(LAN, "工具箱里保存的新备注");
  await findButton(overlay(), "保存").click();
  assert(storedNote(LAN) === "工具箱里保存的新备注", "the Toolkit save is stored");
  assert(
    tab.panel() === panel &&
      panel.textContent.includes("工具箱里保存的新备注") &&
      !panel.textContent.includes("旧备注"),
    "the same panel node now shows the saved note instead of the old one"
  );

  // A failed save must not leak unsaved text into the panel.
  await findButton(overlay(), "编辑").click();
  textarea(overlay()).value = "没有保存成功的内容";
  browser.locksAvailable = false;
  await findButton(overlay(), "保存").click();
  browser.locksAvailable = true;
  assert(
    storedNote(LAN) === "工具箱里保存的新备注" &&
      panel.textContent.includes("工具箱里保存的新备注") &&
      !panel.textContent.includes("没有保存成功的内容"),
    "a failed save changes neither storage nor the other view"
  );

  // An open edit in the panel keeps its input and its original token.
  await findButton(panel, "编辑").click();
  textarea(panel).value = "面板里尚未保存的输入";
  await editInDetail(LAN, "工具箱再次保存的版本");
  await findButton(overlay(), "保存").click();
  assert(
    textarea(panel) && textarea(panel).value === "面板里尚未保存的输入",
    "unsaved input in the other editor must survive a save elsewhere"
  );
  assert(
    statusText(panel).includes("你的输入仍保留"),
    "the open editor is told that a newer version was saved"
  );
  await findButton(panel, "保存").click();
  assert(
    storedNote(LAN) === "工具箱再次保存的版本" &&
      panel.textContent.includes("已被其他标签页修改") &&
      textarea(panel).value === "面板里尚未保存的输入",
    "the open editor still saves against its original version and gets a conflict"
  );
  await findButton(panel, "取消").click();
  assert(
    panel.textContent.includes("工具箱再次保存的版本") &&
      !panel.textContent.includes("面板里尚未保存的输入"),
    "cancelling returns to the stored version, not the one the edit started from"
  );

  // Another profile's panel is never touched, including when the route changes
  // while the save is in flight.
  tab.visit(`/u/${OTHER}`);
  const otherPanel = tab.panel();
  await editInDetail(LAN, "切到别人主页后保存的备注");
  await findButton(overlay(), "保存").click();
  assert(
    storedNote(LAN) === "切到别人主页后保存的备注" &&
      otherPanel.textContent.includes("第二个人的备注") &&
      !otherPanel.textContent.includes("切到别人主页后保存的备注"),
    "a save for one UID must not appear on another UID's panel"
  );
  tab.visit(`/u/${LAN}`);
  await editInDetail(LAN, "保存途中路由已切走");
  browser.beforeGrant = async () => {
    browser.beforeGrant = null;
    tab.visit(`/u/${OTHER}`);
  };
  await findButton(overlay(), "保存").click();
  assert(storedNote(LAN) === "保存途中路由已切走", "the in-flight save completes");
  assert(
    tab.panel().textContent.includes("第二个人的备注") &&
      !tab.panel().textContent.includes("保存途中路由已切走"),
    "a save finishing after a route change must not update the new profile's panel"
  );

  // Toolkit delete -> the profile panel shows the empty state.
  tab.visit(`/u/${LAN}`);
  const lanPanel = tab.panel();
  assert(lanPanel.textContent.includes("保存途中路由已切走"), "panel shows the note");
  tab.product.showFriendNoteDetail(OWNER, LAN, null);
  await findButton(overlay(), "删除档案").click();
  await findButton(overlay(), "确认删除").click();
  assert(storedNote(LAN) === null, "the Toolkit delete is stored");
  assert(
    lanPanel.textContent.includes("还没有为此账号写下备注或标签") &&
      !lanPanel.textContent.includes("保存途中路由已切走") &&
      findAll(lanPanel, (node) => node.tagName === "BUTTON" && node.textContent === "删除档案").length === 0,
    "after a delete elsewhere the panel shows the empty state"
  );
  assert(storedNote(OTHER) === "第二个人的备注", "other profiles are untouched");
  assert(browser.fetchCalls === 0, "syncing views sends no request");
}

(async () => {
  await profilePanel();
  await observedFactsAreNotDuplicated();
  await manager();
  await imeComposition();
  await sameTabSync();
  console.log("friend notes profile and manager invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
