// @vitest-environment node
//
// WYSPY SEKCJI NA SERWERZE (P2.2, krytyka planu m5 - klasa incydentu PR
// #423/#431: nowa granica `<Suspense>`, która zawiesza się na serwerze, zmienia
// kolejność strumienia, a jej fallback ląduje w powłoce). Wyspa leży WEWNĄTRZ
// `StreamingSection`, więc bramka danych sekcji zawiesza się w granicy
// strumienia: HTML serwera nie ma fallbacku wysp, ciepłe sekcje (z wyspami)
// są w powłoce, a zimna sekcja dochodzi jednym segmentem - jak bez wysp.
import { Writable } from "node:stream";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToPipeableStream, renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { BuilderRenderer } from "../BuilderRenderer";
import { column, doc, innerSection, section, widget } from "./builderRendererFixtures";
import type { SectionNode } from "@/lib/builder/types";

describe("BuilderRenderer server gate visibility", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.useFakeTimers();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(client, "prefetchQuery").mockImplementation(() => new Promise<void>(() => {}));
  });

  afterEach(() => {
    client.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderSection(value: SectionNode, device: "desktop" | "mobile" = "mobile") {
    return renderToString(
      <QueryClientProvider client={client}>
        <BuilderRenderer doc={doc([value])} lang="pl" device={device} stream />
      </QueryClientProvider>,
    );
  }

  const hero = () => column("hero", [widget("heading")]);
  const slow = () => widget("slow", "post-list", { content: {} });

  it("forwards the mobile device through StreamingSection, while desktop still waits", () => {
    const value = section("device", [
      hero(),
      column("data", [{ ...slow(), advanced: { hideOn: { mobile: true } } }]),
    ]);
    const mobile = renderSection(value);
    expect(mobile).toContain("T-heading");
    expect(mobile).not.toContain("data-section-stream-skeleton");
    expect(client.prefetchQuery).not.toHaveBeenCalled();
    const desktop = renderSection(value, "desktop");
    expect(desktop).toContain("data-section-stream-skeleton");
    expect(desktop).not.toContain("T-heading");
    expect(client.prefetchQuery).toHaveBeenCalled();
  });

  it.each(["widget", "column", "inner-section", "inner-column"] as const)(
    "does not wait for data behind access on a %s",
    (level) => {
      const access = { access: { auth: "user" as const } };
      const data = column(
        "data",
        [{ ...slow(), ...(level === "widget" ? { advanced: access } : {}) }],
        level === "column" || level === "inner-column" ? { advanced: access } : {},
      );
      const value = section("access", [
        hero(),
        level.startsWith("inner")
          ? innerSection("inner", [data], level === "inner-section" ? { advanced: access } : {})
          : data,
      ]);
      const html = renderSection(value);
      expect(html).toContain("T-heading");
      expect(html).not.toContain("data-section-stream-skeleton");
      expect(client.prefetchQuery).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "active", "missing"])(
    "uses the renderer's initial tab when defaultTabId=%s",
    (defaultTabId) => {
      const value = section(
        "tabs",
        [
          hero(),
          column("active", [widget("active-heading")], { tabId: "active" }),
          innerSection("inactive", [column("data", [slow()])], { tabId: "inactive" }),
        ],
        {
          tabs: {
            enabled: true,
            items: [
              { id: "active", label_pl: "Active" },
              { id: "inactive", label_pl: "Inactive" },
            ],
            defaultTabId,
          },
        },
      );
      const html = renderSection(value);
      expect(html).toContain("T-heading");
      expect(html).toContain("T-active-heading");
      expect(html).not.toContain("data-section-stream-skeleton");
      expect(client.prefetchQuery).not.toHaveBeenCalled();
      // Disabled tabs mount all children; their queries must still block.
      const untabbed = renderSection({ ...value, tabs: { ...value.tabs!, enabled: false } });
      expect(untabbed).toContain("data-section-stream-skeleton");
      expect(client.prefetchQuery).toHaveBeenCalled();
    },
  );
});

describe("wyspy sekcji na serwerze (P2.2)", () => {
  let client: QueryClient;
  let release: () => void = () => {};

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const cold = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Zimne dane sekcji: zapytanie rozstrzyga się dopiero po `release()`.
    vi.spyOn(client, "prefetchQuery").mockImplementation(async (options) => {
      await cold;
      client.setQueryData((options as { queryKey: readonly unknown[] }).queryKey, []);
    });
  });

  afterEach(() => {
    release();
    client.clear();
    vi.restoreAllMocks();
  });

  const app = (sections: SectionNode[]): ReactElement => (
    <QueryClientProvider client={client}>
      <BuilderRenderer doc={doc(sections)} lang="pl" stream />
    </QueryClientProvider>
  );
  const heading = (id: string) => section(id, [column(`${id}-c`, [widget(`${id}-h`)])]);
  const coldData = (id: string) =>
    section(id, [column(`${id}-c`, [widget(`${id}-lista`, "post-list", { content: {} })])]);

  it("HTML serwera: sekcje >= 1 w otoczce wyspy (`pending`) z treścią, bez fallbacku wysp; sekcja 0 bez otoczki", () => {
    const html = renderToString(app([heading("s0"), heading("s1"), heading("s2")]));

    expect(html).toContain('data-island-id="sec-s1"');
    expect(html).toContain('data-island-id="sec-s2"');
    expect(html).not.toContain('data-island-id="sec-s0"');
    expect(html).not.toContain("data-island-fallback");
    expect(html.match(/data-island-state="pending"/g)).toHaveLength(2);
    expect(html).toContain("T-s1-h");
    expect(html).toContain("T-s2-h");
  });

  it("kolejność strumienia bez zmian: zimna sekcja dochodzi JEDNYM segmentem za powłoką (szkielet w powłoce), wyspy ciepłych sekcji w powłoce, fallbacku wysp nigdzie", async () => {
    const chunks: string[] = [];
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
      final(callback) {
        finish();
        callback();
      },
    });
    let shellReady: () => void = () => {};
    const shell = new Promise<void>((resolve) => {
      shellReady = resolve;
    });
    const stream = renderToPipeableStream(
      app([heading("s0"), heading("s1"), coldData("s2"), heading("s3")]),
      {
        onShellReady() {
          stream.pipe(sink);
          shellReady();
        },
        onShellError(error) {
          throw error;
        },
      },
    );
    await shell;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const shellHtml = chunks.join("");

    // Powłoka: ciepłe wyspy z treścią, zimna sekcja jako szkielet strumienia.
    expect(shellHtml).toContain('data-island-id="sec-s1"');
    expect(shellHtml).toContain('data-island-id="sec-s3"');
    expect(shellHtml).toContain("T-s3-h");
    expect(shellHtml).toContain("data-section-stream-skeleton");
    expect(shellHtml).not.toContain('data-island-id="sec-s2"');
    expect(shellHtml).not.toContain("data-island-fallback");

    release();
    await done;
    const full = chunks.join("");
    const segment = full.slice(shellHtml.length);

    // Jeden segment (granica strumienia sekcji), w nim wyspa z treścią sekcji.
    expect(full.match(/<div hidden id="S:/g)).toHaveLength(1);
    expect(segment).toContain('data-island-id="sec-s2"');
    expect(segment).toContain('data-sec-id="s2"');
    expect(full).not.toContain("data-island-fallback");
  });
});
