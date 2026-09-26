// Ustawienia wystawcy faktur (wspolne dla najemcy). Pilnujemy: jawny zapis
// (pasek "Zapisz" tylko przy zmianach), pierwsze wlaczenie wymaga
// potwierdzenia "jestesmy sprzedawca", walidacja przy polu PRZED wyslaniem,
// ladunek po normalizacji i odmowa bazy jako toast.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseInvoiceSettings } from "@/lib/events/eventInvoicesApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";
import { invoiceSettingsJson } from "@/test/events/invoiceFixtures";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/select", async () =>
  (await import("@/test/reactStubs")).radixSelectStub(await import("react")),
);
vi.mock("@/components/ui/switch", async () =>
  (await import("@/test/reactStubs")).radixSwitchStub(await import("react")),
);

const api = vi.hoisted(() => ({ fetchInvoiceSettings: vi.fn(), saveInvoiceSettings: vi.fn() }));
vi.mock("@/lib/events/eventInvoicesApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/eventInvoicesApi")>()),
  ...api,
}));

const { toast } = await import("sonner");
const { EventInvoiceSettingsForm } =
  await import("@/components/admin/events/molecules/EventInvoiceSettingsForm");

const FRESH = parseInvoiceSettings(invoiceSettingsJson({ enabled: false, confirmed_at: null }));
const CONFIRMED = parseInvoiceSettings(invoiceSettingsJson());

beforeEach(() => {
  api.fetchInvoiceSettings.mockReset();
  api.saveInvoiceSettings.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});

describe("EventInvoiceSettingsForm", () => {
  it("wczytywanie i odmowa odczytu", async () => {
    api.fetchInvoiceSettings.mockReturnValue(new Promise(() => {}));
    const first = renderWithQueryClient(<EventInvoiceSettingsForm />);
    expect(screen.getByText("adminEventInvoices.loading")).toBeTruthy();
    first.unmount();
    api.fetchInvoiceSettings.mockRejectedValue(new Error("forbidden: admin role required"));
    renderWithQueryClient(<EventInvoiceSettingsForm />);
    expect(await screen.findByText(/.+/, { selector: "p.text-destructive" })).toBeTruthy();
  });

  it("pierwsze wlaczenie: bez potwierdzenia sprzedawcy nie ma zapisu", async () => {
    api.fetchInvoiceSettings.mockResolvedValue(FRESH);
    renderWithQueryClient(<EventInvoiceSettingsForm />);
    expect(await screen.findByText("adminEventInvoices.settings.sharedNotice")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "adminEventInvoices.settings.save" })).toBeNull();
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.settings.save" }));
    expect(screen.getByText("adminEventInvoices.settings.errors.confirm")).toBeTruthy();
    expect(api.saveInvoiceSettings).not.toHaveBeenCalled();
  });

  it("zapis po potwierdzeniu: ladunek znormalizowany, toast, pasek znika", async () => {
    api.fetchInvoiceSettings.mockResolvedValue(FRESH);
    api.saveInvoiceSettings.mockResolvedValue(CONFIRMED);
    renderWithQueryClient(<EventInvoiceSettingsForm />);
    await screen.findByText("adminEventInvoices.settings.sharedNotice");
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /^adminEventInvoices\.settings\.confirmSeller / }),
    );
    fireEvent.change(screen.getByLabelText("adminEventInvoices.settings.seriesInvoice"), {
      target: { value: " fa " },
    });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.settings.defaultLocale"), {
      target: { value: "en" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.settings.save" }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("adminEventInvoices.toasts.settingsSaved"),
    );
    expect(api.saveInvoiceSettings.mock.calls[0]?.[0]).toMatchObject({
      enabled: true,
      confirmSeller: true,
      seriesInvoice: "FA",
      defaultLocale: "en",
      sellerTaxId: "7011278375",
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "adminEventInvoices.settings.save" })).toBeNull(),
    );
    expect(
      screen.getByText("adminEventInvoices.settings.confirmedAt(date=2026-09-01)"),
    ).toBeTruthy();
  });

  it("walidacja przy polu: zw bez podstawy, zly NIP; odrzucenie zmian", async () => {
    api.fetchInvoiceSettings.mockResolvedValue(CONFIRMED);
    renderWithQueryClient(<EventInvoiceSettingsForm />);
    await screen.findByText("adminEventInvoices.settings.confirmedAt(date=2026-09-01)");
    expect(screen.queryByLabelText(/confirmSeller/)).toBeNull();
    fireEvent.change(screen.getByLabelText("adminEventInvoices.settings.defaultVatRate"), {
      target: { value: "zw" },
    });
    fireEvent.change(screen.getByLabelText("adminEventInvoices.settings.sellerTaxId"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.settings.save" }));
    expect(screen.getByText("adminEventInvoices.settings.errors.exemptBasis")).toBeTruthy();
    expect(screen.getByText("adminEventInvoices.settings.errors.taxId")).toBeTruthy();
    expect(api.saveInvoiceSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.settings.discard" }));
    expect(
      (screen.getByLabelText("adminEventInvoices.settings.sellerTaxId") as HTMLInputElement).value,
    ).toBe("7011278375");
    expect(screen.queryByText("adminEventInvoices.settings.errors.taxId")).toBeNull();
  });

  it("odmowa bazy przy zapisie = toast z mapy bledow", async () => {
    api.fetchInvoiceSettings.mockResolvedValue(CONFIRMED);
    api.saveInvoiceSettings.mockRejectedValue(new Error("series_not_distinct: x"));
    renderWithQueryClient(<EventInvoiceSettingsForm />);
    await screen.findByText("adminEventInvoices.settings.sharedNotice");
    fireEvent.change(screen.getByLabelText("adminEventInvoices.settings.footerNote"), {
      target: { value: "Stopka" },
    });
    fireEvent.click(screen.getByRole("button", { name: "adminEventInvoices.settings.save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).not.toBe(
      "adminEventInvoices.errors.seriesNotDistinct",
    );
  });

  it("dostepnosc: brak naruszen axe", async () => {
    api.fetchInvoiceSettings.mockResolvedValue(FRESH);
    const { container } = renderWithQueryClient(<EventInvoiceSettingsForm />);
    await screen.findByText("adminEventInvoices.settings.sharedNotice");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
