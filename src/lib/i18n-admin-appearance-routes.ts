// Zasoby i18n dla tras wyglądu/designu admina: global colors, tokeny marki,
// nagłówek. Uwaga: etykiety i opisy slotów pochodzą z GLOBAL_COLOR_GROUPS
// (src/lib/builder/globalColors.ts) i są lokalizowane osobno.
import i18n from "@/lib/i18n";

const pl = {
  adminAppearanceRoutes: {
    loading: "Ładowanie…",
    globalColors: {
      intro:
        "Centralna paleta - każdy slot opisuje, gdzie kolor pojawi się na stronie. Zmiany są natychmiast widoczne w całej witrynie po zapisaniu.",
      saving: "Zapisywanie…",
      saveChanges: "Zapisz zmiany",
      overrides: "Nadpisuje:",
      lightMode: "Tryb jasny",
      darkMode: "Tryb ciemny",
      sharedBoth: "(wspólne dla obu trybów)",
    },
    design: {
      brandTokens: "Tokeny marki",
      introPre:
        "Fonty i kolory definiują wygląd całej strony. Wartości zapisują się jako zmienne CSS (",
      introPost:
        ") i automatycznie nadpisują tokeny motywu (przyciski, tło, linki, ramki) - w trybie jasnym i ciemnym.",
      typography: "Typografia",
      headingFont: "Font nagłówków",
      headingFontHint: "Używany dla H1–H6 oraz tytułów w widgetach.",
      headingSample: "Nagłówek - Headlines & Display",
      bodyFont: "Font tekstu",
      bodyFontHint: "Treść artykułów, akapity, listy, opisy.",
      bodySample: "Treść - szybki brązowy lis przeskakuje przez leniwego psa.",
      radius: "Promień (radius)",
      radiusHint: "Domyślny border-radius dla kart, przycisków itp.",
      brandColors: "Kolory marki (Global Colors)",
      brandColorsDescPrefix: "Każdy slot ma osobną wartość dla trybu jasnego (",
      brandColorsDescMid: " Light) i ciemnego (",
      brandColorsDescSuffix: " Dark). Zmiana wpływa od razu na całą stronę.",
      extraColors: "Dodatkowe kolory (zmienne)",
      extraColorsDescPrefix: "Własne sloty dostępne jako ",
      extraColorsDescSuffix: " w CSS i widgetach.",
      addColor: "Dodaj kolor",
      noExtraColors: "Brak dodatkowych kolorów.",
      overrides: "nadpisuje:",
      copiedToast: "Skopiowano {{var}}",
      copyTitle: "Skopiuj {{var}}",
      remove: "Usuń",
    },
    header: {
      title: "Nagłówek",
    },
  },
};

const en = {
  adminAppearanceRoutes: {
    loading: "Loading…",
    globalColors: {
      intro:
        "Central palette - each slot describes where the color appears on the site. Changes are visible across the whole site immediately after saving.",
      saving: "Saving…",
      saveChanges: "Save changes",
      overrides: "Overrides:",
      lightMode: "Light mode",
      darkMode: "Dark mode",
      sharedBoth: "(shared for both modes)",
    },
    design: {
      brandTokens: "Brand tokens",
      introPre:
        "Fonts and colors define the look of the whole site. Values are saved as CSS variables (",
      introPost:
        ") and automatically override theme tokens (buttons, background, links, borders) - in light and dark mode.",
      typography: "Typography",
      headingFont: "Heading font",
      headingFontHint: "Used for H1–H6 and widget titles.",
      headingSample: "Heading - Headlines & Display",
      bodyFont: "Body font",
      bodyFontHint: "Article content, paragraphs, lists, descriptions.",
      bodySample: "Body - the quick brown fox jumps over the lazy dog.",
      radius: "Radius",
      radiusHint: "Default border-radius for cards, buttons, etc.",
      brandColors: "Brand colors (Global Colors)",
      brandColorsDescPrefix: "Each slot has a separate value for light mode (",
      brandColorsDescMid: " Light) and dark mode (",
      brandColorsDescSuffix: " Dark). A change affects the whole site right away.",
      extraColors: "Extra colors (variables)",
      extraColorsDescPrefix: "Custom slots available as ",
      extraColorsDescSuffix: " in CSS and widgets.",
      addColor: "Add color",
      noExtraColors: "No extra colors.",
      overrides: "overrides:",
      copiedToast: "Copied {{var}}",
      copyTitle: "Copy {{var}}",
      remove: "Delete",
    },
    header: {
      title: "Header",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
