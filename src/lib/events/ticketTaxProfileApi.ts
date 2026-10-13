// Profil podatkowy BILETU w panelu (TIX-09): stawka VAT na fakturze, podstawa
// zwolnienia i kod podatkowy produktu Stripe.
//
// OSOBNE RPC, NIE UPSERT BILETU. `admin_event_ticket_upsert` tych kolumn nie
// zna (migracja `20261012130200`), więc profil czyta `admin_event_ticket_tax_profile`
// i zapisuje `admin_event_ticket_set_tax_profile` - PO udanym zapisie biletu,
// pod identyfikatorem, który oddał upsert (nowy bilet nie ma go wcześniej).
// Wzór: `ticketTaxGroup.ts` (tryb podatku i limit grupy).
//
// OKNO WDROŻENIA TO „NIEDOSTĘPNY", NIE AWARIA. Kod wchodzi na produkcję przed
// migracją, więc brak funkcji (`isMigrationPending`) albo kolumny (42703,
// PGRST204) daje `null`: okno biletu pokazuje zdanie o aktualizacji bazy i NIE
// woła zapisu. Każdy inny błąd (odmowa, sieć) rzuca - udawanie pustego profilu
// pozwoliłoby nadpisać zapisaną stawkę pustą przy następnym zapisie.
//
// ZAPIS TYLKO ZMIANY. Profil porównujemy w postaci ładunku (`taxProfileToPayload`),
// więc dopisana spacja albo wielkie litery w kodzie nie są zmianą, a bilet
// zapisany bez dotykania sekcji podatku nie woła drugiego RPC.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  EMPTY_TAX_PROFILE,
  taxProfileFromRow,
  taxProfileToPayload,
  type TaxProfileDraft,
} from "@/lib/events/taxProfileDraft";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

/** Profile biletów wydarzenia po identyfikatorze; `null` = baza bez migracji. */
export type TicketTaxProfiles = Map<string, TaxProfileDraft> | null;

/**
 * Brak KOLUMNY (42703 z Postgresa, PGRST204 ze schematu PostgREST) to ten sam
 * stan co brak funkcji - migracja jeszcze nie weszła. Wąsko, jak
 * `isMigrationPending`: odmowa uprawnień czy timeout to awaria.
 */
const MISSING_COLUMN_CODES: ReadonlySet<string> = new Set(["42703", "PGRST204"]);

function isTaxProfileUnavailable(error: unknown): boolean {
  if (isMigrationPending(error)) return true;
  if (error === null || typeof error !== "object") return false;
  return MISSING_COLUMN_CODES.has(String((error as { code?: unknown }).code ?? ""));
}

function errorOf(error: { message: string }): Error {
  return new Error(error.message);
}

/** Odpowiedź `jsonb` -> mapa profili. Wpis bez identyfikatora odpada po cichu. */
export function parseTicketTaxProfiles(data: unknown): Map<string, TaxProfileDraft> {
  const map = new Map<string, TaxProfileDraft>();
  if (!Array.isArray(data)) return map;
  for (const entry of data) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || row.id === "") continue;
    map.set(row.id, taxProfileFromRow(row));
  }
  return map;
}

export async function fetchTicketTaxProfiles(eventId: string): Promise<TicketTaxProfiles> {
  const { data, error } = await supabase.rpc("admin_event_ticket_tax_profile", {
    p_event_id: eventId,
  });
  if (error) {
    if (isTaxProfileUnavailable(error)) return null;
    throw errorOf(error);
  }
  return parseTicketTaxProfiles(data);
}

export async function saveTicketTaxProfile(
  ticketId: string,
  value: TaxProfileDraft,
): Promise<void> {
  // Ładunek budujemy z typowanego szkicu, a `Json` przyjmuje go dopiero po
  // rozpisaniu na pola - `TaxProfilePayload` jest interfejsem bez sygnatury
  // indeksu, więc wprost nie pasuje do `{ [key: string]: Json }`.
  const payload = taxProfileToPayload(value);
  const { error } = await supabase.rpc("admin_event_ticket_set_tax_profile", {
    p_ticket_id: ticketId,
    p_payload: {
      vat_rate: payload.vat_rate,
      vat_exempt_basis: payload.vat_exempt_basis,
      stripe_tax_code: payload.stripe_tax_code,
    },
  });
  if (error) throw errorOf(error);
}

/** Czy szkic różni się od wartości zapisanej - w postaci, którą zapisałaby baza. */
export function ticketTaxProfileChanged(saved: TaxProfileDraft, next: TaxProfileDraft): boolean {
  const a = taxProfileToPayload(saved);
  const b = taxProfileToPayload(next);
  return (
    a.vat_rate !== b.vat_rate ||
    a.vat_exempt_basis !== b.vat_exempt_basis ||
    a.stripe_tax_code !== b.stripe_tax_code
  );
}

/**
 * Stan profilu w oknie biletu. `ready` niesie wartość ZAPISANĄ - dla nowego
 * biletu `EMPTY_TAX_PROFILE`, bo tyle właśnie zapisze baza bez drugiego RPC.
 */
export type TicketTaxProfileState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "failed"; error: Error }
  | { status: "ready"; value: TaxProfileDraft };

/**
 * Wynik zapytania + edytowany bilet -> stan dla okna. Dane wygrywają z błędem
 * ponownego odczytu: react-query trzyma ostatnią udaną odpowiedź.
 *
 * ISTNIEJĄCY BILET SPOZA MAPY TO „JESZCZE NIE WIEMY", a nie pusty profil.
 * RPC oddaje profil KAŻDEGO biletu wydarzenia, więc brak wiersza znaczy, że
 * mapa jest starsza od biletu (kopia albo nowy bilet sprzed odświeżenia).
 * Pusty profil jako punkt odniesienia kazałby zapisowi jednego pola wyzerować
 * stawkę, którą zapis kopii właśnie ustawił - dlatego okno czeka na odczyt.
 */
export function ticketTaxProfileState(
  query: { data: TicketTaxProfiles | undefined; error: Error | null },
  ticketId: string | null,
): TicketTaxProfileState {
  if (query.data === null) return { status: "unavailable" };
  if (query.data !== undefined) {
    if (ticketId === null) return { status: "ready", value: EMPTY_TAX_PROFILE };
    const saved = query.data.get(ticketId);
    return saved === undefined ? { status: "loading" } : { status: "ready", value: saved };
  }
  if (query.error !== null) return { status: "failed", error: query.error };
  return { status: "loading" };
}

const taxProfileKey = (eventId: string) => ["admin", "event-ticket-tax-profile", eventId] as const;

export function useTicketTaxProfiles(
  eventId: string | null,
): UseQueryResult<TicketTaxProfiles, Error> {
  return useQuery({
    queryKey: taxProfileKey(eventId ?? ""),
    queryFn: () => fetchTicketTaxProfiles(eventId ?? ""),
    enabled: !!eventId,
  });
}

export function useSaveTicketTaxProfile(
  eventId: string,
): UseMutationResult<void, Error, { ticketId: string; value: TaxProfileDraft }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, value }) => saveTicketTaxProfile(ticketId, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: taxProfileKey(eventId) }),
  });
}
