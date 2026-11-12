
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

    let v4DomainsCovered = false;
    let followerRemovalLog = null;
    let followerHygienePresets = null;
    let usageState = null;
    let profileVisits = null;
    if (backup.backupVersion >= 4) {
      if (!hasOwn(backup, "followerRemovalLog")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_FOLLOWER_REMOVAL_LOG",
        };
      }
      if (
        backup.followerRemovalLog !== null &&
        !isValidFollowerRemovalLogState(
          backup.followerRemovalLog,
          backup.ownerUid
        )
      ) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_FOLLOWER_REMOVAL_LOG",
        };
      }
      if (!hasOwn(backup, "followerHygienePresets")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_FOLLOWER_HYGIENE_PRESETS",
        };
      }
      if (
        backup.followerHygienePresets !== null &&
        !isValidFollowerHygienePresetsState(backup.followerHygienePresets)
      ) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_FOLLOWER_HYGIENE_PRESETS",
        };
      }
      if (!hasOwn(backup, "usageState")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_USAGE_STATE",
        };
      }
      if (backup.usageState !== null && !isValidUsageState(backup.usageState)) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_USAGE_STATE",
        };
      }
      if (!hasOwn(backup, "profileVisits")) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "MISSING_PROFILE_VISITS",
        };
      }
      if (
        backup.profileVisits !== null &&
        !isValidProfileVisitBackupState(backup.profileVisits)
      ) {
        return {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "INVALID_PROFILE_VISITS",
        };
      }
      v4DomainsCovered = true;
      followerRemovalLog = backup.followerRemovalLog;
      followerHygienePresets =
        backup.followerHygienePresets === null
          ? null
          : normalizeFollowerHygienePresetsState(backup.followerHygienePresets);
      usageState = backup.usageState;
      profileVisits = backup.profileVisits;
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
      v4DomainsCovered,
      followerRemovalLog,
      followerHygienePresets,
      usageState,
      profileVisits,
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

  // Reads the exact Friend Radar bytes a restore may replace. Unlike loadState
  // it does not require them to be valid: a restore the user confirmed is the
  // way out of a damaged local value. A value that cannot be read at all, or
  // that is not a string, is still a failure, so "damaged" is never confused
  // with "absent".
  function currentFriendRadarRestoreToken(ownerUid) {
    let raw;
    try {
      raw = GM_getValue(storageKey(ownerUid), null);
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: "STATE_UNREADABLE",
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
    if (raw === null || typeof raw === "undefined") return { ok: true, raw: null };
    if (typeof raw !== "string") {
      return { ok: false, failureKind: "STORAGE_ERROR", reason: "STATE_NOT_STRING" };
    }
    return { ok: true, raw };
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

  const V4_RESTORE_DOMAIN_SPECS = Object.freeze([
    Object.freeze({
      key: "followerRemovalLog",
      label: "粉丝移除记录",
      storageKey: followerRemovalLogStorageKey,
      withLock: withFollowerRemovalLogLock,
      isRawObject: false,
      unreadableReason: "FOLLOWER_REMOVAL_LOG_UNREADABLE",
    }),
    Object.freeze({
      key: "followerHygienePresets",
      label: "粉丝筛选方案",
      storageKey: followerHygienePresetsStorageKey,
      withLock: (ownerUid, transaction) =>
        withExclusiveStateLock(
          "weibo-toolkit-follower-hygiene-presets-" + ownerUid,
          transaction
        ),
      isRawObject: false,
      unreadableReason: "FOLLOWER_HYGIENE_PRESETS_UNREADABLE",
    }),
    Object.freeze({
      key: "usageState",
      label: "微博使用统计",
      storageKey: usageStorageKey,
      withLock: withUsageStateLock,
      isRawObject: false,
      unreadableReason: "USAGE_STATE_UNREADABLE",
    }),
    Object.freeze({
      key: "profileVisits",
      label: "主页访问记录",
      storageKey: profileVisitStorageKey,
      withLock: withProfileVisitsLock,
      isRawObject: true,
      unreadableReason: "PROFILE_VISITS_UNREADABLE",
    }),
  ]);

  function v4TokenFromRawValue(spec, rawValue) {
    if (rawValue === null || typeof rawValue === "undefined") {
      return null;
    }
    if (spec.isRawObject) {
      return typeof rawValue === "string"
        ? "raw:" + rawValue
        : "json:" + JSON.stringify(rawValue);
    }
    return typeof rawValue === "string"
      ? "str:" + rawValue
      : "bad:" + typeof rawValue + ":" + JSON.stringify(rawValue);
  }

  function encodeV4BackupTarget(spec, backupValue) {
    if (backupValue === null) {
      return { isDelete: true, storedValue: null, token: null };
    }
    if (spec.isRawObject) {
      const cloned = JSON.parse(JSON.stringify(backupValue));
      return {
        isDelete: false,
        storedValue: cloned,
        token: "json:" + JSON.stringify(cloned),
      };
    }
    const serialized = JSON.stringify(backupValue);
    return {
      isDelete: false,
      storedValue: serialized,
      token: "str:" + serialized,
    };
  }

  function readV4DomainToken(spec, ownerUid) {
    try {
      const rawValue = GM_getValue(spec.storageKey(ownerUid), null);
      return {
        ok: true,
        rawValue:
          rawValue === null || typeof rawValue === "undefined" ? null : rawValue,
        token: v4TokenFromRawValue(spec, rawValue),
      };
    } catch (error) {
      return {
        ok: false,
        failureKind: "STORAGE_ERROR",
        reason: spec.unreadableReason,
        errorName: error && error.name ? String(error.name) : "Error",
      };
    }
  }

  function readV4RestorePreviewTokens(ownerUid) {
    const tokens = {};
    for (const spec of V4_RESTORE_DOMAIN_SPECS) {
      const read = readV4DomainToken(spec, ownerUid);
      if (!read.ok) return read;
      tokens[spec.key] = read.token;
    }
    return { ok: true, tokens };
  }

  function classifyAttemptedV4Mutation(spec, ownerUid, expectedToken, failure) {
    const observed = readV4DomainToken(spec, ownerUid);
    if (!observed.ok) {
      return {
        ...failure,
        ok: false,
        mutationAttempted: true,
        outcomeUnknown: true,
      };
    }
    if (observed.token === expectedToken) {
      return {
        ...failure,
        ok: false,
        mutationAttempted: true,
        outcomeUnknown: false,
      };
    }
    return {
      ...failure,
      ok: false,
      mutationAttempted: true,
      outcomeUnknown: true,
    };
  }

  async function restoreSingleV4Domain(
    ownerUid,
    spec,
    backupValue,
    expectedToken
  ) {
    const target = encodeV4BackupTarget(spec, backupValue);
    const result = await spec.withLock(ownerUid, async () => {
      const current = readV4DomainToken(spec, ownerUid);
      if (!current.ok) {
        return { ...current, mutationAttempted: false, outcomeUnknown: false };
      }
      if (current.token !== expectedToken) {
        return {
          ok: false,
          mutationAttempted: false,
          outcomeUnknown: false,
          failureKind: "CONCURRENT_MODIFICATION",
        };
      }
      const key = spec.storageKey(ownerUid);
      try {
        if (target.isDelete) GM_deleteValue(key);
        else GM_setValue(key, target.storedValue);
        const after = readV4DomainToken(spec, ownerUid);
        if (!after.ok || after.token !== target.token) {
          return classifyAttemptedV4Mutation(spec, ownerUid, expectedToken, {
            failureKind: after.ok ? "CONCURRENT_MODIFICATION" : after.failureKind,
          });
        }
        return {
          ok: true,
          preRawValue: current.rawValue,
          preToken: current.token,
          restoredToken: target.token,
        };
      } catch (error) {
        return classifyAttemptedV4Mutation(spec, ownerUid, expectedToken, {
          failureKind: "PERSISTENCE_ERROR",
          errorName: error && error.name ? String(error.name) : "Error",
        });
      }
    });
    return result;
  }

  async function rollbackSingleV4Domain(ownerUid, committed) {
    const { spec, preRawValue, preToken, restoredToken } = committed;
    const outcome = await spec.withLock(ownerUid, async () => {
      const key = spec.storageKey(ownerUid);
      const current = readV4DomainToken(spec, ownerUid);
      if (!current.ok) return { reason: "RESTORE_STATE_UNCERTAIN" };
      if (current.token !== restoredToken) {
        return { reason: "RESTORE_CONCURRENT_STATE_CHANGED" };
      }
      try {
        if (preRawValue === null) GM_deleteValue(key);
        else GM_setValue(key, preRawValue);
        const after = readV4DomainToken(spec, ownerUid);
        return after.ok && after.token === preToken
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

  async function rollbackFriendNotesRestore(
    ownerUid,
    restoredRaw,
    preRestoreRaw
  ) {
    const outcome = await withFriendNotesLock(ownerUid, async () => {
      const token = currentFriendNotesRestoreToken(ownerUid);
      if (!token.ok) return { reason: "RESTORE_STATE_UNCERTAIN" };
      if (token.raw !== restoredRaw) {
        return { reason: "RESTORE_CONCURRENT_STATE_CHANGED" };
      }
      const written = writeFriendNotesRaw(ownerUid, preRestoreRaw, restoredRaw);
      return written.ok
        ? { reason: "ROLLED_BACK" }
        : { reason: "RESTORE_STATE_UNCERTAIN" };
    });
    if (outcome && outcome.failureKind === "STATE_LOCK_UNAVAILABLE") {
      return { reason: "RESTORE_STATE_UNCERTAIN" };
    }
    return outcome;
  }

  async function finishV4DomainsRestore(
    validated,
    initial,
    expectedFollowerRaw,
    expectedFriendNotesRaw,
    expectedV4Tokens
  ) {
    const committedV4 = [];
    let failedSpec = null;
    let domainFailure = null;
    for (const spec of V4_RESTORE_DOMAIN_SPECS) {
      const expectedToken = hasOwn(expectedV4Tokens, spec.key)
        ? expectedV4Tokens[spec.key]
        : undefined;
      if (expectedToken === undefined) {
        failedSpec = spec;
        domainFailure = {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "V4_PREVIEW_TOKENS_MISSING",
          outcomeUnknown: false,
        };
        break;
      }
      const write = await restoreSingleV4Domain(
        validated.ownerUid,
        spec,
        validated[spec.key],
        expectedToken
      );
      if (!write.ok) {
        failedSpec = spec;
        domainFailure = write;
        break;
      }
      committedV4.push({ spec, ...write });
    }
    if (domainFailure === null) {
      reloadUsageStateAfterRestore(validated.ownerUid);
      return {
        ok: true,
        state: initial.state,
        followerRestored: true,
        friendNotesRestored: true,
        v4DomainsRestored: true,
      };
    }
    const v4FailureKind =
      domainFailure.failureKind || domainFailure.reason || "UNKNOWN_FAILURE";
    if (domainFailure.outcomeUnknown === true) {
      return {
        ...restoreStateUncertain(null),
        v4Domain: failedSpec ? failedSpec.key : null,
        v4FailureKind,
      };
    }

    const rollbackResults = [];
    for (let index = committedV4.length - 1; index >= 0; index -= 1) {
      rollbackResults.push(
        await rollbackSingleV4Domain(validated.ownerUid, committedV4[index])
      );
    }
    rollbackResults.push(
      await rollbackFriendNotesRestore(
        validated.ownerUid,
        validated.friendNotesSerialized,
        expectedFriendNotesRaw
      )
    );
    rollbackResults.push(
      await rollbackFollowerRestore(
        validated.ownerUid,
        validated.followerStateSerialized,
        expectedFollowerRaw
      )
    );
    const radarRollback = await rollbackFriendRadarRestore(
      validated.ownerUid,
      initial.restoredRaw,
      initial.preRestoreRaw
    );
    const allRolledBack =
      rollbackResults.every((entry) => entry.reason === "ROLLED_BACK") &&
      radarRollback.reason === "FOLLOWER_RESTORE_FAILED_ROLLED_BACK";
    const anyUncertain =
      rollbackResults.some(
        (entry) => entry.reason === "RESTORE_STATE_UNCERTAIN"
      ) || radarRollback.reason === "RESTORE_STATE_UNCERTAIN";
    let reason = "V4_DOMAIN_RESTORE_FAILED_PARTIAL";
    if (allRolledBack) reason = "V4_DOMAIN_RESTORE_FAILED_ROLLED_BACK";
    else if (anyUncertain) reason = "RESTORE_STATE_UNCERTAIN";
    return {
      ok: false,
      failureKind: "BACKUP_RESTORE_ERROR",
      reason,
      rollbackSucceeded: allRolledBack,
      v4Domain: failedSpec ? failedSpec.key : null,
      v4FailureKind,
    };
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
    expectedFriendNotesRaw,
    expectedV4Tokens
  ) {
    const notesWrite = await restoreFriendNotesFromBackup(
      validated.ownerUid,
      validated.friendNotesSerialized,
      expectedFriendNotesRaw
    );
    if (notesWrite.ok) {
      if (!validated.v4DomainsCovered) {
        return {
          ok: true,
          state: initial.state,
          followerRestored: true,
          friendNotesRestored: true,
          v4DomainsRestored: false,
        };
      }
      return await finishV4DomainsRestore(
        validated,
        initial,
        expectedFollowerRaw,
        expectedFriendNotesRaw,
        expectedV4Tokens
      );
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
    expectedFriendNotesRaw,
    expectedV4Tokens = null
  ) {
    const currentUid = determineCurrentUid();
    if (!currentUid.ok || currentUid.uid !== validated.ownerUid) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "OWNER_UID_MISMATCH",
      };
    }

    if (validated.v4DomainsCovered && !isPlainObject(expectedV4Tokens)) {
      return {
        ok: false,
        failureKind: "BACKUP_RESTORE_ERROR",
        reason: "V4_PREVIEW_TOKENS_MISSING",
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
    // bytes are read again inside the lock and the restore is refused unless
    // they are exactly the previewed ones. Bytes, not a parsed state: a damaged
    // value the preview said would be replaced must still match.
    const initial = await withFriendRadarStateLock(
      validated.ownerUid,
      async () => {
        const fresh = currentFriendRadarRestoreToken(validated.ownerUid);
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
        v4DomainsRestored: false,
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
          v4DomainsRestored: false,
        };
      }
      // The follower lock is released before the notes lock is taken: no two
      // module locks are ever held at the same time.
      return await finishFriendNotesRestore(
        validated,
        initial,
        expectedFollowerRaw,
        expectedFriendNotesRaw,
        expectedV4Tokens
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
    return anyRelationshipTaskBusy();
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
    friendNotesPreview,
    expectedV4Tokens = null
  ) {
    const body = showPanel("恢复备份", true);
    body.append(
      createElement(
        "p",
        validated.v4DomainsCovered
          ? "恢复后，当前账号的关系雷达数据、粉丝快照、粉丝变化记录、友人档案及移除记录/筛选方案/使用统计/主页访问记录将被此备份完整替换。"
          : validated.followerCovered
            ? "恢复后，当前账号的关系雷达数据、粉丝快照和粉丝变化记录将被此备份完整替换。"
            : "恢复后，当前账号的关系雷达数据将被此备份完整替换；此备份不包含粉丝快照和粉丝变化记录，它们将保持不变。",
        "wfr-error"
      )
    );
    if (!currentLoaded.ok) {
      body.append(
        createElement(
          "p",
          "当前的关系雷达本地数据无法读取：可能已损坏，也可能由更新版本的脚本写入。确认后它将被备份内容替换，且无法先行导出。",
          "wfr-error"
        )
      );
    }
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
    addLine(
      body,
      "当前事件数",
      currentLoaded.ok
        ? currentLoaded.state.events.length
        : "无法读取（将被备份内容替换）"
    );
    addLine(body, "备份事件数", validated.state.events.length);
    addLine(
      body,
      "当前快照记录数",
      currentLoaded.ok
        ? snapshotRecordCount(currentLoaded.state)
        : "无法读取（将被备份内容替换）"
    );
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
    if (validated.v4DomainsCovered) {
      addLine(
        body,
        "备份粉丝移除记录数",
        validated.followerRemovalLog === null
          ? "无移除记录"
          : validated.followerRemovalLog.entries.length
      );
      addLine(
        body,
        "备份粉丝筛选方案数",
        validated.followerHygienePresets === null
          ? "无筛选方案"
          : validated.followerHygienePresets.presets.length
      );
      addLine(
        body,
        "备份使用统计",
        validated.usageState === null
          ? "无使用统计"
          : `已包含（最近日期 ${validated.usageState.currentDay.date}）`
      );
      addLine(
        body,
        "备份主页访问记录数",
        validated.profileVisits === null
          ? "无主页访问记录"
          : Object.keys(validated.profileVisits).length
      );
    } else {
      body.append(
        createElement(
          "p",
          "此备份不包含粉丝移除记录、筛选方案、使用统计和主页访问记录，这些本地数据将保持不变。",
          "wfr-muted"
        )
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
    exportButton.disabled = !currentLoaded.ok;
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
      // The outcome of a restore must be seen, and showing it replaces the
      // panel. So the preview stays put until the transaction has ended: the
      // user cannot leave it, open something else and have that replaced.
      setPanelExitLocked(true);
      let restored;
      try {
        restored = await restoreValidatedBackup(
          validated,
          currentLoaded.raw,
          expectedFollowerRaw,
          friendNotesPreview.expectedRaw,
          expectedV4Tokens
        );
      } catch (error) {
        restored = {
          ok: false,
          failureKind: "BACKUP_RESTORE_ERROR",
          reason: "RESTORE_STATE_UNCERTAIN",
          errorName: error && error.name ? String(error.name) : "Error",
        };
      } finally {
        setPanelExitLocked(false);
      }
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
      addLine(
        success,
        "移除记录、筛选方案、使用统计与主页访问记录",
        restored.v4DomainsRestored ? "已一并恢复" : "未包含在此备份中，保持不变"
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
    let currentLoaded = loadState(uidResult.uid);
    if (!currentLoaded.ok) {
      // A damaged value does not block the restore that would replace it, as
      // long as its exact bytes can be read: they become the expected value the
      // user reviews and the write is checked against.
      const token = currentFriendRadarRestoreToken(uidResult.uid);
      if (!token.ok || token.raw === null) {
        showFailure("恢复备份", currentLoaded);
        return;
      }
      currentLoaded = { ok: false, raw: token.raw };
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
      announceCancelWithoutReplacingPanel("恢复已取消。");
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
    let expectedV4Tokens = null;
    if (validated.v4DomainsCovered) {
      const v4Preview = readV4RestorePreviewTokens(uidResult.uid);
      if (!v4Preview.ok) {
        showFailure("恢复备份", v4Preview);
        return;
      }
      expectedV4Tokens = v4Preview.tokens;
    }
    showRestorePreview(
      validated,
      currentLoaded,
      expectedFollowerRaw,
      {
        expectedRaw: friendNotesToken.ok ? friendNotesToken.raw : null,
        current: friendNotesToken.ok
          ? friendNotesStateFromRaw(friendNotesToken.raw, uidResult.uid)
          : friendNotesToken,
      },
      expectedV4Tokens
    );
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

  function announceCancelWithoutReplacingPanel(text) {
    setLauncherStatus(text, AUTO_STATUS_DURATION_MS);
    if (
      panelExitLocked ||
      !panelRoot ||
      typeof panelRoot.querySelector !== "function"
    ) {
      return;
    }
    const body = panelRoot.querySelector(".wfr-body");
    if (!body) return;
    const existing = panelRoot.querySelector(".wfr-inline-cancel-status");
    if (existing) {
      existing.textContent = text;
      return;
    }
    const note = createElement("p", text, "wfr-muted wfr-inline-cancel-status");
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    if (body.childNodes.length > 0) body.insertBefore(note, body.childNodes[0]);
    else body.append(note);
  }

  async function saveBackup(json, filename) {
    const pickerWindow = resolveSaveFilePickerWindow();
    if (pickerWindow !== null) {
      let fileHandle;
      try {
        fileHandle = await pickerWindow.showSaveFilePicker.call(pickerWindow, {
          suggestedName: filename,
          types: [
            {
              description: "JSON backup",
              accept: { "application/json": [".json"] },
            },
          ],
        });
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
        await abortWritableStreamQuietly(writable);
        throw backupExportError("WRITE_FILE", error);
      }
      try {
        await writable.close();
      } catch (error) {
        await abortWritableStreamQuietly(writable);
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
    const removalLogLoaded = loadFollowerRemovalLogForBackup(uidResult.uid);
    if (!removalLogLoaded.ok) {
      showFailure("导出备份", removalLogLoaded);
      return;
    }
    const presetsLoaded = loadFollowerHygienePresetsForBackup(uidResult.uid);
    if (!presetsLoaded.ok) {
      showFailure("导出备份", presetsLoaded);
      return;
    }
    const usageLoaded = loadUsageStateForBackup(uidResult.uid);
    if (!usageLoaded.ok) {
      showFailure("导出备份", usageLoaded);
      return;
    }
    const profileVisitsLoaded = loadProfileVisitsForBackup(uidResult.uid);
    if (!profileVisitsLoaded.ok) {
      showFailure("导出备份", profileVisitsLoaded);
      return;
    }
    const v4DomainsForBackup = {
      followerRemovalLog: removalLogLoaded.state,
      followerHygienePresets: presetsLoaded.state,
      usageState: usageLoaded.state,
      profileVisits: profileVisitsLoaded.visits,
    };

    const exportedAt = new Date();
    const filename = backupFilename(uidResult.uid, exportedAt);
    let saveResult;
    try {
      const backup = createBackup(
        uidResult.uid,
        loaded.state,
        followerStateForBackup,
        exportedAt,
        friendNotesForBackup,
        v4DomainsForBackup
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
      announceCancelWithoutReplacingPanel("导出已取消。");
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
    addLine(
      body,
      "粉丝移除记录数",
      v4DomainsForBackup.followerRemovalLog === null
        ? "无移除记录"
        : v4DomainsForBackup.followerRemovalLog.entries.length
    );
    addLine(
      body,
      "粉丝筛选方案数",
      v4DomainsForBackup.followerHygienePresets === null
        ? "无筛选方案"
        : v4DomainsForBackup.followerHygienePresets.presets.length
    );
    addLine(
      body,
      "使用统计",
      v4DomainsForBackup.usageState === null
        ? "无使用统计"
        : `已包含（最近日期 ${v4DomainsForBackup.usageState.currentDay.date}）`
    );
    addLine(
      body,
      "主页访问记录数",
      v4DomainsForBackup.profileVisits === null
        ? "无主页访问记录"
        : Object.keys(v4DomainsForBackup.profileVisits).length
    );
    addLine(body, nativeSave ? "文件名" : "建议文件名", saveResult.filename);
  }

  function deliverTableExport({
    panelTitle = "已请求浏览器下载导出文件",
    failureTitle,
    successText,
    formatLabel,
    filename,
    mimeType,
    content,
    countLabel,
    count,
    onBack,
  }) {
    try {
      downloadFile(content, filename, mimeType);
    } catch (error) {
      showFailure(
        failureTitle || panelTitle,
        {
          failureKind: "EVENT_EXPORT_ERROR",
          exportStage:
            error && error.backupStage ? String(error.backupStage) : "PREPARE_EXPORT",
          errorName: error && error.name ? String(error.name) : "Error",
        },
        onBack
      );
      return false;
    }

    const body = showPanel(panelTitle, onBack);
    body.append(createElement("p", successText, "wfr-success"));
    addLine(body, "格式", formatLabel);
    addLine(body, "建议文件名", filename);
    addLine(body, countLabel, count);
    return true;
  }

  // Read-only: builds a document from the already loaded state and hands it to the
  // browser download path. Friend Radar storage is never touched.
  function exportEvents(ownerUid, state, format) {
    const spec = EVENT_EXPORT_FORMATS[format];
    const exportedAt = new Date();
    const filename = eventExportFilename(ownerUid, exportedAt, spec.extension);
    const backToEvents = () => renderEvents(ownerUid, state, null);
    deliverTableExport({
      panelTitle: "已请求浏览器下载事件",
      failureTitle: "导出事件",
      successText:
        "事件文件已交给浏览器下载，保存位置及最终文件名由浏览器下载设置决定。",
      formatLabel: spec.label,
      filename,
      mimeType: spec.mimeType,
      content: spec.build(ownerUid, state.events, exportedAt),
      countLabel: "已导出事件数",
      count: state.events.length,
      onBack: backToEvents,
    });
  }
