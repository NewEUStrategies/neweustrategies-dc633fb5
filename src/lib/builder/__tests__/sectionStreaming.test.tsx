import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense } from "react";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
// Initialize the shared i18n instance so useTranslation resolves in the skeleton.
import "@/lib/i18n";
import type { SectionNode, WidgetNode } from "@/lib/builder/types";
import {
  ServerSectionGate,
  SectionStreamSkeleton,
  StreamingSection,
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
