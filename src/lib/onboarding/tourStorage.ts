// SSR-safe per-tour dismissal persistence in localStorage. Mirrors the
// try/catch + `typeof window` guards used elsewhere (e.g. builder/experiments).
// Version-prefixed so bumping the prefix re-shows every tour after a redesign.
const VERSION = "v1";
const PREFIX = `cms_onboarding:${VERSION}:`;

export function isTourDismissed(id: string): boolean {
  // Never auto-start during SSR / first paint (the overlay is client-only).
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PREFIX + id) === "1";
  } catch {
    return false; // storage blocked → treat as not-yet-seen
  }
}

export function dismissTour(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + id, "1");
  } catch {
    /* ignore */
  }
}

export function resetTour(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
}
