// Server-only atomic rate limiter backed by the SECURITY DEFINER
// `rate_limit_hit` RPC. Atomic INSERT ... ON CONFLICT DO UPDATE RETURNING
// closes the select/update race that let bursts slip past the cap under load.
//
// Failure mode is per-call:
//   * default (`failClosed: false`) -> FAIL-OPEN. A DB blip must not lock out
//     legitimate abuse-prevention scopes (newsletter/comments/import); at
//     worst a few extra calls slip through during an outage.
//   * `failClosed: true` -> FAIL-CLOSED. For cost-bearing or security-critical
//     scopes (paid 3rd-party synthesis, brute-force guards) a DB blip must
//     NOT remove the cap - the limiter denies rather than let an attacker
//     drain the budget or bypass credential throttling while the counter
//     store is unavailable.
interface CheckOpts {
  scope: string;
  subjectId: string;
  max: number;
  windowMinutes?: number;
  failClosed?: boolean;
}

export async function rateLimit({
  scope,
  subjectId,
  max,
  windowMinutes = 1,
  failClosed = false,
}: CheckOpts): Promise<boolean> {
  const onError = !failClosed;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
    _scope: scope,
    _subject: subjectId,
    _max: max,
    _window_minutes: windowMinutes,
  });
  if (error) {
    console.warn(`[rate-limit] rpc failed (${scope}):`, error.message);
    return onError;
  }
  const row = Array.isArray(data) ? data[0] : (data as { allowed?: boolean } | null);
  return row?.allowed === true;
}

/**
 * Wariant `rateLimit` który przy odmowie rzuca strukturalnym `RateLimitError`
 * zamiast zwracać `false`. Klient (mapServerError) wtedy pokazuje przyjazny
 * komunikat i18n zamiast surowego "Wystąpił błąd". Używaj w server-fn, w
 * których odmowa ZAWSZE ma być błędem (a nie np. cichym pominięciem).
 */
export async function guardRateLimit(opts: CheckOpts, retryAfterSec?: number): Promise<void> {
  const allowed = await rateLimit(opts);
  if (!allowed) {
    const { RateLimitError } = await import("@/lib/errors/serverErrors");
    throw new RateLimitError(opts.scope, retryAfterSec);
  }
}
