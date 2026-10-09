// Interaktywna mapa danych (choropleta): Europa, świat i pięć kontynentów
// (lista regionów: `MAP_REGIONS` w `lib/charts/types.ts`). Jeden render dla
// bloku CMS (`data-map`, `DataVizViews.tsx`) i widgetu buildera
// (`DataVizWidgets.tsx` przez `widgetMapConfig`), więc obie platformy
// pokazują tę samą mapę co do piksela.
//
// Geometria NIE podróżuje w bundlu JS: pre-projektowane ścieżki SVG leżą w
// public/geo/*.json (generator: scripts/generate-geo-maps.ts) i są
// dociągane fetchem + cache'owane przez CDN i React Query. Nazwy krajów
// (PL/EN) są wbudowane w zasób, więc klient nie ładuje żadnych locale.
//
// KODOWANIE WARTOŚCI liczy model skali (`kinds/mapScale.ts`): schemat
// (niebieski, łupkowy, pomarańczowy, rozbieżny), skala ciągła albo 3-7 klas
// (kwantyle albo równe przedziały), punkt środkowy schematu rozbieżnego.
// DOMENA TO KRAJE NARYSOWANE: wartość kraju, którego nie ma w zasobie
// regionu, rozciągałaby skalę o liczbę niewidoczną na obrazku - zostaje
// w tabeli, a pod mapą stoi nota, które kody wypadły z rysunku.
// Farbę (napis stylu i hex awaryjny) składa `mapPaint.ts` - tam też żyje
// WYGLĄD OPUBLIKOWANY: mapa `blue` bez klas maluje dokładnie tymi napisami,
// co przed modelem.
//
// KRAJE BEZ DANYCH są KRESKOWANE (wzór SVG w pikselach CSS przez
// `patternTransform`, patrz `MAP_HATCH`), a nie tylko jaśniejsze: sam kolor
// blisko płyty zlewałby się z pierwszą klasą w druku w skali szarości
// i u osoby z zaburzeniem widzenia barw. Ich tooltip mówi „brak danych".
//
// WSKAZANIE I FOKUS rysują NAKŁADKĘ na końcu rysunku: kopia kształtu
// z dwoma obrysami (halo w kolorze karty pod tuszem pierwszego planu),
// z `vector-effect: non-scaling-stroke`. Dwa tony, bo jeden kolor obrysu
// zawsze ginie na części rampy (ciemny na ciemnej klasie, jasny na jasnej),
// a jeden z dwóch ma co najmniej 3:1 do każdej klasy - pilnuje tego bramka
// `mapOutlineContrast.test.ts`. Nakładka na końcu, bo obrys kraju malowany
// w kolejności zasobu chował się pod sąsiadami malowanymi później.
//
// DOTYK: stuknięcie kraju otwiera tooltip i trzyma go (na dotyku nie ma
// „najechania"), stuknięcie obok albo Escape zamyka. Klawiatura: kraj z danymi
// jest przystankiem Tab, fokus otwiera tooltip w środku kraju, Escape go
// chowa, zostawiając obrys fokusu. Fokus i wskazanie to DWA stany: kursor
// przejeżdżający nad innym krajem nie zdejmuje obrysu krajowi z fokusem.
//
// SSR: rama + tabela danych + legenda renderują się na serwerze (crawler widzi
// liczby); sam SVG dogrywa się po stronie klienta w miejsce migotki, której
// wysokość bierze się z aspektu startowego regionu (patrz `geoAspect.ts`).
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { DataMapConfig, GeoAsset, MapRegion } from "@/lib/charts/types";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { mapAspect } from "@/lib/charts/geoAspect";
import { mapScale } from "@/lib/charts/kinds/mapScale";
import type { ChartThemeName } from "@/lib/charts/palette";
import { formatChartValue, type ChartLang } from "@/lib/charts/format";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import {
  ChartFrame,
  ChartNotes,
  CHART_TABLE_CLS,
  type ChartCaption,
  type ChartExportKeyItem,
  type ChartNote,
  type ChartPanelMeta,
} from "./ChartFrame";
import { ChartTooltip, type TooltipFact, type TooltipRow } from "./ChartTooltip";
import { sourceLine } from "./chartFacts";
import { MapLegend } from "./MapLegend";
import {
  classRangeLabel,
  hatchTransform,
  MAP_HATCH,
  MAP_INTERACTION_KEYS,
  MAP_METHOD_KEYS,
  MAP_NODATA_KEY,
  MAP_NODATA_SWATCH,
  MAP_SCHEME_KEYS,
  mapPaintOf,
  nodataHex,
  rankById,
  viewBoxWidth,
  type MapPaint,
  type MapT,
} from "./mapPaint";
import "@/lib/i18n-charts-map";

/**
 * Motyw czytany z klasy na <html> - tej samej, którą ustawia ThemeProvider
 * (i skrypt przedhydracyjny w __root.tsx). Potrzebny WYŁĄCZNIE hexom
 * awaryjnym (atrybut `fill`), a te liczą się przy renderze SVG, który dogrywa
 * się po hydracji - SSR nigdy nie zgaduje motywu. W przeglądarkach
 * z color-mix() wypełnienie i tak bierze `style` (wygrywa nad atrybutem)
 * i jedzie samymi tokenami. Kotwice idą z modułu palety, nie z literałów.
 */
function themeOf(): ChartThemeName {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface DataMapProps {
  config: DataMapConfig;
  lang: ChartLang;
  className?: string;
  /** Numery przypisów źródeł nadane przez artykuł (`precomputeFootnotes`). */
  footnoteNumbers?: ReadonlyMap<string, number>;
  /** `embedded` - bez karty i przycisków (osadzenie ma własny nagłówek). */
  variant?: "panel" | "embedded";
}

/** Treść tooltipa jednego kraju. */
interface MapTip {
  rows: TooltipRow[];
  facts: TooltipFact[];
  source: string | null;
}

export function ChoroplethMap({
  config,
  lang,
  className,
  footnoteNumbers,
  variant = "panel",
}: DataMapProps) {
  // Dwa haki, bo dwie nakładki: linia źródła tooltipa jest WSPÓLNA
  // z wykresami (`charts.tip.*`, `sourceLine`), reszta napisów mapy żyje
  // w `chartsMap.*`. Hak mapy stoi DRUGI - bramka rozjazdu kod-słownik
  // przypisuje literał `t("...")` do ostatniego haka nad nim.
  const { t: chartsScoped } = useTranslation("translation", { keyPrefix: "charts" });
  const { t: mapScoped } = useTranslation("translation", { keyPrefix: "chartsMap" });
  const t: MapT = (key, values) => mapScoped(key, { lng: lang, ...values });
  const chartsT = (key: string, values?: Record<string, string | number>): string =>
    chartsScoped(key, { lng: lang, ...values });

  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate, {
    onMount: true,
  });
  const hasValues = config.values.length > 0;

  const geo = useQuery({
    ...geoAssetQueryOptions(config.region),
    // Klient-only: SSR renderuje ramę + tabelę, SVG dogrywa się po hydracji
    // (duży zasób nie podróżuje w dehydratowanym cache'u). Mapa bez wartości
    // nie ma czego rysować, więc geometrii nie dociąga.
    enabled: typeof window !== "undefined" && hasValues,
  });

  const valueById = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of config.values) m.set(v.id, v.value);
    return m;
  }, [config.values]);

  // KRAJE NARYSOWANE i kody, które z rysunku wypadły. Przed dojechaniem
  // geometrii (SSR, migotka, awaria zasobu) nie wiemy, czego w zasobie nie
  // ma - wtedy domena idzie ze wszystkich wartości.
  const { drawn, dropped } = useMemo(() => {
    if (!geo.data) return { drawn: config.values, dropped: [] as string[] };
    const ids = new Set(geo.data.countries.map((c) => c.id));
    return {
      drawn: config.values.filter((v) => ids.has(v.id)),
      dropped: config.values.filter((v) => !ids.has(v.id)).map((v) => v.id),
    };
  }, [geo.data, config.values]);

  const scale = useMemo(
    () =>
      mapScale(
        drawn.map((v) => v.value),
        config.scheme,
        config.classes,
        config.method,
        config.midpoint,
      ),
    [drawn, config.scheme, config.classes, config.method, config.midpoint],
  );
  const ranks = useMemo(() => rankById(drawn), [drawn]);

  // Mapa nazw zamiast .find() per wiersz tabeli/tooltip (176 krajów).
  const namesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of geo.data?.countries ?? []) {
      m.set(c.id, lang === "en" ? c.en || c.pl : c.pl || c.en);
    }
    return m;
  }, [geo.data, lang]);
  const nameOf = (id: string): string => namesById.get(id) ?? id;

  const unit = config.unit;
  const fmt = (value: number): string => formatChartValue(value, lang, unit);
  const paintOf = (value: number, theme: ChartThemeName): MapPaint =>
    mapPaintOf(scale, config.scheme, value, theme);
  // Legenda i klucz eksportu dostają NAPIS STYLU - ten sam w obu motywach.
  const colorOf = (value: number): string => paintOf(value, "light").style;
  const showNoData = !geo.data || geo.data.countries.some((c) => !valueById.has(c.id));
  const source = sourceLine(chartsT, config);

  const tipOf = (id: string): MapTip => {
    const value = valueById.get(id);
    if (value === undefined) {
      return {
        rows: [
          { name: t("tip.value"), value: t("noData"), colorSlot: null, color: MAP_NODATA_SWATCH },
        ],
        facts: [],
        source: null,
      };
    }
    const facts: TooltipFact[] = [];
    const rank = ranks.get(id);
    if (rank !== undefined) {
      facts.push({
        label: t("tip.rank"),
        value: t("tip.rankValue", { rank, total: drawn.length }),
      });
    }
    const classIndex = scale.classIndexOf(value);
    if (classIndex !== null) {
      const c = scale.classes[classIndex];
      facts.push({ label: t("tip.range"), value: classRangeLabel(t, c.from, c.to, lang, unit) });
    }
    return {
      rows: [
        {
          name: t("tip.value"),
          value: fmt(value),
          colorSlot: null,
          // Próbka w kolorze, którym kraj jest NAMALOWANY - nie slot palety.
          color: paintOf(value, "light").style,
        },
      ],
      facts,
      source,
    };
  };

  // ---- „Jak czytać" - zdania mapy zamiast zdań o osiach i seriach.
  const schemeName = t(MAP_SCHEME_KEYS[config.scheme]);
  const coloursText =
    config.scheme === "diverging"
      ? t("read.coloursDiverging", { scheme: schemeName, midpoint: fmt(scale.midpoint ?? 0) })
      : t("read.coloursSequential", { scheme: schemeName });
  const scaleText =
    scale.kind === "classed"
      ? t("read.scaleClassed", {
          n: scale.classes.length,
          method: t(MAP_METHOD_KEYS[config.method]),
        })
      : t("read.scaleContinuous", { method: t("methods.continuous") });

  // Klucz PNG - te same pozycje, które czytelnik widzi w legendzie; mapa
  // z wyłączoną legendą eksportuje się bez klucza, tak jak wygląda. Pozycja
  // „brak danych" ma w pliku średni ton kreskowania i napis o kreskowaniu
  // (`MAP_NODATA_KEY`) - płótno klucza nie umie namalować wzoru.
  const exportKey = (): ChartExportKeyItem[] => {
    if (!config.showLegend) return [];
    const items: ChartExportKeyItem[] =
      scale.kind === "classed"
        ? scale.classes.map((c) => ({
            label: classRangeLabel(t, c.from, c.to, lang, unit),
            color: c.color,
          }))
        : scale.classes.map((s) => ({ label: fmt(s.from), color: colorOf(s.from) }));
    const unique = items.filter((item, i) => items.findIndex((x) => x.label === item.label) === i);
    if (showNoData) unique.push({ label: t("noDataHatched"), color: MAP_NODATA_KEY });
    return unique;
  };

  const meta: ChartPanelMeta = {
    family: "map",
    help: {
      elements: t("read.elements"),
      colours: `${coloursText} ${scaleText}`,
      interactions: t(MAP_INTERACTION_KEYS[scale.kind]),
    },
    exportKey,
    demo: config.demo,
    provenance: config.provenance,
    sources: config.sources,
    footnoteNumbers,
    // Mapa nie rysuje pasma, celu ani suwaka zakresu.
    hasBand: false,
    hasTarget: false,
    zoomable: false,
  };

  const caption: ChartCaption = {
    source: config.source,
    sourceDate: config.sourceDate,
    unit,
    sampleSize: config.sampleSize,
    // Kartogram nie ma osi wartości, więc nie ma czego uciąć, i nie liczy
    // udziałów, więc nie ma sumy kontrolnej do zgłoszenia.
    zeroBaselineBroken: false,
    shareSumMismatch: null,
    notesShows: config.notesShows,
    notesSurprising: config.notesSurprising,
    notesHidden: config.notesHidden,
    caption: config.caption,
  };

  const frameProps = {
    title: config.title,
    description: config.description,
    lang,
    metric: null,
    // Legenda mapy to `MapLegend` pod rysunkiem, nie legenda serii ramy.
    legend: [],
    showLegend: false,
    caption,
    className,
    meta,
    variant,
  };

  // Tabela danych - przy pustym zestawie zostają same nagłówki (komunikat
  // stoi raz, w miejscu rysunku, a nie drugi raz w panelu danych).
  const table = (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t("table.country")}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t("table.value")}
          </th>
        </tr>
      </thead>
      <tbody>
        {[...config.values]
          .sort((a, b) => b.value - a.value)
          .map((v) => (
            <tr key={v.id}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {nameOf(v.id)}
              </th>
              <td className={CHART_TABLE_CLS.tdNum}>{fmt(v.value)}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );

  // PUSTY ZESTAW zostaje panelem: tytuł, źródło i rama stoją, a w miejscu
  // rysunku jest komunikat o wysokości regionu. Goła notka zamiast karty
  // zmieniała wysokość widgetu i gubiła tytuł, który autor już wpisał.
  if (!hasValues) {
    return (
      <ChartFrame {...frameProps} table={table}>
        <MapEmpty region={config.region} text={t("empty")} />
      </ChartFrame>
    );
  }

  const notes: ChartNote[] =
    dropped.length > 0
      ? [{ key: "outside", text: t("notes.outside", { ids: dropped.join(", ") }), defect: false }]
      : [];

  const canvas = {
    region: config.region,
    geo: geo.data,
    geoError: geo.isError,
    label: config.title,
    valueById,
    paintOf,
    nameOf,
    formatValue: fmt,
    tipOf,
    loadError: t("loadError"),
  };

  const legend = config.showLegend ? (
    <MapLegend
      scale={scale}
      colorOf={colorOf}
      method={config.method}
      lang={lang}
      unit={unit}
      showNoData={showNoData}
    />
  ) : null;

  return (
    <ChartFrame
      {...frameProps}
      table={table}
      renderExpanded={(height) => (
        <>
          <MapCanvas {...canvas} maxHeight={height} />
          {legend}
          {/* Nota o kodach spoza regionu jedzie też do powiększenia: legenda
              liczy domenę z krajów narysowanych, więc bez noty okno nie
              mówiłoby, czego na rysunku brakuje. */}
          <ChartNotes notes={notes} />
        </>
      )}
    >
      <div ref={revealRef} className={revealClassName(revealState)}>
        <MapCanvas {...canvas} />
        {legend}
        <ChartNotes notes={notes} />
      </div>
    </ChartFrame>
  );
}

/** Pusty zestaw: komunikat w pudełku o wysokości rysunku regionu. */
function MapEmpty({ region, text }: { region: MapRegion; text: string }) {
  const { ref, width } = useContainerWidth<HTMLDivElement>(720);
  return (
    <div
      ref={ref}
      className="neh-map-empty flex w-full items-center justify-center text-sm text-muted-foreground"
      style={{ height: Math.round(width * mapAspect(region, undefined)) }}
    >
      <p role="status" className="m-0">
        {text}
      </p>
    </div>
  );
}

/** Kto wskazał kraj - decyduje, co zamyka tooltip. */
type ActiveSource = "pointer" | "touch" | "focus";

/**
 * Czy fokus przyszedł z KLAWIATURY. Klik i stuknięcie też fokusują ścieżkę
 * z `tabIndex`, ale wtedy wskazanie niesie stan wskaźnika - fokus z myszy
 * trzymałby obrys i dymek klikniętego kraju po odjechaniu kursora.
 * Heurystykę daje przeglądarka (`:focus-visible`). Zdarzenie fokusu bez
 * faktycznego fokusu (syntetyczne) i silnik bez tej pseudoklasy liczą się
 * jak klawiatura - lepiej obrys w nadmiarze niż fokus bez wskaźnika.
 */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(":focus-visible") || !el.matches(":focus");
  } catch {
    return true;
  }
}

interface ActiveCountry {
  id: string;
  /**
   * Czy kraj miał dane w chwili wskazania. Po podmianie danych kraj, który
   * je stracił (albo zyskał), nie może dalej pokazywać starego dymka - to
   * byłby tooltip z poprzedniej przestrzeni roboczej.
   */
  hasData: boolean;
  x: number;
  y: number;
  source: ActiveSource;
  /** Escape przy fokusie chowa dymek, ale zostawia obrys fokusu. */
  tip: boolean;
}

interface MapCanvasProps {
  region: MapRegion;
  geo: GeoAsset | undefined;
  geoError: boolean;
  /** Etykieta grupy SVG - tytuł mapy; pusty = bez atrybutu. */
  label: string;
  /** Górna granica wysokości (okno powiększenia); brak = wysokość z szerokości. */
  maxHeight?: number;
  valueById: ReadonlyMap<string, number>;
  paintOf: (value: number, theme: ChartThemeName) => MapPaint;
  nameOf: (id: string) => string;
  formatValue: (value: number) => string;
  tipOf: (id: string) => MapTip;
  loadError: string;
}

/**
 * Płótno mapy: SVG z krajami, kreskowanie, nakładka obrysu i tooltip. Osobny
 * komponent, bo rysuje się DWA RAZY - w panelu i w oknie powiększenia - i każde
 * płótno ma własną szerokość, własny wzór kreskowania i własny stan wskazania.
 */
function MapCanvas({
  region,
  geo,
  geoError,
  label,
  maxHeight,
  valueById,
  paintOf,
  nameOf,
  formatValue,
  tipOf,
  loadError,
}: MapCanvasProps) {
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  // DWA STANY, NIE JEDEN. Wskazanie wskaźnikiem (mysz, pióro, palec) i fokus
  // klawiatury żyją osobno: wspólny stan sprawiał, że najechanie na
  // dowolny kraj i zjechanie z niego zdejmowało obrys krajowi, który wciąż
  // trzymał fokus - zostawał wtedy tylko pierścień akcentu 1,02:1.
  const [pointed, setPointed] = useState<ActiveCountry | null>(null);
  const [focused, setFocused] = useState<ActiveCountry | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Identyfikator wzoru z `useId`, oczyszczony z dwukropków i nawiasów
  // Reacta - `url(#...)` w atrybucie nie znosi ich we wszystkich silnikach.
  const hatchId = `neh-map-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // Aspekt Z ZASOBU (jego `viewBox`), a nie ze stałej przepisanej
  // z generatora - dlaczego, tłumaczy nagłówek `geoAspect.ts`. Do czasu
  // dojechania zasobu (czyli pod migotką) wchodzi wartość startowa regionu.
  // W oknie powiększenia mapa ZWĘŻA SIĘ do wysokości okna zamiast dostawać
  // pasy po bokach - pudełko wciąż dokładnie obejmuje rysunek, więc kotwica
  // tooltipa liczy się tą samą skalą co w panelu.
  const aspect = mapAspect(region, geo);
  const drawWidth =
    maxHeight === undefined ? width : Math.max(1, Math.min(width, Math.floor(maxHeight / aspect)));
  const mapHeight = Math.round(drawWidth * aspect);

  const pointedSource = pointed?.source ?? null;
  const listening = pointed !== null || focused !== null;
  useEffect(() => {
    if (!listening) return;
    // Escape zamyka KAŻDY dymek: wskazanie wskaźnikiem znika w całości,
    // a fokus chowa dymek i zostawia obrys.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      setPointed(null);
      setFocused((f) => (f === null || !f.tip ? f : { ...f, tip: false }));
    };
    // Dotyk nie ma „opuszczenia" kraju: tooltip ze stuknięcia zamyka
    // stuknięcie gdziekolwiek poza krajem tej mapy (inny kraj przełącza).
    const onDown = (e: PointerEvent): void => {
      if (pointedSource !== "touch") return;
      const target = e.target as Element | null;
      const onCountry =
        target !== null &&
        svgRef.current?.contains(target) === true &&
        typeof target.closest === "function" &&
        target.closest(".neh-country") !== null;
      if (!onCountry) setPointed(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [listening, pointedSource]);

  const anchorOf = (e: ReactPointerEvent<SVGPathElement>): { x: number; y: number } | null => {
    const host = e.currentTarget.ownerSVGElement?.parentElement;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlers = (id: string, hasData: boolean) => ({
    onPointerMove: (e: ReactPointerEvent<SVGPathElement>) => {
      // Ruch palca to przewijanie strony, nie wskazanie.
      if (e.pointerType === "touch") return;
      const at = anchorOf(e);
      if (at) setPointed({ id, hasData, ...at, source: "pointer", tip: true });
    },
    onPointerLeave: (e: ReactPointerEvent<SVGPathElement>) => {
      // Na dotyku „opuszczenie" przychodzi zaraz po stuknięciu - tooltip
      // stuknięcia musi je przeżyć.
      // Zjechanie zdejmuje WYŁĄCZNIE wskazanie - fokus klawiatury (inny stan)
      // wraca wtedy z obrysem i dymkiem.
      if (e.pointerType === "touch") return;
      setPointed((a) => (a !== null && a.id === id && a.source !== "touch" ? null : a));
    },
    onPointerUp: (e: ReactPointerEvent<SVGPathElement>) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const at = anchorOf(e);
      if (at) setPointed({ id, hasData, ...at, source: "touch", tip: true });
    },
  });

  const onFocus = (e: FocusEvent<SVGPathElement>, id: string) => {
    if (!keyboardFocus(e.currentTarget)) return;
    const box = e.currentTarget.getBBox();
    const vb = e.currentTarget.ownerSVGElement?.viewBox.baseVal;
    if (!vb || vb.width === 0) return;
    const scale = drawWidth / vb.width;
    setFocused({
      id,
      hasData: true,
      x: (box.x + box.width / 2) * scale,
      y: (box.y + box.height / 2) * scale,
      source: "focus",
      tip: true,
    });
  };

  // Wskazanie aktualne wobec OBECNYCH danych (patrz `hasData`).
  const current = (a: ActiveCountry | null): ActiveCountry | null =>
    a !== null && geo !== undefined && valueById.has(a.id) === a.hasData ? a : null;
  const shownPointed = current(pointed);
  const shownFocused = current(focused);
  // Dymek ma JEDEN: wskazanie wskaźnikiem (ostatni gest) przed fokusem.
  const shown = shownPointed ?? (shownFocused !== null && shownFocused.tip ? shownFocused : null);
  const tip = shown !== null ? tipOf(shown.id) : null;
  // Obrysów może być DWA: kraj z fokusem klawiatury trzyma swój, kiedy kursor
  // wskazuje inny kraj - wskaźnik fokusu nie znika pod najechaniem.
  const outlinedIds = [shownFocused?.id, shownPointed?.id].filter(
    (id, i, all): id is string => id !== undefined && all.indexOf(id) === i,
  );
  const outlined = outlinedIds.flatMap((id) => geo?.countries.find((c) => c.id === id) ?? []);
  const outlinedSet = new Set(outlinedIds);

  let drawing: ReactNode;
  if (geoError) {
    drawing = (
      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
        {loadError}
      </div>
    );
  } else if (geo) {
    const theme = themeOf();
    const nodata = nodataHex(theme);
    const S = MAP_HATCH.spacingPx;
    drawing = (
      <svg
        ref={svgRef}
        width={drawWidth}
        height={mapHeight}
        viewBox={geo.viewBox}
        preserveAspectRatio="xMidYMid meet"
        // group (nie img): kraje z danymi są fokusowalne.
        role="group"
        aria-label={label || undefined}
        className="block"
      >
        <defs>
          <pattern
            id={hatchId}
            patternUnits="userSpaceOnUse"
            width={S}
            height={S}
            patternTransform={hatchTransform(viewBoxWidth(geo.viewBox), drawWidth)}
          >
            <rect
              width={S}
              height={S}
              fill={nodata.fill}
              style={{ fill: "var(--chart-map-nodata)" }}
            />
            <rect
              width={MAP_HATCH.linePx}
              height={S}
              fill={nodata.hatch}
              style={{ fill: "var(--chart-map-nodata-hatch)" }}
            />
          </pattern>
        </defs>
        <g className="neh-map-countries">
          {/* Najpierw kraje bez danych (tło), potem z danymi. */}
          {geo.countries
            .filter((c) => !valueById.has(c.id))
            .map((c) => (
              <path
                key={c.id}
                d={c.d}
                className="neh-country"
                data-nodata="true"
                data-active={outlinedSet.has(c.id) || undefined}
                // Wzór w atrybucie: `url(#...)` nie potrzebuje tokenu, a tokeny
                // niesie wnętrze wzoru (tło i linie kreskowania).
                fill={`url(#${hatchId})`}
                fillRule="evenodd"
                {...handlers(c.id, false)}
              />
            ))}
          {geo.countries
            .filter((c) => valueById.has(c.id))
            .map((c) => {
              const value = valueById.get(c.id) as number;
              const paint = paintOf(value, theme);
              return (
                <path
                  key={c.id}
                  d={c.d}
                  className="neh-country"
                  data-active={outlinedSet.has(c.id) || undefined}
                  fill={paint.fill}
                  // style, nie atrybut - var() w atrybutach prezentacyjnych
                  // SVG nie jest wspierany wszędzie.
                  style={{ fill: paint.style }}
                  fillRule="evenodd"
                  tabIndex={0}
                  role="img"
                  // nameOf, nie c.pl/c.en wprost: zasób geometrii bywa
                  // niepełny, a etykieta to JEDYNY kanał dostępu do tego
                  // regionu na obrazku - bez fallbacku czytnik ogłaszał
                  // "wartość bez podmiotu". Tabela i tooltip idą tą samą
                  // drogą, więc nazwa jest wszędzie ta sama.
                  aria-label={`${nameOf(c.id)}: ${formatValue(value)}`}
                  {...handlers(c.id, true)}
                  onFocus={(e) => onFocus(e, c.id)}
                  onBlur={() => setFocused((a) => (a !== null && a.id === c.id ? null : a))}
                />
              );
            })}
        </g>
        {outlined.length > 0 && (
          // Najpierw WSZYSTKIE halo, potem wszystkie tusze: przy dwóch
          // sąsiadach (fokus i wskazanie) halo drugiego nie zamaluje tuszu
          // pierwszego na wspólnej granicy.
          <g className="neh-map-outline" data-outline={outlinedIds.join(" ")} aria-hidden="true">
            {outlined.map((shape) => (
              <path
                key={`halo-${shape.id}`}
                d={shape.d}
                fillRule="evenodd"
                className="neh-map-outline-halo"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {outlined.map((shape) => (
              <path
                key={`ink-${shape.id}`}
                d={shape.d}
                fillRule="evenodd"
                className="neh-map-outline-ink"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}
      </svg>
    );
  } else {
    drawing = (
      <div
        aria-hidden
        className="skeleton-shimmer absolute inset-0 rounded-lg"
        style={{ opacity: 0.6 }}
      />
    );
  }

  return (
    <div ref={widthRef} className="w-full">
      <div
        data-chart-canvas
        className="neh-map-canvas relative w-full"
        style={
          maxHeight === undefined
            ? { height: mapHeight }
            : { height: mapHeight, width: drawWidth, marginInline: "auto" }
        }
      >
        {drawing}
        <ChartTooltip
          visible={tip !== null}
          x={shown?.x ?? 0}
          y={shown?.y ?? 0}
          containerWidth={drawWidth}
          title={shown !== null ? nameOf(shown.id) : ""}
          rows={tip?.rows ?? []}
          facts={tip?.facts ?? []}
          source={tip?.source ?? null}
        />
      </div>
    </div>
  );
}
