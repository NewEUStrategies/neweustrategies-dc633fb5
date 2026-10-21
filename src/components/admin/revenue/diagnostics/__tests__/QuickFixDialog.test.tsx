// `QuickFixDialog` (S7, SPEC §6.4) - szkielet szybkiej naprawy.
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. Podgląd „Przed → Po" w tabeli z `caption`/`scope` i nagłówek źródła
//      (ta sama zmiana pojawi się w module); axe bez naruszeń.
//   2. Pętla naprawa → ponowne sprawdzenie: zapis aplikatorem modułu, potem
//      `refetchQueries(revenueKeys.facts(t))` i ocena TEJ reguły na świeżych
//      faktach - komunikat `aria-live` zgodny ze stanem („✓ problem zniknął"
//      albo „! zapisano, ale problem nadal występuje: <dowody>").
//   3. „Cofnij" przez 60 s dla zmiany odwracalnej - potem znika.
//   4. Konflikt (`40001`, 0 wierszy): porównanie „Twoja zmiana / stan teraz"
//      na świeżych faktach, „Zastosuj" wstrzymane do „Wczytaj aktualne".
//   5. Brak roli zapisu modułu: „Zastosuj" wyłączone z powodem (Tooltip).
//   6. Treść naprawy (`fixes/*`) ładuje się leniwie; wpis spoza zakresu jest
//      odrzucany komunikatem, a „Zastosuj" czeka na poprawną wartość.
//
// Aplikator jest atrapą (`quickFixFor` z prawdziwą specyfikacją i podmienionym
// `useApplier`): mutatory modułów testuje `quickFixes.test.ts`, tu liczy się
// przepływ dialogu.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchFacts: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
}));
vi.mock("@/lib/admin/revenue/quickFixes", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/admin/revenue/quickFixes")>();
  return {
    ...orig,
    quickFixFor: (id: Parameters<typeof orig.quickFixFor>[0]) => {
      const spec = orig.quickFixFor(id);
      return { ...spec, apply: { ...spec.apply, useApplier: () => ({ apply: h.apply }) } };
    },
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import {
  QuickFixDialog,
  UNDO_WINDOW_MS,
} from "@/components/admin/revenue/diagnostics/QuickFixDialog";
import type { RevenueFacts } from "@/lib/revenue/diagnostics/facts";
import {
  evaluateFindings,
  revenueFactsQueryOptions,
} from "@/lib/revenue/diagnostics/queries";
import type { RevenueCheckId, RevenueFinding } from "@/lib/revenue/diagnostics/registry";
import { revenueKeys } from "@/lib/revenue/keys";
import {
  ENQUIRY_PLAN_ID,
  FACTS,
  FACTS_FIXED,
  TENANT,
  factsRead,
  finding as buildFinding,
} from "./diagnosticsFixtures";

const t = realT("pl");

function findingOf(checkId: RevenueCheckId, facts: RevenueFacts = FACTS): RevenueFinding {
  const found = evaluateFindings(facts, [], Date.parse("2026-10-15T12:00:00Z")).find(
    (f) => f.checkId === checkId,
  );
  if (!found) throw new Error(`brak diagnozy ${checkId}`);
  return found;
}

/**
 * Tablica w miniaturze: obserwator wpisu faktów (jak `DiagnosticsBoard`)
 * i dialog na tych faktach - `refetchQueries` ma kogo odświeżyć.
 */
function Harness({
  finding,
  roles,
  onOpenChange = () => {},
}: {
  finding: RevenueFinding;
  roles: readonly string[];
  onOpenChange?: (open: boolean) => void;
}) {
  const facts = useQuery(revenueFactsQueryOptions(TENANT));
  if (facts.data?.state !== "ready") return null;
  return (
    <QuickFixDialog
      finding={finding}
      facts={facts.data.facts}
      tenantId={TENANT}
      roles={roles}
      open
      onOpenChange={onOpenChange}
    />
  );
}

function renderDialog(finding: RevenueFinding, roles: readonly string[] = ["admin"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const refetch = vi.spyOn(queryClient, "refetchQueries");
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness finding={finding} roles={roles} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient, refetch };
}

async function openDialog() {
  return screen.findByTestId("quick-fix-dialog");
}

function status() {
  return screen.getByTestId("quick-fix-status");
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.fetchFacts.mockReset().mockResolvedValue(factsRead(FACTS));
  h.apply.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("QuickFixDialog - podgląd zmiany", () => {
  it("rozwiązanie, tabela „Przed → Po” z caption/scope i nagłówek źródła; axe bez naruszeń", async () => {
    renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    const dialog = await openDialog();

    expect(
      within(dialog).getByRole("heading", {
        name: t("adminRevenue.fix.dialogTitle", {
          title: t("adminRevenue.checks.catalog.enquiry_plan_buyable.title"),
        }),
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(t("adminRevenue.fix.plan_not_for_sale.description")),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", {
        name: t("adminRevenue.fix.plan_not_for_sale.option.withdraw", { count: 1 }),
      }),
    ).toBeChecked();

    const table = within(dialog).getByRole("table", { name: t("adminRevenue.fix.previewCaption") });
    const row = within(table).getByRole("row", { name: /Plan w sprzedaży/ });
    expect(within(row).getByRole("rowheader")).toHaveTextContent(
      t("adminRevenue.fix.field.for_sale"),
    );
    const cells = within(row).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual([
      t("adminRevenue.fix.value.on"),
      t("adminRevenue.fix.value.off"),
    ]);
    expect(within(dialog).getByText(t("adminRevenue.fix.sourceNote"))).toBeInTheDocument();

    const violations = await axeViolations(dialog);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("diagnoza bez dialogu naprawy mówi, gdzie jej szukać", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <QuickFixDialog
          finding={findingOf("sync.emit_errors")}
          facts={FACTS}
          tenantId={TENANT}
          roles={["admin"]}
          open
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(t("adminRevenue.diagnostics.fixNoDialog"))).toBeInTheDocument();
  });
});

describe("QuickFixDialog - pętla naprawa → ponowne sprawdzenie", () => {
  it("zapis mutatorem modułu, odświeżenie faktów i „✓ problem zniknął”", async () => {
    const revert = vi.fn().mockResolvedValue(undefined);
    h.apply.mockResolvedValue({ revert });
    const { refetch } = renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));

    await waitFor(() => expect(status()).toHaveAttribute("data-outcome", "resolved"));
    expect(status()).toHaveAttribute("aria-live", "polite");
    expect(status()).toHaveTextContent(t("adminRevenue.fix.resolved"));
    expect(h.apply).toHaveBeenCalledWith({ planIds: [ENQUIRY_PLAN_ID] });
    expect(refetch).toHaveBeenCalledWith({ queryKey: revenueKeys.facts(TENANT), exact: true });
    // Jedno pobranie startowe + jedno odświeżenie (bez zapasowego `fetchQuery`).
    expect(h.fetchFacts).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: t("adminRevenue.fix.apply") })).toBe(null);
    expect(
      screen.getByRole("button", { name: t("adminRevenue.fix.undo", { seconds: 60 }) }),
    ).toBeInTheDocument();
  });

  it("problem nadal jest: „! zapisano, ale…” z dowodami ze świeżych faktów", async () => {
    h.apply.mockResolvedValue({});
    renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));

    await waitFor(() => expect(status()).toHaveAttribute("data-outcome", "open"));
    expect(status()).toHaveTextContent(
      t("adminRevenue.fix.stillOpen", {
        evidence: t("adminRevenue.evidence.enquiryPlanBuyable", { count: 1, active: 1 }),
      }),
    );
    // Zmiana bez odwrócenia - bez „Cofnij".
    expect(screen.queryByRole("button", { name: /Cofnij/ })).toBe(null);
  });

  it("bez obserwatora wpisu faktów pobiera je raz wprost (ocena nie na starych faktach)", async () => {
    h.apply.mockResolvedValue({});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <QuickFixDialog
          finding={findingOf("catalog.enquiry_plan_buyable")}
          facts={FACTS}
          tenantId={TENANT}
          roles={["editor"]}
          open
          onOpenChange={() => {}}
        />
      </QueryClientProvider>,
    );
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));
    fireEvent.click(await screen.findByRole("button", { name: t("adminRevenue.fix.apply") }));
    await waitFor(() => expect(status()).toHaveAttribute("data-outcome", "resolved"));
    expect(h.fetchFacts).toHaveBeenCalledTimes(1);
  });

  it("nieudany zapis: komunikat i możliwość ponowienia", async () => {
    h.apply.mockRejectedValue(new Error("network"));
    renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));
    await waitFor(() => expect(status()).toHaveAttribute("data-phase", "failed"));
    expect(status()).toHaveTextContent(t("adminRevenue.fix.failed"));
    expect(screen.getByRole("button", { name: t("adminRevenue.fix.apply") })).toBeEnabled();
  });
});

describe("QuickFixDialog - „Cofnij” przez 60 sekund", () => {
  it("cofnięcie woła odwrócenie i sprawdza regułę ponownie", async () => {
    const revert = vi.fn().mockResolvedValue(undefined);
    h.apply.mockResolvedValue({ revert });
    renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));
    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));
    const undo = await screen.findByRole("button", { name: /Cofnij/ });

    h.fetchFacts.mockResolvedValue(factsRead(FACTS));
    fireEvent.click(undo);

    await waitFor(() => expect(status()).toHaveAttribute("data-phase", "undone"));
    expect(revert).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent(t("adminRevenue.fix.undone"));
    expect(screen.queryByRole("button", { name: /Cofnij/ })).toBe(null);
  });

  it("po minucie przycisk znika, a zmiana zostaje", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.apply.mockResolvedValue({ revert: vi.fn() });
    renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));
    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));
    await screen.findByRole("button", { name: /Cofnij/ });

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 2_000);
    });
    expect(screen.getByRole("button", { name: /Cofnij/ })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.queryByRole("button", { name: /Cofnij/ })).toBe(null);
    expect(status()).toHaveAttribute("data-outcome", "resolved");
  });
});

describe("QuickFixDialog - konflikt zapisu (40001)", () => {
  it("„Twoja zmiana / stan teraz” na świeżych faktach; „Zastosuj” czeka na „Wczytaj aktualne”", async () => {
    h.apply.mockRejectedValue({ code: "40001", message: "stale" });
    const { refetch } = renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));

    const conflict = await screen.findByTestId("quick-fix-conflict");
    expect(conflict).toHaveAttribute("role", "alert");
    expect(within(conflict).getByText(t("adminRevenue.fix.conflictBody"))).toBeInTheDocument();
    const table = within(conflict).getByRole("table", {
      name: t("adminRevenue.fix.conflictCaption"),
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual([
      t("adminRevenue.fix.field.heading"),
      t("adminRevenue.fix.conflictYours"),
      t("adminRevenue.fix.conflictNow"),
    ]);
    expect(refetch).toHaveBeenCalledWith({ queryKey: revenueKeys.facts(TENANT), exact: true });
    expect(screen.getByRole("button", { name: t("adminRevenue.fix.apply") })).toBeDisabled();

    fireEvent.click(within(conflict).getByRole("button", { name: t("adminRevenue.fix.conflictReload") }));
    expect(screen.queryByTestId("quick-fix-conflict")).toBe(null);
    expect(screen.getByRole("button", { name: t("adminRevenue.fix.apply") })).toBeEnabled();
  });

  it("problem naprawiony w innej karcie: komunikat i tylko „Zamknij”", async () => {
    h.apply.mockRejectedValue({ code: "40001", message: "stale" });
    renderDialog(findingOf("catalog.enquiry_plan_buyable"));
    await openDialog();
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.apply") }));

    const conflict = await screen.findByTestId("quick-fix-conflict");
    expect(within(conflict).getByText(t("adminRevenue.fix.conflictGone"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("adminRevenue.fix.apply") })).toBe(null);
    expect(screen.getByRole("button", { name: t("adminRevenue.fix.close") })).toBeInTheDocument();
  });
});

describe("QuickFixDialog - rola zapisu modułu", () => {
  it("redaktor przy naprawie administratora: „Zastosuj” wyłączone z powodem", async () => {
    const tierFinding = buildFinding({
      checkId: "catalog.not_for_sale_still_visible",
      severity: "info",
      state: "warn",
      refs: ["plus"],
      evidence: [],
      fix: { kind: "dialog", dialog: "tier_hide" },
    });
    renderDialog(tierFinding, ["editor"]);
    const dialog = await openDialog();
    const apply = within(dialog).getByRole("button", { name: t("adminRevenue.fix.apply") });
    expect(apply).toBeDisabled();
    expect(apply.closest("[aria-describedby]")).toHaveAccessibleDescription(
      t("adminRevenue.fix.roleAdmin"),
    );
    fireEvent.click(apply);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("bez roli huba (autor) zapis jest niedostępny także dla naprawy redaktora", async () => {
    renderDialog(findingOf("catalog.enquiry_plan_buyable"), ["author"]);
    const dialog = await openDialog();
    expect(within(dialog).getByRole("button", { name: t("adminRevenue.fix.apply") })).toBeDisabled();
  });
});

describe("QuickFixDialog - treść naprawy (`fixes/*`, React.lazy)", () => {
  it("liczba spoza zakresu jest odrzucana komunikatem; poprawna włącza „Zastosuj”", async () => {
    h.apply.mockResolvedValue({});
    renderDialog(findingOf("checkout.abandon_window_default"));
    const dialog = await openDialog();
    const apply = within(dialog).getByRole("button", { name: t("adminRevenue.fix.apply") });
    expect(apply).toBeDisabled();
    expect(apply.closest("[aria-describedby]")).toHaveAccessibleDescription(
      t("adminRevenue.fix.incomplete"),
    );

    const input = await within(dialog).findByLabelText(t("adminRevenue.fix.body.minutes"));
    fireEvent.change(input, { target: { value: "5000" } });
    expect(within(dialog).getByText(t("adminRevenue.fix.body.numberInvalid"))).toBeInTheDocument();
    // Wpis zostaje DOKŁADNIE taki, jak wpisany - bez przycięcia do maksimum.
    expect(input).toHaveValue("5000");
    expect(within(dialog).getByRole("button", { name: t("adminRevenue.fix.apply") })).toBeDisabled();

    fireEvent.change(input, { target: { value: "60" } });
    const enabled = within(dialog).getByRole("button", { name: t("adminRevenue.fix.apply") });
    expect(enabled).toBeEnabled();
    fireEvent.click(enabled);
    await waitFor(() => expect(h.apply).toHaveBeenCalledWith({ value: 60 }));
  });
});
