// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Kurs NBP na fakturze wydarzenia w walucie obcej (INV-06, art. 31a ustawy
// o VAT). Pilnujemy: "ostatni dzien roboczy przed dniem X" to ostatnia tabela
// A opublikowana W DNIU X - 1 albo wczesniej (swieta i weekendy rozstrzyga
// NBP, nie kalendarz w kodzie), tabela starsza niz 10 dni to BRAK danych,
// zapytania mieszcza sie w limicie 93 dni API, blad sieci po 3 probach jest
// wyjatkiem (zadnego kursu z pamieci podrecznej na dokumencie VAT), a zapis
// idzie kluczem uslugowym tylko dla dni, ktorych baza jeszcze nie ma.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

const admin = vi.hoisted(() => ({
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      admin.from(table);
      return { upsert: admin.upsert };
    },
  },
}));

const fx = await import("@/lib/events/eventInvoiceFx.server");

type Rpc = (
  name: string,
  args: { p_payload: Json },
) => Promise<{ data: Json | null; error: { message: string } | null }>;

interface RpcSurface {
  rpc: Rpc;
}

/** Straznik, nie rzutowanie: atrapa bez ogniwa `rpc` nie udaje klienta. */
function isDbClient(candidate: RpcSurface): candidate is RpcSurface & SupabaseClient<Database> {
  return typeof candidate.rpc === "function";
}

function client(rpc: Rpc): SupabaseClient<Database> {
  const candidate: RpcSurface = { rpc };
  if (!isDbClient(candidate)) throw new Error("test: atrapa nie niesie ogniwa rpc()");
  return candidate;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TABLES = {
  rates: [
    { no: "1/A/NBP/2026", effectiveDate: "2026-01-02", mid: 4.2101 },
    { no: "2/A/NBP/2026", effectiveDate: "2026-01-05", mid: 4.2202 },
    { no: "3/A/NBP/2026", effectiveDate: "2026-01-07", mid: 4.2303 },
  ],
};

beforeEach(() => {
  admin.upsert.mockReset();
  admin.from.mockReset();
  admin.upsert.mockResolvedValue({ error: null });
});

describe("parseFxNeeds", () => {
  it("tylko waluta ISO i dzien RRRR-MM-DD; reszta odrzucona", () => {
    expect(
      fx.parseFxNeeds([
        { currency: "EUR", rate_date: "2026-01-06", loaded: false },
        { currency: "eur", rate_date: "2026-01-06" },
        { currency: "EUR", rate_date: "6.01.2026" },
        { currency: "USD", rate_date: "2026-01-06", loaded: true },
      ]),
    ).toEqual([
      { currency: "EUR", rateDate: "2026-01-06", loaded: false },
      { currency: "USD", rateDate: "2026-01-06", loaded: true },
    ]);
    expect(fx.parseFxNeeds(null)).toEqual([]);
  });
});

describe("kalendarz zapytan NBP", () => {
  it("przesuniecie dnia przez granice miesiaca i roku", () => {
    expect(fx.shiftDay("2026-01-03", -10)).toBe("2025-12-24");
    expect(fx.shiftDay("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("bliskie dni = jeden zakres, odlegle = osobne; zakres nie przekracza 93 dni", () => {
    expect(fx.nbpRanges(["2026-01-06", "2026-01-08", "2026-01-06"])).toEqual([
      ["2025-12-27", "2026-01-08"],
    ]);
    expect(fx.nbpRanges(["2026-01-06", "2026-06-30"])).toEqual([
      ["2025-12-27", "2026-01-06"],
      ["2026-06-20", "2026-06-30"],
    ]);
    const days = Array.from({ length: 12 }, (_unused, index) =>
      fx.shiftDay("2026-01-10", index * 10),
    );
    for (const [from, to] of fx.nbpRanges(days)) {
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      expect(span).toBeLessThanOrEqual(92);
    }
  });

  it("swieto (6 stycznia): kurs z ostatniej tabeli przed nim, nie z nastepnej", () => {
    const rates = TABLES.rates.map((rate) => ({ ...rate }));
    expect(fx.rateForDay(rates, "2026-01-06")?.no).toBe("2/A/NBP/2026");
    expect(fx.rateForDay(rates, "2026-01-07")?.no).toBe("3/A/NBP/2026");
    expect(fx.rateForDay(rates, "2026-01-01")).toBeNull();
    // Tabela starsza niz 10 dni to brak danych, a nie "wez cokolwiek".
    expect(fx.rateForDay(rates, "2026-01-20")).toBeNull();
  });

  it("dzien bez tabeli trafia do brakow, reszta do wierszy tabeli kursow", () => {
    const result = fx.nbpRowsForNeeds(
      [
        { currency: "EUR", rateDate: "2026-01-06", loaded: false },
        { currency: "EUR", rateDate: "2026-01-01", loaded: false },
      ],
      new Map([["EUR", TABLES.rates]]),
    );
    expect(result.rows).toEqual([
      {
        currency: "EUR",
        rate_date: "2026-01-06",
        effective_date: "2026-01-05",
        table_no: "2/A/NBP/2026",
        mid: 4.2202,
      },
    ]);
    expect(result.missing).toEqual([{ currency: "EUR", rateDate: "2026-01-01", loaded: false }]);
  });
});

describe("fetchNbpRange", () => {
  it("adres tabeli A dla waluty i zakresu; odrzuca uszkodzone wiersze", async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, {
        rates: [
          ...TABLES.rates,
          { no: "x", effectiveDate: "2026-01-08", mid: 4 },
          { no: "4/A/NBP/2026", effectiveDate: "2026-01-08", mid: -1 },
        ],
      }),
    );
    const rates = await fx.fetchNbpRange("EUR", "2025-12-27", "2026-01-07", fetchImpl);
    expect(rates).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.nbp.pl/api/exchangerates/rates/A/EUR/2025-12-27/2026-01-07/?format=json",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("404 = brak notowan w zakresie (pusta lista, bez ponawiania)", async () => {
    const fetchImpl = vi.fn(async () => response(404, "Not Found"));
    await expect(fx.fetchNbpRange("EUR", "2026-01-01", "2026-01-01", fetchImpl)).resolves.toEqual(
      [],
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blad serwera NBP: 3 proby, potem wyjatek", async () => {
    const fetchImpl = vi.fn(async () => response(503, {}));
    await expect(fx.fetchNbpRange("EUR", "2026-01-01", "2026-01-05", fetchImpl)).rejects.toThrow(
      "NBP HTTP 503",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe("prepareEventInvoiceFxRates", () => {
  it("pyta baze klientem uzytkownika, pobiera tylko brakujace dni, zapisuje kluczem uslugowym", async () => {
    const rpc = vi.fn<Rpc>(async () => ({
      data: [
        { currency: "EUR", rate_date: "2026-01-06", loaded: false },
        { currency: "EUR", rate_date: "2026-01-02", loaded: true },
      ],
      error: null,
    }));
    const fetchImpl = vi.fn(async () => response(200, TABLES));
    const result = await fx.prepareEventInvoiceFxRates(
      client(rpc),
      { invoiceIds: ["inv-1"] },
      fetchImpl,
    );
    expect(rpc).toHaveBeenCalledWith("admin_event_invoice_fx_needs", {
      p_payload: { invoice_ids: ["inv-1"] },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(admin.from).toHaveBeenCalledWith("nbp_exchange_rates");
    expect(admin.upsert).toHaveBeenCalledWith(
      [
        {
          currency: "EUR",
          rate_date: "2026-01-06",
          effective_date: "2026-01-05",
          table_no: "2/A/NBP/2026",
          mid: 4.2202,
        },
      ],
      { onConflict: "currency,rate_date" },
    );
    expect(result).toEqual({ needed: 2, loaded: 1, missing: [] });
  });

  it("masowe wystawienie: zapytanie o oczekujace prosby wydarzenia", async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: [], error: null }));
    const fetchImpl = vi.fn();
    await expect(
      fx.prepareEventInvoiceFxRates(client(rpc), { eventId: "ev-1", pending: true }, fetchImpl),
    ).resolves.toEqual({ needed: 0, loaded: 0, missing: [] });
    expect(rpc).toHaveBeenCalledWith("admin_event_invoice_fx_needs", {
      p_payload: { event_id: "ev-1", pending: true },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(admin.upsert).not.toHaveBeenCalled();
  });

  it("odmowa bramki i blad zapisu sa wyjatkami; brak tabeli = dzien w brakach", async () => {
    const denied = vi.fn<Rpc>(async () => ({ data: null, error: { message: "forbidden: x" } }));
    await expect(
      fx.prepareEventInvoiceFxRates(client(denied), { invoiceIds: ["inv-1"] }, vi.fn()),
    ).rejects.toThrow("forbidden");

    const rpc = vi.fn<Rpc>(async () => ({
      data: [{ currency: "EUR", rate_date: "2026-01-01", loaded: false }],
      error: null,
    }));
    const empty = vi.fn(async () => response(404, "Not Found"));
    await expect(
      fx.prepareEventInvoiceFxRates(client(rpc), { invoiceIds: ["inv-1"] }, empty),
    ).resolves.toEqual({
      needed: 1,
      loaded: 0,
      missing: [{ currency: "EUR", rateDate: "2026-01-01", loaded: false }],
    });
    expect(admin.upsert).not.toHaveBeenCalled();

    const ok = vi.fn(async () => response(200, TABLES));
    const later = vi.fn<Rpc>(async () => ({
      data: [{ currency: "EUR", rate_date: "2026-01-06", loaded: false }],
      error: null,
    }));
    admin.upsert.mockResolvedValueOnce({ error: { message: "permission denied" } });
    await expect(
      fx.prepareEventInvoiceFxRates(client(later), { invoiceIds: ["inv-1"] }, ok),
    ).rejects.toThrow("permission denied");
  });
});
