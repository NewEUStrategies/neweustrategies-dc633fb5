// Aspekt płótna mapy (wysokość / szerokość rysunku) - liczony Z ZASOBU.
//
// CO SIĘ PSUŁO WCZEŚNIEJ. Każdy komponent mapy trzymał własną tablicę
// `REGION_ASPECT: Record<MapRegion, number>` z ułamkami przepisanymi ręcznie
// z generatora (`427/960`, `825/960`) i komentarzem "trzymać w zgodzie
// z generatorem". Nic tej zgodności nie pilnowało, a generator liczy wysokość
// z ZASIĘGU DANYCH (`height = spanY * scale + 2 * padding`) - więc zmiana
// ramki regionu, paddingu albo źródła geometrii rozjeżdża ułamek w kodzie
// z plikiem na dysku. Rozjazd nie zapala się jako błąd: `preserveAspectRatio`
// dopasowuje rysunek do pudełka, więc mapa zostaje poprawna, a pod nią (albo
// po jej bokach) rośnie pas pustego miejsca i nikt nie wie dlaczego. Przy
// siedmiu regionach zamiast dwóch to była kwestia czasu, nie ryzyka.
//
// ZASÓB ZNA SWÓJ ASPEKT: `viewBox` niesie go wprost i jest tą samą liczbą,
// którą wypisał generator. Liczymy go więc z `viewBox`, a tablica zostaje
// wyłącznie jako WARTOŚĆ STARTOWA (niżej).
import { type GeoAsset, type MapRegion } from "./types";

/**
 * Aspekt na czas, ZANIM ZASÓB DOJEDZIE.
 *
 * Migotka (shimmer) renderuje się w pudełku o konkretnej wysokości, zanim
 * fetch geometrii wróci - a pudełko bez wysokości to skok layoutu w chwili
 * pojawienia się mapy. Potrzebna jest więc liczba PRZED zasobem, i tylko do
 * tego służy ta tablica.
 *
 * DLATEGO WOLNO JEJ BYĆ PRZYBLIŻENIEM, a wcześniejszej tablicy nie było:
 * tamta decydowała o wysokości GOTOWEJ mapy, więc jej rozjazd z generatorem
 * zostawał na ekranie na stałe. Ta odpowiada za jedną klatkę - gdy zasób
 * przyjdzie, aspekt liczy się z jego `viewBox` i ewentualna nieścisłość
 * kończy się jednorazowym dociągnięciem wysokości o kilka procent.
 *
 * MIMO TO WSZYSTKIE WARTOŚCI SĄ DOKŁADNE - przepisane z `viewBox`
 * wygenerowanych zasobów, a nie oszacowane z ramki regionu. Pierwsza wersja
 * szacowała i to był błąd w samym celu tej tablicy: Azja stała tu na 0,78,
 * a zasób ma 925/960 ≈ 0,96, więc na kontenerze 720 px blok podskakiwał
 * o ~132 px dokładnie w chwili, w której ta liczba miała skok wyeliminować.
 * Przybliżenie byłoby tu wprawdzie dopuszczalne (błąd żyje jedną klatkę), ale
 * nie ma powodu przybliżać czegoś, co stoi wprost w pliku - i jest bramka
 * (`geoAspect.test.ts`), która pilnuje zgodności z zasobem na dysku.
 *
 * `Record<MapRegion, number>` jest tu istotą, a nie ozdobą typu: region
 * dopisany do `MAP_REGIONS` bez wpisu tutaj NIE SKOMPILUJE SIĘ, więc tej
 * kopii listy nie trzeba pilnować bramką.
 */
export const REGION_ASPECT_FALLBACK: Record<MapRegion, number> = {
  europe: 825 / 960,
  world: 427 / 960,
  africa: 876 / 960,
  asia: 925 / 960,
  "north-america": 814 / 960,
  // JEDYNY REGION PORTRETOWY - wysokość większa od szerokości. Stoi tu
  // osobnym komentarzem, bo przez lata każda mapa w tym silniku była pozioma
  // i „szerokość razy aspekt" czytało się jako „coś niższego niż szerokie".
  "south-america": 1143 / 960,
  oceania: 609 / 960,
};

/**
 * Aspekt z napisu `viewBox` albo `null`, gdy napisu nie da się odczytać.
 *
 * `null`, a nie wartość domyślna: kto pyta, ten wie, jakim regionem się
 * posłużyć w zastępstwie, a zaszyta tutaj liczba byłaby szóstą kopią tej
 * samej stałej. Zasób bywa zcache'owaną kopią z innej wersji generatora, więc
 * pusty, skrócony albo zerowy `viewBox` musi wyjść jako "nie wiem", a nie
 * jako dzielenie przez zero w wysokości pudełka.
 */
export function aspectFromViewBox(viewBox: string | undefined): number | null {
  if (typeof viewBox !== "string") return null;
  const parts = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return height / width;
}

/**
 * Aspekt płótna mapy dla regionu: z zasobu, jeśli już jest, inaczej startowy.
 *
 * DLACZEGO WYSOKOŚĆ PUDEŁKA NIE JEST NICZYM OGRANICZANA. Kuszące byłoby
 * przyciąć ją przy regionie portretowym (Ameryka Południowa na kontenerze
 * 960 px dałaby ponad 1100 px wysokości). Przycięcie zamienia jednak
 * `preserveAspectRatio="xMidYMid meet"` z dopasowania dokładnego w
 * LETTERBOXING - rysunek dostaje puste pasy po bokach - a kotwica tooltipa
 * liczy się w komponentach ze skali `szerokość / viewBox.width`, czyli
 * z założenia, że rysunek wypełnia pudełko dokładnie. Przycięta wysokość
 * rozjechałaby tooltip z krajem, którego dotyczy, i to tylko w regionach
 * portretowych. Wysoki blok jest ceną, którą layout znosi; przesunięty
 * tooltip nie jest.
 */
export function mapAspect(region: MapRegion, asset: Pick<GeoAsset, "viewBox"> | undefined): number {
  return aspectFromViewBox(asset?.viewBox) ?? REGION_ASPECT_FALLBACK[region];
}
