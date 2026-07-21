import { describe, it, expect } from "vitest";
import { workflowsPl, workflowsEn } from "@/lib/i18n-admin-workflows";

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

const PL = workflowsPl as unknown as Record<string, unknown>;
const EN = workflowsEn as unknown as Record<string, unknown>;

// Ta sama reguła co w rdzennym teście parytetu locale: polski ma więcej
// kategorii liczby mnogiej niż angielski, więc porównujemy klucz bazowy.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: string[]): Set<string> =>
  new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, "")));

describe("i18n workflows bundle (pl/en)", () => {
  it("PL i EN mają identyczną strukturę kluczy", () => {
    const plKeys = baseKeys(keyPaths(PL));
    const enKeys = baseKeys(keyPaths(EN));
    const onlyPl = [...plKeys].filter((k) => !enKeys.has(k));
    const onlyEn = [...enKeys].filter((k) => !plKeys.has(k));
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("bez pustych liści", () => {
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

  it("używa '-' zamiast pauzy '—' w każdym stringu", () => {
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
