// i18n dla mobilnego paska dolnego + panelu jego edycji (PL/EN).
import i18n from "./i18n";

const pl = {
  mobileBottomBar: {
    nav: "Nawigacja mobilna",
    // Etykiety domyślnych pozycji: trzymane w i18n (a nie w site_settings),
    // dzięki czemu przełączenie języka zmienia je natychmiast i bez zapisu w
    // bazie. Administrator może je nadpisać per pozycja w panelu.
    // UWAGA: klucz to `itemLabels`, nie `items` - `items` jest już zajęte przez
    // nagłówek sekcji w panelu i zderzenie ucichłoby jako nadpisanie obiektu.
    itemLabels: {
      home: "Start",
      network: "Sieć kontaktów",
      chats: "Czaty",
      clubs: "Kluby dyskusyjne",
      saved: "Zapisane",
      profile: "Profil",
    },
    badge: "Licznik",
    badgeHint: "Kropka z liczbą nieprzeczytanych. Widoczna tylko dla zalogowanych.",
    badgeNone: "Bez licznika",
    badgeChat: "Nieprzeczytane wiadomości",
    badgeNetwork: "Zaproszenia do sieci",
    badgeNotifications: "Nieprzeczytane powiadomienia",
    badgeClubs: "Nieprzeczytane w klubach",
    // Etykiety czytane przez czytniki ekranu przy liczniku (aria-label).
    unreadChat: "Nieprzeczytane wiadomości: {{count}}",
    unreadNetwork: "Oczekujące zaproszenia do sieci: {{count}}",
    unreadNotifications: "Nieprzeczytane powiadomienia: {{count}}",
    unreadClubs: "Nieprzeczytane wpisy w klubach: {{count}}",
    labelFallback: "Domyślnie: {{label}}",
    adminTitle: "Pasek mobilny",
    adminSubtitle:
      "Dolny pasek nawigacji widoczny wyłącznie na urządzeniach mobilnych. Treści, ikony, kolory i linki edytujesz poniżej - pasek respektuje tryb jasny i ciemny oraz język serwisu.",
    enabled: "Pasek aktywny",
    enabledHint: "Wyłączenie ukrywa pasek na całym serwisie.",
    enabledLabel: "Pokazuj dolny pasek na mobile",
    showLabels: "Etykiety pod ikonami",
    showLabelsLabel: "Pokazuj podpisy tekstowe",
    hideOnScroll: "Chowanie przy przewijaniu",
    hideOnScrollLabel: "Ukrywaj pasek przy przewijaniu w dół",
    offset: "Odstęp od dołu (px)",
    offsetHint: "Zakres 0-40 px. Pasek zawsze respektuje safe-area iPhone.",
    radius: "Zaokrąglenie (px)",
    radiusHint: "Zakres 0-40 px.",
    colors: "Kolory",
    backgroundLight: "Tło - tryb jasny",
    backgroundDark: "Tło - tryb ciemny",
    iconLight: "Ikony - tryb jasny",
    iconDark: "Ikony - tryb ciemny",
    useItemColor: "Aktywna pozycja w kolorze pozycji",
    useItemColorHint: "Wyłączone = aktywna pozycja używa koloru marki.",
    items: "Pozycje",
    itemsHint: "Maksymalnie {{max}} pozycji. Kolejność ustawiasz strzałkami.",
    addItem: "Dodaj pozycję",
    removeItem: "Usuń pozycję",
    moveUp: "Przenieś wyżej",
    moveDown: "Przenieś niżej",
    labelPl: "Etykieta (PL)",
    labelEn: "Etykieta (EN)",
    icon: "Ikona",
    href: "Adres (link)",
    hrefHint: "Ścieżka wewnętrzna (np. /analizy) albo pełny adres https://",
    color: "Kolor akcentu",
    colorLight: "Akcent - tryb jasny",
    colorDark: "Akcent - tryb ciemny",
    itemEnabled: "Widoczna",
    preview: "Podgląd",
    previewLight: "Tryb jasny",
    previewDark: "Tryb ciemny",
    emptyItems: "Brak pozycji - dodaj pierwszą, aby pasek się pojawił.",
  },
};

const en = {
  mobileBottomBar: {
    nav: "Mobile navigation",
    itemLabels: {
      home: "Home",
      network: "My network",
      chats: "Chats",
      clubs: "Discussion clubs",
      saved: "Saved",
      profile: "Profile",
    },
    badge: "Counter",
    badgeHint: "Unread counter dot. Shown to signed-in users only.",
    badgeNone: "No counter",
    badgeChat: "Unread messages",
    badgeNetwork: "Network invitations",
    badgeNotifications: "Unread notifications",
    badgeClubs: "Unread in clubs",
    unreadChat: "Unread messages: {{count}}",
    unreadNetwork: "Pending network invitations: {{count}}",
    unreadNotifications: "Unread notifications: {{count}}",
    unreadClubs: "Unread club posts: {{count}}",
    labelFallback: "Default: {{label}}",
    adminTitle: "Mobile bottom bar",
    adminSubtitle:
      "Bottom navigation bar shown on mobile devices only. Edit content, icons, colours and links below - the bar follows light/dark mode and the site language.",
    enabled: "Bar enabled",
    enabledHint: "Turning this off hides the bar across the whole site.",
    enabledLabel: "Show the bottom bar on mobile",
    showLabels: "Labels under icons",
    showLabelsLabel: "Show text captions",
    hideOnScroll: "Hide on scroll",
    hideOnScrollLabel: "Hide the bar when scrolling down",
    offset: "Bottom offset (px)",
    offsetHint: "Range 0-40 px. The bar always respects the iPhone safe area.",
    radius: "Corner radius (px)",
    radiusHint: "Range 0-40 px.",
    colors: "Colours",
    backgroundLight: "Background - light mode",
    backgroundDark: "Background - dark mode",
    iconLight: "Icons - light mode",
    iconDark: "Icons - dark mode",
    useItemColor: "Active item uses its own colour",
    useItemColorHint: "Off = the active item uses the brand colour.",
    items: "Items",
    itemsHint: "Up to {{max}} items. Reorder them with the arrows.",
    addItem: "Add item",
    removeItem: "Remove item",
    moveUp: "Move up",
    moveDown: "Move down",
    labelPl: "Label (PL)",
    labelEn: "Label (EN)",
    icon: "Icon",
    href: "Link",
    hrefHint: "Internal path (e.g. /analysis) or a full https:// address",
    color: "Accent colour",
    colorLight: "Accent - light mode",
    colorDark: "Accent - dark mode",
    itemEnabled: "Visible",
    preview: "Preview",
    previewLight: "Light mode",
    previewDark: "Dark mode",
    emptyItems: "No items yet - add the first one to make the bar appear.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w KOMPONENCIE trasy (nie side-effectowym importem w pliku
 * trasy): route splitter przenosi wtedy import razem z komponentem do jego
 * chunku, a rejestracja (addResourceBundle wyżej) uruchamia się przy
 * załadowaniu tego chunku - słownik nie wchodzi do chunku wejściowego
 * KAŻDEJ strony. Wzorzec: i18n-club.ts / i18n-network.ts.
 */
export function ensureI18n(): void {}
