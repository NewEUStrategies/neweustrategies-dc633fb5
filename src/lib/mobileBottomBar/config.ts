// Konfiguracja mobilnego paska dolnego (animated bottom bar).
//
// Jedno źródło prawdy dla:
//  - publicznego komponentu <MobileBottomBar /> (montowany w SiteChrome),
//  - panelu Admin → Ustawienia → Pasek mobilny.
//
// Zapis w site_settings[key="mobile_bottom_bar"], odczyt przez współdzielony
// bulk query useSiteSetting(). Treści są dwujęzyczne (PL/EN), kolory osobno dla
// trybu jasnego i ciemnego.
import { safeUrl } from "@/lib/sanitize";

export const MOBILE_BOTTOM_BAR_SETTINGS_KEY = "mobile_bottom_bar";

export type MobileBottomBarItem = {
  id: string;
  /** Etykieta pokazywana pod ikoną (i jako aria-label). */
  label_pl: string;
  label_en: string;
  /** Nazwa ikony Lucide w kebab-case (DynamicIcon). */
  icon: string;
  /** Adres docelowy - ścieżka wewnętrzna albo pełny URL. */
  href: string;
  /** Kolor akcentu aktywnej pozycji (hex/rgb/hsl). */
  color: string;
  enabled: boolean;
};

export type MobileBottomBarConfig = {
  enabled: boolean;
  /** Pokazuj etykiety tekstowe pod ikonami. */
  show_labels: boolean;
  /** Chowaj pasek przy przewijaniu w dół, pokazuj przy przewijaniu w górę. */
  hide_on_scroll: boolean;
  /** Odstęp od dolnej krawędzi ekranu w px (0-40). */
  offset_bottom: number;
  /** Zaokrąglenie pigułki paska w px (0-40). */
  radius: number;
  /** Tło paska - osobno dla trybu jasnego i ciemnego. */
  background_light: string;
  background_dark: string;
  /** Kolor nieaktywnych ikon. */
  icon_light: string;
  icon_dark: string;
  /** Aktywna pozycja używa własnego koloru pozycji zamiast koloru marki. */
  use_item_color: boolean;
  items: MobileBottomBarItem[];
};

export const MOBILE_BOTTOM_BAR_DEFAULTS: MobileBottomBarConfig = {
  enabled: false,
  show_labels: true,
  hide_on_scroll: true,
  offset_bottom: 12,
  radius: 26,
  background_light: "#ffffff",
  background_dark: "#111318",
  icon_light: "#6b7280",
  icon_dark: "#9aa3b2",
  use_item_color: true,
  items: [
    {
      id: "home",
      label_pl: "Start",
      label_en: "Home",
      icon: "house",
      href: "/",
      color: "#ff8c00",
      enabled: true,
    },
    {
      id: "explore",
      label_pl: "Analizy",
      label_en: "Analysis",
      icon: "newspaper",
      href: "/analizy",
      color: "#f54888",
      enabled: true,
    },
    {
      id: "experts",
      label_pl: "Eksperci",
      label_en: "Experts",
      icon: "users",
      href: "/experts",
      color: "#4343f5",
      enabled: true,
    },
    {
      id: "search",
      label_pl: "Szukaj",
      label_en: "Search",
      icon: "search",
      href: "/search",
      color: "#e0b115",
      enabled: true,
    },
    {
      id: "profile",
      label_pl: "Profil",
      label_en: "Profile",
      icon: "user",
      href: "/profile",
      color: "#65ddb7",
      enabled: true,
    },
  ],
};

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\)|[a-z]{3,20})$/i;

/** Kolor bezpieczny do wstawienia w atrybut style (odrzuca próby wstrzyknięcia CSS). */
export function safeBarColor(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return v && COLOR_RE.test(v) ? v : fallback;
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export const clampOffset = (value: unknown): number => clampNumber(value, 0, 40, 12);
export const clampRadius = (value: unknown): number => clampNumber(value, 0, 40, 26);

/** Maksymalna liczba pozycji, przy której pasek pozostaje czytelny na 320 px. */
export const MAX_BOTTOM_BAR_ITEMS = 6;

export function newBottomBarItem(index: number): MobileBottomBarItem {
  return {
    id: `item-${Date.now().toString(36)}-${index}`,
    label_pl: "Nowa pozycja",
    label_en: "New item",
    icon: "circle",
    href: "/",
    color: "#4343f5",
    enabled: true,
  };
}

/** Pozycje widoczne publicznie (włączone, z bezpiecznym adresem). */
export function visibleBottomBarItems(cfg: MobileBottomBarConfig): MobileBottomBarItem[] {
  return (Array.isArray(cfg.items) ? cfg.items : [])
    .filter((item) => item && item.enabled !== false)
    .slice(0, MAX_BOTTOM_BAR_ITEMS)
    .map((item) => ({ ...item, href: safeUrl(item.href, "/") }));
}

/** Etykieta pozycji dla bieżącego języka, z fallbackiem na drugi język. */
export function bottomBarLabel(item: MobileBottomBarItem, lang: string): string {
  const pl = (item.label_pl ?? "").trim();
  const en = (item.label_en ?? "").trim();
  return lang.startsWith("pl") ? pl || en : en || pl;
}

/** Indeks pozycji dopasowanej do bieżącej ścieżki (najdłuższy pasujący prefiks). */
export function activeBottomBarIndex(items: MobileBottomBarItem[], pathname: string): number {
  let best = -1;
  let bestLen = -1;
  items.forEach((item, index) => {
    const href = (item.href || "").split("?")[0].replace(/\/$/, "") || "/";
    const path = pathname.replace(/\/$/, "") || "/";
    const matches = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
    if (matches && href.length > bestLen) {
      best = index;
      bestLen = href.length;
    }
  });
  return best;
}
