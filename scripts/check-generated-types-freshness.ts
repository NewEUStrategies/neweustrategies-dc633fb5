/**
 * Bramka: wygenerowane typy Supabase nie odstają od migracji.
 *
 * Cienki runner - inwariant, uzasadnienie i parser żyją w
 * `src/lib/ci/generatedTypesFreshness.ts`, tak jak `check-stale-never-casts.ts`
 * trzyma swoją logikę w `src/lib/ci/staleNeverCasts.ts`. Dzięki temu bramka ma
 * test jednostkowy, a nie tylko przebieg w CI.
 *
 * Usage: bun run check:types-freshness
 *        bun run check:types-freshness --print-baseline   (do odświeżenia listy)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  columnKey,
  compareWithBaseline,
  findStaleColumns,
  freshnessFailed,
  readGeneratedColumns,
  renderFreshnessReport,
  type ScannedMigration,
} from "../src/lib/ci/generatedTypesFreshness";
import { MIGRATIONS_DIR } from "./lib/sqlMigrations";

const TYPES_FILE = "src/integrations/supabase/types.ts";

/**
 * ZAMROŻONY DŁUG: kolumny, które istnieją w migracjach i nie ma ich
 * w wygenerowanych typach. Stan na 2026-08-14, zmierzony - nie przepisany.
 *
 * Lista ma TYLKO MALEĆ i zniknie w całości przy najbliższej regeneracji
 * `types.ts` (`supabase gen types typescript --linked`). Regeneracja to osobna
 * zmiana: przepisuje ~20 tysięcy linii wygenerowanego pliku i dotyka każdego
 * zapytania w repo, więc nie wolno jej doklejać do PR-a o czymś innym.
 *
 * Cztery wpisy `research_program_*.tenant_id` są tu najważniejsze: to kolumna,
 * na której stoi izolacja najemców, i dopóki nie ma jej w typach, kod nie umie
 * jej ustawić w sposób typowany.
 *
 * 2026-08-14: 28 -> 27 wpisów. `member_organizations.paddle_subscription_id`
 * NIE ISTNIEJE od 20260805134721 (`RENAME COLUMN … TO provider_subscription_id`,
 * migracja na Stripe) - skaner nie znał wtedy `RENAME`, więc liczył fantom.
 * Wpis kosztował dwa razy: raz jako zgoda na brak kolumny, której nie ma, i raz
 * jako JEDYNA żywa referencja do poprzedniego operatora płatności w repo, którą
 * `check:legacy-payment-refs` słusznie oblewał. Nazwa nowej kolumny jest
 * w typach, więc dług nie przenosi się pod nią.
 */
const BASELINE: readonly string[] = [
  "membership_grants.source_coupon_id",
  "notifications.meta",
  "podcast_settings.itunes_author",
  "podcast_settings.itunes_category",
  "podcast_settings.itunes_copyright",
  "podcast_settings.itunes_explicit",
  "podcast_settings.itunes_image_url",
  "podcast_settings.itunes_owner_email",
  "podcast_settings.itunes_owner_name",
  "podcast_settings.itunes_subcategory",
  "podcast_settings.itunes_type",
  "podcast_shows.itunes_author",
  "podcast_shows.itunes_category",
  "podcast_shows.itunes_complete",
  "podcast_shows.itunes_explicit",
  "podcast_shows.itunes_owner_email",
  "podcast_shows.itunes_owner_name",
  "podcast_shows.itunes_subcategory",
  "podcast_shows.itunes_type",
  "podcasts.episode_type",
  "podcasts.explicit",
  "research_program_items.tenant_id",
  "research_program_members.id",
  "research_program_members.tenant_id",
  "research_program_partners.tenant_id",
  "research_program_projects.tenant_id",
  "research_programs.created_by",
];

function migrations(): ScannedMigration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8") }));
}

function main(): void {
  const generated = readGeneratedColumns(readFileSync(TYPES_FILE, "utf8"));
  if (generated.size === 0) {
    console.error(`[types-freshness] nie odczytałem ani jednej tabeli z ${TYPES_FILE}`);
    process.exit(1);
  }
  const stale = findStaleColumns(migrations(), generated);

  if (process.argv.includes("--print-baseline")) {
    console.log(stale.map((entry) => `  "${columnKey(entry)}",`).join("\n"));
    return;
  }

  const report = compareWithBaseline(stale, BASELINE);
  const rendered = renderFreshnessReport(report, BASELINE.length);
  if (freshnessFailed(report)) {
    console.error(rendered);
    process.exit(1);
  }
  console.log(`[types-freshness] tabel w typach: ${generated.size}.`);
  console.log(rendered);
}

main();
