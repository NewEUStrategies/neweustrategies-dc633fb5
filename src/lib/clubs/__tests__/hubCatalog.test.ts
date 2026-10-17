// Reguły katalogu klubów na hubie `/club`, wyprowadzone z JSX-a trasy.
//
// CO TO DOWODZI. Cztery reguły produktu, które przed wyprowadzeniem były
// wyrażeniami inline w drzewie JSX i dały się sprawdzić wyłącznie przez
// zamontowanie całego huba z czterema atrapami zapytań:
//
//   1. „MÓJ KLUB" to WYŁĄCZNIE aktywne członkostwo. `pending`, `invited`,
//      `banned` i `left` muszą zostać w „Odkryj": sekcja „Moje kluby"
//      z pozycją, której kliknięcie kończy się bramką dostępu, jest gorsza
//      niż jej brak.
//   2. FILTR OBSZARU dotyczy tylko sekcji „Odkryj". Zawężanie „Moich klubów"
//      ukrywałoby użytkownikowi jego własne kluby i wyglądało jak utrata
//      członkostwa.
//   3. `topic === null` znaczy BRAK zawężenia, a `policy_area === null` znaczy
//      „obszar nieprzypisany" - to NIE to samo. Interpretacja „null pasuje do
//      wszystkiego" wpuszczałaby kluby bez obszaru do każdego filtra i zabijała
//      całą wartość paska obszarów.
//   4. LICZNIKI liczą się z CAŁEGO katalogu, nie z sekcji po filtrze: pasek
//      odpowiada na pytanie „ile tego jest", więc wybór obszaru nie ma prawa
//      zmieniać liczby klubów w serwisie.
//
// Plus dwa progi: fraza wyszukiwania (dwa znaki po przycięciu) i ucięcie
// katalogu - oba trafiane DOKŁADNIE w granicę i o jeden po każdej stronie.
//
// I STRONICOWANIE: offset następnej porcji (`nextClubCatalogOffset`) oraz
// sklejenie porcji bez duplikatów (`mergeClubCatalogPages`). „Pokaż więcej"
// rosło dotąd przez `p_limit`, a A13 tnie stronę do 200 - powyżej 200 klubów
// przycisk zostawał i nie robił nic. Ta warstwa decyduje, czy kliknięcie
// w ogóle coś dowiezie i czy ten sam klub nie stanie w katalogu dwa razy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie odtwarza `resolveClubHubAccess`
// (`hubAccess.test.ts`), rankingu dopasowania nazw (`clubMatch.test.ts`) ani
// etykiet obszarów (`topics.test.ts`). Nie sprawdza też, czy RPC `club_list`
// odsiewa wiersze po widoczności - to autorytet bazy z pokryciem pgTAP,
// a te funkcje dostają wiersze JUŻ odsiane.
import { describe, expect, it } from "vitest";
import {
  CLUB_CATALOG_PAGE_SIZE,
  CLUB_LIST_SERVER_CAP,
  CLUB_SEARCH_MIN_CHARS,
  clubHubBuckets,
  clubHubStats,
  hasMoreClubs,
  isClubSearchActive,
  isMyClub,
  mergeClubCatalogPages,
  nextClubCatalogOffset,
  type ClubCatalogPage,
  type ClubHubCatalogRow,
} from "@/lib/clubs/hubCatalog";
import { clubListRow } from "@/test/clubs/fixtures";

function row(overrides: Partial<ClubHubCatalogRow> = {}): ClubHubCatalogRow {
  return {
    my_status: null,
    policy_area: null,
    thread_count: 0,
    member_count: 0,
    ...overrides,
  };
}

// --- isMyClub --------------------------------------------------------------

describe("isMyClub - członkostwem jest WYŁĄCZNIE `active`", () => {
  it("aktywne członkostwo to mój klub", () => {
    expect(isMyClub(row({ my_status: "active" }))).toBe(true);
  });

  it.each(["pending", "invited", "banned", "left"])(
    "status `%s` NIE jest członkostwem",
    (status) => {
      expect(isMyClub(row({ my_status: status }))).toBe(false);
    },
  );

  it.each([
    ["null (kolumna puste dla gościa)", null],
    ["pusty napis (wartość fałszywa, ale prawidłowa)", ""],
    ["status spoza zbioru", "archived"],
    ["inna wielkość liter", "ACTIVE"],
  ])("%s nie jest członkostwem", (_label, status) => {
    expect(isMyClub(row({ my_status: status }))).toBe(false);
  });

  it("wiersz `club_list` z fixture'ów przechodzi przez ten sam kontrakt", () => {
    // Kanarek zgodności KSZTAŁTU: gdyby `ClubListRow` przestał nieść
    // `my_status`/`policy_area`/liczniki, ten plik przestałby się kompilować,
    // a nie cicho zmienił wynik.
    expect(isMyClub(clubListRow({ my_status: "active" }))).toBe(true);
    expect(isMyClub(clubListRow({ my_status: "pending" }))).toBe(false);
  });
});

// --- clubHubBuckets --------------------------------------------------------

describe("clubHubBuckets - podział na „moje” i „do odkrycia”", () => {
  it("pusty katalog daje dwie puste sekcje, a nie wyjątek", () => {
    expect(clubHubBuckets([], null)).toEqual({ mine: [], discover: [] });
  });

  it("rozdziela członkostwa od reszty bez gubienia ani jednego wiersza", () => {
    const moj = row({ my_status: "active", policy_area: "energy" });
    const obcy = row({ my_status: null, policy_area: "energy" });
    const oczekujacy = row({ my_status: "pending", policy_area: "energy" });
    const wynik = clubHubBuckets([moj, obcy, oczekujacy], null);
    expect(wynik.mine).toEqual([moj]);
    expect(wynik.discover).toEqual([obcy, oczekujacy]);
  });

  it("zachowuje KOLEJNOŚĆ z katalogu w obu sekcjach", () => {
    // RPC sortuje po aktywności; przetasowanie w kliencie zmieniałoby to, co
    // czytelnik widzi na górze listy, bez żadnego powodu.
    const wiersze = [
      row({ my_status: "active", thread_count: 1 }),
      row({ my_status: null, thread_count: 2 }),
      row({ my_status: "active", thread_count: 3 }),
      row({ my_status: null, thread_count: 4 }),
    ];
    const wynik = clubHubBuckets(wiersze, null);
    expect(wynik.mine.map((r) => r.thread_count)).toEqual([1, 3]);
    expect(wynik.discover.map((r) => r.thread_count)).toEqual([2, 4]);
  });

  it("filtr obszaru zawęża WYŁĄCZNIE „Odkryj”", () => {
    const mojInny = row({ my_status: "active", policy_area: "transport" });
    const obcyPasuje = row({ my_status: null, policy_area: "energy" });
    const obcyNie = row({ my_status: null, policy_area: "transport" });
    const wynik = clubHubBuckets([mojInny, obcyPasuje, obcyNie], "energy");
    expect(wynik.mine).toEqual([mojInny]);
    expect(wynik.discover).toEqual([obcyPasuje]);
  });

  it("brak filtra przepuszcza także klub BEZ przypisanego obszaru", () => {
    const bezObszaru = row({ my_status: null, policy_area: null });
    expect(clubHubBuckets([bezObszaru], null).discover).toEqual([bezObszaru]);
  });

  it("klub BEZ obszaru NIE pasuje do żadnego wybranego obszaru", () => {
    // To jest ta reguła, której odwrotność zabija pasek obszarów: gdyby `null`
    // pasował do wszystkiego, każdy filtr pokazywałby kluby nieprzypisane.
    const bezObszaru = row({ my_status: null, policy_area: null });
    expect(clubHubBuckets([bezObszaru], "energy").discover).toEqual([]);
  });

  it("pusty napis jako obszar wiersza to WARTOŚĆ, nie brak - pasuje do filtra ``", () => {
    const pusty = row({ my_status: null, policy_area: "" });
    expect(clubHubBuckets([pusty], "").discover).toEqual([pusty]);
    expect(clubHubBuckets([pusty], "energy").discover).toEqual([]);
  });

  it("filtr, do którego nic nie pasuje, daje pustą sekcję „Odkryj” i nietkniętą „moje”", () => {
    const moj = row({ my_status: "active" });
    const wynik = clubHubBuckets([moj, row({ policy_area: "transport" })], "cyber");
    expect(wynik.discover).toEqual([]);
    expect(wynik.mine).toEqual([moj]);
  });

  it("działa na wierszach `club_list` bez rzutowań", () => {
    const rows = [
      clubListRow({ id: "a", my_status: "active", policy_area: "energy" }),
      clubListRow({ id: "b", my_status: "invited", policy_area: "energy" }),
      clubListRow({ id: "c", my_status: "invited", policy_area: "transport" }),
    ];
    const wynik = clubHubBuckets(rows, "energy");
    expect(wynik.mine.map((r) => r.id)).toEqual(["a"]);
    expect(wynik.discover.map((r) => r.id)).toEqual(["b"]);
  });
});

// --- clubHubStats ----------------------------------------------------------

describe("clubHubStats - liczniki paska nad katalogiem", () => {
  it("pusty katalog daje cztery zera, a nie `NaN`", () => {
    expect(clubHubStats([])).toEqual({ clubs: 0, threads: 0, seats: 0, mine: 0 });
  });

  it("sumuje wątki i miejsca po CAŁYM katalogu", () => {
    const wynik = clubHubStats([
      row({ thread_count: 3, member_count: 10 }),
      row({ thread_count: 4, member_count: 20 }),
    ]);
    expect(wynik).toEqual({ clubs: 2, threads: 7, seats: 30, mine: 0 });
  });

  it("liczy TYLKO aktywne członkostwa jako „moje”", () => {
    const wynik = clubHubStats([
      row({ my_status: "active" }),
      row({ my_status: "pending" }),
      row({ my_status: "invited" }),
      row({ my_status: "active" }),
    ]);
    expect(wynik.mine).toBe(2);
    expect(wynik.clubs).toBe(4);
  });

  it("zerowe liczniki wiersza są liczone, a nie pomijane", () => {
    // `0` jest wartością prawidłową: klub bez wątków istnieje i musi się
    // policzyć w `clubs`, choć nie dołoży nic do `threads`.
    const wynik = clubHubStats([row({ thread_count: 0, member_count: 0 })]);
    expect(wynik).toEqual({ clubs: 1, threads: 0, seats: 0, mine: 0 });
  });

  it("liczniki NIE zależą od filtra obszaru - to suma serwisu, nie widoku", () => {
    const wiersze = [
      row({ policy_area: "energy", thread_count: 5, member_count: 1 }),
      row({ policy_area: "transport", thread_count: 7, member_count: 2 }),
    ];
    expect(clubHubStats(wiersze).threads).toBe(12);
    // Sekcja „Odkryj” po filtrze ma jeden wiersz, ale licznik nadal mówi 12.
    expect(clubHubBuckets(wiersze, "energy").discover).toHaveLength(1);
  });
});

// --- progi -----------------------------------------------------------------

describe("isClubSearchActive - próg frazy wyszukiwania", () => {
  it("próg jest wystawiony jako stała, nie zaszyty w warunku", () => {
    expect(CLUB_SEARCH_MIN_CHARS).toBe(2);
  });

  it.each([
    ["pusta fraza", "", false],
    ["jeden znak", "e", false],
    ["dwa znaki - DOKŁADNIE próg", "en", true],
    ["trzy znaki", "ene", true],
    ["jeden znak w spacjach", "  e  ", false],
    ["dwa znaki w spacjach", "  en  ", true],
    ["same spacje", "     ", false],
    ["tabulator i nowa linia", "\t\n", false],
    ["dwa znaki niełacińskie", "łę", true],
  ])("%s -> %s", (_label, query, expected) => {
    expect(isClubSearchActive(query)).toBe(expected);
  });
});

describe("hasMoreClubs - czy katalog został ucięty", () => {
  it.each([
    ["nic nie pokazano, są wiersze", 0, 5, true],
    ["pokazano mniej niż jest", 100, 250, true],
    ["pokazano DOKŁADNIE tyle, ile jest", 100, 100, false],
    ["pokazano więcej, niż mówi okno (rozjazd po odświeżeniu)", 120, 100, false],
    ["pusty katalog", 0, 0, false],
  ])("%s -> %s", (_label, shown, total, expected) => {
    expect(hasMoreClubs(shown, total)).toBe(expected);
  });
});

// --- stronicowanie ---------------------------------------------------------

/** Porcja `n` kolejnych klubów od pozycji `from` w porządku serwera. */
function page(from: number, n: number, total: number): ClubCatalogPage<{ id: string }> {
  return { rows: Array.from({ length: n }, (_, i) => ({ id: `club-${from + i}` })), total };
}

describe("rozmiar porcji a sufit A13", () => {
  it("porcja klienta mieści się w suficie strony `club_list` (LIMIT ... 200)", () => {
    // Prośba ponad sufit wraca przycięta - porcja 300 dałaby 200 wierszy
    // i licznik, który obiecuje więcej, niż dowozi jedno kliknięcie.
    expect(CLUB_LIST_SERVER_CAP).toBe(200);
    expect(CLUB_CATALOG_PAGE_SIZE).toBe(100);
    expect(CLUB_CATALOG_PAGE_SIZE).toBeLessThanOrEqual(CLUB_LIST_SERVER_CAP);
  });
});

describe("nextClubCatalogOffset - offset następnej porcji", () => {
  it("po pierwszej porcji 100 z 250 następna idzie od offsetu 100", () => {
    expect(nextClubCatalogOffset([page(0, 100, 250)])).toBe(100);
  });

  it("po dwóch porcjach 100 z 250 następna idzie od offsetu 200 - PONAD sufit A13", () => {
    // Dokładnie ten punkt, w którym rosnący `p_limit` stawał: prośba o 300
    // wracała jako 200. Offset przechodzi przez sufit bez trudu.
    expect(nextClubCatalogOffset([page(0, 100, 250), page(100, 100, 250)])).toBe(200);
  });

  it("komplet (100 + 100 + 50 = 250) kończy doładowanie", () => {
    expect(
      nextClubCatalogOffset([page(0, 100, 250), page(100, 100, 250), page(200, 50, 250)]),
    ).toBeUndefined();
  });

  it("katalog mieszczący się w jednej porcji nie ma następnej", () => {
    expect(nextClubCatalogOffset([page(0, 37, 37)])).toBeUndefined();
  });

  it("pusty katalog nie ma następnej porcji", () => {
    expect(nextClubCatalogOffset([{ rows: [], total: 0 }])).toBeUndefined();
  });

  it("brak porcji (zapytanie w locie) nie ma następnej", () => {
    expect(nextClubCatalogOffset([])).toBeUndefined();
  });

  it("serwer przyciął porcję mocniej, niż prosiliśmy - offset to wiersze ODDANE", () => {
    // Prośba o 500, sufit oddał 200: `porcje * rozmiar` dałoby 500 i
    // przeskoczyło 300 klubów. Offset liczy to, co faktycznie przyszło.
    expect(nextClubCatalogOffset([page(0, CLUB_LIST_SERVER_CAP, 650)])).toBe(200);
  });

  it("duplikat na styku porcji NIE cofa offsetu - zajmuje miejsce w porządku serwera", () => {
    // Porcja 2 zaczyna się od ostatniego klubu porcji 1 (klub przesunął się
    // w porządku). Offset po wierszach unikalnych (199) pobrałby go po raz
    // trzeci; po wierszach oddanych (200) idzie dalej.
    const overlapping = [page(0, 100, 250), page(99, 100, 250)];
    expect(nextClubCatalogOffset(overlapping)).toBe(200);
  });

  it("decyduje `total` NAJŚWIEŻSZEJ porcji - klub zarchiwizowany między porcjami", () => {
    // Porcja 1 widziała 201 klubów, porcja 2 już 200: offset 200 = komplet.
    expect(nextClubCatalogOffset([page(0, 100, 201), page(100, 100, 200)])).toBeUndefined();
  });

  it("pusta porcja kończy doładowanie mimo nieaktualnego `total`", () => {
    // Bez tego nieaktualna suma kręciłaby pętlę pustych odpowiedzi pod
    // przyciskiem, który nic nie dokłada.
    expect(nextClubCatalogOffset([page(0, 100, 150), { rows: [], total: 0 }])).toBeUndefined();
  });
});

describe("mergeClubCatalogPages - porcje w jeden katalog", () => {
  it("skleja porcje w kolejności serwera", () => {
    const merged = mergeClubCatalogPages([page(0, 2, 4), page(2, 2, 4)]);
    expect(merged.rows.map((r) => r.id)).toEqual(["club-0", "club-1", "club-2", "club-3"]);
    expect(merged.total).toBe(4);
  });

  it("250 klubów w trzech porcjach = 250 kart i suma 250", () => {
    const merged = mergeClubCatalogPages([
      page(0, 100, 250),
      page(100, 100, 250),
      page(200, 50, 250),
    ]);
    expect(merged.rows).toHaveLength(250);
    expect(merged.total).toBe(250);
    expect(new Set(merged.rows.map((r) => r.id)).size).toBe(250);
  });

  it("nakładające się porcje dają każdy klub RAZ", () => {
    // Porcja 2 zaczyna się od dwóch ostatnich klubów porcji 1 - tak wygląda
    // offset liczony od listy, na której początek weszły dwa kluby.
    const merged = mergeClubCatalogPages([page(0, 100, 250), page(98, 100, 250)]);
    const ids = merged.rows.map((r) => r.id);
    expect(ids).toHaveLength(198);
    expect(new Set(ids).size).toBe(198);
    expect(ids.filter((id) => id === "club-98")).toHaveLength(1);
    expect(ids.filter((id) => id === "club-99")).toHaveLength(1);
  });

  it("duplikat zostaje na PIERWSZYM miejscu - doładowanie nie przestawia kart nad przyciskiem", () => {
    const merged = mergeClubCatalogPages([
      { rows: [{ id: "a" }, { id: "b" }], total: 4 },
      { rows: [{ id: "b" }, { id: "c" }], total: 4 },
    ]);
    expect(merged.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("wygrywa WIERSZ z pierwszego wystąpienia, nie z późniejszej porcji", () => {
    const first = { id: "a", n: 1 };
    const later = { id: "a", n: 2 };
    const merged = mergeClubCatalogPages([
      { rows: [first], total: 2 },
      { rows: [later], total: 2 },
    ]);
    expect(merged.rows).toEqual([first]);
  });

  it("suma pochodzi z NAJŚWIEŻSZEJ porcji", () => {
    expect(mergeClubCatalogPages([page(0, 100, 260), page(100, 100, 255)]).total).toBe(255);
  });

  it("pusta ostatnia porcja: wszystko jest na ekranie, suma = liczba kart", () => {
    // `fetchClubList` oddaje `total: 0` dla pustej odpowiedzi - wzięte
    // wprost dałoby „100 z 0".
    const merged = mergeClubCatalogPages([page(0, 100, 150), { rows: [], total: 0 }]);
    expect(merged.total).toBe(100);
  });

  it("suma nigdy nie jest mniejsza niż liczba kart", () => {
    // Kluby zarchiwizowane po wczytaniu porcji 1: okno porcji 2 mówi 120,
    // a na ekranie jest ich już 150.
    expect(mergeClubCatalogPages([page(0, 100, 250), page(100, 50, 120)]).total).toBe(150);
  });

  it("brak porcji to pusty katalog", () => {
    expect(mergeClubCatalogPages([])).toEqual({ rows: [], total: 0 });
  });

  it("działa na wierszach `club_list` bez rzutowań", () => {
    const merged = mergeClubCatalogPages([
      { rows: [clubListRow({ id: "x", total_count: 2 })], total: 2 },
      { rows: [clubListRow({ id: "x", total_count: 2 }), clubListRow({ id: "y" })], total: 2 },
    ]);
    // Typ wiersza przechodzi bez zmian - trasa czyta dalej `ClubListRow`.
    expect(merged.rows.map((r) => [r.id, r.slug])).toEqual([
      ["x", "klub-energetyczny"],
      ["y", "klub-energetyczny"],
    ]);
  });
});
