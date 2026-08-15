// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CircularCarouselView } from "../CircularCarouselView";

const content = {
  heading_pl: "Nasze moduły",
  heading_en: "Our modules",
  autoPlay: false,
  items: [
    {
      title_pl: "Silnik Nebula",
      title_en: "Nebula Engine",
      desc_pl: "Potok renderowania w czasie rzeczywistym.",
      desc_en: "Real-time rendering pipeline.",
      tag_pl: "Grafika",
      tag_en: "Graphics",
      href: "https://example.test/nebula",
    },
    {
      title_pl: "Quantum Sync",
      title_en: "Quantum Sync",
      desc_pl: "Natychmiastowa replikacja stanu.",
      desc_en: "Instant state replication.",
      tag_pl: "Czas rzeczywisty",
      tag_en: "Realtime",
      href: "",
    },
  ],
};

describe("CircularCarouselView", () => {
  it("renders the PL heading, cards and tags", () => {
    render(<CircularCarouselView c={content} lang="pl" paused />);
    expect(screen.getByRole("heading", { name: "Nasze moduły" })).toBeTruthy();
    expect(screen.getByText("Silnik Nebula")).toBeTruthy();
    expect(screen.getByText("Grafika")).toBeTruthy();
  });

  it("renders EN content and EN a11y labels", () => {
    render(<CircularCarouselView c={content} lang="en" paused />);
    expect(screen.getByRole("heading", { name: "Our modules" })).toBeTruthy();
    expect(screen.getByText("Nebula Engine")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Circular carousel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next card" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to card 2" })).toBeTruthy();
  });

  it("renders a card link only when href is set and keeps it sanitized", () => {
    render(<CircularCarouselView c={content} lang="pl" paused />);
    const link = screen.getByRole("link", { name: /Silnik Nebula/ });
    expect(link.getAttribute("href")).toBe("https://example.test/nebula");
    // Druga karta nie ma linku - tylko jeden <a> w całym widgecie.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("drops an unsafe card link instead of rendering it", () => {
    render(
      <CircularCarouselView
        c={{ ...content, items: [{ title_pl: "Karta", href: "javascript:alert(1)" }] }}
        lang="pl"
        paused
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Karta")).toBeTruthy();
  });

  it("advances the active card with the next arrow", () => {
    render(<CircularCarouselView c={content} lang="pl" paused />);
    fireEvent.click(screen.getByRole("button", { name: "Następna karta" }));
    expect(screen.getByRole("option", { selected: true }).getAttribute("aria-label")).toBe(
      "Quantum Sync",
    );
  });

  it("hides the counter, dots and arrows when toggled off", () => {
    render(
      <CircularCarouselView
        c={{ ...content, showCounter: false, showDots: false, showArrows: false }}
        lang="pl"
        paused
      />,
    );
    expect(screen.queryByRole("button", { name: "Następna karta" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Przejdź do karty 1" })).toBeNull();
  });

  it("shows an empty state without items", () => {
    render(<CircularCarouselView c={{}} lang="pl" paused />);
    expect(screen.getByText("Dodaj karty w panelu widgetu.")).toBeTruthy();
  });
});
