// Regresja M11: invalidator SEO musi celować w RZECZYWISTE query keys.
// Poprzednia wersja unieważniała nieistniejące korzenie ("public-pages-tree",
// "blog-list", ...), przez co publiczne cache nie odświezały się po edycji SEO.
// Test seeduje QueryClient kluczami z prawdziwych queryOptions (src/lib/queries)
// i pilnuje, ze kazdy z nich przechodzi w stan invalidated.
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateSeoCaches } from "@/lib/seo/invalidate";
import {
  blogListQueryOptions,
  homePageQueryOptions,
  publicCategoriesQueryOptions,
  publicPagesTreeQueryOptions,
  resolvedContentQueryOptions,
} from "@/lib/queries/public";

type QueryKeyLike = readonly unknown[];

function seed(qc: QueryClient, key: QueryKeyLike): void {
  qc.setQueryData(key as unknown[], { seeded: true });
}

function isInvalidated(qc: QueryClient, key: QueryKeyLike): boolean {
  return qc.getQueryState(key as unknown[])?.isInvalidated === true;
}

describe("invalidateSeoCaches", () => {
  it("invalidates every public content query key actually used by the app", () => {
    const qc = new QueryClient();
    const publicKeys: QueryKeyLike[] = [
      homePageQueryOptions().queryKey,
      blogListQueryOptions().queryKey,
      publicPagesTreeQueryOptions().queryKey,
      publicCategoriesQueryOptions().queryKey,
      resolvedContentQueryOptions(["europa", "przyklad"]).queryKey,
    ];
    for (const key of publicKeys) seed(qc, key);

    invalidateSeoCaches(qc);

    for (const key of publicKeys) {
      expect(isInvalidated(qc, key), `expected ${JSON.stringify(key)} invalidated`).toBe(true);
    }
  });

  it("invalidates admin SEO surfaces and settings caches", () => {
    const qc = new QueryClient();
    const adminKeys: QueryKeyLike[] = [
      ["seo-panel-path", "post", "page-1"],
      ["site_settings", "seo"],
      ["site_settings_public", "all"],
      ["admin-seo-posts", "tenant-1"],
      ["admin-seo-pages", "tenant-1"],
      ["admin-seo-404"],
      ["admin-redirects"],
    ];
    for (const key of adminKeys) seed(qc, key);

    invalidateSeoCaches(qc);

    for (const key of adminKeys) {
      expect(isInvalidated(qc, key), `expected ${JSON.stringify(key)} invalidated`).toBe(true);
    }
  });

  it("leaves unrelated caches untouched", () => {
    const qc = new QueryClient();
    const unrelated: QueryKeyLike[] = [
      ["admin-posts", "tenant-1", "active"],
      ["post-by-slug", "tenant-1", "abc"],
    ];
    for (const key of unrelated) seed(qc, key);

    invalidateSeoCaches(qc);

    for (const key of unrelated) {
      expect(isInvalidated(qc, key)).toBe(false);
    }
  });

  it("asks the router to re-run loaders when provided", () => {
    const qc = new QueryClient();
    const invalidate = vi.fn();
    invalidateSeoCaches(qc, { invalidate });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
