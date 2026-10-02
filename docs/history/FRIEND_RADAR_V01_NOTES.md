# Weibo Toolkit — Friend Radar v0.1

## What v0.1 does

`weibo-toolkit.user.js` is the first product userscript for Weibo Toolkit. Friend Radar stores a local baseline of the current account's complete API-visible following set and, on later successful manual updates, records a small set of relationship events.

It makes no request on page load. The three userscript menu commands are:

- **Friend Radar: Update Now** — manually collect and compare a complete visible following snapshot;
- **Friend Radar: View Events** — view all stored events newest first and mark them all as read;
- **Friend Radar: View Status** — inspect baseline time, counts, and event totals.

All data remains in userscript-local storage in the browser. There is no server, account mutation, background polling, notification, export, analytics, or external dependency.

## Snapshot and completeness rules

The scanner uses the verified authenticated endpoint `/ajax/friendships/friends`. It requests `page=1`, `page=2`, `page=3`, and so on with one GET at a time and a fixed 750 ms pause. It never uses cursor values as page numbers.

A snapshot is accepted only after every response passes HTTP, content-type, JSON, schema, stable-ID, field, duplicate, total-count, and pagination checks, and the sequential chain reaches the observed natural end `next_cursor = 0`. Live authenticated testing repeatedly verified that `previous_cursor` connects to the preceding page's `next_cursor`, so Friend Radar checks that invariant. Repeated cursors/states stop the scan. A 30-request ceiling is a safety guard.

A failed or incomplete scan neither replaces the last good snapshot nor creates events. Each stored record contains only `uid`, `screenName`, `following`, `followsMe`, and `remark`. Missing `follow_me` is a schema failure and is never interpreted as `false`.

Each snapshot also stores `capturedAt`, `reportedTotal`, `visibleCount`, and `unresolvedRelationCount`. The unresolved count is only the arithmetic difference between the reported total and unique visible stable UIDs when safely derivable. It does not classify any account as deleted, banned, suspended, cancelled, or otherwise unavailable.

## First run and event meanings

The first successful update for a logged-in account creates a baseline and no historical events. Later successful updates compare stable UID identity, never screen-name identity.

v0.1 records exactly these event types:

- `VISIBLE_FOLLOWING_ADDED` — **Appeared in your visible following list**. This does not claim that you personally initiated a new follow.
- `VISIBLE_FOLLOWING_DISAPPEARED` — **Disappeared from your visible following list**. This is intentionally neutral: the API does not prove unfollowing, deletion, suspension, cancellation, or another cause.
- `FOLLOW_ME_GAINED` — `followsMe` changed from `false` to `true`: **Started following you**.
- `FOLLOW_ME_LOST` — `followsMe` changed from `true` to `false`: **Stopped following you**.
- `SCREEN_NAME_CHANGED` — the same stable UID returned a different screen name; both old and new names are stored.

A rename and follow-status change may produce two events for the same UID in one update. Remark changes do not create events in v0.1.

Events are persistent and start unread. Opening or closing the viewer does not delete them. **Mark all as read** changes read state only. v0.1 has no automatic deletion or retention limit.

## Account separation and storage

Friend Radar uses a separate userscript-local storage key for each authenticated owner UID. Each value is one JSON object containing:

```text
schemaVersion
ownerUid
latestSnapshot
events
```

Snapshots from different logged-in Weibo accounts are never compared. After a successful scan, Friend Radar re-checks the logged-in UID and reloads the freshest stored state before calculating events. It aborts if the account changed or the stored snapshot is newer than the completed scan. It then constructs the entire next state, stores it as one value, reads it back for verification, and only then reports success. A persistence failure is reported and is not presented as a completed update.

## Installation and browser testing

1. In Tampermonkey or Violentmonkey, create a new script.
2. Replace the editor contents with the complete contents of `weibo-toolkit.user.js`.
3. Save and enable it.
4. Open `https://weibo.com/`, sign in normally, and reload the page.
5. Use **Friend Radar: View Status**. It should report that no baseline exists for a new account and make no network request.
6. Use **Friend Radar: Update Now** once and keep the tab open. The first complete scan should create a baseline with zero new events.
7. Use **Friend Radar: View Status** to confirm the snapshot time and counts.
8. Use **Friend Radar: View Events**. Opening and closing it must not remove events. When unread events exist, **Mark all as read** must preserve their count.
9. Run **Update Now** again when a real comparison is desired. Review neutral visible-list events and follow/rename events without inferring causes not proven by the API.
10. To test account isolation, switch to another Weibo account, reload, and view status. That account must have its own baseline and events; its first successful update must create a baseline rather than compare against the previous account.

For failure testing, a logged-out session, interrupted network, or unexpected response should produce a clear error while the last successful status and events remain unchanged.

## Known limitations

- Updates are manual only; changes between two successful scans are detected only at the next scan.
- Friend Radar observes the API-visible following set, which may be smaller than `total_number` or the account owner's approximate visible count.
- A disappearance event cannot identify why a relation is absent.
- v0.1 does not crawl followers/fans, probe profiles, classify unavailable accounts, track remark changes, export data, notify, schedule updates, or synchronize across browsers.
- Clearing userscript storage or browser data removes the local baseline and event history.
- After switching Weibo accounts, reload the Weibo page before running any Friend Radar command.
- Simultaneous **Update Now** operations in multiple Weibo tabs are unsupported in v0.1 because userscript storage does not provide the atomic locking needed to guarantee cross-tab serialization. Run one update at a time.
- The following list remains live during a multi-page scan. A relationship that changes during those few seconds could theoretically produce a transient disappear/appear observation.
