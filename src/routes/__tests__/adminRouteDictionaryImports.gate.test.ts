// Bramka PRZYCZYNY: plik trasy panelu (`src/routes/admin*.tsx`) nie importuje
// słownika `@/lib/i18n-*` efektem ubocznym (`import "@/lib/i18n-…";`).
//
// DLACZEGO. Splitter TanStacka wynosi do chunku trasy wyłącznie `component`
// i to, do czego komponent się ODWOŁUJE. Import bez referencji zostaje
// w niedzielonej części pliku (`createFileRoute` + opcje), a ta jedzie
// w chunku wejściowym `app-initial` - czyli w bootcie KAŻDEJ strony
// publicznej. 2026-10-17 tak właśnie siedział tam `i18n-admin-users`
// (15,3 kB źródeł) przez jedną linię w `admin.users.invitations.tsx`.
// Ten sam wzorzec opisuje wpis z 2026-08-18 w `scripts/check-entry-purity.ts`.
//
// `check:entry-purity` łapie skutek wyłącznie dla słowników z listy
// `HEAVY_DICTIONARIES` i dopiero po buildzie (na mainie). Ta bramka łapie
// przyczynę dla KAŻDEGO słownika i każdej trasy panelu, bez buildu.
// Naprawa zawsze ta sama: `import { ensureI18n as ensureXI18n } from …`
// i wywołanie w komponencie trasy (wzorzec: `admin.users.index.tsx`).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = "src/routes";

/** Import samym efektem ubocznym: `import "@/lib/i18n-x";` (bez `from`). */
const SIDE_EFFECT_DICTIONARY =
  /^import\s+["'](@\/lib\/i18n-[\w-]+|\.\.?\/[^"']*i18n-[\w-]+)["'];?/gm;

function sideEffectDictionaryImports(source: string): string[] {
  return [...source.matchAll(SIDE_EFFECT_DICTIONARY)].map((match) => match[1]);
}

const ADMIN_ROUTE_FILES = readdirSync(ROUTES_DIR)
  .filter((name) => /^admin[._-].*\.tsx$|^admin\.tsx$/.test(name))
  .sort();

describe("trasy panelu nie wciągają słowników do chunku wejściowego", () => {
  it("wzorzec rozpoznaje import efektem ubocznym, a pomija import nazwany (kontrola narzędzia)", () => {
    expect(
      sideEffectDictionaryImports(
        [
          'import "@/lib/i18n-admin-users";',
          'import { ensureI18n } from "@/lib/i18n-admin-users";',
          'import "@/lib/adminToasts";',
          "import '@/lib/i18n-admin-media'",
        ].join("\n"),
      ),
    ).toEqual(["@/lib/i18n-admin-users", "@/lib/i18n-admin-media"]);
  });

  it("skan obejmuje trasy panelu (kontrola zasięgu)", () => {
    expect(ADMIN_ROUTE_FILES.length).toBeGreaterThan(100);
    expect(ADMIN_ROUTE_FILES).toContain("admin.users.invitations.tsx");
  });

  it("żaden plik trasy panelu nie importuje słownika efektem ubocznym", () => {
    const offenders = ADMIN_ROUTE_FILES.flatMap((name) =>
      sideEffectDictionaryImports(readFileSync(join(ROUTES_DIR, name), "utf8")).map(
        (spec) => `${name}: import "${spec}"`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
