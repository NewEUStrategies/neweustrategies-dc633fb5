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

    // ŚLAD AUDYTOWY: NAJEMCA OPERATORA, NIE TYLKO OPERATOR. `JobsTickMeta`
    // deklaruje parę (`tenantId`, `actorId`) jako ślad ręcznego ticku, a
    // `recordJobRun` odkłada ją w `job_runner_runs`. Bez najemcy wiersz miał
    // `tenant_id: null`, choć tick jedzie ponad RLS przez kolejki WSZYSTKICH
    // najemców - a kolumna `tenant_id` jest jedynym miejscem, w którym widać,
    // CZYJ operator to wypchnął. Rekonstrukcja po `actorId` tego nie zastąpi:
    // wymaga sięgnięcia do profilu, który do czasu audytu mógł już zmienić
    // przestrzeń roboczą. Bliźniacza funkcja `/admin/scheduler`
    // (`lib/admin/scheduler.functions.ts`) rozwiązuje najemcę tak samo, więc
    // identyczne działanie z dwóch paneli zapisuje się TAK SAMO.
    //
    // Klient SESJI (nie service role) i tylko `context.userId`: profil czyta
    // się w granicach RLS wołającego, a identyfikator nie pochodzi z wejścia -
    // funkcja nie ma walidatora, więc nie da się podać cudzego operatora.
    // Błąd odczytu ŚWIADOMIE nie przerywa ticku (destrukturyzujemy samo
    // `data`): niepełny ślad kosztuje mniej niż niezadrenowane kolejki poczty
    // i push wszystkich najemców.
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();

    // Źródło 'admin' + operator idą do logu przebiegów (job_runner_runs), więc
    // ręczne wypchnięcie alertów jest w panelu zdrowia odróżnialne od crona.
    return runJobsTick(supabaseAdmin, {
      source: "admin",
      tenantId: profile?.tenant_id ?? null,
      actorId: context.userId,
    });
  });
