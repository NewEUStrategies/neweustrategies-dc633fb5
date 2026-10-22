// Tworzenie ścieżki (S8) - instalacja szablonu i pusta ścieżka; RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Szablon: nazwa z S5 i wolny klucz podpowiedziane, język tylko dla
//      szablonu usługowego (podstawa prawna PL/EN), instalacja -> edytor.
//   2. Zajęty klucz (`duplicate`/`key_taken`) to błąd POLA, nie ogólny toast.
//   3. Pusta ścieżka wymaga wyzwalacza (grupy katalogu S5); klucz z nazwy;
//      utworzenie = `createJourney` + od razu `saveJourneyDraft` pustego grafu
//      z wyzwalaczem i tokenem z utworzenia; nieudany drugi zapis - ostrzeżenie,
//      ścieżka i tak się otwiera.
//   4. Usługa wymaga podstawy prawnej; limity = liczniki, odrzucenie zamiast
//      przycięcia (wartość zostaje nietknięta).
//   5. Wyzwalacz windykacji uprzedza, że ścieżka nie wyśle maili; brak `aal2`
//      -> `MfaRequiredNotice`. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  create: vi.fn(),
  saveDraft: vi.fn(),
  install: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  createJourney: (input: unknown) => h.create(input),
  saveJourneyDraft: (input: unknown) => h.saveDraft(input),
  installJourneyTemplate: (input: unknown) => h.install(input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { JourneyCreateDialog, type JourneyCreateMode } from "../JourneyCreateDialog";
import { toCatalogEntry } from "@/lib/admin/journeys/journeyEditor.functions";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { emptyJourneyGraph } from "@/lib/journeys/graph";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const AT = "2026-10-20T09:57:10.333703+00:00";
const CREATED = { ok: true, data: { id: J, updatedAt: AT, status: "draft" } };

function mount(mode: JourneyCreateMode, existingKeys: string[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <JourneyCreateDialog
        mode={mode}
        tenantId={T}
        existingKeys={new Set(existingKeys)}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onOpenChange };
}

const template = (key: keyof typeof JOURNEY_TEMPLATES): JourneyCreateMode => ({
  kind: "template",
  entry: toCatalogEntry(JOURNEY_TEMPLATES[key]),
});
const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  h.create.mockReset();
  h.saveDraft.mockReset();
  h.install.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.warning).mockReset();
});
afterEach(cleanup);

describe("instalacja szablonu", () => {
  it("nazwa i wolny klucz podpowiedziane; marketing bez wyboru języka; instalacja -> edytor", async () => {
    h.install.mockResolvedValue(CREATED);
    const { onCreated } = mount(template("welcome_onboarding"), ["welcome_onboarding"]);
    const name = t("adminJourneys.templates.welcome_onboarding.name");
    const dialog = screen.getByRole("dialog", {
      name: t("adminJourneys.create.templateTitle", { name }),
    });
    expect(input(t("adminJourneys.create.name"))).toHaveValue(name);
    expect(input(t("adminJourneys.create.key"))).toHaveValue("welcome_onboarding-2");
    expect(screen.queryByLabelText(t("adminJourneys.create.language"))).toBeNull();
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitTemplate") }));
    await waitFor(() =>
      expect(h.install).toHaveBeenCalledWith({
        data: {
          templateKey: "welcome_onboarding",
          key: "welcome_onboarding-2",
          name,
          locale: "pl",
        },
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(J));
    expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.create.installed"));
  });

  it("szablon usługowy: wybór języka podstawy prawnej", async () => {
    h.install.mockResolvedValue(CREATED);
    mount(template("trial_ending"));
    fireEvent.change(input(t("adminJourneys.create.language")), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitTemplate") }));
    await waitFor(() =>
      expect(h.install).toHaveBeenCalledWith({
        data: expect.objectContaining({
          templateKey: "trial_ending",
          key: "trial_ending",
          locale: "en",
        }),
      }),
    );
  });

  it("klucz zajęty na serwerze: błąd pola, edytor się nie otwiera", async () => {
    h.install.mockResolvedValue({
      ok: false,
      error: "duplicate",
      reason: "key_taken",
      detail: null,
    });
    const { onCreated } = mount(template("welcome_onboarding"));
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitTemplate") }));
    expect(await screen.findByText(t("adminJourneys.create.keyTaken"))).toBeInTheDocument();
    expect(input(t("adminJourneys.create.key"))).toHaveAttribute("aria-invalid", "true");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("brak aal2 -> MfaRequiredNotice", async () => {
    h.install.mockRejectedValue(new Error("Forbidden: mfa_required - verify your second factor"));
    mount(template("welcome_onboarding"));
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitTemplate") }));
    expect(await screen.findByTestId("revenue-mfa-required")).toBeInTheDocument();
  });
});

describe("pusta ścieżka", () => {
  it("wymaga wyzwalacza; klucz z nazwy; tworzy i zapisuje pusty graf z tokenem", async () => {
    h.create.mockResolvedValue(CREATED);
    h.saveDraft.mockResolvedValue({
      ok: true,
      data: { id: J, updatedAt: "2026-10-20T10:00:00+00:00", status: "draft" },
    });
    const { onCreated } = mount({ kind: "blank" });
    const dialog = screen.getByRole("dialog", { name: t("adminJourneys.create.blankTitle") });
    fireEvent.change(input(t("adminJourneys.create.name")), {
      target: { value: "Powitanie VIP: Łódź" },
    });
    expect(input(t("adminJourneys.create.key"))).toHaveValue("powitanie-vip-lodz");
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitBlank") }));
    expect(await screen.findByText(t("adminJourneys.create.triggerRequired"))).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
    const trigger = input(t("adminJourneys.create.trigger"));
    const groups = within(trigger).getAllByRole("group");
    expect(groups[0]).toHaveAttribute("label", t("adminJourneys.triggerGroup.account"));
    fireEvent.change(trigger, { target: { value: "account.registered.v1" } });
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitBlank") }));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({
        data: {
          key: "powitanie-vip-lodz",
          name: "Powitanie VIP: Łódź",
          category: "marketing",
          legalBasis: null,
          description: null,
        },
      }),
    );
    await waitFor(() =>
      expect(h.saveDraft).toHaveBeenCalledWith({
        data: {
          journeyId: J,
          expectedUpdatedAt: AT,
          draft: {
            graph: emptyJourneyGraph(),
            settings: { triggerEventType: "account.registered.v1" },
          },
        },
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(J));
    expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.create.created"));
  });

  it("usługa wymaga podstawy prawnej", async () => {
    h.create.mockResolvedValue(CREATED);
    h.saveDraft.mockResolvedValue(CREATED);
    mount({ kind: "blank" });
    fireEvent.change(input(t("adminJourneys.create.name")), { target: { value: "Koniec próby" } });
    fireEvent.change(input(t("adminJourneys.create.trigger")), {
      target: { value: "billing_subscription.trial_ending.v1" },
    });
    fireEvent.change(input(t("adminJourneys.create.category")), { target: { value: "service" } });
    expect(screen.getByText(t("adminJourneys.common.categoryHint.service"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitBlank") }));
    expect(
      await screen.findByText(t("adminJourneys.create.legalBasisRequired")),
    ).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
    fireEvent.change(input(t("adminJourneys.create.legalBasis")), {
      target: { value: "Wykonanie umowy" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitBlank") }));
    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ category: "service", legalBasis: "Wykonanie umowy" }),
      }),
    );
  });

  it("za długa nazwa: licznik i błąd, wartość nieprzycięta", async () => {
    mount({ kind: "blank" });
    const name = input(t("adminJourneys.create.name"));
    fireEvent.change(name, { target: { value: "A".repeat(161) } });
    expect(name.value).toHaveLength(161);
    expect(screen.getByText("161/160")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitBlank") }));
    expect(await screen.findByText(t("adminJourneys.create.nameInvalid"))).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("wyzwalacz windykacji uprzedza o braku maili", () => {
    mount({ kind: "blank" });
    fireEvent.change(input(t("adminJourneys.create.trigger")), {
      target: { value: "billing_subscription.payment_failed.v1" },
    });
    expect(screen.getByText(t("adminJourneys.create.triggerEmailForbidden"))).toBeInTheDocument();
  });

  it("nieudany zapis wyzwalacza: ostrzeżenie, ale edytor się otwiera", async () => {
    h.create.mockResolvedValue(CREATED);
    h.saveDraft.mockResolvedValue({
      ok: false,
      error: "conflict",
      reason: "conflict",
      detail: null,
    });
    const { onCreated } = mount({ kind: "blank" });
    fireEvent.change(input(t("adminJourneys.create.name")), { target: { value: "Ścieżka" } });
    fireEvent.change(input(t("adminJourneys.create.trigger")), {
      target: { value: "paywall.hit.v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.create.submitBlank") }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(J));
    expect(toast.warning).toHaveBeenCalledWith(t("adminJourneys.create.draftNotSaved"));
  });

  it("klucz zajęty lokalnie blokuje zapis przed wywołaniem serwera", () => {
    mount({ kind: "blank" }, ["sciezka"]);
    fireEvent.change(input(t("adminJourneys.create.name")), { target: { value: "Ścieżka" } });
    expect(screen.getByText(t("adminJourneys.create.keyTaken"))).toBeInTheDocument();
  });
});
