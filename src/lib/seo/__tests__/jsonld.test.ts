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
import { FOOTER_LINKS, labelFor } from "@/lib/seo/footerNavigation";

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
  it("prepends Home and localizes hrefs", () => {
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
  });
  it("uses bare paths for the default language", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "pl") as {
      itemListElement: Array<{ name: string; item?: string }>;
    };
    expect(ld.itemListElement[0]?.name).toBe("Start");
    expect(ld.itemListElement[1]?.item).toBe(`${ORIGIN}/blog`);
  });
  // Search Console zgłaszał „Brakujące pole item (w itemListElement)" na
  // archiwach: ostatni ListItem nie nosił adresu. `selfPath` domyka kontrakt.
  it("gives the last crumb an item from selfPath", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "pl", "/analizy/atom") as {
      itemListElement: Array<{ item?: string }>;
    };
    expect(ld.itemListElement[2]?.item).toBe(`${ORIGIN}/analizy/atom`);
  });
  it("does not double the language prefix when selfPath is already localized", () => {
    const ld = breadcrumbListJsonLd(items, ORIGIN, "en", "/en/analizy/atom") as {
      itemListElement: Array<{ item?: string }>;
    };
    expect(ld.itemListElement[2]?.item).toBe(`${ORIGIN}/en/analizy/atom`);
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
  // Cały builder był martwy pomiarowo, mimo że emituje go head() strony
  // głównej (`src/routes/index.tsx`, karmiony kanonicznymi hrefami
  // `FOOTER_LINKS` BEZ prefiksu języka).
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
      // STRAŻNIK: adres absolutny to WYŁĄCZNIE `http(s)://` (ta sama reguła co
      // w `breadcrumbListJsonLd`), a nie `href.startsWith("http")` - slug
      // zaczynający się od "http" wychodził wcześniej jako adres RELATYWNY,
      // nieważny w JSON-LD.
      name: "slug zaczynający się od 'http' to ścieżka wewnętrzna, nie adres absolutny",
      href: "httpster",
      url: `${ORIGIN}/httpster`,
    },
    {
      name: "HTTPS:// wielkimi literami też jest absolutne",
      href: "HTTPS://X.com/nes",
      url: "HTTPS://X.com/nes",
    },
    { name: "pusty href to strona główna", href: "", url: `${ORIGIN}/` },
    { name: "kotwica bez ścieżki zostaje na stronie głównej", href: "#a", url: `${ORIGIN}/#a` },
  ])("url pozycji - $name", ({ href, url }) => {
    const ld = siteNavigationJsonLd(ORIGIN, [{ name: "n", href }], "pl") as NavGraph;
    expect(ld.itemListElement[0]?.url).toBe(url);
  });

  it("pusta nawigacja daje pustą listę, nie null ani undefined", () => {
    const ld = siteNavigationJsonLd(ORIGIN, [], "en") as NavGraph;
    expect(ld.itemListElement).toEqual([]);
  });

  it("render EN lokalizuje adresy: inLanguage=en wskazuje wersje /en/...", () => {
    // KONSEKWENCJA, przed którą ten test chroni: na /en strona główna
    // emitowała graf nawigacji z inLanguage "en" i nazwami EN, ale adresami
    // renderu PL. Crawler czytający ten graf dostawał z angielskiej strony
    // komplet linków do polskich wersji - sprzeczny sygnał wobec hreflangów i
    // breadcrumbów TEJ SAMEJ strony (breadcrumbListJsonLd lokalizuje ścieżki),
    // a angielskie podstrony nie dostawały z nawigacji żadnego sygnału.
    const ld = siteNavigationJsonLd(
      ORIGIN,
      [
        { name: "Analyses", href: "/analizy" },
        { name: "Interviews", href: "/category/wywiady" },
        { name: "X", href: "https://x.com/nes" },
      ],
      "en",
    ) as NavGraph;
    expect(ld.inLanguage).toBe("en");
    expect(ld.itemListElement.map((i) => i.url)).toEqual([
      `${ORIGIN}/en/analizy`,
      `${ORIGIN}/en/category/wywiady`,
      "https://x.com/nes",
    ]);
  });

  it("render PL zostawia ścieżki bez prefiksu (negatyw - brak nadkorekty)", () => {
    const ld = siteNavigationJsonLd(ORIGIN, nav, "pl") as NavGraph;
    expect(ld.itemListElement.map((i) => i.url)).toEqual([
      `${ORIGIN}/analizy`,
      `${ORIGIN}/regulamin`,
      "https://x.com/nes",
    ]);
  });

  it.each([
    {
      name: "href już prefiksowany /en NIE dostaje drugiego prefiksu",
      href: "/en/analizy",
      lang: "en" as const,
      url: `${ORIGIN}/en/analizy`,
    },
    {
      // KONSEKWENCJA, przed którą ten przypadek chroni: graf z inLanguage "pl"
      // wskazywał adres "/en/...", czyli ten sam sprzeczny sygnał językowy co
      // w EN, tylko w odwrotnym kierunku. Lokalizacja jest teraz identyczna
      // jak w `breadcrumbListJsonLd` (obcy prefiks zdejmowany).
      name: "href prefiksowany /en w renderze PL traci obcy prefiks",
      href: "/en/analizy",
      lang: "pl" as const,
      url: `${ORIGIN}/analizy`,
    },
    {
      name: "strona główna EN (/en) w renderze PL to strona główna PL",
      href: "/en",
      lang: "pl" as const,
      url: `${ORIGIN}/`,
    },
    {
      name: "href prefiksowany /en z query w renderze PL zachowuje query",
      href: "/en/search?q=nato",
      lang: "pl" as const,
      url: `${ORIGIN}/search?q=nato`,
    },
    { name: "strona główna EN to /en", href: "/", lang: "en" as const, url: `${ORIGIN}/en` },
    {
      name: "ścieżka bez ukośnika w EN dostaje ukośnik i prefiks",
      href: "regulamin",
      lang: "en" as const,
      url: `${ORIGIN}/en/regulamin`,
    },
    {
      name: "query zostaje za ścieżką, prefiks idzie przed nią",
      href: "/search?q=nato",
      lang: "en" as const,
      url: `${ORIGIN}/en/search?q=nato`,
    },
    {
      name: "fragment zostaje za ścieżką",
      href: "/o-nas#zespol",
      lang: "en" as const,
      url: `${ORIGIN}/en/o-nas#zespol`,
    },
    {
      name: "powierzchnia nielokalizowana (/sitemap.xml) zostaje bez prefiksu",
      href: "/sitemap.xml",
      lang: "en" as const,
      url: `${ORIGIN}/sitemap.xml`,
    },
    {
      name: "powierzchnia nielokalizowana z query (/admin?x=1) zostaje bez prefiksu",
      href: "/admin?x=1",
      lang: "en" as const,
      url: `${ORIGIN}/admin?x=1`,
    },
    {
      name: "adres absolutny w EN zostaje bez zmian",
      href: "https://x.com/nes",
      lang: "en" as const,
      url: "https://x.com/nes",
    },
  ])("lokalizacja - $name", ({ href, lang, url }) => {
    const ld = siteNavigationJsonLd(ORIGIN, [{ name: "n", href }], lang) as NavGraph;
    expect(ld.itemListElement[0]?.url).toBe(url);
  });

  it("FOOTER_LINKS w renderze EN: każdy adres ma DOKŁADNIE jeden prefiks /en", () => {
    // Kontrakt z jedynym wywołaniem produkcyjnym (`src/routes/index.tsx`), które
    // podaje kanoniczne hrefy bez prefiksu - zero "/en/en/" i zero adresów PL.
    const items = FOOTER_LINKS.map((l) => ({ name: labelFor(l, "en"), href: l.href }));
    const ld = siteNavigationJsonLd(ORIGIN, items, "en") as NavGraph;
    expect(ld.itemListElement).toHaveLength(FOOTER_LINKS.length);
    ld.itemListElement.forEach((el, i) => {
      expect(el.url).toBe(`${ORIGIN}/en${FOOTER_LINKS[i]?.href}`);
      expect(el.url).not.toContain("/en/en");
    });
  });

  it("render bez originu daje ścieżki względne z prefiksem języka", () => {
    const ld = siteNavigationJsonLd("", [{ name: "n", href: "/analizy" }], "en") as NavGraph;
    expect(ld.itemListElement[0]?.url).toBe("/en/analizy");
  });
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
