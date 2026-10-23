// Strona potwierdzenia subskrypcji newslettera. Link z maila prowadzi tu z ?token=…
// Komponent wywołuje /api/public/newsletter/confirm (JSON) i pokazuje wynik
// w języku interfejsu (PL/EN). Re-klik potwierdzonego linku renderuje stan
// "już potwierdzono" - endpoint jest idempotentny.
//
// KARTA ZGODY NA POMIAR (I9d-Y2b, D1 wariant (b), D2). Gdy osoba zaznaczyła
// w formularzu osobne pole pomiaru, odpowiedź GET niesie `measurement:
// "offer"` i język treści (`measurementLang`) - pod potwierdzeniem pojawia
// się leniwie ładowana karta decyzji (`NewsletterConfirmMeasurementCard`).
// Kształt odpowiedzi czyta wspólny kontrakt `newsletterConfirmViewOf`
// (fail-closed: każdy inny stan, błąd albo nieznany kształt - bez karty).
// GET NIGDY nie udziela zgody: zapisuje ją dopiero kliknięcie w karcie
// (POST). Słownik i treść karty jadą wyłącznie w jej chunku (D-08).
//
// SEKRET SKRZYNKI (przegląd R1, sql-r1-1/zgoda-r1-1). Sam token DOI nie
// dowodzi skrzynki (personel go czytał). Link z maila DOI z zaznaczonym
// polem pomiaru niesie drugi parametr `m` (`DOI_MEASUREMENT_PARAM`): strona
// przekazuje go w GET (`newsletterConfirmApiUrl`), a karta w ciele POST
// (`doiMeasurementDecisionBody`). Bez `m` (albo w złym kształcie) GET zwraca
// `measurement: "none"` - karty nie ma, a samo potwierdzenie zapisu działa
// jak dotąd.
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  DOI_MEASUREMENT_PARAM,
  isDoiMeasurementTokenFormat,
  newsletterConfirmApiUrl,
  newsletterConfirmViewOf,
} from "@/lib/newsletter/confirmMeasurement";
import type { ConsentLang } from "@/lib/newsletter/consentSegments";
import { activeLang } from "@/lib/seo/head";
import { getRequestUrl } from "@/lib/seo/request";
import { buildContentHead, SITE_NAME } from "@/lib/seo/meta";

export const Route = createFileRoute("/newsletter/confirm")({
  head: () => {
    const url = getRequestUrl() || "/newsletter/confirm";
    const lang = activeLang(url);
    const title =
      lang === "en"
        ? `Newsletter confirmed - ${SITE_NAME}`
        : `Newsletter potwierdzony - ${SITE_NAME}`;
    return buildContentHead({
      url,
      lang,
      type: "website",
      title,
      description:
        lang === "en"
          ? "Your newsletter subscription has been confirmed."
          : "Twoja subskrypcja newslettera została potwierdzona.",
      robots: "noindex, nofollow",
    });
  },
  component: Page,
});

const NewsletterConfirmMeasurementCard = lazy(() =>
  import("@/components/newsletter/NewsletterConfirmMeasurementCard").then((m) => ({
    default: m.NewsletterConfirmMeasurementCard,
  })),
);

type State = "loading" | "ok" | "already" | "expired" | "error";

/**
 * Karta decyzji o pomiarze: token DOI i sekret skrzynki `m` z adresu, język
 * treści z odpowiedzi GET.
 */
interface MeasurementCard {
  token: string;
  secret: string;
  lang: ConsentLang;
}

function Page() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("loading");
  const [detail, setDetail] = useState("");
  const [measurementCard, setMeasurementCard] = useState<MeasurementCard | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") ?? "";
    if (!token) {
      setState("error");
      return;
    }
    const rawSecret = params.get(DOI_MEASUREMENT_PARAM);
    const secret = isDoiMeasurementTokenFormat(rawSecret) ? rawSecret : null;
    fetch(newsletterConfirmApiUrl(token, secret))
      .then(async (r) => {
        const view = newsletterConfirmViewOf(r.status, await r.json().catch(() => ({})));
        setState(view.state);
        if (view.detail) setDetail(view.detail);
        // Karta wyłącznie z sekretem skrzynki (bez niego serwer i tak daje `none`).
        if (view.measurementCard && secret) {
          setMeasurementCard({ token, secret, lang: view.measurementCard.lang });
        }
      })
      .catch((e: unknown) => {
        setState("error");
        setDetail(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center border border-border rounded-xl p-8 bg-card space-y-3">
        {state === "loading" && (
          <>
            <Loader2 className="w-10 h-10 mx-auto animate-spin text-brand" />
            <p>{t("newsletter.confirmPage.loading")}</p>
          </>
        )}
        {(state === "ok" || state === "already") && (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto text-brand" />
            <h1 className="font-display text-2xl">
              {t(
                state === "ok"
                  ? "newsletter.confirmPage.okTitle"
                  : "newsletter.confirmPage.alreadyTitle",
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                state === "ok"
                  ? "newsletter.confirmPage.okBody"
                  : "newsletter.confirmPage.alreadyBody",
              )}
            </p>
            {measurementCard && (
              <Suspense fallback={null}>
                <NewsletterConfirmMeasurementCard
                  token={measurementCard.token}
                  secret={measurementCard.secret}
                  lang={measurementCard.lang}
                />
              </Suspense>
            )}
          </>
        )}
        {(state === "expired" || state === "error") && (
          <>
            <XCircle className="w-10 h-10 mx-auto text-destructive" />
            <h1 className="font-display text-2xl">
              {t(
                state === "expired"
                  ? "newsletter.confirmPage.expiredTitle"
                  : "newsletter.confirmPage.errorTitle",
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {state === "expired"
                ? t("newsletter.confirmPage.expiredBody")
                : detail || t("newsletter.confirmPage.errorBody")}
            </p>
          </>
        )}
        <Link to="/" className="inline-block mt-2 text-sm text-brand hover:underline">
          {t("newsletter.confirmPage.backHome")}
        </Link>
      </div>
    </div>
  );
}
