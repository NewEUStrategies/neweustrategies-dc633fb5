import { describe, expect, it } from "vitest";

import { headerSeoHeadingText } from "@/components/header/atoms/HeaderSeoHeading";
import { SITE_NAME } from "@/lib/seo/meta";

describe("headerSeoHeadingText", () => {
  it("bierze redakcyjny tytuł z panelu SEO dla języka", () => {
    const raw = { site_title_pl: "Tytuł PL", site_title_en: "Title EN" };
    expect(headerSeoHeadingText(raw, "pl")).toBe("Tytuł PL");
    expect(headerSeoHeadingText(raw, "en")).toBe("Title EN");
  });

  it("wraca do nazwy marki gdy tytuł jest pusty lub blob jest uszkodzony", () => {
    expect(headerSeoHeadingText({ site_title_pl: "   " }, "pl")).toBe(SITE_NAME);
    expect(headerSeoHeadingText(null, "en")).toBe(SITE_NAME);
  });
});
