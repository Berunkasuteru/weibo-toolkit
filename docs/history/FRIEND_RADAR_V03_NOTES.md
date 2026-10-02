# Weibo Toolkit — Friend Radar v0.3.0

## Data compatibility contract

The application version and stored-data schema version are independent. v0.3.0 continues to use `schemaVersion: 1` and the existing `weiboToolkit.friendRadar.v1.<ownerUid>` storage keys, so valid v0.2.0 baselines, events, and read/unread flags remain immediately readable without transformation.

Normal script upgrades must preserve existing Friend Radar data. `schemaVersion` changes only when the stored structure truly requires it. A script upgrade must never silently clear state or recreate a baseline merely because the application version changed.

Any future supported schema change must automatically:

1. validate the old stored data;
2. convert it in memory;
3. validate the converted data against the new schema;
4. persist it with read-back verification;
5. fail without destroying the old data if any step fails.

No migration framework is implemented in v0.3.0 because the schema remains version 1. Manual backup/export is optional disaster recovery, not part of normal upgrades.

## Backup export

The Toolkit home and userscript menu expose a manual **导出备份** action for the currently authenticated account. Export first uses the existing `loadState()` validation path, then saves or hands off a UTF-8, indented JSON document containing the complete state: baseline, event history, and read/unread flags.

The wrapper format is:

```json
{
  "backupFormat": "weibo-toolkit.friend-radar",
  "backupVersion": 1,
  "exportedAt": "<ISO timestamp>",
  "appVersion": "0.3.0",
  "ownerUid": "<current authenticated UID>",
  "state": {
    "schemaVersion": 1,
    "ownerUid": "<same UID>",
    "latestSnapshot": null,
    "events": []
  }
}
```

`backupVersion` describes the backup wrapper and is separate from `state.schemaVersion`. The wrapper UID must equal `state.ownerUid`. A valid state with no baseline and no events can still be exported.

The filename format is `weibo-toolkit-friend-radar-<UID>-<YYYYMMDD-HHMMSS>.json`, using the UTC export timestamp and filesystem-safe characters only. When supported from the current user action, the native Save As picker is invoked on the real page Window through `unsafeWindow`, avoiding the userscript-sandbox receiver that caused an illegal invocation in real-browser testing. It lets the user choose the directory and filename, writes the exact UTF-8 JSON, and reports success only after the writable stream closes. Cancelling the picker is a neutral result and does not trigger a fallback download.

If the Save As API is unavailable—or cannot be invoked from a userscript-menu activation context—the browser-download fallback creates a Blob URL, clicks a temporary userscript-owned download link, removes it immediately, and revokes the object URL after a one-second delay. The UI reports only that a browser download was requested; the browser's download settings determine the save location and final filename. Export makes no network request, performs no userscript-storage write, and uploads nothing. No directory handle is requested or remembered.

## Scope

v0.3.0 is export-only. It does not implement Import/Restore, an Import file picker, overwrite or merge behavior, a migration engine, automatic backups, combined multi-account export, encryption, ZIP, CSV, Markdown export, or cloud sync.

Friend Radar scanning, pagination, snapshot completeness, diff/event semantics, persistence, account isolation, launcher styling, and existing Toolkit actions remain unchanged from the accepted v0.2.0 state.

The visible product brand remains **Weibo Toolkit**. Normal product controls and labels are Chinese-focused in v0.3.0; no language selector or full i18n system is implemented.

## Panel navigation

Toolkit Home keeps only **关闭** in its header. Completed Events, Status, Update result, and Backup Export result/cancellation panels include **← 返回** alongside Close. Failure panels also provide Back, except when Toolkit Home itself cannot load. Back simply reloads Toolkit Home from the current validated local state; it does not start a scan, export a file, make a network request, or write storage. No navigation history or URL state is maintained.
