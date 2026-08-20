// Zdarzenia DOM dla testów kanwy buildera - moduł BEZ importów produkcyjnych.
//
// happy-dom nie odwzorowuje pełnych klas zdarzeń: `DragEvent` nie dziedziczy
// po `MouseEvent`, a `PointerEvent` nie przenosi współrzędnych z inicjalizatora.
// `fireEvent.drop(el, { clientY })` gubi więc `clientY` - a kanwa liczy z niego
// połowę celu (przed/za). Test „na skróty" wychodziłby zielony dla dolnej
// połowy i czerwony dla górnej, bez winy produkcji. Dlatego zdarzenia
// budujemy tu ręcznie.
//
// Osobny plik (a nie część `canvasHarness`), bo korzystają z tego także testy
// komponentów, które nie chcą ciągnąć całej kanwy i jej dzieci.
import { fireEvent } from "@testing-library/react";
import { vi } from "vitest";

/** Atrapa `DataTransfer`: kanwa czyta z niej wyłącznie `types` i `getData`. */
export function transfer(payload: Record<string, string>) {
  return {
    getData: (mime: string) => payload[mime] ?? "",
    setData: vi.fn(),
    types: Object.keys(payload),
    setDragImage: vi.fn(),
    effectAllowed: "",
    dropEffect: "",
  };
}

export type TransferStub = ReturnType<typeof transfer>;

export interface DragEventInit {
  clientX?: number;
  clientY?: number;
  dataTransfer?: TransferStub;
  relatedTarget?: EventTarget | null;
  /**
   * Zdarzenie BEZ `dataTransfer`. Przeglądarki zawsze je dają, ale produkcja
   * pilnuje tego jawnie (`e.dataTransfer?`) - a nieotestowana straż to straż,
   * o której nie wiadomo, czy działa.
   */
  withoutDataTransfer?: boolean;
}

/**
 * Zdarzenie przeciągania złożone ręcznie - patrz komentarz na górze pliku.
 * Zwraca użytą atrapę `DataTransfer`, bo produkcja ustawia na niej
 * `dropEffect` i to jest asercja na „czy tu wolno upuścić".
 */
export function fireDragEvent(
  type: "dragstart" | "dragover" | "dragleave" | "drop" | "dragend",
  el: HTMLElement | Window,
  init: DragEventInit = {},
): TransferStub {
  const dt = init.dataTransfer ?? transfer({});
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clientX", { value: init.clientX ?? 0 });
  Object.defineProperty(evt, "clientY", { value: init.clientY ?? 0 });
  Object.defineProperty(evt, "dataTransfer", {
    value: init.withoutDataTransfer ? null : dt,
  });
  if ("relatedTarget" in init) {
    Object.defineProperty(evt, "relatedTarget", { value: init.relatedTarget ?? null });
  }
  fireEvent(el, evt);
  return dt;
}

/** Skrót na najczęstszy przypadek: upuszczenie ładunku w danym punkcie. */
export function fireDrop(
  el: HTMLElement,
  payload: Record<string, string>,
  clientY = 0,
): TransferStub {
  return fireDragEvent("drop", el, { dataTransfer: transfer(payload), clientY });
}

export interface PointerInit {
  pointerId?: number;
  button?: number;
  clientX?: number;
  clientY?: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Zdarzenie wskaźnika złożone ręcznie - z tego samego powodu co przeciąganie:
 * happy-dom nie przenosi współrzędnych z inicjalizatora do `PointerEvent`,
 * a prostokąt zaznaczenia liczy się WYŁĄCZNIE z nich.
 */
export function firePointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  el: HTMLElement,
  init: PointerInit = {},
): void {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  const fields: Record<string, unknown> = {
    pointerId: init.pointerId ?? 1,
    button: init.button ?? 0,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    shiftKey: init.shiftKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  };
  for (const [name, value] of Object.entries(fields)) {
    Object.defineProperty(evt, name, { value });
  }
  fireEvent(el, evt);
}

/**
 * Prostokąt o znanym rozmiarze dla WSZYSTKICH elementów: góra 100, wysokość
 * 100 (połowa = 150), lewa 0, szerokość 200 (połowa = 100).
 */
export function stubClientRect(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 100,
    left: 0,
    top: 100,
    right: 200,
    bottom: 200,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  });
}
