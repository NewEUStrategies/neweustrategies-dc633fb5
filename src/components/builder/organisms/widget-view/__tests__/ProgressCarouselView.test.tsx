// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
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

  it("switches the active slide on click", async () => {
    render(<ProgressCarouselView c={content} lang="pl" paused />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-current")).toBe("true");
    fireEvent.click(buttons[1]);
    // Klik uruchamia krótki dobieg paska (`fastDuration`), potem zmianę slajdu.
    // Dawniej asercja `toBeTruthy()` przechodziła także dla "false".
    await waitFor(() => expect(buttons[1].getAttribute("aria-current")).toBe("true"));
    expect(buttons[0].getAttribute("aria-current")).toBe("false");
  });

  it("marks the first slide active already in the server HTML", () => {
    const html = renderToString(<ProgressCarouselView c={content} lang="pl" />);
    expect(html.match(/data-active="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-active="true"[^>]*><figure[^>]*><img[^>]*alt="Most"/);
  });

  it("shows an empty state without items", () => {
    render(<ProgressCarouselView c={{}} lang="pl" paused />);
    expect(screen.getByText("Dodaj slajdy w panelu widgetu.")).toBeTruthy();
  });
});
