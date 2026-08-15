// CounterWidget: animowany licznik (0 -> wartość docelowa) sterowany
// IntersectionObserverem i requestAnimationFrame. Testy kontrolują zegar
// (performance.now) i kolejkę RAF, żeby deterministycznie przejść przez
// easing (easeOutCubic), klatkę pośrednią (t<1) i klatkę końcową (t=1),
// oraz gałąź prefers-reduced-motion (statyczna wartość bez animacji).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { CounterWidget } from "../CounterWidget";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "../frame";

type IOEntry = { isIntersecting: boolean };
type IOCallback = (entries: IOEntry[]) => void;

// Sterowalny IntersectionObserver: test decyduje kiedy i z jakimi wpisami
// odpala callback (obserwacja nie strzela automatycznie).
const io = {
  callbacks: [] as IOCallback[],
  disconnects: 0,
};

class ControlledIO {
  private cb: IOCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb as unknown as IOCallback;
    io.callbacks.push(this.cb);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {
    io.disconnects += 1;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

// Kolejka RAF: klatki wykonywane ręcznie z zadanym timestampem.
let rafQueue: FrameRequestCallback[] = [];
function flushFrame(nowMs: number): void {
  const pending = rafQueue;
  rafQueue = [];
  act(() => {
    for (const cb of pending) cb(nowMs);
  });
}

let reducedMotion = false;

function renderCounter(content: WidgetContent, lang: Lang = "pl") {
  return render(<CounterWidget content={content} lang={lang} />);
}

beforeEach(() => {
  io.callbacks = [];
  io.disconnects = 0;
  rafQueue = [];
  reducedMotion = false;
  vi.stubGlobal("IntersectionObserver", ControlledIO as unknown as typeof IntersectionObserver);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(window, "matchMedia").mockImplementation(
    (q: string) =>
      ({
        matches: q.includes("prefers-reduced-motion") ? reducedMotion : false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  vi.spyOn(performance, "now").mockReturnValue(1000);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CounterWidget - animacja liczby", () => {
  it("animates from 0 to the target through easeOutCubic frames", () => {
    renderCounter({ value: 1000, durationMs: 2000 });

    // Przed wejściem w viewport licznik stoi na wartości startowej.
    expect(screen.getByText("0")).toBeInTheDocument();

    // Wejście w viewport startuje pętlę RAF.
    act(() => {
      io.callbacks.forEach((cb) => cb([{ isIntersecting: true }]));
    });
    expect(rafQueue.length).toBe(1);

    // Połowa animacji: easeOutCubic(0.5) = 0.875 -> 875.
    flushFrame(2000);
    expect(screen.getByText("875")).toBeInTheDocument();
    // t < 1 -> kolejna klatka zaplanowana.
    expect(rafQueue.length).toBe(1);

    // Koniec animacji: t = 1 -> dokładnie wartość docelowa, separator tysięcy.
    flushFrame(3000);
    expect(screen.getByText("1,000")).toBeInTheDocument();
    // t >= 1 -> pętla nie planuje kolejnych klatek.
    expect(rafQueue.length).toBe(0);
  });

  it("starts from a non-zero base and uses a custom delimiter", () => {
    renderCounter({ value: 2500, from: 500, durationMs: 2000, delimiter: " " });
    expect(screen.getByText("500")).toBeInTheDocument();

    act(() => {
      io.callbacks.forEach((cb) => cb([{ isIntersecting: true }]));
    });
    // Klatka końcowa od razu (t = 1).
    flushFrame(3000);
    expect(screen.getByText("2 500")).toBeInTheDocument();
  });

  it("ignores non-intersecting entries and never restarts once started", () => {
    renderCounter({ value: 100, durationMs: 2000 });

    // Wpis poza viewportem -> nic się nie dzieje.
    act(() => {
      io.callbacks.forEach((cb) => cb([{ isIntersecting: false }]));
    });
    expect(rafQueue.length).toBe(0);

    // Pierwszy przecinający wpis startuje animację, drugi w tej samej paczce
    // jest pomijany (startedRef).
    act(() => {
      io.callbacks.forEach((cb) => cb([{ isIntersecting: true }, { isIntersecting: true }]));
    });
    expect(rafQueue.length).toBe(1);
    flushFrame(3000);
    expect(screen.getByText("100")).toBeInTheDocument();
  });
});

describe("CounterWidget - prefers-reduced-motion", () => {
  it("renders the target immediately without any RAF loop", () => {
    reducedMotion = true;
    renderCounter({ value: 4321, durationMs: 2000 });
    expect(screen.getByText("4,321")).toBeInTheDocument();
    expect(rafQueue.length).toBe(0);
    // Observer nie jest w ogóle tworzony w gałęzi reduce.
    expect(io.callbacks.length).toBe(0);
  });
});

describe("CounterWidget - prezentacja (prefiks, sufiks, etykieta, wyrównanie)", () => {
  it("renders prefix/suffix and the language-specific label with sizes", () => {
    reducedMotion = true;
    const { container } = renderCounter(
      {
        value: 90,
        prefix: "+",
        suffix: "%",
        label_pl: "Wzrost",
        label_en: "Growth",
        align: "left",
        accentColor: "#ff6600",
        numberSize: 10, // poniżej minimum -> clamp do 20
        labelSize: 5, // poniżej minimum -> clamp do 10
      },
      "en",
    );

    const number = container.querySelector('[aria-label="+90% Growth"]');
    expect(number).not.toBeNull();
    expect((number as HTMLElement).style.fontSize).toBe("20px");
    expect(screen.getByText("Growth")).toBeInTheDocument();
    const label = screen.getByText("Growth");
    expect(label.style.fontSize).toBe("10px");

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.textAlign).toBe("left");
    expect(wrapper.style.color).toBe("#ff6600");
  });

  it("falls back to the Polish label in EN and supports right alignment", () => {
    reducedMotion = true;
    const { container } = renderCounter({ value: 7, label_pl: "Tylko PL", align: "right" }, "en");
    expect(screen.getByText("Tylko PL")).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.textAlign).toBe("right");
  });

  it("renders without a label block and with centered default alignment", () => {
    reducedMotion = true;
    const { container } = renderCounter({ value: 12 });
    // Brak etykiety -> jedno dziecko (sama liczba, bez bloku label).
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.textAlign).toBe("center");
    expect(wrapper.children).toHaveLength(1);
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});
