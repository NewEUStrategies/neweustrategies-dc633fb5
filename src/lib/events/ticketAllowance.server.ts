// Bilet wliczony w plan - odczyt puli po stronie serwera.
//
// Jedno wejście do RPC `my_ticket_allowance` dla wszystkich ścieżek
// serwerowych (kasa biletowa, zamówienie ad-hoc, strona wydarzenia), żeby
// kwota policzona przed płatnością była liczona TĄ SAMĄ regułą, co kwota
// pokazana na karcie. Klient nigdy nie podaje ceny biletu ani zniżki.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_TICKET_ALLOWANCE,
  parseTicketAllowance,
  ticketAmountCents,
  type TicketAllowance,
} from "./ticketAllowance";

/**
 * Stan puli dla wołającego (klient z jego sesją - RPC czyta `auth.uid()`).
 *
 * Awaria RPC degraduje się do PUSTEJ puli, nie do wyjątku: brak odpowiedzi
 * o benefitach nie może zablokować zakupu biletu za pełną cenę. Kierunek
 * degradacji jest jedyny dopuszczalny - w drugą stronę błąd bazy rozdawałby
 * darmowe wejściówki.
 */
export async function loadTicketAllowance(supabase: SupabaseClient): Promise<TicketAllowance> {
  const { data, error } = await supabase.rpc("my_ticket_allowance");
  if (error) {
    console.error("[tickets] my_ticket_allowance failed", error.message);
    return EMPTY_TICKET_ALLOWANCE;
  }
  return parseTicketAllowance(data);
}

/**
 * Cena biletu do pobrania od tego wołającego: cena wydarzenia pomniejszona
 * o zniżkę planu. Zwraca 0, gdy bilet pokrywa pula - wtedy poprawną ścieżką
 * NIE jest kasa, tylko `rsvp_event`, które pulę skonsumuje.
 */
export async function ticketPriceForCaller(
  supabase: SupabaseClient,
  faceValueCents: number,
): Promise<{ amountCents: number; allowance: TicketAllowance }> {
  const allowance = await loadTicketAllowance(supabase);
  return { amountCents: ticketAmountCents(faceValueCents, allowance), allowance };
}
