// `TextRotate` - rotujący tekst z animacją per znak / słowo / linię.
//
// CO TEN PLIK DOWODZI.
//   1. BEZ PĘTLI OSTATNI TEKST ZOSTAJE WIDOCZNY. Przed poprawką kolejny tik
//      auto-rotacji na ostatnim tekście zerował `entered`, a efekt wejścia
//      (zależny od indeksu) już się nie uruchamiał - segmenty zostawały
//      z `opacity: 0` na stałe. To samo `previous()` na pierwszym i `reset()`.
//   2. SKRÓCENIE LISTY POD KOMPONENTEM nie daje pustego tekstu.
//   3. CZYTNIK EKRANU dostaje jeden pełny tekst (albo jawną etykietę), a animowane
//      segmenty są ukryte; `aria-label` na <span> bez roli zniknął.
//   4. AUTO-ROTACJA zatrzymuje się przy `prefers-reduced-motion` i nie emituje
//      wtedy przejść CSS.
//   5. BRAMKA RUCHU (P3.5): pierwszy obrót dopiero pełny interwał po otwarciu
//      bramki (pierwsza interakcja albo punkt ciszy - tu atrapa); pozostałe
//      przypadki otwierają bramkę w `beforeEach`.
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextRotate, type TextRotateRef } from "@/components/ui/text-rotate";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";

// Punkt ciszy bramki ruchu tylko na żądanie testu.
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  __openMotionGateForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetMotionGateForTests();
});

/** Dwie klatki animacji - tyle czeka efekt wejścia. */
const wejdz = () => act(() => vi.advanceTimersByTime(50));

const tekstSr = (c: HTMLElement) => c.querySelector(".sr-only")?.textContent;
const segmenty = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('[aria-hidden="true"] > span'));
const widoczne = (c: HTMLElement) => segmenty(c).every((s) => s.style.opacity === "1");

function mockReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

describe("TextRotate - podział i dostępność", () => {
  it("czytnik ekranu dostaje pełny tekst raz, a segmenty są ukryte", () => {
    const { container } = render(<TextRotate texts={["Ala ma"]} auto={false} />);
    expect(tekstSr(container)).toBe("Ala ma");
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.firstElementChild?.hasAttribute("aria-label")).toBe(false);
  });

  it("jawna etykieta zastępuje tekst dla czytnika ekranu", () => {
    const { container } = render(
      <TextRotate texts={["Szybciej"]} ariaLabel="Hasło kampanii" auto={false} />,
    );
    expect(tekstSr(container)).toBe("Hasło kampanii");
  });

  it("dzieli na znaki i zachowuje spacje jako osobne segmenty", () => {
    const { container } = render(<TextRotate texts={["a b"]} auto={false} />);
    const s = segmenty(container);
    expect(s.map((x) => x.textContent)).toEqual(["a", " ", "b"]);
    expect(s[1].className).toContain("whitespace-pre");
    expect(s[0].className).not.toContain("whitespace-pre");
  });

  it("dzieli na słowa z separatorami i na linie jako bloki", () => {
    const slowa = render(<TextRotate texts={["raz  dwa"]} splitBy="words" auto={false} />);
    expect(segmenty(slowa.container).map((x) => x.textContent)).toEqual(["raz", "  ", "dwa"]);
    slowa.unmount();
    const linie = render(
      <TextRotate
        texts={["pierwsza\r\ndruga"]}
        splitBy="lines"
        elementLevelClassName="linia"
        auto={false}
      />,
    );
    const s = segmenty(linie.container);
    expect(s.map((x) => x.textContent)).toEqual(["pierwsza", "druga"]);
    expect(s.every((x) => x.className.includes("block") && x.className.includes("linia"))).toBe(
      true,
    );
  });

  it("pusta lista renderuje pusty tekst zamiast się wywracać", () => {
    const { container } = render(<TextRotate texts={[]} />);
    expect(tekstSr(container)).toBe("");
    expect(segmenty(container)).toEqual([]);
  });
});

describe("TextRotate - wejście i opóźnienia", () => {
  it("segmenty wchodzą po dwóch klatkach animacji", () => {
    const { container } = render(<TextRotate texts={["ab"]} auto={false} />);
    expect(segmenty(container)[0].style.opacity).toBe("0");
    wejdz();
    expect(widoczne(container)).toBe(true);
    expect(segmenty(container)[0].style.transform).toBe("translateY(0)");
  });

  it("opóźnienie rośnie od początku, od końca albo od środka", () => {
    const delays = (from: "first" | "last" | "center") => {
      const { container, unmount } = render(
        <TextRotate texts={["abc"]} staggerFrom={from} staggerDurationMs={10} auto={false} />,
      );
      const out = segmenty(container).map((s) => s.style.transitionDelay);
      unmount();
      return out;
    };
    expect(delays("first")).toEqual(["0ms", "10ms", "20ms"]);
    expect(delays("last")).toEqual(["20ms", "10ms", "0ms"]);
    expect(delays("center")).toEqual(["10ms", "0ms", "10ms"]);
  });

  it("zerowy stagger i pojedynczy segment nie mają opóźnienia", () => {
    const zero = render(<TextRotate texts={["abc"]} staggerDurationMs={0} auto={false} />);
    expect(segmenty(zero.container).map((s) => s.style.transitionDelay)).toEqual([
      "0ms",
      "0ms",
      "0ms",
    ]);
    zero.unmount();
    const jeden = render(<TextRotate texts={["a"]} auto={false} />);
    expect(segmenty(jeden.container)[0].style.transitionDelay).toBe("0ms");
  });
});

describe("TextRotate - auto-rotacja", () => {
  it("przed otwarciem bramki ruchu stoi 30 s; pierwszy obrót pełny interwał po otwarciu", () => {
    __resetMotionGateForTests();
    const { container } = render(<TextRotate texts={["A", "B"]} rotationInterval={1000} />);
    wejdz();
    // Krokami po 0,5 s: skok 30 s mógłby wrócić na pierwszy tekst po pełnych obrotach.
    for (let step = 0; step < 60; step += 1) {
      act(() => vi.advanceTimersByTime(500));
      expect(tekstSr(container)).toBe("A");
    }
    act(() => __openMotionGateForTests());
    act(() => vi.advanceTimersByTime(999));
    expect(tekstSr(container)).toBe("A");
    act(() => vi.advanceTimersByTime(1));
    expect(tekstSr(container)).toBe("B");
  });

  it("zmienia tekst co interwał i zawija w pętli", () => {
    const { container } = render(<TextRotate texts={["A", "B"]} rotationInterval={1000} />);
    wejdz();
    act(() => vi.advanceTimersByTime(1000));
    expect(tekstSr(container)).toBe("B");
    wejdz();
    act(() => vi.advanceTimersByTime(1000));
    expect(tekstSr(container)).toBe("A");
  });

  it("bez pętli staje na ostatnim tekście i ten tekst ZOSTAJE widoczny", () => {
    const { container } = render(
      <TextRotate texts={["A", "B"]} rotationInterval={1000} loop={false} />,
    );
    wejdz();
    act(() => vi.advanceTimersByTime(1000));
    wejdz();
    expect(tekstSr(container)).toBe("B");
    act(() => vi.advanceTimersByTime(5000));
    expect(tekstSr(container)).toBe("B");
    expect(widoczne(container)).toBe(true);
  });

  it("jeden tekst i wyłączone `auto` nie rotują", () => {
    const jeden = render(<TextRotate texts={["Sam"]} rotationInterval={100} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(tekstSr(jeden.container)).toBe("Sam");
    jeden.unmount();
    const stop = render(<TextRotate texts={["A", "B"]} rotationInterval={100} auto={false} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(tekstSr(stop.container)).toBe("A");
  });

  it("przy prefers-reduced-motion nie rotuje i nie emituje przejść", async () => {
    mockReducedMotion();
    const { container } = render(<TextRotate texts={["A", "B"]} rotationInterval={100} />);
    await act(async () => {});
    act(() => vi.advanceTimersByTime(1000));
    expect(tekstSr(container)).toBe("A");
    const [seg] = segmenty(container);
    expect(seg.style.opacity).toBe("1");
    expect(seg.style.transform).toBe("none");
    expect(seg.style.transitionDuration).toBe("");
  });

  it("skrócenie listy pod komponentem pokazuje ostatni dostępny tekst, nie pustkę", () => {
    const { container, rerender } = render(
      <TextRotate texts={["A", "B", "C"]} rotationInterval={1000} loop={false} />,
    );
    act(() => vi.advanceTimersByTime(1000));
    act(() => vi.advanceTimersByTime(1000));
    expect(tekstSr(container)).toBe("C");
    rerender(<TextRotate texts={["A", "B"]} rotationInterval={1000} loop={false} />);
    expect(tekstSr(container)).toBe("B");
    expect(segmenty(container).map((s) => s.textContent)).toEqual(["B"]);
  });
});

describe("TextRotate - sterowanie przez ref", () => {
  it("next, previous, jumpTo i reset przestawiają tekst z przycięciem zakresu", () => {
    const ref = createRef<TextRotateRef>();
    const { container } = render(<TextRotate ref={ref} texts={["A", "B", "C"]} auto={false} />);
    act(() => ref.current?.next());
    expect(tekstSr(container)).toBe("B");
    act(() => ref.current?.previous());
    act(() => ref.current?.previous());
    expect(tekstSr(container)).toBe("C");
    act(() => ref.current?.jumpTo(99));
    expect(tekstSr(container)).toBe("C");
    act(() => ref.current?.jumpTo(-5));
    expect(tekstSr(container)).toBe("A");
    act(() => ref.current?.jumpTo(1));
    act(() => ref.current?.reset());
    expect(tekstSr(container)).toBe("A");
  });

  it("przejście na bieżący tekst nie gasi go (previous na pierwszym bez pętli, reset na zerowym)", () => {
    const ref = createRef<TextRotateRef>();
    const { container } = render(
      <TextRotate ref={ref} texts={["A", "B"]} auto={false} loop={false} />,
    );
    wejdz();
    act(() => ref.current?.previous());
    act(() => ref.current?.reset());
    act(() => ref.current?.jumpTo(0));
    wejdz();
    expect(tekstSr(container)).toBe("A");
    expect(widoczne(container)).toBe(true);
  });
});
