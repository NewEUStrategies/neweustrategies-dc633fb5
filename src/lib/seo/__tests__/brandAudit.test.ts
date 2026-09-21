// Reguły audytu marki. Ten plik pilnuje JEDNEJ rzeczy, której nie widać
// w kodzie produkcyjnym: że `titleBrandStripped` opisuje realny objaw
// z wyszukiwarki, a nie życzenie. Objaw: tytuł "New European Strategies -
// European Security Analysis" wraca w SERP-ie jako "European Security
// Analysis". Gdyby ta reguła zaczęła łapać tytuły z marką NA KOŃCU, panel
// zacząłby kazać redakcji poprawiać coś, co jest poprawne.
import { describe, expect, it } from "vitest";
import {
  auditBrandSeo,
  brandAuditScore,
  brandOccurrences,
  countBySeverity,
  titleLeadsWithBrand,
  type BrandAuditInput,
} from "@/lib/seo/brandAudit";

const BRAND = "New European Strategies";

/** Konfiguracja bez ANI JEDNEGO problemu - punkt odniesienia każdego testu. */
const healthy: BrandAuditInput = {
  siteName: BRAND,
  title: "Bezpieczeństwo Europy - New European Strategies",
  description:
    "Niezależny think-tank o bezpieczeństwie Europy i geopolityce: analizy, raporty, wywiady i policy papers na temat gry mocarstw.",
  ogImageUrl: "https://cdn.example.com/og/home.jpg",
  ogImageIsBuiltIn: false,
  ogImageAlt: "Karta udostępniania New European Strategies",
  sameAs: ["https://www.linkedin.com/company/neweustrategies"],
  publisherLogoUrl: "https://cdn.example.com/logo.png",
  twitterSite: "@neweustrategies",
  noindex: false,
};

const ids = (input: BrandAuditInput) => auditBrandSeo(input).map((f) => f.id);

describe("titleLeadsWithBrand - kształt, który Google zdejmuje", () => {
  it("łapie markę na POCZĄTKU z separatorem (dokładnie objaw z SERP-u)", () => {
    expect(titleLeadsWithBrand("New European Strategies - European Security Analysis", BRAND)).toBe(
      true,
    );
  });

  it.each(["–", "—", "|", ":", "·", "•"])("uznaje separator %s", (sep) => {
    expect(titleLeadsWithBrand(`${BRAND} ${sep} Analizy`, BRAND)).toBe(true);
  });

  it("NIE łapie marki na końcu - to poprawny sufiks, nie dubel", () => {
    expect(titleLeadsWithBrand("Bezpieczeństwo Europy - New European Strategies", BRAND)).toBe(
      false,
    );
  });

  it("NIE łapie marki wplecionej w zdanie bez separatora", () => {
    expect(titleLeadsWithBrand("New European Strategies bada bezpieczeństwo Europy", BRAND)).toBe(
      false,
    );
  });

  it("jest niewrażliwy na wielkość liter", () => {
    expect(titleLeadsWithBrand("NEW EUROPEAN STRATEGIES - Analizy", BRAND)).toBe(true);
  });

  it("sam brand bez reszty NIE jest prefiksem (łapie go osobna reguła)", () => {
    expect(titleLeadsWithBrand(BRAND, BRAND)).toBe(false);
  });

  it("pusta marka albo pusty tytuł nie wywracają funkcji", () => {
    expect(titleLeadsWithBrand("", BRAND)).toBe(false);
    expect(titleLeadsWithBrand("cokolwiek", "")).toBe(false);
  });
});

describe("brandOccurrences", () => {
  it("liczy każde wystąpienie, nie tylko pierwsze", () => {
    expect(brandOccurrences(`${BRAND} - Analizy - ${BRAND}`, BRAND)).toBe(2);
  });
  it("zwraca zero dla pustej marki (brak dzielenia przez pustkę)", () => {
    expect(brandOccurrences("cokolwiek", "")).toBe(0);
  });
});

describe("auditBrandSeo", () => {
  it("zdrowa konfiguracja nie zgłasza NICZEGO", () => {
    expect(auditBrandSeo(healthy)).toEqual([]);
    expect(brandAuditScore(auditBrandSeo(healthy))).toBe(100);
  });

  it("tytuł z marką na przedzie daje `titleBrandStripped`", () => {
    const found = ids({ ...healthy, title: `${BRAND} - European Security Analysis` });
    expect(found).toContain("titleBrandStripped");
  });

  it("tytuł bez marki daje `titleBrandMissing`, a NIE `titleBrandStripped`", () => {
    const found = ids({ ...healthy, title: "Bezpieczeństwo Europy i geopolityka" });
    expect(found).toContain("titleBrandMissing");
    expect(found).not.toContain("titleBrandStripped");
  });

  it("sam brand jako tytuł daje `titleIsBrandOnly`", () => {
    expect(ids({ ...healthy, title: BRAND })).toContain("titleIsBrandOnly");
  });

  it("marka dwa razy w tytule daje `titleBrandDuplicated` z licznikiem", () => {
    const findings = auditBrandSeo({ ...healthy, title: `Analizy - ${BRAND} - ${BRAND}` });
    const dup = findings.find((f) => f.id === "titleBrandDuplicated");
    expect(dup?.params?.count).toBe(2);
  });

  it("pusty tytuł to BŁĄD i wyklucza reguły o kształcie marki", () => {
    const findings = auditBrandSeo({ ...healthy, title: "   " });
    expect(findings.find((f) => f.id === "titleMissing")?.severity).toBe("error");
    expect(findings.map((f) => f.id)).not.toContain("titleBrandMissing");
  });

  it("noindex strony głównej to BŁĄD i stoi PIERWSZY na liście", () => {
    const findings = auditBrandSeo({ ...healthy, noindex: true });
    expect(findings[0]).toEqual({ id: "homepageNoindex", severity: "error" });
  });

  it("brak opisu to błąd, a za długi opis to ostrzeżenie z pikselami", () => {
    expect(auditBrandSeo({ ...healthy, description: "" }).map((f) => f.id)).toContain(
      "descriptionMissing",
    );
    const long = auditBrandSeo({ ...healthy, description: "Bardzo długi opis. ".repeat(40) });
    const finding = long.find((f) => f.id === "descriptionTooLong");
    expect(finding?.severity).toBe("warning");
    expect(Number(finding?.params?.px)).toBeGreaterThan(Number(finding?.params?.limitPx));
  });

  it("brak karty to błąd, a karta wbudowana to tylko ostrzeżenie", () => {
    expect(auditBrandSeo({ ...healthy, ogImageUrl: "" }).map((f) => f.id)).toContain(
      "ogImageMissing",
    );
    const builtIn = auditBrandSeo({ ...healthy, ogImageIsBuiltIn: true });
    expect(builtIn.find((f) => f.id === "ogImageBuiltIn")?.severity).toBe("warning");
    expect(builtIn.map((f) => f.id)).not.toContain("ogImageMissing");
  });

  it("puste sygnały encji zgłaszają się POJEDYNCZO, nie jako jedna zbiorcza wada", () => {
    const found = ids({
      ...healthy,
      sameAs: [],
      publisherLogoUrl: "",
      twitterSite: "",
      ogImageAlt: "",
    });
    expect(found).toEqual(
      expect.arrayContaining([
        "ogImageAltMissing",
        "sameAsMissing",
        "publisherLogoMissing",
        "twitterSiteMissing",
      ]),
    );
  });
});

describe("brandAuditScore i countBySeverity", () => {
  it("błąd kosztuje więcej niż ostrzeżenie", () => {
    expect(brandAuditScore([{ id: "a", severity: "error" }])).toBe(80);
    expect(brandAuditScore([{ id: "b", severity: "warning" }])).toBe(93);
  });

  it("wynik nie schodzi poniżej zera nawet przy lawinie problemów", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `x${i}`,
      severity: "error" as const,
    }));
    expect(brandAuditScore(many)).toBe(0);
  });

  it("liczniki rozdzielają wagi", () => {
    expect(
      countBySeverity([
        { id: "a", severity: "error" },
        { id: "b", severity: "warning" },
        { id: "c", severity: "warning" },
      ]),
    ).toEqual({ errors: 1, warnings: 2 });
  });
});
