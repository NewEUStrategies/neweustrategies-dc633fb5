// Testy centralnego wejścia do przygotowania treści. Ten helper nie miał ŻADNEGO
// pokrycia, dlatego regresja "wpis richtext gubi całą sekcję przypisów" przeszła
// przez zielone CI: typy się zgadzały, a żaden test nie patrzył na `footnotes`.
//
// Kontrakt pilnowany tutaj:
//   1. renderowany silnik ZAWSZE numeruje od [1],
//   2. liczba wpisów w sekcji == liczba markerów w treści (brak odsyłaczy w nikąd
//      i brak przypisów-widm),
//   3. dane drugiego (nierenderowanego) silnika nie wyciekają do sekcji,
//   4. blocks nie dubluje sekcji - ma własną w BlocksRenderer.
import { describe, it, expect } from "vitest";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import type { BuilderDocument } from "@/lib/builder/types";

const emptyDoc = { sections: [] } as unknown as BuilderDocument;

/** Dokument buildera z jednym widgetem `text` o podanym HTML. */
const docWithText = (html: string) =>
  ({
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            children: [{ id: "w1", kind: "widget", type: "text", content: { html_pl: html } }],
          },
        ],
      },
    ],
  }) as unknown as BuilderDocument;

const markerIds = (html: string): number[] =>
  [...html.matchAll(/data-fn="(\d+)"/g)].map((m) => Number(m[1]));

describe("prepareContentForRender - przypisy", () => {
  it("wpis richtext: sekcja przypisów odpowiada markerom w treści", () => {
    const r = prepareContentForRender({
      editor: "richtext",
      builderDoc: emptyDoc,
      blocksDoc: null,
      rawHtml: "<p>Teza[fn] źródło A [/fn] oraz druga[fn] źródło B [/fn].</p>",
      lang: "pl",
    });

    expect(r.engine).toBe("html");
    // Regresja, którą to łapie: markery były, a `footnotes` wracało puste.
    expect(markerIds(r.html)).toEqual([1, 2]);
    expect(r.footnotes.map((n) => n.id)).toEqual([1, 2]);
    expect(r.footnotes.map((n) => n.html)).toEqual(["źródło A", "źródło B"]);
  });

  it("wpis buildera: sekcja przypisów odpowiada markerom w widgecie", () => {
    const r = prepareContentForRender({
      editor: "builder",
      builderDoc: docWithText("<p>A[fn] nota buildera [/fn]</p>"),
      blocksDoc: null,
      rawHtml: "",
      lang: "pl",
    });

    expect(r.engine).toBe("builder");
    expect(r.footnotes.map((n) => n.html)).toEqual(["nota buildera"]);
  });

  it("zaległe content_pl NIE dopisuje przypisów-widm do listy buildera", () => {
    // Rekord renderowany builderem, ale z niewyczyszczonym legacy HTML-em.
    // Ten HTML nie jest wyświetlany, więc jego noty nie mają odsyłacza w treści.
    const r = prepareContentForRender({
      editor: "builder",
      builderDoc: docWithText("<p>A[fn] z buildera [/fn]</p>"),
      blocksDoc: null,
      rawHtml: "<p>Stare[fn] z legacy HTML [/fn]</p>",
      lang: "pl",
    });

    expect(r.footnotes.map((n) => n.html)).toEqual(["z buildera"]);
  });

  it("zaległy builder_data NIE przesuwa numeracji wpisu richtext", () => {
    // Odwrotny kierunek: renderujemy HTML, a w rekordzie siedzi builder_data
    // z przypisami. Renderowany silnik musi startować od [1].
    const r = prepareContentForRender({
      editor: "richtext",
      builderDoc: docWithText("<p>X[fn] duch 1 [/fn]Y[fn] duch 2 [/fn]</p>"),
      blocksDoc: null,
      rawHtml: "<p>Treść[fn] realne źródło [/fn]</p>",
      lang: "pl",
    });

    expect(r.engine).toBe("html");
    expect(markerIds(r.html)).toEqual([1]);
    expect(r.footnotes).toEqual([{ id: 1, html: "realne źródło" }]);
  });

  it("strona główna (builder bez rawHtml) dostaje rozwinięte markery i sekcję", () => {
    // Dokładny kształt wywołania z routes/index.tsx: dokument buildera, zero
    // legacy HTML. Dotąd homepage renderowała shortcode dosłownie, bo w ogóle
    // nie przechodziła przez ten helper.
    const r = prepareContentForRender({
      editor: "builder",
      builderDoc: docWithText("<p>Teza homepage[fn] źródło [/fn]</p>"),
      blocksDoc: null,
      rawHtml: "",
      lang: "pl",
    });

    expect(r.engine).toBe("builder");
    expect(r.footnotes).toEqual([{ id: 1, html: "źródło" }]);
    const w = (
      r.builderDoc.sections[0] as unknown as {
        children: [{ children: Array<{ content: { html_pl: string } }> }];
      }
    ).children[0].children[0];
    expect(w.content.html_pl).toContain('class="fn-ref"');
    expect(w.content.html_pl).not.toContain("[fn]");
  });

  it("blocks: helper nie zwraca przypisów (BlocksRenderer ma własną sekcję)", () => {
    const blocksDoc = {
      blocks: [{ id: "p1", type: "paragraph", data: { html: "A[fn] nota [/fn]" } }],
    } as never;
    const r = prepareContentForRender({
      editor: "blocks",
      builderDoc: emptyDoc,
      blocksDoc,
      rawHtml: "<p>Legacy[fn] nota legacy [/fn]</p>",
      lang: "pl",
    });

    expect(r.engine).toBe("blocks");
    // Inaczej strona miałaby DWIE sekcje z duplikatami #fn-/#footnotes-heading.
    expect(r.footnotes).toEqual([]);
  });

  it("puste [fn][/fn] nie zużywa numeru ani nie tworzy wpisu", () => {
    const r = prepareContentForRender({
      editor: "richtext",
      builderDoc: emptyDoc,
      blocksDoc: null,
      rawHtml: "<p>A[fn][/fn]B[fn]   [/fn]C[fn] realny [/fn]</p>",
      lang: "pl",
    });

    expect(markerIds(r.html)).toEqual([1]);
    expect(r.footnotes).toEqual([{ id: 1, html: "realny" }]);
  });

  it("przekazuje marker <!--TOC--> jako hasManualToc", () => {
    const withToc = prepareContentForRender({
      editor: "richtext",
      builderDoc: emptyDoc,
      blocksDoc: null,
      rawHtml: "<!--TOC--><h2>Rozdział</h2>",
      lang: "pl",
    });
    const withoutToc = prepareContentForRender({
      editor: "richtext",
      builderDoc: emptyDoc,
      blocksDoc: null,
      rawHtml: "<h2>Rozdział</h2>",
      lang: "pl",
    });

    expect(withToc.hasManualToc).toBe(true);
    expect(withoutToc.hasManualToc).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GAŁĄŹ OBRONNA `rawHtml ?? ""` - część C (gałęziowa).
//
// Typ `PrepareContentInput` deklaruje `rawHtml: string`, ale kod broni się
// przed `undefined`. Obrona jest realna: rekordy sprzed migracji na kolumny
// `content_pl/en` mają NULL, a trasa przekazuje wartość z bazy wprost. Skoro
// obrona istnieje, musi być wykonana - inaczej "uproszczenie" jej usunie i
// pierwszy taki rekord wywali render całej strony.
// ---------------------------------------------------------------------------
describe("prepareContentForRender - brak surowego HTML", () => {
  it("wpis buildera BEZ `rawHtml` renderuje się, a html wychodzi pusty", () => {
    const r = prepareContentForRender({
      editor: "builder",
      builderDoc: docWithText("<p>Treść buildera[fn] nota [/fn]</p>"),
      blocksDoc: null,
      rawHtml: undefined as unknown as string,
      lang: "pl",
    });

    expect(r.engine).toBe("builder");
    expect(r.html).toBe("");
    expect(r.hasManualToc).toBe(false);
    // Przypisy buildera nie zniknęły przez brak drugiego wejścia.
    expect(r.footnotes.map((n) => n.html)).toEqual(["nota"]);
  });

  it("wpis richtext BEZ `rawHtml` daje pustą treść i pustą sekcję przypisów", () => {
    const r = prepareContentForRender({
      editor: "richtext",
      builderDoc: emptyDoc,
      blocksDoc: null,
      rawHtml: null as unknown as string,
      lang: "en",
    });

    expect(r.engine).toBe("html");
    expect(r.html).toBe("");
    expect(r.footnotes).toEqual([]);
  });
});
