// Tracker-admin server functions. Manualny "tick" zadań tła dla panelu
// /admin/tracker - dzięki temu redakcja może natychmiast wypchnąć alerty
// (push/notyfikacje) po dodaniu aktualizacji dossier, bez czekania na pg_cron.
import { createServerFn } from "@tanstack/react-start";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { runJobsTick, type JobsTickResult } from "@/lib/server/jobsTick.server";

export const runTrackerTickNow = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async (): Promise<JobsTickResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runJobsTick(supabaseAdmin);
  });
