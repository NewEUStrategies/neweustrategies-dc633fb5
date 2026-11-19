# Oczekujące zmiany bazy (do PR na GitHubie)

Pliki tutaj NIE są migracjami i nie są wdrażane. Każdy przenosi się w reviewed PR
(np. sesja Claude) według `docs/RUNBOOK_MIGRACJE_LOVABLE.md`:

1. `git mv docs/pending-db-changes/<plik>.sql supabase/migrations/<plik>.sql`
2. `bun run migrations:mirror`
3. `bun run generate:authz-snapshot`
4. `bun run check:migration-lanes`
5. Po scaleniu: wdrożenie jednym wyzwalaczem z czatu Lovable (`--pending` -> COMMENT ON SCHEMA -> `--verify`).

## Lista

Brak oczekujących plików. Przeniesione:

- `20261119190000_event_seats_helper_private_crm_lead_account_guard.sql` -> `supabase/migrations/`
  (lustro `drizzle/migrations/0416_event_seats_helper_private_crm_lead_account_guard.sql`).
