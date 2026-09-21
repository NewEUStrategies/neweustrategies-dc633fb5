import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ChartTooltip } from "../ChartTooltip";

const originalOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
afterEach(() => {
  vi.restoreAllMocks();
  if (originalOffsetParent)
    Object.defineProperty(HTMLElement.prototype, "offsetParent", originalOffsetParent);
  else Reflect.deleteProperty(HTMLElement.prototype, "offsetParent");
});
const rows = [
  { name: "Revenue", value: "120", colorSlot: 1, emphasised: true },
  { name: "Total", value: "120", colorSlot: null },
];
describe("tooltip measured layout", () => {
  it.each([
    { x: 20, y: 60, width: 400, expected: "translate3d(32px, 40px, 0)" },
    { x: 390, y: 190, width: 400, expected: "translate3d(278px, 156px, 0)" },
    { x: 10, y: 0, width: 80, expected: "translate3d(4px, 4px, 0)" },
  ])(
    "keeps the measured tooltip inside the available viewport ($x, $y)",
    ({ x, y, width, expected }) => {
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
      const parent = document.createElement("div");
      Object.defineProperty(parent, "clientHeight", { value: 200 });
      Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get: () => parent,
      });
      const { container, rerender } = render(
        <ChartTooltip
          visible
          x={x}
          y={y}
          containerWidth={width}
          title="Period"
          note="Forecast"
          rows={rows}
        />,
      );
      expect(container.querySelector<HTMLElement>(".neh-tooltip")?.style.transform).toBe(expected);
      rerender(
        <ChartTooltip visible x={x} y={y} containerWidth={width} title="Period" rows={rows} />,
      );
      expect(container.querySelector<HTMLElement>(".neh-tooltip")?.style.transform).toBe(expected);
    },
  );
  it("clamps vertically when no positioned ancestor is available", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get: () => null,
    });
    const { container } = render(
      <ChartTooltip visible x={20} y={100} containerWidth={400} title="" rows={rows} />,
    );
    expect(container.querySelector<HTMLElement>(".neh-tooltip")?.style.transform).toBe(
      "translate3d(32px, 4px, 0)",
    );
  });
});
