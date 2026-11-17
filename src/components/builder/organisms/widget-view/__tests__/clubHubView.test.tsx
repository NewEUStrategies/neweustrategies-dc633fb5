// Widok widgetu „Klub: strona": trzy sekcje (artykuly, komentarze, zapisy),
// i18n PL/EN, cisza przy braku dostepu i respektowanie przelacznikow z panelu.
// Na koncu okladka obu widgetow klubu („strona" i „karta"): kadr zapisany
// w klubie (`cover_position_y`) zamiast srodka zdjecia.
//
// SESJA. Lista zapisanych to `club_members_list` - bez EXECUTE dla `anon`.
// Domyślny czytelnik tego pliku jest więc ZALOGOWANY (tak jak dotąd widział
// listę), a gość ma własny blok: zero żądań o skład, licznik z karty klubu
// i „Dołącz”, a HTML serwera równy pierwszemu renderowi klienta.
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, render, screen, cleanup, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import { ClubHubView } from "../ClubHubView";
import { ClubCardView } from "../ClubWidgets";
import { clubCardQueryOptions, type ClubCardRow } from "@/lib/builder/clubsQuery";

const state = vi.hoisted(() => ({
  club: [] as Array<Record<string, unknown>>,
  threads: [] as Array<Record<string, unknown>>,
  posts: [] as Array<Record<string, unknown>>,
  members: [] as Array<Record<string, unknown>>,
  error: null as { message: string } | null,
  session: { user: { id: "u-me" } } as { user: { id: string } } | null,
  rpcCalls: [] as string[],
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: state.session, user: state.session?.user ?? null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(async (name: string) => {
      state.rpcCalls.push(name);
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
      cover_position_y: 20,
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
  state.session = { user: { id: "u-me" } };
  state.rpcCalls = [];
  document.body.innerHTML = "";
});

describe("ClubHubView", () => {
  it("renderuje trzy sekcje po polsku", async () => {
    seed();
    renderWidget(<ClubHubView c={content} lang="pl" />);
    expect(await screen.findByRole("heading", { name: "Bezpieczeństwo" })).toBeTruthy();
    expect(await screen.findByText("Artykuły")).toBeTruthy();
    expect(await screen.findByText("Komentarze")).toBeTruthy();
    expect(await screen.findByText("Zapisy")).toBeTruthy();
    expect((await screen.findAllByText("Raport 2026")).length).toBeGreaterThan(0);
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
    const [link] = await screen.findAllByRole("link", { name: /Raport 2026/ });
    expect(link.getAttribute("href")).toContain("/club/bezpieczenstwo/t/raport-2026");
    const time = container.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-03-04T10:00:00.000Z");
    expect(time?.textContent).toBe("4 Mar 2026");
  });
});

describe("okładka widgetów klubu", () => {
  it("„Klub: strona” rysuje okładkę w kadrze zapisanym w klubie", async () => {
    seed();
    const { container } = renderWidget(<ClubHubView c={content} lang="pl" />);
    await screen.findByRole("heading", { name: "Bezpieczeństwo" });
    expect(container.querySelector("img")?.style.objectPosition).toBe("center 20%");
  });

  it("„Klub: karta” rysuje okładkę w kadrze zapisanym w klubie", async () => {
    seed();
    const { container } = renderWidget(
      <ClubCardView c={{ clubSlug: "bezpieczenstwo" } as unknown as WidgetContent} lang="pl" />,
    );
    await screen.findByRole("heading", { name: "Bezpieczeństwo" });
    expect(container.querySelector("img")?.style.objectPosition).toBe("center 20%");
  });

  it("wiersz bez kadru (starsza baza) rysuje środek zdjęcia", async () => {
    seed();
    delete state.club[0].cover_position_y;
    const { container } = renderWidget(
      <ClubCardView c={{ clubSlug: "bezpieczenstwo" } as unknown as WidgetContent} lang="pl" />,
    );
    await screen.findByRole("heading", { name: "Bezpieczeństwo" });
    expect(container.querySelector("img")?.style.objectPosition).toBe("center 50%");
  });
});

describe("ClubHubView - gość (`club_members_list` zamknięte dla `anon`)", () => {
  it("gość nie pyta o skład, a sekcja zapisów zostaje z licznikiem z karty i „Dołącz”", async () => {
    seed();
    state.session = null;
    renderWidget(<ClubHubView c={content} lang="pl" />);

    expect(await screen.findByText("Zapisy")).toBeTruthy();
    // Artykuły i komentarze to RPC otwarte dla `anon` - przyszły, więc
    // zapytania widgetu naprawdę się rozstrzygnęły.
    expect(await screen.findByText("Zgadzam się z tezą raportu.")).toBeTruthy();
    expect(state.rpcCalls).not.toContain("club_members_list");
    expect(screen.queryByText("Maria Lis")).toBeNull();
    expect(screen.getByText("Dołącz do klubu")).toBeTruthy();
    // Licznik z karty klubu (`member_count`), nie z listy, której nie ma.
    expect(screen.getAllByText(/12/).length).toBeGreaterThan(0);
  });

  it("zalogowany pyta o skład jak dotąd", async () => {
    seed();
    renderWidget(<ClubHubView c={content} lang="pl" />);
    expect(await screen.findByText("Maria Lis")).toBeTruthy();
    expect(state.rpcCalls).toContain("club_members_list");
  });

  it("HTML serwera = pierwszy render klienta z rozstrzygniętą sesją; skład dopiero po hydratacji", async () => {
    seed();
    const client = (): QueryClient => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      // Karta klubu jak po prefetchu SSR - widget rysuje się już na serwerze.
      // Wiersz `seed()` ma dokładnie pola karty (`ClubCardRow`).
      queryClient.setQueryData(
        clubCardQueryOptions("bezpieczenstwo").queryKey,
        state.club[0] as unknown as ClubCardRow,
      );
      return queryClient;
    };
    state.session = null;
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <QueryClientProvider client={client()}>
        <ClubHubView c={content} lang="pl" />
      </QueryClientProvider>,
    );
    document.body.append(host);
    expect(host.querySelector("[data-testid='club-hub']")).not.toBeNull();

    state.session = { user: { id: "u-me" } };
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(
        host,
        <QueryClientProvider client={client()}>
          <ClubHubView c={content} lang="pl" />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    try {
      expect(errors).toEqual([]);
      await waitFor(() => expect(host.textContent).toContain("Maria Lis"));
    } finally {
      await act(async () => root.unmount());
    }
  });
});
