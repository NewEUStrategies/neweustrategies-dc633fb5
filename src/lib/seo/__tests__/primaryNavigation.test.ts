// Kolejność sekcji głównych (`lib/seo/primaryNavigation.ts`) - zgłoszenie
// 2026-10-09: w wyniku na nazwę marki Google pokazywał „O nas", „Kontakt"
// i ekran błędu sieci zamiast sekcji redakcyjnych. Lista jest WYBOREM
// z `FOOTER_LINKS`, więc test pilnuje, że wybór nie gubi się po drodze
// (literówka w adresie = sekcja po cichu znika z JSON-LD i llms.txt).
import { describe, expect, it } from "vitest";
import { FOOTER_LINKS } from "@/lib/seo/footerNavigation";
import { PRIMARY_SECTION_HREFS, primarySiteSections } from "@/lib/seo/primaryNavigation";

describe("primarySiteSections", () => {
  it("każdy adres z listy istnieje w mapie stopki - etykiety mają jedno źródło", () => {
    for (const href of PRIMARY_SECTION_HREFS) {
      expect(
        FOOTER_LINKS.some((link) => link.href === href),
        href,
      ).toBe(true);
    }
    expect(primarySiteSections()).toHaveLength(PRIMARY_SECTION_HREFS.length);
  });

  it("zachowuje kolejność redakcji 2026-11-08: analizy, o nas, konferencje, spotkania, wywiady", () => {
    expect(primarySiteSections().map((link) => link.label.en)).toEqual([
      "Analyses",
      "About us",
      "Conferences",
      "Chatham House meetings",
      "Interviews",
    ]);
  });

  it("nie deklaruje „Kontaktu” ani dokumentów prawnych", () => {
    const hrefs = primarySiteSections().map((link) => link.href);
    expect(hrefs).not.toContain("/kontakt");
    expect(primarySiteSections().some((link) => link.group === "legal")).toBe(false);
  });

  it("nie deklaruje stron technicznych (sitelink „Customize Interests”, SERP 2026-11)", () => {
    const hrefs = primarySiteSections().map((link) => link.href);
    expect(hrefs).not.toContain("/customize-interests");
  });

  it("nie ma duplikatów adresów", () => {
    expect(new Set(PRIMARY_SECTION_HREFS).size).toBe(PRIMARY_SECTION_HREFS.length);
  });
});
