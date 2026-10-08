// Blok `CountdownView` (publiczny renderer bloków) a bramka ruchu (P3.5).
//
// Sekunda co sekundę to zmiana wizualna co sekundę - w kadrze trzyma Speed
// Index aż do końca śladu. Do pierwszej interakcji albo punktu ciszy zegar tyka
// więc co minutę (cyfra sekund stoi), a po otwarciu bramki - co sekundę, i
// pierwszy takt przychodzi pełną sekundę po otwarciu (samo otwarcie niczego
// nie przelicza). Pierwszy render to nadal placeholdery „--" (parytet SSR).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { CountdownView } from "@/components/blocks/InteractiveViews";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetMotionGateForTests();
});

/** Wartość komórki o danej jednostce (wartość stoi tuż przed etykietą). */
const cell = (unit: string) => screen.getByText(unit).previousElementSibling?.textContent;

describe("CountdownView - bramka ruchu", () => {
  it("serwer renderuje placeholdery (bez wartości policzonej na serwerze)", () => {
    const html = renderToString(<CountdownView targetAt="2030-01-01T00:00:00.000Z" lang="pl" />);
    expect(html).toContain("--");
  });

  it("do otwarcia takt minutowy, po otwarciu sekunda pełną sekundę po otwarciu", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00.000Z"));
    const target = new Date(Date.now() + 2 * 86_400_000 + 7 * 60_000 + 40_000).toISOString();
    render(<CountdownView targetAt={target} lang="pl" />);
    expect(cell("s")).toBe("40");
    expect(cell("min")).toBe("07");

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(cell("s")).toBe("40");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(cell("min")).toBe("06");
    expect(cell("s")).toBe("40");

    act(() => __openMotionGateForTests());
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(cell("s")).toBe("40");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(cell("s")).toBe("39");
  });
});
