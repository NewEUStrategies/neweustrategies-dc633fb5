import { describe, it, expect } from "vitest";
import { cohesionPl, cohesionEn } from "@/lib/i18n-cohesion";

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const PL = cohesionPl as unknown as Record<string, unknown>;
const EN = cohesionEn as unknown as Record<string, unknown>;

// Same rule as the core locale parity test: Polish legitimately has more
// plural categories (one/few/many/other) than English (one/other), so compare
// on the base key with the plural suffix stripped.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: string[]): Set<string> =>
  new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, "")));

describe("i18n cohesion bundle (pl/en)", () => {
  it("PL and EN expose an identical key structure", () => {
    const plKeys = baseKeys(keyPaths(PL));
    const enKeys = baseKeys(keyPaths(EN));
    const onlyPl = [...plKeys].filter((k) => !enKeys.has(k));
    const onlyEn = [...enKeys].filter((k) => !plKeys.has(k));
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("has no empty leaf strings", () => {
    const empties = (obj: Record<string, unknown>, prefix = ""): string[] => {
      const bad: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v))
          bad.push(...empties(v as Record<string, unknown>, p));
        else if (typeof v === "string" && v.trim() === "") bad.push(p);
      }
      return bad;
    };
    expect(empties(PL)).toEqual([]);
    expect(empties(EN)).toEqual([]);
  });

  it("uses '-' instead of the em dash in every string", () => {
    const emDashes = (obj: Record<string, unknown>, prefix = ""): string[] => {
      const bad: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v))
          bad.push(...emDashes(v as Record<string, unknown>, p));
        else if (typeof v === "string" && v.includes("—")) bad.push(p);
      }
      return bad;
    };
    expect(emDashes(PL)).toEqual([]);
    expect(emDashes(EN)).toEqual([]);
  });
});
