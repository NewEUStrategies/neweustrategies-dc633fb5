// Fixture'y warstwy biletowej wydarzeń.
//
// Ta sama zasada, co przy czacie, profilu i sieci kontaktów: jedne budowniki
// wierszy dla całej powierzchni, a atrapa łańcucha PostgREST NIE jest tu
// kopiowana - importujemy `src/test/supabaseChain.ts` i re-eksportujemy dalej,
// więc żaden test biletów nie zna ścieżki do cudzego katalogu fixture'ów.
//
// CO TA POWIERZCHNIA MA SZCZEGÓLNEGO: `ticket.server.ts` rozmawia z bazą DWOMA
// drogami naraz - łańcuchem `from(...)` (RSVP, wydarzenie, zamówienia, profil)
// oraz `rpc("get_event_rsvp_counts")` (liczniki, SECURITY DEFINER). Sam
// `supabaseFromStub()` nie wystarczy, bo nie zna `rpc`. Stąd `supabaseClientStub()`:
// skleja oba światy w jeden obiekt o kształcie klienta i ZAPISUJE wywołania RPC,
// żeby test mógł udowodnić nie tylko wynik, ale i to, że danego zapytania w ogóle
// nie było (np. że reguła „mam już miejsce" kończy pracę przed liczeniem miejsc).
import {
  ok,
  supabaseFromStub,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";

export * from "@/test/supabaseChain";

/**
 * Identyfikatory w kształcie UUID - `ticket.functions.ts` waliduje je regexem,
 * a `ticketCodeFrom` wyprowadza kod z ich znaków szesnastkowych, więc atrapa
 * „event-1" dawałaby kod z zupełnie innej ścieżki niż produkcja.
 */
export const EVENT_IDS = {
  event: "11111111-1111-4111-8111-111111111111",
  otherEvent: "22222222-2222-4222-8222-222222222222",
  user: "33333333-3333-4333-8333-333333333333",
  otherUser: "99999999-9999-4999-8999-999999999999",
  rsvp: "44444444-4444-4444-8444-444444444444",
  order: "55555555-5555-4555-8555-555555555555",
  otherOrder: "66666666-6666-4666-8666-666666666666",
} as const;

export interface RsvpRow {
  id: string;
  status: string;
}

export function rsvpRow(overrides: Partial<RsvpRow> = {}): RsvpRow {
  return { id: EVENT_IDS.rsvp, status: "going", ...overrides };
}

export interface EventRow {
  id: string;
  slug: string;
  title_pl: string;
  title_en: string;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string | null;
  location: string | null;
}

export function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: EVENT_IDS.event,
    slug: "szczyt-energetyczny",
    title_pl: "Szczyt energetyczny",
    title_en: "Energy summit",
    starts_at: "2026-09-01T08:00:00.000Z",
    ends_at: "2026-09-01T16:00:00.000Z",
    timezone: "Europe/Warsaw",
    location: "Bruksela",
    ...overrides,
  };
}

export interface PaymentOrderRow {
  id: string;
  amount_cents: number | null;
  currency: string | null;
  paid_at: string | null;
  provider_intent_id: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
}

export function paymentOrderRow(overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
  return {
    id: EVENT_IDS.order,
    amount_cents: 12000,
    currency: "PLN",
    paid_at: "2026-08-01T10:00:00.000Z",
    provider_intent_id: "pi_test_123",
    metadata: { event_id: EVENT_IDS.event },
    status: "paid",
    ...overrides,
  };
}

export interface ProfileRow {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
}

export function profileRow(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    email: "anna@example.org",
    first_name: "Anna",
    last_name: "Kowalska",
    display_name: "anna.k",
    ...overrides,
  };
}

/** Wiersz `get_event_rsvp_counts` - RPC zwraca TABLICĘ, kod czyta `[0]`. */
export function rsvpCountsRow(going: number, waitlist = 0): Array<Record<string, unknown>> {
  return [{ going, waitlist }];
}

/** Zapisane wywołanie RPC - do asercji „tego zapytania NIE było". */
export interface RecordedRpc {
  readonly fn: string;
  readonly args: Record<string, unknown> | undefined;
}

export interface SupabaseClientStub {
  /** Obiekt o kształcie klienta - wstrzykiwany do funkcji warstwy serwerowej. */
  client: {
    from: (table: string) => unknown;
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<SupabaseResult>;
  };
  /** Atrapa łańcucha `from(...)` - `setResponse`, `lastChain`, `chainsFor`. */
  db: SupabaseFromStub;
  /** Wszystkie wywołania RPC w kolejności. */
  rpcCalls: RecordedRpc[];
  /** Zaplanuj odpowiedź RPC (domyślnie: pusta tablica). */
  setRpc(fn: string, result: SupabaseResult): void;
}

export function supabaseClientStub(): SupabaseClientStub {
  const db = supabaseFromStub();
  const rpcCalls: RecordedRpc[] = [];
  const responses = new Map<string, SupabaseResult>();

  return {
    db,
    rpcCalls,
    setRpc(fn, result) {
      responses.set(fn, result);
    },
    client: {
      from: db.from,
      rpc: (fn, args) => {
        rpcCalls.push({ fn, args });
        return Promise.resolve(responses.get(fn) ?? ok([]));
      },
    },
  };
}
