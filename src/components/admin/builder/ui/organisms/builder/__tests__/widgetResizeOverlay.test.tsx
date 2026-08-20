// Nakładka zmiany rozmiaru widgetu (rączki góra/dół + pigułki z wymiarami).
//
// To jedyne miejsce w builderze, które MIERZY kanwę, więc cała jego treść
// siedzi w arytmetyce, a nie w wyglądzie:
//   - kanwa bywa PRZESKALOWANA (podglad telefonu/tabletu w mniejszej ramce),
//     więc przesunięcie wskaźnika trzeba dzielić przez skalę; bez tego rączka
//     ucieka spod kursora i widget dostaje inną wysokość, niż widzi redaktor;
//   - rączka górna rośnie W PRZECIWNYM kierunku niż dolna;
//   - wysokość jest przycinana do 8-4000 px, bo widget o wysokości 0 znika
//     z kanwy razem z własnymi rączkami (nie ma jak go odzyskać);
//   - podgląd jest malowany wprost w DOM (`style.height` z `!important`),
//     a dopiero upuszczenie zapisuje wartość w dokumencie.
//
// happy-dom nie robi layoutu, więc `offsetHeight` i `getBoundingClientRect`
// są tu podstawione - inaczej każdy pomiar byłby zerem i cała arytmetyka
// wychodziłaby zielona przez przypadek.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useRef, type CSSProperties } from "react";
import type { Device } from "@/lib/builder/types";
import { firePointerEvent } from "@/test/builder/domEvents";
import { WidgetResizeOverlay } from "../WidgetResizeOverlay";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CONTAINER: Box = { left: 0, top: 0, width: 400, height: 300 };
const WIDGET: Box = { left: 20, top: 40, width: 400, height: 100 };

/**
 * Prostokąty per element: kontener rozpoznajemy po znaczniku testowym,
 * widget po `data-widget-id`. Nakładka odejmuje jeden od drugiego, więc
 * jeden wspólny prostokąt dla wszystkiego nic by nie sprawdził.
 */
function stubBoxes(container: Box = CONTAINER, widget: Box = WIDGET): void {
  const rectOf = (b: Box): DOMRect => ({
    x: b.left,
    y: b.top,
    left: b.left,
    top: b.top,
    right: b.left + b.width,
    bottom: b.top + b.height,
    width: b.width,
    height: b.height,
    toJSON: () => ({}),
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.testid === "kanwa") return rectOf(container);
    if (this.dataset.widgetId) return rectOf(widget);
    return rectOf({ left: 0, top: 0, width: 0, height: 0 });
  });
}

/**
 * `offsetHeight` liczony z wpisanej wysokości - tak jak zrobiłaby to
 * przeglądarka po namalowaniu podglądu. Bez tego zatwierdzenie zapisywałoby
 * wysokość sprzed przeciągnięcia.
 */
function stubOffsets(offsetWidth = CONTAINER.width, offsetHeight = CONTAINER.height): void {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.testid === "kanwa") return offsetHeight;
    const inline = Number.parseFloat(this.style.height);
    return Number.isFinite(inline) ? inline : WIDGET.height;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.testid === "kanwa" ? offsetWidth : WIDGET.width;
  });
}

function Host({
  widgetId,
  device = "desktop",
  onResize,
  widgetStyle,
}: {
  widgetId: string | null;
  device?: Device;
  onResize: (id: string, height: number, device: Device) => void;
  widgetStyle?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={ref} data-testid="kanwa" style={{ position: "relative" }}>
      <div data-widget-id="w1" style={widgetStyle}>
        widget
      </div>
      <input data-testid="edytor" />
      <WidgetResizeOverlay
        containerRef={ref}
        widgetId={widgetId}
        device={device}
        onResize={onResize}
      />
    </div>
  );
}

const target = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>("[data-widget-id='w1']:not([role])");
  if (!el) throw new Error("test: brak widgetu");
  return el;
};
const handle = (which: "top" | "bottom"): HTMLElement =>
  screen.getByLabelText(
    which === "top" ? "builder.resize.heightTopAria" : "builder.resize.heightBottomAria",
  );
const heightChip = (): string => {
  const chip = screen.getByText(/^H: /);
  return chip.textContent ?? "";
};

let observers: Array<() => void> = [];

beforeEach(() => {
  vi.restoreAllMocks();
  observers = [];
  // happy-dom nie ma `ResizeObserver` ani przechwytywania wskaźnika.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  if (!("setPointerCapture" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: () => {},
      writable: true,
    });
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      value: () => {},
      writable: true,
    });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WidgetResizeOverlay - kiedy się pokazuje", () => {
  it("bez zaznaczonego widgetu nie renderuje niczego", () => {
    stubBoxes();
    stubOffsets();
    const { container } = render(<Host widgetId={null} onResize={vi.fn()} />);
    expect(container.querySelector("[data-builder-chrome]")).toBeNull();
  });

  it("zaznaczenie widgetu, którego nie ma w kanwie, nie rysuje nakładki", () => {
    stubBoxes();
    stubOffsets();
    const { container } = render(<Host widgetId="nie-ma-takiego" onResize={vi.fn()} />);
    // Dokument bywa o klatkę przed DOM - nakładka bez celu musi milczeć,
    // a nie mierzyć zera.
    expect(container.querySelector("[data-builder-chrome]")).toBeNull();
  });

  it("dla zaznaczonego widgetu daje dwie rączki i trzy uchwyty przenoszenia", () => {
    stubBoxes();
    stubOffsets();
    const { container } = render(<Host widgetId="w1" onResize={vi.fn()} />);
    // Cała nakładka jest `aria-hidden` (to chrome, nie treść), więc rączki
    // wyszukujemy po selektorze, a nie zapytaniem po roli.
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(2);
    // Uchwyty przenoszenia niosą `data-widget-id`, bo natywny nasłuch
    // `dragstart` kanwy rozpoznaje po nim przeciągany węzeł.
    const grips = screen.getAllByLabelText("builder.resize.moveWidget");
    expect(grips).toHaveLength(3);
    expect(grips.every((g) => g.dataset.widgetId === "w1")).toBe(true);
  });

  it("pigułki pokazują zmierzone wymiary", () => {
    stubBoxes();
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    expect(heightChip()).toBe("H: 100px");
    expect(screen.getByText(/^W: /).textContent).toBe("W: 400px · 100%");
  });

  it("pomiar odejmuje początek kanwy od początku widgetu", () => {
    stubBoxes(
      { left: 10, top: 20, width: 400, height: 300 },
      { left: 30, top: 70, width: 200, height: 100 },
    );
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    // Ramka jest pozycjonowana WEWNĄTRZ kanwy, więc liczy się różnica: 30-10.
    const frame = handle("top").previousElementSibling as HTMLElement | null;
    expect(handle("top").style.left).toBe(`${20 + 200 / 2 - 22}px`);
    expect(handle("top").style.top).toBe(`${50 - 6}px`);
    expect(frame).not.toBeNull();
  });
});

describe("WidgetResizeOverlay - tryb szerokości", () => {
  it.each([
    ["procent", { width: "50%" }, "W: 400px · 50%"],
    ["automat", { width: "auto" }, "W: 400px · auto"],
    ["dopasowanie do treści", { width: "fit-content" }, "W: 400px · auto"],
    ["maksymalna treść", { width: "max-content" }, "W: 400px · auto"],
    ["piksele", { width: "320px" }, "W: 400px · 400px"],
  ])("%s czyta się z wpisanego stylu", (_label, style, expected) => {
    stubBoxes();
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} widgetStyle={style} />);
    expect(screen.getByText(/^W: /).textContent).toBe(expected);
  });

  it("bez wpisanej szerokości węższy widget jest opisany jako automatyczny", () => {
    // Widget węższy niż rodzic = zawinięty (np. przycisk), a nie pełna szerokość.
    stubBoxes(CONTAINER, { left: 20, top: 40, width: 100, height: 100 });
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    expect(screen.getByText(/^W: /).textContent).toBe("W: 100px · auto");
  });
});

describe("WidgetResizeOverlay - przeciąganie rączek", () => {
  function dragHandle(which: "top" | "bottom", from: number, to: number) {
    const el = handle(which);
    firePointerEvent("pointerdown", el, { clientY: from });
    firePointerEvent("pointermove", el, { clientY: to });
    return el;
  }

  it("dolna rączka w dół powiększa i zapisuje po upuszczeniu", () => {
    stubBoxes();
    stubOffsets();
    const onResize = vi.fn();
    render(<Host widgetId="w1" onResize={onResize} />);
    const el = dragHandle("bottom", 100, 150);
    // Podgląd maluje się wprost w DOM, żeby przeciąganie było płynne.
    expect(target().style.getPropertyValue("height")).toBe("150px");
    expect(target().style.getPropertyPriority("height")).toBe("important");
    expect(heightChip()).toBe("H: 150px");
    expect(screen.getByText("150 px")).toBeTruthy();
    expect(onResize).not.toHaveBeenCalled();
    firePointerEvent("pointerup", el, { clientY: 150 });
    expect(onResize).toHaveBeenCalledWith("w1", 150, "desktop");
    // Po zapisie podgląd musi zniknąć - wysokość maluje już dokument.
    expect(target().style.height).toBe("");
    expect(screen.queryByText("150 px")).toBeNull();
  });

  it("górna rączka w GÓRĘ powiększa widget", () => {
    stubBoxes();
    stubOffsets();
    const onResize = vi.fn();
    render(<Host widgetId="w1" onResize={onResize} />);
    const el = dragHandle("top", 100, 60);
    expect(heightChip()).toBe("H: 140px");
    firePointerEvent("pointerup", el, { clientY: 60 });
    expect(onResize).toHaveBeenCalledWith("w1", 140, "desktop");
  });

  it.each([
    ["dolna", "bottom", 100, -10000, 8],
    ["górna", "top", 100, 10000, 8],
    ["dolna w drugą stronę", "bottom", 100, 10000, 4000],
  ] as const)("rączka %s przycina wysokość do granic", (_l, which, from, to, expected) => {
    stubBoxes();
    stubOffsets();
    const onResize = vi.fn();
    render(<Host widgetId="w1" onResize={onResize} />);
    const el = dragHandle(which, from, to);
    expect(heightChip()).toBe(`H: ${expected}px`);
    firePointerEvent("pointerup", el, { clientY: to });
    // Wysokość 0 zabrałaby razem z widgetem jego własne rączki.
    expect(onResize).toHaveBeenCalledWith("w1", expected, "desktop");
  });

  it("przeskalowana kanwa dzieli przesunięcie przez skalę", () => {
    // Kanwa narysowana na 400 px, ale zmierzona na 200 px = skala 0,5.
    stubBoxes(
      { left: 0, top: 0, width: 200, height: 150 },
      { left: 0, top: 0, width: 200, height: 100 },
    );
    stubOffsets(400, 300);
    const onResize = vi.fn();
    render(<Host widgetId="w1" onResize={onResize} />);
    const el = dragHandle("bottom", 100, 150);
    // 50 px ruchu wskaźnika to 100 px w układzie dokumentu: 100 + 100 = 200.
    firePointerEvent("pointerup", el, { clientY: 150 });
    expect(onResize).toHaveBeenCalledWith("w1", 200, "desktop");
  });

  it("aktywny breakpoint jedzie razem z wysokością", () => {
    stubBoxes();
    stubOffsets();
    const onResize = vi.fn();
    render(<Host widgetId="w1" device="mobile" onResize={onResize} />);
    const el = dragHandle("bottom", 100, 120);
    firePointerEvent("pointerup", el, { clientY: 120 });
    // Wysokość jest per breakpoint - zapis pod złym psuje pozostałe.
    expect(onResize).toHaveBeenCalledWith("w1", 120, "mobile");
  });

  it("upuszczenie bez przeciągania nic nie zapisuje", () => {
    stubBoxes();
    stubOffsets();
    const onResize = vi.fn();
    render(<Host widgetId="w1" onResize={onResize} />);
    firePointerEvent("pointerup", handle("bottom"), { clientY: 150 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("ruch bez przeciągania nie zmienia wysokości", () => {
    stubBoxes();
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    firePointerEvent("pointermove", handle("bottom"), { clientY: 150 });
    expect(target().style.height).toBe("");
    expect(heightChip()).toBe("H: 100px");
  });

  it("anulowanie wskaźnika zamyka przeciąganie jak upuszczenie", () => {
    stubBoxes();
    stubOffsets();
    const onResize = vi.fn();
    render(<Host widgetId="w1" onResize={onResize} />);
    const el = dragHandle("bottom", 100, 130);
    firePointerEvent("pointercancel", el, { clientY: 130 });
    // Wyrwany rysik nie może zostawić widgetu z podglądem bez zapisu.
    expect(onResize).toHaveBeenCalledWith("w1", 130, "desktop");
    expect(target().style.height).toBe("");
  });
});

describe("WidgetResizeOverlay - ponowny pomiar i drobne straże", () => {
  it("zmiana rozmiaru okna mierzy widget na nowo", () => {
    stubBoxes();
    stubOffsets();
    const { rerender } = render(<Host widgetId="w1" onResize={vi.fn()} />);
    expect(heightChip()).toBe("H: 100px");
    stubBoxes(CONTAINER, { left: 20, top: 40, width: 400, height: 260 });
    window.dispatchEvent(new Event("resize"));
    rerender(<Host widgetId="w1" onResize={vi.fn()} />);
    expect(heightChip()).toBe("H: 260px");
  });

  it("obserwator rozmiaru elementu też odświeża pomiar", () => {
    stubBoxes();
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    stubBoxes(CONTAINER, { left: 20, top: 40, width: 400, height: 180 });
    // Widget może zmienić wysokość bez udziału redaktora (dogranie obrazka).
    act(() => {
      observers.forEach((cb) => cb());
    });
    expect(heightChip()).toBe("H: 180px");
  });

  it("zerowa wysokość kanwy nie psuje pomiaru dzieleniem przez zero", () => {
    stubBoxes();
    stubOffsets(0, 0);
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    // Kanwa jeszcze nie zmierzona: skala musi wrócić do 1, nie do NaN.
    expect(heightChip()).toBe("H: 100px");
  });

  it("identyfikator ze znakiem znaczącym w CSS trafia we właściwy element", () => {
    stubBoxes();
    stubOffsets();
    function SpecialHost() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <div ref={ref} data-testid="kanwa" style={{ position: "relative" }}>
          <div data-widget-id="w.1">widget</div>
          <WidgetResizeOverlay
            containerRef={ref}
            widgetId="w.1"
            device="desktop"
            onResize={vi.fn()}
          />
        </div>
      );
    }
    const { container } = render(<SpecialHost />);
    // Identyfikator wchodzi wprost do selektora CSS, więc musi przejść przez
    // ucieczkę - inaczej znak o własnym znaczeniu (kropka, dwukropek, nawias)
    // rozwala zapytanie i nakładka nigdy się nie pokazuje.
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(2);
  });

  it("bez CSS.escape ucieczka robi się ręcznie", () => {
    stubBoxes();
    stubOffsets();
    vi.stubGlobal("CSS", undefined);
    const { container } = render(<Host widgetId="w1" onResize={vi.fn()} />);
    expect(container.querySelectorAll('[role="slider"]')).toHaveLength(2);
  });

  it("uchwyt przenoszenia odbiera zaznaczenie edytorowi treści", () => {
    stubBoxes();
    stubOffsets();
    render(<Host widgetId="w1" onResize={vi.fn()} />);
    const editor = screen.getByTestId("edytor");
    editor.focus();
    expect(document.activeElement).toBe(editor);
    const grip = screen.getAllByLabelText("builder.resize.moveWidget")[0];
    if (!grip) throw new Error("test: brak uchwytu");
    const evt = new Event("mousedown", { bubbles: true, cancelable: true });
    grip.dispatchEvent(evt);
    // Aktywny `contenteditable` przechwytuje `pointerdown` na kursor tekstowy
    // i blokuje start przeciągania - dlatego uchwyt najpierw go rozogniskowuje.
    expect(document.activeElement).not.toBe(editor);
  });
});
