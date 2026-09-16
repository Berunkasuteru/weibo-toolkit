"use strict";

// Promotion classification is the only page feature that can hide a real post,
// so its precise/strong boundary is pinned here against a minimal feed-card DOM
// rather than against live Weibo markup.

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function element(tag, options = {}) {
  const classes = new Set(
    (options.class || "").split(/\s+/).filter((token) => token !== "")
  );
  const attributes = Object.assign({}, options.attrs);
  const node = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    children: [],
    parentElement: null,
    hidden: options.hidden === true,
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      [Symbol.iterator]: () => classes[Symbol.iterator](),
    },
    getAttribute: (name) =>
      Object.prototype.hasOwnProperty.call(attributes, name)
        ? attributes[name]
        : null,
    get textContent() {
      if (typeof options.text === "string") return options.text;
      return node.children.map((child) => child.textContent).join("");
    },
    descendants() {
      const found = [];
      for (const child of node.children) {
        found.push(child, ...child.descendants());
      }
      return found;
    },
    matches: (selector) =>
      selector.startsWith(".")
        ? classes.has(selector.slice(1))
        : node.tagName === selector.toUpperCase(),
    querySelectorAll: (selector) =>
      node.descendants().filter((candidate) => candidate.matches(selector)),
  };
  for (const child of options.children || []) {
    child.parentElement = node;
    node.children.push(child);
  }
  return node;
}

function appendChild(parent, child) {
  child.parentElement = parent;
  parent.children.push(child);
  return child;
}

// Mirrors the shipped Home/Latest card topology: an outer article whose body
// branch holds the header and the content wrapper, with generated site hashes
// stubbed so no assertion here can come to depend on one.
function feedCard(options = {}) {
  const nickname = element("div", {
    class: "head_nick_h1",
    children: [
      element("a", { text: "某用户", attrs: { href: "/u/1234567890" } }),
    ],
  });
  if (options.badge) {
    appendChild(
      nickname,
      element("span", {
        class: options.badgeClass || "wbpro-tag",
        children: [
          element("i", { class: "woo-font" }),
          element("span", { text: options.badge }),
        ],
      })
    );
  }

  const headerChildren = [
    element("div", { class: "head_main_h1", children: [nickname] }),
  ];
  if (options.follow) {
    headerChildren.push(
      element("div", {
        class: "Feed_hdFollow_h1",
        children: [
          element("button", {
            children: [element("span", { text: options.follow })],
          }),
        ],
      })
    );
  }
  if (options.negativeFeedback) {
    headerChildren.push(
      element("div", {
        class: "morepop_wrap_h1",
        children: [element("i", { attrs: { title: "负反馈" } })],
      })
    );
  }
  if (options.closeControl) {
    headerChildren.push(
      element("button", {
        attrs: { "aria-label": "关闭" },
        children: [element("i")],
      })
    );
  }

  const bodyChildren = [
    element("header", { class: "Feed_hd_h1", children: headerChildren }),
  ];
  if (options.omitContent !== true) {
    const contentChildren = [
      element("div", {
        class: "detail_wbtext_h1",
        text: options.body || "普通正文",
      }),
    ];
    if (options.repost) {
      contentChildren.push(
        element("div", {
          class: "retweet",
          children: [
            element("article", {
              children: [
                element("header", {
                  children: [
                    element("a", {
                      text: "被转用户",
                      attrs: { href: "/u/999" },
                    }),
                  ],
                }),
                element("div", {
                  class: "wbpro-feed-reText",
                  text: "被转正文",
                }),
              ],
            }),
          ],
        })
      );
    }
    if (options.tipsAdClass) {
      contentChildren.push(
        element("div", { class: options.tipsAdClass, text: "广告" })
      );
    }
    bodyChildren.push(
      element("div", {
        class: options.contentClass || "wbpro-feed-content",
        children: contentChildren,
      })
    );
  }
  bodyChildren.push(
    element("footer", { children: [element("div", { text: "转发" })] })
  );

  return element("div", {
    class: "wbpro-scroller-item",
    attrs: { "data-index": "1" },
    children: [
      element("article", {
        class: "woo-panel-main",
        children: [
          element("div", { class: "Feed_body_h1", children: bodyChildren }),
        ],
      }),
    ],
  });
}

const {
  classifyLatestRecommendedCard,
  resolvePageFeedPromotionHeader,
  isStrongTipsAdModule,
} = loadProductFunctions([
  "classifyLatestRecommendedCard",
  "resolvePageFeedPromotionHeader",
  "isStrongTipsAdModule",
]);

function expectClassification(label, card, expectedPrecise, expectedStrong) {
  const precise = classifyLatestRecommendedCard(card, false);
  const strong = classifyLatestRecommendedCard(card, true);
  assert(
    precise === expectedPrecise,
    `${label}: precise mode expected ${expectedPrecise}, got ${precise}`
  );
  assert(
    strong === expectedStrong,
    `${label}: strong mode expected ${expectedStrong}, got ${strong}`
  );
}

// Precise mode recognises the dedicated semantic tag carrying exactly 荐读, and
// recognises it whether or not the body wrapper beside it resolves.
expectClassification("exact 荐读 tag", feedCard({ badge: "荐读" }), true, true);
expectClassification(
  "荐读 tag without a body wrapper",
  feedCard({ badge: "荐读", omitContent: true }),
  true,
  true
);
expectClassification(
  "荐读 tag beside a renamed body wrapper",
  feedCard({ badge: "荐读", contentClass: "wbpro-feed-contentNext" }),
  true,
  true
);
for (const near of ["荐读内容", "推荐", "广告", "推广", "微博广告"]) {
  expectClassification(`tag text ${near}`, feedCard({ badge: near }), false, true);
}
expectClassification(
  "荐读 in a generated tag class",
  feedCard({ badge: "荐读", badgeClass: "Feed_tag_h1" }),
  false,
  false
);

// Ordinary posts that merely discuss promotion must survive both tiers.
for (const body of [
  "推荐一本书",
  "广告行业观察",
  "推广活动总结",
  "我推荐这个",
  "广告学导论",
  "推广经验分享",
]) {
  expectClassification(`body text ${body}`, feedCard({ body }), false, false);
}

// No single weak signal may hide a post, in either tier.
expectClassification("follow control only", feedCard({ follow: "+关注" }), false, false);
expectClassification("bare follow control", feedCard({ follow: "关注" }), false, false);
expectClassification(
  "negative feedback only",
  feedCard({ negativeFeedback: true }),
  false,
  false
);
expectClassification("generic close control", feedCard({ closeControl: true }), false, false);
expectClassification("ordinary repost", feedCard({ repost: true }), false, false);
expectClassification(
  "repost discussing 广告行业",
  feedCard({ repost: true, body: "广告行业" }),
  false,
  false
);

// Strong mode only: the follow control combined with negative-feedback semantics.
expectClassification(
  "follow control with negative feedback",
  feedCard({ follow: "+关注", negativeFeedback: true }),
  false,
  true
);

// TipsAd scope. A feed item with no resolvable outer post header is nothing but
// the ad module and stays disposable; an ad module sitting beside a real post
// must never make that post's card disposable.
const standaloneTipsAd = element("div", {
  class: "wbpro-scroller-item",
  children: [element("div", { class: "TipsAd_wrap_h1", text: "广告" })],
});
assert(
  isStrongTipsAdModule(standaloneTipsAd.children[0]),
  "the TipsAd class-token prefix must be recognised as an ad module"
);
assert(
  resolvePageFeedPromotionHeader(standaloneTipsAd) === null,
  "a standalone ad item must expose no ordinary outer post header"
);
const postWithEmbeddedTipsAd = feedCard({ tipsAdClass: "TipsAd_wrap_h1" });
assert(
  postWithEmbeddedTipsAd.querySelectorAll(".TipsAd_wrap_h1").length === 1,
  "the embedded-ad fixture must actually contain an ad module"
);
assert(
  resolvePageFeedPromotionHeader(postWithEmbeddedTipsAd) !== null,
  "an ordinary post carrying an embedded ad module must keep its outer header, " +
    "so the card-level TipsAd decision never disposes of the post itself"
);

console.log("PROMOTION_PRECISE_TAG_BOUNDARY=PASS");
console.log("PROMOTION_BODY_KEYWORD_CLASSIFICATION=0");
console.log("PROMOTION_SINGLE_WEAK_SIGNAL_HIDES=0");
console.log("PROMOTION_TIPSAD_SCOPE=MIXED_BY_STRUCTURE");
