// WordPress import (wordpress_com connector).
// Pobiera listę stron z witryny WordPress.com powiązanej przez konektor,
// konwertuje HTML (Gutenberg + Foxiz shortcodes + zwykły HTML z Elementora)
// do naszego BlocksDoc, opakowuje jako pojedynczy widget `rich-text` w
// BuilderDocument i wstawia rekord do public.pages.
//
// Autoryzacja: requireStaff (admin/editor/author) - druga warstwa poza RLS.
// Strona o slug="main" jest zawsze pomijana (na życzenie klienta).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import type { Database, Json } from "@/integrations/supabase/types";
import { parseGutenberg, stripFoxizShortcodes } from "@/lib/blocks/gutenberg";
import type { BlocksDoc } from "@/lib/blocks/types";
import { toJson, newId, type BuilderDocument } from "@/lib/builder/types";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/wordpress_com";

async function wpFetch(path: string, query?: Record<string, string>): Promise<Response> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const wpKey = process.env.WORDPRESS_COM_API_KEY;
  if (!lovableKey || !wpKey) {
    throw new Error(
      "Konektor WordPress nie jest gotowy (brak LOVABLE_API_KEY / WORDPRESS_COM_API_KEY).",
    );
  }
  const qs = query
    ? "?" + new URLSearchParams(query).toString()
    : "";
  const res = await fetch(`${GATEWAY_URL}${path}${qs}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": wpKey,
    },
  });
  return res;
}

async function resolveTenant(supabase: SupabaseClient<Database>, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("Brak tenanta dla bieżącego użytkownika.");
  return data.tenant_id;
}

function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function uniquePageSlug(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  desired: string,
): Promise<string> {
  const base = normalizeSlug(desired) || "wp-page";
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase
      .from("pages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", candidate)
      .limit(1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now()}`;
}

interface WpListedPage {
  ID: number;
  title: string;
  slug: string;
  status: string;
  URL: string;
  modified: string;
}

interface WpFullPage {
  ID: number;
  title: string;
  slug: string;
  status: string;
  content: string;
  excerpt: string;
  featured_image?: string | null;
  URL: string;
}

/**
 * Build a BuilderDocument that hosts imported content inside a single
 * full-width rich-text widget. Blocks doc keeps Gutenberg/Foxiz/Elementor
 * markup structured (paragraph/heading/image/list/quote/table/embed).
 */
function buildDocFromBlocks(blocksPl: BlocksDoc, blocksEn: BlocksDoc): BuilderDocument {
  return {
    version: 1,
    sections: [
      {
        id: newId(),
        kind: "section",
        children: [
          {
            id: newId(),
            kind: "column",
            span: { desktop: 12 },
            children: [
              {
                id: newId(),
                kind: "widget",
                type: "rich-text",
                content: { doc: toJson({ pl: blocksPl, en: blocksEn }) },
              },
            ],
          },
        ],
      },
    ],
  };
}

function convertHtmlToBlocks(html: string): BlocksDoc {
  const cleaned = stripFoxizShortcodes(html ?? "");
  return parseGutenberg(cleaned);
}

/* -------------------------------- list ----------------------------------- */

const listInput = z.object({
  siteDomain: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9._-]+$/i, "Domena WP (np. mojasite.wordpress.com)"),
  perPage: z.number().int().min(1).max(100).optional(),
});

export const wpListPages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d: unknown) => listInput.parse(d))
  .handler(async ({ data }): Promise<{ pages: WpListedPage[] }> => {
    const site = encodeURIComponent(data.siteDomain);
    const res = await wpFetch(`/rest/v1.1/sites/${site}/posts`, {
      type: "page",
      status: "publish,draft,private",
      number: String(data.perPage ?? 100),
      fields: "ID,title,slug,status,URL,modified",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WordPress zwrócił błąd ${res.status}: ${body.slice(0, 400)}`);
    }
    const json = (await res.json()) as { posts?: WpListedPage[] };
    const pages = (json.posts ?? []).map((p) => ({
      ID: p.ID,
      title: p.title ?? "",
      slug: p.slug ?? String(p.ID),
      status: p.status ?? "publish",
      URL: p.URL ?? "",
      modified: p.modified ?? "",
    }));
    return { pages };
  });

/* -------------------------------- import ---------------------------------- */

const importInput = z.object({
  siteDomain: z
    .string()
    .min(3)
    .max(200)
    .regex(/^[a-z0-9._-]+$/i),
  pageIds: z.array(z.number().int().positive()).min(1).max(100),
  targetStatus: z.enum(["draft", "published"]).default("draft"),
});

interface ImportResultRow {
  wpId: number;
  status: "imported" | "skipped" | "error";
  slug?: string;
  pageId?: string;
  message?: string;
}

export const wpImportPages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d: unknown) => importInput.parse(d))
  .handler(async ({ data, context }): Promise<{ results: ImportResultRow[] }> => {
    const supabase = context.supabase as SupabaseClient<Database>;
    const tenantId = await resolveTenant(supabase, context.userId);
    const site = encodeURIComponent(data.siteDomain);
    const results: ImportResultRow[] = [];

    for (const wpId of data.pageIds) {
      try {
        const res = await wpFetch(`/rest/v1.1/sites/${site}/posts/${wpId}`, {
          fields: "ID,title,slug,status,content,excerpt,featured_image,URL",
        });
        if (!res.ok) {
          const body = await res.text();
          results.push({
            wpId,
            status: "error",
            message: `WordPress ${res.status}: ${body.slice(0, 200)}`,
          });
          continue;
        }
        const wp = (await res.json()) as WpFullPage;
        const rawSlug = normalizeSlug(wp.slug || String(wpId));

        // Zawsze pomijamy stronę /main - jak zdefiniowano w wymaganiu.
        if (rawSlug === "main") {
          results.push({ wpId, status: "skipped", slug: "main", message: "Strona /main pominięta." });
          continue;
        }

        const slug = await uniquePageSlug(supabase, tenantId, rawSlug);
        const blocks = convertHtmlToBlocks(wp.content ?? "");
        const emptyEn: BlocksDoc = { version: 1, blocks: [] };
        const builderDoc = buildDocFromBlocks(blocks, emptyEn);
        const title = (wp.title ?? "").replace(/<[^>]+>/g, "").trim();
        const excerptText = (wp.excerpt ?? "").replace(/<[^>]+>/g, "").trim();

        const { data: inserted, error } = await supabase
          .from("pages")
          .insert({
            tenant_id: tenantId,
            slug,
            title_pl: title || slug,
            title_en: "",
            editor: "builder",
            status: data.targetStatus,
            builder_data: builderDoc as unknown as Json,
            cover_image_url: wp.featured_image || null,
            excerpt_pl: excerptText || null,
            excerpt_en: null,
          })
          .select("id")
          .single();

        if (error) {
          results.push({ wpId, status: "error", message: error.message });
          continue;
        }
        results.push({ wpId, status: "imported", slug, pageId: inserted?.id });
      } catch (e) {
        results.push({
          wpId,
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { results };
  });
