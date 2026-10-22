// Strona linków pomiaru otwarć i kliknięć (I9d-Y2): „Nie mierz moich otwarć
// i kliknięć" (stopka maili kampanii i ścieżek, strona preferencji) oraz
// „Zgadzam się na pomiar" (jednorazowa prośba z panelu newslettera).
//
// Mail linkuje do endpointu API (`newsletterMeasurementUrl`), który GET
// z przeglądarki przekierowuje 303 tutaj z `?token=…&lang=…[&via=…]`. Strona
// najpierw sprawdza token (GET - bez zmian w bazie; przy wycofaniu odczyt
// stanu zgody), a decyzję zapisuje dopiero kliknięcie przycisku (POST).
// Skaner linków w bramce pocztowej wykonuje wyłącznie GET, więc ani nie
// udzieli zgody na pomiar, ani jej nie wycofa za osobę, która maila nie
// otworzyła.
//
// Ekran zgody pokazuje DOKŁADNIE treść, którą baza zapisze w rejestrze zgód
// (`newsletter_measurement_confirm` loguje bieżącą treść domyślną w języku
// subskrybenta) - z jednego źródła `@/lib/newsletter/consentText`.
//
// Język: ścieżki `/newsletter` nie mają prefiksu języka, więc język odbiorcy
// przychodzi parametrem `lang` z linku (inaczej - język interfejsu). Ten sam
// parametr czyta SSR i klient (`validateSearch`) - bez zmiany napisów przy
// hydratacji. Chunk startowy: `head()` i `validateSearch` czytają wyłącznie
// nakładkę nagłówka i literał ścieżki; słownik strony, logika odpowiedzi
// i treść zgody jadą w chunku komponentu (D-08).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, EyeOff, Loader2, MailCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewsletterConsentText } from "@/components/newsletter/NewsletterConsentText";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-newsletter-measurement";
import "@/lib/i18n-newsletter-measurement-head";
import { normalizeLang, type AppLang } from "@/lib/i18n/localePath";
import {
  measurementChannelOf,
  measurementPromptStateOf,
  measurementResultStateOf,
  NEWSLETTER_MEASUREMENT_API_PATH,
  type MeasurementLinkChannel,
  type MeasurementPageState,
  type MeasurementResponseBody,
} from "@/lib/privacy/measurement";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";

interface MeasurementSearch {
  token?: string;
  lang?: AppLang;
  /** Kanał wycofania (strona preferencji); wartość spoza listy znika. */
  via?: "preferences";
}

export const Route = createFileRoute("/newsletter/measurement")({
  validateSearch: (search: Record<string, unknown>): MeasurementSearch => ({
    token: typeof search.token === "string" && search.token ? search.token : undefined,
    lang: normalizeLang(typeof search.lang === "string" ? search.lang : null) ?? undefined,
    // Literał zamiast `measurementChannelOf`: `validateSearch` jedzie
    // w chunku startowym, a liść pomiaru - tylko w chunku strony.
    via: search.via === "preferences" ? "preferences" : undefined,
  }),
  head: () => {
    const url = getRequestUrl() || "/newsletter/measurement";
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
      title: `${t("newsletterMeasurement.metaTitle")} - ${SITE_NAME}`,
      description: t("newsletterMeasurement.metaDescription"),
      robots: "noindex, nofollow",
    });
  },
  component: NewsletterMeasurementPage,
});

async function readBody(response: Response): Promise<MeasurementResponseBody> {
  try {
    return (await response.json()) as MeasurementResponseBody;
  } catch {
    return {};
  }
}

type ResultState = Exclude<MeasurementPageState, "loading" | "confirmWithdraw" | "confirmGrant">;

const TITLE_KEY: Record<ResultState, string> = {
  withdrawn: "newsletterMeasurement.withdrawnTitle",
  alreadyOff: "newsletterMeasurement.alreadyOffTitle",
  granted: "newsletterMeasurement.grantedTitle",
  alreadyOn: "newsletterMeasurement.alreadyOnTitle",
  inactive: "newsletterMeasurement.inactiveTitle",
  gone: "newsletterMeasurement.goneTitle",
  expired: "newsletterMeasurement.expiredTitle",
  invalid: "newsletterMeasurement.invalidTitle",
  rateLimited: "newsletterMeasurement.errorTitle",
  error: "newsletterMeasurement.errorTitle",
};

const BODY_KEY: Record<ResultState, string> = {
  withdrawn: "newsletterMeasurement.withdrawnBody",
  alreadyOff: "newsletterMeasurement.alreadyOffBody",
  granted: "newsletterMeasurement.grantedBody",
  alreadyOn: "newsletterMeasurement.alreadyOnBody",
  inactive: "newsletterMeasurement.inactiveBody",
  gone: "newsletterMeasurement.goneBody",
  expired: "newsletterMeasurement.expiredBody",
  invalid: "newsletterMeasurement.invalidBody",
  rateLimited: "newsletterMeasurement.rateLimitedBody",
  error: "newsletterMeasurement.errorBody",
};

const POSITIVE: ReadonlySet<MeasurementPageState> = new Set([
  "withdrawn",
  "alreadyOff",
  "granted",
  "alreadyOn",
]);

function NewsletterMeasurementPage() {
  ensureI18n();
  const search = Route.useSearch();
  const { i18n: instance } = useTranslation();
  const lang: AppLang = search.lang ?? normalizeLang(instance.language) ?? "pl";
  const t = useMemo(() => i18n.getFixedT(lang), [lang]);
  const token = search.token ?? "";
  const channel: MeasurementLinkChannel = measurementChannelOf(search.via);
  const [state, setState] = useState<MeasurementPageState>(token ? "loading" : "invalid");
  // Czy osoba widziała już ekran decyzji. Błąd PRZED nim ponawia wyłącznie
  // sprawdzenie (GET) - ponowienie nigdy nie zapisze zgody na pomiar osobie,
  // która nie zobaczyła jej treści (art. 7 ust. 1 RODO).
  const [decided, setDecided] = useState(false);
  const [check, setCheck] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setState("loading");
    fetch(`${NEWSLETTER_MEASUREMENT_API_PATH}?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const body = await readBody(response);
        if (!cancelled) setState(measurementPromptStateOf(response.status, body));
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token, check]);

  function retry() {
    if (decided) void decide();
    else setCheck((value) => value + 1);
  }

  async function decide() {
    setDecided(true);
    setBusy(true);
    try {
      const response = await fetch(NEWSLETTER_MEASUREMENT_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, channel }),
      });
      setState(measurementResultStateOf(response.status, await readBody(response)));
    } catch {
      setState("error");
    } finally {
      setBusy(false);
    }
  }

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
            <p>{t("newsletterMeasurement.loading")}</p>
          </>
        )}
        {state === "confirmWithdraw" && (
          <>
            <EyeOff className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
            <h1 className="font-display text-2xl">{t("newsletterMeasurement.withdrawTitle")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("newsletterMeasurement.withdrawBody")}
            </p>
            <Button type="button" onClick={decide} disabled={busy} className="mt-2">
              {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.withdrawBtn")}
            </Button>
          </>
        )}
        {state === "confirmGrant" && (
          <>
            <MailCheck className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
            <h1 className="font-display text-2xl">{t("newsletterMeasurement.grantTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("newsletterMeasurement.grantLead")}</p>
            <p className="text-sm text-left border border-border rounded-lg p-3">
              <NewsletterConsentText lang={lang} />
            </p>
            <p className="text-sm text-muted-foreground">{t("newsletterMeasurement.grantNote")}</p>
            <Button type="button" onClick={decide} disabled={busy} className="mt-2">
              {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.grantBtn")}
            </Button>
          </>
        )}
        {state !== "loading" && state !== "confirmWithdraw" && state !== "confirmGrant" && (
          <>
            {POSITIVE.has(state) ? (
              <CheckCircle2 className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
            ) : (
              <XCircle className="w-10 h-10 mx-auto text-destructive" aria-hidden="true" />
            )}
            <h1 className="font-display text-2xl">{t(TITLE_KEY[state])}</h1>
            <p className="text-sm text-muted-foreground">{t(BODY_KEY[state])}</p>
            {retryable && (
              <Button type="button" onClick={retry} disabled={busy} className="mt-2">
                {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.retryBtn")}
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
