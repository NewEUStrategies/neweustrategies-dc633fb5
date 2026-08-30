// ODMOWY BAZY MODULU „GRUPY I ZGODY" -> ZDANIE, KTORE ORGANIZATOR ZROZUMIE.
//
// PO CO TEN PLIK ISTNIEJE. `adminTermsErrors.ts` jest JEDYNYM tlumaczem miedzy
// `RAISE EXCEPTION` w plpgsql a napisem na ekranie autoryzacji - i az do teraz
// nie mial ani jednego wlasnego testu. Panele go ATRAPUJA (kazdy z szesciu
// plikow panelowych podmienia `adminTermsErrorMessage` na `odmowa:<tresc>`),
// bramka `eventErrorMapsI18n.gate` sprawdza wylacznie, czy klucz ma tekst w obu
// jezykach - a SAMEJ MECHANIKI (co jest glowa, co ogonem, kiedy spadamy do
// `unknown`) nie mierzyl nikt. Wynik pomiaru: 0% linii.
//
// DLACZEGO TO JEST PLIK AUTORYZACJI, A NIE „ladnych komunikatow". Odmowa
// `forbidden` to jedyna rzecz, ktora widzi czlowiek odbity od ekranu. Jesli
// spadnie do `unknown`, redaktor przeczyta „Nie udalo sie wykonac operacji.
// Sprobuj ponownie." i BEDZIE PROBOWAL PONOWNIE - a to nie jest awaria, tylko
// decyzja o dostepie, ktora sie nie zmieni. Dlatego kazdy przypadek stoi tu
// PARAMI: kod, ktory ma byc nazwany, obok ksztaltu, ktory ma byc odrzucony.
//
// KODY BIERZEMY Z MIGRACJI, NIE Z GLOWY:
//   `20260824091615` - grupy i zgody: `not_found`, `invalid_request`,
//   `invalid_names`, `invalid_labels`, `invalid_key`, `group_system`,
//   `group_in_use`, `term_in_use`;
//   `assert_event_admin_tenant()` - `forbidden: admin role required`
//   (`runtime_test.d/80_admin_only.sql` dowodzi, ze redaktor dostaje wlasnie ta
//   odmowe, a administrator przechodzi).
//
// CZEGO TEN PLIK NIE DUBLUJE. (1) Bramki „kazdy kod z migracji ma klucz w obu
// jezykach" - to `eventErrorMapsI18n.gate.test.ts`. (2) Parytetu PL/EN calej
// nakladki - to `i18nParity`. Tutaj mierzymy ZACHOWANIE mappera.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import { adminTermsErrorMessage, adminTermsFailure } from "@/lib/events/adminTermsErrors";
import { adminEventTermsEn, adminEventTermsPl } from "@/lib/i18n-admin-event-terms";

const PREFIX = "adminEventTerms.errors.";
const UNKNOWN = `${PREFIX}unknown`;

/** Ksztalt, w ktorym odmowa przychodzi z `supabase-js` (nie jest `Error`). */
interface OdmowaPostgrest {
  message: string;
  code: string;
  details: string | null;
  hint: string | null;
}

function postgrest(message: string): OdmowaPostgrest {
  return { message, code: "P0001", details: null, hint: null };
}

/* --------------------------------------------------------------- role --- */

describe("para rol: kto moze wejsc na ekran i kto nie moze", () => {
  // TA SAMA PARA, CO W `80_admin_only.sql`: redaktor odbija sie od oslony
  // (`assert_editor_tenant` deleguje do `assert_event_admin_tenant`), a
  // administrator przechodzi. Mapper widzi wylacznie polowe redaktorska - i ta
  // polowa MUSI dojsc nazwana, bo inaczej ekran doradza „sprobuj ponownie"
  // komus, kogo dostep sie nie zmieni.
  it("redaktor: `forbidden: admin role required` ma wlasny klucz, nie `unknown`", () => {
    const failure = adminTermsFailure(new Error("forbidden: admin role required"));
    expect(failure.key).toBe(`${PREFIX}forbidden`);
    expect(failure.key).not.toBe(UNKNOWN);
    expect(i18n.exists(failure.key)).toBe(true);
  });

  it("administrator: udana operacja nie przechodzi przez mapper ODMOW", () => {
    // Druga polowa pary. Administrator nie dostaje odmowy - a mapper wolany na
    // pustce (brak bledu) nie ma prawa wyprodukowac zdania o dostepie.
    const failure = adminTermsFailure(null);
    expect(failure.key).toBe(UNKNOWN);
    expect(failure.key).not.toBe(`${PREFIX}forbidden`);
  });

  // Nazwana odmowa roli i nazwana odmowa DANYCH to dwa rozne zdania. Gdyby
  // spadly do jednego klucza, organizator nie odroznilby „nie masz prawa" od
  // „tego wiersza nie ma w tym najemcy".
  it("odmowa roli i odmowa istnienia wiersza NIE spadaja do wspolnego klucza", () => {
    const rola = adminTermsFailure(new Error("forbidden: admin role required"));
    const brak = adminTermsFailure(new Error("not_found: group does not exist in this tenant"));
    expect(rola.key).toBe(`${PREFIX}forbidden`);
    expect(brak.key).toBe(`${PREFIX}notFound`);
    expect(rola.key).not.toBe(brak.key);
  });

  it("brak zalogowania (`forbidden: authentication required`) tez jest nazwany", () => {
    expect(adminTermsFailure(new Error("forbidden: authentication required")).key).toBe(
      `${PREFIX}forbidden`,
    );
  });

  it("odmowa bez dwukropka (`forbidden`) dziala tak samo jak z ogonem", () => {
    const failure = adminTermsFailure(new Error("forbidden"));
    expect(failure.key).toBe(`${PREFIX}forbidden`);
    expect(failure.params).toEqual({});
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (`it.fails`).
  //
  // Zdanie pod kluczem `forbidden` obiecuje redaktorowi dostep: PL „Ten ekran
  // jest dostepny wylacznie dla redakcji i administracji.", EN „…available to
  // editors and administrators only.". Modul jest ADMIN-ONLY od migracji
  // `20260824090000` i `20260825170000`, co `runtime_test.d/80_admin_only.sql`
  // sprawdza dwiema asercjami wykonawczymi: redaktor dostaje `admin role
  // required` z `assert_editor_tenant` I z `assert_event_admin_tenant`.
  // Redaktor czyta wiec po odmowie, ze ekran jest dla niego - i idzie szukac
  // awarii tam, gdzie jej nie ma. Poprawka nalezy do produkcji: tekst w obu
  // nakladkach ma nazwac administracje, a nie redakcje.
  it.fails("zdanie odmowy NIE obiecuje redaktorowi dostepu do ekranu", () => {
    expect(adminTermsFailure(new Error("forbidden: admin role required")).key).toBe(
      `${PREFIX}forbidden`,
    );
    expect(adminEventTermsPl.adminEventTerms.errors.forbidden).not.toMatch(/redakcj/i);
    expect(adminEventTermsEn.adminEventTerms.errors.forbidden).not.toMatch(/editor/i);
  });
});

/* ---------------------------------------------------- glowa komunikatu --- */

describe("glowa komunikatu rozstrzyga klucz", () => {
  const PARY: ReadonlyArray<readonly [string, string]> = [
    ["not_found: group does not exist in this tenant", `${PREFIX}notFound`],
    ["invalid_request: event_id is required", `${PREFIX}invalidRequest`],
    ["invalid_names: the name is required in both languages", `${PREFIX}invalidNames`],
    ["invalid_labels: the label is required in both languages", `${PREFIX}invalidLabels`],
    ["invalid_key: key must match ^[a-z][a-z0-9_]{1,48}$", `${PREFIX}invalidKey`],
    ["group_system: system groups cannot be deleted", `${PREFIX}groupSystem`],
    ["group_in_use: 3 registration(s) use this group", `${PREFIX}groupInUse`],
    ["term_in_use: 12 acceptance(s) recorded - deactivate instead", `${PREFIX}termInUse`],
  ];

  it.each(PARY)("`%s` -> `%s`", (message, key) => {
    const failure = adminTermsFailure(new Error(message));
    expect(failure.key).toBe(key);
    expect(failure.key).not.toBe(UNKNOWN);
    expect(i18n.exists(failure.key)).toBe(true);
  });

  it("podkreslenia z SQL-a zamieniaja sie na wielblada, a nie znikaja", () => {
    expect(adminTermsFailure(new Error("group_in_use: 1")).key).toBe(`${PREFIX}groupInUse`);
    expect(adminTermsFailure(new Error("groupinuse: 1")).key).toBe(UNKNOWN);
  });

  it("biale znaki wokol glowy nie psuja rozpoznania", () => {
    expect(adminTermsFailure(new Error("  term_in_use  : 2 acceptance(s)")).key).toBe(
      `${PREFIX}termInUse`,
    );
  });

  it("cyfra w glowie jest dopuszczona (`invalid_h1`-podobne kody z SQL-a)", () => {
    // Wzorzec glowy to `^[a-z][a-z0-9_]*$` - pierwszy znak litera, dalej moga
    // byc cyfry. Kod, ktorego nie ma w slowniku, i tak spada do `unknown`, ale
    // spada Z POWODU SLOWNIKA, a nie z powodu ksztaltu.
    expect(adminTermsFailure(new Error("group2_in_use: 1")).key).toBe(UNKNOWN);
  });
});

/* ----------------------------------------------------- ogon komunikatu --- */

describe("ogon komunikatu wchodzi do interpolacji", () => {
  it("pierwsza liczba z ogona jest liczba `count`", () => {
    expect(
      adminTermsFailure(
        new Error("group_in_use: 3 registration(s), ticket(s) or membership(s) use this group"),
      ).params,
    ).toEqual({ count: 3 });
  });

  it("druga liczba z ogona jest liczba `total`", () => {
    expect(adminTermsFailure(new Error("term_in_use: 7 z 41 acceptance(s)")).params).toEqual({
      count: 7,
      total: 41,
    });
  });

  it("ogon bez liczb daje puste parametry, a nie `NaN`", () => {
    expect(
      adminTermsFailure(new Error("group_system: system groups cannot be deleted")).params,
    ).toEqual({});
  });

  it("trzecia i dalsze liczby sa ignorowane - slownik ma dwa miejsca", () => {
    expect(adminTermsFailure(new Error("group_in_use: 1 2 3 4")).params).toEqual({
      count: 1,
      total: 2,
    });
  });

  // KWIRK UDOKUMENTOWANY, NIE DEFEKT. Ogon `invalid_key` niesie sam wzorzec
  // (`^[a-z][a-z0-9_]{1,48}$`), wiec czytnik liczb wyciaga z niego 1 i 48.
  // Zdanie pod `invalidKey` nie ma interpolacji, wiec liczby nigdzie nie ida -
  // ale gdyby ktos je kiedys dopisal do slownika, przeczytalby „1 z 48".
  it("liczby z ogona `invalid_key` sa zbierane, choc slownik ich nie uzywa", () => {
    const failure = adminTermsFailure(new Error("invalid_key: key must match ^[a-z]{1,48}$"));
    expect(failure.key).toBe(`${PREFIX}invalidKey`);
    expect(failure.params).toEqual({ count: 1, total: 48 });
    expect(
      adminTermsErrorMessage(new Error("invalid_key: key must match ^[a-z]{1,48}$")),
    ).not.toContain("48");
  });
});

/* ----------------------------------------------- ksztalty, ktore odpadaja --- */

describe("nieznany kod NIE udaje znanego", () => {
  it("SQLSTATE z tresc sterownika spada do `unknown`", () => {
    expect(adminTermsFailure(new Error("23514: violates check constraint")).key).toBe(UNKNOWN);
  });

  it("szum sieciowy spada do `unknown`", () => {
    expect(adminTermsFailure("Failed to fetch").key).toBe(UNKNOWN);
    expect(adminTermsFailure(new Error("TypeError: NetworkError when attempting")).key).toBe(
      UNKNOWN,
    );
  });

  it("kod o poprawnym ksztalcie, ale spoza slownika, spada do `unknown`", () => {
    expect(adminTermsFailure(new Error("quota_exceeded: 5 seats")).key).toBe(UNKNOWN);
  });

  it("pustka w kazdej postaci spada do `unknown`", () => {
    expect(adminTermsFailure(null).key).toBe(UNKNOWN);
    expect(adminTermsFailure(undefined).key).toBe(UNKNOWN);
    expect(adminTermsFailure("").key).toBe(UNKNOWN);
    expect(adminTermsFailure(new Error("")).key).toBe(UNKNOWN);
  });

  it("wartosci nietekstowe i obiekty bez `message` spadaja do `unknown`", () => {
    expect(adminTermsFailure(0).key).toBe(UNKNOWN);
    expect(adminTermsFailure({ code: "P0001" }).key).toBe(UNKNOWN);
    expect(adminTermsFailure([]).key).toBe(UNKNOWN);
  });

  it("`unknown` zawsze ma puste parametry, nawet gdy w tresci byly liczby", () => {
    expect(adminTermsFailure(new Error("23514: 7 rows, 41 columns")).params).toEqual({});
  });
});

describe("ksztalt odmowy: `Error`, napis i obiekt `supabase-js`", () => {
  it("odmowa jako goly napis jest czytana tak samo jak `Error`", () => {
    expect(adminTermsFailure("group_in_use: 4 registration(s)")).toEqual(
      adminTermsFailure(new Error("group_in_use: 4 registration(s)")),
    );
  });

  it("odmowa `PostgrestError` (obiekt z `message`) jest czytana tak samo", () => {
    expect(adminTermsFailure(postgrest("term_in_use: 9 acceptance(s)"))).toEqual({
      key: `${PREFIX}termInUse`,
      params: { count: 9 },
    });
  });

  it("obiekt z nietekstowym `message` nie wywraca mappera", () => {
    expect(adminTermsFailure({ message: 500 }).key).toBe(UNKNOWN);
  });
});

/* -------------------------------------------------- gotowe zdanie toasta --- */

describe("`adminTermsErrorMessage` oddaje zdanie, nie klucz", () => {
  it("znany kod daje napis rozny od klucza", () => {
    const zdanie = adminTermsErrorMessage(new Error("group_system: system groups cannot"));
    expect(zdanie).not.toBe(`${PREFIX}groupSystem`);
    expect(zdanie.trim().length).toBeGreaterThan(0);
  });

  it("liczba z ogona wchodzi do zdania - organizator widzi, ILU uzyc broni grupy", () => {
    expect(adminTermsErrorMessage(new Error("group_in_use: 6 registration(s)"))).toContain("6");
  });

  it("liczba akceptacji wchodzi do zdania o zgodzie", () => {
    expect(adminTermsErrorMessage(new Error("term_in_use: 52 acceptance(s)"))).toContain("52");
  });

  it("nieznany kod NIE dociera do organizatora w postaci surowej", () => {
    const zdanie = adminTermsErrorMessage(new Error("23514: violates check constraint"));
    expect(zdanie).not.toContain("23514");
    expect(zdanie).not.toContain("check constraint");
    expect(zdanie).not.toBe(UNKNOWN);
  });
});
