// Linki podglądu z tokenem (B5). Trzy funkcje staff (utwórz/lista/odwołaj -
// RLS pilnuje staff+tenant) + jedna publiczna po tokenie (fetchPreviewPost),
// która przez service role waliduje token i zwraca treść szkicu do renderu
// w /preview/$token. Token nigdy nie loguje się do audit_log w całości.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/integrations/supabase/require-staff";
import { rateLimit } from "@/lib/server/rate-limit.server";
import type { Database, Json } from "@/integrations/supabase/types";

const UUID = z.string().uuid();

/** 24 losowe bajty w base64url - nieodgadywalny, krótki w URL. */
function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const DEFAULT_TTL_HOURS = 72;
const MAX_TTL_HOURS = 24 * 30;

export const createPreviewToken = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        postId: UUID,
        ttlHours: z.number().int().min(1).max(MAX_TTL_HOURS).default(DEFAULT_TTL_HOURS),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await rateLimit({ scope: "preview.create", subjectId: userId, max: 30 }))) {
      throw new Error("Rate limit exceeded - please slow down");
    }
    const token = generateToken();
    const expiresAt = new Date(Date.now() + data.ttlHours * 3_600_000).toISOString();
    const { data: row, error } = await supabase
      .from("post_preview_tokens")
      .insert({ post_id: data.postId, token, expires_at: expiresAt, created_by: userId })
      .select("id, token, expires_at")
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id as string,
      token: row.token as string,
      expiresAt: row.expires_at as string,
    };
  });

export const listPreviewTokens = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ postId: UUID }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("post_preview_tokens")
      .select("id, token, expires_at, created_at")
      .eq("post_id", data.postId)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string;
      token: string;
      expires_at: string;
      created_at: string;
    }>;
  });

export const revokePreviewToken = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("post_preview_tokens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export interface PreviewPostPayload {
  title_pl: string;
  title_en: string;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  editor: string;
  content_pl: string | null;
  content_en: string | null;
  builder_data: Json | null;
  blocks_data: Json | null;
  cover_image_url: string | null;
  status: string;
  updated_at: string | null;
  expires_at: string;
}

/**
 * Publiczny odczyt szkicu po tokenie. Service role (szkice są niewidoczne
 * dla anon przez RLS), więc walidacja jest twarda: token istnieje, nie
 * wygasł, wpis nie jest w koszu. Rate limit po tokenie tnie zgadywanie.
 */
export const fetchPreviewPost = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => z.object({ token: z.string().min(16).max(64) }).parse(i ?? {}))
  .handler(async ({ data }): Promise<PreviewPostPayload | null> => {
    if (
      !(await rateLimit({ scope: "preview.fetch", subjectId: data.token.slice(0, 16), max: 60 }))
    ) {
      throw new Error("Rate limit exceeded");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tokenRow } = await supabaseAdmin
      .from("post_preview_tokens")
      .select("post_id, expires_at")
      .eq("token", data.token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!tokenRow) return null;
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select(
        "title_pl, title_en, excerpt_pl, excerpt_en, editor, content_pl, content_en, builder_data, blocks_data, cover_image_url, status, updated_at",
      )
      .eq("id", tokenRow.post_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!post) return null;
    const row = post as Database["public"]["Tables"]["posts"]["Row"];
    return {
      title_pl: row.title_pl,
      title_en: row.title_en,
      excerpt_pl: row.excerpt_pl,
      excerpt_en: row.excerpt_en,
      editor: row.editor,
      content_pl: row.content_pl,
      content_en: row.content_en,
      builder_data: row.builder_data,
      blocks_data: row.blocks_data,
      cover_image_url: row.cover_image_url,
      status: row.status,
      updated_at: row.updated_at,
      expires_at: tokenRow.expires_at as string,
    };
  });
