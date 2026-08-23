// Reguły formularza „Nowy kupon B2B” - jedyna bramka, która stoi między
// redaktorem a tabelą `b2b_coupons`. TU LEŻĄ PIENIĄDZE.
//
// CO TEN PLIK DOWODZI.
//   1. TRZY ODMOWY WYCHODZĄ KLUCZEM i18n, NIE NAPISEM, i nie powstaje przy nich
//      żaden ładunek. Baza ma własne CHECK-i (`discount_percent BETWEEN 1 AND
//      100`, `discount_cents > 0`), więc panel jest DRUGĄ linią - ale to on
//      decyduje, czy operator przeczyta zdanie po polsku, czy komunikat
//      Postgresa. Test pilnuje GRANIC (1 i 100 przechodzą), bo przesunięcie
//      o jeden nie zmienia niczego w tsc ani w recenzji.
//   2. `NaN` MIJA OBIE BRAMKI ZAKRESU. `NaN < 1` i `NaN > 100` są fałszem, więc
//      wartość nieliczbowa z pola procentu/kwoty jedzie do bazy. To defekt
//      o skutku pieniężnym, zgłoszony parą `it.fails` + `it`.
//   3. LIMIT UŻYĆ: puste pole to „bez limitu” (null), a wartość nieliczbowa daje
//      `NaN`, który `JSON.stringify` zamienia na `null` - czyli kupon
//      NIEOGRANICZONY zamiast błędu. To najdroższy defekt tej powierzchni.
//   4. ŁADUNEK MA DOKŁADNIE JEDNO POLE RABATU NIEPUSTE - przełączenie rodzaju
//      po wpisaniu kwoty NIE zostawia sieroty (hipoteza OBALONA), bo oba pola
//      liczą się z bieżącego `kind`. CHECK `b2b_coupons_discount_shape` nie ma
//      więc czego odrzucać.
//   5. SIEROTA JEST GDZIE INDZIEJ: `grants_duration_days` nie jest bramkowane
//      przez `grants_tier_key`, więc do bazy idzie liczba dni subskrypcji,
//      której nie ma czego dotyczyć.
//   6. WALUTA jedzie WYŁĄCZNIE przy rabacie kwotowym (waluty bez kwoty wysłać
//      się nie da), ale KWOTA BEZ WALUTY przechodzi - kolumna `currency` jako
//      jedyna z tej piątki nie ma CHECK-a w bazie.
//   7. DATA NIEPARSOWALNA nie jest odmową, tylko WYJĄTKIEM z `toISOString()`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Samego `normalizeCouponCode` - ma dowód
// w `coupons.test.ts`; tutaj dowodzimy, że formularz go UŻYWA. (2) CHECK-ów
// bazy - pilnuje ich pgTAP. (3) Skutków odmowy w interfejsie (toast, otwarty
// dialog) - to `components/admin/coupons/__tests__/CouponCreateDialog.test.tsx`.
import { describe, expect, it } from "vitest";
import {
  buildCouponInsert,
  validateCouponForm,
  type CouponFormInput,
} from "@/lib/billing/couponAdminForm";

/** Formularz w stanie, w jakim otwiera się dialog (procent 10, kwota 1000). */
function form(overrides: Partial<CouponFormInput> = {}): CouponFormInput {
  return {
    code: "NES-B2B-10",
    name: "",
    description: "",
    kind: "percent",
    percent: 10,
    cents: 1000,
    currency: "PLN",
    maxRedemptions: "",
    validFrom: undefined,
    validUntil: undefined,
    planIds: [],
    grantsTierKey: "",
    grantsDurationDays: "",
    ...overrides,
  };
}

describe("odmowa zapisu - klucz i18n zamiast komunikatu bazy", () => {
  it("kod złożony z samych spacji jest odrzucony kluczem adminCoupons.enterCode", () => {
    expect(validateCouponForm(form({ code: "   " }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.enterCode",
    });
  });

  it("pusty kod jest odrzucony zanim panel spojrzy na rabat (kolejność bramek)", () => {
    // Procent też jest błędny - wygrywa jednak brak kodu, bo stoi pierwszy.
    expect(validateCouponForm(form({ code: "", percent: 500 }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.enterCode",
    });
  });

  it.each([
    ["zero", 0],
    ["ponad sto", 101],
    ["ujemny", -5],
  ])("procent %s NIE wychodzi z formularza", (_opis, percent) => {
    expect(validateCouponForm(form({ kind: "percent", percent }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.percent1100",
    });
  });

  it.each([
    ["dolna granica", 1],
    ["górna granica", 100],
  ])("procent na granicy zakresu (%s) jest PRZYJĘTY", (_opis, percent) => {
    expect(validateCouponForm(form({ kind: "percent", percent }))).toEqual({ ok: true });
  });

  it.each([
    ["zerowa", 0],
    ["ujemna", -100],
  ])("kwota %s NIE wychodzi z formularza", (_opis, cents) => {
    expect(validateCouponForm(form({ kind: "fixed", cents }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.amount0",
    });
  });

  it("zły procent NIE blokuje kuponu kwotowego (bramka patrzy na rodzaj rabatu)", () => {
    expect(validateCouponForm(form({ kind: "fixed", cents: 5000, percent: 999 }))).toEqual({
      ok: true,
    });
  });
});

describe("DEFEKT: wartość nieliczbowa mija bramkę zakresu", () => {
  // Para do usunięcia RAZEM po naprawie: `it.fails` opisuje zachowanie
  // OCZEKIWANE, sąsiedni `it` - stan faktyczny.
  it.fails("procent NaN powinien zostać odrzucony kluczem adminCoupons.percent1100", () => {
    expect(validateCouponForm(form({ kind: "percent", percent: Number.NaN }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.percent1100",
    });
  });

  it("STAN FAKTYCZNY: procent NaN przechodzi walidację i ląduje w kolumnie rabatu", () => {
    expect(validateCouponForm(form({ kind: "percent", percent: Number.NaN }))).toEqual({
      ok: true,
    });
    const payload = buildCouponInsert(form({ kind: "percent", percent: Number.NaN }));
    expect(Number.isNaN(payload.discount_percent)).toBe(true);
    // Po serializacji NaN staje się `null`, więc baza dostaje kupon procentowy
    // BEZ procentu i odrzuca go CHECK-iem kształtu - komunikatem po angielsku.
    expect(JSON.parse(JSON.stringify(payload)).discount_percent).toBeNull();
  });

  it.fails("kwota NaN powinna zostać odrzucona kluczem adminCoupons.amount0", () => {
    expect(validateCouponForm(form({ kind: "fixed", cents: Number.NaN }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.amount0",
    });
  });

  it("STAN FAKTYCZNY: kwota NaN przechodzi walidację (NaN <= 0 jest fałszem)", () => {
    expect(validateCouponForm(form({ kind: "fixed", cents: Number.NaN }))).toEqual({ ok: true });
    expect(
      Number.isNaN(buildCouponInsert(form({ kind: "fixed", cents: Number.NaN })).discount_cents),
    ).toBe(true);
  });
});

describe("kod kuponu w ładunku", () => {
  it("kod jest przycinany i podnoszony do wielkich liter", () => {
    expect(buildCouponInsert(form({ code: "  nes-b2b-10  " })).code).toBe("NES-B2B-10");
  });

  it("spacja W ŚRODKU kodu przechodzi - normalizacja nie zna klasy znaków", () => {
    expect(validateCouponForm(form({ code: "AB CD" }))).toEqual({ ok: true });
    expect(buildCouponInsert(form({ code: "AB CD" })).code).toBe("AB CD");
  });
});

describe("limit użyć - najdroższe pole formularza", () => {
  it("puste pole oznacza kupon BEZ limitu (null), nie limit zerowy", () => {
    expect(buildCouponInsert(form({ maxRedemptions: "" })).max_redemptions).toBeNull();
  });

  it("wpisana liczba jedzie jako liczba, nie jako napis", () => {
    expect(buildCouponInsert(form({ maxRedemptions: "5" })).max_redemptions).toBe(5);
  });

  it.fails("limit nieliczbowy powinien zostać odrzucony przed zapisem", () => {
    expect(validateCouponForm(form({ maxRedemptions: "12abc" }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.numberInvalid",
    });
  });

  it("STAN FAKTYCZNY: limit '12abc' daje NaN, który po serializacji jest NULLEM - kupon nieograniczony", () => {
    const payload = buildCouponInsert(form({ maxRedemptions: "12abc" }));
    expect(Number.isNaN(payload.max_redemptions)).toBe(true);
    // To jest cały skutek pieniężny: operator wpisał limit, a baza dostaje
    // `null`, czyli rabat do zrealizowania dowolną liczbę razy.
    expect(JSON.parse(JSON.stringify(payload)).max_redemptions).toBeNull();
  });
});

describe("kształt rabatu - dokładnie jedno pole niepuste", () => {
  it("kupon procentowy nie niesie ani kwoty, ani waluty", () => {
    const payload = buildCouponInsert(form({ kind: "percent", percent: 10, cents: 5000 }));
    expect(payload).toMatchObject({
      discount_kind: "percent",
      discount_percent: 10,
      discount_cents: null,
      currency: null,
    });
  });

  it("przełączenie rodzaju po wpisaniu kwoty NIE zostawia sieroty w discount_cents", () => {
    // Hipoteza o sierocie w parze discount_* jest OBALONA: oba pola liczą się
    // z bieżącego `kind`, więc wartość porzucona w stanie nie wychodzi.
    const payload = buildCouponInsert(form({ kind: "percent", percent: 10, cents: 5000 }));
    expect(payload.discount_cents).toBeNull();
  });

  it("kupon kwotowy nie niesie procentu, a walutę podnosi do wielkich liter", () => {
    const payload = buildCouponInsert(
      form({ kind: "fixed", cents: 2500, currency: "eur", percent: 77 }),
    );
    expect(payload).toMatchObject({
      discount_kind: "fixed",
      discount_percent: null,
      discount_cents: 2500,
      currency: "EUR",
    });
  });
});

describe("DEFEKT: kwota bez waluty", () => {
  it.fails("pusta waluta przy rabacie kwotowym powinna zostać odrzucona", () => {
    expect(validateCouponForm(form({ kind: "fixed", cents: 1000, currency: "" }))).toEqual({
      ok: false,
      errorKey: "adminCoupons.currencyRequired",
    });
  });

  it("STAN FAKTYCZNY: kwota 10.00 jedzie z pustą walutą, a kolumna nie ma CHECK-a", () => {
    const payload = buildCouponInsert(form({ kind: "fixed", cents: 1000, currency: "" }));
    expect(payload.currency).toBe("");
    expect(payload.discount_cents).toBe(1000);
  });
});

describe("DEFEKT: subskrypcja bez warstwy", () => {
  it("liczba dni podana RAZEM z warstwą jedzie w parze", () => {
    const payload = buildCouponInsert(form({ grantsTierKey: "gold", grantsDurationDays: "30" }));
    expect(payload).toMatchObject({ grants_tier_key: "gold", grants_duration_days: 30 });
  });

  it.fails("powrót do „Brak” powinien wyczyścić liczbę dni w ładunku", () => {
    expect(buildCouponInsert(form({ grantsTierKey: "", grantsDurationDays: "30" }))).toMatchObject({
      grants_tier_key: null,
      grants_duration_days: null,
    });
  });

  it("STAN FAKTYCZNY: dni bez warstwy wychodzą do bazy jako sierota", () => {
    // Kampanie robią to odwrotnie (`durationDays && tierKey`), więc te same
    // dane wpisane w dwóch miejscach panelu dają dwa różne wiersze.
    expect(buildCouponInsert(form({ grantsTierKey: "", grantsDurationDays: "30" }))).toMatchObject({
      grants_tier_key: null,
      grants_duration_days: 30,
    });
  });
});

describe("zakres ważności", () => {
  it("brak dat oznacza kupon bezterminowy (null w obu kolumnach)", () => {
    expect(buildCouponInsert(form())).toMatchObject({ valid_from: null, valid_until: null });
  });

  it("wybrane daty jadą jako ISO w UTC", () => {
    const payload = buildCouponInsert(
      form({
        validFrom: new Date("2026-01-05T10:00:00.000Z"),
        validUntil: new Date("2026-03-01T23:59:00.000Z"),
      }),
    );
    expect(payload.valid_from).toBe("2026-01-05T10:00:00.000Z");
    expect(payload.valid_until).toBe("2026-03-01T23:59:00.000Z");
  });

  it.fails("data nieparsowalna powinna być ODMOWĄ walidacji, nie wyjątkiem", () => {
    expect(() => buildCouponInsert(form({ validUntil: new Date("garbage") }))).not.toThrow();
  });

  it("STAN FAKTYCZNY: toISOString rzuca RangeError, więc dialog zostaje z wyłączonym przyciskiem", () => {
    // `setBusy(true)` stoi przed budową ładunku, a `setBusy(false)` po zapisie,
    // więc wyjątek zostawia przycisk „Utwórz kupon” martwy do przeładowania.
    expect(() => buildCouponInsert(form({ validUntil: new Date("garbage") }))).toThrow(RangeError);
  });
});

describe("pozostałe kolumny ładunku", () => {
  it("puste pola opisowe jadą jako NULL, nie jako pusty napis", () => {
    expect(buildCouponInsert(form({ name: "   ", description: "" }))).toMatchObject({
      name: null,
      description: null,
    });
  });

  it("lista planów jedzie taka, jaka przyszła (także pusta)", () => {
    expect(buildCouponInsert(form({ planIds: ["p-1", "p-2"] })).plan_ids).toEqual(["p-1", "p-2"]);
    expect(buildCouponInsert(form()).plan_ids).toEqual([]);
  });

  it("ładunek NIE niesie przypisań CRM - panel ich nie ustawia", () => {
    // `assigned_company_id` / `assigned_lead_id` są pobierane przez listę
    // i deklarowane w typie wiersza, ale nie ma ich ani w formularzu, ani tutaj.
    const keys = Object.keys(buildCouponInsert(form()));
    expect(keys).not.toContain("assigned_company_id");
    expect(keys).not.toContain("assigned_lead_id");
  });
});
