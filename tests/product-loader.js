"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PRODUCT_PATH = path.resolve(__dirname, "..", "weibo-toolkit.user.js");
const STARTUP_MARKER = "  currentTheme = loadTheme();";

function loadProductFunctions(names) {
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
