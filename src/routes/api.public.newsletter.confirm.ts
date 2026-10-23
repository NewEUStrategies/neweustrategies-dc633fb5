// Publiczny endpoint potwierdzenia adresu e-mail dla newslettera (double opt-in).
// GET  /api/public/newsletter/confirm?token=...
// POST /api/public/newsletter/confirm  {token, decision: "grant"|"decline"}
// Używa supabaseAdmin (omija RLS), bo aktualizuje rekord pending → subscribed.
//
// Kontrakt (kształty: `@/lib/newsletter/confirmMeasurement`):
// - Przeglądarka (Accept: text/html) dostaje 303 na stronę /newsletter/confirm,
//   która renderuje przyjazny, zlokalizowany wynik - stare maile linkujące
//   bezpośrednio do API nigdy nie pokazują surowego JSON-a.
// - Klienci programistyczni (fetch ze strony) dostają JSON.
// - Potwierdzenie jest idempotentne: token NIE jest kasowany po sukcesie,
//   więc ponowne kliknięcie tego samego linku zwraca { already: true }
//   zamiast błędu not_found.
// - OSOBNA ZGODA NA POMIAR (I9d-Y2b, decyzje właściciela 2026-10-23: D1
//   wariant (b), D2 - pomiar tylko dla skrzynki potwierdzonej przez jej
//   właściciela). Odpowiedź GET po sukcesie (także `already`) niesie stan
//   karty zgody na pomiar z `newsletter_doi_measurement_state`
//   (`measurement`, `measurementLang`); karta pojawia się tylko, gdy
//   w formularzu zaznaczono osobne pole pomiaru. FAIL-CLOSED: błąd RPC albo
//   nieznany stan -> `measurement: "none"` (brak karty). GET NIGDY nie
//   udziela zgody - skanery linków w bramkach pocztowych wykonują GET na
//   każdym adresie z maila, a zgoda ma być świadomym działaniem osoby
//   (art. 4 pkt 11 i art. 7 ust. 1 RODO).
// - Decyzję z karty zapisuje WYŁĄCZNIE POST (przycisk): tylko
//   `content-type: application/json` (formularz z obcej strony nie przejdzie
//   bez zapytania wstępnego CORS), limiter per IP, potem
//   `newsletter_doi_measurement_decide` (tylko service_role). Token DOI
//   z linku maila to dowód skrzynki; „tak" zapisuje baza z kanałem
//   `measurement:doi`, treścią i wersją pola pomiaru, IP i User-Agentem.
//   Odpowiedzi nigdy nie zawierają adresu e-mail ani komunikatu Postgresa.
import { createFileRoute } from "@tanstack/react-router";
import { consentLangOf } from "@/lib/newsletter/consentSegments";
import {
  doiMeasurementDecisionError,
  doiMeasurementDecisionReplyOf,
  doiMeasurementFieldsOf,
  isConfirmTokenFormat,
  parseDoiMeasurementDecisionRequest,
  type DoiMeasurementDecisionReply,
  type DoiMeasurementFields,
  type NewsletterConfirmGetResponse,
} from "@/lib/newsletter/confirmMeasurement";
import type { RpcCallable } from "@/lib/revenue/rpcCallable";

/** A confirmation token is 16-128 hex chars (jedna reguła z `confirmMeasurement`). */
export function isValidConfirmToken(token: string | null): token is string {
  return isConfirmTokenFormat(token);
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
  // Only a pending row may be confirmed. The token is deliberately retained
  // after use (for idempotency), so any other status - e.g. an address that
  // later unsubscribed - must NOT be silently resurrected by re-clicking the
  // old link; treat it as a stale link.
  if (sub.status !== "pending") return { kind: "expired" };
  if (sub.confirmation_expires_at && new Date(sub.confirmation_expires_at) < now) {
    return { kind: "expired" };
  }
  return { kind: "confirm" };
}

/** Czy zapytanie pochodzi z nawigacji przeglądarki (klik w link z maila)? */
export function wantsHtml(acceptHeader: string | null): boolean {
  return !!acceptHeader && acceptHeader.includes("text/html");
}

/** Czy ciało POST to JSON (jedyny przyjmowany typ decyzji z karty). */
export function isJsonRequest(contentType: string | null): boolean {
  return !!contentType && contentType.toLowerCase().includes("application/json");
}

/**
 * Limit per IP decyzji z karty: osoba klika raz, czasem dwa (jak strona
 * pomiaru). Brak IP -> fail-open: token DOI jest i tak dowodem skrzynki,
 * a decyzja nie może się nie udać człowiekowi zza nietypowego proxy.
 */
export const CONFIRM_MEASUREMENT_LIMIT = {
  scope: "newsletter.confirm_measurement",
  max: 10,
  windowMinutes: 10,
} as const;

async function clientSubject(request: Request): Promise<string | null> {
  const { rateLimitIpSubject } = await import("@/lib/http/rateLimit");
  const subject = rateLimitIpSubject(request.headers);
  return subject === "unknown" ? null : subject;
}

async function passesRateLimit(ip: string | null): Promise<boolean> {
  if (!ip) return true;
  const { rateLimit } = await import("@/lib/server/rate-limit.server");
  return rateLimit({
    scope: CONFIRM_MEASUREMENT_LIMIT.scope,
    subjectId: ip,
    max: CONFIRM_MEASUREMENT_LIMIT.max,
    windowMinutes: CONFIRM_MEASUREMENT_LIMIT.windowMinutes,
  });
}

function json(body: NewsletterConfirmGetResponse, status = 200): Response {
  return Response.json(body, { status });
}

function decisionResponse(reply: DoiMeasurementDecisionReply): Response {
  return Response.json(reply.body, { status: reply.status });
}

/**
 * Stan karty zgody na pomiar dla potwierdzonego zapisu (odczyt bez mutacji).
 * Fail-closed: każda awaria daje `none` - lepiej nie zapytać o zgodę, niż
 * pokazać kartę dla stanu, którego baza nie potwierdziła. Język treści
 * zgody: z RPC, a awaryjnie z wiersza (ta sama reguła co zapis w SQL).
 */
async function doiMeasurementFields(
  admin: unknown,
  token: string,
  language: string | null | undefined,
): Promise<DoiMeasurementFields> {
  const fallbackLang = consentLangOf(language);
  try {
    // RPC spoza wygenerowanych typów do czasu regeneracji `types.ts` - nazwa
    // zostaje LITERAŁEM (bramka kontraktu TS <-> SQL).
    const { data, error } = await (admin as RpcCallable).rpc("newsletter_doi_measurement_state", {
      p_token: token,
    });
    if (error) {
      console.error("[newsletter/confirm] measurement state failed", error.message);
      return doiMeasurementFieldsOf(null, fallbackLang);
    }
    return doiMeasurementFieldsOf(data, fallbackLang);
  } catch (err) {
    console.error(
      "[newsletter/confirm] measurement state failed",
      err instanceof Error ? err.message : String(err),
    );
    return doiMeasurementFieldsOf(null, fallbackLang);
  }
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
          return json({ ok: false, error: "invalid_token" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: sub, error } = await supabaseAdmin
          .from("newsletter_subscribers")
          .select(
            "id, status, confirmation_expires_at, tenant_id, email, language, first_name, display_name",
          )
          .eq("confirmation_token", token)
          .maybeSingle();

        if (error || !sub) {
          return json({ ok: false, error: "not_found" }, 404);
        }

        const outcome = resolveConfirmOutcome(sub, new Date());
        if (outcome.kind === "already") {
          // Ponowny klik: karta pomiaru wraca, dopóki osoba nie zdecydowała.
          const measurement = await doiMeasurementFields(supabaseAdmin, token, sub.language);
          return json({ ok: true, already: true, ...measurement });
        }
        if (outcome.kind === "expired") {
          return json({ ok: false, error: "expired" }, 410);
        }

        // Potwierdzony ponowny zapis zdejmuje wcześniejszy wypis z listy
        // wykluczeń, ZANIM wiersz stanie się `subscribed`: inaczej kampanie
        // i mail powitalny (kategoria `bulk`) pomijałyby potwierdzonego
        // subskrybenta. Nieudane zdjęcie nie zmienia niczego, więc ponowny klik
        // w ten sam link ponawia całość.
        const { releaseUnsubscribeOnOptIn } = await import("@/lib/email/suppression.server");
        if (!(await releaseUnsubscribeOnOptIn(supabaseAdmin, sub.tenant_id, sub.email))) {
          return json({ ok: false, error: "confirm_failed" }, 500);
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
          // Komunikat Postgresa niesie nazwy tabel i kolumn - do klienta idzie
          // stały kod, pełna treść do logu workera.
          console.error("[newsletter/confirm] update failed", updErr.message);
          return json({ ok: false, error: "update_failed" }, 500);
        }

        // Potwierdzenie zapisu (kolejka transakcyjna) - ten sam mail co w
        // ścieżce bez double opt-in. Klucz idempotencji pilnuje, że ponowne
        // kliknięcie linku nie wyśle go drugi raz, a e-mail jest zarazem
        // wejściem do automatyzacji sekwencji powitalnych.
        const lang = sub.language === "en" ? "en" : "pl";
        try {
          const { sendTxEmail } = await import("@/lib/email/transactional.server");
          await sendTxEmail({
            type: "newsletter_confirmed",
            to: sub.email,
            lang,
            metaName: sub.first_name ?? sub.display_name,
            ctaPath: lang === "en" ? "/en/analyses" : "/analizy",
            idempotencyKey: `newsletter_confirmed:${sub.tenant_id}:${sub.email}`,
            tenantId: sub.tenant_id,
          });
        } catch (mailErr) {
          // Subskrypcja jest potwierdzona - brak maila powitalnego nie może
          // zwrócić błędu użytkownikowi.
          console.error("[newsletter/confirm] welcome mail failed", mailErr);
        }

        // Stan karty PO zmianie statusu: oferta istnieje wyłącznie dla
        // aktywnego subskrybenta (D2 - `pending` nigdy nie dostaje pomiaru).
        const measurement = await doiMeasurementFields(supabaseAdmin, token, sub.language);
        return json({ ok: true, ...measurement });
      },
      POST: async ({ request }) => {
        if (!isJsonRequest(request.headers.get("content-type"))) {
          return decisionResponse(doiMeasurementDecisionError("unsupported_media_type"));
        }
        let body: unknown = null;
        try {
          body = await request.json();
        } catch {
          // Puste albo nieparsowalne ciało - parser odpowie `invalid_token`.
        }
        const parsed = parseDoiMeasurementDecisionRequest(body);
        if (!parsed.ok) return decisionResponse(doiMeasurementDecisionError(parsed.error));
        const ip = await clientSubject(request);
        if (!(await passesRateLimit(ip))) {
          return decisionResponse(doiMeasurementDecisionError("rate_limited"));
        }
        const userAgent = request.headers.get("user-agent");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await (supabaseAdmin as unknown as RpcCallable).rpc(
            "newsletter_doi_measurement_decide",
            {
              p_token: parsed.request.token,
              p_grant: parsed.request.decision === "grant",
              p_ip: ip,
              p_user_agent: userAgent,
            },
          );
          if (error) {
            console.error("[newsletter/confirm] measurement decision failed", error.message);
            return decisionResponse(doiMeasurementDecisionError("update_failed"));
          }
          const reply = doiMeasurementDecisionReplyOf(data);
          if (reply === null) {
            console.error("[newsletter/confirm] measurement decision: unexpected result shape");
            return decisionResponse(doiMeasurementDecisionError("update_failed"));
          }
          return decisionResponse(reply);
        } catch (err) {
          console.error(
            "[newsletter/confirm] measurement decision failed",
            err instanceof Error ? err.message : String(err),
          );
          return decisionResponse(doiMeasurementDecisionError("update_failed"));
        }
      },
    },
  },
});
