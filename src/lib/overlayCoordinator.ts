// Global coordinator for marketing overlays (newsletter popup, builder
// popups, footer slide-up). Previously each overlay system triggered
// independently, so a first visit could stack the consent banner + newsletter
// popup + a builder popup at once. Rules enforced here:
//
//   1. While the consent banner is deciding (visible), NO overlay may open -
//      consent always goes first (hard gate on the whole queue).
//   2. Only ONE overlay may be open at a time (single owner).
//   3. After an overlay is granted, subsequent grants wait out a short in-memory
//      cooldown, so overlays never chain back-to-back on the same page view.
//   4. Among waiting requests the highest `priority` wins (FIFO within a
//      priority), so e.g. a targeted builder popup can outrank the generic
//      newsletter popup instead of relying on arrival order.
//   5. Marketing overlays (`marketing: true`) are additionally:
//        - SUPPRESSED entirely when the visitor has explicitly rejected
//          marketing consent (not merely reordered - see setMarketingConsent),
//        - counted against a PERSISTED, cross-session interruption budget
//          (max N per calendar day, min gap between two overlays) so a reload
//          or a new tab can't immediately re-show an overlay.
//
// Non-marketing dialogs (login popup - user-initiated, app dialogs) do not
// participate: they respond to explicit user action. Non-marketing coordinated
// entries (used by tests) skip consent-suppression and the persisted budget.

type Entry = {
  id: string;
  priority: number;
  marketing: boolean;
  resolve: (release: () => void) => void;
};

const COOLDOWN_MS = 30_000;

// Persisted, cross-session interruption budget for marketing overlays.
const BUDGET_KEY = "overlay:budget:v1";
const MAX_MARKETING_PER_DAY = 3;
const MIN_MARKETING_GAP_MS = 20 * 60_000; // 20 minutes between marketing overlays

type Budget = { day: string; count: number; lastTs: number };

let consentVisible = false;
// null = undecided (held by the consent banner anyway); true = granted;
// false = explicitly denied -> marketing overlays are suppressed.
let marketingConsent: boolean | null = null;
let owner: string | null = null;
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Entry[] = [];

function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function readBudget(): Budget {
  if (typeof window === "undefined") return { day: "", count: 0, lastTs: 0 };
  try {
    const raw = window.localStorage.getItem(BUDGET_KEY);
    if (!raw) return { day: "", count: 0, lastTs: 0 };
    const v = JSON.parse(raw) as Partial<Budget>;
    return {
      day: typeof v.day === "string" ? v.day : "",
      count: typeof v.count === "number" ? v.count : 0,
      lastTs: typeof v.lastTs === "number" ? v.lastTs : 0,
    };
  } catch {
    return { day: "", count: 0, lastTs: 0 };
  }
}

function writeBudget(b: Budget): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BUDGET_KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable - budget degrades to in-memory only */
  }
}

/** Whether a marketing overlay may be granted now under the persisted budget. */
function marketingBudgetAllows(now: number): boolean {
  const b = readBudget();
  const today = dayKey(now);
  const countToday = b.day === today ? b.count : 0;
  if (countToday >= MAX_MARKETING_PER_DAY) return false;
  if (b.lastTs > 0 && now - b.lastTs < MIN_MARKETING_GAP_MS) return false;
  return true;
}

function recordMarketingGrant(now: number): void {
  const b = readBudget();
  const today = dayKey(now);
  const countToday = b.day === today ? b.count : 0;
  writeBudget({ day: today, count: countToday + 1, lastTs: now });
}

/** True if a marketing entry is currently blocked (consent denied or budget). */
function marketingBlocked(now: number): boolean {
  return marketingConsent === false || !marketingBudgetAllows(now);
}

/** Index of the highest-priority grantable waiter (FIFO within a priority). */
function pickIndex(now: number): number {
  let best = -1;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (e.marketing && marketingBlocked(now)) continue;
    if (e.priority > bestPriority) {
      best = i;
      bestPriority = e.priority;
    }
  }
  return best;
}

function pump(): void {
  if (owner || consentVisible || queue.length === 0) return;
  const now = Date.now();
  if (now < cooldownUntil) {
    // Re-pump when the cooldown lapses (timer deduped).
    if (!cooldownTimer) {
      cooldownTimer = setTimeout(
        () => {
          cooldownTimer = null;
          pump();
        },
        Math.max(50, cooldownUntil - now),
      );
    }
    return;
  }
  const idx = pickIndex(now);
  if (idx < 0) return;
  const [next] = queue.splice(idx, 1);
  owner = next.id;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  if (next.marketing) recordMarketingGrant(now);
  next.resolve(() => {
    if (owner === next.id) {
      owner = null;
      cooldownUntil = Date.now() + COOLDOWN_MS;
      pump();
    }
  });
}

/** ConsentBanner reports its initial-banner visibility here. */
export function setConsentOverlayVisible(visible: boolean): void {
  consentVisible = visible;
  if (!visible) pump();
}

/**
 * ConsentBanner reports the resolved marketing-consent decision here.
 * `null` = undecided, `true` = granted, `false` = explicitly denied. When
 * denied, marketing overlays are suppressed outright (not just reordered).
 */
export function setMarketingConsent(value: boolean | null): void {
  marketingConsent = value;
  if (value !== false) pump();
}

export type OverlaySlotOptions = {
  /** Higher wins when several requests wait. Default 0. */
  priority?: number;
  /**
   * Marketing overlays are consent-suppressed and counted against the
   * persisted cross-session interruption budget. Default false.
   */
  marketing?: boolean;
};

/**
 * Request permission to open an overlay. Resolves with a `release` function
 * once the slot is granted (may be deferred behind the consent banner /
 * another overlay / the cooldown / the marketing budget). Call `release()`
 * when the overlay closes. Cancel a still-pending request with
 * `cancelOverlayRequest(id)`.
 */
export function requestOverlaySlot(id: string, opts: OverlaySlotOptions = {}): Promise<() => void> {
  return new Promise((resolve) => {
    queue.push({
      id,
      priority: opts.priority ?? 0,
      marketing: opts.marketing ?? false,
      resolve,
    });
    pump();
  });
}

/** Remove a not-yet-granted request (e.g. the requesting component unmounted). */
export function cancelOverlayRequest(id: string): void {
  const idx = queue.findIndex((e) => e.id === id);
  if (idx >= 0) queue.splice(idx, 1);
}

/** True while a coordinated overlay currently holds the single slot. */
export function isOverlayActive(): boolean {
  return owner !== null;
}

/** Test-only: reset module state between test cases. */
export function __resetOverlayCoordinator(): void {
  consentVisible = false;
  marketingConsent = null;
  owner = null;
  cooldownUntil = 0;
  queue.length = 0;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(BUDGET_KEY);
    } catch {
      /* ignore */
    }
  }
}
