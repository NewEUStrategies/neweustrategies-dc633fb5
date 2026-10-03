// TailoredMustReadsView: personalizowane must-reads. Testujemy reguły
// widoczności (audience auth/guest/all vs stan zalogowania), nagłówek z
// imieniem (wołacz PL / nominativ EN, zwijanie szablonu bez imienia),
// pochodzenie imienia (profil -> first_name -> display_name -> user_metadata),
// siatkę wpisów z autorami (link do profilu autora, avatar/placeholder)
// oraz stany puste/ładowania.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

type ProfileRow = { first_name?: string | null; display_name?: string | null };

const db = vi.hoisted(() => ({
  profile: null as null | { first_name?: string | null; display_name?: string | null },
  authors: [] as unknown[] | null,
  authorsError: null as null | string,
  recommended: [] as unknown[],
  user: null as null | { id: string; user_metadata?: Record<string, unknown> },
  authLoading: false,
  profileReads: 0,
  profileError: null as null | string,
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "order", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => {
      if (table !== "profiles") return { data: null, error: null };
      db.profileReads += 1;
      return db.profileError
        ? { data: null, error: { message: db.profileError } }
        : { data: db.profile, error: null };
    };
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === "profiles_public"
          ? db.authorsError
            ? { data: null, error: { message: db.authorsError } }
            : { data: db.authors, error: null }
          : { data: [], error: null },
      );
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
  db.authorsError = null;
  db.recommended = [];
  db.user = null;
  db.authLoading = false;
  db.profileReads = 0;
  db.profileError = null;
});

/** Czeka, aż zapytanie o profil się rozstrzygnie i React Query rozgłosi wynik
 *  (powiadomienia idą przez setTimeout), żeby asercja nie złapała stanu
 *  sprzed odpowiedzi - fallback na user_metadata widać wtedy "przypadkiem". */
async function settleProfileQuery() {
  await waitFor(() => expect(db.profileReads).toBeGreaterThan(0));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
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
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        /^Twoje wybrane must-reads, Anno$/,
      ),
    );
  });

  it.each([
    ["Mateusz", "Mateuszu"],
    ["Paweł", "Pawle"],
    ["Ola", "Olu"],
    ["Ernest", "Erneście"],
    ["Anna-Maria", "Anno-Mario"],
  ])("odmienia %s do wołacza %s (ten sam silnik co e-maile)", async (first, vocative) => {
    db.user = { id: "u1" };
    db.profile = { first_name: first } satisfies ProfileRow;
    renderView();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        `Twoje wybrane must-reads, ${vocative}`,
      ),
    );
  });

  it("supports {name.vocative} next to {name.nominative} in a custom PL label", async () => {
    db.user = { id: "u1" };
    db.profile = { first_name: "Tadeusz" } satisfies ProfileRow;
    renderView({ label_pl: "{name.vocative}! Wybór dla: {name.nominative}" });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
        "Tadeuszu! Wybór dla: Tadeusz",
      ),
    );
  });

  it("keeps the user_metadata name after the profile query settles without a name", async () => {
    // Profil bez imienia zwraca "" - a "" ?? metadane dawało "", więc imię z
    // metadanych mignęło tylko do czasu odpowiedzi bazy i znikało.
    db.user = { id: "u1", user_metadata: { first_name: "Mateusz" } };
    db.profile = { first_name: "", display_name: "" };
    renderView();
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Twoje wybrane must-reads, Mateuszu",
    );
  });

  it("falls back to the first word of user_metadata.full_name when first_name is blank", async () => {
    db.user = { id: "u1", user_metadata: { first_name: "  ", full_name: "  Paweł Nowak" } };
    db.profile = null;
    renderView();
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /^Twoje wybrane must-reads, Pawle$/,
    );
  });

  it("falls back to user_metadata when the profile query fails", async () => {
    db.user = { id: "u1", user_metadata: { first_name: "Kasia" } };
    db.profile = { first_name: "Anna" };
    db.profileError = "permission denied";
    renderView();
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /^Twoje wybrane must-reads, Kasiu$/,
    );
  });

  it("collapses the template for a whitespace-only name instead of leaving a dangling comma", async () => {
    db.user = { id: "u1", user_metadata: { first_name: "   " } };
    db.profile = null;
    renderView();
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /^Twoje wybrane must-reads$/,
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

  it("inserts a name containing '$' literally instead of as a replacement pattern", async () => {
    // String.replace czyta "$&" / "$'" w napisie zastępczym jako wzorce -
    // imię "$&" wstawiało z powrotem "{name}", a "$'" resztę szablonu.
    db.user = { id: "u1" };
    db.profile = { first_name: "$&" } satisfies ProfileRow;
    renderView({ label_pl: "Dla {name.nominative} i {name}" });
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Dla \$& i \$&$/);
  });

  it("ignores non-string user_metadata names instead of crashing the widget", async () => {
    // user_metadata to dowolny JSON ustawiany przez samego użytkownika
    // (auth.updateUser) - liczba w first_name rzucała TypeError przy .trim().
    db.user = { id: "u1", user_metadata: { first_name: 42, full_name: "Paweł Nowak" } };
    db.profile = null;
    renderView();
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /^Twoje wybrane must-reads, Pawle$/,
    );
  });

  it("uses the default 'Dla ciebie' / 'For you' fallback when the template renders empty", async () => {
    db.user = { id: "u1" };
    db.profile = { first_name: "" };
    const pl = renderView({ label_pl: "{name}!" });
    await settleProfileQuery();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Dla ciebie$/);
    pl.unmount();

    renderView({ label_en: "{name.vocative}" }, "en");
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^For you$/),
    );
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

  it("falls back to the other language's title and excerpt when the current one is missing", async () => {
    db.user = { id: "u1" };
    db.recommended = [
      post({ id: "p1", title_en: null, excerpt_en: "" }),
      post({ id: "p2", slug: "bez-tytulu", title_pl: null, title_en: null, author_id: null }),
    ];
    const { container } = renderView({}, "en");

    // Brak wersji EN -> polski tytuł i zajawka zamiast pustej karty.
    expect(await screen.findByText("Analiza CEE")).toBeInTheDocument();
    expect(screen.getByText("Zajawka PL")).toBeInTheDocument();
    // Wpis bez żadnego tytułu: okładka z pustym alt, nie "null"/"undefined".
    const alts = [...container.querySelectorAll("img")].map((img) => img.getAttribute("alt"));
    expect(alts).toEqual(["Analiza CEE", ""]);
    expect(container.textContent).not.toMatch(/null|undefined/);
  });

  it("uses the EN title in the PL view when the post has no Polish title", async () => {
    db.user = { id: "u1" };
    db.recommended = [post({ title_pl: "", excerpt_pl: null })];
    renderView();

    expect(await screen.findByText("CEE analysis")).toBeInTheDocument();
    expect(screen.getByText("Excerpt EN")).toBeInTheDocument();
  });

  it.each([
    ["the author query fails", { authors: [], authorsError: "permission denied" }],
    ["the author query returns no rows object", { authors: null, authorsError: null }],
  ])("renders posts without author bylines when %s", async (_case, authorState) => {
    db.user = { id: "u1" };
    db.recommended = [post()];
    db.authors = authorState.authors;
    db.authorsError = authorState.authorsError;
    renderView();

    expect(await screen.findByText("Analiza CEE")).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole("link", { name: /Igor/ })).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("link").every((a) => !a.getAttribute("href")?.startsWith("/author/")),
    ).toBe(true);
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
