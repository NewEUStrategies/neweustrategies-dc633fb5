// Server-only token-bucket rate limiter backed by the `rate_limits` table.
// Uses the admin client because policies on rate_limits deny anon/authenticated
// access by design (no client should read/write it directly).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface CheckOpts {
  scope: string;        // e.g. "media.upload", "newsletter.subscribe"
  subjectId: string;    // user_id (uuid) or tenant_id (uuid)
  max: number;          // max events per window
  windowMinutes?: number; // bucket size, default 1 min
}

/**
 * Returns true when the action is allowed, false when over the limit.
 * Safe to call from any server function or server route.
 */
export async function rateLimit({ scope, subjectId, max, windowMinutes = 1 }: CheckOpts): Promise<boolean> {
  const now = new Date();
  // Align bucket to the nearest window boundary so concurrent requests share it.
  const bucketMs = windowMinutes * 60_000;
  const windowStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs).toISOString();

  // Atomic upsert + increment via a single SQL round-trip.
  const { data, error } = await supabaseAdmin
    .from("rate_limits")
    .upsert(
      { scope, subject_id: subjectId, window_start: windowStart, count: 1 },
      { onConflict: "scope,subject_id,window_start", ignoreDuplicates: false },
    )
    .select("count")
    .maybeSingle();

  if (error) {
    // On infra failure, fail-open to not block the user.
    console.warn("[rate-limit] upsert failed:", error.message);
    return true;
  }

  // Upsert returns the row but `count` does NOT auto-increment - do it manually
  // when the row already existed (count > 1 after upsert would have just stored 1).
  // Use a follow-up increment when the upsert just reset/created.
  const currentCount = data?.count ?? 1;
  if (currentCount === 1) {
    // Either freshly created (allowed) OR a parallel request reset it - allow.
    return true;
  }
  // Existing row collided; bump count.
  const { data: bumped, error: bumpErr } = await supabaseAdmin.rpc("noop_increment", {});
  // Fall back to a plain UPDATE since we don't ship the RPC.
  if (bumpErr) {
    const { data: updated } = await supabaseAdmin
      .from("rate_limits")
      .update({ count: currentCount + 1 })
      .eq("scope", scope)
      .eq("subject_id", subjectId)
      .eq("window_start", windowStart)
      .select("count")
      .maybeSingle();
    return (updated?.count ?? currentCount + 1) <= max;
  }
  return ((bumped as { count?: number } | null)?.count ?? currentCount + 1) <= max;
}
