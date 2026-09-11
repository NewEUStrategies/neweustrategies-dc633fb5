/**
 * Related Posts - BI dashboard (zakładka Analiza).
 *
 * Wizualizuje sygnały silnika rekomendacji per tenant:
 *  - KPI: liczba wpisów, wyświetleń, klików rekomendacji, czytań
 *  - Słupki poziome: top kategorie / top tagi (liczba wpisów)
 *  - Heatmap: współwystępowanie tagów (macierz top tagów)
 *  - Scatter: popularność wpisów (views × uniques)
 *  - Słupki poziome: ranking przejść „źródło → cel" z klików w rekomendacje
 *  - Słupki poziome: hub-posty (najczęściej rekomendowane cele)
 *  - InsightSection: interpretacja + rekomendacje algorytmiczne
 *
 * Dane pochodzą z `getRelatedInsights` (RPC `related_posts_signals`).
 * Wszystko izolowane per tenant przez auth-middleware + admin gate.
 *
 * SILNIK ZAMIAST ECHARTS. Panel składał wcześniej `option` dla ECharts - osie,
 * dymki, paletę, zaokrąglenia - czyli rysował DRUGIM silnikiem, o innej
 * palecie i innych zasadach interakcji niż wykres we wpisie. Dziś każda karta
 * dostaje `ChartConfig` z `biChart()`, a rysunek, tabelę danych, podpis i
 * obsługę klawiatury robi nasz silnik. Panel podaje WYŁĄCZNIE to, czego silnik
 * wiedzieć nie może: rodzaj, kategorie, serie i garść przełączników uczciwości.
 *
 * SANKEY WYSZEDŁ, ZOSTAŁ RANKING PRZEJŚĆ - i to jest podmiana formy, nie
 * przeniesienie jeden do jednego. Sankey koduje wielkość SZEROKOŚCIĄ WSTĘGI,
 * a przy kilkunastu przepływach splot wstęg jest plątaniną, w której nie da
 * się porównać dwóch pasm ani powiedzieć, które przejście jest drugie w
 * kolejności. Pytanie tej karty brzmi „które przejścia są najczęstsze", a na
 * to odpowiada RANKING: pozycja na wspólnej skali jest najdokładniejszym
 * kanałem percepcyjnym, jaki jest, a kategoria nazywa parę „skąd → dokąd",
 * czyli dokładnie ten element, którym na sankeyu była wstęga. Ranking mieści
 * `FLOWS_IN_RANKING` pozycji, więc podtytuł i podpis `n` mówią WPROST, ile par
 * z ilu widać - obcięcie po cichu byłoby tym samym defektem co wykres bez
 * liczby obserwacji.
 *
 * STANY, KTÓRE NIE SĄ POMIAREM. Panel rozdziela „trwa pomiar", „odczyt padł"
 * i „okno zostało odczytane i nic w nim nie ma" na trzy różne karty ze słownika
 * `adminAnalytics.common.*`. Jeden komunikat na trzy stany stawiał twierdzenie
 * o pomiarze, którego nie było: „Brak danych w oknie." wisiało zarówno w
 * pierwszej sekundzie po wejściu, jak i po padniętym RPC.
 *
 * IZOLACJA WARSZTATÓW. Klucz react-query niesie identyfikator najemcy, a
 * zapytanie jest wstrzymane do jego rozwiązania - inaczej panel następnego
 * warsztatu trafiałby w ten sam wpis cache i (przy `staleTime`) malował
 * kategorie, tagi i tytuły wpisów poprzedniego bez ani jednego żądania w sieci.
 *
 * ALTERNATYWA TEKSTOWA NALEŻY DO SILNIKA, NIE DO KARTY. Tabelę tych samych
 * liczb rysuje rama silnika przy KAŻDYM rodzaju, więc karta jej już nie
 * powtarza; `csv` zostaje wyłącznie jako źródło EKSPORTU, bo plik bywa
 * bogatszy od rysunku (kolumny, których wykres nie koduje - np. liczba źródeł
 * huba obok liczby klików).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getRelatedInsights } from "@/lib/relatedInsights.functions";
import { useCurrentTenantId } from "@/lib/tenant";
import type { ChartSelection } from "@/lib/charts/selection";
import { biChart } from "@/components/admin/analytics/biChart";
import { ChartCard } from "@/components/admin/analytics/ChartCard";
import type { ChartDrillDetail } from "@/components/admin/analytics/ChartDrillDialog";
import { KpiTile } from "@/components/admin/analytics/KpiTile";
import {
  TimeRangeFilter,
  buildPresetRange,
  type TimeRangeValue,
} from "@/components/admin/analytics/TimeRangeFilter";
import { InsightSection, type Insight } from "@/components/admin/analytics/InsightSection";

/**
 * Ile par „źródło → cel" mieści ranking. Powyżej kilkunastu pozycji słupki
 * poziome przestają być rankingiem, a stają się listą - a listę czyta się
 * lepiej w tabeli danych, którą silnik i tak rysuje. Liczba, której NIE widać,
 * jedzie do podtytułu i do podpisu `n`, żeby przycięcie było powiedziane,
 * a nie przemilczane.
 */
const FLOWS_IN_RANKING = 15;

/**
 * Ile tagów wchodzi do macierzy współwystępowania.
 *
 * Macierz jest KWADRATOWA, więc liczba tagów podnosi się do kwadratu: przy
 * dawnych 25 tagach wychodziło 625 komórek, czyli więcej, niż silnik uznaje za
 * czytelne (600) - i wtedy sam dopisuje pod rysunkiem uwagę, że komórka zeszła
 * poniżej celu dotykowego i szerokości liczby. Dwanaście tagów to 144 komórki:
 * liczba mieści się w komórce, a gradient nadal pokazuje kierunek.
 */
const COOC_TAGS = 12;

function nice(n: number): string {
  if (!Number.isFinite(n)) return "-";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Kształt `csv` przyjmowany przez `ChartCard` (eksport danych karty). */
interface ChartCsv {
  filename: string;
  headers: string[];
  rows: ReadonlyArray<ReadonlyArray<unknown>>;
}

/** Podpis wpisu na osi i w tabeli: tytuł, a bez niego skrócony identyfikator. */
function postLabel(title: string | null, postId: string, chars = 8): string {
  return title ?? postId.slice(0, chars);
}

export function RelatedPostsAnalytics() {
  const { t } = useTranslation();
  const fetchInsights = useServerFn(getRelatedInsights);
  const tenantId = useCurrentTenantId();
  const [range, setRange] = useState<TimeRangeValue>(() => buildPresetRange("30d"));

  const query = useQuery({
    // NAJEMCA W KLUCZU, nie tylko okno. Klient react-query powstaje raz na
    // aplikację i przeżywa przełączenie warsztatu, więc bez identyfikatora
    // najemcy panel warsztatu B trafiał w TEN SAM wpis co panel warsztatu A -
    // a przy `staleTime: 60_000` react-query nie ponawiał zapytania, czyli
    // wyciek szedł bez ani jednego żądania w sieci i był widoczny wyłącznie
    // na ekranie.
    queryKey: ["related-insights", tenantId ?? "", range.days],
    queryFn: () => fetchInsights({ data: { days: range.days } }),
    // Odczyt puszczony przed rozwiązaniem najemcy wpadłby do cache pod kluczem
    // z pustym warsztatem - i stamtąd trafiłby do pierwszego, który zapyta.
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const report = query.data;
  // POMIAR W TOKU to także nierozwiązany najemca: zapytanie jest wtedy
  // wstrzymane, więc `isLoading` z react-query jest fałszywe, a panel nadal
  // nie ma CZEGO pokazać.
  const isMeasuring = !tenantId || query.isLoading;
  const readError = query.error;
  const readReason =
    readError instanceof Error && readError.message
      ? readError.message
      : t("adminAnalytics.common.unknownReason");

  const tagIdToName = useMemo(() => {
    const m = new Map<string, string>();
    (report?.top_tags ?? []).forEach((t) => m.set(t.tag_id, t.name));
    return m;
  }, [report]);

  // ---- Zbiory wierszy ----------------------------------------------------
  // Wykres, jego tabela danych i eksport jadą z JEDNEGO przyciętego zbioru.
  // Dwa osobne `slice` to dwie okazje na rozjazd: tabela czytałaby się wtedy
  // jak inny pomiar niż słupki nad nią, przy niezmienionym wyglądzie panelu.
  //
  // KOLEJNOŚĆ JEST RANKINGOWA (najmocniejszy pierwszy) i taka zostaje na
  // wykresie: silnik rysuje kategorie słupków poziomych od góry w kolejności
  // tablicy, więc ranking czyta się z góry na dół. (ECharts układał oś Y od
  // dołu i wymagał `.reverse()` - stąd zniknięcie odwróceń przy tej samej
  // intencji.)
  const cats = useMemo(() => (report?.top_categories ?? []).slice(0, 15), [report]);
  const tags = useMemo(() => (report?.top_tags ?? []).slice(0, 20), [report]);
  const popRows = useMemo(() => (report?.popularity ?? []).slice(0, 40), [report]);
  const hubsRanked = useMemo(() => (report?.hub_targets ?? []).slice(0, 12), [report]);
  /**
   * Wszystkie pary kliknięć MALEJĄCO. Sortowanie jest tu, a nie w zaufaniu do
   * RPC: ranking, który nie jest posortowany, nie jest rankingiem, a kolejność
   * z agregatu SQL jest szczegółem implementacji zapytania.
   */
  const clickPairsRanked = useMemo(
    () => [...(report?.click_pairs ?? [])].sort((a, b) => b.clicks - a.clicks),
    [report],
  );
  /** Ta część rankingu, która MIEŚCI SIĘ na wykresie - reszta jedzie do eksportu. */
  const flowRows = useMemo(() => clickPairsRanked.slice(0, FLOWS_IN_RANKING), [clickPairsRanked]);

  /**
   * Macierz współwystępowania: nazwy osi, wiersze i pary do eksportu.
   *
   * Jeden memo na trzy rzeczy, bo wszystkie trzy muszą wyjść z TEGO SAMEGO
   * przycięcia do `COOC_TAGS` tagów. Para wskazująca poza macierz jest
   * pomijana - bez tego wpadałaby do wiersza `undefined`, czyli do komórki,
   * której w macierzy nie ma.
   *
   * LUKA NIE JEST ZEREM. Komórka pary, która nie wystąpiła, zostaje `null`:
   * zero znaczyłoby „policzono i wyszło zero wspólnych wpisów", czyli
   * twierdzenie o pomiarze, którego nie było. Silnik rysuje lukę teksturą,
   * a nie najjaśniejszym stopniem rampy.
   */
  const cooc = useMemo(() => {
    const pairs = report?.tag_cooccurrence ?? [];
    const idSet = new Set<string>();
    pairs.forEach((p) => {
      idSet.add(p.a);
      idSet.add(p.b);
    });
    const ids = Array.from(idSet).slice(0, COOC_TAGS);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const names = ids.map((id) => tagIdToName.get(id) ?? id.slice(0, 6));
    const grid: (number | null)[][] = ids.map(() => ids.map(() => null));
    // Eksport dostaje PARY, nie komórki: macierz jest symetryczna, więc dwie
    // lustrzane komórki to jedna informacja, a drugi wiersz byłby duplikatem.
    const rows: Array<[string, number]> = [];
    pairs.forEach((p) => {
      const i = idx.get(p.a);
      const j = idx.get(p.b);
      if (i === undefined || j === undefined) return;
      grid[i][j] = p.c;
      grid[j][i] = p.c;
      rows.push([`${names[i]} × ${names[j]}`, p.c]);
    });
    return { names, grid, rows };
  }, [report, tagIdToName]);

  // ---- Konfiguracje wykresów ---------------------------------------------
  // Liczone RAZ na zmianę danych, a nie w JSX przy każdym renderze: każda
  // nowa referencja konfiguracji każe silnikowi przeliczyć geometrię, skalę
  // i model uczciwości całego rysunku.
  const topCatsConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        categories: cats.map((c) => c.name),
        series: [
          {
            name: t("adminAnalytics.related.charts.topCatsSubtitle"),
            values: cats.map((c) => c.posts_count),
          },
        ],
        // Liczba NA SŁUPKU, bo oś dociągnięta do maksimum rankingu nie mówi,
        // czy „prawie pełny" słupek to dziesięć wpisów, czy tysiąc.
        showValues: true,
      }),
    [cats, t],
  );

  const topTagsConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        categories: tags.map((tg) => tg.name),
        series: [
          {
            name: t("adminAnalytics.related.charts.topTagsSubtitle"),
            values: tags.map((tg) => tg.posts_count),
          },
        ],
        showValues: true,
      }),
    [tags, t],
  );

  /**
   * Macierz: SERIA JEST WIERSZEM, KATEGORIA KOLUMNĄ - tak silnik czyta mapę
   * ciepła z konfiguracji. Obie osie niosą te same nazwy tagów, bo
   * współwystępowanie nie ma kierunku.
   *
   * `sampleSize` zostaje pusty świadomie: silnik porównuje go z liczbą
   * WYPEŁNIONYCH KOMÓREK, a tych jest dwa razy więcej niż par (symetria), więc
   * każda podana liczba byłaby albo podwojona, albo zgłoszona jako niezgodna
   * z rysunkiem.
   */
  const coocConfig = useMemo(
    () =>
      biChart({
        kind: "heatmap",
        categories: cooc.names,
        series: cooc.names.map((name, i) => ({ name, values: cooc.grid[i] })),
      }),
    [cooc],
  );

  /**
   * Popularność: dwie zmienne liczbowe, więc ROZRZUT zostaje rozrzutem -
   * pierwsza seria jest osią X, druga osią Y, a kategoria nazywa punkt.
   *
   * `sampleSize` to LICZBA PUNKTÓW, a nie suma wyświetleń: silnik sprawdza tę
   * deklarację wobec liczby par w chmurze i niezgodność wypisuje pod rysunkiem
   * jako defekt („podpis mówi o innym badaniu niż wykres").
   */
  const popularityConfig = useMemo(
    () =>
      biChart({
        kind: "scatter",
        categories: popRows.map((r) => postLabel(r.title, r.post_id)),
        series: [
          { name: t("adminAnalytics.related.views"), values: popRows.map((r) => r.views) },
          { name: t("adminAnalytics.related.uniques"), values: popRows.map((r) => r.uniques) },
        ],
        sampleSize: popRows.length,
      }),
    [popRows, t],
  );

  /**
   * Przejścia „źródło → cel" jako ranking. Kategoria nazywa PARĘ, bo elementem
   * tego wykresu jest przejście między dwoma wpisami, a nie pojedynczy wpis -
   * dokładnie tak, jak na sankeyu elementem była wstęga, a nie węzeł.
   */
  const flowsConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        categories: flowRows.map(
          (p) =>
            `${postLabel(p.source_title, p.source_post_id, 6)} → ${postLabel(p.target_title, p.target_post_id, 6)}`,
        ),
        series: [
          {
            // KLIKI TEGO PRZEJŚCIA, nie kliki wpisu: nazwa serii jest
            // jednocześnie nagłówkiem kolumny w tabeli silnika, a ta sama
            // liczba znaczy tu co innego niż na rankingu hubów obok.
            name: t("adminAnalytics.related.series.flowClicks"),
            values: flowRows.map((p) => p.clicks),
          },
        ],
        showValues: true,
        // Ile par WIDAĆ - obok podtytułu, który mówi, ile ich było.
        sampleSize: flowRows.length,
      }),
    [flowRows, t],
  );

  const hubsConfig = useMemo(
    () =>
      biChart({
        kind: "bar-horizontal",
        categories: hubsRanked.map((hb) => postLabel(hb.title, hb.post_id)),
        series: [
          {
            name: t("adminAnalytics.related.series.hubClicks"),
            values: hubsRanked.map((hb) => hb.clicks),
          },
        ],
        showValues: true,
      }),
    [hubsRanked, t],
  );

  // ---- Drążenie ----------------------------------------------------------
  // LICZBA, KTÓREJ NIE MA NA RYSUNKU, MA MIEĆ GDZIE BYĆ. Słupek huba koduje
  // wyłącznie kliknięcia, a liczba RÓŻNYCH ŹRÓDEŁ rozstrzyga, czy hub wchłania
  // ruch z całego serwisu, czy z jednego wpisu - na sankeyu i w dawnym dymku
  // ECharts jechała razem z kliknięciami, więc musi mieć nośnik i tutaj.
  const hubClick = (sel: ChartSelection): ChartDrillDetail | null => {
    const row = sel.categoryIndex === null ? undefined : hubsRanked[sel.categoryIndex];
    if (!row) return null;
    return {
      title: postLabel(row.title, row.post_id),
      subtitle: t("adminAnalytics.related.charts.hubSubtitle"),
      metrics: [
        { label: t("adminAnalytics.related.series.hubClicks"), value: String(row.clicks) },
        { label: t("adminAnalytics.related.drill.sources"), value: String(row.sources) },
      ],
    };
  };

  // Kategoria rankingu przejść niesie SKRÓCONE podpisy obu wpisów (para musi
  // zmieścić się na osi), więc okno szczegółów podaje jedno i drugie osobno
  // i w pełnym brzmieniu - inaczej „aaaaaa → bbbbbb" byłoby jedyną dostępną
  // postacią pary.
  const flowClick = (sel: ChartSelection): ChartDrillDetail | null => {
    const row = sel.categoryIndex === null ? undefined : flowRows[sel.categoryIndex];
    if (!row) return null;
    return {
      title: sel.category ?? "",
      subtitle: t("adminAnalytics.related.charts.flowsTitle"),
      metrics: [
        {
          label: t("adminAnalytics.related.drill.source"),
          value: postLabel(row.source_title, row.source_post_id),
        },
        {
          label: t("adminAnalytics.related.drill.target"),
          value: postLabel(row.target_title, row.target_post_id),
        },
        { label: t("adminAnalytics.related.series.flowClicks"), value: String(row.clicks) },
      ],
    };
  };

  // ---- Eksport CSV dla SZEŚCIU wykresów -----------------------------------
  // Tabelę danych rysuje silnik, więc `csv` jest tu WYŁĄCZNIE plikiem do
  // pobrania - i wolno mu być bogatszym od rysunku. Korzystają z tego dwie
  // karty: ranking hubów dokłada liczbę źródeł (której słupek nie koduje),
  // a ranking przejść eksportuje WSZYSTKIE pary, nie tylko te, które weszły
  // na wykres.
  //
  // Nagłówek wymiaru bierze tytuł karty (tak samo jak pulpity GSC i GA4),
  // a kolumny wartości - te same klucze słownika, które opisują liczby na tym
  // wykresie. Wiersze idą PORZĄDKIEM RANKINGU, czyli tak, jak czyta się słupki
  // poziome od góry.
  const catsCsv: ChartCsv = {
    filename: "related-top-categories",
    headers: [
      t("adminAnalytics.related.charts.topCatsTitle"),
      t("adminAnalytics.related.charts.topCatsSubtitle"),
    ],
    rows: cats.map((c) => [c.name, c.posts_count]),
  };
  const tagsCsv: ChartCsv = {
    filename: "related-top-tags",
    headers: [
      t("adminAnalytics.related.charts.topTagsTitle"),
      t("adminAnalytics.related.charts.topTagsSubtitle"),
    ],
    rows: tags.map((tg) => [tg.name, tg.posts_count]),
  };
  const coocCsv: ChartCsv = {
    filename: "related-tag-cooccurrence",
    headers: [t("adminAnalytics.related.charts.coocTitle"), t("adminAnalytics.related.coocLabel")],
    rows: cooc.rows,
  };
  const popularityCsv: ChartCsv = {
    filename: "related-popularity",
    headers: [
      t("adminAnalytics.related.charts.popularityTitle"),
      t("adminAnalytics.related.views"),
      t("adminAnalytics.related.uniques"),
    ],
    rows: popRows.map((r) => [postLabel(r.title, r.post_id), r.views, r.uniques]),
  };
  const flowsCsv: ChartCsv = {
    filename: "related-click-paths",
    // Para „źródło → cel" jedzie w JEDNEJ kolumnie, bo jednym elementem wykresu
    // jest tu przejście między dwoma wpisami, a nie osobny wpis.
    headers: [
      t("adminAnalytics.related.charts.flowsTitle"),
      t("adminAnalytics.related.clicksShort"),
    ],
    rows: clickPairsRanked.map((p) => [
      `${postLabel(p.source_title, p.source_post_id, 6)} → ${postLabel(p.target_title, p.target_post_id, 6)}`,
      p.clicks,
    ]),
  };
  const hubsCsv: ChartCsv = {
    filename: "related-hubs",
    headers: [
      t("adminAnalytics.related.charts.hubTitle"),
      t("adminAnalytics.related.hubClicksLabel"),
      t("adminAnalytics.related.hubSourcesLabel"),
    ],
    rows: hubsRanked.map((hb) => [postLabel(hb.title, hb.post_id), hb.clicks, hb.sources]),
  };

  // ---- Interpretacja + rekomendacje ---------------------------------------
  const insights = useMemo<Insight[]>(() => {
    if (!report) return [];
    const list: Insight[] = [];
    const s = report.summary;

    const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];

    // Widoczność silnika: czy w ogóle klikają w rekomendacje?
    if (s.total_views > 100 && s.total_clicks === 0) {
      list.push({
        id: "no-clicks",
        element: t("adminAnalytics.related.insights.noClicks.element"),
        severity: "critical",
        title: t("adminAnalytics.related.insights.noClicks.title"),
        detail: t("adminAnalytics.related.insights.noClicks.detail", { views: s.total_views }),
        fixes: arr("adminAnalytics.related.insights.noClicks.fixes"),
      });
    } else if (s.total_clicks > 0 && s.total_views > 0) {
      const ctr = (s.total_clicks / s.total_views) * 100;
      const sev: Insight["severity"] = ctr >= 3 ? "good" : ctr >= 1 ? "info" : "warn";
      list.push({
        id: "ctr",
        element: t("adminAnalytics.related.insights.ctr.element"),
        severity: sev,
        title: t("adminAnalytics.related.insights.ctr.title", { ctr: ctr.toFixed(2) }),
        detail: t("adminAnalytics.related.insights.ctr.detail", {
          clicks: s.total_clicks,
          views: s.total_views,
        }),
        fixes:
          sev === "good"
            ? arr("adminAnalytics.related.insights.ctr.fixesGood")
            : arr("adminAnalytics.related.insights.ctr.fixesBad"),
      });
    }

    // Zbyt mała pula kategorii
    const cats = report.top_categories;
    const smallCats = cats.filter((c) => c.posts_count > 0 && c.posts_count < 3);
    if (cats.length > 0 && smallCats.length >= 3) {
      list.push({
        id: "small-cats",
        element: t("adminAnalytics.related.insights.smallCats.element"),
        severity: "warn",
        title: t("adminAnalytics.related.insights.smallCats.title", { count: smallCats.length }),
        detail: t("adminAnalytics.related.insights.smallCats.detail"),
        fixes: arr("adminAnalytics.related.insights.smallCats.fixes"),
      });
    }

    // Sygnał behawioralny nieużywany
    if (s.total_reads === 0 && s.total_views > 50) {
      list.push({
        id: "no-reads",
        element: t("adminAnalytics.related.insights.noReads.element"),
        severity: "info",
        title: t("adminAnalytics.related.insights.noReads.title"),
        detail: t("adminAnalytics.related.insights.noReads.detail"),
        fixes: arr("adminAnalytics.related.insights.noReads.fixes"),
      });
    }

    // Współwystępowanie tagów - słaby graf
    const coPairs = report.tag_cooccurrence;
    if (coPairs.length > 0) {
      const avg = coPairs.reduce((a, p) => a + p.c, 0) / coPairs.length;
      if (avg < 2) {
        list.push({
          id: "sparse-tags",
          element: t("adminAnalytics.related.insights.sparseTags.element"),
          severity: "warn",
          title: t("adminAnalytics.related.insights.sparseTags.title"),
          detail: t("adminAnalytics.related.insights.sparseTags.detail", { avg: avg.toFixed(1) }),
          fixes: arr("adminAnalytics.related.insights.sparseTags.fixes"),
        });
      } else {
        list.push({
          id: "healthy-tags",
          element: t("adminAnalytics.related.insights.healthyTags.element"),
          severity: "good",
          title: t("adminAnalytics.related.insights.healthyTags.title"),
          detail: t("adminAnalytics.related.insights.healthyTags.detail", { avg: avg.toFixed(1) }),
          fixes: [],
        });
      }
    }

    // Hub-posty
    const hubs = report.hub_targets;
    if (hubs.length > 0 && hubs[0].clicks >= 5) {
      list.push({
        id: "hub",
        element: t("adminAnalytics.related.insights.hub.element"),
        severity: "info",
        title: t("adminAnalytics.related.insights.hub.title", {
          name: hubs[0].title ?? hubs[0].post_id.slice(0, 8),
        }),
        detail: t("adminAnalytics.related.insights.hub.detail", {
          clicks: hubs[0].clicks,
          sources: hubs[0].sources,
        }),
        fixes: arr("adminAnalytics.related.insights.hub.fixes"),
      });
    }

    // Popularność vs rekomendacja
    const pop = report.popularity;
    if (pop.length > 0 && hubs.length > 0) {
      const hubIds = new Set(hubs.map((h) => h.post_id));
      const popularButNotRec = pop.slice(0, 10).filter((p) => !hubIds.has(p.post_id));
      if (popularButNotRec.length >= 3) {
        list.push({
          id: "mismatch",
          element: t("adminAnalytics.related.insights.mismatch.element"),
          severity: "warn",
          title: t("adminAnalytics.related.insights.mismatch.title", {
            count: popularButNotRec.length,
          }),
          detail: t("adminAnalytics.related.insights.mismatch.detail"),
          fixes: arr("adminAnalytics.related.insights.mismatch.fixes"),
        });
      }
    }

    return list;
  }, [report, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <TimeRangeFilter value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          className="h-7"
          disabled={isMeasuring}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> {t("adminAnalytics.common.refresh")}
        </Button>
        <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3" />{" "}
          {t("adminAnalytics.related.windowInfo", {
            days: report?.summary.window_days ?? range.days,
          })}
        </div>
        {isMeasuring ? (
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> {t("adminAnalytics.common.loading")}
          </span>
        ) : null}
      </div>

      {/* TRZY STANY, TRZY KARTY - nie jeden komunikat na trzy sytuacje.
          „Brak danych w oknie." jest TWIERDZENIEM O POMIARZE i wolno je
          postawić dopiero wtedy, gdy pomiar się odbył. Wcześniej ten sam napis
          obsługiwał także „jeszcze nie wiem" i „odczyt padł": administrator z
          padniętym RPC `related_posts_signals` czytał z ekranu, że silnik
          rekomendacji nie ma danych, choć o danych nikt się nie dowiedział.
          Kolejność gałęzi jest istotna: pomiar w toku wyprzedza awarię, bo
          `error` z poprzedniego okna przeżywa start nowego zapytania. */}
      {isMeasuring ? (
        <Card className="p-6 text-sm text-muted-foreground space-y-1">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t("adminAnalytics.common.measuring")}
          </div>
          <p className="text-xs">{t("adminAnalytics.common.measuringHint")}</p>
        </Card>
      ) : readError ? (
        <Card role="alert" className="p-6 text-sm space-y-1 border-destructive/40 bg-destructive/5">
          <div className="font-medium text-destructive">
            {t("adminAnalytics.common.readFailedReason", { reason: readReason })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.common.readFailedHint")}
          </p>
        </Card>
      ) : !report ? (
        // Odczyt się odbył i nie przyniósł raportu (RPC oddało `null`) - to
        // ZMIERZONE ZERO, więc tu i tylko tu wolno postawić ten komunikat.
        <Card className="p-6 text-sm text-muted-foreground">
          {t("adminAnalytics.common.noDataWindow")}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile
              label={t("adminAnalytics.related.kpi.posts")}
              value={nice(report.summary.total_posts)}
            />
            <KpiTile
              label={t("adminAnalytics.related.kpi.views")}
              value={nice(report.summary.total_views)}
              current={report.summary.total_views}
            />
            <KpiTile
              label={t("adminAnalytics.related.kpi.clicks")}
              value={nice(report.summary.total_clicks)}
              current={report.summary.total_clicks}
            />
            <KpiTile
              label={t("adminAnalytics.related.kpi.reads")}
              value={nice(report.summary.total_reads)}
              current={report.summary.total_reads}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title={t("adminAnalytics.related.charts.topCatsTitle")}
              subtitle={t("adminAnalytics.related.charts.topCatsSubtitle")}
              config={topCatsConfig}
              csv={catsCsv}
              height={360}
            />
            <ChartCard
              title={t("adminAnalytics.related.charts.topTagsTitle")}
              subtitle={t("adminAnalytics.related.charts.topTagsSubtitle")}
              config={topTagsConfig}
              csv={tagsCsv}
              height={360}
            />
          </div>

          <ChartCard
            title={t("adminAnalytics.related.charts.coocTitle")}
            subtitle={t("adminAnalytics.related.charts.coocSubtitle", { count: COOC_TAGS })}
            config={coocConfig}
            csv={coocCsv}
            height={440}
          />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title={t("adminAnalytics.related.charts.popularityTitle")}
              subtitle={t("adminAnalytics.related.charts.popularitySubtitle")}
              config={popularityConfig}
              csv={popularityCsv}
              height={360}
            />
            <ChartCard
              title={t("adminAnalytics.related.charts.hubTitle")}
              subtitle={t("adminAnalytics.related.charts.hubSubtitle")}
              config={hubsConfig}
              csv={hubsCsv}
              height={360}
              onDataClick={hubClick}
            />
          </div>

          <ChartCard
            title={t("adminAnalytics.related.charts.flowsTitle")}
            subtitle={t("adminAnalytics.related.charts.flowsSubtitle", {
              shown: flowRows.length,
              total: clickPairsRanked.length,
            })}
            config={flowsConfig}
            csv={flowsCsv}
            height={420}
            onDataClick={flowClick}
          />

          <InsightSection
            title={t("adminAnalytics.related.insightsTitle")}
            subtitle={t("adminAnalytics.related.insightsSubtitle")}
            insights={insights}
          />
        </>
      )}
    </div>
  );
}
