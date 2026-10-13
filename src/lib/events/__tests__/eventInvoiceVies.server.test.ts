// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//
// Weryfikacja VIES nabywcy faktury z odwrotnym obciazeniem (INV-12). Pilnujemy:
// podmiot zapytania i najemce bierzemy z bazy (bramka administratora,
// klient UZYTKOWNIKA), nigdy z wejscia; niedostepnosc VIES (panstwo offline,
// limit zapytan, blad sieci) to `vies_unavailable` BEZ zapisu, a nie "numer
// niewazny"; zapytanie niesie numer zapytujacego (sprzedawcy), zeby VIES
// oddal numer konsultacji - dowod statusu nabywcy; wynik zapisuje klucz
// uslugowy z najemca z odpowiedzi bazy.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

const admin = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: admin.rpc },
}));

const vies = await import("@/lib/events/eventInvoiceVies.server");

type Rpc = (
  name: string,
  args: { p_id: string },
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

const SUBJECT: { [key: string]: Json } = {
  tenant_id: "tenant-1",
  invoice_id: "inv-1",
  subject: "DE123456789",
  country_code: "DE",
  vat_number: "123456789",
  requester_country: "PL",
  requester_number: "7011278375",
};

const VALID = {
  valid: true,
  userError: "VALID",
  requestIdentifier: " WAPIAAAAZ1 ",
  name: "ACME GMBH",
  address: "---",
};

beforeEach(() => {
  admin.rpc.mockReset();
  admin.rpc.mockResolvedValue({ data: null, error: null });
});

describe("parseViesSubject", () => {
  it("kompletny podmiot z bazy; brak kraju, numeru albo najemcy = null", () => {
    expect(vies.parseViesSubject(SUBJECT)).toEqual({
      tenantId: "tenant-1",
      invoiceId: "inv-1",
      subject: "DE123456789",
      countryCode: "DE",
      vatNumber: "123456789",
      requesterCountry: "PL",
      requesterNumber: "7011278375",
    });
    expect(vies.parseViesSubject(null)).toBeNull();
    expect(vies.parseViesSubject({ ...SUBJECT, country_code: "de" })).toBeNull();
    expect(vies.parseViesSubject({ ...SUBJECT, tenant_id: "" })).toBeNull();
    expect(vies.parseViesSubject({ ...SUBJECT, requester_number: "" })?.requesterNumber).toBeNull();
  });
});

describe("parseViesResponse", () => {
  it("VALID: numer konsultacji przyciety, '---' = brak danych", () => {
    expect(vies.parseViesResponse(200, VALID)).toEqual({
      ok: true,
      valid: true,
      requestId: "WAPIAAAAZ1",
      name: "ACME GMBH",
      address: "",
    });
  });

  it("INVALID to odpowiedz o numerze, nie blad", () => {
    expect(vies.parseViesResponse(200, { valid: false, userError: "INVALID" })).toEqual({
      ok: true,
      valid: false,
      requestId: null,
      name: "",
      address: "",
    });
  });

  it("niedostepnosc panstwa, limit, blad HTTP i zly ksztalt = vies_unavailable", () => {
    for (const [status, body] of [
      [200, { valid: false, userError: "MS_UNAVAILABLE" }],
      [200, { valid: false, userError: "MS_MAX_CONCURRENT_REQ" }],
      [500, VALID],
      [200, { userError: "VALID" }],
      [200, null],
    ] as const) {
      expect(vies.parseViesResponse(status, body)).toEqual({
        ok: false,
        error: "vies_unavailable",
      });
    }
  });
});

describe("checkVies", () => {
  it("zapytanie z numerem zapytujacego (sprzedawcy)", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      response(200, VALID),
    );
    const subject = vies.parseViesSubject(SUBJECT);
    if (subject === null) throw new Error("fixture");
    await vies.checkVies(subject, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number");
    expect(JSON.parse(String(init?.body))).toEqual({
      countryCode: "DE",
      vatNumber: "123456789",
      requesterMemberStateCode: "PL",
      requesterNumber: "7011278375",
    });
  });

  it("bez numeru zapytujacego - samo sprawdzenie; blad sieci = vies_unavailable", async () => {
    const subject = vies.parseViesSubject({ ...SUBJECT, requester_number: "" });
    if (subject === null) throw new Error("fixture");
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      response(200, VALID),
    );
    await vies.checkVies(subject, fetchImpl);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      countryCode: "DE",
      vatNumber: "123456789",
    });
    const broken = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(vies.checkVies(subject, broken)).resolves.toEqual({
      ok: false,
      error: "vies_unavailable",
    });
  });
});

describe("verifyInvoiceBuyerVies", () => {
  it("podmiot z bazy -> VIES -> zapis wyniku kluczem uslugowym z najemca z bazy", async () => {
    const rpc = vi.fn<Rpc>(async () => ({ data: SUBJECT, error: null }));
    const result = await vies.verifyInvoiceBuyerVies(client(rpc), "inv-1", async () =>
      response(200, VALID),
    );
    expect(rpc).toHaveBeenCalledWith("admin_event_invoice_vies_subject", { p_id: "inv-1" });
    expect(admin.rpc).toHaveBeenCalledWith("_event_invoice_vies_record", {
      p_tenant: "tenant-1",
      p_invoice: "inv-1",
      p_subject: "DE123456789",
      p_valid: true,
      p_request_id: "WAPIAAAAZ1",
    });
    expect(result).toMatchObject({ ok: true, valid: true });
  });

  it("odmowa bramki, brak podmiotu, niedostepny VIES i odmowa zapisu", async () => {
    const denied = vi.fn<Rpc>(async () => ({ data: null, error: { message: "forbidden: x" } }));
    await expect(vies.verifyInvoiceBuyerVies(client(denied), "inv-1", vi.fn())).resolves.toEqual({
      ok: false,
      error: "forbidden: x",
    });
    const none = vi.fn<Rpc>(async () => ({ data: null, error: null }));
    await expect(vies.verifyInvoiceBuyerVies(client(none), "inv-1", vi.fn())).resolves.toEqual({
      ok: false,
      error: "vies_not_applicable",
    });
    const rpc = vi.fn<Rpc>(async () => ({ data: SUBJECT, error: null }));
    await expect(
      vies.verifyInvoiceBuyerVies(client(rpc), "inv-1", async () =>
        response(200, { valid: false, userError: "MS_UNAVAILABLE" }),
      ),
    ).resolves.toEqual({ ok: false, error: "vies_unavailable" });
    expect(admin.rpc).not.toHaveBeenCalled();
    admin.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "vies_subject_changed: buyer changed" },
    });
    await expect(
      vies.verifyInvoiceBuyerVies(client(rpc), "inv-1", async () => response(200, VALID)),
    ).resolves.toEqual({ ok: false, error: "vies_subject_changed: buyer changed" });
  });
});
