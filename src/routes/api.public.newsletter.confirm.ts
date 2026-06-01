// Publiczny endpoint potwierdzenia adresu e-mail dla newslettera (double opt-in).
// GET /api/public/newsletter/confirm?token=...
// Używa supabaseAdmin (omija RLS), bo aktualizuje rekord pending → subscribed.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/api/public/newsletter/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token || token.length < 16 || token.length > 128 || !/^[a-f0-9]+$/i.test(token)) {
          return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
        }

        const { data: sub, error } = await supabaseAdmin
          .from("newsletter_subscribers")
          .select("id, status, confirmation_expires_at")
          .eq("confirmation_token", token)
          .maybeSingle();

        if (error || !sub) {
          return Response.json({ ok: false, error: "not_found" }, { status: 404 });
        }
        if (sub.status === "subscribed") {
          return Response.json({ ok: true, already: true });
        }
        if (sub.confirmation_expires_at && new Date(sub.confirmation_expires_at) < new Date()) {
          return Response.json({ ok: false, error: "expired" }, { status: 410 });
        }

        const { error: updErr } = await supabaseAdmin
          .from("newsletter_subscribers")
          .update({
            status: "subscribed",
            confirmed_at: new Date().toISOString(),
            confirmation_token: null,
            confirmation_expires_at: null,
          })
          .eq("id", sub.id);

        if (updErr) {
          return Response.json({ ok: false, error: updErr.message }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
