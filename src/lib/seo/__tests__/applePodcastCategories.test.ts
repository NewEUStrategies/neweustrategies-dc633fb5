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
  normalizeAppleCategory,
} from "@/lib/seo/applePodcastCategories";

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

  // Gałąź `?? []` (applePodcastCategories.ts:115) - klucz poza taksonomią.
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
  // Gałąź `subcategory ?? ""` (applePodcastCategories.ts:131). Kanał z samą
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

// ── DEFEKT: nazwy z łańcucha prototypu Object udają kategorie Apple ──────────
//
// `cat in APPLE_PODCAST_CATEGORIES` (linia 128) i `CATEGORIES[category]`
// (linia 115) przechodzą po ŁAŃCUCHU PROTOTYPU zwykłego literału obiektowego,
// więc "toString", "valueOf", "constructor" i "hasOwnProperty" zdają test
// przynależności do taksonomii. Wartość kategorii jest w bazie zwykłym tekstem
// (`podcast_settings.itunes_category`), a `resolvePodcastChannelMeta` przepuszcza
// ją do buildera bez sprawdzania listy - więc taka wartość (import CSV, ręczna
// edycja, migracja z WP) dociera tutaj.
describe("normalizeAppleCategory - nazwy z prototypu Object", () => {
  it.fails("DEFEKT: 'toString' przechodzi jako kategoria zamiast zdegradować", () => {
    // KONSEKWENCJA: feed wychodzi z <itunes:category text="toString"/>, czyli
    // wartością spoza zamkniętej listy Apple. Podcasts Connect odrzuca
    // zgłoszenie kanału, a redakcja widzi w panelu Apple tylko "invalid
    // category" - bez wskazania, że winna jest wartość w ustawieniach.
    expect(normalizeAppleCategory("toString", "")).toEqual({
      category: DEFAULT_APPLE_CATEGORY,
      subcategory: DEFAULT_APPLE_SUBCATEGORY,
    });
  });

  // PRZYPIĘTY STAN FAKTYCZNY - naprawa produkcji (hasOwnProperty albo
  // Object.create(null) pod mapą) wywali JEDNOCZEŚNIE ten test i it.fails wyżej.
  it("PRZYPIĘTY STAN: 'toString' jest zwracany verbatim jako kategoria", () => {
    expect(normalizeAppleCategory("toString", "")).toEqual({
      category: "toString",
      subcategory: null,
    });
  });

  it.fails("DEFEKT: 'constructor' z podkategorią wywraca generator kanału", () => {
    // appleSubcategories("constructor") zwraca FUNKCJĘ (Object.prototype
    // .constructor), a nie tablicę, więc `.includes(sub)` w linii 134 rzuca
    // TypeError. KONSEKWENCJA: trasa /podcast/rss.xml kończy się błędem 500 -
    // Apple i Spotify dostają stronę błędu zamiast kanału, a program przy
    // kolejnych odpytaniach wypada z katalogów wraz z całą historią odcinków.
    expect(normalizeAppleCategory("constructor", "Politics")).toEqual({
      category: DEFAULT_APPLE_CATEGORY,
      subcategory: DEFAULT_APPLE_SUBCATEGORY,
    });
  });

  it("PRZYPIĘTY STAN: 'constructor' z podkategorią rzuca TypeError", () => {
    expect(() => normalizeAppleCategory("constructor", "Politics")).toThrow(TypeError);
  });

  it("PRZYPIĘTY STAN: 'hasOwnProperty' też przechodzi jako kategoria", () => {
    expect(normalizeAppleCategory("hasOwnProperty", null).category).toBe("hasOwnProperty");
  });
});
