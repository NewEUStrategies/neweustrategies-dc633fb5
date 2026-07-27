/**
 * Guard: every `t("…")` key used by the Elementor-style builder resolves in the
 * PL *and* the EN bundle.
 *
 * A key that is missing from a bundle silently falls back to its `defaultValue`
 * - and those defaults are authored in Polish, so a missing EN key renders
 * Polish copy inside the English editor without failing anything. This test
 * reads the builder sources, extracts the keys, and resolves them against the
 * real resource bundles (core locale + every `lib/i18n-*` overlay).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pl as corePl } from "@/lib/locale/pl";
import { en as coreEn } from "@/lib/locale/en";
import i18n from "@/lib/i18n";
import "@/lib/i18n-builder";

type Dict = Record<string, unknown>;

const SRC = resolve(__dirname, "../../..");
const BUILDER_DIRS = [join(SRC, "components/admin/builder"), join(SRC, "lib/builder")];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

function lookup(bundle: Dict | undefined, key: string): unknown {
  let cur: unknown = bundle;
  for (const part of key.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Dict)[part];
  }
  return cur;
}

/** Resolve a key against the core bundle plus everything the overlays added. */
function resolves(lng: "pl" | "en", key: string): boolean {
  const core = lng === "pl" ? (corePl as Dict) : (coreEn as Dict);
  if (typeof lookup(core, key) === "string") return true;
  const overlay = i18n.getResourceBundle(lng, "translation") as Dict | undefined;
  return typeof lookup(overlay, key) === "string";
}

const KEY_RE = /\bt\(\s*["'`]([a-zA-Z0-9_.-]+)["'`]/g;

function collectKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const dir of BUILDER_DIRS) {
    if (!statSync(dir).isDirectory()) continue;
    for (const file of walk(dir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(KEY_RE)) {
          const key = m[1];
          // Bare identifiers are almost always a local `t(...)` helper, not a key.
          if (!key.includes(".")) continue;
          if (!keys.has(key)) keys.set(key, `${file.replace(SRC + "/", "")}:${i + 1}`);
        }
      });
    }
  }
  return keys;
}

describe("builder translation keys", () => {
  const keys = collectKeys();

  it("finds the builder's translation keys", () => {
    expect(keys.size).toBeGreaterThan(300);
  });

  it("every key resolves in the PL bundle", () => {
    const missing = [...keys.entries()]
      .filter(([key]) => !resolves("pl", key))
      .map(([key, where]) => `${key}  (${where})`);
    expect(missing, `keys missing from PL:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every key resolves in the EN bundle", () => {
    const missing = [...keys.entries()]
      .filter(([key]) => !resolves("en", key))
      .map(([key, where]) => `${key}  (${where})`);
    expect(missing, `keys missing from EN:\n${missing.join("\n")}`).toEqual([]);
  });
});
