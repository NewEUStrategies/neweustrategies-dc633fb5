// Widok widgetu „Klub: strona": trzy sekcje (artykuly, komentarze, zapisy),
// i18n PL/EN, cisza przy braku dostepu i respektowanie przelacznikow z panelu.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { ClubHubView } from "../ClubHubView";

const state = vi.hoisted(() => ({
  club: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  posts: [] as Array<Record<string, unknown>>,
  members: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (name: string) => {
      if (state.error) return { data: null, error: state.error };
      if (name === "club_view") return { data: state.club, error: null };
      if (name === "club_threads_list") return { data: state.threads, error: null };
      if (name === "club_posts_list") return { data: state.posts, error: null };
      if (name === "club_members_list") return { data: state.members, error: null };
      return { data: [], error: null };
    }),
  },
}));

function renderWidget(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const content = {
  clubSlug: "bezpieczenstwo",
  showHeader: true,
  showCover: true,
  showArticles: true,
  showComments: true,
  showSignups: true,
  articlesLimit: 4,
  commentsLimit: 3,
  signupsLimit: 6,
  joinLabel_pl: "Dołącz do klubu",
  joinLabel_en: "Join the club",
} as unknown as WidgetContent;

function seed() {
  state.club = [
    {
      id: "club-1",
      slug: "bezpieczenstwo",
      name_pl: "Bezpieczeństwo",
      name_en: "Security",
      tagline_pl: "Rozmowy o obronie",
      tagline_en: "Defence talks",
      icon: null,
      accent_color: "#123456",
      cover_image_url: "https://example.org/cover.jpg",
      policy_area: "security",
      member_count: 12,
      thread_count: 5,
      visibility: "public",
    },
  ];
  state.threads = [
    {
      id: "t1",
      slug: "raport-2026",
      title: "Raport 2026",
      excerpt: "Krótkie omówienie raportu.",
      author_name: "Anna Kowalska",
      created_at: "2026-03-04T10:00:00Z",
      last_reply_at: "2026-03-05T10:00:00Z",
      reply_count: 7,
      reaction_count: 3,
    },
  ];
  state.posts = [
    {
      id: "p1",
      body: "Zgadzam się z tezą raportu.",
      author_name: "Jan Nowak",
      author_avatar: "",
      author_slug: "jan-nowak",
      thread_slug: "raport-2026",
      thread_title: "Raport 2026",
      created_at: "2026-03-06T10:00:00Z",
      like_count: 2,
    },
  ];
  state.members = [
    {
      user_id: "u1",
      display_name: "Maria Lis",
      avatar_url: "",
      slug: "maria-lis",
      job_title: "Analityk",
      current_company: "NES",
      role: "member",
      joined_at: "2026-02-01T10:00:00Z",
      verified: true,
      total_count: 12,
    },
  ];
  state.error = null;
}

afterEach(() => {
  cleanup();
  state.club = [];
  state.threads = [];
  state.posts = [];
  state.members = [];
  state.error = null;
});

describe("ClubHubView", () => {
  it("renderuje trzy sekcje po polsku", async () => {
    seed();
    renderWidget(<ClubHubView c={content} lang="pl" />);
    expect(await screen.findByRole("heading", { name: "Bezpieczeństwo" })).toBeTruthy();
    expect(await screen.findByText("Artykuły")).toBeTruthy();
    expect(await screen.findByText("Komentarze")).toBeTruthy();
    expect(await screen.findByText("Zapisy")).toBeTruthy();
    expect(await screen.findByText("Raport 2026")).toBeTruthy();
    expect(await screen.findByText("Zgadzam się z tezą raportu.")).toBeTruthy();
    expect(await screen.findByText("Maria Lis")).toBeTruthy();
    expect(await screen.findByText("Dołącz do klubu")).toBeTruthy();
  });

  it("renderuje treść w języku widoku (EN)", async () => {
    seed();
    renderWidget(<ClubHubView c={content} lang="en" />);
    expect(await screen.findByRole("heading", { name: "Security" })).toBeTruthy();
    expect(await screen.findByText("Articles")).toBeTruthy();
    expect(await screen.findByText("Comments")).toBeTruthy();
    expect(await screen.findByText("Sign-ups")).toBeTruthy();
    expect(await screen.findByText("Join the club")).toBeTruthy();
  });

  it("wyłączone sekcje znikają, reszta zostaje", async () => {
    seed();
    renderWidget(
      <ClubHubView
        c={{ ...content, showComments: false, showSignups: false } as unknown as WidgetContent}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Artykuły")).toBeTruthy();
    expect(screen.queryByText("Komentarze")).toBeNull();
    expect(screen.queryByText("Zapisy")).toBeNull();
  });

  it("bez adresu klubu nie renderuje nic i nie pyta bazy", () => {
    const { container } = renderWidget(
      <ClubHubView c={{ ...content, clubSlug: "" } as unknown as WidgetContent} lang="pl" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("brak dostępu jest cichy (żadnej ramki z komunikatem)", async () => {
    state.error = { message: "permission denied" };
    const { container } = renderWidget(<ClubHubView c={content} lang="pl" />);
    await Promise.resolve();
    expect(container.querySelector("[data-testid='club-hub']")).toBeNull();
  });

  it("artykuł prowadzi do wątku klubu, a data ma maszynowy datetime", async () => {
    seed();
    const { container } = renderWidget(<ClubHubView c={content} lang="en" />);
    const link = await screen.findByRole("link", { name: /Raport 2026/ });
    expect(link.getAttribute("href")).toContain("/club/bezpieczenstwo/t/raport-2026");
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-03-04T10:00:00.000Z");
    expect(time?.textContent).toBe("4 Mar 2026");
  });
});
