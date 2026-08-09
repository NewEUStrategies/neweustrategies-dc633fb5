// Mapa świata z animowanymi łukami połączeń.
//
// WIERNE ODWZOROWANIE komponentu źródłowego (`WorldMap` z framer-motion +
// dotted-map + next-themes + next/image) na stos TEGO repozytorium. Zachowane
// 1:1: kontrakt propsów (`dots`, `lineColor`, `showLabels`, `labelClassName`,
// `animationDuration`, `loop`), rzut równoodległościowy `projectPoint`, łuk
// `createCurvedPath` (wierzchołek 50 px nad wyższym końcem), stagger 0,3 s,
// pauza 2 s i klatki `startTime` / `endTime` / `resetTime`, gradient wygaszający
// końce linii, znacznik z pulsem oraz etykiety punktów jako WARSTWA HTML nad
// SVG (pierwowzór też rysuje je HTML-em, nie tekstem SVG).
//
// CZYM SIĘ RÓŻNI WYKONANIE (i dlaczego - to nie jest swoboda artystyczna):
//   * `framer-motion` -> animacje CSS. Biblioteki nie ma w projekcie i nie
//     wchodzi (ta sama decyzja co w `profile-card.tsx` i `circular-carousel.tsx`).
//     `pathLength: 0 -> 1` odtwarza `pathLength="1"` + `stroke-dashoffset`,
//     a `times` z pierwowzoru stają się procentami w `@keyframes`
//     (rachunek w `lib/maps/worldMapGeo.ts` - jedno źródło prawdy, testowalne).
//   * `dotted-map` -> statyczna maska `public/geo/world-dots.v1.svg` liczona
//     przy budowie (scripts/generate-dotted-world.ts). Doktryna repo: geometria
//     nie podróżuje w bundlu JS. Maska siedzi WEWNĄTRZ SVG (`<mask>` +
//     `<image>`), więc kadrowanie przycina ją razem z resztą rysunku, a kolor
//     kropek daje prostokąt pod maską - jeden plik na każdy motyw i kolor.
//   * `next-themes` -> ŻADNEGO odczytu motywu w JS. Pierwowzór przełączał kolory
//     ręcznie (`theme === "dark" ? … : …`), co tutaj byłoby krokiem wstecz:
//     kolory idą z tokenów (`--foreground`, `--brand`, `--card`), które motyw
//     podmienia sam - także w wymuszonym jasnym canvasie buildera.
//   * `next/image` -> `<image>` w masce SVG: zero CLS, zero warstw pozycjonowanych
//     „na oko" nad obrazkiem.
//
// CO DOŁOŻONE PONAD PIERWOWZÓR (i dlaczego mapa bez tego nie wygląda dobrze):
//   * KADR (`fit`). Świat z czterema stolicami Europy to w 85% pusty ocean,
//     a treść siedzi w rogu. Kadr dopasowany do punktów robi z tego kompozycję.
//   * SKALA OPTYCZNA. Kadrowanie powiększa wszystko, więc grubości linii,
//     promienie znaczników i długości „iskry" są mnożone przez `opticalScale`,
//     żeby na ekranie wyglądały tak samo w każdym zbliżeniu.
//   * WARSTWY ŁUKU: szeroka poświata + cienki rdzeń + biegnąca iskra. Pojedyncza
//     kreska 1 px czyta się jak szkic, nie jak trasa.
//   * DEDUPLIKACJA znaczników i rozkładanie etykiet na wiersze - układ
//     „centrala -> świat" powtarza ten sam początek w każdym połączeniu, więc
//     pierwowzór rysowałby N kropek i N napisów jeden na drugim.
//
// Dostępność: SVG to `role="group"` z etykietą (nie `img` - punkty bywają
// linkami do profili, a wnętrze `role="img"` jest dla czytnika prezentacyjne),
// a KOMPLET połączeń jest dostępny jako lista tekstowa (`.sr-only`) - czytnik
// ekranu i wyszukiwarka dostają treść, nie tylko grafikę.
import { useId, useMemo, useState, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { safeUrl, safeImageUrl } from "@/lib/sanitize";
import {
  ARC_STAGGER_S,
  MAP_VIEW_H,
  MAP_VIEW_W,
  WORLD_DOTS_URL,
  arcKeyframes,
  arcTiming,
  fitViewBox,
  opticalScale,
  pointPercent,
  resolveArcs,
  resolveMarkers,
  sparkKeyframes,
  type MapArc,
  type MapFit,
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
   * widget tego buildera ma w panelu przełącznik animacji, a mapa bez niego
   * byłaby jedynym, którego nie da się uspokoić. `false` rysuje komplet łuków
   * od razu (ten sam stan końcowy co po animacji).
   */
  animate?: boolean;
  /** Kadr rysunku: dopasowany do punktów, cały świat albo Europa. */
  fit?: MapFit;
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
/** Domyślny kolor kropek lądu - ledwie widoczny raster, nigdy bohater kadru. */
const DEFAULT_DOT_COLOR = "color-mix(in oklab, var(--foreground) 22%, transparent)";

export function WorldMap({
  dots = [],
  lineColor = DEFAULT_LINE_COLOR,
  showLabels = true,
  labelClassName = "",
  animationDuration = 2,
  loop = true,
  animate = true,
  fit = "auto",
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
  const [hovered, setHovered] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const animated = animate && !reducedMotion;

  const arcs = useMemo(() => resolveArcs(dots), [dots]);
  const view = useMemo(
    () =>
      fitViewBox(
        arcs.flatMap((a) => [a.startPoint, a.endPoint]),
        fit,
      ),
    [arcs, fit],
  );
  // Skala optyczna: przy kadrze na Europę jednostka płótna jest ~3x większa na
  // ekranie, więc wszystkie grubości i promienie muszą się o tyle skurczyć.
  const k = opticalScale(view);
  // Znaczniki liczymy z punktów, nie z końców łuków; kadr wchodzi do środka,
  // bo od niego zależy, ile jednostek płótna zajmuje etykieta danej długości.
  const markers = useMemo(() => resolveMarkers(arcs, view), [arcs, view]);
  const timing = useMemo(
    () => arcTiming(arcs.length, animationDuration),
    [arcs.length, animationDuration],
  );

  // Jedna reguła @keyframes na łuk - dokładnie te ułamki cyklu, które
  // pierwowzór podawał framer-motion jako `times`.
  const keyframesCss = useMemo(
    () =>
      animated
        ? arcs
            .map(
              (_, i) =>
                arcKeyframes(`nes-wm-${uid}-${i}`, i, timing, loop) +
                sparkKeyframes(`nes-wms-${uid}-${i}`, i, timing, loop),
            )
            .join("")
        : "",
    [animated, arcs, loop, timing, uid],
  );

  const markerColor = pointColor || lineColor;
  const gradientId = `nes-wm-grad-${uid}`;
  const maskId = `nes-wm-mask-${uid}`;

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
          "--nes-wm-accent": lineColor,
        } as CSSProperties
      }
      onMouseLeave={() => setHovered(null)}
    >
      {keyframesCss && <style>{keyframesCss}</style>}

      <svg
        viewBox={`${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`}
        className="absolute inset-0 h-full w-full select-none"
        role="group"
        aria-label={t.alt}
      >
        <defs>
          {/* Gradient wygaszający oba końce linii - jak w pierwowzorze. */}
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="6%" stopColor={lineColor} stopOpacity="1" />
            <stop offset="94%" stopColor={lineColor} stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
          {/* Maska luminancji: białe kropki zasobu odsłaniają kolor prostokąta. */}
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={MAP_VIEW_W}
            height={MAP_VIEW_H}
          >
            <image
              href={WORLD_DOTS_URL}
              x="0"
              y="0"
              width={MAP_VIEW_W}
              height={MAP_VIEW_H}
              preserveAspectRatio="none"
            />
          </mask>
        </defs>

        {/* Warstwa kropek lądu. */}
        <rect
          x="0"
          y="0"
          width={MAP_VIEW_W}
          height={MAP_VIEW_H}
          fill={dotColor || DEFAULT_DOT_COLOR}
          mask={`url(#${maskId})`}
        />

        {arcs.map((arc, i) => {
          const arcAnimation: CSSProperties | undefined = animated
            ? {
                animationName: `nes-wm-${uid}-${i}`,
                animationDuration: `${loop ? timing.cycleS : animationDuration}s`,
                animationDelay: loop ? "0s" : `${i * ARC_STAGGER_S}s`,
                animationIterationCount: loop ? "infinite" : 1,
                animationTimingFunction: loop ? "linear" : "cubic-bezier(0.22, 0.61, 0.36, 1)",
                animationFillMode: "forwards",
              }
            : undefined;
          return (
            <g key={`arc-${arc.key}`} data-active={hovered === arc.key ? "true" : undefined}>
              {/* Poświata: ta sama ścieżka, szeroka i ledwie widoczna. Bez niej
                  linia jest płaska jak kreska ołówkiem. */}
              <path
                d={arc.path}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={3.2 * k}
                strokeLinecap="round"
                pathLength={1}
                className="nes-world-map__arc nes-world-map__arc--glow"
                style={arcAnimation}
              />
              <path
                d={arc.path}
                fill="none"
                stroke={`url(#${gradientId})`}
                strokeWidth={0.9 * k}
                strokeLinecap="round"
                pathLength={1}
                className="nes-world-map__arc"
                style={arcAnimation}
              />
              {/* Iskra: krótki odcinek biegnący wzdłuż trasy - to ona daje
                  wrażenie ruchu i kierunku połączenia. */}
              {animated && (
                <path
                  d={arc.path}
                  fill="none"
                  stroke={markerColor}
                  strokeWidth={1.6 * k}
                  strokeLinecap="round"
                  pathLength={1}
                  className="nes-world-map__spark"
                  style={{
                    animationName: `nes-wms-${uid}-${i}`,
                    animationDuration: `${loop ? timing.cycleS : animationDuration}s`,
                    animationDelay: loop ? "0s" : `${i * ARC_STAGGER_S}s`,
                    animationIterationCount: loop ? "infinite" : 1,
                    animationTimingFunction: "linear",
                    animationFillMode: "forwards",
                  }}
                />
              )}
            </g>
          );
        })}

        {markers.map(({ key, point, xy }) => {
          const href = point.href ? safeUrl(point.href, "") : "";
          const active = hovered === key;
          const marker = (
            <g
              className="nes-world-map__marker"
              data-active={active ? "true" : undefined}
              onMouseEnter={() => setHovered(key)}
              onFocus={() => setHovered(key)}
              onBlur={() => setHovered(null)}
              tabIndex={!href && point.label ? 0 : undefined}
              role={!href && point.label ? "img" : undefined}
              aria-label={!href && point.label ? point.label : undefined}
            >
              {/* Poświata pod znacznikiem - „światło" punktu, nie obwódka. */}
              <circle cx={xy.x} cy={xy.y} r={7.5 * k} fill={markerColor} opacity={0.16} />
              {animated && (
                <circle
                  cx={xy.x}
                  cy={xy.y}
                  r={3.4 * k}
                  fill="none"
                  stroke={markerColor}
                  strokeWidth={0.7 * k}
                  className="nes-world-map__pulse"
                />
              )}
              {/* Rdzeń jest PEŁNY, a odcina go od łuku pierścień w kolorze tła
                  karty - wcześniejszy jasny środek robił z kropki obwarzanek,
                  który przy tej wielkości czytał się jako pusty. */}
              <circle
                cx={xy.x}
                cy={xy.y}
                r={3 * k}
                fill={markerColor}
                stroke="var(--card)"
                strokeWidth={0.8 * k}
                className="nes-world-map__core"
              />
              {/* Niewidoczne pole trafień: kropka o promieniu 2 jednostek jest
                  celem 3-pikselowym - za małym dla kursora i dla palca. */}
              <circle cx={xy.x} cy={xy.y} r={9 * k} fill="transparent" />
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

      {/* Etykiety jako HTML nad SVG: nie skalują się z kadrem, mają prawdziwą
          szerokość (żadnego zgadywania metryk czcionki), platformowe 6px i mogą
          pokazać zdjęcie oraz rolę eksperta pobrane z profilu. */}
      {showLabels && (
        <div className="pointer-events-none absolute inset-0">
          {markers.map(({ key, point, xy, labelRow }) => {
            if (!point.label) return null;
            const pos = pointPercent(view, xy);
            if (pos.left < -5 || pos.left > 105 || pos.top < -5 || pos.top > 105) return null;
            const href = point.href ? safeUrl(point.href, "") : "";
            const avatar = safeImageUrl(point.avatar);
            const active = hovered === key;
            const chip = (
              <span
                className={[
                  "nes-world-map__chip",
                  labelClassName,
                  avatar ? "nes-world-map__chip--rich" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {avatar && <img src={avatar} alt="" loading="lazy" decoding="async" />}
                <span className="nes-world-map__chip-text">
                  <span className="nes-world-map__chip-name">{point.label}</span>
                  {point.role && <span className="nes-world-map__chip-role">{point.role}</span>}
                </span>
              </span>
            );
            const style: CSSProperties = {
              left: `${pos.left}%`,
              top: `${pos.top}%`,
              // Wiersz etykiety odsuwa napis od kropki - patrz `assignLabelRows`.
              "--nes-wm-row": labelRow,
            } as CSSProperties;
            return href ? (
              <a
                key={`label-${key}`}
                href={href}
                className="nes-world-map__label"
                style={style}
                data-active={active ? "true" : undefined}
                onMouseEnter={() => setHovered(key)}
                onFocus={() => setHovered(key)}
                onBlur={() => setHovered(null)}
                tabIndex={-1}
                aria-hidden="true"
              >
                {chip}
              </a>
            ) : (
              <span
                key={`label-${key}`}
                className="nes-world-map__label"
                style={style}
                data-active={active ? "true" : undefined}
                aria-hidden="true"
              >
                {chip}
              </span>
            );
          })}
        </div>
      )}

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
