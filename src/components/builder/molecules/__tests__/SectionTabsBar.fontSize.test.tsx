// Verifies that changing `tabs.fontSize` in SectionTabsBar propagates in
// real-time to every rendered tab button AND its label <span>, on all items.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SectionTabsBar } from "../SectionTabsBar";
import type { SectionTabsConfig } from "@/lib/builder/types";

function makeCfg(fontSize: number): SectionTabsConfig {
  return {
    enabled: true,
    orientation: "horizontal",
    variant: "underline",
    align: "start",
    fontSize,
    items: [
      { id: "t1", label_pl: "Jeden", label_en: "One" },
      { id: "t2", label_pl: "Dwa", label_en: "Two" },
      { id: "t3", label_pl: "Trzy", label_en: "Three" },
    ],
    defaultTabId: "t1",
  };
}

function renderAt(fontSize: number) {
  return render(
    <SectionTabsBar
      sectionId="sec-test"
      tabs={makeCfg(fontSize)}
      lang="pl"
      activeId="t1"
      onSelect={() => {}}
    />,
  );
}

describe("SectionTabsBar - fontSize wiring", () => {
  it("applies tabs.fontSize as inline style to every tab button and label span", () => {
    const { container } = renderAt(22);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]");
    expect(buttons.length).toBe(3);
    buttons.forEach((btn) => {
      expect(btn.style.fontSize).toBe("22px");
      const span = btn.querySelector("span:not([aria-hidden])") as HTMLSpanElement | null;
      expect(span).not.toBeNull();
      expect(span!.style.fontSize).toBe("22px");
    });
  });

  it("re-renders with the new fontSize on every button and span in real-time", () => {
    const { container, rerender } = renderAt(12);
    const btnsBefore = container.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]");
    btnsBefore.forEach((b) => expect(b.style.fontSize).toBe("12px"));

    rerender(
      <SectionTabsBar
        sectionId="sec-test"
        tabs={makeCfg(30)}
        lang="pl"
        activeId="t1"
        onSelect={() => {}}
      />,
    );

    const btnsAfter = container.querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]");
    expect(btnsAfter.length).toBe(3);
    btnsAfter.forEach((b) => {
      expect(b.style.fontSize).toBe("30px");
      const span = b.querySelector("span:not([aria-hidden])") as HTMLSpanElement | null;
      expect(span!.style.fontSize).toBe("30px");
    });
  });

  it("clamps out-of-range values to [8..48]", () => {
    const { container, rerender } = renderAt(4);
    container
      .querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]")
      .forEach((b) => expect(b.style.fontSize).toBe("8px"));

    rerender(
      <SectionTabsBar
        sectionId="sec-test"
        tabs={makeCfg(999)}
        lang="pl"
        activeId="t1"
        onSelect={() => {}}
      />,
    );
    container
      .querySelectorAll<HTMLButtonElement>("[data-section-tab-btn]")
      .forEach((b) => expect(b.style.fontSize).toBe("48px"));
  });

  it("falls back to 14px when fontSize is not set", () => {
    const { container } = render(
      <SectionTabsBar
        sectionId="sec-test"
        tabs={{
          enabled: true,
          orientation: "horizontal",
          variant: "underline",
          align: "start",
          items: [{ id: "t1", label_pl: "A", label_en: "A" }],
          defaultTabId: "t1",
        }}
        lang="pl"
        activeId="t1"
        onSelect={() => {}}
      />,
    );
    const btn = container.querySelector<HTMLButtonElement>("[data-section-tab-btn]");
    expect(btn!.style.fontSize).toBe("14px");
  });
});
