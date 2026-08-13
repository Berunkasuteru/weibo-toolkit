# Engineering Philosophy

This document describes the engineering principles used for small, practical software projects.

The goal is not to maximize architectural sophistication. The goal is to build software that is correct, understandable, maintainable, and useful.

---

## 1. Correctness Before Cleverness

Prefer code that is obviously correct over code that is impressive.

A simple implementation with clear behavior is usually better than a sophisticated abstraction whose correctness is harder to verify.

When correctness matters:

- preserve known facts;
- represent uncertainty explicitly;
- avoid silently inventing missing information;
- fail visibly when a result cannot be trusted.

A useful rule:

> If we do not know, say that we do not know.

Do not turn incomplete information into apparently complete output merely to make the program appear more reliable.

---

## 2. Prove the Problem Before Fixing It

A bug report, reviewer finding, static-analysis warning, or AI suggestion is a hypothesis until verified.

The preferred workflow is:

```text
reported issue
      ↓
read-only investigation
      ↓
minimal reproduction
      ↓
confirmed behavior
      ↓
minimal fix
      ↓
regression test
```

Do not modify code merely because a finding sounds plausible or technically sophisticated.

False positives are cheaper to reject than unnecessary fixes are to maintain.

---

## 3. Small Software Should Stay Small

Do not design a small utility as though it were an enterprise platform.

Avoid introducing abstractions solely because they are common in larger systems.

Examples that require real justification include:

- controller/service layers;
- dependency-injection frameworks;
- configuration platforms;
- retry frameworks;
- structured logging infrastructure;
- plugin systems;
- event buses;
- database layers;
- telemetry systems;
- dashboards;
- premature modularization.

Every abstraction has a maintenance cost.

Add structure when current complexity requires it, not because future complexity might exist.

---

## 4. User Value Beats Architectural Purity

Architecture is a means, not the product.

A technically elegant change that produces no meaningful improvement for users may not be worth making.

Prioritize:

1. correctness;
2. data integrity;
3. understandable behavior;
4. clear failure modes;
5. practical usability;
6. maintainability;
7. architectural elegance.

Do not refactor a working component merely because a reviewer considers the file too large or insufficiently layered.

Refactor when there is evidence of:

- recurring defects;
- duplicated dangerous logic;
- difficult testing;
- difficult modification;
- unclear ownership of behavior;
- measurable maintenance cost.

---

## 5. Fail Closed When Trust Matters

When software produces results that users may treat as authoritative, unknown failures should not silently become successful results.

Examples include:

- incomplete network responses;
- schema changes;
- authentication failures;
- identifier mismatches;
- rate limits;
- unexpected server responses;
- missing required data.

Whenever possible, distinguish:

```text
known complete
known incomplete
unknown / failed
```

Do not collapse these states into one convenient success state.

A partial result is acceptable when it is clearly identified as partial.

A partial result pretending to be complete is not.

---

## 6. Preserve Information Before Optimizing Presentation

Do not destroy useful information merely to simplify output.

Presentation formats may differ:

- human-readable;
- machine-oriented;
- compact;
- custom.

But transformations should preserve the semantics required by their intended use.

Compression should remove redundancy, not truth.

Convenience should not erase provenance, attribution, uncertainty, or integrity information.

---

## 7. Prefer Conservative Network Behavior

External services are shared systems, not unlimited local resources.

Default to:

- low concurrency;
- predictable request patterns;
- few retries;
- clear stopping conditions;
- respect for authentication and rate-limit failures.

Retries are not automatically reliability.

An aggressive retry policy can transform a temporary problem into:

- unnecessary server load;
- duplicate operations;
- account risk;
- slower failure;
- harder debugging.

Retry only when the failure mode is understood and retrying is demonstrably safe.

---

## 8. Tests Should Protect Real Failure Modes

Tests are most valuable when they preserve behavior that would be costly to break.

Prioritize tests for:

- data loss;
- incorrect attribution;
- incomplete results reported as complete;
- parsing edge cases;
- termination conditions;
- packaging contracts;
- previously confirmed bugs.

Do not chase coverage percentages for their own sake.

A small test that protects an important invariant is more valuable than dozens of tests for trivial implementation details.

When fixing a confirmed bug, add the smallest regression test that proves the bug stays fixed when practical.

---

## 9. Reviewers Are Advisors, Not Authorities

Human reviewers, static analyzers, LLMs, and coding agents can all be wrong.

Review findings should be classified by evidence.

Useful categories include:

### CONFIRMED BUG

A reproducible defect with real impact.

### CONFIRMED RISK

A specific realistic failure condition that has not necessarily occurred yet.

### OPTIONAL IMPROVEMENT

A useful improvement that is not required for correctness.

### FALSE POSITIVE / NO ACTION

A suspected issue that does not survive verification.

The purpose of review is not to maximize the number of findings.

The purpose of review is to increase confidence about what should change and what should remain unchanged.

---

## 10. Prefer Minimal Fixes

When a defect is confirmed, fix the defect first.

Do not automatically turn:

```text
one bug
```

into:

```text
new abstraction
new framework
new directory structure
new configuration system
and one bug fix
```

A good patch usually has a small relationship between cause and change.

Large refactors should have their own justification and should not be hidden inside unrelated fixes.

---

## 11. Avoid Speculative Engineering

Do not build infrastructure for hypothetical futures without strong evidence that those futures are approaching.

Examples:

> “We might replace the UI framework someday.”

This is not sufficient reason to introduce an abstraction layer today.

> “The project might need a database someday.”

This is not sufficient reason to add a database today.

> “Users might want plugins.”

This is not sufficient reason to design a plugin architecture today.

Solve today's verified problem while leaving tomorrow reasonably possible.

That is usually enough.

---

## 12. Keep Dependencies Intentional

Every dependency adds:

- upgrade risk;
- packaging complexity;
- security surface;
- compatibility constraints;
- future maintenance.

Use dependencies when they substantially reduce complexity or provide functionality that would be unreasonable to implement locally.

Do not add a library to replace a few clear lines of standard-library code without a concrete benefit.

---

## 13. Keep the User Interface Boring When Boring Works

A utility does not need to look like a startup landing page.

Prefer:

- native behavior;
- clear hierarchy;
- predictable controls;
- readable typography;
- consistent spacing;
- obvious primary actions;
- useful status information.

Avoid visual complexity that does not improve understanding.

Animation, themes, custom window chrome, gradients, large icon systems, and framework rewrites all require justification.

The best interface is often the one users stop noticing.

---

## 14. Distribution Is Part of the Product

A program is not finished merely because it runs on the developer's machine.

Release engineering should consider:

- predictable artifact names;
- version identification;
- reproducible packaging;
- checksums where appropriate;
- clear download instructions;
- clean extraction;
- understandable executable names;
- failure detection during download;
- compatibility with the intended environment.

Do not claim tests that were not actually performed.

Unknown is an acceptable status.

Invented confidence is not.

---

## 15. Release When There Is a Reason

A commit and a release are different things.

Commits may happen frequently.

A release should usually answer:

> Why should an existing user download this version?

Good reasons include:

- a confirmed bug fix;
- a security or integrity fix;
- compatibility with an upstream change;
- a meaningful user-facing improvement;
- a coherent group of accumulated usability improvements;
- a clearly useful feature within project scope.

“Something could still be optimized” is not a release reason.

Stable software does not need constant activity.

---

## 16. Real Users Beat Endless Internal Review

After reasonable engineering and verification, release the software and observe real use.

Real users can reveal problems that internal review cannot:

- unclear instructions;
- unexpected operating-system behavior;
- confusing terminology;
- environment-specific failures;
- incorrect assumptions about workflows;
- actual feature demand.

Do not endlessly review already-reviewed code simply because more reviewers are available.

Once confidence is sufficient, external feedback becomes more valuable than another speculative audit.

---

## 17. Scope Discipline Is a Feature

A project should know what it is not.

Feature requests should be evaluated against the product's purpose, not only against technical feasibility.

The fact that something can be implemented does not mean it belongs in the project.

Good software often becomes good by refusing unrelated responsibilities.

---

## 18. Optimize for Exit

Users should not become dependent on the continued existence of the program whenever this can reasonably be avoided.

Prefer:

- standard formats;
- plain files;
- documented structures;
- portable data;
- local ownership;
- interoperable tools.

A healthy system allows users to leave.

Likewise, development infrastructure should avoid unnecessary platform lock-in when practical.

Use convenient platforms, but keep the project portable enough that migration remains possible.

---

## 19. AI Should Reduce Labor, Not Judgment

Coding agents can make implementation dramatically cheaper.

That makes engineering judgment more important, not less important.

When code becomes cheap to produce, a new failure mode appears:

```text
easy to change
→ therefore change everything
```

Avoid it.

Use AI for:

- implementation;
- repetitive inspection;
- test generation;
- minimal reproduction;
- documentation;
- independent review.

Keep human responsibility for:

- product scope;
- behavioral definitions;
- risk tolerance;
- trade-offs;
- acceptance criteria;
- deciding whether a change should exist at all.

The correct question is not:

> Can the agent implement this?

It is:

> Should this be implemented?

---

## 20. Leave Working Code Alone

There is no requirement for software to change every day.

A mature outcome may look like:

```text
release
↓
users use it
↓
nothing breaks
↓
no commits for weeks
```

That is not stagnation.

That is stability.

When there is no confirmed problem, no meaningful demand, and no justified improvement:

> No action is a valid engineering decision.

---

# Short Version

When a decision is unclear, return to these rules:

> **If we cannot obtain it, say we cannot obtain it. Do not pretend we did.**

> **Prove there is a problem before changing the code.**

> **Small tools should not be optimized into enterprise platforms.**

> **User value matters more than architectural fashion.**

> **A reviewer finding is a hypothesis until reproduced.**

> **The cheapest code to maintain is code that did not need to be added.**

> **Stable software is allowed to stay stable.**