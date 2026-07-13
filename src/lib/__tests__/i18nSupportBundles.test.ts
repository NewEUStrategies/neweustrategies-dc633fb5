// Parzystość strukturalna PL/EN dodatkowych bundli i18n (support + tracker) -
// ta sama reguła co i18nCohesion.test.ts: klucze porównywane po zdjęciu
// sufiksu liczby mnogiej.
import { describe, it, expect } from "vitest";
import { supportPl, supportEn } from "@/lib/i18n-support";
import { trackerPl, trackerEn } from "@/lib/i18n-tracker";
import { programsPl, programsEn } from "@/lib/i18n-programs";

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

function expectParity(pl: Record<string, unknown>, en: Record<string, unknown>) {
  const plKeys = baseKeys(keyPaths(pl));
  const enKeys = baseKeys(keyPaths(en));
  const onlyPl = [...plKeys].filter((k) => !enKeys.has(k));
  const onlyEn = [...enKeys].filter((k) => !plKeys.has(k));
  expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
}

describe("i18n bundle wsparcia (pl/en)", () => {
  it("PL i EN mają identyczną strukturę kluczy", () => {
    expectParity(
      supportPl as unknown as Record<string, unknown>,
      supportEn as unknown as Record<string, unknown>,
    );
  });
});

describe("i18n bundle trackera (pl/en)", () => {
  it("PL i EN mają identyczną strukturę kluczy", () => {
    expectParity(
      trackerPl as unknown as Record<string, unknown>,
      trackerEn as unknown as Record<string, unknown>,
    );
  });
});

describe("i18n bundle programów badawczych (pl/en)", () => {
  it("PL i EN mają identyczną strukturę kluczy", () => {
    expectParity(
      programsPl as unknown as Record<string, unknown>,
      programsEn as unknown as Record<string, unknown>,
    );
  });
});
