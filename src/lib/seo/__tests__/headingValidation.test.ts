// CO DOWODZI TEN PLIK
// Cała reguła strukturalna nagłówków (`src/lib/seo/headingValidation.ts`) -
// jedyne miejsce, które mówi redakcji, że wpis ma dwa H1, dziurę w hierarchii
// albo nagłówek nie do przeczytania w SERP-ie. Moduł jest czysty, więc mierzę
// go DECYZJAMI, nie renderem:
//   1. skaner HTML (`headingsFromHtml`): poziomy H1-H6, atrybuty w tagu,
//      znaczniki wewnątrz nagłówka, wielolinijkowy nagłówek, zwijanie białych
//      znaków, tag niedomknięty (POMINIĘTY), dekodowanie encji HTML (raz,
//      bez podwójnego dekodowania) oraz pomijanie tego, czego przeglądarka
//      NIE renderuje (komentarz, treść zastępcza `<iframe>`, `noscript`,
//      `template`, `script`, `style`, `textarea`) - z liniowym czasem
//      skanowania, bo skaner chodzi przy każdym uderzeniu w klawiaturę;
//      `<script>`/`<!--` WEWNĄTRZ wartości atrybutu (`alt`, `title`) to tekst
//      atrybutu, a nie otwarcie kontenera połykającego resztę dokumentu,
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
// Cztery dawne defekty (encje zawyżające długość, duplikat schowany za
// `&nbsp;`, nagłówki z `<iframe>`/komentarza, martwy punkt przy
// `rendersTitleAsH1: true`) są naprawione i stoją tu jako STRAŻNICY regresji
// razem z przypadkami sąsiednimi i negatywnymi (czego naprawa NIE rusza:
// `blockquote`/`figcaption` dalej liczone, flaga `false` dalej mierzy od
// pierwszego nagłówka, nieznana encja zostaje dosłownie).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
//   * `src/components/admin/seo/__tests__/SeoValidationSummary.test.tsx` -
//     DROGA uwagi na ekran: test "żadna uwaga policzona przez validateHeadings
//     nie ginie po drodze do listy" pilnuje, że liczba wierszy równa się
//     liczbie uwag, a strażnik stanu "nie sprawdzono" pilnuje, że zielone
//     "brak uwag" nie potwierdza walidacji, która nie miała czego sprawdzić
//     (tu dowodzę tylko sygnału `headingCount`, na którym ten stan stoi). Tutaj nie renderuję ani jednego komponentu - sprawdzam
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
  analyzeHeadings,
  collectHeadings,
  decodeHtmlEntities,
  hasReadableText,
  headingsFromBlocks,
  headingsFromHtml,
  validateHeadings,
  visibleHtml,
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

  it("encja &nbsp; jest dekodowana i zwijana do zwykłej spacji", () => {
    // STRAŻNIK: tekst nagłówka to tekst WIDZIANY przez czytelnika. Gdyby
    // `&nbsp;` wrócił jako sześć znaków, limit długości i klucz duplikatu
    // znowu mierzyłyby źródło HTML zamiast treści (patrz strażnicy niżej).
    expect(headingsFromHtml("<h2>Ala&nbsp;ma kota</h2>")).toEqual([
      { level: 2, text: "Ala ma kota" },
    ]);
  });
});

describe("headingsFromHtml - dekodowanie encji HTML", () => {
  it.each([
    { opis: "&amp;", html: "<h2>B&amp;R</h2>", text: "B&R" },
    {
      opis: "&quot; i &#39;",
      html: "<h2>&quot;Cytat&quot; i &#39;apostrof&#39;</h2>",
      text: `"Cytat" i 'apostrof'`,
    },
    { opis: "&apos;", html: "<h2>Rock&apos;n&apos;roll</h2>", text: "Rock'n'roll" },
    { opis: "dziesiętna &#8211;", html: "<h2>2025&#8211;2026</h2>", text: "2025\u20132026" },
    { opis: "szesnastkowa &#x2014; (małe x)", html: "<h2>A&#x2014;B</h2>", text: "A\u2014B" },
    {
      opis: "szesnastkowa &#X1F642; (wielkie X, poza BMP)",
      html: "<h2>Hej&#X1F642;</h2>",
      text: "Hej🙂",
    },
    { opis: "&#160; to też twarda spacja", html: "<h2>Ala&#160;ma</h2>", text: "Ala ma" },
    {
      opis: "&hellip; i typograficzne cudzysłowy",
      html: "<h2>&bdquo;Tak&rdquo;&hellip;</h2>",
      text: "\u201eTak\u201d\u2026",
    },
    {
      opis: "polskie litery z WordPressa",
      html: "<h2>Gr&oacute;b &Lstrok;&oacute;d&zacute;</h2>",
      text: "Grób Łódź",
    },
  ])("$opis", ({ html, text }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text }]);
  });

  it("dekoduje RAZ: &amp;nbsp; to dosłowny napis „&nbsp;”, a nie spacja", () => {
    // Podwójne dekodowanie zamieniłoby tekst, który redaktor CELOWO napisał
    // (np. nagłówek poradnika o HTML-u), w coś innego, niż widzi czytelnik.
    expect(headingsFromHtml("<h2>Encja &amp;nbsp; w HTML</h2>")).toEqual([
      { level: 2, text: "Encja &nbsp; w HTML" },
    ]);
  });

  it("&lt;b&gt; zostaje TEKSTEM - dekodowanie idzie PO zdjęciu znaczników", () => {
    // Gdyby kolejność była odwrotna, `<b>` z encji zostałby zdjęty jak tag i
    // z nagłówka „Znacznik <b>” zostałoby samo „Znacznik”.
    expect(headingsFromHtml("<h2>Znacznik &lt;b&gt;</h2>")).toEqual([
      { level: 2, text: "Znacznik <b>" },
    ]);
  });

  it.each([
    { opis: "nieznana nazwa", html: "<h2>A &foo; B</h2>", text: "A &foo; B" },
    { opis: "goły ampersand", html: "<h2>Ala & Ola</h2>", text: "Ala & Ola" },
    {
      opis: "nazwa z prototypu obiektu (&constructor;)",
      html: "<h2>&constructor;</h2>",
      text: "&constructor;",
    },
    { opis: "wielkość liter w nazwie ma znaczenie (&AMP;)", html: "<h2>&AMP;</h2>", text: "&AMP;" },
  ])("$opis zostaje DOSŁOWNIE (negatywny: nie zgadujemy encji)", ({ html, text }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text }]);
  });

  it("OGRANICZENIE: encja bez średnika (&amp B) zostaje dosłownie", () => {
    // Przeglądarka dekoduje kilkadziesiąt historycznych nazw także bez `;`.
    // Świadomie tego nie odtwarzamy: edytory WYSIWYG zawsze domykają encję
    // średnikiem, a skutkiem rozjazdu jest co najwyżej zawyżenie długości o
    // kilka znaków - nigdy fałszywy brak uwagi.
    expect(headingsFromHtml("<h2>A &amp B</h2>")).toEqual([{ level: 2, text: "A &amp B" }]);
  });

  it.each([
    { opis: "&#0;", html: "<h2>a&#0;b</h2>" },
    { opis: "surogat &#xD800;", html: "<h2>a&#xD800;b</h2>" },
    { opis: "poza Unicode &#x110000;", html: "<h2>a&#x110000;b</h2>" },
    { opis: "absurdalnie długa liczba", html: `<h2>a&#${"9".repeat(400)};b</h2>` },
  ])("$opis daje U+FFFD zamiast wyjątku (jak parser HTML)", ({ html }) => {
    // `String.fromCodePoint` rzuca RangeError poza zakresem - jeden zły
    // wklejony znak nie może wywrócić panelu SEO przy każdym uderzeniu w klawisz.
    expect(() => headingsFromHtml(html)).not.toThrow();
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text: "a\ufffdb" }]);
  });

  it("encje w drzewie bloków są dekodowane tak samo jak w HTML", () => {
    expect(
      headingsFromBlocks([{ type: "header", data: { level: 2, text: "Ala&nbsp;ma &amp; kota" } }]),
    ).toEqual([{ level: 2, text: "Ala ma & kota" }]);
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
      opis: "details/summary",
      html: "<details><summary>Więcej</summary><h3>Rozwinięcie</h3></details>",
      oczekiwany: [{ level: 3, text: "Rozwinięcie" }],
    },
  ])("nagłówek w $opis JEST liczony (to realny nagłówek w DOM-ie)", ({ html, oczekiwany }) => {
    // NEGATYWNY dla naprawy niżej: pomijamy wyłącznie to, czego parser HTML
    // nie zamienia w wyrenderowane elementy. Cytat, podpis i rozwijany blok
    // to prawdziwe nagłówki strony - ich pominięcie schowałoby realne dziury.
    expect(headingsFromHtml(html)).toEqual(oczekiwany);
  });

  it.each([
    { opis: "treść zastępcza <iframe>", html: "<iframe src='/widget'><h2>Osadzony</h2></iframe>" },
    { opis: "komentarz HTML", html: "<!-- <h2>Zakomentowany</h2> -->" },
    { opis: "<noscript>", html: "<noscript><h2>Bez JS</h2></noscript>" },
    { opis: "<template>", html: "<template><h2>Szablon</h2></template>" },
    { opis: "<script>", html: "<script>el.innerHTML = '<h2>Z kodu</h2>';</script>" },
    { opis: "<style>", html: "<style>/* <h2>Z CSS</h2> */</style>" },
    { opis: "<textarea>", html: "<textarea><h2>Tekst pola</h2></textarea>" },
    { opis: "kontener WIELKIMI literami", html: "<IFRAME><h2>Osadzony</h2></IFRAME>" },
    {
      opis: "kontener z atrybutami w kilku liniach",
      html: "<iframe\n  src='/x'\n><h2>X</h2></iframe>",
    },
  ])("nagłówek w $opis NIE jest liczony (przeglądarka go nie renderuje)", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([]);
  });

  it("nagłówki PRZED i PO pominiętym kontenerze zostają, w kolejności dokumentu", () => {
    expect(
      headingsFromHtml(
        "<h1>Tytuł</h1><!-- <h2>stara</h2> --><h2>Sekcja</h2><iframe><h5>W</h5></iframe><h3>Dalej</h3>",
      ),
    ).toEqual([
      { level: 1, text: "Tytuł" },
      { level: 2, text: "Sekcja" },
      { level: 3, text: "Dalej" },
    ]);
  });

  it("komentarz WEWNĄTRZ nagłówka znika z tekstu, a zamknięcie w komentarzu go nie domyka", () => {
    // `</h2>` schowane w komentarzu nie jest tagiem - nagłówek kończy się na
    // pierwszym WIDOCZNYM `</h2>`, a tekst nie zawiera treści komentarza.
    expect(headingsFromHtml("<h2>Ala <!-- </h2> notatka --> ma kota</h2>")).toEqual([
      { level: 2, text: "Ala ma kota" },
    ]);
  });

  it("<template> zagnieżdżony w <template> nie domyka zewnętrznego za wcześnie", () => {
    expect(
      headingsFromHtml(
        "<template><template><h2>A</h2></template><h2>B</h2></template><h2>Widoczny</h2>",
      ),
    ).toEqual([{ level: 2, text: "Widoczny" }]);
  });

  it.each([
    { opis: "niedomknięty komentarz", html: "<h2>Przed</h2><!-- <h2>Po</h2>" },
    { opis: "niedomknięty <iframe>", html: "<h2>Przed</h2><iframe><h2>Po</h2>" },
    { opis: "niedomknięty <template>", html: "<h2>Przed</h2><template><h2>Po</h2>" },
  ])("$opis połyka resztę dokumentu - jak w przeglądarce", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text: "Przed" }]);
  });

  it.each([
    { opis: "<!-->", html: "<!--><h2>Widoczny</h2>" },
    { opis: "<!--->", html: "<!---><h2>Widoczny</h2>" },
  ])("pusty komentarz $opis jest domknięty od razu (specyfikacja HTML)", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text: "Widoczny" }]);
  });

  it.each([
    { opis: "<iframes> (inna nazwa tagu)", html: "<iframes><h2>Widoczny</h2></iframes>" },
    { opis: "<scripted> (inna nazwa tagu)", html: "<scripted><h2>Widoczny</h2></scripted>" },
    { opis: "tekst „<iframe” zapisany encją", html: "<p>&lt;iframe&gt;</p><h2>Widoczny</h2>" },
  ])("$opis NIE jest kontenerem do pominięcia (negatywny)", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text: "Widoczny" }]);
  });

  it("nagłówek z <iframe> NIE fałszuje hierarchii widzianej przez walidator", () => {
    // STRAŻNIK dawnego defektu: H5 z treści zastępczej widżetu dawał uwagę o
    // przeskoku H2 -> H5, którego na wyrenderowanej stronie nie ma, a której
    // redakcja nie miała jak poprawić.
    const uwagi = validateHeadings("pl", {
      html: "<h1>Tytuł</h1><h2>Sekcja</h2><iframe><h5>Widget</h5></iframe>",
    });
    expect(rodzaje(uwagi)).not.toContain("skipped_level");
    expect(uwagi).toEqual([]);
  });

  it("nagłówek z komentarza NIE daje fałszywego duplikatu", () => {
    // STRAŻNIK: zakomentowana stara wersja sekcji dawała `duplicate_heading`,
    // a redaktor kasował WIDOCZNĄ sekcję, żeby uciszyć uwagę.
    const uwagi = validateHeadings(
      "pl",
      { html: "<!-- <h2>Wnioski</h2> --><h2>Wnioski</h2>" },
      { rendersTitleAsH1: true },
    );
    expect(uwagi).toEqual([]);
  });

  it("komentarz w tekście bloku nie trafia do tekstu nagłówka", () => {
    expect(
      headingsFromBlocks([{ type: "heading", data: { level: 2, text: "Ala<!-- x --> ma" } }]),
    ).toEqual([{ level: 2, text: "Ala ma" }]);
  });
});

describe("headingsFromHtml - `<` wewnątrz wartości atrybutu", () => {
  // STRAŻNIK: `visibleHtml` dopasowywał nazwę kontenera przy KAŻDYM `<`, także
  // w cudzysłowie atrybutu. `<img alt="<script>">` bez `</script>` dalej w
  // treści otwierał "kontener do końca dokumentu" - kontrola nagłówków
  // wyłączała się po cichu, a panel mówił "nie ma żadnego nagłówka". Markup z
  // importu WP i starszych serializatorów nie zawsze escapuje `<` w atrybutach.
  it('<img alt="<script>"> nie ucina dokumentu - przeskok H2 -> H4 jest zgłaszany', () => {
    const html = '<img alt="<script>"><h2>A</h2><h4>B</h4>';
    expect(headingsFromHtml(html)).toEqual([
      { level: 2, text: "A" },
      { level: 4, text: "B" },
    ]);
    const uwagi = validateHeadings("pl", { html }, { rendersTitleAsH1: true });
    expect(uwaga(uwagi, "skipped_level")).toMatchObject({ from: 2, to: 4, position: 2 });
  });

  it.each([
    {
      opis: "title z <textarea> (cudzysłów podwójny)",
      html: '<p title="<textarea>">x</p><h2>A</h2>',
    },
    { opis: "alt z <iframe> (apostrof)", html: "<img alt='<iframe>'><h2>A</h2>" },
    { opis: "title z <!-- (komentarz w atrybucie)", html: '<a title="<!--">x</a><h2>A</h2>' },
    { opis: "spacje wokół =", html: '<img alt = "<style>"><h2>A</h2>' },
    { opis: "wartość bez cudzysłowu", html: "<img alt=<script>><h2>A</h2>" },
    { opis: "`>` w cudzysłowie atrybutu", html: '<img alt="a > <noscript>"><h2>A</h2>' },
    { opis: "apostrof poza wartością (`<a it's>`)", html: "<a it's><h2>A</h2></a>" },
  ])("$opis: nagłówek po tagu zostaje policzony", ({ html }) => {
    expect(headingsFromHtml(html)).toEqual([{ level: 2, text: "A" }]);
  });

  it("kontener z `>` w cudzysłowie atrybutu nadal jest pomijany w całości", () => {
    expect(headingsFromHtml('<iframe title="a>b"><h2>Środek</h2></iframe><h2>Po</h2>')).toEqual([
      { level: 2, text: "Po" },
    ]);
  });

  it("niedomknięta wartość atrybutu połyka resztę dokumentu - jak w przeglądarce", () => {
    // Tokenizer HTML czyta wartość do EOF i tagu nie emituje w ogóle.
    expect(headingsFromHtml('<h2>Przed</h2><img alt="<script><h2>Po</h2>')).toEqual([
      { level: 2, text: "Przed" },
    ]);
  });

  it("visibleHtml zwraca TEN SAM napis, gdy `<script>` jest tylko w atrybucie", () => {
    const html = '<img alt="<script>"><p>x</p>';
    expect(visibleHtml(html)).toBe(html);
  });

  it("prawdziwy <script> po tagu z cudzysłowem nadal jest wycinany (negatywny)", () => {
    expect(
      headingsFromHtml('<img alt="x"><script>"<h2>Z kodu</h2>"</script><h2>Widoczny</h2>'),
    ).toEqual([{ level: 2, text: "Widoczny" }]);
  });
});

describe("headingsFromHtml - czas skanowania", () => {
  // Skaner chodzi przy KAŻDYM uderzeniu w klawiaturę w edytorze. Poprzednie
  // wyrażenie `<h([1-6])...>([\s\S]*?)<\/h\1>` przy każdym niedomkniętym
  // nagłówku przeszukiwało resztę dokumentu do końca - k niedomkniętych tagów
  // to k pełnych przebiegów (koszt kwadratowy). Progi są CELOWO hojne (rząd
  // wielkości ponad zmierzony czas), żeby test łapał powrót złożoności, a nie
  // chwilowe obciążenie maszyny CI.
  it("30 000 niedomkniętych <h3> przed jednym domkniętym H2 skanuje się liniowo", () => {
    const html = `${"<h3>x".repeat(30_000)}<h2>Koniec</h2>`;
    const start = performance.now();
    const wynik = headingsFromHtml(html);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(wynik).toEqual([{ level: 2, text: "Koniec" }]);
  });

  it("30 000 niedomkniętych <iframe ... bez `>` nie zapętla skanera", () => {
    const html = `<h2>Start</h2>${"<iframe".repeat(30_000)}`;
    const start = performance.now();
    const wynik = headingsFromHtml(html);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(wynik).toEqual([{ level: 2, text: "Start" }]);
  });

  it("nagłówek z 30 000 znaków „<” bez „>” w środku zdejmuje znaczniki liniowo", () => {
    // Tekst nagłówka też jest czyszczony ze znaczników; `<[^>]*>` z flagą g
    // przy braku `>` przeszukiwał wycinek od KAŻDEGO kolejnego `<`.
    const html = `<h2>${"<a".repeat(30_000)}</h2>`;
    const start = performance.now();
    const wynik = headingsFromHtml(html);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(wynik).toEqual([{ level: 2, text: "<a".repeat(30_000) }]);
  });

  it("30 000 tagów z `<script>` w atrybucie skanuje się liniowo", () => {
    const html = `${'<img alt="<script>">'.repeat(30_000)}<h2>Koniec</h2>`;
    const start = performance.now();
    const wynik = headingsFromHtml(html);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(wynik).toEqual([{ level: 2, text: "Koniec" }]);
  });

  it("artykuł z 2 000 sekcji i encjami w każdej daje wszystkie nagłówki", () => {
    const html = Array.from(
      { length: 2_000 },
      (_, i) => `<h2>Sekcja&nbsp;${i}</h2><p>Akapit &amp; treść <!-- uwaga --></p>`,
    ).join("");
    const start = performance.now();
    const wynik = headingsFromHtml(html);
    expect(performance.now() - start).toBeLessThan(1_000);
    expect(wynik).toHaveLength(2_000);
    expect(wynik[1_999]).toEqual({ level: 2, text: "Sekcja 1999" });
  });
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

describe("visibleHtml i decodeHtmlEntities - kontrakt eksportu", () => {
  it("bez niczego do wycięcia zwraca TEN SAM napis (zero alokacji na typowym wpisie)", () => {
    const html = "<h2>Sekcja</h2><p>Akapit</p>";
    expect(visibleHtml(html)).toBe(html);
  });

  it("wycina komentarze i kontenery, zostawiając resztę bajt w bajt", () => {
    expect(visibleHtml("<p>a</p><!-- x --><p>b</p><script>s()</script><p>c</p>")).toBe(
      "<p>a</p><p>b</p><p>c</p>",
    );
  });

  it("napis bez ampersandu wraca bez zmian, z ampersandem dekodowany raz", () => {
    expect(decodeHtmlEntities("bez encji")).toBe("bez encji");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });
});

describe("hasReadableText - czy język ma w ogóle treść", () => {
  // Na tym sygnale panel odróżnia "brak tłumaczenia" (nic do sprawdzenia, bez
  // uwagi) od "treść bez nagłówków" (kontrola nie miała na czym zadziałać).
  it.each([
    { opis: "null", html: null },
    { opis: "undefined", html: undefined },
    { opis: "pusty napis", html: "" },
    { opis: "same spacje", html: "   \n " },
    { opis: "pusty akapit pustego edytora", html: "<p></p>" },
    { opis: "akapit z samym &nbsp;", html: "<p>&nbsp;</p>" },
    { opis: "sam komentarz", html: "<!-- szkic -->" },
    { opis: "sam <script>", html: "<script>track()</script>" },
    { opis: "sam obraz", html: '<p><img src="/a.png" alt=""></p>' },
  ])("$opis -> brak treści", ({ html }) => {
    expect(hasReadableText(html)).toBe(false);
  });

  it.each([
    { opis: "akapit z tekstem", html: "<p>Akapit</p>" },
    { opis: "goły tekst", html: "x" },
    { opis: "tekst zapisany encją", html: "<p>&oacute;</p>" },
    { opis: "pusty nagłówek obok tekstu", html: "<h2></h2><p>a</p>" },
  ])("$opis -> jest treść", ({ html }) => {
    expect(hasReadableText(html)).toBe(true);
  });
});

describe("analyzeHeadings - liczba sprawdzonych nagłówków", () => {
  it.each([
    { opis: "pusty HTML", input: { html: "" } },
    { opis: "akapit bez nagłówków", input: { html: "<p>Akapit</p>" } },
    { opis: "nagłówek tylko w komentarzu", input: { html: "<!-- <h2>X</h2> -->" } },
    { opis: "brak obu źródeł", input: {} },
  ])("$opis: headingCount 0 i pusta lista - NIE SPRAWDZONO", ({ input }) => {
    expect(analyzeHeadings("pl", input, { rendersTitleAsH1: true })).toEqual({
      issues: [],
      headingCount: 0,
    });
  });

  it("czysta hierarchia: pusta lista uwag, ale headingCount > 0 - SPRAWDZONO", () => {
    // To jest jedyna różnica między "czysto" a "nie było czego sprawdzić" -
    // panel na niej opiera stan "nie sprawdzono" w podsumowaniu.
    expect(
      analyzeHeadings("pl", { html: "<h2>A</h2><h3>B</h3>" }, { rendersTitleAsH1: true }),
    ).toEqual({ issues: [], headingCount: 2 });
  });

  it("validateHeadings zwraca dokładnie `issues` z analyzeHeadings (zgodność wsteczna API)", () => {
    const input = { html: "<h1>A</h1><h1>B</h1><h3></h3>" };
    expect(validateHeadings("pl", input)).toEqual(analyzeHeadings("pl", input).issues);
    expect(analyzeHeadings("pl", input).headingCount).toBe(3);
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

  it("przy rendersTitleAsH1: true przeskok z H1 układu do H3 treści JEST zgłaszany", () => {
    // STRAŻNIK dawnego defektu: walidator WIE, że układ renderuje H1, więc
    // pierwszy nagłówek treści jest mierzony względem poziomu 1, a nie
    // względem samego siebie. KONSEKWENCJA regresji: wpis zaczynający się od
    // H3 (typowe po imporcie z WP) ma w DOM-ie realną dziurę H1 -> H3, czytniki
    // ekranu i parsery outline'u tracą poziom, a panel świeci "brak uwag" - w
    // najczęstszej konfiguracji produkcyjnej, bo panel woła walidator
    // DOKŁADNIE z tą flagą.
    const uwagi = validateHeadings(
      "pl",
      { html: "<h3>Start</h3><h4>Dalej</h4>" },
      { rendersTitleAsH1: true },
    );
    expect(uwagi).toEqual([
      {
        lang: "pl",
        kind: "skipped_level",
        severity: "warning",
        from: 1,
        to: 3,
        position: 1,
        snippet: "Start",
      },
    ]);
  });

  it.each([
    { opis: "H2 jako pierwszy nagłówek treści", html: "<h2>A</h2><h3>B</h3>" },
    { opis: "H1 w treści (extra_h1), potem H2", html: "<h1>A</h1><h2>B</h2>" },
    { opis: "sam H2", html: "<h2>A</h2>" },
  ])("przy rendersTitleAsH1: true $opis NIE daje przeskoku (negatywny)", ({ html }) => {
    expect(rodzaje(validateHeadings("pl", { html }, { rendersTitleAsH1: true }))).not.toContain(
      "skipped_level",
    );
  });

  it("przy rendersTitleAsH1: true H4 po H1 z treści to przeskok 1 -> 4 na pozycji 2", () => {
    const uwagi = validateHeadings(
      "pl",
      { html: "<h1>W treści</h1><h4>Za głęboko</h4>" },
      { rendersTitleAsH1: true },
    );
    expect(rodzaje(uwagi)).toEqual(["extra_h1", "skipped_level"]);
    expect(uwaga(uwagi, "skipped_level")).toMatchObject({ from: 1, to: 4, position: 2 });
  });

  it("przy rendersTitleAsH1: true start od H3 w drzewie bloków też jest przeskokiem", () => {
    const uwagi = validateHeadings(
      "en",
      { blocks: [{ type: "heading", data: { level: 3, text: "Block start" } }] },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "skipped_level")).toMatchObject({
      lang: "en",
      from: 1,
      to: 3,
      position: 1,
      snippet: "Block start",
    });
  });

  it("BEZ flagi treść startująca od H3 nadal mierzona jest od pierwszego nagłówka (negatywny)", () => {
    // Bez wiedzy o układzie walidator nie zgaduje H1 - zgłasza `missing_h1`,
    // a hierarchię liczy od H3. Naprawa kontekstu renderowania nie może
    // dorobić drugiej, wymyślonej uwagi o przeskoku.
    expect(rodzaje(validateHeadings("pl", { html: "<h3>Start</h3><h4>Dalej</h4>" }))).toEqual([
      "missing_h1",
    ]);
  });
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

  it("duplikat schowany za encją &nbsp; JEST zgłaszany", () => {
    // STRAŻNIK dawnego defektu: klucz duplikatu liczony jest na TEKŚCIE
    // WIDZIANYM przez czytelnika, czyli po dekodowaniu encji. KONSEKWENCJA
    // regresji: edytor WYSIWYG wstawia `&nbsp;` niewidocznie (np. po
    // jednoliterowym spójniku), więc dwie identycznie brzmiące sekcje
    // przechodziłyby kontrolę i konkurowały w SERP-ie.
    const uwagi = validateHeadings(
      "pl",
      { html: "<h2>Ala ma kota</h2><h3>Ala&nbsp;ma kota</h3>" },
      { rendersTitleAsH1: true },
    );
    expect(uwagi).toEqual([
      {
        lang: "pl",
        kind: "duplicate_heading",
        severity: "warning",
        position: 2,
        snippet: "Ala ma kota",
      },
    ]);
  });

  it.each([
    { opis: "&#160;", html: "<h2>Ala ma kota</h2><h2>Ala&#160;ma kota</h2>" },
    { opis: "&amp; kontra goły &", html: "<h2>B&amp;R</h2><h2>B&R</h2>" },
    {
      opis: "encja polskiej litery",
      html: "<h2>Wnioski z łódzkiego</h2><h2>Wnioski z &lstrok;ódzkiego</h2>",
    },
  ])("duplikat różniący się tylko zapisem ($opis) też jest wykrywany", ({ html }) => {
    expect(
      uwaga(validateHeadings("pl", { html }, { rendersTitleAsH1: true }), "duplicate_heading"),
    ).toMatchObject({ position: 2 });
  });

  it("encja dająca INNY znak nie robi duplikatu (negatywny: &ndash; to nie łącznik)", () => {
    expect(
      rodzaje(
        validateHeadings(
          "pl",
          { html: "<h2>2025-2026</h2><h2>2025&ndash;2026</h2>" },
          { rendersTitleAsH1: true },
        ),
      ),
    ).not.toContain("duplicate_heading");
  });
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

  it("nagłówek 62 znaków rozdzielony encjami &nbsp; liczy się jako 62 znaki, nie 102", () => {
    // STRAŻNIK dawnego defektu: liczony jest tekst WIDZIANY przez czytelnika.
    // KONSEKWENCJA regresji: każda encja ważyłaby 6 znaków, więc treść
    // wklejona z edytora WYSIWYG dostawałaby uwagę "za długi nagłówek", której
    // nie da się spełnić - redaktor obcinałby sensowny nagłówek, a licznik
    // dalej pokazywałby ponad 100 znaków.
    expect(slowa(9).length).toBe(62);
    expect(slowa(9, "&nbsp;").length).toBe(102);
    expect(
      validateHeadings(
        "pl",
        { html: `<h2>${slowa(9, "&nbsp;")}</h2>` },
        { rendersTitleAsH1: true },
      ),
    ).toEqual([]);
  });

  it("za długi nagłówek z encjami podaje w count długość PO dekodowaniu", () => {
    // 12 słów = 85 znaków widocznych (i 140 w źródle z `&nbsp;`): uwaga zostaje,
    // ale liczba w panelu zgadza się z tym, co redaktor widzi w edytorze.
    expect(slowa(12).length).toBe(85);
    expect(slowa(12, "&nbsp;").length).toBe(140);
    const uwagi = validateHeadings(
      "pl",
      { html: `<h2>${slowa(12, "&nbsp;")}</h2>` },
      { rendersTitleAsH1: true },
    );
    expect(uwaga(uwagi, "too_long_heading")).toMatchObject({ count: 85 });
    expect(uwaga(uwagi, "too_long_heading").snippet).not.toContain("&nbsp;");
  });

  it(`encja szesnastkowa liczy się jako JEDEN znak także na progu ${LIMIT_DLUGOSCI}`, () => {
    // 69 liter + jeden znak z encji `&#x105;` (ą) = dokładnie 70 widocznych.
    const html = `<h2>${znaki(LIMIT_DLUGOSCI - 1)}&#x105;</h2>`;
    expect(validateHeadings("pl", { html }, { rendersTitleAsH1: true })).toEqual([]);
    const zaDlugi = `<h2>${znaki(LIMIT_DLUGOSCI)}&#x105;</h2>`;
    expect(
      uwaga(
        validateHeadings("pl", { html: zaDlugi }, { rendersTitleAsH1: true }),
        "too_long_heading",
      ).count,
    ).toBe(LIMIT_DLUGOSCI + 1);
  });
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
