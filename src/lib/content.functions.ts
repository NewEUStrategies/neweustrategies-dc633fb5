// Server functions for all CMS content mutations (posts, pages, categories,
// tags + post terms). Every call:
//   - runs under `requireStaff` (uwierzytelnienie + serwerowy check roli staff,
//     druga warstwa obok RLS; RLS dalej scope'uje dane po tenancie usera)
//   - validates with Zod (no `any`, no client-trusted tenant_id)
//   - resolves tenant_id from `profiles` server-side
//   - autogenerates a unique slug per tenant on collision
//   - writes an `audit_log` entry
//   - is rate-limited per user
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStaff } from "@/integrations/supabase/require-staff";
import type { Database, Json } from "@/integrations/supabase/types";
import { recordAudit, type AuditAction } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";
import { POST_STATUSES, evaluateTransition, isFirstPublish } from "./content/workflow";
import { normalizeSourcePath, normalizeTargetPath } from "./seo/redirects";
import {
  REVISION_KEEP_LIMIT,
  pickRevisionSnapshot,
  revisionTouches,
  shouldSnapshot,
} from "./content/revisions";

// ---------- shared helpers ----------

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function resolveTenant(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error("No tenant for current user");
  return data.tenant_id as string;
}

async function uniqueSlug(
  supabase: SupabaseClient,
  table: "posts" | "pages" | "categories" | "tags",
  tenantId: string,
  desired: string,
  ignoreId?: string,
): Promise<string> {
  const base = slugify(desired) || "item";
  let candidate = base;
  for (let i = 0; i < 50; i++) {
    let q = supabase
      .from(table)
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", candidate)
      .limit(1);
    if (ignoreId) q = q.neq("id", ignoreId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function guard<T>(
  scope: string,
  userId: string,
  max: number,
  action: () => Promise<T>,
): Promise<T> {
  if (!(await rateLimit({ scope, subjectId: userId, max }))) {
    throw new Error("Rate limit exceeded - please slow down");
  }
  return action();
}

async function audit(
  supabase: SupabaseClient,
  tenantId: string,
  action: AuditAction,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await recordAudit(supabase, { tenantId, action, entityType, entityId, metadata });
}

type PostUpdateRow = Database["public"]["Tables"]["posts"]["Update"];
type PageUpdateRow = Database["public"]["Tables"]["pages"]["Update"];
type ContentStatus = Database["public"]["Enums"]["post_status"];

/**
 * Bulk status change honouring the first-publication rule (isFirstPublish):
 * publishing stamps `published_at` only on rows that never had one, so a bulk
 * action over a mixed selection cannot re-date already-published content and
 * reshuffle the public archive, feeds or sitemaps. The rule is expressed as
 * two complementary filtered UPDATEs because bulk paths have no per-row
 * pre-read; RLS keeps both statements tenant-scoped.
 */
async function applyBulkStatus(
  supabase: SupabaseClient<Database>,
  table: "posts" | "pages",
  ids: string[],
  status: ContentStatus,
): Promise<void> {
  if (status !== "published") {
    const { error } = await supabase.from(table).update({ status }).in("id", ids);
    if (error) throw new Error(error.message);
    return;
  }
  const { error: stampError } = await supabase
    .from(table)
    .update({ status, published_at: new Date().toISOString() })
    .in("id", ids)
    .is("published_at", null);
  if (stampError) throw new Error(stampError.message);
  const { error: keepError } = await supabase
    .from(table)
    .update({ status })
    .in("id", ids)
    .not("published_at", "is", null);
  if (keepError) throw new Error(keepError.message);
}

// ---------- SEO: automatic redirects on permalink changes ----------

async function pageFullPath(supabase: SupabaseClient, pageId: string): Promise<string | null> {
  const { data } = await supabase.rpc("page_full_path", { _page_id: pageId });
  return typeof data === "string" && data ? data : null;
}

/**
 * When a PUBLISHED entity changes its URL (slug or parent), persist a 301 so
 * the old permalink keeps resolving - the WP-migration safety net. Also keeps
 * the rule set chain-free: rules that pointed at the old URL are retargeted,
 * and a stale rule shadowing the new (now live) URL is removed. `wildcard`
 * additionally maps the whole old subtree (moved page: children + posts).
 * Best-effort by design - a redirect bookkeeping failure must never fail the
 * content save itself.
 */
async function captureAutoRedirect(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  input: { oldPath: string | null; newPath: string | null; wildcard?: boolean },
): Promise<void> {
  try {
    const source = input.oldPath ? normalizeSourcePath(input.oldPath) : null;
    // Internal path targets only - no allowlist needed here.
    const target = input.newPath ? normalizeTargetPath(input.newPath) : null;
    if (!source || !target || source === target) return;
    const base = {
      tenant_id: tenantId,
      status_code: 301,
      source: "slug_change",
      created_by: userId,
      is_enabled: true,
    };
    const rows = [
      { ...base, source_path: source, target_path: target },
      ...(input.wildcard
        ? [{ ...base, source_path: `${source}/*`, target_path: `${target}/*` }]
        : []),
    ];
    // A stale rule whose source equals the NEW path would hijack the live URL.
    await supabase
      .from("redirects")
      .delete()
      .eq("tenant_id", tenantId)
      .in(
        "source_path",
        rows.map((r) => r.target_path),
      );
    const { error } = await supabase
      .from("redirects")
      .upsert(rows, { onConflict: "tenant_id,source_path" });
    if (error) throw new Error(error.message);
    // Chain-flattening: anything that redirected TO the old URL now goes
    // straight to the new one (one visible hop for visitors and crawlers).
    await supabase
      .from("redirects")
      .update({ target_path: target })
      .eq("tenant_id", tenantId)
      .eq("target_path", source);
  } catch (e) {
    console.warn("[redirects] auto-capture failed:", e);
  }
}

// ---------- shared schemas ----------

const UUID = z.string().uuid();
// Posts carry the full editorial workflow; pages keep the simple lifecycle.
const PostStatus = z.enum(POST_STATUSES);
const PageStatus = z.enum(["draft", "published", "archived"]);
// Bulk actions exclude `scheduled` - scheduling needs a per-post publish_at.
const BulkPostStatus = z.enum(["draft", "pending_review", "published", "archived"]);
const Editor = z.enum(["blocks", "richtext", "markdown", "builder"]);
const NullableStr = (max: number) => z.string().max(max).nullable().optional();
const SlugInput = z.string().min(1).max(120).regex(SLUG_RE).optional();

const TitleBlock = {
  title_pl: z.string().max(300).default(""),
  title_en: z.string().max(300).default(""),
};

// Yoast-class per-entity SEO fields, shared by posts and pages. Every field is
// optional - the public head() falls back to title/excerpt/site defaults, so
// editors only fill these when they want to override the derived meta.
const SeoBlock = {
  seo_title_pl: NullableStr(160),
  seo_title_en: NullableStr(160),
  seo_description_pl: NullableStr(320),
  seo_description_en: NullableStr(320),
  seo_canonical_url: z.string().url().max(2048).nullable().optional(),
  seo_noindex: z.boolean().optional(),
  seo_og_image_url: z.string().url().max(2048).nullable().optional(),
  og_image_generated_url: z.string().url().max(2048).nullable().optional(),
};

// Recursive JSON value tolerated by the builder payload. `undefined` is not
// valid JSON but UI state frequently leaves keys with `undefined` values
// (e.g. `typography.descriptionFontSize: undefined` from cleared controls).
// We accept it here; JSON.stringify drops such keys at the wire boundary.
const BuilderJsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(BuilderJsonValue),
    z.record(z.string(), BuilderJsonValue),
  ]),
);

// ---------- POSTS ----------

const PostCore = z.object({
  slug: SlugInput,
  status: PostStatus.default("draft"),
  publish_at: z.string().datetime({ offset: true }).nullable().optional(),
  // Hybrid model: posts default to blocks (Gutenberg); pages default to builder.
  editor: Editor.default("blocks"),
  ...TitleBlock,
  excerpt_pl: NullableStr(1000),
  excerpt_en: NullableStr(1000),
  content_pl: NullableStr(200_000),
  content_en: NullableStr(200_000),
  cover_image_url: z.string().url().max(2048).nullable().optional(),
  read_minutes: z.number().int().min(0).max(999).nullable().optional(),
  builder_data: BuilderJsonValue.nullable().optional(),
  blocks_data: BuilderJsonValue.nullable().optional(),
  parent_page_id: UUID.optional(),
  template_id: UUID.nullable().optional(),
  post_format: z.enum(["standard", "video", "audio", "gallery"]).optional(),
  layout_overrides: z.record(z.string(), z.unknown()).nullable().optional(),
  takeaways_pl: z.array(z.string().max(500)).max(6).optional(),
  takeaways_en: z.array(z.string().max(500)).max(6).optional(),
  custom_meta: z.record(z.string().max(64), z.string().max(200)).nullable().optional(),
  related_override: z.record(z.string().max(64), z.unknown()).nullable().optional(),
  ...SeoBlock,
});

async function resolveDefaultBlogPage(
  supabase: SupabaseClient,
  tenantId: string,
  authorId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("pages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", "blog")
    .is("parent_id", null)
    .maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: created, error } = await supabase
    .from("pages")
    .insert({
      tenant_id: tenantId,
      author_id: authorId,
      slug: "blog",
      title_pl: "Blog",
      title_en: "Blog",
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !created) throw new Error(error?.message || "Cannot create default blog page");
  return created.id as string;
}

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        title_pl: z.string().max(300).optional(),
        title_en: z.string().max(300).optional(),
        parent_page_id: UUID.optional(),
        template_id: UUID.optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.create", userId, 30, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const seed = (data.title_pl || data.title_en || `post-${Date.now().toString(36)}`).trim();
      const slug = await uniqueSlug(supabase, "posts", tenantId, seed);
      const parentPageId =
        data.parent_page_id ?? (await resolveDefaultBlogPage(supabase, tenantId, userId));
      const { data: row, error } = await supabase
        .from("posts")
        .insert({
          tenant_id: tenantId,
          author_id: userId,
          slug,
          title_pl: data.title_pl ?? "",
          title_en: data.title_en ?? "",
          parent_page_id: parentPageId,
          template_id: data.template_id ?? null,
          // Hybrid model: posts default to the Gutenberg-style blocks editor
          // (rendered inside a /admin/post-layouts layout). The builder stays
          // available as an opt-in per post; pages use the builder. See
          // docs/ARCHITECTURE.md §2.
          editor: "blocks",
          blocks_data: { pl: { version: 1, blocks: [] }, en: { version: 1, blocks: [] } },
        })
        .select("id, slug")
        .single();
      if (error) throw new Error(error.message);

      await audit(supabase, tenantId, "post.create", "post", row.id, { slug });
      return { id: row.id as string, slug: row.slug as string };
    });
  });

async function resolveCanPublish(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_publish_content");
  if (error) throw new Error("Could not verify publishing permissions");
  return data === true;
}

/**
 * Best-effort revision snapshot of the pre-update row. Autosaves are
 * throttled (one snapshot per REVISION_MIN_INTERVAL_MS); status transitions
 * and restores always snapshot. History is pruned to REVISION_KEEP_LIMIT for
 * publishers (RLS blocks delete for authors - acceptable, prune catches up).
 */
async function writeRevisionSnapshot(
  supabase: SupabaseClient<Database>,
  params: {
    tenantId: string;
    userId: string;
    entityType: "post" | "page";
    entityId: string;
    row: Record<string, unknown>;
    note: "autosave" | "pre_restore";
    force?: boolean;
  },
): Promise<void> {
  try {
    const { data: last } = await supabase
      .from("content_revisions")
      .select("created_at")
      .eq("tenant_id", params.tenantId)
      .eq("entity_type", params.entityType)
      .eq("entity_id", params.entityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!shouldSnapshot(last?.created_at ?? null, Date.now(), params.force)) return;

    const { error } = await supabase.from("content_revisions").insert({
      tenant_id: params.tenantId,
      entity_type: params.entityType,
      entity_id: params.entityId,
      author_id: params.userId,
      snapshot: pickRevisionSnapshot(params.row) as Json,
      note: params.note,
    });
    if (error) {
      console.warn("[revisions] snapshot failed:", error.message);
      return;
    }

    const { data: overflow } = await supabase
      .from("content_revisions")
      .select("id")
      .eq("tenant_id", params.tenantId)
      .eq("entity_type", params.entityType)
      .eq("entity_id", params.entityId)
      .order("created_at", { ascending: false })
      .range(REVISION_KEEP_LIMIT, REVISION_KEEP_LIMIT + 49);
    if (overflow?.length) {
      await supabase
        .from("content_revisions")
        .delete()
        .in(
          "id",
          overflow.map((r) => r.id),
        );
    }
  } catch (e) {
    console.warn("[revisions] snapshot threw:", e);
  }
}

export const updatePost = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        id: UUID,
        fields: PostCore.partial(),
        categories: z.array(UUID).max(50).optional(),
        tags: z.array(UUID).max(50).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.update", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);

      // Ownership is still enforced on the UPDATE below by RLS; this pre-read
      // exists for the workflow gate + revision snapshot. It must read the body
      // columns (for the snapshot), which are no longer SELECT-able by the
      // authenticated role, so it goes through service_role - scoped by tenant
      // to preserve cross-tenant isolation.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing, error: exErr } = await supabaseAdmin
        .from("posts")
        .select("*")
        .eq("id", data.id)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (!existing) throw new Error("Post not found or access denied");

      const updates: PostUpdateRow = { ...data.fields } as PostUpdateRow;
      if (typeof updates.slug === "string") {
        updates.slug = await uniqueSlug(supabase, "posts", tenantId, updates.slug, data.id);
      }

      // Editorial workflow gate (mirrors the enforce_post_workflow trigger,
      // but fails with a friendly message before touching the row).
      const nextStatus = updates.status ?? existing.status;
      const statusChanges = nextStatus !== existing.status;
      const nextPublishAt =
        updates.publish_at !== undefined ? updates.publish_at : existing.publish_at;
      if (statusChanges) {
        const actor = { canPublish: await resolveCanPublish(supabase) };
        const verdict = evaluateTransition(actor, existing.status, nextStatus, nextPublishAt);
        if (!verdict.ok) {
          throw new Error(
            verdict.reason === "requires_publisher"
              ? "Workflow: only an administrator can publish or schedule - submit for review instead"
              : "Workflow: a scheduled post needs a publish date",
          );
        }
      }
      // `published_at` is stamped exactly once - on the first transition into
      // `published` (see isFirstPublish). The editor re-sends
      // status: "published" with every save of a live post, so an unguarded
      // stamp here would reorder every published_at-sorted list and feed.
      if (isFirstPublish(existing.status, nextStatus, existing.published_at)) {
        updates.published_at = new Date().toISOString();
      }
      // Leaving `scheduled` (or publishing directly) clears the pending schedule.
      if (statusChanges && nextStatus !== "scheduled" && existing.publish_at) {
        updates.publish_at = null;
      }

      if (revisionTouches(data.fields)) {
        await writeRevisionSnapshot(supabase, {
          tenantId,
          userId,
          entityType: "post",
          entityId: data.id,
          row: existing,
          note: "autosave",
          force: statusChanges,
        });
      }

      if (Object.keys(updates).length) {
        // `.select()` makes an RLS rejection visible: PostgREST returns 0 rows
        // with error=null when the policy filters the target out (e.g. an
        // author "saving" someone else's post). Without this check the client
        // would show "Saved" while nothing was written - silent data loss.
        const { data: updated, error } = await supabase
          .from("posts")
          .update(updates)
          .eq("id", data.id)
          .select("id");
        if (error) throw new Error(error.message);
        if (!updated?.length) {
          throw new Error("Save rejected - you do not have permission to edit this post");
        }
      }

      // A published post whose slug or parent changed leaves its old permalink
      // behind - capture it as a 301 (see captureAutoRedirect).
      const slugChanged = typeof updates.slug === "string" && updates.slug !== existing.slug;
      const parentChanged =
        typeof updates.parent_page_id === "string" &&
        updates.parent_page_id !== existing.parent_page_id;
      if ((slugChanged || parentChanged) && existing.status === "published") {
        const oldBase = await pageFullPath(supabase, existing.parent_page_id);
        const newParentId = updates.parent_page_id ?? existing.parent_page_id;
        const newBase = parentChanged ? await pageFullPath(supabase, newParentId) : oldBase;
        const newSlug = updates.slug ?? existing.slug;
        await captureAutoRedirect(supabase, userId, tenantId, {
          oldPath: oldBase ? `/${oldBase}/${existing.slug}` : null,
          newPath: newBase ? `/${newBase}/${newSlug}` : null,
        });
      }

      if (data.categories) {
        await supabase.from("post_categories").delete().eq("post_id", data.id);
        if (data.categories.length) {
          const { error } = await supabase
            .from("post_categories")
            .insert(data.categories.map((category_id) => ({ post_id: data.id, category_id })));
          if (error) throw new Error(error.message);
        }
      }
      if (data.tags) {
        await supabase.from("post_tags").delete().eq("post_id", data.id);
        if (data.tags.length) {
          const { error } = await supabase
            .from("post_tags")
            .insert(data.tags.map((tag_id) => ({ post_id: data.id, tag_id })));
          if (error) throw new Error(error.message);
        }
      }

      const action: AuditAction = !statusChanges
        ? "post.update"
        : nextStatus === "published"
          ? "post.publish"
          : nextStatus === "scheduled"
            ? "post.schedule"
            : nextStatus === "pending_review"
              ? "post.review.submit"
              : "post.update";
      await audit(supabase, tenantId, action, "post", data.id, {
        fields: Object.keys(updates),
        ...(statusChanges ? { from: existing.status, to: nextStatus } : {}),
        ...(nextStatus === "scheduled" && nextPublishAt ? { publish_at: nextPublishAt } : {}),
      });
      return { ok: true as const };
    });
  });

// Soft-delete: move to trash
export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase
      .from("posts")
      .update({ deleted_at: new Date().toISOString() } as PostUpdateRow)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "post.delete", "post", data.id, { soft: true });
    return { ok: true as const };
  });

export const bulkDeletePosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.bulkDelete", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase
        .from("posts")
        .update({ deleted_at: new Date().toISOString() } as PostUpdateRow)
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "post.delete", "post", null, {
        ids: data.ids,
        count: data.ids.length,
        soft: true,
      });
      return { ok: true as const, count: data.ids.length };
    });
  });

export const restorePosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.restore", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase
        .from("posts")
        .update({ deleted_at: null } as PostUpdateRow)
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "post.update", "post", null, {
        ids: data.ids,
        restored: true,
      });
      return { ok: true as const, count: data.ids.length };
    });
  });

export const purgePosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.purge", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase.from("posts").delete().in("id", data.ids);
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "post.delete", "post", null, { ids: data.ids, purged: true });
      return { ok: true as const, count: data.ids.length };
    });
  });

export const bulkUpdatePosts = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        ids: z.array(UUID).min(1).max(200),
        status: BulkPostStatus,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.bulkUpdate", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      if (data.status === "published" && !(await resolveCanPublish(supabase))) {
        throw new Error("Workflow: only an administrator can publish - submit for review instead");
      }
      await applyBulkStatus(supabase, "posts", data.ids, data.status);
      await audit(
        supabase,
        tenantId,
        data.status === "published" ? "post.publish" : "post.update",
        "post",
        null,
        { ids: data.ids, status: data.status },
      );
      return { ok: true as const, count: data.ids.length };
    });
  });

// ---------- PAGES ----------

const PageCore = z.object({
  slug: SlugInput,
  status: PageStatus.default("draft"),
  editor: Editor.default("builder"),
  ...TitleBlock,
  excerpt_pl: NullableStr(1000),
  excerpt_en: NullableStr(1000),
  content_pl: NullableStr(200_000),
  content_en: NullableStr(200_000),
  cover_image_url: z
    .string()
    .max(2048)
    .nullable()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  builder_data: BuilderJsonValue.nullable().optional(),
  parent_id: UUID.nullable().optional(),
  template_id: UUID.nullable().optional(),
  menu_order: z.number().int().min(0).max(99999).optional(),
  template_type: z
    .enum(["default", "full_width", "landing", "archive_listing", "contact"])
    .optional(),
  header_override: z.string().max(64).nullable().optional(),
  ...SeoBlock,
});

export const createPage = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        title_pl: z.string().max(300).optional(),
        title_en: z.string().max(300).optional(),
        parent_id: UUID.nullable().optional(),
        template_id: UUID.optional(),
        builder_data: BuilderJsonValue.nullable().optional(),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.create", userId, 30, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const seed = (data.title_pl || data.title_en || `page-${Date.now().toString(36)}`).trim();
      const slug = await uniqueSlug(supabase, "pages", tenantId, seed);
      const { data: row, error } = await supabase
        .from("pages")
        .insert({
          tenant_id: tenantId,
          author_id: userId,
          slug,
          title_pl: data.title_pl ?? "",
          title_en: data.title_en ?? "",
          parent_id: data.parent_id ?? null,
          template_id: data.template_id ?? null,
          builder_data: (data.builder_data ?? null) as Json | null,
        })
        .select("id, slug")
        .single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "page.create", "page", row.id, { slug });
      return { id: row.id as string, slug: row.slug as string };
    });
  });

export const updatePage = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID, fields: PageCore.partial() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.update", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);

      const { data: existing, error: exErr } = await supabase
        .from("pages")
        .select("id, status, slug, parent_id, published_at")
        .eq("id", data.id)
        .maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (!existing) throw new Error("Page not found or access denied");

      const updates: PageUpdateRow = { ...data.fields } as PageUpdateRow;
      if (typeof updates.slug === "string") {
        updates.slug = await uniqueSlug(supabase, "pages", tenantId, updates.slug, data.id);
      }
      // Same first-publication rule as posts (see isFirstPublish): a re-save
      // of a live page must not re-date it - sitemaps and feeds order by
      // `published_at`, and the editor re-sends status: "published" every time.
      const nextStatus = updates.status ?? existing.status;
      if (isFirstPublish(existing.status, nextStatus, existing.published_at)) {
        updates.published_at = new Date().toISOString();
      }

      // Permalink move detection needs the pre-update path (page_full_path
      // resolves the CURRENT hierarchy, so read it before writing).
      const slugChanged = typeof updates.slug === "string" && updates.slug !== existing.slug;
      const parentChanged =
        updates.parent_id !== undefined && updates.parent_id !== existing.parent_id;
      const willMove = (slugChanged || parentChanged) && existing.status === "published";
      const oldPath = willMove ? await pageFullPath(supabase, data.id) : null;

      if (Object.keys(updates).length) {
        // Same silent-RLS-rejection guard as updatePost: 0 updated rows with
        // error=null means the policy filtered the page out - surface it.
        const { data: updated, error } = await supabase
          .from("pages")
          .update(updates)
          .eq("id", data.id)
          .select("id");
        if (error) throw new Error(error.message);
        if (!updated?.length) {
          throw new Error("Save rejected - you do not have permission to edit this page");
        }
      }

      if (willMove && oldPath) {
        const newPath = await pageFullPath(supabase, data.id);
        // Wildcard covers the whole moved subtree: child pages and posts under
        // this page redirect via "/old-base/* -> /new-base/*".
        await captureAutoRedirect(supabase, userId, tenantId, {
          oldPath: `/${oldPath}`,
          newPath: newPath ? `/${newPath}` : null,
          wildcard: true,
        });
      }

      const publish = nextStatus === "published" && existing.status !== "published";
      await audit(
        supabase, tenantId, publish ? "page.publish" : "page.update",
        "page", data.id, { fields: Object.keys(updates) },
      );
      return { ok: true as const };
    });
  });

// Soft-delete: move to trash
export const deletePage = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase
      .from("pages")
      .update({ deleted_at: new Date().toISOString() } as PageUpdateRow)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "page.delete", "page", data.id, { soft: true });
    return { ok: true as const };
  });

export const bulkDeletePages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.bulkDelete", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase
        .from("pages")
        .update({ deleted_at: new Date().toISOString() } as PageUpdateRow)
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "page.delete", "page", null, {
        ids: data.ids,
        count: data.ids.length,
        soft: true,
      });
      return { ok: true as const, count: data.ids.length };
    });
  });

export const restorePages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.restore", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase
        .from("pages")
        .update({ deleted_at: null } as PageUpdateRow)
        .in("id", data.ids);
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "page.update", "page", null, {
        ids: data.ids,
        restored: true,
      });
      return { ok: true as const, count: data.ids.length };
    });
  });

export const purgePages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ ids: z.array(UUID).min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.purge", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const { error } = await supabase.from("pages").delete().in("id", data.ids);
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "page.delete", "page", null, { ids: data.ids, purged: true });
      return { ok: true as const, count: data.ids.length };
    });
  });

export const bulkUpdatePages = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) =>
    z
      .object({
        ids: z.array(UUID).min(1).max(200),
        status: PageStatus,
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.bulkUpdate", userId, 20, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      await applyBulkStatus(supabase, "pages", data.ids, data.status);
      await audit(
        supabase,
        tenantId,
        data.status === "published" ? "page.publish" : "page.update",
        "page",
        null,
        { ids: data.ids, status: data.status },
      );
      return { ok: true as const, count: data.ids.length };
    });
  });

// ---------- CATEGORIES ----------

const CategoryCore = z.object({
  name_pl: z.string().min(1).max(200),
  name_en: z.string().min(1).max(200),
  slug: SlugInput,
  description_pl: NullableStr(2000),
  description_en: NullableStr(2000),
});

export const upsertCategory = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID.optional(), fields: CategoryCore }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("category.upsert", userId, 60, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const slug = await uniqueSlug(
        supabase,
        "categories",
        tenantId,
        data.fields.slug || data.fields.name_pl || data.fields.name_en,
        data.id,
      );
      const payload = { ...data.fields, slug, tenant_id: tenantId };

      if (data.id) {
        const { error } = await supabase.from("categories").update(payload).eq("id", data.id);
        if (error) throw new Error(error.message);
        await audit(supabase, tenantId, "category.update", "category", data.id, { slug });
        return { id: data.id, slug };
      }
      const { data: row, error } = await supabase
        .from("categories")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "category.create", "category", row.id, { slug });
      return { id: row.id as string, slug };
    });
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase.from("categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "category.delete", "category", data.id);
    return { ok: true as const };
  });

// ---------- TAGS ----------

export const createTag = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ name: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("tag.create", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const slug = await uniqueSlug(supabase, "tags", tenantId, data.name);
      const { data: row, error } = await supabase
        .from("tags")
        .insert({ name: data.name.trim(), slug, tenant_id: tenantId })
        .select("id, slug, name")
        .single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "tag.create", "tag", row.id, { slug });
      return { id: row.id as string, slug: row.slug as string, name: row.name as string };
    });
  });

export const deleteTag = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase.from("tags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "tag.delete", "tag", data.id);
    return { ok: true as const };
  });
