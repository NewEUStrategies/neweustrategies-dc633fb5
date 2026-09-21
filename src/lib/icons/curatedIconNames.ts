// ZESTAW KURATOROWANY JAKO CZYSTE DANE - lista, którą czyta bramka CI.
//
// DLACZEGO OSOBNY PLIK. Skład zestawu mieszka w `DynamicIcon.tsx` jako mapa
// nazwa -> KOMPONENT, więc każdy, kto chciałby odczytać sam SKŁAD, musiałby
// zaimportować `lucide-react` razem z Reactem. Bramka `check:menu-icons`
// biegnie pod bun-em w jobie `verify` (bez builda, bez przeglądarki, bez bazy)
// i potrzebuje wyłącznie NAZW - dlatego nazwy żyją tutaj, w module bez ani
// jednego importu.
//
// DWIE LISTY TO RYZYKO ROZJAZDU - i dlatego rozjazd jest ZAPIĘTY TESTEM.
// `src/lib/icons/__tests__/curatedIconNames.test.tsx` porównuje tę listę
// z `CURATED_ICON_KEYS` (kluczami prawdziwej mapy) w obie strony, więc ikona
// dopisana do mapy bez dopisania tutaj - albo odwrotnie - oblewa suitę. Bez
// tego testu bramka zaczęłaby mierzyć listę, która nie opisuje już niczego.
//
// KOSZT NAZWY SPOZA TEJ LISTY. `DynamicIcon` dla nieznanej nazwy dociąga
// leniwy chunk pełnego rejestru ikon (`lucideIconNodes.generated.ts`:
// 473 KB źródeł, 109 KB gzip). W treści i w panelu to poprawny kompromis;
// w chrome (menu, mega panel, pasek dolny) nazwy pochodzą z konfiguracji
// w bazie, więc jedna literówka redaktora kosztowałaby ten chunk KAŻDEGO
// anonima. Stąd bramka i stąd `MenuIcon` (wariant bez prawa do rejestru).

/**
 * Kanoniczne nazwy zestawu w kebab-case - w takiej postaci trzymają je
 * konfiguracje (menu, pasek dolny, szablony podstron) i baza.
 */
export const CURATED_ICON_NAMES: readonly string[] = [
  "alert-triangle",
  "arrow-left",
  "arrow-right",
  "arrow-up-right",
  "award",
  "banknote",
  "bar-chart-3",
  "bell",
  "book-open",
  "bookmark",
  "briefcase",
  "building",
  "building-2",
  "calendar",
  "calendar-clock",
  "calendar-days",
  "camera",
  "check",
  "check-circle-2",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "chevron-up",
  "circle",
  "circle-user",
  "clipboard-list",
  "clock",
  "compass",
  "cpu",
  "credit-card",
  "crown",
  "database",
  "dollar-sign",
  "download",
  "euro",
  "external-link",
  "eye",
  "facebook",
  "factory",
  "file-text",
  "flag",
  "flame",
  "folder",
  "folder-open",
  "gavel",
  "github",
  "globe",
  "globe-2",
  "graduation-cap",
  "handshake",
  "headphones",
  "heart",
  "help-circle",
  "home",
  "image",
  "info",
  "instagram",
  "landmark",
  "layers",
  "layout-dashboard",
  "leaf",
  "library",
  "life-buoy",
  "lightbulb",
  "line-chart",
  "link",
  "linkedin",
  "list",
  "list-checks",
  "lock",
  "log-in",
  "log-out",
  "mail",
  "map",
  "map-pin",
  "megaphone",
  "menu",
  "message-circle",
  "message-square",
  "messages-square",
  "mic",
  "moon",
  "newspaper",
  "pencil",
  "phone",
  "pie-chart",
  "plane",
  "play",
  "podcast",
  "radio",
  "rocket",
  "rss",
  "scale",
  "search",
  "settings",
  "share-2",
  "shield",
  "shield-check",
  "ship",
  "shopping-bag",
  "shopping-cart",
  "sliders-horizontal",
  "sparkles",
  "star",
  "sun",
  "tag",
  "tags",
  "target",
  "ticket",
  "trending-down",
  "trending-up",
  "trophy",
  "truck",
  "twitter",
  "user",
  "user-check",
  "user-circle",
  "user-plus",
  "users",
  "users-round",
  "video",
  "wifi",
  "x",
  "youtube",
  "zap",
];

/**
 * Normalizacja nazwy do postaci kanonicznej - DOKŁADNIE ta sama ścieżka, którą
 * idzie `DynamicIcon` w przeglądarce: rozbicie po `-`, `_` i spacji, sklejenie
 * w PascalCase, a potem rozbicie z powrotem na kebab. Dzięki temu bramka
 * ocenia te same napisy, które ocenia runtime: `"graduation cap"`,
 * `"graduation_cap"`, `"GraduationCap"` i `"graduation-cap"` to jedna ikona,
 * a `"logIn"` i `"LogIn"` nie rozjeżdżają się na `"log-in"` kontra `"login"`.
 *
 * Pusta nazwa oddaje pusty napis - to nie jest usterka, tylko „bez ikony"
 * (tak zapisuje się nowy wiersz menu), więc bramka takiego wpisu nie zgłasza.
 */
export function normalizeIconName(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  const pascal = /[-_\s]/.test(trimmed)
    ? trimmed
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join("")
    : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

const KURATOROWANE = new Set(CURATED_ICON_NAMES);

/** Czy nazwa renderuje się SYNCHRONICZNIE, bez leniwego chunka rejestru. */
export function isCuratedIconName(raw: string): boolean {
  const name = normalizeIconName(raw);
  return name.length > 0 && KURATOROWANE.has(name);
}
