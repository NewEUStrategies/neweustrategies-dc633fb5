// MAILA NIE DA SIĘ WYCOFAĆ - a `parseEmailDoc` to brama, przez którą jsonb
// z bazy wchodzi do renderera wysyłki.
//
// `emailDoc.test.ts` obok pilnuje odrzucania śmieci, klamrowania odstępu,
// pól bloku listy wpisów i palety kolorów. Ten plik dobija gałęzie parsera,
// w które tamten nie wchodzi - a każda z nich ma inny skutek W SKRZYNCE:
//   * bloki nigdy nieparsowane w teście (akapit, obraz, przycisk, separator,
//     cytat, nota stopki) - wyrzucone przez parser znikają z wysyłki BEZ
//     ostrzeżenia, więc redaktor wysyła krótszy mail, niż zobaczył w edytorze,
//   * teksty dwujęzyczne podane jako nie-obiekt - muszą dać pustą parę, a nie
//     `undefined`, na którym renderer poleci w środku wysyłki,
//   * pusty/nietekstowy adres obrazu i linku - `null`, żeby renderer wyciął
//     blok, zamiast wysłać `<img src="undefined">`,
//   * poziom nagłówka i wyrównanie spoza dozwolonego zbioru,
//   * awaryjny generator identyfikatorów, gdy środowisko nie ma `crypto`.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmailBlock,
  parseEmailDoc,
  type EmailButtonBlock,
  type EmailDoc,
  type EmailFooterNoteBlock,
  type EmailHeadingBlock,
  type EmailImageBlock,
  type EmailParagraphBlock,
  type EmailPostListBlock,
  type EmailQuoteBlock,
} from "../emailDoc";

/** Parsuje jeden blok i oddaje go jako żądany typ (albo wywala test). */
function parseOne<T extends EmailDoc["blocks"][number]>(raw: unknown): T {
  const doc = parseEmailDoc({ version: 1, blocks: [raw] });
  expect(doc, "dokument nie sparsował się w ogóle").not.toBeNull();
  expect(doc?.blocks, "blok został wyrzucony przez parser").toHaveLength(1);
  return doc?.blocks[0] as T;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("bloki, których wyrzucenie skróciłoby wysłany mail bez ostrzeżenia", () => {
  it("akapit zachowuje treść obu języków i wyrównanie", () => {
    const block = parseOne<EmailParagraphBlock>({
      id: "p1",
      type: "paragraph",
      html: { pl: "<b>Wstęp</b>", en: "<b>Intro</b>" },
      align: "center",
    });
    expect(block.html).toEqual({ pl: "<b>Wstęp</b>", en: "<b>Intro</b>" });
    expect(block.align).toBe("center");
  });

  it("akapit z wyrównaniem spoza zbioru wraca do lewej, a nie do pustego stylu", () => {
    const block = parseOne<EmailParagraphBlock>({
      id: "p1",
      type: "paragraph",
      html: { pl: "x", en: "" },
      align: "justify",
    });
    expect(block.align).toBe("left");
  });

  it("obraz zachowuje adres, tekst alternatywny i link", () => {
    const block = parseOne<EmailImageBlock>({
      id: "i1",
      type: "image",
      url: "https://cdn.example.org/a.png",
      alt: "Baner",
      href: "https://example.org",
    });
    expect(block.url).toBe("https://cdn.example.org/a.png");
    expect(block.alt).toBe("Baner");
    expect(block.href).toBe("https://example.org");
  });

  it("adres obrazu z samych spacji albo nietekstowy staje się pustką, nie napisem", () => {
    // Inaczej renderer dostałby prawdę-podobny adres i wysłał zepsuty obrazek.
    const block = parseOne<EmailImageBlock>({
      id: "i1",
      type: "image",
      url: "   ",
      alt: 42,
      href: 7,
    });
    expect(block.url).toBeNull();
    expect(block.href).toBeNull();
    expect(block.alt).toBe("");
  });

  it("przycisk zachowuje podpis, adres i domyślnie stoi na środku", () => {
    const block = parseOne<EmailButtonBlock>({
      id: "b1",
      type: "button",
      label: { pl: "Czytaj", en: "Read" },
      url: "https://example.org/x",
    });
    expect(block.label).toEqual({ pl: "Czytaj", en: "Read" });
    expect(block.url).toBe("https://example.org/x");
    expect(block.align).toBe("center");
  });

  it("przycisk bez adresu ma pusty napis, a nie 'undefined' w linku", () => {
    const block = parseOne<EmailButtonBlock>({ id: "b1", type: "button" });
    expect(block.url).toBe("");
  });

  it("separator przechodzi jako blok bez pól", () => {
    const block = parseOne({ id: "d1", type: "divider" });
    expect(block).toEqual({ id: "d1", type: "divider" });
  });

  it("cytat zachowuje treść i podpis w obu językach", () => {
    const block = parseOne<EmailQuoteBlock>({
      id: "q1",
      type: "quote",
      text: { pl: "Zdanie", en: "Sentence" },
      attribution: { pl: "Jan", en: "John" },
    });
    expect(block.text).toEqual({ pl: "Zdanie", en: "Sentence" });
    expect(block.attribution).toEqual({ pl: "Jan", en: "John" });
  });

  it("nota stopki przechodzi z treścią obu języków", () => {
    const block = parseOne<EmailFooterNoteBlock>({
      id: "f1",
      type: "footer-note",
      html: { pl: "Wypisz się", en: "Unsubscribe" },
    });
    expect(block.html).toEqual({ pl: "Wypisz się", en: "Unsubscribe" });
  });
});

// ---------------------------------------------------------------------------
describe("teksty dwujęzyczne - renderer nie może dostać undefined", () => {
  it("tekst podany jako napis zamiast pary języków daje pustą parę", () => {
    const block = parseOne<EmailHeadingBlock>({ id: "h1", type: "heading", text: "Tytuł" });
    expect(block.text).toEqual({ pl: "", en: "" });
  });

  it("brakująca strona językowa jest pustym napisem, nie brakiem klucza", () => {
    const block = parseOne<EmailHeadingBlock>({
      id: "h1",
      type: "heading",
      text: { pl: "Tylko PL" },
    });
    expect(block.text).toEqual({ pl: "Tylko PL", en: "" });
  });

  it("poziom nagłówka spoza {1,2} schodzi do dwójki", () => {
    expect(parseOne<EmailHeadingBlock>({ id: "h", type: "heading", level: 7 }).level).toBe(2);
    expect(parseOne<EmailHeadingBlock>({ id: "h", type: "heading", level: 1 }).level).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("lista wpisów - pola, których zła wartość zmienia treść wysyłki", () => {
  it("tryb ręczny jest zachowany, każdy inny napis oznacza 'najnowsze'", () => {
    expect(parseOne<EmailPostListBlock>({ id: "l", type: "post-list", mode: "manual" }).mode).toBe(
      "manual",
    );
    expect(parseOne<EmailPostListBlock>({ id: "l", type: "post-list", mode: "losowe" }).mode).toBe(
      "latest",
    );
  });

  it("lista identyfikatorów podana jako nie-tablica daje pustą listę, nie wyjątek", () => {
    const block = parseOne<EmailPostListBlock>({
      id: "l",
      type: "post-list",
      mode: "manual",
      postIds: "post-1",
    });
    expect(block.postIds).toEqual([]);
  });

  it("układ kart jest zachowany, nieznany układ schodzi do listy", () => {
    expect(
      parseOne<EmailPostListBlock>({ id: "l", type: "post-list", layout: "cards" }).layout,
    ).toBe("cards");
    expect(
      parseOne<EmailPostListBlock>({ id: "l", type: "post-list", layout: "kafle" }).layout,
    ).toBe("list");
  });

  it("świadome wyłączenie zajawki jest zachowane, a nietekstowa flaga jej nie gasi", () => {
    // Rozróżnienie jest istotne: `false` to decyzja redaktora (same tytuły),
    // a śmieć w kolumnie nie może tej decyzji za niego podjąć.
    expect(
      parseOne<EmailPostListBlock>({ id: "l", type: "post-list", showExcerpt: false }).showExcerpt,
    ).toBe(false);
    expect(
      parseOne<EmailPostListBlock>({ id: "l", type: "post-list", showExcerpt: "nie" }).showExcerpt,
    ).toBe(true);
  });

  it("brak slugu kategorii to pustka, a nie napis 'null'", () => {
    const block = parseOne<EmailPostListBlock>({
      id: "l",
      type: "post-list",
      categorySlug: "  ",
    });
    expect(block.categorySlug).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("identyfikatory bloków", () => {
  it("blok bez identyfikatora dostaje własny - inaczej dwa bloki dzieliłyby klucz listy wpisów", () => {
    const block = parseOne({ type: "divider" });
    expect(block.id).toBeTruthy();
  });

  it("środowisko bez crypto.randomUUID nadal produkuje identyfikatory", () => {
    // Podgląd kampanii renderuje się także tam, gdzie WebCrypto nie ma
    // (starszy runtime serwerowy). Wyjątek w fabryce bloku zablokowałby edytor.
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const block = createEmailBlock("divider");
    expect(block.id).toMatch(/^blk-[0-9a-z]+$/);
  });
});
