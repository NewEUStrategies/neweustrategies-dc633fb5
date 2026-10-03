// KARTA WPISU NA LIŚCIE - tytuł, okładka z morphem, oznaczenie i pomiar klików.
//
// CO DOWODZI TEN PLIK. Karta stoi na blogu, w archiwach, wynikach wyszukiwania
// i liście zapisanych, a jej trzy zachowania nie miały wykonania:
//   * morph okładki (View Transitions) nazywa okładkę DOPIERO na intencję
//     (najechanie, fokus, dotyk) i zdejmuje nazwę, gdy intencja odchodzi -
//     dwadzieścia nazwanych kart naraz to dwadzieścia warstw przejścia;
//     czytelnik z `prefers-reduced-motion` nie dostaje morphu wcale;
//   * klik raportuje konwersję strategii z łańcuchem identyfikatorów
//     `strategyId` -> `viewTransitionId` -> `href`;
//   * tytuł i zajawka idą za językiem z odwrotem do drugiego języka.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ track: vi.fn() }));

type AnchorProps = { children: ReactNode; className?: string } & Record<string, unknown>;

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: AnchorProps & { to: string }) => (
    <a data-kind="router" href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/atoms/AppLink", () => ({
  AppLink: ({ href, children, ...rest }: AnchorProps & { href: string }) => (
    <a data-kind="app" href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/atoms/OptimizedImage", () => ({
  OptimizedImage: ({ src, alt, style }: { src: string; alt: string; style?: object }) => (
    <img src={src} alt={alt} style={style} />
  ),
}));
vi.mock("@/lib/analytics/conversions", () => ({ trackStrategyConversion: h.track }));

import { PostListCard } from "../PostListCard";

const POST = {
  title_pl: "Unia i NATO",
  title_en: "EU and NATO",
  excerpt_pl: "Zajawka PL",
  excerpt_en: null,
  cover_image_url: "https://cdn.example.com/okladka.jpg",
  published_at: "2026-03-05T10:00:00Z",
  is_sponsored: false,
  sponsored_kind: null,
  sponsored_affiliate: false,
};

beforeEach(() => {
  h.track.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cover = () => screen.getByRole("img") as HTMLImageElement;

describe("PostListCard - treść", () => {
  it("po polsku: tytuł, zajawka i data; link routera domyślnie", () => {
    render(<PostListCard post={POST} href="/blog/unia" lang="pl" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("data-kind")).toBe("router");
    expect(link.getAttribute("href")).toBe("/blog/unia");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Unia i NATO");
    expect(screen.getByText("Zajawka PL")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Unia i NATO" })).toBeTruthy();
    expect(link.querySelector("time")).not.toBeNull();
  });

  it("po angielsku bez zajawki EN nie pokazuje polskiej; brak tytułu EN - odwrót do PL", () => {
    render(<PostListCard post={{ ...POST, title_en: "" }} href="/en/blog/unia" lang="en" />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Unia i NATO");
    expect(screen.queryByText("Zajawka PL")).toBeNull();
  });

  it("zamiennik zajawki (fragment trafienia wyszukiwarki) wygrywa", () => {
    render(
      <PostListCard
        post={POST}
        href="/blog/unia"
        lang="pl"
        excerptOverride={<mark>trafienie</mark>}
        link="app"
      />,
    );
    expect(screen.getByText("trafienie").tagName).toBe("MARK");
    expect(screen.queryByText("Zajawka PL")).toBeNull();
    expect(screen.getByRole("link").getAttribute("data-kind")).toBe("app");
  });

  it("bez okładki i daty karta nie rysuje pustych elementów", () => {
    render(
      <PostListCard
        post={{ ...POST, cover_image_url: null, published_at: null }}
        href="/blog/unia"
        lang="pl"
      />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("link").querySelector("time")).toBeNull();
  });
});

describe("PostListCard - morph okładki tylko na intencję", () => {
  it("nazwa przejścia pojawia się po najechaniu i znika po zjechaniu", () => {
    render(<PostListCard post={POST} href="/blog/unia" lang="pl" viewTransitionId="p42" />);
    expect(cover().style.getPropertyValue("view-transition-name")).toBe("");
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(cover().style.viewTransitionName).toBe("post-cover-p42");
    fireEvent.mouseLeave(screen.getByRole("link"));
    expect(cover().style.viewTransitionName ?? "").toBe("");
  });

  it("fokus i dotyk też uzbrajają, utrata fokusu rozbraja", () => {
    render(<PostListCard post={POST} href="/blog/unia" lang="pl" viewTransitionId="p42" />);
    fireEvent.pointerDown(screen.getByRole("link"));
    expect(cover().style.viewTransitionName).toBe("post-cover-p42");
    // Drugie uzbrojenie przy uzbrojonej karcie niczego nie zmienia.
    fireEvent.focus(screen.getByRole("link"));
    expect(cover().style.viewTransitionName).toBe("post-cover-p42");
    fireEvent.blur(screen.getByRole("link"));
    expect(cover().style.viewTransitionName ?? "").toBe("");
  });

  it("czytelnik z `prefers-reduced-motion` nie dostaje morphu", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
    }));
    render(<PostListCard post={POST} href="/blog/unia" lang="pl" viewTransitionId="p42" />);
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(cover().style.viewTransitionName ?? "").toBe("");
  });

  it("bez `viewTransitionId` karta nie ma czego nazywać", () => {
    render(<PostListCard post={POST} href="/blog/unia" lang="pl" />);
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(cover().style.viewTransitionName ?? "").toBe("");
  });
});

describe("PostListCard - pomiar kliknięcia", () => {
  it("klik raportuje strategię, adres, tytuł, miejsce i język", () => {
    render(
      <PostListCard
        post={POST}
        href="/blog/unia"
        lang="pl"
        strategyId="rec-7"
        placement="related"
      />,
    );
    fireEvent.click(screen.getByRole("link"));
    expect(h.track).toHaveBeenCalledWith({
      strategyId: "rec-7",
      href: "/blog/unia",
      title: "Unia i NATO",
      placement: "related",
      lang: "pl",
    });
  });

  it("bez strategii identyfikatorem jest id wpisu, a bez niego - adres", () => {
    const { unmount } = render(
      <PostListCard post={POST} href="/blog/unia" lang="pl" viewTransitionId="p42" />,
    );
    fireEvent.click(screen.getByRole("link"));
    expect(h.track).toHaveBeenLastCalledWith(
      expect.objectContaining({ strategyId: "p42", placement: "post_list" }),
    );
    unmount();

    render(<PostListCard post={POST} href="/blog/unia" lang="pl" />);
    fireEvent.click(screen.getByRole("link"));
    expect(h.track).toHaveBeenLastCalledWith(expect.objectContaining({ strategyId: "/blog/unia" }));
  });
});
