// Kanwa wizualna: UPUSZCZENIE ładunku palety z typem widgetu SPOZA rejestru.
//
// Ładunek `application/x-widget-type` przychodzi z `DataTransfer`, czyli
// z dowolnego źródła przeciągnięcia: z karty z inną wersją aplikacji, z typem
// usuniętym w nowszym wydaniu, z literówką. Kanwa rzutowała go wcześniej na
// `WidgetType` bez sprawdzenia, a `makeWidget` rzucał `TypeError` w środku
// uchwytu `drop` - edytor padał razem z niezapisanymi zmianami (naprawione
// 2026-10-18, zob. `src/lib/builder/__tests__/registryMakeWidget.test.ts`).
//
// Dowodem jest to, CZY kanwa woła operację wstawienia: nieznany typ nie może
// dojść do `onDropNewWidget*`, a znany - nadal tak (kontrast w tym samym
// zdarzeniu). Renderer i edycja w miejscu są atrapami ze wspólnego
// `src/test/builder/canvasStubs.tsx`, jak w `visualCanvasDrop.test.tsx`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  canvasNode as node,
  fireDragEvent,
  fireDrop,
  renderCanvas,
  stubClientRect as stubRects,
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

beforeEach(() => {
  vi.restoreAllMocks();
});

const NIEZNANY = { "application/x-widget-type": "widget-z-innej-wersji" };

describe("VisualCanvas - typ widgetu spoza rejestru w ładunku palety", () => {
  it("nad widgetem, kolumną i sekcją NIE woła żadnej operacji wstawienia", () => {
    stubRects();
    const { h } = renderCanvas();

    expect(() => fireDrop(node("data-widget-id", "w1"), NIEZNANY, 110)).not.toThrow();
    fireDrop(node("data-col-id", "c2"), NIEZNANY);
    fireDrop(node("data-sec-id", "s2"), NIEZNANY);

    expect(h.onDropNewWidgetNear).not.toHaveBeenCalled();
    expect(h.onDropNewWidgetToColumn).not.toHaveBeenCalled();
    expect(h.onDropNewWidgetToSection).not.toHaveBeenCalled();
  });

  it("klucz z prototypu ('constructor') też nie jest typem widgetu", () => {
    const { h } = renderCanvas();

    fireDrop(node("data-col-id", "c2"), { "application/x-widget-type": "constructor" });

    expect(h.onDropNewWidgetToColumn).not.toHaveBeenCalled();
  });

  it("znany typ w tym samym miejscu nadal wstawia widget (bramka nie jest za szeroka)", () => {
    const { h } = renderCanvas();

    fireDrop(node("data-col-id", "c2"), { "application/x-widget-type": "button" });

    expect(h.onDropNewWidgetToColumn).toHaveBeenCalledWith("c2", "button", undefined);
  });

  it("odrzucony ładunek palety nie blokuje przenoszenia przeciąganego węzła", () => {
    // Ignorowany ładunek spada do gałęzi przenoszenia istniejącego widgetu,
    // tak jakby go nie było - przeciągnięcie wewnątrz kanwy działa dalej.
    stubRects();
    const { h } = renderCanvas();
    fireDragEvent("dragstart", node("data-widget-id", "w1"));

    fireDrop(node("data-widget-id", "w2"), NIEZNANY, 190);

    expect(h.onDropNewWidgetNear).not.toHaveBeenCalled();
    expect(h.onMoveWidget).toHaveBeenCalledWith("w1", "w2", "after");
  });
});
