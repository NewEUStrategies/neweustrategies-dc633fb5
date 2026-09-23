import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

// Klient Supabase atrapujemy WYŁĄCZNIE dla `registerGroupGuests` - reszta
// modułu to czyste funkcje i atrapy nie dotyka.
const h = vi.hoisted(() => ({
  rpc: vi.fn<
    (
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  >(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc(name, args) },
}));

const {
  clampGroupSize,
  groupTotalCents,
  guestIssues,
  guestsToPayload,
  parseTicketTaxMode,
  registerGroupGuests,
  fetchTicketTaxGroup,
  saveTicketTaxGroup,
  useTicketTaxGroup,
  useSaveTicketTaxGroup,
} = await import("@/lib/events/ticketTaxGroup");

describe("ticketTaxGroup", () => {
  it("parses tax mode strictly", () => {
    expect(parseTicketTaxMode("inclusive")).toBe("inclusive");
    expect(parseTicketTaxMode("exclusive")).toBe("exclusive");
    expect(parseTicketTaxMode("x")).toBeNull();
    expect(parseTicketTaxMode(null)).toBeNull();
  });

  it("clamps group size to 2-50", () => {
    expect(clampGroupSize(1)).toBe(2);
    expect(clampGroupSize(99)).toBe(50);
    expect(clampGroupSize(Number.NaN)).toBe(10);
    expect(clampGroupSize(7.9)).toBe(7);
  });

  it("validates guests and blocks duplicates including the lead", () => {
    const issues = guestIssues(
      [
        { firstName: "Anna", lastName: "Nowak", email: "anna@example.com" },
        { firstName: "", lastName: "X", email: "x@example.com" },
        { firstName: "Jan", lastName: "Kow", email: "bad" },
        { firstName: "Ewa", lastName: "Lis", email: "ANNA@example.com" },
        { firstName: "Lead", lastName: "Self", email: "lead@example.com" },
      ],
      "lead@example.com",
    );
    expect(issues).toEqual([null, "name", "email", "duplicate", "duplicate"]);
  });

  it("normalises payload and totals", () => {
    expect(guestsToPayload([{ firstName: " A ", lastName: " B ", email: " A@X.PL " }])).toEqual([
      { first_name: "A", last_name: "B", email: "a@x.pl" },
    ]);
    expect(groupTotalCents(1000, 2)).toBe(3000);
    expect(groupTotalCents(1000, 0)).toBe(1000);
  });
});

// `registerGroupGuests` czyta `added` z odpowiedzi jsonb zawężeniem typu, bez
// rzutowania na `Record<string, unknown>`. Zachowanie ma zostać to samo: liczba,
// gdy baza ją podała, zero przy każdym innym kształcie, rzut przy odmowie.
describe("registerGroupGuests", () => {
  const LEAD = "22222222-2222-2222-2222-222222222222";
  const GUEST = { firstName: " Ewa ", lastName: "Lis", email: "EWA@example.com" };

  beforeEach(() => h.rpc.mockReset());

  it("woła RPC gości kluczem prowadzącego i oddaje liczbę dopisanych", async () => {
    h.rpc.mockResolvedValue({ data: { added: 1, registration_ids: ["r-1"] }, error: null });

    await expect(registerGroupGuests(LEAD, [GUEST])).resolves.toBe(1);
    expect(h.rpc).toHaveBeenCalledWith("event_register_group_guests", {
      p_lead_registration_id: LEAD,
      p_guests: [{ first_name: "Ewa", last_name: "Lis", email: "ewa@example.com" }],
    });
  });

  it("każdy inny kształt odpowiedzi to zero, a nie wyjątek", async () => {
    for (const data of [null, [], "3", 3, { registration_ids: [] }, { added: "2" }]) {
      h.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(registerGroupGuests(LEAD, [GUEST]), JSON.stringify(data)).resolves.toBe(0);
    }
  });

  it("odmowa bazy rzuca komunikatem RAISE - mapuje go słownik gości", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "group_too_large" } });

    await expect(registerGroupGuests(LEAD, [GUEST])).rejects.toThrow("group_too_large");
  });
});

// Panel organizatora: odczyt i zapis podatku oraz limitu grupy biletu.
// Wartości spoza kontraktu (nieznany tryb, limit poza 2-50) nie przechodzą
// dalej - panel dostaje zawsze to, co baza i tak by zapisała.
describe("ticketTaxGroup - panel organizatora", () => {
  const EVENT = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => h.rpc.mockReset());

  it("odczyt składa mapę biletów z trybem podatku i przyciętym limitem", async () => {
    h.rpc.mockResolvedValue({
      data: [
        { id: "t-1", tax_mode: "exclusive", group_max_size: 4 },
        { id: "t-2", tax_mode: "vat23", group_max_size: 99 },
      ],
      error: null,
    });

    const map = await fetchTicketTaxGroup(EVENT);

    expect(h.rpc).toHaveBeenCalledWith("admin_event_ticket_tax_group", { p_event_id: EVENT });
    expect([...map]).toEqual([
      ["t-1", { taxMode: "exclusive", groupMaxSize: 4 }],
      ["t-2", { taxMode: "inclusive", groupMaxSize: 50 }],
    ]);
  });

  it("odczyt bez wierszy to pusta mapa, a odmowa rzuca", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchTicketTaxGroup(EVENT)).resolves.toEqual(new Map());

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "forbidden" } });
    await expect(fetchTicketTaxGroup(EVENT)).rejects.toThrow("forbidden");
  });

  it("zapis wysyła przycięty limit i rzuca przy odmowie", async () => {
    h.rpc.mockResolvedValueOnce({ data: true, error: null });
    await saveTicketTaxGroup("t-1", { taxMode: "exclusive", groupMaxSize: 1 });
    expect(h.rpc).toHaveBeenCalledWith("admin_event_ticket_set_tax_group", {
      p_ticket_id: "t-1",
      p_tax_mode: "exclusive",
      p_group_max_size: 2,
    });

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "not_found" } });
    await expect(
      saveTicketTaxGroup("t-1", { taxMode: "inclusive", groupMaxSize: 10 }),
    ).rejects.toThrow("not_found");
  });

  it("hook odczytu czeka na wydarzenie i nie woła bazy bez niego", async () => {
    h.rpc.mockResolvedValue({
      data: [{ id: "t-1", tax_mode: "inclusive", group_max_size: 6 }],
      error: null,
    });

    const idle = renderHookWithQueryClient(() => useTicketTaxGroup(null));
    expect(idle.result.current.fetchStatus).toBe("idle");
    expect(h.rpc).not.toHaveBeenCalled();

    const { result } = renderHookWithQueryClient(() => useTicketTaxGroup(EVENT));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.get("t-1")).toEqual({ taxMode: "inclusive", groupMaxSize: 6 });
  });

  it("hook zapisu po sukcesie unieważnia odczyt TEGO wydarzenia", async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveTicketTaxGroup(EVENT));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        ticketId: "t-1",
        value: { taxMode: "exclusive", groupMaxSize: 5 },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["admin", "event-ticket-tax-group", EVENT],
    });
  });
});
