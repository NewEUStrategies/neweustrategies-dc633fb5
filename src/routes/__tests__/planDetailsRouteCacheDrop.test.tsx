// Trasa /plans/$planId w chwili WYLOGOWANIA - zrzut cache zapytań pod otwartą
// stroną planu.
//
// RYZYKO. `useAuth.signOut` woła `queryClient.clear()` przed twardą nawigacją
// (patrz komentarz tamże), więc strona planu zostaje na chwilę zamontowana
// BEZ katalogu w cache - jest w trakcie ponownego odczytu albo ten odczyt
// właśnie padł. W tej chwili strona NIE MOŻE ogłosić „Nie znaleziono takiego
// planu - mógł zostać wycofany ze sprzedaży.": to zdanie o KATALOGU, a
// katalogu jeszcze nie przeczytano. Cennik i dołączenie pokazują w tym samym
// stanie szkielet - strona planu ma mówić tę samą prawdę.
//
// Loader zawsze zasiewa cache (także fallbackiem przy awarii), więc zrzut
// cache to JEDYNA droga do katalogu `undefined` na tej trasie - stąd osobny
// plik, wzorem `pricingRouteCacheDrop.test.tsx`.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja, telemetria i adres
// żądania. Router, loader, zapytania i słowniki biegną PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const PLAN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const h = vi.hoisted(() => ({
  plans: [] as unknown[],
  /** Po „wylogowaniu" każdy ponowny odczyt wisi - sieć jeszcze nie odpowiedziała. */
  stalled: false,
  /** Po „wylogowaniu" ponowny odczyt katalogu pada. */
  broken: false,
  /** Liczba odczytów katalogu - dowód, że „Spróbuj ponownie" naprawdę ponawia. */
  planReads: 0,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  type Result = ReturnType<typeof ok>;
  const stub = supabaseFromStub();
  stub.setResponse("access_plans", () => {
    h.planReads += 1;
    if (h.stalled) return new Promise<Result>(() => {});
    return h.broken ? fail("test: tabela access_plans niedostępna") : ok(h.plans);
  });
  stub.setResponse("membership_tiers", () => (h.stalled ? new Promise<Result>(() => {}) : ok([])));
  return {
    supabase: {
      from: stub.from,
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: null, user: null, roles: [], loading: false }),
}));
vi.mock("@/lib/analytics/track", () => ({ trackCta: vi.fn() }));
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => `https://example.com/plans/${PLAN_ID}`,
  getOrigin: () => "https://example.com",
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute, type RenderedRoute } from "@/test/routeHarness";
import { accessPlan } from "@/test/billing/fixtures";
import { Route as PlanRoute } from "@/routes/plans.$planId";

const NOT_FOUND = "Nie znaleziono takiego planu - mógł zostać wycofany ze sprzedaży.";

async function mountPlan(): Promise<RenderedRoute> {
  const view = await renderRoute({
    route: PlanRoute,
    path: "/plans/$planId",
    initialEntry: `/plans/${PLAN_ID}`,
  });
  expect(await screen.findByRole("heading", { level: 1, name: "Członek" })).toBeInTheDocument();
  return view;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.stalled = false;
  h.broken = false;
  h.planReads = 0;
  h.plans = [accessPlan({ id: PLAN_ID, tier_key: "member", name_pl: "Członek" })];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /plans/$planId - zrzut cache przy wylogowaniu", () => {
  it("katalog w trakcie ponownego odczytu to szkielet, a nie „plan wycofany”", async () => {
    const view = await mountPlan();

    // Dokładnie to robi `useAuth.signOut`: `clear()` pod otwartą stroną.
    act(() => {
      h.stalled = true;
      view.queryClient.clear();
    });

    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 1, name: "Członek" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
    const skeleton = view.container.querySelector<HTMLElement>(
      "[aria-hidden='true'].animate-pulse",
    );
    expect(skeleton).not.toBeNull();
  });

  it("nieudany ponowny odczyt katalogu mówi „nie wiemy” z ponowieniem, nie „nie ma”", async () => {
    const view = await mountPlan();

    act(() => {
      h.broken = true;
      view.queryClient.clear();
    });

    expect(await screen.findByText("Ta sekcja chwilowo nie ma danych")).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();

    // Ponowienie dotyczy DOKŁADNIE katalogu - po powrocie backendu plan wraca.
    const readsBeforeRetry = h.planReads;
    h.broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Członek" })).toBeInTheDocument();
    expect(h.planReads).toBeGreaterThan(readsBeforeRetry);
  });
});
