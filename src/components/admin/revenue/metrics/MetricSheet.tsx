// Organizm: arkusz wskaźnika sterowany ADRESEM (`?metric=&ctx=`, SPEC §6.5)
// - pełne objaśnienie S6 (`MetricExplainerBody`, tryb `full`): definicja,
// wzór, dźwignie, konteksty i pasma benchmarku, źródła, alert przeglądu.
//
// ADRES JEST STANEM. Otwarty wskaźnik i wybrany kontekst porównania żyją
// w adresie, więc arkusz da się udostępnić odnośnikiem (także ze skrótu ⌘K
// „NRR · Wskaźniki"), a „Wstecz" go zamyka. Nieznany `?metric=` nie otwiera
// niczego; nieznany `?ctx=` spada do domyślnego kontekstu wpisu (S6).
//
// TREŚĆ LENIWIE. Objaśnienie ciągnie rejestr benchmarków i skalę - ładuje
// się dopiero, gdy adres otwiera arkusz, więc zakładka maluje słownik bez
// czekania na nie.
import { Suspense, lazy, useId } from "react";
import { useTranslation } from "react-i18next";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { BenchContextSegment } from "@/lib/analytics/semantic/benchmarks/types";
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { metricNames } from "./metricsModel";

const MetricExplainerBody = lazy(() =>
  import("@/components/admin/analytics/semantic/molecules/MetricExplainer").then((m) => ({
    default: m.MetricExplainerBody,
  })),
);

export interface MetricSheetProps {
  /** Wskaźnik z `?metric=` (już zwalidowany rejestrem); `null` = arkusz zamknięty. */
  metricId: MetricId | null;
  /** Kontekst porównania z `?ctx=`. */
  ctx: string | undefined;
  /** Wartość z mapy słownika: brak w mapie = objaśnienie bez wiersza „teraz". */
  values: ReadonlyMap<MetricId, number | null>;
  samples: ReadonlyMap<MetricId, number>;
  currency: string | null;
  segment: BenchContextSegment | undefined;
  onClose: () => void;
  onCtxChange: (ctx: string) => void;
}

export function MetricSheet({
  metricId,
  ctx,
  values,
  samples,
  currency,
  segment,
  onClose,
  onCtxChange,
}: MetricSheetProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();

  return (
    <Sheet
      open={metricId !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        aria-labelledby={headingId}
        aria-describedby={undefined}
        className="w-full overflow-y-auto sm:max-w-lg"
        data-testid="metric-sheet"
      >
        {metricId ? (
          <Suspense
            fallback={
              // Tytuł arkusza już w stanie ładowania: okno dialogowe ma nazwę
              // od pierwszej klatki (Radix i czytnik ekranu jej wymagają).
              <div className="space-y-2">
                <SheetTitle id={headingId} className="text-base font-semibold">
                  {t("adminRevenue.metrics.sheetTitle", {
                    name: metricNames(metricId, lang).label,
                  })}
                </SheetTitle>
                <p role="status" className="m-0 text-sm text-muted-foreground">
                  {t("adminRevenue.common.loading")}
                </p>
              </div>
            }
          >
            <MetricExplainerBody
              metricId={metricId}
              value={values.has(metricId) ? (values.get(metricId) ?? null) : undefined}
              n={samples.get(metricId)}
              currency={currency ?? undefined}
              segment={segment}
              ctx={ctx}
              onCtxChange={onCtxChange}
              lang={lang}
              mode="full"
              headingId={headingId}
              heading="sheet"
            />
          </Suspense>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
