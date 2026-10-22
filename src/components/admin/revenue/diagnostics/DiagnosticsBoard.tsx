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
// nie występuje" (`role="status"`). Dialog otwarty dla aktywnego problemu
// trzyma SWOJĄ diagnozę do zamknięcia: po udanej naprawie reguła jest już
// „w porządku", a dialog musi zostać, żeby ogłosić wynik i dać „Cofnij".
//
// `?finding=` pokazuje wskazaną diagnozę także wtedy, gdy filtry by ją
// ukryły (np. odnośnik z Kokpitu do wyciszonej) - pozostałe filtry działają.
//
// WYNIKI AKCJI W REGIONIE `aria-live`, NIE W TOAŚCIE: wyciszenie, zdjęcie
// wyciszenia i odmowa (rola, MFA, brak funkcji w bazie) zostają w treści
// tablicy, w jednym miejscu, które czytnik ogłasza.
//
// ZERO WŁASNYCH ZAPYTAŃ: fakty i wyciszenia z fabryk `revenueFactsQueryOptions`
// i `revenueSnoozesQueryOptions` (bramka `revenueKeysReuse`). Dialog naprawy
// ładuje się leniwie - rejestr napraw ciągnie mutatory kilkunastu modułów,
// a lista diagnoz ich nie potrzebuje.
import { lazy, Suspense, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { AreaChip } from "@/components/admin/revenue/atoms/AreaChip";
import { MfaRequiredNotice } from "@/components/admin/revenue/molecules/MfaRequiredNotice";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { SourceHeader } from "@/components/admin/revenue/molecules/SourceHeader";
import { Button } from "@/components/ui/button";
import { PlatformSelect } from "@/components/ui/platform-select";
import {
  DIAGNOSTIC_STATE_FILTERS,
  DEFAULT_DIAGNOSTIC_FILTERS,
  areaHealth,
  filterFindings,
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
import { chartLangFrom } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import type { RevenueSnoozeWrite } from "@/lib/revenue/diagnostics/diagnostics.functions";
import {
  evaluateFindings,
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
  useUnsnoozeRevenueCheck,
} from "@/lib/revenue/diagnostics/queries";
import { isRevenueCheckId, type RevenueFinding } from "@/lib/revenue/diagnostics/registry";
import type { SnoozeKind } from "@/lib/revenue/limits";
import type { RevenueView } from "@/lib/revenue/search";
import { DiagnosticCard } from "./DiagnosticCard";
import { SnoozeDialog } from "./SnoozeDialog";
import { SystemMapGrid } from "./SystemMapGrid";
import { findingDomId, findingForFix, isProblem } from "./findingText";

const QuickFixDialog = lazy(() =>
  import("./QuickFixDialog").then((module) => ({ default: module.QuickFixDialog })),
);

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
  onSearchChange(patch: {
    [K in keyof DiagnosticsSearch]?: DiagnosticsSearch[K] | undefined;
  }): void;
}

const LOCALE = { pl: "pl-PL", en: "en-GB" } as const;
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

type BoardNotice = { kind: "text"; text: string } | { kind: "mfa" } | null;

export function DiagnosticsBoard({
  tenantId,
  roles,
  search,
  onSearchChange,
}: DiagnosticsBoardProps) {
  ensureShellI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const isAdmin = roles.includes("admin");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const snoozes = useQuery(revenueSnoozesQueryOptions(tenantId, { roleOk }));
  const unsnooze = useUnsnoozeRevenueCheck(tenantId);
  const [severity, setSeverity] = useState<RevenueSeverity | null>(null);
  const [stateFilter, setStateFilter] = useState<DiagnosticStateFilter>(
    DEFAULT_DIAGNOSTIC_FILTERS.state,
  );
  const [snoozing, setSnoozing] = useState<{ finding: RevenueFinding; kind: SnoozeKind } | null>(
    null,
  );
  const [notice, setNotice] = useState<BoardNotice>(null);
  const [fixSession, setFixSession] = useState<{ fix: string; finding: RevenueFinding } | null>(
    null,
  );
  const areaId = useId();

  const ready = facts.data?.state === "ready" ? facts.data : null;
  const snoozesOk = snoozes.data?.state === "ready";
  const findings = useMemo(() => {
    if (!ready) return [];
    const active = snoozes.data?.state === "ready" ? snoozes.data.snoozes : [];
    return evaluateFindings(ready.facts, active, Date.now());
  }, [ready, snoozes.data]);

  const area = isRevenueArea(search.area) ? search.area : null;
  const view: RevenueView = search.view ?? "list";
  const focusId = isRevenueCheckId(search.finding) ? search.finding : null;
  const focusFinding = focusId ? (findings.find((f) => f.checkId === focusId) ?? null) : null;
  const fixFinding = findingForFix(findings, search.fix);

  // Sesja dialogu naprawy - stan dopasowany w renderze (bez mignięcia efektu):
  // otwiera się dla AKTYWNEGO problemu i trwa, dopóki `?fix=` jest w adresie.
  if (!search.fix && fixSession) setFixSession(null);
  if (
    search.fix &&
    fixSession?.fix !== search.fix &&
    fixFinding !== null &&
    isProblem(fixFinding)
  ) {
    setFixSession({ fix: search.fix, finding: fixFinding });
  }

  // Fokus RAZ na wejście z adresem (albo powrót do listy), nie przy każdym
  // odświeżeniu faktów - szyna zdarzeń odświeża je w tle i fokus skakałby
  // adminowi spod ręki.
  const hasFacts = ready !== null;
  useEffect(() => {
    if (!focusId || view !== "list" || !hasFacts) return;
    const element = document.getElementById(findingDomId(focusId));
    if (!element) return;
    element.scrollIntoView?.({ block: "center" });
    element.focus({ preventScroll: true });
  }, [focusId, view, hasFacts]);

  if (!roleOk) return null;
  if (!tenantId) return <Notice>{t("adminRevenue.diagnostics.noTenant")}</Notice>;
  if (facts.data?.state === "mfa_required") return <MfaRequiredNotice />;
  if (facts.data?.state === "forbidden") {
    return <Notice>{t("adminRevenue.diagnostics.forbidden")}</Notice>;
  }
  if (facts.data?.state === "unavailable") {
    return <Notice>{t("adminRevenue.diagnostics.unavailable")}</Notice>;
  }
  if (!ready && facts.isError) {
    return (
      <Notice>
        <span>{t("adminRevenue.diagnostics.error")}</span>{" "}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          onClick={() => void facts.refetch()}
        >
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

  const visible = filterFindings(findings, { area, severity, state: stateFilter });
  if (focusFinding && !visible.includes(focusFinding)) visible.push(focusFinding);
  const groups = REVENUE_AREAS.map((candidate) => ({
    area: candidate,
    score: areaHealth(findings, candidate).score,
    findings: visible.filter((f) => f.area === candidate),
  })).filter((group) => group.findings.length > 0);
  const counts = stateCounts(findings);
  const filtered = stateFilter !== "open" || area !== null || severity !== null;
  const locale = LOCALE[chartLangFrom(i18n.language)];
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
  const closeFix = () => onSearchChange({ fix: undefined });
  const snoozeNotice = (result: RevenueSnoozeWrite, okKey: string): BoardNotice => {
    if (result.state === "ok") return { kind: "text", text: t(okKey) };
    if (result.state === "mfa_required") return { kind: "mfa" };
    if (result.state === "invalid") {
      return { kind: "text", text: t(`adminRevenue.snooze.invalid.${result.code}`) };
    }
    return { kind: "text", text: t(`adminRevenue.snooze.${result.state}`) };
  };

  return (
    <div className="space-y-4" data-testid="diagnostics-board">
      <RevenueSection
        titleKey="adminRevenue.diagnostics.title"
        descriptionKey="adminRevenue.diagnostics.subtitle"
        actions={
          <>
            {factsAt ? (
              <span className="text-xs text-muted-foreground">
                {t("adminRevenue.diagnostics.factsAt", { time: factsAt })}
              </span>
            ) : null}
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
          </>
        }
      >
        <p className="m-0 text-sm" aria-live="polite" data-testid="diagnostics-summary">
          {t("adminRevenue.diagnostics.summary", { count: counts.open })}
          {counts.unknown > 0 ? (
            <span className="text-muted-foreground">
              {" · "}
              {t("adminRevenue.diagnostics.summaryUnknown", { count: counts.unknown })}
            </span>
          ) : null}
        </p>
        {!snoozesOk && !snoozes.isPending ? (
          <p
            className="m-0 text-xs text-muted-foreground"
            data-testid="diagnostics-snoozes-missing"
          >
            {t("adminRevenue.diagnostics.snoozesUnavailable")}
          </p>
        ) : null}

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t("adminRevenue.diagnostics.viewLabel")}
        >
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
          <div
            className="flex flex-wrap items-end gap-3"
            role="group"
            aria-label={t("adminRevenue.diagnostics.filtersLabel")}
          >
            <div className="w-full space-y-1 sm:w-56">
              <label htmlFor={areaId} className="block text-xs font-medium text-muted-foreground">
                {t("adminRevenue.diagnostics.areaFilter")}
              </label>
              <PlatformSelect
                id={areaId}
                value={area ?? ALL}
                onChange={(event) => {
                  const next = event.target.value;
                  onSearchChange({ area: next === ALL ? undefined : next, finding: undefined });
                }}
              >
                <option value={ALL}>{t("adminRevenue.diagnostics.allAreas")}</option>
                {REVENUE_AREAS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {t(AREA_KEY(candidate))}
                  </option>
                ))}
              </PlatformSelect>
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
                // Liczba w nawiasie to nie tekst do tłumaczenia - jeden napis stanu.
                label: `${t(STATE_KEY[s])} (${counts[s]})`,
              }))}
              selected={stateFilter}
              onSelect={setStateFilter}
            />
          </div>
        ) : null}
      </RevenueSection>

      <div role="status" data-testid="diagnostics-notice" className="text-sm">
        {notice?.kind === "text" ? <p className="m-0">{notice.text}</p> : null}
      </div>
      {notice?.kind === "mfa" ? <MfaRequiredNotice /> : null}

      {search.fix && !fixSession ? (
        <Notice testId="diagnostics-fix-gone">
          <span>
            {fixFinding === null
              ? t("adminRevenue.diagnostics.fixInvalid")
              : fixFinding.state === "unknown"
                ? t("adminRevenue.diagnostics.fixUnknown")
                : t("adminRevenue.diagnostics.fixGone")}
          </span>{" "}
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={closeFix}>
            {t("adminRevenue.fix.close")}
          </Button>
        </Notice>
      ) : null}
      {search.finding && !focusFinding ? (
        <Notice testId="diagnostics-focus-missing">
          {t("adminRevenue.diagnostics.focusMissing")}
        </Notice>
      ) : null}

      {/* Przywrócenie wyciszenia to zapis bytu `revenue_diagnostic` (jak samo
          wyciszenie) - nagłówek źródła stoi nad listą tylko wtedy, gdy admin
          ma na niej wyciszoną diagnozę, czyli przycisk „Przywróć”. */}
      {view === "list" && isAdmin && visible.some((f) => f.snooze !== null) ? (
        <SourceHeader entity="revenue_diagnostic" />
      ) : null}

      {view === "map" ? (
        <SystemMapGrid />
      ) : groups.length === 0 ? (
        <Notice testId="diagnostics-empty">
          <span>
            {filtered
              ? t("adminRevenue.diagnostics.empty.filtered")
              : t("adminRevenue.diagnostics.empty.open")}
          </span>{" "}
          {filtered ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={clearFilters}
            >
              {t("adminRevenue.diagnostics.empty.clear")}
            </Button>
          ) : null}
        </Notice>
      ) : (
        groups.map((group) => (
          <FindingGroupSection key={group.area} area={group.area} score={group.score}>
            {group.findings.map((finding) => (
              <li key={finding.checkId}>
                <DiagnosticCard
                  finding={finding}
                  variant="full"
                  headingLevel={4}
                  canSnooze={isAdmin}
                  focused={finding.checkId === focusId}
                  factsAt={ready.facts.computedAt}
                  onFix={() => onSearchChange({ fix: finding.checkId })}
                  onSnooze={(kind) => setSnoozing({ finding, kind })}
                  onUnsnooze={() =>
                    unsnooze.mutate(
                      { checkId: finding.checkId },
                      {
                        onSuccess: (result) =>
                          setNotice(snoozeNotice(result, "adminRevenue.snooze.removed")),
                        onError: () =>
                          setNotice({ kind: "text", text: t("adminRevenue.snooze.failed") }),
                      },
                    )
                  }
                />
              </li>
            ))}
          </FindingGroupSection>
        ))
      )}

      {fixSession ? (
        <Suspense fallback={null}>
          <QuickFixDialog
            finding={fixSession.finding}
            facts={ready.facts}
            tenantId={tenantId}
            roles={roles}
            open
            onOpenChange={(open) => {
              if (!open) closeFix();
            }}
          />
        </Suspense>
      ) : null}
      {snoozing ? (
        <SnoozeDialog
          finding={snoozing.finding}
          initialKind={snoozing.kind}
          tenantId={tenantId}
          open
          onSaved={() => setNotice({ kind: "text", text: t("adminRevenue.snooze.saved") })}
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
      <h3 id={headingId} className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold">
        {/* Chip powtarza nazwę obszaru z tekstu nagłówka - czytnik słyszy ją raz. */}
        <span aria-hidden="true">
          <AreaChip area={area} />
        </span>
        <span>
          {score === null
            ? t("adminRevenue.diagnostics.groupHeadingNoData", { area: areaLabel })
            : t("adminRevenue.diagnostics.groupHeading", { area: areaLabel, score })}
        </span>
      </h3>
      <ul className="m-0 list-none space-y-2 p-0">{children}</ul>
    </section>
  );
}
