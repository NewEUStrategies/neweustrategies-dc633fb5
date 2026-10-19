// SLIDER: KLIKNIĘCIE W KADR I GEST PRZESUNIĘCIA.
//
// Co ten plik udowadnia (i dlaczego osobno od katalogów i ustawień):
//
// 1. DOKĄD PROWADZI KLIK W KADR. Warianty cinematic-overlay, split-feature
//    i minimal-strip nie mają odnośnika nakładki - kliknięcie kadru woła
//    `navigateTo`, który rozdziela adresy na trzy ścieżki: wewnętrzny (router,
//    bez przeładowania strony, więc nagłówek i menu zostają zamontowane),
//    zewnętrzny (nowa karta z `noopener,noreferrer`) i brak routera (twarde
//    `location.assign`). Kanwa edytora i podgląd w panelu NIE mogą nigdzie
//    prowadzić - a publiczny znacznik `data-builder-renderer="true"` nie jest
//    sygnałem edytora i nawigacji nie blokuje.
// 2. GEST NIE JEST KLIKNIĘCIEM. Przesunięcie o próg 48 px zmienia slajd,
//    krótszy ruch nie; klik, który kończy przeciąganie, nie może otworzyć
//    wpisu - ani przez `navigateTo`, ani przez odnośnik nakładki
//    editorial-hero, ani przez kartę multi-card. Wskaźnik przechwytujemy
//    dopiero po realnym ruchu (> 4 px), inaczej klik trafiałby w kontener
//    zamiast w `<a>` pod spodem.
//
// GRANICE I ATRAPY
//  * Router TanStack to granica: `useRouter` zwraca atrapę ze szpiegiem
//    `navigate` albo `null` (render poza drzewem routera). `window.open`
//    i `location.assign` są szpiegowane - test niczego nie otwiera.
//  * Supabase (okładki-fallbacki, defaulty karuzeli) odpowiada pustką; wiązanie
//    slajdu z wpisem ma własny plik, tu slajdy są ręczne.
//  * happy-dom nie pobiera obrazów i od 20.14 startuje z `complete === true`
//    przy `naturalWidth === 0`, co renderer czyta jako martwą okładkę - ten plik
//    o obrazy nie pyta, więc stanu ładowania nie łata.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderWithQueryClient as render } from "@/test/renderWithQueryClient";

const routerState = vi.hoisted(() => ({
  current: null as null | { navigate: ReturnType<typeof vi.fn>; preloadRoute: () => Promise<void> },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => routerState.current,
  Link: (p: { children?: ReactNode }) => <>{p.children}</>,
}));
vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));
vi.mock("@/lib/theme/carouselDefaults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/theme/carouselDefaults")>()),
  useCarouselDefaults: () => ({ data: undefined }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "in", "not", "order", "limit"]) {
    query[method] = () => query;
  }
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => query } };
});

import { SliderRender, type SliderConfig, type SliderItem } from "../sliderVariants";

const SLIDES: SliderItem[] = [1, 2, 3].map((n) => ({
  image: `https://obrazy.example.com/${n}.jpg`,
  title_pl: `Slajd ${n}`,
  href: `/wpis-${n}`,
}));

let navigate: ReturnType<typeof vi.fn>;
let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  navigate = vi.fn(async () => undefined);
  routerState.current = { navigate, preloadRoute: async () => undefined };
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSlider(
  config: Partial<SliderConfig> = {},
  opts: { preview?: boolean; wrapper?: Record<string, string> } = {},
) {
  const slider = (
    <SliderRender
      config={{ items: SLIDES, autoplay: false, ...config }}
      lang="pl"
      preview={opts.preview}
    />
  );
  return render(opts.wrapper ? <div {...opts.wrapper}>{slider}</div> : slider);
}

const mediaOf = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>("[data-widget-media]")!;
const titleOf = (root: HTMLElement): string =>
  root.querySelector<HTMLElement>("h3.cms-post-title")?.textContent ?? "";

/** Pełny gest wskaźnika na powierzchni przeciągania: wciśnij, przesuń, puść. */
function swipe(surface: HTMLElement, dx: number, pointerId = 1) {
  fireEvent.pointerDown(surface, { clientX: 300, pointerId, pointerType: "touch" });
  fireEvent.pointerMove(surface, { clientX: 300 + dx, pointerId, pointerType: "touch" });
  fireEvent.pointerUp(surface, { clientX: 300 + dx, pointerId, pointerType: "touch" });
}

describe("slider - kliknięcie w kadr prowadzi do wpisu właściwą drogą", () => {
  it.each(["cinematic-overlay", "split-feature", "minimal-strip"] as const)(
    "wariant %s otwiera adres wewnętrzny routerem, bez nowej karty",
    (variant) => {
      const { container } = renderSlider({ variant });
      fireEvent.click(mediaOf(container));
      expect(navigate).toHaveBeenCalledWith({ to: "/wpis-1" });
      expect(openSpy).not.toHaveBeenCalled();
    },
  );

  it("adres bezwzględny tej samej domeny zamienia na ścieżkę routera z zapytaniem i kotwicą", () => {
    const href = `${window.location.origin}/wpis-9?zrodlo=slider#tresc`;
    const { container } = renderSlider({
      variant: "cinematic-overlay",
      items: [{ ...SLIDES[0], href }],
    });
    fireEvent.click(mediaOf(container));
    expect(navigate).toHaveBeenCalledWith({ to: "/wpis-9?zrodlo=slider#tresc" });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("adres zewnętrzny otwiera w nowej karcie bez dostępu do `window.opener`", () => {
    const href = "https://zewnetrzny.example.com/raport";
    const { container } = renderSlider({
      variant: "split-feature",
      items: [{ ...SLIDES[0], href }],
    });
    fireEvent.click(mediaOf(container));
    expect(openSpy).toHaveBeenCalledWith(href, "_blank", "noopener,noreferrer");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("bez routera adres wewnętrzny przechodzi twardym `location.assign`", () => {
    routerState.current = null;
    const assign = vi.fn();
    const realLocation = window.location;
    // `location.assign` w happy-dom naprawdę nawiguje dokument - podmieniamy
    // cały obiekt na czas jednego kliknięcia i oddajemy oryginał w `finally`.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, origin: realLocation.origin, assign },
    });
    try {
      const { container } = renderSlider({ variant: "minimal-strip" });
      fireEvent.click(mediaOf(container));
      expect(assign).toHaveBeenCalledWith("/wpis-1");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    }
  });

  it.each([
    ["podgląd w panelu (prop `preview`)", { preview: true }],
    ["kanwa edytora", { wrapper: { "data-visual-canvas": "" } }],
    ["podgląd na żywo w panelu", { wrapper: { "data-builder-renderer": "widget-props-preview" } }],
  ])("w trybie %s klik w kadr nigdzie nie prowadzi", (_, opts) => {
    const { container } = renderSlider({ variant: "cinematic-overlay" }, opts);
    fireEvent.click(mediaOf(container));
    expect(navigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("publiczny znacznik renderera (`data-builder-renderer=true`) nie blokuje nawigacji", () => {
    const { container } = renderSlider(
      { variant: "cinematic-overlay" },
      { wrapper: { "data-builder-renderer": "true" } },
    );
    fireEvent.click(mediaOf(container));
    expect(navigate).toHaveBeenCalledWith({ to: "/wpis-1" });
  });

  it("slajd bez adresu nie wywołuje nawigacji ani nowej karty", () => {
    const { container } = renderSlider({
      variant: "cinematic-overlay",
      items: [{ image: SLIDES[0].image, title_pl: "Bez adresu" }],
    });
    fireEvent.click(mediaOf(container));
    expect(navigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("klik w miniaturę minimal-strip zmienia slajd zamiast otwierać wpis", () => {
    const { container } = renderSlider({ variant: "minimal-strip" });
    const strip = container.querySelector<HTMLElement>("[data-thumb-strip]")!;
    fireEvent.click(within(strip).getByRole("button", { name: "Slajd 3" }));
    expect(titleOf(container)).toBe("Slajd 3");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("slider - gest przesunięcia", () => {
  it("przesunięcie w lewo o próg przechodzi do następnego slajdu, w prawo - zawija do ostatniego", () => {
    const { container } = renderSlider({ variant: "editorial-hero" });
    swipe(mediaOf(container), -60);
    expect(titleOf(container)).toBe("Slajd 2");
    swipe(mediaOf(container), 60);
    swipe(mediaOf(container), 60);
    expect(titleOf(container)).toBe("Slajd 3");
  });

  it("ruch krótszy niż próg 48 px zostawia bieżący slajd", () => {
    const { container } = renderSlider({ variant: "split-feature" });
    swipe(mediaOf(container), -47);
    expect(titleOf(container)).toBe("Slajd 1");
  });

  it("w trakcie przeciągania obraz podąża za palcem (35% ruchu) bez animacji przejścia", () => {
    const { container } = renderSlider({ variant: "cinematic-overlay" });
    const surface = mediaOf(container);
    fireEvent.pointerDown(surface, { clientX: 300, pointerId: 7, pointerType: "touch" });
    fireEvent.pointerMove(surface, { clientX: 200, pointerId: 7, pointerType: "touch" });
    const layer = container.querySelector<HTMLElement>("img[data-fill-image]")!.parentElement!;
    expect(layer.style.transform).toBe("translate3d(-35px, 0, 0)");
    expect(layer.style.transition).toBe("none");
    expect(surface.classList.contains("is-dragging")).toBe(true);

    fireEvent.pointerUp(surface, { clientX: 200, pointerId: 7, pointerType: "touch" });
    expect(layer.style.transform).toBe("");
    expect(surface.classList.contains("is-dragging")).toBe(false);
  });

  it("przechwytuje wskaźnik dopiero po realnym ruchu i zwalnia go na końcu gestu", () => {
    const proto = window.HTMLElement.prototype as HTMLElement & Record<string, unknown>;
    const realSet = proto.setPointerCapture;
    const realRelease = proto.releasePointerCapture;
    const setCapture = vi.fn();
    const releaseCapture = vi.fn();
    proto.setPointerCapture = setCapture;
    proto.releasePointerCapture = releaseCapture;
    try {
      const { container } = renderSlider({ variant: "editorial-hero" });
      const surface = mediaOf(container);
      fireEvent.pointerDown(surface, { clientX: 300, pointerId: 4, pointerType: "touch" });
      fireEvent.pointerMove(surface, { clientX: 303, pointerId: 4, pointerType: "touch" });
      // 3 px to drżenie palca przy zwykłym kliknięciu - klik musi dojść do <a>.
      expect(setCapture).not.toHaveBeenCalled();
      fireEvent.pointerMove(surface, { clientX: 320, pointerId: 4, pointerType: "touch" });
      expect(setCapture).toHaveBeenCalledWith(4);
      fireEvent.pointerUp(surface, { clientX: 320, pointerId: 4, pointerType: "touch" });
      expect(releaseCapture).toHaveBeenCalledWith(4);
    } finally {
      proto.setPointerCapture = realSet;
      proto.releasePointerCapture = realRelease;
    }
  });

  it("ignoruje ruch innego wskaźnika niż ten, który rozpoczął gest", () => {
    const { container } = renderSlider({ variant: "editorial-hero" });
    const surface = mediaOf(container);
    fireEvent.pointerDown(surface, { clientX: 300, pointerId: 1, pointerType: "touch" });
    fireEvent.pointerMove(surface, { clientX: 100, pointerId: 2, pointerType: "touch" });
    fireEvent.pointerUp(surface, { clientX: 100, pointerId: 2, pointerType: "touch" });
    expect(titleOf(container)).toBe("Slajd 1");
  });

  it.each([
    ["prawy przycisk myszy", {}, { pointerType: "mouse", button: 2 }],
    ["podgląd w panelu", { preview: true }, { pointerType: "touch", button: 0 }],
  ] as const)("%s nie rozpoczyna przeciągania", (_, opts, pointer) => {
    const { container } = renderSlider({ variant: "editorial-hero" }, opts);
    const surface = mediaOf(container);
    fireEvent.pointerDown(surface, { clientX: 300, pointerId: 1, ...pointer });
    fireEvent.pointerMove(surface, { clientX: 100, pointerId: 1, ...pointer });
    fireEvent.pointerUp(surface, { clientX: 100, pointerId: 1, ...pointer });
    expect(surface.classList.contains("is-dragging")).toBe(false);
    expect(titleOf(container)).toBe("Slajd 1");
  });

  it("pojedynczy slajd nie ma czego przeciągać", () => {
    const { container } = renderSlider({ variant: "editorial-hero", items: [SLIDES[0]] });
    const surface = mediaOf(container);
    fireEvent.pointerDown(surface, { clientX: 300, pointerId: 1, pointerType: "touch" });
    expect(surface.classList.contains("is-dragging")).toBe(false);
  });
});

describe("slider - klik kończący przeciąganie nie otwiera wpisu", () => {
  it.each(["cinematic-overlay", "split-feature", "minimal-strip"] as const)(
    "wariant %s: klik po geście jest połknięty, a czysty klik po nim znowu nawiguje",
    (variant) => {
      const { container } = renderSlider({ variant });
      const surface = mediaOf(container);
      swipe(surface, -60);
      fireEvent.click(surface);
      expect(navigate).not.toHaveBeenCalled();

      // Nowe wciśnięcie bez ruchu zeruje pomiar gestu.
      fireEvent.pointerDown(surface, { clientX: 50, pointerId: 2, pointerType: "touch" });
      fireEvent.pointerUp(surface, { clientX: 50, pointerId: 2, pointerType: "touch" });
      fireEvent.click(surface);
      expect(navigate).toHaveBeenCalledWith({ to: "/wpis-2" });
    },
  );

  it("odnośnik nakładki editorial-hero blokuje domyślną akcję po geście", () => {
    const { container } = renderSlider({ variant: "editorial-hero" });
    const surface = mediaOf(container);
    swipe(surface, -60);
    const overlay = within(surface).getByRole("link", { name: "Slajd 2" });
    // `fireEvent` zwraca `false`, gdy ktoś wywołał preventDefault.
    expect(fireEvent.click(overlay)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("odnośnik nakładki editorial-hero bez gestu prowadzi routerem do wpisu", () => {
    const { container } = renderSlider({ variant: "editorial-hero" });
    fireEvent.click(within(mediaOf(container)).getByRole("link", { name: "Slajd 1" }));
    expect(navigate).toHaveBeenCalledWith({ href: "/wpis-1" });
  });

  it.each([
    ["podglądzie w panelu", { preview: true }],
    ["kanwie edytora", { wrapper: { "data-visual-canvas": "" } }],
  ])("odnośnik nakładki editorial-hero w %s nie nawiguje", (_, opts) => {
    const { container } = renderSlider({ variant: "editorial-hero" }, opts);
    const overlay = within(mediaOf(container)).getByRole("link", { name: "Slajd 1" });
    expect(fireEvent.click(overlay)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("karta multi-card po geście zatrzymuje klik, zanim dojdzie do odnośnika", () => {
    const { container } = renderSlider({ variant: "multi-card", columns: 1 });
    const surface = container.querySelector<HTMLElement>(".eh-drag-surface")!;
    swipe(surface, -60);
    const media = container.querySelectorAll<HTMLElement>(".eh-card-media")[1];
    expect(fireEvent.click(media)).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("slider - strzałki przy kropkach wariantu editorial-hero", () => {
  it("przewijają slajd w obie strony z zawijaniem", () => {
    const { container } = renderSlider({ variant: "editorial-hero" });
    // Kropki mają własne strzałki z `title`; boczne strzałki kadru go nie mają.
    const dotsPrev = container.querySelector<HTMLElement>('button[title="Poprzedni slajd"]')!;
    const dotsNext = container.querySelector<HTMLElement>('button[title="Następny slajd"]')!;
    fireEvent.click(dotsPrev);
    expect(titleOf(container)).toBe("Slajd 3");
    fireEvent.click(dotsNext);
    fireEvent.click(dotsNext);
    expect(titleOf(container)).toBe("Slajd 2");
    expect(navigate).not.toHaveBeenCalled();
  });
});
