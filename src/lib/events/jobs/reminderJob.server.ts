// Zadanie w tle: przypomnienia o wydarzeniu i sesjach (F2).
//
// ZAŚLEPKA FOUNDATION. Harmonogram (`jobsTick.server.ts`, `community-cron.ts`)
// woła tę funkcję od pierwszego dnia, żeby tor A wymieniał wyłącznie treść
// modułu, a nie pliki harmonogramu (kontrakt C.0.2). Sygnatura jest zamrożona:
// `(admin, opts) => Promise<ParticipantJobResult>`. Do czasu wymiany zadanie
// nic nie robi i mówi o tym wprost (`note: "stub"`).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  EMPTY_JOB_RESULT,
  type ParticipantJobOptions,
  type ParticipantJobResult,
} from "@/lib/events/jobs/types";

export async function runEventParticipantReminders(
  _admin: SupabaseClient<Database>,
  _opts: ParticipantJobOptions,
): Promise<ParticipantJobResult> {
  return { ...EMPTY_JOB_RESULT, note: "stub" };
}
