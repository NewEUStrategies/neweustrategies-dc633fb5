// Stable per-browser viewer hash for view-counting anti-spam.
// Stored in localStorage; never leaves the browser except as an opaque token
// passed to the `record_post_view` Postgres function.
const KEY = "__viewer_hash";

export function getViewerHash(): string {
  if (typeof window === "undefined") return "ssr-noop-0000000000";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing && existing.length >= 16) return existing;
    const next = generate();
    window.localStorage.setItem(KEY, next);
    return next;
  } catch {
    // localStorage unavailable (private mode, SSR) — return ephemeral hash.
    return generate();
  }
}

function generate(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
