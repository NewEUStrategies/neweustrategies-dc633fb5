import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { CODE_PAGES, codePage, codePageLabel, isCodePage } from "@/lib/admin/codePages";

describe("rejestr stron renderowanych z kodu", () => {
  it("nie zawiera duplikatów slugów", () => {
    const slugs = CODE_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("każdy slug ma odpowiadającą trasę React w src/routes", () => {
    for (const page of CODE_PAGES) {
      // Trasa liściowa może być plikiem płaskim (`pricing.tsx`) albo indeksem
      // rodziny tras (`club.index.tsx`, gdy istnieją też `club.$clubSlug.*`).
      const candidates = [`src/routes/${page.slug}.tsx`, `src/routes/${page.slug}.index.tsx`];
      const found = candidates.some((rel) => existsSync(resolve(process.cwd(), rel)));
      expect(found, `brak trasy dla /${page.slug}`).toBe(true);
    }
  });

  it("ścieżka publiczna odpowiada slugowi", () => {
    for (const page of CODE_PAGES) {
      expect(page.path).toBe(`/${page.slug}`);
    }
  });

  it("rozpoznaje /pricing jako stronę z kodu, a zwykły slug nie", () => {
    expect(isCodePage("pricing")).toBe(true);
    expect(isCodePage("o-nas")).toBe(false);
    expect(isCodePage(null)).toBe(false);
  });

  it("zwraca etykiety PL i EN", () => {
    const def = codePage("pricing");
    expect(def).not.toBeNull();
    if (!def) return;
    expect(codePageLabel(def, "pl")).toContain("Cennik");
    expect(codePageLabel(def, "en")).toContain("Pricing");
  });
});
