// MegaMenu - smoke + interaction tests (PL/EN, click trigger, mobile accordion).
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MegaMenu, type MegaMenuConfig } from "../MegaMenu";

const config: MegaMenuConfig = {
  trigger_pl: "Tematy",
  trigger_en: "Topics",
  triggerOn: "click",
  width: "container",
  columns: [
    {
      title_pl: "Analizy",
      title_en: "Analyses",
      links: [{ label_pl: "Bezpieczeństwo", label_en: "Security", href: "/security" }],
      featured: null,
    },
    {
      title_pl: "Wyróżnione",
      title_en: "Featured",
      links: [],
      featured: {
        image: "",
        title_pl: "Raport",
        title_en: "Report",
        excerpt_pl: "Opis",
        excerpt_en: "Summary",
        href: "/report",
        cta_pl: "Czytaj",
        cta_en: "Read",
      },
    },
  ],
};

describe("MegaMenu", () => {
  it("renders trigger label in PL", () => {
    render(<MegaMenu config={config} lang="pl" />);
    expect(screen.getByRole("button", { name: /Tematy/ })).not.toBeNull();
  });

  it("renders trigger label in EN", () => {
    render(<MegaMenu config={config} lang="en" />);
    expect(screen.getByRole("button", { name: /Topics/ })).not.toBeNull();
  });

  it("opens panel on click and shows columns + links + featured CTA", () => {
    render(<MegaMenu config={config} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Tematy/ }));
    expect(screen.getByText("Analizy")).not.toBeNull();
    const link = screen.getByRole("link", { name: "Bezpieczeństwo" });
    expect(link.getAttribute("href")).toBe("/security");
    expect(screen.getByText("Raport")).not.toBeNull();
    expect(screen.getByText(/Czytaj/)).not.toBeNull();
  });

  it("renders mobile accordion with disclosure", () => {
    const { container } = render(<MegaMenu config={config} lang="en" mobile />);
    expect(container.querySelector("details")).not.toBeNull();
    expect(screen.getByText("Topics")).not.toBeNull();
    expect(screen.getByText("Analyses")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Security" })).not.toBeNull();
  });

  it("falls back to PL label when EN missing", () => {
    const cfg: MegaMenuConfig = { ...config, trigger_en: "" };
    render(<MegaMenu config={cfg} lang="en" />);
    expect(screen.getByRole("button", { name: /Tematy/ })).not.toBeNull();
  });
});
