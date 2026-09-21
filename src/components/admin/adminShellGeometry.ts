/**
 * JEDNO ŹRÓDŁO GEOMETRII POWŁOKI PANELU - dla `AdminShell` i dla jego SZKIELETU.
 *
 * PO CO TEN MODUŁ ISTNIEJE. Od 2026-09-20 (F32 / plan 3.13) serwer renderuje na
 * `/admin` wyłącznie `AdminShellSkeleton`, a właściwa powłoka montuje się po
 * hydratacji i rozstrzygnięciu sesji. Te dwa drzewa MUSZĄ mieć identyczne
 * pudełko, bo każda różnica między nimi jest przesunięciem układu liczonym
 * wprost do CLS. Dopóki obie strony przepisywały klasy z pamięci, parytet był
 * obietnicą, a nie mechanizmem: audyt CWV zmierzył na najemcy ze stylem paska
 * `style-4` przesunięcie 176 px (szkielet 224 px -> powłoka 48 px).
 *
 * DLACZEGO KLASY, A NIE LICZBY - dokładnie ten sam powód, co w
 * `components/header/headerGeometry.ts`: repozytorium skaluje `root font-size`
 * płynnie między 1280 a 1920 px, więc `w-56` to inna liczba pikseli przy
 * różnych szerokościach okna. Rezerwa zapisana liczbą rozjeżdża się z
 * elementem, który tę samą szerokość bierze z `rem` - i różnica wraca jako CLS.
 *
 * DLACZEGO `data-sidebar-style` JEST TU GEOMETRIĄ, A NIE DEKORACJĄ. To jest
 * druga połowa defektu 176 px i była niewidoczna w klasach Tailwinda:
 * `styles.css` nadaje `aside[data-sidebar="sidebar"][data-sidebar-style=...]`
 * twarde wymiary, które WYGRYWAJĄ z klasą szerokości:
 *   * `style-4` - `width: 3.5rem !important` (56 px), czyli ani `w-56`, ani
 *     `w-12` (48 px) nie opisuje realnej szerokości tego paska,
 *   * `style-3` - `margin: 0.75rem` i `height: calc(100vh - 1.5rem)`, czyli
 *     pasek zajmuje 24 px więcej w poziomie niż mówi jego klasa.
 * Szkielet bez tego atrybutu maluje więc INNY prostokąt niż powłoka, nawet gdy
 * obie deklarują tę samą klasę szerokości. Dlatego atrybut jest częścią
 * kontraktu tego modułu, a nie ozdobą powłoki.
 *
 * Moduł jest CELOWO BEZ ZALEŻNOŚCI RUNTIME (same stałe i czyste funkcje, jeden
 * import typu): stoi w drzewie importów szkieletu, czyli w tym samym miejscu,
 * które ma się wyrenderować, zanim cokolwiek innego zdąży się rozstrzygnąć.
 */
import type { SidebarStyle } from "@/lib/builder/sidebarStyles";

/**
 * Mapa znanych wariantów paska - `Record<SidebarStyle, true>`, nie tablica.
 *
 * MECHANIZM: brak klucza w takiej mapie jest BŁĘDEM TYPU, więc dołożenie
 * `style-7` do unii `SidebarStyle` nie ma jak przejść obok tego pliku. Tablica
 * `readonly SidebarStyle[]` tego nie łapie (`satisfies` sprawdza elementy,
 * nie kompletność), a to jest lista, której niekompletność oznacza cichy
 * powrót do geometrii domyślnej dla nowego wariantu.
 */
const KNOWN_SIDEBAR_STYLES: Record<SidebarStyle, true> = {
  "style-1": true,
  "style-2": true,
  "style-3": true,
  "style-4": true,
  "style-5": true,
  "style-6": true,
};

/** Czy wartość z ustawień najemcy jest wariantem, który ten kod zna. */
export function isSidebarStyle(value: unknown): value is SidebarStyle {
  return typeof value === "string" && Object.hasOwn(KNOWN_SIDEBAR_STYLES, value);
}

/**
 * JEDYNY wariant, który sam z siebie zwija pasek - `Style 4 - Compact Icon Rail`.
 * Pozostałe pięć zmienia wyłącznie tło, krawędź i promienie pozycji menu.
 */
export const COMPACT_SIDEBAR_STYLE: SidebarStyle = "style-4";

/** Czy ten wariant najemcy zwija pasek niezależnie od trasy. */
export function isCompactSidebarStyle(style: SidebarStyle | null | undefined): boolean {
  return style === COMPACT_SIDEBAR_STYLE;
}

/**
 * Decyzja „pasek zwinięty" - JEDNA formuła dla powłoki i dla szkieletu.
 *
 * `forceCompact` (przycisk w pasku) i `extras` (slot podstron, które wstawiają
 * do paska własną nawigację) zna wyłącznie powłoka; szkielet podaje tam
 * wartości domyślne, bo przed hydratacją żaden z tych stanów nie istnieje.
 */
export function isAdminSidebarCompact(input: {
  isEditRoute: boolean;
  style: SidebarStyle | null | undefined;
  forceCompact?: boolean;
  hasExtras?: boolean;
}): boolean {
  const { isEditRoute, style, forceCompact = false, hasExtras = false } = input;
  return ((isEditRoute || forceCompact) && !hasExtras) || isCompactSidebarStyle(style);
}

/** Korzeń powłoki. `flex` dokłada dopiero obecność paska (patrz niżej). */
export const ADMIN_SHELL_ROOT_CLASS = "admin-compact min-h-screen bg-muted/30";

/**
 * Korzeń z układem: `flex` stoi TYLKO wtedy, gdy obok treści stoi pasek.
 * Studio wydarzenia wymienia całą ramę panelu, więc korzeń jest tam blokiem -
 * szkielet z `flex` bez paska dałby inną szerokość treści niż powłoka po nim.
 */
export function adminShellRootClass(hideSidebar: boolean): string {
  return hideSidebar ? ADMIN_SHELL_ROOT_CLASS : `${ADMIN_SHELL_ROOT_CLASS} flex`;
}

/**
 * Rama paska BEZ szerokości - tło, krawędź, przyklejenie i jeden ekran
 * wysokości. `sidebar-shell` jest tu istotne: `styles.css` wiesza na tej klasie
 * przejście szerokości, a wariant `style-2` jej krawędź.
 */
export const ADMIN_SIDEBAR_FRAME_CLASS =
  "bg-card border-r border-border flex flex-col sticky top-0 self-start h-screen max-h-screen sidebar-shell";

/** Szerokości paska: rozwinięty 14 rem, zwinięty 3 rem. */
export const ADMIN_SIDEBAR_WIDTH_CLASS = { expanded: "w-56", compact: "w-12" } as const;

/** Klasa szerokości paska dla danej decyzji o zwinięciu. */
export function adminSidebarWidthClass(compact: boolean): string {
  return compact ? ADMIN_SIDEBAR_WIDTH_CLASS.compact : ADMIN_SIDEBAR_WIDTH_CLASS.expanded;
}

/** Blok marki na górze paska - wysokość bierze się z paddingu i wiersza niżej. */
export const ADMIN_SIDEBAR_BRAND_BOX_CLASS = "p-3 border-b border-border";

/**
 * Wiersz marki. Wysokość jest PRZYPIĘTA, bo zawartość zmienia się po pierwszym
 * malowaniu: dopóki `theme_options` nie przyjechało, renderuje się napis, a po
 * odpowiedzi bazy - logo najemcy. Bez przypięcia cała nawigacja zjeżdża w dół.
 */
export const ADMIN_SIDEBAR_BRAND_ROW_CLASS = { expanded: "h-9 flex-1", compact: "h-8 w-8" } as const;

/** Klasa wiersza marki dla danej decyzji o zwinięciu. */
export function adminSidebarBrandRowClass(compact: boolean): string {
  return compact ? ADMIN_SIDEBAR_BRAND_ROW_CLASS.compact : ADMIN_SIDEBAR_BRAND_ROW_CLASS.expanded;
}

/** Pole wyszukiwania panelu - istnieje WYŁĄCZNIE w wariancie rozwiniętym. */
export const ADMIN_SIDEBAR_SEARCH_BOX_CLASS = "p-2 border-b border-border";

/** Wysokość samego pola wyszukiwania. */
export const ADMIN_SIDEBAR_SEARCH_FIELD_CLASS = "h-7";

/** Trasy, na których powłoka oddaje treści cały oddech (własny pas narzędzi). */
export function isAdminThemeOptionsRoute(path: string): boolean {
  return path.startsWith("/admin/theme-options");
}

/**
 * Kolumna treści. `overflow-x-auto` i `min-w-0` dają tę samą minimalną
 * szerokość elastyczną (element z przewijaniem ma automatyczne minimum 0), ale
 * różnią się zachowaniem przy szerokiej tabeli - dlatego wybór idzie tą samą
 * gałęzią co padding.
 */
export function adminContentColumnClass(input: {
  hideSidebar: boolean;
  isEditRoute: boolean;
}): string {
  const { hideSidebar, isEditRoute } = input;
  return `${isEditRoute ? "min-w-0" : "overflow-x-auto"} ${hideSidebar ? "w-full" : "flex-1"}`;
}

/**
 * Padding treści - TRZY rozłączne warianty, i to jest druga (cichsza) połowa
 * parytetu. Szkielet rysował dotąd `p-4 md:p-6`, a powłoka na tych samych
 * trasach `px-3 py-4 lg:px-5 lg:py-6` (albo `p-2` w edytorze): każdy ekran
 * panelu przesuwał się więc przy podmianie o 4-16 px w poziomie, na KAŻDEJ
 * trasie naraz, niezależnie od wariantu paska.
 */
export function adminContentPaddingClass(input: {
  isEditRoute: boolean;
  isThemeOptions: boolean;
}): string {
  const { isEditRoute, isThemeOptions } = input;
  if (isEditRoute) return "p-2";
  if (isThemeOptions) return "w-full py-4 lg:py-6 pl-3 lg:pl-4 pr-4 lg:pr-6";
  return "w-full px-3 py-4 lg:px-5 lg:py-6";
}

/**
 * Wariant paska WPROST z mapy `site_settings` - bez react-query i bez sieci.
 *
 * PO CO OSOBNE CZYTANIE, skoro powłoka ma `resolveSetting`. Bo to jest odczyt
 * dla renderu PRZED hydratacją: `resolveSetting` scala z wbudowanymi domyślnymi
 * i nie odróżnia „najemca ma style-1" od „jeszcze nie wiem", a te dwa stany
 * prowadzą do dwóch różnych geometrii. Tutaj brak wartości musi zostać brakiem
 * (`null`), żeby wołający mógł sięgnąć po następne źródło zamiast zarezerwować
 * cudzy prostokąt.
 *
 * Nieznany napis (najemca zapisał wariant z nowszego wydania, ręczna edycja
 * wiersza) też jest `null`: lepiej zarezerwować geometrię domyślną niż postawić
 * atrybut, którego arkusz nie zna.
 */
export function sidebarStyleFromSettings(settings: unknown): SidebarStyle | null {
  if (!settings || typeof settings !== "object") return null;
  const themeOptions = (settings as Record<string, unknown>).theme_options;
  if (!themeOptions || typeof themeOptions !== "object") return null;
  const sidebars = (themeOptions as Record<string, unknown>).sidebars;
  if (!sidebars || typeof sidebars !== "object") return null;
  const style = (sidebars as Record<string, unknown>).style;
  return isSidebarStyle(style) ? style : null;
}
