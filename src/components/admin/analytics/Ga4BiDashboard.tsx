/**
 * GA4 BI dashboard.
 *
 * Fires four parallel Data API reports (by date, sessionSource, country,
 * deviceCategory) plus one previous-period date report for delta computation.
 * All go through the existing `runGa4Report` server fn - no new backend
 * surface.
 *
 * STANY, KTÓRE NIE SĄ POMIAREM, są rozróżnione, bo każdy prowadzi do innej
 * decyzji operatora, a wszystkie wyglądają identycznie, gdy panel narysuje
 * siatkę zer:
 *   1. prop `configured` z ENV na `false` - integracji nie ma, raportów nawet
 *      nie wysyłamy,
 *   2. raport z polem `error` - bramka odpowiedziała i nazwała przyczynę,
 *   3. zapytanie ODRZUCONE - `q.data` jest wtedy `undefined`, więc pole `error`
 *      nie istnieje; awarię transportu widać wyłącznie w `q.isError`,
 *   4. raport z `configured: false` i BEZ `error` - `EMPTY_GA4_REPORT` po
 *      zniknięciu property albo po padniętym odświeżeniu tokenu Google, kiedy
 *      status z ENV nadal mówi „podłączone",
 *   5. ZMIERZONE ZERO - wszystkie raporty odpowiedziały, żaden nie ma wiersza;
 *      jedyny stan, w którym zera są prawdą, i dlatego nazwany wprost.
 * Dopóki raport dobowy nie odpowie, kafelki KPI mówią o trwającym pomiarze
 * zamiast malować zera.
 *
 * KLUCZ CACHE NIESIE WARSZTAT. `QueryClient` stoi w korzeniu aplikacji, więc
 * przeżywa przelogowanie, a `staleTime: 60_000` trzyma wpisy świeże - klucz bez
 * `tenantId` oddawał panelowi kolejnego warsztatu ruch poprzedniego Z CACHE,
 * bez ani jednego zapytania (wyciek niewidoczny w ruchu sieciowym). Zapytania
 * czekają na rozwiązanie warsztatu (`enabled`), zamiast pytać „bez warsztatu".
 *
 * KAŻDY WYKRES MA ALTERNATYWĘ TEKSTOWĄ: ECharts maluje do kanwy, więc każda
 * karta dostaje `csv` z tymi samymi danymi, a `ChartCard` robi z tego tabelę
 * powiązaną z regionem wykresu przez `aria-describedby`.
 *
 * OKNO CZASOWE pochodzi z kanonicznego resolwera warstwy semantycznej
 * (`@/lib/analytics/semantic`), nie z napisów `NdaysAgo`. Dwa powody:
 *   1. `[28daysAgo, today]` vs `[56daysAgo, 28daysAgo]` DZIELIŁY dzień graniczny
 *      (oba przedziały GA4 są domknięte), więc baza porównawcza była zawyżona o
 *      jeden dzień i każda delta % - systematycznie zaniżona,
 *   2. `today` to dzień jeszcze niedomknięty przez ingestię GA4, więc ostatni
 *      punkt trendu zawsze zaniżał, a liczby nie dawały się uzgodnić z
 *      naszymi strumieniami first-party.
 * Resolwer zwraca pełne dni UTC, rozłączne okno poprzednie i listę zastrzeżeń,
 * które `WindowProvenance` pokazuje adminowi wprost.
 *
 * Charts:
 *   1. KPI row: sesje, aktywni użytkownicy, odsłony, wskaźnik zaangażowania
 *   2. Trend area: sesje vs użytkownicy vs odsłony
 *   3. Donut: źródła ruchu (sessionSource)
 *   4. Donut: kraje
 *   5. Donut: urządzenia
 *   6. Radar: zaangażowanie (5 metryk z tego samego okna)
 *   7. Bar rank: top strony wg odsłon
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import "@/lib/i18n-admin-semantic";
import { useServerFn } from "@tanstack/react-start";
import { useQueries } from "@tanstack/react-query";
import { Loader2, RefreshCw, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EChartsCoreOption } from "echarts/core";
import { runGa4Report, type Ga4Report } from "@/lib/analytics/ga4.functions";
import { useCurrentTenantId } from "@/lib/tenant";
import { previousWindow, resolveWindow, type WindowPresetId } from "@/lib/analytics/semantic";
import { WindowProvenance } from "./semantic/molecules/WindowProvenance";
import { ChartCard } from "./ChartCard";
import { useChartTheme } from "./useChartTheme";
import type { ChartClickParams, ChartDrillDetail } from "./ChartDrillDialog";
import { KpiTile } from "./KpiTile";
import { InsightSection } from "./InsightSection";
import { buildGa4Insights } from "./ga4Insights";

const CORE_METRICS = ["sessions", "activeUsers", "screenPageViews", "engagementRate"] as const;
type CoreMetric = (typeof CORE_METRICS)[number];

// Presety okna dostępne w tym dashboardzie. Identyfikatory pochodzą z warstwy
// semantycznej, więc „28 dni” tutaj znaczy dokładnie to samo, co na pozostałych
// zakładkach i w migawce serwerowej.
const WINDOW_PRESETS = [
  { id: "7d", labelKey: "adminAnalytics.timeRange.preset7d" },
  { id: "14d", labelKey: "adminAnalytics.timeRange.preset14d" },
  { id: "28d", labelKey: "adminAnalytics.timeRange.preset28d" },
  { id: "90d", labelKey: "adminAnalytics.timeRange.preset90d" },
] as const satisfies ReadonlyArray<{ id: WindowPresetId; labelKey: string }>;

type Ga4PresetId = (typeof WINDOW_PRESETS)[number]["id"];

function parseNumber(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Osie radaru w JEDNYM miejscu: ta sama kolejność opisuje wskaźniki wykresu
// i nagłówki tabeli danych, więc alternatywa tekstowa nie może rozjechać się
// z wielokątem.
const RADAR_AXES = [
  "adminAnalytics.ga4.radar.engagement",
  "adminAnalytics.ga4.radar.sessionTime",
  "adminAnalytics.ga4.radar.viewsPerSession",
  "adminAnalytics.ga4.radar.retention",
  "adminAnalytics.ga4.radar.events",
] as const;

/** Wycinek donuta - wspólne źródło dla opcji wykresu i dla tabeli danych. */
interface DonutSlice {
  name: string;
  value: number;
}

/** Kształt `csv` przyjmowany przez `ChartCard` (eksport + tabela danych). */
interface ChartCsv {
  filename: string;
  headers: string[];
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

function totalsFromReport(report: Ga4Report | undefined): Record<CoreMetric, number> {
  const out = { sessions: 0, activeUsers: 0, screenPageViews: 0, engagementRate: 0 };
  if (!report) return out;
  for (let i = 0; i < report.metricHeaders.length; i++) {
    const name = report.metricHeaders[i] as CoreMetric;
    if (CORE_METRICS.includes(name)) out[name] = parseNumber(report.totals[i]);
  }
  return out;
}

export function Ga4BiDashboard({
  configured,
  activeMode,
}: {
  configured: boolean;
  activeMode?: string;
}) {
  const { t } = useTranslation();
  // ROZWIĄZANY motyw dla pól, których `baseOption` nie zna - w tym panelu
  // to cała siatka radaru (uzasadnienie przy `radarOption`). Referencja jest
  // stabilna, dopóki tokeny się nie zmienią, więc wolno ją trzymać
  // w zależnościach `useMemo`.
  const theme = useChartTheme();
  const fetchReport = useServerFn(runGa4Report);
  const [presetId, setPresetId] = useState<Ga4PresetId>("28d");
  // Warsztat wchodzi do KLUCZA cache, nie tylko do zapytania serwerowego -
  // uzasadnienie przy `queries` niżej.
  const tenantId = useCurrentTenantId();
  // Etykieta wyboru okna jest widoczna, ale `<label>` nie potrafi opisać
  // wyzwalacza Radiksa (to `<button role="combobox">`, element nieetykietowalny),
  // więc wiążemy je przez `aria-labelledby` na stabilnym identyfikatorze.
  const windowLabelId = `${useId()}-ga4-window`;

  // Jedno okno kanoniczne na render presetu: pełne dni UTC, bez dnia otwartego.
  // Okno poprzednie jest z niego wyprowadzone i ROZŁĄCZNE - dzień graniczny nie
  // wpada już do obu przedziałów.
  const canonicalWindow = useMemo(() => resolveWindow({ presetId }), [presetId]);
  const prevWindow = useMemo(() => previousWindow(canonicalWindow), [canonicalWindow]);
  const days = canonicalWindow.days;
  const start = canonicalWindow.ga4.startDate;
  const end = canonicalWindow.ga4.endDate;
  const prevStart = prevWindow.ga4.startDate;
  const prevEnd = prevWindow.ga4.endDate;

  const requests: Array<{
    key: string;
    dims: string[];
    metrics: string[];
    range: [string, string];
    limit: number;
  }> = [
    {
      key: "date",
      dims: ["date"],
      metrics: [...CORE_METRICS],
      range: [start, end],
      limit: 400,
    },
    {
      key: "date-prev",
      dims: ["date"],
      metrics: [...CORE_METRICS],
      range: [prevStart, prevEnd],
      limit: 400,
    },
    {
      key: "source",
      dims: ["sessionSource"],
      metrics: ["sessions"],
      range: [start, end],
      limit: 20,
    },
    {
      key: "country",
      dims: ["country"],
      metrics: ["sessions"],
      range: [start, end],
      limit: 30,
    },
    {
      key: "device",
      dims: ["deviceCategory"],
      metrics: ["sessions"],
      range: [start, end],
      limit: 10,
    },
    {
      key: "page",
      dims: ["pagePath"],
      metrics: ["screenPageViews", "engagementRate"],
      range: [start, end],
      limit: 20,
    },
    {
      key: "engagement",
      dims: [],
      metrics: [
        "engagementRate",
        "averageSessionDuration",
        "screenPageViewsPerSession",
        "bounceRate",
        "eventCount",
      ],
      range: [start, end],
      limit: 1,
    },
  ];

  const queries = useQueries({
    queries: requests.map((r) => ({
      // WARSZTAT W KLUCZU, nie tylko w zapytaniu serwerowym: `QueryClient` stoi
      // w korzeniu aplikacji, więc przeżywa przelogowanie, a `staleTime` trzyma
      // wpisy świeże - bez `tenantId` panel następnego warsztatu dostawał ruch
      // poprzedniego Z CACHE i nie wysyłał ani jednego zapytania.
      queryKey: ["ga4-bi", tenantId ?? "", presetId, start, end, r.key],
      queryFn: () =>
        fetchReport({
          data: {
            startDate: r.range[0],
            endDate: r.range[1],
            dimensions: r.dims,
            metrics: r.metrics,
            limit: r.limit,
          },
        }),
      // `Boolean(tenantId)`: dopóki warsztat się nie rozwiąże, zapytanie NIE
      // rusza - inaczej pierwszy przebieg zapisałby wynik pod kluczem z pustym
      // warsztatem, czyli wspólnym dla wszystkich.
      enabled: configured && Boolean(tenantId),
      staleTime: 60_000,
    })),
  });

  const [dateQ, prevQ, sourceQ, countryQ, deviceQ, pageQ, engageQ] = queries;
  const anyLoading = queries.some((q) => q.isLoading);

  // CZTERY STANY, KTÓRE NIE SĄ POMIAREM, każdy z inną decyzją operatora
  // (piąty, ZMIERZONE ZERO, jest niżej - tam zera są prawdą).
  // 1. Raport z polem `error`: bramka odpowiedziała i sama nazwała przyczynę.
  const reportError = queries.find((q) => q.data && "error" in q.data && q.data.error);
  // 2. Zapytanie ODRZUCONE: `q.data` jest wtedy `undefined`, więc szukanie pola
  //    `error` w danych nigdy tego nie zobaczy.
  const failedQuery = queries.find((q) => q.isError);
  // 3. Raport bez błędu, ale z `configured: false`: `runGa4Report` oddaje
  //    `EMPTY_GA4_REPORT`, gdy zabraknie property albo gdy odświeżenie tokenu
  //    Google padnie w locie.
  const serverUnconfigured = queries.some((q) => q.data?.configured === false);
  // 4. Brak odpowiedzi na raport dobowy: kafelki nie mają jeszcze CZEGO pokazać.
  const hasCurrent = dateQ.data !== undefined;
  const hasPrevious = prevQ.data !== undefined;

  const totals = useMemo(() => totalsFromReport(dateQ.data), [dateQ.data]);
  const prevTotals = useMemo(() => totalsFromReport(prevQ.data), [prevQ.data]);

  // ZMIERZONE ZERO to piąty stan i JEDYNY, w którym siatka zer jest prawdą:
  // wszystkie siedem raportów odpowiedziało, żaden nie ma wiersza, a totale są
  // na zerze. Rozpoznajemy go osobno, żeby napisać o nim wprost.
  const measuredZero =
    queries.every((q) => q.data !== undefined && q.data.rows.length === 0) &&
    totals.sessions === 0 &&
    totals.activeUsers === 0 &&
    totals.screenPageViews === 0;

  // Serię czasową liczymy RAZ: wykres i tabela danych muszą mówić to samo,
  // a sortowanie po zbitej dacie GA4 jest tu jedynym źródłem kolejności.
  const trendData = useMemo(() => {
    const rows = (dateQ.data?.rows ?? [])
      .slice()
      .sort((a, b) => (a.dims[0] ?? "").localeCompare(b.dims[0] ?? ""));
    const headers = dateQ.data?.metricHeaders ?? [];
    const idx = (m: CoreMetric): number => headers.indexOf(m);
    const idxSessions = idx("sessions");
    const idxUsers = idx("activeUsers");
    const idxViews = idx("screenPageViews");
    return {
      dates: rows.map((r) => {
        const d = r.dims[0] ?? "";
        return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
      }),
      sessions: rows.map((r) => parseNumber(r.metrics[idxSessions])),
      users: rows.map((r) => parseNumber(r.metrics[idxUsers])),
      views: rows.map((r) => parseNumber(r.metrics[idxViews])),
    };
  }, [dateQ.data]);

  const trendOption = useMemo<EChartsCoreOption>(() => {
    return {
      legend: {
        top: 4,
        data: [
          t("adminAnalytics.ga4.sessions"),
          t("adminAnalytics.ga4.activeUsers"),
          t("adminAnalytics.ga4.views"),
        ],
      },
      tooltip: { trigger: "axis" },
      dataZoom: [{ type: "inside", start: 0, end: 100 }],
      xAxis: { type: "category", data: trendData.dates, boundaryGap: false },
      yAxis: { type: "value" },
      series: [
        {
          name: t("adminAnalytics.ga4.sessions"),
          type: "line",
          smooth: true,
          areaStyle: { opacity: 0.2 },
          data: trendData.sessions,
        },
        {
          name: t("adminAnalytics.ga4.activeUsers"),
          type: "line",
          smooth: true,
          data: trendData.users,
        },
        {
          name: t("adminAnalytics.ga4.views"),
          type: "line",
          smooth: true,
          data: trendData.views,
        },
      ],
    };
  }, [trendData, t]);

  // Zwijanie donuta do `top` wycinków plus „Inne" jest CICHĄ operacją panelu,
  // więc wycinki liczymy raz i tym samym zbiorem karmimy wykres oraz tabelę.
  // `null` znaczy „raport nie ma metryki `sessions`" - wtedy nie ma z czego
  // rysować i nie wolno tego policzyć z przypadkowej metryki.
  const donutSlices = (report: Ga4Report | undefined, top = 8): DonutSlice[] | null => {
    const rows = (report?.rows ?? []).slice();
    const idxSessions = (report?.metricHeaders ?? []).indexOf("sessions");
    if (idxSessions === -1) return null;
    rows.sort((a, b) => parseNumber(b.metrics[idxSessions]) - parseNumber(a.metrics[idxSessions]));
    const head = rows.slice(0, top);
    const rest = rows.slice(top);
    const data = head.map((r) => ({
      name: r.dims[0] || "?",
      value: parseNumber(r.metrics[idxSessions]),
    }));
    const other = rest.reduce((acc, r) => acc + parseNumber(r.metrics[idxSessions]), 0);
    if (other > 0) data.push({ name: t("adminAnalytics.ga4.other"), value: other });
    return data;
  };

  const donutOption = (data: DonutSlice[] | null): EChartsCoreOption => {
    if (data === null) return { series: [] };
    return {
      tooltip: {
        trigger: "item",
        formatter: (raw: unknown) => {
          const p = raw as { name: string; value: number; percent: number };
          return `${p.name}: <b>${p.value}</b> (${p.percent.toFixed(1)}%)`;
        },
      },
      legend: {
        orient: "vertical",
        right: 4,
        top: "middle",
        type: "scroll",
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          center: ["38%", "50%"],
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderRadius: 4, borderWidth: 2, borderColor: "transparent" },
          data,
        },
      ],
    };
  };

  // Pięć osi radaru w skali 0-100. Wartości liczymy osobno od opcji, bo tabela
  // danych karty podaje DOKŁADNIE te liczby - inaczej alternatywa tekstowa
  // opisywałaby inny wielokąt niż widać.
  const radarValues = useMemo<number[]>(() => {
    const totals = engageQ.data?.totals ?? [];
    const headers = engageQ.data?.metricHeaders ?? [];
    const get = (m: string): number => {
      const i = headers.indexOf(m);
      return i >= 0 ? parseNumber(totals[i]) : 0;
    };
    return [
      get("engagementRate") * 100,
      Math.min(100, get("averageSessionDuration") / 3),
      Math.min(100, get("screenPageViewsPerSession") * 20),
      Math.max(0, 100 - get("bounceRate") * 100),
      Math.min(100, get("eventCount") / 50),
    ];
  }, [engageQ.data]);

  // SIATKA RADARU MA WŁASNE POLA, KTÓRYCH BAZA MOTYWU NIE ZNA. `baseOption`
  // motywuje `xAxis`/`yAxis`, a wykres radarowy trzyma `splitLine`, `axisLine`,
  // `splitArea` i `axisName` WEWNĄTRZ sekcji `radar` - to inne pola niż
  // `yAxis.splitLine`, więc głębokie złączenie nie dowozi tu ani jednego
  // koloru. Stąd hook motywu, a nie ręczne powtarzanie bazy.
  //
  // CO TU STAŁO: `"hsl(var(--border))"` i `"hsl(var(--muted-foreground))"`.
  // `var()` rozwiązuje CSS, a ECharts podaje ten napis WPROST kanwie jako
  // `strokeStyle`/`fillStyle`. Oba tokeny siedzą w `src/styles.css` jako
  // `oklch(...)`, więc literał rozwijał się do `hsl(oklch(...))` - wartości
  // nieparsowalnej, przy której kanwa NIE RZUCA, tylko zostaje przy poprzednim
  // kolorze (mechanizm opisany przy `BARE_HSL_TRIPLE` w `./chartTheme.ts`).
  // Awaria wyglądała jak „siatka radaru jest jakoś ciemna”, nie jak błąd.
  const radarOption = useMemo<EChartsCoreOption>(() => {
    return {
      // WYZWALACZ ELEMENTOWY, NIE OSIOWY - i to jest decyzja, nie domyślność.
      // Stało tu puste `tooltip: {}`: przy płaskim złączeniu wyrzucało ono
      // `trigger: "axis"` z bazy razem z całą sekcją, więc dymek działał
      // PRZYPADKIEM - domyślną wartością ECharts. Baza `trigger` już nie
      // narzuca, ale radar nie ma osi kartezjańskiej, więc wyzwalacz osiowy
      // nie pokazałby tu nic; dymek elementowy podaje cały wielokąt (pięć osi
      // naraz) po najechaniu na punkt serii. Deklarujemy go WPROST, bo
      // wyzwalacz jest własnością typu wykresu.
      tooltip: { trigger: "item" },
      radar: {
        indicator: RADAR_AXES.map((key) => ({ name: t(key), max: 100 })),
        radius: "62%",
        splitLine: { lineStyle: { color: theme.border } },
        // Szprychy motywujemy tak samo jak pierścienie. Bez tego pola radar
        // bierze `tokens.color.neutral20` ZASZYTE w ECharts (patrz
        // `coord/radar/RadarModel.js`) - jedyny element siatki panelu, który
        // nie chodziłby za motywem, a w trybie ciemnym najjaśniejszy.
        axisLine: { lineStyle: { color: theme.border } },
        // Naprzemienne pasy stały na `rgba(0,0,0,0.02|0.05)`: czerni na
        // ciemnym tle nie widać wcale, więc w trybie ciemnym radar tracił
        // czytelną skalę promienia. Kryjemy co drugi pierścień kolorem tekstu
        // pomocniczego, a przezroczystość podajemy OSOBNYM polem `opacity`,
        // bo tokenu nie da się rozcieńczyć w napisie (`--muted-foreground` to
        // `oklch(...)`, a `color-mix()` w kanwie nie żyje). ECharts nakłada
        // `opacity` z `areaStyle` na oba pasy i nadpisuje samo `fill` z
        // tablicy kolorów (`component/radar/RadarView.js`).
        splitArea: { areaStyle: { color: ["transparent", theme.muted], opacity: 0.06 } },
        axisName: { color: theme.muted, fontSize: 10 },
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          areaStyle: { opacity: 0.25 },
          data: [{ value: radarValues, name: t("adminAnalytics.ga4.radar.seriesName", { days }) }],
        },
      ],
    };
  }, [radarValues, days, t, theme]);

  // Rank stron MALEJĄCO i przycięty do 15 - jedno źródło dla osi wykresu,
  // drążenia i tabeli danych. Skracanie ścieżki do 40 znaków należy WYŁĄCZNIE
  // do etykiety osi: drążenie i tabela muszą podać adres, który da się otworzyć.
  const topPagesRows = useMemo(() => {
    const headers = pageQ.data?.metricHeaders ?? [];
    const idxViews = headers.indexOf("screenPageViews");
    const idxEng = headers.indexOf("engagementRate");
    return (pageQ.data?.rows ?? [])
      .slice()
      .sort((a, b) => parseNumber(b.metrics[idxViews]) - parseNumber(a.metrics[idxViews]))
      .slice(0, 15)
      .map((r) => ({
        path: r.dims[0] ?? "/",
        views: parseNumber(r.metrics[idxViews]),
        engagement: parseNumber(r.metrics[idxEng]),
      }));
  }, [pageQ.data]);

  const topPagesOption = useMemo<EChartsCoreOption>(() => {
    // Oś kategorii ECharts rośnie w górę, więc najmocniejsza strona jest ostatnia.
    const top = [...topPagesRows].reverse();
    return {
      grid: { left: 8, right: 20, top: 8, bottom: 24, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: { type: "value" },
      yAxis: {
        type: "category",
        data: top.map((r) => r.path.slice(0, 40)),
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: top.map((r) => r.views),
          itemStyle: { borderRadius: [0, 4, 4, 0] },
        },
      ],
    };
  }, [topPagesRows]);

  // ---- Drill-down handlers ----
  const trendClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const rows = (dateQ.data?.rows ?? [])
      .slice()
      .sort((a, b) => (a.dims[0] ?? "").localeCompare(b.dims[0] ?? ""));
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const row = rows[idx];
    if (!row) return null;
    const raw = row.dims[0] ?? "";
    const date =
      raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
    const headers = dateQ.data?.metricHeaders ?? [];
    const val = (m: CoreMetric): number => parseNumber(row.metrics[headers.indexOf(m)]);
    return {
      title: t("adminAnalytics.ga4.charts.trendTitle"),
      subtitle: p.seriesName,
      date,
      metrics: [
        { label: t("adminAnalytics.ga4.sessions"), value: val("sessions").toLocaleString("pl-PL") },
        {
          label: t("adminAnalytics.ga4.activeUsers"),
          value: val("activeUsers").toLocaleString("pl-PL"),
        },
        {
          label: t("adminAnalytics.ga4.views"),
          value: val("screenPageViews").toLocaleString("pl-PL"),
        },
        {
          label: t("adminAnalytics.ga4.engagement"),
          value: `${(val("engagementRate") * 100).toFixed(1)}%`,
        },
      ],
    };
  };

  const donutClickFrom =
    (report: Ga4Report | undefined, dimLabel: string) =>
    (p: ChartClickParams): ChartDrillDetail | null => {
      if (typeof p.value !== "number" && typeof (p.data as { value?: unknown })?.value !== "number")
        return null;
      const name = p.name ?? "?";
      const value = typeof p.value === "number" ? p.value : (p.data as { value: number }).value;
      const total = (report?.rows ?? []).reduce(
        (acc, r) => acc + parseNumber(r.metrics[(report?.metricHeaders ?? []).indexOf("sessions")]),
        0,
      );
      const pct = total > 0 ? (value / total) * 100 : 0;
      return {
        title: name,
        subtitle: dimLabel,
        metrics: [
          { label: t("adminAnalytics.ga4.sessions"), value: value.toLocaleString("pl-PL") },
          { label: "%", value: `${pct.toFixed(1)}%` },
        ],
      };
    };

  const topPagesClick = (p: ChartClickParams): ChartDrillDetail | null => {
    const top = [...topPagesRows].reverse();
    const idx = typeof p.dataIndex === "number" ? p.dataIndex : -1;
    const row = top[idx];
    if (!row) return null;
    const path = row.path;
    return {
      title: path,
      subtitle: t("adminAnalytics.ga4.charts.topPagesTitle"),
      url: path,
      urlLabel: path,
      metrics: [
        { label: t("adminAnalytics.ga4.views"), value: row.views.toLocaleString("pl-PL") },
        {
          label: t("adminAnalytics.ga4.engagement"),
          value: `${(row.engagement * 100).toFixed(1)}%`,
        },
      ],
      links: [{ href: path, label: t("adminAnalytics.drillDialog.openInNewTab"), external: false }],
    };
  };

  const modeText =
    activeMode === "oauth_refresh"
      ? t("adminAnalytics.ga4.modeOauth")
      : t("adminAnalytics.ga4.modeServiceAccount");

  const notConfiguredCard = (
    <Card className="p-6 text-sm text-muted-foreground">
      {t("adminAnalytics.ga4.notConfiguredPre")}
      <b>{t("adminAnalytics.ga4.notConfiguredTab")}</b>
      {t("adminAnalytics.ga4.notConfiguredPost")}
    </Card>
  );

  // Status z ENV: raportów nie wysłaliśmy w ogóle, więc nie ma czego oceniać.
  if (!configured) return notConfiguredCard;

  // Przyczynę CYTUJEMY - własny tekst zamiast komunikatu bramki kazałby
  // operatorowi szukać po logach. Odrzucone zapytanie nie ma `q.data`, więc
  // sięgamy do `q.error`; gdy i tam nie ma treści, mówimy o tym wprost, zamiast
  // rysować siatkę zer.
  const reportErrorText =
    reportError?.data && "error" in reportError.data ? String(reportError.data.error) : null;
  const transportError = failedQuery?.error;
  const errorText =
    reportErrorText ??
    (failedQuery !== undefined
      ? transportError instanceof Error && transportError.message.length > 0
        ? transportError.message
        : t("adminAnalytics.common.unknownReason")
      : null);

  if (errorText !== null) {
    return (
      <Card className="p-6 text-sm text-destructive">
        {t("adminAnalytics.ga4.apiError", { error: errorText })}
      </Card>
    );
  }

  // Property zniknęło albo odświeżenie tokenu Google padło: raport wraca pusty
  // i BEZ pola `error`, a prop `configured` (liczony z ENV) nadal mówi „jest
  // podłączone". Bez tej gałęzi „nie mam dostępu do właściwości" wyglądałoby
  // dokładnie jak „właściwość nie miała ruchu" - pierwsze wymaga interwencji
  // admina, drugie nie wymaga niczego.
  if (serverUnconfigured) return notConfiguredCard;

  // ---- Alternatywa tekstowa i eksport: te same dane, co na wykresach ----
  // Bez `csv` karta oddaje czytnikowi ekranu pusty prostokąt z samą nazwą;
  // z `csv` `ChartCard` dokłada tabelę i wiąże ją z regionem wykresu przez
  // `aria-describedby` (przy okazji odsłaniając eksport CSV).
  const dateHeader = t("adminAnalytics.gsc.csvHeaders.date");
  const sessionsHeader = t("adminAnalytics.ga4.sessions");
  const trendCsv: ChartCsv = {
    filename: "ga4-trend",
    headers: [
      dateHeader,
      sessionsHeader,
      t("adminAnalytics.ga4.activeUsers"),
      t("adminAnalytics.ga4.views"),
    ],
    rows: trendData.dates.map((date, i) => [
      date,
      trendData.sessions[i],
      trendData.users[i],
      trendData.views[i],
    ]),
  };
  const engagementCsv: ChartCsv = {
    filename: "ga4-engagement",
    headers: RADAR_AXES.map((key) => t(key)),
    rows: [radarValues],
  };
  const donutCsv = (
    data: DonutSlice[] | null,
    filename: string,
    dimHeader: string,
  ): ChartCsv | undefined =>
    data === null
      ? undefined
      : {
          filename,
          headers: [dimHeader, sessionsHeader],
          rows: data.map((slice) => [slice.name, slice.value]),
        };
  const topPagesCsv: ChartCsv = {
    filename: "ga4-top-pages",
    headers: [
      t("adminAnalytics.ga4.charts.topPagesTitle"),
      t("adminAnalytics.ga4.views"),
      t("adminAnalytics.ga4.engagement"),
    ],
    // Pełna ścieżka, nie ucięta etykieta osi - tabela ma prowadzić do adresu.
    rows: topPagesRows.map((r) => [r.path, r.views, `${(r.engagement * 100).toFixed(1)}%`]),
  };

  const sourceSlices = donutSlices(sourceQ.data);
  const countrySlices = donutSlices(countryQ.data);
  const deviceSlices = donutSlices(deviceQ.data, 5);

  // KAFELEK NIE MALUJE ZERA, DOPÓKI NIE MA POMIARU. „0 sesji" i „jeszcze nie
  // wiem" to dwie różne informacje, a zero jest tą groźniejszą: wygląda jak
  // odczytana właściwość bez ruchu. Plakietka zmiany też czeka na obie strony
  // porównania - bez okna poprzedniego policzyłaby deltę wobec zera.
  const kpiText = (formatted: string): string =>
    hasCurrent ? formatted : t("adminAnalytics.common.measuringShort");
  const kpiDelta = (current: number, previous: number): { current?: number; previous?: number } =>
    hasCurrent && hasPrevious ? { current, previous } : {};

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          {/* `<span>`, nie `<label>`: wyzwalacz Radiksa to `<button
              role="combobox">`, czyli element NIEETYKIETOWALNY - `htmlFor`
              nie nadałby mu nazwy, a pole wyboru okna zostawało bezimienne
              dla czytnika ekranu. Wiązanie idzie przez `aria-labelledby`,
              więc dostępną nazwą jest ten sam widoczny napis. */}
          <span id={windowLabelId} className="text-xs text-muted-foreground block mb-1">
            {t("adminAnalytics.ga4.window")}
          </span>
          <Select value={presetId} onValueChange={(v) => setPresetId(v as Ga4PresetId)}>
            <SelectTrigger className="h-9 text-sm w-32" aria-labelledby={windowLabelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {t(p.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => queries.forEach((q) => q.refetch())}
          className="h-9"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> {t("adminAnalytics.common.refresh")}
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <BarChart3 className="w-3 h-3" /> {t("adminAnalytics.ga4.modeLabel")}
          {modeText}
        </div>
        {anyLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loading")}
          </span>
        ) : null}
      </div>

      {/* Granice okna wprost: interfejs Google domyślnie dolicza dzień bieżący,
          my go pomijamy, żeby liczby dały się uzgodnić z pozostałymi strumieniami.
          Bez tej linii różnica wobec GA4 wyglądałaby jak błąd panelu. */}
      <WindowProvenance window={canonicalWindow} previous={prevWindow} compact />

      {/* ZMIERZONE ZERO powiedziane wprost. Wszystkie raporty odpowiedziały,
          żaden nie ma wiersza - siatka zer jest tu prawdą, ale bez tej linii
          wygląda identycznie jak dane, które nie dojechały. */}
      {measuredZero ? (
        <div className="text-xs text-muted-foreground">
          {t("adminAnalytics.common.noDataWindow")}
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label={t("adminAnalytics.ga4.sessions")}
          value={kpiText(totals.sessions.toLocaleString("pl-PL"))}
          {...kpiDelta(totals.sessions, prevTotals.sessions)}
        />
        <KpiTile
          label={t("adminAnalytics.ga4.activeUsers")}
          value={kpiText(totals.activeUsers.toLocaleString("pl-PL"))}
          {...kpiDelta(totals.activeUsers, prevTotals.activeUsers)}
        />
        <KpiTile
          label={t("adminAnalytics.ga4.views")}
          value={kpiText(totals.screenPageViews.toLocaleString("pl-PL"))}
          {...kpiDelta(totals.screenPageViews, prevTotals.screenPageViews)}
        />
        <KpiTile
          label={t("adminAnalytics.ga4.engagement")}
          value={kpiText(`${(totals.engagementRate * 100).toFixed(1)}%`)}
          {...kpiDelta(totals.engagementRate, prevTotals.engagementRate)}
          absoluteDelta
          deltaSuffix="pp"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title={t("adminAnalytics.ga4.charts.trendTitle")}
          subtitle={t("adminAnalytics.ga4.charts.trendSubtitle")}
          option={trendOption}
          height={320}
          className="xl:col-span-2"
          csv={trendCsv}
          onDataClick={trendClick}
        />
        <ChartCard
          title={t("adminAnalytics.ga4.charts.engagementTitle")}
          subtitle={t("adminAnalytics.ga4.charts.engagementSubtitle")}
          option={radarOption}
          height={320}
          csv={engagementCsv}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title={t("adminAnalytics.ga4.charts.sourcesTitle")}
          subtitle={t("adminAnalytics.ga4.charts.sourcesSubtitle")}
          option={donutOption(sourceSlices)}
          height={280}
          csv={donutCsv(sourceSlices, "ga4-sources", t("adminAnalytics.ga4.charts.sourcesTitle"))}
          onDataClick={donutClickFrom(sourceQ.data, t("adminAnalytics.ga4.charts.sourcesTitle"))}
        />
        <ChartCard
          title={t("adminAnalytics.ga4.charts.countriesTitle")}
          subtitle={t("adminAnalytics.ga4.charts.countriesSubtitle")}
          option={donutOption(countrySlices)}
          height={280}
          csv={donutCsv(
            countrySlices,
            "ga4-countries",
            t("adminAnalytics.ga4.charts.countriesTitle"),
          )}
          onDataClick={donutClickFrom(countryQ.data, t("adminAnalytics.ga4.charts.countriesTitle"))}
        />
        <ChartCard
          title={t("adminAnalytics.ga4.charts.devicesTitle")}
          subtitle={t("adminAnalytics.ga4.charts.devicesSubtitle")}
          option={donutOption(deviceSlices)}
          height={280}
          csv={donutCsv(deviceSlices, "ga4-devices", t("adminAnalytics.ga4.charts.devicesTitle"))}
          onDataClick={donutClickFrom(deviceQ.data, t("adminAnalytics.ga4.charts.devicesTitle"))}
        />
      </div>

      <ChartCard
        title={t("adminAnalytics.ga4.charts.topPagesTitle")}
        subtitle={t("adminAnalytics.ga4.charts.topPagesSubtitle")}
        option={topPagesOption}
        height={340}
        csv={topPagesCsv}
        onDataClick={topPagesClick}
      />

      {/* Interpretacja + rekomendacje per element dashboardu */}
      <InsightSection
        subtitle={t("adminAnalytics.ga4.insightsSubtitle", { days, mode: modeText })}
        insights={buildGa4Insights({
          dateReport: dateQ.data,
          prevReport: prevQ.data,
          sourceReport: sourceQ.data,
          countryReport: countryQ.data,
          deviceReport: deviceQ.data,
          pageReport: pageQ.data,
          engagementReport: engageQ.data,
          windowDays: days,
          t,
        })}
      />
    </div>
  );
}
