// PostOverlayMeta - warianty danych autora i czasu czytania, których nie
// dotyka `postComposition.test.tsx`.
//
// Nakładka stoi na okładce KAŻDEGO wpisu w układach overlay, a dane autora
// przychodzą z profili wypełnianych ręcznie: bez zdjęcia, z samym nickiem albo
// zupełnie puste. Każdy z tych stanów musi dać czytelny podpis - nie pusty
// link, nie podwójny czas czytania na wąskim ekranie.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { freezeClock } from "@/test/time";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ preloadRoute: vi.fn(), navigate: vi.fn() }),
}));
// Widżet czasu czytania liczy z kontekstu wpisu i ustawień - ma własne testy.
// Tu liczy się wyłącznie to, CZY i W JAKIM opakowaniu nakładka go stawia.
vi.mock("@/components/blocks/PostUtilityViews", () => ({
  ReadingTimeView: ({ lang }: { lang: string }) => (
    <span data-testid="reading-time-widget" data-lang={lang} />
  ),
}));

import { PostOverlayMeta } from "@/components/post/PostOverlayMeta";

freezeClock();

const base = {
  id: "a-1",
  slug: "anna-nowak",
  display_name: null,
  first_name: "Anna",
  last_name: "Nowak",
  avatar_url: null,
};

afterEach(() => {
  cleanup();
});

describe("PostOverlayMeta - podpis autora", () => {
  it("nazwa wyświetlana wygrywa z imieniem i nazwiskiem", () => {
    render(
      <PostOverlayMeta
        lang="pl"
        author={{ ...base, display_name: "dr Anna Nowak-Kowalska" }}
        publishedAt={null}
        readMinutes={3}
      />,
    );
    expect(screen.getByRole("link", { name: "dr Anna Nowak-Kowalska" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    expect(screen.queryByText("Anna Nowak")).toBeNull();
  });

  it("profil BEZ żadnego imienia dostaje neutralny podpis w języku wpisu", () => {
    const anonymous = { ...base, slug: null, first_name: null, last_name: null };
    const { rerender } = render(
      <PostOverlayMeta lang="pl" author={anonymous} publishedAt={null} readMinutes={3} />,
    );
    expect(screen.getByText("Autor", { selector: ".font-medium" })).toBeInTheDocument();

    rerender(<PostOverlayMeta lang="en" author={anonymous} publishedAt={null} readMinutes={3} />);
    expect(screen.getByText("Author", { selector: ".font-medium" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("autor BEZ zdjęcia: ikona zastępcza zamiast pustego obrazka, link do profilu zostaje", () => {
    const { container } = render(
      <PostOverlayMeta lang="pl" author={base} publishedAt={null} readMinutes={3} />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // Jeden link (nazwisko) - bez zdjęcia nie ma drugiego, avatarowego.
    expect(screen.getAllByRole("link", { name: "Anna Nowak" })).toHaveLength(1);
  });

  it("zdjęcie autora bez profilu publicznego nie jest linkiem, ale ma podpis alternatywny", () => {
    render(
      <PostOverlayMeta
        lang="pl"
        author={{ ...base, slug: null, avatar_url: "https://cdn.nes/a.png" }}
        publishedAt={null}
        readMinutes={3}
      />,
    );
    expect(screen.getByRole("img", { name: "Anna Nowak" })).toHaveAttribute("loading", "lazy");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("PostOverlayMeta - data i czas czytania", () => {
  it("data publikacji w zapisie europejskim także w wariancie angielskim", () => {
    const { container } = render(
      <PostOverlayMeta
        lang="en"
        author={null}
        publishedAt="2026-08-01T10:00:00Z"
        readMinutes={3}
      />,
    );
    expect(container.querySelector("time")).toHaveTextContent("01/08/2026");
    expect(container.textContent).toContain("Published:");
  });

  it("czas czytania z wpisu ukryty na mobile, gdy pasek Quick View pokazuje go pod okładką", () => {
    render(
      <PostOverlayMeta
        lang="pl"
        author={null}
        publishedAt={null}
        readMinutes={12}
        hideReadTimeOnMobile
      />,
    );
    const readTime = screen.getByText("12 min czytania").parentElement;
    expect(readTime?.className).toContain("hidden sm:inline-flex");
    expect(screen.queryByTestId("reading-time-widget")).toBeNull();
  });

  it("bez minut z wpisu stawia widżet czasu czytania - na mobile także ukryty, gdy trzeba", () => {
    const { rerender } = render(
      <PostOverlayMeta
        lang="en"
        author={null}
        publishedAt={null}
        readMinutes={0}
        hideReadTimeOnMobile
      />,
    );
    expect(screen.getByTestId("reading-time-widget").parentElement?.className).toBe(
      "hidden sm:inline-flex",
    );

    rerender(<PostOverlayMeta lang="en" author={null} publishedAt={null} readMinutes={null} />);
    expect(screen.getByTestId("reading-time-widget").parentElement?.className).not.toContain(
      "hidden",
    );
    expect(screen.getByTestId("reading-time-widget")).toHaveAttribute("data-lang", "en");
  });
});
