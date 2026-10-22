// Strona „Chcę dalej otrzymywać" - odpowiedź na prośbę o potwierdzenie
// subskrypcji (wygaszanie nieaktywnych subskrybentów newslettera, I9d-Y1).
//
// Mail linkuje do endpointu API (`newsletterKeepUrl`), który GET z przeglądarki
// przekierowuje 303 tutaj z `?token=…&lang=…`. Strona najpierw sprawdza token
// (GET walidacyjny - bez zmian w bazie), a decyzję zapisuje dopiero kliknięcie
// przycisku (POST). Skaner linków w bramce pocztowej wykonuje wyłącznie GET,
// więc nie odnowi zgody za osobę, która maila nie otworzyła.
//
// Język: ścieżki `/newsletter` nie mają prefiksu języka, więc język
// subskrybenta przychodzi parametrem `lang` z linku (inaczej - język
// interfejsu). Ten sam parametr czyta SSR i klient (`validateSearch`), więc
// napisy nie zmieniają się przy hydratacji.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-newsletter-keep";
import { normalizeLang, type AppLang } from "@/lib/i18n/localePath";
import { NEWSLETTER_KEEP_API_PATH, NEWSLETTER_KEEP_PAGE_PATH } from "@/lib/privacy/newsletterKeepPaths";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";

ensureI18n();

interface KeepSearch {
  token?: string;
  lang?: AppLang;
}

export const Route = createFileRoute("/newsletter/keep")({
  validateSearch: (search: Record<string, unknown>): KeepSearch => ({
    token: typeof search.token === "string" && search.token ? search.token : undefined,
    lang: normalizeLang(typeof search.lang === "string" ? search.lang : null) ?? undefined,
  }),
  head: () => {
    const url = getRequestUrl() || NEWSLETTER_KEEP_PAGE_PATH;
    let lang = activeLang(url);
    try {
      lang = normalizeLang(new URL(url, "http://x").searchParams.get("lang")) ?? lang;
    } catch {
      // Nieparsowalny adres - zostaje język interfejsu.
    }
    const t = i18n.getFixedT(lang);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: `${t("newsletterKeep.metaTitle")} - ${SITE_NAME}`,
      description: t("newsletterKeep.metaDescription"),
      robots: "noindex, nofollow",
    });
  },
  component: NewsletterKeepPage,
});

export type KeepPageState =
  | "loading"
  | "confirm"
  | "ok"
  | "already"
  | "inactive"
  | "gone"
  | "expired"
  | "invalid"
  | "rateLimited"
  | "error";

/** Odpowiedź endpointu -> stan strony (czysta funkcja - testowana bez DOM). */
export function keepStateOf(status: number, body: { ok?: boolean; already?: boolean; error?: string }): KeepPageState {
  if (body.ok) return body.already ? "already" : "ok";
  switch (body.error) {
    case "expired":
      return "expired";
    case "invalid_token":
      return "invalid";
    case "inactive":
      return "inactive";
    case "not_found":
      return "gone";
    case "rate_limited":
      return "rateLimited";
    default:
      return status === 429 ? "rateLimited" : "error";
  }
}

async function readBody(response: Response): Promise<{ ok?: boolean; already?: boolean; error?: string }> {
  try {
    return (await response.json()) as { ok?: boolean; already?: boolean; error?: string };
  } catch {
    return {};
  }
}

const TITLE_KEY: Record<Exclude<KeepPageState, "loading" | "confirm">, string> = {
  ok: "newsletterKeep.okTitle",
  already: "newsletterKeep.alreadyTitle",
  inactive: "newsletterKeep.inactiveTitle",
  gone: "newsletterKeep.goneTitle",
  expired: "newsletterKeep.expiredTitle",
  invalid: "newsletterKeep.invalidTitle",
  rateLimited: "newsletterKeep.errorTitle",
  error: "newsletterKeep.errorTitle",
};

const BODY_KEY: Record<Exclude<KeepPageState, "loading" | "confirm">, string> = {
  ok: "newsletterKeep.okBody",
  already: "newsletterKeep.alreadyBody",
  inactive: "newsletterKeep.inactiveBody",
  gone: "newsletterKeep.goneBody",
  expired: "newsletterKeep.expiredBody",
  invalid: "newsletterKeep.invalidBody",
  rateLimited: "newsletterKeep.rateLimitedBody",
  error: "newsletterKeep.errorBody",
};

function NewsletterKeepPage() {
  const search = Route.useSearch();
  const { i18n: instance } = useTranslation();
  const lang: AppLang = search.lang ?? normalizeLang(instance.language) ?? "pl";
  const t = useMemo(() => i18n.getFixedT(lang), [lang]);
  const token = search.token ?? "";
  const [state, setState] = useState<KeepPageState>(token ? "loading" : "invalid");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch(`${NEWSLETTER_KEEP_API_PATH}?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = await readBody(response);
        if (!cancelled) setState(body.ok ? "confirm" : keepStateOf(response.status, body));
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function keep() {
    setBusy(true);
    try {
      const response = await fetch(NEWSLETTER_KEEP_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      setState(keepStateOf(response.status, await readBody(response)));
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

  const positive = state === "ok" || state === "already";
  const retryable = state === "error" || state === "rateLimited";

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div
        className="max-w-md w-full text-center border border-border rounded-xl p-8 bg-card space-y-3"
        aria-live="polite"
      >
        {state === "loading" && (
          <>
            <Loader2 className="w-10 h-10 mx-auto animate-spin text-brand" aria-hidden="true" />
            <p>{t("newsletterKeep.loading")}</p>
          </>
        )}
        {state === "confirm" && (
          <>
            <MailCheck className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
            <h1 className="font-display text-2xl">{t("newsletterKeep.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("newsletterKeep.body")}</p>
            <Button type="button" onClick={keep} disabled={busy} className="mt-2">
              {busy ? t("newsletterKeep.working") : t("newsletterKeep.confirmBtn")}
            </Button>
          </>
        )}
        {state !== "loading" && state !== "confirm" && (
          <>
            {positive ? (
              <CheckCircle2 className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
            ) : (
              <XCircle className="w-10 h-10 mx-auto text-destructive" aria-hidden="true" />
            )}
            <h1 className="font-display text-2xl">{t(TITLE_KEY[state])}</h1>
            <p className="text-sm text-muted-foreground">{t(BODY_KEY[state])}</p>
            {retryable && (
              <Button type="button" onClick={keep} disabled={busy} className="mt-2">
                {busy ? t("newsletterKeep.working") : t("newsletterKeep.retryBtn")}
              </Button>
            )}
          </>
        )}
        <Link to="/" className="inline-block mt-2 text-sm text-brand hover:underline">
          {t("newsletter.confirmPage.backHome")}
        </Link>
      </div>
    </div>
  );
}
