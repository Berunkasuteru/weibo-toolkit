import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const artifactPath = path.join(repositoryRoot, "weibo-toolkit.user.js");
const sourceParts = Object.freeze([
  "src/000-preamble-pm-core.js",
  "src/010-private-message-ui.js",
  "src/020-core-friend-radar.js",
  "src/030-follower-snapshot.js",
  "src/040-page-profile-changelog.js",
  "src/050-stepmeter-route.js",
  "src/060-ui-updates-followers.js",
  "src/070-follower-hygiene-removal.js",
  "src/080-events-status.js",
  "src/090-backup-export-auto.js",
  "src/100-restore-export.js",
  "src/110-overview-auto-update.js",
  "src/120-settings-launcher-startup.js",
]);

function resolveSourcePart(relativePath) {
  const resolved = path.resolve(repositoryRoot, relativePath);
  const repositoryPrefix = repositoryRoot + path.sep;
  if (!resolved.startsWith(repositoryPrefix)) {
    throw new Error(`Source part escapes the repository: ${relativePath}`);
  }
  return resolved;
}

function validateManifest() {
  if (new Set(sourceParts).size !== sourceParts.length) {
    throw new Error("Source-part manifest contains a duplicate entry.");
  }
  for (const relativePath of sourceParts) resolveSourcePart(relativePath);
}

function buildSource() {
  validateManifest();
  return Buffer.concat(
    sourceParts.map((relativePath) =>
      readFileSync(resolveSourcePart(relativePath))
    )
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function firstDifference(left, right) {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? null : commonLength;
}

function reportComparison(generated, artifact) {
  console.log(`GENERATED_BYTES=${generated.length}`);
  console.log(`ARTIFACT_BYTES=${artifact.length}`);
  console.log(`GENERATED_SHA256=${sha256(generated)}`);
  console.log(`ARTIFACT_SHA256=${sha256(artifact)}`);
  if (generated.equals(artifact)) {
    console.log("SOURCE_BUILD_MATCH=PASS");
    return true;
  }
  console.error("SOURCE_BUILD_MATCH=FAIL");
  console.error(`FIRST_DIFFERING_BYTE=${firstDifference(generated, artifact)}`);
  return false;
}

const mode = process.argv[2];
if (mode !== "--check" && mode !== "--write") {
  console.error(
    "Usage: node scripts/build-userscript.mjs --check|--write"
  );
  process.exitCode = 2;
} else {
  try {
    const generated = buildSource();
    if (mode === "--write") {
      writeFileSync(artifactPath, generated);
      console.log("SOURCE_BUILD_WRITE=PASS");
    }
    const artifact = readFileSync(artifactPath);
    if (!reportComparison(generated, artifact)) process.exitCode = 1;
  } catch (error) {
    console.error(`SOURCE_BUILD_ERROR=${error.message}`);
    process.exitCode = 1;
  }
}
