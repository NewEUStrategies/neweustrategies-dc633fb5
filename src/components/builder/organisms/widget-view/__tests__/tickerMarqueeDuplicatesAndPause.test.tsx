// Paski „news-ticker" i „trending-now": duplikaty toru, pauza i unikalność.
//
// Co udowadniamy i dlaczego:
//   * Pętla marquee dubluje kafelki (poziomo cały tor, pionowo pierwszy wpis na
//     końcu). Duplikat jest DEKORACJĄ: czytnik ekranu nie może ogłaszać każdego
//     nagłówka dwa razy, a klawiatura nie może trafiać w niewidoczne kopie
//     (axe: aria-hidden-focus). Przed 2026-10-18 poziomy news-ticker nie ukrywał
//     drugiej kopii wcale, a pionowy ukrywał opakowanie, zostawiając link
//     w kolejności Tab. Teraz kopie są `aria-hidden` + `inert`.
//   * „Pauza po najechaniu" zatrzymuje animację toru i wznawia ją po zjechaniu;
//     wyłączona - tor jedzie dalej.
//   * „Unikalne na stronie": wpisy pokazane już przez wcześniejsze widgety
//     (rejestr UsedPostIds) są pomijane, a własne wiersze trafiają do rejestru.
//   * Prędkość z panelu jako tekst ("25") jest czytana jak liczba, a spoza
//     zakresu - przycinana do 10..180 s.
//
// Granice: `newsTickerQueryOptions` -> stałe wiersze (zapytanie to osobny
// moduł z własnymi testami), react-i18next -> echo klucza/`defaultValue`.
// Rejestr UsedPostIds, AppLink i same widoki są prawdziwe.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import type { WidgetContent } from "@/lib/builder/types";
import type { TickerPost } from "@/lib/builder/newsTickerQuery";

const rows = vi.hoisted(() => ({ list: [] as TickerPost[] }));

vi.mock("@/lib/builder/newsTickerQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/builder/newsTickerQuery")>()),
  newsTickerQueryOptions: (c: unknown, lang: string) => ({
    queryKey: ["ticker-test", JSON.stringify(c), lang],
    queryFn: async () => rows.list,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

import { NewsTickerView } from "../NewsTickerView";
import { TrendingNowView } from "../TrendingNowView";
import { UsedPostIdsProvider, useUsedPostIds } from "@/lib/builder/usedPostIds";

function post(i: number): TickerPost {
  return {
    id: `p${i}`,
    slug: `wpis-${i}`,
    title_pl: `Wpis ${i}`,
    title_en: null,
    author_id: null,
    author_display_name: null,
    author_avatar_url: null,
  };
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/** Wcześniejszy widget na stronie, który już pokazał podane wpisy. */
function EarlierWidget({ ids }: { ids: string[] }) {
  const used = useUsedPostIds();
  useEffect(() => {
    used.register(ids);
  }, [used, ids]);
  return null;
}

afterEach(() => {
  cleanup();
  rows.list = [];
});

describe("news-ticker poziomy", () => {
  it("każdy nagłówek jest dostępny raz; druga kopia toru jest aria-hidden i inert", async () => {
    rows.list = [post(1), post(2), post(3)];
    const { container } = wrap(
      <NewsTickerView c={{ direction: "horizontal" } as WidgetContent} lang="pl" />,
    );
    await screen.findAllByRole("link", { name: "Wpis 1" });
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Wpis 1",
      "Wpis 2",
      "Wpis 3",
    ]);
    const all = [...container.querySelectorAll("a")];
    expect(all).toHaveLength(6);
    for (const dup of all.slice(3)) {
      const shell = dup.closest("[aria-hidden='true']");
      expect(shell).not.toBeNull();
      expect(shell?.hasAttribute("inert")).toBe(true);
    }
    for (const real of all.slice(0, 3)) expect(real.closest("[inert]")).toBeNull();
  });

  it("prędkość z panelu jako tekst jest liczbą; pauza po najechaniu zatrzymuje tor", async () => {
    rows.list = [post(1), post(2), post(3)];
    const { container } = wrap(
      <NewsTickerView
        c={{ direction: "horizontal", speedSeconds: "25" } as WidgetContent}
        lang="en"
      />,
    );
    await screen.findAllByRole("link", { name: "Wpis 1" });
    const track = container.querySelector("[data-motion-loop]") as HTMLElement;
    expect(track.style.animation).toContain("25s");
    fireEvent.mouseEnter(track);
    expect(track.style.animationPlayState).toBe("paused");
    fireEvent.mouseLeave(track);
    expect(track.style.animationPlayState).toBe("running");
  });

  it("wyłączona pauza nie zatrzymuje toru; prędkość spoza zakresu jest przycinana", async () => {
    rows.list = [post(1), post(2), post(3)];
    const { container } = wrap(
      <NewsTickerView
        c={{ direction: "horizontal", pauseOnHover: false, speedSeconds: 999 } as WidgetContent}
        lang="pl"
      />,
    );
    await screen.findAllByRole("link", { name: "Wpis 1" });
    const track = container.querySelector("[data-motion-loop]") as HTMLElement;
    expect(track.style.animation).toContain("180s");
    fireEvent.mouseEnter(track);
    expect(track.style.animationPlayState).toBe("running");
  });
});

describe("news-ticker pionowy", () => {
  it("dopisany na końcu duplikat pierwszego wpisu nie jest w drzewie dostępności ani w Tab", async () => {
    rows.list = [post(1), post(2), post(3)];
    const { container } = wrap(<NewsTickerView c={{} as WidgetContent} lang="pl" />);
    await screen.findByRole("link", { name: /Wpis 1/ });
    expect(screen.getAllByRole("link")).toHaveLength(3);
    const all = [...container.querySelectorAll("a")];
    expect(all).toHaveLength(4);
    const dup = all[3].closest("[aria-hidden='true']");
    expect(dup?.hasAttribute("inert")).toBe(true);
    expect(all[3].getAttribute("href")).toBe(all[0].getAttribute("href"));
  });

  it("pauza po najechaniu na tor pionowy", async () => {
    rows.list = [post(1), post(2), post(3)];
    const { container } = wrap(<NewsTickerView c={{} as WidgetContent} lang="pl" />);
    await screen.findByRole("link", { name: /Wpis 1/ });
    const track = container.querySelector("div[data-motion-loop]") as HTMLElement;
    fireEvent.mouseEnter(track);
    expect(track.style.animationPlayState).toBe("paused");
    fireEvent.mouseLeave(track);
    expect(track.style.animationPlayState).toBe("running");
  });
});

describe("unikalne na stronie (UsedPostIds)", () => {
  it("news-ticker pomija wpisy pokazane już wyżej", async () => {
    rows.list = [post(1), post(2), post(3), post(4)];
    wrap(
      <UsedPostIdsProvider>
        <EarlierWidget ids={["p1", "p3"]} />
        <NewsTickerView c={{ uniqueOnPage: true } as WidgetContent} lang="pl" />
      </UsedPostIdsProvider>,
    );
    await screen.findByRole("link", { name: /Wpis 2/ });
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/post/wpis-2",
      "/post/wpis-4",
    ]);
  });

  it("trending-now pomija wpisy pokazane wyżej i rejestruje własne dla kolejnych widgetów", async () => {
    rows.list = [post(1), post(2), post(3), post(4)];
    let registry: ReturnType<typeof useUsedPostIds> | null = null;
    function Probe() {
      registry = useUsedPostIds();
      return null;
    }
    wrap(
      <UsedPostIdsProvider>
        <EarlierWidget ids={["p2"]} />
        <TrendingNowView c={{ uniqueOnPage: true } as WidgetContent} lang="pl" />
        <Probe />
      </UsedPostIdsProvider>,
    );
    await screen.findByRole("link", { name: /Wpis 1/ });
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/post/wpis-1",
      "/post/wpis-3",
      "/post/wpis-4",
    ]);
    expect(registry!.getSnapshot()).toEqual(expect.arrayContaining(["p1", "p2", "p3", "p4"]));
  });
});

describe("trending-now", () => {
  it("pauza po najechaniu działa tylko, gdy jest włączona", async () => {
    rows.list = [post(1), post(2)];
    const first = wrap(<TrendingNowView c={{} as WidgetContent} lang="pl" />);
    await screen.findByRole("link", { name: /Wpis 1/ });
    const track = first.container.querySelector("[data-motion-loop]") as HTMLElement;
    fireEvent.mouseEnter(track);
    expect(track.style.animationPlayState).toBe("paused");
    fireEvent.mouseLeave(track);
    expect(track.style.animationPlayState).toBe("running");
    first.unmount();

    const second = wrap(<TrendingNowView c={{ pauseOnHover: false } as WidgetContent} lang="pl" />);
    await screen.findByRole("link", { name: /Wpis 1/ });
    const track2 = second.container.querySelector("[data-motion-loop]") as HTMLElement;
    fireEvent.mouseEnter(track2);
    expect(track2.style.animationPlayState).toBe("");
  });

  it("pojedynczy wpis nie animuje się i nie dostaje duplikatu", async () => {
    rows.list = [post(1)];
    const { container } = wrap(<TrendingNowView c={{} as WidgetContent} lang="pl" />);
    await screen.findByRole("link", { name: /Wpis 1/ });
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("[data-motion-loop]")).toBeNull();
  });
});
