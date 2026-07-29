// Automatyczny check SEO w pipeline: kontrakt <head> egzekwowany testem, żeby
// te same findingi (brak og:image, og:title, viewport, lang) nie wracały.
// Test jest czysto statyczny - nie potrzebuje przeglądarki ani SSR, więc działa
// jako blokujący gate w CI (bun run test:coverage).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildContentHead, buildRootHead, SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";

const ROUTES_DIR = join(process.cwd(), "src/routes");

function metaValue(
  meta: Array<Record<string, string>>,
  key: "name" | "property" | "title",
  value?: string,
): string | undefined {
  if (key === "title") return meta.find((m) => "title" in m)?.title;
  return meta.find((m) => m[key] === value)?.content;
}

describe("root head contract", () => {
  for (const lang of ["pl", "en"] as const) {
    it(`emits viewport, charset, title, description and absolute og:image (${lang})`, () => {
      const meta = buildRootHead(lang);
      expect(metaValue(meta, "name", "viewport")).toContain("width=device-width");
      expect(meta.some((m) => "charSet" in m)).toBe(true);
      expect(metaValue(meta, "title")).toBeTruthy();
      expect(metaValue(meta, "name", "description")?.length).toBeGreaterThan(50);
      const og = metaValue(meta, "property", "og:image");
      expect(og?.startsWith("https://")).toBe(true);
      expect(og).toContain(SITE_CANONICAL_ORIGIN);
      expect(metaValue(meta, "name", "twitter:card")).toBe("summary_large_image");
    });
  }

  it("never ships a Lovable placeholder title or description", () => {
    for (const lang of ["pl", "en"] as const) {
      const meta = buildRootHead(lang);
      const text = JSON.stringify(meta).toLowerCase();
      expect(text).not.toContain("lovable app");
      expect(text).not.toContain("lovable generated project");
    }
  });
});

describe("content head contract", () => {
  const head = buildContentHead({
    url: "https://neweuropeanstrategies.com/qa/sesja",
    lang: "pl",
    type: "article",
    title: "Sesja Q&A",
    description: "Opis sesji Q&A dla testu kontraktu SEO.",
  });

  it("emits og:title, og:description, og:url and an absolute og:image", () => {
    expect(metaValue(head.meta, "property", "og:title")).toBe("Sesja Q&A");
    expect(metaValue(head.meta, "property", "og:description")).toBeTruthy();
    expect(metaValue(head.meta, "property", "og:url")).toBe(
      "https://neweuropeanstrategies.com/qa/sesja",
    );
    expect(metaValue(head.meta, "property", "og:image")?.startsWith("https://")).toBe(true);
    expect(metaValue(head.meta, "name", "twitter:image")?.startsWith("https://")).toBe(true);
  });

  it("self-references the canonical and advertises both language alternates", () => {
    const canonical = head.links.find((l) => l.rel === "canonical")?.href;
    expect(canonical).toBe("https://neweuropeanstrategies.com/qa/sesja");
    const alts = head.links.filter((l) => l.rel === "alternate" && l.hrefLang);
    expect(alts.map((a) => a.hrefLang).sort()).toEqual(["en", "pl", "x-default"]);
    expect(alts.find((a) => a.hrefLang === "en")?.href).toBe(
      "https://neweuropeanstrategies.com/en/qa/sesja",
    );
    expect(alts.find((a) => a.hrefLang === "pl")?.href).toBe(
      "https://neweuropeanstrategies.com/qa/sesja",
    );
  });

  it("keeps hreflang consistent when the EN URL is rendered", () => {
    const en = buildContentHead({
      url: "https://neweuropeanstrategies.com/en/qa/sesja",
      lang: "en",
      type: "article",
      title: "Q&A session",
      description: "Q&A session description for the SEO contract test.",
    });
    const alts = en.links.filter((l) => l.rel === "alternate" && l.hrefLang);
    expect(alts.find((a) => a.hrefLang === "x-default")?.href).toBe(
      "https://neweuropeanstrategies.com/qa/sesja",
    );
  });

  it("drops the hreflang cluster when the canonical points elsewhere", () => {
    const overridden = buildContentHead({
      url: "https://neweuropeanstrategies.com/qa/sesja?page=2",
      lang: "pl",
      type: "article",
      title: "Sesja Q&A",
      description: "Opis.",
      canonicalOverride: "https://neweuropeanstrategies.com/qa/sesja",
    });
    expect(overridden.links.some((l) => l.hrefLang)).toBe(false);
  });
});

describe("public routes declare their own head()", () => {
  // Publiczne trasy treściowe muszą mieć własne head() - brak oznacza dziedziczenie
  // brandowego fallbacku i duplikat tytułu/opisu w SERP.
  const REQUIRED = [
    "index.tsx",
    "qa.tsx",
    "qa.$slug.tsx",
    "blog.index.tsx",
    "category.$slug.tsx",
    "tag.$slug.tsx",
    "post.$slug.tsx",
    "programs.index.tsx",
    "glossary.tsx",
  ];

  for (const file of REQUIRED) {
    it(`${file} defines head()`, () => {
      const src = readFileSync(join(ROUTES_DIR, file), "utf8");
      expect(src).toMatch(/head:\s*(\(|async)/);
    });
  }

  it("no public route hardcodes a lovable.app absolute URL in head metadata", () => {
    const offenders = readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith(".tsx") && !f.startsWith("admin."))
      .filter((f) => /https?:\/\/[^"'\s]*lovable(project)?\.(app|com)/.test(
        readFileSync(join(ROUTES_DIR, f), "utf8"),
      ));
    expect(offenders).toEqual([]);
  });
});
