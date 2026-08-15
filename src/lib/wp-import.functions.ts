// WordPress import (wordpress_com connector) - v2.
//
// Publikuje trzy server functions:
// - wpListPages: lista stron z witryny WP.com
// - wpPreviewPage: konwersja bez zapisu; zwraca oryginalny HTML + wynikowy
//   BuilderDocument + statystyki pokrycia + listę mediów, do porównania w UI.
// - wpImportPages: import właściwy z opcją nadpisywania istniejących stron
//   i sparowania wersji PL/EN (dwa wpId -> jedna strona z title_pl + title_en).
// - listExistingPages: lista stron w bazie (staff) do wyboru targetu nadpisania.
//
// Autoryzacja: requireStaff (admin/editor/author). Strona o slug="main" jest
// twardo pomijana zarówno w UI jak i tu (druga warstwa).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import type { Database, Json } from "@/integrations/supabase/types";
import type { BuilderDocument } from "@/lib/builder/types";
import { toJson } from "@/lib/builder/types";
import { convertHtmlToBuilder, type ConversionResult } from "@/lib/wp-import/convert";
import {
  buildPageFromHtmlPair,
  type BuiltPage,
  type EnBodyOutcome,
} from "@/lib/wp-import/buildPage";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/wordpress_com";

async function wpFetch(path: string, query?: Record<string, string>): Promise<Response> {
  const platformApiKey = process.env.LOVABLE_API_KEY;
  const wpKey = process.env.WORDPRESS_COM_API_KEY;
  if (!platformApiKey || !wpKey) {
    throw new Error(
      "Konektor WordPress nie jest gotowy (brak LOVABLE_API_KEY / WORDPRESS_COM_API_KEY).",
    );
  }
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  return fetch(`${GATEWAY_URL}${path}${qs}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${platformApiKey}`,
      "X-Connection-Api-Key": wpKey,
    },
  });
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
  excludeId?: string,
): Promise<string> {
  const base = normalizeSlug(desired) || "wp-page";
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    let q = supabase
      .from("pages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", candidate)
      .limit(1);
    if (excludeId) q = q.neq("id", excludeId);
    const { data, error } = await q;
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

async function fetchWpPage(site: string, wpId: number): Promise<WpFullPage> {
  const res = await wpFetch(`/rest/v1.1/sites/${site}/posts/${wpId}`, {
    fields: "ID,title,slug,status,content,excerpt,featured_image,URL",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as WpFullPage;
}

/* ============================ list ================================= */

const domainRe = /^[a-z0-9._-]+$/i;

const listInput = z.object({
  siteDomain: z.string().min(3).max(200).regex(domainRe),
  perPage: z.number().int().min(1).max(100).optional(),
});

export const wpListPages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((d: unknown) => listInput.parse(d))
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
    return {
      pages: (json.posts ?? []).map((p) => ({
        ID: p.ID,
        title: p.title ?? "",
        slug: p.slug ?? String(p.ID),
        status: p.status ?? "publish",
        URL: p.URL ?? "",
        modified: p.modified ?? "",
      })),
    };
  });

/* ============================ preview ============================== */

const previewInput = z.object({
  siteDomain: z.string().min(3).max(200).regex(domainRe),
  wpId: z.number().int().positive(),
  wpIdEn: z.number().int().positive().optional(),
});

export interface PreviewResult {
  wpId: number;
  title: string;
  slug: string;
  original: { html: string; cleanedHtml: string; mediaUrls: string[] };
  converted: BuilderDocument;
  translationEn?: {
    title: string;
    excerpt: string;
    converted: BuilderDocument;
  };
  coverage: ConversionResult["coverage"];
  warnings: string[];
  source: ConversionResult["source"];
}

export const wpPreviewPage = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((d: unknown) => previewInput.parse(d))
  .handler(async ({ data }): Promise<PreviewResult> => {
    const site = encodeURIComponent(data.siteDomain);
    const wp = await fetchWpPage(site, data.wpId);
    const conv = convertHtmlToBuilder(wp.content ?? "");
    const title = (wp.title ?? "").replace(/<[^>]+>/g, "").trim();

    let translationEn: PreviewResult["translationEn"];
    if (data.wpIdEn) {
      const wpEn = await fetchWpPage(site, data.wpIdEn);
      const convEn = convertHtmlToBuilder(wpEn.content ?? "");
      translationEn = {
        title: (wpEn.title ?? "").replace(/<[^>]+>/g, "").trim(),
        excerpt: (wpEn.excerpt ?? "").replace(/<[^>]+>/g, "").trim(),
        converted: convEn.doc,
      };
    }
    return {
      wpId: wp.ID,
      title,
      slug: normalizeSlug(wp.slug || String(wp.ID)),
      original: {
        html: wp.content ?? "",
        cleanedHtml: conv.cleanedHtml,
        mediaUrls: conv.mediaUrls,
      },
      converted: conv.doc,
      translationEn,
      coverage: conv.coverage,
      warnings: conv.warnings,
      source: conv.source,
    };
  });

/* ======================== list existing pages ====================== */

export const listExistingPages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((_d: unknown) => ({}))
  .handler(
    async ({
      context,
    }): Promise<{
      pages: Array<{
        id: string;
        title_pl: string;
        title_en: string;
        slug: string;
        status: string;
      }>;
    }> => {
      const { supabase, userId } = context;
      const tenantId = await resolveTenant(supabase, userId);
      const { data, error } = await supabase
        .from("pages")
        .select("id, title_pl, title_en, slug, status")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .neq("slug", "main")
        .order("title_pl", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      return { pages: (data ?? []).map((p) => ({ ...p, status: String(p.status) })) };
    },
  );

/* ============================ import =============================== */

const importInput = z.object({
  siteDomain: z.string().min(3).max(200).regex(domainRe),
  items: z
    .array(
      z.object({
        plId: z.number().int().positive(),
        enId: z.number().int().positive().optional(),
        targetPageId: z.string().uuid().optional(),
        slugOverride: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(100),
  targetStatus: z.enum(["draft", "published"]).default("draft"),
  mirrorMedia: z.boolean().default(true),
  includeExternalMedia: z.boolean().default(false),
});

interface ImportResultRow {
  wpId: number;
  wpIdEn?: number;
  status: "imported" | "overwritten" | "skipped" | "error";
  slug?: string;
  pageId?: string;
  message?: string;
  mediaMirrored?: number;
  /** Los treści EN - raportowany zawsze, żeby jej brak nie był cichy. */
  enBody?: EnBodyOutcome;
}

/**
 * Ścieżka konektora WP.com. Dzieli obsługę pary PL/EN z importem WXR
 * (`buildPageFromHtmlPair`), więc treść EN jest konwertowana, mirrorowana i
 * zapisywana dokładnie tak samo - wcześniej ta gałąź brała z EN tylko tytuł i
 * zapowiedź, a całe `wpEn.content` przepadało bez śladu w wyniku importu.
 */
async function buildPageFromWp(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  userId: string,
  wp: WpFullPage,
  wpEn: WpFullPage | null,
  mirror: boolean,
  includeExternal: boolean,
): Promise<BuiltPage> {
  return buildPageFromHtmlPair(
    supabase,
    tenantId,
    userId,
    {
      title: wp.title ?? "",
      contentHtml: wp.content ?? "",
      excerpt: wp.excerpt ?? "",
      cover: wp.featured_image ?? null,
    },
    wpEn
      ? {
          title: wpEn.title ?? "",
          contentHtml: wpEn.content ?? "",
          excerpt: wpEn.excerpt ?? "",
        }
      : null,
    mirror,
    includeExternal,
  );
}

export const wpImportPages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((d: unknown) => importInput.parse(d))
  .handler(async ({ data, context }): Promise<{ results: ImportResultRow[] }> => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const site = encodeURIComponent(data.siteDomain);
    const results: ImportResultRow[] = [];

    for (const item of data.items) {
      try {
        const wp = await fetchWpPage(site, item.plId);
        const rawSlug = normalizeSlug(item.slugOverride || wp.slug || String(item.plId));
        if (rawSlug === "main") {
          results.push({
            wpId: item.plId,
            status: "skipped",
            slug: "main",
            message: "Strona /main jest zawsze pomijana.",
          });
          continue;
        }
        const wpEn = item.enId ? await fetchWpPage(site, item.enId) : null;

        const built = await buildPageFromWp(
          supabase,
          tenantId,
          userId,
          wp,
          wpEn,
          data.mirrorMedia,
          data.includeExternalMedia,
        );

        // Nadpisanie istniejącej strony (z auto-snapshotem do content_revisions).
        if (item.targetPageId) {
          const { data: current, error: readErr } = await supabase
            .from("pages")
            .select("*")
            .eq("id", item.targetPageId)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (readErr || !current) {
            results.push({
              wpId: item.plId,
              wpIdEn: item.enId,
              status: "error",
              message: readErr?.message ?? "Nie znaleziono docelowej strony w tym tenancie.",
            });
            continue;
          }
          if (current.slug === "main") {
            results.push({
              wpId: item.plId,
              wpIdEn: item.enId,
              status: "skipped",
              slug: "main",
              message: "Nie można nadpisać strony /main.",
            });
            continue;
          }
          // Snapshot przed nadpisaniem.
          await supabase.from("content_revisions").insert({
            tenant_id: tenantId,
            entity_type: "page",
            entity_id: current.id,
            author_id: userId,
            snapshot: current as unknown as Json,
            note: "wp_import_pre_overwrite",
          });
          const finalSlug =
            item.slugOverride && item.slugOverride !== current.slug
              ? await uniquePageSlug(supabase, tenantId, item.slugOverride, current.id)
              : current.slug;
          const { error: upErr } = await supabase
            .from("pages")
            .update({
              slug: finalSlug,
              title_pl: built.title_pl || current.title_pl || finalSlug,
              title_en: built.title_en || current.title_en,
              editor: "builder",
              status: data.targetStatus,
              builder_data: built.builderDoc as unknown as Json,
              cover_image_url: built.cover_image_url ?? current.cover_image_url,
              excerpt_pl: built.excerpt_pl ?? current.excerpt_pl,
              excerpt_en: built.excerpt_en ?? current.excerpt_en,
              content_pl: built.content_pl ?? current.content_pl,
              content_en: built.content_en ?? current.content_en,
            })
            .eq("id", current.id)
            .eq("tenant_id", tenantId);
          if (upErr) {
            results.push({
              wpId: item.plId,
              wpIdEn: item.enId,
              status: "error",
              message: upErr.message,
            });
            continue;
          }
          results.push({
            wpId: item.plId,
            wpIdEn: item.enId,
            status: "overwritten",
            slug: finalSlug,
            pageId: current.id,
            mediaMirrored: built.mediaMirrored,
            enBody: built.enBody,
            message: built.warnings.slice(0, 2).join(" · ") || undefined,
          });
          continue;
        }

        // Nowa strona.
        const slug = await uniquePageSlug(supabase, tenantId, rawSlug);
        const { data: inserted, error } = await supabase
          .from("pages")
          .insert({
            tenant_id: tenantId,
            slug,
            title_pl: built.title_pl || slug,
            title_en: built.title_en || "",
            editor: "builder",
            status: data.targetStatus,
            builder_data: built.builderDoc as unknown as Json,
            cover_image_url: built.cover_image_url,
            excerpt_pl: built.excerpt_pl,
            excerpt_en: built.excerpt_en,
            content_pl: built.content_pl,
            content_en: built.content_en,
          })
          .select("id")
          .single();
        if (error) {
          results.push({
            wpId: item.plId,
            wpIdEn: item.enId,
            status: "error",
            message: error.message,
          });
          continue;
        }
        results.push({
          wpId: item.plId,
          wpIdEn: item.enId,
          status: "imported",
          slug,
          pageId: inserted?.id,
          mediaMirrored: built.mediaMirrored,
          enBody: built.enBody,
          message: built.warnings.slice(0, 2).join(" · ") || undefined,
        });
      } catch (e) {
        results.push({
          wpId: item.plId,
          wpIdEn: item.enId,
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    // Zapewnij, że toJson jest realnie użyte, żeby TS builder-narrow'a nie wyciął.
    void toJson;
    return { results };
  });

/* ================= import from WXR (uploaded XML) ================== */
//
// Klient parsuje plik WXR i przesyła gotowe pary PL/EN. Serwer robi to samo,
// co wpImportPages: konwersja HTML->Builder, mirror mediów (obrazki, PDF, itp.),
// upsert do pages z auto-snapshotem do content_revisions przy nadpisaniu.

const wxrItemInput = z.object({
  // Klucz stabilny (zwykle wpId z eksportu), do korelacji rezultatów w UI.
  clientId: z.number().int().positive(),
  slug: z.string().min(1).max(160),
  slugOverride: z.string().max(120).optional(),
  targetPageId: z.string().uuid().optional(),

  title_pl: z.string().max(500).default(""),
  content_pl_html: z.string().max(5_000_000).default(""),
  excerpt_pl: z.string().max(5_000).default(""),
  cover_image_url: z.string().url().max(2000).optional().nullable(),

  title_en: z.string().max(500).optional(),
  content_en_html: z.string().max(5_000_000).optional(),
  excerpt_en: z.string().max(5_000).optional(),
});

const wxrImportInput = z.object({
  items: z.array(wxrItemInput).min(1).max(200),
  targetStatus: z.enum(["draft", "published"]).default("draft"),
  mirrorMedia: z.boolean().default(true),
  includeExternalMedia: z.boolean().default(false),
});

interface WxrImportResultRow {
  clientId: number;
  status: "imported" | "overwritten" | "skipped" | "error";
  slug?: string;
  pageId?: string;
  message?: string;
  mediaMirrored?: number;
  source?: ConversionResult["source"];
  /** Los treści EN - raportowany zawsze, żeby jej brak nie był cichy. */
  enBody?: EnBodyOutcome;
}

export const wpImportFromWxr = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .validator((d: unknown) => wxrImportInput.parse(d))
  .handler(async ({ data, context }): Promise<{ results: WxrImportResultRow[] }> => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const results: WxrImportResultRow[] = [];

    for (const item of data.items) {
      try {
        const rawSlug = normalizeSlug(item.slugOverride || item.slug);
        if (rawSlug === "main") {
          results.push({
            clientId: item.clientId,
            status: "skipped",
            slug: "main",
            message: "Strona /main jest zawsze pomijana (traktowana jako home).",
          });
          continue;
        }

        const built = await buildPageFromHtmlPair(
          supabase,
          tenantId,
          userId,
          {
            title: item.title_pl,
            contentHtml: item.content_pl_html,
            excerpt: item.excerpt_pl,
            cover: item.cover_image_url ?? null,
          },
          item.content_en_html
            ? {
                title: item.title_en ?? "",
                contentHtml: item.content_en_html,
                excerpt: item.excerpt_en ?? "",
              }
            : null,
          data.mirrorMedia,
          data.includeExternalMedia,
        );

        if (item.targetPageId) {
          const { data: current, error: readErr } = await supabase
            .from("pages")
            .select("*")
            .eq("id", item.targetPageId)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (readErr || !current) {
            results.push({
              clientId: item.clientId,
              status: "error",
              message: readErr?.message ?? "Nie znaleziono docelowej strony w tym tenancie.",
            });
            continue;
          }
          if (current.slug === "main") {
            results.push({
              clientId: item.clientId,
              status: "skipped",
              slug: "main",
              message: "Nie można nadpisać strony /main.",
            });
            continue;
          }
          await supabase.from("content_revisions").insert({
            tenant_id: tenantId,
            entity_type: "page",
            entity_id: current.id,
            author_id: userId,
            snapshot: current as unknown as Json,
            note: "wxr_import_pre_overwrite",
          });
          const finalSlug =
            item.slugOverride && item.slugOverride !== current.slug
              ? await uniquePageSlug(supabase, tenantId, item.slugOverride, current.id)
              : current.slug;
          const { error: upErr } = await supabase
            .from("pages")
            .update({
              slug: finalSlug,
              title_pl: built.title_pl || current.title_pl || finalSlug,
              title_en: built.title_en || current.title_en,
              editor: "builder",
              status: data.targetStatus,
              builder_data: built.builderDoc as unknown as Json,
              cover_image_url: built.cover_image_url ?? current.cover_image_url,
              excerpt_pl: built.excerpt_pl ?? current.excerpt_pl,
              excerpt_en: built.excerpt_en ?? current.excerpt_en,
              // Treść w obu językach zapisujemy zawsze (dotąd EN był
              // konwertowany i wyrzucany). Builder pozostaje kanonicznym
              // układem strony; content_pl/content_en to źródło językowe -
              // czyta je silnik `html`, skan użycia mediów, kontrola linków
              // i przepływ tłumaczeń w edytorze.
              content_pl: built.content_pl ?? current.content_pl,
              content_en: built.content_en ?? current.content_en,
            })
            .eq("id", current.id)
            .eq("tenant_id", tenantId);
          if (upErr) {
            results.push({ clientId: item.clientId, status: "error", message: upErr.message });
            continue;
          }
          results.push({
            clientId: item.clientId,
            status: "overwritten",
            slug: finalSlug,
            pageId: current.id,
            mediaMirrored: built.mediaMirrored,
            source: built.source,
            enBody: built.enBody,
            message: built.warnings.slice(0, 2).join(" · ") || undefined,
          });
          continue;
        }

        const slug = await uniquePageSlug(supabase, tenantId, rawSlug);
        const { data: inserted, error } = await supabase
          .from("pages")
          .insert({
            tenant_id: tenantId,
            slug,
            title_pl: built.title_pl || slug,
            title_en: built.title_en || "",
            editor: "builder",
            status: data.targetStatus,
            builder_data: built.builderDoc as unknown as Json,
            cover_image_url: built.cover_image_url,
            excerpt_pl: built.excerpt_pl,
            excerpt_en: built.excerpt_en,
            content_pl: built.content_pl,
            content_en: built.content_en,
          })
          .select("id")
          .single();
        if (error) {
          results.push({ clientId: item.clientId, status: "error", message: error.message });
          continue;
        }
        results.push({
          clientId: item.clientId,
          status: "imported",
          slug,
          pageId: inserted?.id,
          mediaMirrored: built.mediaMirrored,
          source: built.source,
          enBody: built.enBody,
          message: built.warnings.slice(0, 2).join(" · ") || undefined,
        });
      } catch (e) {
        results.push({
          clientId: item.clientId,
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { results };
  });
