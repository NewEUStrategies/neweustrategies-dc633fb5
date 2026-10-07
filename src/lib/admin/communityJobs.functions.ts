// Ręczne uruchomienie zadań crona z panelu społeczności.
//
// DLACZEGO FUNKCJA SERWEROWA. `run_event_reminders()` i
// `chat_purge_expired_messages()` to zadania crona: EXECUTE ma wyłącznie
// `service_role` (20261003140000, 20260801122000), bo żadne z nich nie pyta
// o rolę wołającego. Przyciski „Uruchom przypomnienia" i „Wyczyść wygasłe
// wiadomości" wołały je klientem przeglądarki, więc KAŻDE kliknięcie kończyło
// się 42501 - a test atrapy zwracał sukces (audyt ed13
// R-N-PRZYPOMNIENIA_UCZESTNIKA-s2; znalezisko kontraktu TS <-> SQL).
//
// Rolę sprawdza `requireAdmin` (admin/super_admin najemcy), wywołanie idzie
// rolą serwisową - tym samym, co cron (`dispatch.server.ts`). Oba zadania
// przetwarzają tylko to, co i tak jest należne (przypomnienia w oknie,
// wiadomości po TTL), z dziennikiem doręczeń przeciw duplikatom, więc ręczne
// uruchomienie przyspiesza najbliższy przebieg crona, a nie zmienia jego skutku.
import { createServerFn } from "@tanstack/react-start";

import { requireAdmin } from "@/integrations/supabase/require-staff";

// Nazwy RPC zostają LITERAŁAMI w wywołaniach: kontrakt TS <-> SQL
// (`src/lib/ci/tsSqlContract.ts`) czyta je z drzewa składniowego i sprawdza
// EXECUTE roli serwisowej na prawdziwej bazie.
function jobCount({ data, error }: { data: unknown; error: { message: string } | null }): number {
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

/** Należne przypomnienia o wydarzeniach - teraz, zamiast przy następnym ticku crona. */
export const runEventRemindersNow = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async (): Promise<number> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return jobCount(await supabaseAdmin.rpc("run_event_reminders"));
  });

/** Wiadomości czatu po upływie TTL - teraz, zamiast przy następnym ticku crona. */
export const purgeExpiredMessagesNow = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .handler(async (): Promise<number> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return jobCount(await supabaseAdmin.rpc("chat_purge_expired_messages"));
  });
