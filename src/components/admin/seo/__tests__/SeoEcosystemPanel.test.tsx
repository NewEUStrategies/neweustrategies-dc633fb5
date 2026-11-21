// Jeden panel w dwóch zakładkach: przełącznik zmienia listę plików i robots.txt naraz.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { SeoEcosystemPanel } from "@/components/admin/seo/SeoEcosystemPanel";
import { DEFAULT_SEO_SETTINGS, type SeoSettings } from "@/lib/seo/settings";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

function Harness({ initial }: { initial: SeoSettings }) {
  const [settings, setSettings] = useState(initial);
  return (
    <SeoEcosystemPanel
      settings={settings}
      onChange={(patch) => setSettings({ ...settings, ...patch })}
      host="site-identity"
    />
  );
}

const robotsText = () => document.querySelector("pre")?.textContent ?? "";
const fileLinks = () =>
  within(screen.getByRole("table"))
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));

describe("SeoEcosystemPanel", () => {
  it("removes the Google News sitemap from the list and robots.txt when switched off", () => {
    render(<Harness initial={DEFAULT_SEO_SETTINGS} />);
    expect(fileLinks()).toContain("/news-sitemap.xml");
    expect(robotsText()).toContain("news-sitemap.xml");

    fireEvent.click(screen.getAllByRole("checkbox")[1] as HTMLElement);

    expect(fileLinks()).not.toContain("/news-sitemap.xml");
    expect(robotsText()).not.toContain("news-sitemap.xml");
    expect(screen.getByTestId("SeoEcosystemDisabled")).toBeTruthy();
  });

  it("links to the other tab so both tabs stay one click apart", () => {
    render(<Harness initial={DEFAULT_SEO_SETTINGS} />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/admin/settings/seo");
    expect(hrefs).toContain("/robots.txt");
  });
});
