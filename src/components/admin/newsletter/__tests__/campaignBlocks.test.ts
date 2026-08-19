// Reguły edytora bloków kampanii.
//
// Kampania jedzie do CAŁEJ listy i nie da się jej odwołać - dlatego każda z tych
// reguł ma tu przypadek graniczny, a nie tylko „szczęśliwą ścieżkę":
//   * duplikat musi być GŁĘBOKĄ kopią z nowym identyfikatorem, bo płytka
//     sprawia, że edycja jednego bloku zmienia drugi,
//   * klucz doboru wpisów decyduje, kiedy podgląd pyta serwer - za wąski
//     pokazuje stare wpisy, za szeroki strzela zapytaniem na każdy klawisz,
//   * limity 1-10 nie wywalają się przy śmieciach, tylko schodzą na sensowną
//     wartość: mail z pustą albo przerośniętą listą wpisów wychodzi po cichu.
import { describe, it, expect } from "vitest";
import * as rules from "@/components/admin/newsletter/campaignBlocks";
import {
  createEmailBlock,
  createDefaultEmailDoc,
  EMAIL_BLOCK_TYPES,
  type EmailBlock,
  type EmailDoc,
  type EmailPostListBlock,
} from "@/lib/newsletter/emailDoc";

/** Blok o znanym identyfikatorze - testy mówią o konkretnych elementach. */
function block(type: Parameters<typeof createEmailBlock>[0], id: string): EmailBlock {
  return { ...createEmailBlock(type), id } as EmailBlock;
}

function postList(overrides: Partial<EmailPostListBlock> = {}): EmailPostListBlock {
  return { ...(createEmailBlock("post-list") as EmailPostListBlock), ...overrides };
}

function docWith(blocks: EmailBlock[]): EmailDoc {
  return { ...createDefaultEmailDoc(), blocks };
}

describe("etykiety bloków", () => {
  it("KAŻDY typ bloku ma klucz etykiety - blok bez podpisu jest bezimienny na liście", () => {
    const bez = EMAIL_BLOCK_TYPES.filter((t) => !rules.blockLabelKey(t));

    expect(bez).toEqual([]);
    expect(EMAIL_BLOCK_TYPES.length).toBeGreaterThan(5);
  });

  it("klucze są UNIKALNE - dwa bloki o tym samym podpisie są nierozróżnialne", () => {
    const keys = EMAIL_BLOCK_TYPES.map((t) => rules.blockLabelKey(t));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("etykiety wskazują KLUCZE słownika, nie gotowe napisy", () => {
    // Napisy w tablicy byłyby równoległym słownikiem poza zasięgiem bramki i18n.
    for (const type of EMAIL_BLOCK_TYPES) {
      expect(rules.blockLabelKey(type)).toMatch(/^adminNewsletter\.blocks\./);
    }
    expect(rules.blockLabelKey("heading")).toBe("adminNewsletter.blocks.heading");
  });

  it("typ nieznany palecie oddaje NULL, a nie pusty napis", () => {
    expect(rules.blockLabelKey("nie-ma-takiego" as never)).toBeNull();
  });
});

describe("dodawanie, aktualizacja i usuwanie bloków", () => {
  it("nowy blok ląduje na KOŃCU dokumentu", () => {
    const blocks = [block("heading", "a")];

    const next = rules.appendBlock(blocks, block("paragraph", "b"));

    expect(next.map((b) => b.id)).toEqual(["a", "b"]);
    expect(blocks).toHaveLength(1);
  });

  it("aktualizacja podmienia TYLKO blok o tym identyfikatorze", () => {
    const blocks = [block("heading", "a"), block("heading", "b")];
    const updated = { ...blocks[0]!, level: 2 } as EmailBlock;

    const next = rules.updateBlock(blocks, updated);

    expect(next[0]).toBe(updated);
    expect(next[1]).toBe(blocks[1]);
  });

  it("aktualizacja bloku, którego nie ma, nie dokłada go do dokumentu", () => {
    const blocks = [block("heading", "a")];

    const next = rules.updateBlock(blocks, block("paragraph", "nie-ma"));

    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("a");
  });

  it("usunięcie wycina jeden blok, resztę zostawia bez zmian", () => {
    const blocks = [block("heading", "a"), block("paragraph", "b"), block("divider", "c")];

    const next = rules.removeBlock(blocks, "b");

    expect(next.map((b) => b.id)).toEqual(["a", "c"]);
    expect(blocks).toHaveLength(3);
  });

  it("usunięcie nieznanego bloku nie rusza listy", () => {
    const blocks = [block("heading", "a")];

    expect(rules.removeBlock(blocks, "nie-ma").map((b) => b.id)).toEqual(["a"]);
  });
});

describe("duplikowanie bloku", () => {
  it("kopia ląduje ZARAZ ZA oryginałem", () => {
    const blocks = [block("heading", "a"), block("divider", "b")];

    const result = rules.duplicateBlock(blocks, "a")!;

    expect(result.blocks.map((b) => b.id)).toEqual(["a", result.copyId, "b"]);
    expect(result.copyId).not.toBe("a");
  });

  it("kopia jest GŁĘBOKA - edycja jednej nie rusza drugiej", () => {
    // Kopia płytka dzieli obiekt `{ pl, en }` z oryginałem: redaktor poprawia
    // nagłówek i po cichu psuje kopię, której w tym momencie nie widzi.
    const heading = {
      ...createEmailBlock("heading"),
      id: "a",
      text: { pl: "Tytuł", en: "Title" },
    } as EmailBlock;

    const result = rules.duplicateBlock([heading], "a")!;
    const copy = result.blocks[1] as { text: { pl: string } };
    copy.text.pl = "Zmieniony";

    expect((heading as { text: { pl: string } }).text.pl).toBe("Tytuł");
    expect(copy.text.pl).toBe("Zmieniony");
  });

  it("kopia zachowuje treść i typ oryginału", () => {
    const button = {
      ...createEmailBlock("button"),
      id: "a",
      url: "https://example.test/akcja",
    } as EmailBlock;

    const copy = rules.duplicateBlock([button], "a")!.blocks[1] as { type: string; url: string };

    expect(copy.type).toBe("button");
    expect(copy.url).toBe("https://example.test/akcja");
  });

  it("kopia bloku „najnowsze wpisy” nie dzieli tablicy identyfikatorów", () => {
    const list = postList({ id: "a", mode: "manual", postIds: ["p1", "p2"] });

    const copy = rules.duplicateBlock([list], "a")!.blocks[1] as EmailPostListBlock;
    copy.postIds.push("p3");

    expect(list.postIds).toEqual(["p1", "p2"]);
    expect(copy.postIds).toHaveLength(3);
  });

  it("duplikowanie nieznanego bloku oddaje NULL - dokument zostaje nietknięty", () => {
    const blocks = [block("heading", "a")];

    expect(rules.duplicateBlock(blocks, "nie-ma")).toBeNull();
    expect(blocks).toHaveLength(1);
  });
});

describe("przestawianie bloków", () => {
  const blocks = [block("heading", "a"), block("paragraph", "b"), block("divider", "c")];

  it("blok przenoszony w dół zajmuje pozycję celu", () => {
    expect(rules.reorderBlocks(blocks, "a", "c")!.map((b) => b.id)).toEqual(["b", "c", "a"]);
  });

  it("blok przenoszony w górę też trafia na pozycję celu", () => {
    expect(rules.reorderBlocks(blocks, "c", "a")!.map((b) => b.id)).toEqual(["c", "a", "b"]);
  });

  it("upuszczenie POZA listą oddaje NULL - nie zapisujemy nowego stanu bez zmiany", () => {
    // Każdy zapis to nowy stan formularza (i zapalony przycisk „zapisz").
    expect(rules.reorderBlocks(blocks, "a", null)).toBeNull();
  });

  it("upuszczenie NA SIEBIE oddaje NULL", () => {
    expect(rules.reorderBlocks(blocks, "a", "a")).toBeNull();
  });

  it("nieznany blok źródłowy lub docelowy oddaje NULL", () => {
    expect(rules.reorderBlocks(blocks, "nie-ma", "a")).toBeNull();
    expect(rules.reorderBlocks(blocks, "a", "nie-ma")).toBeNull();
  });

  it("przestawienie nie mutuje listy wejściowej", () => {
    rules.reorderBlocks(blocks, "a", "c");

    expect(blocks.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });
});

describe("klucz doboru wpisów dla podglądu", () => {
  it("bierze tylko bloki „najnowsze wpisy”", () => {
    const doc = docWith([block("heading", "h"), postList({ id: "pl1" }), block("divider", "d")]);

    const selectors = rules.postListSelectors(doc);

    expect(selectors).toHaveLength(1);
    expect(selectors[0]!.id).toBe("pl1");
  });

  it("dokument bez takich bloków daje PUSTY klucz - podgląd nie pyta serwera", () => {
    const doc = docWith([block("heading", "h")]);

    expect(rules.postListSelectors(doc)).toEqual([]);
  });

  it("zmiana KATEGORII zmienia klucz - inaczej podgląd pokazywałby stare wpisy", () => {
    const a = docWith([postList({ id: "p", categorySlug: "eu" })]);
    const b = docWith([postList({ id: "p", categorySlug: "pl" })]);

    expect(JSON.stringify(rules.postListSelectors(a))).not.toBe(
      JSON.stringify(rules.postListSelectors(b)),
    );
  });

  it("zmiana LICZBY, TRYBU i ręcznych identyfikatorów też zmienia klucz", () => {
    const base = docWith([postList({ id: "p", count: 3, mode: "latest", postIds: [] })]);
    const key = (d: EmailDoc) => JSON.stringify(rules.postListSelectors(d));

    expect(key(docWith([postList({ id: "p", count: 5 })]))).not.toBe(key(base));
    expect(key(docWith([postList({ id: "p", mode: "manual" })]))).not.toBe(key(base));
    expect(key(docWith([postList({ id: "p", postIds: ["x"] })]))).not.toBe(key(base));
  });

  it("zmiana NAGŁÓWKA sekcji NIE zmienia klucza - każdy klawisz nie strzela do bazy", () => {
    const a = docWith([postList({ id: "p", heading: { pl: "A", en: "A" } })]);
    const b = docWith([postList({ id: "p", heading: { pl: "Zupełnie inny", en: "Different" } })]);

    expect(rules.postListSelectors(a)).toEqual(rules.postListSelectors(b));
  });

  it("zmiana UKŁADU i zapowiedzi też nie zmienia klucza", () => {
    const a = docWith([postList({ id: "p", layout: "list", showExcerpt: true })]);
    const b = docWith([postList({ id: "p", layout: "cards", showExcerpt: false })]);

    expect(rules.postListSelectors(a)).toEqual(rules.postListSelectors(b));
  });
});

describe("limity liczbowe", () => {
  it("liczba wpisów trzyma się zakresu 1-10", () => {
    expect(rules.clampPostCount("1")).toBe(1);
    expect(rules.clampPostCount("10")).toBe(10);
    expect(rules.clampPostCount("11")).toBe(10);
    expect(rules.clampPostCount("-4")).toBe(1);
  });

  it("puste pole i śmieci schodzą na domyślne 3, a nie na NaN", () => {
    // NaN w dokumencie wyszedłby mailem z pustą listą wpisów.
    expect(rules.clampPostCount("")).toBe(rules.DEFAULT_POST_COUNT);
    expect(rules.clampPostCount("abc")).toBe(rules.DEFAULT_POST_COUNT);
    expect(rules.clampPostCount("0")).toBe(rules.DEFAULT_POST_COUNT);
  });

  it("wysokość odstępu ze śmieci schodzi na domyślne 24 px", () => {
    expect(rules.spacerSize("40")).toBe(40);
    expect(rules.spacerSize("")).toBe(rules.DEFAULT_SPACER_SIZE);
    expect(rules.spacerSize("abc")).toBe(rules.DEFAULT_SPACER_SIZE);
  });
});

describe("ręczny wybór wpisów", () => {
  it("wpis nieobecny na liście jest DOKŁADANY", () => {
    expect(rules.togglePostId(["a"], "b")).toEqual(["a", "b"]);
  });

  it("wpis obecny jest ZDEJMOWANY", () => {
    expect(rules.togglePostId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("ponad limit 10 lista jest UCINANA, a nie odrzucana po cichu przy zapisie", () => {
    const dziesiec = Array.from({ length: 10 }, (_, i) => `p${i}`);

    const next = rules.togglePostId(dziesiec, "jedenasty");

    expect(next).toHaveLength(10);
    expect(next).not.toContain("jedenasty");
  });

  it("zdjęcie wpisu z pełnej listy zwalnia miejsce", () => {
    const dziesiec = Array.from({ length: 10 }, (_, i) => `p${i}`);

    const next = rules.togglePostId(dziesiec, "p0");

    expect(next).toHaveLength(9);
    expect(rules.togglePostId(next, "nowy")).toHaveLength(10);
  });

  it("przełączanie nie mutuje wejścia", () => {
    const selected = ["a"];

    rules.togglePostId(selected, "b");

    expect(selected).toEqual(["a"]);
  });
});

describe("puste pola tekstowe", () => {
  it("pusty napis zapisuje się jako NULL - „brak” to nie „nic”", () => {
    expect(rules.nullIfEmpty("")).toBeNull();
    expect(rules.nullIfEmpty("eu-policy")).toBe("eu-policy");
  });
});
