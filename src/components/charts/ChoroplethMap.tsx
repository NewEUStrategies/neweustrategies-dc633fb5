// Interaktywna mapa danych (choropleta): Europa, świat i pięć kontynentów
// (lista regionów: `MAP_REGIONS` w `lib/charts/types.ts`).
//
// Geometria NIE podróżuje w bundlu JS: pre-projektowane ścieżki SVG leżą w
// public/geo/*.json (generator: scripts/generate-geo-maps.ts) i są
// dociągane fetchem + cache'owane przez CDN i React Query. Nazwy krajów
// (PL/EN) są wbudowane w zasób, więc klient nie ładuje żadnych locale.
//
// Kodowanie wartości: ramp sekwencyjny jednego odcienia (--chart-seq-min ->
// --chart-seq-max, w trybie ciemnym odwrócony kotwicą) przez color-mix() -
// automatycznie poprawny w dark mode i wymuszonym jasnym canvasie buildera.
// Fallback dla starszych przeglądarek: hex interpolowany w JS z pary tego
// samego motywu (SEQ_RAMP z modułu palety), więc ramp awaryjny idzie tymi
// samymi kotwicami, co tokenowy - zgodności pilnuje bramka palety.
// Kraje bez danych: neutralne --muted. Tooltip + tabela niosą pełne wartości.
//
// SSR: rama + tabela danych renderują się na serwerze (crawler widzi liczby);
// sam SVG dogrywa się po stronie klienta w miejsce migotki, której wysokość
// bierze się z aspektu startowego regionu (patrz `geoAspect.ts`).
import { useMemo, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DataMapConfig, MapDatum } from "@/lib/charts/types";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { mapAspect } from "@/lib/charts/geoAspect";
import {
  countryFill,
  manualLegend,
  rampFill,
  RAMP_FLOOR,
  type ThemeName,
} from "@/lib/charts/mapFill";
import { formatChartValue, type ChartLang } from "@/lib/charts/format";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartFrame, CHART_TABLE_CLS } from "./ChartFrame";
import { ChartTooltip } from "./ChartTooltip";

const L = {
  pl: {
    country: "Kraj",
    value: "Wartość",
    empty: "Brak danych mapy.",
    loadError: "Nie udało się wczytać mapy.",
  },
  en: {
    country: "Country",
    value: "Value",
    empty: "No map data.",
    loadError: "Map failed to load.",
  },
} as const;

/**
 * Motyw czytany z klasy na <html> - tej samej, którą ustawia ThemeProvider
 * (i skrypt przedhydracyjny w __root.tsx). Ścieżka awaryjna liczy się przy
 * renderze SVG, a ten dogrywa się WYŁĄCZNIE po hydracji, więc SSR nigdy nie
 * zgaduje motywu i nie ma czego rozjechać. W przeglądarkach z color-mix()
 * wypełnienie i tak bierze `style` (wygrywa nad atrybutem) i jedzie tokenami.
 *
 * Same kotwice i powierzchnie siedzą w module palety, nie w literałach tutaj.
 * Trzymane w tym pliku rozjechały się z arkuszem - arkusz miał
 * `#e0eaf2`/`#00375f`, a ścieżka awaryjna `#cde2fb`/`#0d366b` - i nikt tego
 * nie zauważył, bo nowa przeglądarka nigdy tej gałęzi nie wykonuje.
 */
function currentTheme(): ThemeName {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

interface DataMapProps {
  config: DataMapConfig;
  lang: ChartLang;
  className?: string;
}

interface ActiveCountry {
  id: string;
  x: number;
  y: number;
}

export function ChoroplethMap({ config, lang, className }: DataMapProps) {
  const t = L[lang];
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state: revealState } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<ActiveCountry | null>(null);

  const geo = useQuery({
    ...geoAssetQueryOptions(config.region),
    // Klient-only: SSR renderuje ramę + tabelę, SVG dogrywa się po hydracji
    // (duży zasób nie podróżuje w dehydratowanym cache'u).
    enabled: typeof window !== "undefined",
  });

  // Cały wpis, nie sama liczba: w trybie ręcznym wypełnienie bierze się
  // z `color` tego samego wiersza, więc rozbicie na dwie mapy znaczyłoby
  // tylko tyle, że da się je rozjechać.
  const datumById = useMemo(() => {
    const m = new Map<string, MapDatum>();
    for (const v of config.values) m.set(v.id, v);
    return m;
  }, [config.values]);

  // Domena rampy: WYŁĄCZNIE wartości z danych. Zdegenerowana rozpiętość
  // (jeden region albo wszystkie wartości równe) nie dostaje sztucznego
  // maksimum - dawne `hi = lo + 1` broniło dzielenia przez zero, ale ta
  // zmyślona jedynka wyciekała do legendy jako realna wartość. Dzielenie
  // rozbraja teraz `span` przy liczeniu odcienia, a legenda przy zerowej
  // rozpiętości pokazuje JEDNĄ wartość.
  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of config.values) {
      if (v.value < lo) lo = v.value;
      if (v.value > hi) hi = v.value;
    }
    if (lo === Infinity) return { min: 0, max: 0 };
    return { min: lo, max: hi };
  }, [config.values]);
  const span = max - min;
  const singleValue = span <= 0;

  // Mapa nazw zamiast .find() per wiersz tabeli/tooltip (176 krajów).
  const namesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of geo.data?.countries ?? []) {
      m.set(c.id, lang === "en" ? c.en || c.pl : c.pl || c.en);
    }
    return m;
  }, [geo.data, lang]);
  const nameOf = (id: string): string => namesById.get(id) ?? id;

  // Klucz legendy ręcznej. Liczony zawsze, nie tylko w swoim trybie: hook nie
  // może siedzieć za `if`, a koszt to przebiegnięcie listy krajów.
  const legendGroups = useMemo(() => manualLegend(config.values), [config.values]);

  if (config.values.length === 0) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  // Aspekt Z ZASOBU (jego `viewBox`), a nie ze stałej przepisanej
  // z generatora - dlaczego, tłumaczy nagłówek `geoAspect.ts`. Do czasu
  // dojechania zasobu (czyli pod migotką) wchodzi wartość startowa regionu.
  const aspect = mapAspect(config.region, geo.data);
  const mapHeight = Math.round(width * aspect);
  const theme = currentTheme();

  const onPointerMove = (e: PointerEvent<SVGPathElement>, id: string) => {
    const host = e.currentTarget.ownerSVGElement?.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setActive({ id, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const table = (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t.country}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t.value}
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
              <td className={CHART_TABLE_CLS.tdNum}>
                {formatChartValue(v.value, lang, config.unit)}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );

  const activeValue = active !== null ? datumById.get(active.id)?.value : undefined;

  return (
    <ChartFrame
      title={config.title}
      description={config.description}
      lang={lang}
      metric={null}
      legend={[]}
      showLegend={false}
      caption={{
        source: config.source,
        // Mapa-choropleta nie ma osi wartości, więc nie ma czego uciąć;
        // pozostałe pola podpisu przyjdą razem z rozszerzeniem konfiguracji
        // mapy o `n` i datę danych.
        sourceDate: "",
        unit: config.unit,
        sampleSize: null,
        zeroBaselineBroken: false,
        // Mapa nie liczy udziałów, więc nie ma sumy kontrolnej do zgłoszenia.
        shareSumMismatch: null,
        notesShows: "",
        notesSurprising: "",
        notesHidden: "",
      }}
      table={table}
      className={className}
    >
      <div ref={revealRef} className={revealClassName(revealState)}>
        <div ref={widthRef} className="relative w-full" style={{ height: mapHeight }}>
          {geo.isError ? (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-muted/30 text-sm text-muted-foreground">
              {t.loadError}
            </div>
          ) : geo.data ? (
            <svg
              width={width}
              height={mapHeight}
              viewBox={geo.data.viewBox}
              preserveAspectRatio="xMidYMid meet"
              // group (nie img): kraje z danymi są fokusowalne.
              role="group"
              aria-label={config.title || undefined}
              className="block"
            >
              <g className="neh-map-countries">
                {/* Najpierw kraje bez danych (tło), potem z danymi - obrys
                    aktywnego kraju nigdy nie chowa się pod sąsiadami. */}
                {geo.data.countries
                  .filter((c) => !datumById.has(c.id))
                  .map((c) => (
                    <path
                      key={c.id}
                      d={c.d}
                      className="neh-country"
                      // --secondary (nie --muted): w trybie ciemnym --muted ==
                      // kolor karty i kraje bez danych by znikały. style, nie
                      // atrybut - var() w atrybutach prezentacyjnych SVG nie
                      // jest wspierany wszędzie.
                      style={{ fill: "var(--secondary)" }}
                      fillRule="evenodd"
                    >
                      <title>{nameOf(c.id)}</title>
                    </path>
                  ))}
                {geo.data.countries
                  .filter((c) => datumById.has(c.id))
                  .map((c) => {
                    const datum = datumById.get(c.id) as MapDatum;
                    const value = datum.value;
                    const fill = countryFill(datum, {
                      mode: config.colorMode,
                      rampColor: config.rampColor,
                      min,
                      span,
                      theme,
                    });
                    return (
                      <path
                        key={c.id}
                        d={c.d}
                        className="neh-country"
                        data-active={active?.id === c.id || undefined}
                        fill={fill.attr}
                        style={{ fill: fill.style }}
                        fillRule="evenodd"
                        tabIndex={0}
                        role="img"
                        // nameOf, nie c.pl/c.en wprost: zasób geometrii bywa
                        // niepełny, a etykieta to JEDYNY kanał dostępu do tego
                        // regionu na obrazku - bez fallbacku czytnik ogłaszał
                        // "wartość bez podmiotu". Tabela i tooltip idą tą samą
                        // drogą, więc nazwa jest wszędzie ta sama.
                        aria-label={`${nameOf(c.id)}: ${formatChartValue(value, lang, config.unit)}`}
                        onPointerMove={(e) => onPointerMove(e, c.id)}
                        onPointerLeave={() => setActive(null)}
                        onFocus={(e) => {
                          const box = e.currentTarget.getBBox();
                          const svg = e.currentTarget.ownerSVGElement;
                          const vb = svg?.viewBox.baseVal;
                          if (!vb || vb.width === 0) return;
                          const scale = width / vb.width;
                          setActive({
                            id: c.id,
                            x: (box.x + box.width / 2) * scale,
                            y: (box.y + box.height / 2) * scale,
                          });
                        }}
                        onBlur={() => setActive(null)}
                      />
                    );
                  })}
              </g>
            </svg>
          ) : (
            <div
              aria-hidden
              className="skeleton-shimmer absolute inset-0 rounded-lg"
              style={{ opacity: 0.6 }}
            />
          )}

          <ChartTooltip
            visible={active !== null && activeValue !== undefined}
            x={active?.x ?? 0}
            y={active?.y ?? 0}
            containerWidth={width}
            title={active !== null ? nameOf(active.id) : ""}
            rows={
              active !== null && activeValue !== undefined
                ? [
                    {
                      name: config.unit.trim() || (lang === "en" ? "Value" : "Wartość"),
                      colorSlot: null,
                      value: formatChartValue(activeValue, lang, config.unit),
                    },
                  ]
                : []
            }
          />
        </div>

        {/* LEGENDA MÓWI TO, CO ROBI TRYB, i nie ma tu wspólnego wariantu.

            W trybie rampy kolor niesie WIELKOŚĆ, więc legendą jest gradient
            z dwiema liczbami. Przy zdegenerowanej domenie (jeden kraj albo
            wszystkie wartości równe) nie ma czego rozciągać: zostaje jedna
            próbka w kolorze, który te kraje faktycznie dostały (dolna
            kotwica), i JEDNA liczba - gradient z drugą granicą obiecywałby
            zakres, w którym nikogo nie ma.

            W trybie ręcznym kolor niesie PRZYNALEŻNOŚĆ, więc ten sam gradient
            byłby zwyczajnie nieprawdziwy: sugerowałby porządek tam, gdzie
            autor mógł pomalować Polskę i Portugalię jednym kolorem, bo należą
            do tej samej grupy, a nie dlatego, że mają podobne liczby.
            Legendą jest wtedy klucz: próbka i kraje, które ją dzielą. */}
        {config.showLegend &&
          (config.colorMode === "manual" ? (
            legendGroups.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 p-0 m-0 list-none">
                {legendGroups.map((g) => (
                  <li key={g.color} className="flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: g.color }}
                    />
                    <span className="text-muted-foreground">
                      {g.ids.map((id) => nameOf(id)).join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatChartValue(min, lang, config.unit)}
              </span>
              <span
                aria-hidden
                className={
                  singleValue ? "h-2 w-6 rounded-full" : "h-2 flex-1 max-w-[240px] rounded-full"
                }
                style={{
                  background: singleValue
                    ? rampFill(RAMP_FLOOR, config.rampColor, theme).style
                    : `linear-gradient(to right, ${rampFill(RAMP_FLOOR, config.rampColor, theme).style}, ${rampFill(1, config.rampColor, theme).style})`,
                }}
              />
              {!singleValue && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatChartValue(max, lang, config.unit)}
                </span>
              )}
            </div>
          ))}
      </div>
    </ChartFrame>
  );
}
