// Wspólny model wpisów dla narzędzi /mcp: jedno zapytanie bazowe, jeden
// kształt odpowiedzi, jedna sanityzacja wzorca wyszukiwania.
//
// WIDOCZNOŚĆ JEST JAWNA. Narzędzia działają z tokenem wołającego, a dla roli
// `authenticated` RLS na `posts` dopuszcza więcej niż wpisy opublikowane
// (redakcja widzi szkice własnego najemcy, wczesny dostęp - wpisy
// zaplanowane). Dlatego zapytanie bazowe filtruje WPROST: status
// `published`, brak `deleted_at`, `published_at <= teraz` i najemca
// przeglądanego hosta (`public_tenant_id()`, ta sama funkcja, której używa RLS
// i bramka treści). Narzędzia czytają katalog publiczny - konto wołającego
// rozszerza wyłącznie dostęp do CIAŁA wpisu płatnego (`get_entity_content`).
//
// KOLUMNY OBU JĘZYKÓW W JEDNYM, DOSŁOWNYM `select`. Dosłowny napis daje
// typowany wiersz (bez rzutowań) i czytelny wpis bramki `generate:ts-sql-contract`;
// wybór języka dzieje się w `toPostSummaryJson`, z awarią na drugi język, gdy
// tłumaczenia brak.
import { ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { escapeLike } from "@/lib/admin/listFilters";
import { MCP_CALLER_MESSAGES, type McpDatabase } from "@/lib/mcp/supabase";

export const MCP_LANGS = ["pl", "en"] as const;
export type McpLang = (typeof MCP_LANGS)[number];

export const MCP_DEFAULT_LIMIT = 10;
export const MCP_MAX_LIMIT = 50;
/** Górna granica frazy - dłuższa nie jest wyszukiwaniem, tylko ładunkiem. */
export const MCP_MAX_QUERY_LENGTH = 200;

export const langInput = z
  .enum(MCP_LANGS)
  .default("pl")
  .describe("Language variant: 'pl' (Polish, default) or 'en' (English).");

export const limitInput = z
  .number()
  .int()
  .min(1)
  .max(MCP_MAX_LIMIT)
  .default(MCP_DEFAULT_LIMIT)
  .describe(`Maximum posts to return (1-${MCP_MAX_LIMIT}).`);

type PostRow = Database["public"]["Tables"]["posts"]["Row"];
export type PostSummaryRow = Pick<
  PostRow,
  | "id"
  | "slug"
  | "title_pl"
  | "title_en"
  | "excerpt_pl"
  | "excerpt_en"
  | "cover_image_url"
  | "published_at"
  | "post_format"
>;

/** Schemat wyjścia jednego wpisu - ogłaszany klientom jako `outputSchema`. */
export const postSummaryOutput = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  cover_image_url: z.string().nullable(),
  published_at: z.string().nullable(),
  post_format: z.string(),
});

/** Tekst w żądanym języku, a gdy go brak - w drugim; pusty napis to brak. */
export function pickLocalized(
  pl: string | null,
  en: string | null,
  lang: McpLang,
): string | null {
  const [primary, secondary] = lang === "en" ? [en, pl] : [pl, en];
  const first = primary?.trim() ? primary : null;
  if (first) return first;
  return secondary?.trim() ? secondary : null;
}

/** Wiersz -> obiekt JSON dla klienta MCP. `id` zostaje wewnętrzny. */
export function toPostSummaryJson(row: PostSummaryRow, lang: McpLang) {
  return {
    slug: row.slug,
    title: pickLocalized(row.title_pl, row.title_en, lang) ?? row.slug,
    excerpt: pickLocalized(row.excerpt_pl, row.excerpt_en, lang),
    cover_image_url: row.cover_image_url,
    published_at: row.published_at,
    post_format: row.post_format,
  };
}

/**
 * Wzorzec `ilike` z frazy użytkownika przez wspólny `escapeLike` (bez
 * symboli wieloznacznych LIKE `%`, `_`, `*` i metaznaków filtra `.or()`
 * PostgREST) - fraza nie może dopisać własnego warunku. `null`, gdy po
 * oczyszczeniu nic nie zostaje.
 */
export function toIlikePattern(query: string): string | null {
  const cleaned = escapeLike(query).replace(/\s+/g, " ").trim();
  return cleaned ? `%${cleaned}%` : null;
}

/** Najemca przeglądanego hosta - ta sama funkcja, której używa RLS. */
export async function resolveTenantId(sb: McpDatabase): Promise<string> {
  const { data, error } = await sb.rpc("public_tenant_id");
  if (error || !data) {
    console.error("[mcp] public_tenant_id failed", { code: error?.code ?? "empty" });
    throw new ToolError(MCP_CALLER_MESSAGES.backendUnavailable);
  }
  return data;
}

/** Zapytanie bazowe: wyłącznie opublikowane wpisy najemcy, widoczne teraz. */
export function publishedPosts(sb: McpDatabase, tenantId: string, now: Date = new Date()) {
  return sb
    .from("posts")
    .select(
      "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format",
    )
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null)
    .not("published_at", "is", null)
    .lte("published_at", now.toISOString());
}

/** Błąd PostgREST -> log serwera (sam kod) i stały komunikat dla klienta. */
export function queryFailed(scope: string, error: { code?: string | null }): ToolError {
  console.error(`[mcp] ${scope} failed`, { code: error.code ?? "unknown" });
  return new ToolError(MCP_CALLER_MESSAGES.backendUnavailable);
}
