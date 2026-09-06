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
  transliterateAtomicLetters,
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

// ---------------------------------------------------------------------------
// `transliterateAtomicLetters` - część C (gałęziowa).
//
// Ta funkcja nie miała w tym pliku ANI JEDNEGO wywołania (pokrycie przychodziło
// ubocznie z `src/lib/audio/blobCache.ts`, gdzie służy do nazwy pobieranego
// pliku). Jest to JEDYNE miejsce w repozytorium, gdzie mapa liter atomowych
// żyje z zachowaniem wielkości - a to ona decyduje, czy nazwa pliku „Łódź.mp3"
// nie zjedzie do „ódź.mp3".
// ---------------------------------------------------------------------------
describe("transliterateAtomicLetters", () => {
  it("zachowuje wielkość litery: Ł -> L, ł -> l", () => {
    // Dalsze diakrytyki (ó, ź) zdejmuje dopiero NFKD u konsumenta - ta funkcja
    // ich celowo NIE rusza.
    expect(transliterateAtomicLetters("Łódź")).toBe("Lódź");
    expect(transliterateAtomicLetters("łódź")).toBe("lódź");
  });

  it("dwuznak z małej litery zostaje mały, z wielkiej - tylko pierwsza litera rośnie", () => {
    // Gałąź `char === char.toLowerCase()` w obie strony. „Þor" ma dać „Thor",
    // a nie „THor" - inaczej nazwa pliku wygląda na krzyk.
    expect(transliterateAtomicLetters("Straße")).toBe("Strasse");
    expect(transliterateAtomicLetters("STRAßE")).toBe("STRAssE");
    expect(transliterateAtomicLetters("Þor")).toBe("Thor");
    expect(transliterateAtomicLetters("þor")).toBe("thor");
    // `ø` też jest w mapie liter atomowych, więc „Ærø" schodzi do „Aero" -
    // dwuznak `Æ` daje `Ae` (tylko pierwsza litera wielka), a nie `AE`.
    expect(transliterateAtomicLetters("Ærø")).toBe("Aero");
  });

  it("wielkie ASCII `I` przechodzi NIETKNIĘTE, mimo że wpada w klasę znaków", () => {
    // Gałąź `mapped === undefined`. Klasa znaków powstaje z kluczy mapy ORAZ
    // ich wersji wielkich, a `"ı".toUpperCase()` daje zwykłe ASCII `I`, którego
    // klucza `i` w mapie NIE MA. Bez tej obrony każde `I` w tytule zamieniałoby
    // się w `undefined` w nazwie pliku.
    expect(transliterateAtomicLetters("Instytut")).toBe("Instytut");
    expect(transliterateAtomicLetters("III")).toBe("III");
    // ...a turecka bezkropkowa `ı` nadal jest tłumaczona.
    expect(transliterateAtomicLetters("ırmak")).toBe("irmak");
  });

  it("napis bez liter atomowych i napis pusty wracają bez zmian", () => {
    expect(transliterateAtomicLetters("Raport roczny 2026")).toBe("Raport roczny 2026");
    expect(transliterateAtomicLetters("")).toBe("");
  });
});

describe("legacyAnchorVariants / createAnchorAllocator - gałęzie brzegowe", () => {
  it("nagłówek bez ani jednego znaku slugowalnego NIE produkuje aliasów", () => {
    // Gałąź `|| ANCHOR_FALLBACK`: wszyscy trzej kandydaci degradują się do
    // kotwicy zapasowej, czyli do wartości KANONICZNEJ - a warianty równe
    // kanonicznemu są odfiltrowane. Efekt ma być pusty, bo dokładanie
    // `<span id="section">` przy każdym takim nagłówku produkowałoby
    // zduplikowane identyfikatory w DOM.
    expect(legacyAnchorVariants("!!!")).toEqual([]);
    expect(legacyAnchorVariants("   ")).toEqual([]);
    expect(legacyAnchorVariants("")).toEqual([]);
    expect(slugifyAnchor("!!!")).toBe(ANCHOR_FALLBACK);
  });

  it("`allocate` z jawną kotwicą `null` wraca do sluga z treści", () => {
    // Gałąź `explicit?.trim() ?? ""`. `null` przychodzi wprost z kolumny
    // `anchor` w bazie, gdy autor nie podał własnej kotwicy.
    const a = createAnchorAllocator();
    expect(a.allocate("Tytuł sekcji", null)).toBe("tytul-sekcji");
  });

  it("jawna kotwica z samych spacji NIE staje się kotwicą", () => {
    // Drugi człon tej samej gałęzi: `"   ".trim()` daje pustkę, więc `||`
    // przechodzi na slug. Bez tego id nagłówka byłoby pustym napisem i
    // `#` z odnośnika trafiałby w nic.
    const a = createAnchorAllocator();
    expect(a.allocate("Tytuł sekcji", "   ")).toBe("tytul-sekcji");
    expect(a.allocate("Inny tytuł", undefined)).toBe("inny-tytul");
    expect(a.has("tytul-sekcji")).toBe(true);
  });

  it("dwa nagłówki z pustą kotwicą jawną dedupikują się po slugu, nie po pustce", () => {
    const a = createAnchorAllocator();
    expect(a.allocate("Wnioski", null)).toBe("wnioski");
    expect(a.allocate("Wnioski", "  ")).toBe("wnioski-2");
  });
});
