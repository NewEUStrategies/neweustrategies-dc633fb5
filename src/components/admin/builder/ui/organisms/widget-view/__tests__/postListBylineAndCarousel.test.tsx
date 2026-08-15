// PostListView: dwie naprawy martwych ustawien.
//
//  1. BYLINE. Ustawienie "Autor" (`authorDisplay` + `authorLabel_*`) bylo
//     oferowane w kazdym wariancie, ale wariant "numbered" nigdy nie rysowal
//     autora - uzytkownik przestawial kontrolke i nic sie nie dzialo. Widok
//     rysuje teraz byline w KAZDYM wariancie, ktory go oferuje, a regula
//     "czy autor jest widoczny" pochodzi z jednej funkcji wspoldzielonej z
//     warstwa zapytania (`postListAuthorDisplay`), nie z lokalnej kopii
//     porownujacej stringi do "0".
//
//  2. KARUZELA. `autoplay` bylo martwe podwojnie (nieedytowalne i
//     niekonsumowane) - karuzela byla czystym scroll-snapem. Teraz autoplay
//     dziala, ma dostepne kontrolki, zatrzymuje sie na hover / fokusie /
//     zadanie uzytkownika i nie rusza przy `prefers-reduced-motion`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Prawdziwe zasoby i18n: bez tego `t()` zwraca GOŁY KLUCZ, a asercje na
// widoczny tekst przechodziły wyłącznie dzięki `defaultValue` wpisanemu przy
// wywołaniu - czyli test sprawdzał kopię napisu z kodu, a nie to, co widzi
// użytkownik. Import wciąga rdzeń słownika (nakładki `i18n-*` dociąga sam
// komponent), więc asercja mierzy teraz wartość ze słownika.
import "@/lib/i18n";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));
const motion = vi.hoisted(() => ({ reduced: false }));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "gte", "lte"])
      b[m] = () => b;
    b.maybeSingle = async () => ({ data: (db.tables[table] ?? [])[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return {
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: async () => ({ data: [], error: null }),
    },
  };
});

// BEZ atrapy `react-i18next`: prawdziwy hak na prawdziwym słowniku (import
// `@/lib/i18n` wyżej). Atrapa zwracała `opts.defaultValue ?? key`, czyli test
// czytał kopię napisu wpisaną w kodzie komponentu, a nie wartość ze słownika -
// po zdjęciu zapasowych tekstów nie miała już czego zwracać. Mockować się jej
// nie da: `@/lib/i18n` sam importuje `react-i18next`, więc atrapa sięgająca po
// słownik zamyka cykl importów i test wisi bez komunikatu.

vi.mock("@/hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => motion.reduced,
}));

import { PostListView } from "../PostListView";
import { POST_LIST_BYLINE_VARIANTS } from "@/lib/builder/postListQuery";
import type { WidgetContent } from "@/lib/builder/types";

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  slug: "wpis",
  title_pl: "Tytuł PL",
  title_en: "Title EN",
  excerpt_pl: "Zajawka PL",
  excerpt_en: "Excerpt EN",
  cover_image_url: "https://cdn.example.com/cover.jpg",
  published_at: "2026-01-01T00:00:00Z",
  post_format: null,
  author_id: "a1",
  author_display_name: "Anna Autorka",
  author_avatar_url: null,
  author_slug: "anna",
  ...over,
});

beforeEach(() => {
  db.tables = {};
  motion.reduced = false;
});
afterEach(cleanup);

describe("PostListView - byline w kazdym wariancie, ktory go oferuje", () => {
  it("wariant numbered rysuje autora zamiast po cichu ignorowac ustawienie", async () => {
    db.tables.posts = [post({ id: "n1" })];
    wrap(<PostListView c={{ variant: "numbered", authorDisplay: "avatar" }} lang="pl" />);
    expect(await screen.findByText("Anna Autorka")).toBeInTheDocument();
  });

  it("wariant numbered honoruje tryb etykiety i wlasny tekst etykiety", async () => {
    db.tables.posts = [post({ id: "n2" })];
    wrap(
      <PostListView
        c={{ variant: "numbered", authorDisplay: "label", authorLabel_pl: "Pisze" }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Pisze:")).toBeInTheDocument();
    expect(screen.getByText("Anna Autorka")).toBeInTheDocument();
  });

  it("wariant numbered z authorDisplay=none nie rysuje autora", async () => {
    db.tables.posts = [post({ id: "n3" })];
    wrap(<PostListView c={{ variant: "numbered", authorDisplay: "none" }} lang="pl" />);
    expect(await screen.findByText("Tytuł PL")).toBeInTheDocument();
    expect(screen.queryByText("Anna Autorka")).toBeNull();
  });

  it.each(POST_LIST_BYLINE_VARIANTS)("wariant %s rysuje byline", async (variant) => {
    db.tables.posts = [post({ id: `v-${variant}` })];
    const view = wrap(<PostListView c={{ variant, authorDisplay: "avatar" }} lang="pl" />);
    expect((await screen.findAllByText("Anna Autorka")).length).toBeGreaterThan(0);
    view.unmount();
  });

  it("stare tresci z showAuthorAvatar/showAuthorLabel = '0' chowaja autora", async () => {
    db.tables.posts = [post({ id: "legacy" })];
    wrap(
      <PostListView
        c={{ variant: "card", showAuthorAvatar: "0", showAuthorLabel: "0" }}
        lang="pl"
      />,
    );
    expect(await screen.findByText("Tytuł PL")).toBeInTheDocument();
    expect(screen.queryByText("Anna Autorka")).toBeNull();
  });

  it("stare tresci z samym showAuthorAvatar='0' degraduja do trybu etykiety", async () => {
    db.tables.posts = [post({ id: "legacy2" })];
    wrap(<PostListView c={{ variant: "card", showAuthorAvatar: "0" }} lang="pl" />);
    expect(await screen.findByText("Autor:")).toBeInTheDocument();
  });
});

describe("PostListView - karuzela z autoodtwarzaniem", () => {
  const scrollTo = vi.fn();

  beforeEach(() => {
    scrollTo.mockClear();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const rows = [post({ id: "c1" }), post({ id: "c2" }), post({ id: "c3" })];

  const renderCarousel = (c: WidgetContent) => {
    db.tables.posts = rows;
    return wrap(<PostListView c={{ limit: 8, ...c }} lang="pl" carousel />);
  };

  const tick = async (ms: number) => {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  };

  it("bez autoplay nie renderuje kontrolek i nie przewija sama", async () => {
    const { container } = renderCarousel({});
    await waitFor(() => expect(container.querySelectorAll("a").length).toBe(3));
    expect(screen.queryByLabelText("Zatrzymaj automatyczne przewijanie")).toBeNull();
    await tick(30_000);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("z autoplay przewija tor w zadanym tempie", async () => {
    const { container } = renderCarousel({ autoplay: true, autoplayIntervalMs: 2000 });
    await waitFor(() => expect(container.querySelectorAll("a").length).toBe(3));
    expect(scrollTo).not.toHaveBeenCalled();
    await tick(2000);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await tick(4000);
    expect(scrollTo).toHaveBeenCalledTimes(3);
  });

  it("honoruje historyczny zapis autoplay='on' ze starego schematu", async () => {
    const { container } = renderCarousel({ autoplay: "on", autoplayIntervalMs: 2000 });
    await waitFor(() => expect(container.querySelectorAll("a").length).toBe(3));
    await tick(2000);
    expect(scrollTo).toHaveBeenCalled();
  });

  it("zatrzymuje sie na najechaniu i wraca po zjechaniu kursorem", async () => {
    const { container } = renderCarousel({ autoplay: true, autoplayIntervalMs: 1500 });
    const track = await waitFor(() => {
      const el = container.querySelector<HTMLElement>("[data-autoplay]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const shell = track.parentElement as HTMLElement;

    fireEvent.mouseEnter(shell);
    expect(track.getAttribute("data-autoplay")).toBe("paused");
    await tick(6000);
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.mouseLeave(shell);
    expect(track.getAttribute("data-autoplay")).toBe("running");
    await tick(1500);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("zatrzymuje sie, gdy fokus klawiatury wejdzie w tor", async () => {
    const { container } = renderCarousel({ autoplay: true, autoplayIntervalMs: 1500 });
    const track = await waitFor(() => {
      const el = container.querySelector<HTMLElement>("[data-autoplay]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.focus(track);
    expect(track.getAttribute("data-autoplay")).toBe("paused");
    await tick(6000);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("przycisk pauzy zatrzymuje ruch i zmienia etykiete na wznowienie", async () => {
    renderCarousel({ autoplay: true, autoplayIntervalMs: 1500 });
    const pause = await screen.findByLabelText("Zatrzymaj automatyczne przewijanie");
    expect(pause).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(pause);
    await tick(6000);
    expect(scrollTo).not.toHaveBeenCalled();

    const play = screen.getByLabelText("Wznów automatyczne przewijanie");
    expect(play).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(play);
    await tick(1500);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("kontrolki poprzedni/nastepny przewijaja recznie w obie strony", async () => {
    renderCarousel({ autoplay: true, autoplayIntervalMs: 30_000 });
    fireEvent.click(await screen.findByLabelText("Następny wpis"));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText("Poprzedni wpis"));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("nie rusza przy prefers-reduced-motion, mimo wlaczonego autoplay", async () => {
    motion.reduced = true;
    const { container } = renderCarousel({ autoplay: true, autoplayIntervalMs: 1500 });
    const track = await waitFor(() => {
      const el = container.querySelector<HTMLElement>("[data-autoplay]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(track.getAttribute("data-autoplay")).toBe("paused");
    await tick(9000);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("pojedynczy slajd nie dostaje kontrolek (nie ma czego przewijac)", async () => {
    db.tables.posts = [post({ id: "solo" })];
    wrap(<PostListView c={{ limit: 8, autoplay: true }} lang="pl" carousel />);
    expect(await screen.findByText("Tytuł PL")).toBeInTheDocument();
    expect(screen.queryByLabelText("Następny wpis")).toBeNull();
  });

  it("dziala tez bez Element.scrollTo (fallback na scrollLeft)", async () => {
    const proto = HTMLElement.prototype as unknown as { scrollTo?: unknown };
    const original = proto.scrollTo;
    delete proto.scrollTo;
    try {
      renderCarousel({ autoplay: true, autoplayIntervalMs: 1500 });
      const next = await screen.findByLabelText("Następny wpis");
      expect(() => fireEvent.click(next)).not.toThrow();
    } finally {
      proto.scrollTo = original;
    }
  });
});
