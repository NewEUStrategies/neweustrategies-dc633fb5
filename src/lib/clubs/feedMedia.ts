// Kadrowanie zdjęć i nagrań w strumieniu klubu - czyste reguły, zero I/O.
//
// SKĄD TE LICZBY. Trzy formaty, które w sieciach zawodowych są standardem
// publikacji (stan na 2026), a więc formatami, w jakich członkowie klubu i tak
// przygotowują grafiki:
//   * poziomy  1200 x 627  (1.91:1) - wykresy, zrzuty dokumentów, podgląd linku,
//   * kwadrat  1080 x 1080 (1:1)    - grafiki z cytatem, zdjęcia z wydarzeń,
//   * pionowy  1080 x 1350 (4:5)    - najwięcej miejsca na telefonie.
// Rama pojedynczego zdjęcia mieści się więc między 4:5 a 1.91:1. Zdjęcie
// w tym przedziale pokazujemy BEZ kadrowania, zdjęcie lekko poza nim -
// kadrujemy (`cover`), a skrajne (panorama, zrzut długiej strony) wpisujemy
// w ramę bez obcinania (`contain`), bo w think tanku to częściej infografika
// niż fotografia i ucięta oś wykresu jest gorsza niż pasy po bokach.
//
// GALERIA UKŁADA SIĘ WEDŁUG PIERWSZEGO ZDJĘCIA. Poziome pierwsze bierze górny
// rząd, kwadratowe i pionowe - lewą kolumnę; pozostałe są miniaturami.
// Widać najwyżej cztery kafle, a nadwyżkę niesie licznik „+N" na ostatnim.
// Reguła jest jedna dla całej galerii, więc dwa wpisy z tym samym zestawem
// zdjęć zawsze wyglądają tak samo - niezależnie od kolejności dojazdu plików.

export type ClubPostImageFormat = "landscape" | "square" | "portrait";

/** Formaty zalecane przy publikacji - kolejność = kolejność w podpowiedzi. */
export const CLUB_POST_IMAGE_FORMATS: ReadonlyArray<{
  readonly key: ClubPostImageFormat;
  readonly width: number;
  readonly height: number;
  readonly ratio: string;
}> = [
  { key: "landscape", width: 1200, height: 627, ratio: "1.91:1" },
  { key: "square", width: 1080, height: 1080, ratio: "1:1" },
  { key: "portrait", width: 1080, height: 1350, ratio: "4:5" },
];

/** Najszersza rama strumienia (1.91:1). */
export const CLUB_FEED_RATIO_MAX = 1.91;
/** Najwyższa rama strumienia (4:5). */
export const CLUB_FEED_RATIO_MIN = 0.8;
/** Do tego stosunku kadrujemy; dalej wpisujemy bez obcinania. */
const CROP_TOLERANCE = 1.25;
/** Rama dla pliku bez metadanych: miejsce zarezerwowane, nic nie ucięte. */
const FALLBACK_RATIO = 16 / 9;

/**
 * Zalecana waga zdjęcia. Kubełek przyjmie 50 MB, ale zdjęcie powyżej 5 MB
 * w strumieniu tylko spowalnia ładowanie - to jest PODPOWIEDŹ, nie blokada.
 */
export const CLUB_POST_IMAGE_SOFT_BYTES = 5 * 1024 * 1024;

/** Najwięcej kafli galerii widocznych na karcie - reszta to „+N". */
export const CLUB_GALLERY_MAX_TILES = 4;

export interface ClubMediaSize {
  readonly width: number | null;
  readonly height: number | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Proporcja szerokość / wysokość albo `null`, gdy metadane są niepełne. */
export function clubMediaRatio(size: ClubMediaSize): number | null {
  const { width, height } = size;
  if (width === null || height === null) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return width / height;
}

/** Najbliższy z trzech zalecanych formatów - albo `null` bez metadanych. */
export function clubImageFormat(size: ClubMediaSize): ClubPostImageFormat | null {
  const ratio = clubMediaRatio(size);
  if (ratio === null) return null;
  if (ratio >= 1.25) return "landscape";
  if (ratio <= 0.9) return "portrait";
  return "square";
}

export interface ClubFeedFrame {
  /** Proporcja RAMY (nie pliku) - trafia wprost do `aspect-ratio`. */
  readonly ratio: number;
  /** `cover` = lekkie kadrowanie, `contain` = całość z pasami tła. */
  readonly fit: "cover" | "contain";
}

/** Rama pojedynczego zdjęcia lub nagrania w strumieniu. */
export function clubFeedFrame(size: ClubMediaSize): ClubFeedFrame {
  const ratio = clubMediaRatio(size);
  if (ratio === null) return { ratio: FALLBACK_RATIO, fit: "contain" };
  const framed = clamp(ratio, CLUB_FEED_RATIO_MIN, CLUB_FEED_RATIO_MAX);
  const crop = Math.max(ratio / framed, framed / ratio);
  return { ratio: framed, fit: crop <= CROP_TOLERANCE ? "cover" : "contain" };
}

export type ClubGalleryLayout = "single" | "pair" | "top" | "left";

export interface ClubGalleryPlan {
  readonly layout: ClubGalleryLayout;
  /** Proporcja całej galerii (`single`, `pair`, `left`) albo kafla głównego (`top`). */
  readonly ratio: number;
  /** Ile kafli rysujemy (z kaflem głównym). */
  readonly visible: number;
  /** Ile zdjęć nie zmieściło się w galerii - licznik „+N" na ostatnim kaflu. */
  readonly overflow: number;
  /** Dopasowanie pojedynczego zdjęcia; galerie zawsze kadrują. */
  readonly fit: "cover" | "contain";
}

/** Proporcja rzędu miniatur pod kaflem głównym w układzie `top`. */
export const CLUB_GALLERY_STRIP_RATIO = 3;

/**
 * Plan galerii zdjęć wpisu. Dla pustej listy zwraca `null` - karta wtedy
 * w ogóle nie rysuje pasa mediów.
 */
export function planClubGallery(images: readonly ClubMediaSize[]): ClubGalleryPlan | null {
  const count = images.length;
  const first = images[0];
  if (count === 0 || first === undefined) return null;

  if (count === 1) {
    const frame = clubFeedFrame(first);
    return { layout: "single", ratio: frame.ratio, visible: 1, overflow: 0, fit: frame.fit };
  }

  if (count === 2) {
    // Dwa pionowe obok siebie zachowują 4:5 każdy; w każdym innym zestawie
    // kafle są kwadratowe - para różnych formatów musi mieć wspólną wysokość.
    const bothPortrait = images.every((image) => clubImageFormat(image) === "portrait");
    return {
      layout: "pair",
      ratio: bothPortrait ? 8 / 5 : 2,
      visible: 2,
      overflow: 0,
      fit: "cover",
    };
  }

  const visible = Math.min(count, CLUB_GALLERY_MAX_TILES);
  const overflow = count - visible;
  const firstRatio = clubMediaRatio(first);
  // Brak metadanych pierwszego zdjęcia traktujemy jak poziome: to bezpieczny
  // układ (szeroki kafel główny), a nie zgadywanie kolumny.
  if (firstRatio === null || firstRatio > 1.1) {
    return {
      layout: "top",
      ratio: clamp(firstRatio ?? FALLBACK_RATIO, 1.5, CLUB_FEED_RATIO_MAX),
      visible,
      overflow,
      fit: "cover",
    };
  }
  return {
    layout: "left",
    ratio: firstRatio <= 0.9 ? 6 / 5 : 3 / 2,
    visible,
    overflow,
    fit: "cover",
  };
}

export type ClubImageAdvice = "lowResolution" | "heavy" | "extremeRatio";

/**
 * Uwagi do zdjęcia wybranego w kompozytorze. To są wskazówki jakości, a nie
 * walidacja - wpis z każdą z nich da się opublikować.
 */
export function clubImageAdvice(
  image: ClubMediaSize & { readonly size: number },
): ClubImageAdvice[] {
  const out: ClubImageAdvice[] = [];
  const format = clubImageFormat(image);
  if (format !== null && image.width !== null) {
    const recommended = CLUB_POST_IMAGE_FORMATS.find((item) => item.key === format);
    if (recommended !== undefined && image.width < recommended.width) out.push("lowResolution");
  }
  if (image.size > CLUB_POST_IMAGE_SOFT_BYTES) out.push("heavy");
  if (clubMediaRatio(image) !== null && clubFeedFrame(image).fit === "contain") {
    out.push("extremeRatio");
  }
  return out;
}
