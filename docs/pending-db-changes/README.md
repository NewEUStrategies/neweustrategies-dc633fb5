# Oczekujące zmiany bazy (do PR na GitHubie)

Pliki tutaj NIE są migracjami i nie są wdrażane. Każdy przenosi się w reviewed PR
(np. sesja Claude) według `docs/RUNBOOK_MIGRACJE_LOVABLE.md`:

1. `git mv docs/pending-db-changes/<plik>.sql supabase/migrations/<plik>.sql`
2. `bun run migrations:mirror`
3. `bun run generate:authz-snapshot`
4. `bun run check:migration-lanes`
5. Po scaleniu: wdrożenie jednym wyzwalaczem z czatu Lovable (`--pending` -> COMMENT ON SCHEMA -> `--verify`).

## Lista

- `20261120120000_notification_signal_channels.sql` - kanały sygnałów (@wzmianka, prośba
  o zdanie): natychmiastowy e-mail (domyślnie wyłączony), push „tylko wzmianki",
  osobisty webhook (standard/Slack/Discord, podpis HMAC), kolejka e-mail/webhook.
  Test: `20261120120000_notification_signal_channels.pgtap.sql` ->
  `git mv` do `supabase/tests/notification_signal_channels_test.sql`.
  Sprawdzone lokalnie (PGlite, uproszczony schemat): dwukrotne wykonanie bez błędu,
  wszystkie scenariusze testu zgodne. Po wdrożeniu Lovable podpina wysyłkę i ustawienia.

- `20261120220000_search_autosuggest_private_orgs.sql` - podpowiedzi wyszukiwarki nie
  ujawniają gościom firm członkowskich (B2B) ani usuniętych stron; eksport skanów leadów
  bez EXECUTE dla gościa. Test: `20261120220000_search_autosuggest_private_orgs.pgtap.sql` ->
  `git mv` do `supabase/tests/search_autosuggest_private_orgs_test.sql`.

Przeniesione:

- `20261119190000_event_seats_helper_private_crm_lead_account_guard.sql` -> `supabase/migrations/`
  (lustro `drizzle/migrations/0416_event_seats_helper_private_crm_lead_account_guard.sql`).
