// Publiczny endpoint samoobsługowego unsubscribe: /api/public/newsletter/unsubscribe?token=...
// GET z przeglądarki → 303 na przyjazną stronę /newsletter/unsubscribe (podobnie jak confirm).
// GET z fetch (Accept: */*) → JSON walidacyjny (token istnieje?). GET nigdy nie mutuje:
// skanery linków w bramkach pocztowych wykonują GET i wypisywałyby ludzi mimowolnie.
// POST → wykonuje wypisanie (idempotentnie); klienci pocztowi (Gmail/Yahoo) wykonują
// one-click przez POST zgodnie z List-Unsubscribe-Post (RFC 8058).
import { createFileRoute } from "@tanstack/react-router";

export function isValidUnsubToken(token: string | null): token is string {
  return !!token && token.length >= 16 && token.length <= 128 && /^[a-f0-9]+$/i.test(token);
}

function wantsHtml(accept: string | null): boolean {
  return !!accept && accept.includes("text/html");
}

// Abuse guard: publiczny, niewymagający auth endpoint z zapisem do bazy -
// cap per IP (jak newsletter.subscribe); brak IP -> fail-open (nie blokujemy
// prawdziwych klików zza nietypowych proxy).
async function passesRateLimit(request: Request): Promise<boolean> {
  const fwd = request.headers.get("x-forwarded-for");
  const fwdFirst = fwd ? (fwd.split(",")[0]?.trim() ?? null) : null;
  const clientIp =
    request.headers.get("cf-connecting-ip") ?? fwdFirst ?? request.headers.get("x-real-ip");
  if (!clientIp) return true;
  const { rateLimit } = await import("@/lib/server/rate-limit.server");
  return rateLimit({
    scope: "newsletter.unsubscribe",
    subjectId: clientIp,
    max: 10,
    windowMinutes: 10,
  });
}

export const Route = createFileRoute("/api/public/newsletter/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");

        if (wantsHtml(request.headers.get("accept"))) {
          const target = new URL("/newsletter/unsubscribe", url.origin);
          if (token) target.searchParams.set("token", token);
          return Response.redirect(target.toString(), 303);
        }
        if (!isValidUnsubToken(token)) {
          return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: sub, error } = await supabaseAdmin
          .from("newsletter_subscribers")
          .select("id, status")
          .eq("unsubscribe_token", token)
          .maybeSingle();
        if (error || !sub) {
          return Response.json({ ok: false, error: "not_found" }, { status: 404 });
        }
        // Intentionally do NOT return the subscriber's e-mail. The unsubscribe
        // token is reused as the open/click tracking token, so it rides in every
        // newsletter link and pixel (forwarded mail, mail-gateway logs, shared
        // inboxes); echoing even a masked address would let any token holder
        // recover the recipient's domain + initials. The friendly page falls
        // back to a generic prompt when no e-mail is supplied.
        return Response.json({
          ok: true,
          already: sub.status === "unsubscribed",
        });
      },
      POST: async ({ request }) => {
        let token: string | null = null;
        try {
          const body = (await request.json()) as { token?: unknown };
          if (typeof body.token === "string") token = body.token;
        } catch {
          const url = new URL(request.url);
          token = url.searchParams.get("token");
        }
        if (!isValidUnsubToken(token)) {
          return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
        }
        if (!(await passesRateLimit(request))) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: sub, error } = await supabaseAdmin
          .from("newsletter_subscribers")
          .select("id, status")
          .eq("unsubscribe_token", token)
          .maybeSingle();
        if (error || !sub) {
          return Response.json({ ok: false, error: "not_found" }, { status: 404 });
        }
        if (sub.status === "unsubscribed") {
          // Token zostaje w rekordzie po wypisie - to on czyni operację
          // idempotentną (re-klik trafia tutaj zamiast w 404).
          return Response.json({ ok: true, already: true });
        }
        const { error: updErr } = await supabaseAdmin
          .from("newsletter_subscribers")
          .update({
            status: "unsubscribed",
            unsubscribed_at: new Date().toISOString(),
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
