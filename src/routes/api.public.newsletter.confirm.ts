// Publiczny endpoint potwierdzenia adresu e-mail dla newslettera (double opt-in).
// GET /api/public/newsletter/confirm?token=...
// Używa supabaseAdmin (omija RLS), bo aktualizuje rekord pending → subscribed.
//
// Kontrakt:
// - Przeglądarka (Accept: text/html) dostaje 303 na stronę /newsletter/confirm,
//   która renderuje przyjazny, zlokalizowany wynik - stare maile linkujące
//   bezpośrednio do API nigdy nie pokazują surowego JSON-a.
// - Klienci programistyczni (fetch ze strony) dostają JSON.
// - Potwierdzenie jest idempotentne: token NIE jest kasowany po sukcesie,
//   więc ponowne kliknięcie tego samego linku zwraca { already: true }
//   zamiast błędu not_found.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** A confirmation token is 16-128 lowercase-hex chars. Exported for tests. */
export function isValidConfirmToken(token: string | null): token is string {
  return !!token && token.length >= 16 && token.length <= 128 && /^[a-f0-9]+$/i.test(token);
}

export interface ConfirmSubscriberRow {
  id: string;
  status: string;
  confirmation_expires_at: string | null;
}

export type ConfirmOutcome = { kind: "already" } | { kind: "expired" } | { kind: "confirm" };

/**
 * Czysta decyzja o wyniku potwierdzenia dla znalezionego rekordu.
 * Kolejność ma znaczenie: subskrybent już potwierdzony wygrywa z wygasłym
 * tokenem (re-klik po sukcesie musi zwrócić "already", nie "expired").
 */
export function resolveConfirmOutcome(sub: ConfirmSubscriberRow, now: Date): ConfirmOutcome {
  if (sub.status === "subscribed") return { kind: "already" };
  if (sub.confirmation_expires_at && new Date(sub.confirmation_expires_at) < now) {
    return { kind: "expired" };
  }
  return { kind: "confirm" };
}

/** Czy zapytanie pochodzi z nawigacji przeglądarki (klik w link z maila)? */
export function wantsHtml(acceptHeader: string | null): boolean {
  return !!acceptHeader && acceptHeader.includes("text/html");
}

export const Route = createFileRoute("/api/public/newsletter/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");

        // Klik z maila -> przyjazna strona wyniku zamiast surowego JSON-a.
        // Strona wywoła ten endpoint ponownie przez fetch (Accept: */*).
        if (wantsHtml(request.headers.get("accept"))) {
          const target = new URL("/newsletter/confirm", url.origin);
          if (token) target.searchParams.set("token", token);
          return Response.redirect(target.toString(), 303);
        }

        if (!isValidConfirmToken(token)) {
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

        const outcome = resolveConfirmOutcome(sub, new Date());
        if (outcome.kind === "already") {
          return Response.json({ ok: true, already: true });
        }
        if (outcome.kind === "expired") {
          return Response.json({ ok: false, error: "expired" }, { status: 410 });
        }

        // Token zostaje w rekordzie po potwierdzeniu - to on czyni operację
        // idempotentną (re-klik trafia w gałąź "already" zamiast 404). Po
        // sukcesie jest bezużyteczny: potwierdza już potwierdzoną subskrypcję.
        const { error: updErr } = await supabaseAdmin
          .from("newsletter_subscribers")
          .update({
            status: "subscribed",
            confirmed_at: new Date().toISOString(),
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
