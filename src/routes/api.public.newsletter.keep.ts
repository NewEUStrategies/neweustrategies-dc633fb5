// Publiczny endpoint linku „Chcę dalej otrzymywać" z prośby o potwierdzenie
// subskrypcji (wygaszanie nieaktywnych subskrybentów, I9d-Y1, Z-I9c-08):
// /api/public/newsletter/keep?token=...
//
// WZORZEC /api/public/newsletter/unsubscribe:
//   * GET z przeglądarki (Accept: text/html) -> 303 na stronę
//     /newsletter/keep z przyciskiem; GET z fetch -> walidacja podpisu
//     i terminu tokenu BEZ dostępu do bazy. GET NIGDY NIE MUTUJE: skanery
//     linków w bramkach pocztowych wykonują GET na każdym adresie z maila -
//     gdyby GET potwierdzał, skaner „odnawiałby" zgodę za ludzi, którzy maila
//     nawet nie otworzyli (odnowienie woli ma być świadomym działaniem
//     osoby - art. 7 ust. 1 RODO);
//   * POST (przycisk na stronie) -> limiter per IP -> RPC
//     `newsletter_sunset_keep` (tylko service_role): cykl z tym nonce znika
//     (token jednorazowy - powtórka `already`), znacznik zaangażowania
//     resetuje licznik nieaktywności, wpis potwierdzenia w rejestrze zgód.
//     Awaria bazy -> 500 (nie cichy sukces): osoba widzi błąd i może ponowić,
//     zamiast wierzyć, że została na liście, a po terminie zostać usunięta.
//
// Odpowiedzi nie zawierają adresu e-mail ani niczego, co identyfikuje
// odbiorcę - token jedzie w linku maila (przekazana wiadomość, logi bramek).
import { createFileRoute } from "@tanstack/react-router";
import { normalizeLang } from "@/lib/i18n/localePath";
import { NEWSLETTER_KEEP_PAGE_PATH } from "@/lib/privacy/newsletterKeep";

function wantsHtml(accept: string | null): boolean {
  return !!accept && accept.includes("text/html");
}

/**
 * Limit per IP: jedna osoba klika przycisk raz, czasem dwa (podwójne
 * kliknięcie, odświeżenie). 10 na 10 minut jak strona wypisu; brak IP ->
 * fail-open (potwierdzenie nie może się nie udać człowiekowi zza nietypowego
 * proxy - ceną byłoby usunięcie z listy wbrew jego woli).
 */
const KEEP_LIMIT = { scope: "newsletter.keep", max: 10, windowMinutes: 10 } as const;

async function passesRateLimit(request: Request): Promise<boolean> {
  const { rateLimitIpSubject } = await import("@/lib/http/rateLimit");
  const subject = rateLimitIpSubject(request.headers);
  if (subject === "unknown") return true;
  const { rateLimit } = await import("@/lib/server/rate-limit.server");
  return rateLimit({
    scope: KEEP_LIMIT.scope,
    subjectId: subject,
    max: KEEP_LIMIT.max,
    windowMinutes: KEEP_LIMIT.windowMinutes,
  });
}

/** Token z ciała (JSON strony albo zwykły formularz), awaryjnie z adresu. */
async function readToken(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("token");
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body: unknown = await request.json();
      if (typeof body === "object" && body !== null) {
        const value = (body as Record<string, unknown>).token;
        if (typeof value === "string" && value) return value;
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const value = new URLSearchParams(await request.text()).get("token");
      if (value) return value;
    }
  } catch {
    // Puste albo nieparsowalne ciało - zostaje token z adresu.
  }
  return fromQuery;
}

/** Wynik RPC `newsletter_sunset_keep` (rpc-shape w migracji 20261020161900). */
const KEEP_RESULTS = ["kept", "already", "inactive", "gone", "invalid"] as const;
type KeepResult = (typeof KEEP_RESULTS)[number];

function keepResultOf(data: unknown): KeepResult | null {
  const value =
    typeof data === "object" && data !== null ? (data as Record<string, unknown>).result : null;
  return (KEEP_RESULTS as readonly unknown[]).includes(value) ? (value as KeepResult) : null;
}

type RpcCallable = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export const Route = createFileRoute("/api/public/newsletter/keep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (wantsHtml(request.headers.get("accept"))) {
          const target = new URL(NEWSLETTER_KEEP_PAGE_PATH, url.origin);
          if (token) target.searchParams.set("token", token);
          // Język subskrybenta z linku maila (tylko napisy strony, zawężony
          // do obsługiwanych - nic innego z adresu nie przechodzi dalej).
          const lang = normalizeLang(url.searchParams.get("lang"));
          if (lang) target.searchParams.set("lang", lang);
          return Response.redirect(target.toString(), 303);
        }
        const { verifyNewsletterKeepToken } =
          await import("@/lib/privacy/newsletterKeepToken.server");
        const check = verifyNewsletterKeepToken(token);
        if (check.ok) return Response.json({ ok: true });
        return check.reason === "expired"
          ? Response.json({ ok: false, error: "expired" }, { status: 410 })
          : Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
      },
      POST: async ({ request }) => {
        const token = await readToken(request);
        const { verifyNewsletterKeepToken } =
          await import("@/lib/privacy/newsletterKeepToken.server");
        const check = verifyNewsletterKeepToken(token);
        if (!check.ok) {
          return check.reason === "expired"
            ? Response.json({ ok: false, error: "expired" }, { status: 410 })
            : Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
        }
        if (!(await passesRateLimit(request))) {
          return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        }
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // RPC wygaszania nie ma jeszcze w wygenerowanych typach - kształt
          // wywołania z nazwą RPC jako literałem (bramka kontraktu TS <-> SQL).
          const { data, error } = await (supabaseAdmin as unknown as RpcCallable).rpc(
            "newsletter_sunset_keep",
            { p_subscriber: check.subscriberId, p_nonce: check.nonce },
          );
          const result = error ? null : keepResultOf(data);
          if (result === null) {
            // Komunikat Postgresa niesie nazwy tabel i kolumn - do klienta idzie
            // stały kod, pełna treść do logu workera.
            console.error("[newsletter.keep] keep failed", error?.message ?? "bad shape");
            return Response.json({ ok: false, error: "update_failed" }, { status: 500 });
          }
          switch (result) {
            case "kept":
              return Response.json({ ok: true });
            case "already":
              return Response.json({ ok: true, already: true });
            case "inactive":
              return Response.json({ ok: false, error: "inactive" }, { status: 409 });
            case "gone":
              return Response.json({ ok: false, error: "not_found" }, { status: 404 });
            default:
              return Response.json({ ok: false, error: "invalid_token" }, { status: 400 });
          }
        } catch (err) {
          console.error("[newsletter.keep] keep failed", err);
          return Response.json({ ok: false, error: "update_failed" }, { status: 500 });
        }
      },
    },
  },
});
