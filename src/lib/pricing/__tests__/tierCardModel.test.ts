// Model karty warstwy - CENA i PRZYCISK ZAKUPU. 0 z 5 funkcji pokrytych do
// 18.08.2026, bo oba automaty stanów siedziały w JSX-ie `TierCard.tsx`
// (476 linii) i nie dały się sprawdzić bez routera, i18n i analityki.
//
// To najdroższe reguły w module: przycisk decyduje, CZY klient może kupić,
// a blok ceny - ILE widzi. Pomyłka nie wywala strony; po cichu zabiera przychód
// albo obiecuje złą kwotę.
import { describe, expect, it } from "vitest";

import { accessPlan } from "@/test/billing/fixtures";
import { membershipTier } from "@/test/admin/pricingFixtures";
import {
  ctaDescriptor,
  ctaVariant,
  intervalSuffixKey,
  priceDisplay,
  splitBenefits,
} from "@/lib/pricing/tierCardModel";

const monthly = accessPlan({
  id: "plan-month",
  interval: "month",
  price_cents: 4900,
  currency: "PLN",
});
const yearly = accessPlan({
  id: "plan-year",
  interval: "year",
  price_cents: 49000,
  currency: "PLN",
});

/** Skrót: co pokazuje karta w miejscu ceny. */
const price = (
  tier = membershipTier(),
  plans = [monthly],
  interval: "month" | "year" = "month",
  lang = "pl",
) => priceDisplay(tier, plans, interval, lang);

/** Skrót: który przycisk dostaje klient. */
const cta = (overrides: Partial<Parameters<typeof ctaDescriptor>[0]> = {}) =>
  ctaDescriptor({
    tier: membershipTier(),
    plans: [monthly],
    interval: "month",
    isCurrentTier: false,
    currentPlanId: null,
    isAuthenticated: false,
    ...overrides,
  });

describe("priceDisplay - co widzi klient w miejscu ceny", () => {
  it("warstwa DOMYŚLNA jest bezpłatna", () => {
    const display = price(membershipTier({ is_default: true }));

    expect(display.kind).toBe("free");
    expect(display).not.toHaveProperty("cents");
  });

  it("warstwa domyślna jest bezpłatna NAWET z przypisanym planem", () => {
    // Plan przypisany omyłkowo do warstwy darmowej nie może zamienić jej
    // w płatną - klient widziałby cenę za coś, co ma bez opłaty.
    const display = price(membershipTier({ is_default: true }), [monthly]);

    expect(display.kind).toBe("free");
  });

  it("plan miesięczny pokazuje KWOTĘ w groszach i walucie planu", () => {
    const display = price(membershipTier(), [monthly]);

    expect(display).toMatchObject({ kind: "amount", cents: 4900, currency: "PLN" });
    expect(display).toMatchObject({ intervalKey: "pricing.perMonth" });
  });

  it("plan roczny pokazuje REALNĄ oszczędność wobec dwunastu miesięcznych", () => {
    // 49000 zamiast 12 x 4900 = 58800 -> 17%.
    const display = price(membershipTier(), [monthly, yearly], "year");

    expect(display).toMatchObject({ kind: "amount", cents: 49000, savingsPct: 17 });
  });

  it("plan roczny BEZ planu miesięcznego nie pokazuje oszczędności (nie ma odniesienia)", () => {
    const display = price(membershipTier(), [yearly], "year");

    expect(display).toMatchObject({ kind: "amount", cents: 49000 });
    expect((display as { savingsPct: number | null }).savingsPct).toBeNull();
  });

  it("oszczędność liczy się TYLKO dla okresu rocznego", () => {
    const display = price(membershipTier(), [monthly, yearly], "month");

    expect(display).toMatchObject({ intervalKey: "pricing.perMonth" });
    expect((display as { savingsPct: number | null }).savingsPct).toBeNull();
  });

  it("plan w INNEJ WALUCIE niż roczny nie daje oszczędności (kwoty nieporównywalne)", () => {
    const eurMonthly = accessPlan({
      id: "m-eur",
      interval: "month",
      price_cents: 1200,
      currency: "EUR",
    });
    const display = price(membershipTier(), [eurMonthly, yearly], "year");

    expect((display as { savingsPct: number | null }).savingsPct).toBeNull();
  });

  it("brak planu i tryb „bez przycisku” daje TYLKO NA ZAPROSZENIE", () => {
    const display = price(membershipTier({ cta_mode: "none" }), []);

    expect(display.kind).toBe("invitationOnly");
  });

  it("brak planu w sprzedaży samoobsługowej daje OFERTĘ NA ZAPYTANIE", () => {
    const display = price(membershipTier({ cta_mode: "auto" }), []);

    expect(display.kind).toBe("onRequest");
  });

  it("„tylko na zaproszenie” wyprzedza „na zapytanie” - nie ma o co pytać", () => {
    expect(price(membershipTier({ cta_mode: "none" }), []).kind).toBe("invitationOnly");
    expect(price(membershipTier({ cta_mode: "contact" }), []).kind).toBe("onRequest");
  });

  it("plan ZA MIEJSCE pokazuje cenę „od” i dopisek za miejsce", () => {
    const display = price(membershipTier({ per_seat: true }), [monthly]);

    expect(display).toMatchObject({ fromPrefix: true, perSeat: true });
  });

  it("zwykły plan nie dostaje ani „od”, ani „za miejsce”", () => {
    const display = price(membershipTier({ per_seat: false }), [monthly]);

    expect(display).toMatchObject({ fromPrefix: false, perSeat: false });
  });

  it("nota cenowa redakcji przechodzi w języku strony", () => {
    const tier = membershipTier({ price_note_pl: "2-20 miejsc", price_note_en: "2-20 seats" });

    expect(price(tier, [monthly], "month", "pl").note).toBe("2-20 miejsc");
    expect(price(tier, [monthly], "month", "en").note).toBe("2-20 seats");
  });

  it("brak noty daje `null`, nie pusty napis", () => {
    const display = price(membershipTier({ price_note_pl: null, price_note_en: null }), [monthly]);

    expect(display.note).toBeNull();
  });

  it("nota z samych spacji też schodzi na `null`", () => {
    const display = price(membershipTier({ price_note_pl: "   " }), [monthly]);

    expect(display.note).toBeNull();
  });
});

describe("intervalSuffixKey - odmiana okresu należy do słownika", () => {
  it("zwraca KLUCZ, nie gotowy napis - test nie zależy od ICU", () => {
    expect(intervalSuffixKey("month")).toBe("pricing.perMonth");
    expect(intervalSuffixKey("year")).toBe("pricing.perYear");
  });

  it("obsługuje wszystkie okresy sprzedawane w serwisie", () => {
    const keys = (
      ["day", "week", "two_weeks", "month", "quarter", "year", "one_time"] as const
    ).map(intervalSuffixKey);

    expect(new Set(keys).size).toBe(7);
    expect(keys).toContain("pricing.perOnce");
  });
});

describe("ctaDescriptor - CZY klient może kupić", () => {
  it("tryb „bez przycisku” wygrywa ZAWSZE, nawet z planem w sprzedaży", () => {
    // Warstwy zamkniętej nie da się kupić ani zapytać o ofertę.
    expect(cta({ tier: membershipTier({ cta_mode: "none" }), plans: [monthly] }).kind).toBe("none");
  });

  it("warstwa domyślna dla NIEZALOGOWANEGO prowadzi do rejestracji, nie do płatności", () => {
    const result = cta({ tier: membershipTier({ is_default: true }), isAuthenticated: false });

    expect(result.kind).toBe("signup");
  });

  it("warstwa domyślna dla ZALOGOWANEGO nie ma przycisku - już ją ma", () => {
    const result = cta({ tier: membershipTier({ is_default: true }), isAuthenticated: true });

    expect(result.kind).toBe("none");
  });

  it("warstwa domyślna, na której klient JEST, pokazuje „obecna warstwa”", () => {
    const result = cta({
      tier: membershipTier({ is_default: true }),
      isCurrentTier: true,
      isAuthenticated: true,
    });

    expect(result.kind).toBe("currentTier");
  });

  it("tryb „kontakt” WYPRZEDZA checkout, nawet gdy plan istnieje", () => {
    // Sprzedaż per miejsce przez checkout jednego miejsca byłaby nieuczciwa.
    const result = cta({ tier: membershipTier({ cta_mode: "contact" }), plans: [monthly] });

    expect(result.kind).toBe("contactDialog");
  });

  it("tryb „kontakt” z adresem redakcji prowadzi TAM, nie do okna", () => {
    const result = cta({
      tier: membershipTier({ cta_mode: "contact", contact_url: "mailto:sprzedaz@example.test" }),
    });

    expect(result).toEqual({ kind: "contactLink", href: "mailto:sprzedaz@example.test" });
  });

  it("tryb „kontakt” na obecnej warstwie nie proponuje rozmowy o tym, co klient ma", () => {
    const result = cta({ tier: membershipTier({ cta_mode: "contact" }), isCurrentTier: true });

    expect(result.kind).toBe("currentTier");
  });

  it("plan w sprzedaży daje CHECKOUT z identyfikatorem i kwotą", () => {
    const result = cta({ plans: [monthly] });

    expect(result).toEqual({
      kind: "checkout",
      planId: "plan-month",
      priceCents: 4900,
      currency: "PLN",
    });
  });

  it("TEN SAM plan, który klient ma, jest wyłączony jako „obecny plan”", () => {
    // Bez tego klient kupiłby drugi raz to samo.
    const result = cta({ plans: [monthly], currentPlanId: "plan-month" });

    expect(result.kind).toBe("currentPlan");
  });

  it("INNY plan tej samej warstwy pokazuje „obecna warstwa”, nie checkout", () => {
    const result = cta({ plans: [yearly], currentPlanId: "plan-month", isCurrentTier: true });

    expect(result.kind).toBe("currentTier");
  });

  it("„obecny plan” wyprzedza „obecna warstwa” - komunikat jest dokładniejszy", () => {
    const result = cta({ plans: [monthly], currentPlanId: "plan-month", isCurrentTier: true });

    expect(result.kind).toBe("currentPlan");
  });

  it("przełącznik okresu wybiera plan, który pójdzie do checkoutu", () => {
    expect(cta({ plans: [monthly, yearly], interval: "year" })).toMatchObject({
      planId: "plan-year",
      priceCents: 49000,
    });
    expect(cta({ plans: [monthly, yearly], interval: "month" })).toMatchObject({
      planId: "plan-month",
    });
  });

  it("warstwa WSPIERAJĄCA bez planu prowadzi do darowizny, nie do checkoutu", () => {
    const result = cta({ tier: membershipTier({ key: "supporter" }), plans: [] });

    expect(result.kind).toBe("supporter");
  });

  it("warstwa bez planu i bez adresu kontaktowego otwiera okno rozmowy", () => {
    const result = cta({ tier: membershipTier({ contact_url: null }), plans: [] });

    expect(result.kind).toBe("contactDialog");
  });

  it("warstwa bez planu z adresem redakcji prowadzi tym adresem", () => {
    const result = cta({ tier: membershipTier({ contact_url: "/kontakt" }), plans: [] });

    expect(result).toEqual({ kind: "contactLink", href: "/kontakt" });
  });

  it("warstwa bez planu, na której klient JEST, nie zaprasza do rozmowy", () => {
    const result = cta({ plans: [], isCurrentTier: true });

    expect(result.kind).toBe("currentTier");
  });

  it("NIEZNANY tryb z bazy zachowuje się jak „auto” - nie blokuje zakupu", () => {
    const result = cta({ tier: membershipTier({ cta_mode: "cokolwiek" }), plans: [monthly] });

    expect(result.kind).toBe("checkout");
  });
});

describe("ctaVariant - wyróżniona warstwa przyciąga wzrok", () => {
  it("warstwa wyróżniona dostaje pełny kolor", () => {
    expect(ctaVariant({ highlight: true })).toBe("default");
    expect(ctaVariant({ highlight: false })).toBe("outline");
  });
});

describe("splitBenefits - każda obietnica dokładnie raz", () => {
  const b = (pl: string, en = pl) => ({ pl, en });

  it("benefit ze spotlightu NIE WRACA na pełnej liście", () => {
    const all = [b("Poranny briefing"), b("Klub dyskusyjny"), b("Sieć ekspertów")];

    const split = splitBenefits(all, [b("Klub dyskusyjny")], "pl");

    expect(split.rest.map((x) => x.pl)).toEqual(["Poranny briefing", "Sieć ekspertów"]);
    expect(split.highlights).toHaveLength(1);
  });

  it("porównanie ignoruje wielkość liter i spacje - to ta sama obietnica", () => {
    const all = [b("  Klub Dyskusyjny  "), b("Sieć ekspertów")];

    const split = splitBenefits(all, [b("klub dyskusyjny")], "pl");

    expect(split.rest.map((x) => x.pl)).toEqual(["Sieć ekspertów"]);
  });

  it("porównanie idzie po tekście W JĘZYKU STRONY, bo to on jest czytany", () => {
    const all = [{ pl: "Briefing", en: "Morning briefing" }, b("Klub")];

    const enSplit = splitBenefits(all, [{ pl: "inny", en: "Morning briefing" }], "en");
    const plSplit = splitBenefits(all, [{ pl: "inny", en: "Morning briefing" }], "pl");

    expect(enSplit.rest.map((x) => x.pl)).toEqual(["Klub"]);
    expect(plSplit.rest).toHaveLength(2);
  });

  it("ze spotlightem zostają najwyżej CZTERY pozostałe pozycje", () => {
    const all = Array.from({ length: 12 }, (_, i) => b(`Benefit ${i}`));

    const split = splitBenefits(all, [b("Wyróżnienie")], "pl");

    expect(split.rest).toHaveLength(4);
    expect(split.rest[0].pl).toBe("Benefit 0");
  });

  it("BEZ spotlightu zostaje do OŚMIU pozycji - karta nie ma czym się chwalić inaczej", () => {
    const all = Array.from({ length: 12 }, (_, i) => b(`Benefit ${i}`));

    const split = splitBenefits(all, [], "pl");

    expect(split.rest).toHaveLength(8);
    expect(split.highlights).toEqual([]);
  });

  it("brak spotlightu (`undefined`) działa jak pusty - limit ośmiu", () => {
    const all = Array.from({ length: 10 }, (_, i) => b(`Benefit ${i}`));

    const split = splitBenefits(all, undefined, "pl");

    expect(split.rest).toHaveLength(8);
    expect(split.highlights).toEqual([]);
  });

  it("warstwa bez benefitów daje puste listy, nie wyjątek", () => {
    const split = splitBenefits([], undefined, "pl");

    expect(split.rest).toEqual([]);
    expect(split.highlights).toEqual([]);
  });

  it("kolejność pozostałych benefitów jest kolejnością redakcji", () => {
    const all = [b("Trzeci"), b("Pierwszy"), b("Drugi")];

    const split = splitBenefits(all, undefined, "pl");

    expect(split.rest.map((x) => x.pl)).toEqual(["Trzeci", "Pierwszy", "Drugi"]);
  });
});
