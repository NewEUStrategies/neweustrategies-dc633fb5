// Publiczny webhook do wymuszenia regeneracji og:image dla /author/$slug.
// Do wywołania przez CI / integracje zewnętrzne / cron. Bumpuje
// `profiles.updated_at` co przekłada się na nową wersję `?v=` doklejaną
// przez `withOgVersion` w head() - scrapery uznają zasób za zmieniony.
//
// Autoryzacja: HMAC-SHA256 z sekretu `OG_REFRESH_SECRET` nad `slug`.
// Nagłówek: `x-og-signature: <hex>`. Bez sekretu w env → 501 (opt-in).
// Autor SPA używa server function `refreshAuthorOgImage` (JWT), nie tego endpointu.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const Body = z.object({
  slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/i),
});

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/refresh-og-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.OG_REFRESH_SECRET;
        if (!secret) {
          return new Response(
            JSON.stringify({ error: "OG_REFRESH_SECRET not configured" }),
            { status: 501, headers: { "Content-Type": "application/json" } },
          );
        }
        const raw = await request.text();
        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(JSON.parse(raw));
        } catch {
          return new Response(JSON.stringify({ error: "Invalid body" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const sig = request.headers.get("x-og-signature") ?? "";
        const expected = createHmac("sha256", secret).update(parsed.slug).digest("hex");
        if (!safeEq(sig, expected)) {
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const nowIso = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .update({ updated_at: nowIso })
          .eq("slug", parsed.slug)
          .select("id, slug, updated_at")
          .maybeSingle();
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!data) {
          return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const row = data as { id: string; slug: string; updated_at: string | null };
        return Response.json({
          ok: true,
          slug: row.slug,
          version: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
        });
      },
    },
  },
});
