import { getColoCache } from "./documentCacheL2.server";

/** Public routing metadata survives Worker rotation, just like HTML in L2.
 * Keys include the configured database origin: environments sharing a colo
 * must never reuse another project's tenant directory or redirect rules.
 * Only successful, validated snapshots are used; database reads remain the
 * fallback. These entries are internal Cache API keys, never public routes.
 */
export interface BootstrapSnapshot<T> {
  at: number;
  value: T;
}

function snapshotRequest(key: string): Request | null {
  const source = process.env.SUPABASE_URL;
  if (!source) return null;
  try {
    const origin = new URL(source).origin;
    if (origin === "null") return null;
    return new Request(
      `https://nes-edge-cache.internal/__nes/bootstrap/v1/${encodeURIComponent(origin)}/${encodeURIComponent(key)}`,
    );
  } catch {
    return null;
  }
}

export async function readBootstrapSnapshot<T>(
  key: string,
  ttlMs: number,
  validate: (value: unknown) => value is T,
): Promise<BootstrapSnapshot<T> | null> {
  try {
    const request = snapshotRequest(key);
    const cache = getColoCache();
    if (!request || !cache) return null;
    const response = await cache.match(request);
    if (!response?.ok) return null;
    const snapshot: unknown = await response.json();
    if (!snapshot || typeof snapshot !== "object") return null;
    const { at, value } = snapshot as { at?: unknown; value?: unknown };
    const age = typeof at === "number" ? Date.now() - at : Number.NaN;
    if (!Number.isFinite(age) || age < 0 || age >= ttlMs || !validate(value)) return null;
    return { at: at as number, value };
  } catch {
    return null;
  }
}

export async function writeBootstrapSnapshot<T>(
  key: string,
  snapshot: BootstrapSnapshot<T>,
  ttlMs: number,
): Promise<void> {
  try {
    const request = snapshotRequest(key);
    const cache = getColoCache();
    if (!request || !cache) return;
    await cache.put(
      request,
      new Response(JSON.stringify(snapshot), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${Math.max(1, Math.ceil(ttlMs / 1000))}`,
        },
      }),
    );
  } catch {
    // Cache failure must not fail routing or replace a last known good entry.
  }
}
