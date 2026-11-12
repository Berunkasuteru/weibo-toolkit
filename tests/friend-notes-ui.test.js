"use strict";

const {
  assert,
  notesKey,
  radarKey,
  followerKey,
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
  "closePanel",
  "setPanelExitLocked",
  "showToolkitHome",
  "renderEvents",
  "renderFollowerEvents",
  "showRelationshipOverview",
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
  // Known profile tab subpaths stay supported.
  for (const subpath of ["weibo", "album/", "article", "video", "super"]) {
    assert(
      tab.visit(`/u/${OTHER}/${subpath}`) === true && tab.panels().length === 1,
      `known profile subpath /u/${OTHER}/${subpath} resolves the target UID`
    );
  }
  // Custom-domain routes resolve ONLY when header links before the tab strip
  // unambiguously prove one UID, and fail closed on conflicting UIDs.
  const customAnchor = tab.document.createElement("a");
  customAnchor.setAttribute("href", `/u/${OTHER}?tabtype=follow`);
  customAnchor.textContent = "关注";
  tab.skeleton.header.append(customAnchor);
  assert(
    tab.visit("/n/other-domain") === true &&
      tab.visit("/custom-slug/weibo") === true &&
      tab.panels().length === 1,
    "custom-domain routes resolve when header links unambiguously identify one UID"
  );
  const conflictAnchor = tab.document.createElement("a");
  conflictAnchor.setAttribute("href", `/u/${LAN}`);
  conflictAnchor.textContent = "提及";
  tab.skeleton.header.append(conflictAnchor);
  assert(
    tab.visit("/n/other-domain") === false && tab.panels().length === 0,
    "conflicting UID links in the profile header fail closed"
  );
  tab.skeleton.header.removeChild(customAnchor);
  tab.skeleton.header.removeChild(conflictAnchor);
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

  // First use: guidance, not an empty list, plus direct UID lookup.
  tab.product.showFriendNotesManager();
  assert(
    dom.document.body.textContent.includes("还没有友人档案") && cards().length === 0,
    "the empty state explains how to add the first profile"
  );
  await findButton(dom.document.body, "按 UID 新建/查看档案").click();
  const emptyUidInput = findAll(dom.document.body, (node) => node.tagName === "INPUT")[0];
  emptyUidInput.value = "00123";
  await findButton(dom.document.body, "打开档案").click();
  assert(
    dom.document.body.textContent.includes("请输入有效的纯数字 UID"),
    "invalid UID is rejected before opening detail view"
  );
  emptyUidInput.value = LAN;
  await findButton(dom.document.body, "打开档案").click();
  assert(
    dom.document.body.textContent.includes(`${LAN} · 友人档案`),
    "valid UID opens Friend Note detail directly from empty manager"
  );
  tab.product.showFriendNotesManager();

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

// While a panel is locked (a restore is being written), nothing may remove or
// replace it: not a close, and not another entry point opening its own panel.
// Otherwise the late outcome would land on, and destroy, whatever was opened.
async function lockedPanelIsNotReplaced() {
  const browser = createSharedBrowser();
  browser.storage.set(notesKey(OWNER), JSON.stringify(notesState([[LAN, "旧备注"]])));
  const tab = openProfileTab(browser);
  const overlays = () =>
    findAll(tab.document.body, (node) => String(node.className).includes("wfr-overlay"));
  tab.product.showFriendNoteDetail(OWNER, LAN, null);
  const held = overlays()[0];
  tab.product.setPanelExitLocked(true);
  tab.product.closePanel();
  tab.product.showFriendNotesManager();
  assert(
    overlays().length === 1 && overlays()[0] === held && held.textContent.includes("旧备注"),
    "a locked panel survives a close and another panel being opened"
  );
  tab.product.setPanelExitLocked(false);
  tab.product.showFriendNotesManager();
  assert(overlays().length === 1 && overlays()[0] !== held, "unlocking restores normal replacement");
}

async function unsavedNoteGuardAndCallerReturn() {
  const browser = createSharedBrowser();
  browser.storage.set(notesKey(OWNER), JSON.stringify(notesState([[LAN, "旧备注"]])));
  browser.storage.set(
    radarKey(OWNER),
    JSON.stringify({
      schemaVersion: 1,
      ownerUid: OWNER,
      latestSnapshot: {
        capturedAt: T,
        reportedTotal: 1,
        visibleCount: 1,
        unresolvedRelationCount: 0,
        records: [
          { uid: LAN, screenName: "阿岚Lan", following: true, followsMe: false, remark: "摄影搭子" },
        ],
      },
      events: [
        {
          id: "e1",
          type: "FOLLOW_ME_LOST",
          detectedAt: T,
          subjectUid: LAN,
          displayName: "阿岚Lan",
          read: false,
          previous: { followsMe: true },
          current: { followsMe: false },
        },
      ],
    })
  );
  const dom = createFakeDocument();
  let confirmAnswers = [false, true];
  let confirmCalls = 0;
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: {
      document: dom.document,
      MutationObserver: dom.MutationObserver,
      confirm() {
        confirmCalls += 1;
        return confirmAnswers.shift();
      },
    },
  });
  const overlay = () =>
    findAll(dom.document.body, (node) => String(node.className).includes("wfr-overlay"))[0];

  // Open note detail from Relationship Overview with filter ONE_WAY and a search query.
  tab.product.showRelationshipOverview({ filter: "ONE_WAY", query: "摄影" });
  assert(overlay().textContent.includes("阿岚Lan · 单向关注"), "overview lists matching following account");
  await findButton(overlay(), "友人档案").click();
  assert(overlay().textContent.includes("阿岚Lan · 友人档案"), "entered note detail from overview");

  // Unsaved edit blocks navigation to Home/Timeline when confirm returns false,
  // and prompts only once when confirm returns true.
  await findButton(overlay(), "编辑").click();
  textarea(overlay()).value = "未保存的草稿";
  tab.product.showToolkitHome();
  assert(
    confirmCalls === 1 &&
      overlay().textContent.includes("阿岚Lan · 友人档案") &&
      textarea(overlay()).value === "未保存的草稿",
    "declining confirm keeps the unsaved note detail open when another panel is requested"
  );
  await findButton(overlay(), "← 返回").click();
  assert(
    confirmCalls === 2 &&
      overlay().textContent.includes("关系概览") &&
      overlay().textContent.includes("阿岚Lan · 单向关注"),
    "confirming once returns to the caller (Relationship Overview) with filter and query intact"
  );
}

async function listsRestorePositionAfterChildViews() {
  const browser = createSharedBrowser();
  const dom = createFakeDocument();
  // Detached elements have no layout box: their native scrollTop reads as 0.
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = (tag) => {
    const node = createElement(tag);
    let position = 0;
    Object.defineProperty(node, "scrollTop", {
      get: () => dom.document.body.contains(node) ? position : 0,
      set: (value) => { position = value; },
    });
    return node;
  };
  const records = Array.from({ length: 45 }, (_, index) => ({
    uid: String(5000 + index), screenName: `账号${index}`, following: true,
    followsMe: false, remark: "摄影",
  }));
  const state = {
    schemaVersion: 1, ownerUid: OWNER,
    latestSnapshot: { capturedAt: T, reportedTotal: 45, visibleCount: 45, unresolvedRelationCount: 0, records },
    events: records.flatMap((record, index) => [0, 1].map((sequence) => ({
      id: `e${index}-${sequence}`, type: "FOLLOW_ME_LOST", detectedAt: T,
      subjectUid: record.uid, displayName: record.screenName, read: true,
      previous: { followsMe: true }, current: { followsMe: false },
    }))),
  };
  browser.storage.set(radarKey(OWNER), JSON.stringify(state));
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: { document: dom.document, MutationObserver: dom.MutationObserver },
  });
  for (const [view, actions] of [
    ["events", ["详情", "关系时间线（2 条事件）", "写档案"]],
    ["overview", ["关系时间线（2 条事件）", "写档案"]],
  ]) {
    for (const action of actions) {
      if (view === "events") tab.product.renderEvents(OWNER, state, null, "账号");
      else tab.product.showRelationshipOverview({ filter: "ONE_WAY", query: "摄影" });
      const more = findAll(dom.document.body, (node) => node.tagName === "BUTTON" && node.textContent.startsWith("加载更多"))[0];
      await more.click();
      const body = dom.document.querySelector(".wfr-body");
      body.scrollTop = 700;
      const first = findAll(body, (node) => node.tagName === "ARTICLE")[0];
      await findButton(first, action).click();
      assert(body.scrollTop === 0, "the old list is detached before the return action runs");
      await findButton(dom.document.body, "← 返回").click();
      const restored = dom.document.querySelector(".wfr-body");
      assert(restored.scrollTop === 700, `${view} restores its position after ${action}`);
      assert(findAll(restored, (node) => node.tagName === "ARTICLE").length === 40,
        "the expanded page count survives the round trip");
      assert(findAll(restored, (node) => node.tagName === "INPUT")[0].value === (view === "events" ? "账号" : "摄影"),
        "the search query survives the round trip");
      if (view === "overview") assert(findAll(restored, (node) => node.tagName === "SELECT")[0].value === "ONE_WAY",
        "the overview relationship filter survives the round trip");
    }
  }
  assert(browser.fetchCalls === 0, "restoring a local list sends no requests");
}

async function listViewsShowNotesFilterReadAndExport() {
  const browser = createSharedBrowser();
  const dom = createFakeDocument();
  const downloads = [];
  class MockBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options && options.type;
    }
  }
  let blobId = 0;
  const blobContents = new Map();
  const mockUrl = {
    createObjectURL(blob) {
      blobId += 1;
      const url = `blob:mock/${blobId}`;
      blobContents.set(url, { content: blob.parts.join(""), type: blob.type });
      return url;
    },
    revokeObjectURL() {},
  };
  const createElement = dom.document.createElement.bind(dom.document);
  dom.document.createElement = (tag) => {
    const node = createElement(tag);
    if (tag === "a") {
      node.click = () => {
        downloads.push({
          download: node.download,
          ...(blobContents.get(node.href) || {}),
        });
      };
    }
    return node;
  };
  browser.storage.set(
    notesKey(OWNER),
    JSON.stringify(
      notesState([
        [LAN, "合作摄影师，经常接商单", ["摄影", "熟人"]],
        [OTHER, "=危险备注", ["待观察"]],
      ])
    )
  );
  const radarState = {
    schemaVersion: 1,
    ownerUid: OWNER,
    latestSnapshot: {
      capturedAt: T,
      reportedTotal: 2,
      visibleCount: 2,
      unresolvedRelationCount: 0,
      records: [
        { uid: LAN, screenName: "阿岚Lan", following: true, followsMe: false, remark: "" },
        { uid: OTHER, screenName: "路人乙", following: true, followsMe: true, remark: "" },
      ],
    },
    events: [
      {
        id: "ev-lost",
        type: "FOLLOW_ME_LOST",
        detectedAt: "2026-09-02T08:00:00.000Z",
        subjectUid: LAN,
        displayName: "阿岚Lan",
        read: false,
        previous: { followsMe: true },
        current: { followsMe: false },
      },
      {
        id: "ev-name",
        type: "SCREEN_NAME_CHANGED",
        detectedAt: "2026-09-01T08:00:00.000Z",
        subjectUid: OTHER,
        displayName: "路人乙",
        read: false,
        previous: { screenName: "旧名" },
        current: { screenName: "路人乙" },
      },
    ],
  };
  const followerState = {
    schemaVersion: 1,
    ownerUid: OWNER,
    latestSnapshot: null,
    events: [
      {
        id: "fe-add",
        type: "VISIBLE_FOLLOWER_ADDED",
        observedAt: "2026-09-02T08:00:00.000Z",
        uid: LAN,
        displayName: "阿岚Lan",
      },
      {
        id: "fe-drop",
        type: "VISIBLE_FOLLOWER_DISAPPEARED",
        observedAt: "2026-09-01T08:00:00.000Z",
        uid: OTHER,
        displayName: "路人乙",
      },
    ],
  };
  browser.storage.set(radarKey(OWNER), JSON.stringify(radarState));
  browser.storage.set(followerKey(OWNER), JSON.stringify(followerState));
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: {
      document: dom.document,
      MutationObserver: dom.MutationObserver,
      Blob: MockBlob,
      URL: mockUrl,
      setTimeout: (fn) => {
        fn();
        return 1;
      },
      clearTimeout() {},
    },
  });

  // 1) Events view: inline Friend Note summary, Note search, type/unread filter, card + detail mark-read.
  tab.product.renderEvents(OWNER, radarState);
  let summaries = findAll(dom.document.body, (node) => node.classList.contains("wfr-card-note-summary"));
  assert(
    summaries.length === 2 && summaries[0].textContent.includes("合作摄影师"),
    "renderEvents cards display inline Friend Notes summary"
  );
  const evSearch = findAll(dom.document.body, (node) => node.tagName === "INPUT")[0];
  evSearch.value = "接商单";
  evSearch.dispatch("input");
  await new Promise((resolve) => setImmediate(resolve));
  let evCards = findAll(dom.document.body, (node) => node.tagName === "ARTICLE");
  assert(evCards.length === 1 && evCards[0].textContent.includes("阿岚Lan"), "events search matches Friend Notes");
  await findButton(evCards[0], "标为已读").click();
  let persistedRadar = JSON.parse(browser.storage.get(radarKey(OWNER)));
  assert(
    persistedRadar.events.find((e) => e.id === "ev-lost").read === true &&
      persistedRadar.events.find((e) => e.id === "ev-name").read === false,
    "single-card mark-read persists only that event under lock"
  );
  // Filter by unreadOnly + type: ev-lost is read now, so unreadOnly shows only ev-name; switching type to FOLLOW_ME_LOST clears list.
  const evSearchAfter = findAll(dom.document.body, (node) => node.tagName === "INPUT")[0];
  const unreadCheckbox = findAll(dom.document.body, (node) => node.tagName === "INPUT" && node.type === "checkbox")[0];
  const evTypeSelect = findAll(dom.document.body, (node) => node.tagName === "SELECT")[0];
  evSearchAfter.value = "";
  evSearchAfter.dispatch("input");
  unreadCheckbox.checked = true;
  unreadCheckbox.dispatch("change");
  await new Promise((resolve) => setImmediate(resolve));
  evCards = findAll(dom.document.body, (node) => node.tagName === "ARTICLE");
  assert(evCards.length === 1 && evCards[0].textContent.includes("路人乙"), "unread filter hides already-read event");
  evTypeSelect.value = "FOLLOW_ME_LOST";
  evTypeSelect.dispatch("change");
  assert(
    findAll(dom.document.body, (node) => node.tagName === "ARTICLE").length === 0,
    "type filter narrows events to FOLLOW_ME_LOST"
  );
  evTypeSelect.value = "ALL";
  evTypeSelect.dispatch("change");
  evCards = findAll(dom.document.body, (node) => node.tagName === "ARTICLE");
  await findButton(evCards[0], "详情").click();
  await findButton(dom.document.body, "标为已读").click();
  persistedRadar = JSON.parse(browser.storage.get(radarKey(OWNER)));
  assert(
    persistedRadar.events.every((e) => e.read === true),
    "detail modal mark-read updates storage cleanly"
  );

  // 2) Follower events view: type filter, Friend Note inline summary, and filtered CSV export.
  tab.product.renderFollowerEvents(OWNER, followerState);
  summaries = findAll(dom.document.body, (node) => node.classList.contains("wfr-card-note-summary"));
  assert(summaries.length === 2, "renderFollowerEvents cards show inline Friend Note summary");
  const followerTypeSelect = findAll(dom.document.body, (node) => node.tagName === "SELECT")[0];
  followerTypeSelect.value = "VISIBLE_FOLLOWER_ADDED";
  followerTypeSelect.dispatch("change");
  const followerCards = findAll(dom.document.body, (node) => node.tagName === "ARTICLE");
  assert(followerCards.length === 1 && followerCards[0].textContent.includes("阿岚Lan"), "follower event type filter narrows cards");
  await findButton(dom.document.body, "导出 CSV").click();
  assert(
    downloads.length === 1 &&
      downloads[0].download.includes("follower-events") &&
      downloads[0].content.includes("阿岚Lan") &&
      !downloads[0].content.includes("路人乙"),
    "follower CSV export exports only currently filtered events"
  );

  // 3) Overview: inline Friend Note summary, Note search, and filtered Markdown export.
  tab.product.showRelationshipOverview();
  const ovSearch = findAll(dom.document.body, (node) => node.tagName === "INPUT")[0];
  ovSearch.value = "待观察";
  ovSearch.dispatch("input");
  await new Promise((resolve) => setImmediate(resolve));
  const ovCards = findAll(dom.document.body, (node) => node.tagName === "ARTICLE");
  assert(ovCards.length === 1 && ovCards[0].textContent.includes("路人乙"), "overview search matches Friend Note tags");
  await findButton(dom.document.body, "导出当前名单 Markdown").click();
  assert(
    downloads.length === 2 &&
      downloads[1].download.includes("weibo-toolkit-following") &&
      downloads[1].content.includes("路人乙") &&
      !downloads[1].content.includes("阿岚Lan"),
    "overview Markdown export exports filtered overview records"
  );

  // 4) Friend Notes Manager: direct UID open, filtered CSV & Markdown export with BOM/formula neutralization.
  tab.product.showFriendNotesManager();
  const fnSearch = findAll(dom.document.body, (node) => node.tagName === "INPUT")[0];
  fnSearch.value = "=危险";
  fnSearch.dispatch("input");
  await findButton(dom.document.body, "导出当前档案 CSV").click();
  assert(
    downloads.length === 3 &&
      downloads[2].download.includes("weibo-toolkit-friend-notes") &&
      downloads[2].content.charCodeAt(0) === 0xfeff &&
      downloads[2].content.includes("'=危险备注") &&
      !downloads[2].content.includes("合作摄影师"),
    "friend notes CSV export neutralizes formulas and exports filtered notes with UTF-8 BOM"
  );
  await findButton(dom.document.body, "← 返回").click();
  assert(
    findAll(dom.document.body, (node) => node.tagName === "INPUT")[0].value === "=危险",
    "returning from friend notes export restores the previous search filter"
  );
  await findButton(dom.document.body, "导出当前档案 Markdown").click();
  assert(
    downloads.length === 4 &&
      downloads[3].download.endsWith(".md") &&
      downloads[3].content.includes("=危险备注") &&
      !downloads[3].content.includes("合作摄影师"),
    "friend notes Markdown export exports only filtered notes"
  );
  await findButton(dom.document.body, "← 返回").click();
  await findButton(dom.document.body, "按 UID 新建/查看档案").click();
  const nonEmptyUidInput = findAll(dom.document.body, (node) => node.tagName === "INPUT")[1];
  nonEmptyUidInput.value = "999999";
  await findButton(dom.document.body, "打开档案").click();
  assert(
    dom.document.body.textContent.includes("999999 · 友人档案"),
    "manager opens a brand-new UID note editor directly"
  );
}

(async () => {
  await lockedPanelIsNotReplaced();
  await unsavedNoteGuardAndCallerReturn();
  await listsRestorePositionAfterChildViews();
  await listViewsShowNotesFilterReadAndExport();
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
