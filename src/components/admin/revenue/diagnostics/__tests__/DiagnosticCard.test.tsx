// `DiagnosticCard` (S7, SPEC §6.1) - jedna diagnoza w liście (`full`)
// i w „Wymaga uwagi" (`compact`).
//
// CO TEN PLIK DOWODZI (karta S7.1):
//   1. Karta mówi co, dlaczego i co zrobić: tytuł, waga, obszar, stan słowem,
//      wpływ, dowody z faktów; „Napraw" woła dialog, odnośnik naprawy niesie
//      parametr kontraktu (`refParam`), „Otwórz moduł" prowadzi do właściciela.
//   2. Wyciszanie tylko admin: redaktor widzi „Wycisz" wyłączone z powodem
//      (Tooltip + tekst dla czytnika); reguła krytyczna sync - niewyciszalna
//      także dla admina.
//   3. Naprawa w kodzie: „Zgłoś do zespołu" kopiuje opis z dowodem i numerem
//      zgłoszenia; odmowa schowka pokazuje opis do ręcznego zaznaczenia.
//   4. `compact`: bez opisu i wyciszania, jeden dowód; axe bez naruszeń.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    // Parametry adresu w atrybucie - asercja widzi kontrakt deep linku.
    Link: (props: { search?: Record<string, string>; children?: ReactNode; to?: unknown }) => (
      <RouterLinkStub {...props} data-search={new URLSearchParams(props.search).toString()} />
    ),
  };
});

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { DiagnosticCard } from "@/components/admin/revenue/diagnostics/DiagnosticCard";
import { reportBodyOf } from "@/components/admin/revenue/diagnostics/findingText";
import { daysSnooze, finding } from "./diagnosticsFixtures";

const writeText = vi.fn();

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

afterEach(() => cleanup());

const SYNC_FINDING = finding({
  checkId: "sync.emit_errors",
  area: "sync",
  severity: "critical",
  count: 2,
  refs: [],
  evidence: [{ key: "emitErrors24h", params: { count: 2 } }],
  impact: "high",
  fix: { kind: "code", issueRef: "sync.emit_errors" },
  owner: { to: "/admin/revenue/diagnostics", search: { view: "map" } },
  snoozable: false,
});

describe("DiagnosticCard - wariant pełny", () => {
  it("mówi co, dlaczego i co zrobić; „Napraw” woła dialog", () => {
    const onFix = vi.fn();
    render(<DiagnosticCard finding={finding()} variant="full" onFix={onFix} canSnooze />);
    const t = realT("pl");

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: t("adminRevenue.checks.catalog.enquiry_plan_buyable.title"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("adminRevenue.checks.catalog.enquiry_plan_buyable.description")),
    ).toBeInTheDocument();
    expect(screen.getByText(t("adminRevenue.diagnostics.stateBadge.error"))).toBeInTheDocument();
    expect(screen.getByText(t("adminRevenue.diagnostics.card.impact.medium"))).toBeInTheDocument();
    expect(
      screen.getByText(t("adminRevenue.evidence.enquiryPlanBuyable", { count: 1, active: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("adminRevenue.severity.warning"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.fix") }));
    expect(onFix).toHaveBeenCalledTimes(1);

    const owner = screen.getByRole("link", {
      name: t("adminRevenue.diagnostics.card.openModule"),
    });
    expect(owner).toHaveAttribute("href", "/admin/paywall");
    expect(owner).toHaveAttribute("data-search", "tab=plans");
  });

  it("poziom nagłówka 4 pod grupą obszaru (bez przeskoku poziomów)", () => {
    render(<DiagnosticCard finding={finding()} variant="full" headingLevel={4} />);
    expect(screen.getByRole("heading", { level: 4 })).toHaveAttribute(
      "id",
      "revenue-finding-catalog-enquiry_plan_buyable-title",
    );
  });

  it("naprawa odnośnikiem niesie parametr z pierwszego `refs` (szablon ścieżki)", () => {
    render(
      <DiagnosticCard
        finding={finding({
          checkId: "journeys.missing_core",
          area: "journeys",
          refs: ["checkout_abandoned"],
          evidence: [],
          fix: {
            kind: "link",
            to: "/admin/revenue/journeys",
            search: { new: "1" },
            refParam: "template",
          },
        })}
        variant="full"
      />,
    );
    const link = screen.getByRole("link", {
      name: realT("pl")("adminRevenue.diagnostics.card.openFix"),
    });
    expect(link).toHaveAttribute("href", "/admin/revenue/journeys");
    expect(link).toHaveAttribute("data-search", "new=1&template=checkout_abandoned");
  });

  it("stan „nie wiadomo” mówi, czego brakuje, i nie proponuje naprawy", () => {
    render(
      <DiagnosticCard
        finding={finding({ state: "unknown", evidence: [], count: null })}
        variant="full"
        onFix={vi.fn()}
      />,
    );
    const t = realT("pl");
    expect(screen.getByText(t("adminRevenue.diagnostics.card.unknownHint"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("adminRevenue.diagnostics.card.fix") })).toBe(
      null,
    );
  });
});

describe("DiagnosticCard - wyciszanie tylko dla administratora", () => {
  it("admin: „Wycisz” woła wyciszenie", () => {
    const onSnooze = vi.fn();
    render(<DiagnosticCard finding={finding()} variant="full" canSnooze onSnooze={onSnooze} />);
    fireEvent.click(
      screen.getByRole("button", { name: realT("pl")("adminRevenue.diagnostics.card.snooze") }),
    );
    expect(onSnooze).toHaveBeenCalledWith("days");
  });

  it("redaktor: przycisk wyłączony z powodem dla czytnika i podpowiedzią", () => {
    const onSnooze = vi.fn();
    render(
      <DiagnosticCard finding={finding()} variant="full" canSnooze={false} onSnooze={onSnooze} />,
    );
    const t = realT("pl");
    const button = screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") });
    expect(button).toBeDisabled();
    const reason = t("adminRevenue.diagnostics.card.snoozeAdminOnly");
    expect(button.closest("[aria-describedby]")).toHaveAccessibleDescription(reason);
    fireEvent.click(button);
    expect(onSnooze).not.toHaveBeenCalled();
  });

  it("reguła krytyczna sync jest niewyciszalna także dla admina", () => {
    render(<DiagnosticCard finding={SYNC_FINDING} variant="full" canSnooze onSnooze={vi.fn()} />);
    const t = realT("pl");
    const button = screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") });
    expect(button).toBeDisabled();
    expect(button.closest("[aria-describedby]")).toHaveAccessibleDescription(
      t("adminRevenue.diagnostics.card.notSnoozable"),
    );
  });

  it("wyciszona: termin słowem, „Przywróć” tylko dla admina", () => {
    const onUnsnooze = vi.fn();
    const snoozed = finding({ snooze: daysSnooze("catalog.enquiry_plan_buyable") });
    const t = realT("pl");
    const { unmount } = render(
      <DiagnosticCard finding={snoozed} variant="full" canSnooze onUnsnooze={onUnsnooze} />,
    );
    expect(screen.getByText(t("adminRevenue.diagnostics.stateBadge.snoozed"))).toBeInTheDocument();
    expect(screen.getByTestId("finding-snoozed")).toHaveTextContent(
      t("adminRevenue.diagnostics.card.snoozedUntil", { date: "1 sty 2099" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.unsnooze") }),
    );
    expect(onUnsnooze).toHaveBeenCalledTimes(1);
    unmount();

    render(<DiagnosticCard finding={snoozed} variant="full" canSnooze={false} />);
    expect(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.unsnooze") }),
    ).toBeDisabled();
  });
});

describe("DiagnosticCard - naprawa w kodzie („Zgłoś do zespołu”)", () => {
  it("kopiuje opis z dowodem i numerem zgłoszenia, wynik w regionie statusu", async () => {
    render(<DiagnosticCard finding={SYNC_FINDING} variant="full" factsAt="2026-10-15T10:00Z" />);
    const t = realT("pl");
    fireEvent.click(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.report") }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const body = String(writeText.mock.calls[0]?.[0]);
    expect(body).toBe(reportBodyOf(t, SYNC_FINDING, "2026-10-15T10:00Z"));
    expect(body).toContain("sync.emit_errors");
    expect(body).toContain(t("adminRevenue.evidence.emitErrors24h", { count: 2 }));
    expect(await screen.findByTestId("finding-report-status")).toHaveTextContent(
      t("adminRevenue.diagnostics.card.reported"),
    );
  });

  it("odmowa schowka: opis w polu tylko do odczytu (bez ślepej uliczki)", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<DiagnosticCard finding={SYNC_FINDING} variant="full" />);
    const t = realT("pl");
    fireEvent.click(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.report") }),
    );
    const field = await screen.findByLabelText(t("adminRevenue.diagnostics.card.reportFailed"));
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).value).toBe(reportBodyOf(t, SYNC_FINDING, null));
  });
});

describe("DiagnosticCard - wariant zwarty (Kokpit)", () => {
  it("bez opisu i wyciszania, jeden dowód, akcje naprawy zostają", () => {
    const two = finding({
      evidence: [
        { key: "enquiryPlanBuyable", params: { count: 1, active: 1 } },
        { key: "emitErrors24h", params: { count: 2 } },
      ],
    });
    render(<DiagnosticCard finding={two} variant="compact" onFix={vi.fn()} canSnooze />);
    const t = realT("pl");
    expect(
      screen.queryByText(t("adminRevenue.checks.catalog.enquiry_plan_buyable.description")),
    ).toBe(null);
    expect(screen.queryByRole("button", { name: t("adminRevenue.diagnostics.card.snooze") })).toBe(
      null,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: t("adminRevenue.diagnostics.card.fix") }),
    ).toBeVisible();
  });
});

describe("DiagnosticCard - dostępność", () => {
  it("axe bez naruszeń: pełna (redaktor), zwarta i naprawa w kodzie", async () => {
    const { container } = render(
      <div>
        <DiagnosticCard finding={finding()} variant="full" onFix={vi.fn()} />
        <DiagnosticCard finding={SYNC_FINDING} variant="full" canSnooze />
        <DiagnosticCard
          finding={finding({ checkId: "metering.settings_row_missing" })}
          variant="compact"
          onFix={vi.fn()}
        />
      </div>,
    );
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
