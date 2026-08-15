import { describe, expect, it } from "vitest";
import type { BlocksDoc } from "@/lib/blocks/types";
import { localizedBlocksToBuilderDoc } from "@/lib/builder/migrate/blocksToBuilder";
import { toJson } from "@/lib/builder/types";
import {
  emptyBlocksDoc,
  hasBlocks,
  mergeLocalizedImport,
  readLocalizedBlocks,
  serializeLocalizedBlocks,
  type ExistingLocalized,
} from "@/lib/wp-import/localizedMerge";

const doc = (text: string): BlocksDoc => ({
  version: 1,
  blocks: [{ id: `b_${text}`, type: "paragraph", data: { html: text } }] as BlocksDoc["blocks"],
});

/** Wiersz, jaki import zastaje: PL i EN wypełnione ręcznie przez redakcję. */
const bilingualRow: ExistingLocalized = {
  title_pl: "Strategia UE",
  title_en: "EU strategy",
  excerpt_pl: "Zapowiedź PL",
  excerpt_en: "EN excerpt",
  blocks_data: toJson({ pl: doc("stare-pl"), en: doc("ręczne-en") }),
  builder_data: null,
};

const plImport = { language: "pl" as const, title: "Nowy tytuł", excerpt: "Nowa zapowiedź" };
const enImport = { language: "en" as const, title: "New title", excerpt: "New excerpt" };

describe("mergeLocalizedImport - import PL nie kasuje wersji EN", () => {
  it("zachowuje tytuł, zapowiedź i bloki EN", () => {
    const merged = mergeLocalizedImport({ ...plImport, doc: doc("nowe-pl") }, bilingualRow);

    expect(merged.title_en).toBe("EU strategy");
    expect(merged.excerpt_en).toBe("EN excerpt");
    expect(merged.blocks.en).toEqual(doc("ręczne-en"));
  });

  it("nadpisuje stronę PL wartościami z importu", () => {
    const merged = mergeLocalizedImport({ ...plImport, doc: doc("nowe-pl") }, bilingualRow);

    expect(merged.title_pl).toBe("Nowy tytuł");
    expect(merged.excerpt_pl).toBe("Nowa zapowiedź");
    expect(merged.blocks.pl).toEqual(doc("nowe-pl"));
  });

  it("raportuje ocalony język w wyniku (materiał do logu importu)", () => {
    const merged = mergeLocalizedImport({ ...plImport, doc: doc("nowe-pl") }, bilingualRow);

    expect(merged.counterpart).toBe("en");
    expect(merged.counterpartPreserved).toBe(true);
  });
});

describe("mergeLocalizedImport - symetria kierunku EN", () => {
  it("import EN zachowuje kompletną wersję PL", () => {
    const merged = mergeLocalizedImport({ ...enImport, doc: doc("new-en") }, bilingualRow);

    expect(merged.title_pl).toBe("Strategia UE");
    expect(merged.excerpt_pl).toBe("Zapowiedź PL");
    expect(merged.blocks.pl).toEqual(doc("stare-pl"));
    expect(merged.title_en).toBe("New title");
    expect(merged.blocks.en).toEqual(doc("new-en"));
    expect(merged.counterpart).toBe("pl");
  });
});

describe("mergeLocalizedImport - przypadki brzegowe", () => {
  it("nowy wpis (current = null) daje pustą drugą wersję bez gałęzi u wywołującego", () => {
    const merged = mergeLocalizedImport({ ...plImport, doc: doc("nowe-pl") }, null);

    expect(merged.title_en).toBe("");
    expect(merged.excerpt_en).toBeNull();
    expect(merged.blocks.en).toEqual(emptyBlocksDoc());
    expect(merged.counterpartPreserved).toBe(false);
  });

  it("pusty tytuł z WordPressa nie kasuje istniejącego tytułu importowanego języka", () => {
    const merged = mergeLocalizedImport(
      { language: "pl", title: "   ", excerpt: "", doc: doc("nowe-pl") },
      bilingualRow,
    );

    expect(merged.title_pl).toBe("Strategia UE");
    expect(merged.excerpt_pl).toBe("Zapowiedź PL");
  });

  it("pusta zapowiedź nie zapisuje pustego stringa przy braku poprzedniej wartości", () => {
    const merged = mergeLocalizedImport(
      { language: "pl", title: "Tytuł", excerpt: "   ", doc: doc("nowe-pl") },
      null,
    );

    expect(merged.excerpt_pl).toBeNull();
  });

  it("wiersz z samym PL nie zgłasza fałszywego 'ocalono EN'", () => {
    const merged = mergeLocalizedImport({ ...plImport, doc: doc("nowe-pl") }, {
      title_pl: "Strategia UE",
      title_en: "",
      excerpt_pl: "Zapowiedź PL",
      excerpt_en: null,
      blocks_data: toJson({ pl: doc("stare-pl"), en: emptyBlocksDoc() }),
    } satisfies ExistingLocalized);

    expect(merged.counterpartPreserved).toBe(false);
  });
});

describe("readLocalizedBlocks", () => {
  it("czyta kanoniczne blocks_data", () => {
    expect(readLocalizedBlocks(bilingualRow).en).toEqual(doc("ręczne-en"));
  });

  it("sięga do builder_data, gdy blocks_data jest puste (wpisy zmigrowane do buildera)", () => {
    const row: ExistingLocalized = {
      blocks_data: null,
      builder_data: toJson(
        localizedBlocksToBuilderDoc({ pl: doc("builder-pl"), en: doc("builder-en") }),
      ),
    };

    expect(readLocalizedBlocks(row)).toEqual({ pl: doc("builder-pl"), en: doc("builder-en") });
  });

  it("import PL nie gubi EN schowanego wyłącznie w builder_data", () => {
    const row: ExistingLocalized = {
      title_pl: "Strategia UE",
      title_en: "EU strategy",
      blocks_data: null,
      builder_data: toJson(
        localizedBlocksToBuilderDoc({ pl: doc("builder-pl"), en: doc("builder-en") }),
      ),
    };

    const merged = mergeLocalizedImport({ ...plImport, doc: doc("nowe-pl") }, row);

    expect(merged.blocks.en).toEqual(doc("builder-en"));
    expect(merged.counterpartPreserved).toBe(true);
  });

  it("zwraca pustą parę dla śmieci w kolumnach", () => {
    const row: ExistingLocalized = { blocks_data: toJson("nie-dokument"), builder_data: toJson(7) };

    expect(readLocalizedBlocks(row)).toEqual({ pl: emptyBlocksDoc(), en: emptyBlocksDoc() });
  });

  it("puste dokumenty nie są współdzieloną, mutowalną stałą", () => {
    const first = readLocalizedBlocks(null);
    first.pl.blocks.push({ id: "x", type: "paragraph", data: {} } as BlocksDoc["blocks"][number]);

    expect(readLocalizedBlocks(null).pl.blocks).toHaveLength(0);
  });
});

describe("serializeLocalizedBlocks", () => {
  it("buduje spójną parę blocks_data + builder_data z jednego dokumentu", () => {
    const blocks = { pl: doc("nowe-pl"), en: doc("ręczne-en") };
    const { blocks_data, builder_data } = serializeLocalizedBlocks(blocks);

    expect(blocks_data).toEqual(blocks);
    // Ta sama para językowa musi dać się odczytać z układu buildera.
    expect(readLocalizedBlocks({ blocks_data: null, builder_data })).toEqual(blocks);
  });
});

describe("hasBlocks", () => {
  it("odróżnia pustą skorupę od realnej treści", () => {
    expect(hasBlocks(emptyBlocksDoc())).toBe(false);
    expect(hasBlocks(doc("x"))).toBe(true);
    expect(hasBlocks(null)).toBe(false);
  });
});
