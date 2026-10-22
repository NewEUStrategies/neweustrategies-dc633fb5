// Server fn edytora ścieżek (S8): szczegół, wersja i katalog galerii.
//
// CO TEN PLIK DOWODZI.
//   1. Obudowa: POST, `requireCrmStaff`, walidator; najemca NIGDY nie
//      przychodzi w parametrach ani w filtrach (zawęża go RLS po sesji).
//   2. Literały tabel i jawne kolumny (bramka `ts-sql-contract`), szkic treści
//      `version_id IS NULL`, wersje malejąco.
//   3. Stany: 42501 -> forbidden, brak relacji/kolumny/PGRST2xx -> unavailable,
//      brak wiersza -> not_found, reszta - wyjątek.
//   4. „Treść = szablon” liczona na SERWERZE stabilnym porównaniem (kolejność
//      pól, puste = NULL i normalizacja dokumentu nie zmieniają wyniku; jedna
//      zmieniona litera - zmienia).
//   5. Drut -> DTO: szkic parsowany łagodnie (pusty szkic z `createJourney` =
//      `draftValid: false` z wskazaniem pola), wersja z ustawieniami z kolumn.
//   6. Katalog: 14 szablonów BEZ dokumentów maili; moduł szablonów z treścią
//      jest importowany wyłącznie dynamicznie (nie trafia do klienta).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerFnContext, serverFnMeta, setServerFnContext } from "@/test/serverFn";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));

import {
  JOURNEY_DETAIL_COLUMNS,
  contentFingerprint,
  getJourneyDetail,
  getJourneyVersion,
  listJourneyTemplateCatalog,
  templateMatchesOf,
  toJourneyDetail,
  toJourneyVersion,
  type JourneyDetailRead,
  type JourneyDetailWire,
  type JourneyTemplateCatalogEntry,
  type JourneyVersionWire,
} from "../journeyEditor.functions";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import { JOURNEY_TEMPLATE_KEYS } from "@/lib/journeys/templates/types";
import { parseEmailDoc } from "@/lib/newsletter/emailDoc";

const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const V = "5547c447-8ae8-460b-ac5f-fe00b0e87fc5";
const AT = "2026-10-20T09:57:10.333703+00:00";
const welcome = JOURNEY_TEMPLATES.welcome_onboarding;

function definitionRow(patch: Record<string, unknown> = {}) {
  return {
    id: J,
    key: "powitanie",
    name: "Powitanie",
    description: null,
    status: "draft",
    category: "marketing",
    legal_basis: null,
    template_key: "welcome_onboarding",
    draft: { graph: welcome.graph, settings: welcome.settings },
    published_version_id: null,
    created_at: AT,
    updated_at: AT,
    ...patch,
  };
}

/** Treści szkicu tak, jak zapisała je instalacja szablonu (jsonb: inna kolejność pól). */
function contentRows() {
  return welcome.emails.map((email) => ({
    node_id: email.nodeId,
    variant: "A",
    subject_pl: email.subject.pl,
    subject_en: email.subject.en,
    preheader_pl: email.preheader.pl,
    preheader_en: email.preheader.en,
    // Odwrócona kolejność kluczy dokumentu - jsonb nie zachowuje kolejności.
    doc: Object.fromEntries(Object.entries(structuredClone(email.doc)).reverse()),
    updated_at: AT,
  }));
}

let stub: SupabaseFromStub;

beforeEach(() => {
  stub = supabaseFromStub();
  setServerFnContext({ supabase: { from: stub.from }, userId: "user-1" });
});
afterEach(() => resetServerFnContext());

function ready<T>(read: JourneyDetailRead<T>): T {
  if (read.state !== "ready") throw new Error(`stan ${read.state}`);
  return read.data;
}

describe("obudowa", () => {
  it.each([
    ["getJourneyDetail", getJourneyDetail, true],
    ["getJourneyVersion", getJourneyVersion, true],
    ["listJourneyTemplateCatalog", listJourneyTemplateCatalog, false],
  ] as const)("%s: POST + requireCrmStaff", (_name, fn, hasValidator) => {
    expect(serverFnMeta(fn)).toEqual({
      method: "POST",
      middleware: [{ __mw: "requireCrmStaff" }],
      hasValidator,
    });
  });

  it("walidator odrzuca zły identyfikator i nie przenosi najemcy", async () => {
    await expect(getJourneyDetail({ data: { journeyId: "nie-uuid" } })).rejects.toThrow();
    stub.setResponse("journey_definitions", ok(null));
    await getJourneyDetail({ data: { journeyId: J, tenantId: "obcy" } as never });
    for (const chain of stub.chains) {
      expect(JSON.stringify(chain.calls)).not.toMatch(/tenant/);
    }
  });

  it("moduł szablonów z treścią tylko dynamicznie - bez statycznego importu", () => {
    const source = readFileSync("src/lib/admin/journeys/journeyEditor.functions.ts", "utf8");
    expect(source).not.toMatch(/from "@\/lib\/journeys\/templates"/);
    expect(source).not.toMatch(/from "@\/lib\/journeys\/render\.server"/);
    expect(source).toMatch(/await import\("@\/lib\/journeys\/templates"\)/);
    for (const table of ["journey_definitions", "journey_versions", "journey_email_contents"]) {
      expect(source).toContain(`.from("${table}")`);
    }
    expect(source).not.toMatch(/select\(\s*["']\*/);
  });
});

describe("getJourneyDetail", () => {
  function plan(patch: Record<string, unknown> = {}, contents = contentRows()) {
    stub.setResponse("journey_definitions", ok(definitionRow(patch)));
    stub.setResponse(
      "journey_versions",
      ok([
        {
          id: V,
          version: 2,
          published_at: AT,
          published_by: null,
          trigger_event_type: "account.registered.v1",
          graph_checksum: "abc",
        },
      ]),
    );
    stub.setResponse("journey_email_contents", ok(contents));
  }

  it("literały tabel, jawne kolumny, szkic treści, wersje malejąco", async () => {
    plan();
    await getJourneyDetail({ data: { journeyId: J } });
    const definition = stub.lastChain("journey_definitions");
    expect(definition?.argsOf("select")).toEqual([JOURNEY_DETAIL_COLUMNS.definition]);
    expect(definition?.argsOf("eq")).toEqual(["id", J]);
    expect(definition?.has("maybeSingle")).toBe(true);
    const versions = stub.lastChain("journey_versions");
    expect(versions?.argsOf("select")).toEqual([JOURNEY_DETAIL_COLUMNS.versionSummary]);
    expect(versions?.argsOf("eq")).toEqual(["journey_id", J]);
    expect(versions?.argsOf("order")).toEqual(["version", { ascending: false }]);
    const contents = stub.lastChain("journey_email_contents");
    expect(contents?.argsOf("select")).toEqual([JOURNEY_DETAIL_COLUMNS.content]);
    expect(contents?.argsOf("is")).toEqual(["version_id", null]);
    expect(contents?.argsOf("eq")).toEqual(["journey_id", J]);
  });

  it("mapuje wiersz i liczy „treść = szablon” na serwerze", async () => {
    const rows = contentRows();
    rows[1] = { ...rows[1], subject_pl: `${rows[1].subject_pl}!` };
    plan({}, rows);
    const wire = ready(await getJourneyDetail({ data: { journeyId: J } }));
    expect(wire.definition).toEqual({
      id: J,
      key: "powitanie",
      name: "Powitanie",
      description: null,
      status: "draft",
      category: "marketing",
      legalBasis: null,
      templateKey: "welcome_onboarding",
      publishedVersionId: null,
      createdAt: AT,
      updatedAt: AT,
    });
    expect(wire.templateMatches).toEqual({ welcome: true, value: false, invite: true });
    expect(wire.contents.map((c) => [c.nodeId, c.matchesTemplate])).toEqual([
      ["welcome", true],
      ["value", false],
      ["invite", true],
    ]);
    expect(wire.versions).toEqual([
      {
        id: V,
        version: 2,
        publishedAt: AT,
        publishedBy: null,
        triggerEventType: "account.registered.v1",
        graphChecksum: "abc",
      },
    ]);
    const dto = ready(toJourneyDetail({ state: "ready", data: wire }));
    expect(dto.draftValid).toBe(true);
    expect(dto.draft?.settings.triggerEventType).toBe("account.registered.v1");
    expect(dto.draftIssue).toBeNull();
  });

  it("ścieżka bez szablonu: brak flag, brak dynamicznego importu treści", async () => {
    plan({ template_key: null });
    const wire = ready(await getJourneyDetail({ data: { journeyId: J } }));
    expect(wire.templateMatches).toEqual({});
    expect(wire.contents.every((c) => c.matchesTemplate === false)).toBe(true);
  });

  it("brak wiersza -> not_found, bez dalszych zapytań", async () => {
    stub.setResponse("journey_definitions", ok(null));
    expect(await getJourneyDetail({ data: { journeyId: J } })).toEqual({ state: "not_found" });
    expect(stub.chainsFor("journey_versions")).toHaveLength(0);
  });

  it.each([
    ["42501", "forbidden"],
    ["42P01", "unavailable"],
    ["42703", "unavailable"],
    ["PGRST205", "unavailable"],
  ])("kod %s -> %s", async (code, state) => {
    stub.setResponse("journey_definitions", fail("odmowa", code));
    expect(await getJourneyDetail({ data: { journeyId: J } })).toEqual({ state });
  });

  it("odmowa na tabeli wersji też jest stanem", async () => {
    plan();
    stub.setResponse("journey_versions", fail("permission denied", "42501"));
    expect(await getJourneyDetail({ data: { journeyId: J } })).toEqual({ state: "forbidden" });
  });

  it("inny błąd bazy jest głośny", async () => {
    stub.setResponse("journey_definitions", fail("boom", "XX000"));
    await expect(getJourneyDetail({ data: { journeyId: J } })).rejects.toThrow("boom");
  });

  it("zły kształt wiersza (nieznany status) - wyjątek, nie cichy zły stan", async () => {
    plan({ status: "deleted" });
    await expect(getJourneyDetail({ data: { journeyId: J } })).rejects.toThrow(/status/);
  });
});

describe("toJourneyDetail - szkic łagodnie", () => {
  function wire(draftRaw: unknown): JourneyDetailRead<JourneyDetailWire> {
    return {
      state: "ready",
      data: {
        definition: {
          id: J,
          key: "k",
          name: "N",
          description: null,
          status: "draft",
          category: "marketing",
          legalBasis: null,
          templateKey: null,
          publishedVersionId: null,
          createdAt: AT,
          updatedAt: AT,
        },
        draftRaw: draftRaw as never,
        versions: [],
        contents: [],
        templateMatches: {},
      },
    };
  }

  it("pusty szkic z utworzenia: draftValid false z polem, surowe dane zostają", () => {
    const raw = { graph: { nodes: [], edges: [] }, settings: {} };
    const dto = ready(toJourneyDetail(wire(raw)));
    expect(dto.draftValid).toBe(false);
    expect(dto.draft).toBeNull();
    expect(dto.draftIssue).toBe("settings.triggerEventType");
    expect(dto.draftRaw).toEqual(raw);
  });

  it("stany inne niż ready przechodzą bez zmian", () => {
    for (const state of ["forbidden", "unavailable", "not_found"] as const) {
      expect(toJourneyDetail({ state })).toEqual({ state });
    }
  });
});

describe("getJourneyVersion", () => {
  it("wersja i jej treści; kolumny -> ustawienia szkicu", async () => {
    const template = JOURNEY_TEMPLATES.abandoned_checkout;
    stub.setResponse(
      "journey_versions",
      ok({
        id: V,
        version: 3,
        published_at: AT,
        published_by: "f0f0f0f0-0000-4000-8000-000000000000",
        trigger_event_type: template.settings.triggerEventType,
        trigger_condition: template.settings.triggerCondition,
        entry_filter: [],
        reentry: "cooldown",
        reentry_cooldown_days: 14,
        goal: template.settings.goal,
        exit_events: [],
        graph: template.graph,
        graph_checksum: "md5",
      }),
    );
    stub.setResponse("journey_email_contents", ok(contentRows()));
    const read = await getJourneyVersion({ data: { journeyId: J, versionId: V } });
    const chain = stub.lastChain("journey_versions");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", V],
      ["journey_id", J],
    ]);
    expect(
      stub
        .lastChain("journey_email_contents")
        ?.calls.filter((c) => c.method === "eq")
        .map((c) => c.args),
    ).toEqual([
      ["journey_id", J],
      ["version_id", V],
    ]);
    const dto = ready(toJourneyVersion(read as JourneyDetailRead<JourneyVersionWire>));
    expect(dto.version.version).toBe(3);
    expect(dto.graphValid).toBe(true);
    expect(dto.graph?.nodes).toHaveLength(template.graph.nodes.length);
    expect(dto.settings).toEqual({
      triggerEventType: template.settings.triggerEventType,
      triggerCondition: template.settings.triggerCondition,
      entryFilter: [],
      reentry: "cooldown",
      reentryCooldownDays: 14,
      goal: template.settings.goal,
      exitEvents: [],
    });
    expect(dto.contents).toHaveLength(welcome.emails.length);
  });

  it("brak wersji -> not_found", async () => {
    stub.setResponse("journey_versions", ok(null));
    expect(await getJourneyVersion({ data: { journeyId: J, versionId: V } })).toEqual({
      state: "not_found",
    });
  });
});

describe("katalog galerii", () => {
  it("14 szablonów w kolejności katalogu, bez dokumentów maili", async () => {
    const catalog: JourneyTemplateCatalogEntry[] = await listJourneyTemplateCatalog();
    expect(catalog.map((entry) => entry.key)).toEqual([...JOURNEY_TEMPLATE_KEYS]);
    const json = JSON.stringify(catalog);
    expect(json).not.toContain('"doc"');
    expect(json).not.toContain('"blocks"');
    for (const entry of catalog) {
      const template = JOURNEY_TEMPLATES[entry.key];
      expect(entry.emailCount).toBe(template.emails.length);
      expect(entry.emails.map((e) => e.nodeId)).toEqual(template.emails.map((e) => e.nodeId));
      expect(entry.hasLegalBasis).toBe(template.category === "service");
      expect(entry.graph).toEqual(template.graph);
      expect(entry.graph).not.toBe(template.graph);
    }
    // I9 (Z-S5-01): B2B nie czeka już na zdarzenie formularza.
    expect(catalog.find((e) => e.key === "pricing_enquiry_b2b")?.availability).toEqual({
      status: "available",
    });
  });
});

describe("odcisk treści", () => {
  const base = {
    subjectPl: "Temat",
    subjectEn: "Subject",
    preheaderPl: "",
    preheaderEn: null,
    doc: welcome.emails[0].doc,
  };

  it("pusty napis = NULL, kolejność pól i normalizacja dokumentu bez znaczenia", () => {
    const reordered = {
      ...base,
      preheaderPl: null,
      preheaderEn: "  ",
      doc: Object.fromEntries(Object.entries(base.doc).reverse()),
    };
    expect(contentFingerprint(reordered, parseEmailDoc)).toBe(
      contentFingerprint(base, parseEmailDoc),
    );
    expect(contentFingerprint({ ...base, subjectPl: "Temat." }, parseEmailDoc)).not.toBe(
      contentFingerprint(base, parseEmailDoc),
    );
  });

  it("brak szablonu albo brak treści węzła", () => {
    expect(templateMatchesOf(null, [], parseEmailDoc)).toEqual({});
    expect(templateMatchesOf(welcome, [], parseEmailDoc)).toEqual({
      welcome: false,
      value: false,
      invite: false,
    });
  });
});
