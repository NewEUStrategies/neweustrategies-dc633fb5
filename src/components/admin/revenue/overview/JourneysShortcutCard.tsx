// Organizm: karta skrótu „Ścieżki komunikacji" na Kokpicie (SPEC §2.2
// `overview` - „karta Ścieżki", producent `journeyList` S5).
//
// TA SAMA FABRYKA CO ZAKŁADKA ŚCIEŻKI (`journeyListQueryOptions(t,
// "active")`), więc przejście Kokpit → Ścieżki nie pobiera listy drugi raz.
// Odczyt idzie przez `requireCrmStaff`: konto z MFA bez `aal2` dostaje
// wyjątek `mfa_required`, który karta pokazuje jako `MfaRequiredNotice`
// (stan karty, nie toast).
//
// Liczby to suma po aktywnych ścieżkach: wejścia i osiągnięte cele z 30 dni
// (pola listy S5) - bez własnej arytmetyki okna.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { journeyListQueryOptions } from "@/lib/journeys/queries";
import { HubCardState } from "./HubCardState";
import { cardStatusOf } from "./hubWindow";

export interface JourneysShortcutCardProps {
  tenantId: string | null;
}

export function JourneysShortcutCard({ tenantId }: JourneysShortcutCardProps) {
  ensureI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const query = useQuery(journeyListQueryOptions(tenantId, "active"));
  const status = cardStatusOf(query, tenantId);

  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.overview.journeys.forbidden"
        unavailableKey="adminRevenue.overview.journeys.unavailable"
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data?.state === "ready") {
    const journeys = query.data.data;
    const enrolled = journeys.reduce((sum, j) => sum + j.enrolled30d, 0);
    const goals = journeys.reduce((sum, j) => sum + j.goalReached30d, 0);
    body =
      journeys.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.overview.journeys.none")}
        </p>
      ) : (
        <ul className="m-0 list-none space-y-1 p-0 text-sm">
          <li className="font-medium">
            {t("adminRevenue.overview.journeys.active", { count: journeys.length })}
          </li>
          <li className="text-muted-foreground">
            {t("adminRevenue.overview.journeys.enrolled", { count: enrolled })}
          </li>
          <li className="text-muted-foreground">
            {t("adminRevenue.overview.journeys.goals", { count: goals })}
          </li>
        </ul>
      );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="overview-journeys"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.overview.journeys.title")}
        </h3>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/revenue/$tab" params={{ tab: "journeys" }}>
            {t("adminRevenue.overview.journeys.open")}
          </Link>
        </Button>
      </div>
      {body}
    </section>
  );
}
