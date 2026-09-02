// Interaktywna mapa danych (choropleta) Europy / świata.
//
// Geometria NIE podróżuje w bundlu JS: pre-projektowane ścieżki SVG leżą w
// public/geo/*.v1.json (generator: scripts/generate-geo-maps.ts) i są
// dociągane fetchem + cache'owane przez CDN i React Query. Nazwy krajów
// (PL/EN) są wbudowane w zasób, więc klient nie ładuje żadnych locale.
//
// Kodowanie wartości: ramp sekwencyjny jednego odcienia (--chart-seq-min ->
// --chart-seq-max, w trybie ciemnym odwrócony kotwicą) przez color-mix() -
// automatycznie poprawny w dark mode i wymuszonym jasnym canvasie buildera.
// Fallback dla starszych przeglądarek: hex interpolowany w JS z pary tego
// samego motywu (SEQ_HEX), więc ramp awaryjny idzie w tę samą stronę co
// tokenowy.
// Kraje bez danych: neutralne --muted. Tooltip + tabela niosą pełne wartości.
//
// SSR: rama + tabela danych renderują się na serwerze (crawler widzi liczby);
// sam SVG dogrywa się po stronie klienta w miejsce shimmera o stałym aspekcie.
import { useMemo, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DataMapConfig, MapRegion } from "@/lib/charts/types";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
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

/** Aspekt viewBoxu wygenerowanych zasobów - trzymać w zgodzie z generatorem. */
const REGION_ASPECT: Record<MapRegion, number> = {
  world: 427 / 960,
  europe: 825 / 960,
};

/**
 * Fallback hex dla przeglądarek bez color-mix() - PARA hexów na motyw,
 * trzymana w zgodzie z --chart-seq-min / --chart-seq-max w src/styles.css.
 * Jedna para (jasna) dawałaby w trybie ciemnym ramp ODWRÓCONY względem
 * tokenowego: najniższa wartość świeciłaby na ciemnej karcie, a najwyższa
 * gasła poniżej progu 3:1 dla obiektu graficznego.
 */
const SEQ_HEX = {
  light: { min: "#cde2fb", max: "#0d366b" },
  dark: { min: "#16273f", max: "#86b6ef" },
} as const;

/**
 * Motyw czytany z klasy na <html> - tej samej, którą ustawia ThemeProvider
 * (i skrypt przedhydracyjny w __root.tsx). Fallback liczy się przy renderze
 * SVG, a ten dogrywa się WYŁĄCZNIE po hydracji, więc SSR nigdy nie zgaduje
 * motywu i nie ma czego rozjechać. W przeglądarkach z color-mix() wypełnienie
 * i tak bierze `style` (wygrywa nad atrybutem) i jedzie samymi tokenami.
 */
function seqHexPair(): { min: string; max: string } {
  if (typeof document === "undefined") return SEQ_HEX.light;
  return document.documentElement.classList.contains("dark") ? SEQ_HEX.dark : SEQ_HEX.light;
}

function hexLerp(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
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

  const valueById = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of config.values) m.set(v.id, v.value);
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

  if (config.values.length === 0) {
    return (
      <div
        className={`not-prose my-6 rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t.empty}
      </div>
    );
  }

  const aspect = REGION_ASPECT[config.region];
  const mapHeight = Math.round(width * aspect);
  const seqHex = seqHexPair();

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

  const activeValue = active !== null ? valueById.get(active.id) : undefined;

  return (
    <ChartFrame
      title={config.title}
      description={config.description}
      source={config.source}
      lang={lang}
      legend={[]}
      showLegend={false}
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
                  .filter((c) => !valueById.has(c.id))
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
                  .filter((c) => valueById.has(c.id))
                  .map((c) => {
                    const value = valueById.get(c.id) as number;
                    // 0.15 dolnej kotwicy: najniższa wartość wciąż odróżnia
                    // się od krajów bez danych.
                    const share = 0.15 + 0.85 * (span > 0 ? (value - min) / span : 0);
                    const pct = Math.round(share * 100);
                    return (
                      <path
                        key={c.id}
                        d={c.d}
                        className="neh-country"
                        data-active={active?.id === c.id || undefined}
                        fill={hexLerp(seqHex.min, seqHex.max, share)}
                        style={{
                          fill: `color-mix(in oklab, var(--chart-seq-max) ${pct}%, var(--chart-seq-min))`,
                        }}
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

        {/* Legenda sekwencyjna: gradient min -> max. Przy zdegenerowanej
            domenie (jeden region albo wszystkie wartości równe) nie ma czego
            rozciągać - zostaje jedna próbka w kolorze, który te regiony
            faktycznie dostały (dolna kotwica, 15% rampy), i JEDNA liczba.
            Gradient z drugą granicą obiecywałby zakres, w którym nikogo nie
            ma. */}
        {config.showLegend && (
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
                  ? "color-mix(in oklab, var(--chart-seq-max) 15%, var(--chart-seq-min))"
                  : "linear-gradient(to right, color-mix(in oklab, var(--chart-seq-max) 15%, var(--chart-seq-min)), var(--chart-seq-max))",
              }}
            />
            {!singleValue && (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatChartValue(max, lang, config.unit)}
              </span>
            )}
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
