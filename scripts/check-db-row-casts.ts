/**
 * Bramka: kształt wiersza z bazy nie jest przepisywany ręcznie.
 *
 * Cienki runner - inwariant i uzasadnienie żyją w `src/lib/ci/dbRowCasts.ts`.
 *
 * Usage: bun run check:db-row-casts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isScannable,
  renderRowCastsReport,
  scanHandWrittenRowCasts,
  staleExceptions,
  type RowCastException,
  type ScannedSource,
} from "../src/lib/ci/dbRowCasts";

const SCAN_ROOT = "src";
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage"]);

/**
 * WYJĄTKI - każdy z POWODEM, bo wyjątek bez powodu zamienia listę w listę
 * wymówek. Stan na 2026-08-13; lista ma tylko maleć.
 *
 * Dwie klasy powodów, obie realne:
 *
 *  1. `rpc` - źródłem jest funkcja bazy. Generowane typy `RETURNS TABLE` kłamią
 *     o nullowalności (opisują wszystko jako non-null), więc uczciwszy jest
 *     kształt pisany ręcznie - dokładnie jak w precedensie `GiftLinkAdminRow`
 *     w `gifting-admin.functions.ts`.
 *  2. `join` - `select()` zagnieżdża relację (`posts(...)`, `profiles(...)`),
 *     więc wiersz nie jest `Pick<Tables<…>>`, a `Tables<…> & { relacja: … }`.
 *     Wyprowadzenie części tabelowej jest możliwe i pożądane, ale to zmiana
 *     per plik, nie mechaniczna.
 */
const ROW_CAST_EXCEPTIONS: readonly RowCastException[] = [
  {
    file: "src/components/admin/crm/CrmPartnerEndpointsPanel.tsx",
    type: "PartnerRow",
    reason: "join: select zagnieżdża crm_webhook_endpoints(...)",
  },
  {
    file: "src/hooks/useExpertLayoutSettings.ts",
    type: "ExpertLayoutSettings",
    reason: "model domenowy panelu, nie 1:1 wiersz - kolumny są mapowane po nazwach",
  },
  {
    file: "src/lib/server/publishedContent.server.ts",
    type: "PublishedPodcastRow",
    reason: "kolumny episode_type i explicit są poza typami (patrz baseline check:types-freshness)",
  },
  {
    file: "src/lib/server/publishedContent.server.ts",
    type: "PublishedShowRow",
    reason: "kolumny itunes_* są poza typami (patrz baseline check:types-freshness)",
  },
  {
    file: "src/lib/observability/vitals.functions.ts",
    type: "VitalSample",
    reason: "kształt z polem pochodnym `capped`, liczonym w kodzie - nie kolumną",
  },
  {
    file: "src/lib/tracker/queries.ts",
    type: "Row",
    reason: "join: select zagnieżdża eu_policy_items(...) przy linkach",
  },
  {
    file: "src/lib/chat/stars.ts",
    type: "StarredEntry",
    reason: "model widoku listy gwiazdek, składany z dwóch zapytań",
  },
  {
    file: "src/lib/queries/series.ts",
    type: "PartRowRaw",
    reason: "join: select zagnieżdża posts(...)",
  },
  {
    file: "src/lib/queries/podcasts.ts",
    type: "PersonRow",
    reason: "join: select zagnieżdża profiles(...)",
  },
  {
    file: "src/lib/queries/programs.ts",
    type: "ProgramMember",
    reason: "join: research_program_items z zagnieżdżonym profilem",
  },
  {
    file: "src/lib/queries/programs.ts",
    type: "ProgramProject",
    reason: "join: research_program_items z zagnieżdżoną treścią",
  },
  {
    file: "src/lib/queries/programs.ts",
    type: "ProgramPartner",
    reason: "join: research_program_items z zagnieżdżoną organizacją",
  },
  {
    file: "src/routes/admin.link-monitor.tsx",
    type: "BrokenRow",
    reason: "join: select zagnieżdża posts(...)",
  },
  {
    file: "src/routes/admin.coupons.redemptions.tsx",
    type: "RedRow",
    reason: "join: select zagnieżdża b2b_coupons(...)",
  },
  {
    file: "src/routes/admin.pages.$slug.tsx",
    type: "PageForm",
    reason: "rpc get_page_for_edit - kształt formularza, nie wiersz tabeli",
  },
  {
    file: "src/routes/network.mutual.$userId.tsx",
    type: "MutualRow",
    reason: "rpc mutual_connections - RETURNS TABLE kłamie o nullowalności",
  },
  {
    file: "src/routes/admin.monetization.tsx",
    type: "DashboardShape",
    reason: "rpc monetization_dashboard - zwraca jsonb, nie wiersz",
  },
  {
    file: "src/routes/admin.audience.tsx",
    type: "FunnelRow",
    reason: "rpc admin_member_funnel - RETURNS TABLE kłamie o nullowalności",
  },
  {
    file: "src/routes/admin.audience.tsx",
    type: "SeriesRow",
    reason: "rpc admin_member_activity_series - RETURNS TABLE kłamie o nullowalności",
  },
  {
    file: "src/routes/admin.audience.tsx",
    type: "RetentionRow",
    reason: "rpc admin_member_retention - RETURNS TABLE kłamie o nullowalności",
  },
  {
    file: "src/lib/events/meetingsApi.ts",
    type: "MeetingSettings",
    reason:
      "rpc admin_event_meeting_settings_get/_save - zwraca jsonb, nie wiersz (jak monetization_dashboard)",
  },
];

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function collect(): ScannedSource[] {
  return walk(SCAN_ROOT, [])
    .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"))
    .filter(isScannable)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function main(): void {
  const sources = collect();
  const hits = scanHandWrittenRowCasts(sources, ROW_CAST_EXCEPTIONS);
  const stale = staleExceptions(sources, ROW_CAST_EXCEPTIONS);

  if (hits.length > 0) {
    console.error(renderRowCastsReport(hits, sources.length, ROW_CAST_EXCEPTIONS));
    process.exit(1);
  }
  if (stale.length > 0) {
    console.error(
      [
        `[db-row-casts] ${stale.length} wyjątków jest już nieaktualnych - USUŃ je z listy:`,
        ...stale.map((entry) => `  - ${entry.file}::${entry.type} (${entry.reason})`),
        "",
        "Martwy wyjątek to przyszła furtka: nazwa zostaje, a wraz z nią zgoda na",
        "ręcznie przepisany wiersz, o którym nikt już nie pamięta.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(renderRowCastsReport(hits, sources.length, ROW_CAST_EXCEPTIONS));
}

main();
