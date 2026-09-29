// Durable refunds requested by organiser rejection, serviced by both existing schedulers.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runRegistrationRefunds } from "@/lib/events/registrationRefunds.server";
import type { ParticipantJobOptions, ParticipantJobResult } from "@/lib/events/jobs/types";

export async function runEventTicketLifecycle(
  admin: SupabaseClient<Database>,
  opts: ParticipantJobOptions,
): Promise<ParticipantJobResult> {
  const result = await runRegistrationRefunds(admin, opts.limit ?? 10, opts.deadlineAt);
  return {
    claimed: result.claimed,
    sent: result.submitted,
    failed: result.failed,
    skipped: result.deferred,
    note: "registration_refunds",
  };
}
