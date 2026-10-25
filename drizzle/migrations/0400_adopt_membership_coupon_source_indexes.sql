-- migrations-mirror: supabase/migrations/20261025090010_adopt_membership_coupon_source_indexes.sql
-- WYGENEROWANE przez `bun run migrations:mirror` z pliku wyzej - NIE EDYTUJ RECZNIE.
-- Zrodlo prawdy schematu: supabase/migrations. Ten plik to kopia dostawcza dla
-- migratora Drizzle platformy Lovable (drizzle.config.ts); bramka
-- check:migration-lanes pilnuje, ze jego SQL wykonywalny == zrodlo.

-- ============================================================================
-- ADOPCJA SCHEMATU, KTÓRY ISTNIAŁ WYŁĄCZNIE W DZIENNIKU DRIZZLE (2/2):
-- INDEKSY I KOMENTARZ KOLUMNY `membership_grants.source_coupon_id` (0392).
--
-- DEFEKT
--   `supabase/migrations` jest jedynym źródłem prawdy o schemacie, a dziennik
--   drizzle - generowanym nośnikiem wdrożenia. Wpis dziennika dopisany
--   z panelu Lovable, `drizzle/migrations/0392_membership_coupon_source.sql`
--   (2026-10-23), założył indeks `membership_grants_tenant_coupon_idx`
--   (tenant_id, source_coupon_id), którego ten pas nie ma, i nadpisał polski
--   komentarz kolumny `membership_grants.source_coupon_id` angielskim.
--   W odwrotną stronę: na produkcji kolumny `source_coupon_id` nie było aż do
--   0392 (20260725090300 weszła tam częściowo), więc nie mogło tam powstać
--   `idx_membership_grants_source_coupon` z 20260725090300 - indeks, na którym
--   klucz obcy ON DELETE SET NULL znajduje wiersze przy usuwaniu kuponu.
--
-- ZMIANA
--   1. `membership_grants_tenant_coupon_idx` - CREATE INDEX IF NOT EXISTS,
--      definicja 1:1 jak w 0392 (na produkcji no-op).
--   2. `idx_membership_grants_source_coupon` - CREATE INDEX IF NOT EXISTS,
--      definicja 1:1 jak w 20260725090300 (w tym pasie no-op; na produkcji
--      zakłada brakujący indeks klucza obcego).
--   3. Komentarz kolumny `membership_grants.source_coupon_id` - kanoniczny,
--      polski tekst z 20260725090300 (w tym pasie no-op; na produkcji
--      zastępuje angielski tekst z 0392).
--   Migrator drizzle wykonuje wpis w transakcji, więc indeks powstaje
--   zwykłym CREATE INDEX: blokada SHARE na `membership_grants` (mała tabela)
--   trwa do końca wsadu i na ten czas wstrzymuje zapisy nadań.
--
-- BLOKADY
--   Bez limitu CREATE INDEX czekałby na blokadę SHARE bez końca za każdą
--   otwartą transakcją, która pisze do `membership_grants`, a czekając -
--   blokowałby każdy nowy zapis nadań (kolejka blokad). `lock_timeout` 5 s:
--   zamiast tego szybkie 55P03, wycofanie całego wsadu i ponowienie (runbook
--   §4.6). Pierwszy wpis wsadu przełączenia, który może czekać na blokadę
--   tabeli, to ten (0399 podmienia tylko funkcję). SET na najwyższym poziomie
--   obowiązuje do końca wsadu (generator lustra zgłasza to ostrzeżeniem
--   `ustawienie-sesji`) - świadomie: chroni też 20261025090020 i 090030.
--
-- CZEGO NIE ZMIENIA
--   * Samej kolumny: ADD COLUMN z 0392 nie jest przenoszone - kolumna jest
--     w tym pasie od 20260725090300.
--   * Klucza obcego `membership_grants_source_coupon_id_fkey`: ten pas ma go
--     od 20260725090300 (REFERENCES w ADD COLUMN), produkcja od 0393 - nazwa
--     i definicja są identyczne. 0393 NIE jest przenoszone (ADD CONSTRAINT bez
--     IF NOT EXISTS wywraca bazę z tego pasa: 42710).
--   * Listy prelegentów z 0148: adoptuje ją osobny plik
--     20261025090000_adopt_event_speaker_panel_bio.sql. Ten plik celowo nie
--     wymienia obiektów modułu Wydarzeń: harness tego modułu odtwarza
--     wybrane po treści migracje na bazie atrap bez tabeli
--     `membership_grants`, więc instrukcje stąd padłyby tam na 42P01.
--   * Wpisów 0392/0393 w dzienniku drizzle (forward-only); w rejestrze
--     MIGRATION_LANES zostają `drizzleOnly` z adnotacją o tej adopcji.
--
-- IDEMPOTENTNE: drugi przebieg na tej samej bazie (z tego pasa albo na
-- produkcji przez nośnik w dzienniku drizzle) nie zmienia stanu.
-- Nośnik w dzienniku drizzle generuje `bun run migrations:mirror` (nagłówek
-- generatora + ten plik bajt w bajt); nikt nie pisze go ręcznie.
-- Test: supabase/tests/drizzle_only_schema_adoption_test.sql (asercje 17-19).
-- ============================================================================

SET lock_timeout = '5s';

-- ----------------------------------------------------------------------------
-- 1) membership_grants_tenant_coupon_idx - stan z 0392
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS membership_grants_tenant_coupon_idx ON public.membership_grants (tenant_id, source_coupon_id) WHERE source_coupon_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) idx_membership_grants_source_coupon - stan z 20260725090300 (produkcja)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_membership_grants_source_coupon
  ON public.membership_grants (source_coupon_id)
  WHERE source_coupon_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Komentarz kolumny - kanoniczny tekst z 20260725090300
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN public.membership_grants.source_coupon_id IS
  'Kupon B2B, ktory nadal te warstwe (source = ''coupon''). Nadanie powstaje WYLACZNIE po potwierdzonej płatności - patrz apply_b2b_coupon_effects.';
