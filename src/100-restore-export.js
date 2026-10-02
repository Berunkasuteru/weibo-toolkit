
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
    // v1 and v2 predate Friend Notes in exactly the same way: they say nothing
    // about them, so restoring either must leave the current notes alone.
    let friendNotesState = null;
    let friendNotesCovered = false;
    if (backup.backupVersion >= 3) {
      if (!hasOwn(backup, "friendNotes")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_FRIEND_NOTES",
        };
      }
      if (
        backup.friendNotes !== null &&
        !isValidFriendNotesState(backup.friendNotes, backup.ownerUid)
      ) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_FRIEND_NOTES",
        };
      }
      friendNotesCovered = true;
      friendNotesState = backup.friendNotes;
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
      friendNotesCovered,
      friendNotesState,
      friendNotesSerialized:
        friendNotesState === null ? null : JSON.stringify(friendNotesState),
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
  // Reads the exact follower bytes the user is about to review. Absence is a
  // real reviewed value, so it is represented as null rather than as a failure.
  function currentFollowerRestoreToken(ownerUid) {
    try {
      const raw = GM_getValue(followerStorageKey(ownerUid), null);
      return { ok: true, raw: typeof raw === "string" ? raw : null };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FOLLOWER_STATE_UNREADABLE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  // Called only after a follower mutator was already attempted. A thrown write,
  // a thrown delete or a failed verification does not prove the effect did not
  // land, so one bounded re-read inside the still-held lock is used solely to
  // prove non-mutation. It never upgrades a failed attempt to success and never
  // retries the mutation.
  function classifyAttemptedFollowerMutation(key, expectedRaw, failure) {
    let observedRaw;
    try {
      observedRaw = GM_getValue(key, null);
    } catch (_) {
      return { ...failure, ok: false, mutationAttempted: true, outcomeUnknown: true };
    }
    const normalized = typeof observedRaw === "string" ? observedRaw : null;
    if (normalized === expectedRaw) {
      return { ...failure, ok: false, mutationAttempted: true, outcomeUnknown: false };
    }
    return { ...failure, ok: false, mutationAttempted: true, outcomeUnknown: true };
  }

  // The follower half obeys the same preview-time concurrency principle as the
  // Friend Radar half: the bytes the user reviewed must still be the stored ones.
  // The expected value is the preview token, never a read taken immediately
  // before the write, which would always agree with itself.
  async function restoreFollowerStateFromBackup(
    ownerUid,
    followerState,
    expectedFollowerRaw
  ) {
    return await withFollowerStateLock(ownerUid, async () => {
      const key = followerStorageKey(ownerUid);
      let currentRaw;
      try {
        currentRaw = GM_getValue(key, null);
      } catch (error) {
        return {
          ok: false,
          mutationAttempted: false,
          failureKind: "STORAGE_ERROR",
          reason: "FOLLOWER_STATE_UNREADABLE",
          errorName: error && error.name ? String(error.name) : "Error",
        };
      }
      const normalizedCurrent = typeof currentRaw === "string" ? currentRaw : null;
      if (normalizedCurrent !== expectedFollowerRaw) {
        return {
          ok: false,
          mutationAttempted: false,
          failureKind: "CONCURRENT_MODIFICATION",
        };
      }
      if (followerState === null) {
        try {
          GM_deleteValue(key);
          if (GM_getValue(key, null) !== null) {
            return classifyAttemptedFollowerMutation(key, expectedFollowerRaw, {
              failureKind: "CONCURRENT_MODIFICATION",
            });
          }
          return { ok: true, mutationAttempted: true };
        } catch (error) {
          return classifyAttemptedFollowerMutation(key, expectedFollowerRaw, {
            failureKind: "PERSISTENCE_ERROR",
            errorName: error && error.name ? String(error.name) : "Error",
          });
        }
      }
      const persisted = persistFollowerState(
        ownerUid,
        followerState,
        expectedFollowerRaw
      );
      if (persisted.ok) return { ok: true, mutationAttempted: true };
      return classifyAttemptedFollowerMutation(key, expectedFollowerRaw, persisted);
    });
  }

  // Two durable module states are replaced, so the write order is fixed: Friend
  // Radar first with its existing compare-and-verify persistence, then the
  // follower state inside its own short lock. Nothing else is held while that
  // lock is taken, and no lock is held while the user is deciding, so no cycle
  // is possible. If the follower half fails, the Friend Radar half is put back.
  function restoreStateUncertain(followerFailureKind) {
    const result = {
      ok: false,
      failureKind: "BACKUP_RESTORE_ERROR",
      reason: "RESTORE_STATE_UNCERTAIN",
      rollbackSucceeded: false,
    };
    if (followerFailureKind) result.followerFailureKind = followerFailureKind;
    return result;
  }

  // Reads the exact Friend Notes bytes the user is about to review. Like the
  // follower token, absence is a real reviewed value. The bytes are not required
  // to be valid: a restore the user confirmed is also the way out of a damaged
  // local value, and the preview says so when that is what will be replaced.
  function currentFriendNotesRestoreToken(ownerUid) {
    try {
      const raw = GM_getValue(friendNotesStorageKey(ownerUid), null);
      return { ok: true, raw: typeof raw === "string" ? raw : null };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "FRIEND_NOTES_UNREADABLE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  // Runs before the first restore write. Notes are the module most likely to be
  // edited in another tab while the preview is open, so that case is refused
  // here, with nothing written, instead of being discovered after two other
  // modules were already replaced. The check inside the final write below stays
  // authoritative; this one only keeps the common case free of rollbacks.
  async function friendNotesUnchangedSincePreview(ownerUid, expectedRaw) {
    return await withFriendNotesLock(ownerUid, async () => {
      const token = currentFriendNotesRestoreToken(ownerUid);
      if (!token.ok) return token;
      return token.raw === expectedRaw
        ? { ok: true }
        : {
            ok: false,
            failureKind: "BACKUP_RESTORE_ERROR",
            reason: "FRIEND_NOTES_CHANGED_SINCE_PREVIEW",
          };
    });
  }

  // Writes the Friend Notes third of a v3 restore inside its own lock: the
  // stored state, or nothing at all when the backup recorded that none existed.
  // The expected value is the preview token, never a read taken just before the
  // write.
  async function restoreFriendNotesFromBackup(
    ownerUid,
    serialized,
    expectedRaw
  ) {
    return await withFriendNotesLock(ownerUid, async () => {
      const token = currentFriendNotesRestoreToken(ownerUid);
      if (!token.ok) return { ...token, mutationAttempted: false };
      if (token.raw !== expectedRaw) {
        return {
          ok: false,
          mutationAttempted: false,
          failureKind: "CONCURRENT_MODIFICATION",
        };
      }
      const written = writeFriendNotesRaw(ownerUid, serialized, expectedRaw);
      return written.ok ? { ok: true, mutationAttempted: true } : written;
    });
  }

  // Undoes this restore's follower write, and only this restore's write, under
  // the same rule as the Friend Radar rollback below: bytes another tab has
  // committed since are left alone and reported, never overwritten.
  async function rollbackFollowerRestore(ownerUid, restoredRaw, preRestoreRaw) {
    const outcome = await withFollowerStateLock(ownerUid, async () => {
      const key = followerStorageKey(ownerUid);
      try {
        const currentRaw = GM_getValue(key, null);
        if ((typeof currentRaw === "string" ? currentRaw : null) !== restoredRaw) {
          return { reason: "RESTORE_CONCURRENT_STATE_CHANGED" };
        }
        if (preRestoreRaw === null) GM_deleteValue(key);
        else GM_setValue(key, preRestoreRaw);
        const verified = GM_getValue(key, null);
        return (typeof verified === "string" ? verified : null) === preRestoreRaw
          ? { reason: "ROLLED_BACK" }
          : { reason: "RESTORE_STATE_UNCERTAIN" };
      } catch (_) {
        return { reason: "RESTORE_STATE_UNCERTAIN" };
      }
    });
    if (outcome && outcome.failureKind === "STATE_LOCK_UNAVAILABLE") {
      return { reason: "RESTORE_STATE_UNCERTAIN" };
    }
    return outcome;
  }

  // The last third of a v3 restore. By now Friend Radar and the follower state
  // hold the backup's values. If the notes cannot be written and are known to
  // be untouched, both earlier writes are undone, each only while its bytes are
  // still the ones this restore wrote. The result is "rolled back" only when
  // both were; anything less is reported as partial or uncertain.
  async function finishFriendNotesRestore(
    validated,
    initial,
    expectedFollowerRaw,
    expectedFriendNotesRaw
  ) {
    const notesWrite = await restoreFriendNotesFromBackup(
      validated.ownerUid,
      validated.friendNotesSerialized,
      expectedFriendNotesRaw
    );
    if (notesWrite.ok) {
      return {
        ok: true,
        state: initial.state,
        followerRestored: true,
        friendNotesRestored: true,
      };
    }
    const friendNotesFailureKind = notesWrite.failureKind || "UNKNOWN_FAILURE";
    if (notesWrite.outcomeUnknown === true) {
      return { ...restoreStateUncertain(null), friendNotesFailureKind };
    }

    const followerRollback = await rollbackFollowerRestore(
      validated.ownerUid,
      validated.followerStateSerialized,
      expectedFollowerRaw
    );
    const radarRollback = await rollbackFriendRadarRestore(
      validated.ownerUid,
      initial.restoredRaw,
      initial.preRestoreRaw
    );
    const followerRolledBack = followerRollback.reason === "ROLLED_BACK";
    const radarRolledBack =
      radarRollback.reason === "FOLLOWER_RESTORE_FAILED_ROLLED_BACK";
    let reason = "FRIEND_NOTES_RESTORE_FAILED_PARTIAL";
    if (followerRolledBack && radarRolledBack) {
      reason = "FRIEND_NOTES_RESTORE_FAILED_ROLLED_BACK";
    } else if (
      followerRollback.reason === "RESTORE_STATE_UNCERTAIN" ||
      radarRollback.reason === "RESTORE_STATE_UNCERTAIN"
    ) {
      reason = "RESTORE_STATE_UNCERTAIN";
    }
    return {
      ok: false,
      failureKind: "BACKUP_RESTORE_ERROR",
      reason,
      rollbackSucceeded: followerRolledBack && radarRolledBack,
      friendNotesFailureKind,
    };
  }

  async function restoreValidatedBackup(
    validated,
    expectedCurrentRaw,
    expectedFollowerRaw,
    expectedFriendNotesRaw
  ) {
    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== validated.ownerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }

    if (validated.friendNotesCovered) {
      const unchanged = await friendNotesUnchangedSincePreview(
        validated.ownerUid,
        expectedFriendNotesRaw
      );
      if (!unchanged.ok) return unchanged;
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
        // The pre-write comparison above already passed, so from here the write
        // has been attempted and a failure no longer proves nothing was stored.
        // One bounded re-read inside this lock is used only to prove that the
        // bytes are still the pre-restore ones; anything else is uncertain.
        if (!persisted.ok) {
          return friendRadarRestoreWriteOutcome(
            validated.ownerUid,
            fresh.raw,
            persisted
          );
        }
        const reloaded = loadState(validated.ownerUid);
        if (!reloaded.ok) return restoreStateUncertain(null);
        if (reloaded.raw !== validated.stateSerialized) {
          return friendRadarRestoreWriteOutcome(validated.ownerUid, fresh.raw, {
            ok: false,
            failureKind: "CONCURRENT_MODIFICATION",
          });
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
      return {
        ok: true,
        state: initial.state,
        followerRestored: false,
        friendNotesRestored: false,
      };
    }

    // The Friend Radar lock is released before the follower lock is taken, so
    // the two module locks are never held at the same time.
    const followerWrite = await restoreFollowerStateFromBackup(
      validated.ownerUid,
      validated.followerState,
      expectedFollowerRaw
    );
    if (followerWrite.ok) {
      // A v2 backup carries no Friend Notes, so the current ones are left
      // exactly as they are, just as v1 leaves the follower state alone.
      if (!validated.friendNotesCovered) {
        return {
          ok: true,
          state: initial.state,
          followerRestored: true,
          friendNotesRestored: false,
        };
      }
      // The follower lock is released before the notes lock is taken: no two
      // module locks are ever held at the same time.
      return await finishFriendNotesRestore(
        validated,
        initial,
        expectedFollowerRaw,
        expectedFriendNotesRaw
      );
    }

    // Rolling Friend Radar back and calling the restore cancelled is only honest
    // when the follower half is known not to have mutated. Once a follower
    // mutation may already have landed, the pair is reported as uncertain and
    // Friend Radar is left where the restore put it.
    if (followerWrite.outcomeUnknown === true) {
      return restoreStateUncertain(
        followerWrite.failureKind || "UNKNOWN_FAILURE"
      );
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

  // Runs inside the Friend Radar lock after persistState attempted the restore
  // write. A single re-read proves non-mutation or nothing at all; it never
  // retries and never turns a failed attempt into a success.
  function friendRadarRestoreWriteOutcome(ownerUid, preRestoreRaw, failure) {
    let observedRaw;
    try {
      observedRaw = GM_getValue(storageKey(ownerUid), null);
    } catch (_) {
      return restoreStateUncertain(null);
    }
    const normalized = typeof observedRaw === "string" ? observedRaw : null;
    if (normalized === preRestoreRaw) return failure;
    return restoreStateUncertain(null);
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

  // Every other durable operation refuses to start while any of the three is in
  // flight. Restore writes both module states, so it must obey the same gate at
  // entry and again at the confirmation click, after the user wait.
  function restoreBlockedByRunningOperation() {
    return Boolean(
      updateRunning || followerUpdateRunning || followerRemovalInFlight
    );
  }

  function friendNoteCount(state) {
    return state === null ? 0 : Object.keys(state.notes).length;
  }

  // friendNotesPreview.current is the interpretation of the exact bytes that
  // become the restore's expected value, so the numbers shown here describe
  // precisely what a confirmation would replace.
  function showRestorePreview(
    validated,
    currentLoaded,
    expectedFollowerRaw,
    friendNotesPreview
  ) {
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
    const currentNotes = friendNotesPreview.current;
    if (validated.friendNotesCovered) {
      body.append(
        createElement(
          "p",
          "此备份还包含友人档案：当前账号手写的全部备注和标签也将被备份中的内容完整替换，不做合并。",
          "wfr-error"
        )
      );
    } else {
      body.append(
        createElement(
          "p",
          currentNotes.ok
            ? `此备份不包含友人档案，当前的 ${friendNoteCount(
                currentNotes.state
              )} 条友人档案将保持不变。`
            : "此备份不包含友人档案，当前的友人档案数据将保持不变。",
          "wfr-muted"
        )
      );
    }
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
    if (validated.friendNotesCovered) {
      const backupNotes = validated.friendNotesState;
      addLine(
        body,
        "当前友人档案数",
        currentNotes.ok
          ? friendNoteCount(currentNotes.state)
          : "无法读取（将被备份内容替换）"
      );
      addLine(
        body,
        "备份友人档案数",
        backupNotes === null ? "无友人档案" : friendNoteCount(backupNotes)
      );
      if (currentNotes.ok) {
        const onlyCurrent = Object.keys(currentNotes.state.notes).filter(
          (uid) => backupNotes === null || !hasOwn(backupNotes.notes, uid)
        ).length;
        addLine(
          body,
          "恢复后将被移除的当前档案",
          `${onlyCurrent} 条（备份中没有）`
        );
      }
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
      if (restoreBlockedByRunningOperation()) {
        showFailure("恢复备份失败", {
          failureKind: "UPDATE_ALREADY_RUNNING",
        });
        return;
      }
      const restored = await restoreValidatedBackup(
        validated,
        currentLoaded.raw,
        expectedFollowerRaw,
        friendNotesPreview.expectedRaw
      );
      if (!restored.ok) {
        showFailure("恢复备份失败", restored);
        return;
      }
      // An open profile panel would otherwise keep showing the replaced note.
      if (restored.friendNotesRestored) rebuildProfileFriendNotes();
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
      addLine(
        success,
        "友人档案",
        restored.friendNotesRestored
          ? `已一并恢复（${friendNoteCount(validated.friendNotesState)} 条）`
          : "未包含在此备份中，保持不变"
      );
    });
    actions.append(exportButton, confirmButton);
    body.append(actions);
  }

  async function restoreBackup() {
    if (restoreBlockedByRunningOperation()) {
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
    // The follower bytes the user is about to review become this restore's
    // expected value, exactly as the Friend Radar raw already does. A v1 backup
    // touches no follower state, so it neither needs nor reads the token.
    let expectedFollowerRaw = null;
    if (validated.followerCovered) {
      const followerToken = currentFollowerRestoreToken(uidResult.uid);
      if (!followerToken.ok) {
        showFailure("恢复备份", followerToken);
        return;
      }
      expectedFollowerRaw = followerToken.raw;
    }
    // Friend Notes follow the same rule. For a v1/v2 backup the notes are only
    // read to tell the user they stay as they are; an unreadable value there
    // blocks nothing, because that restore never touches it.
    const friendNotesToken = currentFriendNotesRestoreToken(uidResult.uid);
    if (validated.friendNotesCovered && !friendNotesToken.ok) {
      showFailure("恢复备份", friendNotesToken);
      return;
    }
    showRestorePreview(validated, currentLoaded, expectedFollowerRaw, {
      expectedRaw: friendNotesToken.ok ? friendNotesToken.raw : null,
      current: friendNotesToken.ok
        ? friendNotesStateFromRaw(friendNotesToken.raw, uidResult.uid)
        : friendNotesToken,
    });
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
    // Hand-written notes obey the same rule: unreadable notes fail the export
    // instead of producing a backup that claims there were none.
    const friendNotesLoaded = loadFriendNotesState(uidResult.uid);
    if (!friendNotesLoaded.ok) {
      showFailure("导出备份", friendNotesLoaded);
      return;
    }
    const friendNotesForBackup =
      friendNotesLoaded.raw === null ? null : friendNotesLoaded.state;

    const exportedAt = new Date();
    const filename = backupFilename(uidResult.uid, exportedAt);
    let saveResult;
    try {
      const backup = createBackup(
        uidResult.uid,
        loaded.state,
        followerStateForBackup,
        exportedAt,
        friendNotesForBackup
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
    addLine(
      body,
      "友人档案数",
      friendNotesForBackup === null
        ? "无友人档案"
        : friendNoteCount(friendNotesForBackup)
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
