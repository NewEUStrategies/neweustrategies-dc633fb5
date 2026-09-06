// Sekcja "archiwum kategorii" we wpisie: dziedziczy globalne ustawienia
// archiwum (kolumny / styl listy), wyklucza bieżący wpis i prowadzi do pełnego
// archiwum kategorii. Oba języki interfejsu.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  PostCategoryArchive,
  archiveCardLimit,
} from "@/components/post/PostCategoryArchive";
import { DEFAULT_ARCHIVE_LAYOUT } from "@/lib/archive-layout-settings";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
  }: {
    children: React.ReactNode;
    params?: { slug?: string };
  }) => <a href={`/category/${params?.slug ?? ""}`}>{children}</a>,
}));

const settings = { id: "s1", archive_type: "category" as const, ...DEFAULT_ARCHIVE_LAYOUT };

const posts = [
  {
    id: "p1",
    slug: "a",
    title_pl: "Wpis A",
    title_en: "Post A",
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-01-01",
    parent_page_id: "x",
    author_id: null,
    href: "/blog/a",
  },
  {
    id: "current",
    slug: "b",
    title_pl: "Wpis B",
    title_en: "Post B",
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-01-02",
    parent_page_id: "x",
    author_id: null,
    href: "/blog/b",
  },
];

vi.mock("@/lib/archive-layout-settings", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/archive-layout-settings")>(
      "@/lib/archive-layout-settings",
    );
  return {
    ...actual,
    archiveLayoutQueryOptions: () => ({
      queryKey: ["archive-layout-settings", "category"],
      queryFn: async () => settings,
    }),
  };
});

vi.mock("@/lib/queries/archives", () => ({
  taxonomyArchiveQueryOptions: () => ({
    queryKey: ["public", "archive", "category", "eu"],
    queryFn: async () => ({ posts, total: posts.length }),
  }),
}));

function renderSection(lang: "pl" | "en") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostCategoryArchive
        category={{ slug: "eu", name_pl: "Europa", name_en: "Europe" }}
        currentPostId="current"
        lang={lang}
      />
    </QueryClientProvider>,
  );
}

describe("PostCategoryArchive", () => {
  beforeEach(() => vi.clearAllMocks());

  it("limits cards to two archive rows", () => {
    expect(archiveCardLimit(3)).toBe(6);
    expect(archiveCardLimit(1)).toBe(2);
    expect(archiveCardLimit(4)).toBe(8);
  });

  it("renders PL heading, link to the archive and skips the current post", async () => {
    renderSection("pl");
    expect(await screen.findByText(/Więcej w kategorii Europa/)).toBeInTheDocument();
    const link = screen.getByText("Zobacz całe archiwum").closest("a");
    expect(link).toHaveAttribute("href", "/category/eu");
    expect(screen.queryByText("Wpis B")).not.toBeInTheDocument();
  });

  it("renders EN copy", async () => {
    renderSection("en");
    expect(await screen.findByText(/More in Europe/)).toBeInTheDocument();
    expect(screen.getByText("See the whole archive")).toBeInTheDocument();
  });
});
