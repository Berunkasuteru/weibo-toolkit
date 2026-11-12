"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { assert, createFakeDocument } = require("./friend-notes-fixture");

const source = fs.readFileSync(path.resolve(__dirname, "..", "weibo-toolkit.user.js"), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function openPrivateMessagePage(participantNameText = "测试会话") {
  const { document, MutationObserver } = createFakeDocument();
  const createElement = document.createElement.bind(document);
  document.createElement = (tag) => {
    const node = createElement(tag);
    node.dataset = {};
    return node;
  };
  const surface = document.createElement("div");
  const owner = document.createElement("span");
  owner.textContent = "1001";
  const participant = document.createElement("span");
  participant.textContent = "2001";
  const name = document.createElement("span");
  name.textContent = participantNameText;
  const session = document.createElement("div");
  const avatar = document.createElement("img");
  session.querySelector = (selector) => ({
    ".hidden": participant, ".username": name, ".avatar.radius-c": avatar,
  })[selector] || null;
  const composer = document.createElement("textarea");
  document.body.append(surface, session, composer);
  const querySelector = document.querySelector.bind(document);
  document.querySelector = (selector) => ({
    ".sessionlist.active": session,
    ".user .left .hidden, .user .hidden": owner,
    ".right-container .message": surface,
    ".right-container textarea": composer,
  })[selector] || querySelector(selector);

  const listeners = new Map();
  const reads = [];
  const written = [];
  let closed = false;
  let pending;
  let lastSuggestedName = null;
  // Execute the unmodified entry point: the usual test loader skips startup.
  vm.runInNewContext(source, {
    document, MutationObserver, URL, URLSearchParams, Blob, BigInt, AbortController,
    location: { origin: "https://api.weibo.com", pathname: "/chat" },
    window: {
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    },
    unsafeWindow: {
      async showSaveFilePicker(options = {}) {
        lastSuggestedName = options.suggestedName || null;
        return { async createWritable() {
          return {
            async write(markdown) { written.push(markdown); },
            async close() { closed = true; },
          };
        } };
      },
    },
    GM_getValue(key, fallback) {
      reads.push(key);
      return key === "weiboToolkit.theme.v1" ? "dark" : fallback;
    },
    GM_registerMenuCommand() { throw new Error("normal-page startup must not run on chat"); },
    fetch(href, options) {
      assert(new URL(href).pathname === "/webim/2/direct_messages/conversation.json",
        "the actual private-message request must run");
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        options.signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    },
    setTimeout, clearTimeout, requestAnimationFrame: () => 0,
  }, { filename: "weibo-toolkit.user.js" });

  const root = document.getElementById("wfr-pm-export-root");
  assert(root && root.classList.contains("wfr-theme-dark"), "chat loads its saved theme and mounts export controls");
  assert(reads.length === 1 && reads[0] === "weiboToolkit.theme.v1", "chat reads no unrelated preferences");
  return {
    document,
    root,
    listeners,
    written,
    pending: () => pending,
    closed: () => closed,
    lastSuggestedName: () => lastSuggestedName,
  };
}

(async () => {
  for (const outcome of ["success", "failure", "cancel"]) {
    const view = openPrivateMessagePage();
    const button = view.root.querySelector("button");
    assert(!view.listeners.has("beforeunload"), "idle chat installs no unload guard");
    await button.click();
    assert(view.pending() && view.listeners.has("beforeunload"), "a running export protects page unload");
    let prevented = false;
    const event = { preventDefault() { prevented = true; } };
    view.listeners.get("beforeunload")(event);
    assert(prevented && event.returnValue === "", "the running guard requests the browser leave confirmation");
    if (outcome === "success") {
      view.pending().resolve({
        ok: true, status: 200, headers: { get: () => "application/json" },
        text: async () => JSON.stringify({ direct_messages: [] }),
      });
    } else if (outcome === "failure") {
      view.pending().reject(new Error("simulated network failure"));
    } else {
      await button.click();
    }
    await tick();
    assert(!view.listeners.has("beforeunload"), `${outcome} releases the unload guard`);
    assert(!button.disabled && button.textContent === "导出 Markdown", `${outcome} restores export controls`);
    assert(view.written.length === (outcome === "success" ? 1 : 0), "only a successful read writes the chosen file");
    if (outcome === "success") assert(view.closed(), "the successful file write closes its stream");
    const status = view.root.querySelector("span").textContent;
    assert(status.includes(outcome === "success" ? "已导出" : outcome === "cancel" ? "已取消" : "导出失败"),
      `${outcome} is reported in the private-message status`);
    assert(
      /^微博私信_测试会话_\d{8}-\d{6}\.md$/.test(view.lastSuggestedName() || ""),
      `filename includes sanitized participant label: ${view.lastSuggestedName()}`
    );
    assert(!view.document.getElementById("wfr-toolkit-launcher"), "chat does not install the normal-page launcher");
  }
  const unsafeNameView = openPrivateMessagePage('a/b:c*?"<>|  d');
  await unsafeNameView.root.querySelector("button").click();
  assert(
    /^微博私信_a_b_c_ d_\d{8}-\d{6}\.md$/.test(unsafeNameView.lastSuggestedName() || ""),
    `unsafe characters in participant name are sanitized: ${unsafeNameView.lastSuggestedName()}`
  );
  await unsafeNameView.root.querySelector("button").click();
  const symbolsOnlyView = openPrivateMessagePage("///:::***");
  await symbolsOnlyView.root.querySelector("button").click();
  assert(
    /^微博私信_2001_\d{8}-\d{6}\.md$/.test(symbolsOnlyView.lastSuggestedName() || ""),
    `when participant name sanitizes to empty, filename falls back to UID: ${symbolsOnlyView.lastSuggestedName()}`
  );
  await symbolsOnlyView.root.querySelector("button").click();
  console.log("private message startup and export UI invariants passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
