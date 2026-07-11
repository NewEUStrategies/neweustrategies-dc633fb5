// Comments API — client-side wrappers around supabase-js.
// RLS handles authorization: public may read only `approved` rows;
// authenticated users may INSERT own comments and UPDATE own row
// (only `status='deleted'` is accepted for non-staff — soft delete).
// Staff (admin/editor) may moderate: approve/spam/delete.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type CommentRow = Database["public"]["Tables"]["comments"]["Row"];

export interface CommentAuthor {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  slug: string | null;
}

export interface CommentWithAuthor extends CommentRow {
  author: CommentAuthor | null;
}

export type CommentStatus = "pending" | "approved" | "spam" | "deleted";

/**
 * Fetch approved comments for a post, plus the caller's own pending replies
 * (RLS-permitted via `comments_own_select`). Sorted oldest-first at the top
 * level; children stay adjacent to their parent for a stable 1-level tree.
 *
 * `limit` windows the flat (parents + replies) list oldest-first; the caller
 * grows it for "load more" pagination. Replies whose parent falls outside the
 * window are dropped by the tree assembly - same as the previous fixed cap.
 */
export async function fetchPostComments(postId: string, limit = 500): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("id, post_id, user_id, parent_id, body, status, created_at, updated_at, tenant_id")
    .eq("post_id", postId)
    .in("status", ["approved", "pending"])
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as CommentRow[];
  if (rows.length === 0) return [];

  const authorIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, slug")
    .in("id", authorIds);
  const byId = new Map<string, CommentAuthor>();
  for (const p of profiles ?? []) {
    byId.set(p.id, {
      id: p.id,
      display_name: p.display_name ?? null,
      avatar_url: p.avatar_url ?? null,
      slug: p.slug ?? null,
    });
  }
  return rows.map((r) => ({ ...r, author: byId.get(r.user_id) ?? null }));
}

export async function createComment(input: {
  postId: string;
  body: string;
  parentId?: string | null;
}): Promise<CommentRow> {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error("auth_required");
  const trimmed = input.body.trim();
  if (trimmed.length < 1 || trimmed.length > 5000) throw new Error("invalid_length");

  const { data, error } = await supabase
    .from("comments")
    .insert({
      post_id: input.postId,
      user_id: user.id,
      parent_id: input.parentId ?? null,
      body: trimmed,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CommentRow;
}

/** Soft delete: sets status='deleted'. RLS lets author or staff perform. */
export async function softDeleteComment(id: string): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .update({ status: "deleted" satisfies CommentStatus })
    .eq("id", id);
  if (error) throw error;
}

/** Staff moderation: approve / mark as spam / delete. */
export async function moderateComment(id: string, status: CommentStatus): Promise<void> {
  const { error } = await supabase.from("comments").update({ status }).eq("id", id);
  if (error) throw error;
}

export interface AdminCommentRow extends CommentRow {
  author: CommentAuthor | null;
  post: { id: string; slug: string; title_pl: string | null; title_en: string | null } | null;
}

/** Admin/editor listing — RLS grants staff SELECT of all tenant rows. */
export async function fetchAdminComments(filter: {
  status?: CommentStatus | "all";
  q?: string;
  limit?: number;
}): Promise<AdminCommentRow[]> {
  let query = supabase
    .from("comments")
    .select("id, post_id, user_id, parent_id, body, status, created_at, updated_at, tenant_id")
    .order("created_at", { ascending: false })
    .limit(filter.limit ?? 200);
  if (filter.status && filter.status !== "all") query = query.eq("status", filter.status);
  if (filter.q && filter.q.trim().length > 0) query = query.ilike("body", `%${filter.q.trim()}%`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as CommentRow[];
  if (rows.length === 0) return [];

  const authorIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const postIds = Array.from(new Set(rows.map((r) => r.post_id)));
  const [{ data: profiles }, { data: posts }] = await Promise.all([
    supabase.from("profiles").select("id, display_name, avatar_url, slug").in("id", authorIds),
    supabase.from("posts").select("id, slug, title_pl, title_en").in("id", postIds),
  ]);
  const authorById = new Map<string, CommentAuthor>();
  for (const p of profiles ?? []) {
    authorById.set(p.id, {
      id: p.id,
      display_name: p.display_name ?? null,
      avatar_url: p.avatar_url ?? null,
      slug: p.slug ?? null,
    });
  }
  const postById = new Map<string, AdminCommentRow["post"]>();
  for (const p of posts ?? []) {
    postById.set(p.id, {
      id: p.id,
      slug: p.slug,
      title_pl: p.title_pl ?? null,
      title_en: p.title_en ?? null,
    });
  }
  return rows.map((r) => ({
    ...r,
    author: authorById.get(r.user_id) ?? null,
    post: postById.get(r.post_id) ?? null,
  }));
}
