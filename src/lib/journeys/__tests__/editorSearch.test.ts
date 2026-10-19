// Kontrakt parametrów URL edytora ścieżki (SPEC §2.3). Walidator jedzie
// w powłoce trasy, więc jedyny dozwolony import to liść `revenue/search.ts`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { REVENUE_PERIODS } from "@/lib/revenue/search";
import {
  JOURNEY_EDITOR_TABS,
  JOURNEY_EDITOR_VIEWS,
  parseJourneyEditorSearch,
} from "../editorSearch";

describe("editorSearch.ts - importy", () => {
  it("importuje wyłącznie liść kontraktu huba", () => {
    const kod = bezKomentarzy(readFileSync("src/lib/journeys/editorSearch.ts", "utf8"));
    const zrodla = [...kod.matchAll(/^\s*import\b[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(zrodla).toEqual(["@/lib/revenue/search"]);
    expect(kod).not.toMatch(/\bimport\s*\(|\brequire\s*\(/);
  });
});

describe("parseJourneyEditorSearch", () => {
  it("każdy widok, zakładka i okres statystyk przechodzi", () => {
    for (const view of JOURNEY_EDITOR_VIEWS) {
      expect(parseJourneyEditorSearch({ view })).toEqual({ view });
    }
    for (const tab of JOURNEY_EDITOR_TABS) {
      expect(parseJourneyEditorSearch({ tab })).toEqual({ tab });
    }
    for (const stats of [...REVENUE_PERIODS, "off"]) {
      expect(parseJourneyEditorSearch({ stats })).toEqual({ stats });
    }
  });

  it("pusty adres daje pusty obiekt - bez kluczy `undefined`", () => {
    expect(parseJourneyEditorSearch({})).toStrictEqual({});
    expect(parseJourneyEditorSearch({ w: "month" })).toStrictEqual({});
  });

  it("wersja: dodatnia liczba całkowita, także jako napis z adresu", () => {
    expect(parseJourneyEditorSearch({ version: 3 })).toEqual({ version: 3 });
    expect(parseJourneyEditorSearch({ version: "12" })).toEqual({ version: 12 });
    for (const version of [0, -1, 1.5, "abc", "1e3", null]) {
      expect(parseJourneyEditorSearch({ version }).version, String(version)).toBeUndefined();
    }
  });

  it("węzeł: identyfikator bez spacji i znaczników", () => {
    expect(parseJourneyEditorSearch({ node: "send_email_2" })).toEqual({ node: "send_email_2" });
    expect(parseJourneyEditorSearch({ node: 7 })).toEqual({ node: "7" });
    for (const node of ["a b", "<n>", "", "n".repeat(65)]) {
      expect(parseJourneyEditorSearch({ node }).node, node).toBeUndefined();
    }
  });

  it("odrzucona wartość znanego klucza nie przecieka przez scalenie routera", () => {
    const raw = { view: "board", tab: "stats", stats: "all", version: "v2", node: "x y" };
    const wynik = { ...raw, ...parseJourneyEditorSearch(raw) };
    for (const klucz of Object.keys(raw)) {
      expect(wynik[klucz as keyof typeof wynik], klucz).toBeUndefined();
    }
  });
});
