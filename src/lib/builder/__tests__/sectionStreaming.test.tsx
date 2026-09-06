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
import { sectionQueryOptionsList } from "@/lib/builder/prefetch";

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
        <ServerSectionGate section={section} lang="pl">
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
});

describe("shouldStreamSection (eager-vs-stream decision)", () => {
  const dataSection = withWidgets([makeWidget("post-list")]);
  const staticSection = withWidgets([makeWidget("heading")]);

  it("does not stream when streaming is disabled", () => {
    expect(shouldStreamSection(dataSection, "pl", 9, 3, false)).toBe(false);
  });

  it("renders above-the-fold data sections eagerly (index < aboveFoldCount)", () => {
    // $.tsx-style: leading sections are prefetched in the loader, so they stay
    // eager to land the hero's data in the shell.
    expect(shouldStreamSection(dataSection, "pl", 1, 3, true)).toBe(false);
  });

  it("streams below-the-fold data sections", () => {
    expect(shouldStreamSection(dataSection, "pl", 9, 3, true)).toBe(true);
  });

  it("never streams a section without data-bound queries (static hero stays eager)", () => {
    // Even at index 0 with aboveFoldCount 0, a query-less section is eager, so
    // the homepage hero is never delayed by streaming.
    expect(shouldStreamSection(staticSection, "pl", 0, 0, true)).toBe(false);
  });

  it("streams every data-bound section when aboveFoldCount is 0 (homepage)", () => {
    // The homepage cannot prefetch above the fold in its loader, so it passes
    // aboveFoldCount={0}: the very first data-bound section must stream through
    // the server gate (server-rendered data in the CDN-cached HTML) rather than
    // render eagerly and flash a client-fetched skeleton.
    expect(shouldStreamSection(dataSection, "pl", 0, 0, true)).toBe(true);
  });
});

describe("StreamingSection", () => {
  // In the test (browser-like) environment import.meta.env.SSR is false, so the
  // server gate is never mounted: every branch must render its children, proving
  // streaming never regresses the client/hydration render path.
  const child = <span>CONTENT</span>;

  it("renders eagerly when streaming is disabled", () => {
    render(
      <StreamingSection
        section={withWidgets([makeWidget("post-list")])}
        lang="pl"
        index={9}
        aboveFoldCount={3}
        enabled={false}
      >
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("renders above-the-fold sections eagerly", () => {
    render(
      <StreamingSection
        section={withWidgets([makeWidget("post-list")])}
        lang="pl"
        index={1}
        aboveFoldCount={3}
        enabled
      >
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("renders below-the-fold sections that have no data queries eagerly", () => {
    render(
      <StreamingSection
        section={withWidgets([makeWidget("heading")])}
        lang="pl"
        index={9}
        aboveFoldCount={3}
        enabled
      >
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
  });

  it("keeps the client render intact for below-the-fold data sections", () => {
    render(
      <StreamingSection
        section={withWidgets([makeWidget("post-list")])}
        lang="pl"
        index={9}
        aboveFoldCount={3}
        enabled
      >
        {child}
      </StreamingSection>,
    );
    expect(screen.getByText("CONTENT")).toBeTruthy();
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

  // DEFEKT: BUDŻET SEKCJI NIE JEST TWARDY - ZBIÓR ZAPYTAŃ KURCZY SIĘ I LIMIT
  // STARTUJE OD NOWA.
  //
  // WEJSCIE: sekcja nad zgięciem z DWOMA zapytaniami o różnych kluczach
  //   (tu: dwie post-listy o różnym `limit`; w produkcji równie dobrze slider,
  //   który sam wystawia zapytanie o wpisy ORAZ o obrazy zapasowe). Jedno
  //   zapytanie rozstrzyga w oknie budżetu, drugie wisi - czyli dokładnie
  //   scenariusz częściowej awarii, na który limit ma być odpowiedzią.
  // CO PSUJE: rekord budżetu jest kluczowany ZBIOREM kluczy oczekujących -
  //   `sectionGateKey` (src/lib/builder/sectionStreaming.tsx:66-72) skleja
  //   `lang:sectionId:klucz1|klucz2`. Po wyczerpaniu limitu React ponawia
  //   render, `pendingSectionQueries` (:142) pomija zapytanie, które już się
  //   udało, więc zbiór kurczy się do JEDNEGO klucza - i `sectionGateKey`
  //   zwraca INNY łańcuch. `records.get(key)` (:147) nie znajduje rekordu,
  //   powstaje świeży z `exhausted: false`, a `createBoundedSectionPrefetch`
  //   (:156) uzbraja PEŁNE 2 s od nowa. Zapytanie skasowane przez
  //   `removeDeadSectionQueries` jest przy okazji tworzone ponownie.
  // KONSEKWENCJA: komentarz przy stałej obiecuje „hard cap for a single
  //   below-the-fold section”, a faktyczny czas trzymania dokumentu to 2 s
  //   RAZY liczba różnych momentów, w których cokolwiek się rozstrzygnie.
  //   Sekcja z trzema zapytaniami schodzącymi po kolei blokuje dehydratację
  //   routera na 6 s zamiast 2 s - i to na cold renderze, czyli dokładnie
  //   wtedy, gdy TTFB jest jedyną rzeczą, której ten moduł miał bronić.
  // WYMAGANA POPRAWKA: kluczować rekord budżetu TOŻSAMOŚCIĄ sekcji
  //   (`lang:section.id`), a nie migawką zbioru kluczy oczekujących - wtedy
  //   `exhausted` przeżywa skurczenie zbioru i limit obowiązuje raz na sekcję.
  it.fails(
    "DEFEKT: po 2 s sekcja MUSI być przepuszczona także wtedy, gdy część zapytań zdążyła",
    async () => {
      const section = mixedSection("budzet-4b");
      const [settledKey] = sectionQueryOptionsList(section, "pl").map(
        (o) => o.queryKey as QueryKey,
      );
      mockPrefetch(settledKey);
      renderGate(section);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(SERVER_SECTION_STREAM_BUDGET_MS);
      });

      expect(screen.queryByText("FALLBACK")).toBeNull();
      expect(screen.getByText("CONTENT")).toBeTruthy();
    },
  );

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
