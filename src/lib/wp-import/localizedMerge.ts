// Scalanie JEDNOJĘZYCZNEGO importu WordPressa z istniejącym rekordem.
//
// DEFEKT, który ten moduł zamyka: import WP wchodzi ZAWSZE w jednym języku
// (`language: "pl" | "en"`), a payload budowany był tak, jakby drugiego języka
// nie było - `title_en: ""`, `excerpt_en: null`, `blocks_data.en = []`. Przy
// `sync_existing = true` ten payload leciał UPDATE-em na istniejący wiersz, więc
// ponowny import PL kasował całą, ręcznie przygotowaną wersję EN. Cicho: log
// raportował „Updated", a redakcja dowiadywała się o braku EN na produkcji.
//
// Stos STRON zamknął to dawno (`wp-import.functions.ts`: `built.title_en ||
// current.title_en`, `built.content_en ?? current.content_en`). Ten moduł
// przenosi tamten wzorzec do jednego, przetestowanego miejsca i rozszerza go na
// `blocks_data` / `builder_data`, gdzie u WPISÓW mieszka treść per język.
//
// ZASADA: język importowany WYGRYWA, język przeciwny jest ZACHOWYWANY.
// Import nie ma prawa skasować wersji, której nie przywiózł.
//
// DRUGA ZASADA, równie ważna: „zachowany" znaczy ŻYWY, a nie „jakikolwiek".
// Wpis prowadzony przez builder zapisuje wyłącznie `builder_data`, a migracja
// blocks->builder zostawia `blocks_data` jako odwracalną kopię zapasową. Ślepe
// preferowanie `blocks_data` odtwarzałoby wersję EN sprzed migracji i kasowało
// wszystkie późniejsze edycje - ten sam defekt, tylko okrężną drogą. Kolejność
// źródeł rozstrzyga kolumna `editor` (patrz resolveLocalizedBlocks).
//
// Moduł jest czysty (bez I/O) - izolacja tenantów zostaje po stronie zapytań
// wywołującego (`.eq("tenant_id", tenantId)` na SELECT i UPDATE).
import type { BlocksDoc, LocalizedBlocks } from "@/lib/blocks/types";
import { localizedBlocksToBuilderDoc } from "@/lib/builder/migrate/blocksToBuilder";
import { toJson } from "@/lib/builder/types";
import type { Json } from "@/integrations/supabase/types";

export type ImportLang = "pl" | "en";

/**
 * Drugi język pary - stała, nie ternary po kodzie języka. Mapa mówi wprost, co
 * jest czym, i nie wygląda jak wybór TEKSTU po języku (którego bramka
 * check:i18n-hardcoded słusznie nie przepuszcza).
 */
export const COUNTERPART_LANG: Readonly<Record<ImportLang, ImportLang>> = { pl: "en", en: "pl" };

/** Świeży pusty dokument - nigdy współdzielona stała (mutowalne `blocks`). */
export const emptyBlocksDoc = (): BlocksDoc => ({ version: 1, blocks: [] });

/** Kolumny, które import musi ZOBACZYĆ, zanim cokolwiek nadpisze. */
export interface ExistingLocalized {
  /**
   * Który magazyn treści jest ŻYWY. Wpis prowadzony przez builder zapisuje
   * wyłącznie `builder_data` (PostContentEditor -> BuilderPane), a migracja
   * blocks->builder ŚWIADOMIE zostawia `blocks_data` jako odwracalną kopię
   * zapasową. Bez tej kolumny nie da się odróżnić kopii od bieżącej treści.
   */
  editor?: string | null;
  title_pl?: string | null;
  title_en?: string | null;
  excerpt_pl?: string | null;
  excerpt_en?: string | null;
  blocks_data?: Json | null;
  builder_data?: Json | null;
}

/** Skąd pochodzi para językowa, którą import zastał. */
export type LocalizedBlocksSource = "blocks_data" | "builder_data" | "none";

export interface ResolvedLocalizedBlocks {
  blocks: LocalizedBlocks;
  source: LocalizedBlocksSource;
}

/** Jedna wersja językowa przywieziona z WordPressa. */
export interface LocalizedImport {
  language: ImportLang;
  title: string;
  excerpt: string | null;
  doc: BlocksDoc;
}

export interface MergedLocalized {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  blocks: LocalizedBlocks;
  /** Język, którego import NIE przywiózł - ten, który trzeba było ocalić. */
  counterpart: ImportLang;
  /** true, gdy w drugim języku faktycznie było co zachować (do logu importu). */
  counterpartPreserved: boolean;
  /** Z której kolumny wzięto zachowaną treść - prowenienecja idzie do logu. */
  counterpartSource: LocalizedBlocksSource;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isBlocksDoc(value: unknown): value is BlocksDoc {
  const rec = asRecord(value);
  return rec !== null && Array.isArray(rec.blocks);
}

function isLocalizedBlocks(value: unknown): value is LocalizedBlocks {
  const rec = asRecord(value);
  return rec !== null && isBlocksDoc(rec.pl) && isBlocksDoc(rec.en);
}

/** Dokument ma realną treść (a nie tylko pustą skorupę `{version, blocks: []}`). */
export function hasBlocks(doc: BlocksDoc | null | undefined): boolean {
  return Array.isArray(doc?.blocks) && doc.blocks.length > 0;
}

// Bezpiecznik rekurencji dla skanu `builder_data` - dokument buildera jest
// płytki (sekcja -> kolumna -> widget -> content), ale JSON z bazy bywa czymkolwiek.
const MAX_SCAN_DEPTH = 12;

/** Pierwszy osadzony dokument `{ pl, en }` w dowolnym drzewie JSON. */
function findLocalizedBlocks(value: unknown, depth = 0): LocalizedBlocks | null {
  if (depth > MAX_SCAN_DEPTH) return null;
  if (isLocalizedBlocks(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findLocalizedBlocks(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const rec = asRecord(value);
  if (!rec) return null;
  for (const item of Object.values(rec)) {
    const hit = findLocalizedBlocks(item, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Odczyt pary językowej z istniejącego wiersza - ZAWSZE od źródła ŻYWEGO.
 *
 * Nie ma tu jednego „kanonicznego" magazynu; rozstrzyga kolumna `editor`:
 *  - `editor === "builder"`: treść żyje w `builder_data`. `blocks_data` jest
 *    wtedy kopią sprzed migracji (`migrate-blocks-to-builder` zostawia ją
 *    świadomie, dla odwracalności) i BYWA NIEAKTUALNA o wszystkie edycje zrobione
 *    później w builderze. Sięgnięcie po nią najpierw kasowałoby dokładnie tę
 *    wersję EN, której ten moduł ma bronić - tyle że okrężną drogą.
 *  - w pozostałych trybach (`blocks` i starsze): żywe jest `blocks_data`.
 * Drugie źródło zostaje wyłącznie jako awaryjne, gdy w pierwszym nie ma pary
 * `{ pl, en }` w ogóle.
 *
 * Pusta wersja językowa w źródle żywym to WYNIK, nie brak danych: redaktor mógł
 * skasować EN w builderze i kopia zapasowa nie ma prawa go wskrzesić.
 */
export function resolveLocalizedBlocks(
  row: ExistingLocalized | null | undefined,
): ResolvedLocalizedBlocks {
  const empty = (): LocalizedBlocks => ({ pl: emptyBlocksDoc(), en: emptyBlocksDoc() });
  if (!row) return { blocks: empty(), source: "none" };

  const fromBlocks = isLocalizedBlocks(row.blocks_data) ? row.blocks_data : null;
  const fromBuilder = findLocalizedBlocks(row.builder_data);
  const ordered: ReadonlyArray<readonly [LocalizedBlocks | null, LocalizedBlocksSource]> =
    row.editor === "builder"
      ? [
          [fromBuilder, "builder_data"],
          [fromBlocks, "blocks_data"],
        ]
      : [
          [fromBlocks, "blocks_data"],
          [fromBuilder, "builder_data"],
        ];

  for (const [blocks, source] of ordered) {
    if (blocks) return { blocks, source };
  }
  return { blocks: empty(), source: "none" };
}

/**
 * Scal jednojęzyczny import z tym, co już jest w bazie. `current === null`
 * (nowy wpis) daje czysty payload z pustą drugą wersją - bez gałęzi u wywołującego.
 */
export function mergeLocalizedImport(
  incoming: LocalizedImport,
  current: ExistingLocalized | null | undefined,
): MergedLocalized {
  const isPl = incoming.language === "pl";
  const counterpart = COUNTERPART_LANG[incoming.language];

  const currentBlocks = resolveLocalizedBlocks(current);
  const keptDoc = currentBlocks.blocks[counterpart];
  const keptTitle = (counterpart === "pl" ? current?.title_pl : current?.title_en) ?? "";
  const keptExcerpt = (counterpart === "pl" ? current?.excerpt_pl : current?.excerpt_en) ?? null;

  // Pusty tytuł z WordPressa nie kasuje istniejącego (wzorzec ze stosu stron:
  // `built.title_pl || current.title_pl`). Pusta zapowiedź -> null, nie "".
  const title = incoming.title.trim();
  const excerpt = incoming.excerpt?.trim() ? incoming.excerpt : null;
  const currentPl = current?.title_pl ?? "";
  const currentEn = current?.title_en ?? "";

  return {
    title_pl: isPl ? title || currentPl : currentPl,
    title_en: isPl ? currentEn : title || currentEn,
    excerpt_pl: isPl ? (excerpt ?? current?.excerpt_pl ?? null) : (current?.excerpt_pl ?? null),
    excerpt_en: isPl ? (current?.excerpt_en ?? null) : (excerpt ?? current?.excerpt_en ?? null),
    blocks: isPl ? { pl: incoming.doc, en: keptDoc } : { pl: keptDoc, en: incoming.doc },
    counterpart,
    counterpartPreserved: keptTitle.trim() !== "" || keptExcerpt !== null || hasBlocks(keptDoc),
    counterpartSource: currentBlocks.source,
  };
}

/**
 * Spójna para kolumn treści: `blocks_data` i `builder_data` (układ hostujący ten
 * sam dokument). Zawsze budowane razem - rozjazd między nimi to kolejny sposób na
 * zgubienie wersji językowej. Import zostawia wpis w trybie `builder`, więc po
 * zapisie żywym źródłem znów jest `builder_data`, a `blocks_data` jego wierną kopią.
 */
export function serializeLocalizedBlocks(blocks: LocalizedBlocks): {
  blocks_data: Json;
  builder_data: Json;
} {
  return {
    blocks_data: toJson(blocks),
    builder_data: toJson(localizedBlocksToBuilderDoc(blocks)),
  };
}
