/**
 * Jedno źródło prawdy dla geometrii pasów nagłówka.
 *
 * DLACZEGO KLASY, A NIE LICZBY. Repozytorium skaluje `root font-size` płynnie
 * między 1280 a 1920 px (patrz „Fluid desktop scaling" w `styles.css`), więc
 * `h-10` to 37,5 px przy 1280 px i 40 px dopiero przy 16 px roota. Rezerwa
 * zapisana jako stała liczba pikseli rozjeżdża się z elementem, który tę samą
 * wysokość bierze z `rem` - i różnica wraca jako CLS. Skoro szkielet, rezerwa
 * paska „na czasie" i sam pasek mają mieć IDENTYCZNE pudełko, dzielą tę samą
 * klasę, a nie tę samą liczbę.
 *
 * Moduł jest celowo bez zależności w runtime (same stałe i czyste funkcje,
 * importy wyłącznie typów), żeby mógł go importować i `HeaderSkeleton`,
 * i `TrendingTicker`, bez wiązania tych dwóch ze sobą.
 */
import type { LayoutStyle, LiveDirection } from "@/lib/views/tickerVariants";

/** Wysokość wewnętrznego pasa „na czasie" (`TrendingTicker`, wariant klasyczny). */
export const HEADER_TICKER_BAND_CLASS = "h-10";

/** Dolna krawędź paska „na czasie" - liczy się do jego wysokości w układzie. */
export const HEADER_TICKER_BORDER_CLASS = "border-b";

// ── PASEK „NA CZASIE" PER SKÓRKA ─────────────────────────────────────────────
//
// DLACZEGO MAPOWANIE, A NIE JEDNA KLASA. Do 2026-10-03 rezerwa paska (na czas
// ładowania wpisów) i pas szkieletu nagłówka miały ZAWSZE geometrię wariantu
// klasycznego (`h-10` + krawędź = 41 px), a skórki szklane są wyższe: poziomy
// marquee 57 px, taśma 59 px, pionowa rotacja 57 px przy jednym wierszu
// i 44 px więcej na każdy kolejny. Skutek był podwójny. Po pierwsze
// przesunięcie przy podmianie rezerwy na pasek (16-192 px w dół). Po drugie
// - gorzej - `Header.tsx` mierzy `--hdr-tt` z pudełka `.cms-trending`,
// a `styles.css` narzuca potem temu pudełku `height: var(--hdr-tt)`: jeśli
// pomiar złapał rezerwę, prawdziwy pasek wchodził do pudełka 41 px i był w nim
// PRZYCINANY, a chrome nie zmieniał rozmiaru, więc ResizeObserver nie miał
// czego zgłosić. Teraz rezerwa, szkielet i sam pasek biorą wysokość z TEGO
// SAMEGO mapowania niżej.
//
// DLACZEGO JAWNA WYSOKOŚĆ TAKŻE NA PRAWDZIWYM PASKU. Skórki szklane nie miały
// klasy wysokości - wysokość wynikała z arkusza wstrzykiwanego przez pasek
// (`.tt-glass { padding: 6px 0 }`, pigułki 28 px, okno kart `44px * wiersze`).
// Rezerwa i szkielet tego arkusza nie renderują, więc „ta sama klasa" była
// niemożliwa. Klasa niżej jest równa naturalnej wysokości treści (każdy jej
// składnik ma stałą wysokość), więc na pasku niczego nie zmienia - za to
// rezerwa i szkielet mogą ją powtórzyć co do znaku. Wyprowadzenie każdej
// liczby z arkusza pilnuje test (`TrendingTicker.test.tsx`).

/** Skórka silników szklanych - modyfikator `tt-skin--*` i `cms-trending--*`. */
export type TickerGlassSkin = "marquee" | "cards" | "ribbon" | "spotlight" | "tape" | "live";

/**
 * Silnik paska, czyli element niosący wysokość i reguła, z której ona wynika:
 *  - `band`    - układ klasyczny i plakietkowy: wewnętrzny pas `h-10`;
 *  - `marquee` - poziomy marquee szklany: `.tt-glass`;
 *  - `cards`   - pionowa rotacja szklana: `.tt-glass` z oknem na N wierszy.
 */
export type TickerEngine = "band" | "marquee" | "cards";

interface TickerLayoutFrame {
  /** Modyfikatory ramki - znaczniki układu w DOM, bez wpływu na wysokość. */
  readonly modifier: string;
  readonly skin: TickerGlassSkin | null;
  /** `byDirection` - silnik wybiera `liveDirection` (tylko `glassLive`). */
  readonly engine: TickerEngine | "byDirection";
}

/**
 * JEDNO mapowanie skórki na ramkę i silnik. `Record` po pełnej unii
 * `LayoutStyle`: nowa skórka bez wpisu tutaj nie przejdzie kontroli typów,
 * a test iteruje po `LAYOUT_STYLES`, więc nie przejdzie też w runtime.
 */
export const TICKER_LAYOUT_FRAMES: Readonly<Record<LayoutStyle, TickerLayoutFrame>> = {
  classic: { modifier: "cms-trending--classic", skin: null, engine: "band" },
  badge: { modifier: "cms-trending--badge", skin: null, engine: "band" },
  glassMarquee: {
    modifier: "cms-trending--glass cms-trending--marquee",
    skin: "marquee",
    engine: "marquee",
  },
  glassCards: {
    modifier: "cms-trending--glass cms-trending--cards",
    skin: "cards",
    engine: "cards",
  },
  glassRibbon: {
    modifier: "cms-trending--glass cms-trending--ribbon",
    skin: "ribbon",
    engine: "marquee",
  },
  glassSpotlight: {
    modifier: "cms-trending--glass cms-trending--spotlight",
    skin: "spotlight",
    engine: "cards",
  },
  glassTape: {
    modifier: "cms-trending--glass cms-trending--tape",
    skin: "tape",
    engine: "marquee",
  },
  glassLive: {
    modifier: "cms-trending--glass cms-trending--live",
    skin: "live",
    engine: "byDirection",
  },
};

/** `.tt-glass { padding: 6px 0 }` - pionowy oddech obu silników szklanych. */
export const TICKER_GLASS_PAD_PX = 6;
/** `.tt-glass-pill` / `.tt-glass-chip` - stała wysokość pigułki i etykiety. */
export const TICKER_GLASS_PILL_PX = 28;
/** `.tt-glass--cards .tt-glass-viewport` - `44px` na każdy wiersz okna. */
export const TICKER_CARD_ROW_PX = 44;
/** Najwięcej wpisów widocznych naraz (`visibleCount`, panel CMS: 1-5). */
export const TICKER_MAX_PER_VIEW = 5;

/**
 * Poziomy marquee: 2 x 6 px oddechu + pigułka 28 px + `py-2` taśmy
 * (2 x 0,5 rem). Część w `rem` jest celowa: `py-2` skaluje się z płynnym
 * `root font-size`, więc liczba w samych pikselach rozjechałaby się z paskiem
 * między 1280 a 1920 px.
 */
export const HEADER_TICKER_MARQUEE_BAND_CLASS = "h-[calc(40px+1rem)]";
/** Taśma (`tape`): to samo plus przerywana krawędź 1 px nad i pod taśmą. */
export const HEADER_TICKER_TAPE_BAND_CLASS = "h-[calc(42px+1rem)]";
/**
 * Pionowa rotacja: 2 x 6 px oddechu + 44 px na wiersz; indeks = wiersze - 1.
 * Klasy wypisane literalnie, bo skaner Tailwinda nie liczy szablonów.
 */
export const HEADER_TICKER_CARDS_BAND_CLASSES = [
  "h-[56px]",
  "h-[100px]",
  "h-[144px]",
  "h-[188px]",
  "h-[232px]",
] as const;

/** Ile wpisów pasek pokazuje naraz - ta sama reguła dla paska i rezerw. */
export function tickerPerView(visibleCount: number | undefined): number {
  return Math.max(1, Math.min(TICKER_MAX_PER_VIEW, Math.floor(visibleCount || 1)));
}

/**
 * Wiersze okna pionowej rotacji: `perView`, ale nie więcej niż wpisów. Bez
 * znanej liczby wpisów (rezerwa w trakcie ładowania, szkielet w zimnym
 * starcie) zakładamy pełne okno - to jedyne miejsce, w którym rezerwa może
 * jeszcze różnić się od paska, i tylko gdy wpisów jest mniej niż `perView`.
 */
export function tickerCardRows(perView: number, postCount?: number): number {
  const rows = postCount === undefined ? perView : Math.min(perView, postCount);
  return Math.max(1, Math.min(TICKER_MAX_PER_VIEW, rows));
}

export interface TickerBandGeometry {
  readonly engine: TickerEngine;
  readonly skin: TickerGlassSkin | null;
  /** Pełne klasy ramki: `cms-trending` + dolna krawędź + modyfikatory skórki. */
  readonly frameClass: string;
  /** Klasa wysokości elementu, który w danym silniku niesie wysokość pasa. */
  readonly bandClass: string;
  /** Wysokość nominalna całego pudełka (px przy root 16 px) z dolną krawędzią. */
  readonly nominalPx: number;
}

/**
 * Geometria paska dla skórki - JEDYNE źródło klas ramki i wysokości dla
 * `TrendingTicker`, jego rezerwy (`TickerHeightReserve`) i pasa w
 * `HeaderSkeleton`. Nieznana skórka (śmieci z bazy) schodzi do klasycznej,
 * dokładnie jak render paska.
 */
export function tickerBandGeometry(
  layoutStyle: LayoutStyle | undefined,
  { liveDirection = "vertical", rows = 1 }: { liveDirection?: LiveDirection; rows?: number } = {},
): TickerBandGeometry {
  const frame =
    (layoutStyle && Object.hasOwn(TICKER_LAYOUT_FRAMES, layoutStyle)
      ? TICKER_LAYOUT_FRAMES[layoutStyle]
      : undefined) ?? TICKER_LAYOUT_FRAMES.classic;
  const engine: TickerEngine =
    frame.engine === "byDirection"
      ? liveDirection === "horizontal"
        ? "marquee"
        : "cards"
      : frame.engine;
  // Wartości NOMINALNE (1 rem = 16 px) - dla testów i `headerSkeletonHeight`;
  // w układzie liczy się klasa, nie ta liczba.
  const rem = 16;
  const glassPad = 2 * TICKER_GLASS_PAD_PX;
  const marqueeTrack = TICKER_GLASS_PILL_PX + rem; // pigułka + `py-2` (2 x 0,5 rem)
  let bandClass: string;
  let bandPx: number;
  if (engine === "band") {
    bandClass = HEADER_TICKER_BAND_CLASS;
    bandPx = 2.5 * rem; // `h-10`
  } else if (engine === "cards") {
    const count = tickerCardRows(rows);
    bandClass = HEADER_TICKER_CARDS_BAND_CLASSES[count - 1];
    bandPx = glassPad + TICKER_CARD_ROW_PX * count;
  } else if (frame.skin === "tape") {
    bandClass = HEADER_TICKER_TAPE_BAND_CLASS;
    bandPx = glassPad + marqueeTrack + 2; // przerywana krawędź nad i pod taśmą
  } else {
    bandClass = HEADER_TICKER_MARQUEE_BAND_CLASS;
    bandPx = glassPad + marqueeTrack;
  }
  return {
    engine,
    skin: frame.skin,
    frameClass: `cms-trending ${HEADER_TICKER_BORDER_CLASS} ${frame.modifier}`,
    bandClass,
    nominalPx: bandPx + 1, // + `border-b`
  };
}

/**
 * Pudełko mobilnego paska nagłówka (`Header.tsx`, gałąź `lg:hidden`):
 * `px-4 py-3` + dolna krawędź. Wysokość bierze się z zawartości, więc pasuje
 * tylko razem z `HEADER_MOBILE_BAR_CONTENT_CLASS`.
 */
export const HEADER_MOBILE_BAR_BOX_CLASS = "px-4 py-3 border-b border-border bg-background";

/** Najwyższe dziecko mobilnego paska: przyciski `h-10` (lupa, motyw, menu). */
export const HEADER_MOBILE_BAR_CONTENT_CLASS = "h-10";
