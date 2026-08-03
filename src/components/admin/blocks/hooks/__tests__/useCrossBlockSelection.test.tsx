// Testy zaznaczenia w POPRZEK bloków: przeciąganie myszą przez granicę bloku,
// Shift+strzałki (rozszerzanie i zawężanie), Shift+Home/End, zwykłe strzałki
// w trybie blokowym, pisanie po zaznaczeniu oraz arbitraż zagnieżdżonych kanw.
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { useCrossBlockSelection } from "../useCrossBlockSelection";

const BLOCK_IDS = ["b_1", "b_2", "b_3", "b_4"] as const;

function makeDoc(): BlocksDoc {
  const blocks: Block[] = BLOCK_IDS.map((id, i) => ({
    id,
    type: "paragraph",
    data: { html: `<p>akapit ${i + 1}</p>` },
  }));
  return { version: 1, blocks };
}

type SelectedIdsSpy = Mock<(ids: readonly string[]) => void>;
type SelectSpy = Mock<(id: string | null) => void>;
type ReplaceSpy = Mock<(typed: string) => void>;

interface Harness {
  root: HTMLDivElement;
  docRef: { current: BlocksDoc };
  activeIdRef: { current: string | null };
  selectedIdsRef: { current: readonly string[] };
  onSelectedIdsChange: SelectedIdsSpy;
  onSelect: SelectSpy;
  replaceSelection: ReplaceSpy;
}

function mountCanvasDom(id = "canvas"): HTMLDivElement {
  const canvas = document.createElement("div");
  canvas.id = id;
  canvas.setAttribute("data-block-canvas", "");
  canvas.tabIndex = -1;
  for (const blockId of BLOCK_IDS) {
    const row = document.createElement("div");
    row.setAttribute("data-block-id", blockId);
    const p = document.createElement("p");
    p.contentEditable = "true";
    p.id = `${id}-${blockId}`;
    p.append(document.createTextNode(`treść ${blockId}`));
    row.append(p);
    canvas.append(row);
  }
  document.body.append(canvas);
  return canvas;
}

function setupHook(overrides: Partial<Pick<Harness, "activeIdRef" | "selectedIdsRef">> = {}) {
  const root = mountCanvasDom();
  const harness: Harness = {
    root,
    docRef: { current: makeDoc() },
    activeIdRef: overrides.activeIdRef ?? { current: null },
    selectedIdsRef: overrides.selectedIdsRef ?? { current: [] },
    onSelectedIdsChange: vi.fn<(ids: readonly string[]) => void>(),
    onSelect: vi.fn<(id: string | null) => void>(),
    replaceSelection: vi.fn<(typed: string) => void>(),
  };
  const rootRef = { current: root };
  const rendered = renderHook(() =>
    useCrossBlockSelection({
      rootRef,
      docRef: harness.docRef,
      activeIdRef: harness.activeIdRef,
      selectedIdsRef: harness.selectedIdsRef,
      onSelectedIdsChange: harness.onSelectedIdsChange,
      onSelect: harness.onSelect,
      replaceSelection: harness.replaceSelection,
    }),
  );
  return { ...harness, rendered };
}

/** Ostatnie zaznaczenie przekazane rodzicowi. */
function lastSelection(mock: SelectedIdsSpy): readonly string[] {
  const calls = mock.mock.calls;
  return calls[calls.length - 1]?.[0] ?? [];
}

function pressKey(
  target: HTMLElement,
  key: string,
  mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  target.dispatchEvent(event);
  return event;
}

function selectAcross(fromEditableId: string, toEditableId: string): void {
  const from = document.getElementById(fromEditableId)?.firstChild;
  const to = document.getElementById(toEditableId)?.firstChild;
  if (!from || !to) throw new Error("brak węzłów tekstowych do zaznaczenia");
  const range = document.createRange();
  range.setStart(from, 0);
  range.setEnd(to, 2);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function dragOver(root: HTMLDivElement, fromEditableId: string, toEditableId: string): void {
  root.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  selectAcross(fromEditableId, toEditableId);
  document.dispatchEvent(new Event("selectionchange"));
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

describe("Shift+strzałki rozszerzają zaznaczenie blokowe", () => {
  it("startuje od aktywnego bloku i rozszerza w dół", () => {
    const h = setupHook({ activeIdRef: { current: "b_2" } });
    const event = pressKey(h.root, "ArrowDown", { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_2", "b_3"]);
    expect(h.onSelect).toHaveBeenCalledWith(null);
  });

  it("kolejne naciśnięcia rozszerzają, a przeciwny kierunek ZAWĘŻA zaznaczenie", () => {
    const h = setupHook({ activeIdRef: { current: "b_1" } });
    pressKey(h.root, "ArrowDown", { shiftKey: true });
    pressKey(h.root, "ArrowDown", { shiftKey: true });
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_1", "b_2", "b_3"]);
    pressKey(h.root, "ArrowUp", { shiftKey: true });
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_1", "b_2"]);
  });

  it("na krawędzi dokumentu nie zmienia zaznaczenia (ale blokuje przewijanie)", () => {
    const h = setupHook({ activeIdRef: { current: "b_4" } });
    const event = pressKey(h.root, "ArrowDown", { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it("Shift+End sięga końca, Shift+Home początku dokumentu", () => {
    const h = setupHook({ activeIdRef: { current: "b_2" } });
    pressKey(h.root, "End", { shiftKey: true });
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_2", "b_3", "b_4"]);
    pressKey(h.root, "Home", { shiftKey: true });
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_1", "b_2"]);
  });

  it("ignoruje zdarzenia z pól tekstowych (tam rządzi edytor inline)", () => {
    const h = setupHook({ activeIdRef: { current: "b_2" } });
    const editable = document.getElementById("canvas-b_2");
    if (!editable) throw new Error("brak pola edytowalnego");
    pressKey(editable, "ArrowDown", { shiftKey: true });
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it("bez aktywnego bloku i bez zaznaczenia nie robi nic", () => {
    const h = setupHook();
    const event = pressKey(h.root, "ArrowDown", { shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });
});

describe("kontroler: eskalacja z edytora inline i zakresy", () => {
  it("extendFromBlock zaznacza blok źródłowy i sąsiada oraz oddaje fokus kanwie", () => {
    const h = setupHook();
    const editable = document.getElementById("canvas-b_2");
    editable?.focus();
    selectAcross("canvas-b_2", "canvas-b_2");

    const handled = h.rendered.result.current.extendFromBlock("b_2", 1);

    expect(handled).toBe(true);
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_2", "b_3"]);
    expect(document.activeElement).toBe(h.root);
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
  });

  it("extendFromBlock na krawędzi dokumentu zwraca false", () => {
    const h = setupHook();
    expect(h.rendered.result.current.extendFromBlock("b_4", 1)).toBe(false);
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it("anchorTo czyści zaznaczenie i ustawia kotwicę dla późniejszego Shift+klik", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    h.rendered.result.current.anchorTo("b_3");
    expect(lastSelection(h.onSelectedIdsChange)).toEqual([]);
    expect(h.onSelect).toHaveBeenCalledWith("b_3");

    expect(h.rendered.result.current.extendTo("b_1")).toBe(true);
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_1", "b_2", "b_3"]);
  });

  it("extendTo w ten sam blok nie zmienia zaznaczenia", () => {
    const h = setupHook();
    h.rendered.result.current.anchorTo("b_2");
    expect(h.rendered.result.current.extendTo("b_2")).toBe(false);
  });

  it("toggle dokłada i zdejmuje blok, zachowując kolejność dokumentu", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_3"] } });
    h.rendered.result.current.toggle("b_1");
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_1", "b_3"]);
    h.rendered.result.current.toggle("b_1");
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_3"]);
  });

  it("selectAll zaznacza wszystkie bloki i przenosi fokus na kanwę", () => {
    const h = setupHook();
    h.rendered.result.current.selectAll();
    expect(lastSelection(h.onSelectedIdsChange)).toEqual([...BLOCK_IDS]);
    expect(document.activeElement).toBe(h.root);
  });

  it("selectRange zaznacza gotowy zakres (świeże kopie po duplikacji)", () => {
    const h = setupHook();
    h.rendered.result.current.selectRange("b_2", "b_4");
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_2", "b_3", "b_4"]);
  });

  it("clear zeruje zaznaczenie", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    h.rendered.result.current.clear();
    expect(lastSelection(h.onSelectedIdsChange)).toEqual([]);
  });
});

describe("przeciąganie myszą przez granicę bloku", () => {
  it("zamienia zaznaczenie tekstowe na zaznaczenie CAŁYCH bloków", () => {
    const h = setupHook();
    dragOver(h.root, "canvas-b_1", "canvas-b_3");
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_1", "b_2", "b_3"]);
    expect(h.root.getAttribute("data-multi-selecting")).toBe("true");
  });

  it("po puszczeniu przycisku gasi karetkę i oddaje fokus kanwie", () => {
    const h = setupHook();
    dragOver(h.root, "canvas-b_1", "canvas-b_3");
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(h.root.getAttribute("data-multi-selecting")).toBeNull();
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
    expect(document.activeElement).toBe(h.root);
  });

  it("powrót do jednego bloku oddaje zaznaczenie natywnemu tekstowi", () => {
    const h = setupHook();
    dragOver(h.root, "canvas-b_1", "canvas-b_3");
    selectAcross("canvas-b_1", "canvas-b_1");
    document.dispatchEvent(new Event("selectionchange"));
    expect(lastSelection(h.onSelectedIdsChange)).toEqual([]);
    expect(h.root.getAttribute("data-multi-selecting")).toBeNull();
  });

  it("zaznaczenie wewnątrz JEDNEGO bloku nie tworzy zaznaczenia blokowego", () => {
    const h = setupHook();
    dragOver(h.root, "canvas-b_2", "canvas-b_2");
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it("zmiana selekcji bez wciśniętego przycisku nie zaznacza bloków", () => {
    const h = setupHook();
    selectAcross("canvas-b_1", "canvas-b_3");
    document.dispatchEvent(new Event("selectionchange"));
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it("prawy przycisk myszy nie rozpoczyna zaznaczania blokowego", () => {
    const h = setupHook();
    h.root.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
    selectAcross("canvas-b_1", "canvas-b_3");
    document.dispatchEvent(new Event("selectionchange"));
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });
});

describe("pisanie po zaznaczeniu wielu bloków", () => {
  it("znak zastępuje zaznaczone bloki akapitem", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    const event = pressKey(h.root, "x");
    expect(event.defaultPrevented).toBe(true);
    expect(h.replaceSelection).toHaveBeenCalledWith("x");
  });

  it("Enter zastępuje zaznaczenie pustym akapitem", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    pressKey(h.root, "Enter");
    expect(h.replaceSelection).toHaveBeenCalledWith("");
  });

  it("JEDEN zaznaczony blok nie jest nadpisywany przypadkowym klawiszem", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1"] } });
    pressKey(h.root, "x");
    expect(h.replaceSelection).not.toHaveBeenCalled();
  });

  it("skróty z modyfikatorami przechodzą dalej (Ctrl+C, Ctrl+B…)", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    const event = pressKey(h.root, "c", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(h.replaceSelection).not.toHaveBeenCalled();
  });

  it("klawisz wpisany na elemencie POZA kanwą nie rusza dokumentu", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    const outsideButton = document.createElement("button");
    document.body.append(outsideButton);
    pressKey(outsideButton, "x");
    expect(h.replaceSelection).not.toHaveBeenCalled();
  });

  it("klawisz przy zgubionym fokusie (body) obsługuje kanwa", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    pressKey(document.body, "x");
    expect(h.replaceSelection).toHaveBeenCalledWith("x");
  });

  it("Delete/Backspace nie idą tą ścieżką (usuwaniem zajmuje się kanwa)", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    pressKey(h.root, "Backspace");
    pressKey(h.root, "Delete");
    expect(h.replaceSelection).not.toHaveBeenCalled();
  });
});

describe("zwykłe strzałki w trybie blokowym", () => {
  it("zwijają zaznaczenie do sąsiedniego bloku", () => {
    const h = setupHook({ selectedIdsRef: { current: ["b_1", "b_2"] } });
    const event = pressKey(h.root, "ArrowDown");
    expect(event.defaultPrevented).toBe(true);
    expect(lastSelection(h.onSelectedIdsChange)).toEqual(["b_3"]);
  });

  it("bez zaznaczenia nie przejmują strzałek (nawigacja zostaje natywna)", () => {
    const h = setupHook({ activeIdRef: { current: "b_2" } });
    const event = pressKey(h.root, "ArrowDown");
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("arbitraż zagnieżdżonych kanw", () => {
  it("zdarzenie spoza kanw obsługuje kanwa zamontowana najpóźniej", () => {
    const first = setupHook({ activeIdRef: { current: "b_2" } });
    // Druga kanwa (np. edytor bloków w modalu buildera) montuje się później.
    const secondRoot = mountCanvasDom("canvas-2");
    const secondRef = { current: secondRoot };
    const secondSelected: { current: readonly string[] } = { current: [] };
    const onSecondSelectedIdsChange: SelectedIdsSpy = vi.fn();
    renderHook(() =>
      useCrossBlockSelection({
        rootRef: secondRef,
        docRef: { current: makeDoc() },
        activeIdRef: { current: "b_2" },
        selectedIdsRef: secondSelected,
        onSelectedIdsChange: onSecondSelectedIdsChange,
        onSelect: vi.fn<(id: string | null) => void>(),
        replaceSelection: vi.fn<(typed: string) => void>(),
      }),
    );

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true, bubbles: true }),
    );

    expect(onSecondSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(first.onSelectedIdsChange).not.toHaveBeenCalled();
  });

  it("zdarzenie wewnątrz konkretnej kanwy obsługuje TA kanwa", () => {
    const first = setupHook({ activeIdRef: { current: "b_2" } });
    const secondRoot = mountCanvasDom("canvas-2");
    const onSecondSelectedIdsChange: SelectedIdsSpy = vi.fn();
    renderHook(() =>
      useCrossBlockSelection({
        rootRef: { current: secondRoot },
        docRef: { current: makeDoc() },
        activeIdRef: { current: "b_2" },
        selectedIdsRef: { current: [] },
        onSelectedIdsChange: onSecondSelectedIdsChange,
        onSelect: vi.fn<(id: string | null) => void>(),
        replaceSelection: vi.fn<(typed: string) => void>(),
      }),
    );

    pressKey(first.root, "ArrowDown", { shiftKey: true });

    expect(first.onSelectedIdsChange).toHaveBeenCalledTimes(1);
    expect(onSecondSelectedIdsChange).not.toHaveBeenCalled();
  });
});

describe("sprzątanie", () => {
  it("odmontowanie zdejmuje atrybut trybu przeciągania i wypina listenery", () => {
    const h = setupHook({ activeIdRef: { current: "b_2" } });
    dragOver(h.root, "canvas-b_1", "canvas-b_3");
    expect(h.root.getAttribute("data-multi-selecting")).toBe("true");

    h.rendered.unmount();

    expect(h.root.getAttribute("data-multi-selecting")).toBeNull();
    h.onSelectedIdsChange.mockClear();
    pressKey(h.root, "ArrowDown", { shiftKey: true });
    expect(h.onSelectedIdsChange).not.toHaveBeenCalled();
  });
});
