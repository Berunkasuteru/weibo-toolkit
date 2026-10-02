# Weibo Toolkit — Friend Radar v0.2.0

## What changed

Friend Radar's real-browser-verified v0.1.3 scan, snapshot, diff, storage, account-separation, and event behavior remains unchanged. v0.2.0 adds a small userscript-owned **Weibo Toolkit** button near the lower-right edge of the page. The original three userscript menu commands remain available as fallback controls.

The button opens a lightweight Toolkit home showing:

- whether a Friend Radar baseline exists;
- the last successful update time;
- visible-following and unresolved-relation counts;
- the unread-event count.

Its **Update Now**, **View Events**, and **View Status** buttons call the existing Friend Radar functions. Opening the Toolkit home makes no network request and writes no storage.

## Rejected native-menu integration

A native settings-dropdown entry was tested in a real signed-in browser and rejected. Directly inserting a row into Weibo's `.woo-pop-wrap-main` caused the modified menu to remain as a stale or ghost copy while Weibo created a separate live dropdown without the Toolkit entry. Visibility filtering did not make host reconciliation or recreation reliable enough for product use.

The product therefore contains no settings-menu selector, cloning, injection, cleanup, or `MutationObserver`. It does not modify any Weibo-owned menu, row, wrapper, trigger, or portal node.

## Independent launcher

The launcher is a single `button` created by the userscript, appended directly to `document.body`, and styled only with `wfr-*` classes. It does not depend on Weibo's DOM structure or third-party extension classes. Clicking it opens the existing Toolkit home panel without navigating or interacting with Weibo's settings menu.

If Weibo replaces the page body and the button becomes unavailable, Friend Radar still works through the userscript manager commands. No observer or polling loop is used to restore the enhancement.

## Installation and browser verification

1. In Tampermonkey or Violentmonkey, install or update only `weibo-toolkit.user.js`.
2. Open `https://weibo.com/`, sign in, and reload the page.
3. Confirm that the small **Weibo Toolkit** button appears near the lower-right edge and that page load makes no Friend Radar network request.
4. Open and close Weibo's native settings dropdown repeatedly. Confirm it contains no injected Toolkit row, never forms a stale/ghost copy, and remains entirely host-controlled.
5. Click **Weibo Toolkit**. Confirm Toolkit home opens and Weibo's native settings trigger and dropdown behavior remain unchanged.
6. Confirm the summary matches **Friend Radar: View Status** and that the home buttons open the existing Update, Events, and Status flows.
7. Confirm the userscript manager still lists exactly **Friend Radar: Update Now**, **Friend Radar: View Events**, and **Friend Radar: View Status**.
8. Repeat with any DOM-modifying extension enabled and disabled; the launcher must not depend on extension classes.
9. Re-run the established v0.1.3 checks for first baseline, later diffs, event persistence/read flags, account separation, failure preservation, sequential GET-only scanning, 750 ms delay, no retries/concurrency, and the 30-request ceiling.

Node regression tests in the workspace are developer checks and are not userscripts. Do not install them in Tampermonkey or Violentmonkey.

Historical clarification: the v0.2.0 browser-verification expectation of three userscript commands was superseded by v0.3.0, which has exactly four **Weibo Toolkit** menu commands.

## Known limitations

- The fixed launcher is an enhancement. If it is unavailable after a host page-body replacement, use the three userscript commands.
- After switching Weibo accounts, reload the Weibo page before running Friend Radar.
- Simultaneous **Update Now** operations in multiple Weibo tabs remain unsupported because userscript storage does not provide atomic cross-tab serialization.
- The following list remains live during a multi-page scan, so a relationship changing during those few seconds could theoretically produce a transient disappear/appear observation.
- All other Friend Radar v0.1 limitations remain in effect.
