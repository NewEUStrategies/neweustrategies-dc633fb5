// Globalne style przełączników z Opcji motywu muszą trafiać do CSS strony.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ThemeOptionsStyle } from "@/components/ThemeOptionsStyle";

const cfg = {
  toggles: {
    width: 56,
    height: 30,
    radius: 6,
    on_color: "#FA9346",
    off_color: "#d4d4d8",
    thumb_color: "#ffffff",
    label_size: 16,
    label_weight: 700,
  },
};

vi.mock("@/lib/useSiteSetting", () => ({
  useSiteSetting: () => cfg,
}));

describe("ThemeOptionsStyle - toggles", () => {
  it("emits toggle size, colors and label typography", () => {
    const { container } = render(<ThemeOptionsStyle />);
    const css = container.querySelector("style")?.innerHTML ?? "";
    expect(css).toContain("--to-toggle-w: 56px");
    expect(css).toContain("--to-toggle-h: 30px");
    expect(css).toContain("--to-toggle-radius: 6px");
    expect(css).toContain("--to-toggle-on: #FA9346");
    expect(css).toContain("--to-toggle-off: #d4d4d8");
    expect(css).toContain("--to-toggle-thumb: #ffffff");
    expect(css).toContain("--to-toggle-label-size: 16px");
    expect(css).toContain("--to-toggle-label-weight: 700");
    expect(css).toContain('button[role="switch"]');
  });
});
