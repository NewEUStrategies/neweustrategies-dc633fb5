// Tabela sieci społecznościowych i ocena wymiarów karty. Testy pilnują tego,
// co w podglądzie jest niewidoczne gołym okiem: że progi przycięcia są RÓŻNE
// per sieć (bo to jest cały powód istnienia tego modułu) i że ocena wymiarów
// rozdziela "za mały" od "złe proporcje" - dwie różne wady, dwie różne rady.
import { describe, expect, it } from "vitest";
import {
  OG_RECOMMENDED_HEIGHT,
  OG_RECOMMENDED_WIDTH,
  SOCIAL_NETWORKS,
  displayHost,
  fallbackImageAlt,
  ogDimensionVerdict,
  socialNetworkSpec,
  truncateForNetwork,
} from "@/lib/seo/socialNetworks";

describe("tabela sieci", () => {
  it("ma unikalne identyfikatory", () => {
    const ids = SOCIAL_NETWORKS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("progi tytułu NIE są jednakowe - inaczej moduł byłby zbędny", () => {
    expect(new Set(SOCIAL_NETWORKS.map((n) => n.titleLimit)).size).toBeGreaterThan(1);
  });

  it("tylko X czyta znaczniki twitter:*", () => {
    expect(SOCIAL_NETWORKS.filter((n) => n.usesTwitterTags).map((n) => n.id)).toEqual(["x"]);
  });

  it("nieznany identyfikator spada na pierwszą sieć, nie na undefined", () => {
    // @ts-expect-error - celowo poza unią, bronimy się przed danymi z zewnątrz
    expect(socialNetworkSpec("myspace")).toBe(SOCIAL_NETWORKS[0]);
  });
});

describe("truncateForNetwork", () => {
  it("zwraca ORYGINAŁ, gdy mieści się w progu (bez wielokropka na zapas)", () => {
    expect(truncateForNetwork("Krótki tytuł", 70)).toBe("Krótki tytuł");
  });

  it("przycina do progu i dokłada wielokropek", () => {
    const out = truncateForNetwork("a".repeat(100), 70);
    expect(out).toHaveLength(70);
    expect(out.endsWith("…")).toBe(true);
  });

  it("próg zero oznacza sieć bez opisu - zwraca pustkę", () => {
    expect(truncateForNetwork("cokolwiek", 0)).toBe("");
  });

  it("nie zostawia spacji przed wielokropkiem", () => {
    expect(truncateForNetwork("słowo ".repeat(40), 20)).not.toMatch(/ …$/);
  });
});

describe("ogDimensionVerdict", () => {
  it("zalecany kadr jest OK", () => {
    expect(ogDimensionVerdict(OG_RECOMMENDED_WIDTH, OG_RECOMMENDED_HEIGHT)).toBe("ok");
  });

  it("1200x628 (wariant LinkedIn) mieści się w tolerancji", () => {
    expect(ogDimensionVerdict(1200, 628)).toBe("ok");
  });

  it("plik poniżej progu sieci to `tooSmall`, choćby proporcje były idealne", () => {
    expect(ogDimensionVerdict(400, 210)).toBe("tooSmall");
  });

  it("duży kwadrat to `wrongRatio` - będzie przycięty, nie odrzucony", () => {
    expect(ogDimensionVerdict(1200, 1200)).toBe("wrongRatio");
  });

  it("brak wymiarów daje `unknown`, a nie fałszywe OK", () => {
    expect(ogDimensionVerdict(null, null)).toBe("unknown");
    expect(ogDimensionVerdict(0, 630)).toBe("unknown");
  });
});

describe("pomocnicze", () => {
  it("displayHost zdejmuje protokół i końcowy ukośnik", () => {
    expect(displayHost("https://neweuropeanstrategies.com/")).toBe("neweuropeanstrategies.com");
  });

  it("fallbackImageAlt jest dwujęzyczny", () => {
    expect(fallbackImageAlt("Marka", "pl")).toContain("karta");
    expect(fallbackImageAlt("Marka", "en")).toContain("share card");
  });
});
