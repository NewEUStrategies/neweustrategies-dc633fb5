// `PlanBenefitMatrix` - macierz plan × benefit z konfliktami P20 (S7; karta:
// „konflikty P20, tabela a11y, Accordion < 768 px; editor disabled + Tooltip").
//
// CO TEN PLIK DOWODZI.
//   1. Konflikty P20: obietnica bez uprawnienia („broken") i uprawnienie bez
//      bramki („decorative") - liczone RAZ na parę (warstwa, uprawnienie),
//      choć warstwa ma dwa plany.
//   2. Tabela: `caption`, nagłówki kolumn i wierszy ze `scope`, stan komórki
//      tekstem (nie samym kolorem/ikoną), region przewijany z fokusem.
//   3. Poniżej 768 px `Accordion` (jeden plan na pozycję) - oba układy są
//      w znaczniku, przełącza je CSS (`md:`).
//   4. Redaktor: „Edytuj plan" wyłączony z powodem w podpowiedzi
//      (`DisabledReason` + `Tooltip`), dialog się nie otwiera; administrator
//      otwiera `AccessPlanEditorDialog` modułu z identyfikatorem planu.
//   5. Nagłówek źródła prawdy (warstwa członkostwa) i axe bez naruszeń.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchOffer: vi.fn(),
  fetchTiers: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/finance/finance.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/finance/finance.functions")>()),
  getRevenueOfferMatrix: (...args: unknown[]) => h.fetchOffer(...args),
}));
vi.mock("@/components/admin/membership/membershipQueries", async () => {
  const { billingKeys } = await import("@/lib/billing/keys");
  return {
    adminMembershipTiersQueryOptions: () => ({
      queryKey: billingKeys.admin.membershipTiers(),
      queryFn: () => h.fetchTiers(),
    }),
  };
});
// Dialog modułu ma własne testy; tu - czy macierz go otwiera i z czym.
vi.mock("@/components/admin/paywall/AccessPlanEditorDialog", () => ({
  AccessPlanEditorDialog: (props: { planId: string | null; open: boolean }) => {
    h.dialog(props);
    return props.open ? <div data-testid="plan-editor" data-plan={props.planId} /> : null;
  },
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import { PlanBenefitMatrix } from "@/components/admin/revenue/offer/PlanBenefitMatrix";
import { OFFER_MATRIX, TENANT, clone } from "../../overview/__tests__/hubFixtures";
import { TIER_ROWS } from "./offerFixtures";
import { renderWithClient } from "./offerTestKit";

beforeEach(async () => {
  h.fetchOffer.mockReset().mockResolvedValue({ state: "ready", data: clone(OFFER_MATRIX) });
  h.fetchTiers.mockReset().mockResolvedValue(clone(TIER_ROWS));
  h.dialog.mockReset();
  await i18n.changeLanguage("pl");
});

afterEach(() => cleanup());

async function renderMatrix(roles: string[] = ["admin"]) {
  const view = renderWithClient(<PlanBenefitMatrix tenantId={TENANT} roles={roles} />);
  await screen.findByTestId("matrix-conflicts");
  return view;
}

describe("PlanBenefitMatrix - konflikty P20", () => {
  it("2 konflikty: obietnica bez uprawnienia i uprawnienie bez bramki (raz na warstwę)", async () => {
    await renderMatrix();
    const summary = screen.getByTestId("matrix-conflicts");
    expect(summary).toHaveAttribute("data-conflicts", "2");
    expect(summary).toHaveTextContent("2 konflikty obietnic (P20)");
    expect(screen.getByRole("link", { name: "Popraw benefity w Cenniku" })).toHaveAttribute(
      "href",
      "/admin/pricing",
    );
  });

  it("komórki: stan tekstem w każdej kolumnie planu", async () => {
    await renderMatrix();
    const table = within(screen.getByTestId("matrix-table")).getByRole("table");
    const rows = within(table).getAllByRole("row");
    const byCapability = new Map(
      rows
        .slice(1)
        .map((row) => [
          row.getAttribute("data-capability"),
          [...row.querySelectorAll("td")].map((td) => td.getAttribute("data-cell")),
        ]),
    );
    // Kolumny: Plus miesięczny, Plus roczny, Pro (EUR) - po randze warstwy.
    expect(byCapability.get("premium_content")).toEqual(["ok", "ok", "ok"]);
    expect(byCapability.get("pro_briefings")).toEqual(["broken", "broken", "ok"]);
    expect(byCapability.get("recordings")).toEqual(["none", "none", "silent"]);
    expect(byCapability.get("member_library")).toEqual(["decorative", "decorative", "none"]);
    const broken = rows.find((row) => row.getAttribute("data-capability") === "pro_briefings");
    expect(broken).toHaveTextContent("Obiecane, a warstwa tego nie włącza");
  });
});

describe("PlanBenefitMatrix - dostępność i układ", () => {
  it("tabela: caption, scope kolumn i wierszy, region z fokusem; od 768 px", async () => {
    await renderMatrix();
    const region = screen.getByTestId("matrix-table");
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("hidden");
    expect(region.className).toContain("md:block");
    const table = within(region).getByRole("table", {
      name: "Benefity obiecane w cenniku i uprawnienia warstwy dla każdego aktywnego planu",
    });
    for (const th of within(table).getAllByRole("columnheader")) {
      expect(th).toHaveAttribute("scope", "col");
    }
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((th) => th.textContent),
    ).toEqual([
      "Analizy premium za paywallem",
      "Wstęp na briefingi Pro",
      "Nagrania z wydarzeń",
      "Biblioteka członkowska",
    ]);
  });

  it("poniżej 768 px: Accordion - jeden plan na pozycję, ten sam stan komórek", async () => {
    await renderMatrix();
    const accordion = screen.getByTestId("matrix-accordion");
    expect(accordion.className).toContain("md:hidden");
    const triggers = within(accordion).getAllByRole("button", { expanded: false });
    expect(triggers).toHaveLength(3);
    fireEvent.click(triggers[0] as HTMLElement);
    const region = await within(accordion).findByRole("region");
    expect(region).toHaveTextContent("Wstęp na briefingi Pro");
    expect(region).toHaveTextContent("Obiecane, a warstwa tego nie włącza");
  });

  it("nagłówek źródła prawdy: warstwa członkostwa", async () => {
    await renderMatrix();
    expect(
      screen.getByRole("region", { name: /Warstwa członkostwa/ }).getAttribute("data-entity"),
    ).toBe("membership_tier");
  });

  it("nie ma naruszeń dostępności", async () => {
    const { container } = await renderMatrix();
    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("PlanBenefitMatrix - role", () => {
  it("administrator: „Edytuj plan” otwiera dialog modułu z planem", async () => {
    await renderMatrix(["admin"]);
    const table = within(screen.getByTestId("matrix-table")).getByRole("table");
    fireEvent.click(
      within(table).getAllByRole("button", { name: /^Edytuj plan: Plus/ })[0] as HTMLElement,
    );
    expect(await screen.findByTestId("plan-editor")).toHaveAttribute(
      "data-plan",
      "plan-plus-month",
    );
  });

  it("redaktor: przyciski wyłączone, powód w podpowiedzi, dialog zamknięty", async () => {
    await renderMatrix(["editor"]);
    const table = within(screen.getByTestId("matrix-table")).getByRole("table");
    const buttons = within(table).getAllByRole("button", { name: /^Edytuj plan:/ });
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toBeDisabled();
      const trigger = button.parentElement as HTMLElement;
      expect(trigger).toHaveAttribute("tabindex", "0");
      expect(trigger).toHaveAccessibleDescription(
        "Redaktor widzi tę sekcję w trybie podglądu - zmiany zapisuje wyłącznie administrator.",
      );
    }
    fireEvent.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(screen.queryByTestId("plan-editor")).toBeNull());
    expect(h.dialog.mock.calls.every(([props]) => !(props as { open: boolean }).open)).toBe(true);
  });

  it("odmowa odczytu oferty = stan karty", async () => {
    h.fetchOffer.mockResolvedValue({ state: "forbidden" });
    renderWithClient(<PlanBenefitMatrix tenantId={TENANT} roles={["editor"]} />);
    expect(
      await screen.findByText("Kwoty przychodu widzą wyłącznie administratorzy."),
    ).toBeVisible();
  });
});
