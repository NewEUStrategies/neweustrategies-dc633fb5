// WSPÓLNY PANEL DECYZJI O ZGODZIE NA POMIAR OTWARĆ I KLIKNIĘĆ (I9d-Y2b,
// rozstrzygnięcie R1.18; decyzje właściciela 2026-10-23: D1 wariant (b) -
// każda zgoda ma osobne pole; D2 - pomiar tylko dla skrzynki potwierdzonej
// przez jej właściciela).
//
// Wydzielony ze strony `/newsletter/measurement`, żeby oba miejsca, w których
// właściciel skrzynki udziela (albo odmawia) zgody, wyglądały i mówiły tak
// samo:
//   * strona `/newsletter/measurement` - link z prośby w mailu („Zgadzam się
//     na pomiar"); ekran wycofania ze stopki ma własną treść na stronie;
//   * karta na stronie potwierdzenia double opt-in
//     (`NewsletterConfirmMeasurementCard`) - „Zgadzam się" / „Nie zgadzam się".
//
// KONTRAKT Z HOSTEM:
//   * `t` = słownik nakładki `i18n-newsletter-measurement` (host woła
//     `ensureI18n()`) w języku TREŚCI zgody - napisy panelu i treść, którą
//     baza zapisze, są w jednym języku (art. 7 ust. 2 RODO: zrozumiała
//     i jasna forma). `lang` = język treści (`MeasurementConsentText`).
//   * Panel niczego nie wysyła sam: przyciski wołają `onGrant`/`onDecline`
//     hosta, a wynik host podaje jako `MeasurementOutcome`. Nic nie dzieje
//     się bez kliknięcia.
//   * Odmowa jest tak samo widoczna jak zgoda (ten sam wariant przycisku) -
//     zgoda wymuszona wyglądem nie jest dobrowolna.
//   * Geometria i kolory z tokenów platformy (te same w jasnym i ciemnym
//     motywie); bez własnej typografii poza klasami strony, z której panel
//     wyszedł.
//   * FOKUS PO DECYZJI (WCAG 2.4.3, przegląd R1 - ui-r1-3). Kliknięty przycisk
//     znika razem z ekranem decyzji (albo z ekranem błędu po ponowieniu), więc
//     fokus spadał na `<body>` i następny Tab zaczynał od początku strony.
//     Host podaje `focusKey` (licznik zakończonych decyzji): każda zmiana -
//     także ponowienie z tym samym wynikiem - przenosi fokus na nagłówek
//     wyniku (`tabIndex={-1}`, bez obwódki - to nie kontrolka). Wynik od razu
//     po wejściu na stronę (bez kliknięcia) nie przesuwa fokusu.
import { useEffect, useRef, type Ref } from "react";
import type { TFunction } from "i18next";
import { CheckCircle2, MailCheck, XCircle } from "lucide-react";

import { MeasurementConsentText } from "@/components/newsletter/NewsletterConsentText";
import { Button } from "@/components/ui/button";
import type { ConsentLang } from "@/lib/newsletter/consentSegments";

/** Ekran wyniku (strona pomiaru i karta DOI). */
export type MeasurementOutcome =
  | "withdrawn"
  | "alreadyOff"
  | "granted"
  | "alreadyOn"
  | "declined"
  | "alreadyDecided"
  | "inactive"
  | "gone"
  | "expired"
  | "invalid"
  | "rateLimited"
  | "error";

const TITLE_KEY: Record<MeasurementOutcome, string> = {
  withdrawn: "newsletterMeasurement.withdrawnTitle",
  alreadyOff: "newsletterMeasurement.alreadyOffTitle",
  granted: "newsletterMeasurement.grantedTitle",
  alreadyOn: "newsletterMeasurement.alreadyOnTitle",
  declined: "newsletterMeasurement.declinedTitle",
  alreadyDecided: "newsletterMeasurement.alreadyDecidedTitle",
  inactive: "newsletterMeasurement.inactiveTitle",
  gone: "newsletterMeasurement.goneTitle",
  expired: "newsletterMeasurement.expiredTitle",
  invalid: "newsletterMeasurement.invalidTitle",
  rateLimited: "newsletterMeasurement.errorTitle",
  error: "newsletterMeasurement.errorTitle",
};

const BODY_KEY: Record<MeasurementOutcome, string> = {
  withdrawn: "newsletterMeasurement.withdrawnBody",
  alreadyOff: "newsletterMeasurement.alreadyOffBody",
  granted: "newsletterMeasurement.grantedBody",
  alreadyOn: "newsletterMeasurement.alreadyOnBody",
  declined: "newsletterMeasurement.declinedBody",
  alreadyDecided: "newsletterMeasurement.alreadyDecidedBody",
  inactive: "newsletterMeasurement.inactiveBody",
  gone: "newsletterMeasurement.goneBody",
  expired: "newsletterMeasurement.expiredBody",
  invalid: "newsletterMeasurement.invalidBody",
  rateLimited: "newsletterMeasurement.rateLimitedBody",
  error: "newsletterMeasurement.errorBody",
};

/** Decyzja zapisana albo nie ma czego robić - ikona potwierdzenia. */
const POSITIVE: ReadonlySet<MeasurementOutcome> = new Set([
  "withdrawn",
  "alreadyOff",
  "granted",
  "alreadyOn",
  "declined",
  "alreadyDecided",
]);

/** Błąd przejściowy - przycisk ponowienia (host decyduje, CO ponowić). */
function isRetryableOutcome(outcome: MeasurementOutcome): boolean {
  return outcome === "error" || outcome === "rateLimited";
}

function Heading({
  level,
  children,
  headingRef,
  focusable = false,
}: {
  level: 1 | 2;
  children: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Cel fokusu po decyzji: `tabIndex={-1}` (fokus programowy, nie w kolejce Tab). */
  focusable?: boolean;
}) {
  const tabIndex = focusable ? -1 : undefined;
  return level === 1 ? (
    <h1 ref={headingRef} tabIndex={tabIndex} className="font-display text-2xl focus:outline-none">
      {children}
    </h1>
  ) : (
    <h2 ref={headingRef} tabIndex={tabIndex} className="font-display text-xl focus:outline-none">
      {children}
    </h2>
  );
}

export interface MeasurementGrantPromptProps {
  t: TFunction;
  /** Język treści zgody (= język zapisu w rejestrze zgód). */
  lang: ConsentLang;
  /** Zdanie nad ramką z treścią (już przetłumaczone). */
  lead: string;
  busy: boolean;
  onGrant: () => void;
  /** Karta DOI: drugi przycisk „Nie zgadzam się"; strona pomiaru - brak. */
  onDecline?: () => void;
  /** Strona pomiaru: `h1`; karta pod nagłówkiem strony DOI: `h2`. */
  headingLevel?: 1 | 2;
}

/** Ekran decyzji: treść zgody, którą baza zapisze, notka i przycisk(i). */
export function MeasurementGrantPrompt({
  t,
  lang,
  lead,
  busy,
  onGrant,
  onDecline,
  headingLevel = 1,
}: MeasurementGrantPromptProps) {
  return (
    <>
      <MailCheck className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
      <Heading level={headingLevel}>{t("newsletterMeasurement.grantTitle")}</Heading>
      <p className="text-sm text-muted-foreground">{lead}</p>
      <p className="text-sm text-left border border-border rounded-lg p-3">
        <MeasurementConsentText lang={lang} />
      </p>
      <p className="text-sm text-muted-foreground">{t("newsletterMeasurement.grantNote")}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onGrant} disabled={busy}>
          {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.grantBtn")}
        </Button>
        {onDecline && (
          <Button type="button" onClick={onDecline} disabled={busy}>
            {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.declineBtn")}
          </Button>
        )}
      </div>
    </>
  );
}

export interface MeasurementOutcomeViewProps {
  t: TFunction;
  outcome: MeasurementOutcome;
  busy: boolean;
  /** Ponowienie przy błędzie przejściowym (`error`, `rateLimited`). */
  onRetry: () => void;
  headingLevel?: 1 | 2;
  /**
   * Licznik zakończonych decyzji hosta. Każda zmiana przenosi fokus na
   * nagłówek wyniku (przycisk, który miał fokus, zniknął). Brak = wynik bez
   * kliknięcia (np. zaraz po wejściu na stronę) - fokus zostaje, gdzie był.
   */
  focusKey?: number;
}

/** Ekran wyniku: ikona, tytuł, treść i - przy błędzie przejściowym - ponowienie. */
export function MeasurementOutcomeView({
  t,
  outcome,
  busy,
  onRetry,
  headingLevel = 1,
  focusKey,
}: MeasurementOutcomeViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusKey !== undefined) headingRef.current?.focus();
  }, [focusKey]);
  return (
    <>
      {POSITIVE.has(outcome) ? (
        <CheckCircle2 className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
      ) : (
        <XCircle className="w-10 h-10 mx-auto text-destructive" aria-hidden="true" />
      )}
      <Heading level={headingLevel} headingRef={headingRef} focusable={focusKey !== undefined}>
        {t(TITLE_KEY[outcome])}
      </Heading>
      <p className="text-sm text-muted-foreground">{t(BODY_KEY[outcome])}</p>
      {isRetryableOutcome(outcome) && (
        <Button type="button" onClick={onRetry} disabled={busy} className="mt-2">
          {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.retryBtn")}
        </Button>
      )}
    </>
  );
}
