// Molekula: lejek reklam wydarzenia jako lista krokow z paskami.
//
// CIENKA NAKLADKA NA `FunnelBars` (SPEC §6.1). Lejek huba, lejek reklam
// i przejscia krokow sciezki to jeden organizm; tu zostaje wylacznie to, co
// nalezy do modulu wydarzen: slownik `adminEventAdsFunnel.*` i udzial
// liczony `stepRate` (ten sam, ktorym liczy tabela kampanii obok).
// Znacznik jest identyczny z dotychczasowym (lista z nazwa, wiersz
// „etykieta + wartosc”, pasek `aria-hidden` wzgledem PIERWSZEGO kroku, kreska
// przy zerowym mianowniku) - przypina go test molekuly.
import { useTranslation } from "react-i18next";

import { FunnelBars } from "@/components/admin/analytics/FunnelBars";
import { stepRate } from "@/lib/events/adsFunnel";
import { ensureAdsFunnelI18n } from "@/lib/i18n-admin-event-ads-funnel";

export interface AdsFunnelBarStep {
  key: string;
  label: string;
  value: number;
}

function percentText(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function AdsFunnelBars({ steps }: { steps: readonly AdsFunnelBarStep[] }) {
  ensureAdsFunnelI18n();
  const { t } = useTranslation();

  return (
    <FunnelBars
      steps={steps.map((step, index) => ({
        ...step,
        rate: index === 0 ? undefined : stepRate(step.value, steps[index - 1]?.value ?? 0),
      }))}
      labels={{
        list: t("adminEventAdsFunnel.funnel.ariaLabel"),
        empty: t("adminEventAdsFunnel.funnel.empty"),
        ofPrevious: (percent) => t("adminEventAdsFunnel.funnel.ofPrevious", { percent }),
      }}
      formatRate={percentText}
    />
  );
}
