// Kanwa wizualna: zaznaczanie kliknięciem i UPUSZCZANIE (paleta -> kanwa,
// przenoszenie w obrębie kanwy).
//
// Kanwa nie renderuje treści sama - robi to `BuilderRenderer`. Jej własną
// treścią jest WARSTWA STEROWANIA: nasłuchy na korzeniu, które z celu
// zdarzenia wyliczają najbliższy węzeł (`[data-widget-id]`, `[data-col-id]`,
// `[data-sec-id]`) i wołają właściwą operację. Dlatego renderer jest tu
// atrapą emitującą DOKŁADNIE te atrybuty (i nic więcej): test sprawdza
// wtedy regułę „upuszczenie w tym miejscu = ta operacja", a nie wygląd
// widgetów, który ma własne testy.
//
// Przypięte reguły:
//  1. PIERWSZEŃSTWO CELÓW. Widget > kolumna > sekcja. Upuszczenie nad
//     widgetem wstawia OBOK niego (przed/za w zależności od połowy), nad
//     kolumną - na jej koniec, nad sekcją - jako nowa kolumna.
//  2. PIERWSZEŃSTWO ŁADUNKÓW. Kontener > struktura sekcji > nowy widget
//     (paleta) > przenoszenie istniejącego węzła. Zły porządek sprawiał, że
//     upuszczenie struktury na sekcję dodawało widget.
//  3. ŁADUNEK USZKODZONY jest ignorowany, a nie zamieniany na „coś".
//  4. ZAZNACZANIE: klik w widget/kolumnę/sekcję ustawia właściwy rodzaj,
//     a klik w element chrome buildera nie zmienia zaznaczenia.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import type { BuilderDocument } from "@/lib/builder/types";
import { SECTION_STRUCTURE_MIME } from "@/lib/builder/dndMime";
import { GLOBAL_WIDGET_MIME, CONTAINER_MIME } from "../VisualCanvas";
import {
  canvasNode as node,
  column as col,
  fireDragEvent,
  fireDrop,
  renderCanvas,
  section as sec,
  stubClientRect as stubRects,
  wgt as w,
} from "@/test/builder/canvasHarness";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
// Atrapy dzieci kanwy (renderer, edycja w miejscu) - wspólne dla obu plików
// testowych kanwy, patrz `src/test/builder/canvasStubs.tsx`.
vi.mock("@/components/builder/organisms/BuilderRenderer", async () => {
  const { builderRendererStub } = await import("@/test/builder/canvasStubs");
  return builderRendererStub({ tabPanels: { s3: "t1" } });
});
vi.mock("@/components/builder/inlineEditContext", async () => {
  const { inlineEditProviderStub } = await import("@/test/builder/canvasStubs");
  return inlineEditProviderStub();
});
// Nakładka zmiany rozmiaru ma własny test (pomiary wskaźnikiem).
vi.mock("../WidgetResizeOverlay", () => ({
  WidgetResizeOverlay: () => <div data-testid="nakladka-rozmiaru" />,
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("VisualCanvas - zaznaczanie kliknięciem", () => {
  it.each([
    ["widget", "data-widget-id", "w1", { kind: "widget", id: "w1" }],
    ["kolumna", "data-col-id", "c1", { kind: "column", id: "c1" }],
    ["sekcja", "data-sec-id", "s2", { kind: "section", id: "s2" }],
  ] as const)("klik w %s ustawia właściwy rodzaj zaznaczenia", (_label, attr, id, expected) => {
    const { h } = renderCanvas();
    fireEvent.click(node(attr, id));
    expect(h.setSelection).toHaveBeenCalledWith(expected);
  });

  it("klik w widget wygrywa z kolumną i sekcją, w których leży", () => {
    const { h } = renderCanvas();
    fireEvent.click(node("data-widget-id", "w1"));
    // Najbardziej zagnieżdżony węzeł jest tym, który redaktor wskazał -
    // inaczej klik w widget otwierałby właściwości sekcji.
    expect(h.setSelection).toHaveBeenCalledWith({ kind: "widget", id: "w1" });
    expect(h.setSelection).toHaveBeenCalledTimes(1);
  });

  it("klik w tło kanwy czyści zaznaczenie", () => {
    const { container, h } = renderCanvas();
    const canvas = container.querySelector<HTMLElement>("[data-visual-canvas]");
    if (!canvas) throw new Error("test: brak korzenia kanwy");
    fireEvent.click(canvas);
    expect(h.setSelection).toHaveBeenCalledWith({ kind: null, id: null });
  });
});

describe("VisualCanvas - upuszczenie nowego widgetu z palety", () => {
  it("nad widgetem wstawia OBOK niego", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDrop(node("data-widget-id", "w1"), { "application/x-widget-type": "heading" }, 110);
    // Górna połowa widgetu = przed nim.
    expect(h.onDropNewWidgetNear).toHaveBeenCalledWith("w1", "before", "heading", undefined);
  });

  it("nad dolną połową widgetu wstawia za nim", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDrop(node("data-widget-id", "w1"), { "application/x-widget-type": "heading" }, 190);
    expect(h.onDropNewWidgetNear).toHaveBeenCalledWith("w1", "after", "heading", undefined);
  });

  it("nad pustą kolumną wstawia na jej koniec", () => {
    const { h } = renderCanvas();
    fireDrop(node("data-col-id", "c2"), { "application/x-widget-type": "button" });
    expect(h.onDropNewWidgetToColumn).toHaveBeenCalledWith("c2", "button", undefined);
  });

  it("nad sekcją bez kolumny wstawia nową kolumnę z widgetem", () => {
    const { h } = renderCanvas({
      version: 1,
      sections: [sec("s1", [])],
    });
    fireDrop(node("data-sec-id", "s1"), { "application/x-widget-type": "image" });
    expect(h.onDropNewWidgetToSection).toHaveBeenCalledWith("s1", "image", undefined, undefined);
  });

  it("instancja widgetu globalnego niesie swój ładunek", () => {
    const { h } = renderCanvas();
    const payload = JSON.stringify({ id: "g1", data: { type: "text", content: {} } });
    fireDrop(node("data-col-id", "c2"), { [GLOBAL_WIDGET_MIME]: payload });
    // Typ bierzemy z ładunku globalnego, a sam ładunek jedzie dalej, żeby
    // operacja mogła zapisać referencję `globalId`.
    expect(h.onDropNewWidgetToColumn).toHaveBeenCalledWith(
      "c2",
      "text",
      expect.objectContaining({ id: "g1" }),
    );
  });

  it.each([
    ["niepoprawny JSON", "{to nie jest json"],
    ["brak identyfikatora", JSON.stringify({ data: { type: "text", content: {} } })],
    ["brak danych", JSON.stringify({ id: "g1" })],
  ])("uszkodzony ładunek globalny jest ignorowany: %s", (_label, raw) => {
    const { h } = renderCanvas();
    fireDrop(node("data-col-id", "c2"), { [GLOBAL_WIDGET_MIME]: raw });
    // Lepiej nie zrobić nic niż wstawić widget o zgadniętym typie.
    expect(h.onDropNewWidgetToColumn).not.toHaveBeenCalled();
  });
});

describe("VisualCanvas - upuszczenie struktury sekcji", () => {
  it("nad górną połową sekcji wstawia PRZED nią", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDrop(node("data-sec-id", "s2"), { [SECTION_STRUCTURE_MIME]: JSON.stringify([6, 6]) }, 110);
    expect(h.onInsertSection).toHaveBeenCalledWith(1, [6, 6]);
  });

  it("nad dolną połową sekcji wstawia ZA nią", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDrop(node("data-sec-id", "s1"), { [SECTION_STRUCTURE_MIME]: JSON.stringify([12]) }, 190);
    expect(h.onInsertSection).toHaveBeenCalledWith(1, [12]);
  });

  it("poza sekcjami dokłada na koniec dokumentu", () => {
    const { container, h } = renderCanvas();
    const canvas = container.querySelector<HTMLElement>("[data-visual-canvas]");
    if (!canvas) throw new Error("test: brak korzenia kanwy");
    fireDrop(canvas, { [SECTION_STRUCTURE_MIME]: JSON.stringify([4, 4, 4]) });
    expect(h.onInsertSection).toHaveBeenCalledWith(2, [4, 4, 4]);
  });

  it.each([
    ["niepoprawny JSON", "{["],
    ["nie tablica", JSON.stringify({ cols: 2 })],
    ["rozpiętości poza siatką", JSON.stringify([0, 99])],
    ["pusta tablica", JSON.stringify([])],
  ])("uszkodzona struktura jest ignorowana: %s", (_label, raw) => {
    const { h } = renderCanvas();
    fireDrop(node("data-sec-id", "s1"), { [SECTION_STRUCTURE_MIME]: raw });
    expect(h.onInsertSection).not.toHaveBeenCalled();
  });
});

describe("VisualCanvas - upuszczenie w panel zakładki", () => {
  // Sekcja `s3` jest w atrapie renderera owinięta panelem zakładki `t1` -
  // dokładnie tak, jak robi to prawdziwy renderer dla kontenera z zakładkami.
  const DOC_TABS: BuilderDocument = { version: 1, sections: [sec("s3", [])] };
  const panel = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>("[data-section-tab-panel]");
    if (!found) throw new Error("test: brak panelu zakładki");
    return found;
  };

  it("struktura ląduje W ZAKŁADCE, nie obok sekcji", () => {
    const { h } = renderCanvas(DOC_TABS);
    fireDrop(panel(), { [SECTION_STRUCTURE_MIME]: JSON.stringify([6, 6]) }, 110);
    expect(h.onInsertSectionToTab).toHaveBeenCalledWith("s3", "t1", [6, 6]);
    // Gdyby zadziałała zwykła ścieżka, sekcja wylądowałaby PRZED kontenerem.
    expect(h.onInsertSection).not.toHaveBeenCalled();
  });

  it("nowy widget niesie identyfikator zakładki", () => {
    const { h } = renderCanvas(DOC_TABS);
    fireDrop(panel(), { "application/x-widget-type": "image" });
    expect(h.onDropNewWidgetToSection).toHaveBeenCalledWith("s3", "image", undefined, "t1");
  });
});

describe("VisualCanvas - upuszczenie kontenera", () => {
  it("kontener zwykły wstawia się na wyliczonej pozycji", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDrop(
      node("data-sec-id", "s1"),
      { [CONTAINER_MIME]: JSON.stringify({ withTabs: false }) },
      110,
    );
    expect(h.onInsertContainer).toHaveBeenCalledWith(0, false);
  });

  it.each([
    ["struktura", { [SECTION_STRUCTURE_MIME]: JSON.stringify([6, 6]) }, "onInsertSection"],
    ["kontener", { [CONTAINER_MIME]: JSON.stringify({ withTabs: false }) }, "onInsertContainer"],
  ] as const)("%s nad sekcją NIEZNANĄ dokumentowi ląduje na końcu", (_label, payload, call) => {
    stubRects();
    const { h } = renderCanvas();
    const stale = node("data-sec-id", "s1");
    // Kanwa renderuje dokument z opóźnieniem o klatkę - w DOM może jeszcze
    // stać sekcja usunięta z dokumentu. Wtedy jedyną bezpieczną pozycją jest
    // koniec, a nie indeks -1 (który wstawiłby PRZED wszystkim).
    stale.setAttribute("data-sec-id", "usunieta-sekcja");
    fireDrop(stale, payload, 110);
    expect(h[call].mock.calls[0]?.[0]).toBe(2);
  });

  it("kontener nad dolną połową sekcji ląduje ZA nią", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDrop(
      node("data-sec-id", "s1"),
      { [CONTAINER_MIME]: JSON.stringify({ withTabs: false }) },
      190,
    );
    expect(h.onInsertContainer).toHaveBeenCalledWith(1, false);
  });

  it("kontener z zakładkami niesie swój znacznik", () => {
    const { container, h } = renderCanvas();
    const canvas = container.querySelector<HTMLElement>("[data-visual-canvas]");
    if (!canvas) throw new Error("test: brak korzenia kanwy");
    fireDrop(canvas, { [CONTAINER_MIME]: JSON.stringify({ withTabs: true }) });
    expect(h.onInsertContainer).toHaveBeenCalledWith(2, true);
  });

  it("uszkodzony ładunek kontenera daje kontener bez zakładek", () => {
    const { container, h } = renderCanvas();
    const canvas = container.querySelector<HTMLElement>("[data-visual-canvas]");
    if (!canvas) throw new Error("test: brak korzenia kanwy");
    fireDrop(canvas, { [CONTAINER_MIME]: "{zepsute" });
    // Kontener to jednak żądanie redakcji - wstawiamy najprostszy wariant,
    // zamiast milczeć.
    expect(h.onInsertContainer).toHaveBeenCalledWith(2, false);
  });

  it("kontener ma pierwszeństwo nad strukturą i nowym widgetem", () => {
    const { container, h } = renderCanvas();
    const canvas = container.querySelector<HTMLElement>("[data-visual-canvas]");
    if (!canvas) throw new Error("test: brak korzenia kanwy");
    fireDrop(canvas, {
      [CONTAINER_MIME]: JSON.stringify({ withTabs: false }),
      [SECTION_STRUCTURE_MIME]: JSON.stringify([6, 6]),
      "application/x-widget-type": "heading",
    });
    expect(h.onInsertContainer).toHaveBeenCalled();
    expect(h.onInsertSection).not.toHaveBeenCalled();
    expect(h.onDropNewWidgetToColumn).not.toHaveBeenCalled();
  });
});

describe("VisualCanvas - przenoszenie istniejących węzłów", () => {
  function startWidgetDrag(id: string) {
    const el = node("data-widget-id", id);
    fireDragEvent("dragstart", el);
    return el;
  }

  it("widget upuszczony na inny widget ląduje obok niego", () => {
    stubRects();
    const { h } = renderCanvas();
    startWidgetDrag("w1");
    fireDrop(node("data-widget-id", "w2"), {}, 190);
    expect(h.onMoveWidget).toHaveBeenCalledWith("w1", "w2", "after");
  });

  it("widget upuszczony na SIEBIE nie wywołuje przenoszenia", () => {
    stubRects();
    const { h } = renderCanvas();
    startWidgetDrag("w1");
    fireDrop(node("data-widget-id", "w1"), {}, 110);
    expect(h.onMoveWidget).not.toHaveBeenCalled();
    // Upada na kolumnę, w której leży - to jest zamierzone (przeniesienie
    // na koniec tej samej kolumny).
    expect(h.onMoveWidgetToColumn).toHaveBeenCalledWith("w1", "c1");
  });

  it("widget upuszczony na kolumnę ląduje na jej końcu", () => {
    const { h } = renderCanvas();
    startWidgetDrag("w1");
    fireDrop(node("data-col-id", "c2"), {});
    expect(h.onMoveWidgetToColumn).toHaveBeenCalledWith("w1", "c2");
  });

  it("widget upuszczony na sekcję bez kolumn tworzy w niej kolumnę", () => {
    const { h } = renderCanvas({
      version: 1,
      sections: [sec("s1", [col("c1", [w("w1")])]), sec("s2", [])],
    });
    startWidgetDrag("w1");
    fireDrop(node("data-sec-id", "s2"), {});
    expect(h.onMoveWidgetToSection).toHaveBeenCalledWith("w1", "s2");
  });

  it("sekcja upuszczona na inną sekcję zmienia kolejność", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDragEvent("dragstart", node("data-sec-id", "s1"));
    fireDrop(node("data-sec-id", "s2"), {}, 190);
    expect(h.onMoveSection).toHaveBeenCalledWith("s1", "s2", "after");
  });

  it("sekcja upuszczona na górną połowę innej ląduje PRZED nią", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDragEvent("dragstart", node("data-sec-id", "s2"));
    fireDrop(node("data-sec-id", "s1"), {}, 110);
    expect(h.onMoveSection).toHaveBeenCalledWith("s2", "s1", "before");
  });

  it("sekcja upuszczona na SIEBIE nic nie zmienia", () => {
    stubRects();
    const { h } = renderCanvas();
    fireDragEvent("dragstart", node("data-sec-id", "s1"));
    fireDrop(node("data-sec-id", "s1"), {}, 110);
    expect(h.onMoveSection).not.toHaveBeenCalled();
  });

  it("upuszczenie bez rozpoczętego przeciągania nic nie robi", () => {
    const { h } = renderCanvas();
    fireDrop(node("data-col-id", "c2"), {});
    expect(h.onMoveWidgetToColumn).not.toHaveBeenCalled();
    expect(h.onMoveSection).not.toHaveBeenCalled();
  });

  it("zakończenie przeciągania zdejmuje znacznik z kanwy", () => {
    const { container } = renderCanvas();
    const canvas = container.querySelector<HTMLElement>("[data-visual-canvas]");
    if (!canvas) throw new Error("test: brak korzenia kanwy");
    fireDragEvent("dragstart", node("data-widget-id", "w1"));
    expect(canvas.getAttribute("data-canvas-dragging")).toBe("1");
    fireEvent.dragEnd(node("data-widget-id", "w1"));
    // Znacznik gasi podpowiedzi hoveru na czas przeciągania - musi zniknąć,
    // inaczej kanwa zostaje „w trybie przenoszenia" po upuszczeniu.
    expect(canvas.getAttribute("data-canvas-dragging")).toBeNull();
  });
});

describe("VisualCanvas - strefy wstawiania sekcji", () => {
  it("są dokładnie dwie strefy: przed pierwszą i po ostatniej sekcji", () => {
    const { container } = renderCanvas();
    // Kanwa NIE renderuje strefy w każdej przerwie - wstawianie „w środku"
    // dokumentu obsługuje upuszczenie struktury na połowę sekcji (testy
    // wyżej). Kliknięciem da się dodać sekcję na początku i na końcu, i to
    // jest cały kontrakt tych stref; trzecia strefa nie istnieje.
    const zones = container.querySelectorAll("[data-section-inserter]");
    expect(zones.length).toBe(2);
    expect(zones[0]?.textContent).toContain("pierwsza");
    expect(zones[1]?.textContent).toContain("ostatnia");
  });

  it("strefa początkowa pyta o strukturę, a potem wstawia na indeksie 0", () => {
    const { container, h } = renderCanvas();
    const zone = container.querySelector<HTMLElement>("[data-section-inserter]");
    if (!zone) throw new Error("test: brak strefy wstawiania");
    const opener = zone.querySelector("button");
    if (!opener) throw new Error("test: strefa bez przycisku");
    fireEvent.click(opener);
    // Sam klik NIE wstawia sekcji - najpierw trzeba wybrać układ kolumn.
    expect(h.onInsertSection).not.toHaveBeenCalled();
    const variant = container.querySelector<HTMLElement>(
      '[data-section-inserter] button[draggable="true"]',
    );
    if (!variant) throw new Error("test: brak wariantów struktury");
    fireEvent.click(variant);
    // Indeks bierze się ze strefy, przy której stoi, a nie z końca dokumentu -
    // inaczej klik na górze dokładałby sekcję na spodzie.
    expect(h.onInsertSection).toHaveBeenCalledWith(0, [12]);
  });

  it("strefa końcowa wstawia sekcję ZA ostatnią", () => {
    const { container, h } = renderCanvas();
    const zones = container.querySelectorAll<HTMLElement>("[data-section-inserter]");
    const opener = zones[zones.length - 1]?.querySelector("button");
    if (!opener) throw new Error("test: strefa bez przycisku");
    fireEvent.click(opener);
    const variant = zones[zones.length - 1]?.querySelector<HTMLElement>('button[draggable="true"]');
    if (!variant) throw new Error("test: brak wariantów struktury");
    fireEvent.click(variant);
    // Dwie sekcje w dokumencie - strefa na spodzie wstawia na indeks 2.
    expect(h.onInsertSection).toHaveBeenCalledWith(2, [12]);
  });

  it("pusty dokument ma jedną strefę wstawiania", () => {
    const { container } = renderCanvas({ version: 1, sections: [] });
    expect(container.querySelectorAll("[data-section-inserter]").length).toBe(1);
  });
});
