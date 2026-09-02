// Reguły PREZENTACJI załączników czatu - czyste funkcje bez Reacta.
//
// PO CO. `AttachmentContent.tsx` stał na 12,5% linii i 4,8% GAŁĘZI, a
// `AttachmentPreview.tsx` na 38,1% - i to są pliki, przez które przechodzi
// KAŻDY plik przysłany przez użytkownika. Powód niskiego pokrycia był ten sam,
// co w kompozytorze: macierz decyzji (jaka ikona dla tego MIME, jaki wariant
// dymka, ile wynosi zoom po kółku myszy, co robi strzałka na ostatnim zdjęciu)
// mieszkała wewnątrz komponentów, więc każdy przypadek wymagał renderu z
// podpisanym URL-em, `IntersectionObserver` i dialogiem Radiksa.
//
// PRZENIESIENIE, NIE ZMIANA: każda funkcja odtwarza wcześniejsze wyrażenie co
// do gałęzi (łącznie z zaokrągleniem `toFixed(2)` przy zoomie, które decyduje
// o tym, czy przycisk „pomniejsz" jest wyłączony na dokładnie 100%).
import type { MessageRow } from "./types";

// --- ikona pliku -------------------------------------------------------------

/** Rodzina ikony dla załącznika-dokumentu (mapowana na komponent w UI). */
export type FileIconKind = "spreadsheet" | "presentation" | "document" | "generic";

/**
 * Rodzina ikony na podstawie typu MIME. Dopasowanie jest PODCIĄGIEM, bo
 * warianty biurowe mają po kilka niekompatybilnych nazw MIME
 * (`vnd.ms-excel`, `...spreadsheetml.sheet`, `...opendocument.spreadsheet`),
 * a lista dokładnych literałów rozjeżdżałaby się z kubełkiem przy każdym
 * nowym formacie.
 */
export function fileIconKind(mime: string | null): FileIconKind {
  if (!mime) return "generic";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv") {
    return "spreadsheet";
  }
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "presentation";
  return "document";
}

// --- wariant dymka -----------------------------------------------------------

/** Który atom załącznika ma wyrenderować dymek wiadomości. */
export type AttachmentVariant = "image" | "audio" | "file" | "none";

/**
 * Wariant treści dymka. `none` jest STANEM, nie awarią: wiersz z rodzajem
 * `image` bez `attachment_path` powstaje przy nieudanym przesyłaniu i musi
 * pokazać sam podpis, a nie pusty obrazek z ikoną złamanego linku.
 */
export function attachmentVariant(
  message: Pick<MessageRow, "kind" | "attachment_path">,
): AttachmentVariant {
  if (!message.attachment_path) return "none";
  if (message.kind === "image") return "image";
  if (message.kind === "audio") return "audio";
  if (message.kind === "file") return "file";
  return "none";
}

// --- podgląd pełnoekranowy ---------------------------------------------------

export const LIGHTBOX_MIN_ZOOM = 1;
export const LIGHTBOX_MAX_ZOOM = 6;
export const LIGHTBOX_ZOOM_STEP = 0.4;

/** Zoom przycięty do zakresu podglądu. */
export function clampZoom(value: number): number {
  return Math.min(LIGHTBOX_MAX_ZOOM, Math.max(LIGHTBOX_MIN_ZOOM, value));
}

/**
 * Zoom po kroku. `toFixed(2)` jest częścią kontraktu, nie kosmetyką: bez niego
 * pięć kroków w dół z 3.0 daje 0.9999999999999998, przycięte do 1 - ale
 * porównanie `zoom === 1` (wyłączenie przycisku „dopasuj") byłoby fałszywe.
 */
export function zoomBy(current: number, delta: number): number {
  return clampZoom(Number((current + delta).toFixed(2)));
}

/** Obrót co ćwierć obrotu, zawinięty do pełnego koła. */
export function nextRotation(current: number): number {
  return (current + 90) % 360;
}

/** Indeks przycięty do rozmiaru galerii (pusta galeria = 0). */
export function clampLightboxIndex(index: number, total: number): number {
  return total > 0 ? Math.min(Math.max(index, 0), total - 1) : 0;
}

/** Następny indeks galerii - zawija się na obu końcach (WhatsApp/Photos). */
export function wrapLightboxIndex(current: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (current + delta + total) % total;
}

/** Skróty klawiaturowe podglądu (Esc obsługuje Radix). */
export type LightboxKeyIntent =
  "next" | "prev" | "zoom-in" | "zoom-out" | "reset" | "rotate" | "none";

export function lightboxKeyIntent(key: string): LightboxKeyIntent {
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  if (key === "+" || key === "=") return "zoom-in";
  if (key === "-" || key === "_") return "zoom-out";
  if (key === "0") return "reset";
  if (key.toLowerCase() === "r") return "rotate";
  return "none";
}

/**
 * Czy kółko myszy ma zmienić zoom. Bez modyfikatora wymagany jest WYRAŹNY ruch
 * (>= 20), żeby delikatne przewijanie gładzikiem nad podglądem nie skakało
 * skokowo po powiększeniach.
 */
export function shouldZoomOnWheel(event: {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
}): boolean {
  return event.ctrlKey || event.metaKey || Math.abs(event.deltaY) >= 20;
}

/** Kierunek zoomu z kółka: w dół = oddal, w górę = przybliż. */
export function wheelZoomDelta(deltaY: number): number {
  return deltaY > 0 ? -LIGHTBOX_ZOOM_STEP : LIGHTBOX_ZOOM_STEP;
}
