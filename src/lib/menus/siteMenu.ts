// Reguły PUBLICZNEGO menu witryny - wyprowadzone z `components/menu/SiteMenu.tsx`.
//
// DLACZEGO OSOBNY MODUŁ. `SiteMenu` renderuje nawigację w nagłówku KAŻDEJ
// strony (SSR od pierwszego bajtu), a w pomiarze stał na 0 z 47 funkcji.
// Powód był ten sam, co przy edytorze: reguły siedziały w ciele komponentów -
// wybór wariantu panelu w `DropdownPanel`, źródło kolumn w `MegaPanel`,
// arytmetyka pozycjonowania w anonimowym IIFE wewnątrz `createPortal`.
// Test tych reguł wymagał portalu, `getBoundingClientRect` i `requestAnimationFrame`.
//
// Moduł zwraca WYŁĄCZNIE dane i decyzje - żadnych gotowych napisów. Teksty
// widoczne dla czytelnika zostają w komponencie, bo to on ma dostęp do języka
// strony i do słownika.
import { safeUrl } from "@/lib/sanitizePure";
export {
  filterMenuItemsForViewer,
  isVisibleForViewer,
  normalizeMenuVisibility,
} from "./visibility";
import { DEFAULT_MEGA_CONFIG, megaConfigSchema } from "./types";
import type { MegaColumn, MegaConfig, MenuItemRow } from "./types";

export type SiteMenuLang = "pl" | "en";

export interface SiteMenuNode extends MenuItemRow {
  children: SiteMenuNode[];
}

/** Wariant, w jakim pozycja najwyższego poziomu pokazuje się w nagłówku. */
export type MenuPanelKind = "link" | "dropdown" | "mega";

/**
 * Buduje drzewo nawigacji publicznej. Pozycja wskazująca rodzica spoza wyniku
 * (skasowany, odfiltrowany przez RLS) wraca na najwyższy poziom - lepiej
 * pokazać ją bez kontekstu, niż wyciąć całą gałąź nawigacji.
 */
export function buildPublicMenuTree(items: readonly MenuItemRow[]): SiteMenuNode[] {
  const byId = new Map<string, SiteMenuNode>();
  for (const it of items) byId.set(it.id, { ...it, children: [] });
  const roots: SiteMenuNode[] = [];
  for (const it of items) {
    const node = byId.get(it.id);
    if (!node) continue;
    if (it.parent_id && byId.has(it.parent_id)) {
      byId.get(it.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortRec = (arr: SiteMenuNode[]) => {
    arr.sort((a, b) => a.position - b.position);
    for (const n of arr) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/**
 * Etykieta pozycji w danym języku, z zejściem na drugi język.
 *
 * Pusty wynik jest SYGNAŁEM, nie tekstem: pozycja bez nazwy w obu wersjach
 * nie ma się czym przedstawić, więc znika z nawigacji (patrz
 * `isMenuItemVisible`). To jedyna reguła widoczności, jaką ma to menu -
 * pozycje nie mają pól roli, języka ani flagi.
 */
export function pickMenuLabel(item: MenuItemRow, lang: SiteMenuLang): string {
  const primary = lang === "en" ? item.label_en : item.label_pl;
  return (primary || item.label_pl || item.label_en || "").trim();
}

/** Pozycja bez etykiety w OBU językach nie trafia do nawigacji. */
export function isMenuItemVisible(item: MenuItemRow, lang: SiteMenuLang): boolean {
  return pickMenuLabel(item, lang).length > 0;
}

/** Adres pozycji przepuszczony przez sanityzację (`javascript:` itp. odpada). */
export function menuItemHref(item: Pick<MenuItemRow, "href">): string {
  return safeUrl(item.href || "#") || "#";
}

export function menuItemTarget(item: Pick<MenuItemRow, "target">): "_self" | "_blank" {
  return item.target === "_blank" ? "_blank" : "_self";
}

/** `rel` wymagany przy otwieraniu w nowej karcie (reverse tabnabbing). */
export function menuItemRel(item: Pick<MenuItemRow, "target">): string | undefined {
  return menuItemTarget(item) === "_blank" ? "noopener noreferrer" : undefined;
}

/** Czy pozycja ma wnuki - to ona decyduje o AUTOMATYCZNEJ promocji do mega. */
export function hasNestedChildren(node: Pick<SiteMenuNode, "children">): boolean {
  return node.children.length > 0 && node.children.some((c) => c.children.length > 0);
}

/**
 * Wariant panelu pozycji najwyższego poziomu.
 *
 * Mega wchodzi nie tylko z jawnej zgody administratora (`mega_enabled`), ale
 * też AUTOMATYCZNIE, gdy pozycja ma wnuki: płaska lista nie umiałaby pokazać
 * drugiego poziomu, więc zagnieżdżone menu awansuje na układ redakcyjny.
 */
export function panelKindFor(node: SiteMenuNode): MenuPanelKind {
  if (node.mega_enabled || hasNestedChildren(node)) return "mega";
  return node.children.length > 0 ? "dropdown" : "link";
}

/** Czy pozycja w ogóle otwiera panel (trigger `<button>` zamiast linku). */
export function hasPanel(node: SiteMenuNode): boolean {
  return node.mega_enabled || node.children.length > 0;
}

/**
 * Źródło kolumn mega panelu: ręczna konfiguracja administratora, a gdy jej
 * nie ma - układ wyprowadzony z dzieci i wnuków pozycji. Dzięki temu mega menu
 * działa od razu po zbudowaniu struktury, bez osobnego wypełniania kolumn.
 */
export function megaColumnsFor(node: SiteMenuNode): MegaColumn[] {
  const configured = node.mega_config?.columns ?? [];
  if (configured.length > 0) {
    return configured.map((col) => ({
      title_pl: col.title_pl,
      title_en: col.title_en,
      href: col.href,
      links: (col.links ?? []).map((l) => ({
        label_pl: l.label_pl,
        label_en: l.label_en,
        href: l.href,
        icon: l.icon ?? "",
      })),
    }));
  }
  return node.children.map((child) => ({
    title_pl: child.label_pl,
    title_en: child.label_en,
    href: child.href,
    links: child.children.map((gc) => ({
      label_pl: gc.label_pl,
      label_en: gc.label_en,
      href: gc.href,
      icon: "",
    })),
  }));
}

/** Panel bez kolumn i bez dzieci nie ma czego pokazać - nie renderujemy go. */
export function megaPanelHasContent(node: SiteMenuNode): boolean {
  return megaColumnsFor(node).length > 0 || node.children.length > 0;
}

export interface MobileMegaLink {
  label: string;
  href: string;
}

/**
 * Spłaszczone linki mega panelu dla akordeonu mobilnego. Wariant mobilny nie
 * ma kolumn, więc jedyne, co może zrobić z konfiguracją administratora, to
 * pokazać jej linki po kolei - inaczej treść ustawiona na desktopie znika na
 * telefonie bez śladu.
 */
export function mobileMegaLinks(node: SiteMenuNode, lang: SiteMenuLang): MobileMegaLink[] {
  if (!node.mega_enabled) return [];
  return (node.mega_config?.columns ?? []).flatMap((col) =>
    (col.links ?? []).map((lnk) => ({
      label: (lang === "en" ? lnk.label_en : lnk.label_pl) || lnk.label_pl || "",
      href: safeUrl(lnk.href) || "#",
    })),
  );
}

/** Maksymalna szerokość panelu redakcyjnego i zwykłego dropdownu. */
const MEGA_MAX_WIDTH = 1120;
const DROPDOWN_MAX_WIDTH = 360;
/** Szerokość panelu mega w trybie „container" (CSS widoku, `megaPanelCssWidth`). */
const MEGA_CONTAINER_WIDTH = 980;
/** Margines od krawędzi okna - panel nigdy nie dotyka brzegu ekranu. */
const VIEWPORT_GUTTER = 16;

/** Szerokość panelu mega wybrana w edytorze (`mega_config.width`). */
export type MegaPanelWidth = MegaConfig["width"];

/** Ustawienia układu panelu mega, które redaktor wybiera w edytorze menu. */
export interface MegaPanelLayout {
  /** Ile kolumn nawigacji mieści się w jednym rzędzie siatki (1-6). */
  columnsPerRow: number;
  width: MegaPanelWidth;
}

/**
 * Układ panelu mega z konfiguracji pozycji.
 *
 * Do 03.10.2026 edytor zapisywał „kolumn w rzędzie" i „szerokość", a widok
 * ich NIE CZYTAŁ: siatka miała na sztywno najwyżej cztery kolumny, panel
 * zawsze 980 px. Redaktor zmieniał ustawienie, zapisywał - i nic się nie
 * działo, ani w podglądzie, ani na stronie.
 *
 * Granice i wartości domyślne pochodzą ze SCHEMATU (`megaConfigSchema`), więc
 * edytor, zapis i render nie mogą się rozjechać. Każde pole sprawdzamy
 * OSOBNO: rekord z jednym uszkodzonym polem (np. ręczna edycja JSON-a
 * w bazie) traci tylko to pole, a nie cały układ - inaczej niż
 * `parseMegaConfig`, które przy dowolnym błędzie oddaje całą konfigurację
 * domyślną. Brak konfiguracji daje dokładnie dotychczasowy wygląd.
 */
export function megaPanelLayout(
  config: { columns_per_row?: unknown; width?: unknown } | null | undefined,
): MegaPanelLayout {
  const perRow = megaConfigSchema.shape.columns_per_row.safeParse(config?.columns_per_row);
  const width = megaConfigSchema.shape.width.safeParse(config?.width);
  return {
    columnsPerRow: perRow.success ? perRow.data : DEFAULT_MEGA_CONFIG.columns_per_row,
    width: width.success ? width.data : DEFAULT_MEGA_CONFIG.width,
  };
}

/**
 * Liczba kolumn siatki nawigacji panelu: tyle, ile jest kolumn treści, ale
 * nie więcej niż `columnsPerRow` - nadmiar przechodzi do kolejnego rzędu.
 * Pusty panel i tak się nie renderuje, ale siatka nigdy nie dostaje zera.
 */
export function megaNavColumns(columnCount: number, columnsPerRow: number): number {
  return Math.max(1, Math.min(columnCount, columnsPerRow));
}

/**
 * Szerokość CSS panelu mega osadzonego w nagłówku strony.
 *
 * „container" to DOKŁADNIE dotychczasowa wartość (`min(980px, calc(100vw -
 * 32px))`) - istniejące menu nie mogą zmienić wyglądu przez to, że ustawienie
 * zaczęło działać. „full" to całe okno minus ten sam margines z każdej strony.
 * Margines jest wspólny z `panelGeometry`, bo to ona ustawia lewą krawędź
 * panelu - rozjazd tych liczb wypycha panel poza ekran.
 */
export function megaPanelCssWidth(width: MegaPanelWidth): string {
  const viewport = `calc(100vw - ${2 * VIEWPORT_GUTTER}px)`;
  return width === "full" ? viewport : `min(${MEGA_CONTAINER_WIDTH}px, ${viewport})`;
}

export interface PanelGeometryInput {
  isMega: boolean;
  /** Lewa krawędź triggera względem viewportu (`getBoundingClientRect`). */
  anchorLeft: number;
  viewportWidth: number;
  /** Szerokość panelu mega (`mega_config.width`); brak = „container". */
  megaWidth?: MegaPanelWidth;
}

export interface PanelGeometry {
  /** Szerokość ZAŁOŻONA do dociśnięcia panelu; sam panel mierzy się własnym CSS-em. */
  width: number;
  left: number;
}

/**
 * Pozycja panelu w oknie. Mega jest WYŚRODKOWANY względem viewportu (jest
 * szeroki, kotwiczenie do triggera wypychałoby go poza ekran), a zwykły
 * dropdown trzyma się triggera z dociśnięciem do krawędzi.
 *
 * Mega w trybie „full" zajmuje całe okno minus margines (`megaPanelCssWidth`),
 * więc jego lewa krawędź to sam margines. Liczony z założoną szerokością trybu
 * „container" stanąłby na ekranie 1440 px w odległości 160 px od lewej, a panel
 * szerokości okna (1408 px) wystawałby wtedy 128 px poza prawą krawędź.
 *
 * Reguła żyła w anonimowym IIFE wewnątrz `createPortal` - jedynym sposobem na
 * jej sprawdzenie było zamontowanie portalu i podstawienie wymiarów okna.
 */
export function panelGeometry({
  isMega,
  anchorLeft,
  viewportWidth,
  megaWidth,
}: PanelGeometryInput): PanelGeometry {
  const maxWidth = !isMega
    ? DROPDOWN_MAX_WIDTH
    : megaWidth === "full"
      ? Number.POSITIVE_INFINITY
      : MEGA_MAX_WIDTH;
  const width = Math.min(maxWidth, viewportWidth - 2 * VIEWPORT_GUTTER);
  const left = isMega
    ? Math.round((viewportWidth - width) / 2)
    : Math.max(VIEWPORT_GUTTER, Math.min(anchorLeft, viewportWidth - width - VIEWPORT_GUTTER));
  return { width, left };
}

/**
 * Czy pozycja menu odpowiada bieżącej ścieżce.
 *
 * Reguła jest tu, bo należy do menu, a nie do komponentu - ale nagłówek jej
 * jeszcze NIE UŻYWA: podświetlenie aktywnej sekcji to zmiana zachowania
 * ścieżki krytycznej każdej strony i idzie osobną decyzją. Kontrakt jest ten
 * sam, co w dolnym pasku mobilnym (`activeBottomBarIndex`): porównanie po
 * zdjęciu prefiksu języka, dopasowanie po najdłuższym pasującym prefiksie
 * ŚCIEŻKI (a nie po fragmencie tekstu), strona główna wyłącznie na dokładne
 * trafienie.
 */
export function isMenuPathActive(itemHref: string, pathname: string): boolean {
  const item = canonicalMenuPath(itemHref);
  const current = canonicalMenuPath(pathname);
  if (item === "/") return current === "/";
  return current === item || current.startsWith(`${item}/`);
}

/** Ścieżka bez adresu bazowego, query, hasha, prefiksu języka i końcowych ukośników. */
export function canonicalMenuPath(raw: string): string {
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/i, "");
  const withoutQuery = (withoutOrigin || "/").split(/[?#]/)[0];
  const withoutLang = withoutQuery.replace(/^\/en(?=\/|$)/, "");
  return withoutLang.replace(/\/+$/, "") || "/";
}

/**
 * Indeks pozycji najlepiej pasującej do ścieżki (-1 = żadna). Wygrywa
 * NAJDŁUŻSZE dopasowanie, więc `/blog/analizy` podświetla „Analizy", a nie
 * ogólniejszy „Blog".
 */
export function activeMenuIndex(nodes: readonly SiteMenuNode[], pathname: string): number {
  let best = -1;
  let bestLen = -1;
  nodes.forEach((node, index) => {
    if (!isMenuPathActive(node.href, pathname)) return;
    const len = canonicalMenuPath(node.href).length;
    if (len > bestLen) {
      best = index;
      bestLen = len;
    }
  });
  return best;
}
