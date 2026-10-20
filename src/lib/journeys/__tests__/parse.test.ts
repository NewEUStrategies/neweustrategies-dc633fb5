// Parsery RPC ścieżek (S5). Kontrakt: kształt z PRAWDZIWEJ bazy
// (`rpcShapes.fixture.ts`) przechodzi bez zmian, a rozjazd jest głośny -
// zero to wynik, `null` to „nie da się policzyć", zły typ to wyjątek z nazwą
// pola, nigdy cicha zera.
import { describe, expect, it } from "vitest";
import {
  JourneyShapeError,
  parseEngineHealth,
  parseJourneyEnrollments,
  parseJourneyList,
  parseJourneySeries,
  parseJourneySettings,
  parseJourneyStats,
  parseLeadEnrollments,
  parseMutation,
  parsePublish,
  parseSimulation,
  parseTriggerEstimate,
} from "../parse";
import { RPC_SHAPES } from "./rpcShapes.fixture";

// Kopia JSON fikstury `as const` jest zwykłymi, zmiennymi danymi - stąd
// `unknown`: każdy test sam deklaruje kształt, który psuje (asercja z
// typu readonly na zmienny byłaby dla tsc konwersją bez pokrycia).
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function shapeError(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(JourneyShapeError);
    return (err as JourneyShapeError).path;
  }
  throw new Error("oczekiwano JourneyShapeError");
}

describe("kształty z bazy przechodzą", () => {
  it("lista ścieżek", () => {
    const [row] = parseJourneyList(RPC_SHAPES.list);
    expect(row).toMatchObject({
      key: "kasa",
      status: "archived",
      category: "marketing",
      templateKey: "abandoned_checkout",
      version: 1,
      description: null,
      enrolled30d: 0,
    });
  });

  it("kontakty w ścieżce i ścieżki leada", () => {
    const page = parseJourneyEnrollments(RPC_SHAPES.enrollments);
    expect(page).toMatchObject({ total: 1, page: 0, pageSize: 50 });
    expect(page.rows[0]).toMatchObject({
      status: "exited",
      exitReason: "manual",
      isTest: true,
      nextRunAt: null,
      currentNodeId: "w",
    });
    const [lead] = parseLeadEnrollments(RPC_SHAPES.leadEnrollments);
    expect(lead).toMatchObject({ category: "marketing", exitReason: "manual", version: 1 });
  });

  it("ustawienia: domyślne (brak wiersza) i zapisane z nadawcą", () => {
    expect(parseJourneySettings(RPC_SHAPES.settingsDefault)).toMatchObject({
      exists: false,
      enabled: false,
      marketingCapPer7d: 3,
      quietStart: "21:00",
      quietEnd: "08:00",
      senderName: null,
      updatedAt: null,
    });
    expect(parseJourneySettings(RPC_SHAPES.settingsSaved)).toMatchObject({
      exists: true,
      senderName: "Redakcja NES",
      replyTo: "redakcja@nes.example",
    });
  });

  it("zdrowie silnika z wyłącznikiem środowiska", () => {
    const health = parseEngineHealth(RPC_SHAPES.health, true);
    expect(health).toMatchObject({ enabled: true, killSwitch: true, dueNow: 1, lastErrors: [] });
    const withErrors = clone(RPC_SHAPES.health) as Record<string, unknown>;
    withErrors.errors_24h = { email: "2", route: 1 };
    withErrors.last_errors = [
      {
        phase: "email",
        created_at: "2026-10-20T08:00:00Z",
        journey_id: null,
        node_id: "m",
        error: "x",
      },
    ];
    expect(parseEngineHealth(withErrors, false)).toMatchObject({
      killSwitch: false,
      errors24h: { email: 2, route: 1 },
      lastErrors: [{ phase: "email", nodeId: "m", journeyId: null }],
    });
  });

  it("statystyki: mail z CTOR, A/B z z-score, seria dzienna", () => {
    const stats = parseJourneyStats(RPC_SHAPES.statsEmail);
    const mail = stats.nodes.find((n) => n.nodeId === "m");
    expect(mail?.email).toMatchObject({ queued: 1, uniqueHumanOpens: 1, ctor: 1, complained: 1 });
    expect(stats.nodes.find((n) => n.nodeId === "t")?.email).toBeNull();
    expect(stats.journey.goalRate).toBe(0);
    const ab = parseJourneyStats(RPC_SHAPES.statsAb);
    expect(ab.variants.map((v) => [v.variant, v.z])).toEqual([
      ["A", 6.603],
      ["B", -6.603],
    ]);
    expect(ab.nodes[0].outcomes).toEqual({ A: 120, B: 120 });
    expect(ab.journey.goalRate).toBeCloseTo(0.4625);
    expect(parseJourneySeries(RPC_SHAPES.series)).toHaveLength(4);
  });

  it("szacunek, symulacja, wyniki zapisów", () => {
    expect(parseTriggerEstimate(RPC_SHAPES.estimate)).toEqual({
      eventType: "checkout.abandoned.v1",
      days: 30,
      events: 2,
      contacts: 2,
    });
    const sim = parseSimulation(RPC_SHAPES.simulation);
    expect(sim.ok).toBe(true);
    expect(sim.endedAt).toBe("x");
    expect(sim.emails).toEqual([{ nodeId: "m", verdict: "no_consent" }]);
    expect(sim.path[1]).toEqual({ nodeId: "w", type: "wait", outcome: "next", note: "duration" });
    expect(sim.path[3]).toEqual({ nodeId: "x", type: "exit", outcome: null, note: null });
    expect(parseMutation(RPC_SHAPES.mutation).status).toBe("draft");
    expect(parsePublish(RPC_SHAPES.publish)).toMatchObject({ version: 1 });
  });

  it("symulacja z błędami grafu i bez końca", () => {
    expect(
      parseSimulation({
        ok: false,
        errors: [{ code: "graph_cycle" }, { code: "edge_dangling", nodeId: "a" }],
        path: [],
        emails: [],
      }),
    ).toEqual({
      ok: false,
      errors: [
        { code: "graph_cycle", nodeId: null },
        { code: "edge_dangling", nodeId: "a" },
      ],
      path: [],
      emails: [],
      endedAt: null,
    });
  });
});

describe("rozjazd kontraktu jest głośny", () => {
  it("nie-obiekt, nie-tablica, brak pola", () => {
    expect(shapeError(() => parseJourneyList({}))).toBe("$");
    expect(shapeError(() => parseJourneyList([1]))).toBe("[0].");
    expect(shapeError(() => parseJourneySettings({}))).toBe("enabled");
    expect(shapeError(() => parseJourneyEnrollments({ total: 0, page: 0, page_size: 1 }))).toBe(
      "rows",
    );
  });

  it("liczby: napis cyfr przyjęty, ujemna/ułamek/tekst odrzucone", () => {
    const est = { event_type: "a.b.v1", days: "30", events: 0, contacts: 0 };
    expect(parseTriggerEstimate(est).days).toBe(30);
    expect(shapeError(() => parseTriggerEstimate({ ...est, events: -1 }))).toBe("events");
    expect(shapeError(() => parseTriggerEstimate({ ...est, events: 1.5 }))).toBe("events");
    expect(shapeError(() => parseTriggerEstimate({ ...est, contacts: "dużo" }))).toBe("contacts");
  });

  it("enum, boolean, napis, znacznik czasu", () => {
    const row = clone(RPC_SHAPES.list[0]) as Record<string, unknown>;
    expect(shapeError(() => parseJourneyList([{ ...row, status: "deleted" }]))).toBe("[0].status");
    expect(shapeError(() => parseJourneyList([{ ...row, name: 5 }]))).toBe("[0].name");
    expect(shapeError(() => parseJourneyList([{ ...row, description: 5 }]))).toBe(
      "[0].description",
    );
    expect(shapeError(() => parseJourneyList([{ ...row, updated_at: "wczoraj" }]))).toBe(
      "[0].updated_at",
    );
    const settings = clone(RPC_SHAPES.settingsSaved) as Record<string, unknown>;
    expect(shapeError(() => parseJourneySettings({ ...settings, enabled: "true" }))).toBe(
      "enabled",
    );
    const enr = clone(RPC_SHAPES.leadEnrollments[0]) as Record<string, unknown>;
    expect(shapeError(() => parseLeadEnrollments([{ ...enr, exit_reason: "boredom" }]))).toBe(
      "[0].exit_reason",
    );
  });

  it("statystyki: ułamek > 1, z nieliczbowe, nieznana faza i powód", () => {
    const stats = clone(RPC_SHAPES.statsAb) as Record<string, Record<string, unknown>> & {
      variants: Record<string, unknown>[];
    };
    stats.journey.goal_rate = "1.5";
    expect(shapeError(() => parseJourneyStats(stats))).toBe("journey.goal_rate");
    stats.journey.goal_rate = "0.5";
    expect(parseJourneyStats(stats).journey.goalRate).toBe(0.5);
    stats.journey.exited = { boredom: 1 };
    expect(shapeError(() => parseJourneyStats(stats))).toBe("journey.exited.boredom");
    stats.journey.exited = { manual: "2" };
    expect(parseJourneyStats(stats).journey.exited).toEqual({ manual: 2 });
    stats.variants[0].z = "abc";
    expect(shapeError(() => parseJourneyStats(stats))).toBe("variants[0].z");
    stats.variants[0].z = "1.25";
    expect(parseJourneyStats(stats).variants[0].z).toBe(1.25);
    stats.variants[0].z = null;
    expect(parseJourneyStats(stats).variants[0].z).toBeNull();
    stats.variants[0].z = true;
    expect(shapeError(() => parseJourneyStats(stats))).toBe("variants[0].z");

    const email = clone(RPC_SHAPES.statsEmail) as {
      nodes: Record<string, Record<string, unknown>>[];
    };
    email.nodes[0].email.ctor = -1;
    expect(shapeError(() => parseJourneyStats(email))).toBe("nodes[0].email.ctor");
    email.nodes[0].email.ctor = "";
    expect(shapeError(() => parseJourneyStats(email))).toBe("nodes[0].email.ctor");
    email.nodes[0].email.ctor = null;
    expect(parseJourneyStats(email).nodes[0].email?.ctor).toBeNull();

    const health = clone(RPC_SHAPES.health) as Record<string, unknown>;
    health.errors_24h = { cron: 1 };
    expect(shapeError(() => parseEngineHealth(health, false))).toBe("errors_24h.cron");
  });
});
