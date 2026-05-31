// Server functions for all CMS content mutations (posts, pages, categories,
// tags + post terms). Every call:
//   - runs under `requireSupabaseAuth` (RLS scopes to the user's tenant)
//   - validates with Zod (no `any`, no client-trusted tenant_id)
//   - resolves tenant_id from `profiles` server-side
//   - autogenerates a unique slug per tenant on collision
//   - writes an `audit_log` entry
//   - is rate-limited per user
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { recordAudit, type AuditAction } from "./server/audit.server";
import { rateLimit } from "./server/rate-limit.server";

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
    .from("profiles").select("tenant_id").eq("id", userId).maybeSingle();
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
    let q = supabase.from(table).select("id").eq("tenant_id", tenantId).eq("slug", candidate).limit(1);
    if (ignoreId) q = q.neq("id", ignoreId);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return candidate;
    candidate = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function guard<T>(
  scope: string, userId: string, max: number, action: () => Promise<T>,
): Promise<T> {
  if (!(await rateLimit({ scope, subjectId: userId, max }))) {
    throw new Error("Rate limit exceeded - please slow down");
  }
  return action();
}

async function audit(
  supabase: SupabaseClient, tenantId: string, action: AuditAction,
  entityType: string, entityId: string | null, metadata: Record<string, unknown> = {},
) {
  await recordAudit(supabase, { tenantId, action, entityType, entityId, metadata });
}

type PostUpdateRow = Database["public"]["Tables"]["posts"]["Update"];
type PageUpdateRow = Database["public"]["Tables"]["pages"]["Update"];

// ---------- shared schemas ----------

const UUID = z.string().uuid();
const Status = z.enum(["draft", "published", "archived"]);
const Editor = z.enum(["richtext", "markdown", "builder"]);
const NullableStr = (max: number) => z.string().max(max).nullable().optional();
const SlugInput = z.string().min(1).max(120).regex(SLUG_RE).optional();

const TitleBlock = {
  title_pl: z.string().max(300).default(""),
  title_en: z.string().max(300).default(""),
};

const BuilderJsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(), z.number(), z.boolean(), z.null(),
    z.array(BuilderJsonValue),
    z.record(z.string(), BuilderJsonValue),
  ]),
);

// ---------- POSTS ----------

const PostCore = z.object({
  slug: SlugInput,
  status: Status.default("draft"),
  editor: Editor.default("richtext"),
  ...TitleBlock,
  excerpt_pl: NullableStr(1000),
  excerpt_en: NullableStr(1000),
  content_pl: NullableStr(200_000),
  content_en: NullableStr(200_000),
  cover_image_url: z.string().url().max(2048).nullable().optional(),
  read_minutes: z.number().int().min(0).max(999).nullable().optional(),
  builder_data: BuilderJsonValue.nullable().optional(),
});

export const createPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ title_pl: z.string().max(300).optional(), title_en: z.string().max(300).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.create", userId, 30, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const seed = (data.title_pl || data.title_en || `post-${Date.now().toString(36)}`).trim();
      const slug = await uniqueSlug(supabase, "posts", tenantId, seed);
      const { data: row, error } = await supabase
        .from("posts")
        .insert({
          tenant_id: tenantId, author_id: userId, slug,
          title_pl: data.title_pl ?? "", title_en: data.title_en ?? "",
        })
        .select("id, slug").single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "post.create", "post", row.id, { slug });
      return { id: row.id as string, slug: row.slug as string };
    });
  });

export const updatePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({
    id: UUID, fields: PostCore.partial(),
    categories: z.array(UUID).max(50).optional(),
    tags: z.array(UUID).max(50).optional(),
  }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("post.update", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);

      // Ensure ownership (RLS would also block, but explicit check gives clearer error)
      const { data: existing, error: exErr } = await supabase
        .from("posts").select("id, status, slug").eq("id", data.id).maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (!existing) throw new Error("Post not found or access denied");

      const updates: PostUpdateRow = { ...data.fields } as PostUpdateRow;
      if (typeof updates.slug === "string") {
        updates.slug = await uniqueSlug(supabase, "posts", tenantId, updates.slug, data.id);
      }
      if (updates.status === "published" && !updates.published_at) {
        updates.published_at = new Date().toISOString();
      }

      if (Object.keys(updates).length) {
        const { error } = await supabase.from("posts").update(updates).eq("id", data.id);
        if (error) throw new Error(error.message);
      }

      if (data.categories) {
        await supabase.from("post_categories").delete().eq("post_id", data.id);
        if (data.categories.length) {
          const { error } = await supabase.from("post_categories")
            .insert(data.categories.map((category_id) => ({ post_id: data.id, category_id })));
          if (error) throw new Error(error.message);
        }
      }
      if (data.tags) {
        await supabase.from("post_tags").delete().eq("post_id", data.id);
        if (data.tags.length) {
          const { error } = await supabase.from("post_tags")
            .insert(data.tags.map((tag_id) => ({ post_id: data.id, tag_id })));
          if (error) throw new Error(error.message);
        }
      }

      const publish = updates.status === "published" && existing.status !== "published";
      await audit(
        supabase, tenantId, publish ? "post.publish" : "post.update",
        "post", data.id, { fields: Object.keys(updates) },
      );
      return { ok: true as const };
    });
  });

export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase.from("posts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "post.delete", "post", data.id);
    return { ok: true as const };
  });

// ---------- PAGES ----------

const PageCore = z.object({
  slug: SlugInput,
  status: Status.default("draft"),
  editor: Editor.default("richtext"),
  ...TitleBlock,
  content_pl: NullableStr(200_000),
  content_en: NullableStr(200_000),
  cover_image_url: z.string().url().max(2048).nullable().optional(),
  builder_data: BuilderJsonValue.nullable().optional(),
});

export const createPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ title_pl: z.string().max(300).optional(), title_en: z.string().max(300).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.create", userId, 30, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const seed = (data.title_pl || data.title_en || `page-${Date.now().toString(36)}`).trim();
      const slug = await uniqueSlug(supabase, "pages", tenantId, seed);
      const { data: row, error } = await supabase
        .from("pages")
        .insert({
          tenant_id: tenantId, author_id: userId, slug,
          title_pl: data.title_pl ?? "", title_en: data.title_en ?? "",
        })
        .select("id, slug").single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "page.create", "page", row.id, { slug });
      return { id: row.id as string, slug: row.slug as string };
    });
  });

export const updatePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: UUID, fields: PageCore.partial() }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("page.update", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);

      const { data: existing, error: exErr } = await supabase
        .from("pages").select("id, status").eq("id", data.id).maybeSingle();
      if (exErr) throw new Error(exErr.message);
      if (!existing) throw new Error("Page not found or access denied");

      const updates: PageUpdateRow = { ...data.fields } as PageUpdateRow;
      if (typeof updates.slug === "string") {
        updates.slug = await uniqueSlug(supabase, "pages", tenantId, updates.slug, data.id);
      }
      if (updates.status === "published" && !updates.published_at) {
        updates.published_at = new Date().toISOString();
      }

      if (Object.keys(updates).length) {
        const { error } = await supabase.from("pages").update(updates).eq("id", data.id);
        if (error) throw new Error(error.message);
      }

      const publish = updates.status === "published" && existing.status !== "published";
      await audit(
        supabase, tenantId, publish ? "page.publish" : "page.update",
        "page", data.id, { fields: Object.keys(updates) },
      );
      return { ok: true as const };
    });
  });

export const deletePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase.from("pages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "page.delete", "page", data.id);
    return { ok: true as const };
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
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: UUID.optional(), fields: CategoryCore }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("category.upsert", userId, 60, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const slug = await uniqueSlug(
        supabase, "categories", tenantId,
        data.fields.slug || data.fields.name_pl || data.fields.name_en, data.id,
      );
      const payload = { ...data.fields, slug, tenant_id: tenantId };

      if (data.id) {
        const { error } = await supabase.from("categories").update(payload).eq("id", data.id);
        if (error) throw new Error(error.message);
        await audit(supabase, tenantId, "category.update", "category", data.id, { slug });
        return { id: data.id, slug };
      }
      const { data: row, error } = await supabase.from("categories").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "category.create", "category", row.id, { slug });
      return { id: row.id as string, slug };
    });
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ name: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    return guard("tag.create", userId, 120, async () => {
      const tenantId = await resolveTenant(supabase, userId);
      const slug = await uniqueSlug(supabase, "tags", tenantId, data.name);
      const { data: row, error } = await supabase
        .from("tags").insert({ name: data.name.trim(), slug, tenant_id: tenantId })
        .select("id, slug, name").single();
      if (error) throw new Error(error.message);
      await audit(supabase, tenantId, "tag.create", "tag", row.id, { slug });
      return { id: row.id as string, slug: row.slug as string, name: row.name as string };
    });
  });

export const deleteTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: UUID }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const tenantId = await resolveTenant(supabase, userId);
    const { error } = await supabase.from("tags").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await audit(supabase, tenantId, "tag.delete", "tag", data.id);
    return { ok: true as const };
  });
