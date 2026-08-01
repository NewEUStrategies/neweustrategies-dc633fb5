// TailoredMustReadsView: personalizowane must-reads. Testujemy reguły
// widoczności (audience auth/guest/all vs stan zalogowania), nagłówek z
// imieniem (wołacz PL / nominativ EN, zwijanie szablonu bez imienia),
// pochodzenie imienia (profil -> first_name -> display_name -> user_metadata),
// siatkę wpisów z autorami (link do profilu autora, avatar/placeholder)
// oraz stany puste/ładowania.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { toPlVocative } from "@/lib/i18n/plVocative";

type ProfileRow = { first_name?: string | null; display_name?: string | null };

const db = vi.hoisted(() => ({
  profile: null as null | { first_name?: string | null; display_name?: string | null },
  authors: [] as unknown[],
  recommended: [] as unknown[],
  user: null as null | { id: string; user_metadata?: Record<string, unknown> },
  authLoading: false,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({
      data: table === "profiles" ? db.profile : null,
      error: null,
    });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "profiles_public" ? db.authors : [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async (fn: string) => ({
        data: fn === "get_recommended_posts_v2" ? db.recommended : [],
        error: null,
      }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: db.user, loading: db.authLoading }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { TailoredMustReadsView } from "../TailoredMustReadsView";
import type { WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  slug: "analiza-cee",
  title_pl: "Analiza CEE",
  title_en: "CEE analysis",
  excerpt_pl: "Zajawka PL",
  excerpt_en: "Excerpt EN",
  cover_image_url: "https://cdn.example.com/c.jpg",
  author_id: "a1",
  ...over,
});

function renderView(c: WidgetContent = {}, lang: "pl" | "en" = "pl") {
  return wrap(<TailoredMustReadsView c={c} lang={lang} />);
}

beforeEach(() => {
  db.profile = null;
  db.authors = [];
  db.recommended = [];
  db.user = null;
  db.authLoading = false;
});
afterEach(cleanup);

describe("TailoredMustReadsView - reguły widoczności (audience)", () => {
  it("renders nothing for guests by default and while auth is loading", () => {
    // Domyślne audience=auth + brak usera -> null.
    const a = renderView();
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();

    // Trwające ładowanie auth -> również null (bez migotania).
    db.authLoading = true;
    db.user = { id: "u1" };
    const b = renderView({ audience: "all" });
    expect(b.container).toBeEmptyDOMElement();
  });

  it("audience=guest hides the widget from signed-in users and shows it to guests", () => {
    db.user = { id: "u1" };
    const a = renderView({ audience: "guest" });
    expect(a.container).toBeEmptyDOMElement();
    a.unmount();

    db.user = null;
    renderView({ audience: "guest" });
    // Gość bez imienia -> szablon zwija ", {name}" do samego tytułu.
    expect(screen.getByText("Twoje wybrane must-reads")).toBeInTheDocument();
  });

  it("audience=all renders the collapsed EN heading and default kicker for guests", () => {
    renderView({ audience: "all" }, "en");
    expect(screen.getByText("Your tailored must-reads")).toBeInTheDocument();
    expect(screen.getByText("Recommended for you")).toBeInTheDocument();
  });
});

describe("TailoredMustReadsView - nagłówek z imieniem", () => {
  it("uses the profile first name in the Polish vocative", async () => {
    db.user = { id: "u1" };
    db.profile = { first_name: "Anna" } satisfies ProfileRow;
    renderView();
    const heading = `Twoje wybrane must-reads, ${toPlVocative("Anna")}`;
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(heading),
    );
  });

  it("falls back to the first word of display_name and honors {name.nominative}", async () => {
    db.user = { id: "u1" };
    db.profile = { first_name: " ", display_name: "Jan Kowalski" } satisfies ProfileRow;
    renderView({ label_pl: "Wybór dla {name.nominative}" });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Wybór dla Jan"),
    );
  });

  it("reads user_metadata when the profile has no name and keeps EN nominative", async () => {
    db.user = { id: "u1", user_metadata: { full_name: "Ewa Zielińska" } };
    db.profile = { first_name: "", display_name: "" };
    renderView({}, "en");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "Your tailored must-reads, Ewa",
      ),
    );
  });

  it("collapses the ', {name}' fragment when no name is available", async () => {
    db.user = { id: "u1" };
    db.profile = { first_name: "", display_name: "" };
    renderView();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        /^Twoje wybrane must-reads$/,
      ),
    );
  });

  it("uses the custom fallback label when the template renders empty", async () => {
    db.user = { id: "u1" };
    db.profile = { first_name: "" };
    renderView({ label_pl: "{name}", fallback_pl: "Sekcja specjalna" });
    await waitFor(() => expect(screen.getByText("Sekcja specjalna")).toBeInTheDocument());
  });
});

describe("TailoredMustReadsView - siatka rekomendacji", () => {
  it("renders posts with author links, avatars and excerpts", async () => {
    db.user = { id: "u1" };
    db.recommended = [
      post(),
      post({
        id: "p2",
        slug: "drugi",
        title_pl: "Drugi wpis",
        excerpt_pl: "Inna zajawka",
        author_id: "a2",
      }),
    ];
    db.authors = [
      {
        id: "a1",
        display_name: "Igor Autor",
        slug: "igor",
        avatar_url: "https://cdn.example.com/i.png",
      },
      { id: "a2", display_name: "Bez Slugu", slug: null, avatar_url: null },
    ];
    renderView({ columns: 2 });

    expect(await screen.findByText("Analiza CEE")).toBeInTheDocument();
    expect(screen.getByText("Zajawka PL")).toBeInTheDocument();

    // Autor ze slugiem -> link do profilu z avatarem.
    const authorLink = await screen.findByRole("link", { name: /Igor Autor/ });
    expect(authorLink).toHaveAttribute("href", "/author/igor");
    expect(authorLink.querySelector("img")).not.toBeNull();

    // Autor bez sluga -> zwykły span (bez linku), placeholder zamiast avatara.
    expect(screen.getByText("Bez Slugu").closest("a")).toBeNull();

    // Wpisy linkują do /post/$slug.
    expect(screen.getAllByRole("link", { name: /Analiza CEE/ })[0]).toHaveAttribute(
      "href",
      "/post/analiza-cee",
    );
  });

  it("hides kicker/excerpt/author on demand and renders EN titles with EN paths", async () => {
    db.user = { id: "u1" };
    db.recommended = [post()];
    db.authors = [{ id: "a1", display_name: "Igor Autor", slug: "igor", avatar_url: null }];
    renderView(
      { showKicker: "0", showExcerpt: "0", showAuthor: "0", columns: 4, kicker_en: "Custom" },
      "en",
    );

    expect(await screen.findByText("CEE analysis")).toBeInTheDocument();
    expect(screen.queryByText("Custom")).not.toBeInTheDocument();
    expect(screen.queryByText("Excerpt EN")).not.toBeInTheDocument();
    expect(screen.queryByText("Igor Autor")).not.toBeInTheDocument();
    // EN ścieżki dostają prefiks języka.
    expect(screen.getAllByRole("link", { name: /CEE analysis/ })[0]).toHaveAttribute(
      "href",
      "/en/post/analiza-cee",
    );
  });

  it("shows the empty-interests message when there are no recommendations", async () => {
    db.user = { id: "u1" };
    db.recommended = [];
    renderView({ columns: 1 });
    expect(
      await screen.findByText(/Zaczniemy polecać wpisy, gdy zaznaczysz swoje zainteresowania/),
    ).toBeInTheDocument();
  });
});
