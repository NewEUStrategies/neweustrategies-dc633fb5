import { describe, it, expect } from "vitest";
import { BLOCK_SPECS, BLOCK_LIST, IMPLEMENTED_BLOCKS, type BlockSpec } from "@/lib/blocks/registry";
import { isBlocksDoc } from "@/lib/blocks/schema";
import type { BlockType } from "@/lib/blocks/types";

// Rejestr bloków to katalog ~100 wpisów, z których KAŻDY niesie własną fabrykę
// `create()`. Do tej pory żadna z nich nie była wywołana w teście (18,8%
// funkcji), a to jedyne miejsce, gdzie powstaje domyślny kształt danych bloku.
// Fabryka, która zwróci `type` inny niż klucz w katalogu, wstawia do dokumentu
// blok, którego renderer publiczny nie znajdzie - i wpis znika ze strony bez
// żadnego błędu. Poniższa tabela wywołuje każdą fabrykę i sprawdza kontrakt.

const ENTRIES = Object.entries(BLOCK_SPECS) as Array<[BlockType, BlockSpec]>;

describe("BLOCK_SPECS - kontrakt katalogu", () => {
  it("katalog jest niepusty i pokrywa się z BLOCK_LIST", () => {
    expect(ENTRIES.length).toBeGreaterThan(50);
    expect(BLOCK_LIST).toHaveLength(ENTRIES.length);
  });

  it.each(ENTRIES)("wpis %s ma spójne metadane", (key, spec) => {
    expect(spec.type).toBe(key);
    expect(spec.label.length).toBeGreaterThan(0);
    expect(spec.description.length).toBeGreaterThan(0);
    expect(spec.icon).toBeTruthy();
    expect(typeof spec.category).toBe("string");
    expect(spec.category.length).toBeGreaterThan(0);
  });

  it.each(ENTRIES)("fabryka %s produkuje blok własnego typu ze świeżym id", (key, spec) => {
    const first = spec.create();
    const second = spec.create();
    expect(first.type).toBe(key);
    expect(second.type).toBe(key);
    expect(first.id.length).toBeGreaterThan(0);
    // Dwa wywołania MUSZĄ dać różne id - wspólne id kasuje blok przy zapisie
    // (klucz React i klucz selekcji to to samo id).
    expect(first.id).not.toBe(second.id);
  });

  it.each(ENTRIES)("fabryka %s daje dane, które przechodzą walidację dokumentu", (_key, spec) => {
    const doc = { version: 1 as const, blocks: [spec.create()] };
    expect(isBlocksDoc(doc)).toBe(true);
  });

  it.each(ENTRIES)("fabryka %s zwraca `data` jako obiekt (nie tablicę, nie null)", (_key, spec) => {
    const block = spec.create();
    expect(block.data).toBeTypeOf("object");
    expect(Array.isArray(block.data)).toBe(false);
    expect(block.data).not.toBeNull();
  });
});

describe("IMPLEMENTED_BLOCKS", () => {
  it("każdy zaimplementowany typ ma wpis w katalogu", () => {
    const missing = IMPLEMENTED_BLOCKS.filter((t) => !(t in BLOCK_SPECS));
    expect(missing, `typy bez wpisu w BLOCK_SPECS: ${missing.join(", ")}`).toEqual([]);
  });

  it("każdy wpis katalogu jest zadeklarowany jako zaimplementowany", () => {
    const listed = new Set<string>(IMPLEMENTED_BLOCKS);
    const extra = ENTRIES.map(([k]) => k).filter((k) => !listed.has(k));
    expect(extra, `wpisy katalogu poza IMPLEMENTED_BLOCKS: ${extra.join(", ")}`).toEqual([]);
  });

  it("lista nie ma duplikatów", () => {
    expect(new Set(IMPLEMENTED_BLOCKS).size).toBe(IMPLEMENTED_BLOCKS.length);
  });
});
