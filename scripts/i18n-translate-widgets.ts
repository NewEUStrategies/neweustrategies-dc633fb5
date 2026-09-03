/**
 * Uzupełnienie tłumaczeń EN w treści widgetów (strony + wpisy buildera).
 *
 * Panel `/admin/i18n` pokazuje, które widgety renderują się po polsku na /en
 * (brak EN, EN = PL, polski tekst w polu EN, EN zostawione na szablonie).
 * Ten skrypt zamyka pętlę: zbiera te teksty, tłumaczy je przez bramkę AI
 * Lovable (`translateSegmentsPlToEn`, zero nowych sekretów) i zapisuje
 * z powrotem do `builder_data`.
 *
 * Bezpieczniki:
 *   - `--dry-run` (domyślnie WYŁĄCZONE zapisy dopiero po `--write`),
 *   - pola dłuższe niż `--max-chars` (domyślnie 20000) są pomijane i raportowane
 *     - to legacy import WordPressa, nie treść redakcyjna,
 *   - słownik `pl -> en` jest cache'owany w `reports/i18n-widget-translations.json`,
 *     więc ponowne uruchomienie nie płaci drugi raz za te same segmenty,
 *   - zapis idzie per wiersz i tylko gdy cokolwiek się zmieniło.
 *
 * Usage:
 *   bun run scripts/i18n-translate-widgets.ts                 # podgląd
 *   bun run scripts/i18n-translate-widgets.ts --write         # zapis
 *   bun run scripts/i18n-translate-widgets.ts --slug=o-nas --write
 *
 * Env: SUPABASE_URL (lub VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
 *      LOVABLE_API_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import {
  applyEnTranslations,
  collectTranslatableTexts,
} from "../src/lib/i18n/widgetTranslationFill";
import { chunkSegments, translateSegmentsPlToEn } from "../src/lib/server/aiTranslate.server";

const CACHE_PATH = "reports/i18n-widget-translations.json";

/** Porcja wysyłana do modelu: mała, żeby odpowiedź JSON nigdy się nie urwała. */
const BATCH_CHARS = 4_000;
const BATCH_SEGMENTS = 20;

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const SLUG = args.find((a) => a.startsWith("--slug="))?.slice("--slug=".length);
const MAX_CHARS = Number(args.find((a) => a.startsWith("--max-chars="))?.split("=")[1] ?? 20_000);

const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) fail("Brak SUPABASE_URL / VITE_SUPABASE_URL.");
if (!key) fail("Brak SUPABASE_SERVICE_ROLE_KEY - zapis treści wymaga klucza serwisowego.");

const supabase = createClient(url, key, { auth: { persistSession: false } });

interface Row {
  id: string;
  slug: string;
  builder_data: unknown;
}

function loadCache(): Map<string, string> {
  if (!existsSync(CACHE_PATH)) return new Map();
  try {
    const parsed: unknown = JSON.parse(readFileSync(CACHE_PATH, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function saveCache(dict: ReadonlyMap<string, string>): void {
  mkdirSync("reports", { recursive: true });
  writeFileSync(CACHE_PATH, `${JSON.stringify(Object.fromEntries(dict), null, 2)}\n`);
}

async function loadRows(table: "pages" | "posts"): Promise<Row[]> {
  let query = supabase
    .from(table)
    .select("id, slug, builder_data")
    .eq("editor", "builder")
    .is("deleted_at", null);
  if (SLUG) query = query.eq("slug", SLUG);
  const { data, error } = await query;
  if (error) fail(`Odczyt ${table}: ${error.message}`);
  return (data ?? []) as Row[];
}

async function main(): Promise<void> {
  const opts = { maxFieldChars: MAX_CHARS };
  const tables = ["pages", "posts"] as const;
  const rows = new Map<(typeof tables)[number], Row[]>();
  for (const table of tables) rows.set(table, await loadRows(table));

  // 1. Zbierz UNIKALNE segmenty z całego korpusu - jedno tłumaczenie na tekst,
  //    nawet jeśli ten sam nagłówek stoi na pięciu stronach.
  const segments: string[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    for (const row of rows.get(table) ?? []) {
      for (const text of collectTranslatableTexts(row.builder_data, opts)) {
        if (seen.has(text)) continue;
        seen.add(text);
        segments.push(text);
      }
    }
  }

  const cache = loadCache();
  const pending = segments.filter((s) => !cache.has(s));
  const chars = pending.reduce((sum, s) => sum + s.length, 0);
  console.log(
    `Segmentów do tłumaczenia: ${segments.length} (nowych: ${pending.length}, ${chars} znaków; z cache: ${segments.length - pending.length}).`,
  );

  // Małe porcje: model potrafi obciąć długą odpowiedź JSON, a wtedy tracimy
  // całą partię. Cache zapisujemy po KAŻDEJ porcji, więc przerwany przebieg
  // wznawia się bez ponownego płacenia za już przetłumaczone segmenty.
  const batches = chunkSegments(pending, BATCH_CHARS).flatMap((batch) =>
    batch.length > BATCH_SEGMENTS
      ? Array.from({ length: Math.ceil(batch.length / BATCH_SEGMENTS) }, (_, i) =>
          batch.slice(i * BATCH_SEGMENTS, (i + 1) * BATCH_SEGMENTS),
        )
      : [batch],
  );
  let done = 0;
  let skipped = 0;
  // Model bywa niesforny: raz zwróci o segment mniej, raz obetnie JSON. Zamiast
  // przewracać cały przebieg dzielimy porcję na pół i próbujemy ponownie -
  // pojedynczy oporny segment izoluje się sam i tylko on trafia do pominiętych.
  const translateBatch = async (batch: string[]): Promise<void> => {
    try {
      const translated = await translateSegmentsPlToEn(batch);
      batch.forEach((source, index) => cache.set(source, translated[index]));
      done += batch.length;
    } catch (error) {
      if (batch.length === 1) {
        skipped += 1;
        console.warn(
          `  ⚠ pominięto segment (${batch[0].length} zn.): ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await translateBatch(batch.slice(0, half));
      await translateBatch(batch.slice(half));
    }
  };
  for (const batch of batches) {
    await translateBatch(batch);
    saveCache(cache);
    console.log(`  ✓ przetłumaczono ${done}/${pending.length} segmentów`);
  }
  if (skipped > 0) console.warn(`⚠ Segmentów bez tłumaczenia: ${skipped}.`);

  // 2. Podmiana w dokumentach + zapis.
  let touchedRows = 0;
  let appliedFields = 0;
  let untranslated = 0;
  for (const table of tables) {
    for (const row of rows.get(table) ?? []) {
      const result = applyEnTranslations(row.builder_data, cache, opts);
      untranslated += result.untranslated;
      if (result.applied === 0) continue;
      touchedRows += 1;
      appliedFields += result.applied;
      console.log(`  ${WRITE ? "→" : "·"} ${table}/${row.slug}: ${result.applied} pól`);
      if (!WRITE) continue;
      const { error } = await supabase
        .from(table)
        .update({ builder_data: result.document })
        .eq("id", row.id);
      if (error) fail(`Zapis ${table}/${row.slug}: ${error.message}`);
    }
  }

  console.log(
    `\n${WRITE ? "Zapisano" : "Do zapisu (dry-run)"}: ${appliedFields} pól w ${touchedRows} wierszach.` +
      (untranslated > 0 ? ` Bez tłumaczenia: ${untranslated}.` : ""),
  );
  if (!WRITE) console.log("Uruchom ponownie z --write, żeby zapisać.");
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
