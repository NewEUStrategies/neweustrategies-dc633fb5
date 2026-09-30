import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense } from "react";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
// Initialize the shared i18n instance so useTranslation resolves in the skeleton.
import "@/lib/i18n";
import type { SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  SERVER_SECTION_STREAM_BUDGET_MS,
  ServerSectionGate,
  SectionStreamSkeleton,
  StreamingSection,
  shouldStreamSection,
} from "@/lib/builder/sectionStreaming";
import { GUEST_ACCESS_CONTEXT } from "@/lib/builder/accessControl";
import type { SectionRenderContext } from "@/lib/builder/renderVisibility";
import { pendingSectionQueries, sectionQueryOptionsList } from "@/lib/builder/prefetch";
import {
  SECTION_STREAM_MIN_HEIGHT,
  estimateSectionHeight,
} from "@/lib/builder/sectionHeightEstimate";

function makeWidget(type: WidgetNode["type"], extra: Partial<WidgetNode> = {}): WidgetNode {
  return {
    kind: "widget",
    id: `w-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content: { items: [] },
    style: {},
    advanced: {},
    ...extra,
  } as WidgetNode;
}

function withWidgets(widgets: WidgetNode[], id = "s1"): SectionNode {
  return {
    id,
    children: [{ kind: "column", id: `${id}-c`, span: { desktop: 12 }, children: widgets }],
  } as unknown as SectionNode;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("SectionStreamSkeleton", () => {
  it("exposes a busy, labelled placeholder with shimmer blocks", () => {
    const { container } = render(<SectionStreamSkeleton />);
    const root = container.querySelector("[data-section-stream-skeleton]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(root?.getAttribute("aria-label")?.length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThan(0);
  });

  it("reserves vertical space to blunt layout shift", () => {
    const { container } = render(<SectionStreamSkeleton minHeight={500} />);
    const root = container.querySelector<HTMLElement>("[data-section-stream-skeleton]");
    expect(root?.style.minHeight).toBe("500px");
  });

  it("bez sekcji spada na DNO widełek, a nie na zero", () => {
    // Wołający bez sekcji (np. ręczny fallback) nadal musi coś zarezerwować -
    // szkielet o zerowej wysokości nie różni się od braku szkieletu.
    const { container } = render(<SectionStreamSkeleton />);
    const root = container.querySelector<HTMLElement>("[data-section-stream-skeleton]");
    expect(root?.style.minHeight).toBe(`${SECTION_STREAM_MIN_HEIGHT}px`);
  });
});

describe("ServerSectionGate", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it("renders children synchronously when every section query has settled", () => {
    const section = withWidgets([makeWidget("post-list")]);
    sectionQueryOptionsList(section, "pl").forEach((o) => qc.setQueryData(o.queryKey, []));
    render(
      <Suspense fallback={<span>FALLBACK</span>}>
        <ServerSectionGate section={section} lang="pl">
          <span>CONTENT</span>
        </ServerSectionGate>
      </Suspense>,
      { wrapper: wrapper(qc) },
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
    expect(screen.queryByText("FALLBACK")).toBeNull();
  });

  it.each([
    "desktop-only on mobile",
    "inaccessible widget",
    "inactive tab",
    "inaccessible column",
    "inaccessible inner column",
  ])("does not wait for a pending query from %s", (scenario) => {
    const visible = makeWidget("post-list");
    const excluded = makeWidget("slider", { content: { source: "posts" } });
    const section = withWidgets([visible, excluded]);
    const renderContext: SectionRenderContext = {
      device: "mobile",
      accessContext: GUEST_ACCESS_CONTEXT,
    };
    if (scenario === "desktop-only on mobile") {
      excluded.advanced = { hideOn: { mobile: true, tablet: true } };
    } else if (scenario === "inaccessible widget") {
      excluded.advanced = { access: { auth: "user" } };
    } else {
      section.children = [
        { kind: "column", id: "visible", span: { desktop: 12 }, children: [visible] },
        { kind: "column", id: "excluded", span: { desktop: 12 }, children: [excluded] },
      ];
      if (scenario === "inactive tab") {
        section.tabs = {
          enabled: true,
          items: [
            { id: "inactive", label_pl: "Inactive" },
            { id: "active", label_pl: "Active" },
          ],
          defaultTabId: "active",
        };
        section.children[1].tabId = "inactive";
      } else if (scenario === "inaccessible column") {
        section.children[1].advanced = { access: { auth: "user" } };
      } else {
        section.children[1] = {
          kind: "inner-section",
          id: "inner",
          columns: [
            {
              kind: "column",
              id: "inner-excluded",
              span: { desktop: 12 },
              advanced: { access: { auth: "user" } },
              children: [excluded],
            },
          ],
        };
      }
    }
    sectionQueryOptionsList(withWidgets([visible]), "pl").forEach((options) =>
      qc.setQueryData(options.queryKey, []),
    );
    const [excludedQuery] = sectionQueryOptionsList(withWidgets([excluded]), "pl");
    // Simulate a query already started by the unfiltered loader. The render
    // gate must neither wait for it nor cancel unrelated loader work.
    void qc
      .fetchQuery({
        queryKey: excludedQuery.queryKey,
        queryFn: () => new Promise<never>(() => {}),
      })
      .catch(() => undefined);
    const prefetch = vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);
    try {
      render(
        <Suspense fallback={<span>FALLBACK</span>}>
          <ServerSectionGate section={section} lang="pl" renderContext={renderContext}>
            <span>CONTENT</span>
          </ServerSectionGate>
        </Suspense>,
        { wrapper: wrapper(qc) },
      );
      expect(screen.getByText("CONTENT")).toBeTruthy();
      expect(screen.queryByText("FALLBACK")).toBeNull();
      expect(prefetch).not.toHaveBeenCalled();
      expect(qc.getQueryState(excludedQuery.queryKey)?.fetchStatus).toBe("fetching");
      expect(pendingSectionQueries(qc, section, "pl", renderContext)).toEqual([]);
      // A settled hidden slider can also have unresolved dependent authors.
      qc.setQueryData(excludedQuery.queryKey, [{ id: "post", author_id: "author" }]);
      expect(pendingSectionQueries(qc, section, "pl", renderContext)).toEqual([]);
    } finally {
      prefetch.mockRestore();
      qc.clear();
    }
  });

  it("suspends until pending queries settle, then streams the children", async () => {
    const section = withWidgets([makeWidget("post-list")]);
    // Hold the suspended fetch open until the test releases it, so the fallback
    // is deterministically observable; on release seed the cache (no real
    // network) so the gate's retry render finds the query settled.
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(qc, "prefetchQuery").mockImplementation((options) =>
      released.then(() => {
        qc.setQueryData((options as { queryKey: QueryKey }).queryKey, []);
      }),
    );

    render(
      <Suspense fallback={<span>FALLBACK</span>}>
        <ServerSectionGate
          section={section}
          lang="pl"
          renderContext={{ device: "mobile", accessContext: GUEST_ACCESS_CONTEXT }}
        >
          <span>CONTENT</span>
        </ServerSectionGate>
      </Suspense>,
      { wrapper: wrapper(qc) },
    );

    // Cold cache -> the boundary suspends and shows its fallback, not the section.
    expect(screen.getByText("FALLBACK")).toBeTruthy();
    expect(screen.queryByText("CONTENT")).toBeNull();

    // Release the fetch: the cache settles and the section streams in.
    await act(async () => {
      release();
    });
    expect(screen.getByText("CONTENT")).toBeTruthy();
    expect(screen.queryByText("FALLBACK")).toBeNull();
  });

  it("does not commit a hero without its dependent author data", async () => {
    const section = withWidgets([makeWidget("slider", { content: { source: "posts" } })]);
    let releasePosts!: () => void;
    let releaseAuthors!: () => void;
    const postsReady = new Promise<void>((resolve) => {
      releasePosts = resolve;
    });
    const authorsReady = new Promise<void>((resolve) => {
      releaseAuthors = resolve;
    });
    const prefetch = vi.spyOn(qc, "prefetchQuery").mockImplementation(async (options) => {
      const queryKey = options.queryKey;
      if (queryKey[0] === "builder-slider-posts") {
        await postsReady;
        qc.setQueryData(queryKey, [{ id: "post", author_id: "author" }]);
      } else if (queryKey[0] === "builder-slider-authors") {
        await authorsReady;
        qc.setQueryData(queryKey, { author: { name: "Test Author", avatar: "", slug: "test" } });
      } else {
        qc.setQueryData(queryKey, []);
      }
    });
    try {
      render(
        <Suspense fallback={<span>FALLBACK</span>}>
          <ServerSectionGate section={section} lang="pl">
            <span>CONTENT</span>
          </ServerSectionGate>
        </Suspense>,
        { wrapper: wrapper(qc) },
      );
      await act(async () => {
        releasePosts();
      });
      expect(screen.getByText("FALLBACK")).toBeTruthy();
      expect(screen.queryByText("CONTENT")).toBeNull();
      await act(async () => {
        releaseAuthors();
      });
      expect(screen.getByText("CONTENT")).toBeTruthy();
      expect(screen.queryByText("FALLBACK")).toBeNull();
    } finally {
      releasePosts();
      releaseAuthors();
      prefetch.mockRestore();
      qc.clear();
    }
  });
});

describe("render-aware section queries", () => {
  const context: SectionRenderContext = {
    device: "mobile",
    accessContext: GUEST_ACCESS_CONTEXT,
  };

  it.each([
    { enabled: true, defaultTabId: undefined, selected: "first" },
    { enabled: true, defaultTabId: "missing", selected: "first" },
    { enabled: true, defaultTabId: "second", selected: "second" },
    { enabled: false, defaultTabId: "second", selected: "both" },
  ])("honors initial tab selection: %j", ({ enabled, defaultTabId, selected }) => {
    const first = makeWidget("post-list");
    const second = makeWidget("slider", { content: { source: "posts" } });
    const section = withWidgets([]);
    section.tabs = {
      enabled,
      defaultTabId,
      items: [
        { id: "first", label_pl: "First" },
        { id: "second", label_pl: "Second" },
      ],
    };
    section.children = [
      { kind: "column", id: "first", tabId: "first", span: { desktop: 12 }, children: [first] },
      {
        kind: "inner-section",
        id: "second",
        tabId: "second",
        columns: [{ kind: "column", id: "inner", span: { desktop: 12 }, children: [second] }],
      },
    ];
    const keys = sectionQueryOptionsList(section, "pl", context).map((options) => options.queryKey);
    const expected =
      selected === "both" ? [first, second] : selected === "first" ? [first] : [second];
    expect(keys).toEqual(
      sectionQueryOptionsList(withWidgets(expected), "pl").map((options) => options.queryKey),
    );
  });

  it("streams an accessible widget only on a device where it renders", () => {
    const section = withWidgets([
      makeWidget("post-list", {
        advanced: { hideOn: { mobile: true }, access: { auth: "user", roles: ["admin"] } },
      }),
    ]);
    expect(shouldStreamSection(section, "pl", true, context)).toBe(false);
    const authorized: SectionRenderContext = {
      device: "desktop",
      accessContext: { isAuthenticated: true, roles: ["admin"] },
    };
    expect(shouldStreamSection(section, "pl", true, authorized)).toBe(true);
    expect(shouldStreamSection(section, "pl", true, { ...authorized, device: "mobile" })).toBe(
      false,
    );
    expect(shouldStreamSection(section, "pl", true, { ...context, device: "desktop" })).toBe(false);
  });
});

describe("shouldStreamSection (eager-vs-stream decision)", () => {
  const dataSection = withWidgets([makeWidget("post-list")]);
  const staticSection = withWidgets([makeWidget("heading")]);

  it("does not stream when streaming is disabled", () => {
    expect(shouldStreamSection(dataSection, "pl", false)).toBe(false);
  });

  it("gates first-fold data too when the bounded loader did not finish", () => {
    expect(shouldStreamSection(dataSection, "pl", true)).toBe(true);
  });

  it("streams below-the-fold data sections", () => {
    expect(shouldStreamSection(dataSection, "pl", true)).toBe(true);
  });

  it("never streams a section without data-bound queries (static hero stays eager)", () => {
    // Static content has nothing to await.
    expect(shouldStreamSection(staticSection, "pl", true)).toBe(false);
  });
});

describe("StreamingSection", () => {
  // In the test (browser-like) environment import.meta.env.SSR is false, so the
  // server gate is never mounted: every branch must render its children, proving
  // streaming never regresses the client/hydration render path.
  const child = <span>CONTENT</span>;

  it("renders eagerly when streaming is disabled", () => {
    render(
      <StreamingSection section={withWidgets([makeWidget("post-list")])} lang="pl" enabled={false}>
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("renders above-the-fold sections eagerly", () => {
    render(
      <StreamingSection section={withWidgets([makeWidget("post-list")])} lang="pl" enabled>
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("renders below-the-fold sections that have no data queries eagerly", () => {
    render(
      <StreamingSection section={withWidgets([makeWidget("heading")])} lang="pl" enabled>
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("keeps the client render intact for below-the-fold data sections", () => {
    render(
      <StreamingSection section={withWidgets([makeWidget("post-list")])} lang="pl" enabled>
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("szkielet rezerwuje wysokość POLICZONĄ Z SEKCJI, nie stałą", () => {
    // Dotąd fallback trzymał stałe 280 px wobec sekcji 400-900 px, więc każde
    // dostrumieniowanie spychało treść pod sekcją (audyt CWV, F29b). To jedyne
    // miejsce, w którym widać SPIĘCIE szacunku z granicą Suspense - sam
    // szacunek pilnuje `sectionHeightEstimate.test.ts`.
    //
    // Dziecko zawieszone na wieczność jest tu NARZĘDZIEM: w środowisku
    // testowym `import.meta.env.SSR` jest fałszywe, więc bramka serwerowa się
    // nie montuje i fallbacku nie zobaczylibyśmy w ogóle.
    const section = withWidgets([makeWidget("post-list"), makeWidget("slider")]);
    function NigdyNieGotowe(): never {
      throw new Promise<void>(() => {});
    }
    const { container } = render(
      <StreamingSection section={section} lang="pl" enabled>
        <NigdyNieGotowe />
      </StreamingSection>,
    );
    const root = container.querySelector<HTMLElement>("[data-section-stream-skeleton]");
    const oczekiwane = estimateSectionHeight(section);
    expect(root?.style.minHeight).toBe(`${oczekiwane}px`);
    // Kontrakt kierunku: szacunek tej sekcji jest WYŻSZY niż dawna stała.
    expect(oczekiwane).toBeGreaterThan(SECTION_STREAM_MIN_HEIGHT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUDŻET STRUMIENIA - jedyna rzecz, która dzieli „sekcja doklei się później"
// od „dokument nigdy nie wyjdzie z serwera".
//
// Bramka zawiesza render, więc martwe zapytanie (zerwana sieć, RLS bez
// odpowiedzi, awaria origin) zatrzymywałoby dehydratację routera - a więc CAŁY
// dokument, nie jedną sekcję. Twardy limit 2 s jest zabezpieczeniem tej awarii
// i nie ma żadnego innego dowodu na to, że działa, poza testem z zegarem.
// ─────────────────────────────────────────────────────────────────────────────

describe("ServerSectionGate - wyczerpanie budżetu", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Atrapa prefetchu: zapytanie o podanym kluczu ROZSTRZYGA, reszta wisi. */
  function mockPrefetch(settledKey?: QueryKey) {
    vi.spyOn(qc, "prefetchQuery").mockImplementation((options) => {
      const queryKey = (options as { queryKey: QueryKey }).queryKey;
      const settles =
        settledKey !== undefined && JSON.stringify(queryKey) === JSON.stringify(settledKey);
      return qc
        .fetchQuery({
          queryKey: queryKey as QueryKey,
          queryFn: (): Promise<unknown> =>
            settles ? Promise.resolve([]) : new Promise<never>(() => {}),
          retry: false,
        })
        .then(
          () => undefined,
          () => undefined,
        );
    });
  }

  function renderGate(section: SectionNode) {
    return render(
      <Suspense fallback={<span>FALLBACK</span>}>
        <ServerSectionGate section={section} lang="pl">
          <span>CONTENT</span>
        </ServerSectionGate>
      </Suspense>,
      { wrapper: wrapper(qc) },
    );
  }

  it("limit jest twardy i wynosi 2 sekundy", () => {
    // Wartość jest kontraktem z dokumentem: świadomie KRÓTSZA niż globalny
    // watchdog zapytań, bo strumień sekcji to ulepszenie, a dokument to byt.
    expect(SERVER_SECTION_STREAM_BUDGET_MS).toBe(2_000);
  });

  it("przed upływem budżetu bramka NADAL trzyma zawieszenie", async () => {
    const section = withWidgets([makeWidget("post-list")], "budzet-1");
    mockPrefetch();
    renderGate(section);

    expect(screen.getByText("FALLBACK")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS - 1);
    });

    expect(screen.getByText("FALLBACK")).toBeTruthy();
    expect(screen.queryByText("CONTENT")).toBeNull();
  });

  it("po upływie budżetu sekcja jest PRZEPUSZCZANA mimo martwego zapytania", async () => {
    // To jest cała racja bytu limitu: widget zaraz namaluje swój własny stan
    // pusty/błędu, ale dokument RUSZA. Bez tego jedna zerwana sekcja
    // zatrzymywałaby całą stronę.
    const section = withWidgets([makeWidget("post-list")], "budzet-2");
    mockPrefetch();
    renderGate(section);

    expect(screen.getByText("FALLBACK")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });

    expect(screen.getByText("CONTENT")).toBeTruthy();
    expect(screen.queryByText("FALLBACK")).toBeNull();
  });

  it("martwy wpis jest USUWANY z cache, żeby klient nie odziedziczył wiecznego pending", async () => {
    // Wpis w stanie „pending bez danych" przechodzi do dehydratacji i klient
    // hydratuje widget, który NIGDY nie zacznie pobierać. Skasowanie wpisu
    // sprawia, że po hydratacji widget wykonuje normalne, świeże zapytanie.
    const section = withWidgets([makeWidget("post-list")], "budzet-3");
    const [deadKey] = sectionQueryOptionsList(section, "pl").map((o) => o.queryKey as QueryKey);
    mockPrefetch();
    renderGate(section);

    expect(qc.getQueryState(deadKey)?.status).toBe("pending");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });

    expect(qc.getQueryState(deadKey)).toBeUndefined();
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  /** Sekcja z DWOMA zapytaniami o różnych kluczach (różny `limit`). */
  function mixedSection(id: string): SectionNode {
    return withWidgets(
      [
        makeWidget("post-list", { content: { items: [], limit: 3 } } as Partial<WidgetNode>),
        makeWidget("post-list", { content: { items: [], limit: 9 } } as Partial<WidgetNode>),
      ],
      id,
    );
  }

  it("dane, które ZDĄŻYŁY dojechać, przeżywają wyczerpanie budżetu", async () => {
    // Sprzątanie po limicie musi być chirurgiczne: kasujemy WYŁĄCZNIE wpisy
    // wiszące. Skasowanie wpisu, który się udał, oznaczałoby drugie zapytanie
    // po hydratacji o dane już opłacone na serwerze.
    const section = mixedSection("budzet-4");
    const keys = sectionQueryOptionsList(section, "pl").map((o) => o.queryKey as QueryKey);
    expect(keys).toHaveLength(2);
    const [settledKey, deadKey] = keys;
    mockPrefetch(settledKey);
    renderGate(section);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });

    expect(qc.getQueryState(settledKey)?.status).toBe("success");
    expect(qc.getQueryState(settledKey)?.data).toEqual([]);
    // Zapytanie martwe nie dostaje żadnych zmyślonych danych.
    expect(qc.getQueryState(deadKey)?.status).not.toBe("success");
  });

  // Regression: partial success must not reset the section deadline.
  it("po 2 s sekcja MUSI być przepuszczona także wtedy, gdy część zapytań zdążyła", async () => {
    const section = mixedSection("budzet-4b");
    const [settledKey] = sectionQueryOptionsList(section, "pl").map((o) => o.queryKey as QueryKey);
    mockPrefetch(settledKey);
    renderGate(section);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });

    expect(screen.queryByText("FALLBACK")).toBeNull();
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("raz wyczerpana sekcja NIE zawiesza się drugi raz przy ponownym montowaniu", async () => {
    // Pamięć wyczerpania jest trzymana per QueryClient (WeakMap), więc kolejny
    // render tego samego dokumentu w tym samym żądaniu nie płaci budżetu od
    // nowa - inaczej jedna martwa sekcja kosztowałaby 2 s za KAŻDYM razem.
    const section = withWidgets([makeWidget("post-list")], "budzet-5");
    mockPrefetch();
    const first = renderGate(section);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });
    expect(screen.getByText("CONTENT")).toBeTruthy();
    first.unmount();

    renderGate(section);
    // Bez ani jednego tyknięcia zegara - dowód, że nowy budżet nie wystartował.
    expect(screen.getByText("CONTENT")).toBeTruthy();
    expect(screen.queryByText("FALLBACK")).toBeNull();
  });

  it("pamięć wyczerpania NIE przecieka na inny QueryClient", async () => {
    // Każde żądanie SSR ma własny QueryClient. Gdyby rekord siedział w module,
    // pierwsze nieudane żądanie wyłączałoby strumieniowanie tej sekcji dla
    // WSZYSTKICH kolejnych odwiedzających tego samego procesu.
    const section = withWidgets([makeWidget("post-list")], "budzet-6");
    mockPrefetch();
    const first = renderGate(section);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });
    expect(screen.getByText("CONTENT")).toBeTruthy();
    first.unmount();

    const fresh = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(fresh, "prefetchQuery").mockImplementation(() => new Promise<void>(() => {}));
    render(
      <Suspense fallback={<span>FALLBACK</span>}>
        <ServerSectionGate section={section} lang="pl">
          <span>CONTENT</span>
        </ServerSectionGate>
      </Suspense>,
      { wrapper: wrapper(fresh) },
    );

    expect(screen.getByText("FALLBACK")).toBeTruthy();
  });

  it("ten sam identyfikator sekcji w DRUGIM języku dostaje własny budżet", async () => {
    // Klucz rekordu zaczyna się od języka, bo PL i EN to inne zapytania i inne
    // dane - wyczerpanie budżetu na PL nie może przepuścić EN bez próby.
    const section = withWidgets([makeWidget("post-list")], "budzet-7");
    mockPrefetch();
    const first = renderGate(section);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
    });
    expect(screen.getByText("CONTENT")).toBeTruthy();
    first.unmount();

    render(
      <Suspense fallback={<span>FALLBACK</span>}>
        <ServerSectionGate section={section} lang="en">
          <span>CONTENT</span>
        </ServerSectionGate>
      </Suspense>,
      { wrapper: wrapper(qc) },
    );
    expect(screen.getByText("FALLBACK")).toBeTruthy();
  });
});
