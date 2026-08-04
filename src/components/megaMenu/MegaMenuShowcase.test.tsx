import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MegaMenuShowcase } from "@/components/megaMenu/MegaMenuShowcase";
import { seededPattern } from "@/components/ui/grid-card";
import { resolveMegaMenuIcon, MEGA_MENU_ICON_NAMES } from "@/lib/megaMenu/showcaseIcons";

const columns = [
  {
    title_pl: "Produkty",
    title_en: "Products",
    links: [
      {
        label_pl: "Analizy",
        label_en: "Analyses",
        desc_pl: "Opis PL",
        desc_en: "Description EN",
        href: "/analizy",
        icon: "chart",
      },
      { label_pl: "Wywiady", label_en: "Interviews", href: "/wywiady" },
    ],
  },
];

describe("MegaMenu showcase variant", () => {
  it("renders described links as cards and short links as rows (PL)", () => {
    const html = renderToStaticMarkup(<MegaMenuShowcase columns={columns} lang="pl" />);
    expect(html).toContain("Analizy");
    expect(html).toContain("Opis PL");
    expect(html).toContain("Wywiady");
    expect(html).toContain("/analizy");
  });

  it("uses the EN labels for the english locale", () => {
    const html = renderToStaticMarkup(<MegaMenuShowcase columns={columns} lang="en" />);
    expect(html).toContain("Description EN");
    expect(html).not.toContain("Opis PL");
  });

  it("keeps the decorative pattern deterministic (SSR-safe)", () => {
    expect(seededPattern("Analizy")).toEqual(seededPattern("Analizy"));
    expect(seededPattern("Analizy")).not.toEqual(seededPattern("Wywiady"));
  });

  it("resolves every curated icon name and ignores unknown ones", () => {
    for (const name of MEGA_MENU_ICON_NAMES) expect(resolveMegaMenuIcon(name)).toBeTruthy();
    expect(resolveMegaMenuIcon("nope")).toBeNull();
    expect(resolveMegaMenuIcon(undefined)).toBeNull();
  });
});
