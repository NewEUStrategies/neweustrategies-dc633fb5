// KARTA ZGODY NA POMIAR NA STRONIE POTWIERDZENIA DOUBLE OPT-IN (I9d-Y2b,
// decyzje właściciela 2026-10-23: D1 wariant (b) - każda zgoda ma osobne
// pole; D2 - pomiar tylko dla skrzynki potwierdzonej przez jej właściciela).
//
// Osoba zaznaczyła w formularzu osobne pole pomiaru (deklaracja, nie zgoda),
// a teraz - po kliknięciu linku z maila na SWÓJ adres - potwierdziła zapis.
// Strona (`/newsletter/confirm`) montuje kartę leniwie WYŁĄCZNIE, gdy GET
// potwierdzenia zwrócił `measurement: "offer"` (`newsletterConfirmViewOf`).
// Karta pokazuje DOKŁADNIE treść, którą baza zapisze
// (`_email_measurement_consent_default` w języku subskrybenta =
// `measurementLang` z odpowiedzi), i dwa równorzędne przyciski. Decyzję
// zapisuje dopiero kliknięcie: POST JSON `{ token, decision }` do tej samej
// trasy (`newsletter_doi_measurement_decide`); skaner linków w bramce
// pocztowej robi wyłącznie GET, więc nigdy nie udzieli ani nie odmówi zgody
// za osobę.
//
// Wspólny panel decyzji (`MeasurementDecisionPanel`) i słownik
// (`i18n-newsletter-measurement`) ze stroną `/newsletter/measurement` -
// R1.18. Napisy karty w języku treści zgody (atrybut `lang` sekcji: czytnik
// ekranu wymawia ją poprawnie, także gdy interfejs strony jest w innym
// języku). Wynik w regionie `aria-live="polite"`; po każdej decyzji (także
// ponowieniu) fokus przechodzi na nagłówek wyniku (`focusKey` panelu -
// kliknięty przycisk znika, WCAG 2.4.3; przegląd R1 - ui-r1-3).
import { useMemo, useRef, useState } from "react";

import {
  MeasurementGrantPrompt,
  MeasurementOutcomeView,
  type MeasurementOutcome,
} from "@/components/newsletter/MeasurementDecisionPanel";
import i18n from "@/lib/i18n";
import { ensureI18n } from "@/lib/i18n-newsletter-measurement";
import {
  doiMeasurementDecisionViewOf,
  NEWSLETTER_CONFIRM_API_PATH,
  type DoiMeasurementDecision,
  type DoiMeasurementDecisionView,
} from "@/lib/newsletter/confirmMeasurement";
import type { ConsentLang } from "@/lib/newsletter/consentSegments";

export interface NewsletterConfirmMeasurementCardProps {
  /** Token DOI z linku maila (ten sam, którym strona potwierdziła zapis). */
  token: string;
  /** Język treści zgody = `measurementLang` z odpowiedzi GET. */
  lang: ConsentLang;
}

/** Wynik POST (kontrakt `confirmMeasurement.ts`) -> ekran wyniku panelu. */
const OUTCOME: Record<DoiMeasurementDecisionView, MeasurementOutcome> = {
  granted: "granted",
  declined: "declined",
  already: "alreadyDecided",
  invalid: "invalid",
  inactive: "inactive",
  // Brak deklaracji albo decyzja po terminie (60 dni od zaznaczenia pola).
  none: "expired",
  rateLimited: "rateLimited",
  error: "error",
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function NewsletterConfirmMeasurementCard({
  token,
  lang,
}: NewsletterConfirmMeasurementCardProps) {
  ensureI18n();
  const t = useMemo(() => i18n.getFixedT(lang), [lang]);
  const [outcome, setOutcome] = useState<MeasurementOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  // Licznik zakończonych decyzji - cel fokusu po każdej z nich.
  const [decisions, setDecisions] = useState(0);
  // Ponowienie po błędzie przejściowym powtarza decyzję, którą osoba już
  // kliknęła po przeczytaniu treści - nigdy innej.
  const lastDecision = useRef<DoiMeasurementDecision | null>(null);

  async function decide(decision: DoiMeasurementDecision) {
    lastDecision.current = decision;
    setBusy(true);
    try {
      const response = await fetch(NEWSLETTER_CONFIRM_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ token, decision }),
      });
      setOutcome(OUTCOME[doiMeasurementDecisionViewOf(response.status, await readJson(response))]);
    } catch {
      setOutcome("error");
    } finally {
      setBusy(false);
      setDecisions((count) => count + 1);
    }
  }

  function retry() {
    if (lastDecision.current) void decide(lastDecision.current);
  }

  return (
    <section lang={lang} aria-live="polite" className="mt-4 border-t border-border pt-4 space-y-3">
      {outcome === null ? (
        <MeasurementGrantPrompt
          t={t}
          lang={lang}
          lead={t("newsletterMeasurement.doiLead")}
          busy={busy}
          onGrant={() => void decide("grant")}
          onDecline={() => void decide("decline")}
          headingLevel={2}
        />
      ) : (
        <MeasurementOutcomeView
          t={t}
          outcome={outcome}
          busy={busy}
          onRetry={retry}
          headingLevel={2}
          focusKey={decisions}
        />
      )}
    </section>
  );
}
