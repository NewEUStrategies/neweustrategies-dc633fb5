// Server-only token-bucket rate limiter backed by the `rate_limits` table.
// Uses the admin client because policies on rate_limits deny anon/authenticated
// access by design.
//
// Soft race-acceptable: under heavy concurrent load a few extra calls may slip
// through. Adequate for abuse prevention; not for billing/quota enforcement.
//
// Failure mode is per-call:
//   * default (`failClosed: false`) -> FAIL-OPEN. A DB blip must not lock out
//     legitimate abuse-prevention scopes (newsletter/comments/import); at worst
//     a few extra calls slip through during an outage.
//   * `failClosed: true` -> FAIL-CLOSED. For COST-BEARING scopes (paid 3rd-party
//     synthesis like ElevenLabs TTS) a DB blip must NOT remove the spend cap, so
//     the limiter denies rather than letting an attacker drain the budget while
//     the counter store is unavailable.
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
  // On a counter-store error, fail-open scopes return true (allow) and
  // fail-closed scopes return false (deny).
  const onError = !failClosed;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const bucketMs = windowMinutes * 60_000;
  const windowStart = new Date(Math.floor(Date.now() / bucketMs) * bucketMs).toISOString();

  const { data: existing, error: selectError } = await supabaseAdmin
    .from("rate_limits")
    .select("id, count")
    .eq("scope", scope)
    .eq("subject_id", subjectId)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (selectError) {
    console.warn(`[rate-limit] select failed (${scope}):`, selectError.message);
    return onError;
  }

  if (!existing) {
    const { error } = await supabaseAdmin
      .from("rate_limits")
      .insert({ scope, subject_id: subjectId, window_start: windowStart, count: 1 });
    if (error) {
      console.warn(`[rate-limit] insert failed (${scope}):`, error.message);
      return onError;
    }
    return true;
  }

  const next = existing.count + 1;
  if (next > max) return false;

  const { error } = await supabaseAdmin
    .from("rate_limits")
    .update({ count: next })
    .eq("id", existing.id);
  if (error) {
    console.warn(`[rate-limit] update failed (${scope}):`, error.message);
    return onError;
  }
  return true;
}
