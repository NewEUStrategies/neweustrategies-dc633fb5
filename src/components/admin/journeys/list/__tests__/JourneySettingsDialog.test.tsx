// Ustawienia silnika ścieżek (S8) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Każde pole `journey_settings` jest w panelu: włączenie, limit 1-20/7 d,
//      cisza nocna (`TimeInput`, GG:MM), strefa, domyślna osoba, próg otwarć
//      maszynowych, nazwa nadawcy i Reply-To z licznikami, piksel otwarć.
//   2. Zapis wysyła WYŁĄCZNIE zmienione pola z tokenem `updated_at` (CAS);
//      wiersz jeszcze nie zapisany -> token `null`.
//   3. Włączenie silnika wymaga potwierdzenia z podsumowaniem.
//   4. Odrzucenie zamiast przycięcia: za długa nazwa / znak niedozwolony / zły
//      adres blokują zapis z komunikatem, a wartość zostaje nietknięta.
//   5. Konflikt = komunikat i świeży odczyt; brak `aal2` = `MfaRequiredNotice`.
//   6. Redaktor widzi podgląd tylko do odczytu. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  get: vi.fn(),
  save: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getJourneySettings: () => h.get(),
  saveJourneySettings: (input: unknown) => h.save(input),
}));
vi.mock("@/lib/crm/leadMutations", async () => {
  const { crmKeys } = await import("@/lib/crm/keys");
  return {
    crmStaffUsersQueryOptions: () => ({
      queryKey: crmKeys.staffUsers(),
      queryFn: async () => [
        { id: "aaaaaaaa-0000-4000-8000-0000000000aa", label: "Anna Kowalska" },
        { id: "aaaaaaaa-0000-4000-8000-0000000000bb", label: "Jan Nowak" },
      ],
    }),
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { toast } from "sonner";
import { JourneySettingsDialog } from "../JourneySettingsDialog";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { parseJourneySettings } from "@/lib/journeys/parse";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";
const TOKEN = RPC_SHAPES.settingsSaved.updated_at;
const SAVED = { state: "ready", data: parseJourneySettings(RPC_SHAPES.settingsSaved) };
const DEFAULTS = { state: "ready", data: parseJourneySettings(RPC_SHAPES.settingsDefault) };

function mount(canManage = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JourneySettingsDialog open onOpenChange={onOpenChange} tenantId={T} canManage={canManage} />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const saveButton = () =>
  screen.getByRole("button", { name: t("adminJourneys.engineSettings.save") });

beforeEach(() => {
  h.get.mockReset();
  h.save.mockReset();
  vi.mocked(toast.success).mockReset();
});
afterEach(cleanup);

describe("JourneySettingsDialog - admin", () => {
  it("każde pole silnika jest w panelu, z wartością z bazy", async () => {
    h.get.mockResolvedValue(SAVED);
    mount();
    const dialog = await screen.findByRole("dialog", {
      name: t("adminJourneys.engineSettings.title"),
    });
    await screen.findByLabelText(t("adminJourneys.settings.enabled"));
    expect(field(t("adminJourneys.settings.enabled")).checked).toBe(true);
    expect(field(t("adminJourneys.settings.marketingCap"))).toHaveValue("3");
    const quietStart = field(t("adminJourneys.settings.quietStart"));
    expect(quietStart).toHaveAttribute("type", "time");
    expect(quietStart).toHaveValue("22:00");
    expect(field(t("adminJourneys.settings.quietEnd"))).toHaveValue("08:00");
    expect(field(t("adminJourneys.settings.timezone"))).toHaveValue("Europe/Warsaw");
    expect(field(t("adminJourneys.settings.defaultTaskAssignee"))).toHaveValue("");
    expect(field(t("adminJourneys.settings.machineOpenSeconds"))).toHaveValue(2);
    expect(field(t("adminJourneys.settings.senderName"))).toHaveValue("Redakcja NES");
    expect(screen.getByText("12/120")).toBeInTheDocument();
    expect(field(t("adminJourneys.settings.replyTo"))).toHaveValue("redakcja@nes.example");
    expect(screen.getByText("20/254")).toBeInTheDocument();
    expect(field(t("adminJourneys.engineSettings.openTracking")).checked).toBe(false);
    expect(saveButton()).toBeDisabled();
    // Zasięg axe = treść okna: strażnicy ogniska Radiksa (`aria-hidden` +
    // `tabindex=0`) poza oknem to artefakt prymitywu (precedens:
    // `components/ui/__tests__/dialog.test.tsx`).
    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zapis wysyła tylko zmienione pola z tokenem updated_at", async () => {
    h.get.mockResolvedValue(SAVED);
    h.save.mockResolvedValue({ ok: true, data: { ...SAVED.data, marketingCapPer7d: 5 } });
    const { onOpenChange } = mount();
    await screen.findByLabelText(t("adminJourneys.settings.enabled"));
    fireEvent.change(field(t("adminJourneys.settings.marketingCap")), { target: { value: "5" } });
    fireEvent.change(field(t("adminJourneys.settings.quietEnd")), { target: { value: "07:30" } });
    fireEvent.change(field(t("adminJourneys.settings.defaultTaskAssignee")), {
      target: { value: "aaaaaaaa-0000-4000-8000-0000000000bb" },
    });
    fireEvent.click(field(t("adminJourneys.engineSettings.openTracking")));
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: {
          patch: {
            marketing_cap_per_7d: 5,
            quiet_end: "07:30",
            default_task_assignee_id: "aaaaaaaa-0000-4000-8000-0000000000bb",
            open_tracking_enabled: true,
          },
          expectedUpdatedAt: TOKEN,
        },
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(t("adminJourneys.engineSettings.saved")),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("włączenie silnika: potwierdzenie z podsumowaniem, token null dla nowego wiersza", async () => {
    h.get.mockResolvedValue(DEFAULTS);
    h.save.mockResolvedValue({ ok: true, data: { ...DEFAULTS.data, enabled: true, exists: true } });
    mount();
    await screen.findByText(t("adminJourneys.engineSettings.notStored"));
    fireEvent.click(field(t("adminJourneys.settings.enabled")));
    fireEvent.click(saveButton());
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(t("adminJourneys.engineSettings.confirmEnableTitle"));
    expect(confirm).toHaveTextContent("21:00-08:00 (Europe/Warsaw)");
    expect(confirm).toHaveTextContent(t("adminJourneys.engineSettings.senderFallback"));
    expect(h.save).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", {
        name: t("adminJourneys.engineSettings.confirmEnable"),
      }),
    );
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: { patch: { enabled: true }, expectedUpdatedAt: null },
      }),
    );
  });

  it("odrzucenie zamiast przycięcia: nazwa nadawcy, Reply-To, próg otwarć, cisza nocna", async () => {
    h.get.mockResolvedValue(SAVED);
    mount();
    await screen.findByLabelText(t("adminJourneys.settings.enabled"));
    const sender = field(t("adminJourneys.settings.senderName"));
    const long = "N".repeat(121);
    fireEvent.change(sender, { target: { value: long } });
    expect(sender.value).toHaveLength(121);
    expect(screen.getByText("121/120")).toBeInTheDocument();
    expect(
      screen.getByText(t("adminJourneys.engineSettings.senderNameInvalid")),
    ).toBeInTheDocument();
    expect(sender).toHaveAttribute("aria-invalid", "true");
    expect(saveButton()).toBeDisabled();
    fireEvent.change(sender, { target: { value: 'Anna "NES"' } });
    expect(saveButton()).toBeDisabled();
    fireEvent.change(sender, { target: { value: "Anna z NES" } });
    expect(saveButton()).toBeEnabled();
    fireEvent.change(field(t("adminJourneys.settings.replyTo")), {
      target: { value: "to nie adres" },
    });
    expect(screen.getByText(t("adminJourneys.engineSettings.replyToInvalid"))).toBeInTheDocument();
    fireEvent.change(field(t("adminJourneys.settings.replyTo")), { target: { value: "" } });
    fireEvent.change(field(t("adminJourneys.settings.machineOpenSeconds")), {
      target: { value: "31" },
    });
    expect(
      screen.getByText(t("adminJourneys.engineSettings.machineOpenInvalid")),
    ).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(field(t("adminJourneys.settings.machineOpenSeconds")), {
      target: { value: "5" },
    });
    fireEvent.change(field(t("adminJourneys.settings.quietStart")), { target: { value: "" } });
    expect(screen.getAllByText(t("adminJourneys.engineSettings.quietInvalid"))).toHaveLength(1);
    expect(saveButton()).toBeDisabled();
  });

  it("pusta nazwa nadawcy = null i ostrzeżenie o blokadzie marketingu", async () => {
    h.get.mockResolvedValue(SAVED);
    h.save.mockResolvedValue({ ok: true, data: { ...SAVED.data, senderName: null } });
    mount();
    await screen.findByLabelText(t("adminJourneys.settings.enabled"));
    fireEvent.change(field(t("adminJourneys.settings.senderName")), { target: { value: "   " } });
    expect(
      screen.getByText(t("adminJourneys.engineSettings.senderNameMissing")),
    ).toBeInTheDocument();
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(h.save).toHaveBeenCalledWith({
        data: { patch: { sender_name: null }, expectedUpdatedAt: TOKEN },
      }),
    );
  });

  it("konflikt: komunikat i świeży odczyt ustawień", async () => {
    h.get.mockResolvedValue(SAVED);
    h.save.mockResolvedValue({ ok: false, error: "conflict", reason: "conflict", detail: null });
    mount();
    await screen.findByLabelText(t("adminJourneys.settings.enabled"));
    fireEvent.change(field(t("adminJourneys.settings.marketingCap")), { target: { value: "4" } });
    const calls = h.get.mock.calls.length;
    fireEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("adminJourneys.engineSettings.conflict"),
    );
    await waitFor(() => expect(h.get.mock.calls.length).toBeGreaterThan(calls));
  });

  it("brak aal2 przy zapisie albo odczycie -> MfaRequiredNotice", async () => {
    h.get.mockResolvedValue(SAVED);
    h.save.mockRejectedValue(
      new Error("Forbidden: mfa_required - verify your second factor (aal2)"),
    );
    mount();
    await screen.findByLabelText(t("adminJourneys.settings.enabled"));
    fireEvent.change(field(t("adminJourneys.settings.marketingCap")), { target: { value: "4" } });
    fireEvent.click(saveButton());
    expect(await screen.findByTestId("revenue-mfa-required")).toBeInTheDocument();
    cleanup();
    h.get.mockRejectedValue(
      new Error("Forbidden: mfa_required - verify your second factor (aal2)"),
    );
    mount();
    expect(
      await screen.findByTestId("revenue-mfa-required", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe("JourneySettingsDialog - redaktor", () => {
  it("podgląd tylko do odczytu, bez zapisu", async () => {
    h.get.mockResolvedValue(SAVED);
    mount(false);
    await screen.findByText(t("adminJourneys.engineSettings.readOnly"));
    for (const label of [
      "adminJourneys.settings.enabled",
      "adminJourneys.settings.marketingCap",
      "adminJourneys.settings.quietStart",
      "adminJourneys.settings.senderName",
      "adminJourneys.engineSettings.openTracking",
    ]) {
      expect(field(t(label))).toBeDisabled();
    }
    expect(
      screen.queryByRole("button", { name: t("adminJourneys.engineSettings.save") }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: t("adminJourneys.common.close") }),
    ).toBeInTheDocument();
    const violations = await axeViolations(screen.getByRole("dialog"));
    expect(violations, summarize(violations)).toEqual([]);
  });
});
