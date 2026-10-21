// Organizm: przepływ anulowania widziany oczami klienta - ile kroków dzieli
// go od rezygnacji i co na nich jest (SPEC §2.2 `retention`: „przepływ
// anulowania (≤ 2 kroki)"; karta S7).
//
// KROKI Z USTAWIEŃ, TE SAME WARUNKI CO DIALOG. Liczba kroków wynika
// z `retention_settings` (`cancelFlowSteps`) dokładnie tak, jak dialog
// czytelnika i `offerFor` po stronie serwera decydują o ofercie: retencja
// wyłączona = samo potwierdzenie, włączona = powód i komentarz, a oferta
// jako drugi krok tylko przy rabacie > 0. Więcej niż dwa kroki nie istnieją
// (DSA art. 25, wytyczne UOKiK) - „Anuluj mimo to" jest na każdym kroku.
//
// ŹRÓDŁO PRAWDY W CENNIKU. Ustawienia edytuje zakładka Retencja w Cenniku
// (`SourceHeader` z bytem `retention_settings` z `HUB_SYNC_MANIFEST`) - hub
// nie ma drugiej kopii formularza. Odczyt idzie fabryką modułu
// (`retentionSettingsQueryOptions("admin")`), więc zapis w Cenniku odświeża
// tę kartę tym samym kluczem.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { SourceHeader } from "@/components/admin/revenue/molecules/SourceHeader";
import { FinanceCardFrame } from "@/components/admin/revenue/mrr/FinanceCardFrame";
import { queryDenial, type HubCardStatus } from "@/components/admin/revenue/overview/hubWindow";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { retentionSettingsQueryOptions } from "@/lib/retention/queries";
import { cancelFlowSteps, type CancelFlowStep } from "./retentionModel";

export interface CancellationFlowViewProps {
  tenantId: string | null;
}

export function CancellationFlowView({ tenantId }: CancellationFlowViewProps) {
  ensureI18n();
  const { t } = useTranslation();
  const stepText = (step: CancelFlowStep): string => {
    switch (step.kind) {
      case "confirm":
        return t("adminRevenue.retention.flowStepConfirm");
      case "reason":
        return t("adminRevenue.retention.flowStepReason");
      case "offer":
        return t("adminRevenue.retention.flowStepOffer", { pct: step.pct, count: step.periods });
    }
  };
  const query = useQuery({
    ...retentionSettingsQueryOptions("admin"),
    enabled: Boolean(tenantId),
  });

  // Odczyt RLS modułu (nie RPC huba) - stan karty z wyniku `useQuery`.
  let status: HubCardStatus | "ready";
  if (!tenantId) status = "no_tenant";
  else if (query.isSuccess) status = "ready";
  else if (query.isError) status = queryDenial(query.error) ?? "error";
  else status = "loading";

  let body = null;
  if (status === "ready") {
    const settings = query.data ?? null;
    const steps = cancelFlowSteps(settings);
    const enabled = settings?.enabled === true;
    body = (
      <div className="space-y-2">
        <p className="m-0 text-sm font-medium" data-testid="cancel-flow-count">
          {t("adminRevenue.retention.cancelFlowSteps", { count: steps.length })}
        </p>
        <ol className="m-0 list-decimal space-y-1 pl-5 text-sm" data-testid="cancel-flow-steps">
          {steps.map((step) => (
            <li key={step.kind} data-step={step.kind}>
              {stepText(step)}
            </li>
          ))}
        </ol>
        <p className="m-0 text-xs text-muted-foreground">
          {enabled
            ? t("adminRevenue.retention.flowExitAlways")
            : t("adminRevenue.retention.flowOff")}
        </p>
        {steps.some((step) => step.kind === "offer") ? (
          <p className="m-0 text-xs text-muted-foreground">
            {t("adminRevenue.retention.flowOfferEligible")}
          </p>
        ) : null}
        <SourceHeader entity="retention_settings" />
      </div>
    );
  }

  return (
    <FinanceCardFrame
      testId="cancel-flow"
      title={t("adminRevenue.retention.cancelFlowTitle")}
      // Ustawienia przepływu to konfiguracja, nie kwoty - rama nie blokuje
      // ich rolą (zakładka i tak jest tylko dla administratora).
      isAdmin
      status={status}
      onRetry={() => void query.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}
