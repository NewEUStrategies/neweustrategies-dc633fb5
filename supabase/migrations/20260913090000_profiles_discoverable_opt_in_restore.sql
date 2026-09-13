-- Przywrócenie zgody wyrażonej WPROST: profiles.discoverable wraca do DEFAULT false.
--
-- PRZYCZYNA ŹRÓDŁOWA. `drizzle/migrations/0001_profiles_discoverable_default_true.sql`
-- przestawiło DEFAULT na true i przepisało KAŻDY wiersz `WHERE discoverable = false`
-- na true. Zmiana dotknęła wyłącznie katalogu drizzle/ - zero migracji w
-- supabase/migrations, zero testów, zero dokumentacji - więc ominęła całą warstwę
-- dowodową repozytorium: pgTAP stawia bazę przez `supabase db start` z
-- supabase/migrations, a każda bramka `check:sql-*` czyta
-- MIGRATIONS_DIR = "supabase/migrations" (scripts/lib/sqlMigrations.ts). Oba pasy
-- jadą na produkcję, więc baza dostała DEFAULT true, a całe repozytorium dalej
-- opisywało i testowało DEFAULT false.
--
-- DLACZEGO TO REGRESJA, A NIE POPRAWKA PRODUKTOWA. `discoverable` jest tu zgodą
-- wyrażoną wprost, nie preferencją domyślną:
--   * 20260826182500_event_attendees_and_discussions.sql opiera na tym argument
--     prawny listy uczestników - baza domyślnie mówi NIE, a człowiek, który nigdy
--     nie zdecydował, jest niewidoczny - i bramkuje nazwiska przez
--     `AND pr.discoverable = true`;
--   * `handle_new_user()` NIE wymienia tej kolumny, więc KAŻDA rejestracja bierze
--     DEFAULT; przestawienie DEFAULT zmienia zgodę wszystkich przyszłych kont,
--     nie pytając żadnego z nich;
--   * jedyny wcześniejszy backfill (20260719201038) flagował WYŁĄCZNIE profile już
--     publicznie widoczne - był wnioskiem ze stanu faktycznego, nie hurtowym
--     opt-inem.
--
-- CZEGO TA MIGRACJA NIE NAPRAWIA, powiedziane wprost: wierszy już przestawionych.
-- `UPDATE ... WHERE discoverable = false` zlał w jedno dwa rozłączne zbiory - ludzi,
-- którzy nigdy nie zdecydowali, i ludzi, którzy ŚWIADOMIE wyłączyli przełącznik -
-- a kolumny zapisującej FAKT decyzji nie ma. Rozdzielić ich po stronie bazy już się
-- NIE DA. Odtworzenie stanu sprzed 0001 wymaga kopii `profiles.discoverable` sprzed
-- jej zastosowania i jest decyzją operacyjną, nie migracyjną. Ta migracja NIE pisze
-- do danych: hurtowy `UPDATE` w drugą stronę wyłączyłby z katalogu także tych,
-- którzy włączyli się sami, czyli powtórzyłby ten sam błąd lustrzanie.
--
-- Bliźniak dla pipeline Drizzle:
-- drizzle/migrations/0006_profiles_discoverable_opt_in_restore.sql - bajt w bajt,
-- pilnuje tego src/lib/ci/__tests__/migrationLaneParity.test.ts.

ALTER TABLE public.profiles
  ALTER COLUMN discoverable SET DEFAULT false;

COMMENT ON COLUMN public.profiles.discoverable IS
  'Zgoda na widoczność w katalogu osób, wyrażona WPROST. DEFAULT false: konto, które nigdy nie zdecydowało, jest niewidoczne. Profile z discoverable=false widzi wyłącznie superadmin (is_super_admin()).';
