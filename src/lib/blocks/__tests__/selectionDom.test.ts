import { describe, it, expect, beforeEach } from "vitest";
import {
  clearDomSelection,
  domSelectionEnds,
  enterBlockSelectionMode,
  isEditableTarget,
  topLevelBlockIdFromNode,
} from "@/lib/blocks/selectionDom";

/** Kanwa z trzema blokami top-level; blok `b_2` ma zagnieżdżone dziecko. */
function mountCanvas(): HTMLElement {
  document.body.innerHTML = `
    <div data-block-canvas tabindex="-1" id="canvas">
      <div data-block-id="b_1"><p contenteditable="true" id="p1">pierwszy</p></div>
      <div data-block-id="b_2">
        <div data-nested-canvas>
          <div data-block-id="b_2_child"><p contenteditable="true" id="p2">dziecko</p></div>
        </div>
      </div>
      <div data-block-id="b_3"><p contenteditable="true" id="p3">trzeci</p></div>
    </div>
    <p id="outside">poza kanwą</p>`;
  const root = document.getElementById("canvas");
  if (!root) throw new Error("brak kanwy w DOM");
  return root;
}

function textNode(selector: string): Node {
  const node = document.querySelector(selector)?.firstChild;
  if (!node) throw new Error(`brak węzła tekstowego dla ${selector}`);
  return node;
}

function select(startSelector: string, endSelector: string): void {
  const range = document.createRange();
  range.setStart(textNode(startSelector), 0);
  range.setEnd(textNode(endSelector), 1);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("isEditableTarget", () => {
  beforeEach(() => {
    mountCanvas();
  });

  it("rozpoznaje treści edytowalne i pola formularza", () => {
    expect(isEditableTarget(document.getElementById("p1"))).toBe(true);
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(select)).toBe(true);
  });

  it("rozpoznaje treść wewnątrz hosta edycji i węzeł wewnątrz kontrolki", () => {
    const strong = document.createElement("strong");
    document.getElementById("p1")?.append(strong);
    expect(isEditableTarget(strong)).toBe(true);

    const select = document.createElement("select");
    const option = document.createElement("option");
    select.append(option);
    document.body.append(select);
    expect(isEditableTarget(option)).toBe(true);
  });

  it("nie uznaje kanwy ani braku targetu za pole tekstowe", () => {
    expect(isEditableTarget(document.getElementById("canvas"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("topLevelBlockIdFromNode", () => {
  it("mapuje węzeł tekstowy na blok top-level", () => {
    const root = mountCanvas();
    expect(topLevelBlockIdFromNode(textNode("#p1"), root)).toBe("b_1");
  });

  it("dziecko kontenera wskazuje blok NADRZĘDNY (zaznaczenie działa na top-level)", () => {
    const root = mountCanvas();
    expect(topLevelBlockIdFromNode(textNode("#p2"), root)).toBe("b_2");
  });

  it("zwraca null dla węzła poza kanwą i dla samej kanwy", () => {
    const root = mountCanvas();
    expect(topLevelBlockIdFromNode(textNode("#outside"), root)).toBeNull();
    expect(topLevelBlockIdFromNode(root, root)).toBeNull();
    expect(topLevelBlockIdFromNode(null, root)).toBeNull();
  });

  it("zwraca null dla węzła odpiętego od dokumentu", () => {
    const root = mountCanvas();
    const detached = document.createElement("div");
    detached.setAttribute("data-block-id", "b_x");
    expect(topLevelBlockIdFromNode(detached, root)).toBeNull();
  });
});

describe("domSelectionEnds", () => {
  it("zwraca końce zaznaczenia sięgającego dwóch bloków", () => {
    const root = mountCanvas();
    select("#p1", "#p3");
    expect(domSelectionEnds(root, window.getSelection())).toEqual({
      anchorId: "b_1",
      focusId: "b_3",
    });
  });

  it("dla zaznaczenia wewnątrz jednego bloku oba końce są takie same", () => {
    const root = mountCanvas();
    select("#p1", "#p1");
    expect(domSelectionEnds(root, window.getSelection())).toEqual({
      anchorId: "b_1",
      focusId: "b_1",
    });
  });

  it("zaznaczenie między dziećmi jednego kontenera nie jest zaznaczeniem dwóch bloków", () => {
    const root = mountCanvas();
    select("#p2", "#p2");
    const ends = domSelectionEnds(root, window.getSelection());
    expect(ends?.anchorId).toBe(ends?.focusId);
  });

  it("zwraca null dla zwiniętej selekcji, braku selekcji i selekcji poza kanwą", () => {
    const root = mountCanvas();
    clearDomSelection();
    expect(domSelectionEnds(root, window.getSelection())).toBeNull();
    expect(domSelectionEnds(root, null)).toBeNull();
    select("#outside", "#outside");
    expect(domSelectionEnds(root, window.getSelection())).toBeNull();
  });
});

describe("enterBlockSelectionMode", () => {
  it("gasi karetkę, czyści selekcję i przenosi fokus na kanwę", () => {
    const root = mountCanvas();
    const editable = document.getElementById("p1");
    editable?.focus();
    select("#p1", "#p3");
    expect(window.getSelection()?.isCollapsed).toBe(false);

    enterBlockSelectionMode(root);

    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
    expect(document.activeElement).toBe(root);
  });

  it("jest bezpieczne, gdy kanwy nie ma (odmontowanie w trakcie)", () => {
    mountCanvas();
    expect(() => enterBlockSelectionMode(null)).not.toThrow();
  });
});
