// Molekuła: notka z dymkiem „otwarcia i kliknięcia tylko u odbiorców ze
// zgodą na pomiar" (I9d-Y2) - statystyki kampanii newslettera i wyniki
// ścieżek (tabela maili, panel kroku).
//
// DLACZEGO. Od I9d-Y2 piksel i linki z identyfikatorem odbiorcy dostają
// wyłącznie osoby ze zgodą obejmującą pomiar (przy włączonym wspólnym
// przełączniku najemcy). Wskaźniki otwarć i kliknięć spadną skokowo po
// wdrożeniu - bez notki admin uznałby to za realny spadek zaangażowania.
// Trzy warianty mówią o MIANOWNIKU uczciwie:
//   * `campaign` - kampanie znają liczbę odbiorców mierzonych
//     (`admin_newsletter_campaign_measurement`), więc wskaźnik dzieli przez
//     mierzonych (kampanie sprzed Y2 - przez wszystkich wysłanych);
//   * `journey` - statystyki ścieżek tej liczby nie mają: mianownik to
//     wszystkie wysłane maile, wskaźnik jest więc niższy niż wśród mierzonych;
//   * `dashboard` - kafle otwarć i kliknięć Kokpitu (I9, Z-I9d-16): zdarzenia
//     okna przez wszystkie wysyłki kampanii zakończonych w oknie.
//
// Typografia i dymek jak notka agregatu dobowego (`RetentionAggregateNote`):
// wspólny atom `HintTooltip` (cel 24 px, opis w DOM dla czytnika).
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { ensureI18n } from "@/lib/i18n-admin-measurement-hint";
import { cn } from "@/lib/utils";

/** Treść dymka per wariant - klucze literalnie (bramka pokrycia kluczy). */
const BODY_KEYS = {
  campaign: "adminMeasurementHint.campaign",
  journey: "adminMeasurementHint.journey",
  dashboard: "adminMeasurementHint.dashboard",
} as const;

export function MeasurementConsentNote({
  scope,
  className,
}: {
  scope: keyof typeof BODY_KEYS;
  className?: string;
}) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  return (
    <p
      data-measurement-note={scope}
      className={cn(
        "flex flex-wrap items-center gap-1 text-[11px] leading-snug text-muted-foreground",
        className,
      )}
    >
      {t("adminMeasurementHint.short")}
      <HintTooltip id={id} text={t(BODY_KEYS[scope])} label={t("adminMeasurementHint.label")} />
    </p>
  );
}
