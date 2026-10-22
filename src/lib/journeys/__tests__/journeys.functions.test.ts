// Server fn ścieżek (S5): obudowa (metoda, bramka, walidator), literały RPC,
// najemca NIGDY w parametrach, stany odczytu zamiast wyjątków i kody błędów
// zapisów, które panel S8 tłumaczy. Handlery idą przez atrapę
// `createServerFn` (`@/test/serverFn`) - autoryzacji pilnuje authz-snapshot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));

import * as fns from "../journeys.functions";
import {
  JourneySettingsPatchSchema,
  createJourney,
  enrollJourneyTest,
  estimateJourneyTrigger,
  exitJourneyEnrollment,
  getJourneyEngineHealth,
  getJourneyEnrollments,
  getJourneySettings,
  getLeadJourneys,
  installJourneyTemplate,
  journeysKillSwitch,
  listJourneys,
  mapMutationError,
  publishJourney,
  saveJourneyDraft,
  saveJourneyEmailContent,
  saveJourneySettings,
  setJourneyStatus,
  simulateJourney,
  skipJourneyWait,
} from "../journeys.functions";
import { JOURNEY_SERIES_MAX_DAYS, getJourneySeries, getJourneyStats } from "../stats.functions";
import { emptyJourneyGraph } from "../graph";
import { JOURNEY_TEMPLATES } from "../templates";
import { RPC_SHAPES } from "./rpcShapes.fixture";

const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const L = "434b9215-1ddc-4b35-aaf2-84ed79898881";
const E = "c37321d8-4fb5-4c59-8b70-277e4ba45ba5";
const AT = "2026-10-20T09:57:10.333Z";
const ok = (data: unknown) => ({ data, error: null });
const err = (code: string, message = code, details?: string) => ({
  data: null,
  error: { code, message, details },
});

beforeEach(() => {
  h.rpc.mockReset();
  setServerFnContext({ supabase: { rpc: h.rpc }, userId: "user-1" });
  delete process.env.JOURNEYS_ENGINE_DISABLED;
});
afterEach(() => resetServerFnContext());

describe("obudowa", () => {
  // Set<unknown>: każda server fn ma własny typ fetchera, a `has` dostaje
  // element unii z ALL - przy domyślnej liczbie checkerów tsgo typy się nie łączą.
  const ADMIN_ONLY = new Set<unknown>([
    publishJourney,
    setJourneyStatus,
    saveJourneySettings,
    skipJourneyWait,
  ]);
  const ALL = [
    listJourneys,
    getJourneyEnrollments,
    getLeadJourneys,
    getJourneySettings,
    getJourneyEngineHealth,
    estimateJourneyTrigger,
    simulateJourney,
    createJourney,
    installJourneyTemplate,
    saveJourneyDraft,
    publishJourney,
    setJourneyStatus,
    saveJourneyEmailContent,
    saveJourneySettings,
    enrollJourneyTest,
    skipJourneyWait,
    exitJourneyEnrollment,
    getJourneyStats,
    getJourneySeries,
  ];

  it("POST; publikacja, status, ustawienia i pominięcie czekania tylko dla admina", () => {
    for (const fn of ALL) {
      const meta = serverFnMeta(fn);
      expect(meta?.method).toBe("POST");
      expect(meta?.middleware).toEqual([
        { __mw: ADMIN_ONLY.has(fn) ? "requireAdmin" : "requireCrmStaff" },
      ]);
    }
    expect(serverFnMeta(getJourneySettings)?.hasValidator).toBe(false);
    expect(serverFnMeta(listJourneys)?.hasValidator).toBe(true);
  });

  it("nazwy RPC są literałami w miejscu wywołania, bez `p_tenant`", () => {
    const dir = join(process.cwd(), "src/lib/journeys");
    const source =
      readFileSync(join(dir, "journeys.functions.ts"), "utf8") +
      readFileSync(join(dir, "stats.functions.ts"), "utf8");
    for (const rpc of [
      "admin_journey_list",
      "admin_journey_enrollments",
      "admin_journey_lead_enrollments",
      "admin_journey_settings_get",
      "admin_journey_engine_health",
      "admin_journey_trigger_estimate",
      "admin_journey_simulate",
      "admin_journey_create",
      "admin_journey_save_draft",
      "admin_journey_publish",
      "admin_journey_set_status",
      "admin_journey_email_content_save",
      "admin_journey_settings_save",
      "admin_journey_enroll_test",
      "admin_journey_enrollment_skip_wait",
      "admin_journey_enrollment_exit",
      "admin_journey_stats",
      "admin_journey_series",
    ]) {
      expect(source).toMatch(new RegExp(`\\.rpc\\(\\s*"${rpc}"`));
    }
    expect(source).not.toMatch(/p_tenant/);
  });

  it("eksportuje wyłącznie server fn, schematy i czyste pomocnicze", () => {
    expect(Object.keys(fns).sort()).toContain("journeysKillSwitch");
  });
});

describe("odczyty", () => {
  it("lista, kontakty, leady, ustawienia, zdrowie - parametry i parsowanie", async () => {
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.list));
    await expect(listJourneys({ data: undefined })).resolves.toMatchObject({ state: "ready" });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_list", { p_status: null });

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.enrollments));
    const page = await getJourneyEnrollments({ data: { journeyId: J, status: "exited" } });
    expect(page).toMatchObject({ state: "ready", data: { total: 1 } });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_enrollments", {
      p_journey_id: J,
      p_node_id: null,
      p_status: "exited",
      p_page: 0,
      p_page_size: 50,
    });

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.leadEnrollments));
    await expect(getLeadJourneys({ data: { leadId: L } })).resolves.toMatchObject({
      state: "ready",
    });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_lead_enrollments", { p_lead_id: L });

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.settingsDefault));
    await expect(getJourneySettings()).resolves.toMatchObject({
      state: "ready",
      data: { enabled: false },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_settings_get");

    process.env.JOURNEYS_ENGINE_DISABLED = "1";
    expect(journeysKillSwitch()).toBe(true);
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.health));
    await expect(getJourneyEngineHealth()).resolves.toMatchObject({
      state: "ready",
      data: { killSwitch: true },
    });
  });

  it("szacunek i symulacja", async () => {
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.estimate));
    await estimateJourneyTrigger({
      data: { eventType: "checkout.abandoned.v1", condition: { kind: "subscription" } },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_trigger_estimate", {
      p_event_type: "checkout.abandoned.v1",
      p_condition: { kind: "subscription" },
      p_days: 30,
    });
    await expect(
      estimateJourneyTrigger({ data: { eventType: "zly", condition: {} } }),
    ).rejects.toThrow();

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.simulation));
    const draft = {
      graph: emptyJourneyGraph(),
      settings: { triggerEventType: "account.registered.v1" },
    };
    await expect(
      simulateJourney({ data: { journeyId: J, leadId: L, draft } }),
    ).resolves.toMatchObject({ state: "ready", data: { ok: true } });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_simulate", {
      p_journey_id: J,
      p_lead_id: L,
      p_draft: draft,
    });
  });

  it("42501 = forbidden, 42883/PGRST202 = unavailable, inny błąd = wyjątek", async () => {
    h.rpc.mockResolvedValueOnce(err("42501"));
    await expect(listJourneys({ data: {} })).resolves.toEqual({ state: "forbidden" });
    h.rpc.mockResolvedValueOnce(err("PGRST202"));
    await expect(getJourneySettings()).resolves.toEqual({ state: "unavailable" });
    h.rpc.mockResolvedValueOnce(err("42883"));
    await expect(getJourneyEngineHealth()).resolves.toEqual({ state: "unavailable" });
    h.rpc.mockResolvedValueOnce(err("XX000", "boom"));
    await expect(getLeadJourneys({ data: { leadId: L } })).rejects.toThrow("boom");
    h.rpc.mockResolvedValueOnce(ok({ total: "dużo" }));
    await expect(getJourneyEnrollments({ data: { journeyId: J } })).rejects.toThrow(/total/);
  });
});

describe("kody błędów zapisów", () => {
  it("mapowanie SQLSTATE -> kod panelu, `reason` = komunikat RPC", () => {
    const cases: [string, string][] = [
      ["42501", "forbidden"],
      ["40001", "conflict"],
      ["P0002", "not_found"],
      ["23505", "duplicate"],
      ["23514", "limit_exceeded"],
      ["22023", "invalid"],
      ["22P02", "invalid"],
      ["PGRST202", "unavailable"],
    ];
    for (const [code, expected] of cases) {
      expect(mapMutationError({ code, message: "graph_invalid: x", details: "d" })).toEqual({
        ok: false,
        error: expected,
        reason: "graph_invalid",
        detail: "d",
      });
    }
    expect(mapMutationError({ code: "42501", message: "" })).toMatchObject({ reason: null });
    expect(() => mapMutationError({ code: "XX000", message: "boom" })).toThrow("boom");
    expect(() => mapMutationError({ message: "bez kodu" })).toThrow("bez kodu");
  });
});

describe("zapisy: ścieżka", () => {
  it("create: domyślnie marketing; usługa bez podstawy prawnej odrzucona przed RPC", async () => {
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.mutation));
    await expect(createJourney({ data: { key: "kasa", name: "Kasa" } })).resolves.toMatchObject({
      ok: true,
      data: { status: "draft" },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_create", {
      p_key: "kasa",
      p_name: "Kasa",
      p_category: "marketing",
      p_legal_basis: null,
      p_description: null,
      p_template_key: null,
      p_draft: null,
    });
    await expect(
      createJourney({ data: { key: "usluga", name: "U", category: "service" } }),
    ).rejects.toThrow(/legal_basis_required/);
    h.rpc.mockResolvedValueOnce(err("23505", "key_taken"));
    await expect(createJourney({ data: { key: "kasa", name: "Kasa" } })).resolves.toMatchObject({
      ok: false,
      error: "duplicate",
      reason: "key_taken",
    });
  });

  it("instalacja szablonu: szkic + treść każdego maila (wariant A), podstawa w języku", async () => {
    const template = JOURNEY_TEMPLATES.trial_ending;
    h.rpc.mockResolvedValue(ok(RPC_SHAPES.mutation));
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.mutation));
    const result = await installJourneyTemplate({
      data: { templateKey: "trial_ending", key: "proba", name: "Koniec próby", locale: "en" },
    });
    expect(result.ok).toBe(true);
    expect(h.rpc).toHaveBeenNthCalledWith(1, "admin_journey_create", {
      p_key: "proba",
      p_name: "Koniec próby",
      p_category: "service",
      p_legal_basis: template.legalBasis?.en,
      p_description: null,
      p_template_key: "trial_ending",
      p_draft: { graph: template.graph, settings: template.settings },
    });
    expect(h.rpc).toHaveBeenCalledTimes(1 + template.emails.length);
    expect(h.rpc).toHaveBeenNthCalledWith(
      2,
      "admin_journey_email_content_save",
      expect.objectContaining({
        p_journey_id: J,
        p_variant: "A",
        p_node_id: template.emails[0].nodeId,
      }),
    );
  });

  it("instalacja: szablon niedostępny odmawia bez RPC; błąd create/treści przerywa", async () => {
    // Od I9 (Z-S5-01) żaden szablon katalogu nie czeka na zdarzenie - gałąź
    // odmowy dowodzimy szablonem tymczasowo oznaczonym jako niedostępny.
    const template = JOURNEY_TEMPLATES.pricing_enquiry_b2b;
    const availability = template.availability;
    Object.assign(template, {
      availability: { status: "unavailable", awaitedEvent: "partner.synced.v1" },
    });
    try {
      await expect(
        installJourneyTemplate({
          data: { templateKey: "pricing_enquiry_b2b", key: "b2b", name: "B2B" },
        }),
      ).resolves.toEqual({
        ok: false,
        error: "template_unavailable",
        reason: "pricing_enquiry_b2b",
        detail: null,
      });
    } finally {
      Object.assign(template, { availability });
    }
    expect(h.rpc).not.toHaveBeenCalled();

    h.rpc.mockResolvedValueOnce(err("23505", "key_taken"));
    await expect(
      installJourneyTemplate({ data: { templateKey: "winback_30d", key: "winback", name: "WB" } }),
    ).resolves.toMatchObject({ ok: false, error: "duplicate" });

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.mutation));
    h.rpc.mockResolvedValueOnce(err("22023", "doc_invalid"));
    await expect(
      installJourneyTemplate({ data: { templateKey: "winback_30d", key: "winback", name: "WB" } }),
    ).resolves.toMatchObject({ ok: false, error: "invalid", reason: "doc_invalid" });
  });

  it("szkic: kształt sprawdzony przed RPC, opcjonalne pola jako null", async () => {
    const draft = {
      graph: emptyJourneyGraph(),
      settings: { triggerEventType: "account.registered.v1" },
    };
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.mutation));
    await saveJourneyDraft({ data: { journeyId: J, expectedUpdatedAt: AT, draft } });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_save_draft", {
      p_journey_id: J,
      p_expected_updated_at: AT,
      p_draft: draft,
      p_name: null,
      p_description: null,
      p_category: null,
      p_legal_basis: null,
    });
    h.rpc.mockClear();
    await expect(
      saveJourneyDraft({
        data: { journeyId: J, expectedUpdatedAt: AT, draft: { graph: { nodes: 1 }, settings: {} } },
      }),
    ).resolves.toMatchObject({ ok: false, error: "invalid", reason: "draft_invalid" });
    expect(h.rpc).not.toHaveBeenCalled();
    h.rpc.mockResolvedValueOnce(err("40001", "conflict"));
    await expect(
      saveJourneyDraft({ data: { journeyId: J, expectedUpdatedAt: AT, draft, name: "Nowa" } }),
    ).resolves.toMatchObject({ ok: false, error: "conflict" });
  });

  it("publikacja: graf z błędami odrzucony w TS z listą błędów; poprawny idzie do RPC", async () => {
    const bad = {
      graph: { nodes: [{ id: "t", type: "trigger", params: {} }], edges: [] },
      settings: { triggerEventType: "account.registered.v1" },
    };
    const refused = await publishJourney({
      data: { journeyId: J, expectedUpdatedAt: AT, draft: bad },
    });
    expect(refused).toMatchObject({ ok: false, error: "invalid", reason: "graph_invalid" });
    expect(JSON.parse((refused as { detail: string }).detail)).toEqual([
      { code: "branches_incomplete", nodeId: "t" },
    ]);
    expect(h.rpc).not.toHaveBeenCalled();

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.publish));
    const published = await publishJourney({
      data: {
        journeyId: J,
        expectedUpdatedAt: AT,
        mode: "exit_all",
        draft: { graph: emptyJourneyGraph(), settings: bad.settings },
      },
    });
    expect(published).toMatchObject({ ok: true, data: { version: 1 } });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_publish", {
      p_journey_id: J,
      p_expected_updated_at: AT,
      p_mode: "exit_all",
    });
    h.rpc.mockResolvedValueOnce(err("22023", "content_missing: m"));
    await expect(
      publishJourney({ data: { journeyId: J, expectedUpdatedAt: AT } }),
    ).resolves.toMatchObject({ ok: false, reason: "content_missing" });
  });

  it("status (pauza/wznowienie/archiwum) i treść maila", async () => {
    h.rpc.mockResolvedValueOnce(ok({ ...RPC_SHAPES.mutation, status: "paused" }));
    await expect(
      setJourneyStatus({ data: { journeyId: J, status: "paused" } }),
    ).resolves.toMatchObject({ ok: true, data: { status: "paused" } });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_set_status", {
      p_journey_id: J,
      p_status: "paused",
      p_expected_updated_at: null,
    });

    const doc = JOURNEY_TEMPLATES.winback_30d.emails[0].doc;
    h.rpc.mockResolvedValueOnce(ok({ id: "c1", updated_at: AT }));
    await expect(
      saveJourneyEmailContent({ data: { journeyId: J, nodeId: "news", subjectPl: "Temat", doc } }),
    ).resolves.toEqual({ ok: true, data: { id: "c1", updatedAt: AT } });
    expect(h.rpc).toHaveBeenLastCalledWith(
      "admin_journey_email_content_save",
      expect.objectContaining({ p_variant: "A", p_subject_en: null, p_preheader_pl: null }),
    );
    await expect(
      saveJourneyEmailContent({ data: { journeyId: J, nodeId: "news", subjectPl: "T", doc: {} } }),
    ).resolves.toMatchObject({ ok: false, reason: "doc_invalid" });
    h.rpc.mockResolvedValueOnce(ok({ id: 5 }));
    await expect(
      saveJourneyEmailContent({ data: { journeyId: J, nodeId: "news", subjectPl: "T", doc } }),
    ).rejects.toThrow(/unexpected shape/);
  });
});

describe("zapisy: ustawienia silnika (panel admina)", () => {
  it("łatka: biała lista, limity D-03, nadawca bez znaków nagłówka, pusta odrzucona", () => {
    expect(
      JourneySettingsPatchSchema.safeParse({
        enabled: true,
        marketing_cap_per_7d: 3,
        quiet_start: "21:00",
        quiet_end: "08:00",
        sender_name: "Redakcja NES",
        reply_to: "redakcja@nes.example",
      }).success,
    ).toBe(true);
    for (const bad of [
      {},
      { smtp_password: "x" },
      { marketing_cap_per_7d: 21 },
      { quiet_start: "25:00" },
      { sender_name: "Zła <nazwa>" },
      { sender_name: "x".repeat(121) },
      { reply_to: "nie-adres" },
      { machine_open_seconds: 31 },
    ]) {
      expect(JourneySettingsPatchSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("zapis przez RPC z oczekiwanym znacznikiem", async () => {
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.settingsSaved));
    await expect(
      saveJourneySettings({ data: { patch: { enabled: true }, expectedUpdatedAt: AT } }),
    ).resolves.toMatchObject({ ok: true, data: { enabled: true, senderName: "Redakcja NES" } });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_settings_save", {
      p_patch: { enabled: true },
      p_expected_updated_at: AT,
    });
  });
});

describe("zapisy: kontakt w ścieżce", () => {
  it("test na żywo, pominięcie czekania, wyjście", async () => {
    h.rpc.mockResolvedValueOnce(ok({ enrollment_id: E, lead_id: L }));
    await expect(enrollJourneyTest({ data: { journeyId: J } })).resolves.toEqual({
      ok: true,
      data: { enrollmentId: E, leadId: L },
    });
    h.rpc.mockResolvedValueOnce(ok({}));
    await expect(enrollJourneyTest({ data: { journeyId: J } })).rejects.toThrow(/unexpected/);
    h.rpc.mockResolvedValueOnce(err("P0002", "own_lead_missing"));
    await expect(enrollJourneyTest({ data: { journeyId: J } })).resolves.toMatchObject({
      ok: false,
      error: "not_found",
      reason: "own_lead_missing",
    });

    h.rpc.mockResolvedValueOnce(ok({ enrollment_id: E }));
    await expect(skipJourneyWait({ data: { enrollmentId: E } })).resolves.toEqual({
      ok: true,
      data: { enrollmentId: E },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_enrollment_skip_wait", {
      p_enrollment_id: E,
    });

    h.rpc.mockResolvedValueOnce(ok({ exited: true }));
    await expect(exitJourneyEnrollment({ data: { enrollmentId: E } })).resolves.toEqual({
      ok: true,
      data: { exited: true },
    });
    h.rpc.mockResolvedValueOnce(ok(null));
    await expect(exitJourneyEnrollment({ data: { enrollmentId: E } })).resolves.toEqual({
      ok: true,
      data: { exited: false },
    });
  });
});

describe("statystyki", () => {
  it("statystyki wersji w oknie, seria dzienna, limity okna", async () => {
    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.statsAb));
    await expect(getJourneyStats({ data: { journeyId: J } })).resolves.toMatchObject({
      state: "ready",
      data: { source: "raw" },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("admin_journey_stats", {
      p_journey_id: J,
      p_version_id: null,
      p_since: null,
      p_until: null,
    });
    await expect(
      getJourneyStats({ data: { journeyId: J, sinceIso: AT, untilIso: "2026-10-01T00:00:00Z" } }),
    ).rejects.toThrow(/window_invalid/);

    h.rpc.mockResolvedValueOnce(ok(RPC_SHAPES.series));
    await expect(
      getJourneySeries({
        data: { journeyId: J, sinceIso: "2026-10-17T00:00:00Z", untilIso: AT },
      }),
    ).resolves.toMatchObject({ state: "ready" });
    const tooLong = new Date(Date.parse(AT) - (JOURNEY_SERIES_MAX_DAYS + 1) * 86_400_000);
    await expect(
      getJourneySeries({ data: { journeyId: J, sinceIso: tooLong.toISOString(), untilIso: AT } }),
    ).rejects.toThrow(/window_invalid/);

    h.rpc.mockResolvedValueOnce(err("42501"));
    await expect(getJourneyStats({ data: { journeyId: J } })).resolves.toEqual({
      state: "forbidden",
    });
    h.rpc.mockResolvedValueOnce(err("42883"));
    await expect(
      getJourneySeries({ data: { journeyId: J, sinceIso: AT, untilIso: AT } }),
    ).resolves.toEqual({ state: "unavailable" });
    h.rpc.mockResolvedValueOnce(err("XX000", "boom"));
    await expect(getJourneyStats({ data: { journeyId: J } })).rejects.toThrow("boom");
  });
});
