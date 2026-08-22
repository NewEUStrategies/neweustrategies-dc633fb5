import { describe, expect, it } from "vitest";
import {
  breadcrumbListJsonLd,
  eventsCollectionJsonLd,
  organizationJsonLd,
  qaCollectionJsonLd,
  qaPageJsonLd,
  safeJsonLd,
  siteNavigationJsonLd,
  webSiteJsonLd,
  type ContactPointInput,
  type QaJsonLdQuestion,
  type SiteNavigationItem,
} from "@/lib/seo/jsonld";
import type { BreadcrumbItem } from "@/lib/breadcrumbs";

describe("safeJsonLd", () => {
  it("neutralizes </script> breakout attempts (stored XSS guard)", () => {
    const payload = { name: `</script><script>alert(1)</script>`, reviewBody: "ok" };
    const out = safeJsonLd(payload);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("\\u003C/script\\u003E");
  });

  it("escapes HTML comment and CDATA openers", () => {
    const out = safeJsonLd({ a: "<!-- --> & <![CDATA[" });
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("&");
    expect(out).not.toContain("<![CDATA[");
  });

  it("round-trips to the identical value via JSON.parse", () => {
    const value = {
      title: `Recenzja </script> "specjalna" & <b>ważna</b>`,
      score: 8.5,
      nested: { tags: ["a&b", "<c>"] },
    };
    expect(JSON.parse(safeJsonLd(value))).toEqual(value);
  });
});

const ORIGIN = "https://nes.example";

describe("organizationJsonLd", () => {
  it("builds a NewsMediaOrganization with sameAs and logo", () => {
    const org = organizationJsonLd({
      origin: ORIGIN,
      lang: "pl",
      sameAs: ["https://x.com/nes", ""],
      logoUrl: `${ORIGIN}/logo.png`,
    });
    expect(org["@type"]).toBe("NewsMediaOrganization");
    expect(org["@id"]).toBe(`${ORIGIN}/#organization`);
    expect(org.sameAs).toEqual(["https://x.com/nes"]);
    expect(org.logo).toEqual({ "@type": "ImageObject", url: `${ORIGIN}/logo.png` });
  });
  it("omits empty sameAs/logo", () => {
    const org = organizationJsonLd({ origin: ORIGIN, lang: "en" });
    expect(org.sameAs).toBeUndefined();
    expect(org.logo).toBeUndefined();
  });
});

describe("webSiteJsonLd", () => {
  it("wires the SearchAction to the localized search route", () => {
    const pl = webSiteJsonLd(ORIGIN, "pl") as {
      potentialAction: { target: { urlTemplate: string } };
    };
    const en = webSiteJsonLd(ORIGIN, "en") as {
      potentialAction: { target: { urlTemplate: string } };
    };
    expect(pl.potentialAction.target.urlTemplate).toBe(`${ORIGIN}/search?q={search_term_string}`);
    expect(en.potentialAction.target.urlTemplate).toBe(
      `${ORIGIN}/en/search?q={search_term_string}`,
    );
  });
});

describe("breadcrumbListJsonLd", () => {
  const items: BreadcrumbItem[] = [{ label: "Blog", href: "/blog" }, { label: "Tytuł wpisu" }];
  it("prepends Home, localizes hrefs and drops the item on the last crumb", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "en") as {
      itemListElement: Array<{ position: number; name: string; item?: string }>;
    };
    expect(ld.itemListElement).toHaveLength(3);
    expect(ld.itemListElement[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: `${ORIGIN}/en`,
    });
    expect(ld.itemListElement[1]?.item).toBe(`${ORIGIN}/en/blog`);
    expect(ld.itemListElement[2]?.item).toBeUndefined();
  });
  it("uses bare paths for the default language", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "pl") as {
      itemListElement: Array<{ name: string; item?: string }>;
    };
    expect(ld.itemListElement[0]?.name).toBe("Start");
    expect(ld.itemListElement[1]?.item).toBe(`${ORIGIN}/blog`);
  });
});

// ---------------------------------------------------------------------------
// ETAP 4: gałęzie generatorów, których dotąd nie wołał żaden test.
// Uzupełnienia, nie duplikaty - qaJsonld.test.ts pokrywa sesję Q&A z wieloma
// pytaniami i filtrowanie pytań bez odpowiedzi, eventsJsonld.test.ts tryby
// uczestnictwa i miejsca, quizLanding.test.ts landing platformy. Tutaj są
// wyłącznie wejścia NIEPEŁNE i ramiona, które tamte pliki mijają.
// ---------------------------------------------------------------------------

describe("siteNavigationJsonLd", () => {
  // Cały builder (jsonld.ts:96-116) był martwy pomiarowo, mimo że emituje go
  // head() strony głównej (routes/index.tsx:350).
  const nav: SiteNavigationItem[] = [
    { name: "Analizy", href: "/analizy" },
    { name: "Regulamin", href: "/regulamin" },
    { name: "X", href: "https://x.com/nes" },
  ];

  // Typ (nie interfejs): asercja z Record<string, unknown> jest legalna tylko
  // dla aliasu typu obiektowego - interfejs nie dostaje niejawnej sygnatury
  // indeksowej, więc `as` na nim nie przechodzi bez `as unknown`.
  type NavGraph = {
    "@type": string;
    "@id": string;
    name: string;
    inLanguage: string;
    itemListElement: Array<{ "@type": string; position: number; name: string; url: string }>;
  };

  it("buduje ItemList SiteNavigationElement z pozycjami numerowanymi od 1", () => {
    const ld = siteNavigationJsonLd(ORIGIN, nav, "pl") as NavGraph;
    expect(ld["@type"]).toBe("ItemList");
    expect(ld["@id"]).toBe(`${ORIGIN}/#footer-navigation`);
    expect(ld.inLanguage).toBe("pl");
    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(ld.itemListElement[0]).toEqual({
      "@type": "SiteNavigationElement",
      position: 1,
      name: "Analizy",
      url: `${ORIGIN}/analizy`,
    });
  });

  it.each([
    { lang: "pl" as const, expected: "Nawigacja stopki" },
    { lang: "en" as const, expected: "Footer navigation" },
  ])("nazwa listy jest w języku renderu ($lang)", ({ lang, expected }) => {
    expect((siteNavigationJsonLd(ORIGIN, nav, lang) as NavGraph).name).toBe(expected);
  });

  it.each([
    { name: "ścieżka z ukośnikiem dostaje origin", href: "/analizy", url: `${ORIGIN}/analizy` },
    {
      name: "ścieżka BEZ ukośnika dostaje origin i ukośnik",
      href: "regulamin",
      url: `${ORIGIN}/regulamin`,
    },
    { name: "https:// zostaje bez zmian", href: "https://x.com/nes", url: "https://x.com/nes" },
    {
      name: "http:// (link legacy) też jest uznane za absolutne",
      href: "http://legacy.example/a",
      url: "http://legacy.example/a",
    },
    {
      // FAKT PRZYPIĘTY: test to `href.startsWith("http")`, nie rozbiór schematu,
      // więc slug zaczynający się od "http" wyszedłby jako adres RELATYWNY -
      // nieważny w JSON-LD. Dziś nieszkodliwe: wszystkie hrefy w FOOTER_LINKS
      // zaczynają się od "/" (lib/seo/footerNavigation.ts), ale gałąź jest tu
      // opisana, żeby przyszły slug typu "httpster" nie przeszedł niezauważony.
      name: "slug zaczynający się od 'http' jest brany za adres absolutny",
      href: "httpster",
      url: "httpster",
    },
  ])("url pozycji - $name", ({ href, url }) => {
    const ld = siteNavigationJsonLd(ORIGIN, [{ name: "n", href }], "pl") as NavGraph;
    expect(ld.itemListElement[0]?.url).toBe(url);
  });

  it("pusta nawigacja daje pustą listę, nie null ani undefined", () => {
    const ld = siteNavigationJsonLd(ORIGIN, [], "en") as NavGraph;
    expect(ld.itemListElement).toEqual([]);
  });

  it("render EN dostaje nazwy EN, ale adresy PL (stan faktyczny)", () => {
    // Ten builder - w odróżnieniu od breadcrumbListJsonLd w tym samym pliku -
    // NIE przepuszcza hrefów przez localizedPath().
    const ld = siteNavigationJsonLd(
      ORIGIN,
      [{ name: "Analyses", href: "/analizy" }],
      "en",
    ) as NavGraph;
    expect(ld.inLanguage).toBe("en");
    expect(ld.itemListElement[0]?.url).toBe(`${ORIGIN}/analizy`);
  });

  it.fails(
    "DEFEKT: nawigacja stopki w JSON-LD renderu EN wskazuje adresy PL, choć deklaruje inLanguage=en",
    () => {
      // KONSEKWENCJA: na /en strona główna emituje graf nawigacji z inLanguage
      // "en" i nazwami EN, ale adresami renderu PL. Crawler czytający ten graf
      // dostaje z angielskiej strony komplet linków do polskich wersji - to
      // sprzeczny sygnał wobec hreflangów i breadcrumbów TEJ SAMEJ strony
      // (breadcrumbListJsonLd lokalizuje ścieżki, jsonld.ts:164), a angielskie
      // podstrony nie dostają z nawigacji żadnego sygnału.
      const ld = siteNavigationJsonLd(
        ORIGIN,
        [{ name: "Analyses", href: "/analizy" }],
        "en",
      ) as NavGraph;
      expect(ld.itemListElement[0]?.url).toBe(`${ORIGIN}/en/analizy`);
    },
  );
});

describe("organizationJsonLd - contactPoint", () => {
  const noChannel: Array<{ label: string; contactPoint?: ContactPointInput | null }> = [
    { label: "brak pola", contactPoint: undefined },
    { label: "null", contactPoint: null },
    { label: "obiekt bez e-maila i telefonu", contactPoint: { contactType: "editorial" } },
    { label: "puste łańcuchy", contactPoint: { email: "", telephone: "" } },
    { label: "null w obu kanałach", contactPoint: { email: null, telephone: null } },
  ];

  it.each(noChannel)(
    "pomija contactPoint, gdy nie ma kanału kontaktu: $label",
    ({ contactPoint }) => {
      const org = organizationJsonLd({ origin: ORIGIN, lang: "pl", contactPoint });
      expect("contactPoint" in org).toBe(false);
    },
  );

  it("sam e-mail: domyślny contactType i żadnych pustych kluczy", () => {
    const org = organizationJsonLd({
      origin: ORIGIN,
      lang: "pl",
      contactPoint: { email: "redakcja@nes.example" },
    });
    expect(org.contactPoint).toEqual([
      { "@type": "ContactPoint", contactType: "customer support", email: "redakcja@nes.example" },
    ]);
  });

  it("sam telefon: bez klucza email", () => {
    const org = organizationJsonLd({
      origin: ORIGIN,
      lang: "en",
      contactPoint: { telephone: "+48 22 000 00 00" },
    });
    expect(org.contactPoint).toEqual([
      { "@type": "ContactPoint", contactType: "customer support", telephone: "+48 22 000 00 00" },
    ]);
  });

  it("pełny kanał: własny typ, obszar obsługi i lista języków", () => {
    const org = organizationJsonLd({
      origin: ORIGIN,
      lang: "pl",
      contactPoint: {
        email: "redakcja@nes.example",
        telephone: "+48 22 000 00 00",
        contactType: "editorial",
        areaServed: "EU",
        availableLanguage: ["pl", "en"],
      },
    });
    expect(org.contactPoint).toEqual([
      {
        "@type": "ContactPoint",
        contactType: "editorial",
        email: "redakcja@nes.example",
        telephone: "+48 22 000 00 00",
        areaServed: "EU",
        availableLanguage: ["pl", "en"],
      },
    ]);
  });

  it("pusta lista języków nie tworzy klucza availableLanguage", () => {
    const org = organizationJsonLd({
      origin: ORIGIN,
      lang: "pl",
      contactPoint: { email: "a@nes.example", availableLanguage: [] },
    });
    const cp = (org.contactPoint as Array<Record<string, unknown>>)[0];
    expect(cp).not.toHaveProperty("availableLanguage");
    expect(cp).not.toHaveProperty("areaServed");
  });
});

describe("qaPageJsonLd - sesja z JEDNYM pytaniem i pola opcjonalne", () => {
  const question: QaJsonLdQuestion = {
    id: "q1",
    body: "  Czy Europa ma plan na 2027?  ",
    answer: "  Ma, ale nieskonsolidowany.  ",
  };

  const build = (
    q: QaJsonLdQuestion,
    extra: { datePublished?: string; dateModified?: string } = {},
  ) =>
    qaPageJsonLd({
      origin: ORIGIN,
      lang: "pl",
      path: "/qa/sesja",
      name: "Sesja",
      questions: [q],
      ...extra,
    });

  it("jedno odpowiedziane pytanie: mainEntity BEZ hasPart, daty sesji na wierzchu", () => {
    const ld = build(question, {
      datePublished: "2026-01-01T00:00:00Z",
      dateModified: "2026-02-03T10:15:00Z",
    });
    expect(ld?.datePublished).toBe("2026-01-01T00:00:00Z");
    expect(ld?.dateModified).toBe("2026-02-03T10:15:00Z");
    // Jedno pytanie = brak reszty listy: klucz hasPart nie może się pojawić
    // pusty, bo pusta tablica w rich results to błąd walidacji.
    expect(ld && "hasPart" in ld).toBe(false);
    const main = ld?.mainEntity as Record<string, unknown>;
    expect(main.name).toBe("Czy Europa ma plan na 2027?");
    expect(main.text).toBe("Czy Europa ma plan na 2027?");
    expect(main.acceptedAnswer).toEqual({ "@type": "Answer", text: "Ma, ale nieskonsolidowany." });
    expect(main).not.toHaveProperty("dateCreated");
    expect(main).not.toHaveProperty("author");
  });

  it("sesja bez dat nie emituje datePublished/dateModified", () => {
    const ld = build(question);
    expect(ld && "datePublished" in ld).toBe(false);
    expect(ld && "dateModified" in ld).toBe(false);
    expect(ld && "description" in ld).toBe(false);
  });

  it.each([
    { label: "brak pola", upvotes: undefined, expected: undefined },
    { label: "null z bazy", upvotes: null, expected: undefined },
    // Zero głosów to PRAWIDŁOWA liczba - test `typeof === "number"` (a nie
    // truthiness) jest tu świadomy i musi taki zostać.
    { label: "zero głosów", upvotes: 0, expected: 0 },
  ])("upvoteCount - $label", ({ upvotes, expected }) => {
    const main = build({ ...question, upvotes })?.mainEntity as Record<string, unknown>;
    expect(main.upvoteCount).toBe(expected);
  });

  it.each([
    { label: "same spacje w autorze", authorName: "   " },
    { label: "null w autorze", authorName: null },
  ])("anonimowe pytanie nie dostaje węzła Person: $label", ({ authorName }) => {
    const main = build({ ...question, authorName })?.mainEntity as Record<string, unknown>;
    expect(main).not.toHaveProperty("author");
  });
});

describe("qaCollectionJsonLd - opis i pusta lista sesji", () => {
  const build = (
    description?: string | null,
    sessions: Array<{ slug: string; title: string }> = [],
  ) =>
    qaCollectionJsonLd({
      origin: ORIGIN,
      lang: "pl",
      path: "/qa",
      name: "Q&A",
      description,
      sessions,
    });

  it("opis kolekcji jest przycinany", () => {
    expect(build("  Sesje pytań i odpowiedzi  ").description).toBe("Sesje pytań i odpowiedzi");
  });

  it.each([
    { label: "brak pola", description: undefined },
    { label: "null", description: null },
    { label: "same spacje", description: "   " },
  ])("bez opisu nie ma klucza description: $label", ({ description }) => {
    expect("description" in build(description)).toBe(false);
  });

  it("zero sesji daje pustą ItemList, a strona kolekcji nadal istnieje", () => {
    const ld = build(null, []);
    expect(ld["@type"]).toBe("CollectionPage");
    expect((ld.mainEntity as { itemListElement: unknown[] }).itemListElement).toEqual([]);
  });
});

describe("eventsCollectionJsonLd - degradacja listy wydarzeń", () => {
  it.each([
    { label: "brak pola", description: undefined },
    { label: "null", description: null },
    { label: "same spacje", description: "  " },
  ])("bez opisu nie ma klucza description: $label", ({ description }) => {
    const ld = eventsCollectionJsonLd({
      origin: ORIGIN,
      lang: "en",
      path: "/events",
      name: "Events",
      description,
      events: [],
    });
    expect("description" in ld).toBe(false);
  });

  it("brak nadchodzących wydarzeń daje pustą listę pod adresem wariantu językowego", () => {
    const ld = eventsCollectionJsonLd({
      origin: ORIGIN,
      lang: "en",
      path: "/events",
      name: "Events",
      events: [],
    });
    expect(ld["@id"]).toBe(`${ORIGIN}/en/events#collection`);
    expect((ld.mainEntity as { itemListElement: unknown[] }).itemListElement).toEqual([]);
  });
});
