// SLIDER: PRZECIĄGANIE BEZ PRZEBUDOWY DRZEWA.
//
// Co ten plik udowadnia:
//
// 1. RUCH WSKAŹNIKA NIE RENDERUJE SLAJDÓW. Przesunięcie gestu trzymane w stanie
//    Reacta przebudowywało na KAŻDYM `pointermove` całe drzewo wariantu
//    (wszystkie slajdy i karty, arkusz instancji, propsy wspólne) - z
//    częstotliwością wskaźnika, czyli 60-120 razy na sekundę na telefonie.
//    Kadr i tor mają podążać za palcem bez udziału Reacta: render zostaje
//    tylko na początku i końcu gestu (klasa przeciągania, zmiana slajdu).
//    Dowód dwoma licznikami: `Profiler` całego slidera i licznik renderów
//    atrapy bylinu autora, który rysuje się w każdej karcie multi-card.
// 2. SEMANTYKA GESTU BEZ ZMIAN. Próg 48 px zmienia slajd po puszczeniu, krótszy
//    ruch wraca kadr/tor DOKŁADNIE na miejsce spoczynku, a anulowanie gestu
//    (`pointercancel` - np. przeglądarka przejmuje przewijanie w pionie) nie
//    zostawia kadru przesuniętego. To ostatnie jest ryzykiem właśnie zapisu
//    poza Reactem: render z przesunięciem 0 niczego w DOM-ie nie zmienia, więc
//    koniec gestu musi przywrócić pozycję sam.
//
// GRANICE I ATRAPY
//  * Bylin autora (`AuthorByline`) to granica-licznik: zlicza rendery per autor
//    i rysuje samo nazwisko (ma własne testy).
//  * Supabase, defaulty karuzeli i wiązanie z wpisami odpowiadają pustką - jak
//    w `sliderSlideClickAndSwipe.test.tsx`, którego testy gestu ten plik
//    uzupełnia o wariant multi-card i o liczenie renderów.
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const bylineRenders = vi.hoisted(() => new Map<string, number>());

vi.mock("@/components/molecules/AuthorByline", () => ({
  AuthorByline: ({ name }: { name: string }) => {
    bylineRenders.set(name, (bylineRenders.get(name) ?? 0) + 1);
    return <span>{name}</span>;
  },
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => null }));
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

const AUTHORS = ["Anna Nowak", "Jan Kowalski", "Ewa Wiśniewska"];
const SLIDES: SliderItem[] = AUTHORS.map((author, i) => ({
  image: `https://obrazy.example.com/${i + 1}.jpg`,
  title_pl: `Slajd ${i + 1}`,
  author,
}));

async function mount(config: Partial<SliderConfig>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRender = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <Profiler id="slider" onRender={onRender}>
        <SliderRender config={{ items: SLIDES, autoplay: false, ...config }} lang="pl" />
      </Profiler>
    </QueryClientProvider>,
  );
  // Pomiar kolumn i zapytania startowe rozstrzygają się w efektach - liczymy
  // rendery dopiero od spokojnego stanu.
  await act(async () => {});
  return { ...view, onRender };
}

/** Element, który podąża za palcem: tor kart albo warstwa obrazów kadru. */
const followerOf = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>("article")?.parentElement ??
  root.querySelector<HTMLElement>("img[data-fill-image]")!.parentElement!;
/** Powierzchnia gestu: kadr wariantu albo okno toru kart. */
const surfaceOf = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>("[data-widget-media]") ?? followerOf(root).parentElement!;
const activeDot = (root: HTMLElement): string | null =>
  within(root)
    .getAllByRole("button", { name: /^Slajd \d+$/ })
    .find((b) => b.getAttribute("aria-current") === "true")
    ?.getAttribute("aria-label") ?? null;

const down = (el: HTMLElement, x: number, pointerId = 1) =>
  fireEvent.pointerDown(el, { clientX: x, pointerId, pointerType: "touch" });
const move = (el: HTMLElement, x: number, pointerId = 1) =>
  fireEvent.pointerMove(el, { clientX: x, pointerId, pointerType: "touch" });
const up = (el: HTMLElement, x: number, pointerId = 1) =>
  fireEvent.pointerUp(el, { clientX: x, pointerId, pointerType: "touch" });

afterEach(() => {
  cleanup();
  bylineRenders.clear();
  vi.restoreAllMocks();
});

describe("slider - ruch wskaźnika nie przebudowuje drzewa", () => {
  it("karty multi-card nie renderują się ponownie, a tor i tak podąża za palcem", async () => {
    const { container, onRender } = await mount({ variant: "multi-card", columns: 1 });
    const surface = surfaceOf(container);
    const track = followerOf(container);
    const rest = track.style.transform;

    down(surface, 300);
    const commits = onRender.mock.calls.length;
    const cardRenders = new Map(bylineRenders);
    for (let x = 290; x >= 230; x -= 10) move(surface, x);

    expect(onRender.mock.calls.length).toBe(commits);
    expect(bylineRenders).toEqual(cardRenders);
    // Ostatni ruch: -70 px względem miejsca wciśnięcia.
    expect(track.style.transform).not.toBe(rest);
    expect(track.style.transform).toContain("-70px");
  });

  it("kadr editorial-hero przesuwa się o 35% ruchu bez ani jednego renderu", async () => {
    const { container, onRender } = await mount({ variant: "editorial-hero" });
    const surface = surfaceOf(container);
    const layer = followerOf(container);

    down(surface, 300);
    // Licznik działa: wciśnięcie renderuje raz (stan przeciągania na kadrze).
    expect(onRender).toHaveBeenCalled();
    const commits = onRender.mock.calls.length;
    move(surface, 250);
    move(surface, 200);
    expect(onRender.mock.calls.length).toBe(commits);
    expect(layer.style.transform).toBe("translate3d(-35px, 0, 0)");
  });
});

describe("slider - semantyka gestu po przeniesieniu przesunięcia poza Reacta", () => {
  it("multi-card: ruch za progiem przewija o jedną kartę po puszczeniu", async () => {
    const { container } = await mount({ variant: "multi-card", columns: 1 });
    const surface = surfaceOf(container);
    const track = followerOf(container);
    const rest = track.style.transform;
    expect(activeDot(container)).toBe("Slajd 1");

    down(surface, 300);
    move(surface, 240);
    up(surface, 240);

    expect(activeDot(container)).toBe("Slajd 2");
    expect(track.style.transform).not.toBe(rest);
    expect(track.style.transform).not.toContain("-60px");
  });

  it("multi-card: ruch krótszy niż próg wraca tor dokładnie na miejsce spoczynku", async () => {
    const { container } = await mount({ variant: "multi-card", columns: 1 });
    const surface = surfaceOf(container);
    const track = followerOf(container);
    const rest = track.style.transform;

    down(surface, 300);
    move(surface, 253);
    up(surface, 253);

    expect(activeDot(container)).toBe("Slajd 1");
    expect(track.style.transform).toBe(rest);
  });

  it.each(["multi-card", "editorial-hero"] as const)(
    "%s: anulowany gest nie zostawia przesuniętego kadru ani zmienionego slajdu",
    async (variant) => {
      const { container } = await mount({ variant, columns: 1 });
      const surface = surfaceOf(container);
      const follower = followerOf(container);
      const rest = follower.style.transform;

      down(surface, 300);
      move(surface, 280);
      fireEvent.pointerCancel(surface, { clientX: 280, pointerId: 1, pointerType: "touch" });

      expect(follower.style.transform).toBe(rest);
      expect(activeDot(container)).toBe("Slajd 1");
    },
  );

  it("kolejny gest zaczyna od pozycji spoczynku nowego slajdu, nie od starego przesunięcia", async () => {
    const { container } = await mount({ variant: "editorial-hero" });
    const surface = surfaceOf(container);
    const layer = followerOf(container);

    down(surface, 300);
    move(surface, 200);
    up(surface, 200);
    expect(activeDot(container)).toBe("Slajd 2");
    expect(layer.style.transform).toBe("");

    down(surface, 300, 2);
    move(surface, 320, 2);
    expect(layer.style.transform).toBe("translate3d(7px, 0, 0)");
    up(surface, 320, 2);
    expect(layer.style.transform).toBe("");
    expect(activeDot(container)).toBe("Slajd 2");
  });
});
