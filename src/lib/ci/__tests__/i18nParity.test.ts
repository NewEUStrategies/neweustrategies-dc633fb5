import { describe, expect, it } from "vitest";
import { diffParity, flattenKeys, parityFailed, readKey, renderParityReport } from "../i18nParity";

const pl = {
  blocks: { title: "Tytuł", nested: { save: "Zapisz", same: "OK" } },
  admin: { onlyPl: "Tylko PL" },
};
const en = {
  blocks: { title: "Title", nested: { same: "OK" } },
  admin: { onlyPl: "Only PL", onlyEn: "Only EN" },
};

describe("flattenKeys / readKey", () => {
  it("spłaszcza drzewo do ścieżek", () => {
    expect(flattenKeys(pl)).toEqual([
      "blocks.title",
      "blocks.nested.save",
      "blocks.nested.same",
      "admin.onlyPl",
    ]);
  });

  it("czyta wartość spod ścieżki", () => {
    expect(readKey(pl, "blocks.nested.save")).toBe("Zapisz");
    expect(readKey(pl, "blocks.brak")).toBeNull();
  });
});

describe("diffParity", () => {
  it("wykrywa brak klucza EN w bramkowanym prefiksie", () => {
    const diff = diffParity(pl, en, { gatedPrefixes: ["blocks"] });
    expect(diff.missingEn).toEqual(["blocks.nested.save"]);
    expect(diff.missingPl).toEqual([]);
    expect(parityFailed(diff)).toBe(true);
  });

  it("ignoruje klucze poza bramkowanymi prefiksami", () => {
    const diff = diffParity({ admin: { onlyPl: "x" } }, {}, { gatedPrefixes: ["blocks"] });
    expect(parityFailed(diff)).toBe(false);
  });

  it("zgłasza klucze obecne tylko po stronie EN", () => {
    const diff = diffParity(pl, en, { gatedPrefixes: ["admin"] });
    expect(diff.missingPl).toEqual(["admin.onlyEn"]);
  });

  it("wykrywa nieprzetłumaczone wartości (EN identyczne z PL)", () => {
    const diff = diffParity(
      { blocks: { cta: "Dołącz do nas" } },
      { blocks: { cta: "Dołącz do nas" } },
      { gatedPrefixes: ["blocks"] },
    );
    expect(diff.untranslated).toEqual(["blocks.cta"]);
    // Sam brak tłumaczenia nie blokuje - blokuje brak klucza.
    expect(parityFailed(diff)).toBe(false);
  });

  it("nie uznaje krótkich identycznych tokenów za brak tłumaczenia", () => {
    const diff = diffParity(
      { blocks: { unit: "EUR" } },
      { blocks: { unit: "EUR" } },
      { gatedPrefixes: ["blocks"] },
    );
    expect(diff.untranslated).toEqual([]);
  });

  it("renderuje czytelny raport", () => {
    const diff = diffParity(pl, en, { gatedPrefixes: ["blocks"] });
    expect(renderParityReport(diff)).toContain("blocks.nested.save");
  });
});
