// PUBLICZNY RENDERER: STRUMIENIOWANIE, OKNO „NAD ZGIĘCIEM", GRANICE SUSPENSE
// I CO SIĘ DZIEJE PRZY BRAKU DANYCH ŹRÓDŁOWYCH.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * okno `aboveFoldCount` - wartość domyślna to `ABOVE_FOLD_SECTION_COUNT` (3),
//   i to jest MIERZALNE: sekcje czołowe oznaczają swój pierwszy obraz jako
//   kandydata LCP (`loading="eager"` + `fetchpriority="high"`), a dalsze jako
//   leniwy. Zmiana progu widać w atrybutach obrazów,
// * `stream` włączone i wyłączone dla sekcji ZALEŻNEJ OD DANYCH i dla statycznej
//   - z dowodem, że na ścieżce KLIENCKIEJ treść jest identyczna,
// * brak danych źródłowych: widget listy wpisów z pustą odpowiedzią Supabase
//   nie wywraca sekcji ani strony,
// * granica `Suspense` renderera (L655) w stanie OCZEKIWANIA i po rozwiązaniu
//   - łącznie z tym, że jej `fallback={null}` NIE REZERWUJE ANI PIKSELA,
// * granica błędu wokół sekcji: uszkodzony `layout.htmlTag` wywraca render
//   JEDNEJ sekcji, a nie strony.
//
// ── TWARDE OGRANICZENIA ŚRODOWISKA (nie do obejścia, do udokumentowania) ───
// 1. `import.meta.env.SSR` jest w vitest FAŁSZEM, więc `ServerSectionGate`
//    NIGDY nie montuje się przez `<StreamingSection>` - klient dostaje dzieci
//    bez bramki. Bramka ma własny dowód, montowany BEZPOŚREDNIO, w
//    `src/lib/builder/__tests__/sectionStreaming.test.tsx:58-113`. Tutaj mierzymy
//    to, co widzi PRZEGLĄDARKA, i pilnujemy, że strumieniowanie nie zmienia
//    HTML-a na tej ścieżce.
// 2. Z punktu 1 wynika, że szkielet `SectionStreamSkeleton` (280 px `minHeight`)
//    jest z `BuilderRenderer` nieosiągalny - nic nie zawiesza granicy na
//    kliencie. Dlatego pomiar rezerwy miejsca robimy na trzech faktach:
//    szkielet strumienia rezerwuje 280 px NIEZALEŻNIE od realnej wysokości
//    sekcji (patrz `sectionStreaming.test.tsx:51-55`), granica renderera
//    rezerwuje ZERO, a na kliencie żaden z tych fallbacków się nie pokazuje.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense, lazy, type ReactElement } from "react";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { ABOVE_FOLD_SECTION_COUNT } from "@/lib/builder/prefetch";
import { shouldStreamSection } from "@/lib/builder/sectionStreaming";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { EmptyContainerPickerBoxProps } from "../BuilderRenderer";
import { BuilderEmptyPickerProvider, BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  section,
  simpleSection,
  stubObservers,
  tabsConfig,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// GRANICA SYSTEMU, nie warstwa pod testem: widget listy wpisów czyta dane przez
// react-query z Supabase. Atrapa oddaje pusty zbiór, więc test mierzy ścieżkę
// „brak danych źródłowych" bez sieci.
vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of [
    "select",
    "eq",
    "neq",
    "is",
    "in",
    "not",
    "gte",
    "lte",
    "gt",
    "lt",
    "order",
    "range",
    "limit",
    "or",
    "filter",
    "contains",
    "overlaps",
    "match",
    "ilike",
  ]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => ({ data: null, error: null }));
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  const channel: Record<string, unknown> = {};
  channel.on = vi.fn(() => channel);
  channel.subscribe = vi.fn(() => channel);
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(async () => "ok"),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
        getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
      },
    },
  };
});

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
  vi.restoreAllMocks();
});

/** Sekcja z JEDNYM obrazem - priorytet ładowania zdradza okno „nad zgięciem". */
const sekcjaZObrazem = (id: string) =>
  section(id, [
    column(`${id}-c`, [
      widget(`${id}-img`, "image", {
        content: { src: "https://example.org/obraz.png", alt_pl: `Obraz ${id}` },
      }),
    ]),
  ]);

/** Sekcja zależna od danych (lista wpisów) - jedyny rodzaj, który strumieniuje. */
const sekcjaZDanymi = (id: string) =>
  section(id, [column(`${id}-c`, [widget(`${id}-lista`, "post-list", { content: {} })])]);

const priorytety = (container: HTMLElement) =>
  [...container.querySelectorAll("img")].map((img) => img.getAttribute("loading"));

describe("okno nad zgięciem (aboveFoldCount)", () => {
  it("domyślnie czołowe sekcje to ABOVE_FOLD_SECTION_COUNT, czyli 3", () => {
    expect(ABOVE_FOLD_SECTION_COUNT).toBe(3);
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([0, 1, 2, 3, 4].map((i) => sekcjaZObrazem(`s${i}`)))} lang="pl" />,
    );
    // Trzy pierwsze obrazy to kandydaci LCP, pozostałe schodzą leniwie.
    expect(priorytety(container)).toEqual(["eager", "eager", "eager", "lazy", "lazy"]);
    const pierwszy = container.querySelector("img");
    expect(pierwszy?.getAttribute("fetchpriority")).toBe("high");
  });

  it("aboveFoldCount=1 zawęża okno do jednej sekcji", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([0, 1, 2].map((i) => sekcjaZObrazem(`s${i}`)))}
        lang="pl"
        aboveFoldCount={1}
      />,
    );
    expect(priorytety(container)).toEqual(["eager", "lazy", "lazy"]);
  });

  it("aboveFoldCount=0 (strona główna) nie wyróżnia ŻADNEJ sekcji", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZObrazem("s0")])} lang="pl" aboveFoldCount={0} />,
    );
    expect(priorytety(container)).toEqual(["lazy"]);
    expect(container.querySelector("img")?.getAttribute("fetchpriority")).toBe("auto");
  });
});

describe("strumieniowanie sekcji na ścieżce KLIENCKIEJ", () => {
  const dokument = doc([
    simpleSection("statyczna"),
    sekcjaZDanymi("dane-1"),
    sekcjaZDanymi("dane-2"),
    sekcjaZDanymi("dane-3"),
    sekcjaZDanymi("dane-4"),
  ]);

  it("decyzja eager/stream jest czystą funkcją dokumentu, nie renderu", () => {
    // Ten sam predykat, którego używa `StreamingSection`. Sekcja statyczna nie
    // strumieniuje NIGDY (hero nie może czekać), sekcja z danymi tylko poniżej
    // okna czołowego i tylko przy włączonym `stream`.
    const statyczna = dokument.sections[0];
    const zDanymi = dokument.sections[4];
    expect(shouldStreamSection(statyczna, "pl", 0, 0, true)).toBe(false);
    expect(shouldStreamSection(zDanymi, "pl", 4, 3, true)).toBe(true);
    expect(shouldStreamSection(zDanymi, "pl", 4, 3, false)).toBe(false);
    expect(shouldStreamSection(zDanymi, "pl", 1, 3, true)).toBe(false);
  });

  it.each([false, true])("stream=%s daje IDENTYCZNY zestaw sekcji w DOM", (stream) => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" stream={stream} />,
    );
    const ids = [...container.querySelectorAll("[data-sec-id]")].map((el) =>
      el.getAttribute("data-sec-id"),
    );
    expect(ids).toEqual(["statyczna", "dane-1", "dane-2", "dane-3", "dane-4"]);
    // Na kliencie żaden szkielet strumienia się nie pokazuje: `import.meta.env.SSR`
    // jest fałszem, więc bramka serwerowa nie montuje się i nic nie zawiesza
    // granicy. To jest właśnie brak CLS na tej ścieżce.
    expect(container.querySelector("[data-section-stream-skeleton]")).toBeNull();
  });

  it("włączony stream nie gubi treści sekcji poniżej zgięcia", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" stream aboveFoldCount={0} />,
    );
    expect(container.querySelectorAll("[data-sec-id]").length).toBe(5);
    expect(container.querySelector('[data-sec-id="dane-4"]')).not.toBeNull();
  });
});

describe("brak danych źródłowych", () => {
  it("lista wpisów z pustą odpowiedzią renderuje sekcję i nie wywraca strony", async () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([sekcjaZDanymi("lista"), simpleSection("sasiad")])} lang="pl" />,
    );
    // Oddaj pętlę zdarzeń zapytaniom react-query.
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[data-sec-id="lista"]')).not.toBeNull();
    expect(container.querySelector('[data-sec-id="sasiad"]')).not.toBeNull();
    expect(container.querySelector("[data-render-error]")).toBeNull();
    expect(container.textContent).toContain("T-sasiad-w");
  });

  it("sekcja z widgetem danych i BEZ kolumn nadal renderuje swoją powłokę", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("pusta", [])])} lang="pl" stream />,
    );
    expect(container.querySelector('[data-sec-id="pusta"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(0);
  });
});

describe("granica Suspense renderera (picker pustego kontenera, L655)", () => {
  /** Boks pickera podawany „z góry" - w produkcji robi to kanwa buildera. */
  function makeLazyBox() {
    let release!: (v: { default: (p: EmptyContainerPickerBoxProps) => ReactElement }) => void;
    const promise = new Promise<{ default: (p: EmptyContainerPickerBoxProps) => ReactElement }>(
      (resolve) => {
        release = resolve;
      },
    );
    const Box = lazy(() => promise);
    const Real = ({ tabsEnabled, onPick }: EmptyContainerPickerBoxProps) => (
      <button type="button" data-picker onClick={() => onPick([6, 6])}>
        {tabsEnabled ? "picker-z-zakladkami" : "picker"}
      </button>
    );
    return { Box, release: () => release({ default: Real }) };
  }

  it("stan OCZEKIWANIA: fallback={null} nie rezerwuje ANI PIKSELA", () => {
    const { Box } = makeLazyBox();
    const { container } = renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={vi.fn()} box={Box}>
        <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    const wiersz = container.querySelector<HTMLElement>("[data-columns-row]");
    expect(wiersz).not.toBeNull();
    // Granica wisi - w wierszu kolumn nie ma NIC: ani boksu, ani zastępczej
    // wysokości. Gdy boks dojedzie, treść wskoczy i przesunie stronę.
    expect(wiersz?.childElementCount).toBe(0);
    expect(wiersz?.style.minHeight ?? "").toBe("");
    expect(container.querySelector("[data-picker]")).toBeNull();
  });

  it("po rozwiązaniu boks pojawia się i oddaje wybrane szerokości kolumn", async () => {
    const { Box, release } = makeLazyBox();
    const onPick = vi.fn();
    renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={onPick} box={Box}>
        <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    await act(async () => {
      release();
    });
    const przycisk = await screen.findByText("picker");
    fireEvent.click(przycisk);
    // Kontener bez zakładek zgłasza `tabId === null`.
    expect(onPick).toHaveBeenCalledWith("kontener", null, [6, 6]);
  });

  it("w kontenerze z zakładkami picker zgłasza AKTYWNĄ zakładkę", async () => {
    const { Box, release } = makeLazyBox();
    const onPick = vi.fn();
    renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={onPick} box={Box}>
        <BuilderRenderer
          doc={doc([
            section("kontener", [], {
              tabs: tabsConfig([{ id: "t1" }, { id: "t2" }], { defaultTabId: "t2" }),
            }),
          ])}
          lang="pl"
        />
      </BuilderEmptyPickerProvider>,
    );
    await act(async () => {
      release();
    });
    fireEvent.click(await screen.findByText("picker-z-zakladkami"));
    expect(onPick).toHaveBeenCalledWith("kontener", "t2", [6, 6]);
  });

  it("BEZ dostawcy (strona publiczna) picker nie istnieje - pusty kontener zostaje pusty", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([section("kontener", [])])} lang="pl" />,
    );
    expect(container.querySelector("[data-picker]")).toBeNull();
    expect(container.querySelector<HTMLElement>("[data-columns-row]")?.childElementCount).toBe(0);
  });

  it("dostawca podany, ale kontener MA kolumny - picker się nie pokazuje", () => {
    const { Box } = makeLazyBox();
    const { container } = renderWithQueryClient(
      <BuilderEmptyPickerProvider onPick={vi.fn()} box={Box}>
        <BuilderRenderer doc={doc([simpleSection("pelna")])} lang="pl" />
      </BuilderEmptyPickerProvider>,
    );
    expect(container.querySelector("[data-picker]")).toBeNull();
    expect(container.querySelectorAll("[data-widget-id]").length).toBe(1);
  });
});

describe("granica BŁĘDU wokół sekcji", () => {
  it("uszkodzony layout.htmlTag wywraca JEDNĄ sekcję, reszta strony żyje", () => {
    // `htmlTag` jedzie z kolumny jsonb - wartość spoza zbioru znaczników HTML
    // (tu: liczba) wywraca `createElement`. Bez ziarnistej granicy padłaby
    // CAŁA strona publiczna.
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = renderWithQueryClient(
        <BuilderRenderer
          doc={doc([
            simpleSection("zdrowa-1"),
            simpleSection("polamana", { layout: { htmlTag: 7 } as never }),
            simpleSection("zdrowa-2"),
          ])}
          lang="pl"
        />,
      );
      expect(container.querySelector('[data-sec-id="zdrowa-1"]')).not.toBeNull();
      expect(container.querySelector('[data-sec-id="zdrowa-2"]')).not.toBeNull();
      const diagnostyka = container.querySelector('[data-render-error="section:polamana"]');
      expect(diagnostyka).not.toBeNull();
      // W dev granica pokazuje zwięzły komunikat (rola alert); w produkcji
      // zostaje niewidoczny ślad w DOM - tam mierzy to RenderErrorBoundary.
      expect(diagnostyka?.getAttribute("role")).toBe("alert");
    } finally {
      bledy.mockRestore();
    }
  });

  it("granica z fallbackiem null nie rezerwuje miejsca po zepsutym węźle", () => {
    const bledy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = renderWithQueryClient(
        <Suspense fallback={null}>
          <BuilderRenderer
            doc={doc([simpleSection("polamana", { layout: { htmlTag: 7 } as never })])}
            lang="pl"
          />
        </Suspense>,
      );
      const korzen = container.querySelector<HTMLElement>("[data-builder-renderer]");
      // Jedyne, co zostaje po sekcji, to diagnostyka granicy - nie ma
      // zastępczej wysokości, która utrzymałaby układ strony.
      expect(korzen?.querySelector("[data-sec-id]")).toBeNull();
      expect(korzen?.style.minHeight ?? "").toBe("");
    } finally {
      bledy.mockRestore();
    }
  });
});
