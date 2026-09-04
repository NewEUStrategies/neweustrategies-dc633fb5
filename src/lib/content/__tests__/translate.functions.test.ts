// CIAŁO handlera server fn `translatePostDraft`
// (`src/lib/content/translate.functions.ts`) - przycisk „przetłumacz szkic"
// w edytorze wpisu. Funkcja jest STATELESS (nic nie zapisuje), ale to ona
// decyduje, CO poleci do płatnej bramki AI i CO wróci do formularza redakcji.
// Do tej pory nie miała ani jednego wywołania w testach (0/2 funkcji,
// 0/10 gałęzi), więc wszystkie jej bariery były deklaracją, nie faktem.
//
// CO DOWODZI TEN PLIK:
//   * KONTRAKT WEJŚCIA (walidator zod `TranslateInputSchema`): domyślne puste
//     pola przy braku wejścia oraz sufity długości - tytuł 300, zajawka 2000,
//     najwyżej SIEDEM punktów po 500 znaków, tytuł SEO 300, opis SEO 500,
//     treść 200 000. Sufity są jedyną barierą przed wysłaniem całej książki
//     do modelu na koszt organizacji, a odrzucenie następuje PRZED limiterem
//     (asercja: limiter nie został nawet zapytany);
//   * DRUGI, NIEZALEŻNY sufit: budżet segmentów 120 000 znaków
//     (`translateSegments`) jest OSTRZEJSZY niż 200 000 z walidatora, więc
//     maksymalna dopuszczona treść i tak nie poleci do bramki;
//   * ODMOWĘ LIMITERA (`post.translate`, max 10) jako twardy koniec pracy -
//     przy odmowie tłumacz NIE jest wołany, czyli żądanie nie kosztuje;
//   * ODMOWĘ PUSTEJ TREŚCI: brak czegokolwiek do tłumaczenia kończy się
//     dwujęzycznym komunikatem, a nie pustym wywołaniem bramki AI (białe
//     znaki liczą się jako brak treści);
//   * PRZEBIEG ŚCIEŻKI SZCZĘŚLIWEJ: segmenty PL trafiają do
//     `translateSegmentsPlToEn` w stałej kolejności, a odpowiedź wraca
//     odłożona w pola EN i w KOPIĘ dokumentu bloków (dokument PL z edytora
//     zostaje nietknięty, URL-e i konfiguracje bloków bez zmian);
//   * PROPAGACJĘ błędów bramki i niezgodnej liczby segmentów - lepszy błąd
//     w edytorze niż przesunięte tłumaczenia zapisane w treści.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//   * AUTORYZACJI. Atrapa `createServerFn` (`src/test/serverFn.ts`) NIE
//     wykonuje middleware. Jedyna asercja o autoryzacji to `serverFnMeta()`:
//     funkcja DEKLARUJE `requireStaff` i metodę POST; że brama trzyma na żywym
//     SSR, pilnuje `check:authz-snapshot`;
//   * SEGMENTACJI per typ bloku (whitelist pól, kolumny, FAQ) - to
//     `translateSegments.test.ts`, tu przez handler idzie tylko tyle
//     dokumentu, ile potrzeba, by dowieść przejścia przez parser bloków;
//   * SAMEJ BRAMKI AI (`aiTranslate.server`: porcjowanie, zdejmowanie płotków
//     kodu, retry) - jest zaatrapowana, bo to JEDYNY moduł w tej ścieżce,
//     który sięgnąłby do sieci.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  translateSegmentsPlToEn: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/server/aiTranslate.server", () => ({
  translateSegmentsPlToEn: h.translateSegmentsPlToEn,
}));

import { requireStaff } from "@/integrations/supabase/require-staff";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import { translatePostDraft } from "@/lib/content/translate.functions";

const USER = "11111111-1111-4111-8111-111111111111";
const EMPTY_CONTENT = "Brak treści PL do przetłumaczenia / no Polish content to translate";

/** Poprawny dokument bloków - przechodzi przez PRAWDZIWY `safeParseBlocks`. */
function blocksDoc() {
  return {
    version: 1,
    blocks: [
      { id: "b1", type: "heading", data: { level: 2, text: "Nagłówek PL" } },
      { id: "b2", type: "paragraph", data: { html: "<p>Akapit <strong>PL</strong></p>" } },
      {
        id: "b3",
        type: "image",
        data: { url: "https://example.org/wykres.jpg", alt: "Opis obrazka", caption: "Podpis" },
      },
    ],
  };
}

/** Ostatnia lista segmentów, jaką dostał tłumacz. */
function sentSegments(): string[] {
  const call = h.translateSegmentsPlToEn.mock.calls.at(-1);
  return (call?.[0] ?? []) as string[];
}

beforeEach(() => {
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.translateSegmentsPlToEn
    .mockReset()
    .mockImplementation(async (texts: readonly string[]) => texts.map((t) => `EN(${t})`));
  setServerFnContext({ supabase: { __client: "user-scoped" }, userId: USER });
});

afterEach(() => {
  resetServerFnContext();
});

describe("obudowa server fn", () => {
  it("translatePostDraft to POST z middleware requireStaff I walidatorem wejścia", () => {
    const meta = serverFnMeta(translatePostDraft);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toContain(requireStaff);
    expect(meta?.hasValidator).toBe(true);
  });
});

describe("walidator wejścia - wartości domyślne", () => {
  it("BEZ wejścia wszystkie pola PL są puste, więc nie ma czego tłumaczyć", async () => {
    await expect(translatePostDraft({ data: undefined })).rejects.toThrow(EMPTY_CONTENT);
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("pusty obiekt daje ten sam komplet domyślnych pól co brak wejścia", async () => {
    await expect(translatePostDraft({ data: {} })).rejects.toThrow(EMPTY_CONTENT);
  });

  it("sam biały znak w tytule to nadal BRAK treści do przetłumaczenia", async () => {
    await expect(translatePostDraft({ data: { title_pl: "   " } })).rejects.toThrow(EMPTY_CONTENT);
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("pola nullowalne przyjmują null i nie tworzą segmentów", async () => {
    await translatePostDraft({
      data: {
        title_pl: "Tytuł",
        excerpt_pl: null,
        seo_title_pl: null,
        seo_description_pl: null,
        content_pl: null,
        blocks_doc_pl: null,
      },
    });
    expect(sentSegments()).toEqual(["Tytuł"]);
  });
});

describe("walidator wejścia - sufity długości", () => {
  it("tytuł 300 znaków przechodzi, 301 jest ODRZUCONY zanim ruszy limiter", async () => {
    await translatePostDraft({ data: { title_pl: "a".repeat(300) } });
    expect(sentSegments()).toEqual(["a".repeat(300)]);

    h.rateLimit.mockClear();
    await expect(translatePostDraft({ data: { title_pl: "a".repeat(301) } })).rejects.toThrow();
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.translateSegmentsPlToEn).toHaveBeenCalledTimes(1);
  });

  it("zajawka 2000 znaków przechodzi, 2001 jest ODRZUCONA", async () => {
    await translatePostDraft({ data: { excerpt_pl: "b".repeat(2000) } });
    expect(sentSegments()).toEqual(["b".repeat(2000)]);
    await expect(translatePostDraft({ data: { excerpt_pl: "b".repeat(2001) } })).rejects.toThrow();
  });

  it("SIEDEM punktów przechodzi, ósmy jest ODRZUCONY", async () => {
    const seven = Array.from({ length: 7 }, (_, i) => `Punkt ${i + 1}`);
    await translatePostDraft({ data: { takeaways_pl: seven } });
    expect(sentSegments()).toEqual(seven);
    await expect(
      translatePostDraft({ data: { takeaways_pl: [...seven, "Punkt 8"] } }),
    ).rejects.toThrow();
  });

  it("punkt 500 znaków przechodzi, 501 jest ODRZUCONY", async () => {
    await translatePostDraft({ data: { takeaways_pl: ["c".repeat(500)] } });
    expect(sentSegments()).toEqual(["c".repeat(500)]);
    await expect(
      translatePostDraft({ data: { takeaways_pl: ["c".repeat(501)] } }),
    ).rejects.toThrow();
  });

  it("tytuł SEO ma sufit 300, opis SEO 500 - KAZDY liczony osobno", async () => {
    await translatePostDraft({
      data: { seo_title_pl: "d".repeat(300), seo_description_pl: "e".repeat(500) },
    });
    expect(sentSegments()).toEqual(["d".repeat(300), "e".repeat(500)]);
    await expect(translatePostDraft({ data: { seo_title_pl: "d".repeat(301) } })).rejects.toThrow();
    await expect(
      translatePostDraft({ data: { seo_description_pl: "e".repeat(501) } }),
    ).rejects.toThrow();
  });

  it("treść 200 001 znaków jest ODRZUCONA przez walidator - limiter nie jest pytany", async () => {
    await expect(
      translatePostDraft({ data: { content_pl: "f".repeat(200_001) } }),
    ).rejects.toThrow();
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("treść 200 000 znaków mija walidator, ale odbija się o budżet segmentów", async () => {
    // Dwa sufity, świadomie różne: walidator 200 000, `translateSegments`
    // 120 000. Maksymalna dopuszczona treść NIE poleci więc do bramki AI.
    await expect(translatePostDraft({ data: { content_pl: "f".repeat(200_000) } })).rejects.toThrow(
      /przekracza limit tłumaczenia/,
    );
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("ODRZUCA tytuł podany liczbą i punkty podane napisem", async () => {
    await expect(translatePostDraft({ data: { title_pl: 12 } })).rejects.toThrow();
    await expect(translatePostDraft({ data: { takeaways_pl: "Punkt" } })).rejects.toThrow();
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });
});

describe("limit tempa", () => {
  it("odmowa limitera KOŃCZY żądanie i tłumacz NIE jest wołany", async () => {
    h.rateLimit.mockResolvedValue(false);
    await expect(translatePostDraft({ data: { title_pl: "Tytuł" } })).rejects.toThrow(
      "Rate limit exceeded - please slow down",
    );
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("limiter liczy zakres post.translate na wywołującego z sufitem dziesięciu", async () => {
    await translatePostDraft({ data: { title_pl: "Tytuł" } });
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "post.translate",
      subjectId: USER,
      max: 10,
    });
  });
});

describe("tłumaczenie szkicu", () => {
  it("segmenty PL idą do tłumacza w stałej kolejności, a wynik wraca w polach EN", async () => {
    const out = await translatePostDraft({
      data: {
        title_pl: "Tytuł analizy",
        excerpt_pl: "Zajawka",
        takeaways_pl: ["Punkt pierwszy", "   ", "Punkt trzeci"],
        seo_title_pl: "Tytuł SEO",
        seo_description_pl: "Opis SEO",
        content_pl: "<p>Treść</p>",
      },
    });

    expect(h.translateSegmentsPlToEn).toHaveBeenCalledTimes(1);
    expect(sentSegments()).toEqual([
      "Tytuł analizy",
      "Zajawka",
      "Punkt pierwszy",
      "Punkt trzeci",
      "Tytuł SEO",
      "Opis SEO",
      "<p>Treść</p>",
    ]);
    expect(out).toEqual({
      title_en: "EN(Tytuł analizy)",
      excerpt_en: "EN(Zajawka)",
      takeaways_en: ["EN(Punkt pierwszy)", "EN(Punkt trzeci)"],
      seo_title_en: "EN(Tytuł SEO)",
      seo_description_en: "EN(Opis SEO)",
      content_en: "EN(<p>Treść</p>)",
      blocks_en: null,
    });
  });

  it("BEZ dokumentu bloków pole blocks_en wraca jako null", async () => {
    const out = await translatePostDraft({ data: { title_pl: "Tytuł" } });
    expect(out.blocks_en).toBeNull();
  });

  it("poprawny dokument bloków wraca przetłumaczony ze strukturą 1:1", async () => {
    const out = await translatePostDraft({
      data: { title_pl: "Tytuł", blocks_doc_pl: blocksDoc() },
    });

    expect(sentSegments()).toEqual([
      "Tytuł",
      "Nagłówek PL",
      "<p>Akapit <strong>PL</strong></p>",
      "Podpis",
      "Opis obrazka",
    ]);
    expect(out.blocks_en).toEqual([
      { id: "b1", type: "heading", data: { level: 2, text: "EN(Nagłówek PL)" } },
      { id: "b2", type: "paragraph", data: { html: "EN(<p>Akapit <strong>PL</strong></p>)" } },
      {
        id: "b3",
        type: "image",
        data: {
          url: "https://example.org/wykres.jpg",
          alt: "EN(Opis obrazka)",
          caption: "EN(Podpis)",
        },
      },
    ]);
  });

  it("NIE mutuje dokumentu bloków przekazanego z edytora", async () => {
    const doc = blocksDoc();
    await translatePostDraft({ data: { title_pl: "Tytuł", blocks_doc_pl: doc } });
    expect(doc).toEqual(blocksDoc());
  });

  it("dokument bloków bez żadnego tekstu i bez metadanych to BRAK treści", async () => {
    await expect(
      translatePostDraft({
        data: {
          blocks_doc_pl: { version: 1, blocks: [{ id: "s1", type: "separator", data: {} }] },
        },
      }),
    ).rejects.toThrow(EMPTY_CONTENT);
    expect(h.translateSegmentsPlToEn).not.toHaveBeenCalled();
  });

  it("niezgodna liczba tłumaczeń zatrzymuje wynik błędem, zamiast przesunąć pola", async () => {
    h.translateSegmentsPlToEn.mockResolvedValue(["EN(Tytuł)"]);
    await expect(
      translatePostDraft({ data: { title_pl: "Tytuł", excerpt_pl: "Zajawka" } }),
    ).rejects.toThrow("Translation segment count mismatch");
  });

  it("błąd bramki AI wychodzi do wywołującego, a nie wraca pustym szkicem", async () => {
    h.translateSegmentsPlToEn.mockRejectedValue(new Error("AI gateway 429: too many requests"));
    await expect(translatePostDraft({ data: { title_pl: "Tytuł" } })).rejects.toThrow(
      "AI gateway 429",
    );
  });
});

describe("uszkodzony dokument bloków", () => {
  it("dokument spoza schematu degraduje się do PUSTEJ listy bloków (stan faktyczny)", async () => {
    const out = await translatePostDraft({
      data: { title_pl: "Tytuł", blocks_doc_pl: { version: 1, blocks: "to nie jest tablica" } },
    });
    expect(sentSegments()).toEqual(["Tytuł"]);
    expect(out.blocks_en).toEqual([]);
  });

  it("blok spoza schematu jest po cichu WYRZUCANY, poprawne bloki zostają", async () => {
    const out = await translatePostDraft({
      data: {
        title_pl: "Tytuł",
        blocks_doc_pl: {
          version: 1,
          blocks: [
            { id: "b1", type: "paragraph", data: { html: "Akapit" } },
            { id: "b2", type: "typ-z-przyszlosci", data: { html: "Akapit z nowszego wdrożenia" } },
          ],
        },
      },
    });
    expect(sentSegments()).toEqual(["Tytuł", "Akapit"]);
    expect(out.blocks_en).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // WEJSCIE: `blocks_doc_pl` niezgodny ze schematem, np.
  //   `{ version: 1, blocks: "to nie jest tablica" }`, albo dokument, w którym
  //   KAZDY blok jest spoza schematu.
  // CO PSUJE: `src/lib/content/translate.functions.ts:36-37` zakłada, że
  //   `safeParseBlocks` zwraca wartość fałszywą dla dokumentu nie do odczytania
  //   („if (!parsed) throw new Error("Invalid blocks document")"). Tak nie jest:
  //   `safeParseBlocks` (`src/lib/blocks/schema.ts:149-167`) ma typ zwrotny
  //   `BlocksDoc` i w najgorszym razie oddaje `{ version: 1, blocks: [] }`.
  //   Warunek jest więc martwy - komunikat „Invalid blocks document" nie może
  //   paść nigdy, a uszkodzony dokument przechodzi dalej jako PUSTY.
  // KONSEKWENCJA: redakcja klika „przetłumacz", dostaje komplet pól EN i
  //   `blocks_en: []`. Formularz edytora podstawia to do wersji EN, więc
  //   ZAMIAST błędu („dokument bloków jest uszkodzony") użytkownik ma cichy
  //   szkic z WYKASOWANĄ treścią blokową - i zapisze go, bo nic nie krzyknęło.
  //   Ta sama ścieżka zjada pojedyncze bloki z nowszego wdrożenia po rollbacku.
  // WYMAGANA POPRAWKA (produkcja, poza zakresem tego zadania): bramkować
  //   wejście `isBlocksDoc(data.blocks_doc_pl)` (`src/lib/blocks/schema.ts:145`)
  //   i dopiero potem czytać `safeParseBlocks`, albo porównać liczbę bloków
  //   wejściowych z liczbą sparsowanych i rzucić „Invalid blocks document",
  //   gdy parser cokolwiek wyrzucił.
  // -------------------------------------------------------------------------
  it.fails("DEFEKT: uszkodzony dokument bloków NIE jest odrzucany błędem", async () => {
    await expect(
      translatePostDraft({
        data: { title_pl: "Tytuł", blocks_doc_pl: { version: 1, blocks: "to nie jest tablica" } },
      }),
    ).rejects.toThrow("Invalid blocks document");
  });
});
