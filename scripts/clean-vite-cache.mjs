#!/usr/bin/env node
/**
 * Czyści cache `node_modules/.vite`, gdy zmieni się wersja Vite lub lockfile.
 * Uruchamiane automatycznie przed `vite dev` (predev).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "node_modules", ".vite");
const stampFile = join(root, "node_modules", ".cache", "vite-cache-stamp.json");

/** @param {string} p */
const readIfExists = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const viteVersion = (() => {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "node_modules", "vite", "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

const lockSources = ["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]
  .map((f) => join(root, f))
  .filter((p) => existsSync(p));

const hash = createHash("sha256");
hash.update(`vite:${viteVersion}\n`);
hash.update(`node:${process.version}\n`);
for (const lock of lockSources) {
  hash.update(`${lock}:`);
  hash.update(readFileSync(lock));
  hash.update("\n");
}
hash.update(readIfExists(join(root, "vite.config.ts")));
const signature = hash.digest("hex");

let previous = "";
try {
  previous = JSON.parse(readIfExists(stampFile) || "{}").signature ?? "";
} catch {
  previous = "";
}

if (previous !== signature) {
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
    console.log(
      `[vite-cache] Wykryto zmianę (Vite ${viteVersion}/lock) - wyczyszczono node_modules/.vite`,
    );
  }
  mkdirSync(dirname(stampFile), { recursive: true });
  writeFileSync(
    stampFile,
    JSON.stringify({ signature, viteVersion, updatedAt: new Date().toISOString() }, null, 2),
  );
} else {
  console.log(`[vite-cache] Cache aktualny (Vite ${viteVersion})`);
}
