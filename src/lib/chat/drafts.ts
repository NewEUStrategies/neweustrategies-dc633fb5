// Per-conversation composer drafts, persisted to localStorage so switching
// threads (or reloading the tab) never loses typed-but-unsent text - a
// standard messenger guarantee the previous composer lacked.
//
// Design:
//  - One storage entry per user (`nes.chat.drafts.<uid>`), a JSON map of
//    conversation id -> { text, updatedAt }. User-scoped so an account switch
//    on a shared machine never resurfaces someone else's draft.
//  - Module-level store + subscribe API (useSyncExternalStore-compatible):
//    the conversation list re-renders its "Szkic:" preview live while the
//    composer types in another pane of the same tab.
//  - Writes are debounced; entries are pruned by age and count so the map
//    can't grow unboundedly.
//  - Storage failures (quota, privacy mode) degrade to in-memory drafts.

export interface ChatDraft {
  readonly text: string;
  readonly updatedAt: number;
}

const MAX_DRAFT_LENGTH = 8000; // mirrors MAX_BODY_LENGTH in the composer
const MAX_DRAFTS = 50;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const WRITE_DEBOUNCE_MS = 400;

type DraftMap = Map<string, ChatDraft>;

let currentUid: string | null = null;
let drafts: DraftMap = new Map();
const listeners = new Set<() => void>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function storageKey(uid: string): string {
  return `nes.chat.drafts.${uid}`;
}

/** Drop stale/overflowing entries (newest win). Pure - exported for tests. */
export function pruneDrafts(
  entries: ReadonlyArray<readonly [string, ChatDraft]>,
  nowMs: number,
  maxDrafts = MAX_DRAFTS,
  maxAgeMs = MAX_AGE_MS,
): Array<readonly [string, ChatDraft]> {
  return entries
    .filter(([, draft]) => draft.text.trim().length > 0 && nowMs - draft.updatedAt <= maxAgeMs)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, maxDrafts);
}

function loadFromStorage(uid: string): DraftMap {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return new Map();
    const entries: Array<readonly [string, ChatDraft]> = [];
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { text, updatedAt } = value as { text?: unknown; updatedAt?: unknown };
      if (typeof text !== "string" || typeof updatedAt !== "number") continue;
      entries.push([id, { text: text.slice(0, MAX_DRAFT_LENGTH), updatedAt }]);
    }
    return new Map(pruneDrafts(entries, Date.now()));
  } catch {
    return new Map();
  }
}

function writeNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (!currentUid) return;
  try {
    const pruned = pruneDrafts([...drafts], Date.now());
    drafts = new Map(pruned);
    localStorage.setItem(storageKey(currentUid), JSON.stringify(Object.fromEntries(pruned)));
  } catch {
    // Quota/privacy mode: keep the in-memory copy, skip persistence.
  }
}

/**
 * Debounced write for the hot typing path; `immediate` flushes synchronously.
 * Deletions always flush: a draft cleared on SEND must never resurrect from
 * storage after a reload that beats the debounce window.
 */
function persist(immediate = false): void {
  if (immediate) {
    writeNow();
    return;
  }
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(writeNow, WRITE_DEBOUNCE_MS);
}

// A tab closed mid-debounce must not lose the last keystrokes; pagehide also
// covers bfcache navigations (fires where beforeunload does not).
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => writeNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") writeNow();
  });
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

/** Lazily binds the store to a user; an account switch swaps the whole map. */
function ensureUser(uid: string): void {
  if (currentUid === uid) return;
  // Flush the outgoing user's pending edits before swapping the map.
  writeNow();
  currentUid = uid;
  drafts = typeof localStorage === "undefined" ? new Map() : loadFromStorage(uid);
  notify();
}

export function subscribeDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDraft(uid: string, conversationId: string): string {
  ensureUser(uid);
  return drafts.get(conversationId)?.text ?? "";
}

export function setDraft(uid: string, conversationId: string, text: string): void {
  ensureUser(uid);
  const trimmed = text.slice(0, MAX_DRAFT_LENGTH);
  const existing = drafts.get(conversationId)?.text ?? "";
  let removed = false;
  if (trimmed.trim().length === 0) {
    if (!drafts.has(conversationId)) return;
    drafts.delete(conversationId);
    removed = true;
  } else {
    if (existing === trimmed) return;
    drafts.set(conversationId, { text: trimmed, updatedAt: Date.now() });
  }
  persist(removed);
  notify();
}

export function clearDraft(uid: string, conversationId: string): void {
  setDraft(uid, conversationId, "");
}

/** Snapshot for useSyncExternalStore - stable string identity per content. */
export function draftSnapshot(uid: string | undefined, conversationId: string): string {
  if (!uid) return "";
  return getDraft(uid, conversationId);
}

/** Test hook: reset module state between cases. */
export function __resetDraftsForTests(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  currentUid = null;
  drafts = new Map();
  listeners.clear();
}
