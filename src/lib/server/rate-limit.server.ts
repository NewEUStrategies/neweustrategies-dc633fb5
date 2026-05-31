// Server-only token-bucket rate limiter backed by the `rate_limits` table.
// Uses the admin client because policies on rate_limits deny anon/authenticated
// access by design.
//
// Soft race-acceptable: under heavy concurrent load a few extra calls may slip
// through. Adequate for abuse prevention; not for billing/quota enforcement.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface CheckOpts {
  scope: string;
  subjectId: string;
  max: number;
  windowMinutes?: number;
}

export async function rateLimit({ scope, subjectId, max, windowMinutes = 1 }: CheckOpts): Promise<boolean> {
  const bucketMs = windowMinutes * 60_000;
  const windowStart = new Date(Math.floor(Date.now() / bucketMs) * bucketMs).toISOString();

  const { data: existing } = await supabaseAdmin
    .from("rate_limits")
    .select("id, count")
    .eq("scope", scope)
    .eq("subject_id", subjectId)
    .eq("window_start", windowStart)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabaseAdmin
      .from("rate_limits")
      .insert({ scope, subject_id: subjectId, window_start: windowStart, count: 1 });
    if (error) {
      console.warn("[rate-limit] insert failed:", error.message);
      return true; // fail-open
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
    console.warn("[rate-limit] update failed:", error.message);
    return true;
  }
  return true;
}
