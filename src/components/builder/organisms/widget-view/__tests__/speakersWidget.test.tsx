// Behaviour coverage for the "speakers" widget: category filter with counts,
// search + highlight, bookmark toggle persisted per-widget in localStorage,
// "saved only" filter, load-more pagination and the clear-filters empty state.
// Renders through the real WidgetView like widgetBehavior.test.tsx.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";

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
    "order",
    "range",
    "limit",
    "ilike",
  ]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: { from: vi.fn(() => builder), rpc: vi.fn(async () => ({ data: [], error: null })) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function speaker(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `sp-${i}`,
    photo: "",
    name: `Speaker ${i}`,
    role_pl: `Rola ${i}`,
    role_en: `Role ${i}`,
    category_pl: i % 2 === 0 ? "Nauka" : "Design",
    category_en: i % 2 === 0 ? "Science" : "Design",
    gigs: i,
    rating: 4 + (i % 2 ? 0.5 : 0),
    reviews: i * 10,
    description_pl: `Opis ${i}`,
    description_en: `Description ${i}`,
    href: "",
    ...over,
  };
}

function renderSpeakers(content: WidgetContent, nodeId = "w-speakers") {
  const node: WidgetNode = { id: nodeId, kind: "widget", type: "speakers", content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("speakers widget", () => {
  it("renders heading, cards and category chips with counts", () => {
    renderSpeakers({
      heading_pl: "Prelegenci",
      speakers: [speaker(1), speaker(2), speaker(3)],
    } as unknown as WidgetContent);
    expect(screen.getByText("Prelegenci")).toBeTruthy();
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    const all = screen.getByRole("tab", { name: /Wszyscy/ });
    expect(all.textContent).toContain("3");
    expect(screen.getByRole("tab", { name: /Design/ }).textContent).toContain("2");
    expect(screen.getByRole("tab", { name: /Nauka/ }).textContent).toContain("1");
  });

  it("filters by category chip and can clear filters from the empty state", () => {
    renderSpeakers({
      speakers: [speaker(1), speaker(2)],
    } as unknown as WidgetContent);
    fireEvent.click(screen.getByRole("tab", { name: /Nauka/ }));
    expect(screen.queryByText("Speaker 1")).toBeNull();
    expect(screen.getByText("Speaker 2")).toBeTruthy();

    // Search for something absent within the category → empty state + reset.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "brak-takiego" } });
    expect(screen.getByText("Brak wyników wyszukiwania.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść filtry" }));
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.getByText("Speaker 2")).toBeTruthy();
  });

  it("highlights the search query in matching cards", () => {
    const { container } = renderSpeakers({
      speakers: [speaker(1), speaker(2)],
    } as unknown as WidgetContent);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "speaker 1" } });
    expect(screen.queryByText("Speaker 2")).toBeNull();
    expect(container.querySelector("mark")?.textContent).toBe("Speaker 1");
  });

  it("persists bookmarks per widget node and exposes the saved-only filter", () => {
    renderSpeakers({ speakers: [speaker(1), speaker(2)] } as unknown as WidgetContent, "node-abc");
    expect(screen.queryByRole("tab", { name: /Zapisani/ })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Dodaj do zakładek" })[0]);
    expect(
      JSON.parse(window.localStorage.getItem("cms:speakers:bookmarks:node-abc") ?? "[]"),
    ).toEqual(["sp-1"]);

    fireEvent.click(screen.getByRole("tab", { name: /Zapisani/ }));
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.queryByText("Speaker 2")).toBeNull();
  });

  it("paginates with the load-more button", () => {
    renderSpeakers({
      pageSize: 2,
      speakers: [speaker(1), speaker(2), speaker(3)],
    } as unknown as WidgetContent);
    expect(screen.getByText("Speaker 1")).toBeTruthy();
    expect(screen.queryByText("Speaker 3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Pokaż więcej/ }));
    expect(screen.getByText("Speaker 3")).toBeTruthy();
  });

  it("shows the results counter when filtering narrows the list", () => {
    renderSpeakers({
      speakers: [speaker(1), speaker(2), speaker(3)],
    } as unknown as WidgetContent);
    expect(screen.getByText("3 prelegentów")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Design/ }));
    expect(screen.getByText("2 / 3 prelegentów")).toBeTruthy();
  });
});
