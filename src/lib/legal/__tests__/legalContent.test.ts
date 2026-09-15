// Kontrakt warstwy prezentacji dokumentów prawnych: pierwszeństwo wersji
// opublikowanej, odporność na nieznane ikony i braki językowe.
import { describe, it, expect } from "vitest";
import { pickLegalCopy, resolveLegalCopy } from "@/lib/legal/resolve";
import { safeParseLegalContent } from "@/lib/legal/types";
import { LEGAL_ICONS, resolveLegalIcon } from "@/lib/legal/icons";
import { TERMS_CONTENT } from "@/lib/legal/content/terms";
import { PRIVACY_CONTENT } from "@/lib/legal/content/privacy";
import { REFUNDS_CONTENT } from "@/lib/legal/content/refunds";

const custom = {
  pl: {
    eyebrow: "Warunki",
    title: "Nowy regulamin",
    lead: "lead",
    updated: "2026-08-01",
    sections: [{ id: "a", icon: "Mail", heading: "Kontakt", paragraphs: ["x"] }],
  },
  en: {
    eyebrow: "Terms",
    title: "New terms",
    lead: "lead",
    updated: "2026-08-01",
    sections: [{ id: "a", icon: "Mail", heading: "Contact", paragraphs: ["x"] }],
  },
};

describe("legal content baseline", () => {
  it("every baseline section uses a known icon name", () => {
    for (const doc of [TERMS_CONTENT, PRIVACY_CONTENT, REFUNDS_CONTENT]) {
      for (const lang of ["pl", "en"] as const) {
        for (const section of doc[lang].sections) {
          expect(Object.keys(LEGAL_ICONS), `${section.id}/${section.icon}`).toContain(section.icon);
        }
      }
    }
  });

  it("keeps PL and EN section ids in parity", () => {
    for (const doc of [TERMS_CONTENT, PRIVACY_CONTENT, REFUNDS_CONTENT]) {
      expect(doc.pl.sections.map((s) => s.id)).toEqual(doc.en.sections.map((s) => s.id));
    }
  });

  it("validates against the persisted content schema", () => {
    expect(safeParseLegalContent(TERMS_CONTENT)).not.toBeNull();
  });
});

describe("pickLegalCopy", () => {
  it("prefers the published version over the code baseline", () => {
    expect(pickLegalCopy(custom, TERMS_CONTENT, "pl").title).toBe("Nowy regulamin");
  });

  it("falls back to the code baseline when nothing is published", () => {
    expect(pickLegalCopy(null, TERMS_CONTENT, "en").title).toBe(TERMS_CONTENT.en.title);
  });

  it("resolves icon names into components, unknown names get a fallback", () => {
    const resolved = resolveLegalCopy({
      ...custom.pl,
      sections: [{ id: "z", icon: "NotAnIcon", heading: "H" }],
    });
    expect(resolved.sections[0].Icon).toBe(resolveLegalIcon("NotAnIcon"));
  });
});

describe("safeParseLegalContent", () => {
  it("rejects malformed payloads instead of throwing", () => {
    expect(safeParseLegalContent({ pl: {} })).toBeNull();
    expect(safeParseLegalContent(null)).toBeNull();
  });
});
