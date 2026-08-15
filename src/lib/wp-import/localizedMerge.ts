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
  title_pl?: string | null;
  title_en?: string | null;
  excerpt_pl?: string | null;
  excerpt_en?: string | null;
  blocks_data?: Json | null;
  builder_data?: Json | null;
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
 * Odczyt pary językowej z istniejącego wiersza. Kanoniczne jest `blocks_data`,
 * ale wpisy zmigrowane do buildera trzymają ten sam dokument `{ pl, en }`
 * wewnątrz widgetu `rich-text` (`localizedBlocksToBuilderDoc`) - gdy
 * `blocks_data` jest puste, treść drugiego języka nadal tam jest i też nie może
 * przepaść.
 */
export function readLocalizedBlocks(row: ExistingLocalized | null | undefined): LocalizedBlocks {
  if (!row) return { pl: emptyBlocksDoc(), en: emptyBlocksDoc() };
  if (isLocalizedBlocks(row.blocks_data)) return row.blocks_data;
  return findLocalizedBlocks(row.builder_data) ?? { pl: emptyBlocksDoc(), en: emptyBlocksDoc() };
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

  const currentBlocks = readLocalizedBlocks(current);
  const keptDoc = currentBlocks[counterpart];
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
  };
}

/**
 * Spójna para kolumn treści: `blocks_data` (kanoniczne źródło per język) i
 * `builder_data` (układ hostujący ten sam dokument). Zawsze budowane razem -
 * rozjazd między nimi to kolejny sposób na zgubienie wersji językowej.
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
