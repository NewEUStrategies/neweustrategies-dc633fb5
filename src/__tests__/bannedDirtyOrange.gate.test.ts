// Zakaz brudnego pomarańczu #c1601c (i klas Tailwind, które go dają).
// Główny pomarańcz platformy to #fa9346 (token `brand`).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const files = walk("src");

describe("zakaz brudnego pomarańczu", () => {
  it("nigdzie nie występuje #c1601c", () => {
    const hits = files.filter((f) => /c1601c/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("nie używa ciemnych odcieni orange/amber (600-900)", () => {
    const re =
      /\b(?:text|bg|border|fill|stroke|ring|from|to|via)-(?:orange|amber)-(?:600|700|800|900)\b/;
    const hits = files.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("marka pozostaje #fa9346", () => {
    expect(readFileSync("src/styles.css", "utf8")).toMatch(/--brand:\s*#fa9346/i);
  });
});
