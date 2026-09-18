// Porównanie wgranego obrazu z rekomendacją rozmiaru - wspólne dla całego
// panelu, niezależne od konkretnego widgetu.
//
// PO CO. Pole obrazu w inspektorze buildera przyjmowało dotąd KAŻDY plik bez
// słowa komentarza. Redakcja wgrywała więc albo miniaturę 320 px, która po
// rozciągnięciu na kadr karty jest rozmyta, albo plik prosto z aparatu (kilka
// tysięcy pikseli i kilkanaście megabajtów) na kafelek o szerokości 512 px.
// Obie pomyłki widać dopiero na opublikowanej stronie - jedną na ekranie,
// drugą w rachunku za transfer i w LCP.
//
// Moduł jest czysty (bez DOM-u i Reacta): sama reguła progu, żeby dała się
// sprawdzić testem i żeby panel oraz ewentualne przyszłe walidacje po stronie
// serwera liczyły dokładnie to samo.

/** Rozmiar obrazu w pikselach - i pliku wgranego, i rekomendacji. */
export interface PixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Próg ostrzeżenia "za mały plik".
 *
 * 0,8 jest świadomie miękkie: plik 1500 px tam, gdzie prosimy o 1600 px, nie
 * jest defektem, a ostrzeżenie o nim byłoby szumem, który redakcja nauczy się
 * ignorować - i przy okazji przestanie czytać te prawdziwe. Mówimy dopiero,
 * gdy brakuje piątej części wymiaru, bo wtedy różnicę widać na ekranie.
 */
export const RECOMMENDED_SIZE_MIN_SCALE = 0.8;

/**
 * Próg ostrzeżenia "plik znacznie większy niż potrzeba". Powyżej dwukrotności
 * rekomendacji (która SAMA już zakłada ekrany o podwójnej gęstości) czytelnik
 * pobiera piksele, których żaden ekran nie pokaże.
 */
export const RECOMMENDED_SIZE_MAX_SCALE = 2;

const usable = (size: PixelSize): boolean => size.width > 0 && size.height > 0;

/** Czy obraz jest wyraźnie mniejszy niż rekomendacja (rozmycie po skalowaniu). */
export function isImageTooSmall(natural: PixelSize, recommended: PixelSize): boolean {
  if (!usable(natural) || !usable(recommended)) return false;
  return (
    natural.width < recommended.width * RECOMMENDED_SIZE_MIN_SCALE ||
    natural.height < recommended.height * RECOMMENDED_SIZE_MIN_SCALE
  );
}

/** Czy obraz jest wyraźnie większy niż potrzeba (zbędny transfer u czytelnika). */
export function isImageOversized(natural: PixelSize, recommended: PixelSize): boolean {
  if (!usable(natural) || !usable(recommended)) return false;
  return natural.width > recommended.width * RECOMMENDED_SIZE_MAX_SCALE;
}
