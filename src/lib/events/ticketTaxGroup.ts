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
import {
  REGISTRATION_FIELD_LIMITS as LIMITS,
  hasControlCharacters,
} from "@/lib/events/registrationFieldLimits";

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

export type GuestIssue = "name" | "email" | "duplicate" | "control";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

/**
 * Walidacja listy gości; `leadEmail` blokuje wpisanie samego siebie. Te same
 * reguły i ta sama kolejność co baza (`_event_register_group_guests`, R38):
 * imiona, znaki sterujące, adres, duplikat - baza sprawdza CAŁĄ listę, zanim
 * spojrzy, kto ma już zapis, więc formularz łapie to samo pod polem.
 */
export function guestIssues(guests: readonly GroupGuest[], leadEmail = ""): (GuestIssue | null)[] {
  const seen = new Set<string>();
  const lead = leadEmail.trim().toLowerCase();
  if (lead) seen.add(lead);
  return guests.map((g) => {
    const first = g.firstName.trim();
    const last = g.lastName.trim();
    if (!first || !last) return "name";
    if (first.length > LIMITS.name || last.length > LIMITS.name) return "name";
    const email = g.email.trim().toLowerCase();
    if (hasControlCharacters(first) || hasControlCharacters(last) || hasControlCharacters(email)) {
      return "control";
    }
    if (!EMAIL_RE.test(email) || email.length > LIMITS.email) return "email";
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

/** Bilet w postaci, z której da się odczytać limit grupy (formularz zapisu). */
export interface GroupLimitSource {
  id: string;
  groupRegistrationEnabled?: boolean;
  groupMaxSize?: number;
}

/**
 * Limit grupy biletu `ticketTypeId` (prowadzący + goście) z listy biletów.
 *
 * `null`, gdy tego biletu na liście nie ma albo zapis grupowy jest na nim
 * wyłączony - wtedy o limicie nie wiemy nic i nie wolno go zgadywać.
 */
export function ticketGroupMaxSize(
  tickets: readonly GroupLimitSource[],
  ticketTypeId: string | null,
): number | null {
  const ticket = tickets.find((entry) => entry.id === ticketTypeId);
  if (ticket === undefined || ticket.groupRegistrationEnabled !== true) return null;
  return ticket.groupMaxSize === undefined ? null : clampGroupSize(ticket.groupMaxSize);
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

/**
 * Dopisanie gości do zgłoszenia prowadzącego - przez SERWER (R38, REG-04).
 *
 * Przeglądarka nie woła już bazy wprost: funkcja serwerowa
 * `registerEventGroupGuests` bierze najemcę z hosta, konto z sesji i solony
 * skrót adresu, a baza liczy kubełek adresu i konta. Gość, który ma już zapis
 * na wydarzenie, jest pomijany bez śladu w odpowiedzi (wiadomość dostaje on
 * sam, mailem z serwera) - `added` to liczba poprawnych gości z listy.
 *
 * Odmowa (`{ok:false, error}`, zawsze bez adresu gościa) kończy się
 * `Error("kod")`, który tłumaczy słownik gości (`groupGuestsFailure`). Moduł
 * funkcji serwerowej ładujemy dynamicznie: czyste pomocniki tego pliku czyta
 * też serwer (kasa), a deklaracja funkcji serwerowej jest tam zbędna.
 */
export async function registerGroupGuests(
  leadRegistrationId: string,
  guests: readonly GroupGuest[],
): Promise<number> {
  const { registerEventGroupGuests } = await import("@/lib/events/groupGuests.functions");
  const result = await registerEventGroupGuests({
    data: { leadRegistrationId, guests: guestsToPayload(guests) },
  });
  if (!result.ok) throw new Error(result.error);
  return result.added;
}
