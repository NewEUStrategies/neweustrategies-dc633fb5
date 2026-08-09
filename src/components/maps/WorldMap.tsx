// Mapa świata z animowanymi łukami połączeń.
//
// WIERNE ODWZOROWANIE komponentu źródłowego (`WorldMap` z framer-motion +
// dotted-map + next-themes + next/image) na stos TEGO repozytorium. Zachowane
// 1:1: kontrakt propsów (`dots`, `lineColor`, `showLabels`, `labelClassName`,
// `animationDuration`, `loop`), rzut równoodległościowy `projectPoint`, łuk
// `createCurvedPath` (wierzchołek 50 px nad wyższym końcem), stagger 0.3 s,
// pauza 2 s i klatki `startTime` / `endTime` / `resetTime`, gradient wygaszający
// końce linii, podwójny znacznik (pełna kropka + pulsujący pierścień), etykiety
// przy punktach oraz dymek nazwy lokalizacji na dole.
//
// CZYM SIĘ RÓŻNI WYKONANIE (i dlaczego - to nie jest swoboda artystyczna):
//   * `framer-motion` -> animacje CSS. Biblioteki nie ma w projekcie i nie
//     wchodzi (ta sama decyzja co w `profile-card.tsx` i `circular-carousel.tsx`).
//     `pathLength: 0 -> 1` odtwarza `pathLength="1"` + `stroke-dashoffset`,
//     a `times` z pierwowzoru stają się procentami w `@keyframes`
//     (rachunek w `lib/maps/worldMapGeo.ts` - jedno źródło prawdy, testowalne).
//   * `dotted-map` -> statyczna maska `public/geo/world-dots.v1.svg` liczona
//     przy budowie (scripts/generate-dotted-world.ts). Doktryna repo: geometria
//     nie podróżuje w bundlu JS. Maska + `background-color` dają pełną kontrolę
//     koloru kropek (motyw ORAZ kolor z panelu) przy jednym pliku.
//   * `next-themes` -> ŻADNEGO odczytu motywu w JS. Pierwowzór przełączał kolory
//     ręcznie (`theme === "dark" ? … : …`), co w tym repozytorium byłoby krokiem
//     wstecz: kolory idą z tokenów (`--foreground`, `--brand`, `--background`),
//     które motyw podmienia sam - także w wymuszonym jasnym canvasie buildera,
//     gdzie hook motywu i tak zwróciłby wartość strony admina.
//   * `next/image` -> warstwa CSS (`mask-image`), więc zero requestów obrazu
//     w SSR i zero CLS.
//   * Znaczniki są DEDUPLIKOWANE po pozycji, a etykiety rozkładane na wiersze
//     (`resolveMarkers`): układ „centrala -> świat" powtarza ten sam początek
//     w każdym połączeniu, więc pierwowzór rysowałby N kropek i N napisów jeden
//     na drugim.
//
// Dostępność: SVG to `role="group"` z etykietą (nie `img` - punkty bywają
// linkami do profili, a wnętrze `role="img"` jest dla czytnika prezentacyjne),
// a KOMPLET połączeń jest dostępny jako lista tekstowa (`.sr-only`) - czytnik
// ekranu i wyszukiwarka dostają treść, nie tylko grafikę.
import { useId, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { safeUrl } from "@/lib/sanitize";
import {
  ARC_STAGGER_S,
  MAP_VIEW_H,
  MAP_VIEW_W,
  arcKeyframes,
  arcTiming,
  resolveArcs,
  resolveMarkers,
  type MapArc,
} from "@/lib/maps/worldMapGeo";

export type WorldMapLang = "pl" | "en";

const L = {
  pl: {
    alt: "Mapa świata z zaznaczonymi połączeniami",
    connections: "Połączenia na mapie",
    from: "z",
    to: "do",
    empty: "Brak połączeń do pokazania na mapie.",
  },
  en: {
    alt: "World map with highlighted connections",
    connections: "Map connections",
    from: "from",
    to: "to",
    empty: "No connections to display on the map.",
  },
} as const;

export interface WorldMapProps {
  /** Pary punktów (start -> koniec). Nazwa `dots` zachowana z pierwowzoru. */
  dots?: MapArc[];
  lineColor?: string;
  showLabels?: boolean;
  labelClassName?: string;
  /** Czas rysowania pojedynczego łuku w sekundach. */
  animationDuration?: number;
  loop?: boolean;
  /**
   * Wyłącznik całej animacji - dołożony ponad kontrakt pierwowzoru, bo KAŻDY
   * widget tego buildera ma w panelu przełącznik „Animacja wejścia", a mapa bez
   * niego byłaby jedynym, którego nie da się uspokoić. `false` rysuje komplet
   * łuków od razu (ten sam stan końcowy co po animacji).
   */
  animate?: boolean;
  /** Rozmiar etykiet w jednostkach viewBoxu (puste = klasa `labelClassName`). */
  labelSize?: number;
  /** Kolor kropek lądu; puste = półprzezroczysty kolor tekstu motywu. */
  dotColor?: string;
  /** Kolor znaczników punktów; puste = `lineColor`. */
  pointColor?: string;
  /** Tło płótna mapy; puste = przezroczyste (dziedziczy tło sekcji). */
  bgColor?: string;
  lang?: WorldMapLang;
  className?: string;
}

/** Domyślny akcent = token marki, więc mapa bez ustawień trzyma kolorystykę platformy. */
const DEFAULT_LINE_COLOR = "var(--brand)";

export function WorldMap({
  dots = [],
  lineColor = DEFAULT_LINE_COLOR,
  showLabels = true,
  labelClassName = "text-sm",
  animationDuration = 2,
  loop = true,
  animate = true,
  labelSize,
  dotColor = "",
  pointColor = "",
  bgColor = "",
  lang = "pl",
  className,
}: WorldMapProps) {
  const t = L[lang];
  const rawId = useId();
  // useId() zwraca ":r0:" - dwukropki są nielegalne w nazwie @keyframes
  // i w selektorze CSS, więc identyfikator instancji musi je stracić.
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const animated = animate && !reducedMotion;

  const arcs = useMemo(() => resolveArcs(dots), [dots]);
  // Znaczniki liczymy z punktów, nie z końców łuków: układ „centrala -> świat"
  // powtarza ten sam początek w każdym połączeniu.
  const markers = useMemo(() => resolveMarkers(arcs, labelSize), [arcs, labelSize]);
  const timing = useMemo(
    () => arcTiming(arcs.length, animationDuration),
    [arcs.length, animationDuration],
  );

  // Jedna reguła @keyframes na łuk - dokładnie te ułamki cyklu, które
  // pierwowzór podawał framer-motion jako `times`.
  const keyframesCss = useMemo(
    () =>
      animated
        ? arcs.map((_, i) => arcKeyframes(`nes-wm-${uid}-${i}`, i, timing, loop)).join("")
        : "",
    [animated, arcs, loop, timing, uid],
  );

  const markerColor = pointColor || lineColor;
  const gradientId = `nes-wm-grad-${uid}`;

  if (arcs.length === 0) {
    return (
      <div
        className={[
          "not-prose flex min-h-[160px] w-full items-center justify-center rounded-[6px]",
          "border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {t.empty}
      </div>
    );
  }

  return (
    <div
      className={["nes-world-map relative w-full", className ?? ""].filter(Boolean).join(" ")}
      style={
        {
          aspectRatio: `${MAP_VIEW_W} / ${MAP_VIEW_H}`,
          background: bgColor || undefined,
          "--nes-wm-dot": dotColor || "color-mix(in oklab, var(--foreground) 25%, transparent)",
        } as React.CSSProperties
      }
    >
      {keyframesCss && <style>{keyframesCss}</style>}

      {/* Warstwa kropek lądu: maska CSS zamiast <img>, więc kolor jest sterowalny. */}
      <div className="nes-world-map__dots" aria-hidden="true" />

      {/* `role="group"` (nie `img`): punkty bywają linkami do profili, a wewnątrz
          `role="img"` całe wnętrze staje się dla czytnika prezentacyjne. Ten sam
          wzorzec co interaktywna choropleta w src/components/charts. */}
      <svg
        viewBox={`0 0 ${MAP_VIEW_W} ${MAP_VIEW_H}`}
        className="pointer-events-none absolute inset-0 h-full w-full select-none"
        role="group"
        aria-label={t.alt}
      >
        <defs>
          {/* Gradient wygaszający oba końce linii - jak w pierwowzorze. */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="5%" stopColor={lineColor} stopOpacity="1" />
            <stop offset="95%" stopColor={lineColor} stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        {arcs.map((arc, i) => (
          <path
            key={`path-${arc.key}`}
            d={arc.path}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="1"
            strokeLinecap="round"
            pathLength={1}
            className="nes-world-map__arc"
            style={
              animated
                ? {
                    animationName: `nes-wm-${uid}-${i}`,
                    animationDuration: `${loop ? timing.cycleS : animationDuration}s`,
                    animationDelay: loop ? "0s" : `${i * ARC_STAGGER_S}s`,
                    animationIterationCount: loop ? "infinite" : 1,
                    animationTimingFunction: loop ? "linear" : "ease-out",
                    animationFillMode: "forwards",
                  }
                : undefined
            }
          />
        ))}

        {markers.map(({ key, point, xy, labelDy }) => {
          const href = point.href ? safeUrl(point.href, "") : "";
          const marker = (
            <g
              className="nes-world-map__marker pointer-events-auto"
              onMouseEnter={() => setHoveredLocation(point.label ?? null)}
              onMouseLeave={() => setHoveredLocation(null)}
              onFocus={() => setHoveredLocation(point.label ?? null)}
              onBlur={() => setHoveredLocation(null)}
              tabIndex={!href && point.label ? 0 : undefined}
              role={!href && point.label ? "img" : undefined}
              aria-label={!href && point.label ? point.label : undefined}
            >
              <circle cx={xy.x} cy={xy.y} r="2" fill={markerColor} />
              <circle
                cx={xy.x}
                cy={xy.y}
                r="2"
                fill={markerColor}
                className="nes-world-map__pulse"
                style={animated ? undefined : { display: "none" }}
              />
              {showLabels && point.label && (
                // `labelSize` (kontrolka panelu) jedzie w `style`, bo klasa
                // typograficzna z `labelClassName` wygrałaby z atrybutem
                // `font-size` - suwak rozmiaru byłby wtedy martwy.
                <text
                  x={xy.x}
                  y={xy.y + labelDy}
                  textAnchor="middle"
                  className={`nes-world-map__label ${labelSize ? "" : labelClassName}`}
                  style={labelSize ? { fontSize: `${labelSize}px` } : undefined}
                  fill="currentColor"
                >
                  {point.label}
                </text>
              )}
            </g>
          );
          // Punkt z odsyłaczem (np. publiczny profil eksperta) jest linkiem,
          // więc trafia do kolejności tabulacji i czytnika ekranu jako link -
          // a nie jako grafika z podpowiedzią, której nie da się otworzyć.
          return href ? (
            <a key={key} href={href} aria-label={point.label || undefined}>
              {marker}
            </a>
          ) : (
            <g key={key}>{marker}</g>
          );
        })}
      </svg>

      {/* Dymek nazwy lokalizacji (na telefonie jedyny nośnik etykiety). */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"
        aria-hidden="true"
      >
        <span
          className={[
            "rounded-[6px] border border-border bg-card/90 px-2.5 py-1 text-xs font-medium",
            "text-foreground shadow-sm backdrop-blur transition-opacity duration-200",
            hoveredLocation ? "opacity-100" : "opacity-0",
          ].join(" ")}
        >
          {hoveredLocation ?? ""}
        </span>
      </div>

      {/* Kanał dostępności: pełna lista połączeń tekstem. */}
      <ul className="sr-only">
        <li>{t.connections}</li>
        {arcs.map((arc) => (
          <li key={`sr-${arc.key}`}>
            {t.from} {arc.start.label || `${arc.start.lat}, ${arc.start.lng}`} {t.to}{" "}
            {arc.end.label || `${arc.end.lat}, ${arc.end.lng}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
