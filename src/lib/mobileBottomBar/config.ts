// Konfiguracja mobilnego paska dolnego (animated bottom bar).
//
// Jedno źródło prawdy dla:
//  - publicznego komponentu <MobileBottomBar /> (montowany w SiteChrome),
//  - panelu Admin → Ustawienia → Pasek mobilny.
//
// Zapis w site_settings[key="mobile_bottom_bar"] (PK = tenant_id + key, więc
// każdy tenant ma własny pasek), odczyt przez współdzielony bulk query
// useSiteSetting(). Treści są dwujęzyczne (PL/EN) z fallbackiem na klucz i18n,
// a kolory - w tym akcent aktywnej pozycji - są rozdzielone na tryb jasny i
// ciemny, żeby kontrast nie zależał od motywu.
import { safeUrl } from "@/lib/sanitizePure";
import { DEFAULT_LANG, localizedPath, normalizeLang, stripLangPrefix } from "@/lib/i18n/localePath";
import { uiLang } from "@/lib/i18n/format";
import { pickLocalized } from "@/lib/i18n/pickLocalized";

export const MOBILE_BOTTOM_BAR_SETTINGS_KEY = "mobile_bottom_bar";

/**
 * Źródło licznika przy ikonie. Każde odpowiada istniejącemu, autoryzowanemu
 * hookowi (czat / sieć / powiadomienia) i jest ładowane leniwie dopiero dla
 * zalogowanego użytkownika - guest nie pobiera ani bajta tych modułów.
 */
export const BOTTOM_BAR_BADGE_SOURCES = [
  "none",
  "chat",
  "network",
  "notifications",
  // Kluby dyskusyjne. `user_pending_counters.club_unread` istniał od A18
  // i nie miał po stronie klienta ani jednego czytelnika - baza utrzymywała
  // licznik triggerem dla nikogo.
  "clubs",
] as const;
export type BottomBarBadgeSource = (typeof BOTTOM_BAR_BADGE_SOURCES)[number];

export function normalizeBadgeSource(value: unknown): BottomBarBadgeSource {
  return BOTTOM_BAR_BADGE_SOURCES.includes(value as BottomBarBadgeSource)
    ? (value as BottomBarBadgeSource)
    : "none";
}

export type MobileBottomBarItem = {
  id: string;
  /**
   * Klucz i18n etykiety (np. "mobileBottomBar.itemLabels.home"). Używany, dopóki
   * administrator nie wpisze własnej etykiety - dzięki temu domyślne pozycje
   * tłumaczą się razem z resztą serwisu, a nie zamrażają tekstu w bazie.
   */
  label_key?: string;
  /** Nadpisanie etykiety (pokazywanej pod ikoną i jako aria-label). */
  label_pl: string;
  label_en: string;
  /** Nazwa ikony Lucide w kebab-case (DynamicIcon). */
  icon: string;
  /** Adres docelowy - ścieżka wewnętrzna albo pełny URL. */
  href: string;
  /** Kolor akcentu aktywnej pozycji w trybie jasnym (hex/rgb/hsl). */
  color: string;
  /** Kolor akcentu w trybie ciemnym; puste = ten sam co jasny. */
  color_dark?: string;
  /** Licznik nieprzeczytanych przy ikonie. */
  badge?: BottomBarBadgeSource;
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

/**
 * Zaokrąglenie pigułki paska. 20 px to `2em` z referencyjnego komponentu przy
 * jego bazie 10 px - przy wysokości paska ~44 px daje pełną pigułkę, w której
 * garb nad aktywną pozycją czyta się jako ciągła sylwetka.
 */
export const DEFAULT_BAR_RADIUS = 20;
/** Domyślny odstęp paska od dolnej krawędzi (ponad safe-area). */
export const DEFAULT_BAR_OFFSET = 12;

export const MOBILE_BOTTOM_BAR_DEFAULTS: MobileBottomBarConfig = {
  enabled: true,
  // Wygląd referencyjny jest BEZ podpisów: aktywna pozycja unosi się w garb i
  // dostaje wypełnione koło, a etykieta zostaje nazwą dostępną (sr-only).
  // Administrator może podpisy włączyć - wtedy unos jest o połowę krótszy.
  show_labels: false,
  hide_on_scroll: true,
  offset_bottom: DEFAULT_BAR_OFFSET,
  radius: DEFAULT_BAR_RADIUS,
  background_light: "#ffffff",
  background_dark: "#111318",
  icon_light: "#6b7280",
  icon_dark: "#9aa3b2",
  use_item_color: true,
  // Kolejność jest częścią kontraktu produktowego: pięć pozycji, strona główna
  // dokładnie na środku (indeks 2), czyli pod kciukiem. Etykiety idą z i18n
  // (label_key), więc PL/EN nie rozjeżdżają się z resztą serwisu.
  // Ikony należą do kuratorowanego zestawu DynamicIcon - renderują się
  // synchronicznie, bez dociągania pełnego rejestru lucide.
  items: [
    {
      id: "network",
      label_key: "mobileBottomBar.itemLabels.network",
      label_pl: "",
      label_en: "",
      icon: "users",
      href: "/network",
      color: "#2f6df6",
      color_dark: "#7aa7ff",
      badge: "network",
      enabled: true,
    },
    {
      id: "chats",
      label_key: "mobileBottomBar.itemLabels.chats",
      label_pl: "",
      label_en: "",
      icon: "messages-square",
      href: "/messages",
      color: "#0a8f6d",
      color_dark: "#3fd7ab",
      badge: "chat",
      enabled: true,
    },
    {
      id: "home",
      label_key: "mobileBottomBar.itemLabels.home",
      label_pl: "",
      label_en: "",
      icon: "home",
      href: "/",
      // brand-ink / brand: te same wartości, których używa reszta serwisu na
      // jasnym i ciemnym tle (kontrast AA w obu motywach).
      color: "#FA9346",
      color_dark: "#fa9346",
      badge: "none",
      enabled: true,
    },
    {
      id: "clubs",
      label_key: "mobileBottomBar.itemLabels.clubs",
      label_pl: "",
      label_en: "",
      icon: "landmark",
      href: "/club",
      color: "#6d3fd4",
      color_dark: "#b79bff",
      badge: "clubs",
      enabled: true,
    },
    {
      id: "profile",
      label_key: "mobileBottomBar.itemLabels.profile",
      label_pl: "",
      label_en: "",
      icon: "circle-user",
      href: "/profile",
      color: "#be123c",
      color_dark: "#fb7185",
      badge: "none",
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

/** Akcent pozycji dla wskazanego motywu; ciemny spada z powrotem na jasny. */
export function itemAccent(
  item: MobileBottomBarItem | undefined,
  theme: "light" | "dark",
  fallback: string,
): string {
  if (!item) return fallback;
  const light = safeBarColor(item.color, fallback);
  return theme === "light" ? light : safeBarColor(item.color_dark, light);
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export const clampOffset = (value: unknown): number =>
  clampNumber(value, 0, 40, DEFAULT_BAR_OFFSET);
export const clampRadius = (value: unknown): number =>
  clampNumber(value, 0, 40, DEFAULT_BAR_RADIUS);

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
    color_dark: "#8f8ffb",
    badge: "none",
    enabled: true,
  };
}

/**
 * Kanoniczne adresy pozycji systemowych. Pasek jest konfigurowalny, ale te
 * cztery skróty prowadzą do KONKRETNYCH modułów serwisu - jeżeli zapisana
 * konfiguracja tenanta pamięta stary adres (np. sprzed przeniesienia klubów),
 * kliknięcie lądowało poza modułem. Adres z bazy jest więc naprawiany do
 * kanonicznego wyłącznie dla znanych identyfikatorów; własne pozycje admina
 * (id `item-*`) zostają nietknięte.
 */
export const CANONICAL_ITEM_HREFS: Readonly<Record<string, string>> = {
  network: "/network",
  chats: "/messages",
  home: "/",
  clubs: "/club",
  profile: "/profile",
};

/** Pozycje widoczne publicznie (włączone, z bezpiecznym adresem i badge'em). */
export function visibleBottomBarItems(cfg: MobileBottomBarConfig): MobileBottomBarItem[] {
  return (Array.isArray(cfg.items) ? cfg.items : [])
    .filter((item) => item && item.enabled !== false)
    .slice(0, MAX_BOTTOM_BAR_ITEMS)
    .map((item) => ({
      ...item,
      href: CANONICAL_ITEM_HREFS[item.id] ?? safeUrl(item.href, "/"),
      badge: normalizeBadgeSource(item.badge),
    }));
}

/** Tłumacz etykiet - podzbiór `t` z i18next, żeby config został czysty i testowalny. */
export type BottomBarTranslate = (key: string) => string;

/**
 * Etykieta pozycji dla bieżącego języka.
 *
 * Kolejność: jawne nadpisanie administratora → tłumaczenie z `label_key` →
 * nadpisanie w drugim języku. Dzięki temu domyślne pozycje są w pełni
 * dwujęzyczne bez duplikowania tekstu w bazie, a własne pozycje admina
 * zachowują dokładnie to, co wpisał.
 */
export function bottomBarLabel(
  item: MobileBottomBarItem,
  lang: string,
  translate?: BottomBarTranslate,
): string {
  const own = pickLocalized(item, "label", uiLang(lang));
  const wanted =
    uiLang(lang) === "pl" ? (item.label_pl ?? "").trim() : (item.label_en ?? "").trim();
  if (wanted) return wanted;

  const key = (item.label_key ?? "").trim();
  if (key && translate) {
    const translated = translate(key);
    // i18next zwraca sam klucz, gdy brak zasobu - wtedy szukamy dalej.
    if (translated && translated !== key) return translated;
  }

  // Ostatnia deska: druga wersja językowa (`pickLocalized` już ją wybrał).
  return own;
}

/** Kanoniczna ścieżka bez prefiksu języka i bez query/hash oraz slasha na końcu. */
function canonicalPath(raw: string): string {
  const withoutQuery = (raw || "/").split(/[?#]/)[0];
  const { pathname } = stripLangPrefix(withoutQuery);
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * Indeks pozycji dopasowanej do bieżącej ścieżki (najdłuższy pasujący prefiks).
 *
 * Obie strony porównania przechodzą przez stripLangPrefix, więc `/en/network`
 * trafia w pozycję `/network`, a `/en` w stronę główną - inaczej cały pasek
 * gasł na wersji angielskiej.
 */
export function activeBottomBarIndex(items: MobileBottomBarItem[], pathname: string): number {
  const path = canonicalPath(pathname);
  let best = -1;
  let bestLen = -1;
  items.forEach((item, index) => {
    const href = canonicalPath(item.href || "/");
    const matches = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
    if (matches && href.length > bestLen) {
      best = index;
      bestLen = href.length;
    }
  });
  return best;
}

/**
 * Adres pozycji dla bieżącego języka.
 *
 * Pasek trzyma adresy kanoniczne (bez prefiksu), a treść publiczna EN mieszka
 * pod `/en/*`. Bez tej normalizacji przełączenie na kluby z wersji angielskiej
 * wyrzucało użytkownika na wersję polską - a `activeBottomBarIndex` i tak
 * porównuje ścieżki po zdjęciu prefiksu, więc podświetlenie zostawało.
 * Adresy zewnętrzne (http/mailto) przechodzą bez zmian.
 */
export function bottomBarHref(item: MobileBottomBarItem, lang: string): string {
  const href = item.href || "/";
  if (!href.startsWith("/")) return href;
  const [path, rest = ""] = [
    href.split(/(?=[?#])/)[0],
    href.slice(href.split(/(?=[?#])/)[0].length),
  ];
  return `${localizedPath(path, normalizeLang(lang) ?? DEFAULT_LANG)}${rest}`;
}
