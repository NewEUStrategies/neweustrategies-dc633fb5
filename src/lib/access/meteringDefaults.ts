// DOMYŚLNA KONFIGURACJA METERINGU - kontrakt TS ⇄ SQL.
//
// TRZY MIEJSCA MÓWIĄ TO SAMO: domyślne kolumn `metering_settings` (wiersz
// najemcy, który nigdy nie zapisał ustawień), funkcja SQL `metering_defaults()`
// (diagnostyka i naprawa „brak wiersza ustawień" w hubie) i ta stała (formularz
// paywalla, podgląd naprawy). Rozjazd pokazałby adminowi „domyślnie 5 artykułów",
// podczas gdy baza liczy 3 - dlatego `meteringDefaultsParity.test.ts` porównuje
// wszystkie trzy, plus `DEFAULT_METERING_SETTINGS` z `metering.ts`.
//
// OSOBNY LIŚĆ, a nie stała w `metering.ts`: tamten moduł ciągnie React Query,
// klienta Supabase i server fns gościa, a tę wartość czyta też diagnostyka
// huba. Scalenie (re-eksport w `metering.ts`) robi wycinek S1, właściciel
// `metering.ts`.
import type { MeteringSettings } from "@/lib/access/metering";

export const METERING_DEFAULTS: Readonly<MeteringSettings> = {
  enabled: true,
  member_monthly_limit: 5,
  anon_monthly_limit: 0,
  meter_paid: true,
  meter_members: true,
  show_counter: true,
};
