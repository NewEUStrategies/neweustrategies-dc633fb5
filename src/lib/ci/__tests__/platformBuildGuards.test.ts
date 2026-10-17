// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adminCssPlugin } from "../../../../scripts/lib/adminCssPlugin";
import { CHUNK_PRIORITY, CLIENT_CHUNK_GROUPS } from "../../../../scripts/lib/clientChunkGroups";
import { minifySync, type Plugin, type ResolvedConfig } from "vite";
const root = process.cwd();
const scratch: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "nes-build-guard-"));
  scratch.push(dir);
  return dir;
}
function put(dir: string, path: string, content: string) {
  const dest = join(dir, path);
  mkdirSync(resolve(dest, ".."), { recursive: true });
  writeFileSync(dest, content);
}
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function transform(plugin: Plugin, code: string, id: string): string | null {
  const hook = plugin.transform;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  return (handler as (code: string, id: string) => string | null)(code, id);
}
describe("admin stylesheet isolation", () => {
  it("uses Tailwind's scanner to emit only admin utilities, excluding tests and public renderer classes", () => {
    const dir = temp();
    put(dir, "src/public.tsx", '<main className="px-4 text-red-500" />');
    put(dir, "src/components/builder/PublicRenderer.tsx", '<div className="grid-cols-7" />');
    put(dir, "src/routes/admin.example.tsx", '<div className="px-4 bg-fuchsia-950 grid-cols-7" />');
    put(dir, "src/components/admin/Editor.tsx", '<div className="rotate-12" />');
    put(dir, "src/routes/__tests__/admin.test.tsx", '<div className="bg-lime-900" />');
    put(dir, "src/test/harness.tsx", '<div className="bg-orange-900" />');
    const plugin = adminCssPlugin();
    (plugin.configResolved as (config: ResolvedConfig) => void)({ root: dir } as ResolvedConfig);
    const result = transform(
      plugin,
      '@source inline("__NES_ADMIN_UTILITIES__");',
      join(dir, "src/admin-styles.css") + "?url",
    )!;
    expect(result).toContain("bg-fuchsia-950");
    expect(result).toContain("rotate-12");
    expect(result).not.toContain("px-4");
    expect(result).not.toContain("grid-cols-7");
    expect(result).not.toContain("bg-lime-900");
    expect(result).not.toContain("bg-orange-900");
    expect(result).not.toContain("__NES_ADMIN_UTILITIES__");
    expect(transform(plugin, "public CSS", join(dir, "src/styles.css"))).toBeNull();
  });
  it("keeps the admin sheet owned by the admin route and the public renderer in the shared source set", () => {
    const paths = execFileSync("git", ["ls-files", "src"], { cwd: root, encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(
        (path) => /\.tsx?$/.test(path) && !/(__tests__|\.test\.|\.spec\.|src\/test\/)/.test(path),
      );
    const owners = paths.filter((path) =>
      /(?:from\s*|import\s*\(?\s*)["'][^"']*admin-styles\.css(?:\?url)?["']/.test(
        readFileSync(resolve(root, path), "utf8"),
      ),
    );
    expect(owners).toEqual(["src/routes/admin.tsx"]);
    const shared = readFileSync(resolve(root, "src/styles.css"), "utf8");
    expect(shared).toContain('@source not "../src/components/admin');
    expect(shared).not.toMatch(/@source not ["'][^"']*(?:components\/builder|lib\/builder)/);
  });
});

function fixture() {
  const dir = temp();
  put(
    dir,
    "assets/index-ABCabc12.js",
    'import "./vendor-react-AbCd1234.js"; import("./lazy-ZyxW4321.js");',
  );
  put(dir, "assets/vendor-react-AbCd1234.js", "export const version=19;");
  put(dir, "assets/vendor-tw-merge-EfGh5678.js", "export const merge=()=>null;");
  put(dir, "assets/lazy-ZyxW4321.js", "export const lazy=true;");
  put(dir, "assets/styles-AbCd1234.css", "body{color:black}");
  return dir;
}
function runGate(
  script: string,
  dir: string,
  flags: string[] = [],
  env: Record<string, string> = {},
) {
  const result = spawnSync(process.env.BUN_EXECUTABLE ?? "bun", [resolve(root, script), ...flags], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "false",
      CLIENT_DIR: join(dir, "assets"),
      ENTRY_CHUNKS: "index-ABCabc12.js",
      ...env,
    },
  });
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
}
function gate(dir: string, flags: string[] = [], env: Record<string, string> = {}) {
  return runGate("scripts/check-bundle-size.ts", dir, flags, env);
}
const entropy = () =>
  Array.from({ length: 1700 }, (_, i) => createHash("sha256").update(String(i)).digest("hex")).join(
    "",
  );
describe("bundle gate on emitted artifact fixtures", () => {
  it("rejects a startup-only regression even when total/public/chunk budgets still pass", () => {
    const dir = fixture();
    expect(gate(dir, [], { MAX_BOOT_KB: "1" }).status).toBe(0);
    put(dir, "assets/vendor-react-AbCd1234.js", `export const data="${entropy()}";`);
    const result = gate(dir, [], { MAX_BOOT_KB: "1" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("boot closure");
    expect(result.output).not.toMatch(/exceeded: (?:public|overall|largest)/);
  });
  it("counts unknown stylesheets as public and cannot hide them behind the total CSS budget", () => {
    const dir = fixture();
    put(dir, "assets/future-style-AbCd1234.css", `/*${entropy()}*/`);
    const result = gate(dir, [], { MAX_PUBLIC_CSS_KB: "1" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("public css");
    expect(result.output).not.toContain("css total ");
  });
  it("cannot bless a failing artifact by updating its baseline", () => {
    const dir = fixture();
    put(dir, "assets/vendor-react-AbCd1234.js", `export const data="${entropy()}";`);
    expect(gate(dir, ["--update-baseline"], { MAX_BOOT_KB: "1" }).status).toBe(1);
    expect(existsSync(join(dir, "reports/bundle-baseline.json"))).toBe(false);
  });
  it("writes library-specific vendor buckets and separates CSS from JavaScript", () => {
    const dir = fixture();
    for (const name of ["vendor-react-AbCd1234.js", "vendor-tw-merge-EfGh5678.js"])
      put(dir, `assets/${name}`, `export const data="${entropy().slice(0, 6000)}";`);
    const result = gate(dir, ["--update-baseline"]);
    expect(result.status, result.output).toBe(0);
    const baseline = JSON.parse(readFileSync(join(dir, "reports/bundle-baseline.json"), "utf8"));
    expect(baseline.bucketConvention).toBe(3);
    expect(baseline.chunks).toHaveProperty("vendor-react");
    expect(baseline.chunks).toHaveProperty("vendor-tw-merge");
    expect(baseline.chunks).not.toHaveProperty("vendor");
    expect(baseline.totals.publicCss).toBeDefined();
  });
  it("reads a Rollup-era baseline (convention 2) with current bucket names plus a note", () => {
    // Konwencja 3 (Vite 8 / Rolldown) nie zmienia `stableChunkName()`, tylko nazwy nadawane
    // przez bundler - baseline 2 nie może więc wpaść w łapczywy tryb konwencji 1 (`vendor`).
    const dir = fixture();
    put(
      dir,
      "reports/bundle-baseline.json",
      JSON.stringify({
        measuredAt: "2026-10-01T00:00:00.000Z",
        commit: "rollup",
        bucketConvention: 2,
        totals: { public: 0, overall: 0, chunk: 0 },
        chunks: { index: 0.1, "vendor-react": 0.1, "vendor-tw-merge": 0.1, lazy: 0.1 },
      }),
    );
    put(dir, "assets/vendor-react-AbCd1234.js", `export const data="${entropy()}";`);
    const result = gate(dir, [], { MAX_BOOT_KB: "1" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("baseline z epoki Rollupa");
    expect(result.output).not.toContain("STARĄ konwencją");
    expect(result.output).toMatch(/ KB {2}vendor-react {2}\(/);
  });
  it("ignores attempts to relax frozen CI thresholds", () => {
    const dir = fixture();
    const result = gate(dir, [], { CI: "true", MAX_BOOT_KB: "99999", MAX_PUBLIC_CSS_KB: "99999" });
    expect(result.status).toBe(0);
    expect(result.output).toContain("ZIGNOROWANE");
    // Podniesiona wartość NIE MOŻE dojść do raportu...
    expect(result.output).not.toContain("99999 KB");
    // ...a próg, który bramka OGŁASZA jako zamrożony, musi być DOKŁADNIE tym,
    // którego używa w raporcie. Oba czytamy z wyjścia, zamiast wpisywać
    // literałem: progi w `check-bundle-size.ts` przesuwają się z pomiarem
    // (kronika przy `THRESHOLDS`), więc literał oblewałby ten test za zmianę,
    // której on wcale nie pilnuje - a pilnuje tego, że zmienna środowiskowa
    // nie ma wpływu. Zmierzone: tak właśnie padł przy publicCss 74 -> 75.
    for (const name of ["MAX_BOOT_KB", "MAX_PUBLIC_CSS_KB"]) {
      const frozen = new RegExp(`${name}=99999 ZIGNOROWANE[^(]*\\((\\d+) KB\\)`).exec(
        result.output,
      );
      expect(frozen, `brak noty o zamrożonym progu ${name}`).not.toBeNull();
      expect(result.output).toContain(`budget ≤ ${frozen?.[1]} KB`);
    }
  });
});

// Korzeń bootu bez `ENTRY_CHUNKS`, czyli tak, jak bramki pracują w CI: z mapy `nesBootManifest`
// w artefakcie serwera. Na Vite 8 worker minifikuje Oxc (wartości w backtickach), a Nitro na
// Rolldownie sam nadaje nazwy chunkom, więc moduł mapy nie musi leżeć w katalogu głównym
// `.output/server`. `node_modules` artefaktu to kopie zależności runtime'u Nitro - skan ma je
// pomijać. Same wzorce wobec wyjścia Oxc: chunkGateRegexes.test.ts; tu przebieg CAŁEJ bramki.
describe("boot root from the server artifact (Oxc-minified, nested Nitro chunks)", () => {
  /** Moduł mapy bootu (`scripts/lib/bootAfterLcpPlugin.ts`) po minifikacji Oxc. */
  const bootManifestModule = (entry: string) =>
    minifySync(
      "manifest.mjs",
      `export const nesBootManifest = ${JSON.stringify({
        entry: `/assets/${entry}`,
        rootPreloads: [`/assets/${entry}`],
        routePreloads: {},
      })};\n`,
    ).code;
  function serverFixture() {
    const dir = fixture();
    const manifest = bootManifestModule("index-ABCabc12.js");
    expect(manifest).toContain("entry:`/assets/index-ABCabc12.js`");
    put(dir, ".output/server/_ssr/start-manifest-AbCd1234.mjs", manifest);
    // Wabik: gdyby skan wszedł do `node_modules`, korzeniem stałby się ciężki chunk spoza grafu
    // wejścia.
    put(dir, "assets/heavy-QwEr5678.js", `export const data="${entropy()}";`);
    put(
      dir,
      ".output/server/node_modules/decoy/index.mjs",
      bootManifestModule("heavy-QwEr5678.js"),
    );
    // Chunki rodzin leniwych pod `app-initial` - artefakt aplikacji ma je zawsze; ich BRAK
    // znaczy, że `app-initial` wciągnął rodzinę do bootu (check:entry-purity).
    for (const family of LAZY_FAMILIES) put(dir, `assets/${family}-Fam0001x.js`, "export {};");
    // `vendor-tw-merge` to grupa `boot(...)`: listy preloadu `import()` ją pomijają, więc w
    // artefakcie aplikacji wejście importuje ją statycznie (check:entry-purity pilnuje).
    put(dir, "assets/index-ABCabc12.js", BOOT_ENTRY);
    return dir;
  }
  const BOOT_ENTRY =
    'import "./vendor-react-AbCd1234.js";import "./vendor-tw-merge-EfGh5678.js";' +
    'import("./lazy-ZyxW4321.js");';
  const LAZY_FAMILIES = CLIENT_CHUNK_GROUPS.filter(
    (group) => (group.priority ?? 0) < CHUNK_PRIORITY.initial,
  ).map((group) => group.debugName!);
  const noOverride = { ENTRY_CHUNKS: "" };

  it("check:bundle finds the nested manifest and skips the artifact's node_modules", () => {
    const dir = serverFixture();
    const found = gate(dir, [], { ...noOverride, MAX_BOOT_KB: "1" });
    expect(found.status, found.output).toBe(0);
    rmSync(join(dir, ".output/server/_ssr"), { recursive: true });
    const missing = gate(dir, [], noOverride);
    expect(missing.status).toBe(1);
    expect(missing.output).toContain("Nie udalo sie ustalic chunku startowego");
  });

  it("check:entry-purity uses the same root and rejects a pinned lazy chunk in the boot closure", () => {
    const dir = serverFixture();
    const purity = () => runGate("scripts/check-entry-purity.ts", dir, [], noOverride);
    const clean = purity();
    expect(clean.status, clean.output).toBe(0);
    expect(clean.output).toContain("Sciezka bootowania: index-ABCabc12.js -> 3 chunkow");
    expect(clean.output).toContain("listy preloadu:    2 chunkow bootu pominietych");
    // `legal-links` jest leniwy z definicji (grupa w scripts/lib/clientChunkGroups.ts): statyczna
    // krawędź z wejścia to błąd priorytetu grupy albo zgubiony `import()`.
    put(dir, "assets/legal-links-LgLn1234.js", "export default 1;");
    put(
      dir,
      "assets/index-ABCabc12.js",
      'import "./vendor-react-AbCd1234.js";import"./legal-links-LgLn1234.js";import(`./lazy-ZyxW4321.js`);',
    );
    const dirty = purity();
    expect(dirty.status).toBe(1);
    expect(dirty.output).toContain("legal-links (chunk spoza bootu)");
  });

  it("check:entry-purity: brak chunku rodziny leniwej = rodzina wciągnięta do `app-initial`", () => {
    // Rodzina pod `app-initial` nigdy nie wchodzi do domknięcia wejścia jako własny chunk -
    // `app-initial` zabiera jej moduły wcześniej, a chunk rodziny znika.
    const dir = serverFixture();
    expect(LAZY_FAMILIES).toEqual(expect.arrayContaining(["post-card", "sanitize"]));
    rmSync(join(dir, "assets/post-card-Fam0001x.js"));
    const absorbed = runGate("scripts/check-entry-purity.ts", dir, [], noOverride);
    expect(absorbed.status).toBe(1);
    expect(absorbed.output).toContain("post-card (rodzina leniwa bez chunku)");
    expect(absorbed.output).not.toContain("sanitize (rodzina leniwa bez chunku)");
  });

  it("check:entry-purity: chunk pomijany w listach preloadu MUSI być w domknięciu wejścia", () => {
    // Grupa `boot(...)` (scripts/lib/clientChunkGroups.ts), która przestała być statycznie
    // osiągalna z wejścia: listy `import()` nadal by ją pomijały (scripts/lib/clientModulePreload.ts),
    // więc leniwe chunki pobierałyby ją kaskadą. Sam wzrost bootu tego nie pokaże - to brak.
    const dir = serverFixture();
    put(
      dir,
      "assets/index-ABCabc12.js",
      'import "./vendor-react-AbCd1234.js";import("./lazy-ZyxW4321.js");',
    );
    const drift = runGate("scripts/check-entry-purity.ts", dir, [], noOverride);
    expect(drift.status).toBe(1);
    expect(drift.output).toContain("pomijaja chunki, ktorych NIE MA w domknieciu wejscia");
    expect(drift.output).toContain("• vendor-tw-merge-EfGh5678.js");
    expect(drift.output).not.toContain("• vendor-react-");
    // Chunk spoza grup `boot(...)` (np. leniwy `lazy`) poza domknięciem to norma, nie dryf.
    expect(drift.output).not.toContain("• lazy-");
  });
});
