// Pomiar naturalnego rozmiaru pliku obrazu w przeglądarce redaktora.
//
// WYŁĄCZNIE KOD PANELU. Publiczny render nigdy niczego nie mierzy: rozmiar
// trafia do HTML-u serwera z danych zapisanych wcześniej przez panel (Opcje
// motywu, edytor obrazu w builderze), więc tego modułu nie wolno importować z
// komponentów renderowanych na stronie.
//
// PLIK BEZ WŁASNEJ PROPORCJI NIE MA ROZMIARU. Chrome zgłasza dla SVG bez
// proporcji rozmiar ZASTĘPCZY: 300 × 150, gdy brakuje obu boków, albo jeden
// prawdziwy bok i drugi zastępczy (np. 200 × 150). Atrybuty `width`/`height` z
// takiej pary zostałyby na stałe: plik nie ma proporcji, która po pobraniu
// wygrałaby z `aspect-ratio: auto W / H`, więc obraz zmieniłby kształt (logo o
// wysokości 64 px: z 300 × 64 na 128 × 64). Rozmiar oddajemy więc tylko wtedy,
// gdy plik sam ma proporcję.
//
// O PROPORCJĘ PYTAMY SILNIK, NIE PLIK. Dwie sondy `<img>` tego samego adresu
// stoją poza widokiem z wysokością 10 px i 1000 px i szerokością `auto`. Plik z
// własną proporcją skaluje się z wysokością (350 × 150: 23,3 px i 2333,3 px),
// plik bez proporcji ma w obu sondach tę samą szerokość - własną albo zastępczą
// (300 px i 300 px). To reguła CSS, nie zwyczaj jednej przeglądarki, i obejmuje
// każdy sposób, w jaki plik proporcję dostaje albo traci (`viewBox`, jednostki,
// `preserveAspectRatio="none"`, rozmiar w `style`).
// Treści pliku NIE czytamy: `fetch` podlega `connect-src` z CSP aplikacji
// (`src/start.ts`), która odrzuca plik z obcego hosta i adres `data:`. Taki
// plik nie dostawał rozmiaru nigdy, a każda próba kończyła się zdarzeniem
// `securitypolicyviolation`, które obserwowalność zgłasza jako błąd. Sonda to
// obraz: podlega `img-src`, czyli dyrektywie, pod którą strona i tak go rysuje.
//
// SONDY STOJĄ PRZY KAŻDYM ADRESIE, nie tylko przy `.svg`. To, czy plik może nie
// mieć proporcji, wynika z jego treści, a nie z adresu: SVG pod adresem bez
// rozszerzenia (CDN, adres podpisany) dostawał dotąd rozmiar zastępczy. Jedyny
// inny sygnał dostępny bez czytania pliku to same liczby zastępcze, a te zależą
// od przeglądarki. Koszt jest pomijalny: obrazy tego samego adresu w jednym
// dokumencie pobierają się raz (dwie sondy to jedno żądanie - tyle, ile dotąd
// brał sam pomiar), a pomiar rusza wyłącznie po działaniu redaktora ("Zapisz" w
// Opcjach motywu, plik albo zaznaczenie obrazu w builderze).
import { formatIntrinsicSize } from "@/lib/media/intrinsicSize";
import { mediaRenderUrl } from "@/lib/media/publicUrl";

/** Po tym czasie uznajemy plik za niedostępny - zapis w panelu nie może wisieć. */
const PROBE_TIMEOUT_MS = 5000;

/** Wysokości sond w px: niska i wysoka. Plik z proporcją daje szerokości 1 : 100. */
const PROBE_HEIGHTS = [10, 1000] as const;

/**
 * Pojemnik sond: pole 0 × 0 przypięte do widoku, z przyciętą zawartością -
 * niczego nie rysuje, nie przesuwa układu i nie dokłada paska przewijania.
 * `!important`, bo styl inline bez niego przegrywa z regułą `!important`
 * arkusza strony.
 */
const HOST_STYLE =
  "all:initial!important;position:fixed!important;width:0!important;height:0!important;overflow:hidden!important";

/**
 * Styl sondy: każda własność w wartości początkowej (szerokość `auto`, bez
 * `max-width` z resetu arkusza, który przyciąłby szeroką sondę do pojemnika)
 * i sama wysokość.
 */
const probeStyle = (height: number) => `all:initial!important;height:${height}px!important`;

/**
 * Szerokość sondy po ułożeniu przez silnik. Odczyt jest wstrzykiwany, bo
 * środowisko testów jednostkowych (happy-dom) nie liczy układu.
 */
export type ProbeWidthReader = (probe: HTMLImageElement) => number;

const layoutWidth: ProbeWidthReader = (probe) => probe.getBoundingClientRect().width;

/** Wynik pomiaru pliku. */
export interface IntrinsicMeasurement {
  /** `"WxH"`, gdy plik ma własną proporcję i poprawny rozmiar; inaczej `""`. */
  size: string;
  /**
   * `true` WYŁĄCZNIE wtedy, gdy plik się załadował, a układ pokazał, że nie ma
   * własnej proporcji: rozmiar zapisany dla niego wcześniej jest błędny i ma
   * zniknąć. Nieudany pomiar (błąd pobrania, limit czasu, brak układu) to
   * `false` - wtedy o pliku nic nie wiadomo i zapisana wartość zostaje.
   */
  noRatio: boolean;
}

const FAILED: IntrinsicMeasurement = { size: "", noRatio: false };
const NO_RATIO: IntrinsicMeasurement = { size: "", noRatio: true };

/**
 * Werdykt dla pliku załadowanego w obu sondach:
 *  - wyższa sonda szersza: plik ma własną proporcję - jego rozmiar (albo `""`,
 *    gdy przeglądarka rozmiaru nie podaje, np. 0 × 0);
 *  - obie sondy tej samej, niezerowej szerokości: plik BEZ własnej proporcji;
 *  - cokolwiek innego (zero, NaN, wyjątek odczytu): układu nie ma, czyli
 *    pomiar nieudany. "Brak proporcji" kasuje zapisane rozmiary, więc wymaga
 *    dowodu, a nie braku odpowiedzi.
 */
function verdict(
  probes: readonly HTMLImageElement[],
  readWidth: ProbeWidthReader,
): IntrinsicMeasurement {
  try {
    const [lowProbe, highProbe] = probes;
    const low = readWidth(lowProbe);
    const high = readWidth(highProbe);
    if (high > low) {
      return {
        size: formatIntrinsicSize(lowProbe.naturalWidth, lowProbe.naturalHeight),
        noRatio: false,
      };
    }
    return low > 0 && high === low ? NO_RATIO : FAILED;
  } catch {
    return FAILED;
  }
}

/** Stawia sondy, czeka na oba obrazy i sprząta po sobie na każdej ścieżce. Nie odrzuca. */
function probeIntrinsicSize(
  url: string,
  readWidth: ProbeWidthReader,
): Promise<IntrinsicMeasurement> {
  return new Promise<IntrinsicMeasurement>((resolve) => {
    let host: HTMLElement | undefined;
    let probes: HTMLImageElement[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (result: IntrinsicMeasurement) => {
      clearTimeout(timer);
      for (const probe of probes) {
        probe.onload = null;
        probe.onerror = null;
      }
      host?.remove();
      resolve(result);
    };
    try {
      const box = document.createElement("div");
      host = box;
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = HOST_STYLE;
      let loading = PROBE_HEIGHTS.length;
      probes = PROBE_HEIGHTS.map((height) => {
        const probe = document.createElement("img");
        probe.alt = "";
        probe.style.cssText = probeStyle(height);
        probe.onload = () => {
          loading -= 1;
          if (loading === 0) settle(verdict(probes, readWidth));
        };
        probe.onerror = () => settle(FAILED);
        box.appendChild(probe);
        return probe;
      });
      timer = setTimeout(() => settle(FAILED), PROBE_TIMEOUT_MS);
      document.body.appendChild(box);
      const src = mediaRenderUrl(url);
      for (const probe of probes) probe.src = src;
    } catch {
      settle(FAILED);
    }
  });
}

/**
 * Naturalny rozmiar pliku: `size` to `"WxH"` albo `""`, gdy nie da się go
 * ustalić (pusty adres, błąd pobrania, brak odpowiedzi w 5 s, plik bez własnego
 * rozmiaru - np. SVG z samym `viewBox` w Firefoksie daje 0 × 0 - oraz plik bez
 * własnej proporcji). Ten ostatni przypadek wyróżnia `noRatio` - patrz
 * `IntrinsicMeasurement`. Obietnica NIGDY nie jest odrzucana: brak pomiaru to
 * dla wołającego "rozmiar nieznany".
 *
 * Mierzymy ORYGINAŁ własnymi sondami `<img>` bez `srcset` - nigdy
 * `naturalWidth` obrazu wyrenderowanego przez stronę, bo ten przy `srcset`
 * niesie rozmiar wybranego wariantu, a nie pliku. Adres idzie przez
 * `mediaRenderUrl` (ścieżka względna `/media/...`, ta sama, którą panel
 * pokazuje podglądy), więc świeżo wgrany plik mierzy się także na hoście
 * podglądu.
 *
 * `readWidth` zostaje domyślny wszędzie poza testami jednostkowymi.
 */
export function measureIntrinsicSize(
  url: string,
  readWidth: ProbeWidthReader = layoutWidth,
): Promise<IntrinsicMeasurement> {
  if (!url || typeof document === "undefined") return Promise.resolve(FAILED);
  return probeIntrinsicSize(url, readWidth);
}
