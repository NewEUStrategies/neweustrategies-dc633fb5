import { describe, it, expect } from "vitest";
import {
  BLOCK_VARIANTS,
  BLOCK_PALETTE_KEYS,
  BLOCK_PALETTE_VAR,
  blockPaletteVar,
  getBlockVariants,
  hasBlockPalette,
  type BlockVariantOption,
} from "@/lib/blocks/variants";

// Rejestr wariantów był w całości MARTWY (0% pokrycia), a jest jedynym
// źródłem toolbara „przełącz wariant" nad aktywnym blokiem. Zły wpis nie
// wywala edytora - po prostu zapisuje do `block.data.variant` klucz, którego
// renderer publiczny nie zna, i blok cicho gubi wygląd. Dlatego tabela
// sprawdza KAŻDY typ z katalogu, a nie próbkę.

const TYPES_WITH_VARIANTS = Object.keys(BLOCK_VARIANTS);

describe("getBlockVariants", () => {
  it("katalog nie jest pusty - inaczej cała tabela niżej byłaby bez treści", () => {
    expect(TYPES_WITH_VARIANTS.length).toBeGreaterThan(0);
  });

  it.each(TYPES_WITH_VARIANTS)("zwraca listę wariantów dla typu %s", (type) => {
    const variants = getBlockVariants(type);
    expect(variants).not.toBeNull();
    expect(variants).toBe(BLOCK_VARIANTS[type]);
    expect((variants as BlockVariantOption[]).length).toBeGreaterThan(0);
  });

  it.each(TYPES_WITH_VARIANTS)("każdy wariant typu %s ma niepusty klucz i etykietę", (type) => {
    for (const option of BLOCK_VARIANTS[type]) {
      expect(option.key.length).toBeGreaterThan(0);
      expect(option.label.length).toBeGreaterThan(0);
    }
  });

  it.each(TYPES_WITH_VARIANTS)("klucze wariantów typu %s są unikalne", (type) => {
    const keys = BLOCK_VARIANTS[type].map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // Fałszywe ramię `??`: typ, którego katalog nie zna.
  it.each(["", "nieistniejacy-blok", "paragraph", "image", "chart-x"])(
    "zwraca null dla typu bez wpisu: %s",
    (type) => {
      expect(getBlockVariants(type)).toBeNull();
    },
  );

  // NAPRAWIONE 2026-10-18 (był `it.fails`). `BLOCK_VARIANTS[type] ?? null`
  // czytało przez ŁAŃCUCH PROTOTYPÓW: dla `type === "constructor"` operator
  // `??` widział funkcję `Object`, a nie `undefined`, i toolbar dostawał
  // wartość, na której `.map` wywracał render. `getBlockVariants` przyjmuje
  // `string`, a typ bloku przychodzi też z bazy. Kontrakt: tylko własne klucze
  // katalogu dają listę, każdy inny klucz - `null` („brak toolbara wariantów").
  it.each(["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"])(
    "zwraca null dla klucza z prototypu Object: %s",
    (type) => {
      expect(getBlockVariants(type)).toBeNull();
    },
  );
});

describe("hasBlockPalette", () => {
  it("quote ma paletę kolorów edytowaną z toolbara", () => {
    expect(hasBlockPalette("quote")).toBe(true);
  });

  it.each(["paragraph", "heading", "", "chart", "author-bio", "constructor"])(
    "nie ma palety dla typu %s",
    (type) => {
      expect(hasBlockPalette(type)).toBe(false);
    },
  );
});

describe("BLOCK_PALETTE_KEYS / BLOCK_PALETTE_VAR", () => {
  it.each([...BLOCK_PALETTE_KEYS])("token %s ma odwzorowanie na zmienną CSS", (key) => {
    expect(BLOCK_PALETTE_VAR[key]).toMatch(/^var\(--/);
  });

  it("nie ma zmiennej CSS bez odpowiadającego tokenu (i odwrotnie)", () => {
    expect(Object.keys(BLOCK_PALETTE_VAR).sort()).toEqual([...BLOCK_PALETTE_KEYS].sort());
  });

  it.each([...BLOCK_PALETTE_KEYS])("blockPaletteVar(%s) oddaje token katalogu", (key) => {
    expect(blockPaletteVar(key)).toBe(BLOCK_PALETTE_VAR[key]);
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty", "fiolet", ""])(
    "klucz spoza katalogu (także z prototypu: %s) daje akcent neutralny, nie tekst funkcji",
    (key) => {
      expect(blockPaletteVar(key)).toBe(BLOCK_PALETTE_VAR.neutral);
    },
  );
});
