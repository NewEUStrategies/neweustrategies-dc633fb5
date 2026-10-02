// i18n panelu `/admin/settings/cookie-banner` (trasa + sekcja marki + skaner
// „Wykryte elementy").
//
// Do tej nakładki cały panel był wpisany po polsku wprost w JSX (47 wystąpień
// zamrożonych w ratchecie `check:i18n-hardcoded`), więc panel w wersji EN
// renderował polszczyznę. Polskie brzmienia są tu ZNAK W ZNAK takie jak
// wcześniej w kodzie - zmienia się wyłącznie to, że druga wersja językowa
// w ogóle istnieje.
//
// UWAGA O DWÓCH JĘZYKACH NA JEDNYM EKRANIE. Etykiety panelu idą za językiem
// INTERFEJSU (ten plik). Treści banera (`copy.pl` / `copy.en`) idą za
// zakładką edytowanej WERSJI - i to są dwie różne rzeczy: administrator
// z interfejsem po polsku edytuje angielski baner.
import i18n from "@/lib/i18n";

const pl = {
  adminCookieBanner: {
    headTitle: "Cookie banner - Ustawienia",
    title: "Cookie banner",
    subtitle:
      "Kolory, treści (PL/EN) oraz mechanizmy zgody. Zmiany są widoczne na żywo po zapisie.",
    preview: "Podgląd",
    previewLogoLight: "Logo: jasne",
    previewLogoDark: "Logo: ciemne",
    previewClose: "Zamknij podgląd",
    restoreDefaults: "Przywróć domyślne",
    restoreConfirm: "Przywrócić wartości domyślne (kolory + treści)?",
    mechanisms: {
      title: "Mechanizmy",
      enabledLabel: "Baner aktywny",
      enabledHint: "Wyłączenie ukrywa banner dla nowych użytkowników.",
      enabledCheckbox: "Pokazuj cookie banner",
      languageSwitcherLabel: "Przełącznik języka",
      languageSwitcherHint: "Widoczny pill PL / EN wewnątrz banera.",
      languageSwitcherCheckbox: "Pokaż PL / EN w banerze",
      autoInventoryLabel: "Automatyczna deklaracja",
      autoInventoryHint:
        "System skanuje cookies i storage, dopisuje wykryte elementy do tabel w szczegółach banera i opisuje je sam.",
      autoInventoryCheckbox: "Dopisuj wykryte automatycznie elementy",
    },
    colors: {
      title: "Kolory (puste = motyw)",
      surface: "Powierzchnia",
      foreground: "Tekst",
      muted: "Tło wtórne",
      border: "Obramowanie",
      accent: "Akcent (primary)",
      accentForeground: "Akcent - tekst",
      pickAria: "{{label}} - wybierz kolor",
    },
    copy: {
      title: "Treści",
      versionsLabel: "Wersja językowa treści banera",
      versionName: {
        pl: "Wersja polska",
        en: "Wersja angielska",
      },
      fields: {
        title: "Tytuł",
        intro: "Wstęp (długi)",
        compactMessage: "Komunikat (kompakt)",
        policyLabel: "Etykieta polityki",
        buttons: "Przyciski",
        categories: "Kategorie - nazwy",
        descNecessary: "Opis - niezbędne",
        descFunctional: "Opis - funkcjonalne",
        descAnalytics: "Opis - analityczne",
        descMarketing: "Opis - marketing",
      },
    },
    branding: {
      logoTitle: "Logo banera",
      logoHint:
        "Puste pole = sygnet marki z ustawień motywu. Wariant ciemny jest używany, gdy strona działa w trybie ciemnym (brak wariantu ciemnego = użyty jasny).",
      logoLight: "Logo - tryb jasny",
      logoDark: "Logo - tryb ciemny",
      sizeLabel: "Rozmiar kafla (px)",
      sizeHint: "Zakres 24-72 px.",
      linksTitle: "Odnośniki w banerze",
      addLink: "Dodaj odnośnik",
      linksEmpty:
        "Brak dodatkowych odnośników. Polityka Prywatności i Zasady przetwarzania danych są pokazywane zawsze.",
      privacySettingsLink: "Ustaw stronę polityki prywatności",
      labelPl: "Etykieta PL",
      labelEn: "Etykieta EN",
      urlLabel: "Adres odnośnika",
      urlHint:
        "Ścieżka wewnętrzna (np. /cookies) dostaje prefiks języka odwiedzającego, więc wersja angielska prowadzi do /en/cookies. Adres zewnętrzny (https://…, mailto:) zostaje bez zmian.",
      resolved: "PL: {{pl}} · EN: {{en}}",
      invalidUrl:
        "Ten adres nie zostanie pokazany w banerze - dozwolone są ścieżki /… oraz adresy https://, http://, mailto: i tel:.",
      remove: "Usuń",
    },
    detected: {
      title: "Wykryte elementy",
      scanSummary:
        "Skan przeglądarki: {{count}} kluczy (cookies, localStorage, sessionStorage). Elementy spoza rejestru zostały opisane automatycznie i trafiają do deklaracji w banerze.",
      scanSummary_one:
        "Skan przeglądarki: {{count}} klucz (cookies, localStorage, sessionStorage). Elementy spoza rejestru zostały opisane automatycznie i trafiają do deklaracji w banerze.",
      scanSummary_few:
        "Skan przeglądarki: {{count}} klucze (cookies, localStorage, sessionStorage). Elementy spoza rejestru zostały opisane automatycznie i trafiają do deklaracji w banerze.",
      scanSummary_many:
        "Skan przeglądarki: {{count}} kluczy (cookies, localStorage, sessionStorage). Elementy spoza rejestru zostały opisane automatycznie i trafiają do deklaracji w banerze.",
      rescan: "Skanuj ponownie",
      categories: {
        necessary: "Niezbędne",
        functional: "Funkcjonalne",
        analytics: "Analityczne",
        marketing: "Marketingowe",
      },
      columns: {
        element: "Element",
        storage: "Źródło",
        purpose: "Cel",
        keys: "Wykryte klucze",
      },
      autoBadge: "auto",
    },
  },
};

const en: typeof pl = {
  adminCookieBanner: {
    headTitle: "Cookie banner - Settings",
    title: "Cookie consent banner",
    subtitle:
      "Colours, copy (PL/EN) and consent mechanisms. Changes go live on the site right after saving.",
    preview: "Preview",
    previewLogoLight: "Logo: light",
    previewLogoDark: "Logo: dark",
    previewClose: "Close preview",
    restoreDefaults: "Restore defaults",
    restoreConfirm: "Restore the default values (colours + copy)?",
    mechanisms: {
      title: "Mechanisms",
      enabledLabel: "Banner enabled",
      enabledHint: "Turning it off hides the banner from new visitors.",
      enabledCheckbox: "Show the cookie banner",
      languageSwitcherLabel: "Language switcher",
      languageSwitcherHint: "A PL / EN pill shown inside the banner.",
      languageSwitcherCheckbox: "Show PL / EN in the banner",
      autoInventoryLabel: "Automatic declaration",
      autoInventoryHint:
        "The system scans cookies and storage, adds detected items to the tables in the banner details and describes them on its own.",
      autoInventoryCheckbox: "Add automatically detected items",
    },
    colors: {
      title: "Colours (empty = theme)",
      surface: "Surface",
      foreground: "Text",
      muted: "Secondary background",
      border: "Border",
      accent: "Accent (primary)",
      accentForeground: "Accent - text",
      pickAria: "{{label}} - pick a colour",
    },
    copy: {
      title: "Copy",
      versionsLabel: "Banner copy language version",
      versionName: {
        pl: "Polish version",
        en: "English version",
      },
      fields: {
        title: "Title",
        intro: "Introduction (long)",
        compactMessage: "Message (compact)",
        policyLabel: "Policy label",
        buttons: "Buttons",
        categories: "Categories - names",
        descNecessary: "Description - necessary",
        descFunctional: "Description - functional",
        descAnalytics: "Description - analytics",
        descMarketing: "Description - marketing",
      },
    },
    branding: {
      logoTitle: "Banner logo",
      logoHint:
        "Empty field = the brand mark from the theme settings. The dark variant is used when the site runs in dark mode (no dark variant = the light one is used).",
      logoLight: "Logo - light mode",
      logoDark: "Logo - dark mode",
      sizeLabel: "Tile size (px)",
      sizeHint: "Range 24-72 px.",
      linksTitle: "Links in the banner",
      addLink: "Add link",
      linksEmpty:
        "No additional links. The Privacy Policy and the Data processing terms are always shown.",
      privacySettingsLink: "Set the privacy policy page",
      labelPl: "Label (Polish)",
      labelEn: "Label (English)",
      urlLabel: "Link address",
      urlHint:
        "An internal path (e.g. /cookies) gets the visitor's language prefix, so the English version leads to /en/cookies. An external address (https://…, mailto:) stays unchanged.",
      resolved: "PL: {{pl}} · EN: {{en}}",
      invalidUrl:
        "This address will not be shown in the banner - allowed are /… paths and https://, http://, mailto: and tel: addresses.",
      remove: "Remove",
    },
    detected: {
      title: "Detected items",
      scanSummary:
        "Browser scan: {{count}} keys (cookies, localStorage, sessionStorage). Items outside the registry were described automatically and go into the banner declaration.",
      scanSummary_one:
        "Browser scan: {{count}} key (cookies, localStorage, sessionStorage). Items outside the registry were described automatically and go into the banner declaration.",
      scanSummary_few:
        "Browser scan: {{count}} keys (cookies, localStorage, sessionStorage). Items outside the registry were described automatically and go into the banner declaration.",
      scanSummary_many:
        "Browser scan: {{count}} keys (cookies, localStorage, sessionStorage). Items outside the registry were described automatically and go into the banner declaration.",
      rescan: "Scan again",
      categories: {
        necessary: "Necessary",
        functional: "Functional",
        analytics: "Analytics",
        marketing: "Marketing",
      },
      columns: {
        element: "Item",
        storage: "Storage",
        purpose: "Purpose",
        keys: "Detected keys",
      },
      autoBadge: "auto-detected",
    },
  },
};

/** No-op wołany w komponencie zamiast side-effectowego importu modułu. */
// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
