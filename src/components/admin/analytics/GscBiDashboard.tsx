/**
 * GSC BI dashboard.
 *
 * Fires five parallel Search Analytics queries (by date / query / page / country
 * / device) plus a sixth query over the previous window to compute delta %
 * against the primary window. All queries use the existing `queryGscAnalytics`
 * server fn, so no new server surface is added.
 *
 * Charts:
 *   1. KPI row (clicks, impressions, CTR, avg. position) with delta + sparkline
 *   2. Trend line - clicks vs impressions, daily
 *   3. Horizontal bar rank - top 15 queries by clicks
 *   4. Position buckets (1-3 / 4-10 / 11-20 / 21-50 / 51+)
 *   5. Donut - country distribution (top 8 + "inne")
 *   6. Donut - device distribution
 *   7. Horizontal bar rank - top 20 pages by impressions
 *   8. Calendar heatmap - daily clicks activity
 *
 * RYSUJE NASZ SILNIK, NIE ECHARTS. Panel składa `ChartConfig` przez `biChart()`
 * i oddaje go karcie; paleta, geometria, dymek, tabela danych, podpis i obsługa
 * klawiatury są decyzją silnika. Trzy formy musiały się przy tym zmienić i
 * każda ma powód w danych, nie w dostępności rodzaju:
 *
 *   1. TREEMAPA STRON WYSZŁA, SĄ SŁUPKI POZIOME POSORTOWANE. Kafel kodował
 *      wielkość POWIERZCHNIĄ, czyli jednym z najsłabszych kanałów percepcyjnych
 *      - a kodował nią jedną wielkość (wyświetlenia), więc cała treść rysunku
 *      dawała się oddać długością, kanałem najdokładniejszym. Pytanie karty
 *      („które strony zbierają najwięcej wyświetleń") to ranking, a ranking
 *      czyta się z góry na dół: silnik rysuje kategorie słupków poziomych
 *      w kolejności tablicy, więc tablica jedzie posortowana MALEJĄCO.
 *   2. DRUGA OŚ Y WYSZŁA RAZEM Z NIĄ. Trend miał trzy serie na trzech osiach,
 *      z czego dwie były niewidoczne - czytelnik nie miał jak sprawdzić, w
 *      jakiej skali stoi która linia. Kliknięcia i wyświetlenia zostają na
 *      JEDNEJ osi, bo są tą samą wielkością tego samego lejka (kliknięcia są
 *      podzbiorem wyświetleń), więc odległość między liniami jest treścią.
 *      CTR z rysunku schodzi: `ChartConfig` ma JEDNĄ jednostkę, a procent obok
 *      zliczeń dostałby formatowanie liczby zdarzeń. CTR nie ginie - ma własny
 *      kafelek KPI z deltą, stoi w oknie szczegółów dnia i w eksporcie CSV.
 *   3. KALENDARZ ZOSTAJE MAPĄ CIEPLNĄ, tyle że macierzą (tydzień × dzień
 *      tygodnia) zamiast płyty ECharts. Adresem komórki jest para parametrów,
 *      czyli dokładnie to, do czego ten rodzaj służy. Dzień bez odczytu jest
 *      LUKĄ, a nie zerem: silnik rysuje lukę osobnym stanem, więc „nie było
 *      pomiaru" nie udaje „było zero kliknięć".
 *
 * IZOLACJA WARSZTATU. Każdy klucz react-query niesie identyfikator najemcy
 * (`useCurrentTenantId`), a zapytania startują dopiero po jego rozwiązaniu.
 * Bez tego wpis `["gsc-sites"]` był WSPÓLNY dla wszystkich warsztatów: klient
 * react-query przeżywa zmianę warsztatu, więc panel warsztatu B odczytywał
 * z cache listę właściwości warsztatu A, `preferredSite` wskazywał cudzą
 * właściwość, a świeże wpisy `["gsc-bi", <cudza właściwość>, ...]` malowały
 * cudze frazy BEZ jednego zapytania sieciowego - wyciek widoczny wyłącznie na
 * ekranie.
 *
 * CZTERY STANY, KTÓRE NIE SĄ POMIAREM. Kafelki KPI nie malują zer, dopóki
 * pomiaru nie ma: `measuringShort` w trakcie odczytu, `readFailedShort` po
 * awarii bramki (z osobnym komunikatem `readFailedReason` nad siatką),
 * `notConfiguredShort` gdy warsztat nie ma ani jednej właściwości. Zero jest
 * ZMIERZONE tylko wtedy, gdy wszystkie sześć zapytań wróciło - wtedy panel
 * dopisuje `noDataWindow`.
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Search as SearchIcon } from "lucide-react";
import { useCurrentTenantId } from "@/lib/tenant";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listGscSites, queryGscAnalytics, type GscRow } from "@/lib/analytics/gsc.functions";
import { ChartCard } from "./ChartCard";
import { biChart } from "./biChart";
import type { ChartSelection } from "@/lib/charts/selection";
import type { ChartDrillDetail } from "./ChartDrillDialog";
import { KpiTile } from "./KpiTile";
import { InsightSection } from "./InsightSection";
import { buildGscInsights } from "./gscInsights";

const DAY_MS = 86_400_000;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Kształt `csv` przyjmowany przez `ChartCard` - WYŁĄCZNIE źródło eksportu. */
interface ChartCsv {
  filename: string;
  headers: string[];
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

interface Totals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function totalsOf(rows: GscRow[]): Totals {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posWeighted += r.position * Math.max(r.impressions, 1);
  }
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position = impressions > 0 ? posWeighted / impressions : 0;
  return { clicks, impressions, ctr, position };
}

const POSITION_BUCKETS = [
  { label: "1-3", min: 1, max: 3 },
  { label: "4-10", min: 4, max: 10 },
  { label: "11-20", min: 11, max: 20 },
  { label: "21-50", min: 21, max: 50 },
  { label: "51+", min: 51, max: Number.POSITIVE_INFINITY },
];

interface DonutSlice {
  name: string;
  value: number;
}

/**
 * Wycinki pierścienia: ósemka największych plus ogon zwinięty w „Inne".
 *
 * JEDNA kolejność dla wycinków i dla „Innych": ósemka pokazana osobno i ogon
 * muszą być rozłączne. Liczenie ogona z kolejności WEJŚCIOWEJ (`rows.slice(8)`)
 * dawało przy niesortowanej odpowiedzi API te same kraje dwa razy - raz jako
 * wycinek, raz w „Innych" - więc udziały przestawały sumować się do całości.
 */
function collapseSlices(rows: GscRow[], otherLabel: string): DonutSlice[] {
  const sorted = rows.slice().sort((a, b) => b.clicks - a.clicks);
  const data = sorted.slice(0, 8).map((r) => ({ name: r.keys[0] ?? "?", value: r.clicks }));
  const otherClicks = sorted.slice(8).reduce((acc, r) => acc + r.clicks, 0);
  if (otherClicks > 0) data.push({ name: otherLabel, value: otherClicks });
  return data;
}

/**
 * PIERŚCIEŃ ZE WSPÓLNEGO ŹRÓDŁA. Silnik rysuje przy nim TABELĘ KLUCZA (udział
 * plus wartość bezwzględna w wierszu) zamiast legendy przy łuku - stara legenda
 * „scroll" po prawej stronie koła wchodziła przy tej szerokości karty na
 * pierścień i urywała nazwy po kilku znakach.
 */
function donutChart(slices: DonutSlice[], seriesName: string) {
  return biChart({
    kind: "donut",
    categories: slices.map((s) => s.name),
    series: [{ name: seriesName, values: slices.map((s) => s.value) }],
    sampleSize: slices.reduce((acc, s) => acc + s.value, 0),
  });
}

/**
 * Wiersze macierzy kalendarza, w porządku ISO (poniedziałek pierwszy).
 *
 * Klucze stoją PEŁNYMI ŚCIEŻKAMI, a nie sklejeniem `gsc.weekdays.${dzien}`:
 * bramki parytetu PL/EN i rozjazdu kod <-> słownik widzą wyłącznie pełny
 * cytat klucza, więc sklejenie znika im z oczu razem z brakiem tłumaczenia.
 */
const WEEKDAY_KEYS = [
  "adminAnalytics.gsc.weekdays.mon",
  "adminAnalytics.gsc.weekdays.tue",
  "adminAnalytics.gsc.weekdays.wed",
  "adminAnalytics.gsc.weekdays.thu",
  "adminAnalytics.gsc.weekdays.fri",
  "adminAnalytics.gsc.weekdays.sat",
  "adminAnalytics.gsc.weekdays.sun",
] as const;

/** Dzień z klucza wymiaru albo `null`, gdy wiersz nie niesie daty. */
function dayMs(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Numer dnia tygodnia w porządku ISO: poniedziałek 0, niedziela 6. */
function isoWeekday(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/** Poniedziałek tygodnia, w którym stoi dzień - adres kolumny kalendarza. */
function weekStartMs(ms: number): number {
  return ms - isoWeekday(ms) * DAY_MS;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Macierz kalendarza: tydzień w kolumnie, dzień tygodnia w wierszu.
 *
 * `startMs` to poniedziałek PIERWSZEGO tygodnia i jest jedynym punktem
 * odniesienia adresu komórki - drążenie liczy z niego datę, zamiast trzymać
 * drugą kopię siatki dat obok tej, którą dostał silnik.
 */
interface CalendarGrid {
  startMs: number | null;
  /** Etykiety kolumn: poniedziałek każdego tygodnia. */
  weeks: string[];
  /** Siedem wierszy po tyle wartości, ile tygodni; `null` = brak pomiaru. */
  rows: (number | null)[][];
  /** Liczba dni z pomiarem - to jest `n` tej mapy, nie rozmiar siatki. */
  days: number;
}

const EMPTY_CALENDAR: CalendarGrid = { startMs: null, weeks: [], rows: [], days: 0 };

export function GscBiDashboard({ configured }: { configured: boolean }) {
  const { t } = useTranslation();
  const fetchSites = useServerFn(listGscSites);
  const fetchAnalytics = useServerFn(queryGscAnalytics);
  const tenantId = useCurrentTenantId();
  const [siteUrl, setSiteUrl] = useState<string>("");
  const [days, setDays] = useState<number>(28);
  // Etykiety paska narzędzi są WIDOCZNE, ale `<label>` nie nazywa przycisku -
  // dostępną nazwę wyzwalaczy Radiksa (rola `combobox`) buduje wyłącznie autor,
  // więc każdy dostaje `aria-labelledby` do swojej etykiety. Nazwa dostępna
  // jest wtedy DOKŁADNIE napisem widocznym na ekranie (WCAG 2.5.3).
  const propertyLabelId = useId();
  const windowLabelId = useId();

  const sitesQ = useQuery({
    // Najemca W KLUCZU, nie tylko w RLS: cache react-query przeżywa zmianę
    // warsztatu, a stała `["gsc-sites"]` oddawała listę właściwości poprzedniego.
    queryKey: ["gsc-sites", tenantId ?? ""],
    queryFn: () => fetchSites(),
    enabled: configured && Boolean(tenantId),
  });

  // ODCZYTY PRZEZ `useMemo`, nie gołym `?? []`. Zapasowa pusta tablica jest przy
  // każdym renderze NOWĄ referencją, więc wszystko, co bierze ją do listy
  // zależności, przeliczałoby się bez ani jednej zmiany danych - a liczą z niej
  // wszystkie konfiguracje wykresów niżej.
  const sites = useMemo(() => sitesQ.data?.sites ?? [], [sitesQ.data]);
  const preferredSite = useMemo(() => {
    const match = sites.find((s) => s.siteUrl.toLowerCase().includes("neweuropeanstrategies.com"));
    return match?.siteUrl ?? sites[0]?.siteUrl ?? "";
  }, [sites]);
  const effectiveSite = siteUrl || preferredSite;

  const startDate = daysAgoISO(days);
  const prevStart = daysAgoISO(days * 2);
  const prevEnd = daysAgoISO(days);

  const dims: Array<"date" | "query" | "page" | "country" | "device"> = [
    "date",
    "query",
    "page",
    "country",
    "device",
  ];

  const queries = useQueries({
    queries: [
      ...dims.map((d) => ({
        queryKey: ["gsc-bi", tenantId ?? "", effectiveSite, days, d],
        queryFn: () =>
          fetchAnalytics({
            data: {
              siteUrl: effectiveSite,
              startDate,
              endDate: todayISO(),
              dimensions: [d],
              rowLimit: d === "date" ? 400 : 200,
            },
          }),
        enabled: Boolean(tenantId) && Boolean(effectiveSite),
        staleTime: 60_000,
      })),
      {
        queryKey: ["gsc-bi", tenantId ?? "", effectiveSite, days, "date-prev"],
        queryFn: () =>
          fetchAnalytics({
            data: {
              siteUrl: effectiveSite,
              startDate: prevStart,
              endDate: prevEnd,
              dimensions: ["date" as const],
              rowLimit: 400,
            },
          }),
        enabled: Boolean(tenantId) && Boolean(effectiveSite),
        staleTime: 60_000,
      },
    ],
  });

  const [dateQ, queryQ, pageQ, countryQ, deviceQ, prevDateQ] = queries;
  // Nierozwiązany najemca to nadal ODCZYT W TOKU, nie „brak źródła": zapytania
  // są wtedy wstrzymane, więc bez tego składnika panel ogłaszałby brak
  // właściwości, zanim w ogóle zdążył o nią zapytać.
  const anyLoading = !tenantId || sitesQ.isLoading || queries.some((q) => q.isLoading);
  const failure = queries.find((q) => q.isError)?.error ?? sitesQ.error;
  const readFailed = Boolean(failure);
  /** Wszystkie sześć okien odczytanych - dopiero wtedy zero jest ZMIERZONE. */
  const readComplete = queries.every((q) => q.isSuccess);
  const dateRows = useMemo(() => dateQ.data?.rows ?? [], [dateQ.data]);
  const queryRows = useMemo(() => queryQ.data?.rows ?? [], [queryQ.data]);
  const pageRows = useMemo(() => pageQ.data?.rows ?? [], [pageQ.data]);
  const countryRows = useMemo(() => countryQ.data?.rows ?? [], [countryQ.data]);
  const deviceRows = useMemo(() => deviceQ.data?.rows ?? [], [deviceQ.data]);
  const prevRows = useMemo(() => prevDateQ.data?.rows ?? [], [prevDateQ.data]);

  const totals = useMemo(() => totalsOf(dateRows), [dateRows]);
  const prevTotals = useMemo(() => totalsOf(prevRows), [prevRows]);

  /** ZMIERZONE ZERO: odczyt się udał i w oknie nie ma ani jednego wiersza. */
  const measuredZero =
    readComplete &&
    !readFailed &&
    dateRows.length === 0 &&
    queryRows.length === 0 &&
    pageRows.length === 0 &&
    countryRows.length === 0 &&
    deviceRows.length === 0;

  /**
   * Napis, który staje NA MIEJSCU liczby, kiedy pomiaru nie ma.
   *
   * `null` znaczy „mamy pomiar" - tylko wtedy kafelek dostaje liczbę, deltę
   * i iskrę. W pozostałych stanach zero byłoby kłamstwem o danych, a delta
   * „0%" liczona z dwóch nieznanych okien - kłamstwem o kierunku.
   */
  const kpiPlaceholder: string | null = readFailed
    ? t("adminAnalytics.common.readFailedShort")
    : anyLoading
      ? t("adminAnalytics.common.measuringShort")
      : effectiveSite
        ? null
        : t("adminAnalytics.common.notConfiguredShort");

  /** Seria dzienna w porządku chronologicznym - GSC nie obiecuje kolejności. */
  const sortedDateRows = useMemo(
    () => dateRows.slice().sort((a, b) => (a.keys[0] ?? "").localeCompare(b.keys[0] ?? "")),
    [dateRows],
  );

  /**
   * Trend: DWIE serie zliczeń na JEDNEJ osi.
   *
   * Kliknięcia są podzbiorem wyświetleń, więc wspólna oś nie jest ustępstwem
   * wobec braku drugiej osi - jest treścią: pionowa odległość między liniami
   * to ruch, który zobaczył wynik i w niego nie wszedł. `smoothing: 0`, bo
   * wygładzenie dokłada między dwoma pomiarami wartości, których nie było -
   * przy szeregu dobowym czyta się to jako płynny wzrost tam, gdzie był skok.
   */
  const trendConfig = useMemo(
    () =>
      biChart({
        kind: "line",
        categories: sortedDateRows.map((r) => r.keys[0] ?? ""),
        series: [
          { name: t("adminAnalytics.gsc.clicks"), values: sortedDateRows.map((r) => r.clicks) },
          {
            name: t("adminAnalytics.gsc.impressions"),
            values: sortedDateRows.map((r) => r.impressions),
          },
        ],
        smoothing: 0,
        sampleSize: sortedDateRows.length,
      }),
    [sortedDateRows, t],
  );

  /**
   * Rank fraz: piętnaście najmocniejszych, MALEJĄCO. Jedno źródło dla wykresu,
   * drążenia i eksportu - dwa niezależne sorty to dwa miejsca na rozjazd.
   */
  const topQueryRows = useMemo(
    () =>
      queryRows
        .slice()
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 15),
    [queryRows],
  );

  const topQueriesConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        // MALEJĄCO I BEZ ODWRACANIA: silnik układa kategorie słupków poziomych
        // od góry w kolejności tablicy, więc ranking czyta się z góry na dół.
        // (ECharts budował oś Y od dołu i wymagał odwrotnego sortowania - stąd
        // zmiana kierunku przy niezmienionej intencji.)
        //
        // PEŁNA FRAZA, nie ucięta do 40 znaków: przycinanie należy do renderu
        // etykiet osi, a fraza ucięta w danych wchodzi tak samo do tabeli
        // danych i do eksportu, gdzie nie da się jej już wyszukać.
        categories: topQueryRows.map((r) => r.keys[0] ?? ""),
        series: [
          { name: t("adminAnalytics.gsc.clicks"), values: topQueryRows.map((r) => r.clicks) },
        ],
        sampleSize: topQueryRows.reduce((acc, r) => acc + r.clicks, 0),
      }),
    [topQueryRows, t],
  );

  /**
   * Przedziały SERP-owe policzone RAZ: z tej samej tablicy jedzie wykres i jego
   * tabela danych. Dwa niezależne przebiegi po `queryRows` znaczyłyby, że
   * tekstowa alternatywa może pokazać inne liczby niż słupki.
   */
  const positionBuckets = useMemo(() => {
    const buckets = POSITION_BUCKETS.map((b) => ({ ...b, impressions: 0, clicks: 0 }));
    for (const r of queryRows) {
      const b = buckets.find((x) => r.position >= x.min && r.position <= x.max);
      if (!b) continue;
      b.impressions += r.impressions;
      b.clicks += r.clicks;
    }
    return buckets;
  }, [queryRows]);

  /**
   * Rozkład pozycji: dwie serie zliczeń, znów na jednej osi i z tego samego
   * powodu co trend. Poprzednio kliknięcia jechały LINIĄ po drugiej, ukrytej
   * osi - czyli ten sam znacznik co na trendzie znaczył tam co innego, a
   * wysokość linii nad słupkiem nie znaczyła nic.
   */
  const positionConfig = useMemo(
    () =>
      biChart({
        kind: "bar",
        categories: positionBuckets.map((b) => b.label),
        series: [
          {
            name: t("adminAnalytics.gsc.impressions"),
            values: positionBuckets.map((b) => b.impressions),
          },
          { name: t("adminAnalytics.gsc.clicks"), values: positionBuckets.map((b) => b.clicks) },
        ],
        sampleSize: positionBuckets.reduce((acc, b) => acc + b.impressions, 0),
      }),
    [positionBuckets, t],
  );

  const otherLabel = t("adminAnalytics.gsc.other");
  const clicksLabel = t("adminAnalytics.gsc.clicks");

  const countrySlices = useMemo(
    () => collapseSlices(countryRows, otherLabel),
    [countryRows, otherLabel],
  );
  const deviceSlices = useMemo(
    () => collapseSlices(deviceRows, otherLabel),
    [deviceRows, otherLabel],
  );
  const countriesConfig = useMemo(
    () => donutChart(countrySlices, clicksLabel),
    [countrySlices, clicksLabel],
  );
  const devicesConfig = useMemo(
    () => donutChart(deviceSlices, clicksLabel),
    [deviceSlices, clicksLabel],
  );

  /**
   * Dwadzieścia stron o największej liczbie wyświetleń, MALEJĄCO - jedno
   * źródło dla słupków, drążenia i odnośnika.
   *
   * Domenę ze ścieżki obcinamy, bo właściwość jest jedna i ten sam prefiks
   * w każdym wierszu nie niesie informacji; sam adres NIE JEST PRZYCINANY do
   * trzydziestu znaków, jak w kaflu treemapy. Przycinanie należy do renderu
   * etykiet: ucięty adres wchodziłby tak samo do tabeli danych i do eksportu,
   * a tam nie da się go już otworzyć.
   */
  const topPageRows = useMemo(
    () =>
      pageRows
        .slice()
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 20)
        .map((r) => {
          const raw = r.keys[0] ?? "/";
          return { ...r, rawUrl: raw, path: raw.replace(/^https?:\/\/[^/]+/, "") };
        }),
    [pageRows],
  );

  const pagesConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        categories: topPageRows.map((r) => r.path),
        series: [
          {
            name: t("adminAnalytics.gsc.impressions"),
            values: topPageRows.map((r) => r.impressions),
          },
        ],
        sampleSize: topPageRows.reduce((acc, r) => acc + r.impressions, 0),
      }),
    [topPageRows, t],
  );

  /**
   * Siatka kalendarza. Tygodnie idą CIĄGIEM od pierwszego do ostatniego dnia
   * serii, także te bez ani jednego pomiaru: pominięcie pustego tygodnia
   * ściskałoby oś czasu i dwa odległe tygodnie stanęłyby obok siebie.
   *
   * Wiersz bez daty (Search Console oddaje agregat z pustym `keys`) NIE WCHODZI
   * na siatkę - nie ma na niej miejsca, a dopisanie go do pierwszej komórki
   * przypisałoby pomiar dniowi, którego nikt nie zmierzył.
   */
  const calendar = useMemo<CalendarGrid>(() => {
    const byDay = new Map<number, number>();
    let min: number | null = null;
    let max: number | null = null;
    for (const r of sortedDateRows) {
      const ms = dayMs(r.keys[0] ?? "");
      if (ms === null) continue;
      byDay.set(ms, r.clicks);
      if (min === null || ms < min) min = ms;
      if (max === null || ms > max) max = ms;
    }
    if (min === null || max === null) return EMPTY_CALENDAR;
    const startMs = weekStartMs(min);
    const weeks: string[] = [];
    for (let ms = startMs; ms <= weekStartMs(max); ms += 7 * DAY_MS) weeks.push(isoOf(ms));
    const rows = WEEKDAY_KEYS.map((_key, weekday) =>
      weeks.map((_w, week) => byDay.get(startMs + week * 7 * DAY_MS + weekday * DAY_MS) ?? null),
    );
    return { startMs, weeks, rows, days: byDay.size };
  }, [sortedDateRows]);

  const calendarConfig = useMemo(
    () =>
      biChart({
        kind: "heatmap",
        categories: calendar.weeks,
        series: WEEKDAY_KEYS.map((key, i) => ({
          name: t(key),
          values: calendar.rows[i] ?? [],
        })),
        // `n` mapy cieplnej to liczba WYPEŁNIONYCH komórek, nie rozmiar siatki:
        // tydzień ma siedem pól także wtedy, gdy odczytano z niego dwa dni.
        sampleSize: calendar.days,
      }),
    [calendar, t],
  );

  // ---- Drill-down handlers ----
  const gscRowMetrics = (r: GscRow) => [
    { label: t("adminAnalytics.gsc.clicks"), value: r.clicks.toLocaleString("pl-PL") },
    { label: t("adminAnalytics.gsc.impressions"), value: r.impressions.toLocaleString("pl-PL") },
    { label: "CTR", value: `${(r.ctr * 100).toFixed(2)}%` },
    { label: t("adminAnalytics.gsc.avgPosition"), value: r.position.toFixed(1) },
  ];

  const trendClick = (sel: ChartSelection): ChartDrillDetail | null => {
    const row = sel.categoryIndex === null ? undefined : sortedDateRows[sel.categoryIndex];
    if (!row) return null;
    return {
      title: t("adminAnalytics.gsc.charts.trendTitle"),
      // Wskazanie przy dwóch seriach nie rozstrzyga, która z nich - i nie ma
      // czego rozstrzygać: okno pokazuje wszystkie liczby tego dnia, czyli
      // dokładnie to, o co pytał czytelnik wskazujący dzień.
      subtitle: sel.seriesName ?? undefined,
      date: row.keys[0] ?? "",
      metrics: gscRowMetrics(row),
    };
  };

  const topQueriesClick = (sel: ChartSelection): ChartDrillDetail | null => {
    const row = sel.categoryIndex === null ? undefined : topQueryRows[sel.categoryIndex];
    if (!row) return null;
    return {
      title: row.keys[0] ?? "",
      subtitle: t("adminAnalytics.gsc.charts.topQueriesTitle"),
      metrics: gscRowMetrics(row),
    };
  };

  const positionBucketClick = (sel: ChartSelection): ChartDrillDetail | null => {
    const bucket = sel.categoryIndex === null ? undefined : POSITION_BUCKETS[sel.categoryIndex];
    if (!bucket) return null;
    let clicks = 0;
    let impressions = 0;
    for (const r of queryRows) {
      if (r.position >= bucket.min && r.position <= bucket.max) {
        clicks += r.clicks;
        impressions += r.impressions;
      }
    }
    const ctr = impressions > 0 ? clicks / impressions : 0;
    return {
      title: `${t("adminAnalytics.gsc.avgPosition")}: ${bucket.label}`,
      subtitle: t("adminAnalytics.gsc.charts.positionTitle"),
      metrics: [
        { label: t("adminAnalytics.gsc.clicks"), value: clicks.toLocaleString("pl-PL") },
        { label: t("adminAnalytics.gsc.impressions"), value: impressions.toLocaleString("pl-PL") },
        { label: "CTR", value: `${(ctr * 100).toFixed(2)}%` },
      ],
    };
  };

  const donutClickFrom =
    (rows: GscRow[], dimLabel: string) =>
    (sel: ChartSelection): ChartDrillDetail | null => {
      // „Inne" i zbiorczy wycinek silnika są WORKAMI, nie wymiarem: żaden nie
      // ma wiersza w odpowiedzi, więc nie ma czego pokazać i okno się nie
      // otwiera - zamiast otworzyć je na pustym wierszu.
      const row = rows.find((r) => (r.keys[0] ?? "?") === sel.category);
      if (!row) return null;
      return { title: row.keys[0] ?? "?", subtitle: dimLabel, metrics: gscRowMetrics(row) };
    };

  const pagesClick = (sel: ChartSelection): ChartDrillDetail | null => {
    // BEZ ODWRACANIA: kategorie jadą do silnika w kolejności rankingu, więc
    // indeks wskazania jest indeksem wiersza.
    const row = sel.categoryIndex === null ? undefined : topPageRows[sel.categoryIndex];
    if (!row) return null;
    return {
      title: row.path,
      subtitle: t("adminAnalytics.gsc.charts.pagesTitle"),
      url: row.rawUrl,
      urlLabel: row.path,
      metrics: gscRowMetrics(row),
      links: [
        {
          href: row.rawUrl,
          label: t("adminAnalytics.drillDialog.openInNewTab"),
        },
      ],
    };
  };

  const calendarClick = (sel: ChartSelection): ChartDrillDetail | null => {
    // Adres komórki to PARA (tydzień, dzień tygodnia) - stąd data liczona
    // z poniedziałku pierwszego tygodnia, a nie z drugiej kopii siatki dat.
    if (calendar.startMs === null || sel.categoryIndex === null || sel.seriesIndex === null) {
      return null;
    }
    const iso = isoOf(calendar.startMs + sel.categoryIndex * 7 * DAY_MS + sel.seriesIndex * DAY_MS);
    const row = dateRows.find((r) => (r.keys[0] ?? "") === iso);
    // Komórka bez wiersza to LUKA, nie zero: okno z „0 kliknięć" twierdziłoby
    // o dniu coś, czego nikt nie zmierzył.
    if (!row) return null;
    return {
      title: t("adminAnalytics.gsc.charts.calendarTitle"),
      date: iso,
      metrics: gscRowMetrics(row),
    };
  };

  if (!configured) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {t("adminAnalytics.gsc.notConfiguredPre")}
        <b>{t("adminAnalytics.gsc.notConfiguredTab")}</b>
        {t("adminAnalytics.gsc.notConfiguredPost")}
      </Card>
    );
  }

  // Nagłówki CSV czytane per kolumna, nie jedną tablicą przez `returnObjects`:
  // bramka rozjazdu kod <-> słownik widzi jako wpis tylko liść tekstowy, więc
  // tablica pod kluczem uchodziła za klucz nieistniejący w obu językach.
  const metricHeaders = [
    t("adminAnalytics.gsc.csvHeaders.clicks"),
    t("adminAnalytics.gsc.csvHeaders.impressions"),
    t("adminAnalytics.gsc.csvHeaders.ctr"),
    t("adminAnalytics.gsc.csvHeaders.position"),
  ];
  /** Wiersz metryk w kolejności `metricHeaders` - jeden kształt dla wszystkich tabel. */
  const metricCells = (r: GscRow) => [
    r.clicks,
    r.impressions,
    (r.ctr * 100).toFixed(2),
    r.position.toFixed(2),
  ];
  // EKSPORT, NIE ALTERNATYWA TEKSTOWA. Tabelę danych rysuje przy każdym rodzaju
  // sam silnik i karta nie dokłada drugiej; `csv` zostaje WYŁĄCZNIE źródłem
  // pliku, bo plik bywa bogatszy od rysunku - trend koduje dwie wielkości,
  // a eksport niesie wszystkie cztery metryki dnia, w tym CTR i pozycję,
  // których na osi nie ma i być nie może.
  const trendCsv: ChartCsv = {
    filename: "gsc-trend",
    headers: [t("adminAnalytics.gsc.csvHeaders.date"), ...metricHeaders],
    // Plik idzie porządkiem WYKRESU, nie kolejnością odpowiedzi API - inaczej
    // eksport czyta się jak inny pomiar niż ten na osi czasu.
    rows: sortedDateRows.map((r) => [r.keys[0] ?? "", ...metricCells(r)]),
  };
  const queriesCsv: ChartCsv = {
    filename: "gsc-queries",
    headers: [t("adminAnalytics.gsc.csvHeaders.query"), ...metricHeaders],
    rows: queryRows.map((r) => [r.keys[0] ?? "", ...metricCells(r)]),
  };
  const positionCsv: ChartCsv = {
    filename: "gsc-positions",
    headers: [
      t("adminAnalytics.gsc.csvHeaders.position"),
      t("adminAnalytics.gsc.csvHeaders.impressions"),
      t("adminAnalytics.gsc.csvHeaders.clicks"),
    ],
    // Bez ani jednego zapytania przedziały są ZEROWE, nie zmierzone - plik
    // pięciu zer udawałby pomiar, więc wtedy nie ma go wcale.
    rows:
      queryRows.length === 0 ? [] : positionBuckets.map((b) => [b.label, b.impressions, b.clicks]),
  };
  const dimensionCsv = (rows: GscRow[], filename: string, dimHeader: string): ChartCsv => ({
    filename,
    headers: [dimHeader, ...metricHeaders],
    rows: rows.map((r) => [r.keys[0] ?? "?", ...metricCells(r)]),
  });
  const countriesCsv = dimensionCsv(
    countryRows,
    "gsc-countries",
    t("adminAnalytics.gsc.charts.countriesTitle"),
  );
  const devicesCsv = dimensionCsv(
    deviceRows,
    "gsc-devices",
    t("adminAnalytics.gsc.charts.devicesTitle"),
  );
  const pagesCsv: ChartCsv = {
    filename: "gsc-pages",
    headers: [t("adminAnalytics.gsc.charts.pagesTitle"), ...metricHeaders],
    // PEŁNY adres z domeną, nie sama ścieżka z osi: eksport trafia do arkusza,
    // w którym nie ma już wyboru właściwości, więc adres musi być otwieralny.
    rows: pageRows.map((r) => [r.keys[0] ?? "/", ...metricCells(r)]),
  };
  const calendarCsv: ChartCsv = {
    filename: "gsc-calendar",
    headers: [t("adminAnalytics.gsc.csvHeaders.date"), t("adminAnalytics.gsc.csvHeaders.clicks")],
    rows: sortedDateRows.map((r) => [r.keys[0] ?? "", r.clicks]),
  };

  // Iskra przy kafelku i duży trend jadą z TEGO SAMEGO posortowanego zbioru -
  // dwa osobne sorty były osobną okazją na rozjazd kierunku.
  const sparkClicks = sortedDateRows.map((r) => r.clicks);
  const sparkImpr = sortedDateRows.map((r) => r.impressions);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label id={propertyLabelId} className="text-xs text-muted-foreground block mb-1">
            {t("adminAnalytics.gsc.property")}
          </label>
          <Select value={effectiveSite} onValueChange={setSiteUrl}>
            <SelectTrigger className="h-9 text-sm" aria-labelledby={propertyLabelId}>
              <SelectValue placeholder={t("adminAnalytics.gsc.selectProperty")} />
            </SelectTrigger>
            <SelectContent>
              {sites.map((s) => (
                <SelectItem key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label id={windowLabelId} className="text-xs text-muted-foreground block mb-1">
            {t("adminAnalytics.gsc.window")}
          </label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-9 text-sm w-32" aria-labelledby={windowLabelId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("adminAnalytics.timeRange.preset7d")}</SelectItem>
              <SelectItem value="14">{t("adminAnalytics.timeRange.preset14d")}</SelectItem>
              <SelectItem value="28">{t("adminAnalytics.timeRange.preset28d")}</SelectItem>
              <SelectItem value="90">{t("adminAnalytics.timeRange.preset90d")}</SelectItem>
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
        {anyLoading ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loadingData")}
          </span>
        ) : null}
      </div>

      {/* STANY, KTÓRE NIE SĄ POMIAREM - komunikat, nie milczenie. Awaria bramki
          i zmierzone zero wyglądały do tej pory identycznie: siatka zer. Karta
          zostaje NAD wykresami, a wykresy się nie zwijają, bo operator musi
          nadal móc zmienić okno i ponowić odczyt. */}
      {readFailed ? (
        <Card role="alert" className="border-destructive/40 p-3 text-sm">
          <div className="font-medium text-destructive">
            {t("adminAnalytics.common.readFailedReason", {
              reason: failure?.message?.trim() || t("adminAnalytics.common.unknownReason"),
            })}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t("adminAnalytics.common.readFailedHint")}
          </div>
        </Card>
      ) : null}
      {measuredZero ? (
        <Card role="status" className="p-3 text-sm text-muted-foreground">
          {t("adminAnalytics.common.noDataWindow")}
        </Card>
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label={t("adminAnalytics.gsc.clicks")}
          value={kpiPlaceholder ?? totals.clicks.toLocaleString("pl-PL")}
          current={kpiPlaceholder ? undefined : totals.clicks}
          previous={kpiPlaceholder ? undefined : prevTotals.clicks}
          series={kpiPlaceholder ? undefined : sparkClicks}
          icon={<SearchIcon className="w-3 h-3" />}
        />
        <KpiTile
          label={t("adminAnalytics.gsc.impressions")}
          value={kpiPlaceholder ?? totals.impressions.toLocaleString("pl-PL")}
          current={kpiPlaceholder ? undefined : totals.impressions}
          previous={kpiPlaceholder ? undefined : prevTotals.impressions}
          series={kpiPlaceholder ? undefined : sparkImpr}
        />
        <KpiTile
          label="CTR"
          value={kpiPlaceholder ?? `${(totals.ctr * 100).toFixed(2)}%`}
          current={kpiPlaceholder ? undefined : totals.ctr}
          previous={kpiPlaceholder ? undefined : prevTotals.ctr}
          absoluteDelta
          deltaSuffix="pp"
        />
        <KpiTile
          label={t("adminAnalytics.gsc.avgPosition")}
          value={kpiPlaceholder ?? (totals.position ? totals.position.toFixed(1) : "-")}
          current={kpiPlaceholder ? undefined : totals.position}
          previous={kpiPlaceholder ? undefined : prevTotals.position}
          higherIsBetter={false}
        />
      </div>

      {/* Trend + top queries */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title={t("adminAnalytics.gsc.charts.trendTitle")}
          subtitle={t("adminAnalytics.gsc.charts.trendSubtitle")}
          config={trendConfig}
          csv={trendCsv}
          height={320}
          onDataClick={trendClick}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.topQueriesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.topQueriesSubtitle")}
          config={topQueriesConfig}
          csv={queriesCsv}
          height={320}
          onDataClick={topQueriesClick}
        />
      </div>

      {/* Position buckets + donuts */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <ChartCard
          title={t("adminAnalytics.gsc.charts.positionTitle")}
          subtitle={t("adminAnalytics.gsc.charts.positionSubtitle")}
          config={positionConfig}
          csv={positionCsv}
          height={280}
          onDataClick={positionBucketClick}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.countriesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.countriesSubtitle")}
          config={countriesConfig}
          csv={countriesCsv}
          height={280}
          onDataClick={donutClickFrom(countryRows, t("adminAnalytics.gsc.charts.countriesTitle"))}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.devicesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.devicesSubtitle")}
          config={devicesConfig}
          csv={devicesCsv}
          height={280}
          onDataClick={donutClickFrom(deviceRows, t("adminAnalytics.gsc.charts.devicesTitle"))}
        />
      </div>

      {/* Pages rank + calendar */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard
          title={t("adminAnalytics.gsc.charts.pagesTitle")}
          subtitle={t("adminAnalytics.gsc.charts.pagesSubtitle")}
          config={pagesConfig}
          csv={pagesCsv}
          height={320}
          onDataClick={pagesClick}
        />
        <ChartCard
          title={t("adminAnalytics.gsc.charts.calendarTitle")}
          subtitle={t("adminAnalytics.gsc.charts.calendarSubtitle")}
          config={calendarConfig}
          csv={calendarCsv}
          height={320}
          onDataClick={calendarClick}
        />
      </div>

      {/* Interpretacja + rekomendacje per element dashboardu */}
      <InsightSection
        subtitle={t("adminAnalytics.gsc.insightsSubtitle", { site: effectiveSite, days })}
        insights={buildGscInsights({
          totals,
          prevTotals,
          dateRows,
          queryRows,
          pageRows,
          countryRows,
          deviceRows,
          windowDays: days,
          t,
        })}
      />
    </div>
  );
}
