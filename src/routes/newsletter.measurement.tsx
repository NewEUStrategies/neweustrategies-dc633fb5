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
// (I9d-Y2b: `newsletter_measurement_confirm` -> `_email_measurement_grant`
// zapisuje treść OSOBNEGO pola pomiaru `_email_measurement_consent_default`
// w języku subskrybenta) - z jednego źródła
// `@/lib/newsletter/measurementConsentText`, przez wspólny panel decyzji
// (`MeasurementDecisionPanel`, ten sam co karta na stronie potwierdzenia
// double opt-in).
//
// Język: ścieżki `/newsletter` nie mają prefiksu języka, więc język odbiorcy
// przychodzi parametrem `lang` z linku (inaczej - język interfejsu). Ten sam
// parametr czyta SSR i klient (`validateSearch`) - bez zmiany napisów przy
// hydratacji. ZGODA (R1.19): GET akcji `confirm` zwraca `lang` SUBSKRYBENTA
// (ten, w którym baza zapisze treść) i ekran decyzji renderuje się w tym
// języku, niezależnie od `lang` z adresu; odpowiedź bez poprawnego `lang`
// to błąd z ponowieniem SPRAWDZENIA - bez przycisku zgody (osoba nie może
// zgodzić się na treść w innym języku niż zapisana, art. 7 ust. 1 RODO).
// Chunk startowy: `head()` i `validateSearch` czytają wyłącznie nakładkę
// nagłówka i literał ścieżki; słownik strony, logika odpowiedzi i treść
// zgody jadą w chunku komponentu (D-08).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MeasurementGrantPrompt,
  MeasurementOutcomeView,
} from "@/components/newsletter/MeasurementDecisionPanel";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-newsletter-measurement";
import "@/lib/i18n-newsletter-measurement-head";
import { normalizeLang, type AppLang } from "@/lib/i18n/localePath";
import {
  measurementPageLangOf,
  type MeasurementPageCheckBody,
} from "@/lib/newsletter/confirmMeasurement";
import type { ConsentLang } from "@/lib/newsletter/consentSegments";
import {
  measurementChannelOf,
  measurementPromptStateOf,
  measurementResultStateOf,
  NEWSLETTER_MEASUREMENT_API_PATH,
  type MeasurementLinkChannel,
  type MeasurementPageState,
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

async function readBody(response: Response): Promise<MeasurementPageCheckBody> {
  try {
    return (await response.json()) as MeasurementPageCheckBody;
  } catch {
    return {};
  }
}

/**
 * GET (sprawdzenie tokenu) -> ekran przed decyzją i język treści zgody.
 * Ekran zgody bez poprawnego `lang` subskrybenta = błąd z ponowieniem
 * sprawdzenia (bez przycisku zgody).
 */
function promptOf(
  status: number,
  body: MeasurementPageCheckBody,
): { state: MeasurementPageState; consentLang: ConsentLang | null } {
  const state = measurementPromptStateOf(status, body);
  const consentLang = measurementPageLangOf(body);
  if (state === "confirmGrant" && consentLang === null) return { state: "error", consentLang };
  return { state, consentLang };
}

function NewsletterMeasurementPage() {
  ensureI18n();
  const search = Route.useSearch();
  const { i18n: instance } = useTranslation();
  // Język subskrybenta z odpowiedzi GET (R1.19) ma pierwszeństwo przed
  // językiem z adresu: ekran zgody i treść, którą baza zapisze, w jednym
  // języku.
  const [consentLang, setConsentLang] = useState<ConsentLang | null>(null);
  const lang: AppLang = consentLang ?? search.lang ?? normalizeLang(instance.language) ?? "pl";
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
        const prompt = promptOf(response.status, await readBody(response));
        if (cancelled) return;
        if (prompt.consentLang) setConsentLang(prompt.consentLang);
        setState(prompt.state);
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

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div
        lang={lang}
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
        {state === "confirmGrant" && consentLang && (
          <MeasurementGrantPrompt
            t={t}
            lang={consentLang}
            lead={t("newsletterMeasurement.grantLead")}
            busy={busy}
            onGrant={decide}
          />
        )}
        {state !== "loading" && state !== "confirmWithdraw" && state !== "confirmGrant" && (
          <MeasurementOutcomeView t={t} outcome={state} busy={busy} onRetry={retry} />
        )}
        <Link to="/" className="inline-block mt-2 text-sm text-brand hover:underline">
          {t("newsletter.confirmPage.backHome")}
        </Link>
      </div>
    </div>
  );
}
