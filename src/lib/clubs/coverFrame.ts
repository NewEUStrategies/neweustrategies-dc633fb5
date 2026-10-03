// Kadrowanie okładki klubu - JEDNO źródło dla każdej powierzchni, która ją rysuje.
//
// `clubs.cover_position_y` (0-100) zapisuje edytor w nagłówku klubu, ale przez
// pierwszą wersję czytał je wyłącznie `ClubHubIdentity`. Bramka dostępu, karta
// klubu zamkniętego, minisite, katalog i widżety buildera rysowały środek
// kadru, więc moderator dostawał toast „Kadrowanie zapisane", a osoba spoza
// klubu widziała inny fragment zdjęcia (np. ucięte twarze). Każda powierzchnia
// liczy teraz `object-position` tą samą funkcją, więc rozjazd wymagałby
// świadomego obejścia, a nie zapomnienia.
//
// Semantyka procentu jest ta sama w każdej proporcji ramki: przy
// `object-fit: cover` punkt Y% zdjęcia staje na Y% wysokości ramki. Dlatego
// jedno ustawienie daje spójny kadr na pasie 7:1 i na kaflu 16:9 - zmienia się
// tylko, ile zdjęcia wokół tego punktu mieści ramka.

/** Wartość kolumny dla klubu, którego nikt nie kadrował (DEFAULT w bazie). */
export const CLUB_COVER_DEFAULT_POSITION_Y = 50;

/**
 * Pozycja pionowa w zakresie 0-100, liczba całkowita. Wszystko, co nie jest
 * skończoną liczbą (brak kolumny w starym wierszu, `null`, NaN), schodzi do
 * środka - tak, jak wyglądała okładka przed wprowadzeniem kadrowania.
 */
export function normalizeClubCoverPositionY(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CLUB_COVER_DEFAULT_POSITION_Y;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Wartość `object-position` dla zapisanego (albo podglądanego) kadru. */
export function clubCoverObjectPosition(value: unknown): string {
  return `center ${normalizeClubCoverPositionY(value)}%`;
}

/** Ramka okładki w innej powierzchni niż nagłówek, pokazywana w podglądzie edytora. */
export interface ClubCoverPreviewFrame {
  /** Klucz etykiety: `club.hub.identity.cover.position.preview.<key>`. */
  key: "bannerMobile" | "bannerDesktop" | "card";
  /** Szerokość / wysokość. */
  ratio: number;
}

/**
 * Proporcje `ClubCover` - bramka dostępu, karta klubu zamkniętego i minisite
 * rysują wariant `banner` (`aspect-[3/1]`, od `sm` `aspect-[4/1]`), katalog
 * wariant `card` (`aspect-[16/9]`). Zgodność z klasami atomu pilnuje test
 * `clubCoverFrame.test.ts`, bo Tailwind wymaga literałów w klasach i liczb nie
 * da się z nich wyprowadzić w czasie wykonania.
 */
export const CLUB_COVER_PREVIEW_FRAMES: readonly ClubCoverPreviewFrame[] = [
  { key: "bannerMobile", ratio: 3 },
  { key: "bannerDesktop", ratio: 4 },
  { key: "card", ratio: 16 / 9 },
];

/** Proporcja pasa nagłówka, gdy nie da się jej zmierzyć (render bez układu, SSR). */
export const CLUB_COVER_HUB_FALLBACK_RATIO = 4;

/**
 * Proporcja realnie wyrysowanej ramki. Pas nagłówka ma na mobile `aspect-[4/1]`
 * z `min-h-[7rem]`, a od `sm` STAŁĄ wysokość przy płynnej szerokości - jego
 * proporcja chodzi od ~2.6:1 (telefon 320 px) do ~7.4:1 (szeroki monitor),
 * więc żadna stała w podglądzie nie pokaże tego, co widzi czytelnik. Element
 * bez wymiarów (jeszcze nie w układzie, jsdom) daje proporcję zapasową.
 */
export function measureFrameRatio(
  element: Element | null | undefined,
  fallback: number = CLUB_COVER_HUB_FALLBACK_RATIO,
): number {
  if (!element) return fallback;
  const { width, height } = element.getBoundingClientRect();
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return fallback;
  }
  return width / height;
}
