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
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie odtwarza `resolveClubHubAccess`
// (`hubAccess.test.ts`), rankingu dopasowania nazw (`clubMatch.test.ts`) ani
// etykiet obszarów (`topics.test.ts`). Nie sprawdza też, czy RPC `club_list`
// odsiewa wiersze po widoczności - to autorytet bazy z pokryciem pgTAP,
// a te funkcje dostają wiersze JUŻ odsiane.
import { describe, expect, it } from "vitest";
import {
  CLUB_SEARCH_MIN_CHARS,
  clubHubBuckets,
  clubHubStats,
  hasMoreClubs,
  isClubSearchActive,
  isMyClub,
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
