"use strict";

const { loadProductFunctions } = require("./product-loader");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const product = loadProductFunctions([
  "resolveAutomaticAttemptOutcome",
  "describeAutomaticOutcomeForAttempt",
]);

const T1 = "2026-09-12T11:02:54.000Z";
const T2 = "2026-09-13T11:41:40.000Z";
const success = (attemptedAt) => ({ attemptedAt, outcome: "SUCCESS" });
const failure = (attemptedAt) => ({
  attemptedAt,
  outcome: "FAILURE",
  failureKind: "HTTP_ERROR",
});
const skipped = (attemptedAt) => ({
  attemptedAt,
  outcome: "SKIPPED",
  failureKind: "STALE_SCAN",
});

// An automatic result may only be shown as the result of the displayed attempt
// when both records exist and name the same attempt.
const paired = product.resolveAutomaticAttemptOutcome(T2, success(T2));
assert(paired.paired === true, "matching attempt and outcome must pair");
assert(paired.outcome.outcome === "SUCCESS", "paired outcome must be returned");
assert(
  product.describeAutomaticOutcomeForAttempt(T2, success(T2)) === "成功",
  "paired success must render normally"
);
assert(
  product.describeAutomaticOutcomeForAttempt(T2, failure(T2)) ===
    "失败（接口请求失败）",
  "paired failure must render its own reason"
);
assert(
  product.describeAutomaticOutcomeForAttempt(T2, skipped(T2)) ===
    "已跳过（已有更新的快照）",
  "paired skip must render its own reason"
);

// Nothing recorded at all stays the ordinary empty state.
assert(
  product.resolveAutomaticAttemptOutcome(null, null).state === "NONE",
  "empty metadata must be reported as the empty state"
);
assert(
  product.describeAutomaticOutcomeForAttempt(null, null) === "—",
  "empty metadata must render the ordinary empty state"
);

// A newer attempt must never borrow an older run's result.
const stale = product.resolveAutomaticAttemptOutcome(T2, success(T1));
assert(stale.paired === false, "older outcome must not pair with a newer attempt");
assert(stale.state === "MISMATCHED", "mismatched pairing must be classified");
assert(
  product.describeAutomaticOutcomeForAttempt(T2, success(T1)) ===
    "尚无对应结果记录",
  "stale success must never be shown as the current attempt's result"
);
assert(
  product.describeAutomaticOutcomeForAttempt(T1, success(T2)) ===
    "尚无对应结果记录",
  "an outcome from a different attempt must never be shown in either direction"
);

// An attempt whose result never landed must not reuse anything.
assert(
  product.resolveAutomaticAttemptOutcome(T2, null).state === "MISSING",
  "missing outcome must be classified"
);
assert(
  product.describeAutomaticOutcomeForAttempt(T2, null) === "尚无对应结果记录",
  "missing outcome must not fall back to any previous result"
);

// An outcome with no recorded attempt is leftover metadata, never a result.
const orphaned = product.resolveAutomaticAttemptOutcome(null, success(T1));
assert(orphaned.paired === false, "outcome without an attempt must not pair");
assert(orphaned.state === "ORPHANED", "orphaned metadata must be classified");
assert(
  product.describeAutomaticOutcomeForAttempt(null, success(T1)) ===
    "尚无对应结果记录",
  "orphaned outcome must not be displayed as a current result"
);

// The attempt token is an exact identity, not a time window.
for (const near of [
  "2026-09-13T11:41:40.001Z",
  "2026-09-13T11:41:41.000Z",
  "2026-09-13T11:41:40Z",
  "2026-09-13T19:41:40.000+08:00",
]) {
  assert(
    product.describeAutomaticOutcomeForAttempt(T2, success(near)) ===
      "尚无对应结果记录",
    `attempt identity must be exact, not tolerant: ${near}`
  );
}

// Malformed metadata is rejected rather than coerced into a result.
for (const value of ["SUCCESS", 0, [], true]) {
  assert(
    product.describeAutomaticOutcomeForAttempt(T2, value) ===
      "尚无对应结果记录",
    `non-record outcome accepted: ${String(value)}`
  );
  assert(
    product.describeAutomaticOutcomeForAttempt(value, success(T2)) ===
      "尚无对应结果记录",
    `non-string attempt accepted: ${String(value)}`
  );
}

console.log("automatic update metadata pairing invariants passed");
