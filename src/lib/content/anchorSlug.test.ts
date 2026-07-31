// Kontrakt kanonicznych kotwic nagłówków + PARYTET MIĘDZY SILNIKAMI.
//
// Regresja, którą te testy blokują: `ł` (U+0142) nie ma rozkładu kanonicznego,
// więc pipeline "NFKD + zdejmij znaki łączące" gubił go w środku wyrazu i ten
// sam nagłówek dostawał inny identyfikator w silniku bloków niż w richtekście
// (`wyzwania-ma-ych-firm` vs `wyzwania-malych-firm`). Ostatni blok testów
// dowodzi, że WSZYSTKIE pięć wejść (richtext, spis treści, silnik bloków,
// pływający pasek, widget buildera) liczy dziś dokładnie tę samą funkcję.
import { describe, expect, it } from "vitest";
import {
  ANCHOR_FALLBACK,
  ANCHOR_MAX_LENGTH,
  createAnchorAllocator,
  legacyAnchorVariants,
  slugifyAnchor,
} from "./anchorSlug";
import { slugifyHeading as manualTocSlugify } from "@/lib/manualToc";
import { slugifyHeading as tocSettingsSlugify } from "@/lib/toc/settings";
import { slugify as blocksSlugify } from "@/components/blocks/renderer/data";
import { slugifyHeading as shareBarSlugify } from "./anchorScan";
import { slugifyHeading as tocWidgetSlugify } from "@/lib/toc/manualItems";

describe("slugifyAnchor", () => {
  it("lowercases and dashes word separators", () => {
    expect(slugifyAnchor("Hello World")).toBe("hello-world");
  });

  it("strips decomposable diacritics via NFKD", () => {
    expect(slugifyAnchor("Gęślą jaźń")).toBe("gesla-jazn");
    expect(slugifyAnchor("Śląsk")).toBe("slask");
    expect(slugifyAnchor("Ä Ö")).toBe("a-o");
  });

  it("transliterates the atomic 'ł' instead of dropping it (the reported bug)", () => {
    // U+0142 has NO canonical decomposition, so an NFKD-only pipeline turned it
    // into a separator and mangled the word: "ma-ych" instead of "malych".
    expect(slugifyAnchor("Wyzwania małych firm")).toBe("wyzwania-malych-firm");
    expect(slugifyAnchor("Łódź")).toBe("lodz");
    expect(slugifyAnchor("Słowo wstępne")).toBe("slowo-wstepne");
  });

  it("transliterates the other editorially-real atomic letters", () => {
    expect(slugifyAnchor("Straße")).toBe("strasse");
    expect(slugifyAnchor("Ærø")).toBe("aero");
    expect(slugifyAnchor("Đakovo")).toBe("dakovo");
    expect(slugifyAnchor("Þingvellir")).toBe("thingvellir");
    expect(slugifyAnchor("Œuvre")).toBe("oeuvre");
    expect(slugifyAnchor("Iğdır")).toBe("igdir");
  });

  it("collapses runs of non-alphanumerics and trims edge dashes", () => {
    expect(slugifyAnchor("a  --  b__c!!d")).toBe("a-b-c-d");
    expect(slugifyAnchor("  -Hello-  ")).toBe("hello");
  });

  it("caps the slug and never leaves a trailing dash after the cut", () => {
    expect(slugifyAnchor("a".repeat(200))).toHaveLength(ANCHOR_MAX_LENGTH);
    // Cutting exactly on a separator must not leave "…-" as the anchor.
    const onBoundary = `${"a".repeat(ANCHOR_MAX_LENGTH)} tail`;
    expect(slugifyAnchor(onBoundary)).toBe("a".repeat(ANCHOR_MAX_LENGTH));
    expect(slugifyAnchor(`${"a".repeat(ANCHOR_MAX_LENGTH - 1)} tail`)).not.toMatch(/-$/);
  });

  it("falls back to a stable id when nothing slugifiable survives", () => {
    expect(slugifyAnchor("!!!")).toBe(ANCHOR_FALLBACK);
    expect(slugifyAnchor("   ")).toBe(ANCHOR_FALLBACK);
    expect(slugifyAnchor("")).toBe(ANCHOR_FALLBACK);
    // Non-Latin scripts are out of the transliteration scope by design; they
    // still get a usable (deduplicated) anchor rather than an empty id.
    expect(slugifyAnchor("Программа")).toBe(ANCHOR_FALLBACK);
  });

  it("is idempotent - slugifying an anchor returns the same anchor", () => {
    for (const input of ["Wyzwania małych firm", "Gęślą jaźń", "Straße", "!!!"]) {
      expect(slugifyAnchor(slugifyAnchor(input))).toBe(slugifyAnchor(input));
    }
  });

  it("never emits characters that are illegal in a URL fragment", () => {
    const inputs = [
      "Raport <b>2026</b> & wnioski",
      "„Cytat” — myślnik",
      "100% wzrostu / rok",
      "ł ø đ ß æ œ ħ ı ŋ ŧ",
      "emoji 🚀 w nagłówku",
    ];
    for (const input of inputs) {
      expect(slugifyAnchor(input)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });
});

describe("legacyAnchorVariants", () => {
  it("reproduces the pre-unification anchor for atomic letters", () => {
    // Exactly what the blocks engine and the ToC used to emit.
    expect(legacyAnchorVariants("Wyzwania małych firm")).toContain("wyzwania-ma-ych-firm");
    expect(legacyAnchorVariants("Łódź")).toContain("odz");
  });

  it("reproduces the 64-char FloatingShareBar variant", () => {
    const long = "ą".repeat(100);
    const variants = legacyAnchorVariants(long);
    // Uncapped legacy variant (blocks/ToC) plus the 64-char share-bar variant.
    expect(variants).toContain("a".repeat(100));
    expect(variants).toContain("a".repeat(64));
  });

  it("reproduces the 80-char TocWidget variant only when it differs", () => {
    // Cięcie w środku ciągu liter: legacy widgetu == kanoniczna kotwica,
    // więc alias nie powstaje - zostają wariant bez limitu i share-barowe 64.
    expect(legacyAnchorVariants("ą".repeat(100))).toEqual(["a".repeat(100), "a".repeat(64)]);
    // Stary widget ciął PO zdjęciu myślników z krawędzi, więc cięcie na
    // separatorze zostawiało "…-". Alias musi być bajt w bajt taki sam.
    const onSeparator = `${"ą".repeat(79)} ogon`;
    const variants = legacyAnchorVariants(onSeparator);
    expect(variants).toContain(`${"a".repeat(79)}-ogon`);
    expect(variants).toContain(`${"a".repeat(79)}-`);
  });

  it("is empty when the canonical anchor already matches history", () => {
    // No atomic letters and under the cap -> nothing changed, no aliases needed.
    expect(legacyAnchorVariants("Hello World")).toEqual([]);
    expect(legacyAnchorVariants("Gęślą jaźń")).toEqual([]);
  });

  it("never returns the canonical anchor and never duplicates", () => {
    for (const input of ["Wyzwania małych firm", "a".repeat(200), "Straße", "!!!"]) {
      const variants = legacyAnchorVariants(input);
      expect(variants).not.toContain(slugifyAnchor(input));
      expect(new Set(variants).size).toBe(variants.length);
    }
  });
});

describe("createAnchorAllocator", () => {
  it("returns the base anchor for the first occurrence", () => {
    const alloc = createAnchorAllocator();
    expect(alloc.allocate("Wnioski")).toBe("wnioski");
  });

  it("counts duplicate suffixes from the BASE, not from the previous id", () => {
    const alloc = createAnchorAllocator();
    // The share bar used to compound the suffix: wnioski, wnioski-2, wnioski-2-2.
    expect(alloc.allocate("Wnioski")).toBe("wnioski");
    expect(alloc.allocate("Wnioski")).toBe("wnioski-2");
    expect(alloc.allocate("Wnioski")).toBe("wnioski-3");
    expect(alloc.allocate("Wnioski")).toBe("wnioski-4");
  });

  it("prefers an author-supplied explicit anchor over the slug", () => {
    const alloc = createAnchorAllocator();
    expect(alloc.allocate("Wnioski", "custom-anchor")).toBe("custom-anchor");
    expect(alloc.allocate("Wnioski", "  spaced  ")).toBe("spaced");
    // A blank explicit anchor falls back to the slug.
    expect(alloc.allocate("Wnioski", "   ")).toBe("wnioski");
  });

  it("deduplicates explicit anchors too", () => {
    const alloc = createAnchorAllocator();
    expect(alloc.allocate("A", "dup")).toBe("dup");
    expect(alloc.allocate("B", "dup")).toBe("dup-2");
  });

  it("respects reserved ids so document chrome cannot be shadowed", () => {
    const alloc = createAnchorAllocator();
    alloc.reserve("footnotes-heading");
    expect(alloc.has("footnotes-heading")).toBe(true);
    expect(alloc.allocate("Footnotes heading")).toBe("footnotes-heading-2");
  });

  it("keeps distinct headings that collapse to the same fallback apart", () => {
    const alloc = createAnchorAllocator();
    expect(alloc.allocate("!!!")).toBe(ANCHOR_FALLBACK);
    expect(alloc.allocate("???")).toBe(`${ANCHOR_FALLBACK}-2`);
  });
});

describe("cross-engine anchor parity", () => {
  // Every heading-anchor entry point in the app. If any of them forks its own
  // pipeline again, this table fails.
  const engines: ReadonlyArray<readonly [string, (s: string) => string]> = [
    ["manualToc (richtext)", manualTocSlugify],
    ["toc/settings (spis treści)", tocSettingsSlugify],
    ["blocks/renderer (silnik bloków)", blocksSlugify],
    ["FloatingShareBar (pasek udostępniania)", shareBarSlugify],
    ["TocWidget (widget buildera)", tocWidgetSlugify],
  ];

  const headings = [
    "Wyzwania małych firm",
    "Łódź i region",
    "Gęślą jaźń",
    "Straße & Ærø",
    "Hello World",
    "!!!",
    "   ",
    "a".repeat(200),
    "Raport <b>2026</b>",
  ];

  for (const heading of headings) {
    it(`all engines agree on ${JSON.stringify(heading)}`, () => {
      const canonical = slugifyAnchor(heading);
      for (const [name, engine] of engines) {
        expect(engine(heading), `${name} diverged`).toBe(canonical);
      }
    });
  }
});
