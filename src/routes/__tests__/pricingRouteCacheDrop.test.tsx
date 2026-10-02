// Trasa /pricing w chwili WYLOGOWANIA - zrzut cache zapytań pod otwartą
// stroną.
//
// RYZYKO. Klucze rozliczeniowe (plany, subskrypcja, warstwa) są statyczne
// i niezależne od użytkownika, więc jedyną barierą przed pokazaniem stanu
// POPRZEDNIEGO KONTA na wspólnym urządzeniu jest `queryClient.clear()`
// w `useAuth.signOut` (patrz komentarz tamże). Cennik zostaje wtedy
// zamontowany na chwilę przed twardą nawigacją - i w tej chwili:
//
//   1. NIE MOŻE dalej pokazywać „Aktualny plan" poprzedniego konta (to cudza
//      subskrypcja na ekranie i zablokowany zakup dla następnej osoby),
//   2. NIE MOŻE ogłosić „Brak dostępnych planów." - katalog nie zniknął, jest
//      w trakcie ponownego odczytu; fałszywa pustka to oferta, której „nie ma",
//   3. pokazuje szkielet kart ukryty przed czytnikiem ekranu, a nagłówek
//      i sygnały zaufania zostają na miejscu.
//
// Loader zawsze zasiewa cache (także fallbackiem przy awarii), więc to jest
// JEDYNA droga do stanu „wczytuję" na tej trasie - stąd osobny plik.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja (sklep zewnętrzny,
// żeby zmiana sesji re-renderowała stronę jak prawdziwy kontekst), telemetria,
// adres żądania i kurs walutowy. Router, loader, zapytania, selektory cennika
// i słowniki biegną PRAWDZIWE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => {
  type Session = { user: { id: string } } | null;
  const listeners = new Set<() => void>();
  let session: Session = null;
  return {
    tiers: [] as unknown[],
    plans: [] as unknown[],
    audiences: [] as unknown[],
    subscriptions: [] as unknown[],
    /** Po „wylogowaniu" każdy ponowny odczyt wisi - sieć jeszcze nie odpowiedziała. */
    stalled: false,
    auth: {
      get: (): Session => session,
      set(next: Session) {
        session = next;
        listeners.forEach((notify) => notify());
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabase/chain");
  type Result = ReturnType<typeof ok>;
  const stub = supabaseFromStub();
  const answer = (table: string, rows: () => unknown) =>
    stub.setResponse(table, () => (h.stalled ? new Promise<Result>(() => {}) : ok(rows())));
  answer("pages", () => null);
  answer("pricing_audiences", () => h.audiences);
  answer("pricing_faq_items", () => []);
  answer("membership_tiers", () => h.tiers);
  answer("access_plans", () => h.plans);
  answer("user_subscriptions", () => h.subscriptions);
  return {
    supabase: {
      from: stub.from,
      auth: { getSession: async () => ({ data: { session: h.auth.get() } }) },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock("@/hooks/useAuth", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAuth: () => {
      const session = useSyncExternalStore(h.auth.subscribe, h.auth.get);
      return { session, user: session?.user ?? null, roles: [], loading: false };
    },
  };
});
vi.mock("@/lib/analytics/track", () => ({ trackCta: vi.fn() }));
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => "https://example.com/pricing",
  getOrigin: () => "https://example.com",
}));
vi.mock("@/lib/billing/fxRate", () => ({
  getEurPlnRate: () => 4,
  ensureFxRateLoaded: async () => 4,
  forceRefreshFxRate: async () => 4,
  getFxState: () => ({ eurPln: 4, source: "nbp" as const }),
  setEurPlnRateForTests: () => {},
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { membershipTier, pricingAudience } from "@/test/admin/pricingFixtures";
import { accessPlan } from "@/test/billing/fixtures";
import { DZIEN, freezeClock, relativeIso } from "@/test/time";
import { Route as PricingRoute } from "@/routes/pricing";

// Subskrypcja poprzedniego konta jest AKTYWNA względem zamrożonego „teraz" -
// stan „Aktualny plan" nie może zależeć od dnia, w którym biegnie test.
freezeClock();

function tierCard(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 3, name });
  return heading.closest("div[class*='flex h-full flex-col']") as HTMLElement;
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.stalled = false;
  h.audiences = [pricingAudience({ key: "individual" })];
  h.tiers = [
    membershipTier({ id: "tier-member", key: "member", rank: 10, audience_key: "individual" }),
  ];
  h.plans = [
    accessPlan({
      id: "plan-member-year",
      tier_key: "member",
      interval: "year",
      price_cents: 49000,
    }),
  ];
  h.subscriptions = [
    {
      id: "sub-1",
      user_id: "user-me",
      plan_id: "plan-member-year",
      status: "active",
      started_at: relativeIso(-14 * DZIEN),
      current_period_end: relativeIso(16 * DZIEN),
      canceled_at: null,
      plan: null,
    },
  ];
  h.auth.set({ user: { id: "user-me" } });
});

afterEach(async () => {
  cleanup();
  h.auth.set(null);
  await i18n.changeLanguage("pl");
});

describe("trasa /pricing - zrzut cache przy wylogowaniu", () => {
  it("cudzy „Aktualny plan” znika, a w miejscu kart stoi szkielet - nie „brak planów”", async () => {
    const view = await renderRoute({
      route: PricingRoute,
      path: "/pricing",
      initialEntry: "/pricing",
    });
    await waitFor(() =>
      expect(
        within(tierCard("Członek")).getByRole("button", { name: "Aktualny plan" }),
      ).toBeDisabled(),
    );

    // Dokładnie to robi `useAuth.signOut`: sesja na null, potem `clear()`.
    act(() => {
      h.stalled = true;
      h.auth.set(null);
      view.queryClient.clear();
    });

    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 3, name: "Członek" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Aktualny plan" })).not.toBeInTheDocument();
    expect(screen.queryByText("Brak dostępnych planów.")).not.toBeInTheDocument();

    const skeleton = view.container.querySelector<HTMLElement>("div[aria-hidden='true'].grid");
    expect(skeleton).not.toBeNull();
    expect(skeleton!.querySelectorAll(".animate-pulse")).toHaveLength(3);

    expect(screen.getByRole("heading", { level: 1, name: "Cennik" })).toBeInTheDocument();
    expect(screen.getByText("Bezpieczne płatności online")).toBeInTheDocument();
  });
});
