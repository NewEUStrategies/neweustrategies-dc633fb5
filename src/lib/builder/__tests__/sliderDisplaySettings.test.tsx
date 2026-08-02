// Sekcja "Wyświetlanie" slidera w TRYBIE RĘCZNYM: showTitle / showExcerpt /
// showCover / authorDisplay (+ etykiety PL-EN) / authorSizePx /
// authorAvatarSizePx.
//
// Regresje przypięte tutaj:
//  1. `showTitle` było zapisywane przez panel i obsługiwane przez renderer,
//     ale ŻADNE miejsce wywołania go nie przekazywało - tytuł był zawsze
//     widoczny. Test sprawdza realny DOM (brak <h3>), nie samą flagę.
//  2. `authorDisplay="label"` renderowało się jak avatar, bo renderery
//     przekazywały wyłącznie boolean `showAuthor`. Tryb "label" musi dawać
//     sam tekst "Autor: Imię", bez <img> i bez kafelka z inicjałem.
//  3. `authorSizePx` / `authorAvatarSizePx` działały wyłącznie w podglądzie
//     edytora; renderer musi je honorować w każdym wariancie.
//  4. Wartości historyczne ("0"/"1" jako string) muszą być czytane przez
//     contentValue - string "0" jest prawdziwy, więc `!== false` gubiło je.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

vi.mock("@/lib/builder/contentRefs", () => ({
  useResolvedPostRefs: () => new Map(),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "limit"]) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => builder, rpc: async () => ({ data: [], error: null }) } };
});

import {
  SliderRender,
  SLIDER_VARIANT_VALUES,
  type SliderConfig,
  type SliderItem,
} from "../sliderVariants";

const ITEMS: SliderItem[] = [
  {
    image: "https://cdn.x/1.jpg",
    title_pl: "Tytuł slajdu",
    title_en: "Slide title",
    subtitle_pl: "Zajawka slajdu",
    author: "Anna Nowak",
    authorAvatar: "https://cdn.x/anna.jpg",
    href: "/p1",
  },
];

function renderSlider(config: Partial<SliderConfig>, lang: "pl" | "en" = "pl") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={qc}>
      <SliderRender config={{ items: ITEMS, autoplay: false, ...config }} lang={lang} />
    </QueryClientProvider>
  );
  return render(ui);
}

/** Awatar autora, a nie obrazek slajdu - slajdy renderują <img> bez alt. */
const avatarOf = (root: HTMLElement): HTMLImageElement | null =>
  root.querySelector<HTMLImageElement>('[data-author-badge] img[alt="Anna Nowak"]');

const titlesOf = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>("h3.cms-post-title"));

afterEach(cleanup);

describe("slider (tryb ręczny) - przełącznik tytułu", () => {
  it.each(SLIDER_VARIANT_VALUES)("renders the title in the %s variant by default", (variant) => {
    const { container } = renderSlider({ variant });
    expect(titlesOf(container)).not.toHaveLength(0);
    expect(container.textContent).toContain("Tytuł slajdu");
  });

  it.each(SLIDER_VARIANT_VALUES)("drops the title heading when showTitle=false (%s)", (variant) => {
    const { container } = renderSlider({ variant, showTitle: false });
    expect(titlesOf(container)).toHaveLength(0);
    expect(container.textContent).not.toContain("Tytuł slajdu");
  });

  it('treats the historical string "0" as false', () => {
    const { container } = renderSlider({ showTitle: "0" as unknown as boolean });
    expect(titlesOf(container)).toHaveLength(0);
  });

  it("keeps the excerpt independent from the title", () => {
    const { container } = renderSlider({ showTitle: false, showExcerpt: true });
    expect(container.textContent).toContain("Zajawka slajdu");
  });
});

describe("slider (tryb ręczny) - tryb prezentacji autora", () => {
  it("renders the avatar plus the bare name in avatar mode", () => {
    const { container } = renderSlider({ authorDisplay: "avatar" });
    expect(avatarOf(container)).not.toBeNull();
    expect(container.textContent).toContain("Anna Nowak");
    expect(container.textContent).not.toContain("Autor:");
  });

  it("renders a prefixed label WITHOUT the avatar in label mode", () => {
    const { container } = renderSlider({ authorDisplay: "label" });
    expect(avatarOf(container)).toBeNull();
    expect(container.querySelector('[data-author-badge="label"]')).not.toBeNull();
    expect(container.textContent).toContain("Autor: Anna Nowak");
  });

  it("uses the PL label override and never doubles the colon", () => {
    const { container } = renderSlider({ authorDisplay: "label", authorLabel_pl: "Napisał: " });
    expect(container.textContent).toContain("Napisał: Anna Nowak");
    expect(container.textContent).not.toContain(": :");
  });

  it("uses the EN label override when rendering in English", () => {
    const { container } = renderSlider(
      { authorDisplay: "label", authorLabel_pl: "Napisał", authorLabel_en: "Written by" },
      "en",
    );
    expect(container.textContent).toContain("Written by: Anna Nowak");
    expect(container.textContent).not.toContain("Napisał");
  });

  it("falls back to the built-in label per language", () => {
    const { container: pl } = renderSlider({ authorDisplay: "label" });
    expect(pl.textContent).toContain("Autor: Anna Nowak");
    cleanup();
    const { container: en } = renderSlider({ authorDisplay: "label" }, "en");
    expect(en.textContent).toContain("By: Anna Nowak");
  });

  it("hides the author entirely in none mode", () => {
    const { container } = renderSlider({ authorDisplay: "none" });
    expect(container.textContent).not.toContain("Anna Nowak");
    expect(container.querySelector("[data-author-badge]")).toBeNull();
  });

  it("keeps the legacy showAuthor=false working when authorDisplay is unset", () => {
    const { container } = renderSlider({ showAuthor: false });
    expect(container.textContent).not.toContain("Anna Nowak");
  });

  it("lets authorDisplay win over a stale legacy showAuthor flag", () => {
    const { container } = renderSlider({ showAuthor: false, authorDisplay: "label" });
    expect(container.textContent).toContain("Autor: Anna Nowak");
  });

  it.each(["cinematic-overlay", "split-feature", "multi-card"] as const)(
    "applies the label mode in the %s variant too",
    (variant) => {
      const { container } = renderSlider({ variant, authorDisplay: "label" });
      expect(avatarOf(container)).toBeNull();
      expect(container.textContent).toContain("Autor: Anna Nowak");
    },
  );
});

describe("slider (tryb ręczny) - rozmiary metadanych autora", () => {
  it("defaults to 12px text and a 20px avatar", () => {
    const { container } = renderSlider({});
    const avatar = avatarOf(container);
    expect(avatar?.getAttribute("width")).toBe("20");
    expect(container.querySelector<HTMLElement>("[data-author-badge]")?.style.fontSize).toBe(
      "12px",
    );
  });

  it("honours authorSizePx and authorAvatarSizePx in the rendered DOM", () => {
    const { container } = renderSlider({ authorSizePx: 18, authorAvatarSizePx: 44 });
    const avatar = avatarOf(container);
    expect(avatar?.getAttribute("width")).toBe("44");
    expect(avatar?.style.width).toBe("44px");
    expect(container.querySelector<HTMLElement>("[data-author-badge]")?.style.fontSize).toBe(
      "18px",
    );
  });

  it("accepts numeric strings and clamps out-of-range values", () => {
    const { container } = renderSlider({
      authorSizePx: "999" as unknown as number,
      authorAvatarSizePx: "16" as unknown as number,
    });
    const avatar = avatarOf(container);
    expect(avatar?.getAttribute("width")).toBe("16");
    expect(container.querySelector<HTMLElement>("[data-author-badge]")?.style.fontSize).toBe(
      "24px",
    );
  });

  it("sizes the initial placeholder when the author has no avatar", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <SliderRender
          config={{
            items: [{ image: "https://cdn.x/1.jpg", title_pl: "T", author: "Anna Nowak" }],
            autoplay: false,
            authorAvatarSizePx: 32,
          }}
          lang="pl"
        />
      </QueryClientProvider>,
    );
    const badge = container.querySelector<HTMLElement>('[data-author-badge="avatar"]');
    const placeholder = badge?.querySelector<HTMLElement>("span[aria-hidden]");
    expect(placeholder?.style.width).toBe("32px");
  });
});

describe("slider (tryb ręczny) - okładka i zajawka", () => {
  it("marks the root as cover-less so every variant hides its media", () => {
    const { container } = renderSlider({ showCover: false });
    expect(container.querySelector(".eh-slider")?.getAttribute("data-hide-cover")).toBe("true");
  });

  it("keeps the cover visible by default", () => {
    const { container } = renderSlider({});
    expect(container.querySelector(".eh-slider")?.getAttribute("data-hide-cover")).toBeNull();
  });

  it("drops the excerpt paragraph when showExcerpt=false", () => {
    const { container } = renderSlider({ showExcerpt: false });
    expect(container.querySelector(".cms-post-excerpt")).toBeNull();
    expect(container.textContent).not.toContain("Zajawka slajdu");
  });

  it("exposes the resolved display state on the slider root", () => {
    const { container } = renderSlider({ showTitle: false, authorDisplay: "label" });
    const root = container.querySelector<HTMLElement>(".eh-slider");
    expect(root?.getAttribute("data-show-title")).toBe("false");
    expect(root?.getAttribute("data-author-display")).toBe("label");
  });
});

describe("slider - koercja pozostałych ustawień", () => {
  const fourItems: SliderItem[] = [1, 2, 3, 4].map((n) => ({
    image: `https://cdn.x/${n}.jpg`,
    title_pl: `Slajd ${n}`,
  }));
  const dotsOf = (root: HTMLElement): number =>
    root.querySelectorAll('button[aria-label^="Slajd"]').length;

  const renderMultiCard = (columns: SliderConfig["columns"]) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <SliderRender
          config={{ items: fourItems, variant: "multi-card", autoplay: false, columns }}
          lang="pl"
        />
      </QueryClientProvider>,
    );
  };

  it("steps the carousel per column count", () => {
    // Kroki karuzeli = items - (columns - 1): 4 pozycje / 3 kolumny -> 2 kropki.
    expect(dotsOf(renderMultiCard(3).container)).toBe(2);
  });

  it("accepts a numeric string for columns", () => {
    // "2" musi znaczyć 2 (dotąd degradowało do domyślnych 3 kolumn -> 2 kropki).
    expect(dotsOf(renderMultiCard("2" as unknown as 2).container)).toBe(3);
  });

  it("falls back to the editorial hero for an unknown variant", () => {
    const { container } = renderSlider({ variant: "hero-overlay" as unknown as "editorial-hero" });
    expect(within(container).getByText("Tytuł slajdu")).toBeTruthy();
    expect(container.querySelector(".eh-multi-card")).toBeNull();
  });
});
