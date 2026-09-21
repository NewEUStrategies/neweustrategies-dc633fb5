// Kontrakt warstwy prezentacji dokumentów prawnych: pierwszeństwo wersji
// opublikowanej, odporność na nieznane ikony i braki językowe.
import { describe, it, expect } from "vitest";
import { pickLegalCopy, resolveLegalCopy } from "@/lib/legal/resolve";
import { safeParseLegalContent } from "@/lib/legal/types";
import { LEGAL_ICONS, resolveLegalIcon } from "@/lib/legal/icons";
import { LEGAL_DOC_LIST, LEGAL_DOCS } from "@/lib/legal/registry";
import { LEGAL_DOC_KEYS } from "@/lib/legal/types";
// TERMS_CONTENT zostaje pod ręką dla dowodów o pierwszeństwie wersji z bazy;
// pozostałe dokumenty test bierze z rejestru (ALL_BASELINES), a nie z importów.
import { TERMS_CONTENT } from "@/lib/legal/content/terms";

// Bramka chodzi po CAŁYM rejestrze, nie po trzech wymienionych dokumentach.
// Wpisanie nazw wprost było powodem, dla którego nowy dokument prawny mógł
// wejść do repo z nieznaną ikoną albo z rozjechanymi sekcjami PL/EN - test
// zielony, bo tego dokumentu w ogóle nie sprawdzał.
const ALL_BASELINES = LEGAL_DOC_LIST.map((d) => [d.key, d.baseline] as const);

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
    for (const [key, doc] of ALL_BASELINES) {
      for (const lang of ["pl", "en"] as const) {
        for (const section of doc[lang].sections) {
          expect(
            Object.keys(LEGAL_ICONS),
            `${key}/${lang}/${section.id} -> ${section.icon}`,
          ).toContain(section.icon);
        }
      }
    }
  });

  it("keeps PL and EN section ids in parity", () => {
    for (const [key, doc] of ALL_BASELINES) {
      expect(
        doc.pl.sections.map((s) => s.id),
        key,
      ).toEqual(doc.en.sections.map((s) => s.id));
    }
  });

  it("validates against the persisted content schema", () => {
    for (const [key, doc] of ALL_BASELINES) {
      expect(safeParseLegalContent(doc), key).not.toBeNull();
    }
  });

  it("every declared doc key has a registry entry", () => {
    for (const key of LEGAL_DOC_KEYS) {
      expect(LEGAL_DOCS[key], key).toBeDefined();
      expect(LEGAL_DOCS[key].key, key).toBe(key);
    }
    expect(LEGAL_DOC_LIST).toHaveLength(LEGAL_DOC_KEYS.length);
  });

  it("every document is published under a unique, slug-shaped path", () => {
    const paths = LEGAL_DOC_LIST.map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path, path).toMatch(/^\/[a-z0-9-]+$/);
  });

  it("no section id repeats inside one language of a document", () => {
    for (const [key, doc] of ALL_BASELINES) {
      for (const lang of ["pl", "en"] as const) {
        const ids = doc[lang].sections.map((s) => s.id);
        expect(new Set(ids).size, `${key}/${lang}`).toBe(ids.length);
      }
    }
  });

  it("both languages carry a title, a lead and at least one section", () => {
    for (const [key, doc] of ALL_BASELINES) {
      for (const lang of ["pl", "en"] as const) {
        expect(doc[lang].title.trim(), `${key}/${lang}`).not.toBe("");
        expect(doc[lang].lead.trim(), `${key}/${lang}`).not.toBe("");
        expect(doc[lang].sections.length, `${key}/${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it("PL and EN differ - a language is never a copy of the other", () => {
    // Sklejony brief po polsku w wersji EN przechodziłby parzystość sekcji
    // i schemat. Tytuł jest najtańszym miejscem, w którym to widać.
    for (const [key, doc] of ALL_BASELINES) {
      expect(doc.en.title, key).not.toBe(doc.pl.title);
    }
  });

  it("every section carries renderable body copy", () => {
    for (const [key, doc] of ALL_BASELINES) {
      for (const lang of ["pl", "en"] as const) {
        for (const s of doc[lang].sections) {
          const body = (s.paragraphs?.length ?? 0) + (s.bullets?.length ?? 0);
          expect(body, `${key}/${lang}/${s.id}`).toBeGreaterThan(0);
        }
      }
    }
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
