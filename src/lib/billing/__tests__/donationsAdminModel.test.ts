// Warstwa decyzji panelu `/admin/donations`: jak napis z formularza staje się
// KWOTĄ, którą zobaczy darczyńca na `/donate`.
//
// CO TEN PLIK DOWODZI.
//   1. Że pole „kwoty sugerowane" NIE obsługuje polskiego przecinka
//      dziesiętnego, mimo że kod zawiera `replace(",", ".")` napisany właśnie
//      po to. Administrator wpisujący `50,50` dostaje DWA presety po 50 zł.
//      Napis w polu wygląda na przyjęty; kwoty w publicznym formularzu są inne
//      niż zamierzone. To przechodzi przez `tsc` (typy się zgadzają), przez
//      recenzję (`replace` jest na miejscu i wygląda poprawnie) i przez zapis
//      (zod widzi tablicę dodatnich liczb całkowitych - bo dostaje ją poprawną,
//      tylko nie tę).
//   2. Że każde odrzucenie w tym polu jest CICHE: fragment nieliczbowy, kwota
//      poniżej grosza i dziewiąty preset znikają bez jednego komunikatu.
//   3. Że pole puste daje formularz darowizny BEZ przycisków kwot.
//   4. Że `Number(x) || 0` czyni wyczyszczenie pola nieodróżnialnym od wpisania
//      w nie śmiecia - obie drogi dają zero, także dla `minCents`, które zero
//      mieć nie może.
//   5. Że kierunek domyślnej wartości `<select>` środowiska jest bezpieczny
//      (pomyłka -> piaskownica), a `<select>` silnika i waluty - milczący
//      (nieznana wartość -> wariant domyślny, bez sygnału).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Walidacji zapisu (`DonationsConfigSchema`) ani
// `normalizeDonationAmount` - to `src/lib/billing/donationsConfig.ts` i ma
// własne testy. Tutaj chodzi o krok WCZEŚNIEJ: co w ogóle trafia do schematu.
import { describe, expect, it } from "vitest";

import {
  coerceCurrency,
  coerceProvider,
  coerceSyncEnvironment,
  formatPresetsInput,
  parseAmountField,
  parsePresetsCents,
} from "@/lib/billing/donationsAdminModel";
import { DonationsConfigSchema } from "@/lib/billing/donationsConfig";

describe("parsePresetsCents: pole kwot sugerowanych", () => {
  it("lista pełnozłotowa przechodzi w grosze w podanej kolejności", () => {
    expect(parsePresetsCents("25, 50, 100, 250")).toEqual([2500, 5000, 10000, 25000]);
  });

  it("kropka dziesiętna działa: `12.34` to 1234 gr", () => {
    expect(parsePresetsCents("12.34")).toEqual([1234]);
  });

  it("DEFEKT: przecinek dziesiętny `50,50` daje DWA presety po 50 zł, nie jeden na 50,50", () => {
    // OCZEKIWANE: [5050]. FAKTYCZNE: [5000, 5000].
    //
    // `replace(",", ".")` w kodzie produkcyjnym nie ma jak zadziałać - rozcięcie
    // idzie WŁAŚNIE po przecinku, więc do `replace` nigdy nie trafia fragment
    // zawierający przecinek. Zostawiam ten test jako `it` opisujący STAN
    // FAKTYCZNY (nie `it.fails`), bo jego wartością jest przypięcie liczb,
    // które naprawdę lądują w konfiguracji - żeby po naprawie było widać
    // DOKŁADNIE, co się zmieniło.
    expect(parsePresetsCents("50,50")).toEqual([5000, 5000]);
  });

  it("DEFEKT: `1 234,56` (spacja jako separator tysięcy) daje 100 zł i 56 zł", () => {
    // `Number.parseFloat("1 234")` zatrzymuje się na spacji i zwraca 1.
    expect(parsePresetsCents("1 234,56")).toEqual([100, 5600]);
  });

  it("fragment nieliczbowy znika BEZ ŚLADU, reszta listy wchodzi", () => {
    expect(parsePresetsCents("25, dwadzieścia, 100")).toEqual([2500, 10000]);
  });

  it("jednostka doklejona do liczby jest przyjmowana w ciszy: `25 zł` to 2500 gr", () => {
    // `parseFloat` czyta prefiks liczbowy i ignoruje ogon. Administrator, który
    // wpisze jednostki, nie dostanie ostrzeżenia - dostanie kwoty.
    expect(parsePresetsCents("25 zł, 50 PLN")).toEqual([2500, 5000]);
  });

  it("kwota poniżej grosza znika: `0.001` zaokrągla się do 0 i wypada przez `> 0`", () => {
    expect(parsePresetsCents("0.001, 25")).toEqual([2500]);
  });

  it("zero i kwoty ujemne są odrzucane", () => {
    expect(parsePresetsCents("0, -25, -0.5, 10")).toEqual([1000]);
  });

  it("dziewiąty preset i dalsze są ucinane BEZ OSTRZEŻENIA", () => {
    const dziewiec = "1, 2, 3, 4, 5, 6, 7, 8, 9";
    expect(parsePresetsCents(dziewiec)).toHaveLength(8);
    expect(parsePresetsCents(dziewiec)).not.toContain(900);
  });

  it("sufit 8 pozycji zgadza się z sufitem schematu zapisu", () => {
    // Gdyby te dwie liczby się rozjechały, panel przyjmowałby listę, której
    // zapis odrzuci - albo ucinałby kwoty, na które zod by pozwolił.
    const dziesiec = Array.from({ length: 10 }, (_, i) => String(i + 1)).join(", ");
    const przyciete = parsePresetsCents(dziesiec);
    expect(() => DonationsConfigSchema.parse({ presetsCents: przyciete })).not.toThrow();
    const dziewiec = Array.from({ length: 9 }, (_, i) => (i + 1) * 100);
    expect(() => DonationsConfigSchema.parse({ presetsCents: dziewiec })).toThrow();
  });

  it("pole PUSTE daje pustą listę - formularz `/donate` bez przycisków kwot", () => {
    expect(parsePresetsCents("")).toEqual([]);
    expect(parsePresetsCents("   ")).toEqual([]);
    expect(parsePresetsCents(",,,")).toEqual([]);
  });

  it("pusta lista przechodzi walidację zapisu - nic jej nie zatrzyma", () => {
    // To jest powód, dla którego poprzedni test opisuje realny skutek
    // użytkowy, a nie tylko dziwny wynik funkcji.
    expect(() => DonationsConfigSchema.parse({ presetsCents: [] })).not.toThrow();
  });

  it("kolejność jest zachowana - pierwsza kwota jest domyślnie zaznaczona w formularzu", () => {
    expect(parsePresetsCents("100, 25, 50")).toEqual([10000, 2500, 5000]);
  });

  it("wynik to zawsze liczby całkowite - grosz nie może być ułamkowy", () => {
    for (const cents of parsePresetsCents("12.345, 0.567, 99.999")) {
      expect(Number.isInteger(cents)).toBe(true);
    }
  });
});

describe("formatPresetsInput: grosze -> zawartość pola", () => {
  it("kwoty pełnozłotowe wracają bez części dziesiętnej", () => {
    expect(formatPresetsInput([2500, 5000, 10000])).toBe("25, 50, 100");
  });

  it("pusta konfiguracja daje pusty napis", () => {
    expect(formatPresetsInput([])).toBe("");
  });

  it("obieg jest wierny TAKŻE dla kwot groszowych - i to wyjaśnia, czemu wada jest niewidoczna", () => {
    // HIPOTEZA, KTÓRĄ TEN TEST OBALIŁ. Zakładałem, że 2550 gr rozpadnie się
    // przy ponownym odczycie na 25 zł i 5 zł. Nie rozpada się: `String(25.5)`
    // daje `"25.5"` z KROPKĄ, a kropka jest jedynym separatorem dziesiętnym,
    // który `parsePresetsCents` rozumie.
    //
    // To jest dokładnie powód, dla którego martwy `replace(",", ".")` przetrwał
    // recenzję: jedyny PRODUCENT zawartości tego pola (formatter powyżej) nigdy
    // nie wstawia przecinka, więc obieg panel -> zapis -> panel jest bezstratny
    // i nic nie wygląda na zepsute. Wada uruchamia się wyłącznie wtedy, gdy
    // kwotę wpisuje CZŁOWIEK po polsku - a tego żaden obieg maszynowy nie robi.
    const zapisane = [2550];
    const wPolu = formatPresetsInput(zapisane);
    expect(wPolu).toBe("25.5");
    expect(parsePresetsCents(wPolu)).toEqual(zapisane);
  });

  it("obieg jest wierny dla kwot pełnozłotowych", () => {
    const zapisane = [2500, 5000, 10000, 25000];
    expect(parsePresetsCents(formatPresetsInput(zapisane))).toEqual(zapisane);
  });
});

describe("parseAmountField: pola min / max / cel", () => {
  it("napis liczbowy przechodzi bez zmiany", () => {
    expect(parseAmountField("50000")).toBe(50000);
  });

  it("pole WYCZYSZCZONE i pole ze ŚMIECIEM dają ten sam wynik: 0", () => {
    // Nieodróżnialność jest tu istotą defektu - panel nie ma jak powiedzieć
    // „to nie jest liczba", bo obie drogi wyglądają dla niego identycznie.
    expect(parseAmountField("")).toBe(0);
    expect(parseAmountField("abc")).toBe(0);
    expect(parseAmountField("")).toBe(parseAmountField("abc"));
  });

  it("`0` jako wpisana wartość też daje 0 - trzecia nieodróżnialna droga", () => {
    expect(parseAmountField("0")).toBe(0);
  });

  it("zero dla `minCents` jest PONIŻEJ minimum operatora, a panel je przyjmuje", () => {
    // Zatrzyma to dopiero schemat przy zapisie - ale dopiero wtedy, i bez
    // wskazania pola.
    expect(parseAmountField("")).toBe(0);
    expect(() => DonationsConfigSchema.parse({ minCents: 0 })).toThrow();
  });

  it("wartość ujemna przechodzi przez pole i jest zatrzymana dopiero przez schemat", () => {
    expect(parseAmountField("-500")).toBe(-500);
    expect(() => DonationsConfigSchema.parse({ goalCents: -500 })).toThrow();
  });

  it("wartość ułamkowa przechodzi przez pole, a `goalCents` musi być całkowite", () => {
    expect(parseAmountField("1234.5")).toBe(1234.5);
    expect(() => DonationsConfigSchema.parse({ goalCents: 1234.5 })).toThrow();
  });

  it("DEFEKT: pole nie pilnuje relacji min <= max", () => {
    // OCZEKIWANE ZACHOWANIE: konfiguracja z minimum wyższym niż maksimum jest
    // odrzucana - z takim ustawieniem `normalizeDonationAmount` zwraca `null`
    // dla KAŻDEJ kwoty, czyli publiczny formularz nie przyjmie żadnej wpłaty.
    // STAN FAKTYCZNY: ani pole, ani schemat tej relacji nie sprawdzają.
    const min = parseAmountField("1000000");
    const max = parseAmountField("1000");
    expect(min).toBeGreaterThan(max);
    expect(() => DonationsConfigSchema.parse({ minCents: min, maxCents: max })).not.toThrow();
  });

  it("notacja wykładnicza przechodzi: `1e7` to 10 000 000 gr", () => {
    expect(parseAmountField("1e7")).toBe(10_000_000);
  });
});

describe("coerceProvider / coerceCurrency: <select> konfiguracji", () => {
  it.each([
    ["external", "external"],
    ["stripe", "stripe"],
    ["", "stripe"],
    ["EXTERNAL", "stripe"],
    ["zrzutka", "stripe"],
  ])("silnik %s -> %s", (wejscie, oczekiwane) => {
    expect(coerceProvider(wejscie)).toBe(oczekiwane);
  });

  it.each([
    ["EUR", "EUR"],
    ["PLN", "PLN"],
    ["", "PLN"],
    ["eur", "PLN"],
    ["USD", "PLN"],
  ])("waluta %s -> %s", (wejscie, oczekiwane) => {
    expect(coerceCurrency(wejscie)).toBe(oczekiwane);
  });

  it("nieznana wartość NIE jest sygnalizowana - `USD` po cichu staje się `PLN`", () => {
    // Skutek: zbiórka rozliczana w innej walucie niż wybrana, bez komunikatu.
    expect(coerceCurrency("USD")).toBe("PLN");
    expect(coerceProvider("payu")).toBe("stripe");
  });

  it("oba warianty każdego <select> przechodzą walidację zapisu", () => {
    for (const provider of ["stripe", "external"] as const) {
      expect(() => DonationsConfigSchema.parse({ provider })).not.toThrow();
    }
    for (const currency of ["PLN", "EUR"] as const) {
      expect(() => DonationsConfigSchema.parse({ currency })).not.toThrow();
    }
  });
});

describe("coerceSyncEnvironment: środowisko synchronizacji ze Stripe", () => {
  it("`live` to jedyna droga do produkcyjnych płatności", () => {
    expect(coerceSyncEnvironment("live")).toBe("live");
  });

  it.each(["sandbox", "", "LIVE", "production", "prod"])(
    "%s -> sandbox: kierunek pomyłki jest BEZPIECZNY",
    (wejscie) => {
      // To jedyny z trzech `<select>` w tym panelu, w którym milcząca wartość
      // domyślna działa na korzyść - `production` wpisane ręcznie nie ruszy
      // prawdziwych pieniędzy.
      expect(coerceSyncEnvironment(wejscie)).toBe("sandbox");
    },
  );
});
