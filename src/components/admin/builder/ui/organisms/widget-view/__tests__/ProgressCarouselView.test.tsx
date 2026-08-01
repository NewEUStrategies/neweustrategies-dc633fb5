// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProgressCarouselView } from "../ProgressCarouselView";

const content = {
  heading_pl: "Galeria",
  heading_en: "Gallery",
  items: [
    { img: "https://x/a.jpg", title_pl: "Most", title_en: "Bridge", desc_pl: "Opis mostu" },
    { img: "https://x/b.jpg", title_pl: "Góry", title_en: "Mountains", desc_pl: "Opis gór" },
  ],
};

describe("ProgressCarouselView", () => {
  it("renders heading and slide buttons in PL", () => {
    render(<ProgressCarouselView c={content} lang="pl" paused />);
    expect(screen.getByRole("heading", { name: "Galeria" })).toBeTruthy();
    expect(screen.getByText("Most")).toBeTruthy();
    expect(screen.getByText("Opis mostu")).toBeTruthy();
  });

  it("renders EN labels", () => {
    render(<ProgressCarouselView c={content} lang="en" paused />);
    expect(screen.getByRole("heading", { name: "Gallery" })).toBeTruthy();
    expect(screen.getByText("Bridge")).toBeTruthy();
  });

  it("switches the active slide on click", () => {
    render(<ProgressCarouselView c={content} lang="pl" paused />);
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute("aria-current")).toBeTruthy();
  });

  it("shows an empty state without items", () => {
    render(<ProgressCarouselView c={{}} lang="pl" paused />);
    expect(screen.getByText("Dodaj slajdy w panelu widgetu.")).toBeTruthy();
  });
});
