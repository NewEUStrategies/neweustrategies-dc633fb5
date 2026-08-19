// Reguły wspólne dla paneli ustawień „doświadczenia czytelnika" (ToC, sekcja
// „dowiesz się", rekomendacje, układy wpisu).
//
// DLACZEGO OSOBNY MODUŁ, A NIE `useMemo` W PANELU. Cztery panele liczyły to
// samo na cztery sposoby wprost w komponencie: brudny szkic przez
// `JSON.stringify`, przycięcie liczby raz przez `clamp`, raz przez
// `parseInt(x || "0")` (czyli bez przycięcia), raz przez `Math.min/Math.max`.
// Reguła w `useMemo` nie ma jak dostać testu bez renderu całego panelu, a
// rozjazd trzech implementacji przycięcia był niewidoczny właśnie dlatego, że
// każda siedziała w innym pliku.

/** Granice pola liczbowego - ten sam kształt, którego używa warstwa zapisu. */
export interface NumberBounds {
  readonly min: number;
  readonly max: number;
}

/**
 * Czy szkic różni się od stanu zapisanego.
 *
 * UWAGA NA KOLEJNOŚĆ KLUCZY. Porównanie idzie przez `JSON.stringify`, więc
 * dwa obiekty o tych samych parach, ale innej kolejności kluczy, są RÓŻNE.
 * Panele budują szkic przez `{...draft, [k]: v}`, co kolejność zachowuje, więc
 * w praktyce to nie strzela - ale reguła musi to mówić wprost, bo pierwsze
 * `setDraft` zbudowane od zera (np. z odpowiedzi serwera) zapaliłoby „są
 * niezapisane zmiany" przy identycznej treści.
 */
export function draftDirty<T>(draft: T, persisted: T): boolean {
  return JSON.stringify(draft) !== JSON.stringify(persisted);
}

/**
 * Przycięcie surowej wartości z pola numerycznego do granic.
 *
 * DWA PRZYPADKI BRZEGOWE, ŚWIADOMIE ROZDZIELONE:
 * - PUSTE pole czyta się jak zero i dopiero potem wchodzi w granice. To
 *   zachowanie kopii, którą reguła zastąpiła (`parseInt(value || "0")`), i tak
 *   ma zostać: dla pozycji ToC `min` to `-1`, czyli „ukryj w treści" - samo
 *   wyczyszczenie pola nie może ukryć spisu treści.
 * - ŚMIECI (`abc`, `1,5`) schodzą do `min`, a nie do `NaN` - inaczej zapis
 *   posłałby do bazy `NaN`, który po stronie PostgREST jest `null`.
 * ZAOKRĄGLENIE IDZIE DO KROKU, NIE DO CAŁYCH. Większość pól panelu jest
 * całkowita (pozycja akapitu, liczba nagłówków, liczba dni) i dla nich krok
 * wynosi 1, czyli zachowanie jest takie jak zwykłe zaokrąglenie. Ale mnożnik
 * rozmiaru napisu ghost chodzi po 0,05 - zaokrąglenie do całych zamieniłoby ten
 * suwak w przełącznik „1 albo 2". Wynik jest dodatkowo docinany do liczby
 * miejsc po przecinku kroku, bo `Math.round(x / 0.05) * 0.05` daje w binarnym
 * zapisie wartości typu 1,4500000000000002.
 */
export function clampNumber(raw: string | number, bounds: NumberBounds, step = 1): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return bounds.min;
  const snapped = Number.isFinite(step) && step > 0 ? roundToStep(n, step) : n;
  return Math.min(bounds.max, Math.max(bounds.min, snapped));
}

/** Zaokrąglenie do wielokrotności kroku, bez śmieci z zapisu binarnego. */
function roundToStep(value: number, step: number): number {
  const decimals = decimalPlaces(step);
  const snapped = Math.round(value / step) * step;
  return decimals === 0 ? snapped : Number(snapped.toFixed(decimals));
}

/**
 * Liczba miejsc po przecinku w kroku (0 dla kroku całkowitego).
 *
 * ZAPIS WYKŁADNICZY MA WŁASNĄ GAŁĄŹ. `String(0.0000001)` to `"1e-7"` - bez
 * kropki, więc liczenie znaków po kropce dałoby ZERO miejsc i dociąganie
 * zaokrągliłoby taki krok do całych, czyli zgasiłoby suwak. Wykładnik mówi
 * dokładnie tyle, ile trzeba.
 */
function decimalPlaces(step: number): number {
  if (Number.isInteger(step)) return 0;
  const text = String(step);
  const exponent = text.match(/e-(\d+)$/);
  if (exponent) return Number(exponent[1]);
  // Krok niecałkowity, skończony i bez wykładnika MA kropkę - to nie jest
  // założenie na wiarę, tylko warunek wejścia pilnowany przez `clampNumber`
  // (`Number.isFinite(step) && step > 0`) i wcześniejsze `Number.isInteger`.
  return text.length - text.indexOf(".") - 1;
}

/**
 * Przełączenie indeksu na liście wybranych pozycji, z zachowaniem porządku
 * rosnącego. Kolejność ma znaczenie: lista jedzie do bazy i podświetla słowa
 * etykiety, więc „1,0" i „0,1" muszą dać ten sam wiersz.
 */
export function toggleIndex(list: readonly number[], index: number): number[] {
  return list.includes(index)
    ? list.filter((i) => i !== index)
    : [...list, index].sort((a, b) => a - b);
}
