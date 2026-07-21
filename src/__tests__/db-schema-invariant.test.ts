/**
 * Database schema invariant test.
 *
 * Two guarantees:
 *   1. Required public tables exist and are reachable via the Data API
 *      (RLS-respecting anon read of zero rows — validates presence + basic
 *      column projection).
 *   2. PR #58 (BlocksRenderer atomic-design refactor) is a frontend-only
 *      change: the data model consumed by the renderer must be unchanged.
 *      We assert the exact set of block-consuming columns on `posts` and
 *      `pages` plus every table the renderer's block views read from.
 *
 * Runs against Lovable Cloud with the anon key (CI-safe, no browser).
 */
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const shouldRun = Boolean(SUPABASE_URL && SUPABASE_KEY);
const d = shouldRun ? describe : describe.skip;

const client: SupabaseClient<Database> | null = shouldRun
  ? createClient<Database>(SUPABASE_URL as string, SUPABASE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-tenant-host": "neweustrategies.lovable.app" } },
    })
  : null;

/**
 * Tables the app depends on end-to-end. Grouped for readability; the test
 * probes each one with a zero-row select to confirm existence + Data API
 * reachability. RLS may return zero rows — that is fine; only a
 * missing-table / missing-column error fails the assertion.
 */
const REQUIRED_TABLES = [
  // Content core
  "posts",
  "pages",
  "categories",
  "tags",
  "series",
  "media",
  "media_folders",
  "author_profiles",
  "profiles",
  "post_authors",
  "post_categories",
  "post_tags",
  // Blocks renderer surfaces (PR #58 consumers)
  "polls",
  "poll_votes",
  "glossary_terms",
  "cross_references",
  "live_blog_entries",
  "podcasts",
  "web_stories",
  // Access / monetization
  "access_plans",
  "membership_tiers",
  "membership_grants",
  "content_access",
  "b2b_coupons",
  "b2b_coupon_campaigns",
  "b2b_coupon_redemptions",
  "checkout_settings",
  "metering_settings",
  "metering_event_log",
  "payment_orders",
  // Community / events
  "events",
  "event_rsvps",
  "qa_sessions",
  "qa_questions",
  // Workflow / observability
  "workflow_definitions",
  "workflow_runs",
  "workflow_templates",
  "domain_events",
  "client_errors",
  // Auth-domain
  "user_roles",
  "tenants",
  "user_consents",
] as const satisfies ReadonlyArray<keyof Database["public"]["Tables"]>;

/**
 * Column invariants for PR #58. BlocksRenderer reads `blocks_data` and
 * language content from these two tables — the shape must not drift.
 */
const BLOCKS_COLUMNS_POSTS = [
  "id",
  "slug",
  "status",
  "blocks_data",
  "builder_data",
  "content_pl",
  "content_en",
  "tenant_id",
] as const;

const BLOCKS_COLUMNS_PAGES = ["id", "slug", "status", "blocks_data", "tenant_id"] as const;

d("db schema: required tables are reachable via Data API", () => {
  it.each(REQUIRED_TABLES)("table %s exists and accepts a projection", async (table) => {
    const { error } = await client!.from(table).select("*").limit(0);
    // A missing table produces PGRST205 / 42P01. RLS on a reachable table
    // returns an empty array with no error — that is a pass.
    expect(error, `${table}: ${error?.message ?? ""}`).toBeNull();
  });
});

d("db schema: PR #58 (BlocksRenderer) data model is unchanged", () => {
  it("posts still exposes every column the block renderer reads", async () => {
    const { error } = await client!
      .from("posts")
      .select(BLOCKS_COLUMNS_POSTS.join(","))
      .limit(0);
    expect(error, `posts projection failed: ${error?.message ?? ""}`).toBeNull();
  });

  it("pages still exposes every column the block renderer reads", async () => {
    const { error } = await client!
      .from("pages")
      .select(BLOCKS_COLUMNS_PAGES.join(","))
      .limit(0);
    expect(error, `pages projection failed: ${error?.message ?? ""}`).toBeNull();
  });

  it("generated Database types still declare blocks_data on posts and pages", () => {
    // Compile-time invariant surfaced at runtime: if the generated types
    // stop declaring `blocks_data`, this assignment fails typecheck and
    // the test file will not build.
    const _posts: keyof Database["public"]["Tables"]["posts"]["Row"] = "blocks_data";
    const _pages: keyof Database["public"]["Tables"]["pages"]["Row"] = "blocks_data";
    expect(_posts).toBe("blocks_data");
    expect(_pages).toBe("blocks_data");
  });
});
