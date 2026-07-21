// Synchronizacja pola wyszukiwarki z /search?q=... (most SearchUrlQSync).
// Osobny plik: tutejszy mock routera MA stan lokalizacji (pelny router),
// podczas gdy SearchButtonWidget.test.tsx celowo testuje wariant czesciowego
// routera bez stanu (izolowany render, lustro wylaczone).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

import { SearchButtonWidget } from "../SearchButtonWidget";

const routerState = vi.hoisted(() => ({
  location: { pathname: "/search", search: { q: "energia" } as Record<string, unknown> },
  listeners: new Set<() => void>(),
  navigate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: [], error: null }),
  },
}));

vi.mock("@tanstack/react-router", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-router")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    useRouter: () => ({
      navigate: routerState.navigate,
      preloadRoute: () => Promise.resolve(),
      state: { location: routerState.location },
    }),
    useRouterState: <T,>(opts?: { select?: (s: { location: unknown }) => T }): T => {
      // Minimalna, subskrybowalna wersja: test podmienia location i emituje.
      const snapshot = useSyncExternalStore(
        (cb: () => void) => {
          routerState.listeners.add(cb);
          return () => routerState.listeners.delete(cb);
        },
        () => routerState.location,
      );
      const state = { location: snapshot };
      return (opts?.select ? opts.select(state) : (state as unknown)) as T;
    },
  };
});

function setLocation(pathname: string, q?: string): void {
  routerState.location = { pathname, search: q === undefined ? {} : { q } };
  for (const cb of routerState.listeners) cb();
}

function renderWidget() {
  return render(
    <SearchButtonWidget
      label="Szukaj"
      mode="dropdown"
      heading=""
      liveResults={false}
      limit={8}
      lang="pl"
      height={40}
      radius={6}
      fontSize={14}
    />,
  );
}

describe("SearchButtonWidget - lustro ?q= z routera", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    routerState.location = { pathname: "/search", search: { q: "energia" } };
    routerState.listeners.clear();
    routerState.navigate.mockReset();
  });

  it("inicjalizuje pole synchronicznie z /search?q= (bez migniecia pustym inputem)", () => {
    const { container } = renderWidget();
    const input = container.querySelector("input");
    expect(input?.value).toBe("energia");
  });

  it("nawigacja na nowa fraze lustrzy sie do pola, gdy nie jest aktywne", () => {
    const { container } = renderWidget();
    act(() => setLocation("/search", "obronnosc"));
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("obronnosc");
  });

  it("zejscie ze strony wynikow czysci pole (header i strona nigdy sie nie rozjezdzaja)", () => {
    const { container } = renderWidget();
    act(() => setLocation("/analizy/jakis-wpis"));
    expect((container.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("nie nadpisuje frazy, ktora uzytkownik wlasnie wpisuje (fokus blokuje lustro)", () => {
    const { container } = renderWidget();
    const input = container.querySelector("input") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "moje zapytanie" } });
    act(() => setLocation("/search", "cos-innego"));
    expect(input.value).toBe("moje zapytanie");
    expect(screen.getByDisplayValue("moje zapytanie")).toBeInTheDocument();
  });
});
