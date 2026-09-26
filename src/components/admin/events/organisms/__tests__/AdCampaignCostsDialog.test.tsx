// Organizm `AdCampaignCostsDialog` - koszty dzienne kampanii.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ZLA WKLEJKA IDZIE DO BAZY - blad z numerem wiersza ma sie pokazac ZANIM
//      cokolwiek wyjdzie, a baza dostaje wsad calosc-albo-nic.
//   2. WSAD Z WKLEJKI OZNACZONY JAKO "RECZNY" (albo odwrotnie) - zrodlo kosztu
//      w bazie klamie.
//   3. ODMOWA BAZY BEZ TRESCI - toast z numerem wiersza wsadu.
//   4. USUNIECIE DNIA TRAFIA W INNA KAMPANIE.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { DIALOG_CLOSE_LABEL } from "@/test/events/adsFunnelStubs";
import { freezeClock } from "@/test/time";
import { formatMoney } from "@/lib/billing/types";
import type { AdCampaign } from "@/lib/events/adsFunnelApi";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => h.rpc!.rpc(name, args) },
}));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-ads-funnel", () => ({ ensureAdsFunnelI18n: () => undefined }));
vi.mock("@/lib/events/adminAdsFunnelErrors", () => ({
  adminAdsFunnelErrorMessage: (error: unknown) => `blad:${(error as Error).message}`,
}));
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/adsFunnelStubs")).dialogModuleStub(),
);

const { AdCampaignCostsDialog } =
  await import("@/components/admin/events/organisms/AdCampaignCostsDialog");

freezeClock();

const K = "adminEventAdsFunnel.costs.";
const EVENT = "3f1a0c8e-0000-4000-8000-000000000042";
const CAMPAIGN: AdCampaign = {
  id: "c1",
  matchKind: "utm_campaign",
  matchValue: "wiosna",
  label: "Wiosna Search",
  conversionActionName: null,
  costs: [],
};

let closed = 0;

function renderDialog(campaign: AdCampaign | null = CAMPAIGN) {
  return renderWithQueryClient(
    <AdCampaignCostsDialog
      eventId={EVENT}
      campaign={campaign}
      defaultCurrency="PLN"
      lang="pl"
      onClose={() => {
        closed += 1;
      }}
    />,
  );
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  closed = 0;
  h.rpc = supabaseRpcStub();
  h.rpc.setData("admin_event_ad_costs_list", [
    {
      day: "2099-06-14",
      cost_micros: 50_000_000,
      currency: "PLN",
      clicks: null,
      impressions: 1000,
      source: "csv",
      updated_at: "x",
    },
  ]);
  h.rpc.setData("admin_event_ad_costs_save", 1);
  h.rpc.setData("admin_event_ad_cost_delete", true);
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

afterEach(cleanup);

describe("AdCampaignCostsDialog", () => {
  it("zamkniete okno (brak kampanii) nie rysuje niczego i nie pyta bazy", () => {
    const { container } = renderDialog(null);
    expect(container.innerHTML).toBe("");
    expect(h.rpc!.names()).toEqual([]);
  });

  it("lista kosztow kampanii: kwota, kreska za brak klikniec, zrodlo", async () => {
    renderDialog();
    expect(
      screen.getByRole("heading", { name: `${K}title(name=Wiosna Search)` }),
    ).toBeInTheDocument();
    await screen.findByText("2099-06-14");
    expect(h.rpc!.lastCall("admin_event_ad_costs_list")?.arg("p_campaign_id")).toBe("c1");
    const row = screen.getByText("2099-06-14").closest("tr") as HTMLElement;
    expect(Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual([
      "2099-06-14",
      formatMoney(5000, "PLN", "pl"),
      "—",
      "1000",
      "adminEventAdsFunnel.costSources.csv",
      "",
    ]);
  });

  it("pusta lista i odmowa odczytu", async () => {
    h.rpc!.setData("admin_event_ad_costs_list", [
      {
        day: "2099-06-13",
        cost_micros: 1,
        currency: "EUR",
        clicks: 5,
        impressions: null,
        source: "manual",
        updated_at: "x",
      },
    ]);
    renderDialog();
    await screen.findByText("adminEventAdsFunnel.costSources.manual");
    cleanup();
    h.rpc!.setData("admin_event_ad_costs_list", []);
    renderDialog();
    await screen.findByText(`${K}empty`);
    cleanup();
    h.rpc!.setError("admin_event_ad_costs_list", "not_found: x");
    renderDialog();
    await screen.findByText("blad:not_found: x");
  });

  it("dzien recznie: blad formularza bez strzalu do bazy, potem zapis 'manual'", async () => {
    renderDialog();
    type(`${K}day`, "2099-02-30");
    type(`${K}amount`, "10");
    fireEvent.click(screen.getByRole("button", { name: `${K}addDay` }));
    expect(screen.getByText(`${K}rowErrors.dayInvalid`)).toBeInTheDocument();
    expect(h.rpc!.callsFor("admin_event_ad_costs_save")).toHaveLength(0);

    type(`${K}day`, "2099-06-15");
    type(`${K}amount`, "12,50");
    type(`${K}currency`, "eur");
    fireEvent.click(screen.getByRole("button", { name: `${K}addDay` }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
    expect(h.rpc!.lastCall("admin_event_ad_costs_save")?.arg("p_payload")).toEqual({
      campaign_id: "c1",
      source: "manual",
      rows: [{ day: "2099-06-15", cost_micros: 12_500_000, currency: "EUR" }],
    });
    expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAdsFunnel.toasts.costsSaved(count=1)");
    expect(screen.getByLabelText(`${K}day`)).toHaveValue("");
    expect(screen.getByLabelText(`${K}amount`)).toHaveValue("");
    expect(screen.queryByText(`${K}rowErrors.dayInvalid`)).toBeNull();
  });

  it("wklejka: bledy z numerem wiersza, potem wsad 'csv'; odmowa bazy toastem", async () => {
    renderDialog();
    const importButton = screen.getByRole("button", { name: `${K}pasteImport` });
    expect(importButton).toBeDisabled();

    type(`${K}pasteLabel`, "2099-06-10;x;PLN");
    fireEvent.click(importButton);
    expect(screen.getByRole("alert").textContent).toContain(
      `${K}lineError(line=1,message=${K}rowErrors.amountInvalid)`,
    );
    expect(h.rpc!.callsFor("admin_event_ad_costs_save")).toHaveLength(0);

    h.rpc!.setData("admin_event_ad_costs_save", 2);
    type(`${K}pasteLabel`, "Dzien;Koszt\n2099-06-10;1;PLN\n2099-06-11;2,5");
    fireEvent.click(importButton);
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAdsFunnel.toasts.costsSaved(count=2)"),
    );
    expect(h.rpc!.lastCall("admin_event_ad_costs_save")?.arg("p_payload")).toMatchObject({
      source: "csv",
      rows: [
        { day: "2099-06-10", cost_micros: 1_000_000, currency: "PLN" },
        { day: "2099-06-11", cost_micros: 2_500_000, currency: "PLN" },
      ],
    });
    expect(screen.getByLabelText(`${K}pasteLabel`)).toHaveValue("");
    expect(screen.queryByRole("alert")).toBeNull();

    h.rpc!.setError("admin_event_ad_costs_save", "invalid_cost_row: row 1 is invalid");
    type(`${K}pasteLabel`, "2099-06-12;1;PLN");
    fireEvent.click(importButton);
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("blad:invalid_cost_row: row 1 is invalid"),
    );
    expect(screen.getByLabelText(`${K}pasteLabel`)).toHaveValue("2099-06-12;1;PLN");
  });

  it("usuniecie dnia TEJ kampanii; odmowa usuniecia toastem", async () => {
    renderDialog();
    await screen.findByText("2099-06-14");
    fireEvent.click(screen.getByRole("button", { name: `${K}deleteDay(day=2099-06-14)` }));
    await waitFor(() =>
      expect(h.toastSuccess).toHaveBeenCalledWith("adminEventAdsFunnel.toasts.costDeleted"),
    );
    expect(h.rpc!.lastCall("admin_event_ad_cost_delete")?.args).toEqual({
      p_campaign_id: "c1",
      p_day: "2099-06-14",
    });

    h.rpc!.setError("admin_event_ad_cost_delete", "not_found: x");
    fireEvent.click(await screen.findByRole("button", { name: `${K}deleteDay(day=2099-06-14)` }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("blad:not_found: x"));
  });

  it("zamkniecie przyciskiem i z zewnatrz (Esc/tlo); nowa kampania czysci formularz", () => {
    const { rerender, queryClient } = renderDialog();
    type(`${K}amount`, "99");
    fireEvent.click(screen.getByRole("button", { name: `${K}close` }));
    fireEvent.click(screen.getByRole("button", { name: DIALOG_CLOSE_LABEL }));
    expect(closed).toBe(2);

    rerender(
      <QueryClientProvider client={queryClient}>
        <AdCampaignCostsDialog
          eventId={EVENT}
          campaign={{ ...CAMPAIGN, id: "c2", label: "Inna" }}
          defaultCurrency="EUR"
          lang="pl"
          onClose={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText(`${K}amount`)).toHaveValue("");
    expect(screen.getByLabelText(`${K}currency`)).toHaveValue("EUR");
  });
});
