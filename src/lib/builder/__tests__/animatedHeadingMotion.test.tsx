// Animowany nagłówek a bramka ruchu (P3.5).
//
//  1. ROTACJA SŁÓW stoi do pierwszej interakcji albo punktu ciszy (tu atrapa);
//     pierwsza zmiana słowa przychodzi pełny interwał (`durationMs + 600`) po
//     otwarciu bramki, a przy `prefers-reduced-motion` rotacji nie ma wcale.
//  2. PĘTLA KSZTAŁTU (rysuj/trzymaj/wygaś) do otwarcia jedzie gałęzią
//     jednorazową `forwards` - kształt rysuje się raz i zostaje, także w HTML z
//     serwera. Po otwarciu pętla podmienia NAZWĘ klatek (nowa animacja od
//     chwili otwarcia) i startuje z ujemnym opóźnieniem równym czasowi
//     rysowania, czyli od stanu „narysowany": samo otwarcie nie zmienia klatki.
//     Nagłówek zamontowany już po otwarciu rysuje pętlę od zera.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { AnimatedHeadingRender } from "../animatedHeadingVariants";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";

// Punkt ciszy bramki ruchu tylko na żądanie testu.
vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetMotionGateForTests();
});

const highlighted = (root: HTMLElement) =>
  root.querySelector('span[style*="inline-block"] > span')?.textContent;
const css = (root: HTMLElement) => root.querySelector("style")?.textContent ?? "";

describe("rotacja słów", () => {
  it("stoi przez 30 s przed otwarciem; pierwsza zmiana pełny interwał po otwarciu", () => {
    vi.useFakeTimers();
    const { container } = render(
      <AnimatedHeadingRender
        config={{ mode: "rotate", rotateWords: ["jeden", "dwa"], durationMs: 1000 }}
      />,
    );
    expect(highlighted(container)).toBe("jeden");
    // Krokami po 0,5 s: skok 30 s mógłby wrócić na pierwsze słowo po pełnych obrotach.
    for (let step = 0; step < 60; step += 1) {
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(highlighted(container)).toBe("jeden");
    }
    act(() => __openMotionGateForTests());
    act(() => {
      vi.advanceTimersByTime(1599);
    });
    expect(highlighted(container)).toBe("jeden");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(highlighted(container)).toBe("dwa");
  });

  it("prefers-reduced-motion: bez rotacji także po otwarciu bramki", () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    vi.useFakeTimers();
    __openMotionGateForTests();
    const { container } = render(
      <AnimatedHeadingRender
        config={{ mode: "rotate", rotateWords: ["jeden", "dwa"], durationMs: 1000 }}
      />,
    );
    // Krokami po 0,5 s: skok 30 s mógłby wrócić na pierwsze słowo po pełnych obrotach.
    for (let step = 0; step < 60; step += 1) {
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(highlighted(container)).toBe("jeden");
    }
  });
});

describe("pętla kształtu", () => {
  const config = {
    mode: "highlight" as const,
    shape: "underline" as const,
    highlight: "słowo",
    durationMs: 1600,
    delayMs: 200,
  };

  it("serwer i stan przed otwarciem: jedno rysowanie `forwards`, bez pętli", () => {
    const html = renderToString(<AnimatedHeadingRender config={config} />);
    expect(html).toContain("aHead-draw-h-0 1600ms 200ms 1 forwards");
    expect(html).not.toContain("infinite");
    const { container } = render(<AnimatedHeadingRender config={config} />);
    expect(css(container)).toContain("1 forwards");
    expect(css(container)).not.toContain("infinite");
  });

  it("po otwarciu pętla z nową nazwą klatek, od stanu „narysowany” (ujemne opóźnienie)", () => {
    const { container } = render(<AnimatedHeadingRender config={config} />);
    act(() => __openMotionGateForTests());
    const sheet = css(container);
    expect(sheet).toContain("@keyframes aHead-loop-h-0");
    expect(sheet).toMatch(/animation: aHead-loop-h-0 \d+ms -1600ms infinite/);
    expect(sheet).not.toContain("aHead-draw-h-0");
  });

  it("zamontowany po otwarciu rysuje pętlę od zera (dodatnie opóźnienie)", () => {
    __openMotionGateForTests();
    const { container } = render(<AnimatedHeadingRender config={config} />);
    expect(css(container)).toMatch(/animation: aHead-loop-h-0 \d+ms 200ms infinite/);
  });

  it("`loop: false` zostaje jednym rysowaniem także po otwarciu", () => {
    const { container } = render(<AnimatedHeadingRender config={{ ...config, loop: false }} />);
    act(() => __openMotionGateForTests());
    expect(css(container)).toContain("1 forwards");
    expect(css(container)).not.toContain("infinite");
  });
});
