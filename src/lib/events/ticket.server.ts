// Bilet na wydarzenie i stan miejsc - warstwa serwerowa.
//
// Bilet czytamy jako zalogowany użytkownik (RLS: własny wiersz RSVP i własne
// zamówienie), więc nikt nie pobierze cudzej wejściówki.
//
// STAN MIEJSC MA JEDNO ŹRÓDŁO: `event_seat_state` (SECURITY DEFINER), które
// liczy wolne miejsca regułą `_event_page_seats_left` - tą samą, której używa
// nagłówek strony (`event_page_header().seats_left`). Wcześniej ten moduł
// liczył wyłącznie pulę legacy (`get_event_rsvp_counts`), więc wydarzenie
// zapełniane formularzem zgłoszeń miało na jednej stronie dwie liczby miejsc,
// a kasa sprzedawała bilet na miejsce, którego reguła bazy już nie widzi
// (migracja 20261002210000). Jedno wywołanie zamiast dwóch: pojemność jedzie
// w tym samym wierszu.
//
// KLIENT PUBLICZNY NIESIE HOSTA. `public_tenant_id()` rozpoznaje najemcę po
// nagłówku hosta (`fetchWithTenantHost`); bez niego odczyt z domeny najemcy B
// liczył miejsca najemcy domyślnego, czyli dla wydarzenia B - żadne.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { fetchWithTenantHost } from "@/integrations/supabase/tenant-host-fetch";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

import { ticketCodeFrom } from "./ticketCode";
import type { EventSeatState, MyEventTicket } from "./ticketTypes";

function publicClient(): SupabaseClient {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  return createClient(process.env.SUPABASE_URL ?? "", key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        // Klucze `sb_` są nieprzezroczyste (nie są JWT) - PostgREST przyjmuje
        // je wyłącznie w nagłówku `apikey`.
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetchWithTenantHost(input, { ...init, headers });
      },
    },
  });
}

interface SeatRow {
  capacity?: unknown;
  seats_left?: unknown;
  going?: unknown;
  waitlist?: unknown;
}

/** Liczba z wiersza RPC; PostgREST potrafi oddać `bigint` jako napis. */
function countOf(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function seatState(eventId: string, row: SeatRow | null): EventSeatState {
  // `capacity > 0`: zero i liczby ujemne znaczą BRAK limitu, nie wyprzedanie.
  const rawCapacity = Number(row?.capacity);
  const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : null;
  const rawLeft = row?.seats_left;
  const left = rawLeft === null || rawLeft === undefined ? null : Number(rawLeft);
  // Bez limitu nie ma czego odliczać, nawet gdy baza podała liczbę.
  const seatsLeft =
    capacity === null || left === null || !Number.isFinite(left) ? null : Math.max(0, left);

  return {
    eventId,
    capacity,
    going: countOf(row?.going),
    waitlist: countOf(row?.waitlist),
    seatsLeft,
    isFull: seatsLeft !== null && seatsLeft === 0,
    checkedAt: new Date().toISOString(),
  };
}

/** Dawna reguła (pula legacy) - WYŁĄCZNIE w oknie wdrożenia migracji. */
async function legacySeatsFor(supabase: SupabaseClient, eventId: string): Promise<EventSeatState> {
  const [{ data: event }, { data: counts }] = await Promise.all([
    supabase.from("events").select("capacity").eq("id", eventId).maybeSingle(),
    supabase.rpc("get_event_rsvp_counts", { p_event_ids: [eventId] }),
  ]);
  const row = (Array.isArray(counts) ? counts[0] : null) as SeatRow | null;
  const capacity = Number(event?.capacity);
  const going = countOf(row?.going);
  return seatState(eventId, {
    capacity: event?.capacity ?? null,
    seats_left: Number.isFinite(capacity) && capacity > 0 ? capacity - going : null,
    going,
    waitlist: row?.waitlist,
  });
}

async function seatsFor(supabase: SupabaseClient, eventId: string): Promise<EventSeatState> {
  const { data, error } = await supabase.rpc("event_seat_state", { p_event_id: eventId });
  if (error) {
    // PostgREST nie zna funkcji albo Postgres jej nie ma - migracja
    // 20261002210000 jeszcze nie weszła. Tylko w tym oknie wdrożenia liczymy
    // dawną regułą (pula legacy), żeby kasa nie stanęła; każdy inny błąd odczytu
    // miejsc RZUCA - bramka sprzedaży nie może czytać awarii jako „bez limitu".
    if (isMigrationPending(error)) {
      return legacySeatsFor(supabase, eventId);
    }
    throw new Error(`seat_state_unavailable: ${error.message}`);
  }
  // Brak wiersza = wydarzenie nieopublikowane albo innego najemcy: o jego
  // miejscach nic nie wiemy, więc nie ma też limitu, który można by egzekwować.
  const row = (Array.isArray(data) ? data[0] : null) as SeatRow | null | undefined;
  return seatState(eventId, row ?? null);
}

/** Publiczny odczyt dostępności miejsc (klucz publikowalny, host wołającego). */
export function loadEventSeatState(eventId: string): Promise<EventSeatState> {
  return seatsFor(publicClient(), eventId);
}

/**
 * Autorytatywna kontrola miejsc przed sprzedażą biletu. Rzuca `event_full`,
 * gdy limit jest wyczerpany - klient nie może tego pominąć.
 */
export async function assertSeatAvailable(
  supabase: SupabaseClient,
  eventId: string,
  userId: string,
): Promise<void> {
  // Kto ma już potwierdzone miejsce (np. ponawia nieopłacone zamówienie),
  // nie zajmuje kolejnego - limit go nie dotyczy.
  const { data: mine } = await supabase
    .from("event_rsvps")
    .select("status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (mine?.status === "going") return;

  const seats = await seatsFor(supabase, eventId);
  if (seats.isFull) throw new Error("event_full");
}

/** Bilet zalogowanego użytkownika; `null`, gdy nie ma potwierdzonego wejścia. */
export async function loadMyEventTicket(
  supabase: SupabaseClient,
  userId: string,
  eventId: string,
): Promise<MyEventTicket | null> {
  const { data: rsvp } = await supabase
    .from("event_rsvps")
    .select("id, status")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!rsvp || rsvp.status !== "going") return null;

  // Trzy odczyty niezależne od siebie - jeden round-trip zamiast trzech.
  //
  // ZAMÓWIENIE FILTRUJE BAZA, NIE TEN KOD. Wcześniej brały się „20 ostatnich
  // opłaconych zamówień użytkownika" i dopasowanie `metadata.event_id` szło
  // w pamięci - członek z dwudziestoma nowszymi zakupami (składki, inne bilety)
  // dostawał bilet bez kwoty i z numerem z RSVP zamiast z zamówienia. Filtr
  // jest tym samym, którym `rsvp_event()` sprawdza opłacenie
  // (`metadata ->> 'event_id'`), więc bilet i bramka wejścia widzą to samo
  // zamówienie.
  const [{ data: event }, { data: order }, { data: profile }] = await Promise.all([
    supabase
      .from("events")
      .select("id, slug, title_pl, title_en, starts_at, ends_at, timezone, location")
      .eq("id", eventId)
      .maybeSingle(),
    supabase
      .from("payment_orders")
      .select("id, amount_cents, currency, paid_at, provider_intent_id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .eq("metadata->>event_id", eventId)
      .order("paid_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("email, first_name, last_name, display_name")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (!event) return null;

  const holderName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    profile?.display_name ||
    null;

  return {
    eventId,
    slug: String(event.slug ?? ""),
    titlePl: String(event.title_pl ?? ""),
    titleEn: String(event.title_en ?? ""),
    startsAt: event.starts_at ?? null,
    endsAt: event.ends_at ?? null,
    timezone: event.timezone ?? null,
    location: event.location ?? null,
    code: ticketCodeFrom(order?.id ?? rsvp.id),
    transactionId: order?.provider_intent_id ?? null,
    amountCents: order?.amount_cents ?? null,
    currency: order?.currency ?? null,
    paidAt: order?.paid_at ?? null,
    holderName,
    holderEmail: profile?.email ?? null,
  };
}
