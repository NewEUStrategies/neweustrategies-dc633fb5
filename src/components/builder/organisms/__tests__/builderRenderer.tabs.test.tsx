// PUBLICZNY RENDERER: SEKCJA JAKO KONTENER ZAKŁADEK.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * warunek włączenia zakładek: `enabled` + NIEPUSTA lista pozycji (pusta lista
//   przy `enabled: true` to nadal sekcja bez zakładek),
// * wybór zakładki początkowej: `defaultTabId` gdy wskazuje istniejącą pozycję,
//   inaczej pierwsza z listy,
// * powiązanie ARIA panelu z przyciskiem zakładki (`role=tabpanel`, `id`,
//   `aria-labelledby`) - to jedyna rzecz, po której czytnik ekranu wie, co się
//   właśnie zmieniło,
// * FILTR treści po zakładce: kolumna bez `tabId` jest wspólna dla wszystkich
//   zakładek, kolumna z `tabId` pokazuje się tylko na swojej,
// * animacja przejścia: faza `out` -> 180 ms -> faza `in` z podmianą treści,
//   przerwanie animacji szybkim drugim klikiem, oraz ścieżka
//   `prefers-reduced-motion` (podmiana natychmiastowa, bez `transition`),
// * orientacja pozioma i pionowa (druga zmienia układ na `flex` i daje wierszowi
//   kolumn `flex: 1`),
// * korekta po edycji listy zakładek: gdy aktywna zakładka przestaje istnieć,
//   renderer wraca do pierwszej - bez tego panel zostawał pusty.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  section,
  stubMatchMedia,
  stubObservers,
  tabsConfig,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;
let przywrocMedia: () => void;

beforeEach(() => {
  observers = stubObservers();
  // Domyślnie: użytkownik NIE prosi o ograniczenie animacji.
  przywrocMedia = stubMatchMedia(false);
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  przywrocMedia();
  __resetBuilderDebugForTests();
  vi.useRealTimers();
});

/** Sekcja z dwiema zakładkami: kolumna wspólna + po jednej kolumnie na zakładkę. */
function sekcjaZZakladkami(extra: Record<string, unknown> = {}) {
  return section(
    "s",
    [
      column("wspolna", [widget("w-wspolny")]),
      column("k-t1", [widget("w-t1")], { tabId: "t1" }),
      column("k-t2", [widget("w-t2")], { tabId: "t2" }),
    ],
    {
      tabs: tabsConfig(
        [
          { id: "t1", label_pl: "Pierwsza" },
          { id: "t2", label_pl: "Druga" },
        ],
        extra,
      ),
    },
  );
}

const panel = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-columns-row]");

const widoczneKolumny = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-column-slot]")].map((el) => el.getAttribute("data-col-id"));

describe("warunek włączenia zakładek", () => {
  it("enabled + pozycje = pasek zakładek i panel z rolą tabpanel", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(panel(container)?.getAttribute("role")).toBe("tabpanel");
  });

  it("enabled=true, ale PUSTA lista pozycji = zwykła sekcja bez zakładek", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [column("k", [widget("w")])], {
            tabs: { enabled: true, items: [] } as never,
          }),
        ])}
        lang="pl"
      />,
    );
    expect(container.querySelector("[role=tablist]")).toBeNull();
    expect(panel(container)?.hasAttribute("role")).toBe(false);
    expect(widoczneKolumny(container)).toEqual(["k"]);
  });

  it("enabled=false zostawia sekcję bez zakładek, a wszystkie kolumny widoczne", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section(
            "s",
            [
              column("a", [widget("w1")], { tabId: "t1" }),
              column("b", [widget("w2")], { tabId: "t2" }),
            ],
            { tabs: { enabled: false, items: [{ id: "t1" }, { id: "t2" }] } as never },
          ),
        ])}
        lang="pl"
      />,
    );
    expect(container.querySelector("[role=tablist]")).toBeNull();
    // Wyłączone zakładki = `tabId` nie filtruje niczego.
    expect(widoczneKolumny(container)).toEqual(["a", "b"]);
  });
});

describe("zakładka początkowa", () => {
  it("bez defaultTabId aktywna jest PIERWSZA pozycja", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
    expect(widoczneKolumny(container)).toEqual(["wspolna", "k-t1"]);
  });

  it("defaultTabId wskazujący istniejącą pozycję wygrywa", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami({ defaultTabId: "t2" })])} lang="pl" />,
    );
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t2");
    expect(widoczneKolumny(container)).toEqual(["wspolna", "k-t2"]);
  });

  it("defaultTabId wskazujący NIEISTNIEJĄCĄ pozycję spada na pierwszą", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami({ defaultTabId: "usunieta" })])} lang="pl" />,
    );
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
  });
});

describe("powiązanie ARIA panelu i zakładek", () => {
  it("panel wskazuje na przycisk aktywnej zakładki, a przycisk na panel", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    const p = panel(container);
    expect(p?.getAttribute("id")).toBe("sec-s-panel-t1");
    expect(p?.getAttribute("aria-labelledby")).toBe("sec-s-tab-t1");
    const przycisk = screen.getByRole("tab", { name: "Pierwsza" });
    expect(przycisk.getAttribute("aria-controls")).toBe("sec-s-panel-t1");
    expect(przycisk.getAttribute("id")).toBe("sec-s-tab-t1");
  });
});

describe("przejście między zakładkami", () => {
  it("pasek reaguje NATYCHMIAST, a treść panelu po 180 ms", () => {
    vi.useFakeTimers();
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Druga" }));
    });

    // Faza wygaszania: zakładka już aktywna, treść JESZCZE stara.
    expect(screen.getByRole("tab", { name: "Druga" }).getAttribute("aria-selected")).toBe("true");
    expect(panel(container)?.getAttribute("data-tab-phase")).toBe("out");
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
    expect(panel(container)?.style.opacity).toBe("0");
    expect(panel(container)?.style.transform).toBe("translateY(4px)");

    act(() => {
      vi.advanceTimersByTime(180);
    });

    expect(panel(container)?.getAttribute("data-tab-phase")).toBe("in");
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t2");
    expect(panel(container)?.style.opacity).toBe("1");
    expect(widoczneKolumny(container)).toEqual(["wspolna", "k-t2"]);
  });

  it("kliknięcie w JUŻ aktywną zakładkę nic nie zmienia (brak migotania)", () => {
    vi.useFakeTimers();
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Pierwsza" }));
    });
    expect(panel(container)?.getAttribute("data-tab-phase")).toBe("in");
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
  });

  it("drugi klik w trakcie animacji unieważnia pierwszy (jeden licznik, nie dwa)", () => {
    vi.useFakeTimers();
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Druga" }));
    });
    act(() => {
      vi.advanceTimersByTime(90);
    });
    // Zmiana zdania w połowie fade-outu.
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Pierwsza" }));
    });
    act(() => {
      vi.advanceTimersByTime(180);
    });
    // Wygrywa OSTATNI wybór - bez tego pierwszy licznik dokończyłby przejście
    // na „t2" już po zmianie zdania.
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
    expect(panel(container)?.getAttribute("data-tab-phase")).toBe("in");
  });

  it("prefers-reduced-motion: podmiana natychmiastowa i BEZ transition", () => {
    przywrocMedia();
    przywrocMedia = stubMatchMedia(true);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Druga" }));
    });
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t2");
    expect(panel(container)?.getAttribute("data-tab-phase")).toBe("in");
    expect(panel(container)?.style.transition).toBe("");
    expect(panel(container)?.style.willChange).toBe("");
  });

  it("odmontowanie w trakcie animacji nie zostawia licznika", () => {
    vi.useFakeTimers();
    const { unmount } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Druga" }));
    });
    unmount();
    // Gdyby licznik przeżył, `setDisplayTabId` uderzyłby w odmontowany komponent.
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(500);
      }),
    ).not.toThrow();
  });
});

describe("orientacja paska", () => {
  it("pozioma (domyślna) stawia pasek NAD panelem", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami()])} lang="pl" />,
    );
    const pasek = container.querySelector("[data-section-tabs-bar]");
    expect(pasek?.getAttribute("data-orientation")).toBe("horizontal");
    expect(panel(container)?.style.flex).toBe("");
  });

  it("pionowa układa pasek i panel w rzędzie, a panel dostaje flex: 1", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami({ orientation: "vertical" })])} lang="pl" />,
    );
    const pasek = container.querySelector("[data-section-tabs-bar]");
    expect(pasek?.getAttribute("data-orientation")).toBe("vertical");
    expect(panel(container)?.style.flex).toBe("1 1 0%");
    // Rodzic paska i panelu jest kontenerem flex.
    const rzad = pasek?.parentElement as HTMLElement;
    expect(rzad.style.display).toBe("flex");
    expect(rzad.style.alignItems).toBe("flex-start");
  });
});

describe("korekta po edycji listy zakładek", () => {
  it("usunięcie aktywnej zakładki przestawia panel na pierwszą pozostałą", () => {
    const { container, rerender, queryClient } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZZakladkami({ defaultTabId: "t2" })])} lang="pl" />,
    );
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t2");

    // Redaktor usuwa zakładkę „t2" w panelu; dokument przyjeżdża bez niej.
    const poEdycji = doc([
      section(
        "s",
        [
          column("wspolna", [widget("w-wspolny")]),
          column("k-t1", [widget("w-t1")], { tabId: "t1" }),
        ],
        { tabs: tabsConfig([{ id: "t1", label_pl: "Pierwsza" }]) },
      ),
    ]);
    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <BuilderRenderer doc={poEdycji} lang="pl" />
        </QueryClientProvider>,
      );
    });

    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
    expect(panel(container)?.getAttribute("data-tab-phase")).toBe("in");
    expect(widoczneKolumny(container)).toEqual(["wspolna", "k-t1"]);
  });

  it("zakładki z kolumnami, ale bez ŻADNEJ kolumny na aktywnej zakładce, dają pusty panel", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [column("k-t2", [widget("w")], { tabId: "t2" })], {
            tabs: tabsConfig([{ id: "t1" }, { id: "t2" }]),
          }),
        ])}
        lang="pl"
      />,
    );
    expect(panel(container)?.getAttribute("data-section-tab-panel")).toBe("t1");
    expect(widoczneKolumny(container)).toEqual([]);
    expect(panel(container)?.childElementCount).toBe(0);
  });
});
