/**
 * PL vs EN parity + duplicate-content guard.
 *
 * Runs against Lovable Cloud via the anon Data API (respects RLS). No
 * browser needed - suited for CI. Checks:
 *  - Every published post has both PL and EN title + excerpt (no fallbacks).
 *  - Every published page has both PL and EN titles.
 *  - No re-introduced duplicates of published `slug` / `title_pl` / `title_en`
 *    for pages (soft-deleted rows excluded).
 *  - The dev/prod-shared merge redirects for previously removed duplicates
 *    still exist (so nothing accidentally recreates the old URLs).
 */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const shouldRun = Boolean(SUPABASE_URL && SUPABASE_KEY);
const d = shouldRun ? describe : describe.skip;

const client = shouldRun
  ? createClient(SUPABASE_URL as string, SUPABASE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-tenant-host": "neweustrategies.lovable.app" } },
    })
  : null;

const MERGED_SLUGS = [
  "wydarzenia-2",
  "wp-6675",
  "wp-6559",
  "wp-6546",
  "password-reset-2",
  "membership-registration-2",
  "membership-login-2",
] as const;

d("i18n parity: posts + pages have PL and EN content", () => {
  it("every published post has non-empty title_pl / title_en / excerpt_pl / excerpt_en", async () => {
    const { data, error } = await client!
      .from("posts")
      .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en")
      .eq("status", "published")
      .is("deleted_at", null);
    expect(error, error?.message).toBeNull();
    expect(data).toBeTruthy();
    const missing = (data ?? []).filter(
      (p) =>
        !p.title_pl?.trim() ||
        !p.title_en?.trim() ||
        !p.excerpt_pl?.trim() ||
        !p.excerpt_en?.trim(),
    );
    expect(
      missing,
      `posts missing PL/EN fields: ${missing.map((p) => p.slug).join(", ")}`,
    ).toHaveLength(0);
  });

  it("every published page has non-empty title_pl and title_en", async () => {
    const { data, error } = await client!
      .from("pages")
      .select("id, slug, title_pl, title_en")
      .eq("status", "published")
      .is("deleted_at", null);
    expect(error, error?.message).toBeNull();
    const missing = (data ?? []).filter((p) => !p.title_pl?.trim() || !p.title_en?.trim());
    expect(
      missing,
      `pages missing PL/EN titles: ${missing.map((p) => p.slug).join(", ")}`,
    ).toHaveLength(0);
  });
});

d("i18n parity: no duplicate pages after translation updates", () => {
  it("no duplicated slug among live pages", async () => {
    const { data, error } = await client!
      .from("pages")
      .select("slug")
      .is("deleted_at", null);
    expect(error, error?.message).toBeNull();
    const counts = new Map<string, number>();
    for (const row of data ?? []) counts.set(row.slug, (counts.get(row.slug) ?? 0) + 1);
    const dups = [...counts.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    expect(dups, `duplicated slugs: ${dups.join(", ")}`).toHaveLength(0);
  });

  it("no duplicated title_pl or title_en among published pages", async () => {
    const { data, error } = await client!
      .from("pages")
      .select("title_pl, title_en")
      .eq("status", "published")
      .is("deleted_at", null);
    expect(error, error?.message).toBeNull();
    const pl = new Map<string, number>();
    const en = new Map<string, number>();
    for (const row of data ?? []) {
      if (row.title_pl) pl.set(row.title_pl, (pl.get(row.title_pl) ?? 0) + 1);
      if (row.title_en) en.set(row.title_en, (en.get(row.title_en) ?? 0) + 1);
    }
    const plDups = [...pl.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    const enDups = [...en.entries()].filter(([, n]) => n > 1).map(([s]) => s);
    expect(plDups, `duplicated title_pl: ${plDups.join(" | ")}`).toHaveLength(0);
    expect(enDups, `duplicated title_en: ${enDups.join(" | ")}`).toHaveLength(0);
  });

  it("previously merged duplicate slugs remain soft-deleted or absent, and redirects exist", async () => {
    const { data: livePages, error: pagesErr } = await client!
      .from("pages")
      .select("slug")
      .in("slug", MERGED_SLUGS as unknown as string[])
      .is("deleted_at", null);
    expect(pagesErr, pagesErr?.message).toBeNull();
    expect(
      livePages ?? [],
      `merged duplicates reappeared: ${(livePages ?? []).map((p) => p.slug).join(", ")}`,
    ).toHaveLength(0);

    const { data: redirects, error: redirErr } = await client!
      .from("redirects")
      .select("from_path")
      .eq("source", "merge-duplicates");
    expect(redirErr, redirErr?.message).toBeNull();
    const froms = new Set((redirects ?? []).map((r) => r.from_path));
    for (const slug of MERGED_SLUGS) {
      expect(froms.has(`/${slug}`), `missing redirect for /${slug}`).toBe(true);
    }
  });
});
