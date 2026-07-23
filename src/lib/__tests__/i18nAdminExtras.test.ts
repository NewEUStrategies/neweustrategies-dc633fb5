// Structural PL/EN parity for the admin/CRM "extras" overlay - the bundle that
// backfills keys used in components/routes but previously undefined. Same rule
// as the other bundle parity tests: compare on the base key (plural suffix
// stripped) so Polish plural categories don't read as a missing translation.
import { describe, it, expect } from "vitest";
import { adminExtrasPl, adminExtrasEn } from "@/lib/i18n-admin-extras";

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

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: string[]): Set<string> =>
  new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, "")));

const PL = adminExtrasPl as unknown as Record<string, unknown>;
const EN = adminExtrasEn as unknown as Record<string, unknown>;

describe("i18n admin extras bundle (pl/en)", () => {
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
