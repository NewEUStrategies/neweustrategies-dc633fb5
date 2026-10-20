// Organizm: tablica Diagnostyki (SPEC §2.2 `diagnostics`, §6.1) - lista
// `DiagnosticCard` pogrupowana po obszarze z kondycją 0-100, filtry obszaru
// (`?area=`), wagi i stanu, przełącznik „lista / mapa systemu" (`?view=`),
// fokus diagnozy z adresu (`?finding=`) i dialog naprawy z adresu (`?fix=`).
//
// ADRES PRZEZ PROPSY. Tablica nie woła hooków routera: zakładka podaje
// parametry i `onSearchChange`, więc ten sam organizm testuje się bez trasy
// huba, a o kształcie adresu decyduje jeden walidator układu
// (`parseRevenueHubSearch`). Waga i stan nie mają parametru w kontrakcie
// URL (§2.6) - są stanem lokalnym, domyślnie „otwarte".
//
// `?fix=` SPRAWDZA, CZY REGUŁA NADAL JEST AKTYWNA. Link z maila albo
// z historii przeglądarki może prowadzić do naprawy problemu, który już
// zniknął - zamiast otwierać pusty dialog, mówimy wprost: „Ten problem już
// nie występuje" (`role="status"`).
//
// ZERO WŁASNYCH ZAPYTAŃ: fakty i wyciszenia z fabryk `revenueFactsQueryOptions`
// i `revenueSnoozesQueryOptions` (bramka `revenueKeysReuse`).
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { AreaChip } from "@/components/admin/revenue/atoms/AreaChip";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/atoms/FormSelect";
import {
  DEFAULT_DIAGNOSTIC_FILTERS,
  DIAGNOSTIC_STATE_FILTERS,
  groupFindingsByArea,
  isRevenueArea,
  stateCounts,
  type DiagnosticStateFilter,
} from "@/lib/admin/revenue/diagnosticGroups";
import {
  REVENUE_AREAS,
  REVENUE_SEVERITIES,
  type RevenueArea,
  type RevenueSeverity,
} from "@/lib/admin/revenue/hubTabs";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import {
  evaluateFindings,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
  useUnsnoozeRevenueCheck,
} from "@/lib/revenue/diagnostics/queries";
import {
  isRevenueCheckId,
  isRevenueFixDialogId,
  type RevenueFinding,
} from "@/lib/revenue/diagnostics/registry";
import type { RevenueView } from "@/lib/revenue/search";
import { cn } from "@/lib/utils";
import { DiagnosticCard } from "./DiagnosticCard";
import { QuickFixDialog } from "./QuickFixDialog";
import { SnoozeDialog } from "./SnoozeDialog";
import { SystemMapGrid } from "./SystemMapGrid";
import { findingDomId } from "./findingText";

export interface DiagnosticsSearch {
  area?: string;
  view?: RevenueView;
  finding?: string;
  fix?: string;
}

export interface DiagnosticsBoardProps {
  tenantId: string | null;
  roles: readonly string[];
  search: DiagnosticsSearch;
  /** Łatka adresu; `undefined` usuwa parametr. */
  onSearchChange(patch: { [K in keyof DiagnosticsSearch]?: DiagnosticsSearch[K] | undefined }): void;
}

const AREA_KEY = (area: RevenueArea) => `adminRevenue.area.${area}`;
const SEVERITY_KEY: Readonly<Record<RevenueSeverity, string>> = {
  critical: "adminRevenue.severity.critical",
  warning: "adminRevenue.severity.warning",
  info: "adminRevenue.severity.info",
};
const STATE_KEY: Readonly<Record<DiagnosticStateFilter, string>> = {
  open: "adminRevenue.diagnostics.state.open",
  snoozed: "adminRevenue.diagnostics.state.snoozed",
  ok: "adminRevenue.diagnostics.state.ok",
  unknown: "adminRevenue.diagnostics.state.unknown",
  all: "adminRevenue.diagnostics.state.all",
};
const ALL = "all";

/** Diagnoza wskazana w `?fix=` - id reguły albo dialogu naprawy (SPEC §2.6). */
export function findingForFix(
  findings: readonly RevenueFinding[],
  fix: string | undefined,
): RevenueFinding | null {
  if (!fix) return null;
  if (isRevenueCheckId(fix)) return findings.find((f) => f.checkId === fix) ?? null;
  if (isRevenueFixDialogId(fix)) {
    const matches = findings.filter((f) => f.fix?.kind === "dialog" && f.fix.dialog === fix);
    return (
      matches.find((f) => f.state === "warn" || f.state === "error") ?? matches[0] ?? null
    );
  }
  return null;
}

export function DiagnosticsBoard({ tenantId, roles, search, onSearchChange }: DiagnosticsBoardProps) {
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const isAdmin = roles.includes("admin");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenantId, { roleOk }));
  const unsnooze = useUnsnoozeRevenueCheck(tenantId);
  const [severity, setSeverity] = useState<RevenueSeverity | null>(null);
  const [stateFilter, setStateFilter] = useState<DiagnosticStateFilter>(DEFAULT_DIAGNOSTIC_FILTERS.state);
  const [snoozing, setSnoozing] = useState<RevenueFinding | null>(null);
  const headingId = useId();
  const areaId = useId();

  const ready = facts.data?.state === "ready" ? facts.data : null;
  const findings = useMemo(() => {
    if (!ready) return [];
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return evaluateFindings(ready.facts, active, Date.now());
  }, [ready, snoozes.data]);

  const area = isRevenueArea(search.area) ? search.area : null;
  const view: RevenueView = search.view ?? "list";
  const focusId = isRevenueCheckId(search.finding) ? search.finding : null;
  const focusFinding = focusId ? findings.find((f) => f.checkId === focusId) ?? null : null;
  // Fokus z adresu pokazuje diagnozę także wtedy, gdy filtr stanu by ją ukrył.
  const effectiveState: DiagnosticStateFilter = focusFinding ? "all" : stateFilter;
  const filters = { area, severity, state: effectiveState };
  const groups = groupFindingsByArea(findings, filters);
  const counts = stateCounts(findings);
  const fixFinding = findingForFix(findings, search.fix);
  const fixOpen = fixFinding !== null && (fixFinding.state === "warn" || fixFinding.state === "error");

  useEffect(() => {
    if (!focusId || view !== "list" || !ready) return;
    const element = document.getElementById(findingDomId(focusId));
    if (!element) return;
    element.scrollIntoView?.({ block: "center" });
    element.focus({ preventScroll: true });
  }, [focusId, view, ready]);

  if (!roleOk) return null;
  if (!tenantId) {
    return <Notice>{t("adminRevenue.diagnostics.noTenant")}</Notice>;
  }
  if (facts.data?.state === "mfa_required") return <MfaRequiredNotice />;
  if (facts.data?.state === "forbidden") return <Notice>{t("adminRevenue.diagnostics.forbidden")}</Notice>;
  if (facts.data?.state === "unavailable") return <Notice>{t("adminRevenue.diagnostics.unavailable")}</Notice>;
  if (facts.isError) {
    return (
      <Notice>
        <span>{t("adminRevenue.diagnostics.error")}</span>{" "}
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void facts.refetch()}>
          {t("adminRevenue.diagnostics.refresh")}
        </Button>
      </Notice>
    );
  }
  if (!ready) {
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        {t("adminRevenue.diagnostics.loading")}
      </p>
    );
  }

  const locale = i18n.language.startsWith("en") ? "en-GB" : "pl-PL";
  const factsAt = ready.facts.computedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(ready.facts.computedAt),
      )
    : null;
  const clearFilters = () => {
    setSeverity(null);
    setStateFilter("all");
    onSearchChange({ area: undefined, finding: undefined });
  };

  return (
    <div className="space-y-4" data-testid="diagnostics-board">
      <section aria-labelledby={headingId} className="space-y-3 rounded-[6px] border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <h2 id={headingId} className="m-0 text-base font-semibold">
              {t("adminRevenue.diagnostics.title")}
            </h2>
            <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.diagnostics.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {factsAt ? <span>{t("adminRevenue.diagnostics.factsAt", { time: factsAt })}</span> : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              disabled={facts.isFetching}
              onClick={() => void facts.refetch()}
            >
              {t("adminRevenue.diagnostics.refresh")}
            </Button>
          </div>
        </div>

        <p className="m-0 text-sm" aria-live="polite" data-testid="diagnostics-summary">
          {t("adminRevenue.diagnostics.summary", { count: counts.open })}
          {counts.unknown > 0 ? (
            <span className="text-muted-foreground">
              {" · "}
              {t("adminRevenue.diagnostics.summaryUnknown", { count: counts.unknown })}
            </span>
          ) : null}
        </p>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("adminRevenue.diagnostics.viewLabel")}>
          {(["list", "map"] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              size="sm"
              variant={view === candidate ? "default" : "outline"}
              className="h-7"
              aria-pressed={view === candidate}
              onClick={() => onSearchChange({ view: candidate === "list" ? undefined : candidate })}
            >
              {t(`adminRevenue.diagnostics.view.${candidate}`)}
            </Button>
          ))}
        </div>

        {view === "list" ? (
          <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t("adminRevenue.diagnostics.filtersLabel")}>
            <div className="w-full space-y-1 sm:w-56">
              <label htmlFor={areaId} className="block text-xs font-medium text-muted-foreground">
                {t("adminRevenue.diagnostics.areaFilter")}
              </label>
              <FormSelect
                id={areaId}
                value={area ?? ALL}
                onValueChange={(next) =>
                  onSearchChange({ area: next === ALL ? undefined : next, finding: undefined })
                }
                options={[
                  { value: ALL, label: t("adminRevenue.diagnostics.allAreas") },
                  ...REVENUE_AREAS.map((a) => ({ value: a, label: t(AREA_KEY(a)) })),
                ]}
              />
            </div>
            <ToggleGroup<RevenueSeverity | null>
              label={t("adminRevenue.diagnostics.severityFilter")}
              items={[
                { value: null, label: t("adminRevenue.diagnostics.allSeverities") },
                ...REVENUE_SEVERITIES.map((s) => ({ value: s, label: t(SEVERITY_KEY[s]) })),
              ]}
              selected={severity}
              onSelect={setSeverity}
            />
            <ToggleGroup<DiagnosticStateFilter>
              label={t("adminRevenue.diagnostics.stateFilter")}
              items={DIAGNOSTIC_STATE_FILTERS.map((s) => ({
                value: s,
                label: `${t(STATE_KEY[s])} (${counts[s]})`,
              }))}
              selected={stateFilter}
              onSelect={setStateFilter}
            />
          </div>
        ) : null}
      </section>

      {search.fix && fixFinding && !fixOpen ? (
        <Notice testId="diagnostics-fix-gone">
          {fixFinding.state === "unknown"
            ? t("adminRevenue.diagnostics.fixUnknown")
            : t("adminRevenue.diagnostics.fixGone")}
        </Notice>
      ) : null}
      {focusId && !focusFinding ? <Notice>{t("adminRevenue.diagnostics.focusMissing")}</Notice> : null}

      {view === "map" ? (
        <SystemMapGrid />
      ) : groups.length === 0 ? (
        <Notice testId="diagnostics-empty">
          <span>
            {stateFilter === "open" && area === null && severity === null
              ? t("adminRevenue.diagnostics.empty.open")
              : t("adminRevenue.diagnostics.empty.filtered")}
          </span>{" "}
          {stateFilter !== "open" || area !== null || severity !== null ? (
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={clearFilters}>
              {t("adminRevenue.diagnostics.empty.clear")}
            </Button>
          ) : null}
        </Notice>
      ) : (
        groups.map((group) => (
          <FindingGroupSection key={group.area} area={group.area} score={group.health.score}>
            {group.findings.map((finding) => (
              <li key={finding.checkId}>
                <DiagnosticCard
                  finding={finding}
                  variant="full"
                  canSnooze={isAdmin}
                  focused={finding.checkId === focusId}
                  factsAt={ready.facts.computedAt}
                  onFix={() => onSearchChange({ fix: finding.checkId })}
                  onSnooze={() => setSnoozing(finding)}
                  onUnsnooze={() =>
                    unsnooze.mutate(
                      { checkId: finding.checkId },
                      { onSuccess: () => toast.success(t("adminRevenue.snooze.removed")) },
                    )
                  }
                />
              </li>
            ))}
          </FindingGroupSection>
        ))
      )}

      {fixFinding && fixOpen ? (
        <QuickFixDialog
          finding={fixFinding}
          facts={ready.facts}
          tenantId={tenantId}
          roles={roles}
          open
          onOpenChange={(open) => {
            if (!open) onSearchChange({ fix: undefined });
          }}
        />
      ) : null}
      {snoozing ? (
        <SnoozeDialog
          finding={snoozing}
          tenantId={tenantId}
          open
          onOpenChange={(open) => {
            if (!open) setSnoozing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Notice({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="rounded-[6px] border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function ToggleGroup<T extends string | null>({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: readonly { value: T; label: string }[];
  selected: T;
  onSelect(value: T): void;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground" aria-hidden="true">
        {label}
      </span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {items.map((item) => (
          <Button
            key={item.value ?? ALL}
            type="button"
            size="sm"
            variant={item.value === selected ? "default" : "outline"}
            className="h-7"
            aria-pressed={item.value === selected}
            onClick={() => onSelect(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function FindingGroupSection({
  area,
  score,
  children,
}: {
  area: RevenueArea;
  score: number | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const areaLabel = t(AREA_KEY(area));
  return (
    <section aria-labelledby={headingId} data-area={area} className="space-y-2">
      <h2 id={headingId} className={cn("m-0 flex flex-wrap items-center gap-2 text-sm font-semibold")}>
        <AreaChip area={area} />
        <span>
          {score === null
            ? t("adminRevenue.diagnostics.groupHeadingNoData", { area: areaLabel })
            : t("adminRevenue.diagnostics.groupHeading", { area: areaLabel, score })}
        </span>
      </h2>
      <ul className="m-0 list-none space-y-2 p-0">{children}</ul>
    </section>
  );
}
