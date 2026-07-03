import { describe, it, expect } from "vitest";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";

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

const PL = pl as unknown as Record<string, unknown>;
const EN = en as unknown as Record<string, unknown>;

describe("i18n resources (pl/en split)", () => {
  it("PL and EN expose an identical key structure", () => {
    const plKeys = new Set(keyPaths(PL));
    const enKeys = new Set(keyPaths(EN));
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
});
