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
      links: [
        { label_pl: "Bezpieczeństwo", label_en: "Security", href: "/security" },
      ],
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
    expect(screen.getByRole("button", { name: /Tematy/ })).toBeInTheDocument();
  });

  it("renders trigger label in EN", () => {
    render(<MegaMenu config={config} lang="en" />);
    expect(screen.getByRole("button", { name: /Topics/ })).toBeInTheDocument();
  });

  it("opens panel on click and shows column titles + links + featured CTA", () => {
    render(<MegaMenu config={config} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /Tematy/ }));
    expect(screen.getByText("Analizy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bezpieczeństwo" })).toHaveAttribute(
      "href",
      "/security",
    );
    expect(screen.getByText("Raport")).toBeInTheDocument();
    expect(screen.getByText(/Czytaj/)).toBeInTheDocument();
  });

  it("renders mobile accordion with disclosure", () => {
    const { container } = render(<MegaMenu config={config} lang="en" mobile />);
    const details = container.querySelector("details");
    expect(details).toBeTruthy();
    expect(screen.getByText("Topics")).toBeInTheDocument();
    expect(screen.getByText("Analyses")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Security" })).toBeInTheDocument();
  });

  it("falls back to PL label when EN missing", () => {
    const cfg: MegaMenuConfig = { ...config, trigger_en: "" };
    render(<MegaMenu config={cfg} lang="en" />);
    expect(screen.getByRole("button", { name: /Tematy/ })).toBeInTheDocument();
  });
});
