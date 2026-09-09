
  function validateBackupText(text, currentOwnerUid) {
    let backup;
    try {
      backup = JSON.parse(text);
    } catch (_) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "MALFORMED_JSON",
      };
    }

    if (!isPlainObject(backup)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_TOP_LEVEL",
      };
    }
    if (backup.backupFormat !== BACKUP_FORMAT) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "WRONG_BACKUP_FORMAT",
      };
    }
    if (!SUPPORTED_BACKUP_VERSIONS.includes(backup.backupVersion)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "UNSUPPORTED_BACKUP_VERSION",
      };
    }
    if (
      typeof backup.ownerUid !== "string" ||
      normalizeStableUid(backup.ownerUid) !== backup.ownerUid
    ) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_OWNER_UID",
      };
    }
    if (backup.ownerUid !== currentOwnerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }
    if (
      hasOwn(backup, "exportedAt") &&
      (typeof backup.exportedAt !== "string" ||
        !Number.isFinite(Date.parse(backup.exportedAt)))
    ) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_EXPORTED_AT",
      };
    }
    if (!isValidStoredState(backup.state, backup.ownerUid)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "INVALID_STATE",
      };
    }
    // v1 predates follower backup coverage: it says nothing about follower state,
    // so restoring it must leave the current follower state alone.
    let followerState = null;
    let followerCovered = false;
    if (backup.backupVersion >= 2) {
      if (!hasOwn(backup, "followerState")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_FOLLOWER_STATE",
        };
      }
      if (
        backup.followerState !== null &&
        !isValidFollowerStoredState(backup.followerState, backup.ownerUid)
      ) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_FOLLOWER_STATE",
        };
      }
      followerCovered = true;
      followerState = backup.followerState;
    }

    return {
      ok: true,
      backupVersion: backup.backupVersion,
      ownerUid: backup.ownerUid,
      exportedAt: hasOwn(backup, "exportedAt") ? backup.exportedAt : null,
      state: backup.state,
      stateSerialized: JSON.stringify(backup.state),
      followerCovered,
      followerState,
      followerStateSerialized:
        followerState === null ? null : JSON.stringify(followerState),
    };
  }

  function selectBackupFile() {
    return new Promise((resolve, reject) => {
      const input = createElement("input");
      input.type = "file";
      input.accept = "application/json,.json";
      input.hidden = true;
      let settled = false;

      function finish(file) {
        if (settled) return;
        settled = true;
        if (input.parentNode) input.parentNode.removeChild(input);
        resolve(file || null);
      }

      input.addEventListener("change", () => {
        finish(input.files && input.files.length > 0 ? input.files[0] : null);
      });
      input.addEventListener("cancel", () => finish(null));
      document.body.append(input);
      try {
        input.click();
      } catch (error) {
        if (input.parentNode) input.parentNode.removeChild(input);
        reject(error);
      }
    });
  }

  // Writes the follower half of a v2 restore. It runs inside the owner-scoped
  // follower state lock, reads the current value there, and writes exactly what
  // the backup represents: the stored state, or nothing at all when the backup
  // explicitly recorded that no durable follower state existed.
  async function restoreFollowerStateFromBackup(ownerUid, followerState) {
    return await withFollowerStateLock(ownerUid, async () => {
      const key = followerStorageKey(ownerUid);
      if (followerState === null) {
        try {
          GM_deleteValue(key);
          if (GM_getValue(key, null) !== null) {
            return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
          }
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            failureKind: "PERSISTENCE_ERROR",
            errorName: error && error.name ? String(error.name) : "Error",
          };
        }
      }
      const fresh = GM_getValue(key, null);
      const expectedRaw = typeof fresh === "string" ? fresh : null;
      return persistFollowerState(ownerUid, followerState, expectedRaw);
    });
  }

  // Two durable module states are replaced, so the write order is fixed: Friend
  // Radar first with its existing compare-and-verify persistence, then the
  // follower state inside its own short lock. Nothing else is held while that
  // lock is taken, and no lock is held while the user is deciding, so no cycle
  // is possible. If the follower half fails, the Friend Radar half is put back.
  async function restoreValidatedBackup(validated, expectedCurrentRaw) {
    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== validated.ownerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }

    // The value previewed to the user is not trusted after the wait: the current
    // state is read again inside the lock and the restore is refused if another
    // tab has legitimately changed it in the meantime.
    const initial = await withFriendRadarStateLock(
      validated.ownerUid,
      async () => {
        const fresh = loadState(validated.ownerUid);
        if (!fresh.ok) return fresh;
        if (fresh.raw !== expectedCurrentRaw) {
          return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
        }
        const persisted = persistState(validated.ownerUid, validated.state);
        if (!persisted.ok) return persisted;
        const reloaded = loadState(validated.ownerUid);
        if (!reloaded.ok) {
          return {
            ok: false,
            failureKind: "PERSISTENCE_ERROR",
            errorName: "RestoreVerificationError",
            rollbackSucceeded: false,
          };
        }
        if (reloaded.raw !== validated.stateSerialized) {
          return { ok: false, failureKind: "CONCURRENT_MODIFICATION" };
        }
        return {
          ok: true,
          state: reloaded.state,
          preRestoreRaw: fresh.raw,
          restoredRaw: reloaded.raw,
        };
      }
    );
    if (!initial.ok) return initial;

    // A v1 backup carries no follower information, so the current follower state
    // is deliberately left exactly as it is.
    if (!validated.followerCovered) {
      return { ok: true, state: initial.state, followerRestored: false };
    }

    // The Friend Radar lock is released before the follower lock is taken, so
    // the two module locks are never held at the same time.
    const followerWrite = await restoreFollowerStateFromBackup(
      validated.ownerUid,
      validated.followerState
    );
    if (followerWrite.ok) {
      return { ok: true, state: initial.state, followerRestored: true };
    }

    const rollback = await rollbackFriendRadarRestore(
      validated.ownerUid,
      initial.restoredRaw,
      initial.preRestoreRaw
    );
    return {
      ok: false,
      failureKind: "BACKUP_RESTORE_ERROR",
      reason: rollback.reason,
      rollbackSucceeded: rollback.reason === "FOLLOWER_RESTORE_FAILED_ROLLED_BACK",
      followerFailureKind: followerWrite.failureKind || "UNKNOWN_FAILURE",
    };
  }

  // Undoes this restore's Friend Radar write, and only this restore's write. The
  // whole read/compare/write/verify sequence happens inside one lock callback.
  //
  // If the stored bytes are no longer the ones this restore wrote, another tab
  // has committed something newer and legitimate since; that value is left
  // alone rather than overwritten, and the outcome is reported as such.
  async function rollbackFriendRadarRestore(ownerUid, restoredRaw, preRestoreRaw) {
    const outcome = await withFriendRadarStateLock(ownerUid, async () => {
      const currentRaw = GM_getValue(storageKey(ownerUid), null);
      if (currentRaw !== restoredRaw) {
        return { reason: "RESTORE_CONCURRENT_STATE_CHANGED" };
      }
      return writeFriendRadarRaw(ownerUid, preRestoreRaw)
        ? { reason: "FOLLOWER_RESTORE_FAILED_ROLLED_BACK" }
        : { reason: "RESTORE_STATE_UNCERTAIN" };
    });
    if (outcome && outcome.failureKind === "STATE_LOCK_UNAVAILABLE") {
      return { reason: "RESTORE_STATE_UNCERTAIN" };
    }
    return outcome;
  }

  function snapshotRecordCount(state) {
    return state.latestSnapshot ? state.latestSnapshot.records.length : 0;
  }

  function showRestorePreview(validated, currentLoaded) {
    const body = showPanel("恢复备份", true);
    body.append(
      createElement(
        "p",
        validated.followerCovered
          ? "恢复后，当前账号的关系雷达数据、粉丝快照和粉丝变化记录将被此备份完整替换。"
          : "恢复后，当前账号的关系雷达数据将被此备份完整替换；此备份不包含粉丝快照和粉丝变化记录，它们将保持不变。",
        "wfr-error"
      )
    );
    body.append(
      createElement(
        "p",
        "建议先导出当前数据作为备份。",
        "wfr-muted"
      )
    );
    addLine(body, "备份账号 UID", validated.ownerUid);
    if (validated.exportedAt !== null) {
      addLine(body, "备份导出时间", formatTime(validated.exportedAt));
    }
    addLine(body, "当前事件数", currentLoaded.state.events.length);
    addLine(body, "备份事件数", validated.state.events.length);
    addLine(body, "当前快照记录数", snapshotRecordCount(currentLoaded.state));
    addLine(body, "备份快照记录数", snapshotRecordCount(validated.state));
    if (validated.followerCovered) {
      addLine(
        body,
        "备份中的粉丝变化事件数",
        validated.followerState === null
          ? "无粉丝快照"
          : validated.followerState.events.length
      );
    }

    const actions = createElement("div", null, "wfr-actions");
    const exportButton = createElement("button", "先备份当前数据", "wfr-button");
    const confirmButton = createElement(
      "button",
      "确认完整替换",
      "wfr-button wfr-primary"
    );
    exportButton.type = "button";
    confirmButton.type = "button";
    exportButton.addEventListener("click", () => void exportBackup());
    confirmButton.addEventListener("click", async () => {
      exportButton.disabled = true;
      confirmButton.disabled = true;
      if (updateRunning) {
        showFailure("恢复备份失败", {
          failureKind: "UPDATE_ALREADY_RUNNING",
        });
        return;
      }
      const restored = await restoreValidatedBackup(
        validated,
        currentLoaded.raw
      );
      if (!restored.ok) {
        showFailure("恢复备份失败", restored);
        return;
      }
      showUnreadBadgeForState(restored.state);
      const success = showPanel("备份已恢复", true);
      success.append(createElement("p", "备份已恢复。", "wfr-success"));
      addLine(success, "事件数", restored.state.events.length);
      addLine(success, "快照记录数", snapshotRecordCount(restored.state));
      addLine(
        success,
        "粉丝快照和粉丝变化记录",
        restored.followerRestored ? "已一并恢复" : "未包含在此备份中，保持不变"
      );
    });
    actions.append(exportButton, confirmButton);
    body.append(actions);
  }

  async function restoreBackup() {
    if (updateRunning) {
      showFailure("恢复备份", {
        failureKind: "UPDATE_ALREADY_RUNNING",
      });
      return;
    }
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("恢复备份", uidResult);
      return;
    }
    const currentLoaded = loadState(uidResult.uid);
    if (!currentLoaded.ok) {
      showFailure("恢复备份", currentLoaded);
      return;
    }

    let file;
    try {
      file = await selectBackupFile();
    } catch (error) {
      showFailure("恢复备份", {
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "FILE_READ_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }
    if (file === null) {
      const cancelled = showPanel("恢复已取消", true);
      cancelled.append(createElement("p", "恢复已取消。", "wfr-muted"));
      return;
    }

    let text;
    try {
      text = await file.text();
    } catch (error) {
      showFailure("恢复备份", {
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "FILE_READ_ERROR",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }
    const validated = validateBackupText(text, uidResult.uid);
    if (!validated.ok) {
      showFailure("恢复备份", validated);
      return;
    }
    showRestorePreview(validated, currentLoaded);
  }

  function backupExportError(backupStage, error) {
    const tagged = new Error("Backup export failed");
    tagged.name = error && error.name ? String(error.name) : "Error";
    tagged.backupStage = backupStage;
    return tagged;
  }

  // Browser-managed Blob download, shared by the backup and event exports.
  // Failures reuse the export stage names so the failure UI stays consistent.
  function downloadFile(content, filename, mimeType) {
    let blob;
    try {
      blob = new Blob([content], { type: mimeType });
    } catch (error) {
      throw backupExportError("FALLBACK_CREATE_BLOB", error);
    }
    let objectUrl;
    try {
      objectUrl = URL.createObjectURL(blob);
    } catch (error) {
      throw backupExportError("FALLBACK_CREATE_URL", error);
    }
    try {
      const link = createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      try {
        link.click();
      } finally {
        if (link.parentNode) link.parentNode.removeChild(link);
        setTimeout(
          () => URL.revokeObjectURL(objectUrl),
          OBJECT_URL_REVOKE_DELAY_MS
        );
      }
    } catch (error) {
      throw backupExportError("FALLBACK_TRIGGER_DOWNLOAD", error);
    }
  }

  async function saveBackup(json, filename) {
    if (
      typeof unsafeWindow !== "undefined" &&
      typeof unsafeWindow.showSaveFilePicker === "function"
    ) {
      let fileHandle;
      try {
        fileHandle = await unsafeWindow.showSaveFilePicker.call(
          unsafeWindow,
          {
            suggestedName: filename,
            types: [
              {
                description: "JSON backup",
                accept: { "application/json": [".json"] },
              },
            ],
          }
        );
      } catch (error) {
        const errorName = error && error.name ? String(error.name) : "Error";
        if (errorName === "AbortError") return { cancelled: true };
        if (errorName !== "NotAllowedError" && errorName !== "SecurityError") {
          throw backupExportError("PICKER_OPEN", error);
        }
        downloadFile(json, filename, BACKUP_MIME);
        return { method: "browser-download", filename };
      }

      let writable;
      try {
        writable = await fileHandle.createWritable();
      } catch (error) {
        throw backupExportError("CREATE_WRITABLE", error);
      }
      try {
        await writable.write(json);
      } catch (error) {
        throw backupExportError("WRITE_FILE", error);
      }
      try {
        await writable.close();
      } catch (error) {
        throw backupExportError("CLOSE_FILE", error);
      }
      return {
        method: "save-picker",
        filename:
          typeof fileHandle.name === "string" && fileHandle.name.length > 0
            ? fileHandle.name
            : filename,
      };
    }

    downloadFile(json, filename, BACKUP_MIME);
    return { method: "browser-download", filename };
  }

  async function exportBackup() {
    const uidResult = determineCurrentUid();
    if (!uidResult.ok) {
      showFailure("导出备份", uidResult);
      return;
    }
    const loaded = loadState(uidResult.uid);
    if (!loaded.ok) {
      showFailure("导出备份", loaded);
      return;
    }
    // Only the last successfully persisted follower state is exported; an
    // unreadable one fails the export rather than silently backing up "none".
    const followerLoaded = loadFollowerState(uidResult.uid);
    if (!followerLoaded.ok) {
      showFailure("导出备份", followerLoaded);
      return;
    }
    const followerStateForBackup =
      followerLoaded.raw === null ? null : followerLoaded.state;

    const exportedAt = new Date();
    const filename = backupFilename(uidResult.uid, exportedAt);
    let saveResult;
    try {
      const backup = createBackup(
        uidResult.uid,
        loaded.state,
        followerStateForBackup,
        exportedAt
      );
      const json = serializeBackup(backup);
      saveResult = await saveBackup(json, filename);
    } catch (error) {
      showFailure("导出备份", {
        failureKind: "BACKUP_EXPORT_ERROR",
        backupStage: error && error.backupStage ? String(error.backupStage) : "PREPARE_BACKUP",
        errorName: error && error.name ? String(error.name) : "Error",
      });
      return;
    }

    if (saveResult.cancelled) {
      const body = showPanel("导出已取消", true);
      body.append(createElement("p", "导出已取消", "wfr-muted"));
      return;
    }

    const nativeSave = saveResult.method === "save-picker";
    const body = showPanel(
      nativeSave ? "备份已保存" : "已请求浏览器下载备份",
      true
    );
    if (!nativeSave) {
      body.append(
        createElement(
          "p",
          "备份已交给浏览器下载，保存位置及最终文件名由浏览器下载设置决定。",
          "wfr-success"
        )
      );
    }
    addLine(body, "账号 UID", uidResult.uid);
    addLine(
      body,
      "已有快照",
      loaded.state.latestSnapshot ? "是" : "否"
    );
    addLine(body, "事件数", loaded.state.events.length);
    addLine(
      body,
      "粉丝变化事件数",
      followerStateForBackup === null
        ? "无粉丝快照"
        : followerStateForBackup.events.length
    );
    addLine(body, nativeSave ? "文件名" : "建议文件名", saveResult.filename);
  }

  // Read-only: builds a document from the already loaded state and hands it to the
  // browser download path. Friend Radar storage is never touched.
  function exportEvents(ownerUid, state, format) {
    const spec = EVENT_EXPORT_FORMATS[format];
    const exportedAt = new Date();
    const filename = eventExportFilename(ownerUid, exportedAt, spec.extension);
    const backToEvents = () => renderEvents(ownerUid, state, null);
    try {
      downloadFile(
        spec.build(ownerUid, state.events, exportedAt),
        filename,
        spec.mimeType
      );
    } catch (error) {
      showFailure(
        "导出事件",
        {
          failureKind: "EVENT_EXPORT_ERROR",
          exportStage: error && error.backupStage ? String(error.backupStage) : "PREPARE_EXPORT",
          errorName: error && error.name ? String(error.name) : "Error",
        },
        backToEvents
      );
      return;
    }

    const body = showPanel("已请求浏览器下载事件", backToEvents);
    body.append(
      createElement(
        "p",
        "事件文件已交给浏览器下载，保存位置及最终文件名由浏览器下载设置决定。",
        "wfr-success"
      )
    );
    addLine(body, "格式", spec.label);
    addLine(body, "建议文件名", filename);
    addLine(body, "已导出事件数", state.events.length);
    body.append(
      createElement(
        "p",
        "导出内容仅为 Weibo Toolkit 已观察并保存的事件，本地数据未被修改。",
        "wfr-muted"
      )
    );
  }
