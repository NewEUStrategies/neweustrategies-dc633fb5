// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
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
