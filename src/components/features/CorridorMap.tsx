// Mapa korytarzy transportowych/infrastrukturalnych - tło choropletowe
// (te same zasoby public/geo/*.v1.json co ChoroplethMap) z narysowanymi
// korytarzami (linie lon/lat rzutowane metadanymi `proj` zasobu) i markerami
// węzłowymi. Podświetlone kraje dostają akcent marki. Legenda korytarzy pod
// mapą; pełna lista korytarzy + węzłów w tabeli dostępności.
//
// SSR: rama renderuje się na serwerze; sam SVG (geometria) dogrywa po hydracji
// w miejsce shimmera o stałym aspekcie - identycznie jak w ChoroplethMap.
import { useMemo, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CorridorMapConfig, FeatureLang } from "@/lib/features/types";
import { pickBi } from "@/lib/features/types";
import type { MapRegion } from "@/lib/charts/types";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { makeGeoProjector, corridorPath, type Point2D } from "@/lib/features/geoProject";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import { useRevealOnScroll, revealClassName } from "@/hooks/useRevealOnScroll";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { FeatureFrame, FeatureDataTable, FEATURE_TABLE_CLS } from "./FeatureFrame";

const L = {
  pl: {
    empty: "Brak korytarzy do wyświetlenia.",
    loadError: "Nie udało się wczytać mapy.",
    corridor: "Korytarz",
    waypoints: "Węzły",
    node: "Węzeł",
    data: "Pokaż korytarze i węzły",
  },
  en: {
    empty: "No corridors to display.",
    loadError: "Map failed to load.",
    corridor: "Corridor",
    waypoints: "Waypoints",
    node: "Node",
    data: "Show corridors and nodes",
  },
} as const;

const REGION_ASPECT: Record<MapRegion, number> = {
  world: 427 / 960,
  europe: 825 / 960,
};

interface Props {
  config: CorridorMapConfig;
  lang: FeatureLang;
  className?: string;
}

interface ActiveMarker {
  label: string;
  x: number;
  y: number;
}

export function CorridorMap({ config, lang, className }: Props) {
  const t = L[lang];
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const { ref: revealRef, state } = useRevealOnScroll<HTMLDivElement>(config.animate);
  const [active, setActive] = useState<ActiveMarker | null>(null);

  const geo = useQuery({
    ...geoAssetQueryOptions(config.region),
    enabled: typeof window !== "undefined",
  });

  const highlight = useMemo(() => new Set(config.highlightCountries), [config.highlightCountries]);

  // Skala px-zasobu -> px-ekranu (viewBox ma stałą szerokość 960).
  const projector = useMemo(() => makeGeoProjector(geo.data?.proj), [geo.data?.proj]);

  if (config.corridors.length === 0 && config.markers.length === 0) {
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
  const viewW = geo.data ? Number(geo.data.viewBox.split(" ")[2]) || 960 : 960;

  const projectToScreen = (lat: number, lon: number): Point2D | null => {
    if (!projector) return null;
    const p = projector(lon, lat);
    const s = width / viewW;
    return { x: p.x * s, y: p.y * s };
  };

  const onMarkerMove = (e: PointerEvent<SVGCircleElement>, label: string) => {
    const host = e.currentTarget.ownerSVGElement?.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setActive({ label, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const table = (
    <div className="space-y-4">
      <table className={FEATURE_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" className={FEATURE_TABLE_CLS.th}>
              {t.corridor}
            </th>
            <th scope="col" className={FEATURE_TABLE_CLS.thNum}>
              {t.waypoints}
            </th>
          </tr>
        </thead>
        <tbody>
          {config.corridors.map((c, i) => (
            <tr key={i}>
              <th scope="row" className={`${FEATURE_TABLE_CLS.td} font-medium`}>
                <span
                  aria-hidden
                  className="mr-2 inline-block h-2 w-4 rounded-full align-middle"
                  style={{ background: `var(--chart-${c.colorSlot})` }}
                />
                {pickBi(c.name, lang)}
              </th>
              <td className={FEATURE_TABLE_CLS.tdNum}>{c.points.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {config.markers.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {config.markers.map((m, i) => (
            <li key={i}>
              <span className="font-medium text-foreground">{t.node}:</span> {pickBi(m.label, lang)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <FeatureFrame
      title={config.title}
      description={config.description}
      source={config.source}
      className={className}
      footer={<FeatureDataTable label={t.data}>{table}</FeatureDataTable>}
    >
      <div ref={revealRef} className={revealClassName(state)}>
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
              role="img"
              aria-label={config.title || undefined}
              className="block nes-corridor-map"
            >
              <g className="neh-map-countries">
                {geo.data.countries.map((c) => (
                  <path
                    key={c.id}
                    d={c.d}
                    className="neh-country"
                    style={{
                      fill: highlight.has(c.id)
                        ? "color-mix(in oklab, var(--brand) 22%, var(--secondary))"
                        : "var(--secondary)",
                    }}
                    fillRule="evenodd"
                  >
                    <title>{lang === "en" ? c.en : c.pl}</title>
                  </path>
                ))}
              </g>

              {/* Korytarze - rzutowane w układzie viewBoxu zasobu (bez skalowania
                  ekranowego: SVG sam skaluje viewBox do width/mapHeight). */}
              {projector && (
                <g className="nes-corridors" fill="none">
                  {config.corridors.map((c, i) => {
                    const pts = c.points.map((p) => projector(p.lon, p.lat));
                    const d = corridorPath(pts);
                    return (
                      <path
                        key={i}
                        d={d}
                        stroke={`var(--chart-${c.colorSlot})`}
                        strokeWidth={2}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                        className="nes-corridor-line nes-feature-reveal"
                        style={{ ["--nes-i" as string]: i }}
                      >
                        <title>{pickBi(c.name, lang)}</title>
                      </path>
                    );
                  })}
                </g>
              )}

              {/* Markery węzłów. */}
              {projector && (
                <g className="nes-markers">
                  {config.markers.map((m, i) => {
                    const p = projector(m.lon, m.lat);
                    return (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={4}
                        className="nes-marker"
                        vectorEffect="non-scaling-stroke"
                        tabIndex={0}
                        role="img"
                        aria-label={pickBi(m.label, lang)}
                        onPointerMove={(e) => onMarkerMove(e, pickBi(m.label, lang))}
                        onPointerLeave={() => setActive(null)}
                        onFocus={(e) => {
                          const box = e.currentTarget.getBBox();
                          const s = width / viewW;
                          setActive({ label: pickBi(m.label, lang), x: box.x * s, y: box.y * s });
                        }}
                        onBlur={() => setActive(null)}
                      >
                        <title>{pickBi(m.label, lang)}</title>
                      </circle>
                    );
                  })}
                </g>
              )}
            </svg>
          ) : (
            <div
              aria-hidden
              className="skeleton-shimmer absolute inset-0 rounded-lg"
              style={{ opacity: 0.6 }}
            />
          )}

          <ChartTooltip
            visible={active !== null}
            x={active?.x ?? 0}
            y={active?.y ?? 0}
            containerWidth={width}
            title={active?.label ?? ""}
            rows={active !== null ? [{ name: t.node, colorSlot: null, value: active.label }] : []}
          />
        </div>

        {/* Legenda korytarzy. */}
        {config.corridors.length > 0 && (
          <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {config.corridors.map((c, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-[3px] w-4 rounded-full"
                  style={{ background: `var(--chart-${c.colorSlot})` }}
                />
                <span className="text-xs text-muted-foreground">{pickBi(c.name, lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FeatureFrame>
  );
}
