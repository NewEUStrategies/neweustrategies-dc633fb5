// Stable per-browser viewer hash for view-counting anti-spam.
// Stored in localStorage; never leaves the browser except as an opaque token
// passed to the `record_post_view` Postgres function.
//
// The token IS a device identifier that links a person's reads across sessions
// (`post_views.viewer_hash`, counted as DISTINCT in `related_posts_signals`), so
// it may only be minted behind the analytics consent gate - the caller decides,
// see useRecordPostView. Its lifetime is bounded here: an identifier older than
// MAX_AGE_MS is rotated instead of reused, so it cannot accumulate a profile for
// as long as the browser keeps its storage.
const KEY = "viewer_hash:v2";
// Pre-rotation token: a bare string with no mint timestamp, so its age is
// unknowable. Read only to delete it - never to keep using it.
const LEGACY_KEY = "__viewer_hash";
// 30 days - just past the 28-day default window of `related_posts_signals`, so
// unique-viewer counts stay honest for the window they are reported over. Longer
// windows (the RPC accepts up to 365 days) trade unique precision for the bound.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredHash {
  hash: string;
  mintedAt: number;
}

export function getViewerHash(): string {
  if (typeof window === "undefined") return "ssr-noop-0000000000";
  try {
    window.localStorage.removeItem(LEGACY_KEY);
    const stored = parse(window.localStorage.getItem(KEY));
    if (stored) {
      const age = Date.now() - stored.mintedAt;
      // A mint timestamp in the future means a clock jump, not a fresh token -
      // rotate rather than trust it as ageless.
      if (age >= 0 && age < MAX_AGE_MS) return stored.hash;
    }
    const next: StoredHash = { hash: generate(), mintedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return next.hash;
  } catch {
    // localStorage unavailable (private mode, SSR) - return ephemeral hash.
    return generate();
  }
}

/** Drops the stored identifier (consent withdrawn / never granted). */
export function clearViewerHash(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // localStorage unavailable - nothing was ever stored.
  }
}

function parse(raw: string | null): StoredHash | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredHash> | null;
    if (typeof value?.hash !== "string" || value.hash.length < 16) return null;
    if (typeof value.mintedAt !== "number" || !Number.isFinite(value.mintedAt)) return null;
    return { hash: value.hash, mintedAt: value.mintedAt };
  } catch {
    return null;
  }
}

function generate(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
