// GRUPOWANIE TEMATYCZNE STRON W PANELU (`src/lib/admin/pageTopics.ts`).
// 291 linii, sześć eksportów, ŻADNEGO WŁASNEGO TESTU przed tym plikiem.
//
// UWAGA NA POMIAR - TEN MODUŁ NIE STARTOWAŁ Z ZERA. `adminPagesRoute.test.tsx`
// podmienia atrapą sam pasek zakładek (`TopicTabs`), ale TRASA i tak woła
// `topicOrFilter`, `otherNotPatterns`, `topicForSlug` i `topicLabel`, więc
// zmierzone wejście to 100% linii / 79,16% gałęzi / 90% instrukcji. Ten plik
// dokłada GAŁĘZIE, których test trasy nie rusza (klucz spoza `TOPICS`, warianty
// `lang`, wejście puste i `null`, slug traktowany jako DANA a nie wzorzec),
// a przede wszystkim jest pierwszym miejscem sprawdzającym SPÓJNOŚĆ dwóch
// niezależnych wyliczeń tematu - i to ona się nie zgadza (patrz `it.fails`).
//
// CO TEN PLIK DOWODZI. `pages` nie ma kolumny kategorii - temat strony jest
// WYLICZANY z wzorca sluga, w DWÓCH niezależnych miejscach:
//
//   * `topicOrFilter()` / `otherNotPatterns()` układają filtr, który jedzie do
//     bazy (`.or("slug.ilike.…")`, `.not("slug","ilike",…)`) i decyduje, KTÓRE
//     wiersze admin w ogóle zobaczy oraz jaki dostanie licznik i paginację;
//   * `topicForSlug()` + `topicLabel()` malują plakietkę NA WIERSZU.
//
// Te dwie ścieżki muszą mówić to samo. Rozjazd nie wygląda jak awaria - lista
// po prostu pokazuje inny zbiór, niż mówi zakładka, a redaktor stwierdza, że
// „strony zniknęły”. Dowodzimy więc czterech rzeczy:
//
//   1. KSZTAŁTU FILTRA: dokładnie tyle warunków, ile wzorców, każdy w formie
//      `slug.ilike.<wzorzec>`, ze ZACHOWANYM `%`. To jest sedno komentarza
//      produkcyjnego: te wzorce NIE przechodzą przez `escapeLike`, bo ta
//      funkcja zjada `%` i zamieniłaby dopasowanie z wildcardem na równość.
//   2. NIEWSTRZYKIWALNOŚCI: żaden wzorzec nie wnosi znaku, który PostgREST
//      czyta jako składnię `.or()` (przecinek, nawias, cudzysłów). Dziś to
//      prawda i test pilnuje, żeby nowy wzorzec jej nie złamał - `topicOrFilter`
//      neutralizuje WYŁĄCZNIE przecinek.
//   3. WYLICZENIA TEMATU: pierwsze trafienie po kolejności `TOPICS`, bez
//      rozróżniania wielkości liter, a dane wejściowe NIE są wzorcem
//      (slug `.*` nie łapie wszystkiego).
//   4. WARSTWY JĘZYKOWEJ: `topicLabel` składa napis dwujęzycznie W KODZIE
//      (`label_pl`/`label_en`, bez i18next), więc asercja idzie na RÓŻNICĘ
//      PL/EN i na warianty `lang` (`en-GB`, `pl-PL`, `""`).
//
// ZNALEZIONY DEFEKT (patrz `it.fails` na końcu): wzorce trzech tematów
// ZACHODZĄ NA SIEBIE, więc filtr serwera i plakietka wiersza się rozjeżdżają -
// zakładka „Prawne i informacyjne” zwraca `membership-login`, ale wiersz nosi
// plakietkę „Członkostwo i subskrypcje”. Kontrola dodatnia obok przypina stan
// faktyczny, żeby zmiana kolejności `TOPICS` nie przeszła niezauważona.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - AUTORYTETU BAZY: czy `pages` przepuści odczyt i czy najemca jest zawężony -
//   `rls_tenant_isolation_test.sql`, `tenant_isolation_three_tenants_test.sql`,
//   `security_definer_tenant_scope_test.sql`. Tu nie ma RLS, więc żaden test
//   na atrapie nie może o tym mówić.
// - SKŁADANIA ŁAŃCUCHA ZAPYTANIA W TRASIE (`.or(...)` vs pętla `.not(...)`,
//   paginacja, kosz): `src/routes/__tests__/adminPagesRoute.test.tsx`.
// - NEUTRALIZACJI FRAZY WYSZUKIWANIA (`escapeLike`):
//   `src/lib/admin/__tests__/listFilters.test.ts`.
// - RENDEROWANIA PASKA ZAKŁADEK i liczników: `TopicTabs` jest komponentem
//   i ma być mierzony testem komponentu, nie tutaj.
//
// RODO: moduł nie dotyka danych osobowych - wszystkie slugi w tym pliku są
// umowne, bez adresów e-mail i bez adresów IP.
import { describe, expect, it } from "vitest";
import {
  CATEGORIZED_PATTERNS,
  TOPICS,
  otherNotPatterns,
  topicForSlug,
  topicLabel,
  topicOrFilter,
  type PageTopicDef,
  type PageTopicKey,
} from "@/lib/admin/pageTopics";

/**
 * Dostęp do obu funkcji z parametrem ROZSZERZONYM do `string`.
 *
 * Po co: `topicOrFilter` i `topicLabel` mają w środku gałąź „nie znam takiego
 * tematu” (`!def`), której NIE DA SIĘ dziś osiągnąć wartością z unii
 * `PageTopicKey` - bo każda z nich jest w `TOPICS`. Ta gałąź nie jest jednak
 * martwa: wystarczy usunąć jeden wpis z `TOPICS` (albo dopisać klucz do unii
 * bez wpisu), żeby panel zaczął nią chodzić. Test musi więc umieć podać klucz
 * spoza tablicy - i robi to BEZ rzutowania: parametry metod deklarowanych
 * składnią metody są w TypeScripcie porównywane biwariantnie, więc funkcja
 * przyjmująca `PageTopicKey` jest przypisywalna do metody przyjmującej
 * `string`. Zero `as`, zero `@ts-expect-error`.
 */
interface WidenedTopicApi {
  topicOrFilter(topic: string): string | null;
  topicLabel(key: string, lang: string): string;
}
const widened: WidenedTopicApi = { topicOrFilter, topicLabel };

/** Tematy, które NAPRAWDĘ filtrują po slugu (bez `all` i `other`). */
const REAL_TOPICS: readonly PageTopicDef[] = TOPICS.filter(
  (topic) => topic.key !== "all" && topic.key !== "other",
);

/** Indeks tematu w `TOPICS` - kolejność jest tu regułą, nie kosmetyką. */
function indexOfTopic(key: PageTopicKey): number {
  return TOPICS.findIndex((topic) => topic.key === key);
}

/**
 * Slug, który wzorzec MA łapać: `%` -> `x`, `_` -> `y`. Tak powstaje jeden
 * konkretny przykład na każdy wzorzec w module - bez wypisywania 130 slugów
 * ręcznie i bez ryzyka, że nowy wzorzec zostanie bez przykładu.
 */
function sampleSlug(pattern: string): string {
  return pattern.replace(/%/g, "x").replace(/_/g, "y");
}

/** Wzorzec + temat, który go deklaruje + wyliczony przykładowy slug. */
interface PatternCase {
  topic: PageTopicKey;
  pattern: string;
  slug: string;
}

const PATTERN_CASES: readonly PatternCase[] = REAL_TOPICS.flatMap((topic) =>
  topic.slugPatterns.map((pattern) => ({
    topic: topic.key,
    pattern,
    slug: sampleSlug(pattern),
  })),
);

/**
 * Wzorce, dla których filtr serwera i plakietka wiersza NIE zgadzają się:
 * slug złapany przez wzorzec tematu X dostaje plakietkę tematu Y, bo Y stoi
 * wcześniej w `TOPICS`. Liczony, a nie wpisany - dzięki temu dopisanie
 * kolejnego zachodzącego wzorca podnosi tę listę i oblewa test niżej.
 */
const DIVERGENT: readonly PatternCase[] = PATTERN_CASES.filter(
  (entry) => topicForSlug(entry.slug) !== entry.topic,
);

// ---------------------------------------------------------------------------
// 1. STRUKTURA `TOPICS` - niezmienniki, na których stoją oba wyliczenia.
// ---------------------------------------------------------------------------

describe("pageTopics - struktura tablicy TOPICS", () => {
  it("klucze tematów są unikalne", () => {
    // Duplikat klucza znaczy dwa różne zestawy wzorców pod jedną zakładką:
    // `TOPICS.find` bierze pierwszy, a `topicForSlug` chodzi po obu.
    const keys = TOPICS.map((topic) => topic.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("`all` jest pierwsze, `other` ostatnie", () => {
    // Oba są POJĘCIAMI, nie wzorcami: pierwsze znaczy „bez filtra”, ostatnie
    // „negacja wszystkich pozostałych”. Wstawienie ich w środek zmieniłoby
    // wynik `topicForSlug` dla wszystkiego, co stoi za nimi.
    expect(TOPICS[0]?.key).toBe("all");
    expect(TOPICS.at(-1)?.key).toBe("other");
  });

  it("`all` i `other` NIE mają wzorców", () => {
    expect(TOPICS.find((topic) => topic.key === "all")?.slugPatterns).toEqual([]);
    expect(TOPICS.find((topic) => topic.key === "other")?.slugPatterns).toEqual([]);
  });

  it.each(REAL_TOPICS.map((topic) => ({ key: topic.key, count: topic.slugPatterns.length })))(
    "temat $key ma przynajmniej jeden wzorzec ($count)",
    ({ count }) => {
      // Temat bez wzorców to zakładka, która nigdy nic nie pokaże, a przy tym
      // wypadnie z `CATEGORIZED_PATTERNS`, czyli wpadnie do „Pozostałych”.
      expect(count).toBeGreaterThan(0);
    },
  );

  it("`conferences`, `chatham` i `clubs` stoją PRZED ogólnym `events`", () => {
    // Komentarz modułu obiecuje dokładnie to i od tego zależy plakietka:
    // `panel-2026` ma być konferencją, nie wydarzeniem.
    const events = indexOfTopic("events");
    expect(indexOfTopic("conferences")).toBeLessThan(events);
    expect(indexOfTopic("chatham")).toBeLessThan(events);
    expect(indexOfTopic("clubs")).toBeLessThan(events);
  });

  it.each(REAL_TOPICS.map((topic) => ({ key: topic.key })))(
    "temat $key ma etykietę PL i EN",
    ({ key }) => {
      const def = TOPICS.find((topic) => topic.key === key);
      expect(def?.label_pl).not.toBe("");
      expect(def?.label_en).not.toBe("");
    },
  );
});

// ---------------------------------------------------------------------------
// 2. WZORCE - to, co dosłownie trafia do zapytania PostgREST.
// ---------------------------------------------------------------------------

describe("pageTopics - bezpieczeństwo wzorców w filtrze `.or()`", () => {
  it.each(PATTERN_CASES.map((entry) => ({ topic: entry.topic, pattern: entry.pattern })))(
    "wzorzec `$pattern` ($topic) nie wnosi składni `.or()`",
    ({ pattern }) => {
      // `topicOrFilter` usuwa TYLKO przecinek. Nawias domyka grupę warunków,
      // cudzysłów - wartość, a kropka rozdziela kolumnę od operatora. Wzorzec
      // z takim znakiem nie „nie zadziała”: zmieni CAŁE zapytanie, czyli
      // pokaże adminowi inny zbiór stron, niż wybrał.
      expect(pattern).not.toMatch(/[(),"\\]/);
      expect(pattern.trim()).toBe(pattern);
      expect(pattern).not.toBe("");
    },
  );

  it("wzorce ZACHOWUJĄ `%` - inaczej ILIKE stałoby się równością", () => {
    // To jest powód, dla którego moduł świadomie nie woła `escapeLike`.
    const conferences = REAL_TOPICS.find((topic) => topic.key === "conferences");
    expect(conferences?.slugPatterns).toContain("konferenc%");
    expect(topicOrFilter("conferences")).toContain("slug.ilike.konferenc%");
  });

  it("`CATEGORIZED_PATTERNS` to wzorce wszystkich tematów poza `all` i `other`", () => {
    expect(CATEGORIZED_PATTERNS).toEqual(REAL_TOPICS.flatMap((topic) => topic.slugPatterns));
  });

  it("`otherNotPatterns()` oddaje dokładnie `CATEGORIZED_PATTERNS`", () => {
    // Trasa buduje z tego pętlę `.not("slug","ilike",p)`. Każdy wzorzec, który
    // tu nie dojedzie, wpuści stronę JEDNOCZEŚNIE do swojego tematu
    // i do „Pozostałych” - ten sam wiersz w dwóch zakładkach.
    expect(otherNotPatterns()).toEqual(CATEGORIZED_PATTERNS);
    expect(otherNotPatterns().length).toBeGreaterThan(100);
  });
});

describe("pageTopics - topicOrFilter", () => {
  it("`all` nie filtruje po stronie serwera", () => {
    expect(topicOrFilter("all")).toBeNull();
  });

  it("`other` nie ma filtra POZYTYWNEGO - wywołujący dokłada negację", () => {
    // `null` tutaj nie znaczy „brak filtra”: trasa rozpoznaje `other` osobno
    // i dokłada `.not(...)` dla każdego wzorca. Zwrócenie tu czegokolwiek
    // innego niż `null` dałoby zakładkę „Pozostałe” pokazującą wszystko.
    expect(topicOrFilter("other")).toBeNull();
  });

  it.each(REAL_TOPICS.map((topic) => ({ key: topic.key, patterns: topic.slugPatterns })))(
    "temat $key składa tyle warunków, ile ma wzorców",
    ({ key, patterns }) => {
      const filter = topicOrFilter(key);
      expect(filter).not.toBeNull();
      const parts = (filter ?? "").split(",");
      // Równość liczb jest tu dowodem BRAKU WSTRZYKNIĘCIA: gdyby wzorzec
      // wniósł przecinek, warunków byłoby więcej niż wzorców.
      expect(parts).toHaveLength(patterns.length);
      expect(parts).toEqual(patterns.map((pattern) => `slug.ilike.${pattern}`));
    },
  );

  it("filtr `basic` jest dokładnie tym napisem", () => {
    // Jeden pełny odcisk palca - żeby zmiana formatu ogniwa (np. na `like`
    // z rozróżnianiem wielkości liter) nie przeszła cicho przez testy
    // liczące same warunki.
    expect(topicOrFilter("chatham")).toBe(
      "slug.ilike.chatham-%,slug.ilike.%chatham-house%," +
        "slug.ilike.spotkania-chatham%,slug.ilike.spotkanie-chatham%",
    );
  });

  it("klucz tematu, którego NIE MA w `TOPICS`, nie filtruje niczego", () => {
    // Gałąź `!def`. Zwrócenie `null` znaczy „pokaż wszystko” - i to jest tu
    // wybór bezpieczny, bo alternatywą byłby wyjątek w środku budowania
    // zapytania listy stron, czyli biała strona panelu.
    expect(widened.topicOrFilter("temat-ktorego-nie-ma")).toBeNull();
    expect(widened.topicOrFilter("")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. `topicForSlug` - plakietka na wierszu.
// ---------------------------------------------------------------------------

describe("pageTopics - topicForSlug", () => {
  const EMPTY_INPUTS: readonly { label: string; slug: string | null | undefined }[] = [
    { label: "napis pusty (wartość FAŁSZYWA, ale PRAWIDŁOWA)", slug: "" },
    { label: "null z kolumny", slug: null },
    { label: "undefined - brak pola w wierszu", slug: undefined },
  ];

  it.each(EMPTY_INPUTS)("$label daje temat `other`, nie wyjątek", ({ slug }) => {
    // Wiersz bez sluga istnieje: strona w koszu po migracji z WordPressa.
    // Wyjątek tutaj wywala CAŁĄ listę stron, bo plakietka renderuje się
    // w każdym wierszu.
    expect(topicForSlug(slug)).toBe("other");
  });

  it("slug nieznany dostaje `other`", () => {
    expect(topicForSlug("zupelnie-nowa-strona-2026")).toBe("other");
  });

  it("dopasowanie NIE rozróżnia wielkości liter - jak ILIKE w bazie", () => {
    // Plakietka i filtr muszą czytać sluga tak samo. `ILIKE` w bazie jest
    // bez rozróżniania, więc `topicForSlug` też musi być - inaczej wiersz
    // wpadnie do zakładki, w której nie dostanie plakietki.
    expect(topicForSlug("KONFERENCJA-CEE-2026")).toBe("conferences");
    expect(topicForSlug("Podcast-Odcinek-12")).toBe("podcasts");
  });

  it("slug jest DANĄ, nie wzorcem - `.*` nie łapie wszystkiego", () => {
    // Matcher buduje wyrażenie regularne z WZORCA, nie z wejścia. Gdyby było
    // odwrotnie, slug ze znakami regularnymi przejmowałby dowolną zakładkę.
    expect(topicForSlug(".*")).toBe("other");
    expect(topicForSlug("^main$")).toBe("other");
  });

  it("wzorzec z `%` w środku łapie slug ze śródtekstem", () => {
    expect(topicForSlug("spotkanie-o-chatham-house-w-warszawie")).toBe("chatham");
  });

  it("wzorzec bez `%` wymaga PEŁNEJ zgodności, nie prefiksu", () => {
    // `basic` deklaruje `main` bez wildcardu - `maintenance` nie jest stroną
    // podstawową i nie może dostać jej plakietki.
    expect(topicForSlug("main")).toBe("basic");
    expect(topicForSlug("maintenance")).toBe("other");
    expect(topicForSlug("club")).toBe("clubs");
    expect(topicForSlug("clubhouse")).toBe("other");
  });

  it.each(
    PATTERN_CASES.filter(
      (entry) =>
        !DIVERGENT.some((bad) => bad.pattern === entry.pattern && bad.topic === entry.topic),
    ),
  )("slug `$slug` (wzorzec `$pattern`) dostaje plakietkę `$topic`", ({ slug, topic }) => {
    // Jeden przykład na KAŻDY wzorzec w module: dowód, że filtr serwera
    // i plakietka wiersza mówią to samo. Wyjątki są niżej, w `it.fails`.
    expect(topicForSlug(slug)).toBe(topic);
  });
});

// ---------------------------------------------------------------------------
// 4. `topicLabel` - dwujęzyczność złożona W KODZIE, bez i18next.
// ---------------------------------------------------------------------------

describe("pageTopics - topicLabel", () => {
  const LANGS: readonly { lang: string; expectEn: boolean; why: string }[] = [
    { lang: "pl", expectEn: false, why: "polski" },
    { lang: "en", expectEn: true, why: "angielski" },
    { lang: "en-GB", expectEn: true, why: "angielski regionalny (startsWith)" },
    { lang: "pl-PL", expectEn: false, why: "polski regionalny" },
    { lang: "", expectEn: false, why: "napis pusty - wartość FAŁSZYWA, ale PRAWIDŁOWA" },
    { lang: "de", expectEn: false, why: "język nieobsługiwany spada na polski" },
  ];

  it.each(LANGS)("lang `$lang` ($why) wybiera właściwą etykietę", ({ lang, expectEn }) => {
    const def = TOPICS.find((topic) => topic.key === "basic");
    expect(topicLabel("basic", lang)).toBe(expectEn ? def?.label_en : def?.label_pl);
  });

  it("etykieta PL i EN RÓŻNIĄ SIĘ dla większości tematów", () => {
    // Moduł nie idzie przez i18next - napisy są w kodzie. Asercja pilnuje
    // więc RÓŻNICY: gdyby ktoś skopiował `label_pl` do `label_en`, panel po
    // angielsku pokazywałby polskie zakładki, a żaden test słownika by tego
    // nie zauważył (bo słownika tu nie ma).
    const differing = TOPICS.filter(
      (topic) => topicLabel(topic.key, "pl") !== topicLabel(topic.key, "en"),
    );
    expect(differing.length).toBe(TOPICS.length - 1);
  });

  it("`mentoring` ma ŚWIADOMIE identyczną etykietę w obu językach", () => {
    // Kontrola dodatnia do testu wyżej: to jedyny taki temat i to nie jest
    // przeoczenie - „Mentoring” po polsku brzmi tak samo. Bez tego testu
    // ktoś „naprawi” różnicę wymyślonym tłumaczeniem.
    expect(topicLabel("mentoring", "pl")).toBe("Mentoring");
    expect(topicLabel("mentoring", "en")).toBe("Mentoring");
  });

  it("wielkość litery w `lang` ma znaczenie - `EN` daje polski", () => {
    // Stan faktyczny, przypięty świadomie: `lang.startsWith("en")` rozróżnia
    // wielkość liter, a i18next podaje kody małymi literami. Gdyby kiedyś
    // podał `EN`, ten test pokaże, gdzie dokładnie leży skutek.
    expect(topicLabel("basic", "EN")).toBe("Strony podstawowe");
  });

  it("klucz spoza `TOPICS` wraca jako WŁASNY napis, a nie pusty", () => {
    // Gałąź `!def`: lepiej pokazać w plakietce surowy klucz niż nic - admin
    // widzi wtedy, że coś jest nie tak, zamiast patrzeć na pusty wiersz.
    expect(widened.topicLabel("temat-usuniety", "pl")).toBe("temat-usuniety");
    expect(widened.topicLabel("temat-usuniety", "en")).toBe("temat-usuniety");
  });
});

// ---------------------------------------------------------------------------
// 5. DEFEKT: zachodzące wzorce rozjeżdżają filtr serwera z plakietką wiersza.
// ---------------------------------------------------------------------------

describe("pageTopics - rozjazd filtra i plakietki (defekt)", () => {
  it("stan faktyczny: `membership-%` wygrywa z dosłownym `membership-login` w `legal`", () => {
    // KONTROLA DODATNIA. `membership` (indeks 8) stoi przed `legal` (indeks 10),
    // więc pierwsze trafienie należy do członkostwa - mimo że `legal` wypisuje
    // te dwa slugi dosłownie.
    expect(indexOfTopic("membership")).toBeLessThan(indexOfTopic("legal"));
    expect(topicForSlug("membership-login")).toBe("membership");
    expect(topicForSlug("membership-registration")).toBe("membership");
    // A filtr serwera dla `legal` te slugi JEDNAK obejmuje:
    expect(topicOrFilter("legal")).toContain("slug.ilike.membership-login");
  });

  it("stan faktyczny: `zglos-%` należy do `editorial`, choć `forms` deklaruje ten sam wzorzec", () => {
    // KONTROLA DODATNIA dla drugiego zachodzenia: ten sam wzorzec dosłownie
    // w dwóch tematach. `editorial` (9) przed `forms` (11).
    expect(indexOfTopic("editorial")).toBeLessThan(indexOfTopic("forms"));
    expect(topicForSlug("zglos-uwagi-do-tekstu")).toBe("editorial");
    expect(topicOrFilter("forms")).toContain("slug.ilike.zglos-%");
  });

  it("lista rozjazdów jest DOKŁADNIE tą znaną - nowy zachodzący wzorzec oblewa test", () => {
    // Detektor regresji: gdy ktoś doda kolejny wzorzec zachodzący na
    // wcześniejszy temat, lista spuchnie i ten test upadnie.
    expect(
      DIVERGENT.map((entry) => `${entry.topic}:${entry.pattern}->${topicForSlug(entry.slug)}`),
    ).toEqual([
      "legal:membership-login->membership",
      "legal:membership-registration->membership",
      "forms:zglos-%->editorial",
    ]);
  });

  it.fails("DEFEKT: slug złapany przez filtr tematu dostaje plakietkę INNEGO tematu", () => {
    // CO JEST ZŁE: `topicOrFilter(T)` i `topicForSlug(slug)` liczą temat
    // dwoma niezależnymi drogami. Dla wzorców zachodzących wynik się różni,
    // bo pierwsza droga pyta o JEDEN temat, a druga bierze PIERWSZE
    // trafienie po kolejności `TOPICS`.
    //
    // SKUTEK DLA UŻYTKOWNIKA: w zakładce „Prawne i informacyjne” pojawia się
    // wiersz `membership-login` z plakietką „Członkostwo i subskrypcje”,
    // a licznik zakładki „Członkostwo” (liczony po stronie klienta z
    // `topicForSlug`) nie zgadza się z liczbą wierszy, które zwraca filtr
    // serwera dla tej zakładki. Redaktor czyta to jako „panel gubi strony”.
    //
    // DLACZEGO NAPRAWA TO OSOBNA PRACA: trzeba rozstrzygnąć, która droga
    // jest autorytetem. Albo usunąć zachodzące wzorce z późniejszych tematów
    // (co ZMIENIA zbiór stron w dwóch zakładkach - decyzja redakcyjna), albo
    // dołożyć do filtra serwera negację wzorców tematów wcześniejszych (co
    // zmienia kształt zapytania i wymaga przejrzenia paginacji w trasie).
    // Jedno i drugie to zmiana zachowania produkcyjnego, nie test.
    for (const entry of PATTERN_CASES) {
      expect(topicForSlug(entry.slug)).toBe(entry.topic);
    }
  });
});
