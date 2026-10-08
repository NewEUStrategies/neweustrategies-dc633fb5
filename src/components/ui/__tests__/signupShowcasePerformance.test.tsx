import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignupShowcase } from "../signup-showcase";
import { __openMotionGateForTests, __resetMotionGateForTests } from "@/lib/performance/motionGate";
import { defaultNewsletterSettings } from "@/hooks/useNewsletterSettings";
import { resolvePopupPalette } from "@/lib/newsletter/popupDesign";

const settings = defaultNewsletterSettings();
const images = Array.from({ length: 5 }, (_, index) => ({
  url: `/media/frame-${index}.jpg`,
  caption: `Frame ${index}`,
}));
function showcase(single = false) {
  return render(
    <SignupShowcase
      images={images}
      design={{ ...settings.popup_design.gallery, grid: single ? "single" : "reference" }}
      palette={resolvePopupPalette(settings, "dark")}
      brand=""
      logoUrl={null}
      radiusPx={6}
      rotateMs={1000}
      showBrand={false}
      showCaption
      showDots
      dotLabel="Slide"
      nextLabel="Next"
    />,
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetMotionGateForTests();
});

describe("showcase delivery", () => {
  it("renders all visible mosaic frames eagerly with only the main frame prioritized", () => {
    const { container } = showcase();
    const frames = container.querySelectorAll("img");
    expect(frames).toHaveLength(4);
    expect(
      [...frames].every((image) => image.loading === "eager" && image.sizes && image.srcset),
    ).toBe(true);
    expect(
      [...frames].filter((image) => image.getAttribute("fetchpriority") === "high"),
    ).toHaveLength(1);
  });

  it("single mode loads the active slide and never rotates into unsupported fifth slots", () => {
    vi.useFakeTimers();
    // Rotacja czeka na bramkę ruchu (P3.5) - otwieramy ją jak pierwsza interakcja.
    __openMotionGateForTests();
    const { container } = showcase(true);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Slide 4" }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/frame-3.jpg");
    act(() => vi.advanceTimersByTime(1000));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/media/frame-0.jpg");
    expect(screen.queryByText("Frame 4")).toBeNull();
  });
});
