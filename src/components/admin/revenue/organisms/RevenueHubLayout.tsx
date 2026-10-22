// Układ huba „Przychód i lejek" (`/admin/revenue`) - nagłówek, filtry okna,
// świeżość danych, pasek sekcji, bramka roli i `<Outlet/>` zakładki
// (SPEC §2, §6.1; PLAN S6 §3.6, V21-V24).
//
// DLACZEGO ROLA JEST SPRAWDZANA TUTAJ, A NIE W TRASIE. Layout `/admin`
// przepuszcza cały personel (`isStaff` = admin, editor, author), a hub jest
// dla admina i redaktora (SPEC §2.5). Warunek w pliku trasy jechałby
// w chunku wejściowym i rozjeżdżał się z bazą przy pierwszej zmianie ról -
// bramka `adminRouteAuthority.gate.test.ts` pilnuje, że trasy huba go nie
// mają. Autorytetem i tak jest baza (polityki `has_role(…, 'admin')`,
// `is_admin_or_editor()`); ten układ tylko nie proponuje ekranu, który baza
// zostawi pusty.
//
// ROLE DOKŁADNE, NIE `isAdmin`. `isAdmin` z `useAuth` liczy też
// `super_admin`, a sam `super_admin` (bez wiersza `admin`) dostałby hub,
// w którym baza bez błędu zwraca zero wierszy - 0 MRR wyglądałoby jak
// prawdziwy brak przychodu. Zakładki filtruje `hubTabsFor(roles)` z tej samej
// reguły; zakładka spoza roli wpisana w adres dostaje `RoleGateNotice`.
//
// `useHydrated()` PRZED CZYMKOLWIEK ZALEŻNYM OD SESJI. Serwer nie zna sesji
// tak jak klient, więc do hydratacji obie strony rysują ten sam stan
// „wczytywanie" - bez `h1` i bez bramki (kontrakt I0,
// `adminRevenueHubRoutes.test.tsx`). Cała reszta mieszka w `RevenueHubShell`,
// żeby hooki routera i cache były wołane dopiero po hydratacji, a kolejność
// hooków się nie zmieniała.
//
// OKNO CZASU LOKALNE. Zakres pod przełącznikiem liczy `resolveRevenueRange`
// z lokalnych północy i jest formatowany z LOKALNYCH pól daty - nie przez
// `WindowProvenance`, który tnie napis ISO (`slice(0, 10)`) i dla okna od
// północy w Warszawie (22:00 UTC dnia poprzedniego) pokazałby dzień wcześniej.
//
// ŚWIEŻOŚĆ I WALUTA BEZ WŁASNYCH ZAPYTAŃ. Układ niczego nie pobiera: zakładki
// czytają dane fabrykami `*QueryOptions`, a układ SUBSKRYBUJE cache
// (`useSyncExternalStore`) i biernie czyta najświeższe `dataUpdatedAt`
// zapytań `revenueKeys` tego najemcy oraz waluty z migawki
// (`getQueriesData`). Bez danych w cache przełącznik waluty się nie pokazuje -
// lista walut wymyślona przez układ nie zgadzałaby się z danymi zakładki.
// „Odśwież" unieważnia WYŁĄCZNIE klucze huba z tym najemcą (predykat po
// elemencie najemcy w kluczu), nigdy cache innego obszaru roboczego.
//
// SEKCJE BEZ JS MEDIÓW. Telefon dostaje `Select` sekcji (`md:hidden`), szerszy
// ekran pasek odnośników (`hidden md:flex`) - oba są w znaczniku od początku,
// a przełącza je CSS. Pomiar szerokości w JS dawałby inny znacznik serwera
// i klienta przy pierwszym renderze.
import {
  Suspense,
  lazy,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  Link,
  Outlet,
  useHydrated,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FormSelect } from "@/components/atoms/FormSelect";
import { HeartbeatDot } from "@/components/admin/atoms/HeartbeatDot";
import { DashboardPeriodTabs } from "@/components/admin/dashboard/DashboardPeriodTabs";
import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { RelatedModulesBar } from "@/components/admin/revenue/molecules/RelatedModulesBar";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { useAuth } from "@/hooks/useAuth";
// Liść licznika (re-eksport `summaries.ts`) - nie cały moduł opisów ścieżek.
import { activeJourneyCount } from "@/lib/admin/journeys/activeCount";
import {
  REVENUE_TAB_GROUPS,
  RELATED_MODULES,
  canSeeTab,
  defaultPeriodOf,
  hubTabsFor,
  type HubTabSpec,
  type RevenueTabGroup,
} from "@/lib/admin/revenue/hubTabs";
import { toLocalIsoDate } from "@/lib/analytics/semantic/window";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { schedulerFreshness } from "@/lib/jobs/scheduler";
import { journeyListQueryOptions } from "@/lib/journeys/queries";
import { revenueKeys } from "@/lib/revenue/keys";
import { parseMoneyByCurrency } from "@/lib/revenue/money";
import {
  REVENUE_PERIODS,
  REVENUE_SEGMENTS,
  isLocalIsoDay,
  isRevenueTab,
  type RevenueHubSearch,
  type RevenuePeriod,
  type RevenueSegment,
  type RevenueTabId,
} from "@/lib/revenue/search";
import { resolveRevenueRange, type RevenueRange } from "@/lib/revenue/window";
import { cn } from "@/lib/utils";

// Licznik Diagnostyki (Z-S6-08) liczy ocena rejestru 55 reguł - sonda jest
// leniwa, żeby rejestr nie jechał w chunku układu ładowanym z każdą zakładką
// (budżet D-08). Integrator S7, 2026-10-22.
const DiagnosticsBadgeProbe = lazy(() =>
  import("@/components/admin/revenue/diagnostics/DiagnosticsBadgeProbe").then((m) => ({
    default: m.DiagnosticsBadgeProbe,
  })),
);

// ---------------------------------------------------------------------------
// Jawne mapy kluczy (zakaz sklejania kluczy i18n)
// ---------------------------------------------------------------------------

const TAB_LABEL_KEY: Readonly<Record<RevenueTabId, string>> = {
  overview: "adminRevenue.tab.overview",
  mrr: "adminRevenue.tab.mrr",
  funnel: "adminRevenue.tab.funnel",
  retention: "adminRevenue.tab.retention",
  community: "adminRevenue.tab.community",
  diagnostics: "adminRevenue.tab.diagnostics",
  offer: "adminRevenue.tab.offer",
  access: "adminRevenue.tab.access",
  journeys: "adminRevenue.tab.journeys",
  metrics: "adminRevenue.tab.metrics",
  inputs: "adminRevenue.tab.inputs",
};

const GROUP_LABEL_KEY: Readonly<Record<RevenueTabGroup, string>> = {
  monitor: "adminRevenue.group.monitor",
  fix: "adminRevenue.group.fix",
  automate: "adminRevenue.group.automate",
  understand: "adminRevenue.group.understand",
};

const PERIOD_LABEL_KEY: Readonly<Record<RevenuePeriod, string>> = {
  week: "adminRevenue.period.week",
  month: "adminRevenue.period.month",
  "prev-month": "adminRevenue.period.prev-month",
  quarter: "adminRevenue.period.quarter",
  "half-year": "adminRevenue.period.half-year",
  year: "adminRevenue.period.year",
  ltm: "adminRevenue.period.ltm",
  custom: "adminRevenue.period.custom",
};

const COMPARISON_KEY: Readonly<Record<RevenuePeriod, string>> = {
  week: "adminRevenue.comparison.week",
  month: "adminRevenue.comparison.month",
  "prev-month": "adminRevenue.comparison.prev-month",
  quarter: "adminRevenue.comparison.quarter",
  "half-year": "adminRevenue.comparison.half-year",
  year: "adminRevenue.comparison.year",
  ltm: "adminRevenue.comparison.ltm",
  custom: "adminRevenue.comparison.custom",
};

const SEGMENT_LABEL_KEY: Readonly<Record<RevenueSegment, string>> = {
  all: "adminRevenue.segment.all",
  b2c_individual: "adminRevenue.segment.b2c_individual",
  b2c_reduced: "adminRevenue.segment.b2c_reduced",
  b2b_institution: "adminRevenue.segment.b2b_institution",
};

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

/** Wartość „wszystkie waluty" w liście - Radix nie przyjmuje pustego napisu. */
const ALL_CURRENCIES = "all";

/** Co ile odświeżamy ocenę świeżości, gdy w cache nie ma nowych danych. */
const FRESHNESS_TICK_MS = 60_000;

/**
 * Dopasowanie odnośnika zakładki DOKŁADNE i bez parametrów: indeks huba
 * (`/admin/revenue/`) jest prefiksem każdej zakładki, więc bez `exact` Kokpit
 * świeciłby się zawsze, a z porównaniem `search` gasłby po zmianie okresu.
 */
const TAB_ACTIVE_OPTIONS = { exact: true, includeSearch: false } as const;

// ---------------------------------------------------------------------------
// Adres: wspólne filtry zachowane przy przełączaniu zakładek
// ---------------------------------------------------------------------------

/**
 * Parametry wspólne dla wszystkich zakładek: okno, granice własne, waluta
 * i segment. Reszta (`metric`, `finding`, `fix`, `stage`…) należy do JEDNEJ
 * zakładki - przeniesiona na inną otworzyłaby tam obcy arkusz albo dialog.
 */
function sharedSearch(search: RevenueHubSearch): RevenueHubSearch {
  const out: RevenueHubSearch = {};
  if (search.w !== undefined) out.w = search.w;
  if (search.from !== undefined) out.from = search.from;
  if (search.to !== undefined) out.to = search.to;
  if (search.cur !== undefined) out.cur = search.cur;
  if (search.seg !== undefined) out.seg = search.seg;
  return out;
}

/** Zakładka z parametrów dopasowania: brak `$tab` = indeks huba, czyli Kokpit. */
function tabFromParams(tab: string | undefined): RevenueTabId | null {
  if (tab === undefined) return "overview";
  return isRevenueTab(tab) ? tab : null;
}

// ---------------------------------------------------------------------------
// Bierny odczyt cache huba (świeżość, pobieranie, waluty)
// ---------------------------------------------------------------------------

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

/** Waluty obecne w polu `money` migawki (kolejność pierwszego wystąpienia). */
function currenciesOf(data: unknown, into: string[]): void {
  if (!isRecord(data) || !isRecord(data.money)) return;
  for (const amounts of Object.values(data.money)) {
    for (const { currency } of parseMoneyByCurrency(amounts) ?? []) {
      if (!into.includes(currency)) into.push(currency);
    }
  }
}

/**
 * Stan cache huba najemcy jako NAPIS - `useSyncExternalStore` porównuje
 * migawki przez `Object.is`, więc obiekt budowany przy każdym odczycie
 * renderowałby w kółko. Napis o tej samej treści jest tą samą wartością.
 */
function hubCacheSignature(queryClient: QueryClient, tenantId: string | null): string {
  if (!tenantId) return "0|0|";
  let updatedAt = 0;
  let fetching = 0;
  for (const query of queryClient.getQueryCache().findAll({ queryKey: revenueKeys.root() })) {
    // Element [2] klucza `revenueKeys.*` to najemca (`domainTenant`, `query`,
    // `facts`…) - cudzy obszar roboczy nie wpływa na świeżość tego.
    if (query.queryKey[2] !== tenantId) continue;
    if (query.state.dataUpdatedAt > updatedAt) updatedAt = query.state.dataUpdatedAt;
    if (query.state.fetchStatus === "fetching") fetching += 1;
  }
  const currencies: string[] = [];
  for (const [, data] of queryClient.getQueriesData<unknown>({
    queryKey: revenueKeys.domainTenant("snapshot", tenantId),
  })) {
    currenciesOf(data, currencies);
  }
  return `${updatedAt}|${fetching}|${currencies.join(",")}`;
}

interface HubCacheView {
  updatedAt: number | null;
  fetching: boolean;
  currencies: string[];
}

/**
 * Licznik „Ścieżki = aktywne” (Z-S6-08). Zapytanie rusza po hydratacji
 * (`HubSections` rysuje się dopiero po niej - `RevenueHubLayout`), tylko
 * z najemcą i dla ról z zakładką Ścieżek (`canSeeTab`): autor i sam
 * `super_admin` nie wysyłają żądania, którego RLS i tak by odmówił.
 */
function useJourneysBadgeCount(tenantId: string | null, roles: readonly string[]): number | null {
  const enabled = Boolean(tenantId) && canSeeTab("journeys", roles);
  const list = useQuery({ ...journeyListQueryOptions(tenantId, null), enabled });
  if (!enabled || list.data?.state !== "ready") return null;
  return activeJourneyCount(list.data.data);
}

function useHubCache(tenantId: string | null): HubCacheView {
  const queryClient = useQueryClient();
  const signature = useSyncExternalStore(
    (onChange) => queryClient.getQueryCache().subscribe(onChange),
    () => hubCacheSignature(queryClient, tenantId),
    () => hubCacheSignature(queryClient, tenantId),
  );
  return useMemo(() => {
    const [updated, fetching, currencies] = signature.split("|");
    const updatedAt = Number(updated);
    return {
      updatedAt: updatedAt > 0 ? updatedAt : null,
      fetching: Number(fetching) > 0,
      currencies: currencies ? currencies.split(",") : [],
    };
  }, [signature]);
}

// ---------------------------------------------------------------------------
// Komponenty
// ---------------------------------------------------------------------------

export function RevenueHubLayout() {
  ensureRevenueI18n();
  ensureShellI18n();
  const hydrated = useHydrated();
  if (!hydrated) return <RevenueTabPending />;
  return <RevenueHubShell />;
}

function RevenueHubShell() {
  const { t } = useTranslation();
  const { roles, tenantId } = useAuth();
  const params = useParams({ strict: false });
  const search = useSearch({ from: "/admin/revenue" });
  const tab = tabFromParams(params.tab);
  // Atrapa sesji w testach I0 nie podaje najemcy - `undefined` = brak najemcy.
  const tenant = tenantId ?? null;

  // UI = bramka SQL (SPEC §2.5): wiersz `admin` albo `editor` w najemcy.
  const canSeeHub = roles.includes("admin") || roles.includes("editor");
  const tabAllowed = tab === null || canSeeTab(tab, roles);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold">{t("adminRevenue.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("adminRevenue.subtitle")}</p>
          </div>
          {canSeeHub ? <HubFreshness tenantId={tenant} /> : null}
        </div>
        {canSeeHub ? <RelatedModulesBar items={RELATED_MODULES} /> : null}
      </header>
      {canSeeHub ? (
        <>
          <HubSections roles={roles} current={tab} search={search} tenantId={tenant} />
          {tab !== null && tabAllowed && defaultPeriodOf(tab) !== null ? (
            <HubFilters tab={tab} search={search} tenantId={tenant} />
          ) : null}
          {tabAllowed ? <Outlet /> : <RoleGateNotice requiredRole="admin" />}
        </>
      ) : (
        // Nagłówek zostaje, żeby autor wiedział, GDZIE jest; znika wyłącznie
        // treść i nawigacja huba. Powiadomienie (`role="status"`,
        // `data-testid="revenue-role-gate"` - kontrakt I0) renderuje
        // `RoleGateNotice`; bramka `adminRouteAuthority.gate` szuka tego
        // identyfikatora w tym pliku, bo to on decyduje o bramce.
        <RoleGateNotice requiredRole="admin_or_editor" />
      )}
    </div>
  );
}

/** „Dane z 14:05" + kropka świeżości + „Odśwież dane" (klucze huba TEGO najemcy). */
function HubFreshness({ tenantId }: { tenantId: string | null }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { updatedAt, fetching } = useHubCache(tenantId);
  const [now, setNow] = useState(() => Date.now());

  // Ocena świeżości starzeje się bez nowych danych - kropka „Działa" po pół
  // godzinie bez odświeżenia byłaby nieprawdą. Takt co minutę wystarcza:
  // progi `schedulerFreshness` liczone są w minutach.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), FRESHNESS_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const refresh = () => {
    setNow(Date.now());
    if (!tenantId) return;
    void queryClient.invalidateQueries({
      queryKey: revenueKeys.root(),
      predicate: (query) => query.queryKey[2] === tenantId,
    });
  };

  const locale = LOCALE[chartLangFrom(i18n.language)];
  const freshness = updatedAt === null ? null : schedulerFreshness(updatedAt, now);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span aria-live="polite" className="inline-flex items-center gap-2">
        {fetching ? (
          <span>{t("adminRevenue.status.refreshing")}</span>
        ) : freshness !== null && updatedAt !== null ? (
          <>
            <HeartbeatDot freshness={freshness} withLabel={false} />
            <span>
              {t("adminRevenue.status.updatedAt", {
                time: new Intl.DateTimeFormat(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                }).format(updatedAt),
              })}
            </span>
            {freshness === "stale" ? <span>{t("adminRevenue.status.stale")}</span> : null}
          </>
        ) : null}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        onClick={refresh}
        disabled={!tenantId || fetching}
      >
        {t("adminRevenue.common.refresh")}
      </Button>
    </div>
  );
}

/** Pasek sekcji (≥ 768 px) i wybór sekcji (< 768 px) - te same zakładki dla roli. */
function HubSections({
  roles,
  current,
  search,
  tenantId,
}: {
  roles: readonly string[];
  current: RevenueTabId | null;
  search: RevenueHubSearch;
  tenantId: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const navId = useId();
  const tabs = hubTabsFor(roles);
  // Slot liczników paska (Z-S6-08).
  // Diagnostyka (S7, Integrator S7 2026-10-22): otwarte krytyczne + ważne bez
  // obowiązujących wyciszeń z leniwej sondy - `null` = nie wiadomo
  // (ładowanie, odmowa), wtedy pasek nie pokazuje „0".
  const [diagnosticsBadge, setDiagnosticsBadge] = useState<number | null>(null);
  // Ta sama bramka co `admin_revenue_facts()`: wiersz `admin` albo `editor`.
  const factsRoleOk = roles.includes("admin") || roles.includes("editor");
  const probeDiagnostics =
    tenantId !== null && factsRoleOk && tabs.some((spec) => spec.id === "diagnostics");
  // Ścieżki: aktywne (Integrator S8) - ten sam klucz co lista zakładki
  // (`journeyListQueryOptions(tenantId, null)`), więc przy ciepłym cache zero
  // dodatkowych żądań. `null` (ładowanie, odmowa, brak roli) = brak licznika,
  // nie „0”. Oba liczniki łączy scalenie S7 po S8 (2026-10-22).
  const journeys = useJourneysBadgeCount(tenantId, roles);
  const badges: Partial<Record<RevenueTabId, number>> = {
    ...(probeDiagnostics && diagnosticsBadge !== null ? { diagnostics: diagnosticsBadge } : {}),
    ...(journeys === null ? {} : { journeys }),
  };

  const groups = REVENUE_TAB_GROUPS.map((group) => ({
    group,
    tabs: tabs.filter((spec) => spec.group === group),
  })).filter((entry) => entry.tabs.length > 0);

  const goTo = (next: string) => {
    if (!isRevenueTab(next)) return;
    const keep = sharedSearch(search);
    if (next === "overview") void navigate({ to: "/admin/revenue", search: keep });
    else void navigate({ to: "/admin/revenue/$tab", params: { tab: next }, search: keep });
  };

  return (
    <>
      {probeDiagnostics ? (
        <Suspense fallback={null}>
          <DiagnosticsBadgeProbe
            tenantId={tenantId}
            roleOk={factsRoleOk}
            onCount={setDiagnosticsBadge}
          />
        </Suspense>
      ) : null}
      <div className="md:hidden">
        <FormSelect
          aria-label={t("adminRevenue.nav.sections")}
          value={current ?? ""}
          onValueChange={goTo}
          options={tabs.map((spec) => ({ value: spec.id, label: t(TAB_LABEL_KEY[spec.id]) }))}
        />
      </div>
      <nav aria-label={t("adminRevenue.nav.label")} className="hidden md:flex">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {groups.map(({ group, tabs: groupTabs }, index) => {
            const groupId = `${navId}-${group}`;
            return (
              <div key={group} className="flex items-center gap-2">
                {index > 0 ? (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    className="h-4 w-px bg-border"
                  />
                ) : null}
                {/* Nazwa grupy jest widoczna, ale czytnik słyszy ją jako OPIS
                    każdego odnośnika („Przychód, Monitoruj"), a nie jako
                    osobny węzeł między nimi. */}
                <span
                  id={groupId}
                  aria-hidden="true"
                  className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {t(GROUP_LABEL_KEY[group])}
                </span>
                <ul className="flex flex-wrap items-center gap-0.5">
                  {groupTabs.map((spec) => (
                    <li key={spec.id}>
                      <HubTabLink
                        spec={spec}
                        active={spec.id === current}
                        describedBy={groupId}
                        search={search}
                        badge={badges[spec.id]}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function HubTabLink({
  spec,
  active,
  describedBy,
  search,
  badge,
}: {
  spec: HubTabSpec;
  active: boolean;
  describedBy: string;
  search: RevenueHubSearch;
  badge?: number;
}) {
  const { t } = useTranslation();
  const className = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs font-medium transition-colors whitespace-nowrap",
    active
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:text-foreground hover:bg-muted",
  );
  const content = (
    <>
      {t(TAB_LABEL_KEY[spec.id])}
      {badge !== undefined && badge > 0 ? (
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-foreground">
          <span aria-hidden="true">{badge}</span>
          <span className="sr-only">
            {spec.counter === "journeys"
              ? t("adminRevenue.nav.badgeJourneys", { count: badge })
              : t("adminRevenue.nav.badge", { count: badge })}
          </span>
        </span>
      ) : null}
    </>
  );
  const keep = sharedSearch(search);

  return spec.id === "overview" ? (
    <Link
      to="/admin/revenue"
      search={keep}
      activeOptions={TAB_ACTIVE_OPTIONS}
      aria-current={active ? "page" : undefined}
      aria-describedby={describedBy}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <Link
      to="/admin/revenue/$tab"
      params={{ tab: spec.id }}
      search={keep}
      activeOptions={TAB_ACTIVE_OPTIONS}
      aria-current={active ? "page" : undefined}
      aria-describedby={describedBy}
      className={className}
    >
      {content}
    </Link>
  );
}

/** Pierwszy i ostatni dzień okna jako LOKALNE `YYYY-MM-DD` (`until` jest wyłączne). */
function localBounds(range: RevenueRange): { from: string; to: string } {
  return {
    from: toLocalIsoDate(new Date(range.current.sinceIso)),
    to: toLocalIsoDate(new Date(Date.parse(range.current.untilIso) - 1)),
  };
}

/** Lokalna północ dnia `YYYY-MM-DD` - do formatowania, bez przejścia przez UTC. */
function localDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Okres (z zakresem własnym), segment i waluta - tylko na zakładkach z oknem czasu. */
function HubFilters({
  tab,
  search,
  tenantId,
}: {
  tab: RevenueTabId;
  search: RevenueHubSearch;
  tenantId: string | null;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { currencies } = useHubCache(tenantId);
  // „Teraz" zamrożone przy wejściu: okno trafia do kluczy zapytań zakładek,
  // a zegar czytany przy każdym renderze dawałby co render inny zakres.
  const [nowMs] = useState(() => Date.now());
  const period: RevenuePeriod = search.w ?? defaultPeriodOf(tab) ?? "month";
  const range = useMemo(
    () => resolveRevenueRange(period, nowMs, search.from, search.to),
    [period, nowMs, search.from, search.to],
  );
  const bounds = localBounds(range);
  const locale = LOCALE[chartLangFrom(i18n.language)];
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" });

  const update = (patch: RevenueHubSearch) => {
    void navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }) });
  };

  const onPeriod = (next: RevenuePeriod) => {
    if (next !== "custom") {
      update({ w: next, from: undefined, to: undefined });
      return;
    }
    // Okres własny startuje z bieżącego okna - admin poprawia jedną datę,
    // zamiast wpisywać obie od zera.
    update({ w: "custom", from: bounds.from, to: bounds.to });
  };

  return (
    <div role="group" aria-label={t("adminRevenue.filters.label")} className="space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <DashboardPeriodTabs
          periods={REVENUE_PERIODS}
          value={range.period}
          onChange={onPeriod}
          labelKey={(p) => PERIOD_LABEL_KEY[p]}
          comparisonKey={(p) =>
            p === "custom" && range.previous === null
              ? "adminRevenue.comparison.none"
              : COMPARISON_KEY[p]
          }
        />
        <div className="w-48">
          <FormSelect
            aria-label={t("adminRevenue.filters.segment")}
            value={search.seg ?? "all"}
            onValueChange={(next) => {
              const seg = REVENUE_SEGMENTS.find((s) => s === next);
              if (seg) update({ seg: seg === "all" ? undefined : seg });
            }}
            options={REVENUE_SEGMENTS.map((s) => ({ value: s, label: t(SEGMENT_LABEL_KEY[s]) }))}
          />
        </div>
        {currencies.length > 0 ? (
          <div className="w-40">
            <FormSelect
              aria-label={t("adminRevenue.filters.currency")}
              value={search.cur && currencies.includes(search.cur) ? search.cur : ALL_CURRENCIES}
              onValueChange={(next) => update({ cur: next === ALL_CURRENCIES ? undefined : next })}
              options={[
                { value: ALL_CURRENCIES, label: t("adminRevenue.filters.allCurrencies") },
                ...currencies.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
        ) : null}
      </div>
      {range.period === "custom" ? (
        <CustomRangeForm
          key={`${bounds.from}|${bounds.to}`}
          from={bounds.from}
          to={bounds.to}
          onApply={(from, to) => update({ w: "custom", from, to })}
        />
      ) : null}
      <p data-testid="revenue-hub-range" className="text-[11px] text-muted-foreground">
        {t("adminRevenue.provenance.range", {
          from: day.format(localDay(bounds.from)),
          to: day.format(localDay(bounds.to)),
        })}
      </p>
    </div>
  );
}

/**
 * Dwie daty okresu własnego. Zapis dopiero przyciskiem: pole daty po każdej
 * zmianie dawałoby chwilowe okna „od po do" i zapytanie przy każdej cyfrze.
 */
function CustomRangeForm({
  from: initialFrom,
  to: initialTo,
  onApply,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const valid = isLocalIsoDay(from) && isLocalIsoDay(to) && from <= to;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (valid) onApply(from, to);
  };

  return (
    <form
      aria-label={t("adminRevenue.filters.customRange")}
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="space-y-1">
        <label htmlFor={`${id}-from`} className="block text-xs text-muted-foreground">
          {t("adminRevenue.filters.from")}
        </label>
        <DateInput
          id={`${id}-from`}
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-to`} className="block text-xs text-muted-foreground">
          {t("adminRevenue.filters.to")}
        </label>
        <DateInput
          id={`${id}-to`}
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
        />
      </div>
      <Button type="submit" size="sm" className="h-9" disabled={!valid}>
        {t("adminRevenue.filters.apply")}
      </Button>
    </form>
  );
}
