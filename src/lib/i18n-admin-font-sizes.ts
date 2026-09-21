// Słownik i18n dla tabeli rozmiarów czcionek (admin → Wygląd → Rozmiary czcionek).
import i18n from "@/lib/i18n";

const pl = {
  fontScale: {
    title: "Rozmiary czcionek",
    intro:
      "Jedna tabela sterująca typografią całej platformy. Każdy wiersz to token CSS - zmiana wartości działa natychmiast wszędzie tam, gdzie token jest używany, więc style nie rozjeżdżają się losowo.",
    columns: {
      element: "Element",
      scope: "Gdzie działa",
      variable: "Zmienna CSS",
      defaultSize: "Domyślnie",
      size: "Rozmiar (px)",
      preview: "Podgląd",
    },
    save: "Zapisz zmiany",
    saving: "Zapisywanie…",
    reset: "Przywróć domyślne",
    resetRow: "Domyślny",
    loading: "Ładowanie…",
    previewText: "Przykładowy tekst",
    range: "Zakres {{min}}–{{max}} px",
    tokens: {
      label: {
        label: "Etykiety pól",
        scope: "Etykiety formularzy w serwisie i panelu administracyjnym.",
      },
      input: {
        label: "Pola tekstowe",
        scope: "Inputy, obszary tekstowe i pola edytowalne.",
      },
      placeholder: {
        label: "Podpowiedzi w polach",
        scope: "Tekst zastępczy (placeholder) we wszystkich polach.",
      },
      droplist: {
        label: "Listy rozwijane",
        scope: "Selecty, comboboxy i pozycje list rozwijanych.",
      },
      button: { label: "Przyciski", scope: "Wszystkie przyciski i elementy o roli przycisku." },
      chatComposer: { label: "Pole wiadomości czatu", scope: "Wpisywanie wiadomości w czacie." },
    },
  },
};

const en = {
  fontScale: {
    title: "Font sizes",
    intro:
      "One table that drives typography across the whole platform. Each row is a CSS token - changing a value applies instantly everywhere the token is used, so styles never drift at random.",
    columns: {
      element: "Element",
      scope: "Where it applies",
      variable: "CSS variable",
      defaultSize: "Default",
      size: "Size (px)",
      preview: "Preview",
    },
    save: "Save changes",
    saving: "Saving…",
    reset: "Restore defaults",
    resetRow: "Default",
    loading: "Loading…",
    previewText: "Sample text",
    range: "Range {{min}}–{{max}} px",
    tokens: {
      label: { label: "Field labels", scope: "Form labels across the site and admin panel." },
      input: { label: "Text fields", scope: "Inputs, textareas and editable fields." },
      placeholder: { label: "Field placeholders", scope: "Placeholder text in all fields." },
      droplist: { label: "Dropdowns", scope: "Selects, comboboxes and dropdown items." },
      button: { label: "Buttons", scope: "All buttons and button-role elements." },
      chatComposer: { label: "Chat message field", scope: "Message input in chat." },
    },
  },
};

let registered = false;

/**
 * Rejestruje słownik w chunku trasy, nie w entry aplikacji. Idempotentnie, bo
 * wołane i przy ewaluacji modułu (niżej), i z komponentów: goły import
 * side-effectowy bywał wycinany w buildzie SSR (Rolldown/treeshake), przez co
 * serwer renderował surowe klucze, a klient po hydracji podmieniał je na
 * tekst - czyli React #418.
 */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}

// WYWOŁANIE PRZY EWALUACJI MODUŁU - tak jak w każdej innej nakładce z tym
// wzorcem (`i18n-cart`, `i18n-interests`, `i18n-participant-tickets`,
// `i18n-admin-billing-audit`). Tutaj tej linii brakowało, a bez niej klucze
// `fontScale.*` były dla BRAMKI PARYTETU nieistniejące: bramka
// `src/__tests__/i18nKeyDrift.gate.test.ts` zbiera słowniki przez
// `import.meta.glob(..., { eager: true })`, czyli importuje moduł, ale nie ma
// jak wywołać jego funkcji - i raportowała szesnaście kluczy jako "brak w PL
// i w EN", choć oba tłumaczenia stoją w tym pliku od początku.
ensureI18n();
