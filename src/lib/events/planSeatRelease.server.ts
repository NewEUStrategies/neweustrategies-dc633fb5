// Przegląd biletów z puli planu, których zgłoszenie już nie potrzebuje
// (porzucona kasa, kasa przerwana przed zamówieniem, zamówienie failed/canceled).
//
// DLACZEGO TAKŻE Z CRONA APLIKACJI. Migracja 20260926180000 planuje przegląd
// w pg_cron (`event-plan-seat-release`, co godzinę), ale bez pg_cron - albo gdy
// zakładanie zadania się nie uda - kończy się komunikatem NOTICE. Wtedy bilet
// porzuconej kasy zostawałby zajęty na zawsze i z czasem wyczerpywałby pulę
// członka albo organizacji. `community-cron` (scheduler repo co 5 minut) woła
// więc ten sam przegląd niezależnie od pg_cron. Funkcja w bazie jest
// idempotentna (`SKIP LOCKED`, godzina karencji od zajęcia), więc dwa źródła
// wywołań niczego nie dublują.
//
// MIGRACJA PRZED KODEM. Produkcja dostaje migracje ręcznie (panel Lovable), a kod
// wychodzi sam. Brak funkcji w bazie to „nic do zrobienia", a nie awaria - krok
// nie może zaczerwienić przebiegu crona.
//
// Moduł server-only (klient service_role).
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export interface PlanSeatReleaseResult {
  /** Bilety zwrócone do puli w tym przebiegu. */
  released: number;
  skipped?: "migration_pending";
}

/**
 * Jeden przebieg przeglądu. Rzuca tylko przy błędzie bazy innym niż brak
 * migracji - krok crona świeci wtedy na czerwono.
 */
export async function runPlanSeatRelease(limit = 500): Promise<PlanSeatReleaseResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("_event_plan_seat_release_lapsed", {
    p_limit: limit,
  });
  if (error) {
    if (isMigrationPending(error)) return { released: 0, skipped: "migration_pending" };
    throw new Error(error.message);
  }
  return { released: typeof data === "number" ? data : 0 };
}
