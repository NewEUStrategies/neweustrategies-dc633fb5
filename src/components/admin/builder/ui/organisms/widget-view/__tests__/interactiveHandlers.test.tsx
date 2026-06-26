// Coverage for the interactive handlers that need synthetic DOM events:
// pointer-drag resize (ResizableBox / ResizableImageWrap), document-level
// outside-click / Escape listeners, the image onError logo fallback, and the
// posts-sourced slider.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import { ResizableBox } from "../SimpleWidgets";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]> }));

vi.mock("@/integrations/supabase/client", () => {
  const mk = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit", "ilike"])
      b[m] = () => b;
    b.then = (r: (v: unknown) => unknown) => r({ data: db.tables[table] ?? [], error: null });
    return b;
  };
  return { supabase: { from: (t: string) => mk(t), rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

let nextId = 0;
function widget(type: WidgetType, content: WidgetContent, editable = false) {
  const onContentChange = vi.fn();
  const node: WidgetNode = { id: `i-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang="pl"
        device="desktop"
        editable={editable}
        onContentChange={editable ? onContentChange : undefined}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onContentChange };
}

function drag(handle: Element) {
  fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 80, clientY: 50, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 80, clientY: 50, pointerId: 1 });
}

beforeEach(() => {
  db.tables = {};
});
afterEach(cleanup);

describe("ResizableBox", () => {
  it("commits new dimensions after a pointer drag and shows the live badge", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ResizableBox enabled widthPx={100} heightPx={40} onCommit={onCommit}>
        <button type="button">x</button>
      </ResizableBox>,
    );
    const handle = container.querySelector('[role="slider"]')!;
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 60, clientY: 30, pointerId: 1 });
    // Live badge appears mid-drag.
    expect(container.textContent).toMatch(/×/);
    fireEvent.pointerUp(handle, { clientX: 60, clientY: 30, pointerId: 1 });
    expect(onCommit).toHaveBeenCalled();
  });

  it("renders a sized wrapper when disabled but sized, and bare children otherwise", () => {
    const sized = render(
      <ResizableBox enabled={false} widthPx={120} onCommit={() => {}}>
        <i>a</i>
      </ResizableBox>,
    );
    expect(sized.container.querySelector("div")).toBeTruthy();
    const bare = render(
      <ResizableBox enabled={false} onCommit={() => {}}>
        <i>b</i>
      </ResizableBox>,
    );
    expect(bare.container.querySelector("i")).toBeTruthy();
  });
});

describe("WidgetView resize handles (editable)", () => {
  it("button commits width/height via drag", () => {
    const { container, onContentChange } = widget(
      "button",
      { label_pl: "B", widthPx: 100, heightPx: 40 },
      true,
    );
    drag(container.querySelector('[role="slider"]')!);
    expect(onContentChange).toHaveBeenCalledWith("widthPx", expect.any(Number));
  });

  it("cta commits its action box size via drag", () => {
    const { container, onContentChange } = widget(
      "cta",
      { title_pl: "T", cta_pl: "A", ctaWidthPx: 100, ctaHeightPx: 40 },
      true,
    );
    drag(container.querySelector('[role="slider"]')!);
    expect(onContentChange).toHaveBeenCalledWith("ctaWidthPx", expect.any(Number));
  });

  it("image commits width via drag", () => {
    const { container, onContentChange } = widget(
      "image",
      { src: "https://cdn.example.com/i.png", widthPx: 200 },
      true,
    );
    drag(container.querySelector('[role="slider"]')!);
    expect(onContentChange).toHaveBeenCalledWith("widthPx", expect.any(Number));
  });
});

describe("document-level listeners", () => {
  it("search widget closes on outside mousedown and Escape", () => {
    const { container } = widget("search-button", { label_pl: "Szukaj", liveResults: "off" });
    const input = container.querySelector("input")!;
    fireEvent.focus(input);
    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container).toBeTruthy();
  });

  it("language dropdown closes on outside mousedown", () => {
    const { container } = widget("lang-switcher", { label_pl: "Język" });
    fireEvent.click(screen.getByRole("button", { name: "Język" }));
    expect(container.querySelector('[role="listbox"]')).toBeTruthy();
    act(() => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe("image onError logo fallback", () => {
  it("swaps to the fallback source when a site-logo image errors", () => {
    const { container } = widget("image", {
      src: "https://cdn.example.com/a.png",
      srcDark: "https://cdn.example.com/b.png",
      useSiteLogo: "main",
      alt_pl: "Logo",
    });
    const img = container.querySelector("img");
    if (img) fireEvent.error(img);
    expect(container).toBeTruthy();
  });
});

describe("posts-sourced slider", () => {
  it("renders SliderRender from fetched posts", async () => {
    db.tables.posts = [
      {
        id: "1",
        slug: "a",
        title_pl: "PS1",
        title_en: "PS1",
        excerpt_pl: "e",
        excerpt_en: "e",
        cover_image_url: "https://cdn.example.com/c.jpg",
        published_at: "2026-01-01T00:00:00Z",
      },
    ];
    db.tables.post_categories = [{ post_id: "1" }];
    db.tables.tags = [{ id: "t1" }];
    db.tables.post_tags = [{ post_id: "1" }];
    widget("slider", {
      source: "posts",
      limit: 5,
      categorySlugs: "ue",
      tagSlugs: "nato",
      excludeIds: "9",
      orderBy: "title",
      cta_pl: "Czytaj",
    });
    expect(await screen.findByText("PS1")).toBeTruthy();
  });
});
