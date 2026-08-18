// Czysta geometria kadrowania - reguły wyjęte z `imageCrop.ts` (bounding box
// rotacji) i z `ImageCropDialog.tsx` (tolerancja proporcji, kroki zoomu i
// obrotu, etykieta proporcji).
//
// DLACZEGO OSOBNY MODUŁ. Te reguły decydują o wyglądzie KAŻDEGO zdjęcia w
// serwisie (miniatury wpisów, karty autorów, OG image, obrazy w widgetach), a
// do 18.08.2026 żadnej z nich nie dało się przetestować bez DOM-u: bounding box
// siedział w środku `getCroppedBlob` między `document.createElement("canvas")`
// a `toBlob`, a tolerancja proporcji i kroki suwaków - w ciele komponentu
// React, w handlerach `onKeyDown`. Efekt: `imageCrop.ts` miał 0 z 13 funkcji, a
// jedyną drogą do tych reguł było wyrenderowanie całego modalu z
// `react-easy-crop` - czyli dokładnie ta warstwa testów renderujących bez
// asercji, którą repo raz już zdjęło (patrz komentarz przy progu globalnym w
// vitest.config.ts).
//
// EKSTRAKCJA JEST NEUTRALNA. Każda funkcja niżej to przeniesione 1:1 wyrażenie
// z miejsca wywołania - te same stałe, ta sama kolejność zaokrągleń, te same
// klamry. Zmiana zachowania (np. dopisanie klamrowania kadru do krawędzi
// obrazu, którego dziś NIE MA) to osobna decyzja i osobny commit.

export interface PixelSize {
  width: number;
  height: number;
}

/** Stopnie -> radiany. Było prywatnym `toRad` w `imageCrop.ts`. */
export const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Prostokąt obejmujący dowolny obrót obrazu `width × height` o `rotationDeg`.
 *
 * Canvas rotacji w `getCroppedBlob` musi być na tyle duży, żeby obrócone źródło
 * zmieściło się w całości - inaczej rogi zdjęcia są obcinane przy każdym
 * obrocie innym niż wielokrotność 180°.
 *
 * `Math.abs` na obu składnikach sprawia, że wynik jest symetryczny względem
 * znaku kąta: bbox(-90°) === bbox(90°).
 */
export function rotationBoundingBox(width: number, height: number, rotationDeg: number): PixelSize {
  const rad = toRadians(rotationDeg);
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
}

/**
 * Czy proporcje źródła odbiegają od wymaganej na tyle, żeby ostrzec autora
 * przed otwarciem kadrownika.
 *
 * Porównanie jest WZGLĘDNE (odchylenie dzielone przez `aspect`), więc jeden
 * próg `tolerance` obsługuje zarówno awatar 1:1, jak i okładkę 16:6.
 *
 * Próg jest OSTRY (`>`): źródło dokładnie na granicy tolerancji przechodzi bez
 * ostrzeżenia.
 */
export function sourceAspectWarning(
  width: number,
  height: number,
  aspect: number,
  tolerance: number,
): boolean {
  const sourceRatio = width / height;
  const diff = Math.abs(sourceRatio - aspect) / aspect;
  return diff > tolerance;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
/** Krok strzałki na suwaku zoomu: Shift = precyzyjny. */
export const ZOOM_STEP_COARSE = 0.05;
export const ZOOM_STEP_FINE = 0.01;

/**
 * Zaokrąglenie wartości zoomu do dwóch miejsc - odpowiednik przeciągnięcia
 * suwaka. NIE klamruje: zakres wymusza już sam `<Slider min={1} max={6}>`.
 *
 * Zaokrąglenie nie jest kosmetyką: bez niego `1 + 0,05 × 3` daje
 * `1.1500000000000001`, co wycieka do etykiety „×" pokazywanej użytkownikowi.
 */
export function quantizeZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Krok zoomu strzałką, z klamrą do zakresu suwaka. */
export function stepZoom(current: number, direction: 1 | -1, fine = false): number {
  const delta = fine ? ZOOM_STEP_FINE : ZOOM_STEP_COARSE;
  return direction === 1
    ? Math.min(ZOOM_MAX, quantizeZoom(current + delta))
    : Math.max(ZOOM_MIN, quantizeZoom(current - delta));
}

export const ROTATION_MIN = -180;
export const ROTATION_MAX = 180;
/** Krok strzałki na suwaku obrotu: Alt = snap co 15°, Shift = precyzyjny. */
export const ROTATION_STEP_COARSE = 1;
export const ROTATION_STEP_FINE = 0.1;
export const ROTATION_STEP_SNAP = 15;

/** Zaokrąglenie kąta do jednego miejsca - odpowiednik przeciągnięcia suwaka. */
export function quantizeRotation(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Krok obrotu strzałką, z klamrą do zakresu suwaka. */
export function stepRotation(
  current: number,
  direction: 1 | -1,
  mods: { alt?: boolean; shift?: boolean } = {},
): number {
  const delta = mods.alt
    ? ROTATION_STEP_SNAP
    : mods.shift
      ? ROTATION_STEP_FINE
      : ROTATION_STEP_COARSE;
  return direction === 1
    ? Math.min(ROTATION_MAX, quantizeRotation(current + delta))
    : Math.max(ROTATION_MIN, quantizeRotation(current - delta));
}

/**
 * Etykieta wymaganej proporcji („1:1", „8:3") pokazywana nad kadrownikiem.
 *
 * Skrót dla proporcji kwadratowej omija redukcję GCD, bo `aspect` bywa liczbą
 * zmiennoprzecinkową (16/6), a docelowe wymiary są całkowite - dla awatara oba
 * źródła i tak dają „1:1", ale skrót trzyma etykietę stabilną także wtedy, gdy
 * preset poda wymiary nie dzielące się równo.
 */
export function aspectRatioLabel(
  aspect: number,
  targetWidth: number,
  targetHeight: number,
): string {
  if (Math.abs(aspect - 1) < 0.01) return "1:1";
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(targetWidth, targetHeight);
  return `${targetWidth / g}:${targetHeight / g}`;
}
