// Fetch wrapper for the Supabase clients on the PUBLIC (anon) plane.
//
// Injects `x-tenant-host` - the host the visitor is browsing - into every
// PostgREST/RPC call, so the database side (public.request_public_host() ->
// public.public_tenant_id()) can resolve the tenant per request. This is what
// makes every existing anon RLS policy ("tenant_id = public_tenant_id()")
// host-aware WITHOUT touching individual queries:
//
//   * browser: window.location.host - each tenant domain reads its own site;
//   * SSR / server functions: the active request's host via TanStack Start's
//     request context, VALIDATED against tenants.domain at the edge
//     (pickTrustedHost) - a spoofed X-Forwarded-Host never becomes the
//     x-tenant-host of a server-side render; server-rendered HTML matches
//     what the client fetches.
//
// Requests with no resolvable host (background jobs, previews without a
// claimed domain) carry no header and the database falls back to the DEFAULT
// tenant - exactly the pre-multi-domain behaviour.
//
// Wired into src/integrations/supabase/client.ts (that file is generated - if
// it is ever regenerated, re-add `global: { fetch: fetchWithTenantHost }` to
// its createClient options) and into the per-call anon clients in server
// functions (src/lib/views/postViews.functions.ts).
import { TENANT_HOST_HEADER } from "@/lib/http/host";
import { currentTenantHost } from "@/lib/http/requestHost";

/**
 * Twardy deadline round-tripu DB podczas SSR. Drabinka budżetów SSR:
 * queryTimeout (5 s) anuluje ZAPYTANIE, ale nie ubija samego fetcha - a na
 * Workers niedomknięty fetch trzyma slot połączenia (limit 6 równoległych
 * subrequestów na żądanie) i głodzi kolejne zapytania renderu. Deadline na
 * poziomie fetcha zwalnia slot deterministycznie. 8 s = powyżej queryTimeout
 * (anulowanie zapytania pozostaje mechanizmem pierwszego wyboru), poniżej
 * strażnika dokumentu (12/20 s). Nastawa: SSR_DB_DEADLINE_MS (0/off wyłącza).
 */
const SSR_DB_DEADLINE_MS = 8_000;

function ssrDeadlineMs(): number {
  const raw = typeof process !== "undefined" ? process.env.SSR_DB_DEADLINE_MS : undefined;
  if (raw === undefined || raw === "") return SSR_DB_DEADLINE_MS;
  const lowered = raw.toLowerCase();
  if (lowered === "off" || lowered === "false") return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : SSR_DB_DEADLINE_MS;
}

/**
 * Sygnał deadline'u złożony z ewentualnym sygnałem wywołującego. Defensywnie:
 * starszy runtime bez AbortSignal.timeout/any po prostu nie dostaje deadline'u
 * (zachowanie sprzed zmiany), zamiast wywracać potok SSR.
 */
function withSsrDeadline(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  const deadlineMs = ssrDeadlineMs();
  if (deadlineMs <= 0) return init;
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return init;
  const deadline = AbortSignal.timeout(deadlineMs);
  const existing = init?.signal ?? (input instanceof Request ? input.signal : null);
  const signal =
    existing && typeof AbortSignal.any === "function"
      ? AbortSignal.any([existing, deadline])
      : (existing ?? deadline);
  return { ...init, signal };
}

/**
 * Telemetria SSR (Server-Timing `db;dur`): każdy round-trip planu anon jest
 * mierzony i doliczany do bieżącego żądania dokumentu. Wyłącznie na serwerze -
 * import telemetrii jest dynamiczny za bramką SSR (ten sam wzorzec co
 * `currentTenantHost`), więc do bundla przeglądarki nie trafia ani bajt, a
 * moduł po pierwszym imporcie jest cache'owany przez runtime.
 */
async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window !== "undefined" || !import.meta.env.SSR) return fetch(input, init);
  const startedAt = Date.now();
  try {
    return await fetch(input, withSsrDeadline(input, init));
  } finally {
    try {
      const timing = await import("@/lib/http/ssrTiming.server");
      timing.recordDbRoundTrip(Date.now() - startedAt);
    } catch {
      /* telemetria jest best-effort - nigdy nie może zerwać zapytania */
    }
  }
}

export async function fetchWithTenantHost(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const host = await currentTenantHost();
  if (!host) return timedFetch(input, init);

  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  // Never clobber an explicitly-set header (tests, targeted overrides).
  if (!headers.has(TENANT_HOST_HEADER)) headers.set(TENANT_HOST_HEADER, host);

  if (init || !(input instanceof Request)) {
    return timedFetch(input, { ...init, headers });
  }
  return timedFetch(new Request(input, { headers }));
}
