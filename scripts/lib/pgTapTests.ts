/**
 * Jedno miejsce z lokalizacją suity pgTAP - tak jak `MIGRATIONS_DIR` w
 * `scripts/lib/sqlMigrations.ts`. Czytają je bramka `check:pgtap-plan` i jej test
 * jednostkowy, więc przeniesienie katalogu nie zostawia jednej strony w tyle.
 */
export const PGTAP_TESTS_DIR = "supabase/tests";
