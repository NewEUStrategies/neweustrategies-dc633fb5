// Global coordinator for marketing overlays (newsletter popup, builder
// popups). Previously each overlay system triggered independently, so a first
// visit could stack the consent banner + newsletter popup + a builder popup
// at once. Rules enforced here:
//
//   1. While the consent banner is deciding (visible), no marketing overlay
//      may open - consent always goes first.
//   2. Only ONE marketing overlay may be open at a time (single owner).
//   3. After a marketing overlay is granted, subsequent grants are held back
//      for a cooldown window, so overlays never chain back-to-back on the
//      same page view.
//
// Non-marketing dialogs (login popup - user-initiated, app dialogs) do not
// participate: they respond to explicit user action.

type Entry = {
  id: string;
  resolve: (release: () => void) => void;
};

const COOLDOWN_MS = 30_000;

let consentVisible = false;
let owner: string | null = null;
let cooldownUntil = 0;
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Entry[] = [];

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
  const next = queue.shift();
  if (!next) return;
  owner = next.id;
  cooldownUntil = Date.now() + COOLDOWN_MS;
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
 * Request permission to open a marketing overlay. Resolves with a `release`
 * function once the slot is granted (may be deferred behind the consent
 * banner / another overlay / the cooldown). Call `release()` when the
 * overlay closes. Cancel a still-pending request with
 * `cancelOverlayRequest(id)`.
 */
export function requestOverlaySlot(id: string): Promise<() => void> {
  return new Promise((resolve) => {
    queue.push({ id, resolve });
    pump();
  });
}

/** Remove a not-yet-granted request (e.g. the requesting component unmounted). */
export function cancelOverlayRequest(id: string): void {
  const idx = queue.findIndex((e) => e.id === id);
  if (idx >= 0) queue.splice(idx, 1);
}

/** Test-only: reset module state between test cases. */
export function __resetOverlayCoordinator(): void {
  consentVisible = false;
  owner = null;
  cooldownUntil = 0;
  queue.length = 0;
  if (cooldownTimer) {
    clearTimeout(cooldownTimer);
    cooldownTimer = null;
  }
}
