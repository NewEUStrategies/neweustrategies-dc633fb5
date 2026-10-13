// Durable refunds requested by organiser rejection, serviced by both existing schedulers -
// and retries of free (100% code) ticket orders whose settlement broke off: they have
// no payment-provider webhook to retry them (TIX-13a).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runRegistrationRefunds } from "@/lib/events/registrationRefunds.server";
import type { ParticipantJobOptions, ParticipantJobResult } from "@/lib/events/jobs/types";
import {
  runUnsettledFreeTicketOrders,
  type UnsettledFreeTicketOrdersResult,
} from "@/lib/billing/oneTimeFulfilment.server";

export async function runEventTicketLifecycle(
  admin: SupabaseClient<Database>,
  opts: ParticipantJobOptions,
): Promise<ParticipantJobResult> {
  const result = await runRegistrationRefunds(admin, opts.limit ?? 10, opts.deadlineAt);
  // Zwroty już przeszły - błąd odczytu listy darmowych zamówień nie może
  // skasować ich bilansu z logu przebiegów; zamówienia wrócą w następnym ticku.
  let free: UnsettledFreeTicketOrdersResult;
  let freeNote = "";
  try {
    free = await runUnsettledFreeTicketOrders(admin, opts.limit ?? 10, opts.deadlineAt);
    if (free.skipped) freeNote = `:${free.skipped}`;
  } catch (err) {
    console.error(
      "[events] free ticket order retries failed",
      err instanceof Error ? err.message : String(err),
    );
    free = { claimed: 0, settled: 0, failed: 1, deferred: 0 };
    freeNote = ":error";
  }
  const freeTouched = free.claimed > 0 || free.failed > 0 || freeNote !== "";
  return {
    claimed: result.claimed + free.claimed,
    sent: result.submitted + free.settled,
    failed: result.failed + free.failed,
    skipped: result.deferred + free.deferred,
    note: freeTouched
      ? `registration_refunds,free_ticket_orders${freeNote}`
      : "registration_refunds",
  };
}
