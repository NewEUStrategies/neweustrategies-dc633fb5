// Tokeny dynamiczne (`{post.title}`, `{author.name}`, `{year}`, ...) - to one
// pozwalają redaktorowi wstawić dane wpisu w treść widgetu. Plik startował
// z 5,9% linii i 0 z 9 funkcji, mimo że jego wynik czyta czytelnik strony.
//
// Najważniejszy kontrakt tego modułu jest NIEOCZYWISTY: nieznany token oraz
// token, który nie ma wartości, zostają w tekście W POSTACI SUROWEJ. To celowa
// decyzja („autor ma zobaczyć literówkę"), a nie brak obsługi błędu - i właśnie
// dlatego wymaga testu, bo wygląda jak niedokończona implementacja.
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DYNAMIC_TAG_GROUPS,
  listDynamicTags,
  resolveDynamicText,
  resolveDynamicList,
} from "../dynamicText";
import type { CurrentPostCtx } from "@/lib/content-model/postContext";

/** Minimalny kontekst wpisu - pola dokładamy per test. */
function ctx(over: Record<string, unknown> = {}): CurrentPostCtx {
  return over as unknown as CurrentPostCtx;
}

const pl = (s: string, c: CurrentPostCtx | null = null) => resolveDynamicText(s, c, "pl");
const en = (s: string, c: CurrentPostCtx | null = null) => resolveDynamicText(s, c, "en");

afterEach(() => {
  vi.useRealTimers();
});

describe("katalog tokenów", () => {
  it("ma 4 grupy i 15 tagów", () => {
    expect(DYNAMIC_TAG_GROUPS).toHaveLength(4);
    expect(listDynamicTags()).toHaveLength(15);
  });

  it("każdy tag ma token w klamrach i niepustą etykietę", () => {
    for (const t of listDynamicTags()) {
      expect(t.token).toMatch(/^\{[a-zA-Z][a-zA-Z0-9._-]*\}$/);
      expect(t.label.length).toBeGreaterThan(0);
    }
  });

  it("tokeny są unikalne", () => {
    const tokens = listDynamicTags().map((t) => t.token);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("każda grupa ma etykietę PL i EN", () => {
    // Bramka `check:i18n-parity` nie widzi tych napisów (to dane, nie klucze
    // i18n), więc parytet trzeba pilnować tutaj.
    for (const g of DYNAMIC_TAG_GROUPS) {
      expect(g.labelPl.length).toBeGreaterThan(0);
      expect(g.labelEn.length).toBeGreaterThan(0);
    }
  });

  it("KAŻDY token z katalogu jest obsługiwany przez resolver", () => {
    // Token w katalogu, którego resolver nie zna, to martwa pozycja w
    // podpowiadaczu: redaktor wstawia ją i widzi surowe `{...}` na stronie.
    const full = ctx({
      title_pl: "T",
      title_en: "T",
      excerpt_pl: "E",
      excerpt_en: "E",
      slug: "s",
      publishedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
      readingTimeMin: 5,
      viewCount: 10,
      author: { name: "A", jobTitle: "R", company: "C" },
      categories: [{ name: "K" }],
      tags: [{ name: "G" }],
      archive: { label: "L" },
    });
    for (const t of listDynamicTags()) {
      expect(resolveDynamicText(t.token, full, "pl")).not.toBe(t.token);
    }
  });
});

describe("resolveDynamicText - wejścia brzegowe", () => {
  it("pusty / brakujący tekst daje pusty łańcuch", () => {
    expect(pl("")).toBe("");
    expect(resolveDynamicText(undefined, null, "pl")).toBe("");
    expect(resolveDynamicText(null, null, "pl")).toBe("");
  });

  it("tekst BEZ klamry wraca bez zmian", () => {
    expect(pl("Zwykły tytuł")).toBe("Zwykły tytuł");
  });

  it("NIEZNANY token zostaje w tekście surowy", () => {
    expect(pl("{nie.ma.takiego}", ctx({ title_pl: "X" }))).toBe("{nie.ma.takiego}");
  });

  it("znany token BEZ wartości w kontekście też zostaje surowy", () => {
    // Kontrakt: podglądowi nie wolno zapaść się w pustkę - autor musi widzieć,
    // że token nie ma czym się wypełnić.
    expect(pl("{post.title}", null)).toBe("{post.title}");
    expect(pl("{post.title}", ctx({}))).toBe("{post.title}");
    expect(pl("{author.name}", ctx({ author: {} }))).toBe("{author.name}");
  });

  it("pusty łańcuch w kontekście jest traktowany jak brak wartości", () => {
    expect(pl("{post.slug}", ctx({ slug: "" }))).toBe("{post.slug}");
  });

  it("nie rusza klamer, które nie są tokenem", () => {
    expect(pl("{ post.title }")).toBe("{ post.title }");
    expect(pl("{}")).toBe("{}");
    expect(pl("{1abc}")).toBe("{1abc}");
    expect(pl("{{post.slug}}", ctx({ slug: "s" }))).toBe("{s}");
  });

  it("podmienia WSZYSTKIE wystąpienia w jednym tekście", () => {
    const c = ctx({ slug: "abc" });
    expect(pl("{post.slug}-{post.slug}", c)).toBe("abc-abc");
  });

  it("miesza tekst statyczny z tokenami", () => {
    const c = ctx({ title_pl: "Tytuł", author: { name: "Anna" } });
    expect(pl("„{post.title}” - {author.name}", c)).toBe("„Tytuł” - Anna");
  });
});

describe("resolveDynamicText - język", () => {
  it("bierze wariant żądanego języka", () => {
    const c = ctx({ title_pl: "PL", title_en: "EN" });
    expect(pl("{post.title}", c)).toBe("PL");
    expect(en("{post.title}", c)).toBe("EN");
  });

  it("EN spada na PL, gdy brak wersji angielskiej", () => {
    const c = ctx({ title_pl: "PL" });
    expect(en("{post.title}", c)).toBe("PL");
  });

  it("PL spada na EN, gdy brak wersji polskiej", () => {
    // Ostatnie ogniwo fallbacku - treść tworzona tylko po angielsku nie może
    // zniknąć w widoku PL.
    const c = ctx({ title_en: "EN only" });
    expect(pl("{post.title}", c)).toBe("EN only");
  });

  it("ten sam łańcuch fallbacków obowiązuje dla zajawki", () => {
    expect(en("{post.excerpt}", ctx({ excerpt_pl: "ZajawkaPL" }))).toBe("ZajawkaPL");
    expect(pl("{post.excerpt}", ctx({ excerpt_en: "ExcerptEN" }))).toBe("ExcerptEN");
  });
});

describe("resolveDynamicText - tokeny liczbowe i daty", () => {
  it("czas czytania jest lokalizowany", () => {
    const c = ctx({ readingTimeMin: 7 });
    expect(pl("{post.reading}", c)).toBe("7 min czytania");
    expect(en("{post.reading}", c)).toBe("7 min read");
  });

  it("czas czytania równy 0 jest wartością POPRAWNĄ, nie brakiem", () => {
    // `typeof === "number"`, nie prawdziwościowość - zero minut to zero, a nie
    // „nie policzono".
    expect(pl("{post.reading}", ctx({ readingTimeMin: 0 }))).toBe("0 min czytania");
  });

  it("licznik odsłon 0 również nie znika", () => {
    // Zero przechodzi przez DWA sita: `typeof === "number"` w resolverze i
    // `val.length > 0` w podmieniaczu (bo `String(0)` to niepusty „0").
    // Gdyby którekolwiek sprawdzało prawdziwościowość wartości, wpis z zerem
    // odsłon pokazywałby czytelnikowi surowe `{post.views}`.
    expect(pl("{post.views}", ctx({ viewCount: 0 }))).toBe("0");
  });

  it("licznik odsłon jest zamieniany na tekst", () => {
    expect(pl("{post.views}", ctx({ viewCount: 1234 }))).toBe("1234");
  });

  it("data publikacji jest formatowana per język", () => {
    const c = ctx({ publishedAt: "2026-03-05T10:00:00.000Z" });
    expect(pl("{post.date}", c)).toContain("2026");
    expect(en("{post.date}", c)).toContain("2026");
    // Miesiąc słownie - inny w obu językach.
    expect(pl("{post.date}", c)).not.toBe(en("{post.date}", c));
  });

  it("data aktualizacji korzysta z tego samego formatera", () => {
    const c = ctx({ updatedAt: "2026-03-05T10:00:00.000Z" });
    expect(pl("{post.updated}", c)).toContain("2026");
  });

  it("USZKODZONA data wraca w postaci surowej, zamiast wysypać render", () => {
    // `Intl` na nieprawidłowej dacie rzuca - blok `catch` oddaje wtedy wejście.
    // Bez tego jeden zły rekord w bazie zdejmowałby całą stronę.
    const out = pl("{post.date}", ctx({ publishedAt: "to-nie-data" }));
    expect(out).toBe("to-nie-data");
  });

  it("`{year}` bierze bieżący rok", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-07-04T12:00:00.000Z"));
    expect(pl("© {year}")).toBe("© 2031");
  });

  it("`{date.today}` bierze bieżącą datę i nie zależy od kontekstu", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-07-04T12:00:00.000Z"));
    expect(pl("{date.today}", null)).toContain("2031");
  });
});

describe("resolveDynamicText - taksonomie i archiwum", () => {
  it("bierze PIERWSZĄ kategorię i pierwszy tag", () => {
    const c = ctx({
      categories: [{ name: "Energia" }, { name: "Klimat" }],
      tags: [{ name: "UE" }, { name: "Rada" }],
    });
    expect(pl("{category.name}", c)).toBe("Energia");
    expect(pl("{tag.name}", c)).toBe("UE");
  });

  it("pusta lista taksonomii zostawia token surowy", () => {
    expect(pl("{category.name}", ctx({ categories: [] }))).toBe("{category.name}");
    expect(pl("{tag.name}", ctx({ tags: [] }))).toBe("{tag.name}");
  });

  it("etykieta archiwum jest czytana z kontekstu", () => {
    expect(pl("{archive.label}", ctx({ archive: { label: "Kategoria: Energia" } }))).toBe(
      "Kategoria: Energia",
    );
  });

  it("pola autora mapują się na osobne tokeny", () => {
    const c = ctx({ author: { name: "Anna", jobTitle: "Analityk", company: "NES" } });
    expect(pl("{author.name}", c)).toBe("Anna");
    expect(pl("{author.role}", c)).toBe("Analityk");
    expect(pl("{author.company}", c)).toBe("NES");
  });
});

describe("resolveDynamicList", () => {
  it("pusta lub brakująca lista daje pustą tablicę", () => {
    expect(resolveDynamicList(undefined, null, "pl")).toEqual([]);
    expect(resolveDynamicList([], null, "pl")).toEqual([]);
  });

  it("rozwiązuje każdy element osobno", () => {
    const c = ctx({ slug: "abc", author: { name: "Anna" } });
    expect(resolveDynamicList(["{post.slug}", "x", "{author.name}"], c, "pl")).toEqual([
      "abc",
      "x",
      "Anna",
    ]);
  });

  it("nie zjada elementów, których nie da się rozwiązać", () => {
    expect(resolveDynamicList(["{post.title}", ""], null, "pl")).toEqual(["{post.title}", ""]);
  });
});
