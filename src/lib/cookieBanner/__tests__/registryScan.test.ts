// Skaner deklaracji cookie (`detectCollectedElements`) i opis kluczy SPOZA rejestru.
//
// Do tego pliku `describeUnknown` (cała ścieżka elementów „wykrytych
// automatycznie") nie miała ani jednego testu, a to ona pisze opis, który
// użytkownik czyta w banerze jako informację z art. 13 RODO.
//
// NAPRAWA TEJ KAMPANII: kategoria nieznanego klucza była zgadywana podciągiem
// na całej nazwie, więc `preferences` (p-REF-erences) i `theme_header`
// (he-AD-er) szły do MARKETINGU, a `account`, `country`, `preview`
// i `sidebar-state` - do ANALITYKI. Testy niżej przypinają obie strony reguły:
// zwykłe słowa NIE są śledzeniem, a prawdziwe identyfikatory kampanii
// i liczniki NADAL są rozpoznawane (zaniżenie deklaracji byłoby gorsze).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DATA_ELEMENT_REGISTRY,
  REGISTRY_BY_CATEGORY,
  classifyKey,
  detectCollectedElements,
  guessUnknownCategory,
} from "@/lib/cookieBanner/registry";

function clearCookies(): void {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearCookies();
});

describe("guessUnknownCategory - zwykłe słowa nie są śledzeniem (NAPRAWA)", () => {
  it.each([
    "nes.preferences",
    "theme_header",
    "loaded",
    "account_tab",
    "country",
    "preview-mode",
    "preventScroll",
    "sidebar-state",
    "status",
    "reference-style",
    "viewport",
    "discount_banner_closed",
  ])("`%s` to preferencja interfejsu (functional)", (key) => {
    expect(guessUnknownCategory(key)).toBe("functional");
  });
});

describe("guessUnknownCategory - prawdziwe identyfikatory nadal rozpoznane", () => {
  it.each([
    ["utm_source", "marketing"],
    ["__utmz", "marketing"],
    ["promoCode", "marketing"],
    ["coupon", "marketing"],
    ["affiliate_id", "marketing"],
    ["last-campaign", "marketing"],
    ["referrer", "marketing"],
    ["nes_ref", "marketing"],
    ["ad_seen", "marketing"],
    ["adsShown", "marketing"],
    ["gclid", "marketing"],
    ["readCount", "analytics"],
    ["pageViews", "analytics"],
    ["viewed_posts", "analytics"],
    ["eventLog", "analytics"],
    ["visitorId", "analytics"],
    ["pagetracker", "analytics"],
    ["statsCache", "analytics"],
    ["metrics.v2", "analytics"],
    ["counter", "analytics"],
  ] as const)("`%s` -> %s", (key, category) => {
    expect(guessUnknownCategory(key)).toBe(category);
  });

  it("marketing wygrywa z analityką, gdy klucz niesie oba sygnały", () => {
    expect(guessUnknownCategory("utm_event_count")).toBe("marketing");
  });
});

describe("detectCollectedElements - skan przeglądarki", () => {
  it("pusta przeglądarka: pełny rejestr bez wykrytych kluczy i bez elementów auto", () => {
    const result = detectCollectedElements();
    expect(result.scannedKeys).toBe(0);
    expect(result.auto).toEqual([]);
    expect(result.known).toHaveLength(DATA_ELEMENT_REGISTRY.length);
    expect(result.known.every((item) => item.detected?.length === 0)).toBe(true);
    expect(Number.isNaN(Date.parse(result.scannedAt))).toBe(false);
    // Każdy znany wpis siedzi w swojej kategorii - i tylko tam.
    const counted = Object.values(result.byCategory).reduce((sum, list) => sum + list.length, 0);
    expect(counted).toBe(DATA_ELEMENT_REGISTRY.length);
  });

  it("klucz z rejestru doklejany jest do SWOJEGO wpisu jako wykryty, a nie opisywany od nowa", () => {
    const registered = DATA_ELEMENT_REGISTRY.find((entry) =>
      entry.match.some((pattern) => !pattern.includes("*")),
    );
    if (!registered) throw new Error("rejestr bez wzorca dosłownego");
    const literal = registered.match.find((pattern) => !pattern.includes("*")) as string;
    localStorage.setItem(literal, "1");
    const result = detectCollectedElements();
    expect(classifyKey(literal)?.name).toBe(registered.name);
    const known = result.known.find((item) => item.name === registered.name);
    expect(known?.detected).toEqual([literal]);
    expect(result.auto.find((item) => item.detected?.includes(literal))).toBeUndefined();
  });

  it("klucz dostawcy zewnętrznego dostaje nazwę i stronę dostawcy; magazyn sesji - termin „Sesja”", () => {
    sessionStorage.setItem("_hjSession_123", "x");
    document.cookie = "_fbp=fb.1.123; path=/";
    const { auto } = detectCollectedElements();
    const hotjar = auto.find((item) => item.detected?.includes("_hjSession_123"));
    expect(hotjar).toMatchObject({
      name: "Hotjar (_hjSession_123)",
      category: "analytics",
      kind: "sessionStorage",
      party_pl: "Hotjar Ltd.",
      ttl_pl: "Sesja",
      ttl_en: "Session",
      auto: true,
    });
    const meta = auto.find((item) => item.detected?.includes("_fbp"));
    expect(meta).toMatchObject({
      category: "marketing",
      kind: "cookie",
      ttl_pl: "Wg dostawcy",
      ttl_en: "Per vendor",
    });
  });

  it("klucz własny bez wpisu opisany po kategorii: opis i termin zgodne z kategorią i magazynem", () => {
    localStorage.setItem("nes.preferences", "{}");
    localStorage.setItem("promoCode", "LATO");
    sessionStorage.setItem("readCount", "3");
    const { auto, byCategory } = detectCollectedElements();
    const byKey = new Map(auto.map((item) => [item.name, item]));

    expect(byKey.get("nes.preferences")).toMatchObject({
      category: "functional",
      kind: "localStorage",
      purpose_pl: "Wykryta automatycznie preferencja interfejsu zapisana lokalnie.",
      purpose_en: "Automatically detected interface preference stored locally.",
      ttl_pl: "Bez limitu",
      ttl_en: "Persistent",
      party_pl: "Platforma (1st party)",
    });
    expect(byKey.get("promoCode")).toMatchObject({
      category: "marketing",
      purpose_pl: "Wykryty automatycznie identyfikator kampanii lub źródła wejścia.",
      purpose_en: "Automatically detected campaign or referral identifier.",
    });
    expect(byKey.get("readCount")).toMatchObject({
      category: "analytics",
      kind: "sessionStorage",
      purpose_pl: "Wykryty automatycznie licznik/zdarzenie użycia interfejsu.",
      purpose_en: "Automatically detected usage counter or interface event.",
      ttl_pl: "Sesja",
    });
    expect(byCategory.functional.map((item) => item.name)).toContain("nes.preferences");
    expect(byCategory.marketing.map((item) => item.name)).toContain("promoCode");
  });

  it("ten sam nieznany klucz w dwóch magazynach jest opisany RAZ, ale liczony przy każdym skanie", () => {
    localStorage.setItem("nes.preferences", "{}");
    sessionStorage.setItem("nes.preferences", "{}");
    const result = detectCollectedElements();
    expect(result.auto.filter((item) => item.name === "nes.preferences")).toHaveLength(1);
    expect(result.scannedKeys).toBe(2);
  });

  it("zablokowany magazyn (wyjątek przy odczycie) nie wywraca skanu", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    sessionStorage.setItem("nes.preferences", "{}");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length(): number {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    });
    try {
      const result = detectCollectedElements();
      // Zablokowany magazyn jest pominięty, a pozostałe nadal skanowane.
      expect(result.scannedKeys).toBe(1);
      expect(result.auto.map((item) => item.kind)).toEqual(["sessionStorage"]);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("REGISTRY_BY_CATEGORY - widok statyczny", () => {
  it("niesie każdy wpis rejestru bez wzorców dopasowania", () => {
    const all = Object.values(REGISTRY_BY_CATEGORY).flat();
    expect(all).toHaveLength(DATA_ELEMENT_REGISTRY.length);
    expect(all.every((item) => !("match" in item))).toBe(true);
  });
});
