import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useSectionPreload,
  isSectionFresh,
  __resetSectionPrefetchRegistry,
} from "@/lib/builder/useSectionPreload";
import * as prefetchMod from "@/lib/builder/prefetch";
import type { SectionNode, WidgetNode } from "@/lib/builder/types";

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

const sectionEmpty: SectionNode = {
  id: "s-empty",
  children: [{ kind: "column", id: "c", span: { desktop: 12 }, children: [] }],
} as unknown as SectionNode;

function withWidgets(widgets: WidgetNode[], id = "s1"): SectionNode {
  return {
    id,
    children: [{ kind: "column", id: `${id}-c`, span: { desktop: 12 }, children: widgets }],
  } as unknown as SectionNode;
}

/**
 * Prefetch jedzie przez `whenIdle`, a happy-dom nie zna `requestIdleCallback`,
 * więc moduł degraduje do `setTimeout(32)`. Czekamy na MAKROZADANIE - zanim
 * je puścimy, prefetchu po prostu jeszcze nie ma.
 */
async function flushIdle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe("useSectionPreload", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    __resetSectionPrefetchRegistry(qc);
    vi.spyOn(prefetchMod, "prefetchSectionQueries").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  /** Zamontuj, przepuść bezczynność, odmontuj - jedna "wizyta" na stronie. */
  async function visit(section: SectionNode, lang: "pl" | "en" = "pl"): Promise<void> {
    const view = renderHook(() => useSectionPreload(section, lang), {
      wrapper: makeWrapper(qc),
    });
    await flushIdle();
    view.unmount();
  }

  /** Sekcja z widgetem danych, której nikt jeszcze nie zasiał w cache'u. */
  function coldSection(id = "s-cold"): SectionNode {
    return withWidgets([makeWidget("post-list")], id);
  }

  it("prefetches when IntersectionObserver is unavailable and data is cold", async () => {
    await visit(coldSection());
    expect(prefetchMod.prefetchSectionQueries).toHaveBeenCalledTimes(1);
  });

  it("does not prefetch when disabled", async () => {
    renderHook(() => useSectionPreload(coldSection(), "pl", { enabled: false }), {
      wrapper: makeWrapper(qc),
    });
    await flushIdle();
    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();
  });

  it("nie prefetchuje sekcji bez widgetów danych - nie ma czego grzać", async () => {
    await visit(sectionEmpty);
    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();
  });

  it("NIE prefetchuje PRZY PIERWSZEJ wizycie, gdy dane są świeże (SSR)", async () => {
    // To jest cała stawka poprawki F39. Poprzednia bramka brzmiała
    // `registry.has(key) && isSectionFresh(...)`, więc przy pierwszej wizycie
    // ucinała się na pustym rejestrze, a świeżość nigdy nie dochodziła do
    // głosu: sekcja wyrenderowana serwerowo i tak płaciła za prefetch. Stary
    // komentarz w tym teście przyznawał to wprost („First mount may still
    // prefetch") - dziś to NIE jest już prawda.
    const section = withWidgets([makeWidget("post-list")]);
    const targets = prefetchMod.sectionCacheTargets(
      prefetchMod.collectSectionWidgets(section),
      "pl",
    );
    targets.forEach(({ key }) => qc.setQueryData(key, []));

    await visit(section);
    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();

    await visit(section);
    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();
  });

  it("prefetchuje dane nieświeże RAZ, a powtórną nawigację ucina rejestr", async () => {
    const section = withWidgets([makeWidget("post-list")]);
    const targets = prefetchMod.sectionCacheTargets(
      prefetchMod.collectSectionWidgets(section),
      "pl",
    );
    // Dane w cache'u, ale postarzone ręcznie - bramka świeżości ich nie puści.
    targets.forEach(({ key }) => {
      qc.setQueryData(key, []);
      const state = qc.getQueryState(key);
      const q = qc.getQueryCache().find({ queryKey: key });
      if (q && state) q.setState({ ...state, dataUpdatedAt: 1 });
    });

    await visit(section);
    await visit(section);

    // Rejestr pilnuje POWTÓRNYCH NAWIGACJI: prefetch tej pary w tym kliencie
    // już poszedł. Gdyby dane nadal były nieświeże w chwili montażu sekcji,
    // odświeży je `useQuery` samej sekcji (`refetchOnMount`), a nie obserwator.
    expect(prefetchMod.prefetchSectionQueries).toHaveBeenCalledTimes(1);
  });

  it("odmontowanie przed bezczynnością ANULUJE zaplanowany prefetch", async () => {
    // Sekcja, która mignęła w kadrze i zniknęła (nawigacja w trakcie
    // przewijania), nie ma prawa dociągnąć swoich zapytań po fakcie.
    const view = renderHook(() => useSectionPreload(coldSection("s-flash"), "pl"), {
      wrapper: makeWrapper(qc),
    });
    view.unmount();
    await flushIdle();

    expect(prefetchMod.prefetchSectionQueries).not.toHaveBeenCalled();
  });
});

describe("isSectionFresh", () => {
  let qc: QueryClient;
  beforeEach(() => {
    qc = new QueryClient();
  });

  it("returns true for a section with no data-bound widgets", () => {
    expect(isSectionFresh(qc, sectionEmpty, "pl")).toBe(true);
  });

  it("returns false when no cache entry exists for the section's widgets", () => {
    const section = withWidgets([makeWidget("post-list")]);
    expect(isSectionFresh(qc, section, "pl")).toBe(false);
  });

  it("returns true when every target has fresh cached data", () => {
    const section = withWidgets([makeWidget("post-list")]);
    const targets = prefetchMod.sectionCacheTargets(
      prefetchMod.collectSectionWidgets(section),
      "pl",
    );
    targets.forEach(({ key }) => qc.setQueryData(key, []));
    expect(isSectionFresh(qc, section, "pl")).toBe(true);
  });
});
