// Molekula `AdCampaignDialog` - zapis kampanii reklamowej.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. ZAPIS Z BLEDEM - ladunek z nazwa konwersji z przecinkiem albo z
//      nieliczbowym id kampanii Google Ads wychodzi do bazy.
//   2. BLAD KRZYCZY OD PIERWSZEJ LITERY - walidacja ma sie pokazac dopiero po
//      probie zapisu.
//   3. EDYCJA ZAKLADA NOWA KAMPANIE - ladunek edycji ma niesc `id`, nie
//      wydarzenie; nowa - odwrotnie.
//   4. PONOWNE OTWARCIE POKAZUJE STARY SZKIC poprzedniej kampanii.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { axeViolations, summarize } from "@/test/axe";
import { DIALOG_CLOSE_LABEL } from "@/test/events/adsFunnelStubs";
import type { AdCampaign, AdCampaignInput } from "@/lib/events/adsFunnelApi";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-admin-event-ads-funnel", () => ({ ensureAdsFunnelI18n: () => undefined }));
vi.mock("@/components/ui/dialog", async () =>
  (await import("@/test/events/adsFunnelStubs")).dialogModuleStub(),
);
vi.mock("@/components/atoms/FormSelect", async () =>
  (await import("@/test/events/adsFunnelStubs")).formSelectModuleStub(),
);

const { AdCampaignDialog } = await import("@/components/admin/events/molecules/AdCampaignDialog");

const D = "adminEventAdsFunnel.campaignDialog.";
const V = "adminEventAdsFunnel.validation.";
const EVENT = "3f1a0c8e-0000-4000-8000-000000000042";

const CAMPAIGN: AdCampaign = {
  id: "c1",
  matchKind: "google_ads_campaign_id",
  matchValue: "987654321",
  label: "PMax",
  conversionActionName: "Zakup biletu",
  costs: [],
};

const h = {
  submitted: [] as AdCampaignInput[],
  openChanges: [] as boolean[],
};

beforeEach(() => {
  h.submitted = [];
  h.openChanges = [];
});

afterEach(cleanup);

function renderDialog(
  props: { open?: boolean; campaign?: AdCampaign | null; saving?: boolean } = {},
) {
  const element = (
    <AdCampaignDialog
      open={props.open ?? true}
      onOpenChange={(open) => h.openChanges.push(open)}
      campaign={props.campaign ?? null}
      eventId={EVENT}
      saving={props.saving ?? false}
      onSubmit={(input) => h.submitted.push(input)}
    />
  );
  return render(element);
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AdCampaignDialog - nowa kampania", () => {
  it("pusty szkic: walidacja dopiero po probie zapisu, bez ladunku", async () => {
    const { container } = renderDialog();
    expect(screen.getByRole("heading", { name: `${D}createTitle` })).toBeInTheDocument();
    expect(screen.queryByText(`${V}matchValueRequired`)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `${D}save` }));
    expect(screen.getByText(`${V}matchValueRequired`)).toBeInTheDocument();
    expect(screen.getByText(`${V}labelRequired`)).toBeInTheDocument();
    expect(h.submitted).toEqual([]);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("poprawny szkic: ladunek nowej kampanii niesie wydarzenie", () => {
    renderDialog();
    type(`${D}matchValue`, " Wiosna ");
    type(`${D}label`, "Wiosna Search");
    type(`${D}conversionName`, "Bilet Kongres");
    fireEvent.click(screen.getByRole("button", { name: `${D}save` }));
    expect(h.submitted).toEqual([
      {
        eventId: EVENT,
        matchKind: "utm_campaign",
        matchValue: "Wiosna",
        label: "Wiosna Search",
        conversionActionName: "Bilet Kongres",
      },
    ]);
  });

  it("zmiana rodzaju dopasowania: podpowiedz i walidacja cyfr", () => {
    renderDialog();
    expect(screen.getByText(`${D}matchValueHintUtm`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(`${D}matchKind`), {
      target: { value: "google_ads_campaign_id" },
    });
    expect(screen.getByText(`${D}matchValueHintGad`)).toBeInTheDocument();
    type(`${D}matchValue`, "12a");
    type(`${D}label`, "PMax");
    type(`${D}conversionName`, "Bilet, VIP");
    fireEvent.click(screen.getByRole("button", { name: `${D}save` }));
    expect(screen.getByText(`${V}matchValueDigits`)).toBeInTheDocument();
    expect(screen.getByText(`${V}conversionNameInvalid`)).toBeInTheDocument();
    expect(h.submitted).toEqual([]);
  });
});

describe("AdCampaignDialog - edycja", () => {
  it("szkic z kampanii, ladunek z id, anulowanie zamyka okno", () => {
    renderDialog({ campaign: CAMPAIGN });
    expect(screen.getByRole("heading", { name: `${D}editTitle` })).toBeInTheDocument();
    expect(screen.getByLabelText(`${D}matchValue`)).toHaveValue("987654321");
    type(`${D}conversionName`, "");
    fireEvent.click(screen.getByRole("button", { name: `${D}save` }));
    expect(h.submitted).toEqual([
      {
        id: "c1",
        matchKind: "google_ads_campaign_id",
        matchValue: "987654321",
        label: "PMax",
        conversionActionName: null,
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: `${D}cancel` }));
    fireEvent.click(screen.getByRole("button", { name: DIALOG_CLOSE_LABEL }));
    expect(h.openChanges).toEqual([false, false]);
  });

  it("w trakcie zapisu przyciski sa wylaczone, a napis mowi 'zapisywanie'", () => {
    renderDialog({ campaign: CAMPAIGN, saving: true });
    expect(screen.getByRole("button", { name: `${D}saving` })).toBeDisabled();
    expect(screen.getByRole("button", { name: `${D}cancel` })).toBeDisabled();
  });

  it("ponowne otwarcie resetuje szkic i stan walidacji", () => {
    const { rerender } = renderDialog({ campaign: CAMPAIGN });
    type(`${D}label`, "");
    fireEvent.click(screen.getByRole("button", { name: `${D}save` }));
    expect(screen.getByText(`${V}labelRequired`)).toBeInTheDocument();

    const again = (open: boolean, campaign: AdCampaign | null) => (
      <AdCampaignDialog
        open={open}
        onOpenChange={() => undefined}
        campaign={campaign}
        eventId={EVENT}
        saving={false}
        onSubmit={() => undefined}
      />
    );
    rerender(again(false, CAMPAIGN));
    rerender(again(true, null));
    expect(screen.getByLabelText(`${D}label`)).toHaveValue("");
    expect(screen.queryByText(`${V}labelRequired`)).toBeNull();
  });
});
