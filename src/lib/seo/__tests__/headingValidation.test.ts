// CO DOWODZI TEN PLIK
// Cała reguła strukturalna nagłówków (`src/lib/seo/headingValidation.ts`) -
// jedyne miejsce, które mówi redakcji, że wpis ma dwa H1, dziurę w hierarchii
// albo nagłówek nie do przeczytania w SERP-ie. Moduł jest czysty, więc mierzę
// go DECYZJAMI, nie renderem:
//   1. skaner HTML (`headingsFromHtml`): poziomy H1-H6, atrybuty w tagu,
//      znaczniki wewnątrz nagłówka, wielolinijkowy nagłówek, zwijanie białych
//      znaków, tag niedomknięty (POMINIĘTY) oraz to, CZEGO skaner nie rozumie
//      (encje HTML, treść zastępcza `<iframe>`, nagłówek w komentarzu),
//   2. skaner drzewa bloków (`headingsFromBlocks`): kształty Editor.js /
//      Gutenberg / własnego buildera, każde ze czterech źródeł poziomu i
//      tekstu, domyślka poziomu 2 dla śmieci, drzewo o NIEZNANYM kształcie
//      (nie wolno mu rzucić) i rekurencja w zagnieżdżone kontenery,
//   3. pierwszeństwo źródeł (`collectHeadings`): bloki wygrywają z HTML,
//      pusta lista bloków spada na HTML,
//   4. WSZYSTKIE osiem rodzajów uwagi z `validateHeadings` wraz z LICZBAMI
//      progów odczytanymi z kodu (70 znaków dla H2/H3, 60 znaków snippetu,
//      8 liter i 70% wersalików), z `position` 1-indeksowaną, z `lang` i z
//      `severity` - bo od `severity` zależy, czy podsumowanie panelu świeci
//      na czerwono, a fałszywy `error` kosztuje redakcję tyle samo, co
//      przegapiony.
// Jedyna gałąź, której ten plik NIE domyka, to obronne `match[2] ?? ""` w
// `headingsFromHtml` (linia 58) - grupa 2 zawsze bierze udział w dopasowaniu,
// więc alternatywy nie da się osiągnąć bez zmiany wyrażenia w produkcji.
// Cztery zapisy `it.fails` przypinają defekty produktu (encje HTML, kontekst
// osadzony, martwy punkt przy `rendersTitleAsH1: true`); obok każdego stoi
// ZIELONY test na stan faktyczny, żeby naprawa produkcji natychmiast wywaliła
// `it.fails`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   * `src/components/admin/seo/__tests__/SeoValidationSummary.test.tsx` -
//     DROGA uwagi na ekran: test "żadna uwaga policzona przez validateHeadings
//     nie ginie po drodze do listy" pilnuje, że liczba wierszy równa się
//     liczbie uwag, a `it.fails` o zielonym "brak uwag" opisuje brak stanu
//     "nie sprawdzono". Tutaj nie renderuję ani jednego komponentu - sprawdzam
//     TREŚĆ uwagi, nie jej wiersz.
//   * `src/components/admin/seo/__tests__/SeoPanel.test.tsx` - wpięcie
//     walidatora w panel (to panel decyduje o `rendersTitleAsH1: true`).
//     Tutaj obie wartości flagi są równoprawnymi wejściami funkcji.
//   * `src/lib/seo/__tests__/zeroClick.test.ts` - `collectHeadings` jest tam
//     tylko dostawcą nagłówków pytających dla checklisty zero-click; reguły
//     zero-click nie są tu powtarzane.
//   * `e2e/seo.spec.ts` - powierzchnia styka się z testem "HTML sitemap
//     /sitemap renders navigable page", który BAJTAMI na żywym SSR sprawdza,
//     że w DOM-ie jest widoczny `h1` i przynajmniej jeden `h2`, oraz z
//     "head contract on /" (kontrakt `<head>`). Ten plik nie wykonuje ANI
//     JEDNEGO żądania HTTP, nie montuje DOM-u i nie patrzy na wyrenderowaną
//     stronę: mierzy analizator treści edytora PRZED publikacją, czyli
//     moment, w którym nie ma jeszcze czego zaciągnąć przeglądarką.
//   * RLS i RPC - domena pgTAP; ten moduł nie dotyka bazy.
import { describe, expect, it } from "vitest";
import {
  collectHeadings,
  headingsFromBlocks,
  headingsFromHtml,
  validateHeadings,
  type HeadingIssue,
  type HeadingIssueKind,
  type HeadingIssueLang,
} from "@/lib/seo/headingValidation";

/**
 * Wyszukanie uwaga-po-rodzaju ze STRAŻNIKIEM runtime zamiast rzutowania -
 * `find` zwraca `T | undefined`, a test ma paść z nazwą brakującego rodzaju,
 * nie z "cannot read property of undefined" trzy linijki dalej.
 */
function uwaga(issues: HeadingIssue[], kind: HeadingIssueKind): HeadingIssue {
  const found = issues.find((i) => i.kind === kind);
  expect(found, `brak uwagi ${kind} w ${JSON.stringify(issues)}`).toBeDefined();
  if (!found) throw new Error(`brak uwagi ${kind}`);
  return found;
}

/** Rodzaje uwag w kolejności, w jakiej `validateHeadings` je dokłada. */
function rodzaje(issues: HeadingIssue[]): HeadingIssueKind[] {
  return issues.map((i) => i.kind);
}

/** Nagłówek o zadanej liczbie znaków - progi są liczbowe, więc dane też. */
function znaki(n: number, znak = "a"): string {
  return znak.repeat(n);
}

/** Nagłówek złożony ze słów rozdzielonych `sep` - do testów encji i cięcia. */
function slowa(n: number, sep = " "): string {
  return Array.from({ length: n }, (_, i) => `slowo${i}`).join(sep);
}

// Progi ODCZYTANE Z KODU (nie "około"): domyślny limit długości H2/H3 to 70
// znaków, snippet cięty jest na 60, wersaliki wymagają >= 8 liter i > 70%
// wielkich. Gdy produkcja zmieni którąkolwiek liczbę, testy poniżej padną.
const LIMIT_DLUGOSCI = 70;
const LIMIT_SNIPPETU = 60;

describe("headingsFromHtml - brak wejścia", () => {
  it.each([
    { opis: "null", html: null },
    { opis: "undefined", html: undefined },
    { opis: "pusty napis", html: "" },
  ])("$opis daje pustą listę, nie wyjątek", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([]);
  });

  it("treść bez nagłówków daje pustą listę", () => {
    expect(headingsFromHtml("<p>Akapit <strong>bez</strong> nagłówka</p>")).toEqual([]);
  });
});

describe("headingsFromHtml - poziomy", () => {
  it.each([
    { tag: "h1", level: 1 },
    { tag: "h2", level: 2 },
    { tag: "h3", level: 3 },
    { tag: "h4", level: 4 },
    { tag: "h5", level: 5 },
    { tag: "h6", level: 6 },
  ])("<$tag> ma poziom $level", ({ tag, level }) => {
    expect(headingsFromHtml(`<${tag}>Tekst</${tag}>`)).toEqual([{ level, text: "Tekst" }]);
  });

  it("zachowuje kolejność dokumentu dla wszystkich sześciu poziomów", () => {
    const html = "<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>";
    expect(headingsFromHtml(html).map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("tag pisany WIELKIMI literami jest rozpoznany (regex ma flagę i)", () => {
    expect(headingsFromHtml("<H3>Wielka</H3>")).toEqual([{ level: 3, text: "Wielka" }]);
  });
});

describe("headingsFromHtml - tekst nagłówka", () => {
  it("atrybuty w tagu nie trafiają do tekstu", () => {
    expect(headingsFromHtml('<h2 id="x" class="y" data-anchor="z">Tekst</h2>')).toEqual([
      { level: 2, text: "Tekst" },
    ]);
  });

  it("atrybuty rozbite na kilka linii nadal dopasowują nagłówek", () => {
    expect(headingsFromHtml('<h2\n  class="x"\n  id="y"\n>Wielolinijkowy</h2>')).toEqual([
      { level: 2, text: "Wielolinijkowy" },
    ]);
  });

  it("znaczniki WEWNĄTRZ nagłówka są zdejmowane, a tekst złączony", () => {
    expect(headingsFromHtml("<h2>tekst <em>x</em></h2>")).toEqual([{ level: 2, text: "tekst x" }]);
    expect(headingsFromHtml("<h2><a href='/x'>Link</a> i <code>kod</code></h2>")).toEqual([
      { level: 2, text: "Link i kod" },
    ]);
  });

  it("nagłówek wielolinijkowy zwija się do jednej linii", () => {
    expect(headingsFromHtml("<h2>\n  Pierwsza linia\n  druga\n</h2>")).toEqual([
      { level: 2, text: "Pierwsza linia druga" },
    ]);
  });

  it("białe znaki są zwinięte do jednej spacji i przycięte na brzegach", () => {
    expect(headingsFromHtml("<h2>   Ala \t\t ma    kota   </h2>")).toEqual([
      { level: 2, text: "Ala ma kota" },
    ]);
  });

  it.each([
    { opis: "pusty nagłówek", html: "<h2></h2>" },
    { opis: "same spacje", html: "<h2>   </h2>" },
    { opis: "tylko <br/>", html: "<h2><br/></h2>" },
    { opis: "tylko pusty <span>", html: "<h2><span></span></h2>" },
  ])("$opis daje nagłówek z pustym tekstem (a nie brak nagłówka)", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text: "" }]);
  });
});

describe("headingsFromHtml - czego skaner nie dopasowuje", () => {
  it.each([
    { opis: "tag niedomknięty", html: "<h2>Tekst" },
    { opis: "domknięcie innym poziomem (h2 -> /h3)", html: "<h2>Tekst</h3>" },
    { opis: "nagłówek samodomykający", html: "<h2 />" },
    { opis: "nieistniejący poziom <h7>", html: "<h7>siedem</h7>" },
    { opis: "<hgroup> to nie nagłówek", html: "<hgroup>grupa</hgroup>" },
  ])("$opis jest POMINIĘTY", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([]);
  });

  it("nagłówek niedomknięty ginie, a domknięte obok niego zostają", () => {
    // KONSEKWENCJA: literówka w zamknięciu tagu (częsta po wklejeniu z Worda)
    // po cichu wyłącza kontrolę tego nagłówka - panel nie zgłosi ani pustki,
    // ani przeskoku poziomu, choć w przeglądarce nagłówek się wyrenderuje.
    expect(headingsFromHtml("<h1>Tytuł</h1><h2>Ucięty<h3>Trzeci</h3>")).toEqual([
      { level: 1, text: "Tytuł" },
      { level: 3, text: "Trzeci" },
    ]);
  });

  it("PRZYPIĘTE: encje HTML NIE są dekodowane - &nbsp; zostaje sześcioma znakami", () => {
    // KONSEKWENCJA (rozwinięta w defektach niżej): każda encja liczy się jako
    // 6 znaków przy limicie długości i różnicuje teksty przy szukaniu
    // duplikatów. `zeroClick.countWords` encje rozumie - te dwa moduły
    // czytają tę samą treść inaczej.
    expect(headingsFromHtml("<h2>Ala&nbsp;ma kota</h2>")).toEqual([
      { level: 2, text: "Ala&nbsp;ma kota" },
    ]);
  });
});

describe("headingsFromHtml - nagłówki w blokach osadzonych", () => {
  it.each([
    {
      opis: "figure/figcaption",
      html: "<figure><img src='/a.png'><figcaption><h3>Podpis</h3></figcaption></figure>",
      oczekiwany: [{ level: 3, text: "Podpis" }],
    },
    {
      opis: "blockquote",
      html: "<blockquote><h2>Cytat</h2><p>treść</p></blockquote>",
      oczekiwany: [{ level: 2, text: "Cytat" }],
    },
    {
      opis: "iframe (treść zastępcza)",
      html: "<iframe src='/widget'><h2>Osadzony</h2></iframe>",
      oczekiwany: [{ level: 2, text: "Osadzony" }],
    },
    {
      opis: "komentarz HTML",
      html: "<!-- <h2>Zakomentowany</h2> -->",
      oczekiwany: [{ level: 2, text: "Zakomentowany" }],
    },
  ])("PRZYPIĘTE: nagłówek w $opis JEST liczony jako nagłówek strony", ({ html, oczekiwany }) => {
    // Skaner jest płaskim wyrażeniem regularnym - nie zna kontekstu, w którym
    // nagłówek stoi. Dla cytatu i podpisu to bywa poprawne (w DOM-ie to realne
    // nagłówki), ale dla treści zastępczej `<iframe>` i dla komentarza już nie:
    // przeglądarka ich NIE renderuje.
    expect(headingsFromHtml(html)).toEqual(oczekiwany);
  });

  it("PRZYPIĘTE: nagłówek z <iframe> fałszuje hierarchię widzianą przez walidator", () => {
    // KONSEKWENCJA: redakcja dostaje uwagę o przeskoku H2 -> H5, którego na
    // wyrenderowanej stronie NIE MA (H5 siedzi w treści zastępczej widżetu).
    // Poprawianie takiej uwagi jest niemożliwe - stąd erozja zaufania do panelu.
    const uwagi = validateHeadings("pl", {
      html: "<h1>Tytuł</h1><h2>Sekcja</h2><iframe><h5>Widget</h5></iframe>",
    });
    expect(uwaga(uwagi, "skipped_level")).toMatchObject({ from: 2, to: 5, position: 3 });
  });

  it.fails(
    "DEFEKT: nagłówek z treści zastępczej <iframe> i z komentarza HTML jest liczony jako nagłówek strony - walidator zgłasza dziury w hierarchii, których użytkownik nie widzi",
    () => {
      // Stan POŻĄDANY: skaner pomija to, czego przeglądarka nie wyrenderuje.
      // KONSEKWENCJA obecnego stanu: (a) fałszywy `skipped_level` od nagłówka
      // w widżecie, (b) fałszywy `duplicate_heading` od nagłówka schowanego w
      // komentarzu (np. zakomentowanej starej wersji sekcji) - redaktor kasuje
      // widoczną sekcję, żeby uciszyć uwagę o duplikacie.
      // Naprawa należy do produkcji (parser świadomy kontekstu), nie do testu.
      expect(headingsFromHtml("<iframe><h2>Osadzony</h2></iframe>")).toEqual([]);
      expect(headingsFromHtml("<!-- <h2>Zakomentowany</h2> -->")).toEqual([]);
    },
  );
});

describe("headingsFromBlocks - kształty drzewa", () => {
  it.each([
    {
      opis: "Editor.js (type: header, data.level)",
      blocks: [{ type: "header", data: { text: "Sekcja", level: 3 } }],
      oczekiwany: [{ level: 3, text: "Sekcja" }],
    },
    {
      opis: "Gutenberg (blockName + attributes.content)",
      blocks: [{ blockName: "core/heading", attributes: { level: 2, content: "Blok" } }],
      oczekiwany: [{ level: 2, text: "Blok" }],
    },
    {
      opis: "własny builder (name + props.headingLevel + props.title)",
      blocks: [{ name: "Heading", props: { headingLevel: "h4", title: "Prop" } }],
      oczekiwany: [{ level: 4, text: "Prop" }],
    },
    {
      opis: "kształt płaski (level i text na samym bloku)",
      blocks: [{ type: "heading", level: 5, text: "Płaski" }],
      oczekiwany: [{ level: 5, text: "Płaski" }],
    },
    {
      opis: "poziom z data.tag jako napis",
      blocks: [{ type: "heading", data: { tag: "h6", content: "Tag" } }],
      oczekiwany: [{ level: 6, text: "Tag" }],
    },
    {
      opis: "typ z wielkiej litery i z sufiksem",
      blocks: [{ type: "SectionHeadingBlock", data: { level: 2, text: "Sufiks" } }],
      oczekiwany: [{ level: 2, text: "Sufiks" }],
    },
  ])("$opis", ({ blocks, oczekiwany }) => {
    expect(headingsFromBlocks(blocks)).toEqual(oczekiwany);
  });

  it.each([
    { opis: "poziom 9 (poza zakresem)", rawLevel: 9 },
    { opis: "poziom 0", rawLevel: 0 },
    { opis: "poziom jako obiekt", rawLevel: {} },
    { opis: "poziom jako napis bez cyfr", rawLevel: "duzy" },
    { opis: "poziom NaN", rawLevel: Number.NaN },
  ])("$opis spada na domyślne 2, nie na NaN", ({ rawLevel }) => {
    expect(headingsFromBlocks([{ type: "heading", data: { level: rawLevel, text: "T" } }])).toEqual(
      [{ level: 2, text: "T" }],
    );
  });

  it("tekst inny niż napis daje pusty tekst (a więc uwagę o pustym nagłówku)", () => {
    expect(headingsFromBlocks([{ type: "heading", data: { level: 3, text: 42 } }])).toEqual([
      { level: 3, text: "" },
    ]);
  });

  it("tekst bloku jest normalizowany tak samo jak w HTML", () => {
    expect(
      headingsFromBlocks([
        { type: "heading", data: { level: 2, text: "<em>Kursywa</em> i   trzy" } },
      ]),
    ).toEqual([{ level: 2, text: "Kursywa i trzy" }]);
  });

  it.each([
    {
      opis: "poziom spoza `data` (data bez poziomu, level na samym bloku)",
      blocks: [{ type: "heading", data: { text: "Mieszane" }, level: 4 }],
      oczekiwany: [{ level: 4, text: "Mieszane" }],
    },
    {
      opis: "tekst spoza `data` (data tylko z poziomem, text na bloku)",
      blocks: [{ type: "heading", data: { level: 3 }, text: "Z bloku" }],
      oczekiwany: [{ level: 3, text: "Z bloku" }],
    },
    {
      opis: "tekst z rec.content, gdy data go nie ma",
      blocks: [{ type: "heading", data: { level: 5 }, content: "Z contentu" }],
      oczekiwany: [{ level: 5, text: "Z contentu" }],
    },
    {
      opis: "brak tekstu w OBU miejscach -> pusty tekst, nie undefined",
      blocks: [{ type: "heading", data: { level: 6 } }],
      oczekiwany: [{ level: 6, text: "" }],
    },
  ])("$opis", ({ blocks, oczekiwany }) => {
    // Bloki z importu bywają hybrydami dwóch schematów: część pól siedzi w
    // `data`, część na samym bloku. Gdyby czytanie zatrzymywało się na `data`,
    // nagłówek z importu wpadałby jako pusty H2 - czyli jako FAŁSZYWA uwaga
    // o pustym nagłówku i o przeskoku poziomu.
    expect(headingsFromBlocks(blocks)).toEqual(oczekiwany);
  });

  it("schodzi w zagnieżdżone kontenery (kolumny w rzędach w sekcji)", () => {
    const blocks = {
      content: { rows: [{ columns: [{ type: "heading", data: { level: 2, text: "Głębokie" } }] }] },
    };
    expect(headingsFromBlocks(blocks)).toEqual([{ level: 2, text: "Głębokie" }]);
  });

  it("nagłówek-rodzic i nagłówek-dziecko liczą się oba, rodzic pierwszy", () => {
    const blocks = [
      {
        type: "heading",
        data: { level: 2, text: "Rodzic" },
        children: [{ type: "heading", data: { level: 3, text: "Dziecko" } }],
      },
    ];
    expect(headingsFromBlocks(blocks)).toEqual([
      { level: 2, text: "Rodzic" },
      { level: 3, text: "Dziecko" },
    ]);
  });
});

describe("headingsFromBlocks - wejście, którego nikt nie przewidział", () => {
  it.each([
    { opis: "null", blocks: null },
    { opis: "undefined", blocks: undefined },
    { opis: "pusta tablica", blocks: [] },
    { opis: "napis zamiast drzewa", blocks: "surowa treść" },
    { opis: "liczba", blocks: 7 },
    { opis: "false", blocks: false },
    { opis: "tablica skalarów", blocks: ["tekst", 7, true, null, undefined] },
    { opis: "obiekt bez oczekiwanych pól", blocks: { foo: { bar: 1 }, baz: [1, 2] } },
    { opis: "bloki innych typów", blocks: [{ type: "paragraph", data: { text: "nic" } }] },
    { opis: "blok bez typu", blocks: [{ data: { level: 2, text: "bez typu" } }] },
  ])("$opis nie rzuca i daje pustą listę", ({ blocks }) => {
    expect(() => headingsFromBlocks(blocks)).not.toThrow();
    expect(headingsFromBlocks(blocks)).toEqual([]);
  });
});

describe("collectHeadings - które źródło wygrywa", () => {
  const zBloku = [{ type: "heading", data: { level: 2, text: "Z bloku" } }];

  it("PRZYPIĘTE: przy PODANYCH OBU źródłach wygrywa drzewo bloków, HTML jest ignorowany", () => {
    expect(collectHeadings({ html: "<h1>Z HTML</h1>", blocks: zBloku })).toEqual([
      { level: 2, text: "Z bloku" },
    ]);
  });

  it.each([
    { opis: "pusta tablica bloków", blocks: [] },
    { opis: "blocks: null", blocks: null },
    { opis: "blocks: undefined", blocks: undefined },
    { opis: "drzewo bez nagłówków", blocks: [{ type: "paragraph", data: { text: "x" } }] },
  ])("$opis spada na HTML", ({ blocks }) => {
    expect(collectHeadings({ html: "<h1>Z HTML</h1>", blocks })).toEqual([
      { level: 1, text: "Z HTML" },
    ]);
  });

  it("brak obu źródeł to pusta lista", () => {
    expect(collectHeadings({})).toEqual([]);
    expect(collectHeadings({ html: null, blocks: null })).toEqual([]);
  });
});

describe("validateHeadings - dokument bez nagłówków", () => {
  it.each([
    { opis: "pusty HTML", input: { html: "" } },
    { opis: "HTML bez nagłówków", input: { html: "<p>Akapit</p>" } },
    { opis: "brak obu źródeł", input: {} },
    { opis: "drzewo bloków bez nagłówków", input: { blocks: [{ type: "paragraph" }] } },
  ])("$opis nie generuje ŻADNEJ uwagi (szkic w edytorze)", ({ input }) => {
    expect(validateHeadings("pl", input)).toEqual([]);
  });

  it("czysta hierarchia H1 -> H2 -> H3 -> H4 też nie generuje uwag", () => {
    expect(validateHeadings("pl", { html: "<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4>" })).toEqual(
      [],
    );
  });
});

describe("validateHeadings - H1", () => {
  it("brak H1 przy rendersTitleAsH1: false to missing_h1 bez pozycji i snippetu", () => {
    const uwagi = validateHeadings("pl", { html: "<h2>Sekcja</h2>" });
    expect(uwagi).toEqual([{ lang: "pl", kind: "missing_h1", severity: "warning" }]);
  });

  it("brak H1 przy rendersTitleAsH1: true NIE jest uwagą (H1 daje układ strony)", () => {
    const uwagi = validateHeadings("pl", { html: "<h2>Sekcja</h2>" }, { rendersTitleAsH1: true });
    expect(rodzaje(uwagi)).not.toContain("missing_h1");
    expect(uwagi).toEqual([]);
  });

  it("dokładnie jeden H1 przy rendersTitleAsH1: false nie budzi żadnej uwagi o H1", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>Tytuł</h1><h2>Sekcja</h2>" });
    expect(rodzaje(uwagi)).toEqual([]);
  });

  it("DWA H1 przy rendersTitleAsH1: false to multiple_h1 (error) z count i DRUGIM H1", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>Pierwszy</h1><h1>Drugi</h1>" });
    expect(uwaga(uwagi, "multiple_h1")).toEqual({
      lang: "pl",
      kind: "multiple_h1",
      severity: "error",
      count: 2,
      position: 2,
      snippet: "Drugi",
    });
  });

  it("TE SAME dwa H1 przy rendersTitleAsH1: true to extra_h1 (warning) z PIERWSZYM H1", () => {
    // Ten sam dokument, inna flaga - INNY rodzaj uwagi i INNA waga. Panel
    // wywołuje walidator z `rendersTitleAsH1: true`, więc w praktyce widzi
    // wyłącznie ten wariant.
    const uwagi = validateHeadings(
      "pl",
      { html: "<h1>Pierwszy</h1><h1>Drugi</h1>" },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "extra_h1")).toEqual({
      lang: "pl",
      kind: "extra_h1",
      severity: "warning",
      count: 2,
      position: 1,
      snippet: "Pierwszy",
    });
    expect(rodzaje(uwagi)).not.toContain("multiple_h1");
  });

  it("JEDEN H1 w treści przy rendersTitleAsH1: true to już extra_h1 z count 1", () => {
    const uwagi = validateHeadings("en", { html: "<h1>Jeden</h1>" }, { rendersTitleAsH1: true });
    expect(uwaga(uwagi, "extra_h1")).toMatchObject({ count: 1, position: 1, snippet: "Jeden" });
  });

  it("PRZYPIĘTE: w konfiguracji panelu (rendersTitleAsH1: true) ŻADNA uwaga o nagłówkach nie ma wagi error", () => {
    // KONSEKWENCJA: `multiple_h1` to jedyny `error` w tym module, a przy
    // `rendersTitleAsH1: true` nie powstaje NIGDY. Trzy H1 w DOM-ie (jeden z
    // układu + dwa z treści) dają w panelu wyłącznie żółte ostrzeżenie, więc
    // podsumowanie nie zapali się na czerwono.
    const uwagi = validateHeadings(
      "pl",
      { html: `<h1>Pierwszy</h1><h1>Drugi</h1><h3></h3><h2>${znaki(80)}</h2>` },
      { rendersTitleAsH1: true },
    );
    expect(uwagi.length).toBeGreaterThan(2);
    expect(uwagi.map((i) => i.severity)).not.toContain("error");
  });
});

describe("validateHeadings - przeskok poziomu", () => {
  it.each([
    { opis: "H1 -> H3", html: "<h1>A</h1><h3>C</h3>", from: 1, to: 3, position: 2 },
    { opis: "H2 -> H4", html: "<h1>A</h1><h2>B</h2><h4>D</h4>", from: 2, to: 4, position: 3 },
    {
      opis: "H3 -> H5",
      html: "<h1>A</h1><h2>B</h2><h3>C</h3><h5>E</h5>",
      from: 3,
      to: 5,
      position: 4,
    },
    { opis: "H1 -> H4", html: "<h1>A</h1><h4>D</h4>", from: 1, to: 4, position: 2 },
  ])("$opis to skipped_level z from/to i pozycją", ({ html, from, to, position }) => {
    expect(uwaga(validateHeadings("pl", { html }), "skipped_level")).toMatchObject({
      severity: "warning",
      from,
      to,
      position,
    });
  });

  it.each([
    { opis: "H2 -> H3 -> H4", html: "<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4>" },
    {
      opis: "powrót w górę: H4 potem H2",
      html: "<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h2>B2</h2>",
    },
    {
      opis: "powrót w górę i znowu w dół",
      html: "<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h3>E</h3>",
    },
    { opis: "dwa nagłówki tego samego poziomu", html: "<h1>A</h1><h2>B</h2><h2>C</h2>" },
  ])("$opis NIE daje uwagi o przeskoku", ({ html }) => {
    expect(rodzaje(validateHeadings("pl", { html }))).not.toContain("skipped_level");
  });

  it("zgłasza tylko PIERWSZY przeskok, nawet gdy są dwa", () => {
    const uwagi = validateHeadings("pl", {
      html: "<h1>A</h1><h3>C</h3><h3>C2</h3><h6>F</h6>",
    });
    expect(uwagi.filter((i) => i.kind === "skipped_level")).toHaveLength(1);
    expect(uwaga(uwagi, "skipped_level")).toMatchObject({ from: 1, to: 3, position: 2 });
  });

  it("przeskok na nagłówek BEZ tekstu daje snippet undefined (klucz jest, wartości nie)", () => {
    // Klucz `snippet` zostaje w obiekcie z wartością `undefined` - podsumowanie
    // panelu sprawdza `h.snippet ? ...`, więc nie dokleja pustego cudzysłowu.
    const found = uwaga(validateHeadings("pl", { html: "<h1>A</h1><h3></h3>" }), "skipped_level");
    expect(found.snippet).toBeUndefined();
    expect(Object.keys(found)).toContain("snippet");
    const zTekstem = uwaga(
      validateHeadings("pl", { html: "<h1>A</h1><h3>Trzeci</h3>" }),
      "skipped_level",
    );
    expect(zTekstem.snippet).toBe("Trzeci");
  });

  it("przeskok liczy się też w drzewie bloków, nie tylko w HTML", () => {
    const uwagi = validateHeadings("pl", {
      blocks: [
        { type: "heading", data: { level: 1, text: "Tytuł" } },
        { type: "heading", data: { level: 3, text: "Podsekcja" } },
      ],
    });
    expect(uwaga(uwagi, "skipped_level")).toMatchObject({ from: 1, to: 3, snippet: "Podsekcja" });
  });

  it("PRZYPIĘTE: przy rendersTitleAsH1: true treść startująca od H3 nie budzi ŻADNEJ uwagi", () => {
    expect(
      validateHeadings("pl", { html: "<h3>Start</h3><h4>Dalej</h4>" }, { rendersTitleAsH1: true }),
    ).toEqual([]);
  });

  it.fails(
    "DEFEKT: przy rendersTitleAsH1: true przeskok z H1 układu do H3 treści jest niewidoczny - hierarchia z dziurą przechodzi kontrolę",
    () => {
      // Stan POŻĄDANY: skoro walidator WIE (`rendersTitleAsH1: true`), że układ
      // renderuje H1, to pierwszy nagłówek treści musi być mierzony względem
      // poziomu 1, a nie względem samego siebie (`prev = headings[0].level`).
      // KONSEKWENCJA obecnego stanu: wpis, którego treść zaczyna się od H3 lub
      // H4 (typowe po imporcie z WP), ma w DOM-ie realną dziurę H1 -> H3;
      // czytniki ekranu i parsery outline'u tracą poziom, a panel świeci
      // "brak uwag". To najczęstsza konfiguracja produkcyjna - panel wywołuje
      // walidator DOKŁADNIE z tą flagą.
      // Naprawa należy do produkcji (start `prev` od 1, gdy flaga jest ustawiona).
      const uwagi = validateHeadings(
        "pl",
        { html: "<h3>Start</h3><h4>Dalej</h4>" },
        { rendersTitleAsH1: true },
      );
      expect(uwaga(uwagi, "skipped_level")).toMatchObject({ from: 1, to: 3 });
    },
  );
});

describe("validateHeadings - puste nagłówki", () => {
  it.each([
    { opis: "<h2></h2>", html: "<h1>A</h1><h2></h2>" },
    { opis: "<h2>   </h2>", html: "<h1>A</h1><h2>   </h2>" },
    { opis: "<h2><br/></h2>", html: "<h1>A</h1><h2><br/></h2>" },
  ])("$opis to empty_heading z pozycją 2 i count 1", ({ html }) => {
    expect(uwaga(validateHeadings("pl", { html }), "empty_heading")).toEqual({
      lang: "pl",
      kind: "empty_heading",
      severity: "warning",
      count: 1,
      position: 2,
    });
  });

  it("kilka pustych nagłówków daje count wszystkich i pozycję PIERWSZEGO", () => {
    const uwagi = validateHeadings("pl", {
      html: "<h1>A</h1><h2>   </h2><h3>Treść</h3><h3><br/></h3><h4></h4>",
    });
    expect(uwagi.filter((i) => i.kind === "empty_heading")).toHaveLength(1);
    expect(uwaga(uwagi, "empty_heading")).toMatchObject({ count: 3, position: 2 });
  });

  it("pusty nagłówek nie dostaje snippetu (nie ma czego pokazać)", () => {
    const found = uwaga(validateHeadings("pl", { html: "<h1>A</h1><h2></h2>" }), "empty_heading");
    expect(found.snippet).toBeUndefined();
  });

  it("pusty H1 nie ratuje przed missing_h1 - liczy się poziom, nie treść", () => {
    // KONSEKWENCJA: dokument z pustym H1 dostaje uwagę o pustce, ale NIE o
    // braku H1, choć dla wyszukiwarki taki H1 nic nie znaczy.
    const uwagi = validateHeadings("pl", { html: "<h1></h1><h2>Sekcja</h2>" });
    expect(rodzaje(uwagi)).toEqual(["empty_heading"]);
  });
});

describe("validateHeadings - duplikaty", () => {
  it("dwa nagłówki o identycznym tekście to duplicate_heading na pozycji DRUGIEGO", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>A</h1><h2>Sekcja</h2><h2>Sekcja</h2>" });
    expect(uwaga(uwagi, "duplicate_heading")).toEqual({
      lang: "pl",
      kind: "duplicate_heading",
      severity: "warning",
      position: 3,
      snippet: "Sekcja",
    });
  });

  it("różnica tylko w wielkości liter i w białych znakach to nadal duplikat", () => {
    const uwagi = validateHeadings("pl", {
      html: "<h1>A</h1><h2>Sekcja Druga</h2><h3>  sekcja   DRUGA  </h3>",
    });
    expect(uwaga(uwagi, "duplicate_heading")).toMatchObject({
      position: 3,
      snippet: "sekcja DRUGA",
    });
  });

  it("duplikat liczy się między RÓŻNYMI poziomami H2..H6", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>A</h1><h2>Wnioski</h2><h6>wnioski</h6>" });
    expect(uwaga(uwagi, "duplicate_heading")).toMatchObject({ position: 3 });
  });

  it("dwa identyczne H1 to NIE duplikat (poziom 1 jest pomijany) - to multiple_h1", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>Ten sam</h1><h1>Ten sam</h1>" });
    expect(rodzaje(uwagi)).toEqual(["multiple_h1"]);
  });

  it("dwa PUSTE nagłówki to nie duplikat, tylko empty_heading", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>A</h1><h2></h2><h3></h3>" });
    expect(rodzaje(uwagi)).not.toContain("duplicate_heading");
  });

  it("zgłaszany jest tylko PIERWSZY duplikat, nawet przy trzech powtórzeniach", () => {
    const uwagi = validateHeadings("pl", {
      html: "<h1>A</h1><h2>Sekcja</h2><h2>Sekcja</h2><h2>Sekcja</h2>",
    });
    expect(uwagi.filter((i) => i.kind === "duplicate_heading")).toHaveLength(1);
    expect(uwaga(uwagi, "duplicate_heading")).toMatchObject({ position: 3 });
  });

  it("PRZYPIĘTE: nagłówki różniące się tylko encją &nbsp; NIE są duplikatem", () => {
    expect(
      validateHeadings(
        "pl",
        { html: "<h2>Ala ma kota</h2><h3>Ala&nbsp;ma kota</h3>" },
        { rendersTitleAsH1: true },
      ),
    ).toEqual([]);
  });

  it.fails(
    "DEFEKT: duplikat schowany za encją &nbsp; przechodzi niezauważony - dwie identycznie brzmiące sekcje konkurują w SERP-ie",
    () => {
      // Stan POŻĄDANY: klucz duplikatu liczony na TEKŚCIE WIDZIANYM przez
      // czytelnika, czyli po dekodowaniu encji. KONSEKWENCJA obecnego stanu:
      // edytor WYSIWYG wstawia `&nbsp;` niewidocznie (np. po jednoliterowym
      // spójniku), więc dwa nagłówki o tej samej treści mają różne klucze i
      // kontrola duplikatów po cichu przestaje działać na treści z Worda.
      // Naprawa należy do produkcji (dekodowanie encji w `stripTags`).
      const uwagi = validateHeadings(
        "pl",
        { html: "<h2>Ala ma kota</h2><h3>Ala&nbsp;ma kota</h3>" },
        { rendersTitleAsH1: true },
      );
      expect(uwaga(uwagi, "duplicate_heading")).toMatchObject({ position: 2 });
    },
  );
});

describe("validateHeadings - za długi nagłówek", () => {
  it(`DOKŁADNIE ${LIMIT_DLUGOSCI} znaków to jeszcze NIE uwaga`, () => {
    expect(
      validateHeadings(
        "pl",
        { html: `<h2>${znaki(LIMIT_DLUGOSCI)}</h2>` },
        { rendersTitleAsH1: true },
      ),
    ).toEqual([]);
  });

  it(`${LIMIT_DLUGOSCI + 1} znaków (o JEDEN za dużo) to too_long_heading z count ${LIMIT_DLUGOSCI + 1}`, () => {
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${znaki(LIMIT_DLUGOSCI + 1)}</h2>` },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "too_long_heading")).toMatchObject({
      severity: "warning",
      position: 1,
      count: LIMIT_DLUGOSCI + 1,
    });
  });

  it("bardzo długi nagłówek podaje pełną liczbę znaków w count, choć snippet jest ucięty", () => {
    const uwagi = validateHeadings(
      "pl",
      { html: `<h3>${znaki(240)}</h3>` },
      { rendersTitleAsH1: true },
    );
    const found = uwaga(uwagi, "too_long_heading");
    expect(found.count).toBe(240);
    expect(found.snippet).toHaveLength(LIMIT_SNIPPETU + 1); // 60 znaków + wielokropek
  });

  it("maxHeadingChars z opcji nadpisuje domyślny próg", () => {
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${znaki(11)}</h2>` },
      { rendersTitleAsH1: true, maxHeadingChars: 10 },
    );
    expect(uwaga(uwagi, "too_long_heading")).toMatchObject({ count: 11 });
    expect(
      validateHeadings(
        "pl",
        { html: `<h2>${znaki(10)}</h2>` },
        { rendersTitleAsH1: true, maxHeadingChars: 10 },
      ),
    ).toEqual([]);
  });

  it.each([
    { opis: "H1", tag: "h1" },
    { opis: "H4", tag: "h4" },
    { opis: "H5", tag: "h5" },
    { opis: "H6", tag: "h6" },
  ])(
    "PRZYPIĘTE: 200-znakowy $opis NIE jest zgłaszany (reguła obejmuje tylko H2 i H3)",
    ({ tag }) => {
      // KONSEKWENCJA: rozdmuchany H1 albo H4 nie dostaje żadnej uwagi, choć w
      // SERP-ie i w spisie treści wygląda tak samo źle jak H2.
      const uwagi = validateHeadings(
        "pl",
        { html: `<${tag}>${znaki(200)}</${tag}>` },
        { rendersTitleAsH1: tag === "h1" },
      );
      expect(rodzaje(uwagi)).not.toContain("too_long_heading");
    },
  );

  it("count liczy PUNKTY KODOWE, nie jednostki UTF-16 (emoji to jeden znak)", () => {
    const emoji = "🙂".repeat(LIMIT_DLUGOSCI + 1);
    expect(emoji.length).toBe((LIMIT_DLUGOSCI + 1) * 2); // 142 jednostki UTF-16
    const uwagi = validateHeadings("pl", { html: `<h2>${emoji}</h2>` }, { rendersTitleAsH1: true });
    expect(uwaga(uwagi, "too_long_heading").count).toBe(LIMIT_DLUGOSCI + 1);
  });

  it("PRZYPIĘTE: nagłówek 62 znaków rozdzielony encjami &nbsp; liczy się jako 102 znaki", () => {
    expect(slowa(9).length).toBe(62);
    expect(slowa(9, "&nbsp;").length).toBe(102);
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${slowa(9, "&nbsp;")}</h2>` },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "too_long_heading").count).toBe(102);
  });

  it.fails(
    "DEFEKT: encje HTML zawyżają długość nagłówka - panel każe skracać nagłówek, który mieści się w limicie",
    () => {
      // Stan POŻĄDANY: liczony jest tekst WIDZIANY przez czytelnika (62 znaki),
      // więc nagłówek mieści się w progu 70 i nie ma uwagi. KONSEKWENCJA
      // obecnego stanu: każda encja waży 6 znaków, więc treść wklejona z
      // edytora WYSIWYG dostaje uwagę "za długi nagłówek", której nie da się
      // spełnić - redaktor obcina sensowny nagłówek, a licznik dalej pokazuje
      // ponad 100 znaków. Ten sam nagłówek bez encji przechodzi bez uwagi.
      // Naprawa należy do produkcji (dekodowanie encji), nie do testu.
      expect(
        validateHeadings(
          "pl",
          { html: `<h2>${slowa(9, "&nbsp;")}</h2>` },
          { rendersTitleAsH1: true },
        ),
      ).toEqual([]);
    },
  );
});

describe("validateHeadings - wersaliki", () => {
  it.each([
    { opis: "cały nagłówek wielkimi", text: "WIELKIE LITERY W TYM", zglaszany: true },
    { opis: "polskie znaki diakrytyczne wielkimi", text: "ŻÓŁTE ŚWIATŁO", zglaszany: true },
    { opis: "dokładnie 8 liter, wszystkie wielkie", text: "UWAGA PLN", zglaszany: true },
    { opis: "8 z 10 liter wielkich (80% > 70%)", text: "ABCDEFGHij", zglaszany: true },
    { opis: "akronim w zdaniu", text: "NATO w Europie", zglaszany: false },
    { opis: "krótki nagłówek wielkimi (UE)", text: "UE", zglaszany: false },
    { opis: "7 liter, wszystkie wielkie (poniżej progu 8)", text: "UWAGA PL", zglaszany: false },
    { opis: "dokładnie 70% wielkich (próg jest ostry)", text: "ABCDEFGhij", zglaszany: false },
    { opis: "same cyfry i spacje", text: "2026 2027 2028 2029", zglaszany: false },
    { opis: "zwykłe zdanie", text: "Wnioski z konsultacji publicznych", zglaszany: false },
  ])("$opis -> shouty_heading: $zglaszany", ({ text, zglaszany }) => {
    const uwagi = validateHeadings("pl", { html: `<h1>Tytuł</h1><h2>${text}</h2>` });
    expect(rodzaje(uwagi).includes("shouty_heading")).toBe(zglaszany);
  });

  it("uwaga o wersalikach ma pozycję i snippet nagłówka", () => {
    const uwagi = validateHeadings("pl", { html: "<h1>Tytuł</h1><h2>WIELKIE LITERY W TYM</h2>" });
    expect(uwaga(uwagi, "shouty_heading")).toEqual({
      lang: "pl",
      kind: "shouty_heading",
      severity: "warning",
      position: 2,
      snippet: "WIELKIE LITERY W TYM",
    });
  });

  it("wersaliki są łapane na KAŻDYM poziomie, także w H1 i H6", () => {
    expect(rodzaje(validateHeadings("pl", { html: "<h1>TYTUŁ WERSALIKAMI</h1>" }))).toContain(
      "shouty_heading",
    );
    expect(
      rodzaje(validateHeadings("pl", { html: "<h1>Tytuł</h1><h6>STOPKA SEKCJI</h6>" })),
    ).toContain("shouty_heading");
  });

  it("zgłaszany jest tylko PIERWSZY krzyczący nagłówek", () => {
    const uwagi = validateHeadings("pl", {
      html: "<h1>Tytuł</h1><h2>PIERWSZY KRZYK</h2><h2>DRUGI KRZYK</h2>",
    });
    expect(uwagi.filter((i) => i.kind === "shouty_heading")).toHaveLength(1);
    expect(uwaga(uwagi, "shouty_heading")).toMatchObject({ position: 2 });
  });
});

describe("validateHeadings - snippet", () => {
  it(`tekst do ${LIMIT_SNIPPETU} znaków trafia do snippetu w całości, bez wielokropka`, () => {
    const tekst = znaki(LIMIT_SNIPPETU);
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${tekst}</h2>` },
      { rendersTitleAsH1: true, maxHeadingChars: 10 },
    );
    expect(uwaga(uwagi, "too_long_heading").snippet).toBe(tekst);
  });

  it(`${LIMIT_SNIPPETU + 1} znaków jest już ucinane wielokropkiem`, () => {
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${znaki(LIMIT_SNIPPETU + 1)}</h2>` },
      { rendersTitleAsH1: true, maxHeadingChars: 10 },
    );
    expect(uwaga(uwagi, "too_long_heading").snippet).toBe(`${znaki(LIMIT_SNIPPETU)}…`);
  });

  it("cięcie idzie po granicy słowa, gdy ostatnia spacja wypada dalej niż 20. znak", () => {
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${slowa(20)}</h2>` },
      { rendersTitleAsH1: true },
    );
    const snippet = uwaga(uwagi, "too_long_heading").snippet ?? "";
    expect(snippet).toBe("slowo0 slowo1 slowo2 slowo3 slowo4 slowo5 slowo6 slowo7…");
    expect(snippet).not.toContain("slowo8"); // żadne słowo nie jest ucięte w środku
  });

  it("gdy ostatnia spacja wypada do 20. znaku, cięcie jest twarde na 60 znakach", () => {
    // Nagłówek "Ala " + jedno bardzo długie słowo: jedyna spacja jest na
    // pozycji 3, więc kod NIE cofa się do niej (progiem jest indeks > 20).
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>Ala ${znaki(120)}</h2>` },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "too_long_heading").snippet).toBe(`Ala ${znaki(LIMIT_SNIPPETU - 4)}…`);
  });

  it("słowo bez ani jednej spacji jest cięte twardo na 60 znakach", () => {
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${znaki(120)}</h2>` },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "too_long_heading").snippet).toBe(`${znaki(LIMIT_SNIPPETU)}…`);
  });
});

describe("validateHeadings - pozycja, język i kolejność uwag", () => {
  const DOKUMENT =
    `<h1>Jeden</h1><h1>Dwa</h1><h3></h3><h2>${znaki(80)}</h2>` +
    "<h2>WIELKIE LITERY TUTAJ</h2><h2>WIELKIE LITERY TUTAJ</h2>";

  it("position jest 1-indeksowana i wskazuje nagłówek w kolejności dokumentu", () => {
    const uwagi = validateHeadings("pl", { html: DOKUMENT });
    expect(uwaga(uwagi, "multiple_h1").position).toBe(2); // drugi H1
    expect(uwaga(uwagi, "empty_heading").position).toBe(3); // pusty H3
    expect(uwaga(uwagi, "skipped_level").position).toBe(3); // H1 -> H3
    expect(uwaga(uwagi, "too_long_heading").position).toBe(4);
    expect(uwaga(uwagi, "shouty_heading").position).toBe(5);
    expect(uwaga(uwagi, "duplicate_heading").position).toBe(6);
  });

  it("kolejność uwag na liście jest stała (podsumowanie panelu jej nie sortuje)", () => {
    expect(rodzaje(validateHeadings("pl", { html: DOKUMENT }))).toEqual([
      "multiple_h1",
      "empty_heading",
      "skipped_level",
      "too_long_heading",
      "shouty_heading",
      "duplicate_heading",
    ]);
  });

  it.each<HeadingIssueLang>(["pl", "en"])(
    "każda uwaga niesie lang=%s (podsumowanie etykietuje wiersze językiem)",
    (lang) => {
      const uwagi = validateHeadings(lang, { html: DOKUMENT });
      expect(uwagi.length).toBe(6);
      expect(uwagi.every((i) => i.lang === lang)).toBe(true);
    },
  );

  it.each<HeadingIssueLang>(["pl", "en"])("missing_h1 też niesie lang=%s", (lang) => {
    expect(validateHeadings(lang, { html: "<h2>Sekcja</h2>" })).toEqual([
      { lang, kind: "missing_h1", severity: "warning" },
    ]);
  });
});

describe("validateHeadings - severity per rodzaj uwagi", () => {
  // Od wagi zależy, czy podsumowanie panelu świeci na czerwono (SeoValidationSummary
  // ustawia `hasError` na podstawie `severity === "error"`), więc każdy rodzaj
  // ma tu swój wiersz: fałszywy `error` blokuje pracę redakcji tak samo
  // skutecznie, jak przegapiony `error` przepuszcza błąd na produkcję.
  it.each<{
    kind: HeadingIssueKind;
    severity: HeadingIssue["severity"];
    html: string;
    rendersTitleAsH1: boolean;
  }>([
    { kind: "missing_h1", severity: "warning", html: "<h2>Sekcja</h2>", rendersTitleAsH1: false },
    {
      kind: "multiple_h1",
      severity: "error",
      html: "<h1>Raz</h1><h1>Dwa</h1>",
      rendersTitleAsH1: false,
    },
    {
      kind: "extra_h1",
      severity: "warning",
      html: "<h1>Raz</h1>",
      rendersTitleAsH1: true,
    },
    {
      kind: "skipped_level",
      severity: "warning",
      html: "<h1>Raz</h1><h3>Trzy</h3>",
      rendersTitleAsH1: false,
    },
    {
      kind: "empty_heading",
      severity: "warning",
      html: "<h1>Raz</h1><h2></h2>",
      rendersTitleAsH1: false,
    },
    {
      kind: "duplicate_heading",
      severity: "warning",
      html: "<h2>Sekcja</h2><h2>Sekcja</h2>",
      rendersTitleAsH1: true,
    },
    {
      kind: "too_long_heading",
      severity: "warning",
      html: `<h2>${znaki(LIMIT_DLUGOSCI + 1)}</h2>`,
      rendersTitleAsH1: true,
    },
    {
      kind: "shouty_heading",
      severity: "warning",
      html: "<h2>WIELKIE LITERY TUTAJ</h2>",
      rendersTitleAsH1: true,
    },
  ])("$kind ma severity $severity", ({ kind, severity, html, rendersTitleAsH1 }) => {
    const uwagi = validateHeadings("pl", { html }, { rendersTitleAsH1 });
    expect(uwaga(uwagi, kind).severity).toBe(severity);
  });

  it("multiple_h1 jest JEDYNYM rodzajem o wadze error", () => {
    const bledy = [
      ...validateHeadings("pl", { html: "<h1>Raz</h1><h1>Dwa</h1>" }),
      ...validateHeadings("pl", { html: "<h2>Sekcja</h2>" }),
      ...validateHeadings(
        "pl",
        {
          html:
            `<h1>Raz</h1><h3></h3><h2>${znaki(80)}</h2>` +
            "<h2>WIELKIE LITERY TUTAJ</h2><h2>WIELKIE LITERY TUTAJ</h2>",
        },
        { rendersTitleAsH1: true },
      ),
    ].filter((i) => i.severity === "error");
    expect(bledy.map((i) => i.kind)).toEqual(["multiple_h1"]);
  });
});

describe("validateHeadings - wejście blokowe", () => {
  it("drzewo bloków przechodzi przez te same reguły co HTML", () => {
    const uwagi = validateHeadings("en", {
      blocks: [{ type: "header", data: { level: 2, text: "Only section" } }],
    });
    expect(uwagi).toEqual([{ lang: "en", kind: "missing_h1", severity: "warning" }]);
  });

  it("PRZYPIĘTE: gdy PODANE są oba źródła, reguły liczone są z BLOKÓW", () => {
    // H1 z HTML zniknąłby z widoku walidatora, więc dokument z poprawnym H1 w
    // HTML dostaje uwagę o BRAKU H1 - to jest miara pierwszeństwa źródeł.
    const uwagi = validateHeadings("pl", {
      html: "<h1>Tytuł z HTML</h1>",
      blocks: [{ type: "heading", data: { level: 2, text: "Tylko sekcja" } }],
    });
    expect(rodzaje(uwagi)).toEqual(["missing_h1"]);
  });

  it.each([
    { opis: "blocks: null", blocks: null },
    { opis: "blocks: undefined", blocks: undefined },
    { opis: "pusta tablica bloków", blocks: [] },
  ])("$opis oddaje głos HTML-owi", ({ blocks }) => {
    const uwagi = validateHeadings("pl", { html: "<h1>Raz</h1><h1>Dwa</h1>", blocks });
    expect(rodzaje(uwagi)).toEqual(["multiple_h1"]);
  });

  it.each([
    { opis: "obiekt bez oczekiwanych pól", blocks: { foo: { bar: 1 } } },
    { opis: "głęboko zagnieżdżone śmieci", blocks: { a: { b: { c: [{ d: "x" }] } } } },
    { opis: "napis zamiast drzewa", blocks: "surowa treść" },
    { opis: "liczba", blocks: 3 },
  ])("$opis nie rzuca i nie generuje uwag, gdy nie ma HTML", ({ blocks }) => {
    expect(() => validateHeadings("pl", { blocks })).not.toThrow();
    expect(validateHeadings("pl", { blocks })).toEqual([]);
  });

  it("bloki o nieznanym poziomie wpadają jako H2 - i widać to w uwagach", () => {
    // Poziom-śmieć staje się 2, więc dokument bez H1 dostaje missing_h1,
    // a nie uwagę o przeskoku poziomu.
    const uwagi = validateHeadings("pl", {
      blocks: [{ type: "heading", data: { level: "brak", text: "Sekcja" } }],
    });
    expect(rodzaje(uwagi)).toEqual(["missing_h1"]);
  });
});
