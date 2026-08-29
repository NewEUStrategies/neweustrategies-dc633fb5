// PIĘĆ MAP ODMÓW BAZY -> ZDANIE DLA CZŁOWIEKA. Jeden plik, bo to PIĘĆ KOPII
// tego samego kodu (rejestracje, grupy i zgody, on-site, powierzchnia
// uczestnika, studio wydarzenia) i kontrakt mają wspólny: głowa komunikatu
// plpgsql -> klucz i18n, wszystko inne -> zdanie awaryjne.
//
// DLACZEGO TEN PLIK ISTNIEJE. Mapa odmów jest OSTATNIM elementem przed ekranem:
// dostaje to, co rzuci `supabase-js`, i nie ma prawa ani rzucić, ani przepuścić
// dalej surowego tekstu z bazy. Tekst Postgresa niesie NAZWY TABEL, NAZWY
// OGRANICZEŃ i WARTOŚCI KLUCZY - pokazanie go w toaście to wyciek schematu do
// interfejsu, a dla organizatora i tak zdanie bez następnego kroku.
//
// Testy tablicowe, bo różnica między pięcioma modułami to WYŁĄCZNIE namespace.
// Gdyby któraś kopia zaczęła zachowywać się inaczej (np. przestała przycinać
// spacje albo zaczęła brać za klucz „Failed"), rozjazd wyjdzie tutaj, a nie na
// ekranie jednego z pięciu paneli.
import { describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  adminRegistrationErrorMessage,
  adminRegistrationFailure,
} from "@/lib/events/adminRegistrationErrors";
import { adminTermsErrorMessage, adminTermsFailure } from "@/lib/events/adminTermsErrors";
import { adminOnsiteErrorMessage, adminOnsiteFailure } from "@/lib/events/adminOnsiteErrors";
import { publicEventErrorKey, publicEventErrorMessage } from "@/lib/events/publicEventErrors";
import {
  adminEventStudioErrorKey,
  adminEventStudioErrorMessage,
} from "@/lib/events/adminEventStudioErrors";

interface MapaOdmow {
  /** Nazwa modułu - trafia do nazwy przypadku, żeby czerwień wskazywała plik. */
  nazwa: string;
  /** Przedrostek namespace'u; `${prefix}unknown` to zdanie awaryjne modułu. */
  prefix: string;
  klucz: (error: unknown) => string;
  zdanie: (error: unknown) => string;
  /** Kod z migracji, który ten moduł MUSI rozpoznawać. */
  znanyKod: string;
  /** Klucz, na który `znanyKod` się mapuje (snake_case -> camelCase). */
  znanyKlucz: string;
  /**
   * NAJDŁUŻSZY kod modułu - co najmniej DWA podkreślenia. `camel()` zamienia
   * WSZYSTKIE podkreślenia, a nie pierwsze; kod dwuczłonowy tej różnicy nie
   * pokaże, bo przy obu implementacjach wychodzi ten sam klucz.
   */
  wieloczlonowyKod: string;
  wieloczlonowyKlucz: string;
}

const MAPY: readonly MapaOdmow[] = [
  {
    nazwa: "adminRegistrationErrors",
    prefix: "adminEventRegistration.errors.",
    klucz: (error) => adminRegistrationFailure(error).key,
    zdanie: adminRegistrationErrorMessage,
    znanyKod: "quota_below_sold",
    znanyKlucz: "adminEventRegistration.errors.quotaBelowSold",
    wieloczlonowyKod: "invalid_price_schedule",
    wieloczlonowyKlucz: "adminEventRegistration.errors.invalidPriceSchedule",
  },
  {
    nazwa: "adminTermsErrors",
    prefix: "adminEventTerms.errors.",
    klucz: (error) => adminTermsFailure(error).key,
    zdanie: adminTermsErrorMessage,
    znanyKod: "group_in_use",
    znanyKlucz: "adminEventTerms.errors.groupInUse",
    wieloczlonowyKod: "term_in_use",
    wieloczlonowyKlucz: "adminEventTerms.errors.termInUse",
  },
  {
    nazwa: "adminOnsiteErrors",
    prefix: "adminEventOnsite.errors.",
    klucz: (error) => adminOnsiteFailure(error).key,
    zdanie: adminOnsiteErrorMessage,
    znanyKod: "checkpoint_in_use",
    znanyKlucz: "adminEventOnsite.errors.checkpointInUse",
    wieloczlonowyKod: "invalid_element_font_size",
    wieloczlonowyKlucz: "adminEventOnsite.errors.invalidElementFontSize",
  },
  {
    nazwa: "publicEventErrors",
    prefix: "eventFront.errors.",
    klucz: publicEventErrorKey,
    zdanie: publicEventErrorMessage,
    znanyKod: "overlap_conflict",
    znanyKlucz: "eventFront.errors.overlapConflict",
    wieloczlonowyKod: "requester_not_participating",
    wieloczlonowyKlucz: "eventFront.errors.requesterNotParticipating",
  },
  {
    nazwa: "adminEventStudioErrors",
    prefix: "adminEvents.studio.errors.",
    klucz: adminEventStudioErrorKey,
    zdanie: adminEventStudioErrorMessage,
    znanyKod: "slug_taken",
    znanyKlucz: "adminEvents.studio.errors.slugTaken",
    wieloczlonowyKod: "invalid_registration_flow",
    wieloczlonowyKlucz: "adminEvents.studio.errors.invalidRegistrationFlow",
  },
];

/**
 * WEJŚCIA ZDEGENEROWANE. Każde z nich realnie dociera do mapy: `supabase-js`
 * oddaje `PostgrestError` (obiekt z `message`), warstwa sieciowa `TypeError`,
 * `onError` TanStack Query bywa wołane z `null`, a kod odczytujący `error.code`
 * zdarza się przekazać sam obiekt bez `message`. Żadne z nich nie ma prawa
 * rzucić - wyjątek w mapperze zamienia toast w białą stronę.
 */
const ZDEGENEROWANE: readonly { opis: string; wejscie: unknown }[] = [
  { opis: "null", wejscie: null },
  { opis: "undefined", wejscie: undefined },
  { opis: "pusty obiekt", wejscie: {} },
  { opis: "obiekt bez pola message (samo `code`)", wejscie: { code: "23505" } },
  { opis: "obiekt z message === null", wejscie: { message: null } },
  { opis: "obiekt z message będącym obiektem", wejscie: { message: { detail: "x" } } },
  // `String(42501)` daje głowę z samych cyfr - kształt, który przechodzi przez
  // `messageOf()` bez rzucenia, a mimo to nie jest kluczem. Tak wygląda obiekt
  // odpowiedzi, w którym warstwa serwerowa wstawiła do `message` sam SQLSTATE.
  { opis: "obiekt z message będącym liczbą", wejscie: { message: 42501 } },
  { opis: "pusty łańcuch", wejscie: "" },
  { opis: "łańcuch zamiast obiektu (SQLSTATE)", wejscie: "42501" },
  { opis: "łańcuch zamiast obiektu (szum sieciowy)", wejscie: "Failed to fetch" },
  { opis: "liczba", wejscie: 42 },
  { opis: "tablica", wejscie: [] },
  { opis: "Error z pustym komunikatem", wejscie: new Error("") },
];

describe.each(MAPY)("$nazwa", (mapa) => {
  const awaryjny = `${mapa.prefix}unknown`;

  it("rozpoznaje kod z głowy komunikatu i oddaje własne zdanie tego kodu", () => {
    // Bez tego przypadku cała mapa mogłaby zwracać `unknown` i nadal być
    // „zielona" w każdym teście negatywnym - a organizator nigdy nie zobaczyłby
    // powodu odmowy. Porównanie z tekstem awaryjnym jest tu istotne: klucz
    // wskazujący na to samo zdanie co `unknown` byłby rozpoznaniem na papierze.
    const klucz = mapa.klucz(new Error(`${mapa.znanyKod}: detail from postgres`));
    expect(klucz).toBe(mapa.znanyKlucz);
    expect(i18n.t(klucz)).not.toBe(i18n.t(awaryjny));
  });

  it("czyta komunikat z Errora, z gołego łańcucha i z obiektu PostgrestError", () => {
    // Trzy kanały, którymi ten sam błąd dociera z `supabase-js`: rzucony Error,
    // przekazany tekst i obiekt odpowiedzi. Rozjazd między nimi znaczy, że
    // powód odmowy widać w jednym panelu, a w drugim nie.
    const oczekiwany = mapa.znanyKlucz;
    expect(mapa.klucz(new Error(`${mapa.znanyKod}: x`))).toBe(oczekiwany);
    expect(mapa.klucz(`${mapa.znanyKod}: x`)).toBe(oczekiwany);
    expect(mapa.klucz({ message: `${mapa.znanyKod}: x`, code: "P0001" })).toBe(oczekiwany);
  });

  it("bierze klucz także z komunikatu bez dwukropka i przycina spacje", () => {
    // plpgsql podnosi część wyjątków bez ogona (`RAISE EXCEPTION 'not_found'`),
    // a warstwy pośrednie potrafią dokleić spację. Bez obu ścieżek te odmowy
    // spadałyby do zdania awaryjnego mimo poprawnego kontraktu bazy.
    expect(mapa.klucz(mapa.znanyKod)).toBe(mapa.znanyKlucz);
    expect(mapa.klucz(`   ${mapa.znanyKod}   : ogon`)).toBe(mapa.znanyKlucz);
    // Trzeci kształt jest osobnym torem w kodzie: BEZ dwukropka głową jest CAŁY
    // komunikat, więc przycięcie musi stać za `?:`, a nie w gałęzi z ogonem.
    // Implementacja przycinająca tylko po rozcięciu przeszłaby dwa poprzednie
    // wiersze i wywróciła się dopiero tutaj - a `\n` i `\t` doklejają realnie
    // warstwy logujące i `JSON.stringify` po drodze z serwera.
    expect(mapa.klucz(`\n\t${mapa.znanyKod}\n`)).toBe(mapa.znanyKlucz);
  });

  it("głowę odcina PIERWSZY dwukropek, dalsze zostają w ogonie", () => {
    // Ogon komunikatu Postgresa bywa sam w sobie zdaniem z dwukropkiem
    // („detail: Key (id)=(7)"), a ogon `overlap_conflict` to tytuł cudzej sesji,
    // w którym dwukropek stoi normalnie. Gdyby mapa cięła po OSTATNIM
    // dwukropku, kluczem stałby się cały tekst odmowy - czyli zawsze zdanie
    // awaryjne, i to bez żadnego śladu w pozostałych przypadkach.
    expect(mapa.klucz(`${mapa.znanyKod}: detail: Key (id)=(7) is not present`)).toBe(
      mapa.znanyKlucz,
    );
  });

  it("sam dwukropek na początku nie daje pustego klucza", () => {
    // Pusta głowa nie przechodzi warunku kształtu (`^[a-z]` wymaga litery).
    // Bez tego warunku mapa pytałaby słownik o SAM PRZEDROSTEK
    // (`adminEvent….errors.`) i przy twierdzącej odpowiedzi oddałaby go jako
    // klucz odmowy - czyli kropkowaną ścieżkę w miejscu zdania. Komunikat
    // zaczynający się od dwukropka nie jest wymysłem: tak wygląda odmowa
    // sklejona z pustego kodu w warstwie pośredniej.
    expect(mapa.klucz(`: ${mapa.znanyKod}`)).toBe(awaryjny);
  });

  it("kod wieloczłonowy zamienia się na camelCase w CAŁOŚCI", () => {
    // `camel()` chodzi po WSZYSTKICH podkreśleniach (`replace` z flagą `g`).
    // Zamiana tylko pierwszego dałaby `invalidElement_font_size` - klucz,
    // którego w nakładce nie ma, więc ekran pokazałby zdanie awaryjne przy
    // poprawnym kontrakcie bazy. Kody dwuczłonowe tej pomyłki nie widzą.
    expect(mapa.klucz(new Error(`${mapa.wieloczlonowyKod}: detail`))).toBe(mapa.wieloczlonowyKlucz);
  });

  it("czyta kod z podklasy Errora, nie tylko z gołego `new Error`", () => {
    // `supabase-js` i warstwa serwerowa opakowują odmowy WŁASNYMI klasami
    // (`FunctionsHttpError`, `StorageError`). Gdyby `messageOf()` sprawdzało
    // `error.constructor === Error` albo `Object.getPrototypeOf(error) ===
    // Error.prototype` zamiast `instanceof`, cały panel pokazywałby zdanie
    // awaryjne mimo poprawnego kontraktu bazy - i żaden przypadek na gołym
    // `new Error` by tego nie zobaczył.
    class BladOdpowiedzi extends Error {}
    expect(mapa.klucz(new BladOdpowiedzi(`${mapa.znanyKod}: detail`))).toBe(mapa.znanyKlucz);
  });

  it("kod spoza słownika nie udaje znanego błędu", () => {
    // Nowy `RAISE EXCEPTION` w migracji bez wpisu w nakładce MUSI degradować do
    // zdania awaryjnego. Gdyby mapper oddawał klucz bez sprawdzenia słownika,
    // ekran pokazałby surową ścieżkę `adminEvent….errors.brandNewRule`.
    expect(mapa.klucz(new Error("brand_new_rule_from_next_migration: whatever"))).toBe(awaryjny);
  });

  it("zdanie z bazy nie jest brane za klucz", () => {
    // „Failed to fetch" ma głowę „Failed" (bez dwukropka - całość), a komunikat
    // Postgresa o naruszeniu ograniczenia ma spacje. Bez warunku na kształt
    // klucza mapper zrobiłby z nich etykietę błędu.
    expect(mapa.klucz(new Error("Failed to fetch"))).toBe(awaryjny);
    expect(mapa.klucz(new Error("ERROR: coś poszło nie tak"))).toBe(awaryjny);
    expect(mapa.klucz(new Error('duplicate key value violates unique constraint "x_pkey"'))).toBe(
      awaryjny,
    );
  });

  it("kod pisany wielkimi literami nie przechodzi jako klucz", () => {
    // Kontrakt bazy jest snake_case małymi literami. Gdyby regexp był
    // niewrażliwy na wielkość liter, `camel()` wyprodukowałby klucz, którego
    // w słowniku nie ma - czyli surową ścieżkę na ekranie.
    expect(mapa.klucz(new Error(`${mapa.znanyKod.toUpperCase()}: x`))).toBe(awaryjny);
    // Druga forma pilnuje SAMEJ KOTWICY `^[a-z]`, a nie tylko reszty wzorca.
    // „Quota_below_sold" ma dalszą część zapisaną poprawnie, więc wpuściłby ją
    // każdy wariant dopuszczający wielką literę na starcie - i gdyby `camel()`
    // dodatkowo obniżało pierwszy znak, mapa ROZPOZNAŁABY ten kod jako znany.
    // Wersja WIELKIMI literami tej pomyłki nie widzi (rozjeżdża się na dalszych
    // znakach), więc bez tego wiersza dziura zostaje niezauważona.
    const zWielkaLitera = mapa.znanyKod.charAt(0).toUpperCase() + mapa.znanyKod.slice(1);
    expect(mapa.klucz(new Error(`${zWielkaLitera}: x`))).toBe(awaryjny);
  });

  it("SQLSTATE z ogonem, głowa z myślnikiem i głowa ze spacją idą do zdania awaryjnego", () => {
    // Trzy kształty, które realnie dojeżdżają do mapy, a NIE są kluczem:
    // kod stanu z PostgREST wraz z opisem, identyfikator pisany myślnikiem
    // (tak wygląda nagłówek warstwy sieciowej) i zdanie z bazy zaczynające się
    // małą literą. Wszystkie trzy przechodzą przez rozcięcie na dwukropku, więc
    // to WYŁĄCZNIE warunek kształtu je zatrzymuje - „42501" bez ogona (jest
    // w zdegenerowanych) tego nie sprawdza, bo tam głowa jest całym tekstem.
    expect(mapa.klucz("42501: permission denied for table events")).toBe(awaryjny);
    expect(mapa.klucz("invalid-key: x")).toBe(awaryjny);
    expect(mapa.klucz("invalid key: x")).toBe(awaryjny);
  });

  it.each(ZDEGENEROWANE)("wejście zdegenerowane: $opis oddaje zdanie awaryjne", ({ wejscie }) => {
    // Mapa jest ostatnią linią przed ekranem - rzucony wyjątek zabiera cały
    // widok, a `undefined` w toaście nie mówi nic.
    expect(mapa.klucz(wejscie)).toBe(awaryjny);
    const zdanie = mapa.zdanie(wejscie);
    expect(zdanie).not.toContain(mapa.prefix);
    expect(zdanie.length).toBeGreaterThan(3);
  });

  it("zdanie awaryjne jest napisem po ludzku, nie kluczem ani kodem SQLSTATE", () => {
    // `i18n.t()` na nieistniejącym kluczu oddaje SAM KLUCZ - więc brak wpisu
    // `…errors.unknown` byłby widoczny dopiero na ekranie użytkownika.
    const zdanie = mapa.zdanie(new Error("23514: violates check constraint"));
    expect(zdanie).not.toContain(mapa.prefix);
    expect(zdanie).not.toContain("23514");
    expect(zdanie).not.toContain("constraint");
    expect(zdanie.length).toBeGreaterThan(10);
  });

  it("surowy tekst Postgresa nie wycieka do interfejsu", () => {
    // Komunikat bazy niesie nazwę tabeli, nazwę ograniczenia i WARTOŚCI klucza.
    // To jest wyciek schematu i danych - dlatego sprawdzamy nie tylko „czy
    // ładne zdanie", ale wprost: czy tych fragmentów w zdaniu nie ma.
    const surowy = new Error(
      'insert or update on table "event_registrations" violates foreign key ' +
        'constraint "event_registrations_ticket_id_fkey", Key (ticket_id)=(9f1c) is not present',
    );
    const zdanie = mapa.zdanie(surowy);
    expect(zdanie).not.toContain("event_registrations");
    expect(zdanie).not.toContain("ticket_id");
    expect(zdanie).not.toContain("9f1c");
  });

  it("oddaje przetłumaczone zdanie dla znanego kodu, nie ścieżkę i18n", () => {
    const zdanie = mapa.zdanie(new Error(`${mapa.znanyKod}: 7 rekordów`));
    expect(zdanie).not.toContain(mapa.prefix);
    expect(zdanie.length).toBeGreaterThan(10);
  });

  it("tekst ogona nie wchodzi do zdania nawet przy ROZPOZNANYM kodzie", () => {
    // Poprzednie przypadki pilnują ogona przy kodzie NIEZNANYM - tam zdanie
    // awaryjne i tak nie ma czego wstawić. Tutaj kod jest rozpoznany, więc mapa
    // ma już klucz i parametry: to jedyny moment, w którym mogłaby dokleić do
    // zdania surowy tekst z bazy. A ogon niesie dane, które nie mają prawa
    // trafić na ekran - adres cudzego wydarzenia (`slug_taken`), tytuł cudzej
    // sesji (`overlap_conflict`), wartość z formularza (`invalid_*`) - i zawsze
    // w JEDNYM języku, więc w polskim zdaniu wyglądałby jak awaria tłumaczenia.
    const zdanie = mapa.zdanie(new Error(`${mapa.znanyKod}: 12 sekret-z-bazy-forum-2027`));
    expect(zdanie).not.toContain("sekret-z-bazy");
    expect(zdanie).not.toContain(mapa.prefix);
    // Domknięcie od drugiej strony: skoro liczba z ogona JEST dostępna, żadne
    // miejsce interpolacji nie ma prawa zostać niewypełnione.
    expect(zdanie).not.toContain("{{");
  });
});

// ---------------------------------------------------------------------------
// PARAMETRY INTERPOLACJI - tylko trzy mapy panelu organizatora.
//
// plpgsql nie ma innego kanału na parametry wyjątku niż tekst komunikatu, więc
// liczby jadą w ogonie. Zdanie „Pula nie może być mniejsza od liczby zajętych
// miejsc ({{count}})" bez `count` pokazuje pustą parę nawiasów albo surowe
// `{{count}}` - czyli kłamie o tym, jaki limit jest dopuszczalny.
// ---------------------------------------------------------------------------
const Z_PARAMETRAMI = [
  {
    nazwa: "adminRegistrationErrors",
    prefix: "adminEventRegistration.errors.",
    failure: (error: unknown) => adminRegistrationFailure(error),
    komunikat: "quota_below_sold: 12 seats are already taken, 40 in the pool",
  },
  {
    nazwa: "adminTermsErrors",
    prefix: "adminEventTerms.errors.",
    failure: (error: unknown) => adminTermsFailure(error),
    komunikat: "group_in_use: 12 registration(s), 40 ticket(s)",
  },
  {
    nazwa: "adminOnsiteErrors",
    prefix: "adminEventOnsite.errors.",
    failure: (error: unknown) => adminOnsiteFailure(error),
    komunikat: "checkpoint_in_use: 12 check-in(s) recorded, 40 devices",
  },
] as const;

describe.each(Z_PARAMETRAMI)("$nazwa - liczby z ogona komunikatu", (mapa) => {
  it("pierwsza liczba to `count`, druga to `total`", () => {
    expect(mapa.failure(new Error(mapa.komunikat)).params).toEqual({ count: 12, total: 40 });
  });

  it("liczba z ogona wchodzi do przetłumaczonego zdania", () => {
    // Sam `params` nie dowodzi niczego, dopóki nie widać liczby w zdaniu -
    // klucz bez `{{count}}` przepuściłby poprzedni przypadek.
    const failure = mapa.failure(new Error(mapa.komunikat));
    const zdanie = i18n.t(failure.key, failure.params);
    expect(zdanie).toContain("12");
    // Odwrotna pomyłka: zdanie z miejscem, którego mapa nie umie wypełnić
    // (np. `{{total}}` przy jednej liczbie w ogonie albo literówka w nazwie
    // parametru) pokazuje organizatorowi surowe wąsy zamiast wartości.
    expect(zdanie).not.toContain("{{");
  });

  it("jedna liczba w ogonie daje sam `count`, bez `total`", () => {
    // Drugi parametr jest ZAWSZE opcjonalny: `numbers[1]` bywa `undefined`,
    // a `Number(undefined)` to NaN. Gdyby `total` był dopisywany bezwarunkowo,
    // klucz z dwoma miejscami interpolacji pokazałby na ekranie napis „NaN",
    // a `toEqual` na komplecie dwóch liczb tego nie widzi.
    expect(mapa.failure(new Error("not_found: 4 rekordy")).params).toEqual({ count: 4 });
  });

  it("liczba zero z ogona JEST wartością, nie brakiem wartości", () => {
    // Warunek w mapie to `numbers[0] !== undefined`, a nie test prawdziwości.
    // Przy `if (numbers[0])` zero wypadałoby z parametrów i zdanie „zapisano
    // {{count}} odpraw" straciłoby liczbę dokładnie w tym przypadku, w którym
    // „0" jest sensowną i potrzebną odpowiedzią.
    expect(mapa.failure("not_found: 0 wydruków, 0 sztuk").params).toEqual({ count: 0, total: 0 });
  });

  it("ogon bez liczb daje pusty zestaw parametrów, nie NaN", () => {
    // `Number(undefined)` to NaN, a NaN w interpolacji to napis „NaN" na
    // ekranie organizatora. Pusty obiekt zostawia zdanie w wersji bez liczby.
    expect(mapa.failure(new Error("not_found: nothing here")).params).toEqual({});
  });

  it("komunikat bez ogona (bez dwukropka) też nie ma parametrów", () => {
    expect(mapa.failure("not_found").params).toEqual({});
    // Dwukropek na KOŃCU to osobny tor: separator istnieje, więc ogonem jest
    // `slice(separator + 1)`, czyli pusty napis. Implementacja biorąca za ogon
    // cały komunikat przy braku ogona wciągnęłaby tu liczby z NAZWY kodu.
    expect(mapa.failure("not_found:").params).toEqual({});
  });

  it("trzecia liczba z ogona jest ignorowana", () => {
    // Słowniki mają najwyżej dwa miejsca interpolacji; przepuszczanie dalszych
    // liczb dokładałoby do zdania wartości, których nikt nie umie nazwać.
    expect(mapa.failure(new Error("not_found: 1 of 2 in 3 places")).params).toEqual({
      count: 1,
      total: 2,
    });
  });

  it("zera wiodące i liczba sklejona z tekstem są czytane jako liczby", () => {
    // Ogon jest TEKSTEM z plpgsql, nie polem: „007" i „12wejść" to formy, które
    // realnie w nim stoją (formatowanie `%s` i sklejenie z rzeczownikiem).
    // Bez `Number()` w mapie do zdania weszłoby „007", a wzorzec ze słowną
    // granicą (`\b\d+\b`) zgubiłby liczbę sklejoną z tekstem.
    expect(mapa.failure("not_found: 007 zapisów, 012 sztuk").params).toEqual({
      count: 7,
      total: 12,
    });
    expect(mapa.failure("not_found: 12wejść").params).toEqual({ count: 12 });
  });

  it("minus i kropka z ogona gubią się przy odczycie liczby (STAN OBECNY)", () => {
    // UWAGA: to jest opis stanu obecnego, nie deklaracja, że tak być powinno.
    // Wzorzec `\d+` nie zna minusa ani kropki, więc „-5" czyta się jako 5,
    // a „3.5" rozpada się na DWIE liczby (3 i 5) - druga wjeżdża w `total`.
    // Dziś ogon odmów tych trzech modułów niesie wyłącznie liczby całkowite
    // dodatnie (miejsca, zapisy, wydruki), więc organizator tego nie zobaczy.
    // Ten przypadek stoi tu po to, żeby dzień, w którym do ogona trafi kwota
    // albo różnica, skończył się CZERWIENIĄ tutaj, a nie złą liczbą w toaście.
    expect(mapa.failure("not_found: -5 miejsc").params).toEqual({ count: 5 });
    expect(mapa.failure("not_found: 3.5 kredytu").params).toEqual({ count: 3, total: 5 });
  });

  it("parametry powstają WYŁĄCZNIE dla kodu, który słownik zna", () => {
    // Kod nierozpoznany wychodzi z mapy wcześniej, literałem `{}`. Gdyby
    // parametry liczyły się przed sprawdzeniem słownika, do zdania awaryjnego -
    // które nie ma miejsc interpolacji - doklejałby się cichy śmieć, a każdy
    // `toEqual` na całym wyniku zaczerwieniłby się dopiero u kogoś innego.
    expect(mapa.failure(new Error("brand_new_rule: 12 rzeczy, 40 innych"))).toEqual({
      key: `${mapa.prefix}unknown`,
      params: {},
    });
    // Ta sama ścieżka dla wejścia zdegenerowanego: brak komunikatu to brak
    // parametrów, a nie `{ count: NaN }`.
    expect(mapa.failure(null)).toEqual({ key: `${mapa.prefix}unknown`, params: {} });
  });
});

describe("publicEventErrors - ogon komunikatu zostaje w logach", () => {
  it("tytuł cudzej sesji z komunikatu bazy nie wchodzi do zdania", () => {
    // `overlap_conflict` niesie w ogonie TYTUŁ INNEJ SESJI, wzięty z bazy w
    // jednym języku. Wstawiony do polskiego zdania wyglądałby jak awaria
    // tłumaczenia, a dla uczestnika bywa też informacją o cudzym zapisie.
    const zdanie = publicEventErrorMessage(
      new Error('overlap_conflict: you are already signed up for "Prawo klimatyczne UE"'),
    );
    expect(zdanie).not.toContain("Prawo klimatyczne UE");
    // Nie tylko tytuł: cała angielszczyzna z ogona ma zostać w logach. Zdanie
    // dla uczestnika jest pisane od zera po polsku i po angielsku.
    expect(zdanie).not.toContain("already signed up");
    expect(zdanie).not.toContain("eventFront.");
    expect(zdanie.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// MAPY BEZ PARAMETRÓW - studio wydarzenia i powierzchnia uczestnika.
//
// Te dwie kopie ŚWIADOMIE nie mają `paramsOf()`: wołają `i18n.t(klucz)` bez
// drugiego argumentu. Nie mają więc czym wypełnić `{{count}}`, a ogon ich odmów
// to nie liczby, tylko adres cudzego wydarzenia i tytuł cudzej sesji. Ta różnica
// jest kontraktem, a nie niedoróbką - i dlatego ma własny przypadek.
// ---------------------------------------------------------------------------
const BEZ_PARAMETROW = [
  {
    nazwa: "adminEventStudioErrors",
    zdanie: adminEventStudioErrorMessage,
    znanyKod: "slug_taken",
  },
  {
    nazwa: "publicEventErrors",
    zdanie: publicEventErrorMessage,
    znanyKod: "signup_disabled",
  },
] as const;

describe.each(BEZ_PARAMETROW)("$nazwa - liczby z ogona NIE wchodzą do zdania", (mapa) => {
  it("liczby z ogona nie pojawiają się w zdaniu i nie zostają puste wąsy", () => {
    // Dopisanie `{{count}}` do słownika TEJ mapy jest pomyłką niewidoczną
    // w żadnym innym miejscu: `tsc` jej nie widzi, parytet PL/EN jej nie widzi
    // (klucz istnieje w obu językach), a mapa nie ma czym tego miejsca wypełnić
    // - więc redaktor albo uczestnik zobaczyłby na ekranie surowe wąsy. Drugi
    // kierunek jest równie ważny: gdyby ktoś „dla symetrii" dołożył tu
    // `paramsOf()`, do zdania wjechałaby liczba wyrwana z ogona, który w tych
    // dwóch modułach bywa adresem albo tytułem, a nie licznikiem.
    const zdanie = mapa.zdanie(new Error(`${mapa.znanyKod}: 12 miejsc, 40 razem`));
    expect(zdanie).not.toContain("12");
    expect(zdanie).not.toContain("40");
    expect(zdanie).not.toContain("{{");
    expect(zdanie.length).toBeGreaterThan(10);
  });
});
