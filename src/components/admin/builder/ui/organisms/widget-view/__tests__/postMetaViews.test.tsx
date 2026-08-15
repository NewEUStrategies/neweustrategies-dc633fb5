// Licznik odsłon widgetu `post-meta`.
//
// REGRESJA: kanwa pokazywała 1234 z próbki, a publiczna trasa NIGDY nie
// ustawiała `viewCount`, więc licznik nie mógł pojawić się na stronie - opcja
// "Pokaż liczbę odsłon" była w praktyce martwa. Teraz realną wartość dostarcza
// tenant-scoped RPC `post_view_count`, dociągane leniwie: tylko gdy redaktor
// włączył licznik i kontekst nie niesie już wartości.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { DynamicTagWidget } from "../DynamicTagWidgets";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";
import type { WidgetNode } from "@/lib/builder/types";

const hoisted = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: hoisted.rpc },
}));

const CTX: CurrentPostCtx = {
  kind: "post",
  id: "11111111-2222-3333-4444-555555555555",
  slug: "wpis",
  title_pl: "Wpis",
  publishedAt: "2026-02-02T10:00:00Z",
};

function metaNode(content: Record<string, unknown>): WidgetNode {
  return {
    id: "pm-1",
    kind: "widget",
    type: "post-meta",
    content: content as WidgetNode["content"],
  };
}

function renderMeta(ui: ReactElement, ctx: CurrentPostCtx = CTX) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  hoisted.rpc.mockReset();
  hoisted.rpc.mockResolvedValue({ data: 4321, error: null });
});
afterEach(cleanup);

describe("post-meta - realny licznik odsłon", () => {
  it("dociąga liczbę odsłon tenant-scoped RPC i formatuje ją", async () => {
    const { container } = renderMeta(
      <DynamicTagWidget node={metaNode({ showViews: true })} lang="en" />,
    );
    await waitFor(() => expect(container.textContent).toContain("4,321"));
    expect(hoisted.rpc).toHaveBeenCalledWith("post_view_count", { _post_id: CTX.id });
  });

  it("akceptuje bigint zwrócony jako string", async () => {
    hoisted.rpc.mockResolvedValue({ data: "77", error: null });
    const { container } = renderMeta(
      <DynamicTagWidget node={metaNode({ showViews: true })} lang="pl" />,
    );
    await waitFor(() => expect(container.textContent).toContain("77"));
  });

  it("NIE strzela do bazy, gdy licznik jest wyłączony", async () => {
    renderMeta(<DynamicTagWidget node={metaNode({ showViews: false })} lang="pl" />);
    await waitFor(() => expect(hoisted.rpc).not.toHaveBeenCalled());
  });

  it("NIE strzela do bazy, gdy kontekst niesie już licznik (kanwa buildera)", async () => {
    const { container } = renderMeta(
      <DynamicTagWidget node={metaNode({ showViews: true })} lang="pl" />,
      { ...CTX, viewCount: 1234 },
    );
    const formatted = new Intl.NumberFormat("pl-PL").format(1234);
    await waitFor(() => expect(container.textContent).toContain(formatted));
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it("nie pokazuje licznika, gdy RPC nie jest jeszcze wdrożone", async () => {
    hoisted.rpc.mockResolvedValue({ data: null, error: { message: "PGRST202" } });
    const { container } = renderMeta(
      <DynamicTagWidget node={metaNode({ showViews: true, showDate: false })} lang="pl" />,
    );
    await waitFor(() => expect(hoisted.rpc).toHaveBeenCalled());
    expect(container.textContent).not.toContain("4321");
  });
});
