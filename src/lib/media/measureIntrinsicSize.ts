// Pomiar naturalnego rozmiaru pliku obrazu w przeglądarce redaktora.
//
// WYŁĄCZNIE KOD PANELU. Publiczny render nigdy niczego nie mierzy: rozmiar
// trafia do HTML-u serwera z danych zapisanych wcześniej przez panel (Opcje
// motywu, edytor obrazu w builderze), więc tego modułu nie wolno importować z
// komponentów renderowanych na stronie.
import { formatIntrinsicSize } from "@/lib/media/intrinsicSize";
import { mediaRenderUrl } from "@/lib/media/publicUrl";

/** Po tym czasie uznajemy plik za niedostępny - zapis w panelu nie może wisieć. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * Naturalny rozmiar pliku jako `"WxH"` albo `""`, gdy nie da się go ustalić
 * (pusty adres, błąd pobrania, brak odpowiedzi w 5 s, plik bez własnego
 * rozmiaru - np. SVG bez `width`/`height` w Firefoksie daje 0 × 0). Obietnica
 * NIGDY nie jest odrzucana: brak pomiaru to dla wołającego "rozmiar nieznany".
 *
 * Mierzymy ORYGINAŁ obiektem `Image` poza drzewem DOM - nigdy `naturalWidth`
 * wyrenderowanego `<img>`, bo ten przy `srcset` niesie rozmiar wybranego
 * wariantu, a nie pliku. Adres idzie przez `mediaRenderUrl` (ścieżka względna
 * `/media/...`, ta sama, którą panel pokazuje podglądy), więc świeżo wgrany
 * plik mierzy się także na hoście podglądu.
 */
export function measureIntrinsicSize(url: string): Promise<string> {
  if (!url || typeof window === "undefined" || typeof window.Image !== "function") {
    return Promise.resolve("");
  }
  return new Promise<string>((resolve) => {
    let probe: HTMLImageElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (size: string) => {
      clearTimeout(timer);
      if (probe) {
        probe.onload = null;
        probe.onerror = null;
      }
      resolve(size);
    };
    try {
      const image = new window.Image();
      probe = image;
      timer = setTimeout(() => settle(""), PROBE_TIMEOUT_MS);
      image.onload = () => settle(formatIntrinsicSize(image.naturalWidth, image.naturalHeight));
      image.onerror = () => settle("");
      image.src = mediaRenderUrl(url);
    } catch {
      settle("");
    }
  });
}
