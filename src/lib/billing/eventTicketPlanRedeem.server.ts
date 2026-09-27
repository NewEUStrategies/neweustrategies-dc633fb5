// Odbiór biletu z puli planu dla POJEDYNCZEGO zgłoszenia etapu 4 - bez Stripe.
//
// PO CO. Członek z biletem w puli, zapisany formularzem etapu 4 bez gości,
// kończył w kasie odmową `ticket_included_in_plan` („odbierz z puli
// członkowskiej") - a drogi odbioru dla takiego zgłoszenia nie było:
// `claim_included_event_ticket` zna wyłącznie `rsvp_event`. Zgłoszenie stało
// `pending/unpaid` bez wejściówki.
//
// KOLEJNOŚĆ JEST KONTRAKTEM:
//   1. Wycena `priceEventTicket` - ta sama, którą liczy podgląd kasy: własność
//      zgłoszenia, cennik (okno sprzedaży, kod dostępu, wolne miejsca), liczba
//      miejsc i pula na sucho. Odmowy RZUCAJĄ tymi samymi kodami co kasa, więc
//      ekran mapuje je tym samym słownikiem (`ticketCheckoutRefusal`). Cena
//      różna od zera = pula tego zgłoszenia nie pokrywa (pusta, grupa z gośćmi,
//      miejsce gościa) - odmowa `plan_ticket_unavailable`, ekran przelicza podgląd.
//   2. `event_registration_redeem_plan_ticket` - baza rozstrzyga WSZYSTKO
//      jeszcze raz pod blokadami (zgłoszenie, wolne miejsce, pula) i dopiero
//      wtedy zdejmuje bilet z puli i przyjmuje zgłoszenie. Wycena z kroku 1 to
//      tylko wczesna odmowa z dobrym zdaniem, a nie autorytet.
//   3. Bilet z kodem QR od razu (`issueAndSendTicketCodes`, jak webhook po
//      opłaceniu). Nieudana wysyłka nie cofa odbioru - cron domknie.
//
// Moduł server-only: RPC woła klientem Z SESJĄ wołającego (`auth.uid()` to
// właściciel puli), wysyłkę biletu - kluczem serwisowym przez
// `issueAndSendTicketCodes`, dla zgłoszenia, którego własność sprawdziła baza.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

export interface PlanTicketRedeemInput {
  eventId: string;
  ticketTypeId: string;
  registrationId: string;
  /** Kod dostępu wejściówki (jak w kasie); pusty napis = brak klucza. */
  accessCode?: string;
}

export type PlanTicketRedeemResult =
  { ok: true; registrationId: string; ticketsSent: number } | { ok: false; error: string };

/**
 * Powód odmowy bazy -> kod, który ekran czyta `ticketCheckoutRefusal`.
 * Nazwy po lewej to powody `event_registration_redeem_plan_ticket`
 * (i `event_registration_claim_plan_seat`, który ta woła).
 */
export const REDEEM_REFUSALS: Readonly<Record<string, string>> = {
  account_required: "auth_required",
  not_found: "registration_not_payable:not_found",
  registration_closed: "registration_not_payable:registration_closed",
  already_settled: "registration_not_payable:already_settled",
  group_order: "plan_ticket_unavailable",
  not_eligible: "plan_ticket_unavailable",
  pool_empty: "plan_ticket_unavailable",
  ticket_not_available: "ticket_not_available",
  event_finished: "event_finished",
  sales_not_open: "ticket_sales_not_open",
  sales_closed: "ticket_sales_closed",
  approval_required: "plan_ticket_awaiting_approval",
  sold_out: "ticket_sold_out",
};

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Odbiera bilet z puli dla zgłoszenia wołającego. Odmowy wyceny RZUCAJĄ (jak
 * w kasie), odmowy bazy wracają jako `{ ok: false, error }`, błąd RPC rzuca.
 */
export async function redeemPlanTicket(
  supabase: Client,
  input: PlanTicketRedeemInput,
): Promise<PlanTicketRedeemResult> {
  const { priceEventTicket } = await import("@/lib/billing/eventTicketPricing.server");
  const price = await priceEventTicket(supabase, {
    eventId: input.eventId,
    ticketTypeId: input.ticketTypeId,
    registrationId: input.registrationId,
    accessCode: input.accessCode,
    allowPlanRedemption: true,
  });
  if (price.amountCents > 0) return { ok: false, error: "plan_ticket_unavailable" };

  const { data, error } = await supabase.rpc("event_registration_redeem_plan_ticket", {
    p_registration_id: input.registrationId,
  });
  if (error) throw new Error(error.message);
  const row = objectOf(data);
  if (row === null || row.ok !== true) {
    const reason = typeof row?.reason === "string" ? row.reason : "";
    return { ok: false, error: REDEEM_REFUSALS[reason] ?? "unknown" };
  }

  // Wydanie nigdy nie rzuca (fail-soft) - zgłoszenie jest już rozliczone.
  const { issueAndSendTicketCodes } = await import("@/lib/events/ticketCodeNotify.server");
  const ticketsSent = await issueAndSendTicketCodes(input.registrationId);
  return { ok: true, registrationId: input.registrationId, ticketsSent };
}
