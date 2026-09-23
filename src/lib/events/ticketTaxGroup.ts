// Podatek biletu (wliczony/doliczany - stawkę liczy Stripe) oraz rejestracja
// grupowa (kupujący podaje dane każdego uczestnika, płaci raz). Czyste
// funkcje są wspólne dla kasy (serwer) i formularzy (klient).
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TicketTaxMode = "inclusive" | "exclusive";

export const GROUP_SIZE_MIN = 2;
export const GROUP_SIZE_MAX = 50;
export const GROUP_SIZE_DEFAULT = 10;

export interface TicketTaxGroup {
  taxMode: TicketTaxMode;
  groupMaxSize: number;
}

export const DEFAULT_TICKET_TAX_GROUP: TicketTaxGroup = {
  taxMode: "inclusive",
  groupMaxSize: GROUP_SIZE_DEFAULT,
};

export function parseTicketTaxMode(value: unknown): TicketTaxMode | null {
  return value === "inclusive" || value === "exclusive" ? value : null;
}

export function clampGroupSize(value: number): number {
  if (!Number.isFinite(value)) return GROUP_SIZE_DEFAULT;
  return Math.min(Math.max(Math.trunc(value), GROUP_SIZE_MIN), GROUP_SIZE_MAX);
}

export interface GroupGuest {
  firstName: string;
  lastName: string;
  email: string;
}

export const EMPTY_GUEST: GroupGuest = { firstName: "", lastName: "", email: "" };

export type GuestIssue = "name" | "email" | "duplicate";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/** Walidacja listy gości; `leadEmail` blokuje wpisanie samego siebie. */
export function guestIssues(guests: readonly GroupGuest[], leadEmail = ""): (GuestIssue | null)[] {
  const seen = new Set<string>();
  const lead = leadEmail.trim().toLowerCase();
  if (lead) seen.add(lead);
  return guests.map((g) => {
    if (!g.firstName.trim() || !g.lastName.trim()) return "name";
    if (g.firstName.trim().length > 80 || g.lastName.trim().length > 80) return "name";
    const email = g.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 320) return "email";
    if (seen.has(email)) return "duplicate";
    seen.add(email);
    return null;
  });
}

export function guestsToPayload(guests: readonly GroupGuest[]) {
  return guests.map((g) => ({
    first_name: g.firstName.trim(),
    last_name: g.lastName.trim(),
    email: g.email.trim().toLowerCase(),
  }));
}

/** Kwota za całą grupę (prowadzący + goście). */
export function groupTotalCents(unitCents: number, guestCount: number): number {
  return Math.max(0, Math.round(unitCents)) * (1 + Math.max(0, Math.trunc(guestCount)));
}

// --- Admin ----------------------------------------------------------------

export async function fetchTicketTaxGroup(eventId: string): Promise<Map<string, TicketTaxGroup>> {
  const { data, error } = await supabase.rpc("admin_event_ticket_tax_group", {
    p_event_id: eventId,
  });
  if (error) throw new Error(error.message);
  const map = new Map<string, TicketTaxGroup>();
  for (const row of data ?? []) {
    map.set(row.id, {
      taxMode: parseTicketTaxMode(row.tax_mode) ?? "inclusive",
      groupMaxSize: clampGroupSize(row.group_max_size),
    });
  }
  return map;
}

export async function saveTicketTaxGroup(ticketId: string, value: TicketTaxGroup): Promise<void> {
  const { error } = await supabase.rpc("admin_event_ticket_set_tax_group", {
    p_ticket_id: ticketId,
    p_tax_mode: value.taxMode,
    p_group_max_size: clampGroupSize(value.groupMaxSize),
  });
  if (error) throw new Error(error.message);
}

const taxGroupKey = (eventId: string) => ["admin", "event-ticket-tax-group", eventId] as const;

export function useTicketTaxGroup(
  eventId: string | null,
): UseQueryResult<Map<string, TicketTaxGroup>, Error> {
  return useQuery({
    queryKey: taxGroupKey(eventId ?? ""),
    queryFn: () => fetchTicketTaxGroup(eventId ?? ""),
    enabled: !!eventId,
  });
}

export function useSaveTicketTaxGroup(
  eventId: string,
): UseMutationResult<void, Error, { ticketId: string; value: TicketTaxGroup }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, value }) => saveTicketTaxGroup(ticketId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxGroupKey(eventId) }),
  });
}

// --- Publiczne ------------------------------------------------------------

export async function registerGroupGuests(
  leadRegistrationId: string,
  guests: readonly GroupGuest[],
): Promise<number> {
  const { data, error } = await supabase.rpc("event_register_group_guests", {
    p_lead_registration_id: leadRegistrationId,
    p_guests: guestsToPayload(guests),
  });
  if (error) throw new Error(error.message);
  // `Json` zawęża się do obiektu samym sprawdzeniem typu - rzutowanie na
  // `Record<string, unknown>` niczego tu nie dodawało poza ślepą plamką.
  if (data === null || typeof data !== "object" || Array.isArray(data) || !("added" in data)) {
    return 0;
  }
  return typeof data.added === "number" ? data.added : 0;
}
