// Treści szybkich napraw (`fixes/*`, S7 SPEC §6.4) - formularze, które
// `QuickFixSpec.body` ładuje leniwie w szkielecie `QuickFixDialog`.
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. Wybór warstwy, planu i osoby czyta TE SAME wpisy cache co moduły
//      (Członkostwo, CRM) i oddaje ładunek przez `onChange` - bez własnych
//      zapytań (atrapy podmieniają wyłącznie `queryFn` fabryk modułów).
//   2. Nazwa warstwy pomocnikiem `tierName` modułu: pusta nazwa w języku
//      panelu = nazwa z drugiego języka, nigdy pusta etykieta.
//   3. Treść rysuje się tylko dla rozwiązania, które jej potrzebuje („przypisz",
//      „wskazana osoba", „własna liczba") - inaczej nic i ZERO żądań.
//   4. Wpis spoza zakresu i adres nadawcy platformy są ODRZUCANE komunikatem
//      (`aria-invalid`), nigdy przycinane; podgląd skutku licznika mówi
//      „nie da się policzyć" zamiast zer.
//   5. axe bez naruszeń.
//
// Radix Select nie otwiera listy w happy-dom - prymityw schodzi do natywnego
// `<select>` (wspólna atrapa `selectPrimitiveStub`), reguła opcji zostaje prawdziwa.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  tiers: vi.fn(),
  staff: vi.fn(),
  impact: vi.fn(),
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const { selectPrimitiveStub } = await import("@/test/postExperience/fixtures");
  return selectPrimitiveStub(React);
});
vi.mock("@/components/admin/membership/membershipQueries", async (importOriginal) => {
  const orig =
    await importOriginal<typeof import("@/components/admin/membership/membershipQueries")>();
  return {
    ...orig,
    adminMembershipTiersQueryOptions: () => ({
      ...orig.adminMembershipTiersQueryOptions(),
      queryFn: () => h.tiers(),
    }),
  };
});
vi.mock("@/lib/crm/leadMutations", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/crm/leadMutations")>();
  return {
    ...orig,
    crmStaffUsersQueryOptions: () => ({
      ...orig.crmStaffUsersQueryOptions(),
      queryFn: () => h.staff(),
    }),
  };
});
vi.mock("@/lib/access/meteringQueries", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/access/meteringQueries")>();
  return {
    ...orig,
    meteringImpactPreviewQueryOptions: (limit: number, enabled: boolean) => ({
      ...orig.meteringImpactPreviewQueryOptions(limit, enabled),
      queryFn: () => h.impact(limit),
    }),
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { axeViolations, summarize } from "@/test/axe";
import MeteringImpactBody from "@/components/admin/revenue/diagnostics/fixes/MeteringImpactBody";
import NumberBody from "@/components/admin/revenue/diagnostics/fixes/NumberBody";
import PlanSelectBody from "@/components/admin/revenue/diagnostics/fixes/PlanSelectBody";
import SenderBody from "@/components/admin/revenue/diagnostics/fixes/SenderBody";
import StaffPickerBody from "@/components/admin/revenue/diagnostics/fixes/StaffPickerBody";
import TierSelectBody from "@/components/admin/revenue/diagnostics/fixes/TierSelectBody";
import { METERING_DEFAULTS } from "@/lib/access/meteringDefaults";
import type {
  AccessRulePayload,
  AssignOwnerPayload,
  AssignTasksPayload,
  NumberPayload,
  PlanTierPayload,
  QuickFixBodyProps,
  QuickFixOption,
  SenderPayload,
} from "@/lib/admin/revenue/quickFixes";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import type { RevenueCheckId } from "@/lib/revenue/diagnostics/registry";
import { FACTS, clone, finding } from "./diagnosticsFixtures";

const PLAN_FOR_SALE = "b0000000-0000-4000-8000-000000000001";
const PLAN_HIDDEN = "b0000000-0000-4000-8000-000000000002";
const PLAN_INACTIVE = "b0000000-0000-4000-8000-000000000003";

const tierFact = (key: string, active: boolean) =>
  ({
    id: `tier-${key}`,
    key,
    rank: 1,
    active,
    pricingVisible: true,
    isDefault: false,
    ctaMode: "checkout",
    plansForSale: 1,
    plansNotForSale: 0,
    featureKeys: [],
    capabilityKeys: [],
  }) as const;

const planFact = (id: string, tierKey: string, active: boolean, forSale: boolean) =>
  ({
    id,
    tierKey,
    tierFound: true,
    tierRank: 1,
    active,
    forSale,
    interval: "month",
    currency: "PLN",
    priceCents: 4_900,
    catalogPair: true,
  }) as const;

const CATALOG_FACTS = {
  ...FACTS,
  areas: {
    ...FACTS.areas,
    catalog: {
      plans: [
        planFact(PLAN_FOR_SALE, "member", true, true),
        planFact(PLAN_HIDDEN, "member", true, false),
        planFact(PLAN_INACTIVE, "decision_lab", false, true),
      ],
      tiers: [tierFact("member", true), tierFact("decision_lab", true), tierFact("legacy", false)],
    },
  },
} as const satisfies RevenueFacts;

/** Wiersze `membership_tiers` w kształcie, który czyta `tierName`. */
const TIER_ROWS = [
  { key: "member", name_pl: "Członek", name_en: "Member" },
  { key: "decision_lab", name_pl: "Laboratorium decyzji", name_en: "" },
] as const;

const STAFF = [
  { id: "a0000000-0000-4000-8000-0000000000a1", label: "Anna Nowak" },
  { id: "a0000000-0000-4000-8000-0000000000a2", label: "Jan Kowalski" },
] as const;

function option<F>(id: string, payload: F): QuickFixOption<F> {
  return { id, labelKey: `adminRevenue.fix.test.option.${id}`, payload };
}

/**
 * Dialog w miniaturze: treść jest kontrolowana (wartość trzyma szkielet),
 * więc atrapa trzyma stan i raportuje każdą zmianę do `onChange`.
 */
function renderBody<F>(
  Body: ComponentType<QuickFixBodyProps<F>>,
  props: {
    initial: F;
    option: QuickFixOption<F>;
    facts?: RevenueFacts;
    checkId?: RevenueCheckId;
    disabled?: boolean;
  },
) {
  const onChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const facts = props.facts ?? (clone(CATALOG_FACTS) as RevenueFacts);
  const target = finding(props.checkId ? { checkId: props.checkId } : {});

  function Harness() {
    const [value, setValue] = useState<F>(props.initial);
    return (
      <Body
        facts={facts}
        finding={target}
        option={props.option}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        disabled={props.disabled ?? false}
      />
    );
  }

  const view = render(
    <QueryClientProvider client={queryClient}>
      <main>
        <Harness />
      </main>
    </QueryClientProvider>,
  );
  return { ...view, onChange };
}

function optionTexts(select: HTMLElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.tiers.mockReset().mockResolvedValue(clone(TIER_ROWS));
  h.staff.mockReset().mockResolvedValue(clone(STAFF));
  h.impact.mockReset().mockResolvedValue({
    total_members: 120,
    members_blocked: 7,
    members_warning: 11,
    members_safe: 102,
    total_anon: 900,
    anon_blocked: 0,
    avg_used: 2,
    max_used: 9,
  });
});

afterEach(() => cleanup());

describe("TierSelectBody - warstwa dla planu bez warstwy", () => {
  it("aktywne warstwy z nazwami modułu; wybór oddaje klucz w ładunku", async () => {
    const initial: PlanTierPayload = { planIds: [PLAN_FOR_SALE], tierKey: null };
    const { onChange } = renderBody(TierSelectBody, {
      initial,
      option: option("assign", initial),
    });

    const select = screen.getByLabelText("Warstwa");
    await waitFor(() => expect(optionTexts(select)).toContain("Członek (member)"));
    // Warstwa wycofana nie jest celem naprawy.
    expect(optionTexts(select)).not.toContain("legacy");
    expect(h.tiers).toHaveBeenCalledTimes(1);

    fireEvent.change(select, { target: { value: "member" } });
    expect(onChange).toHaveBeenLastCalledWith({ planIds: [PLAN_FOR_SALE], tierKey: "member" });
  });

  it("pusta nazwa w języku panelu: nazwa z drugiego języka (EN), bez nazw - sam klucz", async () => {
    await i18n.changeLanguage("en");
    const initial: PlanTierPayload = { planIds: [PLAN_FOR_SALE], tierKey: null };
    renderBody(TierSelectBody, { initial, option: option("assign", initial) });

    const select = screen.getByLabelText("Tier");
    await waitFor(() =>
      expect(optionTexts(select)).toEqual([
        "Member (member)",
        "Laboratorium decyzji (decision_lab)",
      ]),
    );
  });

  it("zanim przyjdą nazwy - klucze warstw (lista nigdy nie jest pusta)", () => {
    h.tiers.mockReturnValue(new Promise(() => {}));
    const initial: PlanTierPayload = { planIds: [PLAN_FOR_SALE], tierKey: null };
    renderBody(TierSelectBody, { initial, option: option("assign", initial) });
    expect(optionTexts(screen.getByLabelText("Warstwa"))).toEqual(["member", "decision_lab"]);
  });
});

describe("PlanSelectBody - plan dla reguły dostępu", () => {
  const assign: AccessRulePayload = {
    mode: "assign",
    refs: ["post:c0000000-0000-4000-8000-000000000001"],
    deadPlanIds: [PLAN_INACTIVE],
    planId: null,
  };

  it("tylko plany aktywne i w sprzedaży; wybór oddaje plan", () => {
    const { onChange } = renderBody(PlanSelectBody, {
      initial: assign,
      option: option("assign", assign),
    });
    const select = screen.getByLabelText("Plan w sprzedaży");
    expect(optionTexts(select)).toEqual(["member · month · PLN"]);

    fireEvent.change(select, { target: { value: PLAN_FOR_SALE } });
    expect(onChange).toHaveBeenLastCalledWith({ ...assign, planId: PLAN_FOR_SALE });
  });

  it("brak planu w sprzedaży: zdanie, co zrobić najpierw", () => {
    const facts = clone({
      ...CATALOG_FACTS,
      areas: { ...CATALOG_FACTS.areas, catalog: { plans: [], tiers: [] } },
    }) as RevenueFacts;
    renderBody(PlanSelectBody, { initial: assign, option: option("assign", assign), facts });
    expect(
      screen.getByText("Brak planów w sprzedaży - najpierw włącz plan w paywallu."),
    ).toBeInTheDocument();
  });

  it("tryb „usuń wycofane” nie potrzebuje wyboru - treść nic nie rysuje", () => {
    const remove: AccessRulePayload = { ...assign, mode: "remove_dead" };
    const { container } = renderBody(PlanSelectBody, {
      initial: remove,
      option: option("remove_dead", remove),
    });
    expect(container.querySelector("main")?.childElementCount).toBe(0);
  });
});

describe("StaffPickerBody - osoba z zespołu (CRM)", () => {
  it("właściciel leadów: lista zespołu z wpisu cache CRM, wybór oddaje osobę", async () => {
    const initial: AssignOwnerPayload = { leadIds: ["lead-1", "lead-2"], ownerId: null };
    const { onChange } = renderBody(StaffPickerBody, {
      initial,
      option: option("owner", initial),
    });

    expect(screen.getByText("Wczytujemy zespół…")).toBeInTheDocument();
    const select = await screen.findByLabelText("Osoba z zespołu");
    expect(optionTexts(select)).toEqual(["Anna Nowak", "Jan Kowalski"]);

    fireEvent.change(select, { target: { value: STAFF[1].id } });
    expect(onChange).toHaveBeenLastCalledWith({ ...initial, ownerId: STAFF[1].id });
  });

  it("zadania bez osoby bez „wskazanej osoby”: nic nie rysuje i nie pyta serwera", () => {
    const initial: AssignTasksPayload = { useFallback: false, fallbackAssigneeId: null };
    const { container } = renderBody(StaffPickerBody, {
      initial,
      option: option("rules", initial),
    });
    expect(container.querySelector("main")?.childElementCount).toBe(0);
    expect(h.staff).not.toHaveBeenCalled();
  });

  it("zadania z „wskazaną osobą”: wybór trafia do osoby zastępczej", async () => {
    const initial: AssignTasksPayload = { useFallback: true, fallbackAssigneeId: null };
    const { onChange } = renderBody(StaffPickerBody, {
      initial,
      option: option("fallback", initial),
    });
    const select = await screen.findByLabelText("Osoba z zespołu");
    fireEvent.change(select, { target: { value: STAFF[0].id } });
    expect(onChange).toHaveBeenLastCalledWith({
      useFallback: true,
      fallbackAssigneeId: STAFF[0].id,
    });
  });

  it("pusty zespół mówi to słowem", async () => {
    h.staff.mockResolvedValue([]);
    const initial: AssignOwnerPayload = { leadIds: ["lead-1"], ownerId: null };
    renderBody(StaffPickerBody, { initial, option: option("owner", initial) });
    expect(
      await screen.findByText("Brak osób z rolą administratora albo redaktora."),
    ).toBeInTheDocument();
  });
});

describe("SenderBody - własny nadawca newslettera", () => {
  const initial: SenderPayload = { email: "", name: "" };

  it("adres nadawcy platformy i zły kształt są odrzucane komunikatem", () => {
    renderBody(SenderBody, { initial, option: option("own", initial) });
    const email = screen.getByLabelText("Adres nadawcy");
    expect(email).not.toHaveAttribute("aria-invalid");

    fireEvent.change(email, { target: { value: "onboarding@resend.dev" } });
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Podaj poprawny adres - inny niż nadawca platformy."),
    ).toBeInTheDocument();

    fireEvent.change(email, { target: { value: "redakcja@" } });
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("poprawny adres i nazwa trafiają do ładunku dokładnie tak, jak wpisane", () => {
    const { onChange } = renderBody(SenderBody, { initial, option: option("own", initial) });
    fireEvent.change(screen.getByLabelText("Adres nadawcy"), {
      target: { value: "redakcja@nes.example" },
    });
    fireEvent.change(screen.getByLabelText("Nazwa nadawcy (opcjonalnie)"), {
      target: { value: " Redakcja NES " },
    });
    expect(screen.getByLabelText("Adres nadawcy")).not.toHaveAttribute("aria-invalid");
    expect(onChange).toHaveBeenLastCalledWith({
      email: "redakcja@nes.example",
      name: " Redakcja NES ",
    });
  });
});

describe("NumberBody - okno porzucenia kasy (minuty)", () => {
  const initial: NumberPayload = { value: null };

  it("wpis spoza 30-1440 jest odrzucany (ładunek pusty), poprawny przechodzi", () => {
    const { onChange } = renderBody(NumberBody, {
      initial,
      option: option("custom", initial),
      checkId: "checkout.abandon_window_default",
    });
    const field = screen.getByLabelText("Minuty");
    expect(screen.getByText("Od 30 do 1440 minut.")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "29" } });
    expect(field).toHaveAttribute("aria-invalid", "true");
    // Pole pokazuje DOKŁADNIE wpis - nie przycinamy go do granicy.
    expect(field).toHaveValue("29");
    expect(onChange).toHaveBeenLastCalledWith({ value: null });

    fireEvent.change(field, { target: { value: "45" } });
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(onChange).toHaveBeenLastCalledWith({ value: 45 });
  });

  it("rozwiązanie bez własnej liczby nic nie rysuje", () => {
    const { container } = renderBody(NumberBody, {
      initial: { value: 60 },
      option: option("default", { value: 60 }),
      checkId: "checkout.abandon_window_default",
    });
    expect(container.querySelector("main")?.childElementCount).toBe(0);
  });
});

describe("MeteringImpactBody - skutek domyślnego limitu", () => {
  it("ten sam podgląd co karta licznika: limit z `METERING_DEFAULTS`, liczby słowem", async () => {
    renderBody(MeteringImpactBody, { initial: {}, option: option("defaults", {}) });
    expect(screen.getByText("Liczymy skutek…")).toBeInTheDocument();
    expect(
      await screen.findByText("Zalogowani: 7 zablokowanych, 11 blisko limitu z 120"),
    ).toBeInTheDocument();
    expect(screen.getByText("Goście: 0 zablokowanych z 900")).toBeInTheDocument();
    expect(h.impact).toHaveBeenCalledWith(METERING_DEFAULTS.member_monthly_limit);
  });

  it("brak podglądu: „nie da się policzyć”, nigdy zera", async () => {
    h.impact.mockResolvedValue(null);
    renderBody(MeteringImpactBody, { initial: {}, option: option("defaults", {}) });
    expect(
      await screen.findByText("Podglądu skutku nie da się teraz policzyć."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/zablokowanych/)).not.toBeInTheDocument();
  });
});

describe("treści napraw - dostępność", () => {
  it("axe bez naruszeń: warstwa, osoba, nadawca i liczba", async () => {
    const tier: PlanTierPayload = { planIds: [PLAN_FOR_SALE], tierKey: null };
    const tierView = renderBody(TierSelectBody, { initial: tier, option: option("assign", tier) });
    await waitFor(() =>
      expect(optionTexts(screen.getByLabelText("Warstwa"))).toContain("Członek (member)"),
    );
    let violations = await axeViolations(tierView.container);
    expect(violations, summarize(violations)).toEqual([]);
    cleanup();

    const owner: AssignOwnerPayload = { leadIds: ["lead-1"], ownerId: null };
    const staffView = renderBody(StaffPickerBody, {
      initial: owner,
      option: option("owner", owner),
    });
    await screen.findByLabelText("Osoba z zespołu");
    violations = await axeViolations(staffView.container);
    expect(violations, summarize(violations)).toEqual([]);
    cleanup();

    const sender: SenderPayload = { email: "", name: "" };
    const senderView = renderBody(SenderBody, { initial: sender, option: option("own", sender) });
    fireEvent.change(screen.getByLabelText("Adres nadawcy"), { target: { value: "x@" } });
    violations = await axeViolations(senderView.container);
    expect(violations, summarize(violations)).toEqual([]);
    cleanup();

    const number: NumberPayload = { value: null };
    const numberView = renderBody(NumberBody, {
      initial: number,
      option: option("custom", number),
      checkId: "checkout.abandon_window_default",
    });
    fireEvent.change(screen.getByLabelText("Minuty"), { target: { value: "5" } });
    violations = await axeViolations(numberView.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
