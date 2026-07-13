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

/** Author edit window (mirrors the DB guard comments_guard_update: 15 min). */
export const COMMENT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Whether the caller may still edit this comment (own, not deleted, in window). */
export function canEditComment(c: CommentWithAuthor, currentUserId: string | null): boolean {
  return (
    !!currentUserId &&
    c.user_id === currentUserId &&
    c.status !== "deleted" &&
    Date.now() - new Date(c.created_at).getTime() < COMMENT_EDIT_WINDOW_MS
  );
}

const COMMENT_COLS =
  "id, post_id, user_id, parent_id, body, status, created_at, updated_at, edited_at, tenant_id";

/** Safety ceiling for replies fetched under one page of threads (PostgREST caps at 1000 anyway). */
const REPLIES_FETCH_CAP = 1000;

export interface PostCommentsPage {
  /** Windowed top-level comments plus ALL replies of those parents, oldest-first. */
  comments: CommentWithAuthor[];
  /** Total top-level threads visible to the caller (drives "load more"). */
  topLevelCount: number;
  /** Total approved comments for the post (honest header count, incl. beyond the window). */
  approvedCount: number;
}

/**
 * Fetch a page of comment THREADS for a post: `topLevelLimit` oldest top-level
 * comments plus every reply belonging to them. Includes the caller's own
 * pending rows (RLS-permitted via `comments_own_select`).
 *
 * Paginating threads (instead of windowing the flat parents+replies list, as
 * before) guarantees a reply is never fetched without its parent - the old
 * flat window dropped such replies at tree assembly, so around the window
 * boundary threads appeared to lose answers.
 */
export async function fetchPostComments(
  postId: string,
  topLevelLimit = 50,
): Promise<PostCommentsPage> {
  const {
    data: parentData,
    error: parentError,
    count: topLevelCount,
  } = await supabase
    .from("comments")
    .select(COMMENT_COLS, { count: "exact" })
    .eq("post_id", postId)
    .in("status", ["approved", "pending"])
    .is("parent_id", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(topLevelLimit);
  if (parentError) throw parentError;
  const parents = (parentData ?? []) as CommentRow[];

  const [repliesRes, approvedRes] = await Promise.all([
    parents.length > 0
      ? supabase
          .from("comments")
          .select(COMMENT_COLS)
          .in(
            "parent_id",
            parents.map((r) => r.id),
          )
          .in("status", ["approved", "pending"])
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(REPLIES_FETCH_CAP)
      : Promise.resolve({ data: [] as CommentRow[], error: null }),
    supabase
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("post_id", postId)
      .eq("status", "approved"),
  ]);
  if (repliesRes.error) throw repliesRes.error;
  const rows = [...parents, ...((repliesRes.data ?? []) as CommentRow[])];
  if (rows.length === 0) {
    return { comments: [], topLevelCount: topLevelCount ?? 0, approvedCount: 0 };
  }

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
  return {
    comments: rows.map((r) => ({ ...r, author: byId.get(r.user_id) ?? null })),
    topLevelCount: topLevelCount ?? parents.length,
    approvedCount: approvedRes.count ?? 0,
  };
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

/**
 * Edit an own comment's body. The DB guard (comments_guard_update) accepts this
 * only within 15 minutes of creation and stamps edited_at; outside the window
 * it raises 'comments: edit window expired'.
 */
export async function editComment(id: string, body: string): Promise<CommentRow> {
  const trimmed = body.trim();
  if (trimmed.length < 1 || trimmed.length > 5000) throw new Error("invalid_length");
  const { data, error } = await supabase
    .from("comments")
    .update({ body: trimmed })
    .eq("id", id)
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
