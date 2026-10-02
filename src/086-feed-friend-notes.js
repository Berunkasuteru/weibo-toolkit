
  // Friend Notes in the feed: a small entry beside the outer author of a Home or
  // Latest card, and one card-sized popover that reuses the Friend Notes editor.
  // Nothing new is stored: the entry state is derived from the existing notes
  // and relationship states, and the page's own nickname is only ever compared
  // with them, never recorded.
  const SHOW_FEED_FRIEND_NOTES_KEY =
    "weiboToolkit.page.showFeedFriendNotes.v1";
  const FEED_FRIEND_NOTE_CARD_ID = "wfr-feed-note-card";
  const FEED_FRIEND_NOTE_HAS_CLASS = "wfr-feed-note-has";

  // { ownerUid, data, entries: Map<card node, entry>, stale }. data is null when
  // the notes cannot be read, in which case no entry is shown at all.
  let feedFriendNotes = null;
  // { ownerUid, subjectUid, editor, root, notice, entry, onKeydown, ... }
  let feedFriendNoteCard = null;

  function feedFriendNotesActiveForRoute() {
    return Boolean(
      pageCleanupPreferences.showFeedFriendNotes && isPageEnhancementFeedRoute()
    );
  }

  function feedLinkPath(link) {
    const attribute =
      typeof link.getAttribute === "function" ? link.getAttribute("href") : null;
    const href =
      typeof attribute === "string" && attribute !== "" ? attribute : link.href;
    if (typeof href !== "string" || href === "") return null;
    try {
      const url = new URL(href, WEIBO_MAIN_ORIGIN);
      return url.origin === WEIBO_MAIN_ORIGIN ? url.pathname : null;
    } catch (_) {
      return null;
    }
  }

  // Who wrote the outer post of this card, or null when the page does not prove
  // it. Only links inside the resolved outer header are evidence, so a reposted
  // author, a mention in the body and a commenter can never be candidates.
  //
  // The post's own permalink, /<UID>/<post id>, is required: it names the author
  // of exactly this post. Every /u/<UID> profile link in the same header must
  // agree with it, and all permalinks must agree with each other; any
  // disagreement skips the card. The post id segment is never read as a UID,
  // nicknames are never matched, and a custom-domain profile link is simply not
  // evidence.
  //
  // pageName is the header's own text for a /u/<UID> link of that author, used
  // for display and comparison only; it is null when absent or ambiguous.
  function resolveFeedAuthorIdentity(card) {
    const header = resolvePageFeedPromotionHeader(card);
    if (!header || typeof header.querySelectorAll !== "function") return null;
    let uid = null;
    let anchor = null;
    const profileLinks = [];
    for (const link of header.querySelectorAll("a")) {
      const path = feedLinkPath(link);
      if (path === null) continue;
      const profile = /^\/u\/([1-9]\d*)\/?$/.exec(path);
      if (profile) {
        profileLinks.push({ uid: profile[1], link });
        continue;
      }
      const post = /^\/([1-9]\d*)\/[A-Za-z0-9]+\/?$/.exec(path);
      if (!post) continue;
      if (uid !== null && uid !== post[1]) return null;
      if (uid === null) {
        uid = post[1];
        anchor = link;
      }
    }
    if (uid === null || normalizeStableUid(uid) !== uid || !anchor.parentNode) {
      return null;
    }
    if (profileLinks.some((candidate) => candidate.uid !== uid)) return null;
    const names = new Set();
    for (const candidate of profileLinks) {
      const text = normalizeLatestRecommendedBadgeText(
        candidate.link.textContent
      );
      if (text !== "") names.add(text);
    }
    // A pure repost can render its author as a usercard span rather than a
    // profile link. This identifies the display node only: the permalink and
    // matching numeric profile links above still establish the author UID.
    const nameSpans = Array.from(header.querySelectorAll("span")).filter(
      (span) => {
        const text = normalizeLatestRecommendedBadgeText(span.textContent);
        return (
          text !== "" &&
          span.getAttribute("title") === text &&
          span.getAttribute("usercard") === `name=@${text}`
        );
      }
    );
    const nameSpan = nameSpans.length === 1 ? nameSpans[0] : null;
    return {
      uid,
      anchor,
      // Several links can name the same verified author with different text
      // (for example the nickname and a repost label). That makes pageName
      // ambiguous, but does not invalidate the first text-bearing author link
      // as an insertion point. UID conflicts were already rejected above.
      entryAnchor:
        (nameSpan &&
          (nearestAncestorTagBefore(nameSpan, header, "A") || nameSpan)) ||
        profileLinks.find(
          (candidate) =>
            normalizeLatestRecommendedBadgeText(candidate.link.textContent) !== ""
        )?.link || anchor,
      header,
      pageName: nameSpan
        ? normalizeLatestRecommendedBadgeText(nameSpan.textContent)
        : names.size === 1 ? [...names][0] : null,
    };
  }

  // Names Toolkit has actually recorded for this UID that differ from the name
  // the page shows now, most recently recorded first. A difference is only a
  // difference: it is never reported as a confirmed rename, and the page name
  // is never added to the evidence.
  function feedRecordedOtherNames(pageName, facts) {
    if (typeof pageName !== "string" || pageName === "") return [];
    const recorded = [];
    if (facts.currentName !== null) recorded.push(facts.currentName);
    recorded.push(...[...facts.historicalNames].reverse());
    return recorded.filter(
      (name, index) => name !== pageName && recorded.indexOf(name) === index
    );
  }

  function feedNicknameHintText(pageName, facts) {
    const names = feedRecordedOtherNames(pageName, facts);
    if (names.length === 0) return "";
    return names.length === 1
      ? `本地曾记录为：${names[0]}`
      : `本地曾记录为：${names[0]} 等 ${names.length} 个`;
  }

  // One read of each state per activation, shared by every card. The verified
  // notes map and the per-UID derived facts are reused until the data is
  // reloaded as a whole.
  function loadFeedFriendNotesData(ownerUid) {
    const notes = loadFriendNotesState(ownerUid);
    if (!notes.ok) return null;
    const friend = loadState(ownerUid);
    const follower = loadFollowerState(ownerUid);
    return {
      notes: notes.state.notes,
      friendState: friend.ok ? friend.state : null,
      followerState: follower.ok ? follower.state : null,
      factsByUid: new Map(),
    };
  }

  function feedFriendNoteFacts(uid) {
    const data = feedFriendNotes.data;
    if (!data.factsByUid.has(uid)) {
      data.factsByUid.set(
        uid,
        deriveProfileLocalFacts(uid, data.friendState, data.followerState)
      );
    }
    return data.factsByUid.get(uid);
  }

  function reloadFeedFriendNotesData() {
    const runtime = feedFriendNotes;
    if (runtime === null) return;
    runtime.data = loadFeedFriendNotesData(runtime.ownerUid);
    runtime.stale = false;
    if (runtime.data === null) {
      clearFeedFriendNoteEntries();
      return;
    }
    for (const entry of runtime.entries.values()) {
      renderFeedFriendNoteEntry(entry, entry.pageName);
    }
    flushFeedFriendNoteFits();
  }

  // Relationship data can change while the Toolkit panel is open or when an
  // automatic update finishes. The cache is only flagged here and re-read by
  // the next reconcile, once no panel is open.
  function markFeedFriendNotesStale() {
    if (feedFriendNotes === null) return;
    feedFriendNotes.stale = true;
    schedulePageFeedReconcile();
  }

  // Decides whether the feed entries are active for this reconcile and keeps the
  // runtime in step with the option, the route and the logged-in owner.
  function syncFeedFriendNotes() {
    if (!feedFriendNotesActiveForRoute()) {
      teardownFeedFriendNotes();
      return false;
    }
    const owner = determineCurrentUid();
    if (!owner.ok) {
      teardownFeedFriendNotes();
      return false;
    }
    if (feedFriendNotes !== null && feedFriendNotes.ownerUid !== owner.uid) {
      teardownFeedFriendNotes();
    }
    if (feedFriendNotes === null) {
      feedFriendNotes = {
        ownerUid: owner.uid,
        data: loadFeedFriendNotesData(owner.uid),
        entries: new Map(),
        pendingFit: new Set(),
        stale: false,
      };
      if (
        typeof window !== "undefined" &&
        typeof window.addEventListener === "function"
      ) {
        window.addEventListener("resize", refitFeedFriendNoteEntries);
      }
    } else if (feedFriendNotes.stale && panelRoot === null) {
      reloadFeedFriendNotesData();
    }
    return feedFriendNotes.data !== null;
  }

  // Writes only when what should be shown has changed, so reconciling an
  // unchanged card touches nothing.
  function renderFeedFriendNoteEntry(entry, pageName) {
    const data = feedFriendNotes.data;
    const hasNote = hasOwn(data.notes, entry.uid);
    const hint = feedNicknameHintText(pageName, feedFriendNoteFacts(entry.uid));
    const signature = JSON.stringify([hasNote, pageName, hint]);
    entry.pageName = pageName;
    if (entry.signature === signature) return;
    entry.signature = signature;
    const who = pageName === null ? "这位作者" : pageName;
    entry.hasNote = hasNote;
    entry.button.textContent = feedFriendNoteEntryText(entry);
    setToolkitClass(entry.button, FEED_FRIEND_NOTE_HAS_CLASS, hasNote);
    entry.button.setAttribute(
      "aria-label",
      hasNote
        ? `友人档案：已为${who}写过备注，打开查看${hint === "" ? "" : `；${hint}`}`
        : `友人档案：为${who}写备注${hint === "" ? "" : `；${hint}`}`
    );
    entry.button.setAttribute(
      "title",
      hasNote ? "查看友人档案" : "为这位作者写备注"
    );
    entry.hintText = hint;
    entry.hint.textContent = hint;
    entry.hint.hidden = hint === "";
    feedFriendNotes.pendingFit.add(entry);
  }

  // How much of the entry fits. room is the width left in the post header
  // after everything before the entry and after Weibo's own content that
  // follows it in the same row, so Toolkit's addition neither runs past the
  // header nor pushes native text out. The hint gives way first; if even the
  // button does not fit, it shrinks to a single character. Whatever is not
  // shown inline stays in the entry's spoken label and in the card.
  function feedEntryLayout(room, buttonWidth, hasHint) {
    const compact = room < buttonWidth;
    const hintRoom = Math.floor(room - buttonWidth - 6);
    return {
      compact,
      hintWidth:
        !hasHint || compact || hintRoom < 48 ? 0 : Math.min(hintRoom, 216),
    };
  }

  function feedFriendNoteEntryText(entry) {
    if (entry.compact) return entry.hasNote ? "备" : "写";
    return entry.hasNote ? "有备注" : "写备注";
  }

  // Entries are measured only after their content changed or the window was
  // resized, never on an unchanged pass, and all pending measurements are read
  // before any of them is applied.
  function flushFeedFriendNoteFits() {
    const runtime = feedFriendNotes;
    if (runtime === null || runtime.pendingFit.size === 0) return;
    const pending = [...runtime.pendingFit].filter((entry) => entry.active);
    runtime.pendingFit.clear();
    const layouts = pending.map((entry) => {
      const header = entry.header;
      const parent = entry.wrapper.parentNode;
      if (
        !header ||
        !parent ||
        typeof header.getBoundingClientRect !== "function" ||
        typeof entry.wrapper.getBoundingClientRect !== "function"
      ) {
        return null;
      }
      const bounds = header.getBoundingClientRect();
      if (!(bounds.width > 0)) return null;
      const own = entry.wrapper.getBoundingClientRect();
      const siblings = elementChildren(parent);
      const last = siblings[siblings.length - 1];
      const trailing =
        last && last !== entry.wrapper
          ? Math.max(0, last.getBoundingClientRect().right - own.right)
          : 0;
      if (!entry.compact) {
        entry.fullButtonWidth = entry.button.getBoundingClientRect().width;
      }
      return feedEntryLayout(
        bounds.right - own.left - trailing,
        entry.fullButtonWidth,
        entry.hintText !== ""
      );
    });
    pending.forEach((entry, index) => {
      const layout = layouts[index];
      if (layout === null) return;
      if (entry.compact !== layout.compact) {
        entry.compact = layout.compact;
        entry.button.textContent = feedFriendNoteEntryText(entry);
      }
      const hidden = layout.hintWidth === 0;
      const maxWidth = hidden ? "" : `${layout.hintWidth}px`;
      if (entry.hint.hidden !== hidden) entry.hint.hidden = hidden;
      if (entry.hint.style.maxWidth !== maxWidth) {
        entry.hint.style.maxWidth = maxWidth;
      }
    });
  }

  function refitFeedFriendNoteEntries() {
    const runtime = feedFriendNotes;
    if (runtime === null) return;
    for (const entry of runtime.entries.values()) runtime.pendingFit.add(entry);
    flushFeedFriendNoteFits();
  }
  // An entry belongs to one owner and one author for its whole life. When a
  // recycled node starts showing another author, the old entry is removed and
  // marked inactive, and a new one is created; nothing is ever re-pointed.
  function createFeedFriendNoteEntry(ownerUid, uid, card) {
    const wrapper = createElement("span", null, "wfr-feed-note wfr-root");
    applyThemeToRoot(wrapper);
    const button = createFriendNoteButton("", "wfr-feed-note-entry");
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    const hint = createElement("span", "", "wfr-feed-note-hint");
    hint.hidden = true;
    wrapper.append(button, hint);
    const entry = {
      ownerUid,
      uid,
      card,
      header: null,
      wrapper,
      button,
      hint,
      hintText: "",
      rowText: null,
      hasNote: false,
      compact: false,
      fullButtonWidth: 0,
      pageName: null,
      signature: null,
      active: true,
    };
    button.addEventListener("click", (event) => {
      // The header itself may be a link target; the entry is not part of it.
      if (event && typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (event && typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      // The node may already show another post while the batched pass that
      // would re-bind it has not run yet. Nothing is opened on the strength of
      // what the entry used to mean: the page is brought up to date instead.
      if (!feedFriendNoteEntryIsCurrent(entry)) {
        installLatestFeedRecommendationFilter();
        return;
      }
      toggleFeedFriendNoteCard(entry);
    });
    return entry;
  }

  // Decided at the moment of the click, from the page as it is now: the entry
  // must still be the one registered for its node, that node must still be in
  // the live feed root, the option, route and owner must still hold, and the
  // node's own header must still prove the same author UID.
  function feedFriendNoteEntryIsCurrent(entry) {
    const runtime = feedFriendNotes;
    if (
      runtime === null ||
      runtime.data === null ||
      !entry.active ||
      runtime.entries.get(entry.card) !== entry ||
      runtime.ownerUid !== entry.ownerUid ||
      !feedFriendNotesActiveForRoute()
    ) {
      return false;
    }
    const owner = determineCurrentUid();
    if (!owner.ok || owner.uid !== entry.ownerUid) return false;
    const root = latestRecommendedRoot;
    if (
      !root ||
      findLatestFeedRoot() !== root ||
      !root.contains(entry.card) ||
      !entry.card.contains(entry.wrapper) ||
      hasClass(entry.card, LATEST_RECOMMENDED_HIDDEN_CLASS)
    ) {
      return false;
    }
    const identity = resolveFeedAuthorIdentity(entry.card);
    return identity !== null && identity.uid === entry.uid;
  }

  function removeFeedFriendNoteEntry(card, entry) {
    entry.active = false;
    if (entry.wrapper.parentNode) {
      entry.wrapper.parentNode.removeChild(entry.wrapper);
    }
    if (feedFriendNotes !== null) feedFriendNotes.entries.delete(card);
    releaseFeedFriendNoteCardEntry(entry);
  }

  function reconcileFeedFriendNoteCard(card) {
    const runtime = feedFriendNotes;
    let entry = runtime.entries.get(card) || null;
    const identity = hasClass(card, LATEST_RECOMMENDED_HIDDEN_CLASS)
      ? null
      : resolveFeedAuthorIdentity(card);
    if (identity === null || identity.uid === runtime.ownerUid) {
      if (entry !== null) removeFeedFriendNoteEntry(card, entry);
      return;
    }
    if (entry !== null && entry.uid !== identity.uid) {
      removeFeedFriendNoteEntry(card, entry);
      entry = null;
    }
    if (entry === null) {
      entry = createFeedFriendNoteEntry(runtime.ownerUid, identity.uid, card);
      runtime.entries.set(card, entry);
    }
    entry.header = identity.header;
    // A small entry belongs beside the verified author name. When the header
    // has no unambiguous name link, the post permalink remains the fallback.
    // Both are insertion points only; the permalink still proves the UID.
    const anchor = identity.entryAnchor;
    const parent = anchor.parentNode;
    let remeasure = false;
    if (
      entry.wrapper.parentNode !== parent ||
      anchor.nextSibling !== entry.wrapper
    ) {
      const next = anchor.nextSibling;
      if (next) parent.insertBefore(entry.wrapper, next);
      else parent.append(entry.wrapper);
      remeasure = true;
    }
    // The room left for the entry depends on Weibo's own content in the same
    // row (time, source). When that text changes, or the entry was mounted
    // somewhere else, the entry is queued for one new measurement. Toolkit's
    // own node is left out of the comparison, so its text and style changes
    // can never queue it again.
    const rowText = feedFriendNoteRowText(parent, entry.wrapper);
    if (entry.rowText !== rowText) {
      entry.rowText = rowText;
      remeasure = true;
    }
    if (remeasure) runtime.pendingFit.add(entry);
    renderFeedFriendNoteEntry(entry, identity.pageName);
  }

  // Reads text only; no layout is measured here.
  function feedFriendNoteRowText(row, wrapper) {
    let text = "";
    for (const node of Array.from(row.childNodes)) {
      if (node !== wrapper) text += `${node.textContent}\u0000`;
    }
    return text;
  }

  function pruneFeedFriendNoteEntries(root) {
    for (const [card, entry] of [...feedFriendNotes.entries]) {
      if (!root.contains(card)) removeFeedFriendNoteEntry(card, entry);
    }
    flushFeedFriendNoteFits();
  }

  function clearFeedFriendNoteEntries() {
    if (feedFriendNotes === null) return;
    for (const [card, entry] of [...feedFriendNotes.entries]) {
      removeFeedFriendNoteEntry(card, entry);
    }
  }

  // Leaving the feed, turning the option off or losing the owner removes every
  // Toolkit node, the open card and its listeners.
  function teardownFeedFriendNotes() {
    clearFeedFriendNoteEntries();
    closeFeedFriendNoteCard(false);
    if (
      feedFriendNotes !== null &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("resize", refitFeedFriendNoteEntries);
    }
    feedFriendNotes = null;
  }

  function applyFeedFriendNotesTheme() {
    if (feedFriendNotes !== null) {
      for (const entry of feedFriendNotes.entries.values()) {
        applyThemeToRoot(entry.wrapper);
      }
    }
    if (feedFriendNoteCard !== null) applyThemeToRoot(feedFriendNoteCard.root);
  }

  // The same-tab save hook: the saved record itself is the new state, so the
  // cache and the entries of that author are updated without reading storage.
  function applyFeedFriendNoteSaved(ownerUid, subjectUid, record) {
    const runtime = feedFriendNotes;
    if (
      runtime === null ||
      runtime.data === null ||
      runtime.ownerUid !== ownerUid
    ) {
      return;
    }
    const notes = { ...runtime.data.notes };
    if (record === null) delete notes[subjectUid];
    else notes[subjectUid] = record;
    runtime.data.notes = notes;
    for (const entry of runtime.entries.values()) {
      if (entry.uid === subjectUid) {
        renderFeedFriendNoteEntry(entry, entry.pageName);
      }
    }
    flushFeedFriendNoteFits();
  }

  function setFeedFriendNoteCardNotice(card, text) {
    card.notice.textContent = text;
  }

  const FEED_FRIEND_NOTE_CARD_MARGIN = 12;
  const FEED_FRIEND_NOTE_CARD_DOCKED_CLASS = "wfr-feed-note-card-docked";

  // Where an anchored card goes, in viewport coordinates. Below the entry if it
  // fits, otherwise above it if that fits. Whatever was chosen is then clamped
  // into the viewport, which is also the answer when neither side has room (the
  // card may cover the entry) and while the entry is scrolled out of view. The
  // card is never taller than the usable viewport (its body scrolls instead),
  // so the clamp can always be satisfied.
  function feedFriendNoteCardMaxHeight(viewportHeight) {
    return Math.max(
      120,
      Math.min(560, viewportHeight - FEED_FRIEND_NOTE_CARD_MARGIN * 2)
    );
  }

  function computeFeedFriendNoteCardPlacement(anchor, size, viewport) {
    const margin = FEED_FRIEND_NOTE_CARD_MARGIN;
    const gap = 6;
    const maxHeight = feedFriendNoteCardMaxHeight(viewport.height);
    const height = Math.min(size.height, maxHeight);
    const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
    const lowest = Math.max(margin, viewport.height - margin - height);
    const below = anchor.bottom + gap;
    const above = anchor.top - gap - height;
    const fitsBelow = below + height <= viewport.height - margin;
    const top = !fitsBelow && above >= margin ? above : below;
    return {
      maxHeight,
      left: Math.max(
        margin,
        Math.min(anchor.left, viewport.width - width - margin)
      ),
      top: Math.max(margin, Math.min(top, lowest)),
    };
  }

  function setFeedFriendNoteCardStyle(root, property, value) {
    if (root.style[property] !== value) root.style[property] = value;
  }

  // Runs when the card opens and whenever its size, the window or the scroll
  // position changes; all of those listeners exist only while a card is open.
  // An anchored card follows its entry. A card that has lost its entry is
  // docked to the viewport instead, so its controls can never scroll away.
  function positionFeedFriendNoteCard() {
    const card = feedFriendNoteCard;
    if (card === null || typeof window === "undefined") return;
    const viewport = {
      width: Number(window.innerWidth) || 0,
      height: Number(window.innerHeight) || 0,
    };
    if (!(viewport.width > 0) || !(viewport.height > 0)) return;
    const docked = card.entry === null;
    setToolkitClass(card.root, FEED_FRIEND_NOTE_CARD_DOCKED_CLASS, docked);
    if (
      docked ||
      typeof card.entry.button.getBoundingClientRect !== "function" ||
      typeof card.root.getBoundingClientRect !== "function"
    ) {
      setFeedFriendNoteCardStyle(
        card.root,
        "maxHeight",
        `${feedFriendNoteCardMaxHeight(viewport.height)}px`
      );
      setFeedFriendNoteCardStyle(card.root, "left", "");
      setFeedFriendNoteCardStyle(card.root, "top", "");
      return;
    }
    const placement = computeFeedFriendNoteCardPlacement(
      card.entry.button.getBoundingClientRect(),
      card.root.getBoundingClientRect(),
      viewport
    );
    setFeedFriendNoteCardStyle(
      card.root,
      "maxHeight",
      `${placement.maxHeight}px`
    );
    setFeedFriendNoteCardStyle(
      card.root,
      "left",
      `${Math.round(placement.left + (Number(window.scrollX) || 0))}px`
    );
    setFeedFriendNoteCardStyle(
      card.root,
      "top",
      `${Math.round(placement.top + (Number(window.scrollY) || 0))}px`
    );
  }

  // Called when the entry a card was opened from stops representing its author
  // (the node was recycled, removed, or the feed root was replaced). A card with
  // nothing unsaved is closed. A card holding typed input is kept and docked to
  // the viewport, clearly labelled, because it is bound to the owner and
  // subject UID it was opened for, not to the node.
  function releaseFeedFriendNoteCardEntry(entry) {
    const card = feedFriendNoteCard;
    if (card === null || card.entry !== entry) return;
    if (!card.editor.hasUnsavedChanges()) {
      closeFeedFriendNoteCard(false);
      return;
    }
    card.entry = null;
    setFeedFriendNoteCardNotice(
      card,
      `原微博已不在页面上。此卡片仍属于 UID ${card.subjectUid}，你的输入已保留，卡片已停靠在窗口左下角。`
    );
    positionFeedFriendNoteCard();
  }

  function closeFeedFriendNoteCard(restoreFocus) {
    const card = feedFriendNoteCard;
    if (card === null) return;
    feedFriendNoteCard = null;
    if (typeof document.removeEventListener === "function") {
      document.removeEventListener("keydown", card.onKeydown);
      document.removeEventListener("click", card.onDocumentClick, true);
    }
    if (
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("scroll", positionFeedFriendNoteCard, true);
      window.removeEventListener("resize", positionFeedFriendNoteCard);
    }
    if (card.resizeObserver) card.resizeObserver.disconnect();
    if (card.root.parentNode) card.root.parentNode.removeChild(card.root);
    const entry = card.entry;
    if (entry === null) return;
    entry.button.setAttribute("aria-expanded", "false");
    // Focus returns only to an entry that still exists and still stands for the
    // author this card was about.
    if (
      restoreFocus &&
      entry.active &&
      entry.uid === card.subjectUid &&
      entry.wrapper.parentNode &&
      entry.button.isConnected !== false
    ) {
      focusFriendNoteControl(entry.button);
    }
  }

  // A close the user asked for never discards typed input.
  function requestCloseFeedFriendNoteCard(restoreFocus) {
    const card = feedFriendNoteCard;
    if (card === null) return true;
    if (card.editor.hasUnsavedChanges()) {
      setFeedFriendNoteCardNotice(
        card,
        "有尚未保存的输入。请先保存或取消，再关闭卡片。"
      );
      focusFriendNoteControl(card.root);
      return false;
    }
    closeFeedFriendNoteCard(restoreFocus);
    return true;
  }

  function toggleFeedFriendNoteCard(entry) {
    const current = feedFriendNoteCard;
    if (current !== null && current.entry === entry) {
      requestCloseFeedFriendNoteCard(true);
      return;
    }
    // Only one card at a time, and never at the cost of another card's draft.
    if (!requestCloseFeedFriendNoteCard(false)) return;
    openFeedFriendNoteCard(entry);
  }

  function openFeedFriendNoteCard(entry) {
    const runtime = feedFriendNotes;
    const owner = determineCurrentUid();
    if (
      runtime === null ||
      !entry.active ||
      !owner.ok ||
      owner.uid !== entry.ownerUid ||
      runtime.ownerUid !== entry.ownerUid
    ) {
      return;
    }
    // Opening re-reads local state, so a note saved in another tab is shown
    // rather than the copy cached when the feed was first processed.
    reloadFeedFriendNotesData();
    if (runtime.data === null || !entry.active) return;

    // From here on the card is bound to these two UIDs, not to the node.
    const ownerUid = entry.ownerUid;
    const subjectUid = entry.uid;
    const facts = feedFriendNoteFacts(subjectUid);
    const record = hasOwn(runtime.data.notes, subjectUid)
      ? runtime.data.notes[subjectUid]
      : null;

    const root = createElement("div", null, "wfr-feed-note-card wfr-root");
    root.id = FEED_FRIEND_NOTE_CARD_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "友人档案");
    root.setAttribute("tabindex", "-1");
    applyThemeToRoot(root);

    const head = createElement("div", null, "wfr-feed-note-card-head");
    const title = createElement("p", null, "wfr-feed-note-card-title");
    const shownName =
      entry.pageName !== null
        ? entry.pageName
        : facts.currentName !== null
          ? facts.currentName
          : null;
    if (shownName !== null) title.append(createElement("strong", shownName));
    title.append(createElement("span", `UID ${subjectUid}`, "wfr-muted"));
    const closeButton = createFriendNoteButton("关闭");
    closeButton.setAttribute("aria-label", "关闭友人档案卡片");
    head.append(title, closeButton);

    const notice = createElement("p", "", "wfr-error wfr-feed-note-card-notice");
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");

    const editor = buildFriendNoteEditor({
      ownerUid,
      subjectUid,
      record,
      compact: true,
      onSaved: syncFriendNoteViews,
    });

    const observed = createElement("div", null, "wfr-profile-notes-observed");
    observed.append(
      createElement(
        "p",
        "Toolkit 本地观察记录（非实时）",
        "wfr-profile-notes-subhead"
      )
    );
    const rows = friendNoteObservedRows(facts);
    if (rows.length === 0) {
      observed.append(
        createElement(
          "p",
          "暂无此账号的本地昵称或关系记录。",
          "wfr-profile-row"
        )
      );
    }
    for (const row of rows) {
      addProfileLine(observed, row.label, row.value, row.exactTime);
    }

    const actions = createElement(
      "div",
      null,
      "wfr-actions wfr-compact-actions"
    );
    const detailButton = createFriendNoteButton("完整档案");
    actions.append(createFriendNoteProfileLink(subjectUid), detailButton);

    // The head and the notice stay put; everything else scrolls inside the
    // card when it is taller than the space the viewport leaves it.
    const body = createElement("div", null, "wfr-feed-note-card-body");
    body.append(editor.root, observed, actions);
    root.append(head, notice, body);

    const card = {
      ownerUid,
      subjectUid,
      editor,
      root,
      notice,
      entry,
      resizeObserver: null,
      onKeydown: (event) => {
        if (event && event.key === "Escape" && !isFriendNoteImeKeyEvent(event)) {
          requestCloseFeedFriendNoteCard(true);
        }
      },
      onDocumentClick: (event) => {
        const target = event && event.target;
        if (
          !target ||
          root.contains(target) ||
          (card.entry !== null && card.entry.wrapper.contains(target))
        ) {
          return;
        }
        // Clicking elsewhere dismisses a card that has nothing to lose; a card
        // with typed input stays until it is saved or cancelled.
        if (!editor.hasUnsavedChanges()) closeFeedFriendNoteCard(false);
      },
    };
    closeButton.addEventListener("click", () =>
      requestCloseFeedFriendNoteCard(true)
    );
    detailButton.addEventListener("click", () => {
      if (requestCloseFeedFriendNoteCard(false)) {
        showFriendNoteDetail(ownerUid, subjectUid, null);
      }
    });

    feedFriendNoteCard = card;
    document.body.append(root);
    entry.button.setAttribute("aria-expanded", "true");
    positionFeedFriendNoteCard();
    if (typeof document.addEventListener === "function") {
      document.addEventListener("keydown", card.onKeydown);
      document.addEventListener("click", card.onDocumentClick, true);
    }
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      window.addEventListener("scroll", positionFeedFriendNoteCard, {
        capture: true,
        passive: true,
      });
      window.addEventListener("resize", positionFeedFriendNoteCard);
    }
    // Switching between view and edit, adding tags, a conflict box and a
    // finished save or delete all change the card's height.
    if (typeof ResizeObserver === "function") {
      card.resizeObserver = new ResizeObserver(positionFeedFriendNoteCard);
      card.resizeObserver.observe(root);
    }
    // An existing note opens as a dialog; a new one opens straight into its
    // form, whose note field can only take focus now that it is in the page.
    focusFriendNoteControl(
      editor.isEditing() && typeof root.querySelector === "function"
        ? root.querySelector(".wfr-note-textarea") || root
        : root
    );
  }
