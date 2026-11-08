// Strony techniczne CMS-a: zawsze `noindex`, poza mapą XML i HTML
// (`lib/seo/utilityPages.ts`).
import { describe, expect, it } from "vitest";
import { UTILITY_PAGE_SLUGS, isUtilityPagePath, isUtilityPageSlug } from "@/lib/seo/utilityPages";

describe("isUtilityPageSlug", () => {
  it("łapie strony wtyczek obecne na produkcji (pages.xml 2026-11-08)", () => {
    for (const slug of [
      "customize-interests",
      "edit-your-submission",
      "koszyk",
      "zamowienie",
      "moje-konto",
      "password-reset",
      "register",
      "membership-login",
    ]) {
      expect(isUtilityPageSlug(slug), slug).toBe(true);
    }
  });

  it("nie łapie sekcji redakcyjnych ani stron sprzedażowych", () => {
    for (const slug of [
      "analizy",
      "o-nas",
      "konferencje",
      "spotkania-chatham-house",
      "membership-join",
      // Trasa kodowa: indeksowalna strona rejestracji z treścią (2026-11-08).
      "membership-registration",
      "pricing",
      "dolacz-do-newslettera",
      "zamowienie-publikacji",
      "register-of-experts",
    ]) {
      expect(isUtilityPageSlug(slug), slug).toBe(false);
    }
  });

  it("toleruje wielkość liter i białe znaki, odrzuca brak sluga", () => {
    expect(isUtilityPageSlug(" Customize-Interests ")).toBe(true);
    expect(isUtilityPageSlug("")).toBe(false);
    expect(isUtilityPageSlug(null)).toBe(false);
    expect(isUtilityPageSlug(undefined)).toBe(false);
  });

  it("lista ma wyłącznie slugi w formie kanonicznej (małe litery, bez ukośników)", () => {
    for (const slug of UTILITY_PAGE_SLUGS) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("isUtilityPagePath", () => {
  it("decyduje ostatni człon ścieżki - także z prefiksem języka i pełnym adresem", () => {
    expect(isUtilityPagePath("/customize-interests")).toBe(true);
    expect(isUtilityPagePath("customize-interests")).toBe(true);
    expect(isUtilityPagePath("/en/koszyk/")).toBe(true);
    expect(isUtilityPagePath("https://neweuropeanstrategies.com/en/moje-konto?x=1#a")).toBe(true);
  });

  it("strona pod stroną techniczną nie dziedziczy reguły - liczy się jej własny slug", () => {
    expect(isUtilityPagePath("/koszyk/regulamin-dostawy")).toBe(false);
    expect(isUtilityPagePath("/analizy")).toBe(false);
    expect(isUtilityPagePath("/")).toBe(false);
    expect(isUtilityPagePath("")).toBe(false);
  });
});
