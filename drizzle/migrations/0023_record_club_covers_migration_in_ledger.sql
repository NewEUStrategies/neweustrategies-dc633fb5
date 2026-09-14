-- Rejestr wdrożeń: SQL z `supabase/migrations/20260914184500_club_covers_per_club_storage_write.sql`
-- został wykonany na tej bazie (funkcja `public.club_is_cover_moderator` oraz trzy
-- polityki `club covers moderator *` istnieją), ale bez wpisu w rejestrze - bramka
-- `check:migration-ledger` widziała go jako niewdrożony. Domykamy rejestr.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260914184500', 'club_covers_per_club_storage_write')
ON CONFLICT (version) DO NOTHING;
