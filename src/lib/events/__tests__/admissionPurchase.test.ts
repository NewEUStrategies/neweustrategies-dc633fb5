// WYCENA I ZAKUP PAKIETU - dwie operacje, ktore dotykaja PIENIEDZY, a ktorych
// zaden test dotad nie wykonal.
//
// WZORZEC PRZYCZYNY. Suita modulu wydarzen testuje CZYTANIE i TWORZENIE, a nie
// testuje usuwania, odwolywania i zmiany statusu. Dwadziescia dziewiec zapytan
// `fetch*` ma pokrycie, dziewietnascie operacji destrukcyjnych - nie. Tutaj
// dokladamy sie do tego z drugiej strony: `admissionApi.test.ts` sprawdza sam
// PARSER odpowiedzi (`parseAdmissionQuote`), a `useEventPackagePurchase.test.ts`
// atrapuje CALY `admissionApi` - wiec `quoteAdmission` i `purchasePackage`
// nie wykonaly sie dotad ani razu. Ladunek, ktory te dwie funkcje skladaja,
// nie byl niczym pilnowany, mimo ze to on rozstrzyga, ile kupujacy zaplaci.
//
// CO TU PILNUJEMY.
//
// 1) KLIENT NIE DYKTUJE KWOTY. Naglowek `admissionApi.ts:1-8` mowi to wprost,
//    a `event_package_purchase` liczy wycene PONOWNIE
//    (`20260825191948:988`). Gdyby do ladunku wjechalo `total_cents` albo
//    `price_cents`, mielibysmy pole, ktoremu ktos kiedys uwierzy - dlatego
//    test wymienia zabronione klucze z nazwy.
// 2) POLE PUSTE TO POLE NIEWYSLANE. Kod rabatowy, nazwa i adres kupujacego
//    jada wylacznie wtedy, gdy po przycieciu cos z nich zostaje. Obecnosc
//    klucza `coupon_code` ma znaczyc „kupujacy podal kod", a nie „ekran mial
//    puste pole" - inaczej echo `coupon_code` z wyceny i wpis na zamowieniu
//    przestaja odrozniac te dwie sytuacje.
// 3) ODMOWA TO DANE, BLAD TO BLAD. `{ ok: false, reason }` wraca ze statusem
//    sukcesu i ma dojechac do ekranu jako powod, a odmowa transportu ma
//    POLECIEC WYJATKIEM. Zamiana ktorejkolwiek z tych dwoch na „wycena zerowa"
//    jest najgorsza pomylka tego ekranu.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE - modul, ktory pokrywamy, jest
// wykonywany naprawde.
//
// RODO: uczestnicy i platnicy sa syntetyczni, adresy wylacznie `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/admissionApi");

const PACKAGE_ID = "9a1b0000-0000-4000-8000-000000000101";
const TICKET_TYPE_ID = "9a1b0000-0000-4000-8000-000000000202";
const ORDER_ID = "9a1b0000-0000-4000-8000-000000000303";
const COMPANY_ID = "9a1b0000-0000-4000-8000-000000000404";

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

/** Ladunek `p_payload` w ksztalcie, w ktorym czyta go funkcja bazy. */
function payloadOf(name: string): Record<string, unknown> {
  const call = rpc().lastCall(name);
  if (call === undefined) throw new Error(`test: ${name} nie zostalo wolane`);
  const payload = call.arg("p_payload");
  if (payload === null || typeof payload !== "object") {
    throw new Error(`test: ${name} dostalo p_payload, ktory nie jest obiektem`);
  }
  return payload as Record<string, unknown>;
}

/** Platnik pakietu - dane syntetyczne, domena dokumentacyjna. */
const buyer: import("@/lib/events/admissionApi").PackagePurchaseInput = {
  packageId: PACKAGE_ID,
  buyerName: "  Zofia Wierzbicka  ",
  buyerEmail: "  Zofia.Wierzbicka@example.com  ",
  companyId: COMPANY_ID,
  invoiceNote: "  PO 2026/114  ",
  couponCode: "  partner2026  ",
};

/** Odpowiedz `event_package_purchase` w ksztalcie z `20260825191948:1044`. */
const purchased = {
  order_id: ORDER_ID,
  seats: 10,
  currency: "PLN",
  total_cents: 225000,
  discount_cents: 25000,
  status: "pending",
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------------- wycena --- */

describe("quoteAdmission - ladunek wyceny", () => {
  it("wycena rodzaju biletu niesie SAM rodzaj biletu", async () => {
    rpc().setData("event_admission_quote", { ok: true, kind: "ticket", total_cents: 12000 });
    await api.quoteAdmission({ ticketTypeId: TICKET_TYPE_ID });

    expect(rpc().names()).toEqual(["event_admission_quote"]);
    expect(Object.keys(payloadOf("event_admission_quote"))).toEqual(["ticket_type_id"]);
    expect(payloadOf("event_admission_quote").ticket_type_id).toBe(TICKET_TYPE_ID);
  });

  it("wycena pakietu niesie SAM pakiet", async () => {
    rpc().setData("event_admission_quote", { ok: true, kind: "package", total_cents: 225000 });
    await api.quoteAdmission({ packageId: PACKAGE_ID });

    expect(Object.keys(payloadOf("event_admission_quote"))).toEqual(["package_id"]);
    expect(payloadOf("event_admission_quote").package_id).toBe(PACKAGE_ID);
  });

  // PUSTY KOD RABATOWY NIE JEST KODEM. Obecnosc klucza `coupon_code` w ladunku
  // ma znaczyc „kupujacy cos wpisal" - zamowienie i echo wyceny czytaja to
  // pole i nie maja jak odroznic pustego napisu od kodu, ktorego nie bylo.
  // Baza sama traktuje `''` jako brak kodu (`20260825191948:711`), wiec to
  // gwarancja KONTRAKTU, a nie oslona przed awaria - i wlasnie dlatego nie
  // wolno jej zgubic po cichu.
  it("pusty i sam bialy znak w kodzie rabatowym NIE trafiaja do ladunku", async () => {
    rpc().setData("event_admission_quote", { ok: true, kind: "package", total_cents: 250000 });

    await api.quoteAdmission({ packageId: PACKAGE_ID, couponCode: "" });
    expect("coupon_code" in payloadOf("event_admission_quote")).toBe(false);

    await api.quoteAdmission({ packageId: PACKAGE_ID, couponCode: "   " });
    expect("coupon_code" in payloadOf("event_admission_quote")).toBe(false);
  });

  it("kod rabatowy jedzie przyciety, bez otaczajacych spacji", async () => {
    rpc().setData("event_admission_quote", { ok: true, kind: "package", total_cents: 225000 });
    await api.quoteAdmission({ packageId: PACKAGE_ID, couponCode: "  PARTNER2026  " });

    expect(payloadOf("event_admission_quote").coupon_code).toBe("PARTNER2026");
  });

  // Baza odrzuca oba identyfikatory naraz (`20260825191948:637-639`), bo nie ma
  // jak zgadnac, co wycenia. Klient ma jej to ODDAC W CALOSCI, a nie wybierac
  // jednego po cichu - cicha decyzja klienta oznacza cene innej pozycji niz ta,
  // ktora kupujacy widzi na ekranie.
  it("oba identyfikatory naraz jada do bazy i to ona odmawia", async () => {
    rpc().setError(
      "event_admission_quote",
      "invalid_payload: give exactly one of ticket_type_id or package_id",
    );

    await expect(
      api.quoteAdmission({ ticketTypeId: TICKET_TYPE_ID, packageId: PACKAGE_ID }),
    ).rejects.toThrow(/invalid_payload/);

    const sent = payloadOf("event_admission_quote");
    expect(Object.keys(sent).sort()).toEqual(["package_id", "ticket_type_id"]);
  });

  it("brak obu identyfikatorow: klient nie zgaduje, ladunek jest pusty", async () => {
    rpc().setError(
      "event_admission_quote",
      "invalid_payload: give exactly one of ticket_type_id or package_id",
    );

    await expect(api.quoteAdmission({})).rejects.toThrow(/invalid_payload/);
    expect(Object.keys(payloadOf("event_admission_quote"))).toEqual([]);
  });
});

describe("quoteAdmission - odmowa a awaria", () => {
  // Odmowa ma DOJECHAC jako dane: „limit na osobe wyczerpany" to stan ekranu,
  // nie awaria - i nie wolno go zamienic na wycene po zero zlotych.
  it("odmowa wraca jako powod z liczbami, a nie jako cena", async () => {
    rpc().setData("event_admission_quote", {
      ok: false,
      reason: "per_person_limit",
      max_per_person: 2,
      owned: 2,
    });

    const quote = await api.quoteAdmission({ ticketTypeId: TICKET_TYPE_ID });
    expect(quote.ok).toBe(false);
    if (quote.ok) return;
    expect(quote.reason).toBe("per_person_limit");
    expect(quote.detail.max_per_person).toBe(2);
    // Ekran nie ma z czego odczytac kwoty - to jest cala roznica miedzy
    // odmowa a wycena „za darmo".
    expect("totalCents" in quote).toBe(false);
  });

  // Awaria transportu (odebrany grant, zerwane polaczenie, blad SQL) NIE jest
  // odmowa sprzedazy. Zamieniona na `{ ok: false }` pokazalaby kupujacemu
  // zdanie o niedostepnej stawce zamiast „sprobuj ponownie", a zamieniona na
  // wycene zerowa - przycisk „kup za 0 zl".
  it("blad RPC jest RZUCANY, a nie zamieniany na wycene zerowa", async () => {
    rpc().setError("event_admission_quote", "42501: permission denied for function", "42501");

    await expect(api.quoteAdmission({ packageId: PACKAGE_ID })).rejects.toThrow(
      /permission denied/,
    );
  });

  it("zgoda przechodzi z kwotami bazy, bez przeliczania po stronie klienta", async () => {
    rpc().setData("event_admission_quote", {
      ok: true,
      kind: "package",
      event_id: "9a1b0000-0000-4000-8000-0000000005ee",
      audience: "academic",
      seats: 10,
      currency: "EUR",
      price_cents: 250000,
      discount_cents: 25000,
      total_cents: 225000,
      coupon_code: "PARTNER2026",
      seats_left: null,
    });

    const quote = await api.quoteAdmission({ packageId: PACKAGE_ID, couponCode: "partner2026" });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;
    expect(quote.totalCents).toBe(225000);
    expect(quote.discountCents).toBe(25000);
    expect(quote.currency).toBe("EUR");
    // Brak limitu zestawow to BRAK LIMITU, nie zero wolnych miejsc.
    expect(quote.seatsLeft).toBeNull();
  });
});

/* -------------------------------------------------------------- zakup --- */

describe("purchasePackage - ladunek zakupu", () => {
  it("klient NIE WYSYLA zadnej kwoty ani waluty", async () => {
    rpc().setData("event_package_purchase", purchased);
    await api.purchasePackage(buyer);

    const sent = payloadOf("event_package_purchase");
    for (const forbidden of [
      "amount_cents",
      "total_cents",
      "price_cents",
      "discount_cents",
      "currency",
      "seats",
      "seats_total",
      "status",
    ]) {
      expect(forbidden in sent, `zakup nie moze dyktowac pola ${forbidden}`).toBe(false);
    }
    expect(Object.keys(sent).sort()).toEqual([
      "buyer_email",
      "buyer_name",
      "company_id",
      "coupon_code",
      "invoice_note",
      "package_id",
    ]);
  });

  // WIELKOSC LITER W ADRESIE ZOSTAJE PO STRONIE BAZY - i tak ma byc. Klient
  // przycina, ale NIE sprowadza do malych liter; robi to
  // `event_package_purchase` (`20260825191948:970`), a ograniczenie
  // `CHECK (buyer_email = lower(btrim(buyer_email)))` (`:281`) pilnuje, ze do
  // tabeli nie wejdzie nic innego. Test pilnuje wiec PRZYCIECIA, a mieszana
  // wielkosc liter jest tu opisem stanu faktycznego, nie wymaganiem - gdyby
  // klient kiedys zaczal normalizowac tak jak `inviteMyPackageSeat`
  // (`admissionApi.ts:294`), to nie bylaby regresja.
  it("napisy jada przyciete - spacje z formularza nie ida na fakture", async () => {
    rpc().setData("event_package_purchase", purchased);
    await api.purchasePackage(buyer);

    const sent = payloadOf("event_package_purchase");
    expect(sent.buyer_name).toBe("Zofia Wierzbicka");
    expect(String(sent.buyer_email).toLowerCase()).toBe("zofia.wierzbicka@example.com");
    expect(String(sent.buyer_email)).not.toMatch(/^\s|\s$/);
    expect(sent.invoice_note).toBe("PO 2026/114");
    expect(sent.coupon_code).toBe("partner2026");
  });

  // Klucz pominiety znaczy „nie mam tej danej"; klucz z pustym napisem
  // znaczylby „wyczysc" i wpisalby pusty adres na zamowieniu, ktore idzie do
  // ksiegowosci.
  it("pola puste i brak firmy sa POMIJANE, zostaje sam pakiet", async () => {
    rpc().setData("event_package_purchase", purchased);
    await api.purchasePackage({
      packageId: PACKAGE_ID,
      buyerName: "   ",
      buyerEmail: "",
      companyId: null,
      invoiceNote: "  ",
      couponCode: "   ",
    });

    expect(Object.keys(payloadOf("event_package_purchase"))).toEqual(["package_id"]);
  });
});

describe("purchasePackage - odczyt potwierdzenia", () => {
  it("kwoty i status z bazy przechodza bez zmian", async () => {
    rpc().setData("event_package_purchase", { ...purchased, currency: "EUR", status: "paid" });

    const result = await api.purchasePackage(buyer);
    expect(result).toEqual({
      orderId: ORDER_ID,
      seats: 10,
      currency: "EUR",
      totalCents: 225000,
      discountCents: 25000,
      status: "paid",
    });
  });

  // Zamowienie bez waluty i bez statusu nie moze wygladac jak zamowienie
  // oplacone w nieznanej walucie: domyslne „PLN" i „pending" to jedyne
  // bezpieczne odczytanie takiej odpowiedzi.
  it("brak waluty i statusu czyta sie jako PLN i pending, nie jako pustka", async () => {
    rpc().setData("event_package_purchase", {
      order_id: ORDER_ID,
      seats: 10,
      total_cents: 250000,
      discount_cents: 0,
    });

    const result = await api.purchasePackage(buyer);
    expect(result.currency).toBe("PLN");
    expect(result.status).toBe("pending");
    expect(result.totalCents).toBe(250000);
  });

  // Wyczerpana pula to odmowa SPRZEDAZY, nie potwierdzenie zakupu. Gdyby
  // przeszla, kupujacy zobaczylby ekran „masz 10 miejsc" bez zamowienia
  // w bazie.
  it("odmowa bazy przy zakupie leci wyjatkiem, bez potwierdzenia", async () => {
    rpc().setError("event_package_purchase", "sold_out: no packages left");

    await expect(api.purchasePackage(buyer)).rejects.toThrow(/sold_out/);
    expect(rpc().names()).toEqual(["event_package_purchase"]);
  });

  // DEFEKT NAPRAWIONY W PRODUKCJI - opis nizej zostaje jako powod kontraktu.
  //
  // `purchasePackage` czyta odpowiedz przez `record()`/`text()`/`num()`
  // z fallbackami (`admissionApi.ts:249-257`), wiec odpowiedz, ktorej nie da
  // sie odczytac (`null`, ksztalt bez `order_id`), zamienia sie w POPRAWNIE
  // WYGLADAJACY wynik: `orderId: ""`, `totalCents: 0`, `status: "pending"`.
  // Ekran zakupu narysuje wtedy potwierdzenie zamowienia na zero zlotych
  // z pustym identyfikatorem, po ktorym nikt nie znajdzie ani platnosci, ani
  // miejsc. Siostrzany modul robi to poprawnie: `acceptPackageInvite`
  // (`packageInviteApi.ts:92-97`) rzuca `unknown: invitation response is not
  // readable` „zamiast rysowac pusty sukces". Tu brakuje tego samego progu.
  // Poprawka nalezy do produkcji: brak `order_id` ma byc bledem.
  it("DEFEKT: nieczytelna odpowiedz zakupu daje pusty sukces zamiast bledu", async () => {
    rpc().setData("event_package_purchase", { seats: 10 });

    await expect(api.purchasePackage(buyer)).rejects.toThrow();
  });
});
