// Panel kroku ścieżki (S8.3c) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Formularz dla KAŻDEGO z 14 typów węzłów S5 (parametry domyślne palety
//      przechodzą `NODE_PARAMS_SCHEMAS`, więc żaden formularz nie startuje
//      z błędem), tytuł „Krok N: typ” z numeracji kanwy.
//   2. Limity jak walidator TS/SQL, odrzucenie zamiast przycięcia: czas
//      czekania 5 min-365 dni, termin zdarzenia ≤ 30 dni, wagi A/B 0-100
//      (suma zawsze 100), tytuł zadania ≤ 200, tag ≤ 64, klucz listy wg wzorca,
//      powiadomienie co najmniej jednej osoby.
//   3. Każda przyjęta zmiana = NOWY węzeł przez `onChangeNode` z etykietą
//      historii i kluczem łączenia (krok + pole).
//   4. Warunki `if_else` wskazują tylko maile-przodków (walidacja przodka).
//   5. Zakładki Ustawienia | Wyniki | Kontakty sterowane adresem; Wyniki
//      i Kontakty to komponenty S8.2.
//   6. Tylko do odczytu: rola bez `canEdit` i zablokowana sesja; szkic spoza
//      schematu - „Przywróć ustawienia domyślne”. axe bez naruszeń.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  settings: vi.fn(),
  saveEmail: vi.fn(),
}));

// Fabryka niczego nie importuje (import `@/lib/i18n` z wnętrza fabryki
// `react-i18next` zakleszcza moduły) - prawdziwe `t` wpinamy po importach.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.("pl"), i18n: { language: "pl" }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));
vi.mock("@/lib/journeys/journeys.functions", () => ({
  getJourneySettings: () => h.settings(),
  saveJourneyEmailContent: (input: unknown) => h.saveEmail(input),
}));
// Strażnik niezapisanych zmian wymaga routera - tu wystarczy, że jest wołany.
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({ useUnsavedChangesGuard: () => {} }));
vi.mock("@/lib/newsletter-campaigns.functions", () => ({
  searchCampaignPosts: {},
  resolveCampaignDocPosts: {},
}));
vi.mock("@/components/admin/media/MediaPickerDialog", () => ({
  MediaPickerDialog: () => null,
}));
vi.mock("@/lib/crm/leadMutations", async () => {
  const { crmKeys } = await import("@/lib/crm/keys");
  return {
    crmStaffUsersQueryOptions: () => ({
      queryKey: crmKeys.staffUsers(),
      queryFn: async () => [
        { id: "aaaaaaaa-0000-4000-8000-0000000000aa", label: "Anna Kowalska" },
        { id: "bbbbbbbb-0000-4000-8000-0000000000bb", label: "Jan Nowak" },
      ],
    }),
  };
});
// Wyniki i Kontakty mają własne testy (S8.2) - tu tylko, że panel je montuje.
vi.mock("@/components/admin/journeys/results/JourneyNodeResults", () => ({
  JourneyNodeResults: (props: { nodeId: string; period?: string }) => (
    <p data-testid="node-results-stub">{`${props.nodeId}:${props.period ?? ""}`}</p>
  ),
}));
vi.mock("@/components/admin/journeys/results/JourneyEnrollmentsTable", () => ({
  JourneyEnrollmentsTable: (props: { nodeId?: string | null }) => (
    <p data-testid="enrollments-stub">{props.nodeId ?? ""}</p>
  ),
}));

import {
  JourneyStepSheet,
  replaceJourneyNode,
  type JourneyStepSheetProps,
} from "../JourneyStepSheet";
import type { JourneyCapabilities } from "@/lib/admin/journeys/access";
import { defaultParams, waitUntilEventParams } from "@/lib/admin/journeys/ops";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import {
  JourneyDraftSchema,
  NODE_PARAMS_SCHEMAS,
  type JourneyDraft,
  type JourneyNode,
} from "@/lib/journeys/graph";
import { journeyLabelKey } from "@/lib/journeys/labels";
import { JOURNEY_NODE_TYPES, type JourneyNodeType } from "@/lib/journeys/nodeTypes";
import { parseJourneySettings } from "@/lib/journeys/parse";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-crm-lifecycle";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";
import "@/lib/i18n-admin-journeys-steps";

h.fixedT = realT;
const t = realT("pl");
const T = "11111111-1111-4111-8111-111111111111";
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const ANNA = "aaaaaaaa-0000-4000-8000-0000000000aa";

/** Fikstury `as const` przez JSON - kopia bez wspólnych referencji. */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const ready = <D,>(data: D) => ({ state: "ready" as const, data });

const ADMIN: JourneyCapabilities = {
  canEdit: true,
  canPublish: true,
  canManageEngine: true,
  canSkipWait: true,
  canTest: true,
};
const VIEWER: JourneyCapabilities = {
  canEdit: false,
  canPublish: false,
  canManageEngine: false,
  canSkipWait: false,
  canTest: false,
};

const node = (id: string, type: JourneyNodeType, params: unknown = defaultParams(type)) => ({
  id,
  type,
  params,
});

/**
 * Szkic z każdym z 14 typów (poprawny wg walidatora S5): czekanie trzech
 * rodzajów, mail przed testem A/B, warunek na otwarciu tego maila, wszystkie
 * akcje CRM i oba zakończenia.
 */
const DRAFT = JourneyDraftSchema.parse({
  graph: {
    nodes: [
      node("t", "trigger"),
      node("w1", "wait", { mode: "duration", minutes: 1440 }),
      node("m1", "send_email"),
      node("ab", "ab_split"),
      node("ie", "if_else", {
        match: "all",
        predicates: [{ kind: "email_opened", nodeId: "m1" }],
      }),
      node("lc", "set_lifecycle_stage"),
      node("cs", "set_crm_stage"),
      node("tk", "create_crm_task"),
      node("at", "add_tag"),
      node("rt", "remove_tag"),
      node("nl", "newsletter_list"),
      node("ns", "notify_staff"),
      node("g", "goal", { label: "Zakup" }),
      node("wt", "wait", { mode: "until_time", weekdays: [1, 2, 3, 4, 5], time: "09:00" }),
      node("x1", "exit"),
      node("we", "wait", waitUntilEventParams()),
      node("x2", "exit"),
      node("m2", "send_email"),
      node("x3", "exit"),
    ],
    edges: [
      { from: "t", to: "w1", branch: "next" },
      { from: "w1", to: "m1", branch: "next" },
      { from: "m1", to: "ab", branch: "next" },
      { from: "ab", to: "ie", branch: "A" },
      { from: "ab", to: "we", branch: "B" },
      { from: "ie", to: "lc", branch: "yes" },
      { from: "lc", to: "cs", branch: "next" },
      { from: "cs", to: "tk", branch: "next" },
      { from: "tk", to: "at", branch: "next" },
      { from: "at", to: "rt", branch: "next" },
      { from: "rt", to: "nl", branch: "next" },
      { from: "nl", to: "ns", branch: "next" },
      { from: "ns", to: "g", branch: "next" },
      { from: "ie", to: "wt", branch: "no" },
      { from: "wt", to: "x1", branch: "next" },
      { from: "we", to: "x2", branch: "event" },
      { from: "we", to: "m2", branch: "timeout" },
      { from: "m2", to: "x3", branch: "next" },
    ],
  },
  settings: { triggerEventType: "checkout.abandoned.v1" },
});
const NUMBERING = buildJourneyView(DRAFT.graph).numbering;

/** Pierwszy węzeł danego typu - formularz każdego typu z jednego szkicu. */
function firstOf(type: JourneyNodeType): JourneyNode {
  const found = DRAFT.graph.nodes.find((candidate) => candidate.type === type);
  if (!found) throw new Error(`test: brak węzła ${type}`);
  return found;
}

beforeEach(() => {
  h.settings
    .mockReset()
    .mockResolvedValue(ready(parseJourneySettings(clone(RPC_SHAPES.settingsSaved))));
  h.saveEmail.mockReset();
});
afterEach(cleanup);

/**
 * Panel jak w edytorze: szkic trzyma „sesja” (stan), a `onChangeNode` podmienia
 * węzeł (`replaceJourneyNode`) - wartości wracają do pól jak po `updateDraft`.
 */
function mount(
  nodeId: string,
  overrides: Partial<JourneyStepSheetProps> & { initial?: JourneyDraft } = {},
) {
  const onChangeNode = vi.fn<JourneyStepSheetProps["onChangeNode"]>();
  const onTabChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [draft, setDraft] = useState<JourneyDraft>(overrides.initial ?? DRAFT);
    return (
      <JourneyStepSheet
        open
        onOpenChange={() => {}}
        journeyId={J}
        tenantId={T}
        draft={draft}
        nodeId={nodeId}
        tab="settings"
        onTabChange={onTabChange}
        capabilities={ADMIN}
        editable
        contents={[]}
        ensureNodeSaved={async () => true}
        onChangeNode={(next, options) => {
          onChangeNode(next, options);
          setDraft((current) => replaceJourneyNode(current, next));
        }}
        {...overrides}
      />
    );
  }
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { ...utils, onChangeNode, onTabChange };
}

const lastParams = (spy: ReturnType<typeof mount>["onChangeNode"]) =>
  spy.mock.calls.at(-1)?.[0].params;

/** Etykieta, po której rozpoznajemy formularz typu. */
const FORM_LABEL: Record<JourneyNodeType, string> = {
  trigger: "adminJourneys.stepSheet.triggerEffect",
  wait: "adminJourneys.stepSheet.wait.mode",
  send_email: "adminJourneys.emailStep.subjectPl",
  ab_split: "adminJourneys.stepSheet.ab.weightA",
  if_else: "adminJourneys.stepSheet.ifElse.match",
  set_lifecycle_stage: "adminJourneys.stepSheet.lifecycle.stage",
  set_crm_stage: "adminJourneys.stepSheet.crmStage.stage",
  create_crm_task: "adminJourneys.stepSheet.task.title",
  add_tag: "adminJourneys.stepSheet.tag.label",
  remove_tag: "adminJourneys.stepSheet.tag.label",
  newsletter_list: "adminJourneys.stepSheet.newsletter.listKey",
  notify_staff: "adminJourneys.stepSheet.notify.recipients",
  goal: "adminJourneys.stepSheet.goal.label",
  exit: "adminJourneys.common.effect.exit",
};

describe("JourneyStepSheet - formularze 14 typów", () => {
  it("szkic testu zawiera każdy typ S5, a parametry domyślne przechodzą schemat", () => {
    const types = new Set(DRAFT.graph.nodes.map((candidate) => candidate.type));
    expect([...types].sort()).toEqual([...JOURNEY_NODE_TYPES].sort());
    for (const candidate of DRAFT.graph.nodes) {
      expect(NODE_PARAMS_SCHEMAS[candidate.type].safeParse(candidate.params).success).toBe(true);
    }
  });

  it.each([...JOURNEY_NODE_TYPES])("%s: tytuł z numerem kroku i formularz typu", (type) => {
    const target = firstOf(type);
    mount(target.id);
    const sheet = screen.getByTestId("journey-step-sheet");
    expect(sheet.getAttribute("data-node-id")).toBe(target.id);
    expect(
      within(sheet).getByText(
        t("adminJourneys.stepSheet.title", {
          number: NUMBERING.get(target.id),
          type: t(journeyLabelKey("nodeType", type)),
        }),
      ),
    ).toBeTruthy();
    const settings = screen.getByTestId("journey-step-settings");
    expect(settings.getAttribute("data-node-type")).toBe(type);
    expect(within(settings).getAllByText(t(FORM_LABEL[type])).length).toBeGreaterThan(0);
    expect(within(settings).queryByText(t("adminJourneys.stepSheet.paramsInvalid"))).toBeNull();
  });

  it("brak węzła w szkicu (usunięty, cofnięty) - komunikat zamiast formularza", () => {
    mount("nie_ma");
    expect(screen.getByText(t("adminJourneys.stepSheet.missing"))).toBeTruthy();
    expect(screen.queryByTestId("journey-step-settings")).toBeNull();
  });
});

describe("czekanie", () => {
  it("czas: 3 dni = 4320 min z etykietą historii; 0 i ponad 365 dni odrzucone bez zapisu", () => {
    const { onChangeNode } = mount("w1");
    const amount = screen.getByLabelText(t("adminJourneys.stepSheet.wait.duration"));
    fireEvent.change(amount, { target: { value: "3" } });
    expect(lastParams(onChangeNode)).toEqual({ mode: "duration", minutes: 4320 });
    expect(onChangeNode.mock.calls.at(-1)?.[1]).toEqual({
      label: t("adminJourneys.stepSheet.history", { number: NUMBERING.get("w1") }),
      coalesceKey: "step:w1:minutes",
    });

    onChangeNode.mockClear();
    fireEvent.change(amount, { target: { value: "0" } });
    fireEvent.change(amount, { target: { value: "366" } });
    expect(onChangeNode).not.toHaveBeenCalled();
    expect((amount as HTMLInputElement).value).toBe("366");
    expect(amount.getAttribute("aria-invalid")).toBe("true");

    // Ta sama liczba w godzinach mieści się w limicie - zmiana jednostki ją przyjmuje.
    fireEvent.change(
      screen.getByLabelText(
        t("adminJourneys.stepSheet.wait.unit", {
          field: t("adminJourneys.stepSheet.wait.duration"),
        }),
      ),
      { target: { value: "hours" } },
    );
    expect(lastParams(onChangeNode)).toEqual({ mode: "duration", minutes: 366 * 60 });
  });

  it("do godziny: TimeInput HH:MM, dni ISO; odznaczenie ostatniego dnia odrzucone", async () => {
    const { onChangeNode } = mount("wt", {
      initial: replaceJourneyNode(DRAFT, {
        id: "wt",
        type: "wait",
        params: { mode: "until_time", weekdays: [3], time: "09:00" },
      }),
    });
    const time = screen.getByLabelText(t("adminJourneys.stepSheet.wait.time")) as HTMLInputElement;
    expect(time.type).toBe("time");
    fireEvent.change(time, { target: { value: "07:30" } });
    expect(lastParams(onChangeNode)).toEqual({ mode: "until_time", weekdays: [3], time: "07:30" });

    fireEvent.click(screen.getByLabelText(t("adminJourneys.stepSheet.weekday.1")));
    expect(lastParams(onChangeNode)).toEqual({
      mode: "until_time",
      weekdays: [1, 3],
      time: "07:30",
    });

    onChangeNode.mockClear();
    fireEvent.click(screen.getByLabelText(t("adminJourneys.stepSheet.weekday.1")));
    fireEvent.click(screen.getByLabelText(t("adminJourneys.stepSheet.weekday.3")));
    expect(lastParams(onChangeNode)).toEqual({ mode: "until_time", weekdays: [3], time: "07:30" });
    expect(screen.getByText(t("adminJourneys.sheetField.error.pickOne"))).toBeTruthy();
    // Strefa z ustawień silnika (RPC), nie z przeglądarki.
    expect(
      await screen.findByText(
        t("adminJourneys.stepSheet.wait.timeZone", { timezone: "Europe/Warsaw" }),
      ),
    ).toBeTruthy();
  });

  it("na zdarzenie: rodzaj bez zmiany liczby gałęzi, termin najwyżej 30 dni", () => {
    const { onChangeNode } = mount("we");
    const mode = screen.getByLabelText(t("adminJourneys.stepSheet.wait.mode")) as HTMLSelectElement;
    const disabled = [...mode.options].filter((option) => option.disabled).map((o) => o.value);
    expect(disabled.sort()).toEqual(["duration", "until_time"]);

    const timeout = screen.getByLabelText(t("adminJourneys.stepSheet.wait.timeout"));
    fireEvent.change(timeout, { target: { value: "31" } });
    expect(onChangeNode).not.toHaveBeenCalled();
    fireEvent.change(timeout, { target: { value: "30" } });
    expect(lastParams(onChangeNode)).toMatchObject({ mode: "until_event", timeoutMinutes: 43200 });
  });
});

describe("logika", () => {
  it("A/B: wagi zawsze sumują się do 100, ponad 100 odrzucone; cel bez celu ścieżki ostrzega", () => {
    const { onChangeNode } = mount("ab");
    fireEvent.change(screen.getByLabelText(t("adminJourneys.stepSheet.ab.weightA")), {
      target: { value: "70" },
    });
    expect(lastParams(onChangeNode)).toEqual({
      weights: { A: 70, B: 30 },
      winnerMetric: "click",
    });
    expect(
      (screen.getByLabelText(t("adminJourneys.stepSheet.ab.weightB")) as HTMLInputElement).value,
    ).toBe("30");

    onChangeNode.mockClear();
    fireEvent.change(screen.getByLabelText(t("adminJourneys.stepSheet.ab.weightB")), {
      target: { value: "101" },
    });
    expect(onChangeNode).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(t("adminJourneys.stepSheet.ab.metric")), {
      target: { value: "goal" },
    });
    expect(lastParams(onChangeNode)).toEqual({ weights: { A: 70, B: 30 }, winnerMetric: "goal" });
    expect(screen.getByText(t("adminJourneys.stepSheet.ab.goalMissing"))).toBeTruthy();
  });

  it("warunek: otwarcie wskazuje wyłącznie maile-przodków kroku", () => {
    mount("ie");
    const select = screen.getByLabelText(
      t("adminJourneys.predicateRow.email"),
    ) as HTMLSelectElement;
    const values = [...select.options].map((option) => option.value);
    // `m2` jest za testem A/B na innej gałęzi - nie jest przodkiem warunku.
    expect(values).toEqual(["m1"]);
    expect(
      within(select).getByText(
        t("adminJourneys.predicateRow.emailOptionNoSubject", { number: NUMBERING.get("m1") }),
      ),
    ).toBeTruthy();
  });
});

describe("akcje CRM", () => {
  it("etap cyklu życia bez etapów klienta (nadaje je wyłącznie płatność)", () => {
    mount("lc");
    const select = screen.getByLabelText(
      t("adminJourneys.stepSheet.lifecycle.stage"),
    ) as HTMLSelectElement;
    const values = [...select.options].map((option) => option.value);
    expect(values).not.toContain("customer");
    expect(values).not.toContain("former_customer");
    expect(values).toContain("mql");
  });

  it("zadanie: tytuł ponad 200 znaków odrzucony, osoba z zespołu po wyborze", async () => {
    const { onChangeNode } = mount("tk");
    const title = screen.getByLabelText(t("adminJourneys.stepSheet.task.title"));
    fireEvent.change(title, { target: { value: "x".repeat(201) } });
    expect(onChangeNode).not.toHaveBeenCalled();
    expect(
      screen.getByText(t("adminJourneys.common.counter", { count: 201, max: 200 })),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText(t("adminJourneys.stepSheet.task.assignee")), {
      target: { value: "user" },
    });
    // „Wybrana osoba” bez osoby nie przejdzie schematu - czeka lokalnie.
    expect(onChangeNode).not.toHaveBeenCalled();
    const person = screen.getByLabelText(t("adminJourneys.stepSheet.task.user"));
    await screen.findByRole("option", { name: "Anna Kowalska" });
    fireEvent.change(person, { target: { value: ANNA } });
    expect(lastParams(onChangeNode)).toMatchObject({ assignee: { mode: "user", userId: ANNA } });
  });

  it("tag: 64 znaki przyjęte, 65 odrzucone (limit tagu CRM)", () => {
    const { onChangeNode } = mount("at");
    const tag = screen.getByLabelText(t("adminJourneys.stepSheet.tag.label"));
    fireEvent.change(tag, { target: { value: "a".repeat(65) } });
    expect(onChangeNode).not.toHaveBeenCalled();
    fireEvent.change(tag, { target: { value: "a".repeat(64) } });
    expect(lastParams(onChangeNode)).toEqual({ tag: "a".repeat(64) });
  });

  it("lista newslettera: klucz spoza wzorca odrzucony z komunikatem", () => {
    const { onChangeNode } = mount("nl");
    fireEvent.change(screen.getByLabelText(t("adminJourneys.stepSheet.newsletter.listKey")), {
      target: { value: "lista główna" },
    });
    expect(onChangeNode).not.toHaveBeenCalled();
    expect(screen.getByText(t("adminJourneys.sheetField.error.listKey"))).toBeTruthy();
  });

  it("powiadomienie wybranych osób wymaga co najmniej jednej osoby", async () => {
    const { onChangeNode } = mount("ns");
    fireEvent.change(screen.getByLabelText(t("adminJourneys.stepSheet.notify.recipients")), {
      target: { value: "users" },
    });
    expect(onChangeNode).not.toHaveBeenCalled();
    expect(
      screen.getByText(t("adminJourneys.sheetField.error.listCount", { min: 1, max: 20 })),
    ).toBeTruthy();
    fireEvent.click(await screen.findByLabelText("Anna Kowalska"));
    expect(lastParams(onChangeNode)).toMatchObject({ recipients: { userIds: [ANNA] } });
  });
});

describe("zakładki, odczyt i naprawa", () => {
  it("Wyniki i Kontakty montują komponenty S8.2 z krokiem i oknem statystyk", () => {
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient()}>
        <JourneyStepSheet
          open
          onOpenChange={() => {}}
          journeyId={J}
          tenantId={T}
          draft={DRAFT}
          nodeId="m1"
          tab="results"
          onTabChange={() => {}}
          capabilities={ADMIN}
          editable
          contents={[]}
          ensureNodeSaved={async () => true}
          onChangeNode={() => {}}
          statsPeriod="quarter"
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("node-results-stub").textContent).toBe("m1:quarter");
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <JourneyStepSheet
          open
          onOpenChange={() => {}}
          journeyId={J}
          tenantId={T}
          draft={DRAFT}
          nodeId="m1"
          tab="contacts"
          onTabChange={() => {}}
          capabilities={ADMIN}
          editable
          contents={[]}
          ensureNodeSaved={async () => true}
          onChangeNode={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("enrollments-stub").textContent).toBe("m1");
    expect(screen.getByTestId("journey-step-sheet").getAttribute("data-tab")).toBe("contacts");
  });

  it("wybór zakładki idzie do adresu (`onTabChange`)", () => {
    const { onTabChange } = mount("w1");
    fireEvent.mouseDown(
      screen.getByRole("tab", { name: t("adminJourneys.stepSheet.tabs.results") }),
    );
    expect(onTabChange).toHaveBeenCalledWith("results");
  });

  it("rola bez edycji: pola wyłączone, komunikat o roli, brak zmian", () => {
    const { onChangeNode } = mount("at", { capabilities: VIEWER });
    const tag = screen.getByLabelText(t("adminJourneys.stepSheet.tag.label")) as HTMLInputElement;
    expect(tag.disabled).toBe(true);
    expect(screen.getByText(t("adminJourneys.stepSheet.roleReadOnly"))).toBeTruthy();
    expect(onChangeNode).not.toHaveBeenCalled();
  });

  it("sesja zablokowana (konflikt, wersja, archiwum): komunikat tylko do odczytu", () => {
    mount("w1", { editable: false });
    expect(screen.getByText(t("adminJourneys.stepSheet.readOnly"))).toBeTruthy();
    expect(
      (screen.getByLabelText(t("adminJourneys.stepSheet.wait.duration")) as HTMLInputElement)
        .disabled,
    ).toBe(true);
  });

  it("parametry spoza schematu: zamiast formularza przycisk przywrócenia domyślnych", () => {
    const broken = clone(DRAFT) as JourneyDraft;
    broken.graph.nodes = broken.graph.nodes.map((candidate) =>
      candidate.id === "at" ? { ...candidate, params: { tag: "" } } : candidate,
    );
    const { onChangeNode } = mount("at", { initial: broken });
    expect(screen.getByText(t("adminJourneys.stepSheet.paramsInvalid"))).toBeTruthy();
    expect(screen.getByText(t(journeyLabelKey("graphIssue", "params_invalid")))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.stepSheet.repair") }));
    expect(lastParams(onChangeNode)).toEqual(defaultParams("add_tag"));
  });

  it("wyzwalacz: zdanie startu i przejście do arkusza wyzwalacza", () => {
    const onOpenTrigger = vi.fn();
    mount("t", { onOpenTrigger });
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.stepSheet.openTrigger") }));
    expect(onOpenTrigger).toHaveBeenCalled();
  });
});

describe("dostępność", () => {
  it.each(["w1", "tk", "ie", "ns"])("axe bez naruszeń: krok %s", async (nodeId) => {
    mount(nodeId);
    // Arkusz to dialog Radix w portalu - axe na samym dialogu (strażnicy fokusu
    // Radixa poza dialogiem to szczegół biblioteki, nie treść panelu).
    const violations = await axeViolations(screen.getByRole("dialog"));
    expect(violations, summarize(violations)).toEqual([]);
  });
});
