// Zaznaczanie prostokątem (rubber-band) nad płótnem mediów. Do 18.08.2026: 0%
// - 106 linii bez ani jednego wywołania.
//
// Trzy reguły, których złamania NIE widać w żadnym teście renderującym:
//   1. próg minimalnego ruchu - bez niego zwykłe kliknięcie w pustkę czyściłoby
//      zaznaczenie i od razu zaczynało pusty prostokąt,
//   2. przesunięcie przewinięcia - hit-test liczy się w układzie płótna, więc
//      przy przewiniętej liście brak `scrollTop` zaznacza NIE TE pliki,
//   3. modyfikatory - Shift dodaje, Cmd/Ctrl przełącza, brak modyfikatora
//      zastępuje. Pomyłka tutaj kasuje wcześniejszy wybór użytkownika.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useMarqueeSelection } from "../useMarqueeSelection";

interface ItemSpec {
  id: string;
  /** Prostokąt w układzie EKRANU (jak z getBoundingClientRect). */
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CanvasSpec {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scrollLeft?: number;
  scrollTop?: number;
  items?: ItemSpec[];
}

const captured: number[] = [];
const released: number[] = [];

/** Płótno z ustalonym prostokątem, przewinięciem i dziećmi do hit-testu. */
function makeCanvas(spec: CanvasSpec = {}): HTMLDivElement {
  const left = spec.left ?? 0;
  const top = spec.top ?? 0;
  const width = spec.width ?? 1000;
  const height = spec.height ?? 800;

  const canvas = document.createElement("div");
  canvas.scrollLeft = spec.scrollLeft ?? 0;
  canvas.scrollTop = spec.scrollTop ?? 0;
  canvas.getBoundingClientRect = () =>
    ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;

  for (const item of spec.items ?? []) {
    const el = document.createElement("div");
    el.setAttribute("data-media-item", item.id);
    el.getBoundingClientRect = () =>
      ({
        left: item.left,
        top: item.top,
        right: item.left + item.width,
        bottom: item.top + item.height,
        width: item.width,
        height: item.height,
      }) as DOMRect;
    canvas.appendChild(el);
  }

  Object.defineProperty(canvas, "setPointerCapture", {
    value: (id: number) => captured.push(id),
    configurable: true,
  });
  Object.defineProperty(canvas, "releasePointerCapture", {
    value: (id: number) => released.push(id),
    configurable: true,
  });
  return canvas;
}

interface PointerOptions {
  x: number;
  y: number;
  button?: number;
  shift?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  target?: HTMLElement;
}

function pointer(canvas: HTMLElement, opts: PointerOptions): ReactPointerEvent {
  return {
    button: opts.button ?? 0,
    clientX: opts.x,
    clientY: opts.y,
    pointerId: 7,
    shiftKey: opts.shift ?? false,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    target: opts.target ?? canvas,
  } as unknown as ReactPointerEvent;
}

function setup(spec: CanvasSpec = {}, selected: string[] = []) {
  const canvas = makeCanvas(spec);
  const canvasRef = { current: canvas } as RefObject<HTMLDivElement | null>;
  const setSelectedIds = vi.fn();
  const clearSelection = vi.fn();
  const { result, unmount } = renderHook(() =>
    useMarqueeSelection({
      canvasRef,
      selectedIds: new Set(selected),
      setSelectedIds,
      clearSelection,
    }),
  );
  return { canvas, result, setSelectedIds, clearSelection, unmount };
}

/** Ostatni zestaw identyfikatorów przekazany do `setSelectedIds`. */
function lastSelection(setSelectedIds: ReturnType<typeof vi.fn>): Set<string> {
  const call = setSelectedIds.mock.calls.at(-1);
  return (call?.[0] ?? new Set()) as Set<string>;
}

const GRID: ItemSpec[] = [
  { id: "a", left: 0, top: 0, width: 100, height: 100 },
  { id: "b", left: 200, top: 0, width: 100, height: 100 },
  { id: "c", left: 0, top: 200, width: 100, height: 100 },
];

beforeEach(() => {
  captured.length = 0;
  released.length = 0;
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useMarqueeSelection - próg minimalnego ruchu", () => {
  it("ruch poniżej progu NIE tworzy prostokąta", () => {
    // Bez progu każde drgnięcie myszy przy kliknięciu startowałoby zaznaczanie.
    const { canvas, result, setSelectedIds } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 13, y: 13 })));

    expect(result.current.marquee).toBeNull();
    expect(setSelectedIds).not.toHaveBeenCalled();
  });

  it("ruch powyżej progu w JEDNEJ osi już wystarczy", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 20, y: 11 })));

    expect(result.current.marquee).not.toBeNull();
  });

  it("kliknięcie bez przeciągnięcia czyści zaznaczenie na pointer-up", () => {
    const { canvas, result, clearSelection } = setup({ items: GRID }, ["a"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerUp(pointer(canvas, { x: 10, y: 10 })));

    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it("kliknięcie z Shiftem NIE czyści zaznaczenia", () => {
    const { canvas, result, clearSelection } = setup({ items: GRID }, ["a"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10, shift: true })));
    act(() => result.current.onCanvasPointerUp(pointer(canvas, { x: 10, y: 10, shift: true })));

    expect(clearSelection).not.toHaveBeenCalled();
  });
});

describe("useMarqueeSelection - kierunek przeciągania", () => {
  it("przeciąganie w prawo i w dół daje prostokąt zakotwiczony w punkcie startu", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 50, y: 50 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 250, y: 250 })));

    expect(result.current.marquee).toEqual({ x: 50, y: 50, w: 200, h: 200 });
  });

  it("przeciąganie w LEWO i w GÓRĘ daje ten sam prostokąt", () => {
    // Prostokąt musi się normalizować - inaczej przeciąganie „wstecz” dawałoby
    // ujemną szerokość i nie zaznaczało niczego.
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 250, y: 250 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 50, y: 50 })));

    expect(result.current.marquee).toEqual({ x: 50, y: 50, w: 200, h: 200 });
  });

  it("przeciąganie w prawo-w górę też się normalizuje", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 50, y: 250 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 250, y: 50 })));

    expect(result.current.marquee).toEqual({ x: 50, y: 50, w: 200, h: 200 });
  });
});

describe("useMarqueeSelection - hit-test", () => {
  it("zaznacza kafle PRZECIĘTE prostokątem, nie tylko objęte w całości", () => {
    const { canvas, result, setSelectedIds } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 50, y: 50 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 250, y: 60 })));

    expect(lastSelection(setSelectedIds)).toEqual(new Set(["a", "b"]));
  });

  it("pomija kafel poza prostokątem", () => {
    const { canvas, result, setSelectedIds } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 0, y: 0 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 90, y: 90 })));

    expect(lastSelection(setSelectedIds)).toEqual(new Set(["a"]));
  });

  it("uwzględnia PRZEWINIĘCIE listy", () => {
    // Hit-test liczy się w układzie płótna. Bez dodania scrollTop prostokąt
    // narysowany nad piątym rzędem zaznaczałby pierwszy.
    const scrolled = [{ id: "a", left: 0, top: 0, width: 100, height: 100 }];
    const { canvas, result } = setup({ items: scrolled, scrollTop: 500 });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));

    // Punkt startu przesunięty o przewinięcie: y = 10 - 0 + 500.
    expect(result.current.marquee).toMatchObject({ y: 510 });
  });

  it("uwzględnia ODSUNIĘCIE płótna od krawędzi okna", () => {
    const { canvas, result } = setup({ items: GRID, left: 300, top: 120 });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 350, y: 170 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 450, y: 270 })));

    expect(result.current.marquee).toEqual({ x: 50, y: 50, w: 100, h: 100 });
  });
});

describe("useMarqueeSelection - modyfikatory", () => {
  it("bez modyfikatora ZASTĘPUJE wcześniejszy wybór", () => {
    const { canvas, result, setSelectedIds, clearSelection } = setup({ items: GRID }, ["c"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 0, y: 0 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 90, y: 90 })));

    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(lastSelection(setSelectedIds)).toEqual(new Set(["a"]));
  });

  it("Shift DODAJE do wcześniejszego wyboru", () => {
    const { canvas, result, setSelectedIds, clearSelection } = setup({ items: GRID }, ["c"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 0, y: 0, shift: true })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 90, y: 90, shift: true })));

    expect(clearSelection).not.toHaveBeenCalled();
    expect(lastSelection(setSelectedIds)).toEqual(new Set(["a", "c"]));
  });

  it("Cmd/Ctrl PRZEŁĄCZA trafienia względem wcześniejszego wyboru", () => {
    const { canvas, result, setSelectedIds } = setup({ items: GRID }, ["a", "c"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 0, y: 0, meta: true })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 90, y: 90, meta: true })));

    // "a" było zaznaczone i zostało trafione -> wypada. "c" zostaje.
    expect(lastSelection(setSelectedIds)).toEqual(new Set(["c"]));
  });

  it("Ctrl działa jak Cmd", () => {
    const { canvas, result, setSelectedIds } = setup({ items: GRID }, ["a"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 0, y: 0, ctrl: true })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 90, y: 90, ctrl: true })));

    expect(lastSelection(setSelectedIds)).toEqual(new Set());
  });

  it("bazą jest zaznaczenie z chwili WCIŚNIĘCIA, nie z chwili ruchu", () => {
    const { canvas, result, setSelectedIds } = setup({ items: GRID }, ["c"]);
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 0, y: 0, shift: true })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 90, y: 90, shift: true })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 250, y: 90, shift: true })));

    // Drugi ruch NIE kumuluje na wyniku pierwszego - liczy się od bazy.
    expect(lastSelection(setSelectedIds)).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("useMarqueeSelection - co NIE startuje zaznaczania", () => {
  it("przycisk inny niż lewy jest ignorowany", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10, button: 2 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));

    expect(result.current.marquee).toBeNull();
  });

  it.each(["data-media-item", "data-folder-item", "data-nomarquee"])(
    "wciśnięcie na elemencie z %s nie startuje prostokąta",
    (attr) => {
      const { canvas, result } = setup({ items: GRID });
      const target = document.createElement("div");
      target.setAttribute(attr, "x");
      canvas.appendChild(target);

      act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10, target })));
      act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));

      expect(result.current.marquee).toBeNull();
    },
  );

  it("ruch bez wcześniejszego wciśnięcia nic nie robi", () => {
    const { canvas, result, setSelectedIds } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));

    expect(result.current.marquee).toBeNull();
    expect(setSelectedIds).not.toHaveBeenCalled();
  });
});

describe("useMarqueeSelection - przechwycenie wskaźnika i sprzątanie", () => {
  it("przechwytuje wskaźnik na start i oddaje go na koniec", () => {
    // Bez przechwycenia przeciągnięcie poza płótno gubi zdarzenia ruchu.
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    expect(captured).toEqual([7]);

    act(() => result.current.onCanvasPointerUp(pointer(canvas, { x: 200, y: 200 })));
    expect(released).toEqual([7]);
  });

  it("chowa prostokąt po zakończeniu przeciągania", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));
    expect(result.current.marquee).not.toBeNull();

    act(() => result.current.onCanvasPointerUp(pointer(canvas, { x: 200, y: 200 })));
    expect(result.current.marquee).toBeNull();
  });

  it("kolejne przeciągnięcie startuje od nowa, nie od poprzedniego prostokąta", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 300, y: 300 })));
    act(() => result.current.onCanvasPointerUp(pointer(canvas, { x: 300, y: 300 })));

    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 400, y: 400 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 500, y: 500 })));
    expect(result.current.marquee).toEqual({ x: 400, y: 400, w: 100, h: 100 });
  });

  it("nieudane przechwycenie wskaźnika nie przewraca zaznaczania", () => {
    // `setPointerCapture` rzuca m.in. dla wskaźnika, który już zniknął -
    // to ma być najlepszy wysiłek, nie warunek działania.
    const { canvas, result } = setup({ items: GRID });
    Object.defineProperty(canvas, "setPointerCapture", {
      value: () => {
        throw new Error("InvalidPointerId");
      },
      configurable: true,
    });

    expect(() =>
      act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 }))),
    ).not.toThrow();
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));
    expect(result.current.marquee).not.toBeNull();
  });

  it("nieudane oddanie wskaźnika nie przewraca zakończenia", () => {
    const { canvas, result } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    Object.defineProperty(canvas, "releasePointerCapture", {
      value: () => {
        throw new Error("InvalidPointerId");
      },
      configurable: true,
    });

    expect(() =>
      act(() => result.current.onCanvasPointerUp(pointer(canvas, { x: 200, y: 200 }))),
    ).not.toThrow();
  });

  it("odmontowanie w trakcie przeciągania anuluje klatkę auto-przewijania", () => {
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { canvas, result, unmount } = setup({ items: GRID });
    act(() => result.current.onCanvasPointerDown(pointer(canvas, { x: 10, y: 10 })));
    act(() => result.current.onCanvasPointerMove(pointer(canvas, { x: 200, y: 200 })));

    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it("brak płótna w refie nie przewraca żadnego handlera", () => {
    const canvasRef = { current: null } as RefObject<HTMLDivElement | null>;
    const { result } = renderHook(() =>
      useMarqueeSelection({
        canvasRef,
        selectedIds: new Set<string>(),
        setSelectedIds: vi.fn(),
        clearSelection: vi.fn(),
      }),
    );
    const bare = { button: 0, clientX: 0, clientY: 0, pointerId: 1, target: document.body };

    expect(() =>
      act(() => result.current.onCanvasPointerDown(bare as unknown as ReactPointerEvent)),
    ).not.toThrow();
    expect(() =>
      act(() => result.current.onCanvasPointerUp(bare as unknown as ReactPointerEvent)),
    ).not.toThrow();
  });
});
