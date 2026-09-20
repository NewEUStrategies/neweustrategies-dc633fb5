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

/**
 * Migawka odczytana z Cache API razem z werdyktem ŚWIEŻOŚCI.
 *
 * ŚWIEŻOŚĆ (`ttlMs`) i PRZETRWANIE (`maxAgeMs`) to dwie różne rzeczy i do
 * 2026-09-20 były jedną: wpis starszy niż TTL był odrzucany i wygasał w Cache
 * API po TTL, więc migawka tenantów (60 s) i redirectów (30 s) chroniła
 * wyłącznie izolat rotujący POD RUCHEM. Po ciszy dłuższej niż minuta zimny
 * izolat płacił dwa szeregowe odczyty planu service-role (po 1 500 ms
 * terminu) PRZED cache dokumentów - także na trafieniu (audyt F01).
 *
 * `stale: true` mówi wołającemu: „serwuj od ręki, odśwież w tle" - ta sama
 * decyzja, którą jego lokalna logika SWR podejmuje dla własnego wpisu po TTL.
 */
export interface BootstrapSnapshotRead<T> extends BootstrapSnapshot<T> {
  /** `age >= ttlMs`: wpis nadaje się do serwowania, ale wymaga odświeżenia. */
  stale: boolean;
}

export interface BootstrapSnapshotOptions {
  /**
   * Jak długo wpis ma PRZETRWAĆ w Cache API i być akceptowany przy odczycie
   * (domyślnie 24 h). Poniżej `ttlMs` nie ma sensu, więc jest do niego
   * podciągane. Konsument z własnym oknem serve-stale (np. `edgeTtlCache`)
   * podaje tu swoją wielokrotność TTL.
   */
  maxAgeMs?: number;
}

/**
 * Domyślne przetrwanie migawki: doba. Dłużej niż jakakolwiek realna cisza
 * między czytelnikami jednej kolonii, a jednocześnie twardy sufit na wiek
 * danych routingu, gdy odświeżenie w tle z jakiegoś powodu nigdy nie dojdzie.
 */
export const BOOTSTRAP_SNAPSHOT_MAX_AGE_MS = 86_400_000;

function resolveMaxAgeMs(ttlMs: number, opts: BootstrapSnapshotOptions | undefined): number {
  const requested = opts?.maxAgeMs;
  const maxAge =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? requested
      : BOOTSTRAP_SNAPSHOT_MAX_AGE_MS;
  return Math.max(ttlMs, maxAge);
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
  opts?: BootstrapSnapshotOptions,
): Promise<BootstrapSnapshotRead<T> | null> {
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
    if (!Number.isFinite(age) || age < 0) return null;
    if (age >= resolveMaxAgeMs(ttlMs, opts) || !validate(value)) return null;
    return { at: at as number, value, stale: age >= ttlMs };
  } catch {
    return null;
  }
}

export async function writeBootstrapSnapshot<T>(
  key: string,
  snapshot: BootstrapSnapshot<T>,
  ttlMs: number,
  opts?: BootstrapSnapshotOptions,
): Promise<void> {
  try {
    const request = snapshotRequest(key);
    const cache = getColoCache();
    if (!request || !cache) return;
    // `max-age` = przetrwanie, nie świeżość: Cache API ma trzymać wpis przez
    // całe okno serve-stale; o tym, czy jest świeży, decyduje odczyt z `at`.
    const maxAgeS = Math.max(1, Math.ceil(resolveMaxAgeMs(ttlMs, opts) / 1000));
    await cache.put(
      request,
      new Response(JSON.stringify(snapshot), {
        headers: {
          "content-type": "application/json",
          "cache-control": `public, max-age=${maxAgeS}`,
        },
      }),
    );
  } catch {
    // Cache failure must not fail routing or replace a last known good entry.
  }
}
