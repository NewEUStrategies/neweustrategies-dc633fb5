// Behavioral tests for the stable inline font-size toolbar (v2).
// Covers the three regressions from the recording:
//  1. value must be VISIBLE (override from doc, else measured effective size),
//  2. toolbar must sit ABOVE the widget frame (never over its own content),
//  3. lifecycle must be predictable (survives re-render, closes on Escape /
//     other-widget selection / widget removal, Reset clears the override).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { InlineSizeToolbar } from "../ui/organisms/InlineSizeToolbar";
import {
  EDIT_TARGET_META,
  FORM_SIZE_FIELDS,
  clampEditTarget,
  isEditTargetKey,
  measureEditTargetPx,
} from "@/lib/builder/editTargets";
import type { BuilderDocument, WidgetNode } from "@/lib/builder/types";

const WIDGET_ID = "w-join";

function makeDoc(content: Record<string, unknown> = {}): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            children: [
              { id: WIDGET_ID, kind: "widget", type: "join-us", content } as unknown as WidgetNode,
            ],
          },
        ],
      },
    ],
  } as unknown as BuilderDocument;
}

/** Fake canvas DOM: [data-visual-canvas] > widget > edit-target element. */
function mountCanvasDom() {
  const canvas = document.createElement("div");
  canvas.setAttribute("data-visual-canvas", "");
  const widget = document.createElement("div");
  widget.setAttribute("data-widget-id", WIDGET_ID);
  const el = document.createElement("p");
  el.setAttribute("data-edit-target", "descriptionSize");
  el.textContent = "Otrzymuj najnowsze artykuły";
  el.style.fontSize = "14px";
  widget.appendChild(el);
  canvas.appendChild(widget);
  document.body.appendChild(canvas);

  // happy-dom returns zero rects; the toolbar needs real geometry.
  el.getBoundingClientRect = () =>
    ({ top: 300, left: 200, width: 400, height: 20, right: 600, bottom: 320 }) as DOMRect;
  widget.getBoundingClientRect = () =>
    ({ top: 240, left: 150, width: 600, height: 400, right: 750, bottom: 640 }) as DOMRect;
  return { canvas, widget, el };
}

async function pumpFrames(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
  }
}

describe("editTargets metadata", () => {
  it("recognizes exactly the stamped keys and clamps into range", () => {
    expect(isEditTargetKey("descriptionSize")).toBe(true);
    expect(isEditTargetKey("buttonFontSize")).toBe(true);
    expect(isEditTargetKey("nope")).toBe(false);
    expect(clampEditTarget("consentSize", 999)).toBe(EDIT_TARGET_META.consentSize.max);
    expect(clampEditTarget("consentSize", 1)).toBe(EDIT_TARGET_META.consentSize.min);
  });

  it("panel field lists cover both form widgets with their own button keys", () => {
    const joinKeys = FORM_SIZE_FIELDS["join-us"].map((f) => f.key);
    const cfKeys = FORM_SIZE_FIELDS["contact-form"].map((f) => f.key);
    expect(joinKeys).toContain("buttonSize");
    expect(joinKeys).not.toContain("buttonFontSize");
    expect(cfKeys).toContain("buttonFontSize");
    expect(cfKeys).not.toContain("buttonSize");
    // Every panel key has toolbar metadata - the two surfaces cannot drift.
    [...joinKeys, ...cfKeys].forEach((k) => expect(EDIT_TARGET_META[k]).toBeTruthy());
  });

  it("measureEditTargetPx reads the computed size from the canvas DOM", () => {
    const { el } = mountCanvasDom();
    el.style.fontSize = "18px";
    expect(measureEditTargetPx(WIDGET_ID, "descriptionSize")).toBe(18);
  });
});

describe("InlineSizeToolbar", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  function setup(content: Record<string, unknown> = {}) {
    const dom = mountCanvasDom();
    const setSelection = vi.fn();
    const updateWidget = vi.fn();
    const doc = makeDoc(content);
    const utils = render(
      <InlineSizeToolbar
        doc={doc}
        selection={{ kind: "widget", id: WIDGET_ID }}
        setSelection={setSelection}
        updateWidget={updateWidget}
      />,
    );
    return { ...dom, setSelection, updateWidget, doc, utils };
  }

  it("opens on click, shows the stored override and marks widget as selected", async () => {
    const { el, setSelection } = setup({ descriptionSize: 17 });
    fireEvent.click(el);
    await pumpFrames();
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toBeTruthy();
    expect(setSelection).toHaveBeenCalledWith({ kind: "widget", id: WIDGET_ID });
    const input = screen.getByLabelText(/Rozmiar w px/i) as HTMLInputElement;
    expect(input.value).toBe("17");
    // Explicit override → no "auto" badge.
    expect(toolbar.textContent).not.toContain("auto");
  });

  it("shows the MEASURED effective size (visible value) when no override is set", async () => {
    const { el } = setup({});
    el.style.fontSize = "14px";
    fireEvent.click(el);
    await pumpFrames();
    const input = screen.getByLabelText(/Rozmiar w px/i) as HTMLInputElement;
    expect(input.value).toBe("14");
    expect(screen.getByRole("toolbar").textContent).toContain("auto");
  });

  it("positions the toolbar ABOVE the widget frame, not over widget content", async () => {
    const { el } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    const toolbar = screen.getByRole("toolbar");
    const top = parseFloat(toolbar.style.top);
    // widget top = 240, toolbar height 30 + 8 gap → 202: fully outside the widget.
    expect(top).toBeLessThanOrEqual(240 - 30);
  });

  it("+ / - commit clamped overrides through updateWidget", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 14 });
    fireEvent.click(el);
    await pumpFrames();
    fireEvent.click(screen.getByLabelText("Zwiększ rozmiar"));
    expect(updateWidget).toHaveBeenCalledTimes(1);
    const [id, mut] = updateWidget.mock.calls[0];
    expect(id).toBe(WIDGET_ID);
    const w = { content: { descriptionSize: 14 } } as unknown as WidgetNode;
    mut(w);
    expect((w.content as Record<string, unknown>).descriptionSize).toBe(15);
  });

  it("typing a value commits on Enter; Reset removes the override", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 14 });
    fireEvent.click(el);
    await pumpFrames();
    const input = screen.getByLabelText(/Rozmiar w px/i) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "22" } });
    fireEvent.keyDown(input, { key: "Enter" });
    let w = { content: { descriptionSize: 14 } } as unknown as WidgetNode;
    updateWidget.mock.calls.at(-1)![1](w);
    expect((w.content as Record<string, unknown>).descriptionSize).toBe(22);

    fireEvent.click(screen.getByTitle("Przywróć domyślny rozmiar"));
    w = { content: { descriptionSize: 22 } } as unknown as WidgetNode;
    updateWidget.mock.calls.at(-1)![1](w);
    expect((w.content as Record<string, unknown>).descriptionSize).toBeUndefined();
  });

  it("closes on Escape and on selecting a different widget; ✕ also closes", async () => {
    const { el, utils, setSelection, updateWidget, doc } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    expect(screen.queryByRole("toolbar")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await pumpFrames(1);
    expect(screen.queryByRole("toolbar")).toBeNull();

    // Re-open, then simulate selection moving to another widget.
    fireEvent.click(el);
    await pumpFrames();
    expect(screen.queryByRole("toolbar")).toBeTruthy();
    utils.rerender(
      <InlineSizeToolbar
        doc={doc}
        selection={{ kind: "widget", id: "other" }}
        setSelection={setSelection}
        updateWidget={updateWidget}
      />,
    );
    await pumpFrames(1);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("survives a canvas re-render that remounts the target element", async () => {
    const { el, widget } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    expect(screen.queryByRole("toolbar")).toBeTruthy();

    // Simulate React swapping the DOM node (same data-edit-target key).
    const replacement = el.cloneNode(true) as HTMLElement;
    replacement.getBoundingClientRect = el.getBoundingClientRect;
    widget.replaceChild(replacement, el);
    await pumpFrames(4);
    expect(screen.queryByRole("toolbar")).toBeTruthy();
  });

  it("closes when the widget disappears from the document", async () => {
    const { el, utils, setSelection, updateWidget } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    expect(screen.queryByRole("toolbar")).toBeTruthy();
    utils.rerender(
      <InlineSizeToolbar
        doc={{ version: 1, sections: [] } as unknown as BuilderDocument}
        selection={{ kind: "widget", id: WIDGET_ID }}
        setSelection={setSelection}
        updateWidget={updateWidget}
      />,
    );
    await pumpFrames(1);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("ignores clicks on elements without a supported data-edit-target", async () => {
    const { widget } = setup({});
    const stray = document.createElement("span");
    stray.setAttribute("data-edit-target", "not-a-real-key");
    widget.appendChild(stray);
    fireEvent.click(stray);
    await pumpFrames();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

// Uzupełnienie (PL): gałęzie, których pierwsza wersja tego pliku nie ruszała -
// klawiatura poza belką, czyszczenie wartości do trybu automatycznego,
// awaryjne umiejscowienie belki i mostek do panelu właściwości.
describe("InlineSizeToolbar - klawiatura, czyszczenie i umiejscowienie", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  function setup(content: Record<string, unknown> = {}, rects?: { widgetTop: number }) {
    const dom = mountCanvasDom();
    if (rects) {
      dom.widget.getBoundingClientRect = () =>
        ({
          top: rects.widgetTop,
          left: 150,
          width: 600,
          height: 400,
          right: 750,
          bottom: rects.widgetTop + 400,
        }) as DOMRect;
    }
    const setSelection = vi.fn();
    const updateWidget = vi.fn();
    const doc = makeDoc(content);
    const utils = render(
      <InlineSizeToolbar
        doc={doc}
        selection={{ kind: "widget", id: WIDGET_ID }}
        setSelection={setSelection}
        updateWidget={updateWidget}
      />,
    );
    return { ...dom, setSelection, updateWidget, doc, utils };
  }

  /** Wynik ostatniego zapisu: mutator zastosowany na kopii treści widgetu. */
  function lastWrite(updateWidget: ReturnType<typeof vi.fn>, from: Record<string, unknown>) {
    const w = { content: { ...from } } as unknown as WidgetNode;
    updateWidget.mock.calls.at(-1)![1](w);
    return w.content as Record<string, unknown>;
  }

  it.each([
    ["strzałka w górę dokłada 1 px", "ArrowUp", false, 15],
    ["strzałka w dół zabiera 1 px", "ArrowDown", false, 13],
    ["Shift przyspiesza do 4 px", "ArrowUp", true, 18],
  ])("%s", async (_label, key, shiftKey, expected) => {
    const { el, updateWidget } = setup({ descriptionSize: 14 });
    fireEvent.click(el);
    await pumpFrames();
    fireEvent.keyDown(window, { key, shiftKey });
    // Strzałki muszą działać BEZ wchodzenia w pole - to jest cały sens belki
    // przy klikaniu po kanwie.
    expect(lastWrite(updateWidget, { descriptionSize: 14 }).descriptionSize).toBe(expected);
  });

  it("strzałki w polu belki obsługuje samo pole, nie skrót globalny", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 14 });
    fireEvent.click(el);
    await pumpFrames();
    const input = screen.getByLabelText(/Rozmiar w px/i) as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(window, { key: "ArrowUp" });
    // Skrót globalny nie może zadziałać PODWÓJNIE razem z polem.
    expect(updateWidget).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(lastWrite(updateWidget, { descriptionSize: 14 }).descriptionSize).toBe(18);
  });

  it("strzałki w obcym polu formularza nie ruszają rozmiaru", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 14 });
    fireEvent.click(el);
    await pumpFrames();
    const outside = document.createElement("input");
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    // Redaktor pisze w innym polu panelu - strzałka jest jego, nie belki.
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("wyczyszczenie pola wraca do rozmiaru automatycznego", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 20 });
    fireEvent.click(el);
    await pumpFrames();
    const input = screen.getByLabelText(/Rozmiar w px/i) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    // Puste pole to nie zero - to rezygnacja z nadpisania.
    expect(lastWrite(updateWidget, { descriptionSize: 20 }).descriptionSize).toBeUndefined();
  });

  it("pole przyjmuje wyłącznie cyfry", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 20 });
    fireEvent.click(el);
    await pumpFrames();
    const input = screen.getByLabelText(/Rozmiar w px/i) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "2a4px" } });
    expect(input.value).toBe("24");
    fireEvent.blur(input);
    expect(lastWrite(updateWidget, { descriptionSize: 20 }).descriptionSize).toBe(24);
  });

  it("rozmycie bez zmiany nie zapisuje niczego", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 20 });
    fireEvent.click(el);
    await pumpFrames();
    fireEvent.blur(screen.getByLabelText(/Rozmiar w px/i));
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it("bez nadpisania przycisk czyszczenia jest wyłączony", async () => {
    const { el } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    expect(screen.getByTitle("Przywróć domyślny rozmiar")).toBeDisabled();
  });

  it("widget przy górnej krawędzi okna dostaje belkę POD sobą", async () => {
    const { el } = setup({}, { widgetTop: 4 });
    fireEvent.click(el);
    await pumpFrames();
    const top = parseFloat(screen.getByRole("toolbar").style.top);
    // Nad widgetem nie ma miejsca - belka nie może wyjechać za ekran.
    expect(top).toBeGreaterThan(4);
  });

  it("belka pochłania wskaźnik, żeby nie zaczynać zaznaczania kanwy", async () => {
    const { el } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    const toolbar = screen.getByRole("toolbar");
    const onCanvasPointer = vi.fn();
    // Nasłuch WYŻEJ niż portal belki (belka wisi w `document.body`) - tylko
    // stamtąd widać, czy zdarzenie zostało zatrzymane.
    document.addEventListener("pointerdown", onCanvasPointer);
    document.addEventListener("mousedown", onCanvasPointer);
    fireEvent.pointerDown(toolbar);
    fireEvent.mouseDown(toolbar);
    document.removeEventListener("pointerdown", onCanvasPointer);
    document.removeEventListener("mousedown", onCanvasPointer);
    // Wskaźnik na belce nie może zaczynać prostokąta zaznaczenia w kanwie.
    expect(onCanvasPointer).not.toHaveBeenCalled();
  });

  it("krzyżyk zamyka belkę, a minus zmniejsza rozmiar", async () => {
    const { el, updateWidget } = setup({ descriptionSize: 14 });
    fireEvent.click(el);
    await pumpFrames();
    fireEvent.click(screen.getByLabelText("Zmniejsz rozmiar"));
    expect(lastWrite(updateWidget, { descriptionSize: 14 }).descriptionSize).toBe(13);
    fireEvent.click(screen.getByLabelText("Zamknij"));
    await pumpFrames(1);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("klik w samą belkę nie przestawia celu edycji", async () => {
    const { el, setSelection } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    setSelection.mockClear();
    fireEvent.click(screen.getByRole("toolbar"));
    await pumpFrames(1);
    expect(screen.queryByRole("toolbar")).toBeTruthy();
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("przycisk Panel woła panel właściwości zdarzeniem z kluczem pola", async () => {
    const { el } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    const seen: string[] = [];
    const onFocusField = (e: Event) => {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      seen.push(detail.key);
    };
    window.addEventListener("cms:focus-size-field", onFocusField);
    fireEvent.click(screen.getByTitle("Otwórz w panelu Styl"));
    window.removeEventListener("cms:focus-size-field", onFocusField);
    // Belka ma dwa piksele szerokości na wszystko - reszta ustawień jest
    // w panelu, więc mostek do niego jest częścią kontraktu.
    expect(seen).toEqual(["descriptionSize"]);
  });

  it("zniknięcie elementu na dłużej zamyka belkę", async () => {
    const { el, widget } = setup({});
    fireEvent.click(el);
    await pumpFrames();
    widget.removeChild(el);
    // Krótkie zniknięcie (przemontowanie) jest tolerowane - dłuższe nie.
    // Karencja to 1200 ms, więc czekamy realnie dłużej i dopiero potem
    // przepuszczamy klatki, w których pętla geometrii zdąży ją zauważyć.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
    await pumpFrames(3);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("element o zerowych wymiarach nie rysuje belki, ale jej nie zamyka", async () => {
    const dom = mountCanvasDom();
    dom.el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0 }) as DOMRect;
    render(
      <InlineSizeToolbar
        doc={makeDoc({})}
        selection={{ kind: "widget", id: WIDGET_ID }}
        setSelection={vi.fn()}
        updateWidget={vi.fn()}
      />,
    );
    fireEvent.click(dom.el);
    await pumpFrames(3);
    // Element w trakcie malowania ma zerowy prostokąt - belka o współrzędnych
    // 0,0 mrugałaby w kącie ekranu.
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
