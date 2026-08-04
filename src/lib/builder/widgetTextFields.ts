// Deklaratywna mapa pól widgetów, w które wolno wstrzykiwać znaczniki inline
// (dziś: markery przypisów `[fn]…[/fn]` z src/lib/footnotes.ts).
//
// ─────────────────────────────────────────────────────────────────────────────
// NIEZMIENNIK: wyłącznie pola renderowane jako HTML
// ─────────────────────────────────────────────────────────────────────────────
// Wpis w tej mapie wolno dodać TYLKO wtedy, gdy renderer wstawia dane pole przez
// `dangerouslySetInnerHTML`. Powód jest twardy: pre-pass zamienia `[fn]…[/fn]`
// na `<sup class="fn-ref">…</sup>`. Pole renderowane jako węzeł tekstowy React
// (`{label}`) pokaże ten znacznik DOSŁOWNIE - czytelnik zobaczy
// `<sup class="fn-ref"><span title="…">[1]</span></sup>` jako tekst na stronie,
// czyli gorzej niż nierozwinięty shortcode.
//
// Dlatego każdy wpis niesie odsyłacz do miejsca renderu (źródło prawdy). Przy
// dodawaniu widgetu: znajdź jego `dangerouslySetInnerHTML`, sprawdź NAZWĘ pola
// (bywa inna niż w panelu - np. akordeon używa `a_pl`, nie `content_pl`)
// i dopisz dokładnie ją. Parytet mapy z rzeczywistością pilnuje
// `src/lib/builder/__tests__/widgetTextFields.test.ts`.
//
// Konwencja kluczy:
// - klucz bazowy bez sufiksu językowego; silnik rozszerza go do `_pl` / `_en`
//   (patrz `localizedKeys`),
// - `scalar` - pola bezpośrednio na `content`,
// - `arrays` - kolekcje obiektów na `content[arrayKey]`.
//
// Design: bez `any`. Widget nieobecny w mapie → silnik go pomija (fail-safe:
// shortcode zostaje nietknięty, nic się nie psuje).

import type { WidgetType } from "./types";

export interface WidgetTextFieldSpec {
  /** Bezpośrednie klucze na `content` (lokalizowane; automatycznie warianty pl/en). */
  scalar?: readonly string[];
  /** Kolekcje: `arrayKey` na `content` zawierające obiekty z `fields` w środku. */
  arrays?: ReadonlyArray<{ arrayKey: string; fields: readonly string[] }>;
}

export const WIDGET_TEXT_FIELDS: Partial<Record<WidgetType, WidgetTextFieldSpec>> = {
  // widget-view/RichHtmlView.tsx - body widgetu `text`.
  text: { scalar: ["html"] },

  // widget-view/TabsBlock.tsx - panel aktywnej zakładki (`html_*`).
  // UWAGA: `label_*` zakładki jest tekstem (przycisk), więc NIE wchodzi.
  tabs: { arrays: [{ arrayKey: "items", fields: ["html"] }] },

  // widget-view/SimpleWidgets.tsx (case "accordion") - odpowiedź `a_*` jest HTML,
  // pytanie `q_*` renderuje się jako tekst w <summary>, więc NIE wchodzi.
  accordion: { arrays: [{ arrayKey: "items", fields: ["a"] }] },

  // widget-view/InteractiveCircleWidget.tsx - opis widgetu ORAZ opis elementu
  // (oba przez `sanitizeHtml`, oba pod kluczem `desc_*`).
  "interactive-circle": {
    scalar: ["desc"],
    arrays: [{ arrayKey: "items", fields: ["desc"] }],
  },

  // widget-view/TeamMemberWidget.tsx - biogram w modalu. `name_*` i `role_*`
  // renderują się jako tekst, więc NIE wchodzą.
  "team-member": { scalar: ["bio"] },


  // widget-view/SpeakersWidget.tsx celowo NIE ma wpisu: opis prelegenta
  // renderuje się jako węzeł tekstowy (line-clamp), więc marker `[fn]…[/fn]`
  // zamieniony na <sup> pokazałby się czytelnikowi dosłownie (patrz
  // NIEZMIENNIK wyżej i widgetTextFields.test.ts).
};

/** Rozszerza klucz na warianty lokalizowane + wariant bez sufiksu. */
export function localizedKeys(base: string, lang: "pl" | "en"): readonly string[] {
  // Kolejność ma znaczenie: najpierw bieżący język, potem drugi (fallback), potem bez sufiksu.
  const other = lang === "pl" ? "en" : "pl";
  return [`${base}_${lang}`, `${base}_${other}`, `${base}_pl`, `${base}_en`, base].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
}
