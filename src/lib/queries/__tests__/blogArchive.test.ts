// Kontrakt SSR-prefetch archiwum bloga (/blog?page=N): loader i komponent
// muszą budować IDENTYCZNY queryKey z tych samych wejść, a parametryzacja
// musi być znormalizowana (clamp), żeby śmieciowe `?page` nie mnożyło wpisów
// cache ani nie omijało widełek rozmiaru strony z ustawień czytania.
import { describe, expect, it } from "vitest";
import { BLOG_PAGE_SIZE, blogArchiveQueryOptions } from "@/lib/queries/public";

describe("blogArchiveQueryOptions", () => {
  it("defaults to page 1 with the blog page size", () => {
    expect(blogArchiveQueryOptions().queryKey).toEqual([
      "public",
      "blog",
      "archive",
      { page: 1, pageSize: BLOG_PAGE_SIZE },
    ]);
  });

  it("normalizes page and pageSize (floor + clamp) into the key", () => {
    expect(blogArchiveQueryOptions({ page: 2.9, pageSize: 24.7 }).queryKey).toEqual([
      "public",
      "blog",
      "archive",
      { page: 2, pageSize: 24 },
    ]);
    // Dolne widełki: strona i rozmiar nigdy poniżej 1.
    expect(blogArchiveQueryOptions({ page: 0, pageSize: 0 }).queryKey).toEqual([
      "public",
      "blog",
      "archive",
      { page: 1, pageSize: 1 },
    ]);
    // Górne widełki rozmiaru strony - te same co resolvePostsPerPage (1..100).
    expect(blogArchiveQueryOptions({ page: 3, pageSize: 500 }).queryKey).toEqual([
      "public",
      "blog",
      "archive",
      { page: 3, pageSize: 100 },
    ]);
  });

  it("keeps loader and component keys identical for identical inputs", () => {
    const loaderSide = blogArchiveQueryOptions({ page: 4, pageSize: 12 }).queryKey;
    const componentSide = blogArchiveQueryOptions({ page: 4, pageSize: 12 }).queryKey;
    expect(loaderSide).toEqual(componentSide);
  });
});
