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

  it("zachowuje zaplanowaną kolejność: analizy, wywiady, wydarzenia, ...", () => {
    expect(primarySiteSections().map((link) => link.label.pl)).toEqual([
      "Analizy",
      "Wywiady",
      "Wydarzenia",
      "Policy papers",
      "Podcast",
      "O nas",
    ]);
  });

  it("nie deklaruje „Kontaktu” ani dokumentów prawnych", () => {
    const hrefs = primarySiteSections().map((link) => link.href);
    expect(hrefs).not.toContain("/kontakt");
    expect(primarySiteSections().some((link) => link.group === "legal")).toBe(false);
  });

  it("/podcasts wraca między policy papers a „O nas” - katalog renderuje listę, nie kartę błędu", () => {
    // Pomiar 2026-10-09: 3/3 odpowiedzi /podcasts zdegradowane (42703 na
    // `podcasts.explicit`), więc sekcja wypadła z listy. Lista odcinków czyta
    // już tylko kolumny karty (`podcastsIndexRoute.test.tsx`).
    const hrefs = primarySiteSections().map((link) => link.href);
    expect(hrefs.indexOf("/podcasts")).toBe(hrefs.indexOf("/category/policy-papers") + 1);
    expect(hrefs.indexOf("/o-nas")).toBe(hrefs.indexOf("/podcasts") + 1);
  });

  it("nie ma duplikatów adresów", () => {
    expect(new Set(PRIMARY_SECTION_HREFS).size).toBe(PRIMARY_SECTION_HREFS.length);
  });
});
