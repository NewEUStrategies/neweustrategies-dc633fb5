// Ruch KARTY PRELEGENTA: FLIP (First, Last, Invert, Play) na Web Animations API.
//
// PO CO WLASNY, A NIE BIBLIOTEKA. Wklejony wzorzec (naglowek profilu z 21st.dev)
// stoi na `framer-motion` i `layoutId`. Repozytorium swiadomie tej zaleznosci
// nie ma (patrz `.wd-*` i `.avg-*` w `styles.css`): dock po jej usunieciu
// schudl z 48,7 do 11,4 KB gzip. `layoutId` robi dokladnie to, co ponizej -
// mierzy element przed i po zmianie ukladu, a potem odgrywa roznice jako
// `transform` - wiec zamiast ~40 KB biblioteki jest tu kilkadziesiat linii.
//
// DLACZEGO WAAPI, A NIE KLASA CSS. Arkusz publiczny ma ponizej 2 KB zapasu
// budzetu (`publicCss`), a FLIP i tak musi policzyc przesuniecie w JS. Krzywa
// i czas siedza wiec tutaj, a nie w `styles.css`.
//
// CO SIE RUSZA. Wylacznie `transform` (skompozytowany), `border-radius`
// zdjecia i `height` karty. Wysokosc karty jest jedyna wlasnoscia ukladu: bez
// niej wiersz siatki skakalby o wysokosc zdjecia w pierwszej klatce. To jedna
// karta przez ~0,4 s PO kliknieciu - przesuniecia ukladu tuz po interakcji
// uzytkownika nie licza sie do CLS (`hadRecentInput`), a INP mierzy czas do
// PIERWSZEGO malowania, ktore FLIP daje w tej samej klatce.
//
// CZEGO TU NIE MA. Zadnego odczytu ukladu w renderze i zadnego `window` poza
// funkcjami wolanymi z obslugi zdarzen i `useLayoutEffect` - karta rysuje sie
// identycznie na serwerze i w pierwszym renderze klienta (hydratacja).

/** Czas ruchu - odpowiednik `duration: 0.4` wzorca (sprezyna osiada w nim). */
export const SPEAKER_CARD_MOTION_MS = 440;

/**
 * Sprezyna tlumiona (wspolczynnik 0,8, omega 18 rad/s) sprobkowana do
 * `linear()` - to ten sam charakter, co `type: "spring", bounce: 0.2` wzorca:
 * lekki przestrzal (~1,5%) i spokojne osiadanie, bez odbicia.
 */
export const SPEAKER_CARD_SPRING =
  "linear(0, 0.053, 0.176, 0.325, 0.474, 0.61, 0.724, 0.815, 0.884, 0.934, 0.969, 0.991, 1.005, 1.012, 1.015, 1.015, 1.014, 1.011, 1.009, 1.007, 1.005, 1.004, 1)";

/** Silnik bez `linear()` dostaje krzywa o tym samym charakterze (jak `--avg-spring`). */
export const SPEAKER_CARD_SPRING_FALLBACK = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Promien zdjec platformy - 6 px (spec zdjec profilowych). */
export const SPEAKER_CARD_RADIUS_PX = 6;

export interface FlipBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Krzywa ruchu dla biezacego silnika. Wolac z obslugi zdarzen, nie z renderu. */
export function speakerCardEasing(): string {
  try {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
      return CSS.supports("transition-timing-function", "linear(0, 1)")
        ? SPEAKER_CARD_SPRING
        : SPEAKER_CARD_SPRING_FALLBACK;
    }
  } catch {
    // Silnik bez `CSS.supports` - krzywa awaryjna.
  }
  return SPEAKER_CARD_SPRING_FALLBACK;
}

/**
 * Czy uzytkownik prosi o ograniczenie ruchu. Czytane W CHWILI klikniecia, a nie
 * w renderze: `matchMedia` nie istnieje na serwerze, a odczyt w renderze dalby
 * inny pierwszy rysunek klienta niz serwera.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function boxOf(element: Element | null | undefined): FlipBox | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function canAnimate(element: Element | null | undefined): element is HTMLElement {
  return (
    element !== null &&
    element !== undefined &&
    typeof (element as HTMLElement).animate === "function"
  );
}

const moved = (a: number, b: number): boolean => Math.abs(a - b) >= 0.5;

/**
 * Zdjecie: przesuniecie + JEDNORODNA skala z poprzedniego pudelka do nowego
 * (oba sa kwadratami, wiec obraz sie nie zniekszalca). Promien jest
 * kontr-skalowany: przy skali `s` promien CSS `6/s` daje na ekranie 6 px, wiec
 * rog nie „puchnie" w trakcie powiekszania.
 */
export function flipMediaKeyframes(first: FlipBox, last: FlipBox): Keyframe[] | null {
  if (last.width <= 0 || first.width <= 0) return null;
  const scale = first.width / last.width;
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (!moved(dx, 0) && !moved(dy, 0) && Math.abs(scale - 1) < 0.001) return null;
  const radius = SPEAKER_CARD_RADIUS_PX / scale;
  return [
    {
      transformOrigin: "0 0",
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      borderRadius: `${radius}px`,
    },
    {
      transformOrigin: "0 0",
      transform: "translate(0px, 0px) scale(1)",
      borderRadius: `${SPEAKER_CARD_RADIUS_PX}px`,
    },
  ];
}

/** Napis i przycisk: samo przesuniecie (rozmiar pisma sie nie zmienia). */
export function flipShiftKeyframes(first: FlipBox, last: FlipBox): Keyframe[] | null {
  const dx = first.left - last.left;
  const dy = first.top - last.top;
  if (!moved(dx, 0) && !moved(dy, 0)) return null;
  return [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0px, 0px)" }];
}

/** Wysokosc karty: z poprzedniej do nowej, zeby wiersz siatki nie skakal. */
export function flipHeightKeyframes(first: FlipBox, last: FlipBox): Keyframe[] | null {
  if (!moved(first.height, last.height)) return null;
  return [{ height: `${first.height}px` }, { height: `${last.height}px` }];
}

export function playKeyframes(
  element: Element | null | undefined,
  keyframes: Keyframe[] | null,
  easing: string,
): Animation | null {
  if (keyframes === null || !canAnimate(element)) return null;
  try {
    return element.animate(keyframes, { duration: SPEAKER_CARD_MOTION_MS, easing });
  } catch {
    return null;
  }
}

/**
 * Rozgrzewa duze zdjecie na ZAMIAR (najazd, fokus, dotyk) - zanim padnie
 * klikniecie. Karta zwinieta nie pobiera duzego kadru wcale, wiec siatka nie
 * placi transferem za zdjecia, ktorych nikt nie otworzy (LCP i dane mobilne).
 */
export function preloadImage(url: string | null): void {
  if (url === null || url === "" || typeof Image === "undefined") return;
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
  } catch {
    // Brak konstruktora obrazu (srodowisko bez DOM) - nic do rozgrzania.
  }
}
