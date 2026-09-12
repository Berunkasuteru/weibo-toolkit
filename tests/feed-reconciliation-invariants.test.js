"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createClassListSpy(initialClasses = []) {
  const classes = new Set(initialClasses);
  const calls = [];
  return {
    calls,
    classList: {
      contains: (className) => classes.has(className),
      add(className) {
        calls.push({ operation: "add", className });
        classes.add(className);
      },
      remove(className) {
        calls.push({ operation: "remove", className });
        classes.delete(className);
      },
    },
  };
}

const { setToolkitClass } = loadProductFunctions(["setToolkitClass"]);
const hiddenClass = "wfr-latest-recommended-hidden";

const ordinary = createClassListSpy();
for (let pass = 1; pass <= 3; pass += 1) {
  assert(
    setToolkitClass(ordinary, hiddenClass, false) === false,
    `ordinary fixed-point pass ${pass} must report no class change`
  );
}
assert(
  ordinary.calls.length === 0,
  "matching absent state must never call classList.remove"
);

const promotion = createClassListSpy();
assert(
  setToolkitClass(promotion, hiddenClass, true) === true,
  "first promotion pass must establish the hidden class"
);
const firstPassWrites = promotion.calls.length;
assert(
  setToolkitClass(promotion, hiddenClass, true) === false,
  "second promotion pass must be a fixed point"
);
const secondPassWrites = promotion.calls.length - firstPassWrites;
assert(
  setToolkitClass(promotion, hiddenClass, true) === false,
  "third promotion pass must remain a fixed point"
);
const thirdPassWrites =
  promotion.calls.length - firstPassWrites - secondPassWrites;
assert(firstPassWrites === 1, "first promotion pass must perform one add call");
assert(secondPassWrites === 0, "second promotion pass must call no class mutator");
assert(thirdPassWrites === 0, "third promotion pass must call no class mutator");

const productSource = fs.readFileSync(
  path.resolve(__dirname, "..", "weibo-toolkit.user.js"),
  "utf8"
);
const cardDecisionSource = productSource.slice(
  productSource.indexOf("function shouldCollapsePageFeedCard"),
  productSource.indexOf("function reconcileStrongTipsAdModules")
);
const tipsAdWriterSource = cardDecisionSource.slice(
  cardDecisionSource.indexOf("function applyStrongTipsAdVisibility")
);
assert(
  cardDecisionSource.includes("classifyLatestRecommendedCard(card, strongMode)") &&
    cardDecisionSource.includes("cardContainsStrongTipsAd(card)"),
  "one card-level decision must combine normal and TipsAd promotion classification"
);
assert(
  !tipsAdWriterSource.includes("LATEST_RECOMMENDED_HIDDEN_CLASS"),
  "TipsAd module presentation must not write the outer-card collapse class"
);

console.log("FEED_CLASS_GUARD_CALL_SEMANTICS=PASS");
console.log(`FIRST_PASS_TOOLKIT_CLASS_WRITES=${firstPassWrites}`);
console.log(`SECOND_PASS_TOOLKIT_CLASS_WRITES=${secondPassWrites}`);
console.log(`THIRD_PASS_TOOLKIT_CLASS_WRITES=${thirdPassWrites}`);
