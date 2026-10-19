// Odnośniki do profilu autora w widgetach buildera: team-member,
// author-profile-card i widgety dynamiczne wpisu (post-meta, post-author-card).
//
// Co udowadniamy i dlaczego:
//   * Adres budują te same pomocniki co reszta aplikacji: `profileHref`
//     (lib/profile - ścieżka `/author/<slug>` z zakodowanym slugiem) i
//     `localizedPath` (lib/i18n/localePath - prefiks języka). Wcześniej
//     widgety sklejały `/author/${slug}`: na stronie EN odnośnik prowadził do
//     profilu PL (HTML serwera, nowa karta, roboty), a slug ze znakami
//     specjalnymi („/", „?", spacja) rozcinał ścieżkę albo doklejał zapytanie.
//   * team-member linkuje profil przez wspólny `AppLink`: klik zostaje w
//     routerze (bez przeładowania dokumentu i utraty chromu strony), jak każdy
//     inny odnośnik widgetów - surowy `<a>` przeładowywał całą stronę.
//
// Granice: router -> atrapa z `navigate`/`preloadRoute` (tyle woła AppLink);
// klient Supabase (BrandIcon czyta bibliotekę ikon) -> pusty łańcuch.
// Widgety, kontekst wpisu, AppLink i pomocniki ścieżek są prawdziwe.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";
import {
  CurrentPostProvider,
  type CurrentPostAuthor,
  type CurrentPostCtx,
} from "@/lib/content-model/postContext";

const h = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  preloadRoute: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: h.navigate, preloadRoute: h.preloadRoute }),
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

import { TeamMemberWidget } from "../TeamMemberWidget";
import { AuthorProfileCardWidget } from "../AuthorProfileCardWidget";
import { DynamicTagWidget } from "../DynamicTagWidgets";

type Lang = "pl" | "en";

/** Slug ze znakami, które rozcinają ścieżkę albo doklejają zapytanie. */
const ODD_SLUG = "anna/nowak ?x#1";
const ODD_PATH = "/author/anna%2Fnowak%20%3Fx%231";

function widget(type: WidgetType, content: Record<string, unknown>): WidgetNode {
  return { id: `${type}-t`, kind: "widget", type, content: content as WidgetContent };
}

function wrap(ui: ReactElement, ctx?: CurrentPostCtx) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      {ctx ? <CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider> : ui}
    </QueryClientProvider>,
  );
}

function postWithAuthor(author: Partial<CurrentPostAuthor>): CurrentPostCtx {
  return {
    kind: "post",
    id: "p1",
    slug: "wpis",
    title_pl: "Tytuł",
    author: { name: "Anna Nowak", slug: "anna-nowak", ...author } as CurrentPostAuthor,
  };
}

afterEach(() => {
  cleanup();
  h.navigate.mockClear();
});

const CASES: ReadonlyArray<[label: string, lang: Lang, slug: string, href: string]> = [
  ["PL bez prefiksu", "pl", "anna-nowak", "/author/anna-nowak"],
  ["EN z prefiksem /en", "en", "anna-nowak", "/en/author/anna-nowak"],
  ["PL, slug ze znakami specjalnymi zakodowany", "pl", ODD_SLUG, ODD_PATH],
  ["EN, slug ze znakami specjalnymi zakodowany", "en", ODD_SLUG, `/en${ODD_PATH}`],
];

/** Otwiera kartę osoby i zwraca odnośnik do pełnego profilu. */
function openTeamMemberProfileLink(lang: Lang, slug: string): HTMLElement {
  wrap(
    <TeamMemberWidget
      node={widget("team-member", { name: "Anna Nowak", authorSlug: slug })}
      lang={lang}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Anna Nowak" }));
  return screen.getByRole("link", {
    name: lang === "pl" ? "Zobacz pełny profil eksperta →" : "View full expert profile →",
  });
}

describe("team-member: odnośnik do pełnego profilu eksperta", () => {
  it.each(CASES)("%s", (_label, lang, slug, href) => {
    expect(openTeamMemberProfileLink(lang, slug)).toHaveAttribute("href", href);
  });

  it("klik zostaje w routerze aplikacji (AppLink), bez przeładowania dokumentu", () => {
    const link = openTeamMemberProfileLink("en", "anna-nowak");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(h.navigate).toHaveBeenCalledWith({ href: "/en/author/anna-nowak" });
  });
});

describe("author-profile-card: odnośnik z nazwiska do profilu", () => {
  it.each(CASES)("%s", (_label, lang, slug, href) => {
    wrap(
      <AuthorProfileCardWidget
        node={widget("author-profile-card", { name: "Ewa Nowak", authorSlug: slug })}
        lang={lang}
      />,
    );
    // Karta ma układ desktop i mobile (przełączane CSS) - oba linkują tak samo.
    const links = screen.getAllByRole("link", { name: "Ewa Nowak" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", href);
  });
});

describe("post-meta i post-author-card: odnośnik autora wpisu", () => {
  it.each(CASES)("post-meta - %s", (_label, lang, slug, href) => {
    wrap(
      <DynamicTagWidget
        node={widget("post-meta", { showCategory: false, showDate: false })}
        lang={lang}
      />,
      postWithAuthor({ slug }),
    );
    expect(screen.getByRole("link", { name: /Anna Nowak/ })).toHaveAttribute("href", href);
  });

  it.each(CASES)("post-author-card (karta) - %s", (_label, lang, slug, href) => {
    wrap(
      <DynamicTagWidget node={widget("post-author-card", { showSocial: false })} lang={lang} />,
      postWithAuthor({ slug }),
    );
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toHaveAttribute("href", href);
  });

  it.each(CASES)("post-author-card (inline) - %s", (_label, lang, slug, href) => {
    wrap(
      <DynamicTagWidget
        node={widget("post-author-card", { variant: "inline", showSocial: false })}
        lang={lang}
      />,
      postWithAuthor({ slug }),
    );
    expect(screen.getByRole("link", { name: /Anna Nowak/ })).toHaveAttribute("href", href);
  });

  it("autor bez sluga nie dostaje odnośnika", () => {
    wrap(
      <DynamicTagWidget node={widget("post-author-card", { showSocial: false })} lang="en" />,
      postWithAuthor({ slug: "" }),
    );
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Anna Nowak" })).toBeNull();
  });
});
