// Deklaratywna mapa pól tekstowych na widget - jedno miejsce prawdy o tym, gdzie
// w drzewie buildera mieszka bogaty tekst redakcyjny. Wykorzystywane przez
// pre-pass przypisów `[fn]…[/fn]` (src/lib/footnotes.ts) i potencjalnie inne
// transformacje tekstowe (np. auto-linki, glossary highlight).
//
// Konwencja kluczy:
// - "html_pl" / "html_en" - lokalizowane HTML-e (auto rozszerzamy do html_{lang})
// - "text_pl" / "text_en" - lokalizowane plain/rich text
// - path z kropką - odczyt zagnieżdżony (np. items[].title_pl)
//
// Design: bez `any`. Nieznane widgety → puste pola (silnik pomija).

import type { WidgetType } from "./types";

export interface WidgetTextFieldSpec {
  /** Bezpośrednie klucze na `content` (lokalizowane; automatycznie warianty pl/en). */
  scalar?: readonly string[];
  /** Kolekcje: `arrayKey` na `content` zawierające obiekty z `fields` w środku. */
  arrays?: ReadonlyArray<{ arrayKey: string; fields: readonly string[] }>;
}

/**
 * Pełna mapa. Klucze bez sufiksu językowego są automatycznie rozszerzane
 * do wariantów PL/EN w silniku pre-passu.
 */
export const WIDGET_TEXT_FIELDS: Partial<Record<WidgetType, WidgetTextFieldSpec>> = {
  text: { scalar: ["html", "text"] },
  heading: { scalar: ["html", "text", "title"] },
  "section-label": { scalar: ["title", "text"] },
  "hot-topic-bar": { scalar: ["title", "text"] },
  "animated-heading": { scalar: ["text", "words"] },
  testimonial: { scalar: ["quote", "text", "author"] },
  "team-member": { scalar: ["bio", "role", "name"] },
  cta: { scalar: ["title", "description", "text"] },
  pricing: { scalar: ["title", "description"] },
  accordion: {
    arrays: [{ arrayKey: "items", fields: ["title", "content", "body"] }],
  },
  tabs: {
    arrays: [{ arrayKey: "items", fields: ["title", "content", "body"] }],
  },
  timeline: {
    arrays: [{ arrayKey: "items", fields: ["title", "description", "body"] }],
  },
  "interactive-circle": {
    arrays: [{ arrayKey: "items", fields: ["title", "description"] }],
  },
  image: { scalar: ["caption"] },
  gallery: {
    arrays: [{ arrayKey: "items", fields: ["caption"] }],
  },
  video: { scalar: ["caption"] },
  button: { scalar: ["label", "tooltip"] },
  "dark-featured-card": { scalar: ["title", "description"] },
  "rated-list": {
    arrays: [{ arrayKey: "items", fields: ["title", "description"] }],
  },
};

/** Rozszerza klucz na warianty lokalizowane + wariant bez sufiksu. */
export function localizedKeys(base: string, lang: "pl" | "en"): readonly string[] {
  // Kolejność ma znaczenie: najpierw bieżący język, potem drugi (fallback), potem bez sufiksu.
  const other = lang === "pl" ? "en" : "pl";
  return [`${base}_${lang}`, `${base}_${other}`, `${base}_pl`, `${base}_en`, base].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
}
