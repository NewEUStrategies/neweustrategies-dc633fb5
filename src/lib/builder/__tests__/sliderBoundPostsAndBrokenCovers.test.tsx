// SLIDER: SLAJDY ZWIĄZANE Z WPISEM, MARTWE OKŁADKI I POMIAR KOLUMN BEZ
// ResizeObserver.
//
// Co ten plik udowadnia:
//
// 1. WIĄZANIE SLAJDU Z WPISEM. Slajd z `postId` bierze z wpisu okładkę,
//    adres, autora, tytuł i zajawkę - ale WYŁĄCZNIE tam, gdzie redaktor nic
//    nie wpisał (pole puste albo same spacje). Ręczny tytuł wygrywa z tytułem
//    wpisu; klucz językowy jest wybierany po `lang`, więc wersja EN wpisu nie
//    nadpisuje polskiego slajdu. Do warstwy danych idzie lista identyfikatorów
//    w kolejności slajdów, z `null` dla slajdów ręcznych.
// 2. ŁAŃCUCH ZASTĘPSTW OKŁADKI. Błąd ładowania okładki przełącza obraz na
//    okładkę-fallback z ostatnich wpisów, a drugi błąd - na wbudowany obrazek
//    SVG; martwy adres zapamiętuje cały slider, więc miniatura minimal-strip
//    nie pobiera go drugi raz.
// 3. POMIAR KOLUMN BEZ ResizeObserver. Środowisko bez tego API (stare
//    przeglądarki, część WebView) mierzy kontener raz przy montażu - karuzela
//    multi-card ma wtedy tyle kroków, ile wynika ze zmierzonej szerokości.
//
// GRANICE I ATRAPY
//  * `useResolvedPostRefs` (warstwa danych wpisów) jest atrapą ze szpiegiem -
//    jego zapytania mają własne testy; tu liczy się, co renderer z wynikiem
//    robi i o co pyta.
//  * Supabase odpowiada na `posts` listą okładek-fallbacków; zapytanie ma
//    własny klucz cache, więc każdy test dostaje świeżego klienta zapytań.
//  * Stan ładowania obrazu (`complete`/`naturalWidth`) jest JAWNIE łatany na
//    „wczytany", bo happy-dom nie pobiera obrazów, a od 20.14 startuje z
//    kombinacją, którą renderer czyta jako martwą okładkę.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";
import type { PostRefData } from "@/lib/builder/contentRefs";
import { WIDGET_QUERY_ROOTS } from "@/lib/builder/queryKeys";

const refs = vi.hoisted(() => ({
  map: new Map<string, PostRefData>(),
  calls: [] as Array<{ ids: ReadonlyArray<string | null | undefined>; lang: string }>,
  fallbackCovers: [] as Array<{ cover_image_url: string | null }>,
}));

vi.mock("@/lib/builder/contentRefs", () => ({
  useResolvedPostRefs: (ids: ReadonlyArray<string | null | undefined>, lang: string) => {
    refs.calls.push({ ids, lang });
    return refs.map;
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => null,
  Link: (p: { children?: ReactNode }) => <>{p.children}</>,
}));
vi.mock("@/lib/theme/carouselDefaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme/carouselDefaults")>()),
  useCarouselDefaults: () => ({ data: undefined }),
}));
// Okładki-fallbacki idą przez per-izolatowy cache TTL - w testach wyłączony,
// żeby każdy test widział własną odpowiedź tabeli `posts`.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
}));
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "limit"]) {
    query[method] = () => query;
  }
  query.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data: refs.fallbackCovers, error: null });
  return { supabase: { from: () => query } };
});

import { SliderRender, type SliderConfig, type SliderItem } from "../sliderVariants";

const PLACEHOLDER_PREFIX = "data:image/svg+xml;utf8,";

const POST: PostRefData = {
  id: "p-1",
  slug: "raport-roczny",
  title: "Tytuł z wpisu",
  excerpt: "Zajawka z wpisu",
  cover: "https://obrazy.example.com/okladka-wpisu.jpg",
  href: "/raport-roczny",
  publishedAt: null,
  authorName: "Jan Kowalski",
  authorAvatar: "",
  authorSlug: "jan-kowalski",
};

/** Okładki „wczytane i z pikselami" na czas całego testu. */
let restoreImageState: () => void = () => undefined;
beforeEach(() => {
  refs.map = new Map();
  refs.calls = [];
  refs.fallbackCovers = [];
  const proto = window.HTMLImageElement.prototype;
  const completeDesc = Object.getOwnPropertyDescriptor(proto, "complete");
  const widthDesc = Object.getOwnPropertyDescriptor(proto, "naturalWidth");
  Object.defineProperty(proto, "complete", { configurable: true, get: () => true });
  Object.defineProperty(proto, "naturalWidth", { configurable: true, get: () => 1200 });
  restoreImageState = () => {
    if (completeDesc) Object.defineProperty(proto, "complete", completeDesc);
    else Reflect.deleteProperty(proto, "complete");
    if (widthDesc) Object.defineProperty(proto, "naturalWidth", widthDesc);
    else Reflect.deleteProperty(proto, "naturalWidth");
  };
});

afterEach(() => {
  cleanup();
  restoreImageState();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderSlider(config: Partial<SliderConfig>, lang: "pl" | "en" = "pl") {
  return render(<SliderRender config={{ items: [], autoplay: false, ...config }} lang={lang} />);
}

const activeImage = (root: HTMLElement): HTMLImageElement =>
  root.querySelector<HTMLImageElement>("img[data-fill-image]")!;

describe("slider - slajd związany z wpisem", () => {
  it("wypełnia puste pola slajdu okładką, adresem, tytułem, zajawką i autorem wpisu", () => {
    refs.map.set("p-1", POST);
    const { container } = renderSlider({
      variant: "split-feature",
      items: [{ image: "", postId: "p-1" } as SliderItem],
    });
    expect(container.querySelector("h3.cms-post-title")?.textContent).toBe("Tytuł z wpisu");
    expect(container.textContent).toContain("Zajawka z wpisu");
    expect(container.textContent).toContain("Jan Kowalski");
    expect(activeImage(container).getAttribute("src")).toBe(POST.cover);
    const titleLink = container.querySelector("h3.cms-post-title")?.closest("a");
    expect(titleLink?.getAttribute("href")).toBe("/raport-roczny");
  });

  it("ręczny tytuł wygrywa z wpisem, a pole złożone z samych spacji bierze wartość wpisu", () => {
    refs.map.set("p-1", POST);
    const { container } = renderSlider({
      variant: "split-feature",
      items: [
        {
          image: "https://obrazy.example.com/wlasna.jpg",
          postId: "p-1",
          title_pl: "Własny tytuł",
          subtitle_pl: "   ",
        },
      ],
    });
    expect(container.querySelector("h3.cms-post-title")?.textContent).toBe("Własny tytuł");
    expect(container.textContent).toContain("Zajawka z wpisu");
    expect(activeImage(container).getAttribute("src")).toBe(
      "https://obrazy.example.com/wlasna.jpg",
    );
  });

  it("przy lang=en wypełnia klucz angielski i nie rusza polskiego tekstu slajdu", () => {
    refs.map.set("p-1", { ...POST, title: "Post title" });
    const { container } = renderSlider(
      {
        variant: "split-feature",
        items: [{ image: "", postId: "p-1", title_pl: "Polski tytuł" } as SliderItem],
      },
      "en",
    );
    expect(container.querySelector("h3.cms-post-title")?.textContent).toBe("Post title");
    expect(refs.calls.at(-1)?.lang).toBe("en");
  });

  it("pyta warstwę danych o identyfikatory w kolejności slajdów, z null dla slajdów ręcznych", () => {
    renderSlider({
      items: [
        { image: "https://obrazy.example.com/1.jpg", title_pl: "Ręczny" },
        { image: "", postId: "p-9" } as SliderItem,
      ],
    });
    expect(refs.calls[0]).toEqual({ ids: [null, "p-9"], lang: "pl" });
  });

  it("slajd wskazujący wpis, którego jeszcze nie ma w wyniku, zostaje taki, jak go zapisano", () => {
    const { container } = renderSlider({
      variant: "split-feature",
      items: [{ image: "https://obrazy.example.com/1.jpg", postId: "p-404", title_pl: "Zapisany" }],
    });
    expect(container.querySelector("h3.cms-post-title")?.textContent).toBe("Zapisany");
  });
});

describe("slider - łańcuch zastępstw martwej okładki", () => {
  it("pierwszy błąd przełącza na okładkę-fallback, drugi na wbudowany obrazek", async () => {
    refs.fallbackCovers = [{ cover_image_url: "https://obrazy.example.com/zapas.jpg" }];
    const { container, queryClient } = renderSlider({
      variant: "editorial-hero",
      items: [{ image: "https://obrazy.example.com/martwa.jpg", title_pl: "Slajd" }],
    });
    // Fallbacki przychodzą z zapytania - błąd przed ich nadejściem dałby od
    // razu obrazek wbudowany i test nie dotknąłby środkowego ogniwa.
    await waitFor(() =>
      expect(
        queryClient.getQueriesData({ queryKey: [WIDGET_QUERY_ROOTS.sliderFallbackImages] })[0]?.[1],
      ).toEqual(["https://obrazy.example.com/zapas.jpg"]),
    );
    expect(activeImage(container).getAttribute("src")).toBe(
      "https://obrazy.example.com/martwa.jpg",
    );
    fireEvent.error(activeImage(container));
    expect(activeImage(container).getAttribute("src")).toBe("https://obrazy.example.com/zapas.jpg");
    fireEvent.error(activeImage(container));
    expect(activeImage(container).getAttribute("src")?.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
  });

  it("bez okładek-fallbacków błąd od razu daje wbudowany obrazek", () => {
    const { container } = renderSlider({
      variant: "cinematic-overlay",
      items: [{ image: "https://obrazy.example.com/martwa.jpg", title_pl: "Slajd" }],
    });
    fireEvent.error(activeImage(container));
    expect(activeImage(container).getAttribute("src")?.startsWith(PLACEHOLDER_PREFIX)).toBe(true);
  });

  it("martwy adres zapamiętuje cały slider - miniatura minimal-strip go nie pobiera", () => {
    const dead = "https://obrazy.example.com/martwa.jpg";
    const { container } = renderSlider({
      variant: "minimal-strip",
      items: [
        { image: dead, title_pl: "Slajd 1" },
        { image: "https://obrazy.example.com/2.jpg", title_pl: "Slajd 2" },
      ],
    });
    const thumb = () => container.querySelector<HTMLImageElement>("[data-thumb-strip] img")!;
    expect(thumb().getAttribute("src")).toContain(dead);
    fireEvent.error(activeImage(container));
    expect(thumb().getAttribute("src")).not.toContain(dead);
  });
});

describe("slider - kolumny multi-card bez ResizeObserver", () => {
  const FOUR: SliderItem[] = [1, 2, 3, 4].map((n) => ({
    image: `https://obrazy.example.com/${n}.jpg`,
    title_pl: `Karta ${n}`,
  }));
  const dotsOf = (root: HTMLElement) => root.querySelectorAll('button[aria-label^="Slajd"]').length;

  it.each([
    [500, 4],
    [900, 3],
    [1400, 2],
  ])("kontener o szerokości %i px daje karuzelę o %i kropkach", (width, dots) => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width,
    } as DOMRect);
    // 3 skonfigurowane kolumny: telefon -> 1, tablet -> 2, desktop -> 3;
    // kroków jest `karty - (kolumny - 1)`.
    const { container } = renderSlider({ variant: "multi-card", columns: 3, items: FOUR });
    expect(dotsOf(container)).toBe(dots);
  });
});
