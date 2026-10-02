// Taksonomia kategorii Apple Podcasts - zamknięta lista, z której `podcastRss`
// buduje `<itunes:category>`. Apple przyjmuje WYŁĄCZNIE nazwy z tej listy, więc
// modul obiecuje degradację nieznanej wartości do pary domyślnej. Ten plik
// trzyma tę obietnicę na wejściach NIEPEŁNYCH: undefined, null, "", same białe
// znaki, zła wielkość liter i nazwa spoza taksonomii.
//
// Dokument wyjściowy (`<itunes:category>` w gotowym XML-u) sprawdza
// `podcastRss.test.ts`; tutaj testujemy wyłącznie czystą normalizację.
import { describe, expect, it } from "vitest";
import {
  APPLE_CATEGORY_NAMES,
  DEFAULT_APPLE_CATEGORY,
  DEFAULT_APPLE_SUBCATEGORY,
  appleSubcategories,
  isAppleCategory,
  normalizeAppleCategory,
} from "@/lib/seo/applePodcastCategories";
import { buildPodcastRssXml } from "@/lib/seo/podcastRss";

describe("appleSubcategories", () => {
  it("zwraca podkategorie zadeklarowane przez Apple dla znanej kategorii", () => {
    expect(appleSubcategories("News")).toContain("Politics");
    expect(appleSubcategories("Science")).toContain("Social Sciences");
    expect(appleSubcategories("Health & Fitness")).toContain("Mental Health");
  });

  // Kategoria ISTNIEJĄCA, ale bez podkategorii w taksonomii Apple - lewa strona
  // `?? []` z pustą tablicą po prawej stronie mapy.
  it.each([["Government"], ["History"], ["Technology"], ["True Crime"]])(
    "zwraca pustą listę dla kategorii %s, dla której Apple nie definiuje podkategorii",
    (kategoria) => {
      expect(appleSubcategories(kategoria)).toEqual([]);
    },
  );

  // Gałąź „klucz poza taksonomią" w `appleSubcategories`.
  // Select w /admin/podcasts czyta tę funkcję, więc dla śmieciowej wartości
  // zapisanej w bazie musi pokazać pustą listę, a nie wywrócić panelu.
  it.each([["Geopolityka"], [""], ["   "], ["news"], ["NEWS"]])(
    "zwraca pustą listę dla wartości %j spoza taksonomii",
    (kategoria) => {
      expect(appleSubcategories(kategoria)).toEqual([]);
    },
  );
});

describe("normalizeAppleCategory - poprawne pary", () => {
  it("przepuszcza znaną kategorię wraz z jej podkategorią", () => {
    expect(normalizeAppleCategory("Health & Fitness", "Nutrition")).toEqual({
      category: "Health & Fitness",
      subcategory: "Nutrition",
    });
  });

  it("obcina białe znaki wokół obu wartości", () => {
    expect(normalizeAppleCategory("  Music  ", "  Music History  ")).toEqual({
      category: "Music",
      subcategory: "Music History",
    });
  });

  // Każda nazwa z listy publikowanej do selecta musi przejść normalizację bez
  // degradacji - inaczej panel oferowałby opcję, którą builder i tak podmieni.
  it("nie degraduje żadnej nazwy wystawionej w APPLE_CATEGORY_NAMES", () => {
    for (const nazwa of APPLE_CATEGORY_NAMES) {
      expect(normalizeAppleCategory(nazwa, null).category).toBe(nazwa);
    }
  });
});

describe("normalizeAppleCategory - podkategoria niepełna lub obca", () => {
  // Gałąź `subcategory ?? ""` w `normalizeAppleCategory`. Kanał z samą
  // kategorią jest dla Apple poprawny, z obcą podkategorią - nie.
  it.each<[string, string | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["pusty string", ""],
    ["same białe znaki", "   "],
  ])("znana kategoria bez podkategorii (%s) daje subcategory null", (_opis, sub) => {
    expect(normalizeAppleCategory("Technology", sub)).toEqual({
      category: "Technology",
      subcategory: null,
    });
  });

  it.each([
    ["Sports", "Politics"],
    ["Government", "Politics"],
    ["News", "Nutrition"],
    ["News", "politics"],
  ])("kategoria %s odrzuca obcą podkategorię %s, ale zostaje sama", (kategoria, sub) => {
    expect(normalizeAppleCategory(kategoria, sub)).toEqual({
      category: kategoria,
      subcategory: null,
    });
  });
});

describe("normalizeAppleCategory - kategoria nieznana degraduje do domyślnej", () => {
  it.each<[string, string | null | undefined]>([
    ["undefined", undefined],
    ["null", null],
    ["pusty string", ""],
    ["same białe znaki", "  "],
    ["nazwa spoza taksonomii", "Geopolityka"],
    ["zła wielkość liter", "news"],
    ["nazwa z ogonkiem", "Wiadomości"],
  ])("kategoria %s -> para domyślna News/Politics", (_opis, kategoria) => {
    expect(normalizeAppleCategory(kategoria, "Politics")).toEqual({
      category: DEFAULT_APPLE_CATEGORY,
      subcategory: DEFAULT_APPLE_SUBCATEGORY,
    });
  });

  it("para domyślna jest sama w sobie poprawna w taksonomii", () => {
    expect(APPLE_CATEGORY_NAMES).toContain(DEFAULT_APPLE_CATEGORY);
    expect(appleSubcategories(DEFAULT_APPLE_CATEGORY)).toContain(DEFAULT_APPLE_SUBCATEGORY);
  });
});

// ── STRAŻNIK: nazwy z łańcucha prototypu Object NIE są kategoriami Apple ────
//
// Mapa taksonomii jest zwykłym literałem obiektowym. Dawniej `cat in MAPA` i
// `MAPA[category]` chodziły po ŁAŃCUCHU PROTOTYPU, więc "toString",
// "valueOf", "constructor" i "hasOwnProperty" zdawały test przynależności do
// taksonomii. Wartość kategorii jest w bazie zwykłym tekstem
// (`podcast_settings.itunes_category`), a `resolvePodcastChannelMeta`
// przepuszcza ją do buildera bez sprawdzania listy - więc taka wartość
// (import CSV, ręczna edycja, migracja z WP) dociera tutaj. Teraz każdy odczyt
// idzie przez `isAppleCategory` (`Object.hasOwn`).
const PROTOTYPE_NAMES = [
  "toString",
  "valueOf",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
  "__lookupGetter__",
] as const;

describe("normalizeAppleCategory - nazwy z prototypu Object", () => {
  it("'toString' degraduje do pary domyślnej, a nie przechodzi jako kategoria", () => {
    // KONSEKWENCJA, przed którą ten test chroni: feed wychodził z
    // <itunes:category text="toString"/>, czyli wartością spoza zamkniętej
    // listy Apple. Podcasts Connect odrzucał zgłoszenie kanału, a redakcja
    // widziała w panelu Apple tylko "invalid category" - bez wskazania, że
    // winna jest wartość w ustawieniach.
    expect(normalizeAppleCategory("toString", "")).toEqual({
      category: DEFAULT_APPLE_CATEGORY,
      subcategory: DEFAULT_APPLE_SUBCATEGORY,
    });
  });

  it("'constructor' z podkategorią degraduje do pary domyślnej zamiast rzucać", () => {
    // KONSEKWENCJA, przed którą ten test chroni: `appleSubcategories
    // ("constructor")` zwracało FUNKCJĘ (Object.prototype.constructor), a nie
    // tablicę, więc `.includes(sub)` rzucało TypeError. Trasa /podcast/rss.xml
    // kończyła się błędem 500 - Apple i Spotify dostawały stronę błędu zamiast
    // kanału, a program przy kolejnych odpytaniach wypadał z katalogów wraz z
    // całą historią odcinków.
    expect(() => normalizeAppleCategory("constructor", "Politics")).not.toThrow();
    expect(normalizeAppleCategory("constructor", "Politics")).toEqual({
      category: DEFAULT_APPLE_CATEGORY,
      subcategory: DEFAULT_APPLE_SUBCATEGORY,
    });
  });

  it.each(PROTOTYPE_NAMES)("'%s' (z podkategorią i bez) degraduje do pary domyślnej", (name) => {
    for (const sub of [null, "", "Politics", "constructor"]) {
      expect(normalizeAppleCategory(name, sub), `${name} / ${String(sub)}`).toEqual({
        category: DEFAULT_APPLE_CATEGORY,
        subcategory: DEFAULT_APPLE_SUBCATEGORY,
      });
    }
  });

  it.each([
    ["spacje wokół", "  constructor  "],
    ["tabulator i nowa linia", "\ttoString\n"],
    ["wielka litera", "Constructor"],
    ["wielkie litery", "HASOWNPROPERTY"],
    ["__proto__ ze spacją", " __proto__ "],
  ])("wariant %s (%j) też degraduje do pary domyślnej", (_opis, name) => {
    expect(normalizeAppleCategory(name, "Politics")).toEqual({
      category: DEFAULT_APPLE_CATEGORY,
      subcategory: DEFAULT_APPLE_SUBCATEGORY,
    });
  });

  it.each(PROTOTYPE_NAMES)(
    "appleSubcategories('%s') to pusta TABLICA, nie funkcja/obiekt",
    (name) => {
      const subs = appleSubcategories(name);
      expect(Array.isArray(subs)).toBe(true);
      expect(subs).toEqual([]);
    },
  );

  it.each(PROTOTYPE_NAMES)("isAppleCategory('%s') = false", (name) => {
    expect(isAppleCategory(name)).toBe(false);
  });

  it("nazwa z prototypu jako PODKATEGORIA znanej kategorii jest pomijana, kategoria zostaje", () => {
    // Negatyw: naprawa nie może zdegradować poprawnej kategorii tylko dlatego,
    // że podkategoria jest śmieciem z prototypu.
    for (const sub of PROTOTYPE_NAMES) {
      expect(normalizeAppleCategory("News", sub)).toEqual({ category: "News", subcategory: null });
    }
  });
});

describe("isAppleCategory", () => {
  it("przyjmuje KAŻDĄ nazwę z APPLE_CATEGORY_NAMES (brak nadkorekty)", () => {
    for (const nazwa of APPLE_CATEGORY_NAMES) expect(isAppleCategory(nazwa)).toBe(true);
  });

  it.each<[string, unknown]>([
    ["zła wielkość liter", "news"],
    ["spacje wokół (porównanie dokładne - przycina wywołujący)", " News "],
    ["pusty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["liczba", 1],
    ["obiekt", {}],
  ])("odrzuca: %s", (_opis, value) => {
    expect(isAppleCategory(value)).toBe(false);
  });
});

describe("buildPodcastRssXml - kategoria z prototypu nie wywraca kanału", () => {
  // Jedyny test końca łańcucha w tym pliku: dowodzi, że builder RSS (jedyny
  // konsument `normalizeAppleCategory` na trasie /podcast/rss.xml) dostaje
  // poprawną parę, a nie TypeError. Pełny kształt XML pilnuje
  // `podcastRss.test.ts`.
  it.each([["constructor"], ["__proto__"], ["toString"]])(
    'kategoria %s -> feed z <itunes:category text="News"> i Politics',
    (name) => {
      const xml = buildPodcastRssXml({
        title: "Feed",
        description: "Desc",
        siteUrl: "https://example.org/podcasts",
        feedUrl: "https://example.org/podcast/rss.xml",
        language: "pl",
        category: name,
        subcategory: "Politics",
        items: [],
      });
      expect(xml).toContain('<itunes:category text="News">');
      expect(xml).toContain('<itunes:category text="Politics"/>');
      expect(xml).not.toContain(`text="${name}"`);
    },
  );
});
