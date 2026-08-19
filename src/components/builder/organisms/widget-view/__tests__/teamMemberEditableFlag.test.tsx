// team-member: guard „w kanwie nie otwieramy modala" żył w TeamMemberWidget,
// ale dispatcher renderSimpleWidget nie przekazywał flagi `editable`, więc
// kliknięcie kafelka w builderze i tak otwierało modal z bio (zamiast zaznaczyć
// widget). Ten test pilnuje przekazania flagi na obu ścieżkach.
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";
import { renderSimpleWidget } from "../SimpleWidgets";

// Rejestr leniwych widgetow -> lustro eager: `team-member` jedzie przez
// React.lazy od 2026-08-15, wiec bez podmiany widget renderuje fallback.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// BrandIcon czyta bibliotekę ikon przez Supabase - thenable stub wystarczy.
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "in", "is", "order", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: (onF: (v: unknown) => unknown) => Promise<unknown> }).then = (onF) =>
    Promise.resolve({ data: [], error: null }).then(onF);
  (chain as { maybeSingle: () => Promise<unknown> }).maybeSingle = () =>
    Promise.resolve({ data: null, error: null });
  return { supabase: chain };
});

const CONTENT: WidgetContent = {
  name: "Anna Kowalska",
  position_pl: "Dyrektorka programu",
  bio_pl: "<p>Bio Anny.</p>",
};

function Member({ editable }: { editable: boolean }) {
  const node: WidgetNode = { id: "tm-1", kind: "widget", type: "team-member", content: CONTENT };
  return <>{renderSimpleWidget(node, "pl", undefined, editable)}</>;
}

function paint(editable: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Member editable={editable} />
    </QueryClientProvider>,
  );
}

describe("team-member - flaga editable dociera z dispatchera do widgetu", () => {
  it("does not open the bio modal inside the builder canvas", () => {
    paint(true);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still opens the bio modal on the public page", () => {
    paint(false);
    fireEvent.click(screen.getByRole("button", { name: "Anna Kowalska" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
