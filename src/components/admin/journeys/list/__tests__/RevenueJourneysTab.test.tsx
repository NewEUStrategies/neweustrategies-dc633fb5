// Zakładka „Ścieżki” huba (S8) - adres, stany i składanie organizmów; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Kontrakt I0: `data-testid="revenue-tab-journeys"` zostaje; do
//      hydratacji stan „wczytywanie”; zakładka nie renderuje już
//      `RevenueTabPreparing` („w przygotowaniu”).
//   2. Stany zamiast treści: brak roli -> `RoleGateNotice`, brak `aal2`
//      (`mfa_required`) -> `MfaRequiredNotice`, funkcje niewdrożone ->
//      komunikat z następnym krokiem.
//   3. Adres: `?status=` i `?q=` filtrują listę, szukanie przepisuje adres
//      z `replace`; `?new=1` otwiera galerię, `?template=<klucz>` otwiera
//      instalację tego szablonu; nieznany klucz jest ignorowany, a szablon
//      niedostępny nie otwiera instalacji.
//   4. Pusta lista bez filtra = galeria jako stan pusty; utworzenie ścieżki
//      prowadzi do edytora. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  hydrated: true,
  search: {} as Record<string, unknown>,
  auth: { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" } as {
    roles: string[];
    tenantId: string | null;
  },
  navigate: vi.fn(),
  list: vi.fn(),
  health: vi.fn(),
  catalog: vi.fn(),
  settings: vi.fn(),
  install: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => h.navigate,
  useSearch: () => h.search,
  useHydrated: () => h.hydrated,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  listJourneys: () => h.list(),
  getJourneyEngineHealth: () => h.health(),
  getJourneySettings: () => h.settings(),
  saveJourneySettings: vi.fn(),
  setJourneyStatus: vi.fn(),
  createJourney: vi.fn(),
  saveJourneyDraft: vi.fn(),
  installJourneyTemplate: (input: unknown) => h.install(input),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  listJourneyTemplateCatalog: () => h.catalog(),
}));
vi.mock("@/lib/crm/leadMutations", async () => {
  const { crmKeys } = await import("@/lib/crm/keys");
  return {
    crmStaffUsersQueryOptions: () => ({ queryKey: crmKeys.staffUsers(), queryFn: async () => [] }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { RevenueJourneysTab } from "@/components/admin/revenue/tabs/RevenueJourneysTab";
import { toCatalogEntry } from "@/lib/admin/journeys/journeyEditor.functions";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { parseEngineHealth, parseJourneyList, parseJourneySettings } from "@/lib/journeys/parse";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import { JOURNEY_TEMPLATE_KEYS } from "@/lib/journeys/templates/types";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const LIST = parseJourneyList([
  { ...RPC_SHAPES.list[0], id: J, status: "active", name: "Porzucona kasa (v1)" },
  {
    ...RPC_SHAPES.list[0],
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    key: "powitanie",
    name: "Powitanie",
    status: "paused",
    template_key: "welcome_onboarding",
    trigger_event_type: "account.registered.v1",
  },
]);
const CATALOG = JOURNEY_TEMPLATE_KEYS.map((key) => toCatalogEntry(JOURNEY_TEMPLATES[key]));

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RevenueJourneysTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.hydrated = true;
  h.search = {};
  h.auth = { roles: ["admin"], tenantId: "11111111-1111-4111-8111-111111111111" };
  h.navigate.mockReset();
  h.list.mockReset().mockResolvedValue({ state: "ready", data: LIST });
  h.health
    .mockReset()
    .mockResolvedValue({ state: "ready", data: parseEngineHealth(RPC_SHAPES.health, false) });
  h.catalog.mockReset().mockResolvedValue(CATALOG);
  h.settings
    .mockReset()
    .mockResolvedValue({ state: "ready", data: parseJourneySettings(RPC_SHAPES.settingsSaved) });
  h.install.mockReset();
});
afterEach(cleanup);

describe("kontrakt zakładki", () => {
  it("testid zostaje; przed hydratacją - wczytywanie, bez treści", () => {
    h.hydrated = false;
    mount();
    const tab = screen.getByTestId("revenue-tab-journeys");
    expect(tab).toHaveTextContent(t("adminRevenue.common.loading"));
    expect(h.list).not.toHaveBeenCalled();
  });

  it("po hydratacji: zdrowie silnika, lista, bez „w przygotowaniu”; axe bez naruszeń", async () => {
    const { container } = mount();
    const tab = screen.getByTestId("revenue-tab-journeys");
    expect(await within(tab).findByText("Porzucona kasa (v1)")).toBeInTheDocument();
    expect(within(tab).getByTestId("journey-engine-health")).toBeInTheDocument();
    expect(
      within(tab).getByRole("heading", { level: 2, name: t("adminJourneys.list.title") }),
    ).toBeInTheDocument();
    expect(tab).not.toHaveTextContent("w przygotowaniu");
    expect(tab.querySelector('[data-tour="journeys-list"]')).not.toBeNull();
    expect(screen.queryByTestId("journey-template-gallery")).toBeNull();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("stany zamiast treści", () => {
  it("autor (bez roli admin/editor) - RoleGateNotice, bez zapytań", () => {
    h.auth = { roles: ["author"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    expect(screen.getByTestId("revenue-role-gate")).toBeInTheDocument();
    expect(h.list).not.toHaveBeenCalled();
  });

  it("brak aal2 (mfa_required z middleware) - MfaRequiredNotice", async () => {
    h.list.mockRejectedValue(
      new Error("Forbidden: mfa_required - verify your second factor (aal2)"),
    );
    mount();
    expect(
      await screen.findByTestId("revenue-mfa-required", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("odmowa RPC (forbidden) - RoleGateNotice", async () => {
    h.list.mockResolvedValue({ state: "forbidden" });
    mount();
    expect(await screen.findByTestId("revenue-role-gate")).toBeInTheDocument();
  });

  it("funkcje silnika niewdrożone - komunikat z następnym krokiem", async () => {
    h.list.mockResolvedValue({ state: "unavailable" });
    mount();
    const notice = await screen.findByTestId("journeys-unavailable");
    expect(notice).toHaveTextContent(t("adminJourneys.list.unavailableTitle"));
    expect(notice).toHaveTextContent(t("adminJourneys.list.unavailableNext"));
  });
});

describe("adres zakładki", () => {
  it("?status= i ?q= filtrują listę; szukanie przepisuje adres z replace", async () => {
    h.search = { w: "month", status: "paused", q: "powi" };
    mount();
    expect(await screen.findByText("Powitanie")).toBeInTheDocument();
    expect(screen.queryByText("Porzucona kasa (v1)")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(t("adminJourneys.list.searchPlaceholder")), {
      target: { value: "kasa" },
    });
    expect(h.navigate).toHaveBeenLastCalledWith({
      to: "/admin/revenue/$tab",
      params: { tab: "journeys" },
      search: { w: "month", status: "paused", q: "kasa" },
      replace: true,
    });
    fireEvent.change(screen.getByRole("combobox", { name: t("adminJourneys.list.statusFilter") }), {
      target: { value: "" },
    });
    expect(h.navigate).toHaveBeenLastCalledWith({
      to: "/admin/revenue/$tab",
      params: { tab: "journeys" },
      search: { w: "month", q: "powi" },
      replace: false,
    });
  });

  it("„Nowa ścieżka” ustawia ?new=1, zachowując resztę adresu", async () => {
    h.search = { w: "quarter" };
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminJourneys.list.newJourney") }),
    );
    expect(h.navigate).toHaveBeenCalledWith({
      to: "/admin/revenue/$tab",
      params: { tab: "journeys" },
      search: { w: "quarter", new: "1" },
      replace: false,
    });
  });

  it("?new=1&template=<klucz> otwiera galerię z wyborem i instalację szablonu", async () => {
    h.search = { new: "1", template: "welcome_onboarding" };
    h.install.mockResolvedValue({
      ok: true,
      data: { id: J, updatedAt: "2026-10-20T10:00:00Z", status: "draft" },
    });
    mount();
    const gallery = await screen.findByTestId("journey-template-gallery");
    const name = t("adminJourneys.templates.welcome_onboarding.name");
    const dialog = await screen.findByRole("dialog", {
      name: t("adminJourneys.create.templateTitle", { name }),
    });
    // Modalne okno chowa resztę strony przed czytnikiem (`aria-hidden`) - karta
    // galerii jest pod spodem, zaznaczona.
    expect(
      within(gallery).getByRole("button", {
        name: t("adminJourneys.gallery.useFor", { name }),
        hidden: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    // Szablon już zainstalowany na liście - podpowiedź wolnego klucza.
    expect(within(dialog).getByLabelText(t("adminJourneys.create.key"))).toHaveValue(
      "welcome_onboarding",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("adminJourneys.create.submitTemplate") }),
    );
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith({
        to: "/admin/revenue/journeys/$journeyId",
        params: { journeyId: J },
      }),
    );
  });

  it("nieznany ?template= jest ignorowany - galeria bez instalacji", async () => {
    h.search = { new: "1", template: "nie_ma_takiego" };
    mount();
    expect(await screen.findByTestId("journey-template-gallery")).toBeInTheDocument();
    await screen.findAllByRole("button", {
      name: new RegExp(`^${t("adminJourneys.gallery.use")}`),
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByRole("button", { pressed: true })).toHaveLength(0);
  });

  it("szablon niedostępny z adresu nie otwiera instalacji (karta mówi dlaczego)", async () => {
    h.search = { new: "1", template: "pricing_enquiry_b2b" };
    mount();
    const gallery = await screen.findByTestId("journey-template-gallery");
    await waitFor(() =>
      expect(gallery.querySelector('[data-template-key="pricing_enquiry_b2b"]')).not.toBeNull(),
    );
    const card = gallery.querySelector('[data-template-key="pricing_enquiry_b2b"]') as HTMLElement;
    expect(card).toHaveAttribute("data-available", "false");
    expect(card).toHaveAttribute("data-selected", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("zamknięcie galerii zdejmuje ?new i ?template", async () => {
    h.search = { new: "1", w: "month" };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: t("adminJourneys.gallery.close") }));
    expect(h.navigate).toHaveBeenLastCalledWith({
      to: "/admin/revenue/$tab",
      params: { tab: "journeys" },
      search: { w: "month" },
      replace: false,
    });
  });
});

describe("stan pusty i ustawienia", () => {
  it("pusta lista bez filtra - galeria jako stan pusty (bez zamykania)", async () => {
    h.list.mockResolvedValue({ state: "ready", data: [] });
    mount();
    expect(await screen.findByTestId("journey-template-gallery")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("adminJourneys.gallery.close") })).toBeNull();
    expect(screen.getByText(t("adminJourneys.list.empty"))).toBeInTheDocument();
  });

  it("admin otwiera ustawienia silnika z paska zdrowia", async () => {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: t("adminJourneys.engineStrip.settings") }),
    );
    expect(
      await screen.findByRole("dialog", { name: t("adminJourneys.engineSettings.title") }),
    ).toBeInTheDocument();
  });

  it("redaktor: podgląd ustawień, bez akcji statusu", async () => {
    h.auth = { roles: ["editor"], tenantId: "11111111-1111-4111-8111-111111111111" };
    mount();
    expect(await screen.findByText("Porzucona kasa (v1)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("adminJourneys.engineStrip.preview") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: t("adminJourneys.list.columns.actions") }),
    ).toBeNull();
  });
});
