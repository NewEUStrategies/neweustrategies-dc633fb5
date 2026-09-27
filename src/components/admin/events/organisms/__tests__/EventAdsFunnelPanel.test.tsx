// Organizm `EventAdsFunnelPanel` - ekran "Lejek Google Ads".
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. OKRES LICZONY W RENDERZE - zegar poza `useNowMs` rozjezdza klucz zapytania
//      co render (petla zapytan) albo pyta baze z oknem "teraz" przed hydratacja.
//   2. LEJEK MIESZA POPULACJE - paski licza zgloszenia BEZ atrybucji w kroku
//      po wizytach ze zgoda (zawyzona konwersja).
//   3. USUNIECIE KAMPANII BEZ POTWIERDZENIA albo z potwierdzeniem, ktore nie
//      zatrzymuje zapisu po "Anuluj".
//   4. EKSPORT KONWERSJI BEZ NAZWY KONWERSJI / Z NAZWA Z PRZECINKIEM - plik
//      odrzucony przez Google Ads albo wiersze znikaja bez slowa.
//   5. EKSPORT LEJKA BEZ BOM (Excel psuje polskie znaki) albo import Ads Z BOM.
//   6. KAFEL ROAS LICZY PRZYCHOD KAMPANII BEZ KOSZTU (600/100 + 200/brak = 8,00x
//      zamiast 6,00x) albo przy braku kosztu pokazuje lacznik zamiast kreski
//      uzywanej w tabeli.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { adminEventDetailRow } from "@/test/events/adminEventStudioRows";
import { axeViolations, summarize } from "@/test/axe";
import { freezeClock, FIXED_NOW_MS } from "@/test/time";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  nowMs: null as number | null,
  confirm: true,
  confirmCalls: [] as unknown[],
  downloads: [] as { fileName: string; mimeType: string; data: string }[],
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
vi.mock("@/lib/time/useNowMs", () => ({ useNowMs: () => h.nowMs }));
vi.mock("@/lib/appDialogs", () => ({
  confirmDialog: async (opts: unknown) => {
    h.confirmCalls.push(opts);
    return h.confirm;
  },
}));
vi.mock("@/lib/events/leadExport", () => ({
  downloadLeadExport: (file: { fileName: string; mimeType: string; data: string }) =>
    h.downloads.push(file),
}));
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/adsFunnelStubs")).dialogModuleStub(),
);
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/adsFunnelStubs")).formSelectModuleStub(),
);

const { EventAdsFunnelPanel } =
  await import("@/components/admin/events/organisms/EventAdsFunnelPanel");

freezeClock();

const F = "adminEventAdsFunnel.";
const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

function report(overrides: Record<string, unknown> = {}) {
  return {
    window: { timezone: "Europe/Warsaw" },
    groups: [
      {
        key: "campaign:c1",
        kind: "campaign",
        campaign_id: "c1",
        label: "Wiosna Search",
        visits: 10,
        registration_starts: 4,
        checkout_starts: 2,
        registrations: 3,
        paid: 2,
        revenue: [{ currency: "PLN", cents: 60000 }],
        cost: [{ currency: "PLN", micros: 100_000_000 }],
        channels: [],
      },
      {
        key: "campaign:c2",
        kind: "campaign",
        campaign_id: "c2",
        label: "PMax",
        visits: 5,
        registrations: 1,
        paid: 1,
        revenue: [{ currency: "PLN", cents: 20000 }],
        cost: [{ currency: "PLN", micros: 100_000_000 }],
        channels: [],
      },
      { key: "none", kind: "none", visits: 7, registrations: 1, channels: [] },
    ],
    unattributed: { registrations: 4, paid: 2, revenue: [{ currency: "PLN", cents: 30000 }] },
    totals: {
      visits: 22,
      registration_starts: 6,
      checkout_starts: 3,
      attributed_registrations: 5,
      registrations: 9,
      paid: 5,
      revenue: [{ currency: "PLN", cents: 110000 }],
      cost: [{ currency: "PLN", micros: 200_000_000 }],
    },
    ...overrides,
  };
}

const CAMPAIGN_ROW = {
  id: "c1",
  match_kind: "utm_campaign",
  match_value: "wiosna",
  label: "Wiosna Search",
  conversion_action_name: "Bilet Kongres",
  costs: [],
  created_at: "x",
  updated_at: "x",
};

function conversions(rows: Record<string, unknown>[]) {
  return {
    timezone: "Europe/Warsaw",
    rows,
    skipped: { unattributed: 1, no_click: 2, expired: 0, before_click: 0 },
  };
}

const CONVERSION = {
  order_id: "o1",
  registration_id: "r1",
  click_id_type: "gclid",
  click_id: "Cj0KCQjw-abc_DEF123",
  conversion_action_name: null,
  conversion_time: "x",
  conversion_time_local: "2099-06-15 14:05:00",
  value_cents: 49900,
  currency: "PLN",
  ad_user_data: true,
  ad_personalization: true,
};

/** Raport wczytany = lejek narysowany (liczby stoja w kilku miejscach naraz). */
async function reportLoaded(): Promise<void> {
  await screen.findByRole("list", { name: `${F}funnel.ariaLabel` });
}

function renderPanel() {
  return renderWithQueryClient(
    <EventAdsFunnelPanel
      row={adminEventDetailRow({ id: EVENT_ID, slug: "kongres-2099", ticket_currency: "PLN" })}
    />,
  );
}

beforeEach(() => {
  h.nowMs = FIXED_NOW_MS;
  h.confirm = true;
  h.confirmCalls = [];
  h.downloads = [];
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.rpc = supabaseRpcStub();
  h.rpc.setData("admin_event_ads_funnel", report());
  h.rpc.setData("admin_event_ad_campaigns_list", [CAMPAIGN_ROW]);
  h.rpc.setData("admin_event_ad_campaign_save", "c9");
  h.rpc.setData("admin_event_ad_campaign_delete", true);
  h.rpc.setData("admin_event_ad_costs_list", []);
  h.rpc.setData("admin_event_ads_conversions_export", conversions([CONVERSION]));
});

afterEach(cleanup);

describe("okres i podsumowanie", () => {
  it("do pierwszego tyku zegara ekran wczytuje i NIE pyta o raport", () => {
    h.nowMs = null;
    renderPanel();
    expect(screen.getByText(`${F}loading`)).toBeInTheDocument();
    expect(h.rpc!.callsFor("admin_event_ads_funnel")).toHaveLength(0);
  });

  it("domyslnie 28 dni z dniem biezacym; kafle z liczbami raportu i ROAS zmapowanych kampanii", async () => {
    const { container } = renderPanel();
    await reportLoaded();
    expect(h.rpc!.lastCall("admin_event_ads_funnel")?.args).toEqual({
      p_event_id: EVENT_ID,
      p_from: "2099-05-19T00:00:00.000Z",
    });
    // ROAS zmapowanych: (600 + 200) zl / (100 + 100) zl = 4.
    expect(screen.getByText("4.00×")).toBeInTheDocument();
    expect(screen.getByText(`${F}summary.roasHint`)).toBeInTheDocument();
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("lejek pokazuje zgloszenia i oplacone Z ATRYBUCJA (bez zgloszen bez atrybucji)", async () => {
    renderPanel();
    const list = await screen.findByRole("list", { name: `${F}funnel.ariaLabel` });
    const values = Array.from(list.querySelectorAll("li")).map((item) => item.textContent ?? "");
    expect(values[0]?.startsWith(`${F}steps.visit22`)).toBe(true);
    expect(values[2]?.startsWith(`${F}steps.registration5`)).toBe(true);
    // 5 oplaconych razem minus 2 bez atrybucji = 3.
    expect(values[4]?.startsWith(`${F}steps.paid3`)).toBe(true);
  });

  it("zmiana okresu: 'calosc' bez granic, 7 dni z poczatkiem okna", async () => {
    renderPanel();
    await reportLoaded();
    fireEvent.click(screen.getByRole("radio", { name: `${F}window.presets.all` }));
    await waitFor(() =>
      expect(h.rpc!.lastCall("admin_event_ads_funnel")?.args).toEqual({ p_event_id: EVENT_ID }),
    );
    fireEvent.click(screen.getByRole("radio", { name: `${F}window.presets.7d` }));
    await waitFor(() =>
      expect(h.rpc!.lastCall("admin_event_ads_funnel")?.arg("p_from")).toBe(
        "2099-06-09T00:00:00.000Z",
      ),
    );
  });

  it("odmowa raportu - zdanie z mapy bledow, bez lejka i tabeli", async () => {
    h.rpc!.setError("admin_event_ads_funnel", "forbidden: admin role required");
    renderPanel();
    await screen.findByText("blad:forbidden: admin role required");
    expect(screen.queryByRole("list", { name: `${F}funnel.ariaLabel` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${F}export.funnelCsv` })).toBeNull();
  });

  it("raport z roznymi walutami kosztu - ROAS kreska, nie suma zlotych z euro", async () => {
    h.rpc!.setData(
      "admin_event_ads_funnel",
      report({
        groups: [
          {
            key: "campaign:c1",
            kind: "campaign",
            label: "A",
            revenue: [],
            cost: [{ currency: "PLN", micros: 1 }],
            channels: [],
          },
          {
            key: "campaign:c2",
            kind: "campaign",
            label: "B",
            revenue: [],
            cost: [{ currency: "EUR", micros: 1 }],
            channels: [],
          },
        ],
      }),
    );
    renderPanel();
    await reportLoaded();
    // Kafel ROAS (suma zmapowanych) - kreska; w tabeli kazda kampania ma wlasny ROAS.
    const tile = screen.getByText(`${F}summary.roas`).closest("div.space-y-1") as HTMLElement;
    expect(tile.textContent).not.toContain("×");
    expect(tile.textContent).toContain("—");
  });

  it("ROAS kafla pomija kampanie bez kosztu: 600/100 i 200/brak = 6.00×, nie 8.00×", async () => {
    const [withCost, withoutCost, none] = report().groups;
    h.rpc!.setData(
      "admin_event_ads_funnel",
      report({ groups: [withCost, { ...withoutCost, cost: [] }, none] }),
    );
    renderPanel();
    await reportLoaded();
    const tile = screen.getByText(`${F}summary.roas`).closest("div.space-y-1") as HTMLElement;
    expect(tile.textContent).toContain("6.00×");
  });

  it("bez zadnego kosztu kafle kosztu i ROAS maja kreske z tabeli (—)", async () => {
    const [withCost, withoutCost, none] = report().groups;
    h.rpc!.setData(
      "admin_event_ads_funnel",
      report({
        groups: [{ ...withCost, cost: [] }, { ...withoutCost, cost: [] }, none],
        totals: { ...report().totals, cost: [] },
      }),
    );
    renderPanel();
    await reportLoaded();
    const roas = screen.getByText(`${F}summary.roas`).closest("div.space-y-1") as HTMLElement;
    const cost = screen.getByText(`${F}summary.cost`).closest("div.space-y-1") as HTMLElement;
    expect(roas.textContent).toContain("—");
    expect(roas.textContent).not.toContain("×");
    expect(cost.textContent).toContain("—");
  });
});

describe("mapowanie kampanii", () => {
  it("lista i dodanie kampanii: okno, zapis, toast, zamkniecie", async () => {
    renderPanel();
    await screen.findByText("wiosna");
    fireEvent.click(screen.getByRole("button", { name: `${F}campaigns.add` }));
    expect(
      screen.getByRole("heading", { name: `${F}campaignDialog.createTitle` }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(`${F}campaignDialog.matchValue`), {
      target: { value: "lato" },
    });
    fireEvent.change(screen.getByLabelText(`${F}campaignDialog.label`), {
      target: { value: "Lato" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${F}campaignDialog.save` }));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${F}toasts.campaignSaved`));
    expect(h.rpc!.lastCall("admin_event_ad_campaign_save")?.arg("p_payload")).toMatchObject({
      event_id: EVENT_ID,
      match_value: "lato",
    });
    expect(screen.queryByRole("heading", { name: `${F}campaignDialog.createTitle` })).toBeNull();
  });

  it("edycja: okno z kampania; odmowa zapisu zostawia okno i pokazuje toast", async () => {
    h.rpc!.setError("admin_event_ad_campaign_save", "campaign_exists: x");
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: `${F}campaigns.edit: Wiosna Search` }),
    );
    expect(
      screen.getByRole("heading", { name: `${F}campaignDialog.editTitle` }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${F}campaignDialog.save` }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("blad:campaign_exists: x"));
    expect(
      screen.getByRole("heading", { name: `${F}campaignDialog.editTitle` }),
    ).toBeInTheDocument();
  });

  it("usuniecie po potwierdzeniu; 'Anuluj' niczego nie usuwa; odmowa toastem", async () => {
    renderPanel();
    const del = await screen.findByRole("button", { name: `${F}campaigns.delete: Wiosna Search` });
    h.confirm = false;
    fireEvent.click(del);
    await waitFor(() => expect(h.confirmCalls).toHaveLength(1));
    expect(h.confirmCalls[0]).toMatchObject({
      destructive: true,
      title: `${F}campaigns.deleteTitle`,
    });
    expect(h.rpc!.callsFor("admin_event_ad_campaign_delete")).toHaveLength(0);

    h.confirm = true;
    fireEvent.click(del);
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith(`${F}toasts.campaignDeleted`));
    expect(h.rpc!.lastCall("admin_event_ad_campaign_delete")?.arg("p_id")).toBe("c1");

    h.rpc!.setError("admin_event_ad_campaign_delete", "not_found: x");
    fireEvent.click(
      await screen.findByRole("button", { name: `${F}campaigns.delete: Wiosna Search` }),
    );
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("blad:not_found: x"));
  });

  it("koszty kampanii otwieraja okno kosztow i zamykaja je", async () => {
    renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: `${F}campaigns.costs: Wiosna Search` }),
    );
    expect(
      screen.getByRole("heading", { name: `${F}costs.title(name=Wiosna Search)` }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `${F}costs.close` }));
    expect(
      screen.queryByRole("heading", { name: `${F}costs.title(name=Wiosna Search)` }),
    ).toBeNull();
  });

  it("brak kampanii i odmowa listy", async () => {
    h.rpc!.setData("admin_event_ad_campaigns_list", []);
    renderPanel();
    await screen.findByText(`${F}campaigns.empty`);
    cleanup();
    h.rpc!.setError("admin_event_ad_campaigns_list", "forbidden: x");
    renderPanel();
    await screen.findByText("blad:forbidden: x");
  });
});

describe("eksporty", () => {
  it("tabela lejka: CSV z BOM i nazwa z dniem", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: `${F}export.funnelCsv` }));
    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0]?.fileName).toBe("ads-funnel-kongres-2099-2099-06-15.csv");
    expect(h.downloads[0]?.mimeType).toBe("text/csv;charset=utf-8");
    expect(h.downloads[0]?.data.charCodeAt(0)).toBe(0xfeff);
    expect(h.downloads[0]?.data).toContain("Wiosna Search");
  });

  it("konwersje offline: bez nazwy - wiersz pominiety i nota; z nazwa domyslna - plik bez BOM", async () => {
    renderPanel();
    await reportLoaded();
    const button = screen.getByRole("button", { name: `${F}export.adsCsv` });
    fireEvent.click(button);
    await screen.findByText(`${F}export.noRows`);
    expect(screen.getByText(`${F}export.missingName(count=1)`)).toBeInTheDocument();
    expect(
      screen.getByText(
        `${F}export.skipped(awaitingAdmission=0,beforeClick=0,consentWithdrawn=0,expired=0,noClick=2,unattributed=1)`,
      ),
    ).toBeInTheDocument();
    expect(h.downloads).toHaveLength(0);
    expect(h.rpc!.lastCall("admin_event_ads_conversions_export")?.args).toEqual({
      p_event_id: EVENT_ID,
      p_from: "2099-05-19T00:00:00.000Z",
    });

    fireEvent.change(screen.getByLabelText(`${F}export.defaultConversion`), {
      target: { value: "Bilet, VIP" },
    });
    expect(screen.getByText(`${F}validation.conversionNameInvalid`)).toBeInTheDocument();
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText(`${F}export.defaultConversion`), {
      target: { value: "Zakup biletu" },
    });
    fireEvent.click(button);
    await screen.findByText(`${F}export.exported(count=1)`);
    expect(h.downloads).toHaveLength(1);
    expect(h.downloads[0]?.fileName).toBe("google-ads-conversions-kongres-2099-2099-06-15.csv");
    expect(h.downloads[0]?.data.startsWith("Parameters:TimeZone=Europe/Warsaw\n")).toBe(true);
  });

  it("wiersz z niedozwolonym znakiem - nota o odrzuceniu; odmowa eksportu toastem", async () => {
    h.rpc!.setData(
      "admin_event_ads_conversions_export",
      conversions([CONVERSION, { ...CONVERSION, conversion_action_name: "Bilet", currency: "zl" }]),
    );
    renderPanel();
    await reportLoaded();
    fireEvent.change(screen.getByLabelText(`${F}export.defaultConversion`), {
      target: { value: "Zakup" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${F}export.adsCsv` }));
    await screen.findByText(`${F}export.rejected(count=1)`);
    expect(h.downloads).toHaveLength(1);

    h.rpc!.setError("admin_event_ads_conversions_export", "invalid_window: x");
    fireEvent.click(screen.getByRole("button", { name: `${F}export.adsCsv` }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("blad:invalid_window: x"));
  });
});
