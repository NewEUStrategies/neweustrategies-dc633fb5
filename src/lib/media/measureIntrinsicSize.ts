// Pomiar naturalnego rozmiaru pliku obrazu w przeglądarce redaktora.
//
// WYŁĄCZNIE KOD PANELU. Publiczny render nigdy niczego nie mierzy: rozmiar
// trafia do HTML-u serwera z danych zapisanych wcześniej przez panel (Opcje
// motywu, edytor obrazu w builderze), więc tego modułu nie wolno importować z
// komponentów renderowanych na stronie.
//
// SVG BEZ WŁASNEJ PROPORCJI NIE MA ROZMIARU. Chrome zgłasza dla takiego pliku
// rozmiar ZASTĘPCZY: 300 × 150, gdy brakuje obu boków, albo jeden prawdziwy bok
// i drugi zastępczy (np. 200 × 150). Atrybuty `width`/`height` z takiej pary
// zostałyby na stałe: plik nie ma proporcji, która po pobraniu wygrałaby z
// `aspect-ratio: auto W / H`, więc obraz zmieniłby kształt (logo o wysokości
// 64 px: z 300 × 64 na 128 × 64). Dlatego dla adresu SVG czytamy sam plik i
// oddajemy rozmiar tylko wtedy, gdy deklaruje on proporcję (`svgDeclaresRatio`).
import { formatIntrinsicSize } from "@/lib/media/intrinsicSize";
import { mediaRenderUrl } from "@/lib/media/publicUrl";

/** Po tym czasie uznajemy plik za niedostępny - zapis w panelu nie może wisieć. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * Czy adres wskazuje plik SVG: rozszerzenie ŚCIEŻKI (`.svg`, `.svgz`; zapytanie
 * i fragment się nie liczą) albo `data:image/svg+xml`. SVG podany pod adresem
 * bez rozszerzenia nie jest rozpoznawany i mierzy się jak każdy inny obraz.
 */
export function isSvgSource(url: string): boolean {
  if (/^data:/i.test(url)) return /^data:image\/svg\+xml[;,]/i.test(url);
  return /\.svgz?$/i.test(url.split(/[?#]/, 1)[0]);
}

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?`;
/** Długość bezwzględna: liczba dodatnia bez jednostki albo w px/pt/pc/mm/cm/in. */
const ABSOLUTE_LENGTH_RE = new RegExp(
  String.raw`^\s*\+?(${NUMBER})(?:px|pt|pc|mm|cm|in)?\s*$`,
  "i",
);
const VIEW_BOX_NUMBER_RE = new RegExp(String.raw`^[+-]?${NUMBER}$`, "i");
/** Wstęp dokumentu przed elementem głównym: deklaracja XML, komentarz, DOCTYPE. */
const PROLOG_RE =
  /^\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^[>"']|"[^"]*"|'[^']*')*(?:\[[\s\S]*?\]\s*)?>)/;
const ROOT_SVG_RE = /^\s*<(?:[A-Za-z_][\w.-]*:)?svg(?=[\s/>])/;
const ATTRIBUTE_RE = /\s+([^\s=/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

/** Atrybuty elementu głównego `<svg>` albo `null`, gdy to nie dokument SVG. */
function rootSvgAttributes(markup: string): Map<string, string> | null {
  let rest = markup.replace(/^\uFEFF/, "");
  for (let prolog = PROLOG_RE.exec(rest); prolog; prolog = PROLOG_RE.exec(rest)) {
    rest = rest.slice(prolog[0].length);
  }
  const root = ROOT_SVG_RE.exec(rest);
  if (!root) return null;
  const attributes = new Map<string, string>();
  ATTRIBUTE_RE.lastIndex = root[0].length;
  for (let match = ATTRIBUTE_RE.exec(rest); match; match = ATTRIBUTE_RE.exec(rest)) {
    if (!attributes.has(match[1])) attributes.set(match[1], match[2] ?? match[3] ?? "");
  }
  return attributes;
}

/**
 * Liczba w precyzji, w której czyta ją przeglądarka (32-bitowy `float`):
 * wartość poza zakresem to nieskończoność, a zbyt mała - zero, i w obu
 * przypadkach atrybut jest dla przeglądarki niepoprawny.
 */
const svgNumber = (text: string): number => Math.fround(Number(text));
/**
 * Bok, z którego da się policzyć proporcję. Chrome traktuje bok poniżej około
 * 1e-6 jak zero (plik bez proporcji) - granica stoi z zapasem powyżej.
 */
const MIN_SIDE = 1e-3;
const isSide = (value: number): boolean => Number.isFinite(value) && value >= MIN_SIDE;

const isAbsoluteLength = (value: string | undefined): boolean => {
  const match = ABSOLUTE_LENGTH_RE.exec(value ?? "");
  return !!match && isSide(svgNumber(match[1]));
};

/**
 * Czy plik SVG SAM deklaruje proporcję, czyli czy `naturalWidth`/`naturalHeight`
 * opisują jego kształt, a nie zastępcze 300 × 150 przeglądarki:
 *  - `width` i `height` elementu głównego jako długości bezwzględne, albo
 *  - poprawny `viewBox` (cztery liczby, szerokość i wysokość dodatnie), o ile
 *    `preserveAspectRatio` nie jest `none` (wtedy plik ma się rozciągać i
 *    `viewBox` proporcji nie daje).
 * Reguła jest ZACHOWAWCZA: procenty, jednostki względne (`em`, `ex`), rozmiar
 * podany w `style` i wartości z encji dają `false` (rozmiar nieznany - znacznik
 * jak dotąd), także tam, gdzie przeglądarka umiałaby proporcję policzyć.
 * Odpowiedzi `true` są sprawdzone na Chrome 153 (obraz o stałej wysokości ma
 * to samo pole z atrybutami i bez nich).
 */
export function svgDeclaresRatio(markup: string): boolean {
  const root = rootSvgAttributes(markup);
  if (!root) return false;
  if (isAbsoluteLength(root.get("width")) && isAbsoluteLength(root.get("height"))) return true;
  if (/(?:^|\s)none(?:\s|$)/.test(root.get("preserveAspectRatio") ?? "")) return false;
  const parts = (root.get("viewBox") ?? "").trim().split(/\s*,\s*|\s+/);
  if (parts.length !== 4 || !parts.every((part) => VIEW_BOX_NUMBER_RE.test(part))) return false;
  const [minX, minY, width, height] = parts.map(svgNumber);
  return Number.isFinite(minX) && Number.isFinite(minY) && isSide(width) && isSide(height);
}

/** `naturalWidth` × `naturalHeight` pliku jako `"WxH"` albo `""`. Nie odrzuca. */
function probeNaturalSize(url: string): Promise<string> {
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

/**
 * Czyta plik SVG spod tego samego adresu, którym ładuje go pomiar, i sprawdza
 * `svgDeclaresRatio`. Nie odrzuca: błąd pobrania (także odmowa CORS dla pliku
 * z obcego hosta), odpowiedź inna niż 2xx i brak odpowiedzi w 5 s dają `false`.
 */
function readSvgDeclaresRatio(url: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (declares: boolean) => {
      clearTimeout(timer);
      resolve(declares);
    };
    try {
      const abort = typeof AbortController === "function" ? new AbortController() : null;
      timer = setTimeout(() => {
        abort?.abort();
        settle(false);
      }, PROBE_TIMEOUT_MS);
      fetch(mediaRenderUrl(url), abort ? { signal: abort.signal } : undefined)
        .then((response) => (response.ok ? response.text() : ""))
        .then(
          (markup) => settle(svgDeclaresRatio(markup)),
          () => settle(false),
        );
    } catch {
      settle(false);
    }
  });
}

/**
 * Naturalny rozmiar pliku jako `"WxH"` albo `""`, gdy nie da się go ustalić
 * (pusty adres, błąd pobrania, brak odpowiedzi w 5 s, plik bez własnego
 * rozmiaru - np. SVG bez `width`/`height` w Firefoksie daje 0 × 0 - oraz SVG,
 * który nie deklaruje proporcji albo którego treści nie da się przeczytać).
 * Obietnica NIGDY nie jest odrzucana: brak pomiaru to dla wołającego "rozmiar
 * nieznany".
 *
 * Mierzymy ORYGINAŁ obiektem `Image` poza drzewem DOM - nigdy `naturalWidth`
 * wyrenderowanego `<img>`, bo ten przy `srcset` niesie rozmiar wybranego
 * wariantu, a nie pliku. Adres idzie przez `mediaRenderUrl` (ścieżka względna
 * `/media/...`, ta sama, którą panel pokazuje podglądy), więc świeżo wgrany
 * plik mierzy się także na hoście podglądu.
 *
 * Plik SVG jest czytany RÓWNOLEGLE z pomiarem i z tym samym limitem, więc
 * całość nadal rozstrzyga się najpóźniej po 5 s. Adres innego pliku nie
 * dostaje żadnego dodatkowego żądania.
 */
export function measureIntrinsicSize(url: string): Promise<string> {
  if (!url || typeof window === "undefined" || typeof window.Image !== "function") {
    return Promise.resolve("");
  }
  const probed = probeNaturalSize(url);
  if (!isSvgSource(url)) return probed;
  return Promise.all([probed, readSvgDeclaresRatio(url)]).then(([size, declares]) =>
    declares ? size : "",
  );
}
