// Prezentacja BILETU: widoczność, etykieta ceny, zapis grupowy, status sprzedaży
// i link rejestracyjny. Osobny moduł od `ticketDraft`, bo te pola zapisuje
// osobne RPC (`admin_event_ticket_set_presentation`) - upsert biletu zostaje
// nietknięty, a jego kontrakt i testy nie muszą się zmieniać.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { browserPublicOrigin } from "@/lib/http/host";
import type { EventTicketRow } from "@/lib/events/registrationsApi";
import type { TicketDraft } from "@/lib/events/ticketDraft";

export const TICKET_PRICE_LABEL_MAX = 40;

export interface TicketPresentation {
  isHidden: boolean;
  showPriceLabel: boolean;
  priceLabelPl: string;
  priceLabelEn: string;
  groupRegistrationEnabled: boolean;
}

export const DEFAULT_TICKET_PRESENTATION: TicketPresentation = {
  isHidden: false,
  showPriceLabel: true,
  priceLabelPl: "",
  priceLabelEn: "",
  groupRegistrationEnabled: false,
};

export type TicketStatus = "on_sale" | "scheduled" | "ended" | "sold_out" | "inactive";

/** Status wiersza listy. `availability` liczy baza; brak - liczymy z okna. */
export function ticketStatus(row: EventTicketRow, now: Date = new Date()): TicketStatus {
  if (!row.is_active) return "inactive";
  const availability = row.availability;
  if (
    availability === "scheduled" ||
    availability === "ended" ||
    availability === "sold_out" ||
    availability === "on_sale"
  ) {
    return availability;
  }
  if (row.sales_from !== null && new Date(row.sales_from) > now) return "scheduled";
  if (row.sales_to !== null && new Date(row.sales_to) < now) return "ended";
  if (row.quota !== null && (row.sold_count ?? 0) >= row.quota) return "sold_out";
  return "on_sale";
}

/** Bezpośredni link rejestracyjny - kanoniczny host, nigdy host podglądu. */
export function ticketRegistrationUrl(
  eventSlug: string,
  ticketKey: string,
  origin: string = browserPublicOrigin(),
): string {
  return `${origin}/events/${encodeURIComponent(eventSlug)}/register?ticket=${encodeURIComponent(ticketKey)}`;
}

/** Wolny klucz kopii: `<klucz>_copy`, `<klucz>_copy2`... w granicy 49 znaków. */
export function duplicateTicketKey(key: string, taken: ReadonlySet<string>): string {
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? "_copy" : `_copy${index}`;
    const candidate = `${key.slice(0, 49 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${key.slice(0, 40)}_${Date.now().toString(36).slice(-8)}`;
}

/**
 * Szkic kopii biletu: nowy wiersz (id = null), wolny klucz, nazwy z dopiskiem.
 * Kod dostępu NIE przechodzi - baza zna tylko jego skrót, więc kopia startuje
 * bez bramki, a organizator ustawia kod świadomie.
 */
export function duplicateTicketDraft(
  draft: TicketDraft,
  taken: ReadonlySet<string>,
  suffixes: { pl: string; en: string },
  sortOrder: number,
): TicketDraft {
  return {
    ...draft,
    id: null,
    key: duplicateTicketKey(draft.key, taken),
    namePl: `${draft.namePl}${suffixes.pl}`.slice(0, 200),
    nameEn: `${draft.nameEn}${suffixes.en}`.slice(0, 200),
    sortOrder: String(sortOrder),
    accessCode: "",
    hasAccessCode: false,
    removeAccessCode: false,
  };
}

/** Wyszukiwarka listy: nazwa PL/EN albo klucz, bez rozróżniania wielkości liter. */
export function matchesTicketSearch(row: EventTicketRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return [row.name_pl, row.name_en, row.key].some((value) =>
    (value ?? "").toLowerCase().includes(needle),
  );
}

async function fetchTicketPresentation(eventId: string): Promise<Map<string, TicketPresentation>> {
  const { data, error } = await supabase.rpc("admin_event_ticket_presentation", {
    p_event_id: eventId,
  });
  if (error) throw error;
  const map = new Map<string, TicketPresentation>();
  for (const row of data ?? []) {
    map.set(row.id, {
      isHidden: row.is_hidden,
      showPriceLabel: row.show_price_label,
      priceLabelPl: row.price_label_pl ?? "",
      priceLabelEn: row.price_label_en ?? "",
      groupRegistrationEnabled: row.group_registration_enabled,
    });
  }
  return map;
}

export async function saveTicketPresentation(
  ticketId: string,
  value: TicketPresentation,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("admin_event_ticket_set_presentation", {
    p_ticket_id: ticketId,
    p_is_hidden: value.isHidden,
    p_show_price_label: value.showPriceLabel,
    p_price_label_pl: value.priceLabelPl.slice(0, TICKET_PRICE_LABEL_MAX),
    p_price_label_en: value.priceLabelEn.slice(0, TICKET_PRICE_LABEL_MAX),
    p_group_registration_enabled: value.groupRegistrationEnabled,
  });
  if (error) throw error;
  return data === true;
}

const presentationKey = (eventId: string) => ["event-ticket-presentation", eventId] as const;

export function useTicketPresentation(
  eventId: string,
): UseQueryResult<Map<string, TicketPresentation>> {
  return useQuery({
    queryKey: presentationKey(eventId),
    queryFn: () => fetchTicketPresentation(eventId),
    staleTime: 30_000,
  });
}

export function useSaveTicketPresentation(
  eventId: string,
): UseMutationResult<boolean, Error, { ticketId: string; value: TicketPresentation }> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, value }) => saveTicketPresentation(ticketId, value),
    onSuccess: () => client.invalidateQueries({ queryKey: presentationKey(eventId) }),
  });
}
