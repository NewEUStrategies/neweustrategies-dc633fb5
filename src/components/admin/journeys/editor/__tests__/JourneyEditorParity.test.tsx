// Parytet edytora ścieżki (S8.3d, SPEC §6.3 „A11y”, R-36) - złożony edytor,
// nie pojedynczy widok.
//
// CO TEN PLIK DOWODZI.
//   1. Menu kroku w kanwie (`⋯` i Shift+F10) i na liście (`⋯` i Shift+F10)
//      to te same pozycje w tej samej kolejności - `availableOps` szkicu
//      sesji; przełączenie widoku paskiem nie zmienia ani grafu, ani menu.
//   2. „Lista = te same węzły i kolejność co kanwa”: kolejność elementów
//      fokusu kanwy i `treeitem` listy = `focusItems(buildJourneyView(graf))`;
//      jeden tab stop w każdym widoku, a fokus przechodzi między widokami.
//   3. Operacja z kanwy trafia do szkicu sesji (lista ją widzi), ogłoszenie
//      „Wykonano: …” pada raz (sesja nie powtarza komunikatu widoku), a Ctrl/Cmd+Z
//      i Ctrl/Cmd+Shift+Z działają z paska edytora (poza kanwą) z komunikatem
//      „Cofnięto: …” / „Ponowiono: …” w tym samym regionie `aria-live`.
//   4. Atrybuty wycieczki (`data-tour`), axe bez naruszeń w obu widokach.
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
  getDetail: vi.fn(),
  saveDraft: vi.fn(),
  guard: vi.fn(),
}));

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
vi.mock("@/hooks/useUnsavedChangesGuard", () => ({
  useUnsavedChangesGuard: (when: boolean) => h.guard(when),
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.getDetail(input),
}));
vi.mock("@/lib/journeys/journeys.functions", async () => {
  const { RPC_SHAPES } = await import("@/lib/journeys/__tests__/rpcShapes.fixture");
  const { parseEngineHealth, parseJourneyList, parseJourneySettings } =
    await import("@/lib/journeys/parse");
  const copy = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
  return {
    saveJourneyDraft: (input: unknown) => h.saveDraft(input),
    getJourneySettings: () =>
      Promise.resolve({
        state: "ready",
        data: parseJourneySettings(copy(RPC_SHAPES.settingsSaved)),
      }),
    getJourneyEngineHealth: () =>
      Promise.resolve({
        state: "ready",
        data: parseEngineHealth(copy(RPC_SHAPES.health), false),
      }),
    listJourneys: () =>
      Promise.resolve({ state: "ready", data: parseJourneyList(copy(RPC_SHAPES.list)) }),
  };
});
vi.mock("@/lib/admin/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/workflows")>()),
  fetchWorkflowDefinitions: () => Promise.resolve([]),
}));

import { JourneyEditor, type JourneyEditorProps } from "../JourneyEditor";
import { journeyOpLabel, journeyOpsContext } from "../JourneyInsertButton";
import { journeyCapabilities } from "@/lib/admin/journeys/access";
import { focusItems, focusKey } from "@/lib/admin/journeys/nav";
import { availableOps } from "@/lib/admin/journeys/ops";
import { buildJourneyView } from "@/lib/admin/journeys/viewModel";
import type { JourneyEditorSearch } from "@/lib/journeys/editorSearch";
import type { JourneyGraph } from "@/lib/journeys/graph";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const T = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-21T10:00:00.123456+00:00";
const TRIGGER = "checkout.abandoned.v1";

/** Fikstury przez JSON - kopia bez wspólnych referencji (jak jsonb). */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// Wyzwalacz -> czekanie -> warunek (tak: mail -> cel; nie: mail -> scalenie
// do celu): rozgałęzienie, chip scalenia i krok bez menu usuwania.
const GRAPH: JourneyGraph = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 1440 } },
    {
      id: "c",
      type: "if_else",
      params: { match: "all", predicates: [{ kind: "consent", marketing: true }] },
    },
    { id: "m1", type: "send_email", params: {} },
    { id: "g", type: "goal", params: {} },
    { id: "m2", type: "send_email", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "c", branch: "next" },
    { from: "c", to: "m1", branch: "yes" },
    { from: "c", to: "m2", branch: "no" },
    { from: "m1", to: "g", branch: "next" },
    { from: "m2", to: "g", branch: "next" },
  ],
};
const CONTEXT = journeyOpsContext({ triggerEventType: TRIGGER });

function wire() {
  return {
    state: "ready" as const,
    data: {
      definition: {
        id: J,
        key: "porzucona-kasa",
        name: "Porzucona kasa",
        description: null,
        status: "draft",
        category: "marketing",
        legalBasis: null,
        templateKey: null,
        publishedVersionId: null,
        createdAt: AT,
        updatedAt: AT,
      },
      draftRaw: clone({ graph: GRAPH, settings: { triggerEventType: TRIGGER } }),
      versions: [],
      contents: [],
      templateMatches: {},
    },
  };
}

function Harness(props: Partial<JourneyEditorProps> & { initial?: JourneyEditorSearch }) {
  const [search, setSearch] = useState<JourneyEditorSearch>(props.initial ?? {});
  return (
    <JourneyEditor
      journeyId={J}
      search={search}
      view={search.view ?? "canvas"}
      capabilities={journeyCapabilities(["admin"])}
      tenantId={T}
      onSearchChange={(patch) =>
        setSearch((previous) => {
          const next: JourneyEditorSearch = { ...previous, ...patch };
          for (const key of Object.keys(next) as (keyof JourneyEditorSearch)[]) {
            if (next[key] === undefined) delete next[key];
          }
          return next;
        })
      }
      {...props}
    />
  );
}

async function mount(initial: JourneyEditorSearch = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Porzucona kasa" });
  return view;
}

const canvas = () => screen.getByTestId("journey-canvas");
const outline = () => screen.getByTestId("journey-outline");
const item = (root: HTMLElement, key: string) =>
  root.querySelector<HTMLElement>(`[data-focus-key="${key}"]`) as HTMLElement;
const keysIn = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("[data-focus-key]")].map((el) => el.dataset.focusKey);
const press = (key: string, init: Record<string, boolean> = {}) =>
  fireEvent.keyDown(document.activeElement as Element, { key, ...init });
const menuLabels = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole("menuitem")
    .map((entry) => entry.textContent?.replace(/(Insert|Delete)$/, ""));
const closeMenu = async (dialog: HTMLElement) => {
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};
const switchView = (name: string) =>
  fireEvent.click(
    within(screen.getByTestId("journey-toolbar")).getByRole("button", { name: new RegExp(name) }),
  );

beforeEach(() => {
  h.getDetail.mockReset();
  h.getDetail.mockImplementation(async () => wire());
  h.saveDraft.mockReset();
  h.saveDraft.mockResolvedValue({
    ok: true,
    data: { id: J, updatedAt: "2026-10-21T10:00:05.000001+00:00", status: "draft" },
  });
  h.guard.mockReset();
});

afterEach(cleanup);

describe("parytet operacji kanwa ↔ lista ↔ klawiatura w złożonym edytorze", () => {
  it("menu `⋯` i Shift+F10 na kanwie i na liście = availableOps szkicu sesji", async () => {
    await mount();
    const surfaces: [string, () => HTMLElement][] = [
      [t("adminJourneys.editor.toolbar.view.canvas"), canvas],
      [t("adminJourneys.editor.toolbar.view.list"), outline],
    ];
    for (const [viewName, root] of surfaces) {
      switchView(viewName);
      for (const node of GRAPH.nodes) {
        const expected = availableOps(GRAPH, node.id, CONTEXT).map((op) => journeyOpLabel(t, op));
        act(() => item(root(), `node:${node.id}`).focus());
        press("F10", { shiftKey: true });
        const viaKeyboard = await screen.findByRole("dialog");
        expect(menuLabels(viaKeyboard), `${viewName} Shift+F10 ${node.id}`).toEqual(expected);
        await closeMenu(viaKeyboard);

        fireEvent.click(root().querySelector(`[data-menu-for="${node.id}"]`) as HTMLElement);
        const viaButton = await screen.findByRole("dialog");
        expect(menuLabels(viaButton), `${viewName} ⋯ ${node.id}`).toEqual(expected);
        await closeMenu(viaButton);
      }
    }
  });

  it("Lista = te same węzły i kolejność co kanwa; jeden tab stop; fokus przechodzi między widokami", async () => {
    await mount();
    const expected = focusItems(buildJourneyView(GRAPH)).map(focusKey);
    expect(keysIn(canvas())).toEqual(expected);
    expect(canvas().querySelectorAll('[data-focus-key][tabindex="0"]')).toHaveLength(1);

    act(() => item(canvas(), "node:m1").focus());
    switchView(t("adminJourneys.editor.toolbar.view.list"));
    expect(screen.queryByTestId("journey-canvas")).toBeNull();
    const tree = within(outline()).getByRole("tree");
    expect(within(tree).getAllByRole("treeitem").map((entry) => entry.dataset.focusKey)).toEqual(
      expected,
    );
    expect(tree.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    // Fokus edytora jest wspólny: tab stop listy stoi tam, gdzie był na kanwie.
    expect(item(outline(), "node:m1").getAttribute("tabindex")).toBe("0");
  });

  it("operacja z kanwy idzie do szkicu sesji; jedno ogłoszenie; Ctrl+Z i Ctrl+Shift+Z z paska", async () => {
    await mount();
    act(() => item(canvas(), "node:w").focus());
    press("Delete");
    await waitFor(() => expect(item(canvas(), "node:w")).toBeNull());
    const live = canvas().querySelector('[aria-live="polite"]') as HTMLElement;
    const deleteLabel = journeyOpLabel(
      t,
      availableOps(GRAPH, "w", CONTEXT).find((op) => op.kind === "remove") ??
        availableOps(GRAPH, "w", CONTEXT)[0],
    );
    expect(live.textContent?.trim()).toBe(
      t("adminJourneys.canvas.live.applied", { label: deleteLabel }),
    );
    expect(h.guard).toHaveBeenLastCalledWith(true);

    // Lista widzi ten sam szkic.
    switchView(t("adminJourneys.editor.toolbar.view.list"));
    expect(item(outline(), "node:w")).toBeNull();

    // Skrót z paska (poza kanwą i listą) - cofnięcie z etykietą operacji.
    const toolbar = screen.getByTestId("journey-toolbar");
    const listButton = within(toolbar).getByRole("button", {
      name: new RegExp(t("adminJourneys.editor.toolbar.view.list")),
    });
    act(() => listButton.focus());
    fireEvent.keyDown(listButton, { key: "z", ctrlKey: true });
    await waitFor(() => expect(item(outline(), "node:w")).not.toBeNull());
    const outlineLive = outline().querySelector('[aria-live="polite"]') as HTMLElement;
    expect(outlineLive.textContent?.trim()).toBe(
      t("adminJourneys.editor.session.announce.undone", { label: deleteLabel }),
    );
    fireEvent.keyDown(listButton, { key: "Z", metaKey: true, shiftKey: true });
    await waitFor(() => expect(item(outline(), "node:w")).toBeNull());
    expect(outlineLive.textContent?.trim()).toBe(
      t("adminJourneys.editor.session.announce.redone", { label: deleteLabel }),
    );
  });

  it("Ctrl+Z w polu tekstowym należy do pola - szkic bez zmian", async () => {
    await mount();
    act(() => item(canvas(), "node:w").focus());
    press("Delete");
    await waitFor(() => expect(item(canvas(), "node:w")).toBeNull());
    const select = within(screen.getByTestId("journey-toolbar")).getByLabelText(
      t("adminJourneys.editor.toolbar.stats.label"),
    );
    fireEvent.keyDown(select, { key: "z", ctrlKey: true });
    expect(item(canvas(), "node:w")).toBeNull();
  });

  it("atrybuty wycieczki i axe bez naruszeń w widoku kanwy i listy", async () => {
    const { container } = await mount();
    expect(container.querySelector('[data-tour="journey-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-tour="journey-publish"]')).not.toBeNull();
    expect(summarize(await axeViolations(container))).toBe("");
    switchView(t("adminJourneys.editor.toolbar.view.list"));
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
