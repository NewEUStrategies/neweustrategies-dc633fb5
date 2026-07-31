// Tracker-admin server functions. Manualny "tick" zadań tła dla panelu
// /admin/tracker - dzięki temu redakcja może natychmiast wypchnąć alerty
// (push/notyfikacje) po dodaniu aktualizacji dossier, bez czekania na pg_cron.
import { createServerFn } from "@tanstack/react-start";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { runJobsTick, type JobsTickResult } from "@/lib/server/jobsTick.server";

export const runTrackerTickNow = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<JobsTickResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Źródło 'admin' + operator idą do logu przebiegów (job_runner_runs), więc
    // ręczne wypchnięcie alertów jest w panelu zdrowia odróżnialne od crona.
    return runJobsTick(supabaseAdmin, { source: "admin", actorId: context.userId });
  });
