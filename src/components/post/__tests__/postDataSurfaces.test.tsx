// Powierzchnie wpisu czytające dane (query / DOM), które stały na ZERZE.
//
// Wspólna reguła całej tej grupy: KAŻDA renderuje się warunkowo, a warunkiem
// jest „redakcja to wypełniła". Brak sekcji jest tu decyzją produktową („zero
// szumu poza cyklami", „brak wpisów to brak sekcji"), więc test, który sprawdza
// wyłącznie wariant wypełniony, przepuszcza najczęstszy stan produkcyjny.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({ series: null as unknown, changelog: [] as unknown[] }));
const stubs = vi.hoisted(() => ({ from: null as unknown }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouter: () => ({ preloadRoute: vi.fn(), navigate: vi.fn() }),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/lib/queries/series", () => ({
  postSeriesQueryOptions: (postId: string) => ({
    queryKey: ["series", postId],
    queryFn: async () => h.series,
  }),
}));

import { PostChangelog } from "@/components/post/PostChangelog";
import { PostSeriesNav } from "@/components/post/PostSeriesNav";
import { InlineToc } from "@/components/post/InlineToc";
import { GlossaryHighlighter } from "@/components/post/GlossaryHighlighter";
import { QuoteShareBar } from "@/components/post/QuoteShareBar";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import {
  blocksDoc,
  headingBlock,
  paragraphBlock,
  tocDefaults,
} from "@/test/postExperience/fixtures";

const from = () => stubs.from as SupabaseFromStub;

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

beforeEach(() => {
  from().reset();
  h.series = null;
  h.changelog = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostChangelog - historia aktualizacji analizy", () => {
  const rows = [
    {
      id: "c1",
      entry_date: "2026-07-20",
      note_pl: "Zaktualizowano dane o Q2",
      note_en: "Q2 data refreshed",
    },
    { id: "c2", entry_date: "2026-06-01", note_pl: "Pierwsza publikacja", note_en: null },
  ];

  it("BRAK wpisów nie renderuje sekcji (brak szumu przy analizach bez aktualizacji)", async () => {
    from().setResponse("post_changelog", ok([]));
    const { container } = renderWithQuery(<PostChangelog postId="p1" lang="pl" />);
    await waitFor(() => expect(from().chainsFor("post_changelog")).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("renderuje listę wpisów jako sekcję z nagłówkiem", async () => {
    from().setResponse("post_changelog", ok(rows));
    renderWithQuery(<PostChangelog postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Historia aktualizacji" })).toBeInTheDocument();
  });

  it("każdy wpis ma MASZYNOWĄ datę w `datetime` i czytelną obok", async () => {
    from().setResponse("post_changelog", ok(rows));
    const { container } = renderWithQuery(<PostChangelog postId="p1" lang="pl" />);
    await waitFor(() => expect(container.querySelectorAll("time")).toHaveLength(2));
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-07-20");
  });

  it("czyta wpisy TEGO wpisu, najnowsze na górze, z limitem", async () => {
    from().setResponse("post_changelog", ok(rows));
    renderWithQuery(<PostChangelog postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    const chain = from().lastChain("post_changelog");
    expect(chain?.argsOf("eq")).toEqual(["post_id", "p1"]);
    expect(chain?.argsOf("limit")).toEqual([20]);
  });

  it("brak notatki EN degraduje do PL (wpis nigdy nie jest pusty)", async () => {
    from().setResponse("post_changelog", ok(rows));
    renderWithQuery(<PostChangelog postId="p1" lang="en" />);
    await waitFor(() => expect(screen.getByText("Q2 data refreshed")).toBeInTheDocument());
    expect(screen.getByText("Pierwsza publikacja")).toBeInTheDocument();
  });

  it("USZKODZONA data renderuje surową wartość, nie `Invalid Date`", async () => {
    from().setResponse(
      "post_changelog",
      ok([{ id: "c9", entry_date: "nie-data", note_pl: "Notatka", note_en: null }]),
    );
    renderWithQuery(<PostChangelog postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByText("nie-data")).toBeInTheDocument());
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("nagłówek sekcji jest POWIĄZANY z regionem (aria-labelledby)", async () => {
    from().setResponse("post_changelog", ok(rows));
    renderWithQuery(<PostChangelog postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("region")).toBeInTheDocument());
    const region = screen.getByRole("region");
    const headingId = screen.getByRole("heading", { name: "Historia aktualizacji" }).id;
    expect(region).toHaveAttribute("aria-labelledby", headingId);
  });
});

describe("PostSeriesNav - nawigacja po dossier", () => {
  const series = {
    series: { slug: "dossier-cee", name_pl: "Dossier CEE", name_en: "CEE Dossier" },
    part: 2,
    parts: [
      { post_id: "p0", href: "/post/a", title_pl: "Część 1", title_en: "Part 1" },
      { post_id: "p1", href: "/post/b", title_pl: "Część 2", title_en: "Part 2" },
      { post_id: "p2", href: "/post/c", title_pl: "Część 3", title_en: "Part 3" },
    ],
  };

  it("WPIS POZA SERIĄ nie renderuje niczego (zero szumu poza cyklami)", async () => {
    h.series = null;
    const { container } = renderWithQuery(<PostSeriesNav postId="p1" lang="pl" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("renderuje nawigację z nazwą serii i numerem części", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.getByRole("navigation")).toHaveAccessibleName("Dossier: Dossier CEE");
  });

  it("wpis w ŚRODKU serii ma linki wstecz I dalej", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Poprzednia część" })).toHaveAttribute(
      "href",
      "/post/a",
    );
    expect(screen.getByRole("link", { name: "Następna część" })).toHaveAttribute("href", "/post/c");
  });

  it("PIERWSZY wpis serii nie ma linku wstecz", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="p0" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Poprzednia część" })).toBeNull();
    expect(screen.getByRole("link", { name: "Następna część" })).toBeInTheDocument();
  });

  it("OSTATNI wpis serii nie ma linku dalej", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="p2" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Następna część" })).toBeNull();
    expect(screen.getByRole("link", { name: "Poprzednia część" })).toBeInTheDocument();
  });

  it("wpis NIEOBECNY na liście części nie dostaje żadnego z linków", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="obcy" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Poprzednia część" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Następna część" })).toBeNull();
  });

  it("wariant angielski bierze nazwę EN i angielskie etykiety", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="p1" lang="en" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "CEE Dossier" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous part" })).toBeInTheDocument();
  });

  it("link do strony serii prowadzi pod jej slug", async () => {
    h.series = series;
    renderWithQuery(<PostSeriesNav postId="p1" lang="pl" />);
    await waitFor(() => expect(screen.getByRole("navigation")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Dossier CEE" })).toHaveAttribute(
      "href",
      "/series/dossier-cee",
    );
  });
});

describe("InlineToc - spis treści w treści wpisu", () => {
  const doc = blocksDoc(
    headingBlock(2, "Wprowadzenie"),
    paragraphBlock("Tekst"),
    headingBlock(2, "Kluczowe czynniki"),
    headingBlock(3, "Kontekst"),
    headingBlock(2, "Wnioski"),
  );

  it("renderuje spis, gdy globalne WŁĄCZAJĄ go w treści i nagłówków wystarcza", () => {
    const { container } = render(
      <InlineToc
        blocksDoc={doc}
        defaults={tocDefaults({ showInBody: true, minHeadings: 3 })}
        override={null}
        lang="pl"
      />,
    );
    expect(container).not.toBeEmptyDOMElement();
    expect(container.querySelectorAll("a").length).toBeGreaterThan(0);
  });

  it("WYŁĄCZONY spis treści nie renderuje niczego", () => {
    const { container } = render(
      <InlineToc
        blocksDoc={doc}
        defaults={tocDefaults({ enabled: false, showInBody: true })}
        override={null}
        lang="pl"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector("a")).toBeNull();
  });

  it("`showInBody: false` (domyślnie) nie renderuje - spis jest tylko w sidebarze", () => {
    const { container } = render(
      <InlineToc blocksDoc={doc} defaults={tocDefaults()} override={null} lang="pl" />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(tocDefaults().showInBody).toBe(false);
  });

  it("NADPISANIE per wpis potrafi WŁĄCZYĆ spis przy globalnym wyłączeniu w treści", () => {
    const { container } = render(
      <InlineToc
        blocksDoc={doc}
        defaults={tocDefaults({ showInBody: false, minHeadings: 3 })}
        override={{ showInBody: true }}
        lang="pl"
      />,
    );
    expect(container).not.toBeEmptyDOMElement();
    expect(container.querySelectorAll("a").length).toBeGreaterThan(0);
  });

  it("ZA MAŁO nagłówków nie renderuje spisu (dwa punkty to nie spis)", () => {
    const { container } = render(
      <InlineToc
        blocksDoc={blocksDoc(headingBlock(2, "Jeden"), headingBlock(2, "Dwa"))}
        defaults={tocDefaults({ showInBody: true, minHeadings: 3 })}
        override={null}
        lang="pl"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(container.textContent).toBe("");
  });

  it("BRAK dokumentu blokowego nie renderuje spisu", () => {
    const { container } = render(
      <InlineToc
        blocksDoc={null}
        defaults={tocDefaults({ showInBody: true, minHeadings: 1 })}
        override={null}
        lang="pl"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector("nav")).toBeNull();
  });

  it("ZAKRES poziomów odsiewa nagłówki poza nim", () => {
    const { container } = render(
      <InlineToc
        blocksDoc={doc}
        defaults={tocDefaults({ showInBody: true, minHeadings: 1, minLevel: 3, maxLevel: 3 })}
        override={null}
        lang="pl"
      />,
    );
    // Tylko jeden nagłówek H3 w dokumencie - spis nie może pokazać H2.
    expect(container.textContent).toContain("Kontekst");
    expect(container.textContent).not.toContain("Wnioski");
  });
});

describe("GlossaryHighlighter - organizm nad regułą oznaczania", () => {
  const terms = [
    {
      id: "t1",
      slug: "unia-europejska",
      term_pl: "UE",
      term_en: "EU",
      definition_pl: "Unia Europejska",
      definition_en: "European Union",
    },
  ];

  function mount(lang: "pl" | "en" = "pl") {
    const root = document.createElement("div");
    // Treść niesie OBA warianty terminu (PL „UE" i EN „EU"), bo etykieta zależy
    // od języka strony - inaczej wariant angielski nie miałby czego oznaczyć.
    root.innerHTML = "<p>Rola UE w regionie rośnie, a EU debates it too.</p>";
    document.body.appendChild(root);
    const containerRef = { current: root };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["public", "glossary-terms"], terms);
    const view = render(
      <QueryClientProvider client={queryClient}>
        <GlossaryHighlighter containerRef={containerRef} lang={lang} scanKey="p1" />
      </QueryClientProvider>,
    );
    return { root, ...view };
  }

  it("oznacza pierwsze wystąpienie terminu w treści po klatce animacji", async () => {
    const { root } = mount();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(root.querySelectorAll("span[data-glossary-term]")).toHaveLength(1);
    expect(root.textContent).toBe("Rola UE w regionie rośnie, a EU debates it too.");
  });

  it("BEZ aktywnego dymka nie renderuje niczego w swoim drzewie", () => {
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("odmontowanie ZDEJMUJE oznaczenia (treść wraca do oryginału)", async () => {
    const { root, unmount } = mount();
    const before = root.innerHTML;
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(root.innerHTML).not.toBe(before);

    unmount();
    expect(root.innerHTML).toBe(before);
  });

  it("FOKUS na oznaczeniu pokazuje dymek z definicją i linkiem do słowniczka", async () => {
    const { root } = mount();
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const mark = root.querySelector<HTMLElement>("span[data-glossary-term]")!;
    await act(async () => {
      mark.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unia Europejska");
    expect(screen.getByRole("link", { name: "Słowniczek" })).toBeInTheDocument();
  });

  it("wariant angielski pokazuje definicję EN i angielski link", async () => {
    const { root } = mount("en");
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const mark = root.querySelector<HTMLElement>("span[data-glossary-term]")!;
    await act(async () => {
      mark.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent("European Union");
    expect(screen.getByRole("link", { name: "Glossary" })).toBeInTheDocument();
  });

  it("PUSTY słownik nie dotyka treści", async () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Rola UE w regionie.</p>";
    document.body.appendChild(root);
    const before = root.innerHTML;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["public", "glossary-terms"], []);
    render(
      <QueryClientProvider client={queryClient}>
        <GlossaryHighlighter containerRef={{ current: root }} lang="pl" scanKey="p1" />
      </QueryClientProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(root.innerHTML).toBe(before);
    expect(root.querySelectorAll("span[data-glossary-term]")).toHaveLength(0);
  });

  it("BRAK kontenera treści nie wywala organizmu", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["public", "glossary-terms"], terms);
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <GlossaryHighlighter containerRef={{ current: null }} lang="pl" scanKey="p1" />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("QuoteShareBar - pasek udostępniania cytatu", () => {
  function mount(text = "To jest realny cytat z analizy o UE.") {
    const root = document.createElement("div");
    root.innerHTML = `<p>${text}</p>`;
    document.body.appendChild(root);
    // Pasek ciągnie `BrandIcon`, który czyta rejestr ikon marki przez react-query -
    // bez providera cały pasek pada na „No QueryClient set".
    const view = renderWithQuery(
      <QuoteShareBar containerRef={{ current: root }} url="https://nes.eu/post/a" lang="pl" />,
    );
    return { root, ...view };
  }

  /** Odgrywa zaznaczenie tekstu wewnątrz kontenera treści. */
  function selectInside(
    root: HTMLElement,
    quote: string,
    rect = { top: 300, left: 400, width: 200, height: 20 },
  ) {
    const node = root.querySelector("p")!.firstChild!;
    const range = {
      startContainer: node,
      endContainer: node,
      getBoundingClientRect: () => rect,
    };
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => quote,
    } as unknown as Selection);
  }

  it("BEZ zaznaczenia nie renderuje paska (SSR i spoczynek dają null)", () => {
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("zaznaczenie w treści pokazuje pasek z trzema akcjami", async () => {
    const { root } = mount();
    selectInside(root, "To jest realny cytat z analizy.");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(
      screen.getByRole("toolbar", { name: "Udostępnij zaznaczony cytat" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("ZA KRÓTKIE zaznaczenie nie pokazuje paska", async () => {
    const { root, container } = mount();
    selectInside(root, "krótkie");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("zaznaczenie POZA kontenerem treści nie pokazuje paska", async () => {
    const { container } = mount();
    const outside = document.createElement("p");
    outside.textContent = "Komentarz pod artykułem, nie treść.";
    document.body.appendChild(outside);
    vi.spyOn(window, "getSelection").mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => ({
        startContainer: outside.firstChild,
        endContainer: outside.firstChild,
        getBoundingClientRect: () => ({ top: 10, left: 10, width: 100, height: 20 }),
      }),
      toString: () => "Komentarz pod artykułem, nie treść.",
    } as unknown as Selection);

    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("udostępnienie na X otwiera intencję z CYTATEM i adresem", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { root } = mount();
    selectInside(root, "To jest realny cytat z analizy.");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    await act(async () => {
      screen.getByRole("button", { name: "Udostępnij cytat na X" }).click();
    });

    const href = String(openSpy.mock.calls[0][0]);
    expect(href).toContain("x.com/intent/post");
    expect(href).toContain(encodeURIComponent("https://nes.eu/post/a"));
  });

  it("udostępnienie na LinkedIn kopiuje cytat do schowka i otwiera share-offsite", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { root } = mount();
    selectInside(root, "To jest realny cytat z analizy.");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    await act(async () => {
      screen.getByRole("button", { name: "Udostępnij na LinkedIn" }).click();
    });

    expect(writeText).toHaveBeenCalledWith("„To jest realny cytat z analizy.”");
    expect(String(openSpy.mock.calls[0][0])).toContain("linkedin.com/sharing/share-offsite");
  });

  it("kopiowanie cytatu dokłada ATRYBUCJĘ i przełącza etykietę na potwierdzenie", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const { root } = mount();
    selectInside(root, "To jest realny cytat z analizy.");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    await act(async () => {
      screen.getByRole("button", { name: "Kopiuj cytat" }).click();
    });

    expect(String(writeText.mock.calls[0][0])).toContain("https://nes.eu/post/a");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Skopiowano cytat" })).toBeInTheDocument(),
    );
  });

  it("ZABLOKOWANY schowek nie wywala paska ani nie kłamie o skopiowaniu", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const { root } = mount();
    selectInside(root, "To jest realny cytat z analizy.");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });

    await act(async () => {
      screen.getByRole("button", { name: "Kopiuj cytat" }).click();
    });

    expect(screen.getByRole("button", { name: "Kopiuj cytat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skopiowano cytat" })).toBeNull();
  });

  it("pasek jest UKRYTY W DRUKU i stoi na pozycji z reguły", async () => {
    const { root } = mount();
    selectInside(root, "To jest realny cytat z analizy.");
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    });
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.className).toContain("no-print");
    expect(toolbar.getAttribute("style")).toContain("top: 256px");
  });
});
