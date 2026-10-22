// Wybór kontaktu do symulacji ścieżki (S8) - fabryka zapytania nad
// `listCrmLeads`.
//
// CO TEN PLIK DOWODZI.
//   1. Klucz pochodzi z `crmKeys.leads(params)`, więc leży pod prefiksem
//      `crmKeys.leadsAll()` - inwalidacje list leadów CRM odświeżają też wybór.
//   2. Pełny klucz różni się od klucza ekranu `/admin/crm` (inne parametry),
//      więc wpisy cache o innym kształcie danych się nie zderzają.
//   3. Parametry: pierwsza strona, limit wyboru, sortowanie po aktywności,
//      wyszukiwanie przycięte, a puste znika z parametrów.
//   4. Parser bierze wyłącznie pola wyboru, pomija wiersze bez `id`/e-maila
//      i nie rzuca na zepsutym JSON-ie.
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ listCrmLeads: vi.fn() }));

vi.mock("@/lib/crm.functions", () => ({
  listCrmLeads: (input: unknown) => h.listCrmLeads(input),
}));

import {
  JOURNEY_SIMULATION_LEAD_LIMIT,
  JOURNEY_SIMULATION_LEADS_STALE_MS,
  journeySimulationLeadParams,
  journeySimulationLeadsQueryOptions,
  parseJourneySimulationLeads,
} from "@/lib/admin/journeys/simulationLeads";
import { crmKeys } from "@/lib/crm/keys";

beforeEach(() => {
  h.listCrmLeads.mockReset();
});

describe("journeySimulationLeadParams", () => {
  it("pierwsza strona, limit wyboru i najświeższa aktywność na górze", () => {
    expect(journeySimulationLeadParams("")).toEqual({
      search: undefined,
      limit: JOURNEY_SIMULATION_LEAD_LIMIT,
      page: 1,
      sort: "activity",
      sort_dir: "desc",
    });
    expect(JOURNEY_SIMULATION_LEAD_LIMIT).toBe(20);
  });

  it("wyszukiwanie jest przycięte, a same spacje to brak wyszukiwania", () => {
    expect(journeySimulationLeadParams("  anna@nes.example ").search).toBe("anna@nes.example");
    expect(journeySimulationLeadParams("   ").search).toBeUndefined();
  });
});

describe("journeySimulationLeadsQueryOptions", () => {
  it("klucz z fabryki CRM pod prefiksem list leadów, inny niż klucz ekranu /admin/crm", () => {
    const options = journeySimulationLeadsQueryOptions("anna");
    expect(options.queryKey).toEqual(crmKeys.leads(journeySimulationLeadParams("anna")));
    expect(options.queryKey.slice(0, 1)).toEqual([...crmKeys.leadsAll()]);
    // Kształt parametrów ekranu listy leadów (`admin.crm.index.tsx`).
    const crmScreenKey = crmKeys.leads({
      search: "anna",
      scope: "active",
      serverParams: {},
      page: 1,
      pageSize: 20,
    });
    expect(options.queryKey).not.toEqual(crmScreenKey);
    expect(options.staleTime).toBe(JOURNEY_SIMULATION_LEADS_STALE_MS);
  });

  it("pobiera przez listCrmLeads z tymi samymi parametrami i zwraca pola wyboru", async () => {
    h.listCrmLeads.mockResolvedValue({
      json: JSON.stringify([
        { id: "lead-1", email: "anna@nes.example", first_name: "Anna", last_name: "Nowak" },
        { id: "lead-2", email: "jan@nes.example", first_name: " ", last_name: null },
      ]),
      total: 42,
      page: 1,
      pageSize: JOURNEY_SIMULATION_LEAD_LIMIT,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const data = await client.fetchQuery(journeySimulationLeadsQueryOptions(" anna "));

    expect(h.listCrmLeads).toHaveBeenCalledWith({ data: journeySimulationLeadParams("anna") });
    expect(data).toEqual({
      rows: [
        { id: "lead-1", email: "anna@nes.example", name: "Anna Nowak" },
        { id: "lead-2", email: "jan@nes.example", name: null },
      ],
      total: 42,
    });
  });

  it("błąd serwera (np. mfa_required) przechodzi do zapytania, nie jest połykany", async () => {
    h.listCrmLeads.mockRejectedValue(new Error("Forbidden: mfa_required"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await expect(client.fetchQuery(journeySimulationLeadsQueryOptions(""))).rejects.toThrow(
      "mfa_required",
    );
  });
});

describe("parseJourneySimulationLeads", () => {
  it("pomija wiersze bez id albo e-maila i obce wartości", () => {
    const json = JSON.stringify([
      { id: "a", email: "a@nes.example", first_name: "Ala" },
      { id: "b", email: null },
      { email: "c@nes.example" },
      null,
      "wiersz",
      { id: "d", email: "d@nes.example", first_name: 7, last_name: "Kos" },
    ]);
    expect(parseJourneySimulationLeads(json)).toEqual([
      { id: "a", email: "a@nes.example", name: "Ala" },
      { id: "d", email: "d@nes.example", name: "Kos" },
    ]);
  });

  it("zepsuty JSON albo nie-tablica to pusta lista, bez wyjątku", () => {
    expect(parseJourneySimulationLeads("{")).toEqual([]);
    expect(parseJourneySimulationLeads(JSON.stringify({ id: "a" }))).toEqual([]);
  });
});
