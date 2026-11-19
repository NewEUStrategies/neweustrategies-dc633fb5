// Ikony marek - PIERWSZEŃSTWO BIBLIOTEKI IKON (decyzja właściciela, 19.11.2026).
//
// Ikona wgrana w /admin/icons zawsze wygrywa z glifem marki w kodzie. Glify
// marek (`@/lib/icons/brandIcons`, `@/components/atoms/XIcon`, eksporty marek
// shimu) są wyłącznie ZAPASEM podawanym do `BrandIcon` jako `fallback`.
// Element JSX `<Facebook />` itd. rysowałby glif z pominięciem biblioteki,
// więc ten plik pilnuje, żeby żaden moduł aplikacji go nie wstawił.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "src");
const BRAND_NAMES = new Set(["Facebook", "Linkedin", "Twitter", "Instagram", "Youtube", "Github"]);
const BRAND_SOURCES: Record<string, ReadonlySet<string> | "all"> = {
  "@/lib/icons/brandIcons": "all",
  "@/components/atoms/XIcon": "all",
  "@/lib/lucide-shim": BRAND_NAMES,
};
/** Moduły, które definiują glify albo sam atom pierwszeństwa. */
const EXEMPT = new Set([
  "lib/icons/brandIcons.ts",
  "lib/lucide-shim.tsx",
  "lib/icons/DynamicIcon.tsx",
  "components/atoms/BrandIcon.tsx",
  "components/atoms/XIcon.tsx",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" || entry === "test" ? [] : sourceFiles(path);
    }
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

/** Lokalne nazwy glifów marek zaimportowanych w pliku (z aliasami `A as B`). */
function brandLocals(source: string): string[] {
  const locals: string[] = [];
  const importRe = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;
  for (const match of source.matchAll(importRe)) {
    const allowed = BRAND_SOURCES[match[2]];
    if (!allowed) continue;
    for (const raw of match[1].split(",")) {
      const spec = raw.trim().replace(/^type\s+/, "");
      if (!spec) continue;
      const [imported, local = imported] = spec.split(/\s+as\s+/).map((part) => part.trim());
      if (allowed === "all" || allowed.has(imported)) locals.push(local);
    }
  }
  return locals;
}

describe("ikony marek - biblioteka ikon ma pierwszeństwo", () => {
  it("żaden moduł nie rysuje glifu marki bezpośrednio, tylko przez BrandIcon", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of sourceFiles(ROOT)) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (EXEMPT.has(rel)) continue;
      const source = readFileSync(file, "utf8");
      const locals = brandLocals(source);
      if (locals.length === 0) continue;
      scanned += 1;
      for (const local of locals) {
        if (new RegExp(`<${local}\\b`).test(source)) offenders.push(`${rel}: <${local}>`);
      }
    }
    expect(scanned).toBeGreaterThan(15);
    expect(offenders).toEqual([]);
  });

  it("wykrywa bezpośredni glif marki także pod aliasem importu", () => {
    const source = `import { Linkedin as LI } from "@/lib/icons/brandIcons";\nconst a = <LI />;`;
    expect(brandLocals(source)).toEqual(["LI"]);
    expect(brandLocals(`import { Mail, Facebook } from "@/lib/lucide-shim";`)).toEqual([
      "Facebook",
    ]);
  });
});
