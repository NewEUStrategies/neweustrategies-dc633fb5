// Lista stref czasowych droplisty wydarzeń.
//
// CO TU MOŻE SIĘ NAPRAWDĘ ZEPSUĆ - i dlatego jest sprawdzane.
//
//   1. LITERÓWKA W IDENTYFIKATORZE IANA. `Intl.DateTimeFormat` rzuca
//      `RangeError` na nieznanej strefie, a `timezone.ts` liczy datę
//      wydarzenia właśnie przez `Intl`. Wpis „Europe/Warszawa" nie wywala
//      niczego przy tworzeniu listy - wywala się dopiero na EKRANIE, u
//      redaktora, który tę pozycję wybrał, i już po zapisie do bazy (kolumna
//      `events.timezone` jest `text` bez CHECK-a na katalog stref). Kompilator
//      tego nie widzi, bo to zwykły napis. Pętla po katalogu jest jedynym
//      miejscem w repo, które to złapie.
//   2. DUPLIKAT. Dwa te same napisy dają dwie identyczne pozycje `<option>`
//      i - przy kluczu z wartości - ostrzeżenie Reacta o powtórzonym kluczu.
//   3. WYBÓR ŹRÓDŁA LISTY. Pełny katalog IANA pochodzi z
//      `Intl.supportedValuesOf`, którego starsze silniki nie mają, a niektóre
//      rzucają na nieznany klucz. Obie te ścieżki muszą kończyć się listą
//      awaryjną, a nie pustą droplistą ani wyjątkiem w renderze panelu.
//   4. WARTOŚĆ JUŻ ZAPISANA. Strefa spoza katalogu musi zostać doklejona,
//      inaczej pole edycji wygląda na puste i PIERWSZY zapis ustawień po cichu
//      przestawia strefę wydarzenia na cudzą.
//
// GRANICĄ MOCKOWANĄ JEST WYŁĄCZNIE `Intl.supportedValuesOf` - czyli API
// środowiska. Sama `timeZoneOptions` jest wołana prawdziwa.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EVENT_TIME_ZONE,
  FALLBACK_TIME_ZONES,
  timeZoneOptions,
} from "@/lib/events/timeZoneOptions";

type IntlWithZones = { supportedValuesOf?: (key: string) => string[] };

/** 1 lipca 2026, 12:00 UTC - lato, więc strefy europejskie są przesunięte. */
const INSTANT = new Date("2026-07-01T12:00:00.000Z");

const REAL_SUPPORTED = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf");

/** Podmiana API środowiska - jedyna granica, którą ten plik atrapuje. */
function setSupportedValuesOf(value: ((key: string) => string[]) | undefined): void {
  Object.defineProperty(Intl, "supportedValuesOf", {
    value,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  if (REAL_SUPPORTED) Object.defineProperty(Intl, "supportedValuesOf", REAL_SUPPORTED);
  else delete (Intl as IntlWithZones).supportedValuesOf;
});

describe("katalog stref awaryjnych", () => {
  it("każdy identyfikator jest PRZYJMOWANY przez Intl i daje realną godzinę", () => {
    // Gdyby którykolwiek wpis był literówką, `Intl.DateTimeFormat` rzuciłby
    // `RangeError` - tutaj, a nie na produkcji w połowie renderu panelu.
    for (const zone of FALLBACK_TIME_ZONES) {
      const formatted = new Intl.DateTimeFormat("pl-PL", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
      }).format(INSTANT);
      expect(formatted).toMatch(/^\d{2}:\d{2}$/);
    }
  });

  it("nie zawiera duplikatów ani dwóch nazw tej samej strefy", () => {
    // Powtórzony napis daje dwie identyczne pozycje droplisty. Powtórzenie
    // UKRYTE (np. „Europe/Kyiv" obok „Europe/Kiev", które `Intl` sprowadza do
    // jednej strefy) wygląda dla użytkownika na dwa różne wybory dające ten
    // sam wynik - stąd porównanie po nazwie KANONICZNEJ, nie po napisie.
    expect(new Set(FALLBACK_TIME_ZONES).size).toBe(FALLBACK_TIME_ZONES.length);

    const canonical = FALLBACK_TIME_ZONES.map(
      (zone) => new Intl.DateTimeFormat("pl-PL", { timeZone: zone }).resolvedOptions().timeZone,
    );
    expect(new Set(canonical).size).toBe(FALLBACK_TIME_ZONES.length);
  });

  it("strefa domyślna organizacji jest na liście awaryjnej", () => {
    // `EventCreateForm` startuje z `DEFAULT_EVENT_TIME_ZONE` w szkicu. Gdyby
    // ta wartość była poza katalogiem, kreator w przeglądarce bez
    // `Intl.supportedValuesOf` doklejałby ją jako dziewiątą, osobną pozycję
    // ponad listą - czyli pokazywałby wybór, którego panel edycji nie oferuje.
    expect(FALLBACK_TIME_ZONES).toContain(DEFAULT_EVENT_TIME_ZONE);
  });
});

describe("źródło listy", () => {
  it("bierze PEŁNY katalog z Intl, gdy przeglądarka go zna", () => {
    // Sedno modułu: redaktor nie jest ograniczony do ośmiu stref. Zwrócenie
    // listy awaryjnej mimo dostępnego API oznaczałoby, że wydarzenia poza
    // Europą nie da się w ogóle poprawnie ustawić.
    setSupportedValuesOf(() => ["Europe/Warsaw", "America/New_York", "Pacific/Auckland"]);

    expect(timeZoneOptions("Europe/Warsaw")).toEqual([
      "Europe/Warsaw",
      "America/New_York",
      "Pacific/Auckland",
    ]);
  });

  it("pyta o klucz dokładnie `timeZone`", () => {
    // Silniki rzucają `RangeError` na nieznanym kluczu, a moduł ten wyjątek
    // POŁYKA. Literówka w kluczu („timezone") nie byłaby więc żadnym błędem -
    // po cichu ścięłaby droplistę do ośmiu pozycji w KAŻDEJ przeglądarce.
    const supported = vi.fn(() => ["Europe/Warsaw"]);
    setSupportedValuesOf(supported);

    timeZoneOptions("Europe/Warsaw");

    expect(supported.mock.calls).toEqual([["timeZone"]]);
  });

  it("przeglądarka BEZ `Intl.supportedValuesOf` dostaje listę awaryjną, nie pustą droplistę", () => {
    setSupportedValuesOf(undefined);

    expect(timeZoneOptions("Europe/Warsaw")).toEqual([...FALLBACK_TIME_ZONES]);
  });

  it("`supportedValuesOf`, które RZUCA, nie wywraca panelu", () => {
    // Wyjątek z API środowiska nie może dolecieć do renderu - inaczej cały
    // panel „Informacje ogólne" gaśnie przez jedną droplistę.
    setSupportedValuesOf(() => {
      throw new RangeError("invalid key: timeZone");
    });

    expect(timeZoneOptions("")).toEqual([...FALLBACK_TIME_ZONES]);
  });

  it("w prawdziwym środowisku lista jest niepusta i ma strefę domyślną", () => {
    // Bez atrapy: gdyby prawdziwe `supportedValuesOf` oddało pustą tablicę,
    // moduł wziąłby ją jako listę i kreator wyrenderowałby `<select>` bez
    // ani jednej pozycji - z wartością domyślną, której nie da się zaznaczyć.
    const options = timeZoneOptions("");

    expect(options.length).toBeGreaterThanOrEqual(FALLBACK_TIME_ZONES.length);
    expect(options).toContain(DEFAULT_EVENT_TIME_ZONE);
  });
});

describe("wartość już zapisana na wydarzeniu", () => {
  it("strefa spoza katalogu ląduje NA POCZĄTKU listy", () => {
    // To nie jest przypadek teoretyczny: `Intl.supportedValuesOf` w bieżącym
    // ICU oddaje starą nazwę „Europe/Kiev", a lista awaryjna zawiera
    // „Europe/Kyiv". Wydarzenie założone w kreatorze na starszej przeglądarce
    // ma więc w bazie wartość, której pełny katalog NIE zna. Bez doklejenia
    // pole edycji wyglądałoby na puste, a pierwszy zapis ustawień po cichu
    // podmieniłby strefę wydarzenia na pierwszą z brzegu.
    setSupportedValuesOf(() => ["Europe/Warsaw", "Europe/Berlin"]);

    const options = timeZoneOptions("Europe/Kyiv");

    expect(options).toEqual(["Europe/Kyiv", "Europe/Warsaw", "Europe/Berlin"]);
  });

  it("strefa już obecna NIE jest doklejana drugi raz", () => {
    // Doklejanie bezwarunkowe dałoby dublet w droplistie i powtórzony klucz
    // Reacta - dokładnie ten sam objaw, co duplikat w katalogu awaryjnym.
    setSupportedValuesOf(() => ["Europe/Warsaw", "Europe/Berlin"]);

    const options = timeZoneOptions("Europe/Berlin");

    expect(options).toEqual(["Europe/Warsaw", "Europe/Berlin"]);
  });

  it("pusta wartość nie tworzy pustej pozycji droplisty", () => {
    // Nowe wydarzenie i wiersz bez strefy dają `""` (tak normalizuje
    // `eventGeneralDraftFromRow`). Doklejenie tego napisu dałoby na szczycie
    // listy niewidzialny, ale wybieralny wiersz.
    setSupportedValuesOf(() => ["Europe/Warsaw", "Europe/Berlin"]);

    const options = timeZoneOptions("");

    expect(options).toEqual(["Europe/Warsaw", "Europe/Berlin"]);
    expect(options).not.toContain("");
  });

  it("USTERKA: `null` i `undefined` w miejsce strefy trafiają do listy jako pozycja", () => {
    // Kontrakt typu mówi `string`, a `eventGeneralDraftFromRow` normalizuje
    // każdą wartość z bazy do napisu - więc to nie jest codzienny przypadek,
    // tylko zachowanie na wywołanie z miejsca nieotypowanego. Strażnik w
    // module brzmi `current !== ""`, a `null !== ""` jest PRAWDĄ, więc obie te
    // wartości przechodzą przez sito i lądują na szczycie droplisty.
    //
    // To prawdopodobnie USTERKA (zgłoszona osobno): `<option>` z wartością
    // `null` renderuje się jako pusty, wybieralny wiersz, a wybranie go
    // zapisuje do `events.timezone` napis „null". Test pilnuje zachowania
    // OBECNEGO, żeby zmiana strażnika była widoczna, a nie cicha.
    setSupportedValuesOf(() => ["Europe/Warsaw", "Europe/Berlin"]);

    expect(timeZoneOptions(null as unknown as string)).toEqual([
      null,
      "Europe/Warsaw",
      "Europe/Berlin",
    ]);
    expect(timeZoneOptions(undefined as unknown as string)).toEqual([
      undefined,
      "Europe/Warsaw",
      "Europe/Berlin",
    ]);
  });

  it('USTERKA: same spacje przechodzą przez strażnik `!== ""`', () => {
    // `eventGeneralDraftValidate` odrzuca strefę, której `.trim()` jest pusty
    // (eventGeneralDraft.ts, warunek `draft.timezone.trim() === ""`). Strażnik
    // w tym module porównuje BEZ `.trim()`, więc oba miejsca rozjeżdżają się
    // dokładnie na napisie ze spacji: walidacja mówi „strefa wymagana", a
    // droplista już pokazuje niewidzialny wiersz nad katalogiem.
    setSupportedValuesOf(() => ["Europe/Warsaw"]);

    expect(timeZoneOptions("   ")).toEqual(["   ", "Europe/Warsaw"]);
  });

  it("USTERKA: strefa spoza IANA jest doklejana bez żadnej walidacji", () => {
    // Kolumna `events.timezone` jest `text` bez CHECK-a, więc do bazy może
    // trafić dowolny napis (import, ręczny UPDATE, starszy kreator). Moduł
    // dokleja go, bo „nie zna", i redaktor dostaje wybieralną pozycję, której
    // wybranie wywala `timezone.ts` na `RangeError` z `Intl.DateTimeFormat`.
    // Zachowanie obecne: dokleja wszystko. Prawdopodobnie usterka.
    setSupportedValuesOf(() => ["Europe/Warsaw"]);

    expect(timeZoneOptions("Europe/Warszawa")).toEqual(["Europe/Warszawa", "Europe/Warsaw"]);
    expect(() => new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warszawa" })).toThrow(
      RangeError,
    );
  });

  it("różnica WIELKOŚCI LITER jest traktowana jak inna strefa", () => {
    // `Intl` przyjmuje identyfikator bez względu na wielkość liter, ale
    // `Array.prototype.includes` porównuje napisy dokładnie. Wartość
    // „europe/warsaw" z bazy daje więc DWIE pozycje oznaczające tę samą
    // strefę - dokładnie ten objaw, przed którym broni test na duplikaty.
    setSupportedValuesOf(() => ["Europe/Warsaw", "UTC"]);

    expect(timeZoneOptions("europe/warsaw")).toEqual(["europe/warsaw", "Europe/Warsaw", "UTC"]);
  });
});

describe("zdegenerowana odpowiedź `Intl.supportedValuesOf`", () => {
  it("USTERKA: PUSTY katalog z Intl daje PUSTĄ droplistę zamiast listy awaryjnej", () => {
    // Nagłówek modułu obiecuje, że skrócony zbiór stoi „jako awaryjny". Ale
    // awaria jest rozpoznawana tylko po BRAKU funkcji albo po wyjątku - nie po
    // bezużytecznej odpowiedzi. Silnik zbudowany bez danych stref (albo
    // wypełniacz zwracający `[]` zamiast rzucać) przechodzi przez oba te sita
    // i podstawia pustą tablicę jako katalog.
    //
    // Skutek na ekranie: `<select>` bez ani jednej pozycji przy zakładaniu
    // wydarzenia - formularza nie da się wysłać, bo walidacja żąda strefy.
    setSupportedValuesOf(() => []);

    expect(timeZoneOptions("")).toEqual([]);
  });

  it("USTERKA: przy pustym katalogu redaktor widzi WYŁĄCZNIE swoją obecną strefę", () => {
    // Wariant groźniejszy od pustej listy, bo wygląda poprawnie: pole edycji
    // pokazuje zapisaną strefę i nic poza nią, więc zmiana strefy wydarzenia
    // jest niemożliwa, a nic nie sygnalizuje awarii.
    setSupportedValuesOf(() => []);

    expect(timeZoneOptions("Europe/Warsaw")).toEqual(["Europe/Warsaw"]);
  });

  it("właściwość obecna, ale NIEWYWOŁYWALNA, schodzi na listę awaryjną", () => {
    // Gałąź `typeof supported === "function"` musi odrzucić także wartości
    // obecne, lecz nie będące funkcją - inaczej `supported("timeZone")`
    // rzuciłoby `TypeError` w środku `try`, co akurat też kończy się listą
    // awaryjną, ale przypadkiem, nie z rozmysłu.
    for (const notAFunction of [null, "timeZone", 42, {}]) {
      setSupportedValuesOf(notAFunction as unknown as (key: string) => string[]);

      expect(timeZoneOptions("Europe/Warsaw")).toEqual([...FALLBACK_TIME_ZONES]);
    }
  });

  it("duplikaty z Intl przechodzą do droplisty bez odsiewu", () => {
    // Moduł nie normalizuje katalogu z przeglądarki - ufa mu. Test utrwala
    // ten kontrakt: jedyną gwarancją unikalności jest sam silnik, więc
    // odsiewu trzeba szukać tutaj, gdyby kiedyś okazał się potrzebny.
    setSupportedValuesOf(() => ["Europe/Warsaw", "Europe/Warsaw", "UTC"]);

    expect(timeZoneOptions("UTC")).toEqual(["Europe/Warsaw", "Europe/Warsaw", "UTC"]);
  });
});

describe("kolejność pozycji droplisty", () => {
  it("lista awaryjna zachowuje kolejność ZADEKLAROWANĄ, nie alfabetyczną", () => {
    // Kolejność w `FALLBACK_TIME_ZONES` jest celowa - strefy, w których
    // organizacja pracuje, stoją najbliżej góry, a „Europe/Warsaw" pierwsza.
    // Posortowanie listy w module wyglądałoby na porządek, a w praktyce
    // zepchnęłoby domyślną strefę w środek zbioru.
    setSupportedValuesOf(undefined);

    const options = timeZoneOptions("");

    expect(options[0]).toBe(DEFAULT_EVENT_TIME_ZONE);
    expect([...options]).not.toEqual([...FALLBACK_TIME_ZONES].sort());
  });

  it("katalog z Intl trafia do droplisty w kolejności silnika, bez przestawiania", () => {
    // Gdyby moduł sortował, ten test przeszedłby przypadkiem na liście już
    // posortowanej - stąd wejście CELOWO nieposortowane.
    setSupportedValuesOf(() => ["Pacific/Auckland", "Africa/Abidjan", "Europe/Warsaw"]);

    expect(timeZoneOptions("Europe/Warsaw")).toEqual([
      "Pacific/Auckland",
      "Africa/Abidjan",
      "Europe/Warsaw",
    ]);
  });

  it("doklejona strefa stoi PRZED katalogiem, nie na końcu", () => {
    // Pozycja ma znaczenie: przy 400+ strefach z `Intl` wartość dopisana na
    // końcu byłaby dla redaktora nie do znalezienia.
    setSupportedValuesOf(() => Array.from({ length: 50 }, (_, index) => `Etc/GMT+${index}`));

    const options = timeZoneOptions("Europe/Kyiv");

    expect(options[0]).toBe("Europe/Kyiv");
    expect(options).toHaveLength(51);
  });

  it("strefa domyślna organizacji NIE jest wynoszona na górę pełnego katalogu", () => {
    // Utrwalenie świadomego ograniczenia, nie pochwała: przy dostępnym `Intl`
    // moduł oddaje katalog silnika bez wyróżnienia stref organizacji, więc
    // „Europe/Warsaw" leży w porządku alfabetycznym gdzieś w środku listy.
    // Gdyby ktoś kiedyś dołożył sekcję „często używane", ten test upadnie
    // i przypomni, żeby zaktualizować opis modułu.
    const options = timeZoneOptions("");

    expect(options.length).toBeGreaterThan(FALLBACK_TIME_ZONES.length);
    expect(options.indexOf(DEFAULT_EVENT_TIME_ZONE)).toBeGreaterThan(0);
  });
});

describe("kontrakt zwracanej tablicy", () => {
  it("ścieżka awaryjna oddaje TĘ SAMĄ tablicę, co eksportowana stała", () => {
    // Utrwalenie faktu, nie zalecenie: bez `Intl` moduł zwraca referencję do
    // `FALLBACK_TIME_ZONES`, więc każdy wywołujący dostaje ten sam obiekt.
    // Typ `readonly string[]` blokuje mutację w TypeScripcie i to jest tu
    // jedyna ochrona - gdyby wynik trafił kiedyś do kodu bez typów, `sort()`
    // na nim przestawiłby katalog awaryjny CAŁEJ aplikacji, na stałe.
    setSupportedValuesOf(undefined);

    expect(timeZoneOptions("")).toBe(FALLBACK_TIME_ZONES);
  });

  it("doklejenie strefy tworzy NOWĄ tablicę, a stała zostaje nietknięta", () => {
    // Odwrotna strona tego samego kontraktu: gałąź z doklejaniem buduje kopię
    // przez rozwinięcie, więc katalog awaryjny nie rośnie z każdym wydarzeniem
    // o nietypowej strefie.
    setSupportedValuesOf(undefined);

    const options = timeZoneOptions("Asia/Tokyo");

    expect(options).not.toBe(FALLBACK_TIME_ZONES);
    expect(options).toEqual(["Asia/Tokyo", ...FALLBACK_TIME_ZONES]);
    expect(FALLBACK_TIME_ZONES).toHaveLength(8);
    expect(FALLBACK_TIME_ZONES).not.toContain("Asia/Tokyo");
  });
});
