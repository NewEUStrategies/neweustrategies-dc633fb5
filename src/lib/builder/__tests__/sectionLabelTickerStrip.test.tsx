// Etykieta sekcji, wariant Ticker Strip (21), a bramka ruchu (P3.5).
//
// Kropka „na żywo" i jej halo pulsują w nieskończoność (`.nes-ticker-dot`,
// `.nes-ticker-halo` w `styles.css`) już od pierwszego malowania HTML-a z
// serwera. Obie niosą znacznik pauzy bramki (`data-motion-loop`), a wariant
// uzbraja bramkę, więc puls rusza po pierwszej interakcji albo w punkcie ciszy
// także na stronie bez innych konsumentów ruchu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { SectionLabelRender } from "@/lib/builder/sectionLabelVariants";
import { __resetMotionGateForTests } from "@/lib/performance/motionGate";

const quiet = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));

vi.mock("@/lib/performance/whenQuiescent", () => ({
  onQuiescent: (task: () => unknown) => {
    quiet.tasks.push(task);
    return () => {
      quiet.tasks = quiet.tasks.filter((candidate) => candidate !== task);
    };
  },
}));

afterEach(() => {
  cleanup();
  quiet.tasks = [];
  __resetMotionGateForTests();
});

describe("Ticker Strip - bramka ruchu", () => {
  it("puls i halo stoją do otwarcia bramki, którą wariant sam uzbraja", () => {
    const { container } = render(
      <SectionLabelRender label="Na żywo" accent="#FA9346" variant="ticker-strip" />,
    );
    const pulse = container.querySelectorAll(".nes-ticker-dot, .nes-ticker-halo");
    expect(pulse).toHaveLength(2);
    for (const el of pulse) expect(el.hasAttribute("data-motion-loop")).toBe(true);
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);

    expect(quiet.tasks).toHaveLength(1);
    act(() => {
      for (const task of quiet.tasks.splice(0)) task();
    });
    expect(document.documentElement.getAttribute("data-motion")).toBe("on");
  });
});
