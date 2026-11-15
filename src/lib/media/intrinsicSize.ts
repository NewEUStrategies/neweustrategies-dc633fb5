// Naturalny rozmiar pliku obrazu w pikselach, zapisywany jako napis "WxH".
//
// KONTRAKT: te liczby trafiają WYŁĄCZNIE do atrybutów `width`/`height`
// znacznika `<img>`, nigdy do CSS (ani inline `aspect-ratio`, ani wyliczona
// szerokość, ani `ratio` widgetu). Każdy taki obraz ma już szerokość i wysokość
// w CSS, więc atrybuty przegrywają jako rozmiar i zostaje z nich sama
// podpowiedź przeglądarki `aspect-ratio: auto W / H`: rezerwuje pole przed
// pobraniem, a po pobraniu wygrywa realna proporcja pliku. Brak wartości albo
// wartość nieaktualna nie może więc trwale zniekształcić obrazu - nieznany
// rozmiar to po prostu dzisiejszy znacznik bez atrybutów.
//
// Moduł bez importów i bez efektów ubocznych: ląduje w chunku wejściowym
// (logo w chrome), więc ma zostać mały. Pomiar pliku mieszka osobno, w kodzie
// panelu (`measureIntrinsicSize`).

export interface IntrinsicSize {
  width: number;
  height: number;
}

/** Para `[adres pliku dokładnie tak, jak zapisano go w polu, "WxH"]`. */
export type IntrinsicSizeEntry = [src: string, size: string];

const SIZE_RE = /^([1-9]\d{0,4})x([1-9]\d{0,4})$/;
/** Górna granica boku - powyżej to uszkodzony zapis, nie obraz. */
const MAX_SIDE = 20000;

/** `"350x150"` -> `{ width: 350, height: 150 }`; wszystko inne -> `undefined`. */
export function parseIntrinsicSize(value: unknown): IntrinsicSize | undefined {
  if (typeof value !== "string") return undefined;
  const match = SIZE_RE.exec(value);
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
  return { width, height };
}

/**
 * Napis "WxH" albo `""`, gdy para nie jest poprawnym rozmiarem. Jedna ścieżka
 * walidacji: wynik wraca tylko wtedy, gdy przyjmuje go `parseIntrinsicSize`
 * (0, NaN, ułamki, wartości ujemne i ponad limit to "nieznany").
 */
export function formatIntrinsicSize(width: number, height: number): string {
  const size = `${width}x${height}`;
  return parseIntrinsicSize(size) ? size : "";
}

/**
 * Rozmiar pliku `src` z listy par `[src, "WxH"]`. Porównanie adresu jest
 * dokładne (ten sam napis, bez normalizacji), wygrywa pierwsza para z tym
 * adresem. Lista innego kształtu niż tablica i para z błędnym rozmiarem dają
 * `undefined`.
 */
export function findIntrinsicSize(entries: unknown, src: string): IntrinsicSize | undefined {
  if (!src || !Array.isArray(entries)) return undefined;
  const entry = (entries as unknown[]).find(
    (candidate): candidate is unknown[] => Array.isArray(candidate) && candidate[0] === src,
  );
  return entry ? parseIntrinsicSize(entry[1]) : undefined;
}
