"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PRODUCT_PATH = path.resolve(__dirname, "..", "weibo-toolkit.user.js");
const STARTUP_MARKER = "  currentTheme = loadTheme();";

// contextOverrides supplies the userscript globals a test needs to control
// (GM storage, unsafeWindow, document, ...). Each call evaluates the product in
// a fresh context, so two calls sharing one storage object behave like two tabs.
function loadProductFunctions(names, contextOverrides = {}) {
  const source = fs.readFileSync(PRODUCT_PATH, "utf8");
  if (!source.includes(STARTUP_MARKER)) {
    throw new Error("Public-test instrumentation point is missing");
  }
  const exports = names.join(",\n      ");
  const instrumented = source.replace(
    STARTUP_MARKER,
    `  globalThis.__weiboToolkitPublicTest = {\n      ${exports}\n    };\n  return;\n\n${STARTUP_MARKER}`
  );
  const context = {
    console,
    location: { origin: "https://weibo.com", pathname: "/" },
    URL,
    URLSearchParams,
    Blob,
    BigInt,
    Date,
    Object,
    Set,
    Map,
    JSON,
    ...contextOverrides,
  };
  vm.runInNewContext(instrumented, context, {
    filename: "weibo-toolkit.user.js",
  });
  if (!context.__weiboToolkitPublicTest) {
    throw new Error("Actual product functions were not exposed for public tests");
  }
  return context.__weiboToolkitPublicTest;
}

module.exports = { loadProductFunctions };
