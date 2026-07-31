// Wypis z poczty systemowej: GET (walidacja tokenu) + POST (wypis).
//
// Obsługuje RFC 8058 „one-click": klient pocztowy (Gmail, Apple Mail) POST-uje
// tu formularz `List-Unsubscribe=One-Click` bez żadnej interakcji ze stroną, a
// wytyczne Google/Yahoo dla nadawców masowych wymagają, by taki wypis działał
// bezwarunkowo i w ciągu dwóch dni.
//
// PRZYCZYNA ŹRÓDŁOWA. Wypis zapisywał blokadę do zaszłej tabeli
// `suppressed_emails`, której NIE czytała wysyłka kampanii (ta patrzyła w
// kanoniczne `email_suppressions`). Odbiorca klikał „wypisz się", dostawał
// potwierdzenie - i dalej dostawał newsletter. Teraz cała praca dzieje się w
// jednej transakcji SQL (`email_unsubscribe_by_token`): zużycie tokenu, blokada
// na liście kanonicznej i - przez trigger - zdjęcie subskrypcji.
import { createFileRoute } from "@tanstack/react-router";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Token z żądania. Dla one-click przychodzi w query (ciało niesie wtedy tylko
 * `List-Unsubscribe=One-Click`); strona aplikacji przysyła go w JSON-ie, a
 * zwykły formularz - w polu `token`.
 */
async function tokenFromRequest(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("token");
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(await request.text());
    if (!params.get("List-Unsubscribe")) {
      const formToken = params.get("token");
      if (formToken) return formToken;
    }
    return fromQuery;
  }

  if (contentType.includes("application/json")) {
    try {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) {
        const value = (body as Record<string, unknown>).token;
        if (typeof value === "string" && value) return value;
      }
    } catch {
      // Nieparsowalne ciało - zostaje token z query.
    }
  }
  return fromQuery;
}

export const Route = createFileRoute("/email/unsubscribe")({
  server: {
    handlers: {
      // Walidacja przed pokazaniem strony potwierdzenia. Odpowiedź NIE zawiera
      // adresu e-mail: token trafia do logów proxy i historii przeglądarki, więc
      // nie może służyć do odczytania, kto się pod nim kryje.
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token");
        if (!token) return json({ error: "Token is required" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: record } = await supabaseAdmin
          .from("email_unsubscribe_tokens")
          .select("used_at")
          .eq("token", token)
          .maybeSingle();

        if (record) {
          return json(
            record.used_at ? { valid: false, reason: "already_unsubscribed" } : { valid: true },
          );
        }

        // Token per subskrybent newslettera (stopka kampanii) jest długowieczny
        // i nie ma znacznika użycia - jego istnienie wystarcza.
        const { data: subscriber } = await supabaseAdmin
          .from("newsletter_subscribers")
          .select("status")
          .eq("unsubscribe_token", token)
          .maybeSingle();
        if (!subscriber) return json({ error: "Invalid or expired token" }, 404);
        return json(
          subscriber.status === "unsubscribed"
            ? { valid: false, reason: "already_unsubscribed" }
            : { valid: true },
        );
      },

      POST: async ({ request }) => {
        const token = await tokenFromRequest(request);
        if (!token) return json({ error: "Token is required" }, 400);

        const [{ supabaseAdmin }, { unsubscribeByToken }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/email/suppression.server"),
        ]);

        const result = await unsubscribeByToken(supabaseAdmin, token);

        if (!result.ok) {
          if (result.error === "unknown_token" || result.error === "missing_token") {
            return json({ error: "Invalid or expired token" }, 404);
          }
          console.error("[unsubscribe] failed", { error: result.error });
          return json({ error: "Failed to process unsubscribe" }, 500);
        }

        // Ponowne kliknięcie w ten sam link nie jest błędem: blokada już jest,
        // a klient pocztowy potrafi POST-ować one-click wielokrotnie.
        if (result.alreadyUnsubscribed) {
          return json({ success: true, reason: "already_unsubscribed" });
        }

        // Log bez adresu i bez tokenu: jedno i drugie jest PII/sekretem, a do
        // diagnostyki wystarczy fakt i tenant.
        console.log("[unsubscribe] recorded", { tenant: result.tenantId });
        return json({ success: true });
      },
    },
  },
});
