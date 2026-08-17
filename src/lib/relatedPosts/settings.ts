// Zapis globalnej konfiguracji silnika rekomendacji (`related_posts_config`).
//
// PRZYCZYNA ŹRÓDŁOWA, którą ten moduł zamyka:
// panel /admin/related-posts zapisywał przez
//
//     supabase.from("related_posts_config").update(next)
//             .neq("tenant_id", "00000000-0000-0000-0000-000000000000")
//
// czyli UPDATE + „dopasuj wszystko" do tabeli-singletonu, której wiersz był
// zasiewany JEDNORAZOWO w migracji z 24.06 i nie miał provisioningu dla nowych
// tenantów. UPDATE bez dopasowania jest dla PostgREST pełnym sukcesem (204), więc
// panel pokazywał „Zapisano" przy ZEROWEJ zmianie. Był to jedyny wyjątek wśród
// 13 tabel-singletonów - pozostałe 12 używa poprawnie `upsert`.
//
// Trzy warstwy naprawy (żadna nie wystarcza sama):
//   1. UPSERT z JAWNYM `tenant_id` i `onConflict: "tenant_id"` - brak wiersza
//      przestaje być stanem, w którym zapis nic nie robi;
//   2. WERYFIKACJA ZAPISU - `.select()` zwraca zapisany wiersz; zero wierszy
//      traktujemy jako BŁĄD, nie sukces. To domyka całą klasę „cichego zapisu",
//      także gdyby polityka RLS kiedyś odfiltrowała wiersz;
//   3. PROVISIONING W BAZIE - trigger na `tenants`
//      (migracja 20260726090000) zasiewa wiersz dla każdego nowego tenanta.
//
// Izolacja tenantów: `tenant_id` bierzemy z `current_tenant_id()` (tenant DOMOWY
// zalogowanego użytkownika, liczony z `profiles`), nigdy z nagłówka hosta. Panel
// jednego obszaru roboczego nie może więc zapisać ani odczytać konfiguracji
// innego, nawet gdy przegląda jego domenę.

import {
  RELATED_POSTS_DEFAULTS,
  type RelatedLayout,
  type RelatedPosition,
  type RelatedPostsConfig,
  type RelatedSource,
} from "@/lib/relatedPosts";

/** Wiersz gotowy do zapisu: konfiguracja + jawny właściciel (tenant). */
export type RelatedPostsConfigRow = RelatedPostsConfig & { tenant_id: string };

const POSITIONS: readonly RelatedPosition[] = ["end", "sidebar", "after_paragraph"];
const LAYOUTS: readonly RelatedLayout[] = [
  "grid",
  "list",
  "slider",
  "cards",
  "magazine",
  "timeline",
];
const SOURCES: readonly RelatedSource[] = ["categories", "tags", "both", "author"];
const COLUMNS: readonly RelatedPostsConfig["columns"][] = [2, 3, 4];

/** Granice pól liczbowych. Baza nie ma na nie CHECK-ów, więc pilnujemy ich tutaj. */
export const RELATED_POSTS_LIMITS = {
  afterParagraph: { min: 1, max: 20 },
  itemsLimit: { min: 1, max: 24 },
  recencyBoostDays: { min: 0, max: 3650 },
  sliderIntervalMs: { min: 2000, max: 60_000 },
  weight: { min: 0, max: 10 },
  minScore: { min: 0, max: 1000 },
} as const;

const TITLE_MAX_LENGTH = 200;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function title(value: string, fallback: string): string {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed.slice(0, TITLE_MAX_LENGTH) : fallback;
}

/**
 * Normalizuje konfigurację do wiersza zapisu: domyka braki defaultami, przycina
 * wartości do dopuszczalnych zakresów i przypina `tenant_id`.
 *
 * Czysta funkcja - cała walidacja zapisu jest testowalna bez bazy.
 */
export function buildRelatedPostsConfigRow(
  input: Partial<RelatedPostsConfig>,
  tenantId: string,
): RelatedPostsConfigRow {
  const c: RelatedPostsConfig = { ...RELATED_POSTS_DEFAULTS, ...input };
  const w = RELATED_POSTS_LIMITS.weight;
  const weight = (value: number, fallback: number): number =>
    clampInt(value, w.min, w.max, fallback);

  return {
    tenant_id: tenantId,
    enabled: c.enabled === true,
    position: oneOf(c.position, POSITIONS, RELATED_POSTS_DEFAULTS.position),
    after_paragraph: clampInt(
      c.after_paragraph,
      RELATED_POSTS_LIMITS.afterParagraph.min,
      RELATED_POSTS_LIMITS.afterParagraph.max,
      RELATED_POSTS_DEFAULTS.after_paragraph,
    ),
    layout: oneOf(c.layout, LAYOUTS, RELATED_POSTS_DEFAULTS.layout),
    columns: COLUMNS.includes(c.columns) ? c.columns : RELATED_POSTS_DEFAULTS.columns,
    items_limit: clampInt(
      c.items_limit,
      RELATED_POSTS_LIMITS.itemsLimit.min,
      RELATED_POSTS_LIMITS.itemsLimit.max,
      RELATED_POSTS_DEFAULTS.items_limit,
    ),
    source_strategy: oneOf(c.source_strategy, SOURCES, RELATED_POSTS_DEFAULTS.source_strategy),
    show_excerpt: c.show_excerpt === true,
    show_meta: c.show_meta === true,
    show_cover: c.show_cover === true,
    recency_boost_days: clampInt(
      c.recency_boost_days,
      RELATED_POSTS_LIMITS.recencyBoostDays.min,
      RELATED_POSTS_LIMITS.recencyBoostDays.max,
      RELATED_POSTS_DEFAULTS.recency_boost_days,
    ),
    slider_autoplay: c.slider_autoplay === true,
    slider_interval_ms: clampInt(
      c.slider_interval_ms,
      RELATED_POSTS_LIMITS.sliderIntervalMs.min,
      RELATED_POSTS_LIMITS.sliderIntervalMs.max,
      RELATED_POSTS_DEFAULTS.slider_interval_ms,
    ),
    title_pl: title(c.title_pl, RELATED_POSTS_DEFAULTS.title_pl),
    title_en: title(c.title_en, RELATED_POSTS_DEFAULTS.title_en),
    weight_categories: weight(c.weight_categories, RELATED_POSTS_DEFAULTS.weight_categories),
    weight_tags: weight(c.weight_tags, RELATED_POSTS_DEFAULTS.weight_tags),
    weight_author: weight(c.weight_author, RELATED_POSTS_DEFAULTS.weight_author),
    weight_recency: weight(c.weight_recency, RELATED_POSTS_DEFAULTS.weight_recency),
    weight_popularity: weight(c.weight_popularity, RELATED_POSTS_DEFAULTS.weight_popularity),
    weight_dwell: weight(c.weight_dwell, RELATED_POSTS_DEFAULTS.weight_dwell),
    weight_personalization: weight(
      c.weight_personalization,
      RELATED_POSTS_DEFAULTS.weight_personalization,
    ),
    use_idf: c.use_idf === true,
    min_score: clampInt(
      c.min_score,
      RELATED_POSTS_LIMITS.minScore.min,
      RELATED_POSTS_LIMITS.minScore.max,
      RELATED_POSTS_DEFAULTS.min_score,
    ),
  };
}

/** Rozpoznawalne powody nieudanego zapisu - panel mapuje je na komunikat i18n. */
export type RelatedPostsSaveFailure =
  "no_tenant" | "tenant_lookup_failed" | "write_failed" | "not_persisted";

export class RelatedPostsSaveError extends Error {
  readonly reason: RelatedPostsSaveFailure;
  /** Surowy komunikat z bazy (jeśli był) - do diagnostyki, nie do UI. */
  readonly cause?: string;

  constructor(reason: RelatedPostsSaveFailure, cause?: string) {
    super(`related_posts_config save failed: ${reason}${cause ? ` (${cause})` : ""}`);
    this.name = "RelatedPostsSaveError";
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * Minimalny port zapisu. Trzyma powierzchnię kontaktu z Supabase w JEDNYM
 * miejscu i pozwala testować całą logikę (brak tenanta, błąd zapisu, zapis
 * niepotwierdzony) bez klienta bazy i bez sieci.
 */
export interface RelatedPostsConfigPort {
  /** `current_tenant_id()` - tenant DOMOWY zalogowanego użytkownika. */
  currentTenantId(): Promise<{ tenantId: string | null; error: string | null }>;
  /** `upsert(row, { onConflict: "tenant_id" }).select("tenant_id")`. */
  upsert(row: RelatedPostsConfigRow): Promise<{ savedTenantIds: string[]; error: string | null }>;
}

/**
 * Zapisuje konfigurację i POTWIERDZA, że wiersz faktycznie powstał/zmienił się.
 * Zwraca zapisany wiersz, więc wywołujący może odświeżyć cache danymi po
 * normalizacji, a nie surowym draftem z formularza.
 */
export async function saveRelatedPostsConfig(
  port: RelatedPostsConfigPort,
  input: Partial<RelatedPostsConfig>,
): Promise<RelatedPostsConfigRow> {
  const { tenantId, error: tenantError } = await port.currentTenantId();
  if (tenantError) throw new RelatedPostsSaveError("tenant_lookup_failed", tenantError);
  if (!tenantId) throw new RelatedPostsSaveError("no_tenant");

  const row = buildRelatedPostsConfigRow(input, tenantId);
  const { savedTenantIds, error } = await port.upsert(row);
  if (error) throw new RelatedPostsSaveError("write_failed", error);
  // Sedno naprawy: zapis, który nie dotknął ŻADNEGO wiersza, nie jest sukcesem.
  if (!savedTenantIds.includes(tenantId)) throw new RelatedPostsSaveError("not_persisted");
  return row;
}
