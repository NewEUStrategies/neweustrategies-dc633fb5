/**
 * Gate: publiczny CSS nie zawiera selektora `:has()`.
 *
 * Pomiar z 2026-10-02 (docs/performance/2026-10-02-pagespeed-przyczyny.md):
 * przy 38 regułach `:has()` jedno wymuszone pełne przeliczenie stylu strony
 * głównej kosztowało ~35 ms (desktop, 1x CPU, 1260 elementów), a po usunięciu
 * WSZYSTKICH tych reguł 0,5 ms. Usunięcie dowolnej pojedynczej grupy nic nie
 * dawało - koszt włącza sama obecność `:has()` w dokumencie (Blink przełącza
 * wtedy unieważnianie stylu na tryb świadomy `:has()`). Przy 4x CPU telefonu
 * to ~300 ms na KAŻDE z kilkunastu pełnych przeliczeń po hydratacji - ponad
 * połowa czasu „Style & Layout" raportowanego przez Lighthouse.
 *
 * Test czyta źródła, a nie artefakt: Tailwind składa klasy z każdego pliku TSX
 * w jeden arkusz, więc jedno `has-[:focus]:` w komponencie leniwym ląduje w
 * publicznym `styles.css` tak samo jak reguła napisana ręcznie. Panel admina
 * (`src/components/admin/**`, `src/routes/admin*`, `admin-styles.css`) jest
 * wyłączony ze skanowania Tailwinda i ma własny arkusz - dlatego jest tu
 * pominięty. Komentarze są usuwane przed dopasowaniem.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = process.cwd();

const SKIP_DIRS = new Set(["__tests__", "__snapshots__", "node_modules"]);
const ADMIN_PATHS = [/^src\/components\/admin\//, /^src\/routes\/admin/, /^src\/lib\/admin\//];
const PUBLIC_SOURCE = /\.(css|ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
}

/** Usuwa komentarze blokowe (CSS/TS) i liniowe (TS), żeby liczyć tylko kod. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function publicSources(): string[] {
  const files: string[] = [];
  walk(resolve(ROOT, "src"), files);
  return files
    .map((f) => relative(ROOT, f))
    .filter((f) => PUBLIC_SOURCE.test(f) && !TEST_FILE.test(f))
    .filter((f) => !ADMIN_PATHS.some((re) => re.test(f)))
    .filter((f) => !f.endsWith("admin-styles.css"))
    .filter((f) => f !== "src/lib/ci/__tests__/noHasSelectors.test.ts");
}

describe("publiczny CSS bez :has()", () => {
  const offenders: string[] = [];
  for (const file of publicSources()) {
    const code = stripComments(readFileSync(resolve(ROOT, file), "utf8"));
    // Reguła CSS, klasa Tailwind `has-*`/`group-has-*`/`peer-has-*` albo
    // arbitralny wariant `[&:has(...)]` - każda z nich trafia do arkusza.
    const hits = code.match(
      /:has\(|(^|[\s"'`])(group-|peer-)?has-(\[|focus|checked|disabled|hover|active)/g,
    );
    if (hits) offenders.push(`${file} (${hits.length})`);
  }

  it("żadne źródło publiczne nie wprowadza selektora :has()", () => {
    expect(offenders).toEqual([]);
  });

  it("skanowanie obejmuje arkusz główny i komponenty publiczne", () => {
    const files = publicSources();
    expect(files).toContain("src/styles.css");
    expect(files.some((f) => f.startsWith("src/components/builder/"))).toBe(true);
    expect(files.some((f) => f.startsWith("src/components/admin/"))).toBe(false);
  });
});
