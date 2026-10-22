// Segment przychodu warstwy w panelu członkostwa (I9b, decyzja właściciela
// 2026-10-20) - chip tylko do odczytu z dymkiem PL/EN.
//
// CO TEN PLIK DOWODZI.
//   1. Chip pokazuje segment z TEJ SAMEJ mapy co księga MRR (`segments.ts`):
//      partnerzy i NGO jako instytucje, Członek jako klient indywidualny,
//      student jako ulga, czytelnik jako „pozostałe".
//   2. Dymek mówi, do czego służy segment (raporty MRR, churnu, ARPA w hubie)
//      i skąd się bierze (typ klienta) - po polsku i po angielsku; opis jest
//      w DOM i wskazany `aria-describedby` (czytnik nie musi najeżdżać ikony).
//   3. W kaflu katalogu (przycisk) chip nie dokłada drugiego przycisku.
//   4. Edytor warstwy pokazuje chip przy randze (zakładka Podstawy) - nie
//      w nagłówku, gdzie przycisk dymka przejmowałby fokus okna; brak naruszeń
//      axe.
//
// Tłumacz PRAWDZIWY, wstrzykiwany do atrapy po imporcie - fabryka `vi.mock`
// importująca `@/test/i18nReal` zakleszcza plik (`ReputationLevelChip.test`).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { membershipTier } from "@/test/admin/pricingFixtures";
import { RevenueSegmentChip } from "@/components/admin/membership/atoms/RevenueSegmentChip";
import { TierEditorCard } from "@/components/admin/membership/molecules/TierEditorCard";
import { TierSummaryCard } from "@/components/admin/membership/molecules/TierSummaryCard";
import { coreDraftFromTier } from "@/components/admin/membership/tierCoreDraft";
import "@/lib/i18n-admin-membership";

h.fixedT = realT;

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

describe("RevenueSegmentChip", () => {
  it.each([
    ["partner", "b2b_institution", "Instytucje"],
    ["ngo", "b2b_institution", "Instytucje"],
    ["team", "b2b_institution", "Instytucje"],
    ["member", "b2c_individual", "Klienci indywidualni"],
    ["student", "b2c_reduced", "Klienci z ulgą"],
    ["reader", "other", "Pozostałe"],
  ])("PL: %s -> %s", (tierKey, segment, label) => {
    const { container } = render(<RevenueSegmentChip tierKey={tierKey} />);

    const chip = container.querySelector("[data-revenue-segment]");
    expect(chip).toHaveAttribute("data-revenue-segment", segment);
    expect(chip).toHaveTextContent(`Segment przychodu: ${label}`);
  });

  it("PL: dymek - do czego służy segment i skąd się bierze, powiązany z chipem", () => {
    const { container } = render(<RevenueSegmentChip tierKey="partner" />);

    const button = screen.getByRole("button", { name: "Co znaczy segment przychodu?" });
    expect(button).toBeInTheDocument();
    const chip = container.querySelector("[data-revenue-segment]");
    const hintId = chip?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(hintId)).toHaveTextContent(
      "Segment przychodu - do raportów MRR, churnu i ARPA w hubie; wynika z typu klienta.",
    );
  });

  it("EN: etykieta, wartość i dymek po angielsku", () => {
    h.lang = "en";
    const { container } = render(<RevenueSegmentChip tierKey="ngo" />);

    expect(container.querySelector("[data-revenue-segment]")).toHaveTextContent(
      "Revenue segment: Institutions",
    );
    expect(
      screen.getByRole("button", { name: "What does the revenue segment mean?" }),
    ).toBeInTheDocument();
    expect(container).toHaveTextContent(
      "Revenue segment - for MRR, churn and ARPA reports in the hub; it follows from the customer type.",
    );
  });

  it("bez dymka (kafel-przycisk): żadnego zagnieżdżonego przycisku ani opisu", () => {
    const { container } = render(<RevenueSegmentChip tierKey="pro" hint={false} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[data-revenue-segment]")).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("brak naruszeń axe", async () => {
    const { container } = render(<RevenueSegmentChip tierKey="partner_general" />);

    expect(summarize(await axeViolations(container))).toBe("");
  });
});

describe("segment w kartach warstwy panelu członkostwa", () => {
  it("edytor warstwy: chip z dymkiem przy randze w zakładce Podstawy (NGO -> instytucje)", () => {
    const tier = membershipTier({ key: "ngo", rank: 40 });
    render(
      <TierEditorCard
        tier={tier}
        draft={coreDraftFromTier(tier)}
        saving={false}
        deleting={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText("Segment przychodu: Instytucje")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Co znaczy segment przychodu?" }),
    ).toBeInTheDocument();
  });

  it("kafel katalogu: chip bez dymka - kafel zostaje jednym przyciskiem", () => {
    const tier = membershipTier({ key: "partner", rank: 40 });
    render(
      <TierSummaryCard
        tier={tier}
        name="Partner Instytucjonalny"
        description=""
        benefitsCount={0}
        enabledCount={0}
        enforcedCount={0}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Segment przychodu: Instytucje")).toBeInTheDocument();
  });
});
