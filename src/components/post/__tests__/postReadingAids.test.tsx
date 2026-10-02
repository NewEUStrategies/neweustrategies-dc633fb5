// Pomoce czytelnika nad treścią wpisu: dymek słowniczka i pasek udostępniania
// zaznaczonego cytatu - CYKL ŻYCIA, którego nie pokrywa `postDataSurfaces`.
//
// Tamten plik dowodzi, że dymek i pasek się POJAWIAJĄ. Ten - że ZNIKAJĄ
// wtedy, kiedy trzeba, i ani chwili wcześniej:
//   * dymek słowniczka chowa się z opóźnieniem 200 ms (przejście kursora
//     z terminu na dymek nie może go zgasić), a powrót na termin to opóźnienie
//     anuluje;
//   * potwierdzenie „Skopiowano cytat" wraca do „Kopiuj cytat" po 1,6 s, a
//     drugie kopiowanie nie skraca tego okna starym licznikiem;
//   * pasek trzyma zaznaczenie przy kliknięciu (preventDefault na pointerdown)
//     i znika razem z zaznaczeniem.
//
// Zaznaczenie jest PRAWDZIWE (`Range` + `Selection` happy-dom), a atrapą jest
// wyłącznie prostokąt zakresu - happy-dom nie liczy układu i oddaje zera,
// które reguła paska słusznie odrzuca jako „nie ma nad czym stanąć".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  /** Odpowiedź słowniczka - `null` = zapytanie wciąż wisi. */
  terms: null as unknown[] | null,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/queries/glossary", () => ({
  glossaryTermsQueryOptions: () => ({
    queryKey: ["public", "glossary-terms"],
    queryFn: () => (h.terms ? Promise.resolve(h.terms) : new Promise<never>(() => undefined)),
  }),
}));

import { GlossaryHighlighter } from "@/components/post/GlossaryHighlighter";
import { QuoteShareBar } from "@/components/post/QuoteShareBar";

const TERMS = [
  {
    id: "t1",
    slug: "unia-europejska",
    term_pl: "UE",
    term_en: "",
    definition_pl: "Unia Europejska",
    definition_en: "",
  },
];

function withQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** Kontener treści z gotowym oznaczeniem terminu (skan ma własne testy). */
function article(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

function mark(root: HTMLElement, slug = "unia-europejska"): HTMLElement {
  const el = root.querySelector<HTMLElement>(`span[data-glossary-term="${slug}"]`);
  if (!el) throw new Error(`brak oznaczenia ${slug}`);
  return el;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GlossaryHighlighter - cykl życia dymka", () => {
  beforeEach(() => {
    h.terms = TERMS;
    vi.useFakeTimers();
  });

  async function mountGlossary(lang: "pl" | "en" = "pl") {
    const root = article(
      '<p>Rola <span data-glossary-term="unia-europejska">UE</span> rośnie. <a href="/x">Link</a></p>',
    );
    withQuery(<GlossaryHighlighter containerRef={{ current: root }} lang={lang} scanKey="p1" />);
    // Słowniczek dojeżdża z zapytania (mikrozadanie), skan - po bezczynności.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    return root;
  }

  it("wyjście z terminu chowa dymek PO 200 ms, nie natychmiast", async () => {
    const root = await mountGlossary();
    fireEvent.focusIn(mark(root));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unia Europejska");

    fireEvent.focusOut(mark(root));
    act(() => vi.advanceTimersByTime(199));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("powrót na termin przed upływem opóźnienia ANULUJE chowanie dymka", async () => {
    const root = await mountGlossary();
    fireEvent.mouseEnter(mark(root));
    fireEvent.mouseLeave(mark(root));
    act(() => vi.advanceTimersByTime(150));

    fireEvent.mouseEnter(mark(root));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("tooltip")).toHaveTextContent("UE");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unia Europejska");
  });

  it("wejście na element, który NIE jest terminem, nie otwiera dymka ani nie anuluje chowania", async () => {
    const root = await mountGlossary();
    const link = root.querySelector("a");
    if (!link) throw new Error("brak linku w treści");

    fireEvent.focusIn(link);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focusIn(mark(root));
    fireEvent.focusOut(mark(root));
    fireEvent.focusIn(link);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("dymek stoi nad ŚRODKIEM terminu, 8 px nad jego górną krawędzią", async () => {
    const root = await mountGlossary();
    vi.spyOn(mark(root), "getBoundingClientRect").mockReturnValue(new DOMRect(100, 300, 40, 18));

    fireEvent.focusIn(mark(root));
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.style.left).toBe("120px");
    expect(tooltip.style.top).toBe("292px");
  });

  it("oznaczenie terminu, którego słowniczek już nie zna, nie daje pustego dymka", async () => {
    const root = await mountGlossary();
    root.insertAdjacentHTML("beforeend", '<span data-glossary-term="usuniety">Stary</span>');

    fireEvent.focusIn(mark(root, "usuniety"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(mark(root, "usuniety")).toHaveTextContent("Stary");
  });

  it("wariant angielski spada na polski termin i definicję, gdy angielskich brak", async () => {
    const root = await mountGlossary("en");
    fireEvent.focusIn(mark(root));
    expect(screen.getByRole("tooltip")).toHaveTextContent("UE");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Unia Europejska");
    expect(screen.getByRole("link", { name: "Glossary" })).toBeInTheDocument();
  });

  it("słowniczek w trakcie ładowania: treść nietknięta i żadnego dymka", async () => {
    h.terms = null;
    const root = await mountGlossary();
    const before = root.innerHTML;

    fireEvent.focusIn(mark(root));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(root.innerHTML).toBe(before);
  });

  it("odmontowanie zdejmuje z kontenera WSZYSTKIE cztery nasłuchy", async () => {
    const root = article("<p>Treść</p>");
    const remove = vi.spyOn(root, "removeEventListener");
    const view = withQuery(
      <GlossaryHighlighter containerRef={{ current: root }} lang="pl" scanKey="p1" />,
    );
    view.unmount();

    const removed = remove.mock.calls.map(([type, , capture]) => `${type}:${String(capture)}`);
    expect(removed).toEqual(
      expect.arrayContaining([
        "mouseenter:true",
        "focusin:true",
        "mouseleave:true",
        "focusout:true",
      ]),
    );
    expect(removed).toHaveLength(4);
  });
  it("odmontowanie w trakcie opóźnionego chowania kasuje JEGO licznik", async () => {
    const root = await mountGlossary();
    fireEvent.focusIn(mark(root));
    const scheduled = vi.spyOn(window, "setTimeout");
    const cleared = vi.spyOn(window, "clearTimeout");
    fireEvent.focusOut(mark(root));
    const at = scheduled.mock.calls.findIndex(([, delay]) => delay === 200);
    expect(at).toBeGreaterThanOrEqual(0);

    cleanup();
    expect(cleared).toHaveBeenCalledWith(scheduled.mock.results[at]?.value);
  });
});

describe("QuoteShareBar - cykl życia paska", () => {
  const TEXT = "To jest realny cytat z analizy o UE.";

  function mountBar(containerRef: { current: HTMLElement | null }) {
    return withQuery(
      <QuoteShareBar containerRef={containerRef} url="https://nes.eu/blog/a" lang="pl" />,
    );
  }

  /** Prawdziwe zaznaczenie całego akapitu; atrapą jest wyłącznie prostokąt zakresu. */
  function selectParagraph(root: HTMLElement): void {
    const text = root.querySelector("p")?.firstChild;
    if (!text) throw new Error("brak tekstu do zaznaczenia");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, TEXT.length);
    vi.spyOn(range, "getBoundingClientRect").mockReturnValue(new DOMRect(400, 300, 200, 20));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function selectionChanged(): Promise<void> {
    await act(async () => {
      document.dispatchEvent(new Event("selectionchange"));
      await vi.advanceTimersByTimeAsync(20);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("zwinięcie zaznaczenia CHOWA pasek", async () => {
    const root = article(`<p>${TEXT}</p>`);
    mountBar({ current: root });
    selectParagraph(root);
    await selectionChanged();
    expect(screen.getByRole("toolbar", { name: "Udostępnij zaznaczony cytat" })).toBeVisible();

    window.getSelection()?.collapseToStart();
    await selectionChanged();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("bez zamontowanego kontenera treści pasek się nie pokazuje", async () => {
    const root = article(`<p>${TEXT}</p>`);
    const { container } = mountBar({ current: null });
    selectParagraph(root);
    await selectionChanged();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("pointerdown na pasku jest wstrzymany - klik w akcję nie zdejmuje zaznaczenia", async () => {
    const root = article(`<p>${TEXT}</p>`);
    mountBar({ current: root });
    selectParagraph(root);
    await selectionChanged();

    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    screen.getByRole("toolbar").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()?.toString()).toBe(TEXT);
  });

  it("„Skopiowano cytat” wraca do „Kopiuj cytat” po 1,6 s", async () => {
    const root = article(`<p>${TEXT}</p>`);
    mountBar({ current: root });
    selectParagraph(root);
    await selectionChanged();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kopiuj cytat" }));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Skopiowano cytat" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1600));
    expect(screen.getByRole("button", { name: "Kopiuj cytat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skopiowano cytat" })).toBeNull();
  });

  it("drugie kopiowanie liczy 1,6 s OD NOWA - stary licznik nie gasi potwierdzenia", async () => {
    const root = article(`<p>${TEXT}</p>`);
    mountBar({ current: root });
    selectParagraph(root);
    await selectionChanged();
    const copy = async (name: string) =>
      act(async () => {
        fireEvent.click(screen.getByRole("button", { name }));
        await Promise.resolve();
      });

    await copy("Kopiuj cytat");
    act(() => vi.advanceTimersByTime(1000));
    await copy("Skopiowano cytat");
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: "Skopiowano cytat" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByRole("button", { name: "Kopiuj cytat" })).toBeInTheDocument();
  });

  it("LinkedIn przy zablokowanym schowku i tak otwiera okno udostępnienia", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const root = article(`<p>${TEXT}</p>`);
    mountBar({ current: root });
    selectParagraph(root);
    await selectionChanged();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Udostępnij na LinkedIn" }));
      await Promise.resolve();
    });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(String(openSpy.mock.calls[0][0])).toContain("linkedin.com/sharing/share-offsite");
  });

  it("odmontowanie z aktywnym potwierdzeniem kasuje JEGO licznik", async () => {
    const root = article(`<p>${TEXT}</p>`);
    const view = mountBar({ current: root });
    selectParagraph(root);
    await selectionChanged();
    const scheduled = vi.spyOn(window, "setTimeout");
    const cleared = vi.spyOn(window, "clearTimeout");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kopiuj cytat" }));
      await Promise.resolve();
    });
    const at = scheduled.mock.calls.findIndex(([, delay]) => delay === 1600);
    expect(at).toBeGreaterThanOrEqual(0);
    const copyTimer = scheduled.mock.results[at]?.value;

    view.unmount();
    expect(cleared).toHaveBeenCalledWith(copyTimer);
  });
});
