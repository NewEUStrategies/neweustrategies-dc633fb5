// SearchOverlay - axe (structural a11y) for the modal search surface:
// dialog semantics, combobox naming, listbox/option pattern, close button name.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";

const rows = vi.hoisted(() => ({
  data: [] as Array<Record<string, string | null>>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: rows.data, error: null }),
  },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useRouter: () => ({ navigate: vi.fn(), preloadRoute: vi.fn() }),
  };
});

import { SearchOverlay } from "../SearchOverlay";

beforeEach(() => {
  cleanup();
  localStorage.clear();
  rows.data = [];
});

describe("SearchOverlay a11y", () => {
  it("fullscreen overlay with results has no axe violations", async () => {
    rows.data = [
      { id: "1", slug: "a", title_pl: "Wynik A", title_en: "Result A", excerpt_pl: "opis" },
    ];
    const { container } = render(
      <SearchOverlay
        open
        onClose={() => {}}
        mode="fullscreen"
        heading="Szukaj"
        liveResults
        limit={8}
        lang="pl"
      />,
    );
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "wy" } });
    await waitFor(() => expect(screen.queryByText("Wynik A")).not.toBeNull());
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("empty state (no query) has no axe violations", async () => {
    const { container } = render(
      <SearchOverlay
        open
        onClose={() => {}}
        mode="fullscreen"
        heading="Search"
        liveResults
        limit={8}
        lang="en"
      />,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
