// Karta historii etapów (hub S4): wiersze z etykietami z nakładki, filtr osi
// (cykl życia / etap sprzedaży), „Pokaż starsze", stan błędu z ponowieniem,
// klucz z fabryki `crmKeys` i parytet nakładki `i18n-admin-crm-lifecycle`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  fails: false,
  calls: [] as unknown[],
}));

vi.mock("@/lib/crm.functions", () => ({
  getCrmLeadStageHistory: async (input: unknown) => {
    h.calls.push(input);
    if (h.fails) throw new Error("permission denied");
    return { json: JSON.stringify(h.rows) };
  },
}));

import {
  LeadStageHistoryCard,
  STAGE_HISTORY_VISIBLE,
  leadStageHistoryQueryOptions,
  parseStageHistory,
} from "@/components/admin/crm/LeadStageHistoryCard";
import { crmKeys } from "@/lib/crm/keys";
import { crmLifecycleEn, crmLifecyclePl } from "@/lib/i18n-admin-crm-lifecycle";
import { LIFECYCLE_STAGES, STAGE_HISTORY_SOURCES } from "@/lib/crm/lifecycle";
import { CRM_SOURCE_TYPES, LEAD_STAGE_ORDER } from "@/lib/crm/leadListSpec";

const LEAD = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";

function row(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    dimension: "lifecycle",
    from_value: "lead",
    to_value: "mql",
    source: "workflow",
    actor_id: null,
    journey_id: null,
    changed_at: `2026-10-${String(10 + (id % 9)).padStart(2, "0")}T10:00:00.000Z`,
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  h.rows = [];
  h.fails = false;
  h.calls = [];
});

describe("LeadStageHistoryCard", () => {
  it("klucz z fabryki crmKeys i czytanie po id leada", async () => {
    expect(leadStageHistoryQueryOptions(LEAD).queryKey).toEqual(crmKeys.leadStageHistory(LEAD));
    h.rows = [row(1)];
    renderWithQueryClient(<LeadStageHistoryCard leadId={LEAD} lang="pl" />);
    await screen.findAllByTestId("stage-history-row");
    expect(h.calls).toEqual([{ data: { id: LEAD } }]);
  });

  it("wiersz: etykiety etapów, źródło, autor z zespołu i zdanie dla czytnika", async () => {
    h.rows = [
      row(2, { source: "manual", actor_id: ACTOR }),
      row(1, { dimension: "crm_stage", from_value: null, to_value: "new", source: "backfill" }),
    ];
    renderWithQueryClient(
      <LeadStageHistoryCard leadId={LEAD} lang="pl" actorNames={new Map([[ACTOR, "Anna"]])} />,
    );
    const rows = await screen.findAllByTestId("stage-history-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Cykl życia: Lead → MQL")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Ręcznie")).toBeInTheDocument();
    expect(within(rows[0]).getByText("przez Anna")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Etap sprzedaży: start → Nowy")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Odtworzone przy wdrożeniu")).toBeInTheDocument();
  });

  it("filtr osi zostawia wyłącznie wpisy cyklu życia", async () => {
    h.rows = [row(2), row(1, { dimension: "crm_stage", from_value: "new", to_value: "won" })];
    renderWithQueryClient(<LeadStageHistoryCard leadId={LEAD} lang="pl" />);
    await screen.findAllByTestId("stage-history-row");
    const lifecycleButton = screen.getByRole("button", { name: "Cykl życia" });
    fireEvent.click(lifecycleButton);
    expect(lifecycleButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("stage-history-row")).toHaveLength(1);
  });

  it("długa historia: pierwsze wpisy + „Pokaż starsze”, potem zwinięcie", async () => {
    h.rows = Array.from({ length: STAGE_HISTORY_VISIBLE + 3 }, (_, i) => row(100 - i));
    renderWithQueryClient(<LeadStageHistoryCard leadId={LEAD} lang="en" />);
    expect(await screen.findAllByTestId("stage-history-row")).toHaveLength(STAGE_HISTORY_VISIBLE);
    fireEvent.click(screen.getByRole("button", { name: "Show older (3)" }));
    expect(screen.getAllByTestId("stage-history-row")).toHaveLength(STAGE_HISTORY_VISIBLE + 3);
    expect(screen.getByRole("button", { name: "Collapse" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("pusta historia i błąd odczytu z ponowieniem", async () => {
    renderWithQueryClient(<LeadStageHistoryCard leadId={LEAD} lang="pl" />);
    expect(await screen.findByText("Brak zmian etapów dla tego kontaktu.")).toBeInTheDocument();
    cleanup();

    h.fails = true;
    renderWithQueryClient(<LeadStageHistoryCard leadId={LEAD} lang="pl" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nie udało się wczytać historii etapów.",
    );
    h.fails = false;
    h.rows = [row(1)];
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(screen.getAllByTestId("stage-history-row")).toHaveLength(1));
  });

  it("parser odrzuca wiersze spoza kontraktu (oś, brak to_value)", () => {
    expect(
      parseStageHistory({
        json: JSON.stringify([row(1), { ...row(2), dimension: "x" }, { id: 3 }, null]),
      }),
    ).toHaveLength(1);
    expect(parseStageHistory({ json: "nie-json" })).toEqual([]);
  });
});

describe("nakładka i18n-admin-crm-lifecycle", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
          keys(v, prefix ? `${prefix}.${k}` : k),
        )
      : [prefix];

  it("PL i EN mają identyczne drzewo kluczy", () => {
    expect(keys(crmLifecycleEn).sort()).toEqual(keys(crmLifecyclePl).sort());
  });

  it("każdy etap, segment, źródło historii i etap sprzedaży ma etykietę w obu językach", () => {
    for (const dict of [crmLifecyclePl, crmLifecycleEn]) {
      const lc = dict.adminCrm.lifecycle;
      for (const stage of LIFECYCLE_STAGES) {
        expect(lc.stages[stage]).toBeTruthy();
        expect(lc.stageHints[stage]).toBeTruthy();
      }
      for (const type of CRM_SOURCE_TYPES) expect(lc.segments[type]).toBeTruthy();
      for (const source of STAGE_HISTORY_SOURCES) {
        expect((lc.historySources as Record<string, string>)[source]).toBeTruthy();
      }
      for (const stage of LEAD_STAGE_ORDER) expect(lc.crmStages[stage]).toBeTruthy();
    }
  });
});
