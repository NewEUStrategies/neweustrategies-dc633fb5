// Profil podatkowy biletu w panelu (TIX-09) - odczyt, zapis i stan dla okna.
//
// CO TEN PLIK DOWODZI.
//   1. ODCZYT JEST OBRONNY: odpowiedź `jsonb` bez schematu składa się w mapę po
//      identyfikatorze biletu, a wpis bez identyfikatora albo nie-obiekt odpada.
//      Nieznana stawka nie przechodzi dalej (spada do „domyślnej organizatora").
//   2. OKNO WDROŻENIA TO `null`, NIE PUSTA MAPA. Brak funkcji (PGRST202, 42883)
//      albo kolumny (42703, PGRST204) mówi oknu „niedostępny" i blokuje zapis;
//      pusta mapa pozwoliłaby nadpisać zapisaną stawkę pustą. Każdy inny błąd
//      rzuca - odmowa uprawnień to awaria, nie migracja.
//   3. ZAPIS IDZIE DOSŁOWNĄ NAZWĄ RPC z ładunkiem znormalizowanym tak, jak go
//      zapisze baza (stawka „default" -> `null`, kod małymi literami, podstawa
//      bez brzegowych spacji), i rzuca komunikatem RAISE - mapuje go słownik
//      odmów panelu (`invalid_tax_code` -> `adminEventRegistration.errors.*`).
//   4. ZMIANA LICZY SIĘ W POSTACI ŁADUNKU, więc spacja albo wielkie litery
//      w kodzie nie wołają drugiego RPC.
//   5. HOOK ZAPISU UNIEWAŻNIA ODCZYT TEGO WYDARZENIA.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { EMPTY_TAX_PROFILE, type TaxProfileDraft } from "@/lib/events/taxProfileDraft";

const h = vi.hoisted(() => ({
  rpc: vi.fn<
    (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>
  >(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc(name, args) },
}));

const {
  fetchTicketTaxProfiles,
  parseTicketTaxProfiles,
  saveTicketTaxProfile,
  ticketTaxProfileChanged,
  ticketTaxProfileState,
  useSaveTicketTaxProfile,
  useTicketTaxProfiles,
} = await import("@/lib/events/ticketTaxProfileApi");

const EVENT = "11111111-1111-4111-8111-111111111111";
const TICKET = "aaaaaaaa-1111-4111-8111-111111111111";

const ZW: TaxProfileDraft = {
  vatRate: "zw",
  vatExemptBasis: "art. 43 ust. 1 pkt 29 ustawy o VAT",
  stripeTaxCode: "txcd_20030000",
};

beforeEach(() => h.rpc.mockReset());

describe("odczyt profili biletów", () => {
  it("woła dosłowną nazwę RPC i składa mapę po identyfikatorze biletu", async () => {
    h.rpc.mockResolvedValue({
      data: [
        {
          id: TICKET,
          vat_rate: "zw",
          vat_exempt_basis: ZW.vatExemptBasis,
          stripe_tax_code: ZW.stripeTaxCode,
        },
        { id: "t-2", vat_rate: null, vat_exempt_basis: "", stripe_tax_code: null },
      ],
      error: null,
    });

    const map = await fetchTicketTaxProfiles(EVENT);

    expect(h.rpc).toHaveBeenCalledWith("admin_event_ticket_tax_profile", { p_event_id: EVENT });
    expect(map).not.toBeNull();
    expect([...(map ?? new Map())]).toEqual([
      [TICKET, ZW],
      ["t-2", EMPTY_TAX_PROFILE],
    ]);
  });

  it("bełkot w odpowiedzi odpada po cichu, a nieznana stawka spada do domyślnej", () => {
    const map = parseTicketTaxProfiles([
      null,
      "t-1",
      ["t-1"],
      { vat_rate: "23" },
      { id: "", vat_rate: "23" },
      { id: 7, vat_rate: "23" },
      { id: "t-3", vat_rate: "22", vat_exempt_basis: 5, stripe_tax_code: false },
    ]);
    expect([...map]).toEqual([["t-3", EMPTY_TAX_PROFILE]]);
    expect(parseTicketTaxProfiles(null)).toEqual(new Map());
    expect(parseTicketTaxProfiles({ id: TICKET })).toEqual(new Map());
  });

  it.each([
    ["PGRST202", "funkcji nie ma w schemacie PostgREST"],
    ["42883", "funkcji o tej sygnaturze nie ma w Postgresie"],
    ["42703", "kolumny vat_rate jeszcze nie ma"],
    ["PGRST204", "kolumny nie ma w schemacie PostgREST"],
  ])("brak migracji (%s - %s) to `null` = profil niedostępny", async (code) => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "missing", code } });

    await expect(fetchTicketTaxProfiles(EVENT)).resolves.toBeNull();
  });

  it("każdy inny błąd rzuca - odmowa uprawnień nie udaje pustego profilu", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden", code: "42501" } });
    await expect(fetchTicketTaxProfiles(EVENT)).rejects.toThrow("forbidden");

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    await expect(fetchTicketTaxProfiles(EVENT)).rejects.toThrow("Failed to fetch");
  });
});

describe("zapis profilu biletu", () => {
  it("wysyła ładunek znormalizowany jak w bazie pod dosłowną nazwą RPC", async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });

    await saveTicketTaxProfile(TICKET, {
      vatRate: "default",
      vatExemptBasis: "  podstawa  ",
      stripeTaxCode: " TXCD_10000000 ",
    });

    expect(h.rpc).toHaveBeenCalledWith("admin_event_ticket_set_tax_profile", {
      p_ticket_id: TICKET,
      p_payload: { vat_rate: null, vat_exempt_basis: "podstawa", stripe_tax_code: "txcd_10000000" },
    });
  });

  it("pusty kod idzie jako `null`, stawka jako napis", async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });

    await saveTicketTaxProfile(TICKET, { ...EMPTY_TAX_PROFILE, vatRate: "8" });

    expect(h.rpc).toHaveBeenCalledWith("admin_event_ticket_set_tax_profile", {
      p_ticket_id: TICKET,
      p_payload: { vat_rate: "8", vat_exempt_basis: "", stripe_tax_code: null },
    });
  });

  it("odmowa bazy rzuca komunikatem RAISE - z kodem w głowie dla mapy odmów", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { message: "invalid_tax_code: the Stripe tax code looks like txcd_12345678" },
    });

    await expect(saveTicketTaxProfile(TICKET, ZW)).rejects.toThrow(/^invalid_tax_code:/);
  });
});

describe("zmiana profilu", () => {
  it("ten sam profil nie jest zmianą - także po spacjach i wielkich literach", () => {
    expect(ticketTaxProfileChanged(ZW, ZW)).toBe(false);
    expect(
      ticketTaxProfileChanged(ZW, {
        ...ZW,
        vatExemptBasis: ` ${ZW.vatExemptBasis} `,
        stripeTaxCode: ZW.stripeTaxCode.toUpperCase(),
      }),
    ).toBe(false);
    expect(ticketTaxProfileChanged(EMPTY_TAX_PROFILE, { ...EMPTY_TAX_PROFILE })).toBe(false);
  });

  it("każde z trzech pól osobno jest zmianą", () => {
    expect(ticketTaxProfileChanged(ZW, { ...ZW, vatRate: "23" })).toBe(true);
    expect(ticketTaxProfileChanged(ZW, { ...ZW, vatExemptBasis: "inna" })).toBe(true);
    expect(ticketTaxProfileChanged(ZW, { ...ZW, stripeTaxCode: "" })).toBe(true);
    expect(ticketTaxProfileChanged(EMPTY_TAX_PROFILE, ZW)).toBe(true);
  });
});

describe("stan profilu dla okna biletu", () => {
  const map = new Map([[TICKET, ZW]]);

  it("bez danych i bez błędu - wczytywanie", () => {
    expect(ticketTaxProfileState({ data: undefined, error: null }, TICKET)).toEqual({
      status: "loading",
    });
  });

  it("`null` z odczytu - niedostępny (baza bez migracji)", () => {
    expect(ticketTaxProfileState({ data: null, error: null }, TICKET)).toEqual({
      status: "unavailable",
    });
  });

  it("błąd bez danych - awaria z błędem do zdania", () => {
    const error = new Error("forbidden");
    expect(ticketTaxProfileState({ data: undefined, error }, TICKET)).toEqual({
      status: "failed",
      error,
    });
  });

  it("bilet z mapy niesie SWÓJ profil, nowy bilet - pusty", () => {
    expect(ticketTaxProfileState({ data: map, error: null }, TICKET)).toEqual({
      status: "ready",
      value: ZW,
    });
    expect(ticketTaxProfileState({ data: map, error: null }, null)).toEqual({
      status: "ready",
      value: EMPTY_TAX_PROFILE,
    });
  });

  it("istniejący bilet spoza mapy to „wczytywanie”, a nie pusty profil", () => {
    // Mapa starsza od biletu (kopia, nowy bilet sprzed odświeżenia): pusty
    // profil jako punkt odniesienia kazałby zapisowi wyzerować stawkę kopii.
    expect(ticketTaxProfileState({ data: map, error: null }, "t-kopia")).toEqual({
      status: "loading",
    });
  });

  it("dane z poprzedniego odczytu wygrywają z błędem ponownego odczytu", () => {
    expect(ticketTaxProfileState({ data: map, error: new Error("timeout") }, TICKET)).toEqual({
      status: "ready",
      value: ZW,
    });
  });
});

describe("hooki panelu", () => {
  it("hook odczytu czeka na wydarzenie i nie woła bazy bez niego", async () => {
    h.rpc.mockResolvedValue({
      data: [{ id: TICKET, vat_rate: "8", vat_exempt_basis: "", stripe_tax_code: null }],
      error: null,
    });

    const idle = renderHookWithQueryClient(() => useTicketTaxProfiles(null));
    expect(idle.result.current.fetchStatus).toBe("idle");
    expect(h.rpc).not.toHaveBeenCalled();

    const { result } = renderHookWithQueryClient(() => useTicketTaxProfiles(EVENT));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get(TICKET)).toEqual({ ...EMPTY_TAX_PROFILE, vatRate: "8" });
  });

  it("hook odczytu oddaje `null` przy migracji w toku - bez stanu błędu", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "missing", code: "PGRST202" } });

    const { result } = renderHookWithQueryClient(() => useTicketTaxProfiles(EVENT));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("hook zapisu po sukcesie unieważnia odczyt TEGO wydarzenia", async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveTicketTaxProfile(EVENT));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ ticketId: TICKET, value: ZW });
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["admin", "event-ticket-tax-profile", EVENT],
    });
  });

  it("hook zapisu przy odmowie NIE unieważnia odczytu i oddaje błąd", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "not_found: ticket" } });
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveTicketTaxProfile(EVENT));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await expect(result.current.mutateAsync({ ticketId: TICKET, value: ZW })).rejects.toThrow(
        "not_found",
      );
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
