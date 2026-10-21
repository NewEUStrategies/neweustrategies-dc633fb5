// `DiagnosticsBoard` (S7, SPEC §2.2 `diagnostics`) - tablica Diagnostyki.
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. Lista otwartych diagnoz pogrupowana po obszarze (kondycja 0-100,
//      h2 → h3 → h4), filtry: obszar z adresu (`?area=`), waga i stan.
//   2. `?view=list|map` - przełącznik z `aria-pressed`, mapa systemu
//      z manifestu.
//   3. `?finding=` - fokus na karcie, także gdy filtr stanu by ją ukrył.
//   4. `?fix=` - dialog dla aktywnej reguły; nieaktywna → „Ten problem już
//      nie występuje"; dialog po udanej naprawie ZOSTAJE (wynik i „Cofnij").
//   5. Wyciszanie tylko admin (redaktor: wyłączone z powodem); zapis
//      i zdjęcie wyciszenia ogłasza region `role="status"`, nie toast.
//   6. Stany kart: brak najemcy (zero zapytań), odmowa, brak funkcji, MFA,
//      błąd z ponowieniem; brak wyciszeń powiedziany słowem.
//   7. axe bez naruszeń (lista, mapa).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchFacts: vi.fn(),
  fetchSnoozes: vi.fn(),
  snooze: vi.fn(),
  unsnooze: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@/lib/revenue/diagnostics/diagnostics.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/revenue/diagnostics/diagnostics.functions")>()),
  getRevenueFacts: () => h.fetchFacts(),
  getRevenueSnoozes: () => h.fetchSnoozes(),
  snoozeRevenueCheck: (input: unknown) => h.snooze(input),
  unsnoozeRevenueCheck: (input: unknown) => h.unsnooze(input),
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
  DiagnosticsBoard,
  type DiagnosticsSearch,
} from "@/components/admin/revenue/diagnostics/DiagnosticsBoard";
import { findingDomId } from "@/components/admin/revenue/diagnostics/findingText";
import {
  FACTS,
  FACTS_FIXED,
  TENANT,
  daysSnooze,
  factsRead,
  snoozesRead,
} from "./diagnosticsFixtures";

const t = realT("pl");

type Patch = Parameters<ComponentProps<typeof DiagnosticsBoard>["onSearchChange"]>[0];

/** Zakładka w miniaturze: adres w stanie, `onSearchChange` scala łatkę jak router. */
function Harness({
  initial,
  roles,
  tenantId,
  onChange,
}: {
  initial: DiagnosticsSearch;
  roles: readonly string[];
  tenantId: string | null;
  onChange: (patch: Patch) => void;
}) {
  const [search, setSearch] = useState<DiagnosticsSearch>(initial);
  return (
    <DiagnosticsBoard
      tenantId={tenantId}
      roles={roles}
      search={search}
      onSearchChange={(patch) => {
        onChange(patch);
        setSearch((prev) => ({ ...prev, ...patch }));
      }}
    />
  );
}

function renderBoard(
  initial: DiagnosticsSearch = {},
  roles: readonly string[] = ["admin"],
  tenantId: string | null = TENANT,
) {
  const onChange = vi.fn<(patch: Patch) => void>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} roles={roles} tenantId={tenantId} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { ...view, onChange, queryClient };
}

async function board() {
  return screen.findByTestId("diagnostics-board");
}

function groupAreas(): string[] {
  return [...document.querySelectorAll("section[data-area]")].map(
    (s) => s.getAttribute("data-area") ?? "",
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.fetchFacts.mockReset().mockResolvedValue(factsRead(FACTS));
  h.fetchSnoozes.mockReset().mockResolvedValue(snoozesRead());
  h.snooze.mockReset().mockResolvedValue({ state: "ok" });
  h.unsnooze.mockReset().mockResolvedValue({ state: "ok", removed: true });
  h.apply.mockReset();
});

afterEach(() => cleanup());

describe("DiagnosticsBoard - lista i filtry", () => {
  it("otwarte diagnozy w grupach obszarów z kondycją; nagłówki h2 → h3 → h4", async () => {
    renderBoard();
    await board();
    expect(screen.getByTestId("diagnostics-summary")).toHaveTextContent(
      t("adminRevenue.diagnostics.summary", { count: 4 }),
    );
    expect(groupAreas()).toEqual(["catalog", "metering", "checkout", "sync"]);
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: t("adminRevenue.diagnostics.groupHeading", {
          area: t("adminRevenue.area.metering"),
          score: 80,
        }),
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 4 })).toHaveLength(4);
    expect(
      screen.getByRole("heading", { level: 2, name: t("adminRevenue.diagnostics.title") }),
    ).toBeInTheDocument();
  });

  it("waga i stan filtrują lokalnie; obszar idzie do adresu", async () => {
    const { onChange } = renderBoard();
    await board();

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.severity.critical") }));
    expect(groupAreas()).toEqual(["metering", "sync"]);
    expect(
      screen.getByRole("button", { name: t("adminRevenue.severity.critical") }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.allSeverities") }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t("adminRevenue.diagnostics.state.ok")} (4)` }),
    );
    expect(
      [...document.querySelectorAll("article[data-check-id]")].map((a) =>
        a.getAttribute("data-state"),
      ),
    ).toEqual(["ok", "ok", "ok", "ok"]);

    fireEvent.change(screen.getByLabelText(t("adminRevenue.diagnostics.areaFilter")), {
      target: { value: "metering" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ area: "metering", finding: undefined });
    expect(groupAreas()).toEqual(["metering"]);
  });

  it("pusty wynik filtrów: komunikat i „Wyczyść filtry”", async () => {
    const { onChange } = renderBoard({ area: "paywall" });
    await board();
    const empty = screen.getByTestId("diagnostics-empty");
    expect(empty).toHaveTextContent(t("adminRevenue.diagnostics.empty.filtered"));
    fireEvent.click(
      within(empty).getByRole("button", { name: t("adminRevenue.diagnostics.empty.clear") }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ area: undefined, finding: undefined });
    expect(groupAreas().length).toBeGreaterThan(4);
  });
});

describe("DiagnosticsBoard - widok listy i mapy (`?view=`)", () => {
  it("przełącznik z aria-pressed; mapa systemu zamiast listy", async () => {
    const { onChange } = renderBoard();
    await board();
    const map = screen.getByRole("button", { name: t("adminRevenue.diagnostics.view.map") });
    expect(map).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(map);
    expect(onChange).toHaveBeenLastCalledWith({ view: "map" });
    expect(screen.getByTestId("system-map")).toBeInTheDocument();
    expect(screen.queryByLabelText(t("adminRevenue.diagnostics.areaFilter"))).toBe(null);
    expect(groupAreas()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.diagnostics.view.list") }));
    expect(onChange).toHaveBeenLastCalledWith({ view: undefined });
  });
});

describe("DiagnosticsBoard - fokus z adresu (`?finding=`)", () => {
  it("karta w fokusie także wtedy, gdy filtr stanu by ją ukrył", async () => {
    h.fetchSnoozes.mockResolvedValue(snoozesRead([daysSnooze("catalog.enquiry_plan_buyable")]));
    renderBoard({ finding: "catalog.enquiry_plan_buyable" });
    await board();
    const card = document.getElementById(findingDomId("catalog.enquiry_plan_buyable"));
    expect(card).not.toBe(null);
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card).toHaveAttribute("data-focused", "true");
    expect(screen.getByTestId("diagnostics-summary")).toHaveTextContent(
      t("adminRevenue.diagnostics.summary", { count: 3 }),
    );
  });

  it("reguła bez faktów (poza filtrem „otwarte”) też jest pokazana dzięki fokusowi", async () => {
    renderBoard({ finding: "paywall.rule_inactive_plan" });
    await board();
    const card = document.getElementById(findingDomId("paywall.rule_inactive_plan"));
    expect(card).toHaveAttribute("data-state", "unknown");
    expect(groupAreas()).toContain("paywall");
  });

  it("nieznana diagnoza z adresu: komunikat zamiast cichego braku", async () => {
    renderBoard({ finding: "catalog.missing_rule" });
    await board();
    expect(screen.getByTestId("diagnostics-focus-missing")).toHaveTextContent(
      t("adminRevenue.diagnostics.focusMissing"),
    );
  });
});

describe("DiagnosticsBoard - dialog naprawy z adresu (`?fix=`)", () => {
  it("aktywna reguła otwiera dialog; po udanej naprawie dialog zostaje z wynikiem", async () => {
    h.apply.mockResolvedValue({ revert: vi.fn() });
    const { onChange } = renderBoard({ fix: "catalog.enquiry_plan_buyable" });
    const dialog = await screen.findByTestId("quick-fix-dialog");
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));

    fireEvent.click(within(dialog).getByRole("button", { name: t("adminRevenue.fix.apply") }));

    await waitFor(() =>
      expect(screen.getByTestId("quick-fix-status")).toHaveAttribute("data-outcome", "resolved"),
    );
    // Lista już się przeliczyła (reguła „ok"), a dialog nadal ogłasza wynik.
    expect(screen.getByTestId("diagnostics-summary")).toHaveTextContent(
      t("adminRevenue.diagnostics.summary", { count: 3 }),
    );
    expect(screen.queryByTestId("diagnostics-fix-gone")).toBe(null);
    expect(screen.getByRole("button", { name: /Cofnij/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.fix.close") }));
    expect(onChange).toHaveBeenLastCalledWith({ fix: undefined });
    await waitFor(() => expect(screen.queryByTestId("quick-fix-dialog")).toBe(null));
  });

  it("id dialogu w adresie wybiera regułę, która dziś widzi problem", async () => {
    renderBoard({ fix: "metering_defaults" });
    const dialog = await screen.findByTestId("quick-fix-dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: t("adminRevenue.fix.dialogTitle", {
          title: t("adminRevenue.checks.metering.settings_row_missing.title"),
        }),
      }),
    ).toBeInTheDocument();
  });

  it("nieaktywna reguła: „Ten problem już nie występuje” i zamknięcie czyści adres", async () => {
    h.fetchFacts.mockResolvedValue(factsRead(FACTS_FIXED));
    const { onChange } = renderBoard({ fix: "catalog.enquiry_plan_buyable" });
    await board();
    const gone = screen.getByTestId("diagnostics-fix-gone");
    expect(gone).toHaveAttribute("role", "status");
    expect(gone).toHaveTextContent(t("adminRevenue.diagnostics.fixGone"));
    expect(screen.queryByTestId("quick-fix-dialog")).toBe(null);
    fireEvent.click(within(gone).getByRole("button", { name: t("adminRevenue.fix.close") }));
    expect(onChange).toHaveBeenLastCalledWith({ fix: undefined });
    expect(screen.queryByTestId("diagnostics-fix-gone")).toBe(null);
  });

  it("reguła bez faktów i nieznany identyfikator mają własne komunikaty", async () => {
    renderBoard({ fix: "paywall.rule_inactive_plan" });
    await board();
    expect(screen.getByTestId("diagnostics-fix-gone")).toHaveTextContent(
      t("adminRevenue.diagnostics.fixUnknown"),
    );
    cleanup();
    renderBoard({ fix: "nie_ma_takiej" });
    await board();
    expect(screen.getByTestId("diagnostics-fix-gone")).toHaveTextContent(
      t("adminRevenue.diagnostics.fixInvalid"),
    );
  });

  it("„Napraw” na karcie dopisuje `?fix=` (nowy wpis historii)", async () => {
    const { onChange } = renderBoard();
    await board();
    const card = document.getElementById(findingDomId("metering.settings_row_missing"));
    if (!card) throw new Error("brak karty");
    fireEvent.click(
      within(card).getByRole("button", { name: t("adminRevenue.diagnostics.card.fix") }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ fix: "metering.settings_row_missing" });
    expect(await screen.findByTestId("quick-fix-dialog")).toBeInTheDocument();
  });
});

describe("DiagnosticsBoard - wyciszanie (tylko administrator)", () => {
  it("admin wycisza na 30 dni; wynik w regionie statusu, fakty i wyciszenia odświeżone", async () => {
    renderBoard();
    await board();
    const card = document.getElementById(findingDomId("catalog.enquiry_plan_buyable"));
    if (!card) throw new Error("brak karty");
    fireEvent.click(
      within(card).getByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") }),
    );
    const dialog = await screen.findByTestId("snooze-dialog");
    expect(within(dialog).getByLabelText(t("adminRevenue.snooze.daysLabel"))).toHaveValue("30");

    fireEvent.click(within(dialog).getByRole("button", { name: t("adminRevenue.snooze.confirm") }));

    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-notice")).toHaveTextContent(
        t("adminRevenue.snooze.saved"),
      ),
    );
    expect(h.snooze).toHaveBeenCalledTimes(1);
    const input = (h.snooze.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(input).toMatchObject({
      checkId: "catalog.enquiry_plan_buyable",
      scopeKey: "*",
      kind: "days",
      reason: null,
      scopeHash: null,
    });
    const days = (Date.parse(String(input.until)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30);
    await waitFor(() => expect(h.fetchSnoozes).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("snooze-dialog")).toBe(null);
  });

  it("wyciszenie świadome wymaga powodu; za długi powód jest odrzucany, nie przycinany", async () => {
    renderBoard();
    await board();
    const card = document.getElementById(findingDomId("catalog.enquiry_plan_buyable"));
    if (!card) throw new Error("brak karty");
    fireEvent.click(
      within(card).getByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") }),
    );
    const dialog = await screen.findByTestId("snooze-dialog");
    fireEvent.click(
      within(dialog).getByRole("radio", { name: t("adminRevenue.snooze.kind.intentional") }),
    );
    const confirm = within(dialog).getByRole("button", { name: t("adminRevenue.snooze.confirm") });
    expect(confirm).toBeDisabled();

    const reason = within(dialog).getByLabelText(t("adminRevenue.snooze.reason"));
    const long = "x".repeat(501);
    fireEvent.change(reason, { target: { value: long } });
    expect(reason).toHaveValue(long);
    expect(
      within(dialog).getByText(t("adminRevenue.snooze.reasonTooLong", { max: 500 })),
    ).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    fireEvent.change(reason, { target: { value: "  Plan zostaje na życzenie zarządu  " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(h.snooze).toHaveBeenCalledTimes(1));
    expect((h.snooze.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data).toMatchObject({
      kind: "intentional",
      until: null,
      reason: "Plan zostaje na życzenie zarządu",
      scopeHash: expect.any(String),
    });
  });

  it("odmowa z bazy zostaje w dialogu (kod 22023 słowem), bez toastu", async () => {
    h.snooze.mockResolvedValue({ state: "invalid", code: "until_too_far" });
    renderBoard();
    await board();
    const card = document.getElementById(findingDomId("catalog.enquiry_plan_buyable"));
    if (!card) throw new Error("brak karty");
    fireEvent.click(
      within(card).getByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") }),
    );
    const dialog = await screen.findByTestId("snooze-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("adminRevenue.snooze.confirm") }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      t("adminRevenue.snooze.invalid.until_too_far"),
    );
  });

  it("redaktor widzi diagnozy, ale „Wycisz” jest wyłączone z powodem", async () => {
    renderBoard({}, ["editor"]);
    await board();
    const buttons = screen.getAllByRole("button", {
      name: t("adminRevenue.diagnostics.card.snooze"),
    });
    expect(buttons.length).toBe(4);
    expect(buttons.every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("zdjęcie wyciszenia ogłasza region statusu", async () => {
    h.fetchSnoozes.mockResolvedValue(snoozesRead([daysSnooze("catalog.enquiry_plan_buyable")]));
    renderBoard();
    await board();
    fireEvent.click(
      screen.getByRole("button", { name: `${t("adminRevenue.diagnostics.state.snoozed")} (1)` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.unsnooze") }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("diagnostics-notice")).toHaveTextContent(
        t("adminRevenue.snooze.removed"),
      ),
    );
    expect(h.unsnooze).toHaveBeenCalledWith({
      data: { scopeKey: "*", checkId: "catalog.enquiry_plan_buyable" },
    });
  });
});

describe("DiagnosticsBoard - stany kart", () => {
  it("bez najemcy: komunikat i ZERO zapytań", async () => {
    renderBoard({}, ["admin"], null);
    expect(await screen.findByText(t("adminRevenue.diagnostics.noTenant"))).toBeInTheDocument();
    expect(h.fetchFacts).not.toHaveBeenCalled();
    expect(h.fetchSnoozes).not.toHaveBeenCalled();
  });

  it("odmowa, brak funkcji w bazie i MFA to stany karty", async () => {
    h.fetchFacts.mockResolvedValue({ state: "forbidden" });
    renderBoard();
    expect(await screen.findByText(t("adminRevenue.diagnostics.forbidden"))).toBeInTheDocument();
    cleanup();

    h.fetchFacts.mockResolvedValue({ state: "unavailable" });
    renderBoard();
    expect(await screen.findByText(t("adminRevenue.diagnostics.unavailable"))).toBeInTheDocument();
    cleanup();

    h.fetchFacts.mockResolvedValue({ state: "mfa_required" });
    renderBoard();
    expect(await screen.findByTestId("revenue-mfa-required")).toBeInTheDocument();
  });

  it("błąd odczytu: komunikat z ponowieniem", async () => {
    // Fabryka ponawia raz (`retry: 1`, ze zwłoką) - błąd po obu próbach.
    h.fetchFacts.mockRejectedValue(new Error("boom"));
    renderBoard();
    expect(
      await screen.findByText(t("adminRevenue.diagnostics.error"), undefined, { timeout: 4_000 }),
    ).toBeInTheDocument();
    h.fetchFacts.mockResolvedValue(factsRead(FACTS));
    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.diagnostics.refresh") }));
    expect(await screen.findByTestId("diagnostics-board")).toBeInTheDocument();
  });

  it("brak wyciszeń powiedziany słowem (nie cicho)", async () => {
    h.fetchSnoozes.mockResolvedValue({ state: "unavailable" });
    renderBoard();
    await board();
    expect(screen.getByTestId("diagnostics-snoozes-missing")).toHaveTextContent(
      t("adminRevenue.diagnostics.snoozesUnavailable"),
    );
  });
});

describe("DiagnosticsBoard - dostępność", () => {
  it("axe bez naruszeń: lista (admin) i mapa systemu", async () => {
    const { container } = renderBoard();
    await board();
    const list = await axeViolations(container);
    expect(list, summarize(list)).toEqual([]);
    cleanup();

    const map = renderBoard({ view: "map" }, ["editor"]);
    await screen.findByTestId("system-map");
    const violations = await axeViolations(map.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
