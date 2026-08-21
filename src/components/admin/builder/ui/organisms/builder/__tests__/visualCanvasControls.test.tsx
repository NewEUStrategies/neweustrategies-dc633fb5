// Kanwa wizualna: WARSTWA STEROWANIA poza samym upuszczeniem ładunku
// (upuszczanie ma osobny plik, `visualCanvasDrop.test.tsx`).
//
// Ten plik przypina cztery rzeczy, których nie widać w dokumencie, a które
// psują pracę redaktora natychmiast, gdy przestaną działać:
//
//  1. ZAZNACZANIE WIELOKROTNE. Shift dokłada, Ctrl/Cmd przełącza, zwykły klik
//     kasuje zbiór - inaczej redaktor musiałby wychodzić Escape przed każdą
//     zmianą jednego widgetu.
//  2. PROSTOKĄT ZAZNACZENIA. Rysuje się tylko od tła kanwy i tylko po
//     przekroczeniu luzu 5 px, a zaznacza widgety, których prostokąt PRZECINA
//     się z zaznaczeniem (nie: zawiera się w nim).
//  3. ZNACZNIKI PRZECIĄGANIA. To jedyna informacja zwrotna, gdzie ładunek
//     spadnie: przed/za widgetem (oś zależna od układu), do kolumny, do
//     sekcji, a dla struktury i kontenera - między sekcje.
//  4. ZABICIE NAWIGACJI. Widgety mają w środku prawdziwe linki; klik w kanwie
//     ma edytować widget, a nie wyjść ze strony buildera.
//
// Dodatkowo: gałęzie drzewa renderowania (szerokość ramki urządzenia, edycja
// w miejscu, nakładka rozmiaru) i autoprzewijanie przy krawędzi.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import type { BuilderDocument } from "@/lib/builder/types";
import { SECTION_STRUCTURE_MIME } from "@/lib/builder/dndMime";
import {
  CANVAS_DOC,
  canvasNode as node,
  column,
  fireDragEvent,
  firePointerEvent,
  renderCanvas,
  section,
  stubClientRect,
  transfer,
  wgt,
} from "@/test/builder/canvasHarness";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@/components/builder/organisms/BuilderRenderer", async () => {
  const { builderRendererStub } = await import("@/test/builder/canvasStubs");
  return builderRendererStub({ tabPanels: { s3: "t1" } });
});
vi.mock("@/components/builder/inlineEditContext", async () => {
  const { inlineEditProviderStub } = await import("@/test/builder/canvasStubs");
  return inlineEditProviderStub();
});
vi.mock("../WidgetResizeOverlay", () => ({
  WidgetResizeOverlay: () => <div data-testid="nakladka-rozmiaru" />,
}));

/** Widget „przycisk" ma układ w wierszu, więc dzieli się w OSI X. */
const DOC_INLINE: BuilderDocument = {
  version: 1,
  sections: [section("s1", [column("c1", [wgt("wb", "button")])])],
};
const DOC_TABS: BuilderDocument = { version: 1, sections: [section("s3", [])] };

const WIDGET_PALETTE = { "application/x-widget-type": "heading" };
const STRUCTURE_PALETTE = { [SECTION_STRUCTURE_MIME]: JSON.stringify([6, 6]) };

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VisualCanvas - zaznaczanie wielokrotne", () => {
  it.each([
    ["Shift dokłada do zbioru", { shiftKey: true }, "add"],
    ["Ctrl przełącza", { ctrlKey: true }, "toggle"],
    ["Cmd przełącza", { metaKey: true }, "toggle"],
  ] as const)("%s", (_label, modifier, mode) => {
    const { h } = renderCanvas();
    fireEvent.click(node("data-widget-id", "w1"), modifier);
    expect(h.onMultiSelectionChange).toHaveBeenCalledWith(new Set(["w1"]), mode);
    // Zbiór i pojedyncze zaznaczenie wykluczają się - pasek akcji zbiorczych
    // zastępuje panel właściwości.
    expect(h.setSelection).toHaveBeenCalledWith({ kind: null, id: null });
  });

  it.each([
    ["widget", "data-widget-id", "w1", { kind: "widget", id: "w1" }],
    ["kolumnę", "data-col-id", "c1", { kind: "column", id: "c1" }],
    ["sekcję", "data-sec-id", "s2", { kind: "section", id: "s2" }],
  ] as const)("zwykły klik w %s kasuje aktywny zbiór", (_label, attr, id, expected) => {
    const { h } = renderCanvas(CANVAS_DOC, { multiSelection: new Set(["w2"]) });
    fireEvent.click(node(attr, id));
    expect(h.onMultiSelectionChange).toHaveBeenCalledWith(new Set(), "replace");
    expect(h.setSelection).toHaveBeenCalledWith(expected);
  });

  it("bez obsługi zbioru Shift zaznacza pojedynczo", () => {
    const { h } = renderCanvas(CANVAS_DOC, { omit: ["onMultiSelectionChange"] });
    fireEvent.click(node("data-widget-id", "w1"), { shiftKey: true });
    // Kanwa bez `onMultiSelectionChange` (np. w podglądzie) nie może zgubić
    // kliknięcia - wraca do zwykłego zaznaczenia.
    expect(h.setSelection).toHaveBeenCalledWith({ kind: "widget", id: "w1" });
  });

  it("puste zaznaczenie NIE woła kasowania zbioru", () => {
    const { h } = renderCanvas();
    fireEvent.click(node("data-widget-id", "w1"));
    expect(h.onMultiSelectionChange).not.toHaveBeenCalled();
  });

  it("zaznaczone węzły dostają klasy, a wszystkie są przeciągalne", () => {
    renderCanvas(CANVAS_DOC, {
      selection: { kind: "widget", id: "w1" },
      multiSelection: new Set(["w2"]),
    });
    expect(node("data-widget-id", "w1").classList.contains("is-selected")).toBe(true);
    expect(node("data-widget-id", "w2").classList.contains("is-multi-selected")).toBe(true);
    expect(node("data-widget-id", "w1").getAttribute("draggable")).toBe("true");
    expect(node("data-sec-id", "s1").getAttribute("draggable")).toBe("true");
  });

  it.each([
    ["kolumna", "data-col-id", "c1", { kind: "column", id: "c1" }],
    ["sekcja", "data-sec-id", "s1", { kind: "section", id: "s1" }],
  ] as const)("zaznaczona %s dostaje klasę", (_label, attr, id, selection) => {
    renderCanvas(CANVAS_DOC, { selection });
    expect(node(attr, id).classList.contains("is-selected")).toBe(true);
  });
});

describe("VisualCanvas - prostokąt zaznaczenia", () => {
  // Prostokąt jest jedynym UKRYTYM elementem chrome kanwy (`aria-hidden`) -
  // atrapa pickera używa tego samego znacznika, więc sam `data-builder-chrome`
  // by go nie odróżnił.
  const MARQUEE = "[data-builder-chrome][aria-hidden]";

  it("przecięcie z prostokątem zaznacza widgety i kasuje pojedyncze", () => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { clientX: 0, clientY: 0 });
    firePointerEvent("pointermove", canvas, { clientX: 150, clientY: 160 });
    // Prostokąt jest rysowany jako chrome buildera na wierzchu kanwy.
    const box = canvas.querySelector<HTMLElement>(MARQUEE);
    expect(box).not.toBeNull();
    expect(canvas.style.userSelect).toBe("none");
    firePointerEvent("pointerup", canvas, { clientX: 150, clientY: 160 });
    // Widgety mają prostokąt 0,100 - 200,200; zaznaczenie 0,0 - 150,160 PRZECINA
    // je, choć żadnego nie obejmuje w całości.
    expect(h.onMultiSelectionChange).toHaveBeenCalledWith(new Set(["w1", "w2"]), "replace");
    expect(h.setSelection).toHaveBeenCalledWith({ kind: null, id: null });
    expect(canvas.querySelector(MARQUEE)).toBeNull();
  });

  it("prostokąt obok widgetów daje pusty zbiór i nie kasuje zaznaczenia", () => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { clientX: 400, clientY: 400 });
    firePointerEvent("pointermove", canvas, { clientX: 500, clientY: 500 });
    firePointerEvent("pointerup", canvas, { clientX: 500, clientY: 500 });
    expect(h.onMultiSelectionChange).toHaveBeenCalledWith(new Set(), "replace");
    // Brak trafień = brak powodu, by ruszać pojedyncze zaznaczenie.
    expect(h.setSelection).not.toHaveBeenCalled();
  });

  it("ruch poniżej luzu 5 px nie rysuje prostokąta i nic nie zaznacza", () => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { clientX: 0, clientY: 0 });
    firePointerEvent("pointermove", canvas, { clientX: 2, clientY: 2 });
    expect(canvas.querySelector(MARQUEE)).toBeNull();
    firePointerEvent("pointerup", canvas, { clientX: 2, clientY: 2 });
    // Drżenie ręki przy zwykłym kliknięciu w tło nie może kasować zbioru.
    expect(h.onMultiSelectionChange).not.toHaveBeenCalled();
  });

  it.each([
    ["Shift", { shiftKey: true }, "add"],
    ["Ctrl", { ctrlKey: true }, "toggle"],
    ["Cmd", { metaKey: true }, "toggle"],
  ] as const)("%s przy starcie ustawia tryb zbioru", (_label, modifier, mode) => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { clientX: 0, clientY: 0, ...modifier });
    firePointerEvent("pointermove", canvas, { clientX: 150, clientY: 160 });
    firePointerEvent("pointerup", canvas, { clientX: 150, clientY: 160 });
    expect(h.onMultiSelectionChange).toHaveBeenCalledWith(new Set(["w1", "w2"]), mode);
  });

  it.each([
    ["prawy przycisk", { button: 2 }],
    ["środkowy przycisk", { button: 1 }],
  ])("%s nie zaczyna prostokąta", (_label, init) => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { clientX: 0, clientY: 0, ...init });
    firePointerEvent("pointermove", canvas, { clientX: 150, clientY: 160 });
    firePointerEvent("pointerup", canvas, { clientX: 150, clientY: 160 });
    expect(h.onMultiSelectionChange).not.toHaveBeenCalled();
  });

  it.each([
    ["widgecie", "data-widget-id", "w1"],
    ["kolumnie", "data-col-id", "c1"],
    ["sekcji", "data-sec-id", "s1"],
    ["strefie wstawiania", "data-section-inserter", ""],
  ])("start na %s nie zaczyna prostokąta", (_label, attr, id) => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    const target = id
      ? node(attr, id)
      : (canvas.querySelector<HTMLElement>(`[${attr}]`) as HTMLElement);
    firePointerEvent("pointerdown", target, { clientX: 0, clientY: 0 });
    firePointerEvent("pointermove", canvas, { clientX: 150, clientY: 160 });
    firePointerEvent("pointerup", canvas, { clientX: 150, clientY: 160 });
    // Widgety zachowują natywne przeciąganie HTML5 - prostokąt nie może go
    // przejąć.
    expect(h.onMultiSelectionChange).not.toHaveBeenCalled();
  });

  it("bez obsługi zbioru prostokąt się nie rysuje", () => {
    stubClientRect();
    const { canvas } = renderCanvas(CANVAS_DOC, { omit: ["onMultiSelectionChange"] });
    firePointerEvent("pointerdown", canvas, { clientX: 0, clientY: 0 });
    firePointerEvent("pointermove", canvas, { clientX: 150, clientY: 160 });
    expect(canvas.querySelector(MARQUEE)).toBeNull();
  });

  it("inny wskaźnik w trakcie jest ignorowany", () => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { pointerId: 1, clientX: 0, clientY: 0 });
    firePointerEvent("pointermove", canvas, { pointerId: 9, clientX: 150, clientY: 160 });
    expect(canvas.querySelector(MARQUEE)).toBeNull();
    firePointerEvent("pointerup", canvas, { pointerId: 9, clientX: 150, clientY: 160 });
    // Drugi palec na tablecie nie kończy zaznaczania pierwszego.
    expect(h.onMultiSelectionChange).not.toHaveBeenCalled();
  });

  it("klik zaraz po prostokącie nie czyści świeżego zbioru", () => {
    stubClientRect();
    const { canvas, h } = renderCanvas();
    firePointerEvent("pointerdown", canvas, { clientX: 0, clientY: 0 });
    firePointerEvent("pointermove", canvas, { clientX: 150, clientY: 160 });
    firePointerEvent("pointerup", canvas, { clientX: 150, clientY: 160 });
    const afterMarquee = h.setSelection.mock.calls.length;
    // Podniesienie wskaźnika wysyła jeszcze syntetyczny `click` w tło - bez
    // tłumienia zjadałby dopiero co zrobione zaznaczenie.
    fireEvent.click(canvas);
    expect(h.setSelection.mock.calls.length).toBe(afterMarquee);
  });
});

describe("VisualCanvas - znaczniki przeciągania", () => {
  const classesOf = (el: HTMLElement) => Array.from(el.classList);

  it.each([
    ["górna połowa", 110, "is-drop-before"],
    ["dolna połowa", 190, "is-drop-after"],
  ])("widget blokowy, %s: %s", (_label, clientY, expected) => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragover", node("data-widget-id", "w1"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY,
    });
    expect(classesOf(node("data-widget-id", "w1"))).toContain(expected);
  });

  it.each([
    ["lewa połowa", 40, "is-drop-left"],
    ["prawa połowa", 160, "is-drop-right"],
  ])("widget w wierszu, %s: %s", (_label, clientX, expected) => {
    stubClientRect();
    renderCanvas(DOC_INLINE);
    fireDragEvent("dragover", node("data-widget-id", "wb"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientX,
      clientY: 150,
    });
    // Widgety w wierszu płyną poziomo - podział na oś Y wskazywałby miejsce,
    // w którym nic nie powstanie.
    expect(classesOf(node("data-widget-id", "wb"))).toContain(expected);
  });

  it.each([
    ["kolumna", "data-col-id", "c2"],
    ["sekcja", "data-sec-id", "s2"],
  ])("%s dostaje znacznik wnętrza", (_label, attr, id) => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragover", node(attr, id), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 150,
    });
    expect(classesOf(node(attr, id))).toContain("is-drop-into");
  });

  it("kolejny ruch czyści poprzedni znacznik", () => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragover", node("data-widget-id", "w1"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 110,
    });
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 150,
    });
    expect(classesOf(node("data-widget-id", "w1"))).not.toContain("is-drop-before");
    expect(classesOf(node("data-col-id", "c2"))).toContain("is-drop-into");
  });

  it.each([
    ["paleta", WIDGET_PALETTE, "copy"],
    ["struktura", STRUCTURE_PALETTE, "copy"],
  ])("%s zgłasza efekt kopiowania", (_label, payload, effect) => {
    stubClientRect();
    renderCanvas();
    const dt = fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(payload),
      clientY: 150,
    });
    expect(dt.dropEffect).toBe(effect);
  });

  it("paleta nad tłem kanwy zgłasza BRAK miejsca upuszczenia", () => {
    stubClientRect();
    const { canvas } = renderCanvas();
    const dt = fireDragEvent("dragover", canvas, {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 150,
    });
    // Nowy widget musi mieć kolumnę - poza sekcjami nie ma go gdzie włożyć.
    expect(dt.dropEffect).toBe("none");
  });

  it("przenoszenie istniejącego widgetu zgłasza efekt przeniesienia", () => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragstart", node("data-widget-id", "w1"));
    const dt = fireDragEvent("dragover", node("data-col-id", "c2"), { clientY: 150 });
    expect(dt.dropEffect).toBe("move");
  });

  it("ruch bez przeciągania i bez ładunku nie znaczy niczego", () => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragover", node("data-widget-id", "w1"), { clientY: 110 });
    expect(classesOf(node("data-widget-id", "w1"))).not.toContain("is-drop-before");
  });

  it.each([
    ["górna połowa", 110, "is-drop-before"],
    ["dolna połowa", 190, "is-drop-after"],
  ])("struktura nad sekcją, %s: %s", (_label, clientY, expected) => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragover", node("data-sec-id", "s2"), {
      dataTransfer: transfer(STRUCTURE_PALETTE),
      clientY,
    });
    expect(classesOf(node("data-sec-id", "s2"))).toContain(expected);
  });

  it("struktura nad widgetem NIE znaczy widgetu, tylko sekcję", () => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragover", node("data-widget-id", "w1"), {
      dataTransfer: transfer(STRUCTURE_PALETTE),
      clientY: 110,
    });
    // Struktura zawsze tworzy NOWĄ sekcję - znacznik na widgecie obiecywałby
    // wstawienie, którego nie będzie.
    expect(classesOf(node("data-widget-id", "w1"))).not.toContain("is-drop-before");
    expect(classesOf(node("data-sec-id", "s1"))).toContain("is-drop-before");
  });

  it("struktura nad panelem zakładki znaczy panel", () => {
    stubClientRect();
    const { container } = renderCanvas(DOC_TABS);
    const panel = container.querySelector<HTMLElement>("[data-section-tab-panel]");
    if (!panel) throw new Error("test: brak panelu zakładki");
    fireDragEvent("dragover", panel, {
      dataTransfer: transfer(STRUCTURE_PALETTE),
      clientY: 150,
    });
    expect(classesOf(panel)).toContain("is-drop-into");
  });

  it("struktura poza sekcjami podświetla ostatnią strefę wstawiania", () => {
    stubClientRect();
    const { canvas } = renderCanvas();
    fireDragEvent("dragover", canvas, {
      dataTransfer: transfer(STRUCTURE_PALETTE),
      clientY: 150,
    });
    const zones = canvas.querySelectorAll<HTMLElement>("[data-section-inserter]");
    expect(zones[zones.length - 1]?.getAttribute("data-drop-active")).toBe("1");
    // Kolejny ruch nad sekcją musi to podświetlenie zdjąć.
    fireDragEvent("dragover", node("data-sec-id", "s1"), {
      dataTransfer: transfer(STRUCTURE_PALETTE),
      clientY: 110,
    });
    expect(canvas.querySelector("[data-section-inserter][data-drop-active]")).toBeNull();
  });

  it("struktura w dokumencie bez sekcji podświetla jedyną strefę", () => {
    stubClientRect();
    const { canvas } = renderCanvas({ version: 1, sections: [] });
    fireDragEvent("dragover", canvas, {
      dataTransfer: transfer(STRUCTURE_PALETTE),
      clientY: 150,
    });
    expect(canvas.querySelector("[data-section-inserter][data-drop-active]")).not.toBeNull();
  });

  it.each([
    ["paleta", WIDGET_PALETTE],
    ["struktura", STRUCTURE_PALETTE],
  ])("%s włącza tryb przeciągania na kanwie", (_label, payload) => {
    stubClientRect();
    const { canvas } = renderCanvas();
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(payload),
      clientY: 150,
    });
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
  });

  it("wyjście poza kanwę czyści znaczniki i tryb przeciągania", () => {
    stubClientRect();
    const { canvas } = renderCanvas();
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 150,
    });
    fireDragEvent("dragleave", canvas, { relatedTarget: document.body });
    expect(canvas.getAttribute("data-canvas-dragging")).toBeNull();
    expect(canvas.querySelector(".is-drop-into")).toBeNull();
  });

  it("wyjście na element WEWNĄTRZ kanwy nic nie czyści", () => {
    stubClientRect();
    const { canvas } = renderCanvas();
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 150,
    });
    fireDragEvent("dragleave", canvas, { relatedTarget: node("data-widget-id", "w1") });
    // Przejście między dziećmi kanwy zdarza się przy każdym ruchu myszy -
    // gaszenie znaczników migałoby przez całe przeciąganie.
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
    expect(canvas.querySelector(".is-drop-into")).not.toBeNull();
  });
});

describe("VisualCanvas - duszek przeciągania", () => {
  it.each([
    ["widget", "data-widget-id", "w1", "Tekst"],
    ["sekcja", "data-sec-id", "s1", "Sekcja"],
  ])("%s dostaje własną etykietę i znika po zakończeniu", (_label, attr, id, expected) => {
    const { canvas } = renderCanvas();
    const dt = transfer({});
    fireDragEvent("dragstart", node(attr, id), { dataTransfer: dt });
    expect(dt.setDragImage).toHaveBeenCalled();
    const ghost = dt.setDragImage.mock.calls[0]?.[0] as HTMLElement;
    // Przeglądarka rysuje domyślnie zrzut całego elementu i zasłania nim cele
    // upuszczenia - stąd własna pigułka z nazwą.
    expect(ghost.textContent).toBe(expected);
    expect(ghost.isConnected).toBe(true);
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
    fireDragEvent("dragend", node(attr, id));
    expect(ghost.isConnected).toBe(false);
  });

  it("widget bez opisanego typu dostaje etykietę zastępczą", () => {
    renderCanvas();
    const el = node("data-widget-id", "w1");
    el.removeAttribute("data-debug-type");
    const dt = transfer({});
    fireDragEvent("dragstart", el, { dataTransfer: dt });
    // Renderer nie musi opisywać typu (np. widget w kontenerze zewnętrznym) -
    // duszek i tak musi coś napisać.
    expect((dt.setDragImage.mock.calls[0]?.[0] as HTMLElement).textContent).toBe("Widget");
  });

  it("po angielsku sekcja ma angielską etykietę", () => {
    renderCanvas(CANVAS_DOC, { lang: "en" });
    const dt = transfer({});
    fireDragEvent("dragstart", node("data-sec-id", "s1"), { dataTransfer: dt });
    expect((dt.setDragImage.mock.calls[0]?.[0] as HTMLElement).textContent).toBe("Section");
  });

  it("odrzucony obraz przeciągania nie zostawia duszka w dokumencie", () => {
    renderCanvas();
    const dt = transfer({});
    const ghosts: HTMLElement[] = [];
    dt.setDragImage.mockImplementation((el: HTMLElement) => {
      ghosts.push(el);
      throw new Error("setDragImage niedostępne");
    });
    fireDragEvent("dragstart", node("data-widget-id", "w1"), { dataTransfer: dt });
    // Bez sprzątania każdy nieudany start przeciągania zostawiałby element
    // w `document.body` na zawsze.
    expect(ghosts[0]?.isConnected).toBe(false);
  });

  it("start przeciągania z tła kanwy nie włącza trybu przeciągania", () => {
    const { canvas } = renderCanvas();
    fireDragEvent("dragstart", canvas);
    expect(canvas.getAttribute("data-canvas-dragging")).toBeNull();
  });
});

describe("VisualCanvas - zdarzenia bez DataTransfer", () => {
  // Zdarzenie bez `dataTransfer` przychodzi z narzędzi wspomagających
  // i ze starszych warstw zgodności. Kanwa NIE MOŻE się na nim wywalić, bo
  // wywalony nasłuch zabija całe przeciąganie do końca sesji.
  it("start przeciągania bez DataTransfer nie rzuca i włącza tryb", () => {
    const { canvas } = renderCanvas();
    fireDragEvent("dragstart", node("data-widget-id", "w1"), { withoutDataTransfer: true });
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
  });

  it("start przeciągania sekcji bez DataTransfer nie rzuca", () => {
    const { canvas } = renderCanvas();
    fireDragEvent("dragstart", node("data-sec-id", "s1"), { withoutDataTransfer: true });
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
  });

  it("ruch nad kolumną bez DataTransfer dalej znaczy cel", () => {
    stubClientRect();
    renderCanvas();
    fireDragEvent("dragstart", node("data-widget-id", "w1"), { withoutDataTransfer: true });
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      withoutDataTransfer: true,
      clientY: 150,
    });
    expect(Array.from(node("data-col-id", "c2").classList)).toContain("is-drop-into");
  });

  it("upuszczenie bez DataTransfer przenosi przeciągany widget", () => {
    stubClientRect();
    const { h } = renderCanvas();
    fireDragEvent("dragstart", node("data-widget-id", "w1"), { withoutDataTransfer: true });
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      withoutDataTransfer: true,
      clientY: 150,
    });
    fireDragEvent("drop", node("data-col-id", "c2"), {
      withoutDataTransfer: true,
      clientY: 150,
    });
    // Brak ładunku = to nie jest paleta, czyli zwykłe przeniesienie.
    expect(h.onMoveWidgetToColumn).toHaveBeenCalledWith("w1", "c2");
  });

  it("ruch nad tłem kanwy przy przenoszeniu nie znaczy niczego", () => {
    stubClientRect();
    const { canvas } = renderCanvas();
    fireDragEvent("dragstart", node("data-widget-id", "w1"), { withoutDataTransfer: true });
    fireDragEvent("dragover", canvas, { withoutDataTransfer: true, clientY: 150 });
    // Nie ma sekcji pod wskaźnikiem - nie ma czego podświetlić, ale i nie ma
    // powodu, żeby przerwać przeciąganie.
    expect(canvas.querySelector(".is-drop-into")).toBeNull();
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
  });
});

describe("VisualCanvas - autoprzewijanie przy krawędzi", () => {
  function stubFrames(): { scrollBy: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
    const scrollBy = vi.fn();
    const cancel = vi.fn();
    let frames = 0;
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("scrollBy", scrollBy);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    // Tylko PIERWSZA klatka wykonuje się od razu - pętla `autoScrollStep`
    // planuje następną i zapętliłaby test w nieskończoność.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      if (frames++ === 0) cb(0);
      return 1;
    });
    return { scrollBy, cancel };
  }

  it.each([
    ["górna krawędź przewija w górę", 10, -1],
    ["dolna krawędź przewija w dół", 795, 1],
  ])("%s", (_label, clientY, sign) => {
    stubClientRect();
    renderCanvas();
    const { scrollBy } = stubFrames();
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY,
    });
    expect(scrollBy).toHaveBeenCalled();
    const dy = scrollBy.mock.calls[0]?.[1] as number;
    expect(Math.sign(dy)).toBe(sign);
  });

  it("środek okna nie przewija", () => {
    stubClientRect();
    renderCanvas();
    const { scrollBy } = stubFrames();
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 400,
    });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("klatka przy zerowej prędkości kończy pętlę", () => {
    stubClientRect();
    renderCanvas();
    const frames: FrameRequestCallback[] = [];
    const scrollBy = vi.fn();
    vi.stubGlobal("innerHeight", 800);
    vi.stubGlobal("scrollBy", scrollBy);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 10,
    });
    // Wskaźnik wraca na środek: prędkość spada do zera, a zaplanowana wcześniej
    // klatka musi się wtedy wypisać z pętli, a nie przewijać dalej.
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 400,
    });
    frames[0]?.(0);
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("wyjście poza kanwę zatrzymuje przewijanie", () => {
    stubClientRect();
    const { canvas } = renderCanvas();
    const { cancel } = stubFrames();
    fireDragEvent("dragover", node("data-col-id", "c2"), {
      dataTransfer: transfer(WIDGET_PALETTE),
      clientY: 10,
    });
    fireDragEvent("dragleave", canvas, { relatedTarget: document.body });
    // Bez zatrzymania strona przewijałaby się dalej po porzuceniu ładunku.
    expect(cancel).toHaveBeenCalled();
  });
});

describe("VisualCanvas - zabicie nawigacji w kanwie", () => {
  it.each([
    ["kliknięcie", "click"],
    ["kliknięcie środkowym", "auxclick"],
    ["wysłanie formularza", "submit"],
  ] as const)("%s w treści widgetu jest wstrzymane", (_label, type) => {
    renderCanvas();
    const link = node("data-widget-id", "w1").querySelector("a");
    if (!link) throw new Error("test: widget bez linku");
    const evt = new Event(type, { bubbles: true, cancelable: true });
    fireEvent(link, evt);
    // Link w widgecie ma być edytowalną treścią, nie wyjściem z buildera.
    expect(evt.defaultPrevented).toBe(true);
  });

  it("kliknięcie linku i tak zaznacza widget", () => {
    const { h } = renderCanvas();
    const link = node("data-widget-id", "w1").querySelector("a");
    if (!link) throw new Error("test: widget bez linku");
    fireEvent.click(link);
    // Zaznaczenie leci fazą przechwytywania Reacta, PRZED zabiciem zdarzenia.
    expect(h.setSelection).toHaveBeenCalledWith({ kind: "widget", id: "w1" });
  });

  it.each([
    ["strefa wstawiania", "[data-section-inserter] button"],
    ["chrome buildera", "[data-builder-chrome]"],
  ])("klik w %s nie jest wstrzymany", (_label, selector) => {
    const { canvas } = renderCanvas();
    const target = canvas.querySelector<HTMLElement>(selector);
    if (!target) throw new Error(`test: brak elementu ${selector}`);
    const evt = new Event("click", { bubbles: true, cancelable: true });
    fireEvent(target, evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});

describe("VisualCanvas - gałęzie drzewa renderowania", () => {
  it.each([
    ["telefon", "mobile", "390px"],
    ["tablet", "tablet", "820px"],
    ["pulpit", "desktop", "100%"],
  ] as const)("ramka dla %s ma szerokość %s", (_label, device, width) => {
    const { canvas } = renderCanvas(CANVAS_DOC, { device });
    const frame = canvas.querySelector<HTMLElement>("div[style]");
    expect(canvas.getAttribute("data-device")).toBe(device);
    expect(frame?.style.width).toBe(width);
  });

  it.each([
    ["edycja w miejscu", "onWidgetContentChange", "edycja-w-miejscu"] as const,
    ["nakładka rozmiaru", "onWidgetResize", "nakladka-rozmiaru"] as const,
  ])("%s pojawia się tylko z obsługą", (_label, prop, testId) => {
    renderCanvas();
    expect(screen.queryByTestId(testId)).not.toBeNull();
    screen.getByTestId(testId).remove();
    renderCanvas(CANVAS_DOC, { omit: [prop] });
    expect(screen.queryByTestId(testId)).toBeNull();
  });

  it("picker pustego kontenera wstawia do zakładki albo do kontenera", () => {
    const { h } = renderCanvas();
    fireEvent.click(screen.getByTestId("picker-zakladka"));
    expect(h.onInsertSectionToTab).toHaveBeenCalledWith("s1", "t1", [6, 6]);
    fireEvent.click(screen.getByTestId("picker-kontener"));
    // Bez identyfikatora zakładki sekcja ląduje wprost w kontenerze.
    expect(h.onInsertSectionToContainer).toHaveBeenCalledWith("s1", [12]);
  });
});
