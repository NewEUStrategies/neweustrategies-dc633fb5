// Trasa /plans/$planId dla oferty WYCENIANEJ INDYWIDUALNIE (Decision Lab).
//
// RYZYKO. Strona szczegółów planu jest linkowalna i SSR-owalna - wchodzi się
// na nią z wyszukiwarki i z udostępnionego adresu, z pominięciem cennika.
// Dla oferty bez publicznej ceny to najgroźniejsze wejście: strona, która
// pokaże kwotę z `price_cents` (wartość techniczna w katalogu), okres próbny
// albo przycisk „Wybieram" prowadzący do checkoutu, sprzedaje Decision Lab
// po cenie, której nikt nie zatwierdził. Jedyną ścieżką jest zgłoszenie - a
// zgłoszenie musi dojść do Contact Center z NAZWĄ planu w temacie, bo plan
// nie ma warstwy, po której dział sprzedaży rozpoznałby lead.
//
// ATRAPOWANE SĄ WYŁĄCZNIE GRANICE: klient Supabase, sesja, telemetria, adres
// żądania i funkcja serwerowa Contact Center. Router (prawdziwy, pamięciowy,
// z prawdziwym `useServerFn`), loader, okno kontaktu i słowniki biegną
// PRAWDZIWE - asercje mierzą napisy, które zobaczy kupujący.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { AccessPlan } from "@/lib/billing/types";

const PLAN_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const h = vi.hoisted(() => ({
  plans: [] as unknown[],
  submit: vi.fn(),
  trackCta: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  stub.setResponse("access_plans", () => ok(h.plans));
  stub.setResponse("membership_tiers", ok([]));
  return {
    supabase: {
      from: stub.from,
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: async () => ({ data: [], error: null }),
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: null,
    user: null,
    roles: [],
    tenantId: null,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));
vi.mock("@/lib/analytics/track", () => ({ trackCta: h.trackCta }));
vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => `https://example.com/plans/${PLAN_ID}`,
  getOrigin: () => "https://example.com",
}));
// GRANICA SIECI: funkcja serwerowa Contact Center. `useServerFn` zostaje
// prawdziwy - działa w kontekście prawdziwego routera.
vi.mock("@/lib/contact.functions", () => ({
  submitContactMessage: (args: unknown) => h.submit(args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { renderRoute } from "@/test/routeHarness";
import { accessPlan, moneyPattern } from "@/test/billing/fixtures";
import { Route as PlanRoute } from "@/routes/plans.$planId";

function decisionLab(overrides: Partial<AccessPlan> = {}): AccessPlan {
  return accessPlan({
    id: PLAN_ID,
    tier_key: "decision_lab",
    name_pl: "Decision Lab",
    name_en: "Decision Lab",
    description_pl: "Cykl warsztatów decyzyjnych dla zarządu.",
    description_en: "Decision workshops for the board.",
    price_cents: 1_500_000,
    interval: "year",
    trial_days: 14,
    features_pl: ["Warsztat strategiczny"],
    features_en: ["Strategy workshop"],
    ...overrides,
  });
}

async function mount() {
  return renderRoute({
    route: PlanRoute,
    path: "/plans/$planId",
    initialEntry: `/plans/${PLAN_ID}`,
  });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.plans = [decisionLab()];
  h.submit.mockReset().mockResolvedValue({ ok: true });
  h.trackCta.mockReset();
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
});

describe("trasa /plans/$planId - oferta wyceniana indywidualnie", () => {
  it("NIE ujawnia kwoty, cyklu ani okresu próbnego - mówi „Wycena indywidualna”", async () => {
    const view = await mount();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Decision Lab" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Wycena indywidualna")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Zakres i koszt ustalamy po zgłoszeniu - liczba miejsc, cykl i zakres raportu.",
      ),
    ).toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(moneyPattern(1_500_000));
    expect(screen.queryByText("/ rok")).not.toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(/14 dni/);
  });

  it("NIE prowadzi do checkoutu - jedyną akcją jest zgłoszenie, a porównanie zostaje", async () => {
    await mount();
    await screen.findByRole("heading", { level: 1, name: "Decision Lab" });

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).not.toContain(`/checkout/${PLAN_ID}`);
    expect(screen.queryByRole("link", { name: /Wybieram|Wybierz/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wyślij zgłoszenie" })).toBeEnabled();
    expect(hrefs).toContain("/pricing");
  });

  it("zgłoszenie otwiera formularz kontaktu z NAZWĄ planu w temacie", async () => {
    await mount();
    await screen.findByRole("heading", { level: 1, name: "Decision Lab" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Wyślij zgłoszenie" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Porozmawiajmy o ofercie")).toBeInTheDocument();
    expect(within(dialog).getByText("Zapytanie o ofertę: Decision Lab")).toBeInTheDocument();
  });

  it("wysłane zgłoszenie dochodzi do Contact Center z tematem planu i zamyka okno", async () => {
    await mount();
    await screen.findByRole("heading", { level: 1, name: "Decision Lab" });
    fireEvent.click(screen.getByRole("button", { name: "Wyślij zgłoszenie" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Imię i nazwisko"), {
      target: { value: "Anna Testowa" },
    });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), {
      target: { value: "anna@example.com" },
    });
    fireEvent.change(within(dialog).getByLabelText("Wiadomość"), {
      target: { value: "Zarząd 9 osób, start w Q1" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Wyślij" }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect((h.submit.mock.calls[0][0] as { data: Record<string, unknown> }).data).toMatchObject({
      subject: "Zapytanie o ofertę: Decision Lab",
      email: "anna@example.com",
      source: "pricing",
      lang: "pl",
      consent: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("benefity planu i matryca limitów zostają - kupujący wie, o co pyta", async () => {
    await mount();

    expect(await screen.findByText("Warsztat strategiczny")).toBeInTheDocument();
    expect(screen.getByText("Limity i porównanie")).toBeInTheDocument();
  });
});
