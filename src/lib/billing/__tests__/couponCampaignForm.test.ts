// Reguły formularza kampanii kuponowej - JEDYNA bramka panelu przed insertem
// do `b2b_coupon_campaigns` i kształt ładunku, którym kampania rozdaje rabaty.
//
// CO TEN PLIK DOWODZI.
//   1. Bramka zapisu przepuszcza WSZYSTKO poza pustą nazwą. Procent 200, kwota
//      0 i zero kodów wychodzą z panelu bez słowa sprzeciwu - a baza je odrzuci
//      CHECK-iem, więc operator zobaczy angielski komunikat Postgresa zamiast
//      wskazania pola. To przechodzi przez `tsc` (typy się zgadzają) i przez
//      recenzję (walidacja „jest"), a łapie to wyłącznie ten test.
//   2. Dokładnie JEDNO pole rabatu jest niepuste, wybrane przez bieżący `kind` -
//      wartość porzucona w drugim polu nie wychodzi do bazy. To obala hipotezę
//      o sierocie w parze `discount_*`.
//   3. Liczba dni subskrypcji JEST bramkowana warstwą - odwrotnie niż
//      w bliźniaczym formularzu pojedynczego kuponu. Kontrast jest tu nazwany,
//      bo to on decyduje, czy do bazy trafi konfiguracja bez podmiotu.
//   4. Puste pole liczbowe daje 0, a nie „brak" - `Number("")` to zero, więc
//      panel wysyła `code_count: 0` w żądaniu skazanym na odmowę.
//   5. Które akcje pokazuje wiersz o danym statusie - tabelarycznie, po
//      wszystkich czterech wartościach enumu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Arytmetyki pieniędzy (`couponMoney` ma własny
// plik), formatowania kwot (atomy) i tego, co panel robi z ODMOWĄ bazy (to
// dowodzi test organizmu `CampaignCreateDialog`).
import { describe, expect, it } from "vitest";
import {
  buildCampaignInsert,
  campaignActions,
  validateCampaignForm,
  type CampaignFormState,
  type CampaignStatus,
} from "@/lib/billing/couponCampaignForm";

/** Stan formularza dokładnie taki, jaki daje dialog po otwarciu. */
function form(overrides: Partial<CampaignFormState> = {}): CampaignFormState {
  return {
    name: "Q1 2026 VIP",
    description: "",
    prefix: "",
    codeLength: 8,
    codeCount: 100,
    kind: "percent",
    percent: 20,
    cents: 2000,
    currency: "PLN",
    validUntil: undefined,
    tierKey: "",
    durationDays: "30",
    segment: "",
    ...overrides,
  };
}

describe("bramka zapisu kampanii", () => {
  it("pusta nazwa NIE wychodzi z formularza - odmowa niesie klucz i18n, nie gotowy napis", () => {
    const check = validateCampaignForm(form({ name: "   " }));
    expect(check).toEqual({ ok: false, errorKey: "adminCoupons.enterName" });
  });

  it("nazwa z samymi spacjami wokół treści przechodzi i jest przycinana w ładunku", () => {
    expect(validateCampaignForm(form({ name: "  Kampania  " }))).toEqual({ ok: true });
    expect(buildCampaignInsert(form({ name: "  Kampania  " })).name).toBe("Kampania");
  });

  it.each([
    ["procent 200 (baza dopuszcza 1-100)", form({ kind: "percent", percent: 200 })],
    ["procent 0", form({ kind: "percent", percent: 0 })],
    ["kwota 0 (baza wymaga > 0)", form({ kind: "fixed", cents: 0 })],
    ["kwota ujemna", form({ kind: "fixed", cents: -500 })],
    ["zero kodów (baza wymaga > 0)", form({ codeCount: 0 })],
    ["100 000 kodów (baza dopuszcza 10 000)", form({ codeCount: 100000 })],
    ["długość kodu 1 (baza wymaga 4-24)", form({ codeLength: 1 })],
    ["pusta waluta przy rabacie kwotowym", form({ kind: "fixed", currency: "" })],
  ])("panel PRZEPUSZCZA wartość spoza kontraktu bazy: %s", (_nazwa, stan) => {
    // To nie jest opis rzeczy pożądanej, tylko stanu faktycznego: jedyną
    // walidacją jest nazwa, więc żądanie leci i odmawia je dopiero CHECK.
    expect(validateCampaignForm(stan)).toEqual({ ok: true });
  });
});

describe("ładunek insertu kampanii", () => {
  it("rabat procentowy zeruje pole kwoty i walutę - do bazy idzie jedno pole rabatu", () => {
    const insert = buildCampaignInsert(form({ kind: "percent", percent: 10, cents: 5000 }));
    expect(insert.discount_kind).toBe("percent");
    expect(insert.discount_percent).toBe(10);
    expect(insert.discount_cents).toBeNull();
    expect(insert.currency).toBeNull();
  });

  it("rabat kwotowy zeruje procent i podnosi walutę do wielkich liter", () => {
    const insert = buildCampaignInsert(form({ kind: "fixed", percent: 33, currency: "eur" }));
    expect(insert.discount_percent).toBeNull();
    expect(insert.discount_cents).toBe(2000);
    expect(insert.currency).toBe("EUR");
  });

  it("przełączenie typu po wpisaniu kwoty NIE zostawia sieroty w discount_cents", () => {
    // Hipoteza o sierocie w parze `discount_*` jest tu OBALONA: oba pola są
    // liczone z bieżącego `kind`, więc porzucona kwota 5000 nie wychodzi.
    const insert = buildCampaignInsert(form({ kind: "percent", cents: 5000 }));
    expect(insert.discount_cents).toBeNull();
  });

  it("kwota bez waluty przechodzi jako pusty string - kolumna currency nie ma CHECK-a", () => {
    const insert = buildCampaignInsert(form({ kind: "fixed", currency: "" }));
    expect(insert.discount_cents).toBe(2000);
    expect(insert.currency).toBe("");
  });

  it.each([
    ["warstwa + dni", "gold", "30", "gold", 30],
    ["dni bez warstwy - liczba NIE wychodzi", "", "30", null, null],
    ["warstwa bez dni - subskrypcja BEZTERMINOWA", "gold", "", "gold", null],
    ["ani warstwy, ani dni", "", "", null, null],
  ])("grants: %s", (_nazwa, tierKey, durationDays, oczekiwanyTier, oczekiwaneDni) => {
    const insert = buildCampaignInsert(form({ tierKey, durationDays }));
    expect(insert.grants_tier_key).toBe(oczekiwanyTier);
    expect(insert.grants_duration_days).toBe(oczekiwaneDni);
  });

  it("pusty opis i pusty segment idą jako NULL, nie jako pusty string", () => {
    const insert = buildCampaignInsert(form({ description: "   ", segment: "  " }));
    expect(insert.description).toBeNull();
    expect(insert.newsletter_segment).toBeNull();
  });

  it("prefiks jest tylko przycinany - pusty prefiks idzie jako PUSTY STRING, nie NULL", () => {
    expect(buildCampaignInsert(form({ prefix: "  NES-  " })).prefix).toBe("NES-");
    expect(buildCampaignInsert(form({ prefix: "" })).prefix).toBe("");
  });

  it("brak daty ważności daje NULL, a data z kalendarza ISO", () => {
    expect(buildCampaignInsert(form()).valid_until).toBeNull();
    expect(
      buildCampaignInsert(form({ validUntil: new Date("2026-03-01T12:00:00Z") })).valid_until,
    ).toBe("2026-03-01T12:00:00.000Z");
  });

  it("wyczyszczone pole liczby kodów wysyła ZERO, czyli żądanie skazane na odmowę CHECK-a", () => {
    // `Number("")` to 0, a stan dialogu jest liczbowy - pusty input nie znaczy
    // „bez limitu", tylko „zero kodów".
    const insert = buildCampaignInsert(form({ codeCount: Number(""), codeLength: Number("") }));
    expect(insert.code_count).toBe(0);
    expect(insert.code_length).toBe(0);
  });

  it("wartość nieliczbowa w polu liczby kodów daje NaN, który po serializacji staje się NULL", () => {
    const insert = buildCampaignInsert(form({ codeCount: Number("12abc") }));
    expect(Number.isNaN(insert.code_count)).toBe(true);
    // Dowód konsekwencji: supabase-js serializuje ładunek przez JSON.
    expect(JSON.parse(JSON.stringify({ code_count: insert.code_count })).code_count).toBeNull();
  });
});

describe("DEFEKT: niepoprawna data ważności RZUCA zamiast odmówić", () => {
  // `new Date("nie-data").toISOString()` rzuca RangeError. W dialogu
  // `setBusy(true)` stoi PRZED budową ładunku, a `submit` jest wołany bez
  // `catch`, więc taki wyjątek daje ciszę: brak toastu, brak insertu, przycisk
  // „Utwórz kampanię" wyłączony do przeładowania strony. Przez dzisiejszy
  // kalendarz ta wartość nie wchodzi, ale budowa ładunku jest jedynym
  // miejscem, które może ją zatrzymać - i dziś tego nie robi.
  //
  // Para `it.fails` + `it()`; po naprawie (zwrot błędu walidacji zamiast
  // wyjątku) usuwa się OBA RAZEM.
  it.fails("budowa ładunku POWINNA oddać błąd walidacji, a nie rzucić wyjątkiem", () => {
    expect(() => buildCampaignInsert(form({ validUntil: new Date("nie-data") }))).not.toThrow();
  });

  it("STAN FAKTYCZNY: budowa ładunku rzuca RangeError na niepoprawnej dacie", () => {
    expect(() => buildCampaignInsert(form({ validUntil: new Date("nie-data") }))).toThrow(
      RangeError,
    );
  });

  it("bramka zapisu NIE zatrzymuje niepoprawnej daty - sprawdza wyłącznie nazwę", () => {
    expect(validateCampaignForm(form({ validUntil: new Date("nie-data") }))).toEqual({ ok: true });
  });
});

describe("akcje wiersza kampanii jako funkcja statusu", () => {
  it.each([
    ["draft", ["generate", "archive"]],
    ["generated", ["export", "send", "archive"]],
    ["sent", ["archive"]],
    ["archived", []],
  ])("status %s daje akcje %j", (status, oczekiwane) => {
    expect(campaignActions(status as CampaignStatus)).toEqual(oczekiwane);
  });

  it("kampania już wysłana NIE ma przycisku ponownej wysyłki", () => {
    expect(campaignActions("sent")).not.toContain("send");
  });

  it("kampania w wersji roboczej NIE ma eksportu kodów - nie ma czego eksportować", () => {
    expect(campaignActions("draft")).not.toContain("export");
  });
});
