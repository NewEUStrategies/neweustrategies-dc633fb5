// Pakiet i18n inline-edytora layoutu eksperta (ExpertLayoutInlineEditor na
// /author/$slug). Rejestrowany w chunku edytora (lazy) - publiczni goście
// nigdy go nie pobierają. Etykiety współdzielone z panelem admina
// (`adminLayouts.expertLayouts.{sections.*,moveUp,…}`) mają właściciela TUTAJ,
// a /admin/expert-layouts rejestruje ten słownik obok `i18n-admin-layouts` -
// edytor nie importuje słownika panelu (wtedy ten liczyłby się do PUBLIC).
import i18n from "./i18n";

export const expertLayoutEditorPl = {
  expertLayoutEditor: {
    open: "Edytuj layout",
    openTitle: "Nadpisz layout swojej strony (preset, sekcje, akcent)",
    title: "Layout Twojej strony",
    subtitle:
      "Zmiany podglądasz na żywo na tej stronie. Pola bez nadpisania dziedziczą ustawienia tenanta.",
    livePreview: "Podgląd na żywo",
    overridesCount: "Nadpisania: {{count}}",
    inherit: "Dziedzicz",
    inheritShort: "Auto",
    presetHeading: "Preset strony",
    tenantPreset: "Preset tenanta: {{label}}",
    sectionsHint: "Strzałki zmieniają kolejność, przełącznik nadpisuje widoczność.",
    orderOverridden: "Kolejność: nadpisana",
    restoreTenantOrder: "Przywróć kolejność tenanta",
    visibilityLabel: "Widoczność sekcji „{{section}}”",
    inheritedShown: "dziedziczone: widoczna",
    inheritedHidden: "dziedziczone: ukryta",
    show: "Pokaż",
    hide: "Ukryj",
    on: "Wł.",
    off: "Wył.",
    accentHeading: "Kolor akcentu",
    accentHint: "Puste pole = akcent tenanta lub kolor motywu.",
    resetAll: "Wyczyść wszystkie nadpisania",
    resetAllTitle: "Usuwa nadpisania i wraca do pełnego dziedziczenia (wymaga zapisu)",
    saving: "Zapisuję…",
    savedToast: "Zapisano - Twoja strona używa nadpisanego layoutu",
    saveErrorToast: "Błąd zapisu: {{msg}}",
    discardConfirm: "Masz niezapisane zmiany layoutu - zamknąć bez zapisu?",
    close: "Zamknij edytor",
  },
  // Etykiety WSPÓŁDZIELONE z /admin/expert-layouts - ten sam klucz, to samo
  // brzmienie w panelu i w edytorze eksperta. Właścicielem jest TEN plik, nie
  // `i18n-admin-layouts`: edytor jedzie na publicznym /author/<slug>, a import
  // słownika panelu stąd czynił go publicznym w grafie chunków. Trasa panelu
  // rejestruje ten słownik obok swojego (`ensureEditorI18n()`). Klucz sekcji
  // jest składany w locie (`sections.${sectionKey}`), więc przenosi się CAŁA
  // gałąź `sections.*` - pojedynczy brak to goły klucz na stronie eksperta.
  adminLayouts: {
    expertLayouts: {
      sectionsHeading: "Sekcje strony eksperta",
      moveUp: "Przesuń w górę",
      moveDown: "Przesuń w dół",
      centeringHeading: "Wycentrowanie",
      centerHero: "Wycentruj hero (tytuł, funkcja, socials)",
      centerDetails: "Wycentruj sekcję bio/szczegółów",
      accentLight: "Akcent (light)",
      accentDark: "Akcent (dark)",
      clearTitle: "Wyczyść (użyj koloru motywu)",
      colorAutoPlaceholder: "auto (motyw)",
      sections: {
        hero_cover: "Okładka hero",
        expertise_bar: "Pasek obszarów ekspertyzy",
        details: "Bio i szczegóły",
        social_row: "Social media (WWW, LinkedIn, X)",
        contact_card: "Karta kontaktowa",
        media_mentions: "Wzmianki w mediach",
        podcast_strip: "Podcasty",
        materials: "Materiały (publikacje, raporty, wideo)",
        cv: "CV (doświadczenie, edukacja, umiejętności)",
        programs: "Programy i projekty",
      },
    },
  },
};

export const expertLayoutEditorEn = {
  expertLayoutEditor: {
    open: "Edit layout",
    openTitle: "Override your page layout (preset, sections, accent)",
    title: "Your page layout",
    subtitle:
      "Changes preview live on this page. Fields without an override inherit the tenant settings.",
    livePreview: "Live preview",
    overridesCount: "Overrides: {{count}}",
    inherit: "Inherit",
    inheritShort: "Auto",
    presetHeading: "Page preset",
    tenantPreset: "Tenant preset: {{label}}",
    sectionsHint: "Arrows reorder sections, the toggle overrides visibility.",
    orderOverridden: "Order: overridden",
    restoreTenantOrder: "Restore tenant order",
    visibilityLabel: "Visibility of the „{{section}}” section",
    inheritedShown: "inherited: shown",
    inheritedHidden: "inherited: hidden",
    show: "Show",
    hide: "Hide",
    on: "On",
    off: "Off",
    accentHeading: "Accent color",
    accentHint: "Empty field = tenant accent or theme color.",
    resetAll: "Clear all overrides",
    resetAllTitle: "Removes the overrides and returns to full inheritance (requires saving)",
    saving: "Saving…",
    savedToast: "Saved - your page now uses the overridden layout",
    saveErrorToast: "Save error: {{msg}}",
    discardConfirm: "You have unsaved layout changes - close without saving?",
    close: "Close the editor",
  },
  adminLayouts: {
    expertLayouts: {
      sectionsHeading: "Expert page sections",
      moveUp: "Move up",
      moveDown: "Move down",
      centeringHeading: "Centering",
      centerHero: "Center the hero (title, role, socials)",
      centerDetails: "Center the bio/details section",
      accentLight: "Accent (light)",
      accentDark: "Accent (dark)",
      clearTitle: "Clear (use theme color)",
      colorAutoPlaceholder: "auto (theme)",
      sections: {
        hero_cover: "Hero cover",
        expertise_bar: "Expertise areas bar",
        details: "Bio and details",
        social_row: "Social media (WWW, LinkedIn, X)",
        contact_card: "Contact card",
        media_mentions: "Media mentions",
        podcast_strip: "Podcasts",
        materials: "Materials (publications, reports, video)",
        cv: "CV (experience, education, skills)",
        programs: "Programs and projects",
      },
    },
  },
};

// Explicit registration must survive both Vite and Nitro tree shaking.
// Keep the legacy side-effect import contract, and avoid repeated deep merges.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", expertLayoutEditorPl, true, true);
  i18n.addResourceBundle("en", "translation", expertLayoutEditorEn, true, true);
}
ensureI18n();
