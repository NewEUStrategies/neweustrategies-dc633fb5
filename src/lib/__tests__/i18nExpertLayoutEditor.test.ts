// Parytet strukturalny PL/EN bundla inline-edytora layoutu eksperta - ta sama
// reguła co pozostałe testy bundli: porównanie po kluczu bazowym (bez sufiksu
// liczby mnogiej), zero pustych stringów, "-" zamiast "—".
import { describe, it, expect } from "vitest";
import { expertLayoutEditorEn, expertLayoutEditorPl } from "@/lib/i18n-expert-layout-editor";

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

const PL = expertLayoutEditorPl as unknown as Record<string, unknown>;
const EN = expertLayoutEditorEn as unknown as Record<string, unknown>;

const leaves = (obj: Record<string, unknown>, prefix = ""): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...leaves(v as Record<string, unknown>, p));
    } else if (typeof v === "string") {
      out.push([p, v]);
    }
  }
  return out;
};

describe("i18n expert layout editor bundle (pl/en)", () => {
  it("PL and EN expose an identical key structure", () => {
    const plKeys = baseKeys(keyPaths(PL));
    const enKeys = baseKeys(keyPaths(EN));
    const onlyPl = [...plKeys].filter((k) => !enKeys.has(k)).sort();
    const onlyEn = [...enKeys].filter((k) => !plKeys.has(k)).sort();
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("has no empty leaf strings", () => {
    expect(leaves(PL).filter(([, v]) => v.trim() === "")).toEqual([]);
    expect(leaves(EN).filter(([, v]) => v.trim() === "")).toEqual([]);
  });

  it("uses '-' instead of the em dash '—'", () => {
    expect(
      leaves(PL)
        .filter(([, v]) => v.includes("—"))
        .map(([k]) => k),
    ).toEqual([]);
    expect(
      leaves(EN)
        .filter(([, v]) => v.includes("—"))
        .map(([k]) => k),
    ).toEqual([]);
  });
});
