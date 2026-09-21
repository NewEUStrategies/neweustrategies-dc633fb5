// Model podpowiedzi z `facetModel.ts`: kolejność kubełków, przypisanie rodzaju
// do kubełka i statyczne cele nawigacji.
//
// TEN PLIK NAZYWAŁ SIĘ `components/search/__tests__/SearchAutosuggest.test.tsx`
// i nie importował komponentu ANI RAZU - wszystkie jego asercje zasilały
// `lib/search/facetModel.ts` (93,7% pokrycia z własnego testu), podczas gdy
// `SearchAutosuggest.tsx` stał na 0,0% linii i 0 z 19 funkcji. Nazwa pliku była
// jedynym powodem, dla którego moduł wyglądał na przetestowany: w przeglądzie
// widać „jest test autosuggesta", w pomiarze - zero. Plik leży teraz przy
// przedmiocie, który faktycznie mierzy; test komponentu powstał osobno.
import { describe, it, expect } from "vitest";
import type { AutosuggestItem } from "@/lib/queries/archives";
import { parseSearchParams } from "@/lib/search/searchParams";
import {
  orderSuggestions,
  searchHref,
  suggestBucketOf,
  suggestionHref,
  SUGGEST_BUCKET_LABELS,
} from "@/lib/search/facetModel";

const it0 = (p: Partial<AutosuggestItem>): AutosuggestItem => ({
  kind: "post",
  id: "1",
  slug: "s",
  label_pl: "L",
  label_en: "L",
  parentPageId: null,
  score: 0,
  ...p,
});

describe("orderSuggestions", () => {
  it("porządkuje kubełki: tytuły → rodzaje treści → tematyka → osoby i organizacje", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "author", id: "a", score: 0.9 }),
      it0({ kind: "region", id: "r", score: 0.9 }),
      it0({ kind: "pub_type", id: "t", score: 0.5 }),
      it0({ kind: "post", id: "p", score: 0.1 }),
    ];
    expect(orderSuggestions(items).map((i) => i.kind)).toEqual([
      "post",
      "pub_type",
      "region",
      "author",
    ]);
  });

  it("organizacja ląduje w kubełku osób i organizacji", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "organization", id: "o", score: 0.9 }),
      it0({ kind: "topic", id: "t", score: 0.1 }),
    ];
    expect(orderSuggestions(items).map((i) => i.kind)).toEqual(["topic", "organization"]);
  });

  it("w obrębie kubełka sortuje malejąco po score", () => {
    const items: AutosuggestItem[] = [
      it0({ kind: "post", id: "p1", score: 0.2 }),
      it0({ kind: "post", id: "p2", score: 0.8 }),
    ];
    expect(orderSuggestions(items).map((i) => i.id)).toEqual(["p2", "p1"]);
  });

  it("nie mutuje wejścia", () => {
    const items: AutosuggestItem[] = [it0({ kind: "author" }), it0({ kind: "post" })];
    const copy = [...items];
    orderSuggestions(items);
    expect(items).toEqual(copy);
  });
});

describe("suggestBucketOf", () => {
  it("mapuje rodzaje podpowiedzi na cztery premium kubełki", () => {
    expect(suggestBucketOf("post")).toBe("titles");
    expect(suggestBucketOf("pub_type")).toBe("contentTypes");
    expect(suggestBucketOf("format")).toBe("contentTypes");
    expect(suggestBucketOf("access")).toBe("contentTypes");
    expect(suggestBucketOf("lang")).toBe("contentTypes");
    expect(suggestBucketOf("topic")).toBe("topics");
    expect(suggestBucketOf("region")).toBe("topics");
    expect(suggestBucketOf("author")).toBe("peopleOrg");
    expect(suggestBucketOf("organization")).toBe("peopleOrg");
  });

  it("ma etykiety PL i EN dla każdego kubełka", () => {
    for (const lang of ["pl", "en"] as const) {
      for (const bucket of ["titles", "contentTypes", "topics", "peopleOrg"] as const) {
        expect(SUGGEST_BUCKET_LABELS[lang][bucket]).toBeTruthy();
      }
    }
  });
});

describe("suggestionHref", () => {
  it("publikacja Z RODZICEM prowadzi do permalinka /post/<slug>", () => {
    expect(suggestionHref(it0({ kind: "post", slug: "moj-wpis", parentPageId: "pg-1" }))).toBe(
      "/post/moj-wpis",
    );
  });

  it("publikacja BEZ RODZICA szuka po tytule - /post/<slug> odesłałby na /blog", () => {
    // `resolveLegacyPostPath` (trasa /post/$slug) zwraca null bez parent_page_id
    // i trasa robi 302 na /blog. Adres kanoniczny takiego wpisu nie istnieje.
    expect(suggestionHref(it0({ kind: "post", slug: "moj-wpis", label_pl: "Mój wpis" }))).toBe(
      "/search?q=M%C3%B3j+wpis",
    );
  });

  it("autor prowadzi bezpośrednio do profilu /author/<slug>", () => {
    expect(suggestionHref(it0({ kind: "author", id: "a-1", slug: "jan" }))).toBe("/author/jan");
  });

  it("autor bez sluga wraca do /search po id", () => {
    // it0 domyslnie nadaje slug "s"; tu testujemy fallback dla autora BEZ sluga,
    // wiec jawnie go zerujemy - inaczej autor ze slugiem trafia do /author/<slug>.
    expect(suggestionHref(it0({ kind: "author", id: "a-1", slug: "" }))).toBe("/search?author=a-1");
  });

  it("term taksonomii bez publicznej strony filtruje /search po ID", () => {
    expect(suggestionHref(it0({ kind: "organization", id: "o-1", slug: "nato" }))).toBe(
      "/search?org=o-1",
    );
  });

  it("kategoria/tag/seria/program prowadzą do publicznego archiwum po slug", () => {
    expect(suggestionHref(it0({ kind: "category", id: "c-1", slug: "geo" }))).toBe("/category/geo");
    expect(suggestionHref(it0({ kind: "topic", id: "t-1", slug: "energia" }))).toBe("/tag/energia");
    expect(suggestionHref(it0({ kind: "series", id: "s-1", slug: "raporty" }))).toBe(
      "/series/raporty",
    );
    expect(suggestionHref(it0({ kind: "project", id: "p-1", slug: "eu-green" }))).toBe(
      "/programs/eu-green",
    );
  });

  it("wymiary wyliczane (format/rok) filtrują po slugu", () => {
    expect(suggestionHref(it0({ kind: "format", slug: "video" }))).toBe("/search?format=video");
    expect(suggestionHref(it0({ kind: "year", slug: "2026" }))).toBe("/search?year=2026");
  });

  it("term taksonomii BEZ id szuka po nazwie, zamiast budować zepsuty filtr", () => {
    // Parametry spec/type/org… lecą do RPC jako uuid[] - slug w URL wywracał
    // zapytanie, więc adres z samym slugiem był gorszy niż brak filtra.
    expect(
      suggestionHref(it0({ kind: "organization", id: null, slug: "nato", label_pl: "NATO" })),
    ).toBe("/search?q=NATO");
  });

  it("opcja `base` SCALA adres z bieżącym stanem /search zamiast go kasować", () => {
    expect(
      suggestionHref(it0({ kind: "organization", id: "o-1" }), {
        base: { q: "stare", tab: "titles", sort: "newest" },
      }),
    ).toBe("/search?q=stare&org=o-1&sort=newest&tab=titles");
  });

  it("opcja `phrase` wstawia etykietę termu w q - pole frazy ma zgadzać się z filtrem", () => {
    expect(
      suggestionHref(
        it0({ kind: "organization", id: "o-1", label_pl: "NATO", label_en: "NATO EN" }),
        {
          phrase: true,
          lang: "pl",
        },
      ),
    ).toBe("/search?q=NATO&org=o-1");
    expect(
      suggestionHref(it0({ kind: "author", id: "a-1", slug: "", label_pl: "Jan Kowalski" }), {
        phrase: true,
        lang: "pl",
      }),
    ).toBe("/search?q=Jan+Kowalski&author=a-1");
  });

  it("`phrase` NIE dotyczy wymiarów wyliczanych - „Wideo” jako fraza zawęziłoby wyniki", () => {
    expect(
      suggestionHref(it0({ kind: "format", id: null, slug: "video", label_pl: "Wideo" }), {
        phrase: true,
        lang: "pl",
      }),
    ).toBe("/search?format=video");
  });
});

describe("searchHref", () => {
  it("porządkuje parametry według schematu adresu i pomija puste", () => {
    expect(searchHref({ sort: "newest", q: "", org: "o-1", tab: undefined })).toBe(
      "/search?org=o-1&sort=newest",
    );
  });

  it("pomija pola spoza schematu - adres zostaje odczytywalny przez validateSearch", () => {
    expect(searchHref({ q: "raport", nieistnieje: "x" })).toBe("/search?q=raport");
  });

  it("pusty stan daje gołe /search, nie /search?", () => {
    expect(searchHref({})).toBe("/search");
  });
});

describe("suggestionHref - kontrakt z validateSearch trasy", () => {
  // Adres podpowiedzi jest JEDYNĄ ścieżką nawigacji (mysz i Enter), więc każdy,
  // który wytworzy, musi dać się odczytać z powrotem. Adres odrzucony przez
  // `validateSearch` nie daje pustych wyników - wywraca CAŁĄ trasę.
  const KINDS: AutosuggestItem["kind"][] = [
    "author",
    "post",
    "page",
    "company",
    "category",
    "pub_type",
    "region",
    "topic",
    "project",
    "series",
    "organization",
    "format",
    "lang",
    "access",
    "year",
  ];

  it("ŻADEN wygenerowany adres /search nie wywraca walidatora adresu", () => {
    const odrzucone: string[] = [];
    for (const kind of KINDS) {
      for (const slug of ["cos", "", "pl", "de", "2026"]) {
        for (const id of ["id-1", null]) {
          for (const phrase of [true, false]) {
            const href = suggestionHref(it0({ kind, slug, id, label_pl: "Etykieta" }), {
              phrase,
              lang: "pl",
            });
            if (!href.startsWith("/search")) continue;
            const params = Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));
            try {
              parseSearchParams(params);
            } catch {
              odrzucone.push(`${kind} slug=${JSON.stringify(slug)} id=${id} -> ${href}`);
            }
          }
        }
      }
    }
    expect(odrzucone).toEqual([]);
  });

  it("język spoza {pl,en} szuka po nazwie - kod w adresie wywracał walidator", () => {
    expect(suggestionHref(it0({ kind: "lang", id: null, slug: "de", label_pl: "Niemiecki" }))).toBe(
      "/search?q=Niemiecki",
    );
    expect(suggestionHref(it0({ kind: "lang", id: null, slug: "en" }))).toBe("/search?lang=en");
  });
});
