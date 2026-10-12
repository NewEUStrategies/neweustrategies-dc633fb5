// Ręczne uruchomienie przypomnień rozliczeniowych z panelu administracyjnego.
// Cienka warstwa RPC: cała logika żyje w `reminders.server` (server-only),
// tutaj zostaje wyłącznie kontrakt wejścia i bramka uprawnień.
//
// BRAMKA PLATFORMY, NIE NAJEMCY. Przebieg obejmuje subskrypcje WSZYSTKICH
// najemców (tak samo jak cron) - to operacja instalacji, więc stoi za
// `requirePlatformAdmin` (super_admin w najemcy domyślnym), tą samą bramką
// co ustawienia runnera zadań, który ten przebieg uruchamia codziennie. Do
// 12.10.2026 wystarczał `requireAdmin` dowolnego najemcy: admin najemcy B
// rozsyłał przypomnienia klientom najemcy A i piaskownicy.
//
// ŚRODOWISKO Z SERWERA. Ładunek go nie niesie - `runBillingReminders` bierze
// `resolveEnvironment()` (produkcja = zawsze `live`), więc przycisk w panelu
// nie może wysłać przypomnień klientom testowym ani odwrotnie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePlatformAdmin } from "@/integrations/supabase/require-staff";

const inputSchema = z.object({
  leadDays: z.number().int().min(1).max(30).optional(),
});

export const runBillingRemindersNow = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .validator((input: unknown) => inputSchema.parse(input ?? {}))
  .handler(async ({ data }) => {
    const { runBillingReminders, REMINDER_LEAD_DAYS } =
      await import("@/lib/billing/reminders.server");
    const leadDays = data.leadDays ?? REMINDER_LEAD_DAYS;
    // Wyprzedzenie inne niż standardowe dostaje własną przestrzeń kluczy
    // idempotencji (`reminderSeed`), więc nie zużywa właściwego przypomnienia.
    const result = await runBillingReminders(leadDays);
    return { leadDays, ...result };
  });
