// Reguły dokumentu buildera - wszystko, co NewsletterBuilder robi z dokumentem,
// zanim wynik trafi do historii zmian.
//
// PO CO OSOBNY MODUŁ. `NewsletterBuilder` to 900 linii, w których te reguły
// siedziały wewnątrz komponentu, splecione z `useState`, historią zmian i
// @dnd-kit. Nie dawały się sprawdzić inaczej niż przez przeciąganie myszą, a
// niosą rzeczy, których pomyłka jest cicha i trwała:
//
//   * PRZENOSZENIE widgetu między sekcjami i kolumnami. Zły indeks nie wywala
//     aplikacji - po prostu wstawia element w innym miejscu, niż operator go
//     upuścił, albo GUBI go (usunięcie ze źródła bez wstawienia do celu).
//   * PRZEŁĄCZENIE UKŁADU sekcji. Wyjście z dwóch kolumn musi wyczyścić
//     przypisania `col`; zostawione „col: 1" w układzie jednokolumnowym
//     sprawia, że kanwa POMIJA widget - operator widzi, że element zniknął.
//   * DUPLIKOWANIE sekcji. Kopia musi dostać nowe identyfikatory - również
//     widgety w środku. Powtórzony `id` to dwa elementy, które zaznaczają się
//     razem i patchują razem.
//   * MAPOWANIE USTAWIEŃ na pierwszy dokument. To jedyne miejsce, w którym
//     treść z zakładki ustawień (nagłówek, opis, klauzula RODO, zgoda) trafia
//     do formularza. Pole, które tu wypadnie, znika z formularza bez śladu.
//
// Wszystkie funkcje są CZYSTE i nie mutują wejścia: dokument jest trzymany w
// historii zmian (cofnij/ponów), więc mutacja w miejscu psuje cofanie.
import type {
  NlDoc,
  NlSection,
  NlSectionLayout,
  NlSectionMedia,
  NlSectionStyle,
  NlWidget,
} from "@/lib/newsletter-builder/types";
import type { DocSeed } from "@/lib/newsletter-builder/defaults";
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";

export type Device = "desktop" | "tablet" | "mobile";

/** Położenie widgetu w dokumencie: indeks sekcji + indeks w tej sekcji. */
export interface WidgetLocation {
  sectionIdx: number;
  widgetIdx: number;
}

/** Cel upuszczenia rozwiązany z identyfikatora obszaru @dnd-kit. */
export interface DropTarget {
  sectionId: string | null;
  col: 0 | 1 | null;
  overWidgetIdx: number | null;
}

// ---------------------------------------------------------------------------
// WYSZUKIWANIE
// ---------------------------------------------------------------------------

export function findWidgetLocation(doc: NlDoc, widgetId: string): WidgetLocation | null {
  for (let s = 0; s < doc.sections.length; s++) {
    const idx = doc.sections[s]!.widgets.findIndex((w) => w.id === widgetId);
    if (idx >= 0) return { sectionIdx: s, widgetIdx: idx };
  }
  return null;
}

export function findSectionIdx(doc: NlDoc, sectionId: string): number {
  return doc.sections.findIndex((s) => s.id === sectionId);
}

export function widgetById(doc: NlDoc, widgetId: string | null): NlWidget | null {
  if (!widgetId) return null;
  const loc = findWidgetLocation(doc, widgetId);
  return loc ? doc.sections[loc.sectionIdx]!.widgets[loc.widgetIdx]! : null;
}

export function sectionById(doc: NlDoc, sectionId: string | null): NlSection | null {
  if (!sectionId) return null;
  return doc.sections[findSectionIdx(doc, sectionId)] ?? null;
}

/**
 * Identyfikator obszaru upuszczenia -> cel.
 *
 * Obszary kanwy mają nazwy `sec-{id}-drop`, `sec-{id}-col-0`, `sec-{id}-col-1`.
 * Identyfikator sekcji jest UUID-em z myślnikami, więc wzorzec musi być
 * zachłanny od lewej - inaczej „sec-a-b-col-1" rozwiązałoby się na sekcję „a".
 * Jeśli obszarem jest sam widget, celem jest jego sekcja i jego indeks.
 */
export function resolveDropTarget(doc: NlDoc, overId: string): DropTarget {
  if (overId.startsWith("sec-")) {
    const rest = overId.slice(4);
    const m = rest.match(/^(.+)-(drop|col-0|col-1)$/);
    if (m) {
      const kind = m[2]!;
      return {
        sectionId: m[1]!,
        col: kind === "col-0" ? 0 : kind === "col-1" ? 1 : null,
        overWidgetIdx: null,
      };
    }
  }
  const loc = findWidgetLocation(doc, overId);
  if (loc) {
    const section = doc.sections[loc.sectionIdx]!;
    const target = section.widgets[loc.widgetIdx]!;
    return {
      sectionId: section.id,
      col: (target.col ?? 0) as 0 | 1,
      overWidgetIdx: loc.widgetIdx,
    };
  }
  return { sectionId: null, col: null, overWidgetIdx: null };
}

// ---------------------------------------------------------------------------
// SEKCJE
// ---------------------------------------------------------------------------

export function mapSection(
  doc: NlDoc,
  sectionId: string,
  fn: (section: NlSection) => NlSection,
): NlDoc {
  return { ...doc, sections: doc.sections.map((s) => (s.id === sectionId ? fn(s) : s)) };
}

export function applySectionStyle(
  doc: NlDoc,
  sectionId: string,
  patch: Partial<NlSectionStyle>,
): NlDoc {
  return mapSection(doc, sectionId, (s) => ({ ...s, style: { ...(s.style ?? {}), ...patch } }));
}

/**
 * `null` USUWA obraz sekcji. Patch częściowy dokłada się do istniejącego, a gdy
 * obrazu jeszcze nie było - do pustej podstawy z pozycją „left", żeby dokument
 * nigdy nie miał obrazu bez pozycji.
 */
export function applySectionMedia(
  doc: NlDoc,
  sectionId: string,
  patch: Partial<NlSectionMedia> | null,
): NlDoc {
  return mapSection(doc, sectionId, (s) => {
    if (patch === null) return { ...s, media: null };
    const current = s.media ?? { url: "", position: "left" as const };
    return { ...s, media: { ...current, ...patch } };
  });
}

/**
 * Zmiana układu sekcji MUSI posprzątać przypisania kolumn:
 * wyjście na jedną kolumnę czyści `col` (widget z „col: 1" byłby w kanwie
 * pominięty), wejście w dwie kolumny nadaje brakującym `col: 0`.
 */
export function applySectionLayout(doc: NlDoc, sectionId: string, layout: NlSectionLayout): NlDoc {
  return mapSection(doc, sectionId, (s) => {
    if (layout === "single") {
      return { ...s, layout: "single", widgets: s.widgets.map((w) => ({ ...w, col: undefined })) };
    }
    return {
      ...s,
      layout,
      widgets: s.widgets.map((w) => ({ ...w, col: (w.col ?? 0) as 0 | 1 })),
    };
  });
}

/** Wstawia sekcję ZA wskazaną; bez wskazania - na końcu dokumentu. */
export function insertSection(doc: NlDoc, section: NlSection, afterSectionId?: string): NlDoc {
  const next = [...doc.sections];
  const idx = afterSectionId ? next.findIndex((s) => s.id === afterSectionId) : -1;
  const at = idx >= 0 ? idx + 1 : next.length;
  next.splice(at, 0, section);
  return { ...doc, sections: next };
}

/** Ostatniej sekcji nie wolno usunąć - dokument bez sekcji nie ma gdzie trzymać widgetów. */
export function canRemoveSection(doc: NlDoc): boolean {
  return doc.sections.length > 1;
}

export function removeSection(doc: NlDoc, sectionId: string): NlDoc {
  if (!canRemoveSection(doc)) return doc;
  return { ...doc, sections: doc.sections.filter((s) => s.id !== sectionId) };
}

/**
 * Kopia sekcji ląduje ZARAZ ZA oryginałem i dostaje nowe identyfikatory -
 * sekcji ORAZ każdego widgetu w środku. Powtórzony `id` to dwa elementy, które
 * zaznaczają się i patchują razem.
 */
export function duplicateSection(doc: NlDoc, sectionId: string, newId: () => string): NlDoc {
  const idx = findSectionIdx(doc, sectionId);
  if (idx < 0) return doc;
  const src = doc.sections[idx]!;
  const copy: NlSection = {
    ...src,
    id: newId(),
    widgets: src.widgets.map((w) => ({ ...w, id: newId() })),
  };
  const next = [...doc.sections];
  next.splice(idx + 1, 0, copy);
  return { ...doc, sections: next };
}

/** Przesuwa sekcję o jedno miejsce; poza zakresem nie robi nic. */
export function moveSection(doc: NlDoc, sectionId: string, dir: -1 | 1): NlDoc {
  const idx = findSectionIdx(doc, sectionId);
  if (idx < 0) return doc;
  const to = idx + dir;
  if (to < 0 || to >= doc.sections.length) return doc;
  const next = [...doc.sections];
  const [item] = next.splice(idx, 1);
  next.splice(to, 0, item!);
  return { ...doc, sections: next };
}

// ---------------------------------------------------------------------------
// WIDGETY
// ---------------------------------------------------------------------------

export function mapSectionWidgets(
  doc: NlDoc,
  sectionId: string,
  fn: (list: NlWidget[]) => NlWidget[],
): NlDoc {
  return mapSection(doc, sectionId, (s) => ({ ...s, widgets: fn(s.widgets) }));
}

/**
 * Buduje widget do wstawienia.
 *
 * PRESET (np. wariant `field.text`: imię / nazwisko / telefon) nadpisuje
 * wartości domyślne, ale NIE `id` ani `type` - inaczej wszystkie warianty
 * jednego typu miałyby ten sam identyfikator, a dwa elementy z tym samym `id`
 * zaznaczają się i patchują razem.
 *
 * `col` zapisujemy TYLKO w układzie wielokolumnowym; w jednej kolumnie
 * przypisanie zrobiłoby z widgetu element pomijany przez kanwę.
 */
export function buildWidget(
  section: NlSection,
  base: NlWidget,
  opts: { col?: 0 | 1; preset?: Partial<NlWidget> } = {},
): NlWidget {
  const widget = (
    opts.preset ? { ...base, ...opts.preset, id: base.id, type: base.type } : base
  ) as NlWidget;
  if ((section.layout ?? "single") !== "single") widget.col = opts.col ?? 0;
  return widget;
}

/** Wstawia widget na wskazanym indeksie; bez indeksu - na końcu sekcji. */
export function insertWidget(
  doc: NlDoc,
  sectionId: string,
  widget: NlWidget,
  atIndex?: number,
): NlDoc {
  return mapSectionWidgets(doc, sectionId, (list) => {
    const out = [...list];
    const idx =
      typeof atIndex === "number" ? Math.max(0, Math.min(atIndex, out.length)) : out.length;
    out.splice(idx, 0, widget);
    return out;
  });
}

export function removeWidget(doc: NlDoc, widgetId: string): NlDoc {
  const loc = findWidgetLocation(doc, widgetId);
  if (!loc) return doc;
  const sectionId = doc.sections[loc.sectionIdx]!.id;
  return mapSectionWidgets(doc, sectionId, (list) => list.filter((w) => w.id !== widgetId));
}

/** Kopia widgetu ląduje ZARAZ ZA oryginałem i dostaje nowy identyfikator. */
export function duplicateWidget(doc: NlDoc, widgetId: string, newId: () => string): NlDoc {
  const loc = findWidgetLocation(doc, widgetId);
  if (!loc) return doc;
  const sectionId = doc.sections[loc.sectionIdx]!.id;
  return mapSectionWidgets(doc, sectionId, (list) => {
    const idx = list.findIndex((w) => w.id === widgetId);
    if (idx < 0) return list;
    const copy: NlWidget = { ...list[idx]!, id: newId() };
    const out = [...list];
    out.splice(idx + 1, 0, copy);
    return out;
  });
}

export function patchWidget(doc: NlDoc, widgetId: string, patch: Partial<NlWidget>): NlDoc {
  const loc = findWidgetLocation(doc, widgetId);
  if (!loc) return doc;
  const sectionId = doc.sections[loc.sectionIdx]!.id;
  return mapSectionWidgets(doc, sectionId, (list) =>
    list.map((w) => (w.id === widgetId ? ({ ...w, ...patch } as NlWidget) : w)),
  );
}

/**
 * Przenosi widget na wskazany cel - w tej samej sekcji albo do innej.
 *
 * Kolejność ma znaczenie: najpierw usunięcie ze ŹRÓDŁA, potem wstawienie do
 * CELU, a indeks wstawienia liczony po identyfikatorze elementu, nad którym
 * operator puścił mysz. Liczenie po surowym indeksie po usunięciu przesunęłoby
 * element o jedno miejsce przy przenoszeniu w obrębie jednej sekcji.
 *
 * Cel bez sekcji albo nieznany widget = brak zmian (widget nigdy nie ginie).
 */
export function moveWidget(doc: NlDoc, activeId: string, target: DropTarget): NlDoc {
  if (!target.sectionId) return doc;
  const targetSection = sectionById(doc, target.sectionId);
  if (!targetSection) return doc;
  const activeLoc = findWidgetLocation(doc, activeId);
  if (!activeLoc) return doc;

  const sourceSection = doc.sections[activeLoc.sectionIdx]!;
  const activeWidget = sourceSection.widgets[activeLoc.widgetIdx]!;
  const targetLayout: NlSectionLayout = targetSection.layout ?? "single";
  const newCol =
    targetLayout === "single" ? undefined : ((target.col ?? activeWidget.col ?? 0) as 0 | 1);

  const withoutSource = doc.sections.map((s) =>
    s.id === sourceSection.id
      ? { ...s, widgets: s.widgets.filter((w) => w.id !== activeWidget.id) }
      : s,
  );
  const sections = withoutSource.map((s) => {
    if (s.id !== target.sectionId) return s;
    const list = [...s.widgets];
    const moved: NlWidget = { ...activeWidget, col: newCol } as NlWidget;
    let insertAt: number;
    if (target.overWidgetIdx == null) {
      insertAt = list.length;
    } else {
      const overWidget = targetSection.widgets[target.overWidgetIdx]!;
      const idx = list.findIndex((w) => w.id === overWidget.id);
      insertAt = idx >= 0 ? idx : list.length;
    }
    list.splice(insertAt, 0, moved);
    return { ...s, widgets: list };
  });
  return { ...doc, sections };
}

export function applyPopupStyle(doc: NlDoc, patch: Partial<NonNullable<NlDoc["popup"]>>): NlDoc {
  return { ...doc, popup: { ...(doc.popup ?? {}), ...patch } };
}

// ---------------------------------------------------------------------------
// PODGLĄD: SZEROKOŚĆ KANWY I PODPISY
// ---------------------------------------------------------------------------

/**
 * Szerokość podglądu. Popup ma stałą szerokość jak w produkcji (układ z grafiką
 * boczną jest szerszy), formularz inline na desktopie rozciąga się na całość.
 * Rozjazd z produkcją znaczy, że operator układa treść na innej szerokości, niż
 * zobaczy odbiorca.
 */
export function canvasWidthFor(
  variant: "inline" | "popup",
  device: Device,
  popupLayout: string | null,
): number | "100%" {
  if (variant === "popup") {
    if (device === "desktop") {
      return popupLayout === "split" || popupLayout === "showcase" ? 880 : 520;
    }
    return device === "tablet" ? 560 : 360;
  }
  if (device === "desktop") return "100%";
  return device === "tablet" ? 720 : 380;
}

/** Nazwy urządzeń są takie same w obu językach - nie ma tu czego tłumaczyć. */
export function deviceLabel(device: Device): string {
  return device === "desktop" ? "Desktop" : device === "tablet" ? "Tablet" : "Mobile";
}

/**
 * Podpis rozmiaru kanwy. Szerokość liczbowa ma gotowy pomiar - liczba z
 * jednostką nie jest tłumaczeniem. Dla „100%" reguła oddaje `null`, bo podpis
 * jest wtedy TEKSTEM dla operatora, a reguła nie trzyma treści w dwóch
 * językach: ternary po języku omija bramkę parytetu PL/EN i zamyka drogę do
 * trzeciego języka. Napis dokłada warstwa widoku, która ma dostęp do języka.
 */
export function canvasSizeLabel(canvasWidth: number | "100%"): string | null {
  return typeof canvasWidth === "number" ? `${canvasWidth}px` : null;
}

// ---------------------------------------------------------------------------
// PIERWSZY DOKUMENT Z USTAWIEŃ
// ---------------------------------------------------------------------------

/**
 * Zaczep pierwszego dokumentu: treść z zakładki ustawień przepisana na wejście
 * fabryki. Uruchamia się RAZ na instalację - jeśli któreś pole tu wypadnie,
 * operator zaczyna od formularza bez klauzuli RODO albo bez pola zgody i
 * najczęściej tego nie zauważy, bo nie wie, że coś miało tam być.
 *
 * Wariant inline nie ma okładki, zgody popupowej ani stylu okna - dla niego te
 * pola muszą być puste, a nie „przypadkiem takie same jak w popupie".
 */
export function docSeedFromSettings(
  variant: "inline" | "popup",
  settings: NewsletterSettings,
): DocSeed {
  const isPopup = variant === "popup";
  return {
    heading: { pl: settings.heading_pl, en: settings.heading_en },
    description: { pl: settings.description_pl, en: settings.description_en },
    policyHtml: { pl: settings.policy_html_pl, en: settings.policy_html_en },
    successMsg: { pl: settings.success_message_pl, en: settings.success_message_en },
    submitLabel: isPopup
      ? { pl: settings.popup_cta_pl, en: settings.popup_cta_en }
      : { pl: "Zapisz sie", en: "Subscribe" },
    coverUrl: isPopup ? settings.popup_cover_url : null,
    requireTerms: isPopup && settings.popup_require_terms,
    termsHtml: isPopup
      ? { pl: settings.popup_terms_html_pl, en: settings.popup_terms_html_en }
      : { pl: null, en: null },
    popupStyle: isPopup
      ? {
          bg: settings.popup_bg_color,
          fg: settings.popup_text_color,
          muted: settings.popup_muted_color,
          accent: settings.popup_accent_color,
          accentFg: settings.popup_accent_text_color,
          overlay: settings.popup_overlay_color,
          radius: settings.popup_border_radius_px,
          layout: settings.popup_layout,
          sideImage: settings.popup_side_image_url,
        }
      : undefined,
  };
}
