"use strict";

// Friend Notes in the Home/Latest feed. Every assertion drives the generated
// userscript; the DOM is the synthetic fixture documented in
// friend-notes-fixture.js, not live Weibo markup.

const {
  assert,
  notesKey,
  radarKey,
  followerKey,
  createSharedBrowser,
  openTab,
  createFakeDocument,
  mountFeedSkeleton,
  createFeedCard,
  findAll,
  findButton,
} = require("./friend-notes-fixture");

const NAMES = [
  "installLatestFeedRecommendationFilter",
  "reconcileCurrentPageFeed",
  "resolveFeedAuthorIdentity",
  "feedNicknameHintText",
  "feedEntryLayout",
  "computeFeedFriendNoteCardPlacement",
  "showFriendNoteDetail",
  "loadPageCleanupPreferences",
  "classifyLatestRecommendedCard",
  "extractUsagePostId",
  "validateLongPostExpandControl",
  "saveFriendNote",
  "friendNoteRecordToken",
  "loadFriendNotesState",
  "setPagePreferences: (value) => { pageCleanupPreferences = value; }",
  "feedRuntime: () => feedFriendNotes",
  "openCard: () => feedFriendNoteCard",
];

const OWNER = "1001";
const OTHER_OWNER = "2002";
const LAN = "3001";
const BO = "3002";
const TWIN = "3003";
const STRANGER = "3004";
const T = "2026-09-01T08:00:00.000Z";
const HOSTILE = '<img src=x onerror="alert(1)"> & <b>阿岚</b>';
const ALL_OFF = {
  hideHotSearch: false,
  hideRightSidebar: false,
  hideTopRecommend: false,
  hideTopVideo: false,
  hideLatestRecommended: false,
  strongFeedPromotionFilter: false,
  autoExpandLongPosts: false,
  showProfileExtras: false,
  showProfileFriendNotes: false,
  showFeedFriendNotes: false,
};
const FEED_ONLY = { ...ALL_OFF, showFeedFriendNotes: true };

const notesState = (entries, ownerUid = OWNER) => ({
  schemaVersion: 1,
  ownerUid,
  notes: Object.fromEntries(
    entries.map(([uid, note, tags = []]) => [
      uid,
      { note, tags, createdAt: T, updatedAt: T },
    ])
  ),
});

// 阿岚 (LAN) is in the following snapshot as 阿岚Lan and has one recorded
// rename from 阿岚在路上. Nobody else has any local evidence.
const RADAR_RAW = JSON.stringify({
  schemaVersion: 1,
  ownerUid: OWNER,
  latestSnapshot: {
    capturedAt: "2026-08-20T00:00:00.000Z",
    reportedTotal: 1,
    visibleCount: 1,
    unresolvedRelationCount: 0,
    records: [
      { uid: LAN, screenName: "阿岚Lan", following: true, followsMe: true, remark: "" },
    ],
  },
  events: [
    {
      id: "e1",
      type: "SCREEN_NAME_CHANGED",
      detectedAt: "2026-08-20T00:00:00.000Z",
      subjectUid: LAN,
      displayName: "阿岚Lan",
      read: true,
      previous: { screenName: "阿岚在路上" },
      current: { screenName: "阿岚Lan" },
    },
  ],
});

const tick = () => new Promise((resolve) => setImmediate(resolve));

function openFeed(preferences, storage = {}) {
  const browser = createSharedBrowser();
  for (const [key, value] of Object.entries(storage)) browser.storage.set(key, value);
  const dom = createFakeDocument();
  const feed = mountFeedSkeleton(dom.document);
  // A window with no size: geometry-dependent code stays idle unless a test
  // gives it a viewport and element boxes (see the layout section below).
  const windowListeners = [];
  const pageWindow = {
    scrollX: 0,
    scrollY: 0,
    addEventListener(type, listener) {
      windowListeners.push({ type, listener });
    },
    removeEventListener(type, listener) {
      const index = windowListeners.findIndex(
        (entry) => entry.type === type && entry.listener === listener
      );
      if (index >= 0) windowListeners.splice(index, 1);
    },
  };
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      resizeObservers.push(this);
    }
    observe(target) {
      this.target = target;
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  const tab = openTab(browser, NAMES, {
    ownerUid: OWNER,
    context: {
      document: dom.document,
      MutationObserver: dom.MutationObserver,
      ResizeObserver: FakeResizeObserver,
      window: pageWindow,
    },
  });
  tab.product.setPagePreferences({ ...preferences });
  const view = {
    browser,
    tab,
    document: dom.document,
    feed,
    add(options) {
      const parts = createFeedCard(dom.document, options);
      feed.scroller.append(parts.card);
      return parts;
    },
    window: pageWindow,
    windowListeners: (type) => windowListeners.filter((entry) => entry.type === type),
    fireWindow(type) {
      for (const entry of [...windowListeners]) {
        if (entry.type === type) entry.listener({ type });
      }
    },
    // What a real ResizeObserver does when the observed card changes size.
    cardResized() {
      for (const observer of resizeObservers) {
        if (observer.connected) observer.callback([]);
      }
    },
    sizeObservers: () => resizeObservers.filter((observer) => observer.connected),
    install: () => tab.product.installLatestFeedRecommendationFilter(),
    reconcile: () => tab.product.reconcileCurrentPageFeed(),
    setPreferences: (next) => tab.product.setPagePreferences({ ...next }),
    wrappers: (root = dom.document.body) =>
      findAll(root, (node) => node.classList.contains("wfr-feed-note")),
    entry(parts) {
      const buttons = findAll(parts.card, (node) =>
        node.classList.contains("wfr-feed-note-entry")
      );
      assert(buttons.length <= 1, "a card must never carry two entries");
      return buttons[0] || null;
    },
    hint(parts) {
      const hints = findAll(parts.card, (node) =>
        node.classList.contains("wfr-feed-note-hint")
      );
      return hints.length === 1 && !hints[0].hidden ? hints[0].textContent : "";
    },
    cards: () =>
      findAll(dom.document.body, (node) => node.id === "wfr-feed-note-card"),
    card() {
      const cards = view.cards();
      assert(cards.length === 1, `expected one friend card, found ${cards.length}`);
      return cards[0];
    },
    observers: () => dom.document.observers.filter((observer) => observer.connected),
    stored: (ownerUid = OWNER) =>
      browser.storage.has(notesKey(ownerUid))
        ? JSON.parse(browser.storage.get(notesKey(ownerUid))).notes
        : {},
  };
  return view;
}

const textarea = (root) => findAll(root, (node) => node.tagName === "TEXTAREA")[0];
const tagInput = (root) => findAll(root, (node) => node.tagName === "INPUT")[0];
const statusText = (root) =>
  findAll(root, (node) => node.getAttribute("role") === "status")
    .map((node) => node.textContent)
    .join(" ");

// Rewrites a mounted card in place for another post, as the virtual list does.
function recycle(parts, uid, name, bid = "Qr3cycl3d") {
  parts.avatar.setAttribute("href", `/u/${uid}`);
  parts.name.setAttribute("href", `/u/${uid}`);
  parts.nameText.textContent = name;
  parts.permalink.setAttribute("href", `https://weibo.com/${uid}/${bid}`);
  parts.text.textContent = `${name} 的另一条微博`;
}

async function switchesAndEntries() {
  // Off by default: no entry, no observer, no per-card work.
  const defaults = openFeed(ALL_OFF, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "摄影展认识的阿岚"]])),
  });
  assert(
    defaults.tab.product.loadPageCleanupPreferences().showFeedFriendNotes === false,
    "the feed option must default to off"
  );
  defaults.add({ uid: LAN, name: "阿岚Lan" });
  assert(defaults.install() === false, "nothing is installed while every option is off");
  assert(
    defaults.wrappers().length === 0 &&
      defaults.document.observers.length === 0 &&
      defaults.tab.product.feedRuntime() === null,
    "the default-off feature adds no entry, no observer and no cached data"
  );
  assert(defaults.browser.writes.length === 0, "default-off writes nothing");

  // On alone, with every other enhancement off.
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(
      notesState([
        [LAN, "去年摄影展认识的阿岚，喜欢拍海边。", ["摄影"]],
        [TWIN, "同名的另一位"],
      ])
    ),
  });
  const lan = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  const bo = view.add({ uid: BO, name: "老薄", index: 1 });
  const twinNoted = view.add({ uid: TWIN, name: "同名", index: 2 });
  const twinPlain = view.add({ uid: STRANGER, name: "同名", index: 3 });
  const mine = view.add({ uid: OWNER, name: "我自己", index: 4 });
  assert(view.install() === true, "the feed option works with all other options off");
  assert(view.observers().length === 1, "exactly one feed observer serves the feature");
  assert(
    view.observers()[0].options.attributeFilter.includes("href"),
    "a recycled card's link change must be observed"
  );

  assert(
    view.entry(lan).textContent === "有备注" &&
      view.entry(lan).classList.contains("wfr-feed-note-has"),
    "an author with a note is marked"
  );
  assert(
    view.entry(bo).textContent === "写备注" &&
      !view.entry(bo).classList.contains("wfr-feed-note-has"),
    "an author without a note gets the low-key entry"
  );
  assert(
    view.entry(lan).getAttribute("aria-label").includes("阿岚Lan") &&
      view.entry(bo).getAttribute("aria-label").includes("写备注") &&
      view.entry(lan).tagName === "BUTTON",
    "entries are real buttons with a spoken label"
  );
  // Identity is the UID: the same nickname on two accounts never shares a note.
  assert(
    view.entry(twinNoted).textContent === "有备注" &&
      view.entry(twinPlain).textContent === "写备注",
    "accounts sharing a nickname must not share a note"
  );
  assert(view.entry(mine) === null, "the owner's own posts get no entry");
  assert(
    !view.feed.scroller.textContent.includes("摄影展认识"),
    "private notes are not spread across the feed"
  );
  // Weibo's own nodes stay where and what they were.
  assert(
    lan.nameText.textContent === "阿岚Lan" &&
      lan.name.getAttribute("href") === `/u/${LAN}` &&
      lan.name.nextSibling.classList.contains("wfr-feed-note") &&
      lan.name.parentNode.childNodes.length === 2 &&
      lan.permalink.nextSibling.textContent === "来自 微博网页版" &&
      view.entry(lan).getAttribute("title") === "查看友人档案",
    "the entry sits beside the author with a tooltip, leaving time and source together"
  );
  assert(
    !view.entry(lan).classList.contains("wbpro-tag") &&
      findAll(lan.header, (node) => [...node.classList].some((token) => token.startsWith("wbpro-tag"))).length === 0,
    "the entry never poses as a promotion tag"
  );

  // Processing the same cards again inserts nothing and writes nothing.
  const writesAfterFirstPass = view.document.writes;
  for (let pass = 0; pass < 3; pass += 1) {
    view.reconcile();
    for (const observer of view.observers()) observer.callback([]);
    await tick();
  }
  assert(
    view.document.writes === writesAfterFirstPass,
    `repeated passes over unchanged cards must not write: ${view.document.writes - writesAfterFirstPass} writes`
  );
  assert(view.wrappers().length === 4, "one entry per supported card, never duplicated");
  assert(
    view.browser.fetchCalls === 0 && view.browser.writes.length === 0,
    "showing entries sends no request and stores nothing"
  );
}

function authorIdentity() {
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(
      notesState([
        [LAN, "外层作者的备注"],
        [BO, "被转作者的备注"],
        [TWIN, "正文里提到的人的备注"],
        [STRANGER, "评论里的人的备注"],
      ])
    ),
  });
  const resolve = (parts) => view.tab.product.resolveFeedAuthorIdentity(parts.card);
  const uidOf = (parts) => {
    const identity = resolve(parts);
    return identity === null ? null : identity.uid;
  };

  const plain = view.add({ uid: LAN, name: "阿岚Lan" });
  assert(
    uidOf(plain) === LAN && resolve(plain).pageName === "阿岚Lan",
    "an ordinary card resolves its outer author and page nickname"
  );

  // A repost: only the reposter is the outer author.
  const repost = view.add({ uid: "4001", name: "转发的人", repost: { uid: BO, name: "老薄" } });
  assert(uidOf(repost) === "4001", "a repost resolves the outer reposter only");

  // Body mentions and comment links are not in the outer header at all.
  const noisy = view.add({
    uid: "4002",
    name: "话多的人",
    bodyLinks: [`/u/${TWIN}`, `https://weibo.com/${TWIN}/Qmention1`, "/n/someone"],
    commentLinks: [`/u/${STRANGER}`, `https://weibo.com/${STRANGER}/Qcomment1`],
  });
  assert(uidOf(noisy) === "4002", "body and comment links never become the author");

  // Evidence that disagrees means no identity at all.
  const profileConflict = view.add({ uid: LAN, name: "阿岚Lan", profileHref: `/u/${BO}` });
  assert(uidOf(profileConflict) === null, "a conflicting profile link skips the card");
  const permalinkConflict = view.add({
    uid: LAN,
    name: "阿岚Lan",
    extraHeaderLinks: [`https://weibo.com/${BO}/Qother123`],
  });
  assert(uidOf(permalinkConflict) === null, "two permalinks naming different UIDs skip the card");

  // No permalink: a lone profile link is not enough to bind a note to.
  const noPermalink = view.add({ uid: LAN, name: "阿岚Lan", permalinkHref: null });
  assert(uidOf(noPermalink) === null, "without the post's own permalink the card is skipped");
  // A post id is never read as a UID, wherever it appears.
  for (const href of [
    "https://weibo.com/detail/4901234567890123",
    "/4901234567890123",
    "https://weibo.com/status/4901234567890123",
    `https://evil.example/${LAN}/Qa1b2C3d4`,
    `https://weibo.com/${LAN}/Qa1b2C3d4/extra`,
    "https://weibo.com/0123/Qa1b2C3d4",
    "",
  ]) {
    const odd = view.add({ uid: LAN, name: "阿岚Lan", permalinkHref: href, profileHref: "/custom", nameHref: "/custom" });
    assert(uidOf(odd) === null, `no UID may be taken from ${JSON.stringify(href)}`);
  }

  // A custom-domain profile link is not evidence, but does not block the
  // permalink either: the UID is known, the page nickname is not.
  const customDomain = view.add({
    uid: "4003",
    name: "个性域名用户",
    profileHref: "/somebody",
    nameHref: "/somebody",
  });
  const customIdentity = resolve(customDomain);
  assert(
    customIdentity.uid === "4003" && customIdentity.pageName === null,
    "a custom-domain author is bound by permalink UID with no page nickname"
  );

  view.install();
  assert(
    view.entry(repost).textContent === "写备注" && view.wrappers(repost.card).length === 1,
    "the reposted author's note must not mark the reposter's card"
  );
  assert(
    view.wrappers(repost.repost).length === 0,
    "nothing is inserted inside the reposted post"
  );
  const repostWithLabel = view.add({
    uid: "7733309837",
    name: "鹿野莓厨",
    repost: { uid: LAN, name: "被转发者" },
    extraHeaderLinks: ["/u/7733309837"],
  });
  repostWithLabel.header.querySelectorAll("a").at(-1).textContent = "转发微博";
  view.reconcile();
  assert(
    resolve(repostWithLabel).pageName === null &&
      repostWithLabel.name.nextSibling.classList.contains("wfr-feed-note") &&
      repostWithLabel.permalink.nextSibling.textContent === "来自 微博网页版" &&
      view.wrappers(repostWithLabel.repost).length === 0,
    "a repost label does not move the outer author's entry back beside the time"
  );
  // Live pure-repost markup supplied by the user: the outer author's name is
  // a usercard span, followed by a separate grey repost label, with no comment.
  const pureRepost = view.add({
    uid: "7733309837",
    name: "鹿野莓厨",
    repost: { uid: LAN, name: "被转发者" },
  });
  const nativeName = view.document.createElement("span");
  nativeName.setAttribute("title", "鹿野莓厨");
  nativeName.setAttribute("usercard", "name=@鹿野莓厨");
  nativeName.textContent = "鹿野莓厨";
  const nameRow = pureRepost.name.parentNode;
  nameRow.insertBefore(nativeName, pureRepost.name);
  nameRow.removeChild(pureRepost.name);
  const repostLabel = view.document.createElement("span");
  repostLabel.className = "_fastbehind_ygi5b_59";
  repostLabel.textContent = "转发微博";
  nameRow.append(repostLabel);
  pureRepost.content.removeChild(pureRepost.text);
  pureRepost.content.className = "";
  view.reconcile();
  assert(
    resolve(pureRepost).uid === "7733309837" &&
      resolve(pureRepost).pageName === "鹿野莓厨" &&
      nativeName.nextSibling.classList.contains("wfr-feed-note") &&
      nativeName.nextSibling.nextSibling === repostLabel &&
      pureRepost.permalink.nextSibling.textContent === "来自 微博网页版" &&
      view.wrappers(pureRepost.repost).length === 0,
    "a pure repost places its entry between the outer usercard name and repost label"
  );
  assert(view.entry(noisy).textContent === "写备注", "mentions and commenters do not mark a card");
  for (const skipped of [profileConflict, permalinkConflict, noPermalink]) {
    assert(view.entry(skipped) === null, "an unprovable author gets no entry");
  }
  assert(
    view.entry(customDomain).textContent === "写备注" && view.hint(customDomain) === "" &&
      customDomain.permalink.nextSibling.classList.contains("wfr-feed-note"),
    "a UID-only author uses the permalink fallback without guessing a name anchor"
  );
}

async function nicknameMemory() {
  const view = openFeed(FEED_ONLY, { [radarKey(OWNER)]: RADAR_RAW });
  const same = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  const renamed = view.add({ uid: LAN, name: "岚在海边", index: 1 });
  const lookalike = view.add({ uid: BO, name: "阿岚在路上", index: 2 });
  const unnamed = view.add({ uid: LAN, name: "阿岚Lan", nameHref: "/alan", profileHref: "/alan", index: 3 });
  view.install();

  assert(
    view.hint(same) === "本地曾记录为：阿岚在路上",
    `a recorded earlier name is offered: ${view.hint(same)}`
  );
  assert(
    view.hint(renamed) === "本地曾记录为：阿岚Lan 等 2 个",
    `names that differ from the page are listed, latest first: ${view.hint(renamed)}`
  );
  assert(
    view.hint(lookalike) === "",
    "a recorded name belonging to another UID is never used as evidence"
  );
  assert(
    view.entry(unnamed) !== null && view.hint(unnamed) === "",
    "without a reliable page nickname there is an entry but no hint"
  );
  for (const parts of [same, renamed]) {
    assert(
      !/改名|曾用名|真实/.test(view.hint(parts)),
      "a difference is not reported as a confirmed rename or a full name history"
    );
  }
  assert(
    view.tab.product.feedNicknameHintText("阿岚Lan", {
      currentName: "阿岚Lan",
      historicalNames: [],
    }) === "" &&
      view.tab.product.feedNicknameHintText(null, {
        currentName: "阿岚Lan",
        historicalNames: ["阿岚在路上"],
      }) === "",
    "no hint without both a page name and differing evidence"
  );

  // Seeing a new page nickname records nothing.
  await view.entry(renamed).click();
  assert(
    view.card().textContent.includes("岚在海边") &&
      view.card().textContent.includes("阿岚在路上") &&
      view.card().textContent.includes("非实时"),
    "the card shows the page name and the dated local records side by side"
  );
  assert(
    view.browser.storage.get(radarKey(OWNER)) === RADAR_RAW &&
      view.browser.writes.length === 0 &&
      !RADAR_RAW.includes("岚在海边"),
    "the page's current nickname is never written as new evidence"
  );
}

async function cardAndQuickEdit() {
  const followerRaw = JSON.stringify({ marker: "follower bytes" });
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, HOSTILE, ["<i>摄影</i>"]]])),
    [followerKey(OWNER)]: followerRaw,
  });
  const lan = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  const bo = view.add({ uid: BO, name: "老薄", index: 1 });
  view.install();
  assert(view.cards().length === 0, "no card until an entry is used");

  // Existing note: opens as a dialog, in view mode, focused.
  await view.entry(lan).click();
  const lanCard = view.card();
  assert(
    lanCard.parentNode === view.document.body &&
      lanCard.getAttribute("role") === "dialog" &&
      view.document.activeElement === lanCard &&
      view.entry(lan).getAttribute("aria-expanded") === "true",
    "the card is a focused dialog outside the feed container"
  );
  assert(
    findAll(lanCard, (node) => node.textContent === HOSTILE && node.childNodes.length === 0).length === 1 &&
      findAll(lanCard, (node) => node.textContent === "<i>摄影</i>" && node.childNodes.length === 0).length === 1 &&
      findAll(view.document.body, (node) => ["IMG", "B", "I", "SCRIPT"].includes(node.tagName)).length === 0,
    "note and tags are rendered as plain text"
  );
  assert(
    lanCard.textContent.includes(`UID ${LAN}`) &&
      findAll(lanCard, (node) => node.tagName === "A" && node.href === `https://weibo.com/u/${LAN}`).length === 1 &&
      findButton(lanCard, "完整档案"),
    "the card identifies the UID and links to the profile and the full note"
  );

  // One card at a time; focus returns to an entry that still stands for the author.
  await view.entry(bo).click();
  assert(view.cards().length === 1 && view.card().textContent.includes(`UID ${BO}`), "only one card is open");
  assert(view.entry(lan).getAttribute("aria-expanded") === "false", "the previous entry is released");

  // New authors open in view mode, and an untouched form is not a draft.
  let boCard = view.card();
  assert(
    !textarea(boCard) && boCard.textContent.includes("暂无此账号的本地昵称或关系记录"),
    "a new note opens for viewing, with no automatic edit form"
  );
  await findButton(boCard, "关闭").click();
  assert(view.cards().length === 0, "an empty viewed card closes in one click");
  await view.entry(bo).click();
  await findButton(view.card(), "添加备注与标签").click();
  await findButton(view.card(), "关闭").click();
  assert(view.cards().length === 0, "entering edit without changing anything does not block close");
  await view.entry(bo).click();
  boCard = view.card();
  await findButton(boCard, "添加备注与标签").click();
  textarea(boCard).value = "临时输入";
  textarea(boCard).value = "";
  await view.document.dispatch("keydown", { key: "Escape" });
  assert(view.cards().length === 0, "restoring the original input clears the unsaved state");
  await view.entry(bo).click();
  boCard = view.card();
  await findButton(boCard, "添加备注与标签").click();
  assert(view.document.activeElement === textarea(boCard), "the note field takes focus");

  // IME: a composing Enter neither adds a tag nor saves.
  tagInput(boCard).value = "laobo";
  await tagInput(boCard).dispatch("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
  textarea(boCard).value = "写到一半";
  await textarea(boCard).dispatch("keydown", { key: "Enter", isComposing: true, keyCode: 229, ctrlKey: true });
  await tick();
  assert(
    tagInput(boCard).value === "laobo" &&
      findAll(boCard, (node) => node.tagName === "LI").length === 0 &&
      !(BO in view.stored()),
    "a composing Enter in the feed card neither adds a tag nor saves"
  );
  tagInput(boCard).value = "";

  // A user-requested close never discards typed input.
  await findButton(boCard, "关闭").click();
  await view.document.dispatch("keydown", { key: "Escape" });
  await view.document.dispatch("click", { target: view.feed.scroller });
  await view.entry(lan).click();
  assert(
    view.card() === boCard &&
      textarea(boCard).value === "写到一半" &&
      boCard.textContent.includes("尚未保存的输入"),
    "close, Escape, an outside click and another entry all keep a card with a draft"
  );

  // A failed save keeps the input and changes no view.
  view.browser.locksAvailable = false;
  await findButton(boCard, "保存").click();
  view.browser.locksAvailable = true;
  assert(
    !(BO in view.stored()) &&
      view.entry(bo).textContent === "写备注" &&
      textarea(boCard).value === "写到一半" &&
      statusText(boCard).includes("未保存"),
    "a failed save shows nothing as saved and keeps the input"
  );

  textarea(boCard).value = "信息流里新建的备注";
  await findButton(boCard, "保存").click();
  assert(
    view.stored()[BO].note === "信息流里新建的备注" && view.stored()[LAN].note === HOSTILE,
    "the note is saved under the author's own UID"
  );
  assert(
    view.entry(bo).textContent === "有备注" && view.entry(lan).textContent === "有备注",
    "the mounted entry reflects the save"
  );

  await findButton(boCard, "关闭").click();
  assert(
    view.cards().length === 0 && view.document.activeElement === view.entry(bo),
    "closing returns focus to the entry it was opened from"
  );
  assert(view.document.listenerCount() === 0, "closing removes the card's document listeners");

  // Delete from the feed card.
  await view.entry(bo).click();
  await findButton(view.card(), "删除档案").click();
  await findButton(view.card(), "确认删除").click();
  assert(
    !(BO in view.stored()) &&
      view.entry(bo).textContent === "写备注" &&
      view.card().textContent.includes("还没有为此账号写下备注或标签"),
    "after a delete the entry and the card return to the no-note state"
  );
  await view.document.dispatch("keydown", { key: "Escape" });
  assert(view.cards().length === 0, "Escape closes a card with nothing unsaved");

  // Nothing but friend notes was written, and nothing was requested.
  assert(view.browser.fetchCalls === 0, "the feed card sends no request");
  assert(
    view.browser.writes.every((key) => key === notesKey(OWNER)) &&
      view.browser.storage.get(followerKey(OWNER)) === followerRaw &&
      !view.browser.storage.has(radarKey(OWNER)) &&
      ![...view.browser.storage.keys()].some((key) => key.includes("profileVisits") || key.includes("usage")),
    "no visit log, usage statistics or relationship data is touched"
  );
}

async function recycledNodes() {
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "只属于阿岚的备注"]])),
  });
  const node = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  view.install();

  // A -> B with a card open in view mode.
  const oldEntry = view.entry(node);
  await oldEntry.click();
  assert(view.card().textContent.includes("只属于阿岚的备注"), "A's card is open");
  recycle(node, BO, "老薄");
  view.reconcile();
  assert(view.cards().length === 0, "a card that no longer matches its author is closed");
  assert(
    oldEntry.parentNode === null || !node.card.contains(oldEntry),
    "the old entry is removed from the recycled node"
  );
  const newEntry = view.entry(node);
  assert(
    newEntry !== oldEntry && newEntry.textContent === "写备注",
    "the recycled node gets a new entry for its new author"
  );
  assert(
    !view.document.body.textContent.includes("只属于阿岚的备注"),
    "A's note must not linger anywhere once the node shows B"
  );
  await oldEntry.click();
  assert(view.cards().length === 0, "the old entry's callback can no longer open A's card");
  await newEntry.click();
  assert(
    view.card().textContent.includes(`UID ${BO}`) &&
      !view.card().textContent.includes("只属于阿岚的备注"),
    "the new entry opens B's card"
  );
  await findButton(view.card(), "添加备注与标签").click();
  textarea(view.card()).value = "写给老薄";
  await findButton(view.card(), "保存").click();
  assert(
    view.stored()[BO].note === "写给老薄" && view.stored()[LAN].note === "只属于阿岚的备注",
    "the save lands on the author the card was opened for"
  );
  await findButton(view.card(), "关闭").click();

  // B -> A while B's card holds a draft: the draft is kept, labelled, and
  // still saves to B.
  await view.entry(node).click();
  await findButton(view.card(), "编辑").click();
  textarea(view.card()).value = "老薄的草稿，节点却被复用了";
  const draftCard = view.card();
  const draftEntry = view.entry(node);
  recycle(node, LAN, "阿岚Lan");
  view.reconcile();
  assert(
    view.card() === draftCard &&
      textarea(draftCard).value === "老薄的草稿，节点却被复用了" &&
      draftCard.textContent.includes(`此卡片仍属于 UID ${BO}`),
    "a recycled node must not discard a draft; the card says whose it is"
  );
  assert(
    view.entry(node) !== draftEntry && view.entry(node).textContent === "有备注",
    "the node itself already shows the new author's entry"
  );
  await findButton(draftCard, "保存").click();
  assert(
    view.stored()[BO].note === "老薄的草稿，节点却被复用了" &&
      view.stored()[LAN].note === "只属于阿岚的备注",
    "a draft saved after its node was recycled goes to its own author, not the node's new one"
  );
  await findButton(draftCard, "关闭").click();
  assert(
    view.cards().length === 0 && view.document.activeElement !== view.entry(node),
    "focus is not handed to an entry that now stands for someone else"
  );

  // Recycled while the save is in flight.
  await view.entry(node).click();
  await findButton(view.card(), "编辑").click();
  textarea(view.card()).value = "保存途中节点被复用";
  view.browser.beforeGrant = async () => {
    view.browser.beforeGrant = null;
    recycle(node, STRANGER, "路人");
    view.reconcile();
  };
  await findButton(view.card(), "保存").click();
  assert(
    view.stored()[LAN].note === "保存途中节点被复用" && !(STRANGER in view.stored()),
    "an in-flight save is bound to the UID captured when editing began"
  );
  assert(
    view.entry(node).textContent === "写备注",
    "the result does not mark the node's new author"
  );
  if (view.cards().length === 1) await findButton(view.card(), "关闭").click();

  // Original <-> repost on the same node, and a node that stops being provable.
  const second = view.add({ uid: LAN, name: "阿岚Lan", index: 1 });
  view.reconcile();
  assert(view.entry(second).textContent === "有备注", "original card");
  const reArticle = view.document.createElement("article");
  const reHeader = view.document.createElement("header");
  const reLink = view.document.createElement("a");
  reLink.setAttribute("href", `https://weibo.com/${LAN}/Qorig1nal`);
  reHeader.append(reLink);
  reArticle.append(reHeader);
  const retweet = view.document.createElement("div");
  retweet.className = "retweet";
  retweet.append(reArticle);
  second.content.append(retweet);
  recycle(second, BO, "老薄");
  view.reconcile();
  assert(
    view.entry(second).textContent === "有备注" &&
      view.entry(second).getAttribute("aria-label").includes("老薄") &&
      view.wrappers(retweet).length === 0,
    "a node turned into a repost is bound to the reposter, not the original author"
  );
  second.permalink.setAttribute("href", "/somewhere/else");
  view.reconcile();
  assert(view.entry(second) === null, "a node that stops proving its author loses its entry");
}

async function lifecycle() {
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "阿岚的备注"]])),
    [notesKey(OTHER_OWNER)]: JSON.stringify(notesState([[BO, "另一个账号写的"]], OTHER_OWNER)),
  });
  const lan = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  const bo = view.add({ uid: BO, name: "老薄", index: 1 });
  view.install();
  const runtime = view.tab.product.feedRuntime;
  assert(runtime().entries.size === 2, "two cards, two entries");

  // New card inserted.
  const late = view.add({ uid: TWIN, name: "后来的人", index: 2 });
  for (const observer of view.observers()) observer.callback([]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(view.entry(late) !== null, "a card inserted later is picked up by the batched pass");

  // Node removed, with its card open.
  await view.entry(bo).click();
  await findButton(view.card(), "添加备注与标签").click();
  textarea(view.card()).value = "原微博移除后仍需保留的草稿";
  view.feed.scroller.removeChild(bo.card);
  view.reconcile();
  assert(
    runtime().entries.size === 2 && view.cards().length === 1 && textarea(view.card()),
    "a removed node's entry is forgotten; its card survives only because it holds a draft"
  );
  await findButton(view.card(), "取消").click();
  await findButton(view.card(), "关闭").click();
  await view.entry(lan).click();
  view.feed.scroller.removeChild(lan.card);
  view.reconcile();
  assert(view.cards().length === 0, "a view-mode card closes when its node is removed");

  // Feed root replaced.
  const oldScroller = view.feed.scroller;
  view.feed.homeWrap.removeChild(oldScroller);
  const newScroller = view.document.createElement("div");
  newScroller.id = "scroller";
  newScroller.className = "vue-recycle-scroller";
  view.feed.homeWrap.append(newScroller);
  view.feed.scroller = newScroller;
  const fresh = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  view.install();
  assert(
    runtime().entries.size === 1 && view.entry(fresh).textContent === "有备注",
    "after the root is replaced only cards of the new root carry entries"
  );
  assert(view.observers().length === 1, "the observer follows the new root");

  // Owner changes: entries are rebuilt from the new owner's notes only.
  const mine = view.add({ uid: OTHER_OWNER, name: "切换后的自己", index: 1 });
  const boAgain = view.add({ uid: BO, name: "老薄", index: 2 });
  view.reconcile();
  assert(view.entry(boAgain).textContent === "写备注", "owner A has no note for 老薄");
  await view.entry(fresh).click();
  view.tab.ownerUid = OTHER_OWNER;
  view.reconcile();
  assert(view.cards().length === 0, "an owner change closes the open card");
  assert(
    view.entry(fresh).textContent === "写备注" &&
      view.entry(boAgain).textContent === "有备注" &&
      view.entry(mine) === null &&
      runtime().ownerUid === OTHER_OWNER,
    "entries follow the new owner's own notes"
  );
  view.tab.ownerUid = null;
  view.reconcile();
  assert(
    view.wrappers().length === 0 && runtime() === null,
    "without a reliable owner nothing is shown"
  );
  view.tab.ownerUid = OWNER;
  view.reconcile();
  assert(view.entry(fresh).textContent === "有备注", "the owner's entries return");

  // Leaving the feed route removes every Toolkit node and the observer.
  await view.entry(fresh).click();
  view.tab.location.pathname = `/u/${LAN}`;
  view.tab.location.href = `https://weibo.com/u/${LAN}`;
  view.install();
  assert(
    view.wrappers().length === 0 &&
      view.cards().length === 0 &&
      view.observers().length === 0 &&
      view.document.listenerCount() === 0 &&
      runtime() === null,
    "a route change leaves no entry, card, observer or listener behind"
  );
  view.tab.location.pathname = "/";
  view.tab.location.href = "https://weibo.com/";
  view.install();
  assert(view.entry(fresh).textContent === "有备注", "returning to the feed restores entries");

  // Turning the option off restores the page.
  await view.entry(fresh).click();
  view.setPreferences(ALL_OFF);
  view.install();
  assert(
    view.wrappers().length === 0 &&
      view.cards().length === 0 &&
      view.observers().length === 0 &&
      findAll(view.document.body, (node) => String(node.className).includes("wfr-")).length === 0,
    "switching the option off removes every Toolkit node and the observer"
  );
  assert(
    fresh.permalink.parentNode.childNodes.length === 2,
    "the header is back to Weibo's own two nodes"
  );
}

async function sameTabSync() {
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "旧备注"]])),
  });
  const lanA = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
  const lanB = view.add({ uid: LAN, name: "阿岚Lan", bid: "Qsecond22", index: 1 });
  const bo = view.add({ uid: BO, name: "老薄", index: 2 });
  view.install();
  const overlay = () =>
    findAll(view.document.body, (node) => node.classList.contains("wfr-overlay"))[0];
  const detail = (uid) => view.tab.product.showFriendNoteDetail(OWNER, uid, null);

  // Toolkit save -> the open feed card (view mode) and the entries follow.
  await view.entry(lanA).click();
  const card = view.card();
  detail(LAN);
  await findButton(overlay(), "编辑").click();
  textarea(overlay()).value = "工具箱里保存的新备注";
  await findButton(overlay(), "保存").click();
  assert(
    card.textContent.includes("工具箱里保存的新备注") && !card.textContent.includes("旧备注"),
    "a feed card in view mode shows a note saved elsewhere in the tab"
  );

  // A failed save elsewhere leaks nothing.
  await findButton(overlay(), "编辑").click();
  textarea(overlay()).value = "没有保存成功";
  view.browser.locksAvailable = false;
  await findButton(overlay(), "保存").click();
  view.browser.locksAvailable = true;
  assert(
    !card.textContent.includes("没有保存成功") && view.stored()[LAN].note === "工具箱里保存的新备注",
    "a failed save elsewhere does not change the feed card"
  );

  // A feed card with a draft keeps it, keeps its original token, and conflicts.
  await findButton(card, "编辑").click();
  textarea(card).value = "信息流卡片里的草稿";
  detail(LAN);
  await findButton(overlay(), "编辑").click();
  textarea(overlay()).value = "工具箱再次保存";
  await findButton(overlay(), "保存").click();
  assert(
    view.card() === card && textarea(card).value === "信息流卡片里的草稿",
    "a draft in the feed card survives a save elsewhere"
  );
  await findButton(card, "保存").click();
  assert(
    view.stored()[LAN].note === "工具箱再次保存" &&
      card.textContent.includes("已被其他标签页修改") &&
      textarea(card).value === "信息流卡片里的草稿",
    "the draft still saves against its original version and gets a conflict"
  );
  await findButton(card, "取消").click();
  await findButton(card, "关闭").click();

  // Create and delete elsewhere: every mounted entry of that UID follows, and
  // no other author's entry does.
  detail(BO);
  await findButton(overlay(), "添加备注与标签").click();
  textarea(overlay()).value = "工具箱里给老薄写的";
  await findButton(overlay(), "保存").click();
  assert(view.entry(bo).textContent === "有备注", "a note created elsewhere marks the entry");
  detail(LAN);
  await findButton(overlay(), "删除档案").click();
  await findButton(overlay(), "确认删除").click();
  assert(
    view.entry(lanA).textContent === "写备注" &&
      view.entry(lanB).textContent === "写备注" &&
      view.entry(bo).textContent === "有备注",
    "a delete elsewhere clears exactly that author's entries"
  );

  // A removed node no longer takes part.
  const removedEntry = view.entry(lanB);
  view.feed.scroller.removeChild(lanB.card);
  view.reconcile();
  detail(LAN);
  await findButton(overlay(), "添加备注与标签").click();
  textarea(overlay()).value = "节点移除后再保存";
  await findButton(overlay(), "保存").click();
  assert(
    view.entry(lanA).textContent === "有备注" && removedEntry.textContent === "写备注",
    "an entry whose node was removed is no longer updated"
  );

  // A note saved in another tab is picked up when a card is opened.
  const otherTab = openTab(view.browser, NAMES, { ownerUid: OWNER });
  const current = otherTab.product.loadFriendNotesState(OWNER).state.notes[BO];
  await otherTab.product.saveFriendNote(
    OWNER,
    BO,
    { note: "另一个标签页改过的备注", tags: [] },
    otherTab.product.friendNoteRecordToken(current),
    T
  );
  await view.entry(bo).click();
  assert(
    view.card().textContent.includes("另一个标签页改过的备注"),
    "opening a card re-reads the stored note"
  );
  assert(view.browser.fetchCalls === 0, "syncing sends no request");
}

async function otherFeedFeatures() {
  const view = openFeed(
    {
      ...FEED_ONLY,
      hideLatestRecommended: true,
      strongFeedPromotionFilter: true,
      autoExpandLongPosts: true,
    },
    { [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "阿岚"], [BO, "推广账号"]])) }
  );
  const plain = view.add({ uid: LAN, name: "阿岚Lan", expand: true, index: 0 });
  const promoted = view.add({ uid: BO, name: "推广账号", badge: "荐读", index: 1 });
  const postIdBefore = view.tab.product.extractUsagePostId(plain.card);
  view.install();

  assert(
    promoted.card.classList.contains("wfr-latest-recommended-hidden") &&
      view.entry(promoted) === null,
    "a collapsed promotion card is still collapsed and carries no entry"
  );
  assert(
    !plain.card.classList.contains("wfr-latest-recommended-hidden") &&
      view.entry(plain).textContent === "有备注",
    "an ordinary card is kept and marked"
  );
  assert(
    view.tab.product.classifyLatestRecommendedCard(plain.card, true) === false &&
      view.tab.product.classifyLatestRecommendedCard(promoted.card, false) === true,
    "the entry does not change promotion classification, even in strong mode"
  );
  assert(
    view.tab.product.extractUsagePostId(plain.card) === postIdBefore && postIdBefore === "Qa1b2C3d4",
    "the post identity read from the header is unchanged by the entry"
  );
  const control = findAll(plain.card, (node) => node.classList.contains("expand"))[0];
  const validated = view.tab.product.validateLongPostExpandControl(control);
  assert(
    validated !== null && validated.identity === `${LAN}/Qa1b2C3d4`,
    "auto-expand still accepts the card's native control"
  );

  // The promotion filter can be switched off without taking the entries along,
  // and the other way round.
  view.setPreferences({ ...FEED_ONLY, autoExpandLongPosts: true });
  view.install();
  assert(
    !promoted.card.classList.contains("wfr-latest-recommended-hidden") &&
      view.entry(promoted).textContent === "有备注",
    "with the promotion filter off the card returns and gets its entry"
  );
  view.setPreferences({ ...ALL_OFF, hideLatestRecommended: true });
  view.install();
  assert(
    promoted.card.classList.contains("wfr-latest-recommended-hidden") &&
      view.wrappers().length === 0 &&
      view.observers().length === 1,
    "with only the promotion filter on, the filter keeps working and no entry remains"
  );
}

// A click can arrive after a node was given another post and before the
// batched pass has run. The entry must be judged against the page as it is at
// that moment, not against what it meant when it was created.
async function clickBeforeReconcile() {
  const seed = {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "只属于阿岚的备注"]])),
  };

  // UID changed.
  let view = openFeed(FEED_ONLY, seed);
  let node = view.add({ uid: LAN, name: "阿岚Lan" });
  view.install();
  let oldEntry = view.entry(node);
  recycle(node, BO, "老薄");
  await oldEntry.click();
  assert(
    view.cards().length === 0 &&
      !view.document.body.textContent.includes("只属于阿岚的备注"),
    "a click after the author changed and before any pass must not open the old note"
  );
  assert(
    view.entry(node) !== oldEntry &&
      view.entry(node).textContent === "写备注" &&
      !node.card.contains(oldEntry),
    "the click itself brings the node's entry up to date, without waiting for a frame"
  );
  await view.entry(node).click();
  assert(view.card().textContent.includes(`UID ${BO}`), "the new entry opens the new author");
  // Once open, the card keeps the owner and subject it was confirmed for.
  await findButton(view.card(), "添加备注与标签").click();
  textarea(view.card()).value = "写给老薄，随后节点又变了";
  recycle(node, STRANGER, "路人");
  await findButton(view.card(), "保存").click();
  assert(
    view.stored()[BO].note === "写给老薄，随后节点又变了" && !(STRANGER in view.stored()),
    "a save made after the node changed again still goes to the confirmed subject"
  );

  // Evidence turned contradictory.
  view = openFeed(FEED_ONLY, seed);
  node = view.add({ uid: LAN, name: "阿岚Lan" });
  view.install();
  oldEntry = view.entry(node);
  node.avatar.setAttribute("href", `/u/${BO}`);
  await oldEntry.click();
  assert(
    view.cards().length === 0 && view.entry(node) === null,
    "conflicting evidence at click time opens nothing and drops the entry"
  );

  // Node removed from the feed.
  view = openFeed(FEED_ONLY, seed);
  node = view.add({ uid: LAN, name: "阿岚Lan" });
  view.install();
  oldEntry = view.entry(node);
  view.feed.scroller.removeChild(node.card);
  await oldEntry.click();
  assert(view.cards().length === 0, "an entry on a removed node opens nothing");
  assert(view.tab.product.feedRuntime().entries.size === 0, "and is forgotten at once");

  // Owner, route and option are re-checked at the same moment.
  for (const [label, change] of [
    ["owner changed", (current) => { current.tab.ownerUid = OTHER_OWNER; }],
    ["owner unknown", (current) => { current.tab.ownerUid = null; }],
    ["route left", (current) => { current.tab.location.pathname = "/hot"; }],
    ["option off", (current) => current.setPreferences(ALL_OFF)],
  ]) {
    view = openFeed(FEED_ONLY, seed);
    node = view.add({ uid: LAN, name: "阿岚Lan" });
    view.install();
    oldEntry = view.entry(node);
    change(view);
    await oldEntry.click();
    assert(view.cards().length === 0, `${label}: the stale entry must not open a card`);
    assert(
      !view.document.body.textContent.includes("只属于阿岚的备注"),
      `${label}: the old note must not be shown`
    );
    assert(
      !node.card.contains(oldEntry),
      `${label}: the stale entry is replaced or removed by the click itself`
    );
  }

  // The same checks let an unchanged entry through.
  view = openFeed(FEED_ONLY, seed);
  node = view.add({ uid: LAN, name: "阿岚Lan" });
  view.install();
  await view.entry(node).click();
  assert(view.card().textContent.includes("只属于阿岚的备注"), "an unchanged entry still opens");
}

// Geometry here is simulated: the test supplies the viewport and element
// boxes. It checks the placement arithmetic and listener lifecycle, not how a
// browser lays the card out.
async function cardPlacement() {
  const openFeedWithProduct = openFeed(FEED_ONLY);
  const place = openFeedWithProduct.tab.product.computeFeedFriendNoteCardPlacement;
  const fits = (placement, height, viewport) =>
    placement.top >= 12 && placement.top + Math.min(height, placement.maxHeight) <= viewport.height - 12;
  const anchorAt = (top, left = 300) => ({ left, top, bottom: top + 20 });

  const desktop = { width: 1280, height: 800 };
  assert(place(anchorAt(100), { width: 360, height: 300 }, desktop).top === 126, "below when it fits");
  assert(
    place(anchorAt(700), { width: 360, height: 300 }, desktop).top === 394,
    "above when only that side fits"
  );
  // The measured height may still be the uncapped one; the decision uses the
  // height the card will actually have.
  assert(
    place(anchorAt(700), { width: 360, height: 600 }, desktop).top === 134,
    "an over-tall card is placed by its capped height, flush above its entry"
  );
  // The reported case: neither side fits.
  const cramped = { width: 1024, height: 400 };
  const reported = place(anchorAt(160), { width: 360, height: 288 }, cramped);
  assert(
    reported.top === 100 && fits(reported, 288, cramped),
    `with no room on either side the card is pinned inside the viewport: ${JSON.stringify(reported)}`
  );
  // Taller than the viewport: capped, and the cap is what gets positioned.
  const tall = place(anchorAt(160), { width: 360, height: 900 }, cramped);
  assert(
    tall.maxHeight === 376 && tall.top === 12 && fits(tall, 900, cramped),
    "content taller than the viewport is capped and scrolls inside the card"
  );
  assert(
    place(anchorAt(100), { width: 360, height: 900 }, { width: 1280, height: 2000 }).maxHeight === 560,
    "the card never grows past its own limit on a tall screen"
  );
  // Narrow window and an entry near the right edge.
  const narrow = { width: 300, height: 700 };
  const squeezed = place(anchorAt(100, 250), { width: 276, height: 300 }, narrow);
  assert(
    squeezed.left === 12 && squeezed.left + 276 <= 300 - 12,
    "in a narrow window the card stays inside the left and right margins"
  );
  // The entry itself is outside the viewport.
  for (const top of [-500, 5000]) {
    const offscreen = place(anchorAt(top), { width: 360, height: 300 }, desktop);
    assert(fits(offscreen, 300, desktop), `the card stays reachable with its entry at ${top}`);
  }

  // The same arithmetic, driven through the open card.
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "阿岚的备注"]])),
  });
  const node = view.add({ uid: LAN, name: "阿岚Lan" });
  view.install();
  const baselineResizeListeners = view.windowListeners("resize").length;
  let cardHeight = 288;
  let anchor = { left: 300, top: 160, bottom: 180, right: 348, width: 48, height: 20 };
  view.window.innerWidth = 1024;
  view.window.innerHeight = 400;
  view.document.rectFor = (element) => {
    if (element.id === "wfr-feed-note-card") {
      return { left: 0, top: 0, right: 360, bottom: cardHeight, width: 360, height: cardHeight };
    }
    return element.classList.contains("wfr-feed-note-entry") ? anchor : null;
  };
  await view.entry(node).click();
  const card = view.card();
  const box = () => ({
    top: parseInt(card.style.top, 10) - view.window.scrollY,
    bottom:
      parseInt(card.style.top, 10) - view.window.scrollY +
      Math.min(cardHeight, parseInt(card.style.maxHeight, 10)),
  });
  const inside = () => box().top >= 12 && box().bottom <= view.window.innerHeight - 12;
  assert(
    card.style.top === "100px" && card.style.left === "300px" && inside(),
    `first open is placed inside the viewport: ${JSON.stringify(card.style)}`
  );
  assert(view.sizeObservers().length === 1, "the card's size is observed while it is open");

  // Content grows: view -> edit, tags, a conflict box.
  await findButton(card, "编辑").click();
  cardHeight = 520;
  view.cardResized();
  assert(
    card.style.maxHeight === "376px" && inside(),
    `a taller card is re-fitted and capped: ${JSON.stringify(card.style)}`
  );
  assert(
    findButton(card, "保存") && findButton(card, "取消") && findButton(card, "关闭"),
    "save, cancel and close are all still in the card"
  );
  assert(
    findButton(card, "关闭").parentNode.classList.contains("wfr-feed-note-card-head") &&
      findButton(card, "保存").parentNode.parentNode.parentNode.parentNode.classList.contains("wfr-feed-note-card-body"),
    "close sits in the fixed head and the form in the scrolling body"
  );

  // The viewport shrinks.
  view.window.innerHeight = 300;
  view.fireWindow("resize");
  assert(
    card.style.maxHeight === "276px" && inside(),
    `a smaller viewport re-fits the card: ${JSON.stringify(card.style)}`
  );

  // The page scrolls: the entry moves in the viewport, the card follows it.
  view.window.innerHeight = 800;
  view.window.scrollY = 900;
  anchor = { ...anchor, top: 60, bottom: 80 };
  view.fireWindow("scroll");
  assert(
    card.style.top === `${86 + 900}px` && inside(),
    `after scrolling the card is below its entry again: ${JSON.stringify(card.style)}`
  );

  // Closing removes every listener the card added.
  await findButton(card, "取消").click();
  await findButton(card, "关闭").click();
  assert(
    view.sizeObservers().length === 0 &&
      view.windowListeners("scroll").length === 0 &&
      view.windowListeners("resize").length === baselineResizeListeners &&
      view.document.listenerCount() === 0,
    "size, scroll, resize and document listeners exist only while a card is open"
  );
  view.setPreferences(ALL_OFF);
  view.install();
  assert(
    view.windowListeners("resize").length === 0,
    "turning the option off removes the last window listener"
  );
}

// A draft whose entry is gone must stay reachable and must still be the same
// draft: same input, same base version, same save target.
async function detachedDraft() {
  for (const how of ["recycled", "removed"]) {
    const view = openFeed(FEED_ONLY, {
      [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "原来的备注"]])),
    });
    const node = view.add({ uid: LAN, name: "阿岚Lan", index: 0 });
    const other = view.add({ uid: TWIN, name: "另一位", index: 1 });
    view.install();
    view.window.innerWidth = 1024;
    view.window.innerHeight = 700;
    view.document.rectFor = (element) =>
      element.id === "wfr-feed-note-card"
        ? { left: 0, top: 0, right: 360, bottom: 300, width: 360, height: 300 }
        : element.classList.contains("wfr-feed-note-entry")
          ? { left: 300, top: 100, bottom: 120, right: 348, width: 48, height: 20 }
          : null;
    await view.entry(node).click();
    const card = view.card();
    await findButton(card, "编辑").click();
    textarea(card).value = "入口消失后仍要保住的草稿";
    assert(card.style.top === "126px", "anchored while its entry exists");

    if (how === "recycled") recycle(node, BO, "老薄");
    else view.feed.scroller.removeChild(node.card);
    view.reconcile();

    const docked = () =>
      view.card() === card &&
      card.classList.contains("wfr-feed-note-card-docked") &&
      card.style.top === "" &&
      card.style.left === "";
    assert(docked(), `${how}: the draft card is docked to the viewport, not left at old coordinates`);
    assert(
      card.textContent.includes(`此卡片仍属于 UID ${LAN}`) && card.textContent.includes("停靠"),
      `${how}: the docked card names its subject UID`
    );

    // Scrolling and resizing can no longer carry it away or disturb it.
    view.window.scrollY = 8000;
    view.fireWindow("scroll");
    view.window.innerHeight = 320;
    view.fireWindow("resize");
    view.cardResized();
    assert(
      docked() &&
        card.style.maxHeight === "296px" &&
        textarea(card).value === "入口消失后仍要保住的草稿",
      `${how}: after scrolling and resizing the draft is still docked, capped and intact`
    );
    assert(
      findButton(card, "保存") && findButton(card, "取消") && findButton(card, "关闭"),
      `${how}: save, cancel and close remain available`
    );

    // It still refuses to be discarded and still blocks a second card.
    await findButton(card, "关闭").click();
    await view.entry(other).click();
    assert(view.card() === card && docked(), `${how}: the draft is not dropped for another card`);

    // Its base version is the one it started from: a newer save elsewhere is a
    // conflict, not something to overwrite.
    const otherTab = openTab(view.browser, NAMES, { ownerUid: OWNER });
    const stored = otherTab.product.loadFriendNotesState(OWNER).state.notes[LAN];
    await otherTab.product.saveFriendNote(
      OWNER,
      LAN,
      { note: "另一个标签页先保存", tags: [] },
      otherTab.product.friendNoteRecordToken(stored),
      T
    );
    await findButton(card, "保存").click();
    assert(
      view.stored()[LAN].note === "另一个标签页先保存" &&
        card.textContent.includes("已被其他标签页修改") &&
        textarea(card).value === "入口消失后仍要保住的草稿" &&
        docked(),
      `${how}: the docked draft keeps its original token and reports the conflict`
    );
    await findButton(card, "用我的内容覆盖").click();
    assert(
      view.stored()[LAN].note === "入口消失后仍要保住的草稿" && !(BO in view.stored()),
      `${how}: the draft is saved to its own subject, never to the node's new author`
    );
    if (how === "recycled") {
      assert(view.entry(node).textContent === "写备注", "the node's new author is not marked");
    }

    // Saved: nothing left to protect, so it can be closed and others opened.
    await findButton(card, "关闭").click();
    assert(view.cards().length === 0, `${how}: a saved docked card closes normally`);
    await view.entry(other).click();
    assert(view.card().textContent.includes(`UID ${TWIN}`), `${how}: other cards open again`);
    assert(
      !view.card().classList.contains("wfr-feed-note-card-docked"),
      "a newly opened card is anchored, not docked"
    );
  }

  // Cancelling a docked draft keeps the stored note and frees the card.
  const view = openFeed(FEED_ONLY, {
    [notesKey(OWNER)]: JSON.stringify(notesState([[LAN, "原来的备注"]])),
  });
  const node = view.add({ uid: LAN, name: "阿岚Lan" });
  view.install();
  view.window.innerWidth = 1024;
  view.window.innerHeight = 700;
  await view.entry(node).click();
  await findButton(view.card(), "编辑").click();
  textarea(view.card()).value = "决定不要的草稿";
  view.feed.scroller.removeChild(node.card);
  view.reconcile();
  await findButton(view.card(), "取消").click();
  assert(
    view.stored()[LAN].note === "原来的备注" &&
      view.card().textContent.includes("原来的备注") &&
      view.card().classList.contains("wfr-feed-note-card-docked"),
    "cancel discards only the draft and leaves the card showing the stored note"
  );
  await findButton(view.card(), "关闭").click();
  assert(view.cards().length === 0, "after cancelling, the docked card can be closed");
}

// Simulated geometry again: the test supplies the header's right edge, where
// the entry starts and how much native content follows it. It checks the
// decisions the product takes from those numbers, not real text rendering.
async function entryWidth() {
  const view = openFeed(FEED_ONLY, { [radarKey(OWNER)]: RADAR_RAW });
  const layout = view.tab.product.feedEntryLayout;
  const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
  assert(same(layout(600, 48, true), { compact: false, hintWidth: 216 }), "desktop: normal cap");
  assert(same(layout(134, 48, true), { compact: false, hintWidth: 80 }), "narrow: what is left");
  assert(same(layout(90, 48, true), { compact: false, hintWidth: 0 }), "too little: no inline hint");
  assert(same(layout(600, 48, false), { compact: false, hintWidth: 0 }), "no hint, nothing to size");
  assert(same(layout(30, 48, true), { compact: true, hintWidth: 0 }), "no room for the button: compact");
  assert(same(layout(-200, 48, false), { compact: true, hintWidth: 0 }), "already overflowing: compact");

  const node = view.add({ uid: LAN, name: "一个特别特别特别特别特别长的昵称" });
  const sourceText = view.document.createElement("span");
  sourceText.textContent = "来自 微博网页版";
  node.name.parentNode.append(sourceText);
  let headerRight = 284;
  let wrapperLeft = 86;
  let trailing = 64;
  view.window.innerWidth = 300;
  view.window.innerHeight = 700;
  view.document.rectFor = (element) => {
    if (element.tagName === "HEADER") return { left: 16, right: headerRight, width: headerRight - 16 };
    if (element.classList.contains("wfr-feed-note")) return { left: wrapperLeft, right: wrapperLeft + 120 };
    if (element.classList.contains("wfr-feed-note-entry")) return { width: 48 };
    if (element === sourceText) return { right: wrapperLeft + 120 + trailing };
    return null;
  };
  view.install();
  const entry = view.entry(node);
  const hintNode = findAll(node.card, (candidate) =>
    candidate.classList.contains("wfr-feed-note-hint")
  )[0];
  // 284 - 86 - 64 (native text after the entry) = 134 of room.
  assert(
    entry.textContent === "有备注" || entry.textContent === "写备注",
    "with room the entry keeps its full label"
  );
  assert(
    !hintNode.hidden && hintNode.style.maxWidth === "80px",
    `the hint is limited so that the native text after it still fits: ${JSON.stringify(hintNode.style)}`
  );
  assert(
    node.nameText.textContent === "一个特别特别特别特别特别长的昵称" &&
      node.permalink.textContent === "10分钟前" &&
      sourceText.textContent === "来自 微博网页版" &&
      node.permalink.parentNode.childNodes.length === 2,
    "Weibo's own nickname, time and source are neither edited nor moved"
  );

  // A long time text pushes the entry right: the hint yields first.
  wrapperLeft = 150;
  view.fireWindow("resize");
  assert(
    hintNode.hidden && entry.textContent.length === 3,
    "with too little room the inline hint is hidden and the entry stays whole"
  );
  assert(
    entry.getAttribute("aria-label").includes("本地曾记录为：阿岚Lan"),
    "the entry still announces the recorded name"
  );

  // Even the button does not fit: it shrinks to one character, keeps its
  // label, and still opens the card with everything in it.
  wrapperLeft = 200;
  view.fireWindow("resize");
  assert(
    entry.textContent === "写" && hintNode.hidden && entry.getAttribute("aria-label").includes("写备注"),
    `with no room for the button the entry is compact: ${entry.textContent}`
  );
  await entry.click();
  assert(
    view.card().textContent.includes("阿岚Lan") && view.card().textContent.includes("阿岚在路上"),
    "every recorded name is available in the card"
  );
  await findButton(view.card(), "添加备注与标签").click();
  textarea(view.card()).value = "窄栏里写的备注";
  await findButton(view.card(), "保存").click();
  assert(entry.textContent === "备", "a compact entry reflects a save in its compact form");
  await findButton(view.card(), "关闭").click();

  // Back at desktop width everything returns.
  headerRight = 900;
  wrapperLeft = 200;
  view.window.innerWidth = 1280;
  view.fireWindow("resize");
  assert(
    entry.textContent === "有备注" && !hintNode.hidden && hintNode.style.maxWidth === "216px",
    "widening the window restores the full entry and the hint"
  );

  // Weibo's own text in the author row changes with
  // no window resize: an ordinary feed pass must re-fit the entry, and restore
  // it once the room is back. Only native nodes are edited here, by the test.
  headerRight = 284;
  wrapperLeft = 86;
  view.fireWindow("resize");
  assert(
    entry.textContent === "有备注" && hintNode.style.maxWidth === "80px",
    "narrow column, short native author information: full entry and an 80px hint"
  );
  sourceText.textContent = "认证标记和额外作者信息变长";
  wrapperLeft = 200;
  view.reconcile();
  assert(
    entry.textContent === "备" && hintNode.hidden,
    `longer native author information re-fits the entry without a resize: ${entry.textContent}`
  );
  sourceText.textContent = "来自 微博网页版";
  wrapperLeft = 86;
  view.reconcile();
  assert(
    entry.textContent === "有备注" && !hintNode.hidden && hintNode.style.maxWidth === "80px",
    "when native author information is short again the full entry and hint return"
  );
  sourceText.textContent = "来自 一个名字非常非常长的第三方客户端";
  trailing = 180;
  view.reconcile();
  assert(
    entry.textContent === "备" && hintNode.hidden,
    "a longer native source text re-fits the entry the same way"
  );
  sourceText.textContent = "来自 微博网页版";
  trailing = 64;
  view.reconcile();
  assert(
    entry.textContent === "有备注" && hintNode.style.maxWidth === "80px",
    "and restores it when the source text is short again"
  );
  headerRight = 900;
  wrapperLeft = 200;
  view.fireWindow("resize");
  assert(
    entry.textContent === "有备注" && hintNode.style.maxWidth === "216px" &&
      node.permalink.textContent === "10分钟前" &&
      node.permalink.parentNode.childNodes.length === 2,
    "native nodes are exactly as the page left them"
  );

  // Fitting happens on change and on resize only, never on an idle pass. The
  // entry's own re-fits above changed its text and style, and that must not
  // have queued another measurement.
  const writes = view.document.writes;
  const before = JSON.stringify(hintNode.style);
  headerRight = 284;
  for (let pass = 0; pass < 3; pass += 1) view.reconcile();
  assert(
    view.document.writes === writes &&
      JSON.stringify(hintNode.style) === before &&
      entry.textContent === "有备注",
    "an unchanged pass neither re-measures nor rewrites the entry"
  );
}
(async () => {
  await switchesAndEntries();
  await clickBeforeReconcile();
  await cardPlacement();
  await detachedDraft();
  await entryWidth();
  authorIdentity();
  await nicknameMemory();
  await cardAndQuickEdit();
  await recycledNodes();
  await lifecycle();
  await sameTabSync();
  await otherFeedFeatures();
  console.log("friend notes feed invariants passed");
  // Auto-expand scroll tracking leaves a short idle timer behind.
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
