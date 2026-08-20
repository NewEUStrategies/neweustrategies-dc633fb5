// Wspólna oprawa testów KANWY WIZUALNEJ buildera.
//
// Kanwa ma kilkanaście wywołań zwrotnych (wstawianie, przenoszenie, wybór,
// zmiana rozmiaru) i dwa pliki testowe: upuszczanie i pozostała warstwa
// sterowania (zaznaczanie, prostokąt zaznaczenia, znaczniki przeciągania).
// Bez wspólnej oprawy te pliki rozjechałyby się w atrapach - a wtedy zielony
// test jednego z nich nic już nie mówi o drugim.
//
// Dwie rzeczy są tu ważniejsze niż skrócenie zapisu:
//  1. `fireDrop`/`fireDragEvent` budują zdarzenie RĘCZNIE. `DragEvent`
//     w happy-dom nie dziedziczy po `MouseEvent`, więc `clientX`/`clientY`
//     podane w inicjalizatorze `fireEvent.drop` PRZEPADAJĄ - a kanwa liczy
//     z nich połowę celu (przed/za). Test „na skróty" wychodziłby wtedy
//     zielony dla dolnej połowy i czerwony dla górnej, bez winy produkcji.
//  2. `stubClientRect` daje wszystkim elementom znany prostokąt, bo happy-dom
//     nie robi layoutu i każdy `getBoundingClientRect` byłby zerowy - czyli
//     każda połowa wypadałaby tak samo.
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type {
  BuilderDocument,
  ColumnNode,
  Device,
  SectionNode,
  WidgetNode,
} from "@/lib/builder/types";
export {
  fireDragEvent,
  fireDrop,
  firePointerEvent,
  stubClientRect,
  transfer,
  type DragEventInit,
  type PointerInit,
  type TransferStub,
} from "./domEvents";
import { VisualCanvas } from "@/components/admin/builder/ui/organisms/builder/VisualCanvas";
import type { Selection } from "@/components/admin/builder/ui/organisms/builder/types";

export const wgt = (id: string, type: WidgetNode["type"] = "text"): WidgetNode => ({
  id,
  kind: "widget",
  type,
  content: {},
});

export const column = (id: string, children: WidgetNode[] = []): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 12 },
  children,
});

export const section = (id: string, children: SectionNode["children"]): SectionNode => ({
  id,
  kind: "section",
  children,
});

/** Dwie sekcje, pierwsza z dwoma widgetami, druga z pustą kolumną. */
export const CANVAS_DOC: BuilderDocument = {
  version: 1,
  sections: [
    section("s1", [column("c1", [wgt("w1"), wgt("w2")])]),
    section("s2", [column("c2", [])]),
  ],
};

export function canvasHandlers() {
  return {
    setSelection: vi.fn(),
    onInsertSection: vi.fn(),
    onInsertSectionToTab: vi.fn(),
    onInsertSectionToContainer: vi.fn(),
    onInsertContainer: vi.fn(),
    onMoveWidget: vi.fn(),
    onMoveWidgetToColumn: vi.fn(),
    onMoveWidgetToSection: vi.fn(),
    onMoveSection: vi.fn(),
    onDropNewWidgetToColumn: vi.fn(),
    onDropNewWidgetNear: vi.fn(),
    onDropNewWidgetToSection: vi.fn(),
    onMultiSelectionChange: vi.fn(),
    onWidgetContentChange: vi.fn(),
    onWidgetResize: vi.fn(),
  };
}

export type CanvasHandlers = ReturnType<typeof canvasHandlers>;

export interface CanvasExtras extends Partial<CanvasHandlers> {
  selection?: Selection;
  multiSelection?: ReadonlySet<string>;
  device?: Device;
  lang?: "pl" | "en";
  /** Jawne `undefined` wyłącza gałąź w drzewie renderowania. */
  omit?: ReadonlyArray<"onMultiSelectionChange" | "onWidgetContentChange" | "onWidgetResize">;
}

export function renderCanvas(doc: BuilderDocument = CANVAS_DOC, extra: CanvasExtras = {}) {
  const h: CanvasHandlers = { ...canvasHandlers(), ...extra };
  const omit = new Set(extra.omit ?? []);
  const view = render(
    <VisualCanvas
      doc={doc}
      lang={extra.lang ?? "pl"}
      device={extra.device ?? "desktop"}
      selection={extra.selection ?? { kind: null, id: null }}
      firstLabel="pierwsza"
      lastLabel="ostatnia"
      multiSelection={extra.multiSelection}
      {...h}
      onMultiSelectionChange={
        omit.has("onMultiSelectionChange") ? undefined : h.onMultiSelectionChange
      }
      onWidgetContentChange={
        omit.has("onWidgetContentChange") ? undefined : h.onWidgetContentChange
      }
      onWidgetResize={omit.has("onWidgetResize") ? undefined : h.onWidgetResize}
    />,
  );
  const canvas = view.container.querySelector<HTMLElement>("[data-visual-canvas]");
  if (!canvas) throw new Error("test: brak korzenia kanwy");
  return { ...view, h, canvas };
}

/** Element kanwy po atrybucie danych - z czytelnym błędem, gdy go nie ma. */
export const canvasNode = (attr: string, id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[${attr}="${id}"]`);
  if (!found) throw new Error(`test: brak elementu [${attr}="${id}"]`);
  return found;
};
