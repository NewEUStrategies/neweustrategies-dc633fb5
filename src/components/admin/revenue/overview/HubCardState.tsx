// Atom stanu karty huba: brak najemcy, wczytywanie, błąd z ponowieniem,
// odmowa roli, brak funkcji w bazie i wymagane MFA (SPEC §2.5, §6.1).
//
// STANY KART, NIE TOASTY. Odmowa roli i migracja w drodze to stany trwałe -
// toast znika po sekundach, a karta zostawałaby pusta bez wyjaśnienia.
// Każda karta S7 mówi więc w swoim miejscu siatki, DLACZEGO nie ma liczb,
// a tekst odmowy i „pojawi się po wdrożeniu" bierze ze słownika swojej
// dziedziny (lejek, finanse, społeczność), bo te zdania już istnieją.
//
// GEOMETRIA JEDNA DLA WSZYSTKICH STANÓW: ten sam akapit `text-sm` w tej samej
// ramce karty - przełączenie z „wczytywanie" na „brak danych" nie przesuwa
// siatki (AGENTS: geometria identyczna w obu motywach, różnią się kolory).
import { useTranslation } from "react-i18next";

import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { HubCardStatus } from "./hubWindow";

export interface HubCardStateProps {
  status: HubCardStatus;
  /** Zdanie odmowy roli ze słownika dziedziny (np. `adminRevenue.funnel.state.forbidden`). */
  forbiddenKey: string;
  /** Zdanie „pojawi się po wdrożeniu" ze słownika dziedziny. */
  unavailableKey: string;
  onRetry?: () => void;
}

export function HubCardState({ status, forbiddenKey, unavailableKey, onRetry }: HubCardStateProps) {
  ensureRevenueI18n();
  ensureI18n();
  const { t } = useTranslation();

  if (status === "mfa_required") return <MfaRequiredNotice />;
  if (status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <span>{t("adminRevenue.overview.state.error")}</span>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={onRetry}>
            {t("adminRevenue.overview.state.retry")}
          </Button>
        ) : null}
      </div>
    );
  }
  const key =
    status === "forbidden"
      ? forbiddenKey
      : status === "unavailable"
        ? unavailableKey
        : status === "no_tenant"
          ? "adminRevenue.overview.state.noTenant"
          : "adminRevenue.common.loading";
  return (
    <p role="status" data-card-state={status} className="m-0 text-sm text-muted-foreground">
      {t(key)}
    </p>
  );
}
