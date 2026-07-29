// Bilet na wydarzenie i stan miejsc - warstwa serwerowa.
//
// Bilet czytamy jako zalogowany użytkownik (RLS: własny wiersz RSVP i własne
// zamówienie), więc nikt nie pobierze cudzej wejściówki. Stan miejsc jest
// publiczny i liczony przez RPC `get_event_rsvp_counts` (SECURITY DEFINER),
// dzięki czemu liczba zajętych miejsc nie wymaga wglądu w cudze wiersze RSVP.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ticketCodeFrom } from "./ticketCode";

export interface EventSeatState {
  eventId: string;
  capacity: number | null;
  going: number;
  waitlist: number;
  /** `null` = brak limitu miejsc. */
  seatsLeft: number | null;
  isFull: boolean;
  /** Znacznik odczytu - klient pokazuje, jak świeża jest liczba miejsc. */
  checkedAt: string;
}

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
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function seatsFor(supabase: SupabaseClient, eventId: string): Promise<EventSeatState> {
  const [{ data: event }, { data: counts }] = await Promise.all([
    supabase.from("events").select("capacity").eq("id", eventId).maybeSingle(),
    supabase.rpc("get_event_rsvp_counts", { p_event_ids: [eventId] }),
  ]);

  const row = (Array.isArray(counts) ? counts[0] : null) as
    | { going?: number; waitlist?: number }
    | null;
  const capacity =
    typeof event?.capacity === "number" && event.capacity > 0 ? Number(event.capacity) : null;
  const going = Number(row?.going ?? 0);
  const seatsLeft = capacity === null ? null : Math.max(0, capacity - going);

  return {
    eventId,
    capacity,
    going,
    waitlist: Number(row?.waitlist ?? 0),
    seatsLeft,
    isFull: seatsLeft !== null && seatsLeft === 0,
    checkedAt: new Date().toISOString(),
  };
}

/** Publiczny odczyt dostępności miejsc (klucz publikowalny, polityki anon). */
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

export interface MyEventTicket {
  eventId: string;
  slug: string;
  titlePl: string;
  titleEn: string;
  startsAt: string | null;
  endsAt: string | null;
  timezone: string | null;
  location: string | null;
  /** Numer biletu prezentowany posiadaczowi i zakodowany w QR. */
  code: string;
  /** Numer transakcji u operatora - tylko dla biletów płatnych. */
  transactionId: string | null;
  amountCents: number | null;
  currency: string | null;
  paidAt: string | null;
  holderName: string | null;
  holderEmail: string | null;
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

  const { data: event } = await supabase
    .from("events")
    .select("id, slug, title_pl, title_en, starts_at, ends_at, timezone, location")
    .eq("id", eventId)
    .maybeSingle();
  if (!event) return null;

  // Opłacony bilet: najnowsze zamówienie tego użytkownika dla wydarzenia.
  const { data: orders } = await supabase
    .from("payment_orders")
    .select("id, amount_cents, currency, paid_at, provider_intent_id, metadata, status")
    .eq("user_id", userId)
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(20);

  const order = (orders ?? []).find(
    (row) => ((row.metadata ?? {}) as Record<string, unknown>).event_id === eventId,
  );

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, first_name, last_name, display_name")
    .eq("id", userId)
    .maybeSingle();

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
