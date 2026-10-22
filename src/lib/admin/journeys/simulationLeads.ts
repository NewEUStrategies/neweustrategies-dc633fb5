// Wybór kontaktu do symulacji ścieżki (S8, SPEC §6.3 „Symulacja”) - ostatnio
// aktywne albo wyszukane leady CRM z `listCrmLeads` (`requireCrmStaff`, aal2).
//
// FABRYKA, NIE `queryFn` W KOMPONENCIE. Komponenty ścieżek czytają dane
// wyłącznie przez `*QueryOptions` producentów (bramka `revenueKeysReuse`):
// własne pobranie w dialogu to druga, cicha kopia zapytania, której nikt nie
// pilnuje przy zmianie kontraktu `listCrmLeads`.
//
// KLUCZ Z `crmKeys.leads(params)` - prefiks list leadów CRM, więc każda
// inwalidacja `crmKeys.leadsAll()` (szyna zdarzeń, import CSV, scoring)
// odświeża też ten wybór. Wpisy cache nie zderzają się z ekranem `/admin/crm`,
// mimo innego kształtu danych: tamten klucz niesie `scope`, `serverParams`
// i `pageSize`, ten - `limit`, `sort` i `sort_dir`, więc pełne klucze nigdy nie
// są równe, a nikt nie czyta tych wpisów prefiksem (`setQueriesData`).
//
// Moduł jest osobnym liściem, a nie częścią `journeyQueries.ts`: zaślepka
// klienta `crm.functions` ma trafić wyłącznie do leniwego chunku dialogu
// symulacji, nie do chunku zakładki Ścieżki i karty leada, które czytają
// `journeyQueries`.
import { queryOptions } from "@tanstack/react-query";
import { listCrmLeads } from "@/lib/crm.functions";
import { crmKeys } from "@/lib/crm/keys";

/**
 * Ile kontaktów pokazuje wybór: tyle mieści się w oknie dialogu bez
 * przewijania listy, a resztę zawęża wyszukiwanie (serwer i tak liczy `total`).
 */
export const JOURNEY_SIMULATION_LEAD_LIMIT = 20;

/** Kontakty CRM zmieniają się rzadziej niż wynik symulacji - pół minuty wystarcza. */
export const JOURNEY_SIMULATION_LEADS_STALE_MS = 30_000;

export interface JourneySimulationLead {
  id: string;
  email: string;
  name: string | null;
}

export interface JourneySimulationLeads {
  rows: JourneySimulationLead[];
  total: number;
}

/** Parametry `listCrmLeads`: pierwsza strona, najświeższa aktywność na górze. */
export function journeySimulationLeadParams(search: string) {
  const term = search.trim();
  return {
    search: term || undefined,
    limit: JOURNEY_SIMULATION_LEAD_LIMIT,
    page: 1,
    sort: "activity" as const,
    sort_dir: "desc" as const,
  };
}

/**
 * Wiersze `crm_leads` z odpowiedzi `listCrmLeads` (JSON) - tylko pola wyboru.
 * Wiersz bez `id` albo adresu e-mail pomijamy: nie da się go ani wskazać
 * w symulacji, ani podpisać dla czytnika ekranu.
 */
export function parseJourneySimulationLeads(json: string): JourneySimulationLead[] {
  let rows: unknown;
  try {
    rows = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row): JourneySimulationLead[] => {
    if (typeof row !== "object" || row === null) return [];
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.email !== "string") return [];
    const name = [record.first_name, record.last_name]
      .filter((part): part is string => typeof part === "string" && part.trim() !== "")
      .join(" ");
    return [{ id: record.id, email: record.email, name: name || null }];
  });
}

export function journeySimulationLeadsQueryOptions(search: string) {
  const params = journeySimulationLeadParams(search);
  return queryOptions<JourneySimulationLeads>({
    queryKey: crmKeys.leads(params),
    queryFn: async () => {
      const result = await listCrmLeads({ data: params });
      return { rows: parseJourneySimulationLeads(result.json), total: result.total };
    },
    staleTime: JOURNEY_SIMULATION_LEADS_STALE_MS,
  });
}
