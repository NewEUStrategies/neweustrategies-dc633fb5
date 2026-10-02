// Publiczny endpoint samoobsługowego unsubscribe: /api/public/newsletter/unsubscribe?token=...
// GET z przeglądarki → 303 na przyjazną stronę /newsletter/unsubscribe (podobnie jak confirm).
// GET z fetch (Accept: */*) → JSON walidacyjny (token istnieje?). GET nigdy nie mutuje:
// skanery linków w bramkach pocztowych wykonują GET i wypisywałyby ludzi mimowolnie.
// POST → wykonuje wypisanie (idempotentnie); klienci pocztowi (Gmail/Yahoo) wykonują
// one-click przez POST zgodnie z List-Unsubscribe-Post (RFC 8058). To jest adres z
// nagłówka List-Unsubscribe kampanii (`@/lib/newsletter/unsubscribeUrl`).
//
// PRZYCZYNA ŹRÓDŁOWA (wypis bez blokady). POST zmieniał wyłącznie
// `newsletter_subscribers.status`. Kanoniczna lista wykluczeń
// (`email_suppressions`) nie dostawała wpisu, więc digesty i każda inna wysyłka
// „za zgodą" pytająca bramę listy wykluczeń nadal szła na adres, który właśnie
// wycofał zgodę - a import CSV albo ręczna zmiana statusu w CRM po cichu
// przywracały go do audiencji kampanii. Teraz wypis idzie przez TO SAMO RPC co
// /email/unsubscribe (`email_unsubscribe_by_token`): status subskrybenta i
// blokada `unsubscribe` w tenancie subskrybenta powstają w JEDNEJ transakcji
// albo wcale.
import { createFileRoute } from "@tanstack/react-router";
import { NEWSLETTER_UNSUBSCRIBE_PAGE_PATH } from "@/lib/newsletter/unsubscribeUrl";

export function isValidUnsubToken(token: string | null): token is string {
  return !!token && token.length >= 16 && token.length <= 128 && /^[a-f0-9]+$/i.test(token);
}

function wantsHtml(accept: string | null): boolean {
  return !!accept && accept.includes("text/html");
}

interface UnsubscribePost {
  token: string | null;
  /**
   * One-click RFC 8058: ciało niesie pole `List-Unsubscribe`. Takie żądanie
   * nadaje infrastruktura dostawcy poczty (serwery Gmaila, Yahoo, Outlooka),
   * nie przeglądarka odbiorcy - patrz `passesRateLimit`.
   */
  oneClick: boolean;
}

/**
 * Formularz z ciała. RFC 8058 dopuszcza OBA kodowania formularza - przykład
 * w samym RFC to `multipart/form-data` - więc parsujemy oba. Uszkodzone ciało
 * to brak formularza, nie błąd: token i tak jedzie w adresie.
 */
async function readForm(
  request: Request,
  contentType: string,
): Promise<URLSearchParams | FormData | null> {
  try {
    return contentType.includes("multipart/form-data")
      ? await request.formData()
      : new URLSearchParams(await request.text());
  } catch {
    return null;
  }
}

/**
 * Token z żądania POST. Trzy kształty ciała, jedna reguła: ciało, które tokenu
 * NIE niesie, nie unieważnia tokenu z adresu.
 *
 *  * one-click RFC 8058 - formularz (`application/x-www-form-urlencoded` albo
 *    `multipart/form-data`) z samym `List-Unsubscribe=One-Click`; token jest
 *    wyłącznie w query adresu z nagłówka. Pole `token` w takim ciele jest
 *    ignorowane: wiąże nas adres z nagłówka, który sami wysłaliśmy temu
 *    odbiorcy, nie dopisek w ciele,
 *  * strona /newsletter/unsubscribe - JSON `{ token }`,
 *  * zwykły formularz - pole `token`.
 *
 * Wcześniej każde ciało inne niż parsowalny JSON z tokenem kończyło się 400:
 * `request.json()` na JSON-ie BEZ pola `token` nie rzucał, więc zapas na query
 * nigdy się nie uruchamiał. Ta sama semantyka co w /email/unsubscribe.
 */
async function readUnsubscribePost(request: Request): Promise<UnsubscribePost> {
  const fromQuery = new URL(request.url).searchParams.get("token");
  const contentType = request.headers.get("content-type") ?? "";

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await readForm(request, contentType);
    if (form?.has("List-Unsubscribe")) return { token: fromQuery, oneClick: true };
    const formToken = form?.get("token");
    return {
      token: typeof formToken === "string" && formToken ? formToken : fromQuery,
      oneClick: false,
    };
  }

  if (contentType.includes("application/json")) {
    try {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) {
        const value = (body as Record<string, unknown>).token;
        if (typeof value === "string" && value) return { token: value, oneClick: false };
      }
    } catch {
      // Puste albo nieparsowalne ciało - zostaje token z query.
    }
  }
  return { token: fromQuery, oneClick: false };
}

// Abuse guard: publiczny, niewymagający auth endpoint z zapisem do bazy -
// cap per IP (jak newsletter.subscribe); brak IP -> fail-open (nie blokujemy
// prawdziwych klików zza nietypowych proxy).
//
// Adres bierze się z JEDNEJ definicji „kto dzwoni" (`@/lib/http/rateLimit`):
// `cf-connecting-ip` -> `x-real-ip` -> OSTATNI wpis `x-forwarded-for`. Pierwszy
// wpis XFF dopisuje klient, więc kubełek po nim kluczowany rotował się jednym
// nagłówkiem. "unknown" traktujemy tu jak BRAK adresu, bo ten endpoint jest
// świadomie fail-OPEN: wypis z listy to obowiązek prawny, nie funkcja
// opcjonalna, i nie wolno go odciąć człowiekowi zza nietypowego proxy.
//
// One-click ma OSOBNY, szeroki kubełek. Ten endpoint jest adresem z nagłówka
// List-Unsubscribe, a one-click POST-uje serwer dostawcy poczty - setki
// odbiorców Gmaila wychodzą przez tę samą pulę adresów Google. Wspólny
// kubełek „10 na 10 minut" odciąłby jedenastego odbiorcę po każdej większej
// kampanii (wypisy skupiają się w pierwszych godzinach), a odpowiedzi 429
// nikt nie powtórzy: odbiorca widzi „wypisano" w skrzynce i dalej dostaje
// maile. Limit zostaje (ciało one-click może dopisać każdy), ale na skali
// bramki pocztowej, nie człowieka - i nie zjada budżetu stronie wypisu.
const UNSUBSCRIBE_LIMITS = {
  page: { scope: "newsletter.unsubscribe", max: 10 },
  oneClick: { scope: "newsletter.unsubscribe.one_click", max: 300 },
} as const;

async function passesRateLimit(request: Request, oneClick: boolean): Promise<boolean> {
  const { rateLimitIpSubject } = await import("@/lib/http/rateLimit");
  const subject = rateLimitIpSubject(request.headers);
  const clientIp = subject === "unknown" ? null : subject;
  if (!clientIp) return true;
  const { rateLimit } = await import("@/lib/server/rate-limit.server");
  const bucket = oneClick ? UNSUBSCRIBE_LIMITS.oneClick : UNSUBSCRIBE_LIMITS.page;
  return rateLimit({
    scope: bucket.scope,
    subjectId: clientIp,
    max: bucket.max,
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
          const target = new URL(NEWSLETTER_UNSUBSCRIBE_PAGE_PATH, url.origin);
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
        const { token, oneClick } = await readUnsubscribePost(request);
        if (!isValidUnsubToken(token)) {
          return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
        }
        if (!(await passesRateLimit(request, oneClick))) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }
        const [{ supabaseAdmin }, { unsubscribeByToken }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/email/suppression.server"),
        ]);
        // JEDNO wywołanie zamiast odczytu i osobnego zapisu: RPC sam znajduje
        // subskrybenta po tokenie (blokada wiersza), wypisuje go i stawia
        // blokadę `unsubscribe` w JEGO tenancie. Ponowny klik (także dla wierszy
        // wypisanych przed tą poprawką) dopisuje brakującą blokadę idempotentnie
        // i raportuje `already`. Token zostaje w rekordzie po wypisie - to on
        // czyni operację idempotentną (re-klik trafia tutaj zamiast w 404).
        const result = await unsubscribeByToken(supabaseAdmin, token);
        if (!result.ok) {
          if (result.error === "unknown_token" || result.error === "missing_token") {
            return Response.json({ ok: false, error: "not_found" }, { status: 404 });
          }
          // Komunikat Postgresa niesie nazwy tabel, kolumn i ograniczeń - na
          // ścieżce dostępnej bez sesji to darmowa mapa schematu. Do klienta
          // idzie stały kod, do logu workera pełna treść; bez tego logu
          // tracimy diagnostykę nieudanych wypisów, których nikt nie zgłosi.
          // 500 (nie cichy sukces) każe bramce pocztowej powtórzyć żądanie.
          console.error("[newsletter.unsubscribe] unsubscribe failed", result.error);
          return Response.json({ ok: false, error: "update_failed" }, { status: 500 });
        }
        return Response.json(
          result.alreadyUnsubscribed ? { ok: true, already: true } : { ok: true },
        );
      },
    },
  },
});
