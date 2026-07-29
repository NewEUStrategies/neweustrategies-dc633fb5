// Ręczne uruchomienie przypomnień rozliczeniowych z panelu administracyjnego.
// Cienka warstwa RPC: cała logika żyje w `reminders.server` (server-only),
// tutaj zostaje wyłącznie kontrakt wejścia i bramka uprawnień.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdmin } from "@/integrations/supabase/require-staff";

const inputSchema = z.object({
  leadDays: z.number().int().min(1).max(30).optional(),
});

export const runBillingRemindersNow = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { runBillingReminders, REMINDER_LEAD_DAYS } = await import(
      "@/lib/billing/reminders.server"
    );
    const leadDays = data.leadDays ?? REMINDER_LEAD_DAYS;
    const result = await runBillingReminders(leadDays);
    return { leadDays, ...result };
  });
