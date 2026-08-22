// KUPON RETENCYJNY - granice ważności, granice rabatu i przewidywalność kodu.
//
// CO TEN PLIK DOWODZI. To trzy funkcje, które wchodzą do przepływu anulowania
// subskrypcji: użytkownik klika „zostaję", a `acceptRetentionOffer` zapisuje na
// ich podstawie PRAWDZIWY wiersz w `b2b_coupons` (kod, procent, data ważności).
// Pomyłka w każdej z nich kosztuje pieniądze albo dostęp:
//
//   1. GRANICA WAŻNOŚCI. `couponValidUntil` wyznacza moment, po którym checkout
//      odrzuca kupon (błąd `expired`). Sekunda w złą stronę to albo kupon
//      martwy w dniu, w którym obiecaliśmy go w mailu, albo rabat żyjący dłużej,
//      niż wolno. Tu sprawdzamy trzy punkty: dokładnie w momencie wygaśnięcia,
//      sekundę przed i sekundę po.
//   2. GRANICA RABATU. Procent trafia zarówno do CZYTANEGO kodu (`SAVE30-…`),
//      jak i do kolumny `discount_percent`. Rabat 100% albo większy to faktura
//      na zero (lub poniżej zera) i darmowa subskrypcja bez końca; rabat 0% to
//      kupon, który nic nie robi, wystawiony osobie właśnie ratowanej od
//      odejścia. Klamra [1, 90] musi trzymać OBA końce - i musi być zgodna
//      z CHECK-iem w bazie, bo to on jest realną ostatnią linią obrony.
//   3. PRZEWIDYWALNOŚĆ KODU. Sufiks powstaje z bajtów `randomBytes`. Alfabet bez
//      0/O i 1/I jest po to, żeby kod dał się podyktować przez telefon; równy
//      podział 256/32 jest po to, żeby modulo nie faworyzowało części znaków -
//      inaczej kody da się zgadywać, a kupon jest per tenant unikalny, więc
//      zgadnięcie cudzego to darmowy rabat.
//
// ZEGAR: zero `Date.now()` i zero fałszywych timerów - wszystkie trzy funkcje
// przyjmują czas argumentem, więc data bazowa jest wstrzykiwana wprost.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - TRZECH SZCZĘŚLIWYCH PRZYPADKÓW (30 -> `SAVE30-AB12CD`, klamra 120 -> 90,
//   14 dni): `src/lib/pricing/__tests__/selectors.test.ts` (sekcja o kuponie
//   retencyjnym). Tutaj są GRANICE, zaokrąglenia, DST i zgodność z bazą.
// - SKLEJENIA SERWEROWEGO (własność subskrypcji, okno 180 dni, kolizja kodu,
//   zapis do `retention_feedback`): `src/lib/retention/__tests__/functions.test.ts`.
// - WALIDACJI KUPONU W CHECKOUCIE (aktywność, limit użyć, `expired`): to warstwa
//   SQL i pgTAP, nie vitest.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  couponSuffixFromBytes,
  couponValidUntil,
  retentionCouponCode,
} from "@/lib/retention/coupon";
import { normalizeCouponCode } from "@/lib/billing/coupons";

/** Migracja, która stworzyła `retention_settings` wraz z CHECK-ami. */
const MIGRACJA = "supabase/migrations/20260722230000_pricing_catalog_v3_retention.sql";

/** Stała data bazowa. Sekundy i milisekundy są NIEZEROWE celowo - patrz niżej. */
const TERAZ = new Date("2026-03-02T08:15:30.500Z");
const DOBA_MS = 24 * 60 * 60 * 1000;

/** Znaki, których alfabet kodu nie ma prawa zawierać (dyktowanie przez telefon). */
const ZNAKI_DWUZNACZNE = ["0", "O", "1", "I"];

describe("granica ważności kuponu", () => {
  it("data ważności to dokładnie N pełnych dób od podanej chwili", () => {
    expect(couponValidUntil(TERAZ, 14).toISOString()).toBe("2026-03-16T08:15:30.500Z");
    expect(couponValidUntil(TERAZ, 1).getTime() - TERAZ.getTime()).toBe(DOBA_MS);
    expect(couponValidUntil(TERAZ, 90).getTime() - TERAZ.getTime()).toBe(90 * DOBA_MS);
  });

  it("SEKUNDA PRZED wygaśnięciem jeszcze się mieści, SEKUNDA PO już nie", () => {
    // Dokładnie ten warunek stawia checkout: `now < valid_until`. Trzy punkty
    // wokół granicy pokazują, że moment wygaśnięcia jest jednoznaczny i że
    // sama chwila wygaśnięcia NIE jest już ważna.
    const doKiedy = couponValidUntil(TERAZ, 14);
    const sekundaPrzed = new Date(doKiedy.getTime() - 1000);
    const dokladnie = new Date(doKiedy.getTime());
    const sekundaPo = new Date(doKiedy.getTime() + 1000);

    expect(sekundaPrzed < doKiedy).toBe(true);
    expect(dokladnie < doKiedy).toBe(false);
    expect(dokladnie.getTime()).toBe(doKiedy.getTime());
    expect(sekundaPo > doKiedy).toBe(true);
  });

  it("STAN FAKTYCZNY: ważność kończy się o TEJ SAMEJ godzinie, nie na koniec dnia", () => {
    // Opis rzeczywistości, nie życzenie. Komentarz w module mówi „koniec dnia po
    // stronie serwera", ale sama funkcja przenosi godzinę, minutę, sekundę
    // i milisekundę bez zmian. Konsekwencja dla użytkownika: kto zaakceptował
    // ofertę o 23:59, ma kupon do 23:59 czternastego dnia - a nie do jego końca.
    const doKiedy = couponValidUntil(TERAZ, 14);
    expect(doKiedy.getUTCHours()).toBe(TERAZ.getUTCHours());
    expect(doKiedy.getUTCMinutes()).toBe(TERAZ.getUTCMinutes());
    expect(doKiedy.getUTCSeconds()).toBe(TERAZ.getUTCSeconds());
    expect(doKiedy.getUTCMilliseconds()).toBe(TERAZ.getUTCMilliseconds());
  });

  it("STAN FAKTYCZNY: przez zmianę czasu doba to 24 h, więc godzina lokalna się przesuwa", () => {
    // Liczymy w milisekundach, nie w dniach kalendarzowych. Kupon wystawiony
    // przed ostatnią niedzielą marca wygasa o godzinę PÓŹNIEJ czasu lokalnego,
    // niż został wystawiony. Sprawdzamy to w strefie `Europe/Warsaw` niezależnie
    // od strefy maszyny, na której idzie test.
    const wystawiony = new Date("2026-03-20T12:00:00.000Z");
    const doKiedy = couponValidUntil(wystawiony, 14);
    const godzinaWarszawska = (date: Date): string =>
      new Intl.DateTimeFormat("pl-PL", {
        timeZone: "Europe/Warsaw",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);

    expect(doKiedy.toISOString()).toBe("2026-04-03T12:00:00.000Z");
    expect(godzinaWarszawska(wystawiony)).toBe("13:00");
    expect(godzinaWarszawska(doKiedy)).toBe("14:00");
  });

  it("nie mutuje podanej chwili", () => {
    // `functions.ts` podaje ten sam obiekt `new Date()` dalej do zapisu -
    // mutacja przesunęłaby też znacznik czasu wiersza.
    const kopia = TERAZ.getTime();
    couponValidUntil(TERAZ, 30);
    expect(TERAZ.getTime()).toBe(kopia);
  });

  it.each([
    [0, 1],
    [-5, 1],
    [-0.4, 1],
    [0.4, 1],
    [0.5, 1],
    [1, 1],
    [1.4, 1],
    [1.5, 2],
    [89.5, 90],
    [90, 90],
    [90.4, 90],
    [90.5, 90],
    [500, 90],
  ])("liczba dni %j daje %i pełnych dób (klamra 1..90 z zaokrągleniem)", (podane, oczekiwane) => {
    const doKiedy = couponValidUntil(TERAZ, podane);
    expect((doKiedy.getTime() - TERAZ.getTime()) / DOBA_MS).toBe(oczekiwane);
  });

  it("STAN FAKTYCZNY: `NaN` dni daje datę nieprawidłową, a nie datę domyślną", () => {
    // Nieosiągalne z produkcji: `coupon_valid_days` jest `integer NOT NULL`
    // z CHECK-iem 1..90 (patrz test zgodności z bazą niżej). Zapisuję to jednak,
    // bo konsekwencja byłaby ostra: `functions.ts:134` woła
    // `validUntil.toISOString()`, co na nieprawidłowej dacie RZUCA `RangeError` -
    // czyli użytkownik, który właśnie kliknął „zostaję", zobaczyłby błąd
    // zamiast kuponu, a subskrypcja zostałaby w limbo.
    expect(Number.isNaN(couponValidUntil(TERAZ, Number.NaN).getTime())).toBe(true);
    expect(() => couponValidUntil(TERAZ, Number.NaN).toISOString()).toThrow(RangeError);
  });
});

describe("granica rabatu", () => {
  /** Procent wyjęty z gotowego kodu - asercje idą na tym, co widzi użytkownik. */
  function procentZKodu(code: string): string {
    const dopasowanie = /^SAVE(.+)-/.exec(code);
    return dopasowanie ? dopasowanie[1] : "";
  }

  it.each([
    [-1000, "1"],
    [-1, "1"],
    [0, "1"],
    [0.4, "1"],
    [0.5, "1"],
    [1, "1"],
    [29.4, "29"],
    [29.6, "30"],
    [30, "30"],
    [89.5, "90"],
    [90, "90"],
    [90.4, "90"],
    [91, "90"],
    [1000, "90"],
  ])("procent %j pojawia się w kodzie jako SAVE%s", (podany, oczekiwany) => {
    expect(procentZKodu(retentionCouponCode(podany, "ABCDEF"))).toBe(oczekiwany);
  });

  it("ŻADNE wejście nie daje rabatu 0% ani 100% - faktura nie zejdzie do zera", () => {
    // Kupon retencyjny jest rabatem PROCENTOWYM (`discount_kind: "percent"`),
    // więc 100% to faktura na zero, a >100% to kwota ujemna. Sweep po całym
    // sensownym zakresie plus wartości skrajne.
    const wejscia = [
      Number.NEGATIVE_INFINITY,
      -1000,
      -0.5,
      0,
      0.001,
      0.5,
      1,
      45.5,
      89.9,
      90,
      99.5,
      100,
      101,
      1e6,
      Number.POSITIVE_INFINITY,
    ];
    for (const wejscie of wejscia) {
      const pct = Number(procentZKodu(retentionCouponCode(wejscie, "ABCDEF")));
      expect(pct, `procent poza klamrą dla wejścia ${wejscie}`).toBeGreaterThanOrEqual(1);
      expect(pct, `procent poza klamrą dla wejścia ${wejscie}`).toBeLessThanOrEqual(90);
    }
  });

  it("zaokrągla do najbliższej całości, więc nie gubi ani nie dokłada groszy w dół", () => {
    // Procent jest w bazie liczbą CAŁKOWITĄ, więc jedyne, co można tu zgubić,
    // to część dziesiętna wpisana w panelu. Kod ZAOKRĄGLA (a nie ucina): przy
    // ustawieniu 29,6% na fakturze 1000 zł rabat wynosi 300 zł, nie 290 zł.
    expect(retentionCouponCode(29.6, "ABCDEF")).toBe("SAVE30-ABCDEF");
    expect(retentionCouponCode(29.4, "ABCDEF")).toBe("SAVE29-ABCDEF");
  });

  it("KLAMRA W KODZIE ZGADZA SIĘ Z CHECK-iem W BAZIE", () => {
    // To jest najważniejsza asercja w tej grupie. Klamra w JS jest tylko drugą
    // linią obrony - realnym strażnikiem jest CHECK w `retention_settings`,
    // bo `functions.ts:132` zapisuje do `discount_percent` wartość
    // `settings.discount_pct` BEZ przejścia przez `retentionCouponCode`.
    // Gdyby ktoś rozluźnił CHECK do 1..100, kod na kuponie nadal mówiłby
    // „SAVE90", a wiersz dawałby 100% - czyli darmowa subskrypcja przy kodzie
    // obiecującym 90%. Ten test każe wtedy wrócić do tego pliku.
    const sql = readFileSync(MIGRACJA, "utf8");
    expect(sql).toContain(
      "discount_pct integer NOT NULL DEFAULT 30 CHECK (discount_pct BETWEEN 1 AND 90)",
    );
    expect(sql).toContain(
      "coupon_valid_days integer NOT NULL DEFAULT 14 CHECK (coupon_valid_days BETWEEN 1 AND 90)",
    );
    // Te same dwie granice, wyprowadzone z zachowania kodu.
    expect(retentionCouponCode(-1, "X")).toBe("SAVE1-X");
    expect(retentionCouponCode(1000, "X")).toBe("SAVE90-X");
    expect((couponValidUntil(TERAZ, -1).getTime() - TERAZ.getTime()) / DOBA_MS).toBe(1);
    expect((couponValidUntil(TERAZ, 1000).getTime() - TERAZ.getTime()) / DOBA_MS).toBe(90);
  });

  it("STAN FAKTYCZNY: `NaN` procent daje kod `SAVENaN-…`", () => {
    // Nieosiągalne z produkcji (kolumna `integer NOT NULL` + CHECK), ale
    // zapisane, bo moduł nie ma własnego strażnika. Gdyby procent zaczął
    // przychodzić z formularza panelu bez walidacji, użytkownik dostałby
    // w mailu kod, którego checkout nie znajdzie.
    expect(retentionCouponCode(Number.NaN, "ABCDEF")).toBe("SAVENaN-ABCDEF");
  });
});

describe("format kodu", () => {
  it("kod ma kształt SAVE<procent>-<sufiks> i normalizuje sufiks do wielkich liter", () => {
    expect(retentionCouponCode(30, "ab12cd")).toBe("SAVE30-AB12CD");
  });

  it("gotowy kod przechodzi normalizację checkoutu BEZ ZMIANY", () => {
    // Checkout i panel porównują kody po `normalizeCouponCode` (trim + upper).
    // Gdyby kod wychodził stąd z małą literą albo spacją, użytkownik wpisywałby
    // go dokładnie tak, jak dostał w mailu - i dostawał `not_found`.
    const code = retentionCouponCode(30, couponSuffixFromBytes(new Uint8Array([1, 2, 3, 4, 5, 6])));
    expect(normalizeCouponCode(code)).toBe(code);
    expect(code).toMatch(/^SAVE\d{1,2}-[A-Z2-9]{6}$/);
  });

  it("STAN FAKTYCZNY: sufiks NIE jest sprawdzany względem bezpiecznego alfabetu", () => {
    // Świadomy opis rzeczywistości. Produkcja podaje tu wyłącznie wynik
    // `couponSuffixFromBytes`, więc dwuznaczne znaki nie mają skąd przyjść -
    // ale sama funkcja przepuści je bez słowa. Konsekwencja przy ręcznym
    // wywołaniu: kod z „O" i „0", którego nie da się podyktować przez telefon.
    expect(retentionCouponCode(30, "o0il1")).toBe("SAVE30-O0IL1");
  });
});

describe("sufiks z bajtów", () => {
  it("jest deterministyczny i domyślnie sześcioznakowy", () => {
    const bajty = new Uint8Array([7, 12, 31, 32, 200, 255, 99, 1]);
    expect(couponSuffixFromBytes(bajty)).toBe(couponSuffixFromBytes(bajty));
    expect(couponSuffixFromBytes(bajty)).toHaveLength(6);
    expect(couponSuffixFromBytes(bajty, 8)).toHaveLength(8);
    expect(couponSuffixFromBytes(bajty, 1)).toHaveLength(1);
    expect(couponSuffixFromBytes(bajty, 0)).toBe("");
  });

  it("ŻADNA wartość bajtu nie daje znaku dwuznacznego (0/O/1/I)", () => {
    // Sweep po całej przestrzeni bajtu - nie po przykładach.
    const wszystkie = couponSuffixFromBytes(
      new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
      256,
    );
    expect(wszystkie).toHaveLength(256);
    for (const znak of ZNAKI_DWUZNACZNE) {
      expect(wszystkie, `alfabet zawiera dwuznaczny znak ${znak}`).not.toContain(znak);
    }
    expect(wszystkie).toMatch(/^[A-Z2-9]+$/);
  });

  it("modulo jest NIEOBCIĄŻONE - 256 bajtów rozkłada się równo na 32 znaki", () => {
    // Gdyby ktoś dodał albo usunął znak z alfabetu (np. wpuścił z powrotem „O"),
    // 256 % długość przestałoby być zerem i część znaków wypadałaby częściej.
    // Kod kuponu jest per tenant unikalny i daje pieniądze, więc przewidywalność
    // sufiksu to realne ryzyko - nie kosmetyka.
    const wszystkie = couponSuffixFromBytes(
      new Uint8Array(Array.from({ length: 256 }, (_, i) => i)),
      256,
    );
    const licznik = new Map<string, number>();
    for (const znak of wszystkie) licznik.set(znak, (licznik.get(znak) ?? 0) + 1);
    expect(licznik.size).toBe(32);
    expect([...new Set(licznik.values())]).toEqual([8]);
  });

  it("STAN FAKTYCZNY: brakujące bajty dają stałe „A”, więc sufiks przestaje być losowy", () => {
    // Opis rzeczywistości. `bytes[i] ?? 0` wskazuje pierwszy znak alfabetu,
    // więc żądanie dłuższego sufiksu niż jest bajtów DOKLEJA „A". Produkcja
    // podaje 8 bajtów na 6 znaków (`functions.ts:123`), więc to nie zachodzi -
    // ale gdyby ktoś podniósł długość kodu bez podniesienia liczby bajtów,
    // ogon kodu stałby się przewidywalny.
    expect(couponSuffixFromBytes(new Uint8Array([31, 31]), 5)).toBe("99AAA");
    expect(couponSuffixFromBytes(new Uint8Array([]), 3)).toBe("AAA");
  });
});
