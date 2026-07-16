// Beacon endpoint: kliknięcia w rekomendacje trafiają tutaj i zapisują wpis
// do `related_post_clicks`. Publiczny prefix `/api/public/*` pomija auth
// broker Lovable, więc rate-limit + walidacja zależności musi być tutaj.
//
// - Walidacja Zod (uuid + uuid, różne).
// - Rate limit: max 30 wpisów / 5 min z tego samego `viewer_hash`.
// - Tenant rozwiązywany z kolumny `posts.tenant_id` (spójne z RLS-em tabeli).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createHash } from "crypto";

const BodySchema = z.object({
  sourcePostId: z.string().uuid(),
  targetPostId: z.string().uuid(),
});

function viewerHashFrom(req: Request): string {
  const ip =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "0.0.0.0";
  const ua = req.headers.get("user-agent") ?? "";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex");
}

export const Route = createFileRoute("/api/public/related-click")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const parsed = BodySchema.safeParse(payload);
        if (!parsed.success) {
          return new Response("Invalid body", { status: 400 });
        }
        if (parsed.data.sourcePostId === parsed.data.targetPostId) {
          return new Response("Self-reference", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const viewer = viewerHashFrom(request);

        // Rate-limit: 30 klik / 5 min z jednego viewer_hash
        const since = new Date(Date.now() - 5 * 60_000).toISOString();
        const { count } = await supabaseAdmin
          .from("related_post_clicks")
          .select("id", { count: "exact", head: true })
          .eq("viewer_hash", viewer)
          .gte("clicked_at", since);
        if ((count ?? 0) >= 30) {
          return new Response("Too many requests", { status: 429 });
        }

        // Rozwiązanie tenanta z posts.tenant_id (musi się zgadzać dla obu)
        const { data: srcPost, error: srcErr } = await supabaseAdmin
          .from("posts")
          .select("tenant_id")
          .eq("id", parsed.data.sourcePostId)
          .maybeSingle();
        if (srcErr || !srcPost) return new Response("Source not found", { status: 404 });

        const { data: tgtPost, error: tgtErr } = await supabaseAdmin
          .from("posts")
          .select("tenant_id")
          .eq("id", parsed.data.targetPostId)
          .maybeSingle();
        if (tgtErr || !tgtPost) return new Response("Target not found", { status: 404 });
        if (tgtPost.tenant_id !== srcPost.tenant_id) {
          return new Response("Cross-tenant blocked", { status: 400 });
        }

        const { error: insErr } = await supabaseAdmin.from("related_post_clicks").insert({
          tenant_id: srcPost.tenant_id,
          source_post_id: parsed.data.sourcePostId,
          target_post_id: parsed.data.targetPostId,
          viewer_hash: viewer,
        });
        if (insErr) return new Response(insErr.message, { status: 500 });

        return new Response("ok", { status: 202 });
      },
      // sendBeacon może w niektórych przeglądarkach wykonać preflight
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "content-type",
          },
        }),
    },
  },
});
