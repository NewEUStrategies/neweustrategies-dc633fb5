// Rozwiązywanie dynamicznych bloków EmailDoc (post-list) na konkretne wpisy.
//
// Dwustopniowo, żeby renderer pozostał czysty:
//  1. fetchEmailDocPostRows - JEDNO pobranie surowych wierszy per blok
//     (wywoływane na serwerze w momencie wysyłki / podglądu - "najnowsze
//     wpisy" są świeże w chwili wysyłki, nie zapisu),
//  2. postRefsForLang - czyste mapowanie wierszy na EmailPostRef dla języka
//     odbiorcy (testowalne jednostkowo).
//
// Klient bazy przekazywany luźnym interfejsem (wzorzec tbl() z
// crm.functions.ts) - działa i z supabaseAdmin, i z klientem user-scoped.
import type { EmailDoc, EmailLang, EmailPostListBlock } from "./emailDoc";
import type { EmailPostRef } from "./renderEmailHtml";

export interface EmailPostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
}

type Result = Promise<{ data: unknown; error: { message: string } | null }>;
type AnyQ = {
  select: (s: string) => AnyQ;
  eq: (c: string, v: unknown) => AnyQ;
  in: (c: string, v: unknown[]) => AnyQ;
  is: (c: string, v: unknown) => AnyQ;
  not: (c: string, op: string, v: unknown) => AnyQ;
  order: (c: string, o: { ascending: boolean }) => AnyQ;
  limit: (n: number) => AnyQ;
  maybeSingle: () => Result;
  then: Result["then"];
};
export type EmailDocDbClient = { from: (t: string) => AnyQ };

const POST_COLS = "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url";

const asRows = (data: unknown): EmailPostRow[] =>
  Array.isArray(data) ? (data as EmailPostRow[]) : [];

async function fetchForBlock(
  client: EmailDocDbClient,
  tenantId: string,
  block: EmailPostListBlock,
): Promise<EmailPostRow[]> {
  if (block.mode === "manual") {
    if (block.postIds.length === 0) return [];
    const { data } = await (client
      .from("posts")
      .select(POST_COLS)
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .is("deleted_at", null)
      .in("id", block.postIds) as unknown as Result);
    const rows = asRows(data);
    // Zachowaj kolejność wskazaną przez redaktora.
    const byId = new Map(rows.map((r) => [r.id, r]));
    return block.postIds.map((id) => byId.get(id)).filter((r): r is EmailPostRow => Boolean(r));
  }

  let postIdFilter: string[] | null = null;
  if (block.categorySlug) {
    const { data: cat } = await client
      .from("categories")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", block.categorySlug)
      .maybeSingle();
    const categoryId = (cat as { id: string } | null)?.id;
    if (!categoryId) return [];
    const { data: links } = await (client
      .from("post_categories")
      .select("post_id")
      .eq("category_id", categoryId)
      .limit(200) as unknown as Result);
    postIdFilter = (Array.isArray(links) ? (links as { post_id: string }[]) : []).map(
      (l) => l.post_id,
    );
    if (postIdFilter.length === 0) return [];
  }

  let q = client
    .from("posts")
    .select(POST_COLS)
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null);
  if (postIdFilter) q = q.in("id", postIdFilter);
  const { data } = await (q
    .order("published_at", { ascending: false })
    .limit(block.count) as unknown as Result);
  return asRows(data);
}

/** Pobiera wiersze wpisów dla wszystkich bloków post-list dokumentu. */
export async function fetchEmailDocPostRows(
  client: EmailDocDbClient,
  tenantId: string,
  doc: EmailDoc,
): Promise<Record<string, EmailPostRow[]>> {
  const out: Record<string, EmailPostRow[]> = {};
  const blocks = doc.blocks.filter((b): b is EmailPostListBlock => b.type === "post-list");
  for (const block of blocks) {
    try {
      out[block.id] = await fetchForBlock(client, tenantId, block);
    } catch {
      out[block.id] = []; // blok bez danych jest pomijany w renderze
    }
  }
  return out;
}

const stripHtml = (v: string): string =>
  v
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Czyste mapowanie wierszy -> EmailPostRef dla języka odbiorcy. */
export function postRefsForLang(
  rowsByBlock: Record<string, EmailPostRow[]>,
  origin: string,
  lang: EmailLang,
): Record<string, EmailPostRef[]> {
  const base = origin.replace(/\/+$/, "");
  const prefix = lang === "en" ? "/en" : "";
  const out: Record<string, EmailPostRef[]> = {};
  for (const [blockId, rows] of Object.entries(rowsByBlock)) {
    out[blockId] = rows.map((r) => {
      // Fallback międzyjęzykowy jak pickLocalized: żądany -> drugi -> "".
      const title = (lang === "pl" ? r.title_pl : r.title_en) || r.title_pl || r.title_en || "";
      const excerptRaw =
        (lang === "pl" ? r.excerpt_pl : r.excerpt_en) || r.excerpt_pl || r.excerpt_en || "";
      const excerpt = stripHtml(excerptRaw).slice(0, 220);
      return {
        id: r.id,
        title: stripHtml(title),
        excerpt,
        // /post/$slug rozwiązuje się 301 do kanonicznego URL - stabilny
        // format linku niezależny od hierarchii stron.
        href: `${base}${prefix}/post/${encodeURIComponent(r.slug)}`,
        coverUrl: r.cover_image_url,
      };
    });
  }
  return out;
}
