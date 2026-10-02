"use strict";

// Shared harness for the Friend Notes tests. It models only what the product
// touches: userscript storage shared between tabs, the page LockManager, the
// logged-in UID, and a small DOM. The product code under test is always the
// real generated userscript, loaded once per simulated tab.

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const notesKey = (ownerUid) => `weiboToolkit.friendNotes.v1.${ownerUid}`;
const radarKey = (ownerUid) => `weiboToolkit.friendRadar.v1.${ownerUid}`;
const followerKey = (ownerUid) => `weiboToolkit.followerSnapshot.v1.${ownerUid}`;

// One browser profile: every tab opened on it shares storage and locks.
function createSharedBrowser() {
  const lockQueues = new Map();
  const browser = {
    storage: new Map(),
    locksAvailable: true,
    lockNames: [],
    // async (lockName) => void, run after the lock is free and before the
    // holder's callback: the place where "another tab got there first" happens.
    beforeGrant: null,
    // (key) => true to make reading that key throw.
    failRead: null,
    // (key) => "throw" | "drop" | "land-then-throw" | undefined
    writeBehavior: null,
    writes: [],
    fetchCalls: 0,
  };
  browser.lockManager = {
    async request(name, options, callback) {
      assert(options && options.mode === "exclusive", "state locks must be exclusive");
      const previous = lockQueues.get(name) || Promise.resolve();
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      lockQueues.set(name, previous.then(() => held));
      await previous;
      try {
        if (browser.beforeGrant) await browser.beforeGrant(name);
        browser.lockNames.push(name);
        return await callback({ name });
      } finally {
        release();
      }
    },
  };
  return browser;
}

function applyWrite(browser, key, mutate) {
  const behavior = browser.writeBehavior ? browser.writeBehavior(key) : undefined;
  if (behavior === "throw") throw new Error("simulated write failure");
  if (behavior === "drop") return;
  mutate();
  browser.writes.push(key);
  if (behavior === "land-then-throw") {
    throw new Error("simulated failure after the write landed");
  }
}

// One tab: its own evaluation of the product, its own logged-in UID and route.
function openTab(browser, names, options = {}) {
  const tab = {
    ownerUid: options.ownerUid === undefined ? null : options.ownerUid,
    location: {
      origin: "https://weibo.com",
      pathname: "/",
      href: "https://weibo.com/",
    },
  };
  const pageWindow = {
    navigator: {
      get locks() {
        return browser.locksAvailable ? browser.lockManager : undefined;
      },
    },
  };
  Object.defineProperty(pageWindow, "$CONFIG", {
    get: () => ({ uid: tab.ownerUid }),
  });
  tab.product = loadProductFunctions(names, {
    unsafeWindow: pageWindow,
    location: tab.location,
    GM_getValue(key, fallback) {
      if (browser.failRead && browser.failRead(key)) {
        throw new Error("simulated read failure");
      }
      return browser.storage.has(key) ? browser.storage.get(key) : fallback;
    },
    GM_setValue(key, value) {
      applyWrite(browser, key, () => browser.storage.set(key, value));
    },
    GM_deleteValue(key) {
      applyWrite(browser, key, () => browser.storage.delete(key));
    },
    async fetch() {
      browser.fetchCalls += 1;
      throw new Error("unexpected network request");
    },
    setTimeout,
    clearTimeout,
    ...(options.context || {}),
  });
  return tab;
}

class FakeElement {
  constructor(tag, ownerDocument) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = ownerDocument;
    this.childNodes = [];
    this.parentNode = null;
    this.ownText = "";
    this.className = "";
    this.id = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
  }
  // A live view over className, like the real DOM's.
  get classList() {
    const element = this;
    const tokens = () => String(element.className).split(/\s+/).filter(Boolean);
    return {
      contains: (name) => tokens().includes(name),
      add(name) {
        if (tokens().includes(name)) return;
        element.ownerDocument.writes += 1;
        element.className = [...tokens(), name].join(" ");
      },
      remove(name) {
        if (!tokens().includes(name)) return;
        element.ownerDocument.writes += 1;
        element.className = tokens().filter((token) => token !== name).join(" ");
      },
      [Symbol.iterator]: () => tokens()[Symbol.iterator](),
    };
  }
  // Like a real anchor: the property is the attribute resolved to an absolute
  // URL, and assigning it sets the attribute.
  get href() {
    const value = this.getAttribute("href");
    if (value === null) return undefined;
    try {
      return new URL(value, "https://weibo.com").href;
    } catch (_) {
      return value;
    }
  }
  set href(value) {
    this.setAttribute("href", value);
  }
  // Geometry is opt-in: a test supplies document.rectFor(element). Without it
  // every element reports an empty box, which the product treats as "not laid
  // out" and skips.
  getBoundingClientRect() {
    const rect = this.ownerDocument.rectFor ? this.ownerDocument.rectFor(this) : null;
    return rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  // Supports the three selector forms the product uses: tag, .class and #id.
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    assert(/^[a-z]+$/.test(selector), `unsupported selector: ${selector}`);
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    return findAll(this, (node) => node !== this && node.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  get children() {
    return this.childNodes;
  }
  get parentElement() {
    return this.parentNode;
  }
  get textContent() {
    return this.ownText + this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this.ownerDocument.writes += 1;
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.ownText = String(value);
  }
  set innerHTML(_value) {
    throw new Error("innerHTML must never be used");
  }
  set outerHTML(_value) {
    throw new Error("outerHTML must never be used");
  }
  insertAdjacentHTML() {
    throw new Error("insertAdjacentHTML must never be used");
  }
  detach() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  append(...nodes) {
    for (const node of nodes) {
      assert(node instanceof FakeElement, "only elements may be appended");
      node.detach();
      this.ownerDocument.writes += 1;
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  insertBefore(node, reference) {
    node.detach();
    const index = this.childNodes.indexOf(reference);
    assert(index >= 0, "insertBefore reference is not a child");
    this.ownerDocument.writes += 1;
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    assert(index >= 0, "removeChild target is not a child");
    this.ownerDocument.writes += 1;
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }
  setAttribute(name, value) {
    this.ownerDocument.writes += 1;
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
  async dispatch(type, event = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) {
      await listener({ type, target: this, preventDefault() {}, ...event });
    }
  }
  // Handlers start async work without returning it, so a click settles only
  // after the pending promise jobs (lock, save, re-render) have run.
  async click() {
    if (this.disabled) return;
    await this.dispatch("click");
    await new Promise((resolve) => setImmediate(resolve));
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
}

function walk(root, visit) {
  visit(root);
  for (const child of root.childNodes) walk(child, visit);
}

function findAll(root, predicate) {
  const matches = [];
  walk(root, (node) => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

function findButton(root, text) {
  const matches = findAll(
    root,
    (node) => node.tagName === "BUTTON" && node.textContent === text
  );
  assert(matches.length === 1, `expected exactly one "${text}" button, found ${matches.length}`);
  return matches[0];
}

function createFakeDocument() {
  const observers = [];
  const listeners = new Map();
  const document = {
    activeElement: null,
    observers,
    // Counts every structural, attribute, class and text write made through
    // the fake DOM, so a test can prove that a repeated pass writes nothing.
    writes: 0,
    createElement(tag) {
      return new FakeElement(tag, document);
    },
    getElementById(id) {
      return findAll(document.body, (node) => node.id === id)[0] || null;
    },
    querySelector(selector) {
      return document.body.querySelector(selector);
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      const index = registered.indexOf(listener);
      if (index >= 0) registered.splice(index, 1);
    },
    listenerCount: () =>
      [...listeners.values()].reduce((total, list) => total + list.length, 0),
    async dispatch(type, event = {}) {
      for (const listener of [...(listeners.get(type) || [])]) {
        await listener({ type, preventDefault() {}, ...event });
      }
    },
  };
  document.head = document.createElement("head");
  document.body = document.createElement("body");
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }
    observe(target, options) {
      this.connected = true;
      this.options = options;
    }
    disconnect() {
      this.connected = false;
    }
  }
  return { document, MutationObserver: FakeMutationObserver };
}

// The part of a Weibo profile page the product looks for: a tab strip whose
// labels include 微博, inside <main>.
function mountProfileSkeleton(document) {
  const main = document.createElement("main");
  const host = document.createElement("div");
  const header = document.createElement("div");
  header.textContent = "微博原生资料区";
  const tabs = document.createElement("div");
  for (const label of ["精选", "微博", "视频"]) {
    const tab = document.createElement("span");
    tab.textContent = label;
    tabs.append(tab);
  }
  host.append(header, tabs);
  main.append(host);
  document.body.append(main);
  return { main, host, header, tabs };
}

function tagged(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof text === "string") node.textContent = text;
  return node;
}

function link(document, href, text, className) {
  const node = tagged(document, "a", className, text);
  if (href !== null) node.setAttribute("href", href);
  return node;
}

// The Home/Latest feed root the product looks for: #scroller carrying the
// vue-recycle-scroller class, inside .homeWrap.
function mountFeedSkeleton(document) {
  const homeWrap = tagged(document, "div", "homeWrap");
  const scroller = tagged(document, "div", "vue-recycle-scroller");
  scroller.id = "scroller";
  homeWrap.append(scroller);
  document.body.append(homeWrap);
  return { homeWrap, scroller };
}

// One feed card. The topology is the one the shipped promotion-classifier
// fixture pins (outer article > body branch > header + .wbpro-feed-content,
// reposts inside .retweet with their own article/header), and the header's
// /<UID>/<post id> permalink is the signal the maintainer's selector registry
// records as observed on live Weibo. The avatar and nickname links in /u/<UID>
// form follow that same fixture; they were not re-captured from a live page
// for this test, and generated class hashes are stubbed.
//
// Returned parts let a test rewrite the same nodes in place, the way the
// virtual list recycles a card for another post.
function createFeedCard(document, options) {
  const avatar = link(document, options.profileHref ?? `/u/${options.uid}`, "");
  const name = link(
    document,
    options.nameHref === undefined ? `/u/${options.uid}` : options.nameHref,
    null
  );
  const nameText = tagged(document, "span", null, options.name ?? "某用户");
  name.append(nameText);
  const nick = tagged(document, "div", "head_nick_h1");
  nick.append(name);
  if (options.badge) {
    const badge = tagged(document, "span", "wbpro-tag");
    badge.append(tagged(document, "span", null, options.badge));
    nick.append(badge);
  }
  const permalink =
    options.permalinkHref === null
      ? null
      : link(
          document,
          options.permalinkHref ?? `https://weibo.com/${options.uid}/${options.bid ?? "Qa1b2C3d4"}`,
          "10分钟前"
        );
  const info = tagged(document, "div", "head-info_info_h1");
  if (permalink) info.append(permalink);
  info.append(tagged(document, "div", null, "来自 微博网页版"));
  for (const href of options.extraHeaderLinks || []) {
    info.append(link(document, href, "附加链接"));
  }
  const headMain = tagged(document, "div", "head_main_h1");
  headMain.append(nick, info);
  const header = tagged(document, "header", "Feed_hd_h1");
  header.append(avatar, headMain);

  const text = tagged(document, "div", "detail_wbtext_h1", options.body ?? "普通正文");
  const content = tagged(document, "div", "wbpro-feed-content");
  content.append(text);
  for (const href of options.bodyLinks || []) {
    content.append(link(document, href, "@正文里提到的人"));
  }
  if (options.expand) content.append(tagged(document, "span", "expand", "展开"));
  let repost = null;
  if (options.repost) {
    const reAvatar = link(document, `/u/${options.repost.uid}`, options.repost.name);
    const rePermalink = link(
      document,
      `https://weibo.com/${options.repost.uid}/Qz9y8X7w6`,
      "昨天"
    );
    const reHeader = tagged(document, "header");
    reHeader.append(reAvatar, rePermalink);
    const reArticle = tagged(document, "article");
    reArticle.append(reHeader, tagged(document, "div", "wbpro-feed-reText", "被转正文"));
    repost = tagged(document, "div", "retweet");
    repost.append(reArticle);
    content.append(repost);
  }

  const footer = tagged(document, "footer");
  footer.append(tagged(document, "div", null, "转发"));
  for (const href of options.commentLinks || []) {
    footer.append(link(document, href, "评论里的人"));
  }

  const body = tagged(document, "div", "Feed_body_h1");
  body.append(header, content, footer);
  const article = tagged(document, "article", "woo-panel-main");
  article.append(body);
  const card = tagged(document, "div", "wbpro-scroller-item");
  card.setAttribute("data-index", String(options.index ?? 0));
  card.append(article);
  return { card, header, avatar, name, nameText, permalink, content, text, repost };
}

module.exports = {
  mountFeedSkeleton,
  createFeedCard,
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
};
