// Żądania edycji kanwy i listy (S8.3b) - czyste funkcje z `JourneyInsertButton`.
//
// CO TEN PLIK DOWODZI.
//   1. `runJourneyEditRequest` nie ma własnych reguł: wstawienie i pozycje menu
//      dają DOKŁADNIE wynik `applyOp`/`insertAfter` z S8.1 (parytet kanwa ↔
//      lista ↔ klawiatura stoi na jednym wejściu), a „Połącz z krokiem…” na
//      BRAKUJĄCEJ gałęzi (bez kroku, na którym `applyOp` mógłby działać) idzie
//      przez `mergeInto` z adresem gałęzi.
//   2. Powód odmowy: `would_break` wymienia błędy grafu słowami słownika S5,
//      limit kroków podaje limit z `JOURNEY_LIMITS`.
//   3. Kontekst operacji z ustawień szkicu (zakaz maili przy windykacji).
import { describe, expect, it } from "vitest";

import {
  journeyOpErrorText,
  journeyOpLabel,
  journeyOpsContext,
  runJourneyEditRequest,
} from "../JourneyInsertButton";
import {
  applyOp,
  availableOps,
  insertAfter,
  mergeInto,
  JOURNEY_OP_LABEL_KEY,
} from "@/lib/admin/journeys/ops";
import { validateJourneyGraph, type JourneyGraph } from "@/lib/journeys/graph";
import { JOURNEY_LIMITS } from "@/lib/journeys/limits";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-canvas";

const t = realT("pl");

const GRAPH: JourneyGraph = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } },
    {
      id: "c",
      type: "if_else",
      params: { match: "all", predicates: [{ kind: "consent", marketing: true }] },
    },
    { id: "m", type: "send_email", params: {} },
    { id: "x", type: "exit", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "c", branch: "next" },
    { from: "c", to: "m", branch: "yes" },
    { from: "m", to: "x", branch: "next" },
  ],
};

describe("runJourneyEditRequest", () => {
  it("wstawienie = `insertAfter` z S8.1 (ten sam graf i ten sam fokus)", () => {
    const params = { mode: "duration", minutes: 120 };
    const viaRequest = runJourneyEditRequest(GRAPH, {
      kind: "insert",
      from: "w",
      branch: "next",
      type: "wait",
      params,
      label: "x",
    });
    expect(viaRequest).toEqual(insertAfter(GRAPH, "w", "next", "wait", params));
    expect(viaRequest.ok).toBe(true);
  });

  it("pozycja menu = `applyOp` z tym samym deskryptorem i wejściem", () => {
    for (const op of availableOps(GRAPH, "m")) {
      if (op.needs) continue;
      expect(
        runJourneyEditRequest(GRAPH, { kind: "op", nodeId: "m", op, label: "x" }),
        op.label,
      ).toEqual(applyOp(GRAPH, "m", op));
    }
  });

  it("„Połącz z krokiem…” na brakującej gałęzi idzie przez `mergeInto`", () => {
    const result = runJourneyEditRequest(GRAPH, {
      kind: "merge",
      from: "c",
      branch: "no",
      targetId: "x",
      label: "x",
    });
    expect(result).toEqual(mergeInto(GRAPH, { from: "c", branch: "no" }, "x"));
    if (!result.ok) throw new Error(result.error);
    expect(result.graph.edges.at(-1)).toEqual({ from: "c", to: "x", branch: "no" });
    expect(validateJourneyGraph(result.graph).errors).toEqual([]);
  });

  it("windykacja: wstawienie maila odrzucone w kontekście z ustawień szkicu", () => {
    const context = journeyOpsContext({
      triggerEventType: "billing_subscription.payment_failed.v1",
    });
    expect(context).toEqual({ triggerEventType: "billing_subscription.payment_failed.v1" });
    expect(journeyOpsContext(null)).toEqual({});
    const result = runJourneyEditRequest(
      GRAPH,
      { kind: "insert", from: "w", branch: "next", type: "send_email", params: {}, label: "x" },
      context,
    );
    expect(result.ok).toBe(false);
  });
});

describe("napisy operacji", () => {
  it("powód `would_break` wymienia błędy grafu słowami słownika silnika", () => {
    expect(
      journeyOpErrorText(t, { ok: false, error: "would_break", codes: ["trigger_count"] }),
    ).toBe(
      t("adminJourneys.canvas.opError.wouldBreakIssues", {
        issues: t("adminJourneys.graphIssue.trigger_count"),
      }),
    );
    expect(journeyOpErrorText(t, { ok: false, error: "would_break" })).toBe(
      t("adminJourneys.canvas.opError.would_break"),
    );
    expect(journeyOpErrorText(t, { ok: false, error: "limit_nodes" })).toContain(
      String(JOURNEY_LIMITS.nodesMax),
    );
  });

  it("etykieta pozycji gałęzi zawiera nazwę gałęzi", () => {
    const insertNo = availableOps(GRAPH, "c").find((op) => op.branch === "no");
    expect(insertNo?.labelKey).toBe(JOURNEY_OP_LABEL_KEY.insertBranch);
    expect(journeyOpLabel(t, insertNo as NonNullable<typeof insertNo>)).toBe(
      t("adminJourneys.common.ops.insertBranch", { branch: t("adminJourneys.branch.no") }),
    );
  });
});
