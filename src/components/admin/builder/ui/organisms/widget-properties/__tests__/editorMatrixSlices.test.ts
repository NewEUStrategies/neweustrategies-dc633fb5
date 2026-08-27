// BRAMKA KOMPLETNOŚCI PODZIAŁU TABELI EDYTORÓW.
//
// Tabela z `editorMatrix.shared.tsx` jedzie w sześciu plikach, po podzbiorach
// edytorów. Gdyby edytor wypadł z podziału (albo trafił do dwóch kawałków),
// pokrycie powierzchni panelu spadłoby BEZ ani jednego czerwonego testu - a to
// jest dokładnie ta klasa awarii, przez którą podział powstał. Dlatego podział
// ma własny dowód: suma kawałków = wszystkie edytory bareli, rozłącznie.
import { describe, it, expect } from "vitest";
import { MATRIX_SLICES, ALL_EDITOR_NAMES } from "./editorMatrix.shared";

describe("podział tabeli edytorów treści", () => {
  const sliced = Object.values(MATRIX_SLICES).flatMap((names) => [...names]);

  it("obejmuje KAŻDY edytor tabeli", () => {
    expect([...sliced].sort()).toEqual([...ALL_EDITOR_NAMES].sort());
  });

  it("nie wpisuje żadnego edytora do dwóch kawałków", () => {
    expect(sliced.length).toBe(new Set(sliced).size);
  });

  it("trzyma kawałki w rozsądnym budżecie (żaden nie rośnie z powrotem w monolit)", () => {
    for (const [slice, names] of Object.entries(MATRIX_SLICES)) {
      expect(names.length, `kawałek ${slice}`).toBeLessThanOrEqual(6);
      expect(names.length, `kawałek ${slice}`).toBeGreaterThan(0);
    }
  });
});
