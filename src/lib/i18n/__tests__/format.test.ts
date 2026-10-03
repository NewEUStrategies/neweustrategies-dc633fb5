// Formatowanie dat, godzin i liczb świadome języka i STREFY SERWISU.
//
// Kontrakt, który tu przypinamy (uzasadnienia w `../format.ts`):
//   * język interfejsu to tylko "pl" | "en", a wersja EN formatuje po
//     europejsku (en-GB), nie po amerykańsku;
//   * chwila formatuje się w `SITE_TIME_ZONE` (Europe/Warsaw), chyba że
//     wywołujący podał własną strefę - wynik nie zależy od strefy MASZYNY,
//     więc SSR (Workers, UTC) i przeglądarka drukują ten sam tekst;
//   * kolumna DATE formatuje się w UTC i nigdy nie przesuwa się o dzień;
//   * degradacja przy odmowie `Intl` jest dwustopniowa i nigdy nie rzuca.
//
// Testy, które psują `Intl`, ładują moduł NA ŚWIEŻO (`vi.resetModules`):
// format.ts trzyma zbudowane formatery w pamięci modułu, więc atrapa
// podstawiona po pierwszym użyciu nie zostałaby nawet zapytana.
import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeClock } from "@/test/time";
import {
  DATE_ONLY_TIME_ZONE,
  SITE_TIME_ZONE,
  formatDate,
  formatDateOnly,
  formatDateShort,
  formatDateTime,
  formatNumber,
  uiLang,
  uiLocale,
} from "../format";

// format.ts czyta zegar (`siteYear()` bez argumentu), a ten plik niesie
// literały dat - bramka `check:clock-freeze` wymaga zamrożenia.
freezeClock();

afterEach(() => {
  vi.restoreAllMocks();
});

const RealDateTimeFormat = Intl.DateTimeFormat;
const RealNumberFormat = Intl.NumberFormat;

async function loadFresh(): Promise<typeof import("../format")> {
  vi.resetModules();
  return import("../format");
}

/**
 * Podgląd konstruktora `Intl.DateTimeFormat`. Goły `vi.spyOn` tu nie wystarczy:
 * przy `new` buduje obiekt z prototypem atrapy, bez `format`. Implementacja
 * zwracająca prawdziwy formater zachowuje zachowanie i liczy wywołania.
 */
function observeDateTimeFormat(refuse: (locales?: Intl.LocalesArgument) => boolean = () => false) {
  return vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions,
  ) {
    if (refuse(locales)) throw new RangeError("ICU bez danych dla tego locale");
    return new RealDateTimeFormat(locales, options);
  });
}

/** Spacje grupujące tysiące to U+00A0 - porównujemy kształt, nie bajt spacji. */
const spaces = (s: string): string => s.replace(/\s/g, " ");

/** Podgląd konstruktora `Intl.NumberFormat` - jak wyżej. */
function observeNumberFormat() {
  return vi.spyOn(Intl, "NumberFormat").mockImplementation(function (
    locales?: Intl.LocalesArgument,
    options?: Intl.NumberFormatOptions,
  ) {
    return new RealNumberFormat(locales, options);
  });
}

// 22:30 UTC 12 lipca = 00:30 CEST 13 lipca: chwila z okna 22:00-24:00 UTC,
// w którym strefa maszyny (UTC) i strefa serwisu dają RÓŻNE dni.
const LATE_EVENING_UTC = "2026-07-12T22:30:00.000Z";

describe("uiLang / uiLocale - normalizacja języka interfejsu", () => {
  it("brak języka to polski (język domyślny serwisu)", () => {
    expect(uiLang(undefined)).toBe("pl");
    expect(uiLocale(undefined)).toBe("pl-PL");
  });

  it.each([
    ["pl", "pl", "pl-PL"],
    ["pl-PL", "pl", "pl-PL"],
    ["en", "en", "en-GB"],
    ["en-US", "en", "en-GB"],
    ["en-GB", "en", "en-GB"],
  ])("%s -> %s / %s", (raw, lang, locale) => {
    expect(uiLang(raw)).toBe(lang);
    expect(uiLocale(raw)).toBe(locale);
  });

  it("wersja EN formatuje po europejsku (en-GB) nawet dla en-US - konwencja domu", () => {
    // Dzień przed miesiącem: 13/07/2026, a nie amerykańskie 7/13/2026.
    expect(formatDateShort(LATE_EVENING_UTC, "en-US")).toBe("13/07/2026");
  });

  it.each(["de", "fr-FR", ""])("język spoza pary (%j) spada na polski", (raw) => {
    expect(uiLang(raw)).toBe("pl");
    expect(uiLocale(raw)).toBe("pl-PL");
  });

  it("jest idempotentne - wynik uiLocale podany z powrotem jako język daje to samo", () => {
    // `ClubInsights` przekazuje `uiLocale(i18n.language)` ("en-GB"/"pl-PL")
    // prosto do `formatNumber`, więc ponowna normalizacja musi być stała.
    for (const raw of [undefined, "pl", "en", "en-US", "de"]) {
      expect(uiLocale(uiLocale(raw))).toBe(uiLocale(raw));
      expect(uiLang(uiLocale(raw))).toBe(uiLang(raw));
    }
  });

  it("oczekuje kodów małymi literami - tak oddaje je każdy normalizator przed nim", () => {
    // Świadomie NIE zmieniamy: `normalizeLang`, `detectLangFromAcceptLanguage`,
    // `detectBrowserLang` i `supportedLngs` i18next oddają wyłącznie "pl"/"en",
    // więc wielka litera nie ma drogi do tej funkcji. Gdyby ktoś zaczął ją tu
    // podawać, ten test każe mu podjąć decyzję jawnie.
    expect(uiLang("EN")).toBe("pl");
  });
});

describe("formatDate", () => {
  it("formatuje datę długą w języku interfejsu", () => {
    expect(formatDate("2026-07-12T10:00:00.000Z", "pl")).toBe("12 lipca 2026");
    expect(formatDate("2026-07-12T10:00:00.000Z", "en")).toBe("12 July 2026");
  });

  it("przyjmuje Date, milisekundy i ISO z tym samym wynikiem", () => {
    const ms = Date.parse(LATE_EVENING_UTC);
    const expected = "13 lipca 2026";
    expect(formatDate(new Date(ms), "pl")).toBe(expected);
    expect(formatDate(ms, "pl")).toBe(expected);
    expect(formatDate(LATE_EVENING_UTC, "pl")).toBe(expected);
  });

  it.each([
    ["napis, którego nie da się sparsować", "nie-data"],
    ["pusty napis", ""],
    ["NaN", Number.NaN],
    ["Invalid Date", new Date(Number.NaN)],
  ])("%s daje pusty napis, nie „Invalid Date”", (_label, input) => {
    expect(formatDate(input, "pl")).toBe("");
    expect(formatDateShort(input, "en")).toBe("");
    expect(formatDateTime(input, "en")).toBe("");
  });

  describe("okno 22:00-24:00 UTC drukuje dzień warszawski, nie dzień maszyny", () => {
    it.each([
      // lato (CEST, UTC+2): granica doby warszawskiej to 22:00 UTC
      ["2026-07-12T21:59:59.000Z", "12 July 2026"],
      ["2026-07-12T22:00:00.000Z", "13 July 2026"],
      // zima (CET, UTC+1): granica przesuwa się na 23:00 UTC
      ["2026-01-12T22:59:00.000Z", "12 January 2026"],
      ["2026-01-12T23:00:00.000Z", "13 January 2026"],
    ])("%s -> %s", (iso, expected) => {
      expect(formatDate(iso, "en")).toBe(expected);
    });
  });

  it("wstrzykuje strefę serwisu, gdy wywołujący jej nie podał (także jawne undefined)", async () => {
    const fresh = await loadFresh();
    const spy = observeDateTimeFormat();
    // Dzień 13, nie 12: maszyna testowa i Workers liczą w UTC.
    expect(fresh.formatDate(LATE_EVENING_UTC, "en", { day: "numeric", timeZone: undefined })).toBe(
      "13",
    );
    expect(fresh.formatDate(LATE_EVENING_UTC, "en", { month: "long", day: "numeric" })).toBe(
      "13 July",
    );
    expect(spy).toHaveBeenCalledWith("en-GB", { day: "numeric", timeZone: SITE_TIME_ZONE });
    expect(spy).toHaveBeenCalledWith("en-GB", {
      month: "long",
      day: "numeric",
      timeZone: SITE_TIME_ZONE,
    });
  });

  it("szanuje strefę podaną przez wywołującego", () => {
    const opts = { year: "numeric", month: "long", day: "numeric" } as const;
    expect(formatDate(LATE_EVENING_UTC, "en", { ...opts, timeZone: "UTC" })).toBe("12 July 2026");
    expect(formatDate(LATE_EVENING_UTC, "en", { ...opts, timeZone: "America/New_York" })).toBe(
      "12 July 2026",
    );
    expect(formatDate(LATE_EVENING_UTC, "en", opts)).toBe("13 July 2026");
  });

  it("nie modyfikuje obiektu opcji wywołującego (bywa współdzieloną stałą modułu)", () => {
    const shared = Object.freeze({ year: "numeric", month: "short", day: "numeric" } as const);
    expect(formatDate(LATE_EVENING_UTC, "pl", shared)).toBe("13 lip 2026");
    expect(shared).toEqual({ year: "numeric", month: "short", day: "numeric" });
    expect("timeZone" in shared).toBe(false);
  });

  describe("degradacja, gdy główny formater odmawia", () => {
    it("odrzucona kombinacja opcji spada na ISO dnia W STREFIE SERWISU (en-CA)", () => {
      // Prawdziwe `Intl` rzuca TypeError dla `dateStyle` razem z `year`.
      expect(
        () => new RealDateTimeFormat("pl-PL", { dateStyle: "medium", year: "numeric" }),
      ).toThrow(TypeError);
      // 22:30 UTC 12.07 to już 13.07 w Warszawie - ratunek NIE może wrócić do
      // dnia UTC, bo sama degradacja stałaby się rozjazdem SSR/klient.
      expect(formatDate(LATE_EVENING_UTC, "pl", { dateStyle: "medium", year: "numeric" })).toBe(
        "2026-07-13",
      );
    });

    it("nieznana strefa wywołującego też spada na dzień warszawski", () => {
      expect(formatDate(LATE_EVENING_UTC, "en", { timeZone: "Mars/Olympus_Mons" })).toBe(
        "2026-07-13",
      );
    });

    it("pierwszy ratunek buduje formater en-CA w strefie serwisu", async () => {
      const fresh = await loadFresh();
      const spy = observeDateTimeFormat((locales) => locales !== "en-CA");
      expect(fresh.formatDateTime(LATE_EVENING_UTC, "en")).toBe("2026-07-13");
      expect(spy).toHaveBeenLastCalledWith("en-CA", {
        timeZone: SITE_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    });

    it("gdy odmawia całe `Intl`, ostatnia bramka to dzień ISO w UTC i nic nie rzuca", async () => {
      const fresh = await loadFresh();
      const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
        throw new RangeError("Intl niedostępny");
      });
      // Bez `Intl` nie ma czym przeliczyć strefy - zostaje dzień UTC. To jest
      // świadomy koszt ostatniej bramki, nie przypadek.
      expect(fresh.formatDate(LATE_EVENING_UTC, "pl")).toBe("2026-07-12");
      expect(fresh.formatDateShort(LATE_EVENING_UTC, "en")).toBe("2026-07-12");
      // główna próba + pierwszy ratunek, za każdym wywołaniem
      expect(spy).toHaveBeenCalledTimes(4);
    });
  });
});

describe("formatDateOnly - kolumny DATE w UTC", () => {
  it("formatuje dzień kolumny DATE bez przesunięcia", () => {
    expect(formatDateOnly("2026-07-12", "pl")).toBe("12 lipca 2026");
    expect(formatDateOnly("2026-07-12", "en")).toBe("12 July 2026");
    // Nowy Rok to najczulsza granica - żadna strefa nie może zrobić z niego
    // 31 grudnia poprzedniego roku.
    expect(formatDateOnly("2026-01-01", "pl")).toBe("1 stycznia 2026");
  });

  it("bierze tylko część dzienną znacznika czasu", () => {
    expect(formatDateOnly("2026-07-12T23:30:00+00:00", "en")).toBe("12 July 2026");
    expect(formatDateOnly("2026-07-12T00:15:00-08:00", "en")).toBe("12 July 2026");
  });

  it("przekazuje opcje wywołującego", () => {
    expect(formatDateOnly("2026-07-01", "pl", { month: "long", year: "numeric" })).toBe(
      "lipiec 2026",
    );
    expect(formatDateOnly("2026-07-12", "en", { day: "numeric", month: "short" })).toBe("12 Jul");
  });

  it("strefa UTC wygrywa ze strefą podaną w opcjach (dzień DATE nie ma chwili)", () => {
    // Los Angeles (UTC-7) zrobiłoby z północy UTC 11 lipca.
    expect(DATE_ONLY_TIME_ZONE).toBe("UTC");
    expect(
      formatDateOnly("2026-07-12", "en", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "America/Los_Angeles",
      }),
    ).toBe("12 July 2026");
  });

  it("buduje formater W UTC, nie w strefie serwisu", async () => {
    // Warszawa leży na wschód od UTC, więc północ UTC to w niej ten sam dzień -
    // samo porównanie wyniku nie odróżni UTC od `SITE_TIME_ZONE`. Strefę
    // przypinamy więc na konstruktorze: przy strefie zachodniej serwisu (albo
    // przy innej konfiguracji) kolumna DATE przesunęłaby się o dzień.
    const fresh = await loadFresh();
    const spy = observeDateTimeFormat();
    expect(fresh.formatDateOnly("2026-07-12", "pl")).toBe("12 lipca 2026");
    expect(spy).toHaveBeenCalledWith("pl-PL", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: DATE_ONLY_TIME_ZONE,
    });
    expect(spy).not.toHaveBeenCalledWith(
      "pl-PL",
      expect.objectContaining({ timeZone: SITE_TIME_ZONE }),
    );
  });

  it.each(["uszkodzone", "2026-13-45", ""])(
    "uszkodzona wartość %j wraca SUROWA - redakcja ma widzieć, co jest w bazie",
    (raw) => {
      expect(formatDateOnly(raw, "pl")).toBe(raw);
    },
  );
});

describe("formatDateShort", () => {
  it("pl: kropki, en: ukośniki - dzień przed miesiącem, w strefie serwisu", () => {
    expect(formatDateShort(LATE_EVENING_UTC, "pl")).toBe("13.07.2026");
    expect(formatDateShort(LATE_EVENING_UTC, "en")).toBe("13/07/2026");
  });

  it("jednocyfrowy dzień i miesiąc: pl bez zera przed dniem, en z zerami (dd/MM)", () => {
    // Przypina kształt opcji `numeric`: inna kombinacja (np. `month: "2-digit"`)
    // dla en-GB daje "5/03/2026", a `day: "2-digit"` dla pl - "05.03.2026".
    expect(formatDateShort("2026-03-05T10:00:00.000Z", "pl")).toBe("5.03.2026");
    expect(formatDateShort("2026-03-05T10:00:00.000Z", "en")).toBe("05/03/2026");
  });
});

describe("formatDateTime - godzina w strefie serwisu", () => {
  it("lato to UTC+2, zima UTC+1", () => {
    expect(formatDateTime("2026-07-12T12:00:00.000Z", "pl")).toBe("12.07.2026, 14:00");
    expect(formatDateTime("2026-01-12T12:00:00.000Z", "pl")).toBe("12.01.2026, 13:00");
    expect(formatDateTime("2026-01-12T12:00:00.000Z", "en")).toBe("12/01/2026, 13:00");
  });

  it("chwila z okna 22:00-24:00 UTC ma datę i godzinę dnia warszawskiego", () => {
    expect(formatDateTime(LATE_EVENING_UTC, "pl")).toBe("13.07.2026, 00:30");
    expect(formatDateTime(LATE_EVENING_UTC, "en")).toBe("13/07/2026, 00:30");
  });

  it.each([
    // 29.03.2026: 02:00 CET -> 03:00 CEST o 01:00 UTC
    ["2026-03-29T00:59:00.000Z", "29.03.2026, 01:59"],
    ["2026-03-29T01:00:00.000Z", "29.03.2026, 03:00"],
    // 25.10.2026: 03:00 CEST -> 02:00 CET o 01:00 UTC
    ["2026-10-25T00:59:00.000Z", "25.10.2026, 02:59"],
    ["2026-10-25T01:00:00.000Z", "25.10.2026, 02:00"],
  ])("zmiana czasu: %s -> %s", (iso, expected) => {
    expect(formatDateTime(iso, "pl")).toBe(expected);
  });
});

describe("formatNumber", () => {
  it("grupuje i oddziela ułamek według języka", () => {
    expect(spaces(formatNumber(1234567.891, "pl"))).toBe("1 234 567,891");
    expect(formatNumber(1234567.891, "en")).toBe("1,234,567.891");
    expect(formatNumber(1234567.891, undefined)).toBe(formatNumber(1234567.891, "pl"));
  });

  it("przekazuje opcje Intl.NumberFormat", () => {
    expect(spaces(formatNumber(1234.5, "pl", { style: "currency", currency: "PLN" }))).toBe(
      "1234,50 zł",
    );
    expect(formatNumber(1234.5, "en", { style: "currency", currency: "EUR" })).toBe("€1,234.50");
    expect(formatNumber(0.1234, "pl", { style: "percent", maximumFractionDigits: 1 })).toBe(
      "12,3%",
    );
    expect(formatNumber(7, "en", { minimumIntegerDigits: 3 })).toBe("007");
  });

  it("przyjmuje wynik uiLocale jako język (wywołanie z ClubInsights)", () => {
    expect(formatNumber(1234567.891, uiLocale("en"))).toBe("1,234,567.891");
    expect(spaces(formatNumber(1234567.891, uiLocale("pl")))).toBe("1 234 567,891");
  });

  it.each([
    ["nieprawidłowy kod waluty (RangeError)", { style: "currency", currency: "XX" } as const],
    ["styl walutowy bez waluty (TypeError)", { style: "currency" } as const],
  ])("odrzucone opcje (%s) degradują do String(value), nie rzucają", (_label, opts) => {
    expect(() => new RealNumberFormat("pl-PL", opts)).toThrow();
    expect(formatNumber(1234.5, "pl", opts)).toBe("1234.5");
  });
});

describe("pamięć formaterów Intl", () => {
  it("buduje formater dat RAZ na parę (język, opcje), nie przy każdej dacie", async () => {
    const fresh = await loadFresh();
    const spy = observeDateTimeFormat();
    expect(fresh.formatDate("2026-07-12T10:00:00.000Z", "pl")).toBe("12 lipca 2026");
    expect(fresh.formatDate(LATE_EVENING_UTC, "pl")).toBe("13 lipca 2026");
    expect(fresh.formatDate("2026-01-12T23:00:00.000Z", "pl")).toBe("13 stycznia 2026");
    expect(spy).toHaveBeenCalledTimes(1);

    // Inny język i inne opcje to osobne formatery...
    expect(fresh.formatDate(LATE_EVENING_UTC, "en")).toBe("13 July 2026");
    expect(fresh.formatDateTime(LATE_EVENING_UTC, "pl")).toBe("13.07.2026, 00:30");
    expect(spy).toHaveBeenCalledTimes(3);

    // ...ale opcje RÓWNE co do wartości (nowy obiekt przy każdym wywołaniu,
    // jak w każdym miejscu wywołania z literałem) trafiają w ten sam.
    expect(fresh.formatDateTime("2026-07-12T12:00:00.000Z", "pl")).toBe("12.07.2026, 14:00");
    expect(fresh.formatDate(LATE_EVENING_UTC, "pl", { year: "numeric", month: "long" })).toBe(
      "lipiec 2026",
    );
    expect(fresh.formatDate(LATE_EVENING_UTC, "pl", { year: "numeric", month: "long" })).toBe(
      "lipiec 2026",
    );
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("strefa wywołującego jest częścią klucza - formatery stref się nie mieszają", async () => {
    const fresh = await loadFresh();
    const opts = { year: "numeric", month: "long", day: "numeric" } as const;
    expect(fresh.formatDate(LATE_EVENING_UTC, "en", { ...opts, timeZone: "UTC" })).toBe(
      "12 July 2026",
    );
    expect(fresh.formatDate(LATE_EVENING_UTC, "en", opts)).toBe("13 July 2026");
    expect(fresh.formatDate(LATE_EVENING_UTC, "en", { ...opts, timeZone: "UTC" })).toBe(
      "12 July 2026",
    );
    // kolumna DATE (UTC) i chwila (Warszawa) z tymi samymi opcjami
    expect(fresh.formatDateOnly("2026-07-12", "en")).toBe("12 July 2026");
    expect(fresh.formatDate("2026-07-12T00:00:00.000Z", "en")).toBe("12 July 2026");
    expect(fresh.formatDate("2026-07-11T22:30:00.000Z", "en")).toBe("12 July 2026");
    expect(fresh.formatDateOnly("2026-07-11", "en")).toBe("11 July 2026");
  });

  it("buduje formater liczb RAZ na parę (język, opcje); brak opcji i {} to ten sam", async () => {
    const fresh = await loadFresh();
    const spy = observeNumberFormat();
    expect(fresh.formatNumber(1234, "en")).toBe("1,234");
    expect(fresh.formatNumber(5678, "en", {})).toBe("5,678");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fresh.formatNumber(0.5, "en", { style: "percent" })).toBe("50%");
    expect(fresh.formatNumber(0.25, "en", { style: "percent" })).toBe("25%");
    expect(fresh.formatNumber(1234, "pl")).toBe("1234");
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("konstrukcja, która rzuciła, niczego nie zapamiętuje", async () => {
    const fresh = await loadFresh();
    let refusals = 1;
    const spy = observeDateTimeFormat((locales) => locales !== "en-CA" && refusals-- > 0);
    // Pierwsza próba: główny formater odmawia -> ratunek en-CA.
    expect(fresh.formatDate(LATE_EVENING_UTC, "pl")).toBe("2026-07-13");
    // Druga: odmowa nie została zapamiętana jako formater - wraca pełna data.
    expect(fresh.formatDate(LATE_EVENING_UTC, "pl")).toBe("13 lipca 2026");
    expect(fresh.formatDate(LATE_EVENING_UTC, "pl")).toBe("13 lipca 2026");
    // odmowa + en-CA + jedna udana budowa (potem już z pamięci)
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("pamięć ma górny limit - opcje z danych nie rozdmuchują jej bez końca", async () => {
    const fresh = await loadFresh();
    const spy = observeNumberFormat();
    const variants: Intl.NumberFormatOptions[] = [];
    for (let integer = 1; integer <= 21; integer += 1) {
      for (let fraction = 0; fraction <= 3; fraction += 1) {
        variants.push({ minimumIntegerDigits: integer, minimumFractionDigits: fraction });
      }
    }
    for (const opts of variants) fresh.formatNumber(1, "en", opts);
    expect(spy).toHaveBeenCalledTimes(variants.length);

    // Wczesne wpisy zostają w pamięci - dokładnie 64 pierwsze (granica limitu)...
    expect(fresh.formatNumber(1, "en", variants[0])).toBe("1");
    expect(fresh.formatNumber(1, "en", variants[63])).toBe("0,000,000,000,000,001.000");
    expect(spy).toHaveBeenCalledTimes(variants.length);
    // ...65. już nie.
    expect(fresh.formatNumber(1, "en", variants[64])).toBe("00,000,000,000,000,001");
    expect(spy).toHaveBeenCalledTimes(variants.length + 1);
    // ...a ponad limitem formater buduje się jak dawniej - wynik ten sam,
    // poprawność nie zależy od pamięci.
    const last = variants[variants.length - 1];
    expect(fresh.formatNumber(1, "en", last)).toBe("000,000,000,000,000,000,001.000");
    expect(spy).toHaveBeenCalledTimes(variants.length + 2);
  });
});
