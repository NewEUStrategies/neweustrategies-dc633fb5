// Publiczny endpoint linków pomiaru otwarć i kliknięć (I9d-Y2, I9d-Y2b):
// /api/public/newsletter/measurement?token=...
//
// Dwa linki, jedna trasa - rodzaj akcji wynika z PODPISANEGO tokenu
// (`measurementToken.server.ts`), nigdy z parametru adresu:
//   * „Nie mierz moich otwarć i kliknięć" (`mw:`, stopka maili kampanii
//     i ścieżek, strona preferencji) - wycofanie SAMEGO pomiaru: wpis
//     `email_measurement` „nie", zgoda na newsletter bez zmian;
//   * „Potwierdzam / Zgadzam się na pomiar" (`mc:`, jednorazowa prośba
//     z panelu albo prośba po zapisie bez double opt-in z zaznaczonym
//     osobnym polem pomiaru) - zapis OSOBNEJ zgody na pomiar: wpis
//     `email_measurement` „tak" z treścią i wersją pola pomiaru robi WYŁĄCZNIE
//     baza (`_email_measurement_grant`, kanał `measurement:reconfirm` albo
//     `measurement:signup`), bez wpisu zgody na newsletter. Od wariantu (b)
//     decyzji właściciela 2026-10-23 żadna treść zgody na newsletter nie
//     daje pomiaru, a pomiar działa tylko dla aktywnego subskrybenta, który
//     sam potwierdził zgodę (D2).
//
// JĘZYK TREŚCI ZGODY = JĘZYK ZAPISU. GET akcji „zgoda" zwraca `lang`
// subskrybenta (`email_measurement_state`, reguła `consentLangOf` - ta sama
// co w `_email_measurement_grant`): strona pokazuje treść zgody w języku,
// w którym baza ją zapisze, a nie w języku z adresu (art. 7 ust. 1 RODO).
//
// WZORZEC /api/public/newsletter/keep i /unsubscribe:
//   * GET z przeglądarki (Accept: text/html) -> 303 na stronę
//     /newsletter/measurement z przyciskiem; GET z fetch -> walidacja tokenu
//     (dla wycofania także ODCZYT stanu zgody - bez zapisu). GET NIGDY NIE
//     MUTUJE: skanery linków w bramkach pocztowych wykonują GET na każdym
//     adresie z maila - gdyby GET udzielał zgody, skaner zgadzałby się na
//     pomiar za ludzi, którzy maila nie otworzyli (zgoda ma być świadomym
//     działaniem osoby - art. 4 pkt 11 i art. 7 ust. 1 RODO); gdyby wycofywał,
//     skaner wyłączałby pomiar osobom, które o to nie prosiły;
//   * POST (przycisk na stronie) -> limiter per IP -> RPC (tylko service_role):
//     `email_measurement_withdraw` (idempotentne - powtórka `already`) albo
//     `newsletter_measurement_confirm` (nonce prośby jednorazowy). Awaria
//     bazy -> 500, nie cichy sukces: osoba, która chce wyłączyć pomiar, musi
//     wiedzieć, że jej decyzja NIE została zapisana.
//
// Odpowiedzi nie zawierają adresu e-mail ani niczego, co identyfikuje
// odbiorcę - token jedzie w linku maila (przekazana wiadomość, logi bramek).
// IP i User-Agent trafiają WYŁĄCZNIE do wpisu rejestru zgód (dowód decyzji).
import { createFileRoute } from "@tanstack/react-router";
import { normalizeLang } from "@/lib/i18n/localePath";
import type { MeasurementPageCheckBody } from "@/lib/newsletter/confirmMeasurement";
import { consentLangOf } from "@/lib/newsletter/consentSegments";
import {
  measurementChannelOf,
  NEWSLETTER_MEASUREMENT_PAGE_PATH,
  type MeasurementLinkChannel,
} from "@/lib/privacy/measurement";

function wantsHtml(accept: string | null): boolean {
  return !!accept && accept.includes("text/html");
}

/**
 * Limit per IP: osoba klika przycisk raz, czasem dwa. 10 na 10 minut jak
 * strona wypisu; brak IP -> fail-open (wycofanie pomiaru nie może się nie
 * udać człowiekowi zza nietypowego proxy - token i tak jest podpisany).
 */
const MEASUREMENT_LIMIT = {
  scope: "newsletter.measurement",
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
    scope: MEASUREMENT_LIMIT.scope,
    subjectId: ip,
    max: MEASUREMENT_LIMIT.max,
    windowMinutes: MEASUREMENT_LIMIT.windowMinutes,
  });
}

/** Token i kanał z ciała (JSON strony albo formularz), token awaryjnie z adresu. */
async function readPost(
  request: Request,
): Promise<{ token: string | null; channel: MeasurementLinkChannel }> {
  const url = new URL(request.url);
  let token = url.searchParams.get("token");
  let channel: unknown = url.searchParams.get("via");
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) {
        const record = body as Record<string, unknown>;
        if (typeof record.token === "string" && record.token) token = record.token;
        if (record.channel !== undefined) channel = record.channel;
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams(await request.text());
      token = form.get("token") || token;
      channel = form.get("channel") ?? channel;
    }
  } catch {
    // Puste albo nieparsowalne ciało - zostaje token z adresu.
  }
  return { token, channel: measurementChannelOf(channel) };
}

type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

function resultOf<T extends string>(data: unknown, allowed: readonly T[]): T | null {
  const value =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>).result : null;
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : null;
}

/**
 * Wynik `email_measurement_withdraw` (rpc-shape w 20261020162300; od
 * 20261023090300 `withdrawn` także dla odmowy osoby bez zgody).
 */
const WITHDRAW_RESULTS = ["withdrawn", "already", "gone", "invalid"] as const;
/** Wynik `newsletter_measurement_confirm` (rpc-shape w 20261020162500). */
const CONFIRM_RESULTS = ["confirmed", "already", "inactive", "gone", "invalid"] as const;

function tokenError(reason: "invalid" | "expired"): Response {
  return reason === "expired"
    ? Response.json({ ok: false, error: "expired" }, { status: 410 })
    : Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
}

const UPDATE_FAILED = () => Response.json({ ok: false, error: "update_failed" }, { status: 500 });

export const Route = createFileRoute("/api/public/newsletter/measurement")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (wantsHtml(request.headers.get("accept"))) {
          const target = new URL(NEWSLETTER_MEASUREMENT_PAGE_PATH, url.origin);
          if (token) target.searchParams.set("token", token);
          // Język odbiorcy i kanał z linku (zawężone do obsługiwanych - nic
          // innego z adresu nie przechodzi dalej).
          const lang = normalizeLang(url.searchParams.get("lang"));
          if (lang) target.searchParams.set("lang", lang);
          const via = measurementChannelOf(url.searchParams.get("via"));
          if (via !== "email_footer") target.searchParams.set("via", via);
          return Response.redirect(target.toString(), 303);
        }
        const { verifyMeasurementToken } = await import("@/lib/privacy/measurementToken.server");
        const check = verifyMeasurementToken(token);
        if (!check.ok) return tokenError(check.reason);
        if (check.action === "confirm") {
          // Nonce prośby sprawdza dopiero POST - GET niczego nie zużywa.
          // Język treści zgody z wiersza subskrybenta (odczyt bez mutacji);
          // bez niego strona nie pokaże przycisku zgody (błąd z ponowieniem).
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data, error } = await (supabaseAdmin as unknown as RpcCallable).rpc(
              "email_measurement_state",
              { p_subscriber: check.subscriberId, p_lead: null },
            );
            const row =
              !error && typeof data === "object" && data !== null
                ? (data as Record<string, unknown>)
                : null;
            if (row?.result === "gone") {
              return Response.json({ ok: false, error: "not_found" }, { status: 404 });
            }
            if (row?.result === "ok") {
              const body: MeasurementPageCheckBody = {
                ok: true,
                action: "confirm",
                lang: consentLangOf(typeof row.lang === "string" ? row.lang : null),
              };
              return Response.json(body);
            }
            console.error(
              "[newsletter.measurement] confirm state failed",
              error?.message ?? "shape",
            );
          } catch (err) {
            console.error(
              "[newsletter.measurement] confirm state failed",
              err instanceof Error ? err.message : String(err),
            );
          }
          return Response.json({ ok: false, error: "state_failed" }, { status: 500 });
        }
        // Wycofanie: ODCZYT stanu zgody i odmowy (bez zapisu). Strona mówi
        // „pomiar jest wyłączony" tylko przy odmowie już zapisanej; osoba bez
        // zgody i bez odmowy dostaje przycisk - jej odmowa trafia do rejestru
        // i wyklucza ją z próśb (I9d-Y2b R1, zgoda-r1-2).
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const subject = check.subject;
          const { data, error } = await (supabaseAdmin as unknown as RpcCallable).rpc(
            "email_measurement_state",
            subject.kind === "subscriber"
              ? { p_subscriber: subject.subscriberId, p_lead: null }
              : { p_subscriber: null, p_lead: subject.leadId },
          );
          const row =
            !error && typeof data === "object" && data !== null
              ? (data as Record<string, unknown>)
              : null;
          if (row?.result === "gone") {
            return Response.json({ ok: false, error: "not_found" }, { status: 404 });
          }
          if (row?.result === "ok" && typeof row.consent === "boolean") {
            return Response.json({
              ok: true,
              action: "withdraw",
              consent: row.consent,
              // Stara baza bez pola - jak dotąd (odmowa zakładana).
              refused: typeof row.refused === "boolean" ? row.refused : true,
            });
          }
          if (error) console.error("[newsletter.measurement] state failed", error.message);
        } catch (err) {
          console.error("[newsletter.measurement] state failed", err);
        }
        // Awaria odczytu nie blokuje decyzji - przycisk jak zwykle.
        return Response.json({ ok: true, action: "withdraw" });
      },
      POST: async ({ request }) => {
        const { token, channel } = await readPost(request);
        const { verifyMeasurementToken } = await import("@/lib/privacy/measurementToken.server");
        const check = verifyMeasurementToken(token);
        if (!check.ok) return tokenError(check.reason);
        const ip = await clientSubject(request);
        if (!(await passesRateLimit(ip))) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }
        const userAgent = request.headers.get("user-agent");
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const rpc = supabaseAdmin as unknown as RpcCallable;
          if (check.action === "withdraw") {
            const subject = check.subject;
            // RPC pomiaru nie ma jeszcze w wygenerowanych typach - kształt
            // wywołania z nazwą RPC jako literałem (bramka kontraktu TS <-> SQL).
            // Kanał z listy publicznej (stopka, preferencje) - odmowa osoby
            // wyklucza ją z kolejnych próśb; kanał wypisu (neutralny) ustawia
            // wyłącznie wyzwalacz bazy.
            const { data, error } = await rpc.rpc("email_measurement_withdraw", {
              p_subscriber: subject.kind === "subscriber" ? subject.subscriberId : null,
              p_lead: subject.kind === "lead" ? subject.leadId : null,
              p_channel: channel,
              p_ip: ip,
              p_user_agent: userAgent,
            });
            const result = error ? null : resultOf(data, WITHDRAW_RESULTS);
            if (result === null) {
              // Komunikat Postgresa niesie nazwy tabel i kolumn - do klienta
              // idzie stały kod, pełna treść do logu workera.
              console.error("[newsletter.measurement] withdraw failed", error?.message ?? "shape");
              return UPDATE_FAILED();
            }
            switch (result) {
              case "withdrawn":
                return Response.json({ ok: true, action: "withdraw" });
              case "already":
                return Response.json({ ok: true, action: "withdraw", already: true });
              case "gone":
                return Response.json({ ok: false, error: "not_found" }, { status: 404 });
              default:
                return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
            }
          }
          // Zgoda: baza sprawdza nonce prośby i zapisuje „tak" WYŁĄCZNIE przez
          // `_email_measurement_grant` (kanał z pochodzenia prośby).
          const { data, error } = await rpc.rpc("newsletter_measurement_confirm", {
            p_subscriber: check.subscriberId,
            p_nonce: check.nonce,
            p_ip: ip,
            p_user_agent: userAgent,
          });
          const result = error ? null : resultOf(data, CONFIRM_RESULTS);
          if (result === null) {
            console.error("[newsletter.measurement] confirm failed", error?.message ?? "shape");
            return UPDATE_FAILED();
          }
          switch (result) {
            case "confirmed":
              return Response.json({ ok: true, action: "confirm" });
            case "already":
              return Response.json({ ok: true, action: "confirm", already: true });
            case "inactive":
              return Response.json({ ok: false, error: "inactive" }, { status: 409 });
            case "gone":
              return Response.json({ ok: false, error: "not_found" }, { status: 404 });
            default:
              return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
          }
        } catch (err) {
          console.error("[newsletter.measurement] update failed", err);
          return UPDATE_FAILED();
        }
      },
    },
  },
});
