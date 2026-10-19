// Odnośniki do profilu autora w widgetach z listą osób albo wpisów: speakers
// (źródło „baza"), slider (wszystkie warianty bylinu) i tailored-must-reads.
//
// Co udowadniamy i dlaczego:
//   * Adres budują te same pomocniki co reszta aplikacji (od K2 także
//     team-member, author-profile-card i widgety wpisu): `profileHref`
//     (ścieżka `/author/<slug>` z zakodowanym slugiem) i `localizedPath`
//     (prefiks języka TREŚCI widgetu). Wcześniej te widgety sklejały
//     `/author/${slug}`: na stronie EN odnośnik prowadził do profilu PL, a slug
//     ze znakami specjalnymi („/", „?", „#", spacja) rozcinał ścieżkę albo
//     doklejał zapytanie i kotwicę. tailored-must-reads miał już prefiks, ale
//     bez kodowania sluga.
//   * Adres wpisany ręcznie przez redaktora (pole „Adres" prelegenta) zostaje
//     nietknięty - pomocniki dotyczą wyłącznie profilu budowanego ze sluga.
//
// Granice: klient Supabase -> atrapa odpowiadająca na wywołania RPC i odczyt
// `profiles_public` (dane z bazy); router -> atrapa z `navigate`/`preloadRoute`
// (tyle woła AppLink i slider); sesja (`useAuth`) -> zalogowany użytkownik;
// detektor ciszy strony bramki ruchu -> wyłączony (autoplay i tak stoi).
// Widgety, zapytania, AppLink, AuthorByline i pomocniki ścieżek są prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

const h = vi.hoisted(() => ({
  speakers: [] as unknown[],
  recommended: [] as unknown[],
  authors: [] as unknown[],
  user: { id: "u-1" } as null | { id: string },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    navigate: () => Promise.resolve(),
    preloadRoute: () => Promise.resolve(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "not", "order", "range", "limit"]) {
      b[m] = () => b;
    }
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: table === "profiles_public" ? h.authors : [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: async (fn: string) => ({
        data:
          fn === "get_public_speakers"
            ? h.speakers
            : fn === "get_recommended_posts_v2"
              ? h.recommended
              : [],
        error: null,
      }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, loading: false }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/performance/whenQuiescent", () => ({ onQuiescent: () => () => {} }));

import { SpeakersWidget } from "../SpeakersWidget";
import { TailoredMustReadsView } from "../TailoredMustReadsView";
import { SliderRender, SLIDER_VARIANT_VALUES, type SliderItem } from "@/lib/builder/sliderVariants";

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

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function speakersNode(content: Record<string, unknown>): WidgetNode {
  return {
    id: "speakers-t",
    kind: "widget",
    type: "speakers",
    content: content as unknown as WidgetContent,
  };
}

beforeEach(() => {
  h.speakers = [];
  h.recommended = [];
  h.authors = [];
  h.user = { id: "u-1" };
  window.localStorage.clear();
});

afterEach(cleanup);

describe("speakers (źródło „baza”): karta prowadzi do profilu prelegenta", () => {
  it.each(CASES)("%s", async (_label, lang, slug, href) => {
    h.speakers = [{ user_id: "u-anna", display_name: "Anna Nowak", slug }];
    // Bez dialogu profilu karta jest odnośnikiem - to jego adres sprawdzamy.
    wrap(
      <SpeakersWidget
        node={speakersNode({ source: "directory", openProfile: false })}
        lang={lang}
      />,
    );
    expect(await screen.findByRole("link", { name: "Anna Nowak" })).toHaveAttribute("href", href);
  });

  it("prelegent bez sluga nie dostaje odnośnika", async () => {
    h.speakers = [{ user_id: "u-anna", display_name: "Anna Nowak", slug: "" }];
    wrap(
      <SpeakersWidget node={speakersNode({ source: "directory", openProfile: false })} lang="en" />,
    );
    expect(await screen.findByText("Anna Nowak")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Anna Nowak" })).toBeNull();
  });

  it("adres wpisany ręcznie przez redaktora zostaje taki, jak go podał (także w EN)", () => {
    wrap(
      <SpeakersWidget
        node={speakersNode({
          speakers: [
            { id: "m1", name: "Jan Ręczny", href: "/prelegenci/jan" },
            { id: "m2", name: "Ewa Zewnętrzna", href: "https://example.com/ewa?ref=nes" },
          ],
        })}
        lang="en"
      />,
    );
    expect(screen.getByRole("link", { name: "Jan Ręczny" })).toHaveAttribute(
      "href",
      "/prelegenci/jan",
    );
    expect(screen.getByRole("link", { name: "Ewa Zewnętrzna" })).toHaveAttribute(
      "href",
      "https://example.com/ewa?ref=nes",
    );
  });
});

describe("speakers (źródło „baza”): dialog profilu prowadzi do pełnego profilu", () => {
  // Domyślnie (`openProfile` nie wyłączone) klik w kartę otwiera dialog
  // profilu - jego odnośnik „pełny profil” jest wtedy JEDYNĄ drogą czytelnika
  // na stronę prelegenta. Sklejany `/author/${slug}` gubił prefiks /en i nie
  // kodował sluga, choć sama karta (bez dialogu) była już poprawna.
  it.each(CASES)("%s", async (_label, lang, slug, href) => {
    h.speakers = [{ user_id: "u-anna", display_name: "Anna Nowak", slug }];
    wrap(<SpeakersWidget node={speakersNode({ source: "directory" })} lang={lang} />);
    fireEvent.click(await screen.findByRole("button", { name: /Anna Nowak/ }));
    const fullProfile = await screen.findByRole("link", {
      name: lang === "pl" ? /Zobacz pełny profil/ : /View full profile/,
    });
    expect(fullProfile).toHaveAttribute("href", href);
  });
});

describe("slider: byline autora slajdu w każdym wariancie", () => {
  const slide = (authorSlug: string | undefined): SliderItem => ({
    image: "https://cdn.example.com/1.jpg",
    title_pl: "Tytuł slajdu",
    title_en: "Slide title",
    author: "Anna Nowak",
    authorSlug,
  });

  const renderSlider = (
    variant: (typeof SLIDER_VARIANT_VALUES)[number],
    lang: Lang,
    slug?: string,
  ) =>
    wrap(<SliderRender config={{ variant, items: [slide(slug)], autoplay: false }} lang={lang} />);

  describe.each(SLIDER_VARIANT_VALUES)("wariant %s", (variant) => {
    it.each(CASES)("%s", (_label, lang, slug, href) => {
      renderSlider(variant, lang, slug);
      const links = screen.getAllByRole("link", { name: /Anna Nowak/ });
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) expect(link).toHaveAttribute("href", href);
    });

    it("autor bez sluga nie dostaje odnośnika", () => {
      renderSlider(variant, "en", undefined);
      expect(screen.getAllByText("Anna Nowak").length).toBeGreaterThan(0);
      expect(screen.queryByRole("link", { name: /Anna Nowak/ })).toBeNull();
    });
  });
});

describe("tailored-must-reads: byline autora polecanego wpisu", () => {
  it.each(CASES)("%s", async (_label, lang, slug, href) => {
    h.recommended = [
      {
        id: "p1",
        slug: "analiza-cee",
        title_pl: "Analiza CEE",
        title_en: "CEE analysis",
        author_id: "a1",
      },
    ];
    h.authors = [{ id: "a1", display_name: "Igor Autor", slug, avatar_url: null }];
    wrap(<TailoredMustReadsView c={{} as WidgetContent} lang={lang} />);
    expect(await screen.findByRole("link", { name: /Igor Autor/ })).toHaveAttribute("href", href);
  });
});
