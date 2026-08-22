import { describe, expect, it } from "vitest";
import { buildRssXml, plainText, rfc822Date } from "@/lib/seo/rss";

describe("rfc822Date", () => {
  it("formats ISO dates as RFC 822 and rejects garbage", () => {
    expect(rfc822Date("2026-07-01T10:00:00Z")).toBe("Wed, 01 Jul 2026 10:00:00 GMT");
    expect(rfc822Date("not-a-date")).toBeNull();
    expect(rfc822Date(null)).toBeNull();
  });
});

describe("plainText", () => {
  it("strips tags, collapses whitespace and caps length", () => {
    expect(plainText("<p>Ala  ma<br> kota</p>")).toBe("Ala ma kota");
    expect(plainText("x".repeat(600), 10)).toHaveLength(10);
    expect(plainText(null)).toBe("");
  });
});

describe("buildRssXml", () => {
  const xml = buildRssXml({
    title: "NES",
    description: 'Analizy & "raporty"',
    siteUrl: "https://nes.example",
    feedUrl: "https://nes.example/rss.xml",
    language: "pl",
    copyright: "© 2026 NES",
    items: [
      {
        url: "https://nes.example/blog/wpis-a",
        title: "Wpis <A> & spółka",
        description: "<p>Zajawka</p>",
        publishedAt: "2026-07-01T10:00:00Z",
        categories: ["Geopolityka"],
        imageUrl: "https://nes.example/a.jpg",
        authorName: "Jan Kowalski",
      },
      {
        url: "https://nes.example/blog/wpis-b",
        title: "Wpis B",
        description: null,
        publishedAt: null,
      },
    ],
  });

  it("emits a valid RSS 2.0 skeleton with self link and language", () => {
    expect(xml).toContain(`<rss version="2.0"`);
    expect(xml).toContain(`<language>pl</language>`);
    expect(xml).toContain(
      `<atom:link href="https://nes.example/rss.xml" rel="self" type="application/rss+xml"/>`,
    );
    expect(xml).toContain(`<lastBuildDate>Wed, 01 Jul 2026 10:00:00 GMT</lastBuildDate>`);
    expect(xml).toContain(`<copyright>© 2026 NES</copyright>`);
  });
  it("escapes XML entities everywhere", () => {
    expect(xml).toContain("Wpis &lt;A&gt; &amp; spółka");
    expect(xml).toContain("Analizy &amp; &quot;raporty&quot;");
    expect(xml).not.toContain("<A>");
  });
  it("emits permalink guids, media and dc:creator", () => {
    expect(xml).toContain(`<guid isPermaLink="true">https://nes.example/blog/wpis-a</guid>`);
    expect(xml).toContain(`<media:content url="https://nes.example/a.jpg" medium="image"/>`);
    expect(xml).toContain(`<dc:creator>Jan Kowalski</dc:creator>`);
    expect(xml).toContain(`<category>Geopolityka</category>`);
  });
  it("omits optional fields cleanly", () => {
    const item = xml.slice(xml.indexOf("wpis-b"));
    expect(item).not.toContain("<pubDate>");
    expect(item).not.toContain("<description>");
  });
});

describe("buildRssXml - jawny guid (kanały wielopozycyjne per URL)", () => {
  // Kanał trackera emituje jedną pozycję na wpis osi czasu, a wszystkie
  // wskazują TEN SAM adres dossier. Bez jawnego guida czytnik widziałby
  // duplikaty i po pierwszej pozycji przestałby pokazywać alerty.
  const xml = buildRssXml({
    title: "Tracker",
    description: "Zmiany",
    siteUrl: "https://nes.example/tracker",
    feedUrl: "https://nes.example/tracker/rss.xml",
    language: "pl",
    items: [
      {
        url: "https://nes.example/tracker/ai-act#update-u1",
        guid: "tracker:update:u1",
        title: "AI Act - etap: Parlament -> Rada",
        description: "Rada przyjęła stanowisko",
        publishedAt: "2026-08-02T12:00:00.000Z",
      },
      {
        url: "https://nes.example/tracker/ai-act#update-u2",
        guid: "  ",
        title: "AI Act - aktualizacja",
        description: null,
        publishedAt: null,
      },
    ],
  });

  it("emituje guid isPermaLink=false, gdy podano jawną tożsamość", () => {
    expect(xml).toContain(`<guid isPermaLink="false">tracker:update:u1</guid>`);
  });

  it("zachowuje link jako osobne pole (kotwica wpisu osi czasu)", () => {
    expect(xml).toContain(`<link>https://nes.example/tracker/ai-act#update-u1</link>`);
  });

  it("puste/whitespace guid degraduje do permalinku - bez pustego węzła", () => {
    expect(xml).toContain(
      `<guid isPermaLink="true">https://nes.example/tracker/ai-act#update-u2</guid>`,
    );
    expect(xml).not.toContain(`<guid isPermaLink="false">  </guid>`);
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałęzie kanału na wejściach NIEPEŁNYCH (rss.ts:89 - pusta kategoria,
// rss.ts:107 - brak jakiejkolwiek poprawnej daty w kanale).
// NIE DUBLUJE `e2e/seo.spec.ts` - test "rss.xml returns a well-formed feed"
// dowodzi tam na żywym SSR trasy, typu treści i poprawności dokumentu; tutaj
// dowodzimy CZYSTEGO buildera na danych, których redakcja nie powinna, ale może
// wypuścić (tag bez nazwy, wpisy bez daty publikacji).
// ---------------------------------------------------------------------------
describe("buildRssXml - wejścia niepełne", () => {
  it("pomija <lastBuildDate>, gdy żadna pozycja nie ma poprawnej daty", () => {
    // Czytnik traktuje <lastBuildDate> jako znacznik świeżości. Pusty albo
    // wyliczony "na teraz" węzeł kazałby mu odpytywać kanał w kółko, a data
    // wzięta z niczego byłaby kłamstwem o treści.
    const xml = buildRssXml({
      title: "NES",
      description: "Analizy",
      siteUrl: "https://nes.example",
      feedUrl: "https://nes.example/rss.xml",
      language: "pl",
      items: [
        { url: "https://nes.example/a", title: "A", description: null, publishedAt: null },
        { url: "https://nes.example/b", title: "B", description: null, publishedAt: "nie-data" },
        { url: "https://nes.example/c", title: "C", description: null, publishedAt: "" },
      ],
    });
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).not.toContain("<pubDate>");
    // Kanał nadal jest poprawnym dokumentem z trzema pozycjami.
    expect(xml.match(/<item>/g)).toHaveLength(3);
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
  });

  it("pomija copyright pusty i null (bez pustego węzła w kanale)", () => {
    for (const copyright of [undefined, null, ""]) {
      const xml = buildRssXml({
        title: "NES",
        description: "Analizy",
        siteUrl: "https://nes.example",
        feedUrl: "https://nes.example/rss.xml",
        language: "pl",
        copyright,
        items: [],
      });
      expect(xml).not.toContain("<copyright>");
      expect(xml).not.toContain("<item>");
      expect(xml).toContain("<ttl>60</ttl>");
    }
  });

  it("pomija kategorie puste i z samych spacji, zachowując te realne", () => {
    // Tag bez nazwy trafiał do <category></category> - agregatory czytają to
    // jako kategorię o pustej nazwie i tworzą w indeksie śmieciowy wpis.
    const xml = buildRssXml({
      title: "NES",
      description: "Analizy",
      siteUrl: "https://nes.example",
      feedUrl: "https://nes.example/rss.xml",
      language: "pl",
      items: [
        {
          url: "https://nes.example/a",
          title: "A",
          description: null,
          publishedAt: null,
          categories: ["", "   ", "  Geopolityka  ", "\n"],
        },
      ],
    });
    expect(xml.match(/<category>/g)).toHaveLength(1);
    expect(xml).toContain("<category>Geopolityka</category>");
    expect(xml).not.toContain("<category></category>");
  });

  const blankCases: readonly { label: string; value: string | null | undefined }[] = [
    { label: "pominięte pole", value: undefined },
    { label: "null", value: null },
    { label: "pusty łańcuch", value: "" },
    { label: "same spacje", value: "   " },
  ];

  it.each(blankCases)("pomija autora i okładkę, gdy pole to $label", ({ value }) => {
    const xml = buildRssXml({
      title: "NES",
      description: "Analizy",
      siteUrl: "https://nes.example",
      feedUrl: "https://nes.example/rss.xml",
      language: "pl",
      items: [
        {
          url: "https://nes.example/a",
          title: "A",
          description: value ?? null,
          publishedAt: null,
          authorName: value,
          imageUrl: value,
          categories: undefined,
        },
      ],
    });
    // Kroimy od `<item>`, bo opis KANAŁU jest osobnym, zawsze obecnym węzłem.
    const item = xml.slice(xml.indexOf("<item>"));
    expect(item).not.toContain("<dc:creator>");
    expect(item).not.toContain("<media:content");
    expect(item).not.toContain("<description>");
    expect(item).not.toContain("<category>");
    expect(item).toContain('<guid isPermaLink="true">https://nes.example/a</guid>');
  });

  it("kanał bez pozycji jest poprawnym, pustym dokumentem RSS", () => {
    const xml = buildRssXml({
      title: "NES",
      description: "Analizy",
      siteUrl: "https://nes.example",
      feedUrl: "https://nes.example/rss.xml",
      language: "en",
      items: [],
    });
    expect(xml).not.toContain("<item>");
    expect(xml).not.toContain("<lastBuildDate>");
    expect(xml).toContain("<language>en</language>");
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
  });
});

describe("plainText / rfc822Date - wartości brzegowe", () => {
  it.each([
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "pusty łańcuch", value: "" },
    { label: "same tagi", value: "<p></p><br>" },
    { label: "same spacje i encje białych znaków", value: " \n\t " },
  ])("plainText zwraca pusty łańcuch dla $label", ({ value }) => {
    expect(plainText(value)).toBe("");
  });

  it("plainText przycina dokładnie do limitu i dokleja elipsę", () => {
    const out = plainText("a".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
    // Tekst DOKŁADNIE na granicy nie jest ruszany (brak zbędnej elipsy).
    expect(plainText("a".repeat(10), 10)).toBe("a".repeat(10));
  });

  it.each([
    { label: "pusty łańcuch", value: "" },
    { label: "undefined", value: undefined },
    { label: "data poza kalendarzem", value: "2026-02-30T99:00:00Z" },
    { label: "sam tekst", value: "wczoraj" },
  ])("rfc822Date zwraca null dla $label", ({ value }) => {
    expect(rfc822Date(value)).toBeNull();
  });
});
