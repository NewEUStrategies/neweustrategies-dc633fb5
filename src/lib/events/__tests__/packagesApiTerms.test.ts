// PANEL ORGANIZATORA: WARUNKI ZAKUPU I PROFIL PODATKOWY PAKIETU (TIX-07, TIX-09)
// - odczyt `admin_event_package_terms` i szesc nowych kluczy ladunku
// `admin_event_package_upsert`.
//
// CO TU PILNUJEMY.
//
// 1) OKNO WDROZENIA TO `null`, NIE PUSTA MAPA. Baza bez migracji (funkcji nie
//    ma: PGRST202/42883; kolumn nie ma: 42703/PGRST204) oddaje „warunki
//    niedostepne". Pusta mapa znaczylaby „pakiety bez wierszy", a dialog
//    traktowalby nowy pakiet jak znany i wyslal klucze. Kazda INNA odmowa
//    (uprawnienia, siec) leci wyjatkiem - to awaria, nie okno wdrozenia.
// 2) WIERSZ NIECZYTELNY JEST POMIJANY, nie uzupelniany. Pakiet bez wiersza ma
//    warunki nieznane, wiec zapis ich nie rusza; wiersz uzupelniony „14 dni"
//    nadpisalby prawdziwy termin przy pierwszej zmianie nazwy.
// 3) KLUCZE WARUNKOW JADA TYLKO PRZY ZNANYCH WARUNKACH. Upsert zmienia kolumne
//    wylacznie przy kluczu obecnym w ladunku (`p_payload ? '...'`), wiec brak
//    klucza = „zostaw", a `null` przy limicie = „bez limitu". Obie rzeczy musza
//    dojechac dokladnie tak.
//
// ATRAPA OBEJMUJE WYLACZNIE KLIENTA SUPABASE (`supabaseRpcStub`); RPC bez
// zaplanowanej odpowiedzi konczy test bledem.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { EventPackageInput, EventPackageTermsRow } from "@/lib/events/packagesApi";

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

const api = await import("@/lib/events/packagesApi");

const EVENT_ID = "3f4a0000-0000-4000-8000-000000000001";
const PACKAGE_ID = "3f4a0000-0000-4000-8000-000000000002";
const OTHER_PACKAGE_ID = "3f4a0000-0000-4000-8000-000000000003";
const TICKET_TYPE_ID = "3f4a0000-0000-4000-8000-000000000004";

const TERMS_KEYS = [
  "admit_before_payment",
  "payment_terms_days",
  "max_open_orders_per_buyer",
  "vat_rate",
  "vat_exempt_basis",
  "stripe_tax_code",
] as const;

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function upsertPayload(): Record<string, unknown> {
  const call = rpc().lastCall("admin_event_package_upsert");
  if (call === undefined) throw new Error("test: upsert nie zostal wolany");
  const sent = call.arg("p_payload");
  if (sent === null || typeof sent !== "object")
    throw new Error("test: p_payload nie jest obiektem");
  return sent as Record<string, unknown>;
}

function termsRow(overrides: Partial<EventPackageTermsRow> = {}): EventPackageTermsRow {
  return {
    id: PACKAGE_ID,
    admit_before_payment: false,
    payment_terms_days: 14,
    max_open_orders_per_buyer: 3,
    vat_rate: null,
    vat_exempt_basis: "",
    stripe_tax_code: null,
    ...overrides,
  };
}

const PAKIET: EventPackageInput = {
  id: PACKAGE_ID,
  eventId: EVENT_ID,
  key: "delegacja_firmowa",
  ticketTypeId: TICKET_TYPE_ID,
  namePl: "Delegacja firmowa",
  nameEn: "Company delegation",
  descriptionPl: "",
  descriptionEn: "",
  audience: "company",
  seats: 10,
  priceCents: 250_000,
  currency: "PLN",
  quota: null,
  salesFrom: null,
  salesTo: null,
  minTierRank: 0,
  requiresVerification: false,
  isActive: true,
  sortOrder: 10,
};

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

/* ------------------------------------------------------- odczyt warunkow --- */

describe("fetchEventPackageTerms", () => {
  it("wola `admin_event_package_terms` z samym wydarzeniem i oddaje mape po pakiecie", async () => {
    rpc().setData("admin_event_package_terms", [
      termsRow(),
      termsRow({
        id: OTHER_PACKAGE_ID,
        admit_before_payment: true,
        payment_terms_days: 30,
        max_open_orders_per_buyer: null,
        vat_rate: "zw",
        vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
        stripe_tax_code: "txcd_20030000",
      }),
    ]);

    const terms = await api.fetchEventPackageTerms(EVENT_ID);

    // Najemca bierze sie z `assert_editor_tenant()` - klient podaje wylacznie
    // wydarzenie, stad asercja na CALY obiekt argumentow.
    expect(rpc().lastCall("admin_event_package_terms")?.args).toEqual({ p_event_id: EVENT_ID });
    expect(terms).not.toBeNull();
    expect([...(terms ?? new Map()).keys()]).toEqual([PACKAGE_ID, OTHER_PACKAGE_ID]);
    expect(terms?.get(OTHER_PACKAGE_ID)).toEqual({
      id: OTHER_PACKAGE_ID,
      admit_before_payment: true,
      payment_terms_days: 30,
      max_open_orders_per_buyer: null,
      vat_rate: "zw",
      vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
      stripe_tax_code: "txcd_20030000",
    });
  });

  it("pusta tablica i brak danych to pusta mapa - wydarzenie bez pakietow, nie awaria", async () => {
    rpc().setData("admin_event_package_terms", []);
    expect((await api.fetchEventPackageTerms(EVENT_ID))?.size).toBe(0);

    rpc().setData("admin_event_package_terms", null);
    expect((await api.fetchEventPackageTerms(EVENT_ID))?.size).toBe(0);
  });

  it("wiersz nieczytelny jest POMIJANY, a nie uzupelniany wartosciami domyslnymi", async () => {
    rpc().setData("admin_event_package_terms", [
      termsRow(),
      // Termin platnosci jako napis, limit ulamkowy, brak flagi zaufania, brak id.
      { ...termsRow({ id: OTHER_PACKAGE_ID }), payment_terms_days: "14" },
      { ...termsRow({ id: "a" }), max_open_orders_per_buyer: 2.5 },
      { ...termsRow({ id: "b" }), admit_before_payment: null },
      { ...termsRow({ id: "c" }), vat_exempt_basis: null },
      { ...termsRow({ id: "d" }), stripe_tax_code: 12345678 },
      { ...termsRow(), id: "" },
      "nie-obiekt",
      null,
      [termsRow({ id: "e" })],
    ]);

    const terms = await api.fetchEventPackageTerms(EVENT_ID);
    expect([...(terms ?? new Map()).keys()]).toEqual([PACKAGE_ID]);
  });

  it.each([
    ["PGRST202", "funkcji nie ma w PostgREST"],
    ["42883", "Postgres nie zna sygnatury"],
    ["42703", "funkcja jest, kolumn jeszcze nie ma"],
    ["PGRST204", "PostgREST nie zna kolumny"],
  ])("odmowa %s (%s) to `null` - warunki niedostepne, nie wyjatek", async (code) => {
    rpc().setError("admin_event_package_terms", "migration pending", code);
    await expect(api.fetchEventPackageTerms(EVENT_ID)).resolves.toBeNull();
  });

  it("kazda inna odmowa leci wyjatkiem - awaria nie udaje okna wdrozenia", async () => {
    rpc().setError("admin_event_package_terms", "forbidden: editor role required", "42501");
    await expect(api.fetchEventPackageTerms(EVENT_ID)).rejects.toThrow(/forbidden/);

    rpc().setError("admin_event_package_terms", "network down");
    await expect(api.fetchEventPackageTerms(EVENT_ID)).rejects.toThrow(/network down/);
  });
});

/* ------------------------------------------------ klucze warunkow w zapisie --- */

describe("saveEventPackage - klucze warunkow zakupu i podatku", () => {
  it("warunki NIEZNANE (brak pola) - ladunek nie ma ZADNEGO z szesciu kluczy", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);
    await api.saveEventPackage(PAKIET);

    const sent = upsertPayload();
    for (const key of TERMS_KEYS) expect(key in sent, key).toBe(false);
  });

  it("warunki NIEZNANE (`null`) - tak samo: baza zostawia kolumny bez zmian", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);
    await api.saveEventPackage({ ...PAKIET, terms: null });

    const sent = upsertPayload();
    for (const key of TERMS_KEYS) expect(key in sent, key).toBe(false);
  });

  it("warunki ZNANE jada wszystkie szesc, z wartosciami ze szkicu", async () => {
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);
    await api.saveEventPackage({
      ...PAKIET,
      terms: {
        admitBeforePayment: true,
        paymentTermsDays: 30,
        maxOpenOrdersPerBuyer: 5,
        tax: {
          vat_rate: "zw",
          vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
          stripe_tax_code: "txcd_20030000",
        },
      },
    });

    const sent = upsertPayload();
    expect(Object.fromEntries(TERMS_KEYS.map((key) => [key, sent[key]]))).toEqual({
      admit_before_payment: true,
      payment_terms_days: 30,
      max_open_orders_per_buyer: 5,
      vat_rate: "zw",
      vat_exempt_basis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
      stripe_tax_code: "txcd_20030000",
    });
    // Reszta ladunku bez zmian - warunki dokladaja klucze, nie zastepuja pol.
    expect(sent.price_cents).toBe(250_000);
    expect("key" in sent).toBe(false);
  });

  it("brak limitu, stawka biletu i brak kodu jada JAWNYM `null`, a falsz jako falsz", async () => {
    // `CASE WHEN p_payload ? 'max_open_orders_per_buyer'`: o skutku decyduje
    // OBECNOSC klucza. Zgubiony `null` zostawilby stary limit 3, choc
    // organizator go zdjal; zgubiony `false` zostawilby zaufanie do faktury.
    rpc().setData("admin_event_package_upsert", PACKAGE_ID);
    await api.saveEventPackage({
      ...PAKIET,
      terms: {
        admitBeforePayment: false,
        paymentTermsDays: 14,
        maxOpenOrdersPerBuyer: null,
        tax: { vat_rate: null, vat_exempt_basis: "", stripe_tax_code: null },
      },
    });

    const sent = upsertPayload();
    for (const key of TERMS_KEYS) expect(key in sent, key).toBe(true);
    expect(sent.admit_before_payment).toBe(false);
    expect(sent.max_open_orders_per_buyer).toBeNull();
    expect(sent.vat_rate).toBeNull();
    expect(sent.vat_exempt_basis).toBe("");
    expect(sent.stripe_tax_code).toBeNull();
  });

  it("odmowa profilu podatkowego z bazy leci wyjatkiem, bez drugiej proby", async () => {
    rpc().setError(
      "admin_event_package_upsert",
      "invalid_tax_code: the Stripe tax code looks like txcd_12345678",
      "22023",
    );
    await expect(
      api.saveEventPackage({
        ...PAKIET,
        terms: {
          admitBeforePayment: false,
          paymentTermsDays: 14,
          maxOpenOrdersPerBuyer: 3,
          tax: { vat_rate: null, vat_exempt_basis: "", stripe_tax_code: "txcd_1" },
        },
      }),
    ).rejects.toThrow(/^invalid_tax_code:/);
    expect(rpc().callsFor("admin_event_package_upsert")).toHaveLength(1);
  });
});
