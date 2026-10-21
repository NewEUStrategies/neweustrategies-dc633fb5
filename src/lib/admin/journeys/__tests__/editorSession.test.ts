// Sesja edytora ścieżki (S8.3a) - maszyna stanów, hook i słownik edytora.
//
// CO TEN PLIK DOWODZI.
//   1. Maszyna (czysta): pierwsze wczytanie, token znany = cisza, zapis
//      w locie = decyzja odłożona, obcy token przy czystym szkicu = przyjęcie,
//      przy brudnym = konflikt, chyba że serwer ma nasz stan (cicho) albo
//      przesunął się sam token (ponowienie); konflikt z zapisu czeka na OBCĄ
//      wersję; „zachowaj moje” / „weź serwera”; pamięć tokenów ma limit.
//   2. Hook na atrapie serwera z PRAWDZIWYM CAS (`expectedUpdatedAt` musi
//      równać się tokenowi serwera): autozapis z tokenem z detail, potem
//      z wyniku zapisu; refetch po szynie (`invalidateQueries(detail)`) po
//      własnym zapisie nie rusza szkicu ani historii; obcy zapis przy czystym
//      szkicu wczytuje się sam, przy brudnym - konflikt, autozapis stoi,
//      ochrona przed utratą działa; rozstrzygnięcia; ponowienie po samym
//      przesunięciu tokenu; cofnij/ponów z komunikatami; flush przed treścią
//      nowego maila; „wybierz wyzwalacz”, naprawa szkicu; tylko do odczytu
//      (archiwum, podgląd wersji, rola); walidacja lokalna i MFA bez zapisu.
//   3. Różnice konfliktu na liniach stabilnego JSON-u („−” serwer, „+” moje).
//   4. Słownik `i18n-admin-journeys-editor`: parytet, liczebniki, zero kolizji
//      ze słownikami S5/S8, każdy klucz ma czytelnika w kodzie produkcyjnym.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  saveDraft: vi.fn(),
  getDetail: vi.fn(),
  guard: vi.fn(),
  t: null as unknown,
}));

// Fabryka NIC nie importuje (import `@/test/i18nReal` w fabryce zakleszcza
// moduły - `@/lib/i18n` sam sięga po `react-i18next`); prawdziwy `t` wpinamy
// po importach, jeden obiekt na cały plik (stabilny jak w aplikacji).
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t, i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: (when: boolean) => h.guard(when),
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  saveJourneyDraft: (input: unknown) => h.saveDraft(input),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.getDetail(input),
}));

import {
  INITIAL_JOURNEY_SESSION,
  JOURNEY_AUTOSAVE_DELAY_MS,
  JOURNEY_SESSION_NOTICE_KEY,
  JOURNEY_VALUE_ISSUE_KEY,
  draftStateOf,
  journeyConflictDiff,
  journeyConflictLines,
  journeySessionMode,
  normalizeToken,
  reduceJourneySession,
  repairDraft,
  sameEditorValue,
  serverSnapshot,
  useJourneyEditorSession,
  validateEditorValue,
  type JourneyEditorValue,
  type JourneyServerSnapshot,
  type JourneySessionState,
  type UseJourneyEditorSessionOptions,
} from "../editorSession";
import type { JourneyDetailDto } from "../journeyEditor.functions";
import { emptyJourneyGraph, type JourneyDraft } from "@/lib/journeys/graph";
import { journeyKeys } from "@/lib/journeys/keys";
import { journeysEditorDictionaries } from "@/lib/i18n-admin-journeys-editor";
import { journeysDictionaries } from "@/lib/i18n-admin-journeys";
import { journeysListDictionaries } from "@/lib/i18n-admin-journeys-list";
import { journeysPublishDictionaries } from "@/lib/i18n-admin-journeys-publish";
import { journeysResultsDictionaries } from "@/lib/i18n-admin-journeys-results";
import { realT } from "@/test/i18nReal";

const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const J2 = "5547c447-8ae8-460b-ac5f-fe00b0e87fc5";
const TRIGGER = "account.registered.v1";
const t = realT("pl");
h.t = t;

/** Fikstury przez JSON - kopia bez wspólnych referencji (jak jsonb). */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

function baseDraft(): JourneyDraft {
  return { graph: emptyJourneyGraph(), settings: { triggerEventType: TRIGGER } };
}

/** Krok między wyzwalaczem a wyjściem (graf zgodny ze schematem). */
function withStep(draft: JourneyDraft, id: string, type: "wait" | "send_email"): JourneyDraft {
  const params = type === "wait" ? { mode: "duration", minutes: 60 } : {};
  const last = draft.graph.edges.find((edge) => edge.to === "exit");
  if (!last) throw new Error("test: graf bez krawędzi do wyjścia");
  return {
    ...draft,
    graph: {
      nodes: [...draft.graph.nodes, { id, type, params }],
      edges: [
        ...draft.graph.edges.filter((edge) => edge !== last),
        { from: last.from, to: id, branch: last.branch },
        { from: id, to: "exit", branch: "next" },
      ],
    },
  };
}

function value(draft: JourneyDraft = baseDraft(), name = "Powitanie"): JourneyEditorValue {
  return {
    draft,
    definition: { name, description: "", category: "marketing", legalBasis: "" },
  };
}

function snapshot(token: string, editorValue: JourneyEditorValue | null): JourneyServerSnapshot {
  return {
    token,
    definition: editorValue?.definition ?? value().definition,
    draft: editorValue?.draft ?? null,
    draftRaw: editorValue?.draft ?? null,
    draftState: editorValue ? "valid" : "needs_trigger",
    draftIssue: null,
    archived: false,
    value: editorValue,
  };
}

// ── Maszyna stanów ──────────────────────────────────────────────────────────

const T0 = "2026-10-21T10:00:00.000001+00:00";
const T1 = "2026-10-21T10:00:01.000001+00:00";
const T2 = "2026-10-21T10:00:02.000001+00:00";

function loaded(base: JourneyEditorValue = value()): JourneySessionState {
  return reduceJourneySession(INITIAL_JOURNEY_SESSION, {
    type: "server",
    snapshot: snapshot(T0, base),
    local: null,
    saving: false,
  }).state;
}

describe("reduceJourneySession - maszyna sesji", () => {
  it("pierwszy odczyt = wczytanie bazy i tokenu", () => {
    const { state, effect } = reduceJourneySession(INITIAL_JOURNEY_SESSION, {
      type: "server",
      snapshot: snapshot(T0, value()),
      local: null,
      saving: false,
    });
    expect(effect).toBe("load");
    expect(state.token).toBe(T0);
    expect(sameEditorValue(state.base, value())).toBe(true);
  });

  it("znany token (nasz zapis, także w innym zapisie strefy) = cisza; zapis w locie = odłożenie", () => {
    const saved = reduceJourneySession(loaded(), {
      type: "saved",
      token: T1,
      value: value(withStep(baseDraft(), "w1", "wait")),
    }).state;
    for (const token of [T1, "2026-10-21 10:00:01.000001+00", T0]) {
      expect(
        reduceJourneySession(saved, {
          type: "server",
          snapshot: snapshot(token, value()),
          local: value(),
          saving: false,
        }).effect,
        token,
      ).toBe("none");
    }
    expect(
      reduceJourneySession(saved, {
        type: "server",
        snapshot: snapshot(T2, value()),
        local: value(),
        saving: true,
      }).effect,
    ).toBe("defer");
  });

  it("obcy token przy czystym szkicu: przyjęcie wersji serwera (albo cisza, gdy treść ta sama)", () => {
    const foreign = value(baseDraft(), "Z innej karty");
    const adopted = reduceJourneySession(loaded(), {
      type: "server",
      snapshot: snapshot(T1, foreign),
      local: value(),
      saving: false,
    });
    expect(adopted.effect).toBe("adopt");
    expect(adopted.state.token).toBe(T1);
    expect(sameEditorValue(adopted.state.base, foreign)).toBe(true);

    const same = reduceJourneySession(loaded(), {
      type: "server",
      snapshot: snapshot(T1, value()),
      local: value(),
      saving: false,
    });
    expect(same.effect).toBe("none");
    expect(same.state.token).toBe(T1);
  });

  it("obcy token przy brudnym szkicu: konflikt, cisza (serwer = mój szkic) albo ponowienie (sam token)", () => {
    const mine = value(withStep(baseDraft(), "w1", "wait"));
    const conflict = reduceJourneySession(loaded(), {
      type: "server",
      snapshot: snapshot(T1, value(baseDraft(), "Z innej karty")),
      local: mine,
      saving: false,
    });
    expect(conflict.effect).toBe("conflict");
    expect(conflict.state.conflict?.server?.token).toBe(T1);
    expect(conflict.state.token).toBe(T0);

    const silent = reduceJourneySession(loaded(), {
      type: "server",
      snapshot: snapshot(T1, mine),
      local: mine,
      saving: false,
    });
    expect(silent.effect).toBe("none");
    expect(silent.state.conflict).toBeNull();

    const retry = reduceJourneySession(loaded(), {
      type: "server",
      snapshot: snapshot(T1, value()),
      local: mine,
      saving: false,
    });
    expect(retry.effect).toBe("retry");
    expect(retry.state.token).toBe(T1);
    expect(retry.state.conflict).toBeNull();
  });

  it("konflikt z zapisu: pobranie wersji serwera, znany token nie rozstrzyga, autorytatywny tak", () => {
    const mine = value(withStep(baseDraft(), "w1", "wait"));
    const pending = reduceJourneySession(loaded(), { type: "save_conflict", local: mine });
    expect(pending.effect).toBe("refetch");
    expect(pending.state.conflict).toEqual({ local: mine, server: null });
    expect(reduceJourneySession(pending.state, { type: "save_conflict", local: mine }).effect).toBe(
      "none",
    );

    const stale = {
      type: "server" as const,
      snapshot: snapshot(T0, value()),
      local: mine,
      saving: false,
    };
    expect(reduceJourneySession(pending.state, stale).effect).toBe("none");
    const forced = reduceJourneySession(pending.state, { ...stale, authoritative: true });
    expect(forced.effect).toBe("conflict");
    expect(forced.state.conflict?.server?.token).toBe(T0);

    const foreign = reduceJourneySession(pending.state, {
      ...stale,
      snapshot: snapshot(T1, value(baseDraft(), "Obca")),
    });
    expect(foreign.effect).toBe("conflict");
    expect(foreign.state.conflict?.server?.definition.name).toBe("Obca");
  });

  it("zachowaj moje = token serwera + zapis; weź serwera = baza serwera bez zapisu", () => {
    const mine = value(withStep(baseDraft(), "w1", "wait"));
    const theirs = value(baseDraft(), "Obca");
    const conflict = reduceJourneySession(loaded(), {
      type: "server",
      snapshot: snapshot(T1, theirs),
      local: mine,
      saving: false,
    }).state;

    const keep = reduceJourneySession(conflict, { type: "keep_mine" });
    expect(keep.effect).toBe("flush");
    expect(keep.state).toMatchObject({ token: T1, conflict: null });

    const take = reduceJourneySession(conflict, { type: "take_server" });
    expect(take.effect).toBe("load");
    expect(take.state.token).toBe(T1);
    expect(sameEditorValue(take.state.base, theirs)).toBe(true);

    expect(reduceJourneySession(loaded(), { type: "keep_mine" }).effect).toBe("none");
    expect(reduceJourneySession(loaded(), { type: "take_server" }).effect).toBe("none");
  });

  it("token z własnej publikacji jest znany; pamięć tokenów ma limit", () => {
    let state = reduceJourneySession(loaded(), { type: "adopt_token", token: T2 }).state;
    expect(state.token).toBe(T2);
    expect(
      reduceJourneySession(state, {
        type: "server",
        snapshot: snapshot(T2, value()),
        local: value(),
        saving: false,
      }).effect,
    ).toBe("none");
    for (let i = 0; i < 100; i += 1) {
      state = reduceJourneySession(state, {
        type: "saved",
        token: `2026-10-21T11:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(6, "0")}+00:00`,
        value: value(),
      }).state;
    }
    expect(state.known.length).toBe(32);
  });
});

describe("czyste pomocniki sesji", () => {
  it("normalizeToken: ta sama chwila w różnych zapisach, mikrosekundy rozróżniają", () => {
    const key = normalizeToken("2026-10-21T10:00:00.5+00:00");
    expect(normalizeToken("2026-10-21T10:00:00.500000Z")).toBe(key);
    expect(normalizeToken("2026-10-21 12:00:00.5+02")).toBe(key);
    expect(normalizeToken("2026-10-21T12:00:00.5+0200")).toBe(key);
    expect(normalizeToken("2026-10-21T10:00:00.500001+00:00")).not.toBe(key);
    expect(normalizeToken("nie-data")).toBe("nie-data");
  });

  it("sameEditorValue: kolejność kluczy i spacje na brzegach pól definicji nie są zmianą", () => {
    const a = value();
    const reordered = clone({
      definition: { legalBasis: "", category: "marketing", description: " ", name: "Powitanie " },
      draft: { settings: { triggerEventType: TRIGGER }, graph: emptyJourneyGraph() },
    }) as JourneyEditorValue;
    expect(sameEditorValue(a, reordered)).toBe(true);
    expect(sameEditorValue(a, value(baseDraft(), "Inna"))).toBe(false);
    expect(sameEditorValue(a, null)).toBe(false);
    expect(sameEditorValue(null, null)).toBe(true);
  });

  it("draftStateOf: pusty szkic z createJourney = wybierz wyzwalacz; z wyzwalaczem = naprawa", () => {
    expect(draftStateOf({ draftValid: true, draftRaw: baseDraft() })).toBe("valid");
    expect(
      draftStateOf({
        draftValid: false,
        draftRaw: { graph: { nodes: [], edges: [] }, settings: {} },
      }),
    ).toBe("needs_trigger");
    expect(draftStateOf({ draftValid: false, draftRaw: null })).toBe("needs_trigger");
    expect(
      draftStateOf({
        draftValid: false,
        draftRaw: { graph: { nodes: "x" }, settings: { triggerEventType: TRIGGER } },
      }),
    ).toBe("invalid");
  });

  it("repairDraft: wyzwalacz + ustawienia, które przechodzą schemat; zły albo pusty graf = pusty szkic", () => {
    expect(repairDraft({ graph: { nodes: [], edges: [] }, settings: {} }, TRIGGER)).toEqual({
      graph: emptyJourneyGraph(),
      settings: { triggerEventType: TRIGGER },
    });
    const kept = withStep(baseDraft(), "w1", "wait");
    expect(
      repairDraft({ graph: kept.graph, settings: { triggerEventType: "zły" } }, TRIGGER),
    ).toEqual({ graph: kept.graph, settings: { triggerEventType: TRIGGER } });
    expect(
      repairDraft({
        graph: { nodes: [{ id: "zły id!", type: "trigger", params: {} }], edges: [] },
        settings: {
          triggerEventType: TRIGGER,
          reentry: "czasem",
          exitEvents: [{ eventType: "crm_lead.created.v1" }],
          reentryCooldownDays: 9999,
        },
      }),
    ).toEqual({
      graph: emptyJourneyGraph(),
      settings: { triggerEventType: TRIGGER, exitEvents: [{ eventType: "crm_lead.created.v1" }] },
    });
    expect(repairDraft({ settings: {} })).toBeNull();
    expect(repairDraft({}, "bez-wersji")).toBeNull();
  });

  it("validateEditorValue: limity definicji, podstawa prawna usługi, kształt szkicu", () => {
    expect(validateEditorValue(value())).toBeNull();
    expect(validateEditorValue(value(baseDraft(), "   "))?.field).toBe("name");
    expect(validateEditorValue(value(baseDraft(), "x".repeat(161)))?.field).toBe("name");
    const service = value();
    service.definition = { ...service.definition, category: "service", legalBasis: " " };
    expect(validateEditorValue(service)?.field).toBe("legalBasisRequired");
    service.definition.legalBasis = "x".repeat(501);
    expect(validateEditorValue(service)?.field).toBe("legalBasis");
    const long = value();
    long.definition.description = "x".repeat(2001);
    expect(validateEditorValue(long)?.field).toBe("description");
    const broken = value({ ...baseDraft(), settings: { triggerEventType: "zły" } });
    expect(validateEditorValue(broken)).toEqual({
      field: "draft",
      path: "settings.triggerEventType",
    });
  });

  it("journeySessionMode: kolejność powodów tylko do odczytu, stany szkicu", () => {
    const snap = snapshot(T0, value());
    const mode = (overrides: Partial<Parameters<typeof journeySessionMode>[0]>) =>
      journeySessionMode({
        snapshot: snap,
        hasBase: true,
        canEdit: true,
        versionPreview: false,
        ...overrides,
      });
    expect(mode({ snapshot: null })).toEqual({ mode: "loading", readOnlyReason: null });
    expect(mode({})).toEqual({ mode: "edit", readOnlyReason: null });
    expect(mode({ canEdit: false, versionPreview: true })).toEqual({
      mode: "readonly",
      readOnlyReason: "role",
    });
    expect(
      mode({ versionPreview: true, snapshot: { ...snap, archived: true } }).readOnlyReason,
    ).toBe("version");
    expect(mode({ snapshot: { ...snap, archived: true } }).readOnlyReason).toBe("archived");
    expect(mode({ hasBase: false, snapshot: { ...snap, draftState: "needs_trigger" } }).mode).toBe(
      "needs_trigger",
    );
    expect(mode({ hasBase: false, snapshot: { ...snap, draftState: "invalid" } }).mode).toBe(
      "invalid",
    );
    expect(mode({ hasBase: false }).mode).toBe("loading");
  });

  it("różnice konfliktu: sekcje ze zmianami, linie stabilnego JSON-u, „−” serwer i „+” moje", () => {
    const mine = value(withStep(baseDraft(), "w1", "wait"));
    const theirs = snapshot(T1, value(baseDraft(), "Obca nazwa"));
    const sections = journeyConflictDiff(mine, theirs);
    expect(sections.map((section) => section.id)).toEqual(["definition", "nodes", "edges"]);
    const definition = sections[0].lines;
    expect(definition).toContainEqual({ kind: "removed", text: 'name: "Obca nazwa"' });
    expect(definition).toContainEqual({ kind: "added", text: 'name: "Powitanie"' });
    const nodes = sections[1].lines;
    expect(nodes.filter((line) => line.kind === "added")).toEqual([
      {
        kind: "added",
        text: '{"id":"w1","params":{"minutes":60,"mode":"duration"},"type":"wait"}',
      },
    ]);
    expect(nodes.filter((line) => line.kind === "same")).toHaveLength(2);
    expect(journeyConflictLines(mine.definition, null)).toMatchObject({
      settings: [],
      nodes: [],
      edges: [],
    });
    expect(journeyConflictDiff(mine, snapshot(T1, mine))).toEqual([]);
  });
});

// ── Hook na atrapie serwera z CAS ───────────────────────────────────────────

interface FakeServer {
  seq: number;
  token: string;
  draft: unknown;
  name: string;
  description: string | null;
  category: "marketing" | "service";
  legalBasis: string | null;
  status: "draft" | "active" | "paused" | "archived";
}

let server: FakeServer;

function tokenFor(seq: number) {
  return `2026-10-21T10:${String(Math.floor(seq / 60)).padStart(2, "0")}:${String(seq % 60).padStart(2, "0")}.123456+00:00`;
}

function resetServer(draft: unknown = baseDraft()) {
  server = {
    seq: 0,
    token: tokenFor(0),
    draft: clone(draft),
    name: "Powitanie",
    description: null,
    category: "marketing",
    legalBasis: null,
    status: "draft",
  };
}

/** Zapis z „innej karty” prosto w atrapie bazy (nowy token). */
function foreignSave(patch: Partial<Omit<FakeServer, "seq" | "token">>) {
  Object.assign(server, clone(patch));
  server.seq += 1;
  server.token = tokenFor(server.seq);
}

function wire(journeyId: string) {
  return {
    state: "ready" as const,
    data: {
      definition: {
        id: journeyId,
        key: "powitanie",
        name: server.name,
        description: server.description,
        status: server.status,
        category: server.category,
        legalBasis: server.legalBasis,
        templateKey: null,
        publishedVersionId: null,
        createdAt: tokenFor(0),
        updatedAt: server.token,
      },
      draftRaw: clone(server.draft),
      versions: [],
      contents: [],
      templateMatches: {},
    },
  };
}

interface SaveInput {
  data: {
    journeyId: string;
    expectedUpdatedAt: string;
    draft: unknown;
    name?: string;
    description?: string;
    category?: "marketing" | "service";
    legalBasis?: string;
  };
}

beforeEach(() => {
  resetServer();
  h.guard.mockReset();
  h.getDetail.mockReset();
  h.getDetail.mockImplementation(async (input: { data: { journeyId: string } }) =>
    wire(input.data.journeyId),
  );
  h.saveDraft.mockReset();
  h.saveDraft.mockImplementation(async ({ data }: SaveInput) => {
    if (data.expectedUpdatedAt !== server.token) {
      return { ok: false, error: "conflict", reason: "conflict", detail: null };
    }
    if (server.status === "archived") {
      return { ok: false, error: "invalid", reason: "journey_archived", detail: null };
    }
    server.draft = clone(data.draft);
    if (data.name !== undefined) server.name = data.name.trim();
    if (data.description !== undefined) server.description = data.description.trim() || null;
    if (data.category !== undefined) server.category = data.category;
    if (data.legalBasis !== undefined) server.legalBasis = data.legalBasis.trim() || null;
    server.seq += 1;
    server.token = tokenFor(server.seq);
    return {
      ok: true,
      data: { id: data.journeyId, updatedAt: server.token, status: server.status },
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

type HookProps = Partial<UseJourneyEditorSessionOptions>;

function renderSession(props: HookProps = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const view = renderHook(
    (initial: HookProps) =>
      useJourneyEditorSession({
        journeyId: J,
        enabled: true,
        capabilities: { canEdit: true },
        delayMs: 15,
        ...initial,
      }),
    { wrapper, initialProps: props },
  );
  /** Zdarzenie `journey.changed.v1` - szyna unieważnia szczegół w każdej karcie. */
  const bus = async (journeyId = J) => {
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: journeyKeys.detail(journeyId) });
    });
  };
  return { ...view, queryClient, bus };
}

async function ready(props: HookProps = {}) {
  const view = renderSession(props);
  await waitFor(() => expect(view.result.current.value).not.toBeNull());
  return view;
}

function savedPayloads() {
  return h.saveDraft.mock.calls.map(([input]) => (input as SaveInput).data);
}

const STEP = "Dodano krok: Czekaj";

describe("useJourneyEditorSession - autozapis z CAS", () => {
  it("wczytanie: szkic i definicja z detail, token CAS, czysto, tryb edycji", async () => {
    const { result } = await ready();
    expect(result.current.mode).toBe("edit");
    expect(result.current.editable).toBe(true);
    expect(result.current.token).toBe(tokenFor(0));
    expect(result.current.value).toEqual(value());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.notice).toBeNull();
    expect(h.guard).toHaveBeenLastCalledWith(false);
    expect(JOURNEY_AUTOSAVE_DELAY_MS).toBe(2_000);
  });

  it("zapis po bezczynności z tokenem z detail, następny z tokenem z wyniku; własny refetch nie rusza szkicu", async () => {
    const { result, bus } = await ready();
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    expect(result.current.isDirty).toBe(true);
    expect(h.guard).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(savedPayloads()[0]).toEqual({
      journeyId: J,
      expectedUpdatedAt: tokenFor(0),
      draft: withStep(baseDraft(), "w1", "wait"),
      name: "Powitanie",
      description: "",
      category: "marketing",
      legalBasis: "",
    });
    expect(result.current.token).toBe(tokenFor(1));
    expect(h.guard).toHaveBeenLastCalledWith(false);

    await bus();
    expect(result.current.conflict).toBeNull();
    expect(result.current.canUndo).toBe(true);
    expect(result.current.announcement?.text).toBe(STEP);

    act(() => {
      result.current.updateDefinition(
        { name: "Powitanie 2" },
        { label: "Nazwa", coalesceKey: "name" },
      );
    });
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(2));
    expect(savedPayloads()[1]).toMatchObject({
      expectedUpdatedAt: tokenFor(1),
      name: "Powitanie 2",
    });
    await waitFor(() => expect(result.current.token).toBe(tokenFor(2)));
    // Pisanie w polu nie ogłasza każdego znaku.
    expect(result.current.announcement?.text).toBe(STEP);
    expect(server.name).toBe("Powitanie 2");
  });

  it("obcy zapis przy czystym szkicu: wersja serwera wczytana, komunikat, historia od nowa, bez zapisu", async () => {
    const { result, bus } = await ready();
    foreignSave({ name: "Z innej karty", draft: withStep(baseDraft(), "m1", "send_email") });
    await bus();
    await waitFor(() => expect(result.current.value?.definition.name).toBe("Z innej karty"));
    expect(result.current.draft).toEqual(withStep(baseDraft(), "m1", "send_email"));
    expect(result.current.token).toBe(server.token);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.announcement?.text).toBe(
      t("adminJourneys.editor.session.announce.external"),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it("obcy zapis przy brudnym szkicu: konflikt, autozapis stoi, ochrona działa; „zachowaj moje” nadpisuje z tokenem serwera", async () => {
    const { result, bus } = await ready({ delayMs: 60_000 });
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    foreignSave({ name: "Z innej karty" });
    const foreignToken = server.token;
    await bus();
    await waitFor(() => expect(result.current.conflict?.server?.token).toBe(foreignToken));
    expect(result.current.editable).toBe(false);
    expect(result.current.notice?.code).toBe("conflict");
    expect(result.current.autosaveBar).toMatchObject({
      status: "error",
      error: t("adminJourneys.editor.autosave.conflict"),
    });
    expect(h.guard).toHaveBeenLastCalledWith(true);
    expect(await result.current.flush()).toBeNull();
    expect(h.saveDraft).not.toHaveBeenCalled();

    let kept = false;
    await act(async () => {
      kept = await result.current.keepMine();
    });
    expect(kept).toBe(true);
    expect(savedPayloads()).toHaveLength(1);
    expect(savedPayloads()[0]).toMatchObject({
      expectedUpdatedAt: foreignToken,
      name: "Powitanie",
    });
    expect(server.draft).toEqual(withStep(baseDraft(), "w1", "wait"));
    expect(server.name).toBe("Powitanie");
    expect(result.current.conflict).toBeNull();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.announcement?.text).toBe(
      t("adminJourneys.editor.session.announce.keptMine"),
    );
  });

  it("konflikt zgłoszony przez zapis: pobranie wersji serwera i różnice; „weź serwera” bez zapisu", async () => {
    const { result } = await ready();
    foreignSave({ name: "Obca", draft: withStep(baseDraft(), "m1", "send_email") });
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    await waitFor(() => expect(result.current.conflict?.server?.token).toBe(server.token));
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
    const sections = journeyConflictDiff(
      result.current.conflict!.local,
      result.current.conflict!.server!,
    );
    expect(sections.map((section) => section.id)).toEqual(["definition", "nodes", "edges"]);

    act(() => result.current.takeServer());
    expect(result.current.conflict).toBeNull();
    expect(result.current.value?.definition.name).toBe("Obca");
    expect(result.current.draft).toEqual(withStep(baseDraft(), "m1", "send_email"));
    expect(result.current.isDirty).toBe(false);
    expect(result.current.announcement?.text).toBe(
      t("adminJourneys.editor.session.announce.tookServer"),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("przesunięty sam token (publikacja/pauza w innej karcie) przy brudnym szkicu: ponowienie bez dialogu", async () => {
    const { result, bus } = await ready({ delayMs: 60_000 });
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    foreignSave({ status: "active" });
    const moved = server.token;
    await bus();
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(1));
    expect(savedPayloads()[0].expectedUpdatedAt).toBe(moved);
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(result.current.conflict).toBeNull();
  });

  it("token z własnej publikacji (adoptToken): następny zapis z nim, refetch bez przyjmowania", async () => {
    const { result, bus } = await ready();
    foreignSave({ status: "active" });
    act(() => result.current.adoptToken(server.token));
    await bus();
    expect(result.current.announcement).toBeNull();
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    await waitFor(() => expect(result.current.isDirty).toBe(false));
    expect(savedPayloads()[0].expectedUpdatedAt).toBe(tokenFor(1));
  });
});

describe("useJourneyEditorSession - historia, flush i stany szkicu", () => {
  it("cofnij/ponów z etykietą operacji w komunikacie aria-live", async () => {
    const { result } = await ready({ delayMs: 60_000 });
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.draft).toEqual(baseDraft());
    expect(result.current.announcement?.text).toBe(`Cofnięto: ${STEP}`);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.draft).toEqual(withStep(baseDraft(), "w1", "wait"));
    expect(result.current.announcement?.text).toBe(`Ponowiono: ${STEP}`);
    // Operacja bez zmiany treści nie trafia do historii.
    expect(result.current.updateDraft((draft) => draft, { label: "nic" })).toBe(false);

    act(() => result.current.autosaveBar.onDiscard?.());
    expect(result.current.draft).toEqual(baseDraft());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.announcement?.text).toBe(
      t("adminJourneys.editor.session.announce.discarded"),
    );
  });

  it("ensureNodeSaved: nowy krok maila trafia do zapisanego szkicu przed treścią (node_not_email)", async () => {
    const { result } = await ready({ delayMs: 60_000 });
    act(() => {
      result.current.updateDraft((draft) => withStep(draft, "m1", "send_email"), {
        label: "Dodano krok: Wyślij e-mail",
      });
    });
    let saved = false;
    await act(async () => {
      saved = await result.current.ensureNodeSaved("m1");
    });
    expect(saved).toBe(true);
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
    expect(server.draft).toEqual(withStep(baseDraft(), "m1", "send_email"));
    await act(async () => {
      saved = await result.current.ensureNodeSaved("m1");
    });
    expect(saved).toBe(true);
    await act(async () => {
      saved = await result.current.ensureNodeSaved("trigger");
    });
    expect(saved).toBe(false);
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
    expect(await result.current.flush()).toBe(server.token);
  });

  it("wybierz wyzwalacz: pusty szkic z createJourney zapisuje się od razu z wyzwalaczem", async () => {
    resetServer({ graph: { nodes: [], edges: [] }, settings: {} });
    const { result } = renderSession();
    await waitFor(() => expect(result.current.mode).toBe("needs_trigger"));
    expect(result.current.value).toBeNull();
    expect(result.current.notice).toEqual({
      code: "needs_trigger",
      text: t(JOURNEY_SESSION_NOTICE_KEY.needs_trigger),
    });
    let outcome: Awaited<ReturnType<typeof result.current.chooseTrigger>> | null = null;
    await act(async () => {
      outcome = await result.current.chooseTrigger("checkout.abandoned.v1");
    });
    expect(outcome).toEqual({ ok: true });
    expect(savedPayloads()[0]).toEqual({
      journeyId: J,
      expectedUpdatedAt: tokenFor(0),
      draft: {
        graph: emptyJourneyGraph(),
        settings: { triggerEventType: "checkout.abandoned.v1" },
      },
    });
    await waitFor(() => expect(result.current.mode).toBe("edit"));
    expect(result.current.isDirty).toBe(false);
    expect(result.current.announcement?.text).toBe(
      t("adminJourneys.editor.session.announce.triggerChosen"),
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("szkic spoza schematu: stan naprawy z polem, naprawa zachowuje to, co da się odczytać", async () => {
    resetServer({
      graph: { nodes: [{ id: "zły id!", type: "trigger", params: {} }], edges: [] },
      settings: { triggerEventType: TRIGGER, reentry: "czasem" },
    });
    const { result } = renderSession();
    await waitFor(() => expect(result.current.mode).toBe("invalid"));
    expect(result.current.notice?.code).toBe("draft_invalid");
    expect(result.current.notice?.text).toContain("graph.nodes.0.id");
    await act(async () => {
      await result.current.repairDraft();
    });
    expect(savedPayloads()[0].draft).toEqual(baseDraft());
    await waitFor(() => expect(result.current.mode).toBe("edit"));
    expect(result.current.announcement?.text).toBe(
      t("adminJourneys.editor.session.announce.repaired"),
    );
  });

  it("tylko do odczytu: archiwum, podgląd wersji i rola bez edycji - zmiany i zapis zablokowane", async () => {
    server.status = "archived";
    const archived = await ready();
    expect(archived.result.current).toMatchObject({
      mode: "readonly",
      readOnlyReason: "archived",
      editable: false,
    });
    expect(archived.result.current.notice?.text).toBe(t(JOURNEY_SESSION_NOTICE_KEY.archived));
    expect(
      archived.result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), {
        label: STEP,
      }),
    ).toBe(false);
    expect(await archived.result.current.flush()).toBeNull();
    archived.unmount();

    server.status = "draft";
    const preview = await ready({ versionPreview: true });
    expect(preview.result.current.readOnlyReason).toBe("version");
    expect(preview.result.current.autosaveBar.canUndo).toBe(false);
    expect(preview.result.current.updateDefinition({ name: "X" }, { label: "Nazwa" })).toBe(false);
    preview.rerender({ versionPreview: false });
    expect(preview.result.current.editable).toBe(true);
    preview.unmount();

    const role = await ready({ capabilities: { canEdit: false } });
    expect(role.result.current.readOnlyReason).toBe("role");
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it("walidacja lokalna i MFA: bez zapisu (albo odrzucony), szkic brudny, zdanie zamiast surowego błędu", async () => {
    const { result } = await ready();
    act(() => {
      result.current.updateDefinition({ name: "   " }, { label: "Nazwa", coalesceKey: "name" });
    });
    await waitFor(() => expect(result.current.autosaveBar.status).toBe("error"));
    expect(result.current.autosaveBar.error).toBe(t(JOURNEY_VALUE_ISSUE_KEY.name, { max: 160 }));
    expect(h.saveDraft).not.toHaveBeenCalled();
    expect(result.current.isDirty).toBe(true);

    h.saveDraft.mockRejectedValueOnce(new Error("Forbidden: mfa_required (aal2)"));
    act(() => {
      result.current.updateDefinition(
        { name: "Powitanie MFA" },
        { label: "Nazwa", coalesceKey: "name" },
      );
    });
    await waitFor(() =>
      expect(result.current.autosaveBar.error).toBe(t("adminJourneys.editor.autosave.mfa")),
    );
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
    expect(result.current.isDirty).toBe(true);
  });

  it("inna ścieżka bez odmontowania: sesja od zera, bez zapisu poprzedniego szkicu", async () => {
    const view = await ready({ delayMs: 60_000 });
    act(() => {
      view.result.current.updateDraft((draft) => withStep(draft, "w1", "wait"), { label: STEP });
    });
    view.rerender({ journeyId: J2, delayMs: 60_000 });
    await waitFor(() => expect(view.result.current.draft).toEqual(baseDraft()));
    expect(view.result.current.isDirty).toBe(false);
    expect(view.result.current.canUndo).toBe(false);
    expect(h.saveDraft).not.toHaveBeenCalled();
  });
});

// ── Słownik edytora ─────────────────────────────────────────────────────────

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, child]) =>
    typeof child === "string" ? [`${prefix}${key}`] : leaves(child, `${prefix}${key}.`),
  );
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : productionSources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [readFileSync(path, "utf8")] : [];
  });
}

describe("słownik `i18n-admin-journeys-editor`", () => {
  const plTree = journeysEditorDictionaries.pl as unknown as Tree;
  const enTree = journeysEditorDictionaries.en as unknown as Tree;
  const plKeys = leaves(plTree);

  it("parytet PL/EN: te same klucze, EN niepusty i różny od PL", () => {
    expect(leaves(enTree)).toEqual(plKeys);
    const at = (tree: Tree, key: string) =>
      key.split(".").reduce<unknown>((node, part) => (node as Tree)[part], tree);
    for (const key of plKeys) {
      const en = at(enTree, key);
      expect(typeof en === "string" && en.trim() !== "", key).toBe(true);
      expect(en, key).not.toBe(at(plTree, key));
    }
  });

  it("liczebniki: każda grupa ma formy _one/_few/_many/_other", () => {
    const bases = new Set(plKeys.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
    expect(bases.size).toBeGreaterThan(0);
    for (const base of bases) {
      for (const form of ["one", "few", "many", "other"]) {
        expect(plKeys, base).toContain(`${base}_${form}`);
      }
    }
  });

  it("jedna gałąź `adminJourneys.editor`, zero kolizji ze słownikami S5 i S8", () => {
    expect(new Set(plKeys.map((key) => key.split(".").slice(0, 2).join(".")))).toEqual(
      new Set(["adminJourneys.editor"]),
    );
    const others = [
      journeysDictionaries.pl,
      journeysListDictionaries.pl,
      journeysPublishDictionaries.pl,
      journeysResultsDictionaries.pl,
    ].flatMap((tree) => leaves(tree as unknown as Tree));
    const otherBranches = new Set(others.map((key) => key.split(".").slice(0, 2).join(".")));
    expect(otherBranches.has("adminJourneys.editor")).toBe(false);
    expect(plKeys.filter((key) => others.includes(key))).toEqual([]);
  });

  it("każdy klucz ma czytelnika w kodzie produkcyjnym edytora", () => {
    const sources = [
      ...productionSources("src/lib/admin/journeys"),
      ...productionSources("src/components/admin/journeys/editor"),
    ].join("\n");
    const unread = plKeys
      .map((key) => key.replace(PLURAL, ""))
      .filter((key, index, all) => all.indexOf(key) === index)
      .filter((key) => !sources.includes(`"${key}"`));
    expect(unread).toEqual([]);
  });

  it("klucze stanów i walidacji sesji mają zdania w obu językach", () => {
    for (const lang of ["pl", "en"] as const) {
      const tl = realT(lang);
      for (const key of [
        ...Object.values(JOURNEY_SESSION_NOTICE_KEY),
        ...Object.values(JOURNEY_VALUE_ISSUE_KEY),
      ]) {
        expect(tl(key, { max: 1, path: "x" }), `${lang}:${key}`).not.toBe(key);
      }
    }
  });
});

/** Szczegół z atrapy w kształcie DTO (dla `serverSnapshot`). */
describe("serverSnapshot", () => {
  it("token, definicja w polach formularza, stan szkicu i archiwum", () => {
    const dto: JourneyDetailDto = {
      definition: {
        id: J,
        key: "powitanie",
        name: "Powitanie",
        description: null,
        status: "archived",
        category: "service",
        legalBasis: "art. 6 ust. 1 lit. b RODO",
        templateKey: null,
        publishedVersionId: null,
        createdAt: T0,
        updatedAt: T1,
      },
      draft: null,
      draftValid: false,
      draftRaw: { graph: { nodes: [], edges: [] }, settings: {} },
      draftIssue: "settings.triggerEventType",
      versions: [],
      contents: [],
      templateMatches: {},
    };
    expect(serverSnapshot(dto)).toMatchObject({
      token: T1,
      definition: {
        name: "Powitanie",
        description: "",
        category: "service",
        legalBasis: "art. 6 ust. 1 lit. b RODO",
      },
      draftState: "needs_trigger",
      archived: true,
      value: null,
    });
  });
});
