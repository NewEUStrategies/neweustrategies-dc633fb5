// Explorer stanowisk państw członkowskich UE dla dossier trackera.
//
// Wzorzec "EU Coalition Explorer" (ECFR): mapa choropletowa Europy koduje
// stanowisko każdego państwa (za / przeciw / podzielone / brak stanowiska)
// kolorem kategorycznym z palety wykresów. Geometria NIE podróżuje w bundlu -
// współdzielimy pre-projektowany zasób public/geo/europe-50m.v1.json
// z ChoroplethMap (fetch + cache React Query, ISO2 = klucz kraju).
//
// Dostępność jak w ChoroplethMap: kraje ze stanowiskiem są fokusowalne
// (tooltip na focus), a pełne wartości niesie przełączana tabela ChartFrame -
// tooltip nigdy nie jest jedyną drogą do danych. SSR renderuje ramę + tabelę,
// SVG dogrywa się po hydracji w miejsce shimmera o stałym aspekcie.
import { useMemo, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { geoAssetQueryOptions } from "@/lib/charts/geoQuery";
import { ChartFrame, CHART_TABLE_CLS } from "@/components/charts/ChartFrame";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { useContainerWidth } from "@/hooks/useContainerWidth";
import {
  euCountryName,
  stanceLabel,
  stanceMeta,
  STANCE_META,
  type PositionStance,
} from "@/lib/tracker/euCountries";
import type { PolicyPosition } from "@/lib/tracker/queries";

const L = {
  pl: {
    stance: "Stanowisko",
    country: "Państwo",
    note: "Nota",
    loadError: "Nie udało się wczytać mapy.",
  },
  en: {
    stance: "Position",
    country: "Country",
    note: "Note",
    loadError: "Map failed to load.",
  },
} as const;

/** Aspekt viewBoxu zasobu europe - trzymać w zgodzie z generatorem map. */
const EUROPE_ASPECT = 825 / 960;

interface PolicyPositionsMapProps {
  positions: PolicyPosition[];
  lang: "pl" | "en";
  title: string;
  description?: string;
  className?: string;
}

interface ActiveCountry {
  code: string;
  x: number;
  y: number;
}

/** Porządek sortowania tabeli: za -> przeciw -> podzielone -> brak. */
const STANCE_ORDER: Record<PositionStance, number> = {
  support: 0,
  oppose: 1,
  mixed: 2,
  undecided: 3,
};

export function PolicyPositionsMap({
  positions,
  lang,
  title,
  description,
  className,
}: PolicyPositionsMapProps) {
  const t = L[lang];
  const { ref: widthRef, width } = useContainerWidth<HTMLDivElement>(720);
  const [active, setActive] = useState<ActiveCountry | null>(null);

  const geo = useQuery({
    ...geoAssetQueryOptions("europe"),
    enabled: typeof window !== "undefined",
  });

  const byCountry = useMemo(() => {
    const m = new Map<string, PolicyPosition>();
    for (const p of positions) m.set(p.country_code, p);
    return m;
  }, [positions]);

  const counts = useMemo(() => {
    const c: Record<PositionStance, number> = { support: 0, oppose: 0, mixed: 0, undecided: 0 };
    for (const p of positions) {
      const key = stanceMeta(p.stance).key;
      c[key] += 1;
    }
    return c;
  }, [positions]);

  if (positions.length === 0) return null;

  const mapHeight = Math.round(width * EUROPE_ASPECT);

  const noteOf = (p: PolicyPosition): string | null => {
    const note = lang === "en" ? p.note_en || p.note_pl : p.note_pl || p.note_en;
    return note?.trim() ? note.trim() : null;
  };

  const onPointerMove = (e: PointerEvent<SVGPathElement>, code: string) => {
    const host = e.currentTarget.ownerSVGElement?.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setActive({ code, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const sorted = [...positions].sort((a, b) => {
    const byStance =
      STANCE_ORDER[stanceMeta(a.stance).key] - STANCE_ORDER[stanceMeta(b.stance).key];
    if (byStance !== 0) return byStance;
    return euCountryName(a.country_code, lang).localeCompare(
      euCountryName(b.country_code, lang),
      lang,
    );
  });

  const table = (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t.country}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t.stance}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t.note}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.country_code}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {euCountryName(p.country_code, lang)}
            </th>
            <td className={CHART_TABLE_CLS.td}>{stanceLabel(p.stance, lang)}</td>
            <td className={CHART_TABLE_CLS.td}>{noteOf(p) ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const activePosition = active ? byCountry.get(active.code) : undefined;
  const activeNote = activePosition ? noteOf(activePosition) : null;

  return (
    <ChartFrame
      title={title}
      description={description ?? ""}
      source=""
      lang={lang}
      legend={[]}
      showLegend={false}
      table={table}
      className={className}
    >
      {/* Legenda kategoryczna z licznikami - zawsze widoczna (4 kategorie). */}
      <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5" role="list">
        {STANCE_META.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: s.hex, background: s.cssVar }}
            />
            {lang === "en" ? s.en : s.pl}
            <span className="tabular-nums">({counts[s.key]})</span>
          </li>
        ))}
      </ul>

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
            role="group"
            aria-label={title || undefined}
            className="block"
          >
            <g className="neh-map-countries">
              {/* Tło: kraje bez stanowiska (w tym spoza UE). */}
              {geo.data.countries
                .filter((c) => !byCountry.has(c.id))
                .map((c) => (
                  <path
                    key={c.id}
                    d={c.d}
                    className="neh-country"
                    style={{ fill: "var(--secondary)" }}
                    fillRule="evenodd"
                  >
                    <title>{lang === "en" ? c.en : c.pl}</title>
                  </path>
                ))}
              {geo.data.countries
                .filter((c) => byCountry.has(c.id))
                .map((c) => {
                  const position = byCountry.get(c.id)!;
                  const meta = stanceMeta(position.stance);
                  return (
                    <path
                      key={c.id}
                      d={c.d}
                      className="neh-country"
                      data-active={active?.code === c.id || undefined}
                      fill={meta.hex}
                      style={{ fill: meta.cssVar }}
                      fillRule="evenodd"
                      tabIndex={0}
                      role="img"
                      aria-label={`${euCountryName(c.id, lang)}: ${stanceLabel(position.stance, lang)}`}
                      onPointerMove={(e) => onPointerMove(e, c.id)}
                      onPointerLeave={() => setActive(null)}
                      onFocus={(e) => {
                        const box = e.currentTarget.getBBox();
                        const svg = e.currentTarget.ownerSVGElement;
                        const vb = svg?.viewBox.baseVal;
                        if (!vb || vb.width === 0) return;
                        const scale = width / vb.width;
                        setActive({
                          code: c.id,
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
          visible={active !== null && activePosition !== undefined}
          x={active?.x ?? 0}
          y={active?.y ?? 0}
          containerWidth={width}
          title={active ? euCountryName(active.code, lang) : ""}
          rows={
            activePosition
              ? [
                  {
                    name: t.stance,
                    colorSlot: null,
                    value: stanceLabel(activePosition.stance, lang),
                  },
                  ...(activeNote
                    ? [
                        {
                          name: t.note,
                          colorSlot: null,
                          value:
                            activeNote.length > 140 ? `${activeNote.slice(0, 137)}…` : activeNote,
                        },
                      ]
                    : []),
                ]
              : []
          }
        />
      </div>
    </ChartFrame>
  );
}
