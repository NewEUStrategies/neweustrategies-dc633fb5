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
//
// ROZSZERZENIE: KOERCJA POZOSTAŁYCH USTAWIEŃ WIDGETU.
// Druga połowa pliku broni tej samej rzeczy co pierwsza, tylko dla ustawień
// spoza sekcji "Wyświetlanie": proporcji kadru, zaokrąglenia, liczby kolumn,
// krycia nakładki, interwału autoplay, paska miniatur i pustego stanu.
//
// CO TU JEST NAPRAWDE DO OBRONY
//  1. KAŻDE ustawienie panelu ma DAĆ SIĘ ZOBACZYĆ W DOM. Renderer koercjuje
//     całą konfigurację przez `contentValue` (asOneOf/asNum/asNumInRange), więc
//     "3" musi znaczyć 3, wartość spoza katalogu musi wracać do domyślnej,
//     a wartość poza zakresem ma być domknięta do granicy - nie odrzucona
//     i nie przepuszczona. Asercje idą wyłącznie na atrybuty i style
//     wyrenderowanych elementów, nigdy na zmienne wewnętrzne.
//  2. GRANICE, NIE ŚRODEK PRZEDZIAŁU. Kolumny (1..4), krycie nakładki (0..1)
//     i dolny limit interwału (1500 ms) testujemy wartościami skrajnymi i
//     spoza zakresu, bo to jedyne miejsca, w których zacisk w ogóle działa.
//  3. PASEK MINIATUR wariantu minimal-strip: po jednej miniaturze na slajd,
//     przełączanie kliknięciem i adres budowany przez transformację Storage
//     (miniatura 96x72 nie może pobierać drugiego pełnowymiarowego oryginału).
//  4. PUSTY STAN jest stanem widgetu, nie awarią: musi trzymać proporcje
//     i promień z konfiguracji, a lista złożona z samych wartości pustych
//     ma dawać ten sam stan, a nie wywracać render.
//
// GRANICA DOWODU: z tego poziomu nie da się udowodnić układu wizualnego.
// happy-dom nie liczy layoutu, a szerokość karty multi-card jest podawana jako
// `calc(...)`, którego happy-dom nie zachowuje w `style` - dlatego liczbę
// kolumn obserwujemy przez liczbę kroków karuzeli (kropki), a nie przez
// zmierzoną szerokość. Reguły responsywne (media queries, [data-device])
// żyją wyłącznie w arkuszu i są weryfikowane jako tekst w siostrzanym
// `sliderTypographyFidelity.test.tsx`, nie przez zmianę viewportu.
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
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
  NAV_ARROW_VARIANT_VALUES,
  NAV_BG_STYLES,
  NAV_POSITIONS,
  SliderRender,
  SLIDER_RATIOS,
  SLIDER_ROUNDED_VALUES,
  SLIDER_VARIANT_VALUES,
  type SliderConfig,
  type SliderItem,
  type SliderRatio,
  type SliderRounded,
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

/** Awatar autora: jedyny <img> WEWNĄTRZ bylinu (alt="" - nazwisko stoi obok
 *  jako tekst, więc zdjęcie jest dekoracyjne). */
const avatarOf = (root: HTMLElement): HTMLImageElement | null =>
  root.querySelector<HTMLImageElement>("[data-author-byline] img");

const titlesOf = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>("h3.cms-post-title"));

/** Kadr slajdu - każdy wariant poza multi-card oznacza go `data-widget-media`,
 *  więc to jedyny stabilny punkt zaczepienia dla proporcji i promienia. */
const mediaOf = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>("[data-widget-media]");

/** Trzy slajdy - minimum, przy którym widać krok automatu i nawigację. */
const THREE_SLIDES: SliderItem[] = [1, 2, 3].map((n) => ({
  image: `https://cdn.example.com/${n}.jpg`,
  title_pl: `Slajd ${n}`,
}));

afterEach(cleanup);
// Autoplay jest jedynym miejscem z prawdziwym setInterval - fałszywe timery
// muszą znikać razem z testem, żeby nie wyciekły na sąsiednie przypadki.
afterEach(() => {
  vi.useRealTimers();
});

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
    expect(container.querySelector('[data-author-byline="label"]')).not.toBeNull();
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
    expect(container.querySelector("[data-author-byline]")).toBeNull();
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

  it.each(SLIDER_VARIANT_VALUES.filter((v) => v !== "minimal-strip"))(
    "prowadzi bylinę do profilu autora w wariancie %s, gdy slajd niesie slug",
    (variant) => {
      const { container } = renderSlider({
        variant,
        items: [{ ...ITEMS[0], authorSlug: "anna-nowak" }],
      });
      const byline = container.querySelector<HTMLElement>("[data-author-byline]");
      expect(byline?.tagName).toBe("A");
      expect(byline?.getAttribute("href")).toBe("/author/anna-nowak");
    },
  );

  it("zostawia bylinę bez odnośnika, gdy slajd nie zna sluga autora", () => {
    const { container } = renderSlider({});
    expect(container.querySelector("[data-author-byline]")?.tagName).toBe("SPAN");
  });
});

describe("slider (tryb ręczny) - rozmiary metadanych autora", () => {
  it("defaults to 12px text and a 20px avatar", () => {
    const { container } = renderSlider({});
    const avatar = avatarOf(container);
    expect(avatar?.getAttribute("width")).toBe("20");
    expect(container.querySelector<HTMLElement>("[data-author-byline]")?.style.fontSize).toBe(
      "12px",
    );
  });

  it("honours authorSizePx and authorAvatarSizePx in the rendered DOM", () => {
    const { container } = renderSlider({ authorSizePx: 18, authorAvatarSizePx: 44 });
    const avatar = avatarOf(container);
    expect(avatar?.getAttribute("width")).toBe("44");
    expect(avatar?.style.width).toBe("44px");
    expect(container.querySelector<HTMLElement>("[data-author-byline]")?.style.fontSize).toBe(
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
    expect(container.querySelector<HTMLElement>("[data-author-byline]")?.style.fontSize).toBe(
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
    const badge = container.querySelector<HTMLElement>('[data-author-byline="avatar"]');
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

  it.each(SLIDER_RATIOS)("przekłada zapisane proporcje %s na aspect-ratio kadru", (ratio) => {
    const { container } = renderSlider({ ratio });
    // Renderer rozsuwa "16/9" do "16 / 9" - bez tej spacji CSS nie przyjmuje
    // wartości, a kadr cicho wraca do wysokości treści.
    expect(mediaOf(container)?.style.aspectRatio).toBe(ratio.replace("/", " / "));
  });

  it("wraca do proporcji domyślnych, gdy zapisana wartość jest spoza katalogu", () => {
    const { container } = renderSlider({ ratio: "7/3" as unknown as SliderRatio });
    expect(mediaOf(container)?.style.aspectRatio).toBe("4 / 3");
  });

  const roundedCases: Array<[SliderRounded, string]> = [
    ["none", "0px"],
    ["sm", "4px"],
    ["md", "8px"],
    ["lg", "16px"],
    ["xl", "24px"],
    ["full", "9999px"],
  ];

  it("opisuje promieniem KAŻDĄ wartość z katalogu zaokrągleń", () => {
    // Katalog jest wystawiany w panelu; wartość bez wpisu w mapie promieni
    // dawałaby w kadrze `undefined`, więc obie listy muszą chodzić parami.
    expect(roundedCases.map(([value]) => value)).toEqual([...SLIDER_ROUNDED_VALUES]);
  });

  it.each(roundedCases)(
    "przekłada zaokrąglenie %s na promień %s kadru w wariancie cinematic-overlay",
    (rounded, radius) => {
      const { container } = renderSlider({ variant: "cinematic-overlay", rounded });
      expect(mediaOf(container)?.style.borderRadius).toBe(radius);
    },
  );

  // DEFEKT: DOMYŚLNY WARIANT IGNORUJE USTAWIENIE ZAOKRĄGLENIA KADRU.
  //
  // WEJSCIE: widget bez zmiany wariantu (czyli `editorial-hero`, wartość
  //   domyślna) z ustawieniem "Zaokrąglenie: pełne", które panel zapisuje
  //   jako `rounded: "full"`.
  // CO PSUJE: `SliderRender` wylicza promień z `radiusMap`
  //   (src/lib/builder/sliderVariants.tsx:780) i podaje go wariantom jako
  //   `p.rounded`, ale `EditorialHeroVariant` wpisuje w kadr stałą
  //   `borderRadius: 4` (tamże :1147) i wyliczonej wartości nigdy nie czyta.
  //   Cztery pozostałe warianty (cinematic-overlay, split-feature,
  //   minimal-strip, multi-card) używają `p.rounded` poprawnie.
  // KONSEKWENCJA: ustawienie jest martwe dokładnie w tym wariancie, który ma
  //   większość widgetów. Redaktor przestawia listę, panel pokazuje nową
  //   opcję jako wybraną, a kadr wygląda identycznie - klasyczne "wybrałem,
  //   nic się nie stało", którego z panelu nie da się rozpoznać.
  // WYMAGANA POPRAWKA: `EditorialHeroVariant` ma rysować kadr z `p.rounded`,
  //   tak samo jak pozostałe warianty; stała 4 px może zostać najwyżej jako
  //   wartość domyślna mapy, nie jako nadpisanie konfiguracji.
  it.fails("DEFEKT: wariant editorial-hero też honoruje zaokrąglenie kadru", () => {
    const { container } = renderSlider({ variant: "editorial-hero", rounded: "full" });
    expect(mediaOf(container)?.style.borderRadius).toBe("9999px");
  });

  // DEFEKT: PANEL I RENDERER MAJĄ DWIE RÓŻNE PROPORCJE DOMYŚLNE.
  //
  // WEJSCIE: widget slidera, w którym nikt nigdy nie dotknął listy "Proporcje"
  //   (pole `ratio` nie istnieje w zapisanej treści).
  // CO PSUJE: panel czyta `asOneOf(c.ratio, SLIDER_RATIOS, "16/9")`
  //   (src/components/admin/builder/widget-props/SliderEditor.tsx:53), a
  //   renderer `asOneOf(config.ratio, SLIDER_RATIOS, "4/3")`
  //   (src/lib/builder/sliderVariants.tsx:775). Obie strony są "poprawne"
  //   osobno i sprzeczne razem.
  // KONSEKWENCJA: panel pokazuje 16/9 jako zaznaczone, a strona rysuje 4/3.
  //   Redaktor widzi inny kadr niż wybrany i "naprawia" go ręcznie, więc
  //   dokument zapisuje wartość, której nie chciał zmieniać.
  // WYMAGANA POPRAWKA: jedna wartość domyślna po obu stronach - to, co panel
  //   pokazuje jako zaznaczone, musi być tym, co widz widzi.
  it.fails("DEFEKT: kadr bez zapisanego pola ma proporcje pokazywane w panelu", () => {
    const { container } = renderSlider({});
    expect(mediaOf(container)?.style.aspectRatio).toBe("16 / 9");
  });

  // Kolumny: [zapis z panelu, liczba kropek karuzeli]. Kroków jest
  // `items - (kolumny - 1)`, więc przy 4 slajdach liczba kropek jednoznacznie
  // wskazuje rozstrzygniętą liczbę kolumn (4 kolumny = jeden krok = DotsNav
  // w ogóle nie rysuje kropek).
  const columnCases: Array<[unknown, number]> = [
    [-5, 4],
    ["0", 4],
    [1, 4],
    [2, 3],
    ["3", 2],
    [2.6, 2],
    [9, 0],
  ];

  it.each(columnCases)("zawęża zapis kolumn %s do karuzeli o %i kropkach", (columns, dots) => {
    const { container } = renderMultiCard(columns as SliderConfig["columns"]);
    expect(dotsOf(container)).toBe(dots);
    // Kolumny sterują SZEROKOŚCIĄ karty, nigdy liczbą kart - wszystkie cztery
    // slajdy zostają w torze niezależnie od zacisku.
    expect(container.querySelectorAll("article.eh-card")).toHaveLength(4);
  });

  // Krycie nakładki: [zapis z panelu, krycie u góry, krycie u dołu].
  // Gradient liczy się z jednej wartości dwiema funkcjami
  // (`overlayTop` = min(0.6, x/2), `overlayBottom` = min(0.95, x+0.4)), więc
  // wartość spoza 0..1 musi być domknięta ZANIM trafi do gradientu.
  const overlayCases: Array<[number, number, number]> = [
    [5, 0.5, 0.95],
    [-1, 0, 0.4],
    [0.5, 0.25, 0.9],
  ];

  it.each(overlayCases)(
    "zawęża krycie nakładki %s do gradientu %s -> %s",
    (overlayOpacity, top, bottom) => {
      const { container } = renderSlider({ variant: "cinematic-overlay", overlayOpacity });
      const gradient = container.querySelector<HTMLElement>(
        "[data-widget-media] .pointer-events-none",
      );
      expect(gradient?.style.background).toBe(
        `linear-gradient(180deg, rgba(0,0,0,${top}) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,${bottom}) 100%)`,
      );
    },
  );

  it.each([
    [true, "Slajd 1"],
    [false, "Slajd 3"],
  ])("po ostatnim slajdzie automat z pętlą=%s zatrzymuje się na %s", (loop, expected) => {
    vi.useFakeTimers();
    const { container } = renderSlider({
      items: THREE_SLIDES,
      autoplay: true,
      intervalMs: 1500,
      loop,
    });
    act(() => {
      vi.advanceTimersByTime(3 * 1600);
    });
    // Bez pętli automat staje na ostatnim slajdzie; ręczne strzałki nadal
    // zawijają, więc widz nie zostaje uwięziony na końcu listy.
    expect(container.querySelector("h3.cms-post-title")?.textContent).toBe(expected);
  });

  it("traktuje dokument bez pola pozycji jak slider bez slajdów", () => {
    // Rewizje sprzed wprowadzenia pola `items` nadal siedzą w bazie - brak
    // tablicy ma dać pusty stan, a nie wyjątek przy pierwszym `map`.
    const { container } = renderSlider({ items: undefined as unknown as SliderItem[] });
    expect(container.textContent).toContain("Dodaj obrazki do slidera");
  });

  it("podnosi zbyt krótki interwał autoplay do dolnego limitu 1500 ms", () => {
    vi.useFakeTimers();
    const { container } = renderSlider({
      items: THREE_SLIDES,
      autoplay: true,
      intervalMs: 200,
    });
    expect(container.textContent).toContain("Slajd 1");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    // Gdyby renderer honorował zapisane 200 ms, slajd zmieniłby się cztery
    // razy przed tą asercją.
    expect(container.textContent).toContain("Slajd 1");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(container.textContent).toContain("Slajd 2");
  });
});

describe("slider - pasek miniatur wariantu minimal-strip", () => {
  const STRIP_ITEMS: SliderItem[] = [
    {
      image: "https://storage.example.com/storage/v1/object/public/media/1.jpg",
      title_pl: "Slajd 1",
    },
    { image: "https://cdn.example.com/2.jpg", title_pl: "Slajd 2" },
    { image: "https://cdn.example.com/3.jpg", title_pl: "Slajd 3" },
  ];

  const renderStrip = (config: Partial<SliderConfig> = {}, lang: "pl" | "en" = "pl") =>
    renderSlider({ variant: "minimal-strip", items: STRIP_ITEMS, ...config }, lang);

  const thumbsOf = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-thumb-strip] button"));

  /** Tytuł widoczny w pasku podpisu - w tym wariancie jest dokładnie jeden. */
  const captionTitleOf = (root: HTMLElement): string =>
    root.querySelector<HTMLElement>("h3.cms-post-title")?.textContent ?? "";

  it("rysuje po jednej miniaturze na slajd i wyróżnia aktywną obwódką", () => {
    const { container } = renderStrip();
    const thumbs = thumbsOf(container);
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0].className).toContain("ring-2");
    expect(thumbs[1].className).toContain("ring-1");
    expect(thumbs[2].className).toContain("ring-1");
  });

  it("przełącza slajd kliknięciem w miniaturę", () => {
    const { container } = renderStrip();
    expect(captionTitleOf(container)).toBe("Slajd 1");
    fireEvent.click(thumbsOf(container)[2]);
    expect(captionTitleOf(container)).toBe("Slajd 3");
    expect(thumbsOf(container)[2].className).toContain("ring-2");
  });

  it("buduje adres miniatury ze Storage przez wariant transformowany 192x144", () => {
    const { container } = renderStrip();
    const src = thumbsOf(container)[0].querySelector("img")?.getAttribute("src") ?? "";
    // Miniatura maluje się w polu 96x72, więc wolno jej pobrać najwyżej
    // wariant 2x DPR - nigdy drugiego pełnowymiarowego oryginału.
    expect(src).toContain("/storage/v1/render/image/public/");
    expect(src).toContain("width=192");
    expect(src).toContain("height=144");
    expect(src).toContain("resize=cover");
  });

  it("dokleja do adresu spoza Storage wyłącznie nieszkodliwe parametry w/h", () => {
    const { container } = renderStrip();
    const src = thumbsOf(container)[1].querySelector("img")?.getAttribute("src") ?? "";
    expect(src).toContain("https://cdn.example.com/2.jpg");
    expect(src).toContain("w=192");
    expect(src).toContain("h=144");
    expect(src).not.toContain("/render/image/");
  });

  it("nie rysuje paska miniatur dla pojedynczego slajdu", () => {
    const { container } = renderStrip({ items: [STRIP_ITEMS[0]] });
    expect(container.querySelector("[data-thumb-strip]")).toBeNull();
    expect(captionTitleOf(container)).toBe("Slajd 1");
  });

  // DEFEKT: WYŁĄCZONA OKŁADKA ZOSTAJE WIDOCZNA W PASKU MINIATUR.
  //
  // WEJSCIE: wariant `minimal-strip` z odznaczonym "Pokaż okładkę"
  //   (`showCover: false`) i co najmniej dwoma slajdami.
  // CO PSUJE: wyłączenie okładki działa wyłącznie przez arkusz - reguła
  //   `.eh-slider[data-hide-cover="true"]` chowa `.eh-img`, `.eh-hover-zoom`
  //   i `.eh-card-media img` (src/lib/builder/sliderVariants.tsx:457-459).
  //   Miniatura ma klasę "absolute inset-0 w-full h-full object-cover"
  //   (tamże :1816-1828) i leży w `[data-thumb-strip]`, czyli nie łapie jej
  //   żaden z trzech selektorów.
  // KONSEKWENCJA: redaktor wyłącza okładki, główny kadr faktycznie gaśnie,
  //   a pod spodem nadal stoi rząd tych samych zdjęć w miniaturze. Ustawienie
  //   wygląda na zepsute właśnie w wariancie, który miniatur używa.
  // WYMAGANA POPRAWKA: `data-hide-cover="true"` ma chować KAŻDY obraz
  //   pochodzący z okładki - albo przez dopisanie paska do reguły, albo przez
  //   ukrycie całego paska razem z okładkami.
  it.fails("DEFEKT: wyłączenie okładki chowa również pasek miniatur", () => {
    const { container } = renderStrip({ showCover: false });
    const stillVisible = Array.from(container.querySelectorAll("img")).filter(
      (img) => getComputedStyle(img).visibility !== "hidden",
    );
    expect(stillVisible).toHaveLength(0);
  });

  // DEFEKT: ETYKIETY DOSTĘPNOŚCI SLIDERA SĄ WYŁĄCZNIE PO POLSKU.
  //
  // WEJSCIE: ten sam widget wyrenderowany z `lang="en"` - czyli angielska
  //   wersja strony, na której slider jest dwujęzyczny (tytuły i zajawki
  //   przełączają się poprawnie).
  // CO PSUJE: `aria-label` miniatur jest wpisany w kod jako `Slajd ${i + 1}`
  //   (src/lib/builder/sliderVariants.tsx:1805), tak samo jak etykiety kropek
  //   (:679, :1561) i tekst pustego stanu (:931). W TYM SAMYM pliku strzałki
  //   nawigacji lokalizują się poprawnie ("Previous slide" / "Poprzedni
  //   slajd", :1191-1192), więc to niekonsekwencja, a nie decyzja projektowa;
  //   dług jest zarejestrowany budżetem w src/lib/ci/monolingualUserText.ts.
  // KONSEKWENCJA: czytnik ekranu na anglojęzycznej stronie czyta polskie
  //   słowo "Slajd" w środku angielskiego interfejsu - jedyni użytkownicy,
  //   którzy tę etykietę w ogóle słyszą, dostają ją w obcym języku.
  // WYMAGANA POPRAWKA: komplet PL i EN wybierany po propsie `lang`,
  //   dokładnie tak jak robią to `NavArrows` w tym samym pliku.
  it.fails("DEFEKT: etykiety miniatur są po angielsku przy lang=en", () => {
    const { container } = renderStrip({}, "en");
    expect(thumbsOf(container)[0].getAttribute("aria-label")).not.toMatch(/^Slajd/);
  });
});

describe("slider - czas czytania i separator metadanych", () => {
  const withMeta = (extra: Partial<SliderItem>): SliderItem[] => [
    { image: "https://cdn.example.com/1.jpg", title_pl: "Slajd 1", ...extra },
  ];

  /** Wiersz metadanych: kontener, w którym stoi bylina albo czas czytania.
   *  Szukamy po zegarze, bo tylko on jest wspólny dla wszystkich wariantów. */
  const metaRowOf = (root: HTMLElement): HTMLElement | null => {
    const clock = Array.from(root.querySelectorAll<HTMLElement>("span")).find((el) =>
      el.textContent?.includes("⏱"),
    );
    return (
      clock?.parentElement ??
      root.querySelector<HTMLElement>("[data-author-byline]")?.parentElement ??
      null
    );
  };

  it("rysuje czas czytania także wtedy, gdy autor jest wyłączony", () => {
    const { container } = renderSlider({
      showAuthor: false,
      items: withMeta({ author: "Anna Nowak", readTime: "5 min" }),
    });
    expect(container.textContent).not.toContain("Anna Nowak");
    expect(metaRowOf(container)?.textContent).toContain("5 min");
  });

  const separatorCases: Array<[NonNullable<SliderConfig["variant"]>, string]> = [
    ["editorial-hero", "|"],
    ["multi-card", "·"],
    ["cinematic-overlay", "·"],
    ["split-feature", "·"],
  ];

  it.each(separatorCases)(
    "wariant %s wstawia separator %s dopiero przy obu informacjach naraz",
    (variant, separator) => {
      const onlyAuthor = renderSlider({ variant, items: withMeta({ author: "Anna Nowak" }) });
      expect(metaRowOf(onlyAuthor.container)?.textContent).toContain("Anna Nowak");
      expect(metaRowOf(onlyAuthor.container)?.textContent).not.toContain(separator);
      cleanup();

      const onlyReadTime = renderSlider({
        variant,
        showAuthor: false,
        items: withMeta({ author: "Anna Nowak", readTime: "5 min" }),
      });
      expect(metaRowOf(onlyReadTime.container)?.textContent).toContain("5 min");
      expect(metaRowOf(onlyReadTime.container)?.textContent).not.toContain(separator);
      cleanup();

      const both = renderSlider({
        variant,
        items: withMeta({ author: "Anna Nowak", readTime: "5 min" }),
      });
      const row = metaRowOf(both.container)?.textContent ?? "";
      expect(row).toContain("Anna Nowak");
      expect(row).toContain("5 min");
      expect(row).toContain(separator);
    },
  );

  // DEFEKT: WARIANT MINIMAL-STRIP GUBI CAŁY WIERSZ METADANYCH.
  //
  // WEJSCIE: slajd z autorem i czasem czytania w wariancie `minimal-strip`,
  //   przy domyślnie włączonym "Pokaż autora".
  // CO PSUJE: `SliderRender` rozstrzyga `author`, `showAuthor` i `authorStyle`
  //   i przekazuje je we wspólnych propsach każdemu wariantowi, ale
  //   `MinimalStripVariant` (src/lib/builder/sliderVariants.tsx:1718-1835)
  //   rysuje w pasku podpisu wyłącznie kategorię, tytuł i zajawkę - bylina
  //   i zegar nie mają tam ani jednej linii kodu.
  // KONSEKWENCJA: ustawienia "Pokaż autora", `authorSizePx` i
  //   `authorAvatarSizePx` są w tym wariancie martwe, a panel pokazuje je
  //   bez żadnego zawężenia - redaktor przestawia suwaki, które nic nie robią.
  //   To ta sama klasa martwych ustawień, którą deadWidgetSettings.test.ts
  //   pilnuje dla nagłówka.
  // WYMAGANA POPRAWKA: pasek podpisu ma pokazywać bylinę i czas czytania jak
  //   pozostałe cztery warianty, albo panel ma te pola dla `minimal-strip`
  //   chować - milczące ignorowanie ustawienia jest jedyną opcją zakazaną.
  it.fails("DEFEKT: wariant minimal-strip pokazuje autora i czas czytania", () => {
    const { container } = renderSlider({
      variant: "minimal-strip",
      items: withMeta({ author: "Anna Nowak", readTime: "5 min" }),
    });
    expect(container.textContent).toContain("Anna Nowak");
    expect(container.textContent).toContain("5 min");
  });
});

describe("slider - pusty stan bez slajdów", () => {
  const emptyBoxOf = (root: HTMLElement): HTMLElement | null =>
    root.querySelector<HTMLElement>("div.border-dashed");

  it("pokazuje zachętę w proporcjach i promieniu wziętych z konfiguracji", () => {
    const { container } = renderSlider({ items: [], ratio: "1/1", rounded: "lg" });
    const box = emptyBoxOf(container);
    expect(box?.textContent).toContain("Dodaj obrazki do slidera");
    // Pusty stan trzyma wymiar widgetu - bez tego kanwa buildera skacze przy
    // dodawaniu pierwszego slajdu.
    expect(box?.style.aspectRatio).toBe("1 / 1");
    expect(box?.style.borderRadius).toBe("16px");
  });

  it("traktuje listę złożoną z samych wartości pustych jak brak slajdów", () => {
    // Dokument po nieudanej migracji potrafi trzymać dziury w tablicy pozycji;
    // renderer ma je odrzucić, a nie wywrócić się na odczycie `it.postId`.
    const { container } = renderSlider({
      items: [null, undefined] as unknown as SliderItem[],
    });
    expect(emptyBoxOf(container)?.textContent).toContain("Dodaj obrazki do slidera");
  });

  // DEFEKT: PUSTY STAN ODZYWA SIĘ PO POLSKU NA ANGIELSKIEJ STRONIE.
  //
  // WEJSCIE: widget slidera bez zapisanych slajdów, wyrenderowany z
  //   `lang="en"` (angielska wersja strony albo podgląd EN w buforze).
  // CO PSUJE: tekst "Dodaj obrazki do slidera" jest wpisany w kod na sztywno
  //   (src/lib/builder/sliderVariants.tsx:931), mimo że komponent dostaje
  //   `lang` i używa go wszędzie indziej. To ten sam dług, co przy etykietach
  //   miniatur wyżej - opisany tam w całości.
  // KONSEKWENCJA: pusty widget na anglojęzycznej stronie mówi po polsku.
  //   Widzi to nie tylko redakcja: pusty stan renderuje się także publicznie,
  //   gdy wszystkie slajdy zostaną usunięte lub odfiltrowane.
  // WYMAGANA POPRAWKA: komunikat w PL i EN wybierany po propsie `lang`.
  it.fails("DEFEKT: pusty stan nie odzywa się po polsku przy lang=en", () => {
    const { container } = renderSlider({ items: [] }, "en");
    expect(container.textContent).not.toContain("Dodaj obrazki do slidera");
  });
});

describe("slider - koercja ustawień strzałek bocznych", () => {
  const renderNav = (config: Partial<SliderConfig> = {}) =>
    renderSlider({ variant: "editorial-hero", items: THREE_SLIDES, ...config });

  const prevOf = (root: HTMLElement): HTMLElement | null =>
    root.querySelector<HTMLElement>("button.eh-prev");
  const nextOf = (root: HTMLElement): HTMLElement | null =>
    root.querySelector<HTMLElement>("button.eh-next");

  it.each(NAV_ARROW_VARIANT_VALUES)("rysuje kształt strzałki %s jako inline SVG", (variant) => {
    const { container } = renderNav({ navArrowVariant: variant });
    // Kształt musi powstać w DOM, a nie w foncie ikon: strzałka slidera nie
    // może zniknąć, gdy asynchroniczny pakiet ikon nie zdąży się załadować.
    const paths = prevOf(container)?.querySelectorAll("svg path") ?? [];
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute("d")).toBeTruthy();
  });

  it("każdej wartości z katalogu strzałek odpowiada INNY kształt", () => {
    // Katalog wystawia osiem pozycji w panelu; dwie o tym samym rysunku
    // znaczyłyby, że wybór z listy niczego nie zmienia.
    const shapes = new Set<string>();
    for (const variant of NAV_ARROW_VARIANT_VALUES) {
      const { container } = renderNav({ navArrowVariant: variant });
      shapes.add(prevOf(container)?.querySelector("svg path")?.getAttribute("d") ?? "");
      cleanup();
    }
    expect(shapes.size).toBe(NAV_ARROW_VARIANT_VALUES.length);
  });

  it("wraca do chevronu, gdy zapisany kształt jest spoza katalogu", () => {
    const { container } = renderNav({
      navArrowVariant: "swoosh" as unknown as (typeof NAV_ARROW_VARIANT_VALUES)[number],
    });
    const { container: domyslny } = renderNav({ navArrowVariant: "chevron" });
    expect(prevOf(container)?.querySelector("svg path")?.getAttribute("d")).toBe(
      prevOf(domyslny)?.querySelector("svg path")?.getAttribute("d"),
    );
  });

  it.each(NAV_BG_STYLES)("nadaje obu przyciskom klasę modyfikatora eh-nav-%s", (navBgStyle) => {
    const { container } = renderNav({ navBgStyle });
    expect(prevOf(container)?.className).toContain(`eh-nav-${navBgStyle}`);
    expect(nextOf(container)?.className).toContain(`eh-nav-${navBgStyle}`);
  });

  it.each(NAV_POSITIONS)("ustawia pozycję przycisków na %s", (navPosition) => {
    const { container } = renderNav({ navPosition });
    expect(prevOf(container)?.getAttribute("data-pos")).toBe(navPosition);
    expect(nextOf(container)?.getAttribute("data-pos")).toBe(navPosition);
  });

  it.each([
    [5, "28px", "14px"],
    [500, "96px", "40px"],
    ["64", "64px", "27px"],
  ])("zawęża rozmiar przycisku %s do %s i skaluje ikonę do %s", (navSizePx, size, icon) => {
    const { container } = renderNav({ navSizePx: navSizePx as SliderConfig["navSizePx"] });
    const button = prevOf(container);
    expect(button?.style.getPropertyValue("--nav-size")).toBe(size);
    // Ikona to 42% przycisku, ale nigdy mniej niż 14 px - przy najmniejszym
    // dozwolonym przycisku strzałka nadal musi być widoczna.
    expect(button?.querySelector<SVGElement>("svg")?.style.width).toBe(icon);
  });

  it.each([
    [999, "9999px"],
    [-20, "0px"],
    [12, "12px"],
  ])("przekłada zapisany promień przycisku %s na %s", (navRoundedPx, radius) => {
    const { container } = renderNav({ navRoundedPx });
    expect(prevOf(container)?.style.getPropertyValue("--nav-radius")).toBe(radius);
  });

  it.each([
    [0.1, "0.5"],
    [9, "4"],
    ["3", "3"],
  ])("zawęża grubość kreski %s do %s", (navArrowStroke, stroke) => {
    const { container } = renderNav({
      navArrowStroke: navArrowStroke as SliderConfig["navArrowStroke"],
    });
    expect(prevOf(container)?.querySelector("svg path")?.getAttribute("stroke-width")).toBe(stroke);
  });

  it("pogrubia chevron-bold do co najmniej 3, a angle cieniuje o pół punktu", () => {
    const { container: bold } = renderNav({ navArrowVariant: "chevron-bold", navArrowStroke: 1 });
    expect(bold.querySelector("button.eh-prev svg path")?.getAttribute("stroke-width")).toBe("3");
    const { container: angle } = renderNav({ navArrowVariant: "angle", navArrowStroke: 3 });
    expect(angle.querySelector("button.eh-prev svg path")?.getAttribute("stroke-width")).toBe(
      "2.5",
    );
  });

  it("przenosi zapisane kolory chromu do zmiennych CSS przycisku", () => {
    const { container } = renderNav({ navBgColor: "#101010", navArrowColor: "#f5f5f5" });
    const button = prevOf(container);
    expect(button?.style.getPropertyValue("--nav-bg")).toBe("#101010");
    expect(button?.style.getPropertyValue("--nav-arrow")).toBe("#f5f5f5");
  });
});

describe("slider - chrom nawigacji nie uruchamia nawigacji slajdu", () => {
  // Cały kadr slajdu jest klikalny (przejście do wpisu), a chrom - strzałki,
  // kropki i bylina autora - leży W ŚRODKU tego kadru. Każdy element chromu
  // musi więc zatrzymać zdarzenie u siebie, inaczej jedno kliknięcie
  // przewija karuzelę I wychodzi ze strony. Kliknięcie, które wyszło poza
  // slider, łapiemy szpiegiem na elemencie nadrzędnym.
  const CHROME_ITEMS: SliderItem[] = [1, 2, 3].map((n) => ({
    image: `https://cdn.example.com/${n}.jpg`,
    title_pl: `Slajd ${n}`,
    author: "Anna Nowak",
  }));

  const renderWithOuterClick = (config: Partial<SliderConfig>, onOuterClick: () => void) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui: ReactElement = (
      <QueryClientProvider client={qc}>
        <div data-outer onClick={onOuterClick}>
          <SliderRender config={{ items: CHROME_ITEMS, autoplay: false, ...config }} lang="pl" />
        </div>
      </QueryClientProvider>
    );
    return render(ui);
  };

  /** Tytuł aktualnego slajdu - w wariantach jednoslajdowych jest jeden. */
  const currentTitleOf = (root: HTMLElement): string =>
    root.querySelector<HTMLElement>("h3.cms-post-title")?.textContent ?? "";

  it("kliknięcie w kadr slajdu DOCIERA poza slider (kontrola szpiega)", () => {
    const spy = vi.fn();
    const { container } = renderWithOuterClick({ variant: "editorial-hero" }, spy);
    fireEvent.click(container.querySelector<HTMLElement>("[data-widget-media]")!);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(["editorial-hero", "cinematic-overlay", "split-feature", "minimal-strip"] as const)(
    "strzałki boczne w wariancie %s przewijają slajd zamiast klikać w kadr",
    (variant) => {
      const spy = vi.fn();
      const { container } = renderWithOuterClick({ variant }, spy);
      const next = container.querySelector<HTMLElement>("button.eh-next")!;
      const prev = container.querySelector<HTMLElement>("button.eh-prev")!;

      // Wciśnięcie strzałki nie może też ROZPOCZĄĆ przeciągania - inaczej
      // ruch myszy nad przyciskiem szarpałby karuzelą.
      fireEvent.pointerDown(next, { clientX: 200, pointerId: 1 });
      expect(container.querySelector(".is-dragging")).toBeNull();

      fireEvent.click(next);
      expect(currentTitleOf(container)).toBe("Slajd 2");
      fireEvent.click(prev);
      expect(currentTitleOf(container)).toBe("Slajd 1");
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(["editorial-hero", "multi-card", "cinematic-overlay", "split-feature"] as const)(
    "kliknięcie w bylinę autora w wariancie %s zostaje w bylinie",
    (variant) => {
      const spy = vi.fn();
      const { container } = renderWithOuterClick({ variant }, spy);
      fireEvent.click(container.querySelector<HTMLElement>("[data-author-byline]")!);
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(["multi-card", "split-feature"] as const)(
    "strzałki przy kropkach w wariancie %s przewijają karuzelę",
    (variant) => {
      const spy = vi.fn();
      // Multi-card liczy kroki jako `slajdy - (kolumny - 1)`, więc przy trzech
      // slajdach dopiero jedna kolumna daje trzy kroki i trzy kropki.
      const columns: SliderConfig["columns"] = variant === "multi-card" ? 1 : undefined;
      const { container } = renderWithOuterClick({ variant, columns }, spy);
      const activeDot = (): number =>
        Array.from(
          container.querySelectorAll<HTMLElement>('button[aria-label^="Slajd"]'),
        ).findIndex(
          (dot) => dot.className.includes("bg-foreground") && !dot.className.includes("/25"),
        );
      expect(activeDot()).toBe(0);
      fireEvent.click(within(container).getByLabelText("Następny"));
      expect(activeDot()).toBe(1);
      fireEvent.click(within(container).getByLabelText("Poprzedni"));
      expect(activeDot()).toBe(0);
    },
  );

  it("kropki wewnątrz kadru cinematic-overlay przełączają slajd, nie klikając kadru", () => {
    const spy = vi.fn();
    const { container } = renderWithOuterClick({ variant: "cinematic-overlay" }, spy);
    const dots = within(container).getAllByLabelText(/^Slajd \d$/);
    expect(dots).toHaveLength(3);
    fireEvent.click(dots[2]);
    expect(currentTitleOf(container)).toBe("Slajd 3");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("slider - pauza automatu pod kursorem", () => {
  const startAutoplay = (pauseOnHover: boolean) =>
    renderSlider({ items: THREE_SLIDES, autoplay: true, intervalMs: 1500, pauseOnHover });

  it("zatrzymuje automat pod kursorem, gdy pauza jest włączona, i wznawia po zjechaniu", () => {
    vi.useFakeTimers();
    const { container } = startAutoplay(true);
    const root = container.querySelector<HTMLElement>(".eh-slider")!;
    fireEvent.mouseOver(root);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.textContent).toContain("Slajd 1");
    fireEvent.mouseOut(root);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.textContent).toContain("Slajd 2");
  });

  it("nie zatrzymuje automatu pod kursorem, gdy pauza jest wyłączona", () => {
    vi.useFakeTimers();
    const { container } = startAutoplay(false);
    fireEvent.mouseOver(container.querySelector<HTMLElement>(".eh-slider")!);
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(container.textContent).toContain("Slajd 2");
  });
});
