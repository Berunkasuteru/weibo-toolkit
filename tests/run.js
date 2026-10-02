"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const buildCheck = spawnSync(
  process.execPath,
  [path.join(__dirname, "..", "scripts", "build-userscript.mjs"), "--check"],
  { stdio: "inherit" }
);
if (buildCheck.error) throw buildCheck.error;
if (buildCheck.status !== 0) {
  console.error("PUBLIC_TESTS=FAIL BUILD=SOURCE_BUILD_MATCH");
  process.exit(buildCheck.status || 1);
}

const tests = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith(".test.js"))
  .sort();

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`PUBLIC_TESTS=FAIL FILE=${test}`);
    process.exit(result.status || 1);
  }
}

console.log(`PUBLIC_TESTS=PASS TEST_COUNT=${tests.length}`);
