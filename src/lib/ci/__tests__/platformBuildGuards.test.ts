// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { adminCssPlugin } from "../../../../scripts/lib/adminCssPlugin";
import type { Plugin, ResolvedConfig } from "vite";
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
function gate(dir: string, flags: string[] = [], env: Record<string, string> = {}) {
  const result = spawnSync(
    process.env.BUN_EXECUTABLE ?? "bun",
    [resolve(root, "scripts/check-bundle-size.ts"), ...flags],
    {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "false",
        CLIENT_DIR: join(dir, "assets"),
        ENTRY_CHUNKS: "index-ABCabc12.js",
        ...env,
      },
    },
  );
  if (result.error) throw result.error;
  return { status: result.status, output: result.stdout + result.stderr };
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
    expect(gate(dir, ["--update-baseline"]).status).toBe(0);
    const baseline = JSON.parse(readFileSync(join(dir, "reports/bundle-baseline.json"), "utf8"));
    expect(baseline.bucketConvention).toBe(2);
    expect(baseline.chunks).toHaveProperty("vendor-react");
    expect(baseline.chunks).toHaveProperty("vendor-tw-merge");
    expect(baseline.chunks).not.toHaveProperty("vendor");
    expect(baseline.totals.publicCss).toBeDefined();
  });
  it("ignores attempts to relax frozen CI thresholds", () => {
    const dir = fixture();
    const result = gate(dir, [], { CI: "true", MAX_BOOT_KB: "99999", MAX_PUBLIC_CSS_KB: "99999" });
    expect(result.status).toBe(0);
    expect(result.output).toContain("ZIGNOROWANE");
    expect(result.output).toContain("budget ≤ 579 KB");
    expect(result.output).toContain("budget ≤ 74 KB");
  });
});
