// Pakiet i18n inline-edytora layoutu eksperta (ExpertLayoutInlineEditor na
// /author/$slug). Rejestrowany w chunku edytora (lazy) - publiczni goście
// nigdy go nie pobierają. Etykiety sekcji współdzielone z panelem admina
// przez i18n-admin-layouts (adminLayouts.expertLayouts.sections.*).
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
};

i18n.addResourceBundle("pl", "translation", expertLayoutEditorPl, true, true);
i18n.addResourceBundle("en", "translation", expertLayoutEditorEn, true, true);

/**
 * No-op wołany w module edytora zamiast side-effectowego importu - nazwane
 * wiązanie pozwala bundlerowi zostawić słownik w lazy-chunku edytora
 * (ten sam wzorzec co i18n-admin-layouts / i18n-experts).
 */
export function ensureI18n(): void {}
