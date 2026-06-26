// Editable-canvas coverage for WidgetView: the inline <Editable> commit
// callbacks, ResizableBox sizing, and the editable branches of heading / text /
// button / nav-link / cta / dark-featured-card / newsletter that the read-only
// tests never reach.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { WidgetNode, WidgetType, WidgetContent } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
}));

let nextId = 0;
function renderEditable(type: WidgetType, content: WidgetContent) {
  const onContentChange = vi.fn();
  const node: WidgetNode = { id: `e-${nextId++}`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang="pl"
        device="desktop"
        editable
        onContentChange={onContentChange}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onContentChange };
}

/** Edit the n-th contenteditable node and blur to fire its commit. */
function editAndBlur(container: HTMLElement, text: string, index = 0) {
  const editables = container.querySelectorAll<HTMLElement>("[contenteditable]");
  const el = editables[index];
  el.textContent = text;
  fireEvent.blur(el);
  return el;
}

afterEach(cleanup);

describe("WidgetView editable commits", () => {
  it("heading commits edited title text", () => {
    const { container, onContentChange } = renderEditable("heading", {
      text_pl: "Stary",
      tag: "h2",
    });
    editAndBlur(container, "Nowy nagłówek");
    expect(onContentChange).toHaveBeenCalledWith("text_pl", "Nowy nagłówek");
  });

  it("text commits sanitized html", () => {
    const { container, onContentChange } = renderEditable("text", { html_pl: "<p>stare</p>" });
    const el = container.querySelector<HTMLElement>("[contenteditable]")!;
    el.innerHTML = "<p>nowe</p>";
    fireEvent.blur(el);
    expect(onContentChange).toHaveBeenCalledWith("html_pl", expect.stringContaining("nowe"));
  });

  it("button renders an editable label inside a resizable box and commits", () => {
    const { container, onContentChange } = renderEditable("button", {
      label_pl: "Klik",
      widthPx: 120,
      heightPx: 40,
    });
    expect(container.querySelector('[role="slider"]')).toBeTruthy();
    editAndBlur(container, "Nowy");
    expect(onContentChange).toHaveBeenCalledWith("label_pl", "Nowy");
  });

  it("nav-link commits its edited label", () => {
    const { container, onContentChange } = renderEditable("nav-link", {
      label_pl: "Menu",
      variant: "primary",
      iconName: "Star",
    });
    editAndBlur(container, "Nawigacja");
    expect(onContentChange).toHaveBeenCalledWith("label_pl", "Nawigacja");
  });

  it("cta commits both title and action edits", () => {
    const { container, onContentChange } = renderEditable("cta", {
      title_pl: "Tytuł",
      cta_pl: "Akcja",
      variant: "split",
      ctaWidthPx: 100,
      ctaHeightPx: 40,
    });
    const editables = container.querySelectorAll<HTMLElement>("[contenteditable]");
    editables[0].textContent = "Nowy tytuł";
    fireEvent.blur(editables[0]);
    editables[1].textContent = "Nowa akcja";
    fireEvent.blur(editables[1]);
    expect(onContentChange).toHaveBeenCalledWith("title_pl", "Nowy tytuł");
    expect(onContentChange).toHaveBeenCalledWith("cta_pl", "Nowa akcja");
  });

  it("dark-featured-card commits its edited badge", () => {
    const { container, onContentChange } = renderEditable("dark-featured-card", {
      badge_pl: "WYRÓŻNIONE",
      title_pl: "Tytuł",
      image: "https://cdn.example.com/c.jpg",
    });
    editAndBlur(container, "NOWE");
    expect(onContentChange).toHaveBeenCalledWith("badge_pl", "NOWE");
  });

  it("renders editable newsletter previews for every variant", () => {
    for (const variant of ["inline", "card", "minimal", "icon-only", "icon"]) {
      expect(() => renderEditable("newsletter", { title_pl: "Newsletter", variant })).not.toThrow();
    }
  });
});

describe("WidgetView unknown widget", () => {
  it("renders nothing for an unhandled widget type", () => {
    const { container } = renderEditable("totally-unknown" as WidgetType, {});
    expect(container.firstChild).toBeNull();
  });
});
