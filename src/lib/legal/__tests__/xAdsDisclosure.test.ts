import { describe, expect, it } from "vitest";
import { TERMS_CONTENT } from "@/lib/legal/content/terms";
import { PRIVACY_CONTENT } from "@/lib/legal/content/privacy";
import { DATA_PROCESSING_CONTENT } from "@/lib/legal/content/dataProcessing";
import { classifyKey } from "@/lib/cookieBanner/registry";
import { LEGAL_UPDATED, TERMS_UPDATED } from "@/lib/legal/entity";

const text = (doc: typeof TERMS_CONTENT, lang: "pl" | "en") => JSON.stringify(doc[lang].sections);

describe("X Ads disclosure", () => {
  it.each(["pl", "en"] as const)(
    "terms (%s) name the X Ads pixel as marketing-consent only",
    (lang) => {
      const terms = text(TERMS_CONTENT, lang);
      expect(terms).toContain("X Ads");
      expect(terms).toMatch(lang === "pl" ? /zgodzie marketingowej/ : /marketing consent/);
    },
  );

  it.each(["pl", "en"] as const)(
    "privacy (%s) names X Internet Unlimited Company and the opt-out",
    (lang) => {
      const privacy = text(PRIVACY_CONTENT, lang);
      expect(privacy).toContain("X Internet Unlimited Company");
      expect(privacy).toContain("youronlinechoices.eu");
    },
  );

  it.each(["pl", "en"] as const)("data processing (%s) lists X among ad providers", (lang) => {
    expect(text(DATA_PROCESSING_CONTENT, lang)).toMatch(/Google, Meta, LinkedIn, X\)/);
  });

  it("terms carry their own update date without moving the refund policy date", () => {
    expect(TERMS_UPDATED).toBe("2026-11-21");
    expect(LEGAL_UPDATED).toBe("2026-07-30");
  });

  it("the cookie banner files X cookies under marketing", () => {
    expect(classifyKey("_twclid")?.category).toBe("marketing");
    expect(classifyKey("muc_ads")?.category).toBe("marketing");
  });
});
