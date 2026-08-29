// Regresja UI kafelków marki: snapshot gradientów (LinkedIn i pozostałe sieci)
// oraz kontrakt klas hover/focus. Test ma wyłapać każdą zmianę koloru, rampy
// gradientu lub zachowania kafelka, zanim trafi na produkcję.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BRAND_PILL_CLASS,
  BRAND_TILE_CLASS,
  brandTileColor,
  brandTileGradient,
  brandTileStyle,
  type BrandTileKey,
} from "@/components/common/brandTile";

const NETWORKS: readonly BrandTileKey[] = [
  "facebook",
  "x",
  "youtube",
  "instagram",
  "linkedin",
  "spotify",
  "website",
  "mail",
  "email",
  "phone",
  "location",
];

describe("brandTile - snapshot palety", () => {
  it("utrzymuje stały kolor i gradient dla każdej sieci", () => {
    const snapshot = Object.fromEntries(
      NETWORKS.map((key) => [
        key,
        { color: brandTileColor(key), gradient: brandTileGradient(key) },
      ]),
    );
    expect(snapshot).toMatchInlineSnapshot(`
      {
        "email": {
          "color": "hsl(var(--brand, 25 95% 63%))",
          "gradient": "linear-gradient(135deg, color-mix(in oklab, var(--brand) 62%, #2B1408) 0%, color-mix(in oklab, var(--brand) 45%, #1D0E06) 54%, color-mix(in oklab, var(--brand) 28%, #150B05) 100%)",
        },
        "facebook": {
          "color": "#1877F2",
          "gradient": "linear-gradient(135deg, #1567D6 0%, #0A3E85 100%)",
        },
        "instagram": {
          "color": "#E4405F",
          "gradient": "linear-gradient(135deg, #C2551F 0%, #B4225F 48%, #6A2A9C 100%)",
        },
        "linkedin": {
          "color": "#0A66C2",
          "gradient": "linear-gradient(135deg, #0A66C2 0%, #013A70 100%)",
        },
        "location": {
          "color": "hsl(var(--brand, 25 95% 63%))",
          "gradient": "linear-gradient(135deg, color-mix(in oklab, var(--brand) 62%, #2B1408) 0%, color-mix(in oklab, var(--brand) 45%, #1D0E06) 54%, color-mix(in oklab, var(--brand) 28%, #150B05) 100%)",
        },
        "mail": {
          "color": "hsl(var(--brand, 25 95% 63%))",
          "gradient": "linear-gradient(135deg, color-mix(in oklab, var(--brand) 62%, #2B1408) 0%, color-mix(in oklab, var(--brand) 45%, #1D0E06) 54%, color-mix(in oklab, var(--brand) 28%, #150B05) 100%)",
        },
        "phone": {
          "color": "hsl(var(--brand, 25 95% 63%))",
          "gradient": "linear-gradient(135deg, color-mix(in oklab, var(--brand) 62%, #2B1408) 0%, color-mix(in oklab, var(--brand) 45%, #1D0E06) 54%, color-mix(in oklab, var(--brand) 28%, #150B05) 100%)",
        },
        "spotify": {
          "color": "#1DB954",
          "gradient": "linear-gradient(135deg, #0C7A35 0%, #064F20 100%)",
        },
        "website": {
          "color": "hsl(var(--brand, 25 95% 63%))",
          "gradient": "linear-gradient(135deg, color-mix(in oklab, var(--brand) 62%, #2B1408) 0%, color-mix(in oklab, var(--brand) 45%, #1D0E06) 54%, color-mix(in oklab, var(--brand) 28%, #150B05) 100%)",
        },
        "x": {
          "color": "#000000",
          "gradient": "linear-gradient(135deg, #262626 0%, #000000 100%)",
        },
        "youtube": {
          "color": "#FF0000",
          "gradient": "linear-gradient(135deg, #D8221A 0%, #8E0F0A 100%)",
        },
      }
    `);
  });

  it("LinkedIn ma gradient, a nie płaską plamę koloru logotypu", () => {
    const gradient = brandTileGradient("linkedin");
    expect(gradient).toContain("#0A66C2");
    expect(gradient).toContain("#013A70");
    expect(gradient.startsWith("linear-gradient(135deg")).toBe(true);
  });

  it("nieznany klucz spada na firmową tonację, nie na czerń", () => {
    expect(brandTileColor("mastodon")).toBe("hsl(var(--brand, 25 95% 63%))");
    expect(brandTileGradient("mastodon")).toContain("color-mix(in oklab, var(--brand)");
  });

  it("każda sieć ma unikalny gradient", () => {
    const brandOnly = ["facebook", "x", "youtube", "instagram", "linkedin", "spotify"] as const;
    const gradients = brandOnly.map((key) => brandTileGradient(key));
    expect(new Set(gradients).size).toBe(brandOnly.length);
  });
});

describe("brandTileStyle - zmienne CSS", () => {
  it("wstrzykuje --tile-brand i --tile-grad oraz zachowuje dodatkowe style", () => {
    const style = brandTileStyle("linkedin", { width: 36, height: 36 }) as Record<string, unknown>;
    expect(style["--tile-brand"]).toBe("#0A66C2");
    expect(style["--tile-grad"]).toBe(brandTileGradient("linkedin"));
    expect(style["width"]).toBe(36);
    expect(style["height"]).toBe(36);
  });

  it("renderuje zmienne na elemencie DOM", () => {
    render(
      <a href="https://linkedin.com" aria-label="LinkedIn" style={brandTileStyle("linkedin")}>
        li
      </a>,
    );
    const el = screen.getByLabelText("LinkedIn");
    expect(el.style.getPropertyValue("--tile-brand")).toBe("#0A66C2");
    expect(el.style.getPropertyValue("--tile-grad")).toBe(brandTileGradient("linkedin"));
  });
});

describe("brandTile - kontrakt hover/focus", () => {
  const HOVER_CONTRACT = [
    "rounded-[6px]",
    "bg-transparent",
    "hover:[background-image:linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_38%,rgba(255,255,255,0)_62%),var(--tile-grad)]",
    "hover:text-white",
    "hover:shadow-[0_10px_24px_-16px_rgba(0,0,0,0.55)]",
    "focus-visible:[background-image:linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.05)_38%,rgba(255,255,255,0)_62%),var(--tile-grad)]",
    "focus-visible:text-white",
    "focus-visible:ring-2",
    "hover:[&_svg]:!text-white",
    "focus-visible:[&_svg]:!text-white",
  ] as const;

  it.each(HOVER_CONTRACT)("kafelek zawiera klasę %s", (cls) => {
    expect(BRAND_TILE_CLASS).toContain(cls);
  });

  it("pigułka kontaktowa reaguje tak samo jak kafelek", () => {
    for (const cls of HOVER_CONTRACT.filter(
      (c) => c.startsWith("hover:") || c.startsWith("focus-visible:"),
    )) {
      expect(BRAND_PILL_CLASS).toContain(cls);
    }
  });

  it("obie klasy animują tło i kolor ikony", () => {
    for (const cls of [BRAND_TILE_CLASS, BRAND_PILL_CLASS]) {
      expect(cls).toContain("transition-[background-image,box-shadow,border-color,color]");
      expect(cls).toContain("[&_svg]:transition-colors");
    }
  });
});
