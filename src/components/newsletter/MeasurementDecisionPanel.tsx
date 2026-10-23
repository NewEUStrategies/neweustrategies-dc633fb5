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

function Heading({ level, children }: { level: 1 | 2; children: string }) {
  return level === 1 ? (
    <h1 className="font-display text-2xl">{children}</h1>
  ) : (
    <h2 className="font-display text-xl">{children}</h2>
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
}

/** Ekran wyniku: ikona, tytuł, treść i - przy błędzie przejściowym - ponowienie. */
export function MeasurementOutcomeView({
  t,
  outcome,
  busy,
  onRetry,
  headingLevel = 1,
}: MeasurementOutcomeViewProps) {
  return (
    <>
      {POSITIVE.has(outcome) ? (
        <CheckCircle2 className="w-10 h-10 mx-auto text-brand" aria-hidden="true" />
      ) : (
        <XCircle className="w-10 h-10 mx-auto text-destructive" aria-hidden="true" />
      )}
      <Heading level={headingLevel}>{t(TITLE_KEY[outcome])}</Heading>
      <p className="text-sm text-muted-foreground">{t(BODY_KEY[outcome])}</p>
      {isRetryableOutcome(outcome) && (
        <Button type="button" onClick={onRetry} disabled={busy} className="mt-2">
          {busy ? t("newsletterMeasurement.working") : t("newsletterMeasurement.retryBtn")}
        </Button>
      )}
    </>
  );
}
