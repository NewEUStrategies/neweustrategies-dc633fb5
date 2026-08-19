// Gałęzie warstw atoms / molecules / organisms renderera bloków.
//
// Macierze pokrywają „dane pełne" i „dane puste". Zostaje trzecia kategoria,
// której żadna z nich nie dotyka: ścieżki włączane NIE przez dane bloku, lecz
// przez KONTEKST renderu -
//   * `fnHtml` - mapa treści z rozwiniętymi przypisami `[fn]…[/fn]`. Gdy wpis
//     dla pola istnieje, renderer WSTRZYKUJE gotowy HTML zamiast tekstu; ta
//     ścieżka ma osobny kod w nagłówku, cytacie, liście i komórce tabeli,
//   * inline HTML z buildera (pogrubienie / kursywa w polu tekstowym),
//   * kotwice zgodności wstecznej nagłówka (`data-anchor-alias`),
//   * wyliczenia wariantów (cytat, separator, callout, przycisk) - każdy
//     wariant to osobna gałąź, a rejestr mapuje tylko dane, nie warianty.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BlockView, BlocksTenantProvider, precomputeFootnotes } from "@/components/blocks/renderer";
import { createCounter } from "@/lib/footnotes";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});
vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useNavigate: () => () => undefined,
    useRouter: () => ({ navigate: () => undefined }),
    useSearch: () => ({}),
    useParams: () => ({}),
  };
});
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return { ...actual, ...serverFnStubModule(), useServerFn: () => async () => ({}) };
});
vi.mock("@/lib/queries/blocks", () => {
  const opts = (key: readonly unknown[], value: () => unknown) => ({
    queryKey: key,
    queryFn: async () => value(),
    staleTime: 0,
    gcTime: 0,
  });
  return {
    latestPostsBlockQueryOptions: (i: unknown) => opts(["lp", i], () => []),
    queryLoopBlockQueryOptions: (i: unknown) => opts(["ql", i], () => []),
    relatedPostsBlockQueryOptions: (i: unknown) => opts(["rp", i], () => []),
    morePostsBlockQueryOptions: (i: unknown) => opts(["mp", i], () => []),
    blockCategoriesQueryOptions: (i: unknown) => opts(["cat", i], () => []),
    blockArchivesQueryOptions: (i: unknown) => opts(["arch", i], () => []),
    blockTagsQueryOptions: (i: unknown) => opts(["tags", i], () => []),
    blockNavigationQueryOptions: () => opts(["nav"], () => []),
    postNeighborQueryOptions: (i: unknown) => opts(["nb", i], () => null),
    pollBlockQueryOptions: (i: unknown) => opts(["poll", i], () => null),
    authorProfileByIdQueryOptions: (i: unknown) => opts(["ap", i], () => null),
    authorPostsCountQueryOptions: (i: unknown) => opts(["apc", i], () => 0),
    calendarBlockQueryOptions: (i: unknown) => opts(["cal", i], () => []),
    calendarTarget: () => ({ year: 2026, month: 8 }),
    liveBlogEntriesBlockQueryOptions: (i: unknown) => opts(["lb", i], () => []),
  };
});
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const link of [
    "select",
    "insert",
    "update",
    "upsert",
    "delete",
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "is",
    "not",
    "like",
    "ilike",
    "or",
    "filter",
    "match",
    "contains",
    "overlaps",
    "order",
    "limit",
    "range",
    "returns",
    "abortSignal",
  ]) {
    chain[link] = () => chain;
  }
  chain.single = async () => ({ data: null, error: null });
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (f?: (v: unknown) => unknown) =>
    Promise.resolve({ data: [], error: null, count: 0 }).then(f);
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => undefined };
  return {
    supabase: {
      from: () => chain,
      rpc: async () => ({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});

const POST_CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "wpis",
  title_pl: "Tytuł",
  title_en: "Title",
  publishedAt: "2026-08-01T10:00:00.000Z",
};

function Wrap({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <CurrentPostProvider value={POST_CTX}>
        <BlocksTenantProvider host="nes.test">{children}</BlocksTenantProvider>
      </CurrentPostProvider>
    </QueryClientProvider>
  );
}

const blockOf = (type: BlockType, data: Record<string, unknown>, id = `b_${type}`): Block => ({
  id,
  type,
  data: data as Record<string, Json>,
});

/**
 * Render z PRAWDZIWĄ mapą przypisów - `precomputeFootnotes` liczy ją tak samo
 * jak `BlocksRenderer`, więc test wchodzi w tę samą ścieżkę co produkcja,
 * a nie w ręcznie sklejoną atrapę mapy.
 */
function renderWithFootnotes(blocks: Block[]): HTMLElement {
  const fn = createCounter(1);
  const fnHtml = new Map<string, string>();
  precomputeFootnotes(blocks, fn, fnHtml);
  const { container } = render(
    <Wrap>
      {blocks.map((b) => (
        <BlockView key={b.id} block={b} fnHtml={fnHtml} lang="pl" allBlocks={blocks} />
      ))}
    </Wrap>,
  );
  return container;
}

function renderPlain(block: Block, allBlocks: Block[] = [block]): HTMLElement {
  const { container } = render(
    <Wrap>
      <BlockView block={block} fnHtml={new Map()} lang="pl" allBlocks={allBlocks} />
    </Wrap>,
  );
  return container;
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date"];
function assertNoLeak(container: HTMLElement, label: string): void {
  const text = container.textContent ?? "";
  for (const leak of LEAKS) {
    expect(text.includes(leak), `${label}: wyciekło "${leak}"`).toBe(false);
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("atoms - treść z rozwiniętymi przypisami", () => {
  it("akapit z przypisem dostaje wstrzyknięty HTML z markerem", () => {
    const container = renderWithFootnotes([
      blockOf("paragraph", { html: "<p>Teza[fn]Źródło pierwsze[/fn].</p>" }),
    ]);
    expect(container.querySelector("[data-fn-ref], sup, a")).toBeTruthy();
    expect(container.textContent).toContain("Teza");
  });

  it("nagłówek z przypisem idzie ścieżką wstrzykniętego HTML-a", () => {
    const container = renderWithFootnotes([
      blockOf("heading", { level: 2, text: "Nagłówek[fn]Przypis nagłówka[/fn]", anchor: "" }),
    ]);
    const heading = container.querySelector("h2");
    expect(heading).toBeTruthy();
    expect(heading?.textContent).toContain("Nagłówek");
  });

  it("cytat z przypisem w treści ORAZ w źródle rozwija oba", () => {
    const container = renderWithFootnotes([
      blockOf("quote", {
        text: "Treść[fn]Przypis treści[/fn]",
        cite: "Autor[fn]Przypis autora[/fn]",
      }),
    ]);
    expect(container.textContent).toContain("Treść");
    expect(container.textContent).toContain("Autor");
    assertNoLeak(container, "quote z przypisami");
  });

  it("pozycja listy z przypisem idzie ścieżką wstrzykniętego HTML-a", () => {
    const container = renderWithFootnotes([
      blockOf("list", { ordered: false, items: ["Pozycja[fn]Przypis pozycji[/fn]", "Zwykła"] }),
    ]);
    expect(container.textContent).toContain("Pozycja");
    expect(container.textContent).toContain("Zwykła");
  });

  it("komórka tabeli z przypisem idzie ścieżką wstrzykniętego HTML-a", () => {
    const container = renderWithFootnotes([
      blockOf("table", { header: true, rows: [["Nagłówek"], ["Komórka[fn]Przypis komórki[/fn]"]] }),
    ]);
    expect(container.textContent).toContain("Komórka");
  });

  it("blok html z przypisem rozwija marker", () => {
    const container = renderWithFootnotes([
      blockOf("html", { html: "<div>Treść[fn]Przypis[/fn]</div>" }),
    ]);
    expect(container.textContent).toContain("Treść");
  });

  it("dokument BEZ przypisów renderuje się bez wstrzykiwania HTML-a", () => {
    const container = renderWithFootnotes([blockOf("paragraph", { html: "<p>Bez przypisów</p>" })]);
    expect(container.textContent).toBe("Bez przypisów");
  });

  it("przypis PUSTY nie zużywa numeru ani nie zostawia markera", () => {
    const container = renderWithFootnotes([blockOf("paragraph", { html: "<p>A[fn] [/fn]B</p>" })]);
    assertNoLeak(container, "pusty przypis");
  });

  it("wiele przypisów w jednym akapicie numeruje się rosnąco", () => {
    const container = renderWithFootnotes([
      blockOf("paragraph", { html: "<p>A[fn]Pierwszy[/fn] B[fn]Drugi[/fn]</p>" }),
    ]);
    expect(container.textContent).toContain("A");
    expect(container.textContent).toContain("B");
  });
});

describe("atoms - inline HTML z buildera", () => {
  it("nagłówek z formatowaniem inline renderuje znaczniki, nie ich tekst", () => {
    const container = renderPlain(
      blockOf("heading", { level: 2, text: "Tytuł <strong>ważny</strong>", anchor: "" }),
    );
    expect(container.querySelector("h2 strong")).toBeTruthy();
    expect(container.textContent).not.toContain("<strong>");
  });

  it("nagłówek z CZYSTYM tekstem nie przechodzi ścieżką HTML-a", () => {
    const container = renderPlain(
      blockOf("heading", { level: 2, text: "Zwykły tytuł", anchor: "" }),
    );
    expect(container.querySelector("h2")?.textContent).toBe("Zwykły tytuł");
  });

  it("nagłówek SANITYZUJE wstrzyknięty skrypt", () => {
    const container = renderPlain(
      blockOf("heading", { level: 2, text: "T <script>alert(1)</script>", anchor: "" }),
    );
    expect(container.querySelector("script")).toBeNull();
  });

  it("pozycja listy z formatowaniem inline renderuje znaczniki", () => {
    const container = renderPlain(
      blockOf("list", { ordered: false, items: ["Pozycja <em>skośna</em>"] }),
    );
    expect(container.querySelector("em")).toBeTruthy();
  });

  it("pozycja listy sanityzuje wstrzyknięty skrypt", () => {
    const container = renderPlain(
      blockOf("list", { ordered: false, items: ["<img src=x onerror=alert(1)>tekst"] }),
    );
    expect(container.innerHTML).not.toContain("onerror");
  });
});

describe("atoms - kotwice nagłówka", () => {
  it("nagłówek dostaje identyfikator wyliczony ze slugu tekstu", () => {
    const container = renderPlain(
      blockOf("heading", { level: 2, text: "Sekcja pierwsza", anchor: "" }),
    );
    expect(container.querySelector("h2")?.getAttribute("id")).toBeTruthy();
  });

  it("jawna kotwica z panelu wygrywa nad wyliczoną", () => {
    const container = renderPlain(
      blockOf("heading", { level: 2, text: "Sekcja", anchor: "moja-kotwica" }),
    );
    expect(container.querySelector("h2")?.getAttribute("id")).toBe("moja-kotwica");
  });

  it("dwa nagłówki o tej samej treści dostają RÓŻNE identyfikatory", () => {
    const blocks = [
      blockOf("heading", { level: 2, text: "Sekcja", anchor: "" }, "b_h1"),
      blockOf("heading", { level: 2, text: "Sekcja", anchor: "" }, "b_h2"),
    ];
    const { container } = render(
      <Wrap>
        {blocks.map((b) => (
          <BlockView key={b.id} block={b} fnHtml={new Map()} lang="pl" allBlocks={blocks} />
        ))}
      </Wrap>,
    );
    const ids = Array.from(container.querySelectorAll("h2")).map((h) => h.getAttribute("id"));
    expect(new Set(ids).size).toBe(2);
  });

  it("nagłówek z polskimi znakami daje kotwicę ASCII", () => {
    const container = renderPlain(
      blockOf("heading", { level: 2, text: "Zażółć gęślą jaźń", anchor: "" }),
    );
    const id = container.querySelector("h2")?.getAttribute("id") ?? "";
    expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("nagłówek PUSTY nie dostaje identyfikatora ze slugu pustego tekstu", () => {
    const container = renderPlain(blockOf("heading", { level: 2, text: "", anchor: "" }));
    assertNoLeak(container, "nagłówek pusty");
  });

  it.each([1, 2, 3, 4, 5, 6, 0, 9])("poziom %i klampuje się do h2-h5", (level) => {
    const container = renderPlain(blockOf("heading", { level, text: "T", anchor: "" }));
    expect(container.querySelector("h2,h3,h4,h5")).toBeTruthy();
  });

  // Kontrakt jest zawężony ŚWIADOMIE (komentarz w atoms.tsx: „tylko hex /
  // token var(--…)"): dowolna funkcja CSS w tym miejscu to wektor na
  // wstrzyknięcie, bo wartość idzie prosto do atrybutu `style`.
  it.each(["#123456", "#abc", "var(--brand)"])("kolor nagłówka %s przechodzi do stylu", (color) => {
    const container = renderPlain(blockOf("heading", { level: 2, text: "T", color }));
    expect(container.querySelector("h2")?.getAttribute("style")).toBeTruthy();
  });

  it.each([
    "rgb(1,2,3)",
    "javascript:alert(1)",
    "url(evil)",
    "expression(1)",
    "śmieć",
    "red; background:url(x)",
  ])("kolor spoza kontraktu (%s) jest odrzucany", (color) => {
    const container = renderPlain(blockOf("heading", { level: 2, text: "T", color }));
    const style = container.querySelector("h2")?.getAttribute("style") ?? "";
    expect(style).toBe("");
  });
});

describe("atoms - warianty cytatu, separatora, przycisku, listy", () => {
  it.each(["default", "plain", "card", "minimal", "nieznany"])(
    "cytat w wariancie %s renderuje treść",
    (variant) => {
      const container = renderPlain(
        blockOf("quote", { text: "Treść cytatu", cite: "Autor", variant }),
      );
      expect(container.textContent).toContain("Treść cytatu");
      // Źródło ma być poprzedzone DYWIZEM, nigdy pauzą (reguła typograficzna
      // tego repo - patrz istniejący test rejestru).
      expect(container.textContent).toContain("- Autor");
      expect(container.textContent).not.toContain("—");
    },
  );

  it.each(["default", "plain", "card", "minimal"])(
    "cytat w wariancie %s BEZ źródła nie renderuje pustego cite",
    (variant) => {
      const container = renderPlain(blockOf("quote", { text: "Treść", variant }));
      expect(container.querySelector("cite")).toBeNull();
    },
  );

  it.each(["neutral", "brand", "primary", "accent", "success", "warning", "danger", "nieznany"])(
    "cytat z paletą %s renderuje treść",
    (colorPalette) => {
      const container = renderPlain(blockOf("quote", { text: "T", colorPalette }));
      expect(container.textContent).toContain("T");
    },
  );

  it.each(["line", "dots", "wide", "nieznany"])(
    "separator w wariancie %s renderuje się",
    (variant) => {
      const container = renderPlain(blockOf("separator", { variant }));
      expect(container.innerHTML.length).toBeGreaterThan(0);
    },
  );

  it.each(["info", "warning", "success", "danger", "nieznany"])(
    "callout w wariancie %s renderuje treść",
    (variant) => {
      const container = renderPlain(blockOf("callout", { variant, text: "Komunikat" }));
      expect(container.textContent).toContain("Komunikat");
    },
  );

  it("callout BEZ treści nie renderuje pustej ramki", () => {
    const container = renderPlain(blockOf("callout", { variant: "info", text: "" }));
    assertNoLeak(container, "callout pusty");
  });

  it.each(["default", "outline", "ghost", "nieznany"])(
    "przycisk w wariancie %s renderuje odnośnik",
    (variant) => {
      const container = renderPlain(
        blockOf("button", { label: "Kliknij", href: "https://x.test/a", variant }),
      );
      expect(container.querySelector("a")?.textContent).toBe("Kliknij");
    },
  );

  it("przycisk BEZ etykiety nie renderuje odnośnika", () => {
    const container = renderPlain(blockOf("button", { href: "/x" }));
    expect(container.querySelector("a")).toBeNull();
  });

  it.each(["javascript:alert(1)", "data:text/html,x"])(
    "przycisk z adresem %s nie wstrzykuje go do href",
    (href) => {
      const container = renderPlain(blockOf("button", { label: "Kliknij", href }));
      const got = container.querySelector("a")?.getAttribute("href") ?? "";
      expect(got).not.toContain("javascript:");
      expect(got).not.toContain("data:text/html");
    },
  );

  it("lista ZAGNIEŻDŻONA renderuje podlisty", () => {
    const container = renderPlain(
      blockOf("list", {
        ordered: false,
        items: ["Pierwszy", "Podpunkt", "Drugi"],
        levels: [1, 2, 1],
      }),
    );
    expect(container.querySelectorAll("ul,ol").length).toBeGreaterThanOrEqual(2);
  });

  it("lista MIESZANA respektuje rodzaj per pozycja", () => {
    const container = renderPlain(
      blockOf("list", {
        ordered: false,
        items: ["Punkt", "Numer"],
        levels: [1, 2],
        itemsOrdered: [false, true],
      }),
    );
    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelector("ul")).toBeTruthy();
  });

  it("lista z numerem startowym renderuje atrybut start", () => {
    const container = renderPlain(blockOf("list", { ordered: true, items: ["A"], start: 5 }));
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("5");
  });

  it("lista pomija pozycje PUSTE, zachowuje te z samą spacją", () => {
    // Filtr to `Boolean(it)`, więc `""` wypada, a `"  "` zostaje. Rozróżnienie
    // jest celowe: spacja bywa świadomym odstępem w wypunktowaniu z Worda.
    const container = renderPlain(blockOf("list", { ordered: false, items: ["A", "", "  ", "B"] }));
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("lista złożona z samych pozycji PUSTYCH nie renderuje wypunktowania", () => {
    const container = renderPlain(blockOf("list", { ordered: false, items: ["", ""] }));
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("lista z levels o innej długości niż items nie wywala renderu", () => {
    const container = renderPlain(
      blockOf("list", { ordered: false, items: ["A", "B", "C"], levels: [1] }),
    );
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it.each([1, 24, 120, 0, -10])("odstęp o wysokości %i renderuje się", (height) => {
    const container = renderPlain(blockOf("spacer", { height }));
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });
});

describe("molecules - atrybucja źródła i warianty mediów", () => {
  it("obraz ze ŹRÓDŁEM i adresem źródła renderuje odnośnik atrybucji", () => {
    const container = renderPlain(
      blockOf("image", {
        url: "https://cdn.test/a.jpg",
        source: "Agencja",
        sourceUrl: "https://x.test/z",
      }),
    );
    expect(container.textContent).toContain("Agencja");
    expect(
      Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).toContain("https://x.test/z");
  });

  it("obraz ze źródłem BEZ adresu renderuje sam napis", () => {
    const container = renderPlain(
      blockOf("image", { url: "https://cdn.test/a.jpg", source: "Agencja" }),
    );
    expect(container.textContent).toContain("Agencja");
  });

  it("obraz BEZ źródła nie renderuje pustej atrybucji", () => {
    const container = renderPlain(blockOf("image", { url: "https://cdn.test/a.jpg" }));
    assertNoLeak(container, "obraz bez źródła");
  });

  it.each([
    ["small", "max-w-xs"],
    ["medium", "max-w-md"],
    ["full", "w-full"],
    ["nieznany", "w-full"],
  ])("obraz w rozmiarze %s dostaje klasę %s", (size, cls) => {
    const container = renderPlain(blockOf("image", { url: "https://cdn.test/a.jpg", size }));
    expect(container.innerHTML).toContain(cls);
  });

  it.each(["left", "center", "right", "nieznany"])(
    "obraz z wyrównaniem %s renderuje się",
    (align) => {
      const container = renderPlain(blockOf("image", { url: "https://cdn.test/a.jpg", align }));
      expect(container.querySelector("img, picture, span")).toBeTruthy();
    },
  );

  it("obraz z wymiarami przekazuje je do znacznika", () => {
    const container = renderPlain(
      blockOf("image", { url: "https://cdn.test/a.jpg", width: 800, height: 600 }),
    );
    expect(container.innerHTML).toContain("800");
  });

  it.each([
    ["szerokość zerowa", { width: 0, height: 600 }],
    ["wysokość ujemna", { width: 800, height: -1 }],
    ["wymiary nieliczbowe", { width: "abc", height: "def" }],
  ])("obraz z %s pomija atrybuty wymiarów", (_l, dims) => {
    const container = renderPlain(blockOf("image", { url: "https://cdn.test/a.jpg", ...dims }));
    assertNoLeak(container, "obraz wymiary");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd"])(
    "obraz o adresie %s NIE jest renderowany",
    (url) => {
      const container = renderPlain(blockOf("image", { url }));
      expect(container.innerHTML).toBe("");
    },
  );

  it("wideo ze źródłem renderuje atrybucję i napisy", () => {
    const container = renderPlain(
      blockOf("video", {
        url: "https://cdn.test/v.mp4",
        source: "Studio",
        sourceUrl: "https://x.test/s",
        captionsUrl: "https://cdn.test/v.vtt",
        caption: "Podpis",
      }),
    );
    expect(container.textContent).toContain("Studio");
    expect(container.innerHTML).toContain("v.vtt");
  });

  it.each(["16/9", "4/3", "1/1", "nieznany"])("wideo w proporcjach %s renderuje się", (aspect) => {
    const container = renderPlain(blockOf("video", { url: "https://cdn.test/v.mp4", aspect }));
    expect(container.innerHTML.length).toBeGreaterThan(0);
  });

  it("audio z okładką i pobieraniem renderuje oba elementy", () => {
    const container = renderPlain(
      blockOf("audio", {
        url: "https://cdn.test/a.mp3",
        cover: "https://cdn.test/c.jpg",
        download: true,
        caption: "Podpis",
        source: "Podcast",
        sourceUrl: "https://x.test/p",
      }),
    );
    expect(container.textContent).toContain("Podcast");
    expect(container.innerHTML).toContain("a.mp3");
  });

  it("audio BEZ okładki i pobierania renderuje sam odtwarzacz", () => {
    const container = renderPlain(blockOf("audio", { url: "https://cdn.test/a.mp3" }));
    assertNoLeak(container, "audio minimalne");
  });

  it("plik z przyciskiem i etykietą renderuje odnośnik", () => {
    const container = renderPlain(
      blockOf("file", { url: "https://cdn.test/p.pdf", label: "Raport", showButton: true }),
    );
    expect(container.textContent).toContain("Raport");
  });

  it("plik BEZ przycisku renderuje sam odnośnik", () => {
    const container = renderPlain(
      blockOf("file", { url: "https://cdn.test/p.pdf", label: "Raport", showButton: false }),
    );
    expect(container.textContent).toContain("Raport");
  });

  it.each(["left", "right", "nieznany"])(
    "media-text z grafiką po %s renderuje oba",
    (mediaPosition) => {
      const container = renderPlain(
        blockOf("media-text", {
          url: "https://cdn.test/a.jpg",
          text: "<p>Tekst obok</p>",
          mediaPosition,
        }),
      );
      expect(container.textContent).toContain("Tekst obok");
    },
  );

  it.each([0, 40, 100])("okładka z przyciemnieniem %i renderuje się", (overlay) => {
    const container = renderPlain(
      blockOf("cover", { url: "https://cdn.test/c.jpg", title: "T", overlay }),
    );
    expect(container.textContent).toContain("T");
  });

  it("okładka BEZ tytułu renderuje samo tło", () => {
    const container = renderPlain(blockOf("cover", { url: "https://cdn.test/c.jpg" }));
    assertNoLeak(container, "okładka bez tytułu");
  });

  it.each(["left", "center", "right", "nieznany"])(
    "grupa przycisków z wyrównaniem %s renderuje wszystkie",
    (align) => {
      const container = renderPlain(
        blockOf("buttons", {
          align,
          items: [
            { label: "A", href: "/a", variant: "default" },
            { label: "B", href: "/b", variant: "outline" },
            { label: "C", href: "/c", variant: "ghost" },
          ],
        }),
      );
      expect(container.querySelectorAll("a")).toHaveLength(3);
    },
  );

  it("grupa przycisków pomija pozycję BEZ etykiety", () => {
    const container = renderPlain(
      blockOf("buttons", { items: [{ href: "/a" }, { label: "B", href: "/b" }] }),
    );
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("ikony społecznościowe pomijają pozycję o nieznanej platformie", () => {
    const container = renderPlain(
      blockOf("social-icons", {
        items: [
          { platform: "facebook", url: "https://facebook.com/x" },
          { platform: "platforma-z-przyszlosci", url: "https://x.test" },
        ],
      }),
    );
    assertNoLeak(container, "social icons");
  });

  it.each([16, 24, 48, 0, -10])("ikony społecznościowe o rozmiarze %i renderują się", (size) => {
    const container = renderPlain(
      blockOf("social-icons", { size, items: [{ platform: "x", url: "https://x.com/a" }] }),
    );
    assertNoLeak(container, `social icons size=${size}`);
  });

  it("tabela z nagłówkiem renderuje thead", () => {
    const container = renderPlain(
      blockOf("table", {
        header: true,
        rows: [
          ["A", "B"],
          ["1", "2"],
        ],
      }),
    );
    expect(container.querySelector("thead")).toBeTruthy();
  });

  it("tabela BEZ nagłówka nie renderuje thead", () => {
    const container = renderPlain(blockOf("table", { header: false, rows: [["1", "2"]] }));
    expect(container.querySelector("thead")).toBeNull();
  });

  it("tabela ze scaleniami komórek renderuje atrybuty colspan/rowspan", () => {
    const container = renderPlain(
      blockOf("table", {
        rows: [["A", "B"]],
        spans: [
          [
            [2, 1],
            [1, 2],
          ],
        ],
      }),
    );
    expect(container.innerHTML).toMatch(/colspan|rowspan/i);
  });

  it("tabela z wyrównaniami komórek renderuje styl", () => {
    const container = renderPlain(
      blockOf("table", { rows: [["A", "B"]], aligns: [["center", "right"]] }),
    );
    expect(container.innerHTML).toMatch(/center|right/);
  });

  it.each([
    ["rows nie-tablica", { rows: "x" }],
    ["wiersz nie-tablica", { rows: ["x"] }],
    ["rows puste", { rows: [] }],
  ])("tabela z %s nie wywala renderu", (_l, data) => {
    const container = renderPlain(blockOf("table", data));
    assertNoLeak(container, "tabela zdegenerowana");
  });

  it("spoiler domyślnie OTWARTY ma atrybut open", () => {
    const container = renderPlain(
      blockOf("spoiler", { summary: "Rozwiń", html: "<p>Treść</p>", defaultOpen: true }),
    );
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(true);
  });

  it("spoiler domyślnie ZAMKNIĘTY nie ma atrybutu open", () => {
    const container = renderPlain(
      blockOf("spoiler", { summary: "Rozwiń", html: "<p>Treść</p>", defaultOpen: false }),
    );
    expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  it("spoiler BEZ podsumowania dostaje etykietę zastępczą", () => {
    const container = renderPlain(blockOf("spoiler", { html: "<p>Treść</p>" }));
    assertNoLeak(container, "spoiler bez podsumowania");
    expect(container.querySelector("summary")).toBeTruthy();
  });

  it("osadzenie z rozpoznanym dostawcą renderuje iframe", () => {
    const container = renderPlain(blockOf("embed", { url: "https://youtu.be/dQw4w9WgXcQ" }));
    expect(container.querySelector("iframe")).toBeTruthy();
  });

  it("osadzenie NIEROZPOZNANE renderuje odnośnik, nie iframe", () => {
    const container = renderPlain(blockOf("embed", { url: "https://nieznany.test/x" }));
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("a")).toBeTruthy();
  });

  it("osadzenie z PUSTYM adresem nie renderuje niczego", () => {
    const container = renderPlain(blockOf("embed", { url: "" }));
    expect(container.innerHTML).toBe("");
  });

  it.each(["javascript:alert(1)", "to nie adres"])(
    "osadzenie o adresie %s nie renderuje iframe",
    (url) => {
      const container = renderPlain(blockOf("embed", { url }));
      expect(container.querySelector("iframe")).toBeNull();
    },
  );
});

describe("organisms - kontenery rekurencyjne", () => {
  it.each(["muted", "brand", "transparent", "nieznany"])(
    "grupa z tłem %s renderuje dzieci",
    (background) => {
      const container = renderPlain(
        blockOf("group", {
          background,
          children: [{ id: "b_c", type: "paragraph", data: { html: "<p>W grupie</p>" } }],
        }),
      );
      expect(container.textContent).toContain("W grupie");
    },
  );

  it.each([0, 8, 24, 64])("grupa z wypełnieniem %i renderuje dzieci", (padding) => {
    const container = renderPlain(
      blockOf("group", {
        padding,
        children: [{ id: "b_c", type: "paragraph", data: { html: "<p>W grupie</p>" } }],
      }),
    );
    expect(container.textContent).toContain("W grupie");
  });

  it.each(["constrained", "full", "nieznany"])("grupa w układzie %s renderuje dzieci", (layout) => {
    const container = renderPlain(
      blockOf("group", {
        layout,
        children: [{ id: "b_c", type: "paragraph", data: { html: "<p>W grupie</p>" } }],
      }),
    );
    expect(container.textContent).toContain("W grupie");
  });

  it.each(["row", "stack", "grid"] as const)("%s z kolumnami renderuje dzieci", (type) => {
    const container = renderPlain(
      blockOf(type, {
        columns: 3,
        children: [{ id: "b_c", type: "paragraph", data: { html: "<p>Wewnątrz</p>" } }],
      }),
    );
    expect(container.textContent).toContain("Wewnątrz");
  });

  it.each([1, 2, 3, 4, 0, -1, 99])("siatka o %i kolumnach renderuje dzieci", (columns) => {
    const container = renderPlain(
      blockOf("grid", {
        columns,
        children: [{ id: "b_c", type: "paragraph", data: { html: "<p>Wewnątrz</p>" } }],
      }),
    );
    expect(container.textContent).toContain("Wewnątrz");
  });

  it("kolumny renderują lewą PRZED prawą", () => {
    const container = renderPlain(
      blockOf("columns", {
        left: [{ id: "b_l", type: "paragraph", data: { html: "<p>Lewa</p>" } }],
        right: [{ id: "b_r", type: "paragraph", data: { html: "<p>Prawa</p>" } }],
      }),
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Lewa")).toBeLessThan(text.indexOf("Prawa"));
  });

  it("kontener honoruje ukrycie dziecka REKURENCYJNIE", () => {
    const container = renderPlain(
      blockOf("group", {
        children: [
          { id: "b_v", type: "paragraph", data: { html: "<p>Widoczne</p>" } },
          {
            id: "b_h",
            type: "paragraph",
            data: { html: "<p>Ukryte</p>" },
            style: { hidden: true },
          },
        ],
      }),
    );
    expect(container.textContent).toContain("Widoczne");
    expect(container.textContent).not.toContain("Ukryte");
  });

  it("kontener zagnieżdżony DWUPOZIOMOWO renderuje najgłębsze dziecko", () => {
    const container = renderPlain(
      blockOf("group", {
        children: [
          {
            id: "b_mid",
            type: "group",
            data: {
              children: [{ id: "b_deep", type: "paragraph", data: { html: "<p>Głęboko</p>" } }],
            },
          },
        ],
      }),
    );
    expect(container.textContent).toContain("Głęboko");
  });

  it.each([
    ["children nie-tablica", { children: "x" }],
    ["children puste", { children: [] }],
    ["wpis bez type", { children: [{ id: "x" }] }],
  ])("kontener z %s nie wywala renderu", (_l, data) => {
    const container = renderPlain(blockOf("group", data));
    assertNoLeak(container, "kontener zdegenerowany");
  });
});
