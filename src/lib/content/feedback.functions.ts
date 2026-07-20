// Feedback przydatności analizy (A9). Publiczny server fn: service role z
// tenantem pinowanym po hoście żądania (wzorzec submitContactMessage),
// rate limit per IP, dedup po skrócie IP+UA per wpis (drugi głos tego samego
// czytelnika w 30 dni jest cicho ignorowany - bez błędu w UI).
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const submitPostFeedback = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) =>
    z.object({ postId: z.string().uuid(), helpful: z.boolean() }).parse(i ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ resolveTenantIdForHost }, { currentTenantHost }, { rateLimit }] = await Promise.all([
      import("@/lib/server/tenant.server"),
      import("@/lib/http/requestHost"),
      import("@/lib/server/rate-limit.server"),
    ]);
    const tenantId = await resolveTenantIdForHost(await currentTenantHost());
    if (!tenantId) throw new Error("tenant unresolved");

    let clientIp = "unknown-ip";
    let userAgent = "";
    try {
      const req = getRequest();
      const fwd = req.headers.get("x-forwarded-for");
      clientIp =
        req.headers.get("cf-connecting-ip") ??
        (fwd ? (fwd.split(",")[0]?.trim() ?? "unknown-ip") : "unknown-ip");
      userAgent = req.headers.get("user-agent") ?? "";
    } catch {
      /* brak kontekstu HTTP - zostają wartości domyślne */
    }
    // Fail-closed na nieznanym IP (wspólny kubełek) jak contact.submit.
    if (!(await rateLimit({ scope: "post.feedback", subjectId: clientIp, max: 20 }))) {
      throw new Error("rate_limited");
    }

    // Wpis musi być opublikowany i widoczny w tym tenancie.
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("id")
      .eq("id", data.postId)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .is("deleted_at", null)
      .maybeSingle();
    if (!post) throw new Error("post not found");

    const voterHash = await sha256Hex(`${tenantId}:${data.postId}:${clientIp}:${userAgent}`);
    const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from("post_feedback")
      .select("id")
      .eq("post_id", data.postId)
      .eq("voter_hash", voterHash)
      .gte("created_at", since)
      .limit(1);
    if (existing && existing.length > 0) return { ok: true as const, duplicate: true as const };

    const { error } = await supabaseAdmin.from("post_feedback").insert({
      tenant_id: tenantId,
      post_id: data.postId,
      helpful: data.helpful,
      voter_hash: voterHash,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const, duplicate: false as const };
  });
