// Organizm: „Zacznij tutaj" na Kokpicie dla nowego najemcy (SPEC §2.2
// `overview`, §6.1) - brak planu w sprzedaży, ustawień licznika, retencji
// albo wyłączony silnik ścieżek, każdy krok z odnośnikiem do ekranu, który go
// ustawia.
//
// Kroki liczy `gettingStartedSteps` z faktów S7-A (ten sam klucz co „Wymaga
// uwagi" - bez dodatkowego żądania). Karta znika, gdy nic nie jest „do
// zrobienia": dla skonfigurowanego serwisu byłaby szumem.
//
// STATUS SŁOWEM I IKONĄ, nie samym kolorem (WCAG 1.4.1).
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { Button } from "@/components/ui/button";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { revenueFactsQueryOptions } from "@/lib/revenue/diagnostics/queries";
import {
  gettingStartedSteps,
  needsGettingStarted,
  type GettingStartedStatus,
  type GettingStartedStepId,
} from "./gettingStarted";

const STEP_KEYS: Readonly<
  Record<GettingStartedStepId, { title: string; hint: string; action: string }>
> = {
  plans: {
    title: "adminRevenue.overview.gettingStarted.step.plans.title",
    hint: "adminRevenue.overview.gettingStarted.step.plans.hint",
    action: "adminRevenue.overview.gettingStarted.step.plans.action",
  },
  metering: {
    title: "adminRevenue.overview.gettingStarted.step.metering.title",
    hint: "adminRevenue.overview.gettingStarted.step.metering.hint",
    action: "adminRevenue.overview.gettingStarted.step.metering.action",
  },
  retention: {
    title: "adminRevenue.overview.gettingStarted.step.retention.title",
    hint: "adminRevenue.overview.gettingStarted.step.retention.hint",
    action: "adminRevenue.overview.gettingStarted.step.retention.action",
  },
  journeys: {
    title: "adminRevenue.overview.gettingStarted.step.journeys.title",
    hint: "adminRevenue.overview.gettingStarted.step.journeys.hint",
    action: "adminRevenue.overview.gettingStarted.step.journeys.action",
  },
};

const STATUS_KEY: Readonly<Record<GettingStartedStatus, string>> = {
  done: "adminRevenue.overview.gettingStarted.status.done",
  todo: "adminRevenue.overview.gettingStarted.status.todo",
  unknown: "adminRevenue.overview.gettingStarted.status.unknown",
};

const STATUS_ICON = { done: CheckCircle2, todo: AlertTriangle, unknown: Info } as const;

export interface GettingStartedCardProps {
  tenantId: string | null;
  roles: readonly string[];
}

export function GettingStartedCard({ tenantId, roles }: GettingStartedCardProps) {
  ensureI18n();
  const { t } = useTranslation();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const steps = useMemo(
    () => (facts.data?.state === "ready" ? gettingStartedSteps(facts.data.facts) : null),
    [facts.data],
  );

  if (!tenantId || !roleOk || steps === null || !needsGettingStarted(steps)) return null;
  const done = steps.filter((step) => step.status === "done").length;

  return (
    <div data-testid="revenue-getting-started">
      <RevenueSection
        titleKey="adminRevenue.overview.gettingStarted.title"
        descriptionKey="adminRevenue.overview.gettingStarted.description"
        actions={
          <span className="text-xs tabular-nums text-muted-foreground">
            {t("adminRevenue.overview.gettingStarted.progress", { done, total: steps.length })}
          </span>
        }
      >
        <ol className="m-0 grid list-none gap-2 p-0 md:grid-cols-2">
          {steps.map((step) => {
            const Icon = STATUS_ICON[step.status];
            const keys = STEP_KEYS[step.id];
            return (
              <li
                key={step.id}
                data-step={step.id}
                data-status={step.status}
                className="flex min-w-0 items-start gap-2 rounded-[6px] border border-border p-3"
              >
                <Icon
                  className={
                    step.status === "todo"
                      ? "mt-0.5 h-4 w-4 shrink-0 text-brand-ink dark:text-brand"
                      : "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  }
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="m-0 text-sm font-medium">{t(keys.title)}</p>
                  <p className="m-0 text-xs text-muted-foreground">
                    {t(STATUS_KEY[step.status])}
                    {step.status === "todo" ? ` - ${t(keys.hint)}` : null}
                  </p>
                  {step.status === "todo" ? (
                    <Button asChild size="sm" variant="outline" className="h-7">
                      <Link to={step.link.to} search={step.link.search}>
                        {t(keys.action)}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </RevenueSection>
    </div>
  );
}
