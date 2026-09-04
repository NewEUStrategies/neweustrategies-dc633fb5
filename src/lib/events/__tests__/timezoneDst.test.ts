// Czas wydarzenia PRZY ZMIANIE CZASU - i to, co zostaje, gdy `Intl` odmowi.
//
// PO CO TEN PLIK OBOK `timezone.test.ts`. Tamten dowodzi, ze godzina liczy sie
// w strefie WYDARZENIA. Tutaj stoja przypadki, ktore ta sama regula generuje
// dwa razy w roku i ktorych nikt nie zglosi jako bledu, bo wyglada poprawnie:
//
//   1. NOC PRZESTAWIENIA ZEGARA NA ZIMOWY. Miedzy 02:00 a 03:00 czasu polskiego
//      godzina 02:30 wypada DWA RAZY. Dwie rozne sesje agendy dostaja wtedy ten
//      sam napis „02:30" i jedynym, co je rozroznia, jest etykieta strefy.
//      Uczestnik bez etykiety przychodzi na zla - z dwoch mozliwych.
//   2. NOC PRZESTAWIENIA ZEGARA NA LETNI. Godzina 02:30 czasu polskiego NIE
//      ISTNIEJE. To jest klasyczne zrodlo „sesji o godzinie, ktorej nie ma"
//      w importowanej agendzie.
//   3. KLUCZ DNIA (`eventDayKey`) po zmianie czasu i po polnocy. Zakladki dni
//      agendy grupuja po nim, a przesuniecie o jedna dobe przenosi sesje na
//      niewlasciwa zakladke - tam, gdzie uczestnik jej nie szuka.
//   4. DEGRADACJA, gdy `Intl` odmawia. To jest DRUGA linia obrony modulu i do
//      dzis nie byla wykonana ani razu.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_DEFAULT_TZ,
  browserTimeZone,
  eventDateBlock,
  eventDayKey,
  eventTimeZone,
  eventTimeZoneLabel,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
} from "@/lib/events/timezone";

/**
 * Zmiana na czas ZIMOWY 2026: niedziela 25 pazdziernika, 01:00 UTC.
 * Przed nia Warszawa jest na UTC+2 (CEST), po niej na UTC+1 (CET).
 */
const PRZED_ZIMA = "2026-10-25T00:30:00.000Z"; // 02:30 CEST
const PO_ZIMIE = "2026-10-25T01:30:00.000Z"; // 02:30 CET - ta sama godzina na zegarze

/** Zmiana na czas LETNI 2026: niedziela 29 marca, 01:00 UTC (02:00 -> 03:00). */
const PRZED_LATEM = "2026-03-29T00:59:00.000Z"; // 01:59 CET
const PO_LECIE = "2026-03-29T01:00:00.000Z"; // 03:00 CEST - 02:xx nie istnieje

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("noc przestawienia zegara na czas zimowy", () => {
  it("godzina 02:30 wypada dwa razy i sam napis godziny ich nie rozroznia", () => {
    // To nie jest usterka formatera, tylko wlasciwosc kalendarza - i wlasnie
    // dlatego etykieta strefy MUSI stac obok godziny w agendzie.
    expect(formatEventTime(PRZED_ZIMA, "Europe/Warsaw", "pl")).toBe("02:30");
    expect(formatEventTime(PO_ZIMIE, "Europe/Warsaw", "pl")).toBe("02:30");
    // Pelny napis daty i godziny tez ich nie rozroznia - dwie rozne sesje
    // agendy dostaja tej nocy IDENTYCZNY podpis, wiec uczestnik nie ma z czego
    // wybrac wlasciwej, dopoki nie stanie przy nim etykieta strefy.
    const napisPrzed = formatEventDateTime(PRZED_ZIMA, "Europe/Warsaw", "pl");
    expect(napisPrzed).toContain("02:30");
    expect(formatEventDateTime(PO_ZIMIE, "Europe/Warsaw", "pl")).toBe(napisPrzed);
  });

  it("etykieta strefy jest jedynym, co odroznia te dwie chwile", () => {
    // Bez tej roznicy uczestnik nie ma z czego wyliczyc, ktora z dwoch godzin
    // 02:30 jest jego - a pomylka kosztuje cala sesje. Sama ROZNICA etykiet
    // jednak nie wystarczy: uczestnik z Brukseli dolicza do wlasnego zegara
    // KONKRETNE przesuniecie, wiec etykieta ma je nazwac. „CEST" to UTC+2
    // (przed zmiana), „CET" to UTC+1 (po zmianie).
    expect(eventTimeZoneLabel(PRZED_ZIMA, "Europe/Warsaw", "pl")).toBe("CEST");
    expect(eventTimeZoneLabel(PO_ZIMIE, "Europe/Warsaw", "pl")).toBe("CET");
  });

  it("obie chwile naleza do tej samej doby wydarzenia", () => {
    // Zakladka dnia nie moze sie rozdwoic tylko dlatego, ze w srodku nocy
    // przesunieto zegar.
    expect(eventDayKey(PRZED_ZIMA, "Europe/Warsaw")).toBe("2026-10-25");
    expect(eventDayKey(PO_ZIMIE, "Europe/Warsaw")).toBe("2026-10-25");
  });
});

describe("noc przestawienia zegara na czas letni", () => {
  it("po 01:59 nastepuje 03:00 - godziny 02:xx nie ma na zegarze", () => {
    // Agenda zaimportowana z systemu liczacego w UTC potrafi wystawic sesje
    // „o 02:30" tej nocy. Formater ma pokazac godzine, ktora naprawde
    // wystapila, a nie doliczyc brakujacej.
    expect(formatEventTime(PRZED_LATEM, "Europe/Warsaw", "pl")).toBe("01:59");
    expect(formatEventTime(PO_LECIE, "Europe/Warsaw", "pl")).toBe("03:00");
  });

  it("skrocona doba nie przenosi sesji na sasiedni dzien", () => {
    expect(eventDayKey(PRZED_LATEM, "Europe/Warsaw")).toBe("2026-03-29");
    expect(eventDayKey(PO_LECIE, "Europe/Warsaw")).toBe("2026-03-29");
  });
});

describe("klucz dnia liczy dobe po stronie wydarzenia", () => {
  it("sesja tuz przed polnoca UTC nalezy juz do nastepnego dnia kongresu", () => {
    // 22:30 UTC to 00:30 nastepnego dnia w Warszawie. Zakladka dnia idzie za
    // wydarzeniem, a nie za UTC - inaczej sesja otwierajaca dzien drugi wisi
    // pod dniem pierwszym.
    expect(eventDayKey("2026-10-24T22:30:00.000Z", "Europe/Warsaw")).toBe("2026-10-25");
    expect(eventDayKey("2026-10-24T22:30:00.000Z", "UTC")).toBe("2026-10-24");
  });

  it("klucz nie zalezy od jezyka interfejsu, bo nie przyjmuje jezyka wcale", () => {
    // Przelaczenie jezyka nie moze przebudowac zakladek dni ani zgubic wyboru
    // uczestnika - dlatego klucz jest techniczny, a nie do czytania.
    expect(eventDayKey(PRZED_ZIMA, "Europe/Warsaw")).toBe("2026-10-25");
    // Dowod, ze to nie jest oczywistosc: napis DO CZYTANIA tej samej chwili
    // rozni sie miedzy jezykami, wiec uzyty jako klucz przebudowalby zakladki
    // dni przy przelaczeniu jezyka i zgubil wybor uczestnika.
    expect(formatEventDate(PRZED_ZIMA, "Europe/Warsaw", "pl")).not.toBe(
      formatEventDate(PRZED_ZIMA, "Europe/Warsaw", "en"),
    );
  });

  it("brak terminu i termin nie do sparsowania daja pusty klucz, nie 'Invalid Date'", () => {
    // Pusty klucz znaczy „ta sesja nie ma dnia" - grupowanie odklada ja osobno
    // zamiast tworzyc zakladke o nazwie `Invalid Date`.
    for (const wartosc of [null, undefined, "", "wczoraj", "2026-13-45T99:99:99Z"]) {
      expect(eventDayKey(wartosc, "Europe/Warsaw")).toBe("");
    }
  });

  it("nieznana strefa liczy dobe w strefie domyslnej, a nie w UTC", () => {
    // 22:30 UTC to 00:30 dnia nastepnego w Warszawie. Porownanie dwoch wywolan
    // tej samej funkcji przepuscilaby przypadek, w ktorym OBA oddaja pusty
    // napis, wiec obie strony sa tu wartosciami dokladnymi.
    expect(eventDayKey("2026-10-24T22:30:00.000Z", "Nie/Istnieje")).toBe("2026-10-25");
    expect(eventDayKey("2026-10-24T22:30:00.000Z", EVENT_DEFAULT_TZ)).toBe("2026-10-25");
    expect(eventDayKey("2026-10-24T22:30:00.000Z", "UTC")).toBe("2026-10-24");
  });
});

describe("strefa przegladarki", () => {
  it("oddaje strefe rozstrzygnieta przez przegladarke", () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "America/New_York" }) }),
    });
    expect(browserTimeZone()).toBe("America/New_York");
  });

  it("pusta odpowiedz przegladarki degraduje do strefy serwisu", () => {
    // Srodowiska bez bazy stref (stare WebView, kiosk) zwracaja pusty napis.
    // Pusta strefa oddana dalej trafilaby do `Intl` i wywrocila render.
    vi.stubGlobal("Intl", {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "" }) }),
    });
    expect(browserTimeZone()).toBe(EVENT_DEFAULT_TZ);
  });

  it("wyjatek z `Intl` tez degraduje, zamiast wywracac panel", () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: () => {
        throw new RangeError("brak bazy stref");
      },
    });
    expect(browserTimeZone()).toBe(EVENT_DEFAULT_TZ);
  });
});

/**
 * Atrapy `Intl.DateTimeFormat` MUSZA byc konstruktorami.
 *
 * `eventTimeZoneLabel` i `eventDayKey` wolaja formater przez `new`, a funkcji
 * strzalkowej nie da sie skonstruowac - podstawiona zamiast klasy wywolalaby
 * `TypeError` z samego `new` i test przechodzilby przez inna galaz niz ta,
 * ktorej dotyczy.
 */
class FormaterOdmawiajacy {
  constructor() {
    throw new RangeError("odrzucona kombinacja opcji");
  }
}

/** Formater, ktory oddaje czesci daty BEZ nazwy strefy. */
class FormaterBezNazwyStrefy {
  formatToParts(): Intl.DateTimeFormatPart[] {
    return [{ type: "hour", value: "02" }];
  }
}

describe("druga linia obrony, gdy `Intl` odmawia", () => {
  it("etykieta strefy degraduje do identyfikatora, zamiast rzucac", () => {
    // Rozstrzygniecie strefy jest juz zapamietane, wiec stub dotyka WYLACZNIE
    // formatera etykiety. Odpowiedz jest gorsza (identyfikator IANA zamiast
    // „CEST"), ale to nadal jest prawda o strefie - i nadal jest to render.
    expect(eventTimeZone({ timezone: "Europe/Warsaw" })).toBe("Europe/Warsaw");
    vi.stubGlobal("Intl", { DateTimeFormat: FormaterOdmawiajacy });
    expect(eventTimeZoneLabel(PRZED_ZIMA, "Europe/Warsaw", "pl")).toBe("Europe/Warsaw");
  });

  it("formater bez nazwy strefy oddaje identyfikator, a nie pusty podpis", () => {
    // Godzina bez ZADNEGO podpisu strefy jest gorsza niz godzina podpisana
    // identyfikatorem IANA: uczestnik z Brukseli nie ma wtedy czego przeliczac
    // i zaklada, ze to jego wlasna strefa.
    expect(eventTimeZone({ timezone: "Europe/Warsaw" })).toBe("Europe/Warsaw");
    vi.stubGlobal("Intl", { DateTimeFormat: FormaterBezNazwyStrefy });
    expect(eventTimeZoneLabel(PRZED_ZIMA, "Europe/Warsaw", "pl")).toBe("Europe/Warsaw");
  });

  it("klucz dnia degraduje do doby UTC, zamiast rzucac", () => {
    expect(eventTimeZone({ timezone: "Europe/Warsaw" })).toBe("Europe/Warsaw");
    vi.stubGlobal("Intl", { DateTimeFormat: FormaterOdmawiajacy });
    // Doba UTC potrafi sie roznic od doby wydarzenia - to jest cena degradacji,
    // ale zakladka dnia powstaje, a agenda sie renderuje.
    expect(eventDayKey("2026-10-24T22:30:00.000Z", "Europe/Warsaw")).toBe("2026-10-24");
  });

  it("blok daty degraduje do strefy domyslnej, gdy formater odrzuci strefe wydarzenia", () => {
    // `Intl` bywa aktualizowany razem z przegladarka i potrafi odrzucic
    // kombinacje opcji, ktora dzialala wczoraj. Blok daty ma sie wtedy narysowac
    // w strefie serwisu, a nie zniknac z karty wydarzenia.
    const oczekiwany = eventDateBlock(PRZED_ZIMA, EVENT_DEFAULT_TZ, "pl");
    let pierwszeWywolanie = true;
    const original = Date.prototype.toLocaleDateString;
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      locales?: Intl.LocalesArgument,
      options?: Intl.DateTimeFormatOptions,
    ): string {
      if (pierwszeWywolanie) {
        pierwszeWywolanie = false;
        throw new RangeError("odrzucona kombinacja opcji");
      }
      return original.call(this, locales, options);
    });

    expect(eventDateBlock(PRZED_ZIMA, "America/New_York", "pl")).toEqual(oczekiwany);
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (`it.fails`).
  //
  // `formatEventDateTime` przyjmuje DOWOLNE `Intl.DateTimeFormatOptions` od
  // wolajacego i deklaruje w komentarzu degradacje zamiast wyjatku. Odrzucona
  // KOMBINACJA opcji (tu: `dateStyle` razem z `hour` - `Intl` rzuca na to
  // `TypeError`) nie zalezy jednak od strefy, wiec gdy pierwsza proba padnie,
  // padnie tez druga (strefa domyslna) i TRZECIA (bez strefy) - wyjatek
  // wychodzi z funkcji i zabiera ze soba render calej listy wydarzen.
  // Trzeci fallback musi byc bezwarunkowo bezpieczny (pusty napis albo ISO),
  // bo inaczej `try/catch` wokol niego niczego nie chroni. Poprawka nalezy do
  // produkcji, nie do testu.
  it.fails("DEFEKT: odrzucona kombinacja opcji rzuca zamiast zdegradowac", () => {
    expect(() =>
      formatEventDateTime(PRZED_ZIMA, "Europe/Warsaw", "pl", {
        dateStyle: "long",
        hour: "numeric",
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// PAMIEC ROZSTRZYGNIEC STREFY - na koncu pliku, bo zapelnia ja na stale.
// ---------------------------------------------------------------------------
describe("pamiec rozstrzygniec ma sufit, a poprawnosc go nie potrzebuje", () => {
  it("po przekroczeniu limitu strefy nadal rozstrzygaja sie poprawnie", () => {
    // Limit jest BEZPIECZNIKIEM na wypadek kolumny zasilanej importem z obcego
    // systemu: pamiec ma przestac rosnac, a nie zaczac klamac. Po zapelnieniu
    // cache znana strefa musi dalej byc znana, a nieznana dalej nieznana -
    // inaczej wydarzenie pokazywaloby godzine w strefie biura po tym, jak ktos
    // zaimportowal kilkaset wierszy.
    for (let i = 0; i < 600; i += 1) eventTimeZone({ timezone: `Nie/Istnieje-${i}` });

    expect(eventTimeZone({ timezone: "Europe/Brussels" })).toBe("Europe/Brussels");
    expect(eventTimeZone({ timezone: "Nie/Istnieje-po-limicie" })).toBe(EVENT_DEFAULT_TZ);
    expect(formatEventTime(PRZED_ZIMA, "Europe/Warsaw", "pl")).toBe("02:30");
  });
});
