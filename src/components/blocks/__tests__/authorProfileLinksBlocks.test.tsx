// Odnośniki do profilu autora w blokach wpisu: author-bio (wszystkie warianty
// wizytówki) i post-author.
//
// Co udowadniamy i dlaczego:
//   * Adres budują te same pomocniki co reszta aplikacji: `profileHref`
//     (ścieżka `/author/<slug>` z zakodowanym slugiem) i `localizedPath`
//     (prefiks języka treści bloku). Wcześniej oba widoki sklejały
//     `/author/${slug}`: wizytówka na stronie EN prowadziła do profilu PL,
//     a slug ze znakami specjalnymi („/", „?", „#", spacja) rozcinał ścieżkę
//     albo doklejał zapytanie i kotwicę.
//   * Każdy wariant author-bio ma własne miejsca z odnośnikiem (nazwisko,
//     „Zobacz profil", „Obserwuj", karta profilu) - wszystkie muszą prowadzić
//     pod ten sam adres.
//
// Granice: router -> atrapa z `navigate`/`preloadRoute` (tyle woła AppLink);
// klient Supabase -> pusta odpowiedź (autor przychodzi gotowy, bez zapytań).
// Widoki, kontekst wpisu, AppLink i pomocniki ścieżek są prawdziwe.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  CurrentPostProvider,
  type CurrentPostAuthor,
  type CurrentPostCtx,
} from "@/lib/content-model/postContext";

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    preloadRoute: () => Promise.resolve(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "is", "order", "limit"]) chain[m] = () => chain;
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = () =>
    Promise.resolve({ data: null, error: null });
  return { supabase: chain };
});

import { AuthorBioView } from "../PostContextViews";
import { PostAuthorView } from "../ContextBlockViews";

type Lang = "pl" | "en";

/** Slug ze znakami, które rozcinają ścieżkę albo doklejają zapytanie i kotwicę. */
const ODD_SLUG = "anna/nowak ?x#1";
const ODD_PATH = "/author/anna%2Fnowak%20%3Fx%231";

const CASES: ReadonlyArray<[label: string, lang: Lang, slug: string, href: string]> = [
  ["PL bez prefiksu", "pl", "anna-nowak", "/author/anna-nowak"],
  ["EN z prefiksem /en", "en", "anna-nowak", "/en/author/anna-nowak"],
  ["PL, slug ze znakami specjalnymi zakodowany", "pl", ODD_SLUG, ODD_PATH],
  ["EN, slug ze znakami specjalnymi zakodowany", "en", ODD_SLUG, `/en${ODD_PATH}`],
];

const VARIANTS = ["card", "inline", "minimal", "split", "profile"] as const;

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function author(slug: string): CurrentPostAuthor {
  return { name: "Anna Nowak", slug, bio_pl: "Analityczka", bio_en: "Analyst" };
}

afterEach(cleanup);

describe("author-bio: każdy odnośnik wizytówki prowadzi do profilu autora", () => {
  describe.each(VARIANTS)("wariant %s", (variant) => {
    it.each(CASES)("%s", (_label, lang, slug, href) => {
      // Bez linków społecznościowych i licznika wpisów - zostają wyłącznie
      // odnośniki do profilu (nazwisko, „Zobacz profil", „Obserwuj", karta).
      wrap(
        <AuthorBioView
          variant={variant}
          lang={lang}
          showSocial={false}
          showPostsCount={false}
          authorOverride={author(slug)}
        />,
      );
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("href", href);
    });
  });

  it("autor bez sluga nie dostaje odnośnika", () => {
    wrap(
      <AuthorBioView
        variant="card"
        lang="en"
        showSocial={false}
        showPostsCount={false}
        authorOverride={author("")}
      />,
    );
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("post-author: nazwisko autora wpisu", () => {
  const post = (slug: string): CurrentPostCtx => ({
    kind: "post",
    id: "p1",
    slug: "wpis",
    title_pl: "Tytuł",
    author: author(slug),
  });

  it.each(CASES)("%s", (_label, lang, slug, href) => {
    wrap(
      <CurrentPostProvider value={post(slug)}>
        <PostAuthorView showAvatar={false} showBio={false} lang={lang} cls="" />
      </CurrentPostProvider>,
    );
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toHaveAttribute("href", href);
  });

  it("autor bez sluga nie dostaje odnośnika", () => {
    wrap(
      <CurrentPostProvider value={post("")}>
        <PostAuthorView showAvatar={false} showBio={false} lang="en" cls="" />
      </CurrentPostProvider>,
    );
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
