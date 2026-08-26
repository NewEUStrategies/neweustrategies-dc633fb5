// Wspolny ZESTAW NARZEDZI do budowania szablonow buildera w kodzie.
//
// DLACZEGO OSOBNY MODUL. Szablony startowe palety (`starterTemplates`) i szablony
// podstron wydarzenia (`lib/events/eventPageTemplates`) skladaja te same trzy
// wezly: widget z domyslnymi wartosciami z rejestru, kolumne o zadanym rozstawie
// i sekcje o standardowej szerokosci. Gdyby kazdy z tych plikow mial wlasna
// kopie helperow, zmiana domyslnej szerokosci sekcji (1200) albo sposobu
// czytania `defaults()` z rejestru dotykalaby jednego zestawu szablonow i cicho
// pomijala drugi - a rozjazd bylo by widac tylko na wstawionej stronie.
//
// KAZDE WOLANIE DAJE SWIEZE `id` (wzorzec `homepageTemplate`), wiec ten sam
// szablon mozna wstawic wielokrotnie bez kolizji identyfikatorow w dokumencie.
import type { ColumnNode, SectionNode, WidgetContent, WidgetNode, WidgetType } from "./types";
import { newId } from "./types";
import { WIDGET_MAP } from "./registry";

/** Widget z domyslnymi wartosciami REJESTRU pod nadpisaniami szablonu. */
export const widget = (
  type: WidgetType,
  overrides: WidgetContent = {},
  node: Partial<Pick<WidgetNode, "style" | "advanced">> = {},
): WidgetNode => {
  const def = WIDGET_MAP[type];
  const defaults = (def?.defaults?.() ?? {}) as WidgetContent;
  return {
    id: newId(),
    kind: "widget",
    type,
    content: { ...defaults, ...overrides },
    ...node,
  };
};

export const column = (span: number, children: WidgetNode[] = []): ColumnNode => ({
  id: newId(),
  kind: "column",
  span: { desktop: span },
  children,
});

export const section = (cols: ColumnNode[], opts: Partial<SectionNode> = {}): SectionNode => ({
  id: newId(),
  kind: "section",
  children: cols,
  ...opts,
});

/** Standardowa sekcja tresci: boxed 1200 + odstep dolny. */
export const contentLayout = (marginBottom = 48) => ({
  layout: { contentWidth: "boxed" as const, width: 1200, marginBottom },
});

/** Wysrodkowanie zawartosci widgetu na desktopie. */
export const centered = { style: { align: { desktop: "center" as const } } };
