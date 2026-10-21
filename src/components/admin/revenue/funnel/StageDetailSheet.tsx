// Organizm: arkusz szczegółów kroku lejka (`?stage=`, SPEC §2.4, §6.1).
//
// ADRES, NIE STAN KOMPONENTU. Otwarty krok żyje w parametrze `?stage=`
// (kontrakt `RevenueHubSearch`), więc odnośnik „Konwersja kasy w tym
// miesiącu" da się wkleić koledze, a „Wstecz" w przeglądarce zamyka arkusz.
// Wartość spoza listy kroków (`isFunnelMapStage`) arkusza nie otwiera.
//
// TREŚĆ Z TEGO SAMEGO ODCZYTU CO MAPA (`revenueFunnelSteps`) - liczba
// i udział w arkuszu nie mogą się różnić od paska na mapie. Definicja kroku
// to zdanie S3 (to samo co podpowiedź pola), źródło danych mówi, z której
// populacji krok pochodzi (odwiedzający ze zgodą vs księga), a „Otwórz
// moduł" prowadzi do ekranu, który zmienia to, co krok liczy.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatMetricValue } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { RevenueFunnelDto } from "@/lib/revenue/funnel/dto";
import { revenueFunnelSteps } from "@/lib/revenue/funnel/funnelStages";
import {
  STAGE_HINT_KEY,
  STAGE_LABEL_KEY,
  STAGE_OWNER,
  type FunnelMapStage,
} from "./funnelStageKeys";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface StageDetailSheetProps {
  /** Krok z adresu; `null` = arkusz zamknięty. */
  stage: FunnelMapStage | null;
  /** Odczyt lejka (ten sam co mapa); `null` = jeszcze nie ma danych. */
  funnel: RevenueFunnelDto | null;
  onClose: () => void;
}

export function StageDetailSheet({ stage, funnel, onClose }: StageDetailSheetProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const number = new Intl.NumberFormat(LOCALE[lang]);
  const step =
    stage === null || stage === "activation"
      ? null
      : (revenueFunnelSteps(funnel).find((s) => s.stage === stage) ?? null);
  const owner = stage === null ? null : STAGE_OWNER[stage];
  // Udział ma sens tylko w strumieniu księgi i dla kroków z ilorazem z SQL.
  const hasRate = step !== null && !step.separate && step.rate !== null;

  return (
    <Sheet
      open={stage !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {stage !== null ? (
          <div className="space-y-4" data-testid="stage-detail" data-stage={stage}>
            <SheetHeader>
              <SheetTitle>
                {t("adminRevenue.funnelTab.sheet.title", { stage: t(STAGE_LABEL_KEY[stage]) })}
              </SheetTitle>
              <SheetDescription>{t(STAGE_HINT_KEY[stage])}</SheetDescription>
            </SheetHeader>
            {stage === "activation" ? null : (
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("adminRevenue.funnelTab.sheet.value")}</dt>
                <dd className="m-0 text-right tabular-nums">
                  {step?.value === null || step === null ? "-" : number.format(step.value)}
                </dd>
                <dt className="text-muted-foreground">{t("adminRevenue.funnelTab.sheet.rate")}</dt>
                <dd className="m-0 text-right tabular-nums">
                  {hasRate ? formatMetricValue(step.rate, "ratio", lang) : "-"}
                </dd>
                <dt className="text-muted-foreground">
                  {t("adminRevenue.funnelTab.sheet.stream")}
                </dt>
                <dd className="m-0 text-right">
                  {step?.stream === "first_party"
                    ? t("adminRevenue.funnelTab.sheet.streamFirstParty")
                    : t("adminRevenue.funnelTab.sheet.streamLifecycle")}
                </dd>
              </dl>
            )}
            {stage !== "activation" && !hasRate ? (
              <p className="m-0 text-xs text-muted-foreground">
                {stage === "visitors"
                  ? t("adminRevenue.funnel.separateStream")
                  : t("adminRevenue.funnelTab.sheet.noRate")}
              </p>
            ) : null}
            {owner ? (
              <Button asChild size="sm" variant="outline" className="h-7">
                <Link to={owner.to} search={owner.search}>
                  {t("adminRevenue.funnelTab.sheet.open")}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
