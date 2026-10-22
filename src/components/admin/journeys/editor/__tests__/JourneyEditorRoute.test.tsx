// Powłoka edytora ścieżki (S8.3d) na PRAWDZIWEJ trasie
// `/admin/revenue/journeys/$journeyId` (router, historia, walidator adresu).
//
// CO TEN PLIK DOWODZI.
//   1. Przed hydratacją serwer rysuje wyłącznie „wczytywanie” - bez bramki
//      roli i bez edytora (ten sam znacznik dla każdej roli).
//   2. Bramka roli: admin i redaktor wchodzą, autor i sam `super_admin`
//      dostają `revenue-role-gate` (dokładne role, nie `isAdmin`); redaktor
//      nie dostaje publikacji (`journeyCapabilities`), tylko zdanie, kto
//      publikuje.
//   3. `data-testid="journey-editor"` z `data-journey-id` i `data-view`:
//      `?view=` z adresu, bez niego Kanwa, a Lista przy ograniczonym ruchu
//      i oknie węższym niż 768 px.
//   4. Odmowa `aal2` przy odczycie szczegółu -> `MfaRequiredNotice`.
//   5. Okruszki „Przychód i lejek › Ścieżki › {nazwa}”: powrót do ostatniego
//      filtra listy (`?status=&q=` zapamiętane przez listę), bez niego -
//      `/admin/revenue/journeys`; nazwa jako bieżąca strona.
//   6. Nawigacja `useNavigate` po adresie edytora (widok, krok z panelem)
//      działa także przy niezapisanym szkicu - strażnik zmian pilnuje
//      wyjścia z edytora, nie przełączania widoku.
//   7. Leniwe ładowanie: powłoka nie importuje edytora statycznie, a edytor -
//      arkuszy, dialogów, panelu testu i wyników. axe bez naruszeń.
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Role } from "@/hooks/useAuth";

const h = vi.hoisted(() => ({
  auth: { isAdmin: false, roles: [] as Role[], tenantId: null as string | null },
  getDetail: vi.fn(),
  getVersion: vi.fn(),
  saveDraft: vi.fn(),
}));

// Przewodnik (I9, Z-S8-01): nakładka przejmuje fokus, więc w testach
// zakładki stoi atrapa z propsami - sam przewodnik testuje `JourneyTour.test`.
vi.mock("@/components/admin/journeys/tour/JourneyTour", () => ({
  JourneyTour: (props: { id: string; ready: boolean }) => (
    <div data-testid="journey-tour" data-tour-id={props.id} data-ready={String(props.ready)} />
  ),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
// Panel kroku sięga też po server fn CRM (zespół) - atrapa każdej bramki.
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
  requireAdmin: { __mw: "requireAdmin" },
  requirePlatformAdmin: { __mw: "requirePlatformAdmin" },
}));
vi.mock("@/lib/admin/journeys/journeyEditor.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/journeys/journeyEditor.functions")>()),
  getJourneyDetail: (input: unknown) => h.getDetail(input),
  getJourneyVersion: (input: unknown) => h.getVersion(input),
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
    getJourneyEnrollments: () => new Promise(() => {}),
    estimateJourneyTrigger: () => new Promise(() => {}),
    simulateJourney: () => new Promise(() => {}),
  };
});
vi.mock("@/lib/journeys/stats.functions", () => ({
  getJourneyStats: () => new Promise(() => {}),
  getJourneySeries: () => new Promise(() => {}),
}));
vi.mock("@/lib/admin/workflows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/workflows")>()),
  fetchWorkflowDefinitions: () => Promise.resolve([]),
}));

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-revenue";
// Słowniki leniwych arkuszy i dialogów - napisy w asercjach liczone przed ich wczytaniem.
import "@/lib/i18n-admin-journeys-publish";
import "@/lib/i18n-admin-journeys-steps";
import { JourneyEditorRoute } from "../JourneyEditorRoute";
import { rememberJourneyListSearch } from "@/components/admin/journeys/list/JourneyList";
import { emptyJourneyGraph } from "@/lib/journeys/graph";
import { journeysEditorDictionaries } from "@/lib/i18n-admin-journeys-editor";
import { Route as EditorRoute } from "@/routes/admin.revenue_.journeys.$journeyId";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { renderRoute } from "@/test/routeHarness";
import { zaleznosciTrasy } from "@/test/routeSourceImports";

const t = realT("pl");
const PATH = "/admin/revenue/journeys/$journeyId";
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const T = "11111111-1111-4111-8111-111111111111";
const AT = "2026-10-21T10:00:00.123456+00:00";
const TRIGGER = "account.registered.v1";

const ROLES = {
  admin: { isAdmin: true, roles: ["admin"] },
  editor: { isAdmin: false, roles: ["editor"] },
  author: { isAdmin: false, roles: ["author"] },
  // `useAuth` liczy `super_admin` do `isAdmin` - bramka ma go odrzucić, bo
  // polityki ścieżek (wiersz `admin`/`editor`) go nie wpuszczają.
  super_admin: { isAdmin: true, roles: ["super_admin"] },
} as const satisfies Record<string, { isAdmin: boolean; roles: readonly Role[] }>;

function asRole(role: keyof typeof ROLES): void {
  h.auth = { isAdmin: ROLES[role].isAdmin, roles: [...ROLES[role].roles], tenantId: T };
}

/** Fikstury przez JSON - kopia bez wspólnych referencji (jak jsonb). */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const V1 = "5547c447-8ae8-460b-ac5f-fe00b0e87fc5";
const VERSION_1 = {
  id: V1,
  version: 1,
  publishedAt: "2026-10-20T09:00:00.000000+00:00",
  publishedBy: null,
  triggerEventType: TRIGGER,
  graphChecksum: "abc",
};

function wire(versions: unknown[] = []) {
  const graph = emptyJourneyGraph();
  return {
    state: "ready" as const,
    data: {
      definition: {
        id: J,
        key: "powitanie",
        name: "Powitanie nowego konta",
        description: null,
        status: "draft",
        category: "marketing",
        legalBasis: null,
        templateKey: null,
        publishedVersionId: null,
        createdAt: AT,
        updatedAt: AT,
      },
      draftRaw: clone({
        graph: {
          nodes: [
            ...graph.nodes,
            { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } },
          ],
          edges: [
            { from: "trigger", to: "w", branch: "next" },
            { from: "w", to: "exit", branch: "next" },
          ],
        },
        settings: { triggerEventType: TRIGGER },
      }),
      versions,
      contents: [],
      templateMatches: {},
    },
  };
}

async function mountEditor(entry = `/admin/revenue/journeys/${J}`) {
  const rendered = await renderRoute({ route: EditorRoute, path: PATH, initialEntry: entry });
  return rendered;
}

/** Atrapa `matchMedia` - zapytania z listy pasują, reszta nie. */
function stubMedia(matching: readonly string[]) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: matching.includes(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

beforeEach(async () => {
  asRole("admin");
  window.sessionStorage.clear();
  h.getDetail.mockReset();
  h.getDetail.mockImplementation(async () => wire());
  h.getVersion.mockReset();
  h.getVersion.mockResolvedValue({
    state: "ready",
    data: {
      version: VERSION_1,
      // Wersja 1 to sam wyzwalacz i wyjście (szkic ma już czekanie `w`).
      graphRaw: clone(emptyJourneyGraph()),
      settingsRaw: { triggerEventType: TRIGGER },
      contents: [],
    },
  });
  h.saveDraft.mockReset();
  h.saveDraft.mockResolvedValue({
    ok: true,
    data: { id: J, updatedAt: "2026-10-21T10:00:05.000001+00:00", status: "draft" },
  });
  await i18n.changeLanguage("pl");
});

afterEach(cleanup);

describe("JourneyEditorRoute - hydratacja i bramka roli", () => {
  it("przed hydratacją: wyłącznie „wczytywanie”, bez bramki i bez edytora (każda rola)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const role of ["admin", "author"] as const) {
      asRole(role);
      const html = renderToString(<JourneyEditorRoute journeyId={J} search={{}} />);
      expect(html, role).toContain('role="status"');
      expect(html, role).toContain(t("adminRevenue.common.loading"));
      expect(html, role).not.toContain("journey-editor");
      expect(html, role).not.toContain("revenue-role-gate");
    }
    warn.mockRestore();
  });

  it.each(["author", "super_admin"] as const)(
    "%s dostaje powiadomienie huba zamiast edytora",
    async (role) => {
      asRole(role);
      const { container } = await mountEditor();
      expect(await screen.findByTestId("revenue-role-gate")).toHaveTextContent(
        t("adminRevenue.common.roleGate"),
      );
      expect(screen.queryByTestId("journey-editor")).toBeNull();
      expect(h.getDetail).not.toHaveBeenCalled();
      expect(summarize(await axeViolations(container))).toBe("");
    },
  );

  it("admin: edytor z identyfikatorem i widokiem, nazwa z odczytu, publikacja w pasku", async () => {
    const { container } = await mountEditor();
    const editor = await screen.findByTestId("journey-editor");
    expect(editor).toHaveAttribute("data-journey-id", J);
    expect(editor).toHaveAttribute("data-view", "canvas");
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    expect(h.getDetail).toHaveBeenCalledWith({ data: { journeyId: J } });
    expect(within(editor).getByTestId("journey-canvas")).toBeInTheDocument();
    const publish = within(screen.getByTestId("journey-toolbar")).getByRole("button", {
      name: t("adminJourneys.editor.toolbar.publish"),
    });
    expect(publish).toHaveAttribute("data-tour", "journey-publish");
    // Przewodnik edytora (I9, Z-S8-01): gotowy na kanwie edytowalnego szkicu.
    await waitFor(() =>
      expect(screen.getByTestId("journey-tour")).toHaveAttribute("data-ready", "true"),
    );
    expect(screen.getByTestId("journey-tour")).toHaveAttribute("data-tour-id", "journey-editor");
    expect(summarize(await axeViolations(container))).toBe("");
  });

  it("redaktor: edytor bez publikacji - zdanie, kto publikuje", async () => {
    asRole("editor");
    await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const toolbar = screen.getByTestId("journey-toolbar");
    expect(
      within(toolbar).queryByRole("button", { name: t("adminJourneys.editor.toolbar.publish") }),
    ).toBeNull();
    expect(
      within(toolbar).getByText(t("adminJourneys.editor.toolbar.publishAdminOnly")),
    ).toBeVisible();
  });

  it("brak aal2 przy odczycie szczegółu -> MfaRequiredNotice w edytorze", async () => {
    h.getDetail.mockRejectedValue(new Error("Forbidden: mfa_required (aal2)"));
    await mountEditor();
    const editor = await screen.findByTestId("journey-editor");
    expect(await within(editor).findByTestId("revenue-mfa-required")).toBeVisible();
    expect(within(editor).queryByTestId("journey-canvas")).toBeNull();
  });
});

describe("JourneyEditorRoute - widok domyślny", () => {
  it("`?view=list` z adresu wygrywa; bez niego Kanwa", async () => {
    await mountEditor(`/admin/revenue/journeys/${J}?view=list`);
    const editor = await screen.findByTestId("journey-editor");
    expect(editor).toHaveAttribute("data-view", "list");
    expect(await within(editor).findByRole("tree")).toBeInTheDocument();
    // Lista kroków nie ma kotwicy kanwy - przewodnik czeka (Z-S8-01).
    expect(screen.getByTestId("journey-tour")).toHaveAttribute("data-ready", "false");
  });

  it.each([
    ["ograniczony ruch", "(prefers-reduced-motion: reduce)"],
    ["okno < 768 px", "(max-width: 767px)"],
  ])("%s bez `?view=` -> Lista", async (_label, query) => {
    const restore = stubMedia([query]);
    try {
      await mountEditor();
      const editor = await screen.findByTestId("journey-editor");
      await waitFor(() => expect(editor).toHaveAttribute("data-view", "list"));
      expect(await within(editor).findByRole("tree")).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});

describe("JourneyEditorRoute - okruszki", () => {
  it("„Przychód i lejek › Ścieżki › {nazwa}”, bez zapamiętanego filtra - pełna lista", async () => {
    await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const nav = screen.getByRole("navigation", {
      name: t("adminJourneys.editor.breadcrumbs.label"),
    });
    expect(within(nav).getByRole("link", { name: t("adminRevenue.title") })).toHaveAttribute(
      "href",
      "/admin/revenue",
    );
    expect(within(nav).getByRole("link", { name: t("adminRevenue.tab.journeys") })).toHaveAttribute(
      "href",
      "/admin/revenue/journeys",
    );
    expect(within(nav).getByText("Powitanie nowego konta")).toHaveAttribute("aria-current", "page");
  });

  it("powrót do ostatniego filtra listy (`?status=&q=`)", async () => {
    rememberJourneyListSearch({ status: "paused", q: "kasa" });
    await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const nav = screen.getByRole("navigation", {
      name: t("adminJourneys.editor.breadcrumbs.label"),
    });
    const back = within(nav).getByRole("link", { name: t("adminRevenue.tab.journeys") });
    const href = new URL(back.getAttribute("href") ?? "", "https://nes.test");
    expect(href.pathname).toBe("/admin/revenue/journeys");
    expect(href.searchParams.get("status")).toBe("paused");
    expect(href.searchParams.get("q")).toBe("kasa");
  });

  it("wersja angielska: okruszki i pasek po angielsku", async () => {
    await i18n.changeLanguage("en");
    await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const en = journeysEditorDictionaries.en.adminJourneys.editor;
    expect(screen.getByRole("navigation", { name: en.breadcrumbs.label })).toBeVisible();
    expect(screen.getByRole("link", { name: "Revenue and funnel" })).toBeVisible();
    expect(
      within(screen.getByTestId("journey-toolbar")).getByRole("button", {
        name: new RegExp(en.toolbar.view.list),
      }),
    ).toBeVisible();
  });
});

describe("JourneyEditorRoute - nawigacja po adresie edytora", () => {
  it("widok i panel kroku przez adres, także przy niezapisanym szkicu", async () => {
    const route = await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const canvas = await screen.findByTestId("journey-canvas");

    // Niezapisana zmiana (autozapis czeka 2 s) - strażnik zmian jest aktywny.
    const wait = canvas.querySelector<HTMLElement>('[data-focus-key="node:w"]') as HTMLElement;
    act(() => wait.focus());
    fireEvent.keyDown(wait, { key: "Delete" });
    await waitFor(() => expect(canvas.querySelector('[data-focus-key="node:w"]')).toBeNull());

    fireEvent.click(
      within(screen.getByTestId("journey-toolbar")).getByRole("button", {
        name: new RegExp(t("adminJourneys.editor.toolbar.view.list")),
      }),
    );
    await waitFor(() => expect(route.search()).toMatchObject({ view: "list" }));
    expect(screen.getByTestId("journey-editor")).toHaveAttribute("data-view", "list");
    // Lista pokazuje niezapisany szkic - edytor nie przeładował się.
    const tree = await screen.findByRole("tree");
    expect(tree.querySelector('[data-focus-key="node:w"]')).toBeNull();

    // Enter na kroku = `?node=` i panel kroku (leniwy arkusz).
    const trigger = tree.querySelector<HTMLElement>(
      '[data-focus-key="node:trigger"]',
    ) as HTMLElement;
    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "Enter" });
    await waitFor(() => expect(route.search()).toMatchObject({ view: "list", node: "trigger" }));
    const sheet = await screen.findByTestId("journey-step-sheet");
    expect(sheet).toHaveAttribute("data-node-id", "trigger");
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(route.search().node).toBeUndefined());
    expect(route.searchStr()).not.toContain("undefined");
  });
});

describe("JourneyEditorRoute - pasek edytora", () => {
  it("Sprawdź (n), Testuj na sobie, Ustawienia, Symuluj i Opublikuj otwierają swoje części", async () => {
    await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const toolbar = () => screen.getByTestId("journey-toolbar");
    const button = (name: string | RegExp) => within(toolbar()).getByRole("button", { name });

    const check = await within(toolbar()).findByRole("button", { name: /\(\d+\)$/ });
    expect(check).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(check);
    expect(check).toHaveAttribute("aria-expanded", "true");
    const issuesRegion = document.getElementById(check.getAttribute("aria-controls") ?? "");
    expect(within(issuesRegion as HTMLElement).getByTestId("journey-issues")).toBeVisible();

    const test = button(t("adminJourneys.editor.toolbar.test"));
    fireEvent.click(test);
    expect(test).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByTestId("journey-test-panel")).toBeVisible();

    fireEvent.click(button(t("adminJourneys.editor.toolbar.settings")));
    expect(
      await screen.findByRole("dialog", { name: t("adminJourneys.settingsSheet.title") }),
    ).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(button(t("adminJourneys.editor.toolbar.simulate")));
    expect(
      await screen.findByRole("dialog", { name: t("adminJourneys.simulateDialog.title") }),
    ).toBeVisible();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(button(t("adminJourneys.editor.toolbar.publish")));
    expect(await screen.findByTestId("journey-publish-dialog")).toHaveAttribute(
      "data-tour",
      "journey-publish",
    );
  });

  it("podgląd wersji `?version=k`: graf wersji tylko do odczytu, powrót do szkicu", async () => {
    h.getDetail.mockImplementation(async () => wire([VERSION_1]));
    const route = await mountEditor();
    await screen.findByRole("heading", { level: 1, name: "Powitanie nowego konta" });
    const select = within(screen.getByTestId("journey-toolbar")).getByLabelText(
      t("adminJourneys.editor.toolbar.version.label"),
    );
    fireEvent.change(select, { target: { value: "1" } });
    await waitFor(() => expect(route.search()).toMatchObject({ version: 1 }));
    await waitFor(() =>
      expect(h.getVersion).toHaveBeenCalledWith({ data: { journeyId: J, versionId: V1 } }),
    );
    const canvas = await screen.findByTestId("journey-canvas");
    await waitFor(() => expect(canvas.querySelector('[data-focus-key="node:w"]')).toBeNull());
    expect(canvas.querySelector('[data-focus-key="node:trigger"]')).not.toBeNull();
    // Tylko do odczytu: bez „+”, bez autozapisu i bez publikacji w pasku.
    expect(canvas.querySelector("[data-insert-key]")).toBeNull();
    expect(
      screen.queryByTestId("journey-toolbar")?.querySelector('[data-tour="journey-publish"]'),
    ).toBeNull();
    expect(screen.getByText(t("adminJourneys.editor.session.notice.version"))).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: t("adminJourneys.editor.notice.backToDraft") }),
    );
    await waitFor(() => expect(route.search().version).toBeUndefined());
    await waitFor(() =>
      expect(
        screen.getByTestId("journey-canvas").querySelector('[data-focus-key="node:w"]'),
      ).not.toBeNull(),
    );
  });
});

describe("leniwe ładowanie (D-08)", () => {
  it("powłoka ładuje edytor dynamicznie, edytor - arkusze, dialogi, test i wyniki", () => {
    const dir = "src/components/admin/journeys/editor";
    const route = zaleznosciTrasy(
      `${dir}/JourneyEditorRoute.tsx`,
      readFileSync(`${dir}/JourneyEditorRoute.tsx`, "utf8"),
    );
    expect(route.statyczne).not.toContain("./JourneyEditor");
    expect(route.pozaHandlerem).toEqual(["./JourneyEditor"]);

    const editor = zaleznosciTrasy(
      `${dir}/JourneyEditor.tsx`,
      readFileSync(`${dir}/JourneyEditor.tsx`, "utf8"),
    );
    const lazy = [
      "./JourneyStepSheet",
      "./JourneyTriggerSheet",
      "./JourneySettingsSheet",
      "./JourneyPublishDialog",
      "./JourneySimulateDialog",
      "./JourneyTestPanel",
      "@/components/admin/journeys/results/JourneyResults",
    ];
    expect([...editor.pozaHandlerem].sort()).toEqual([...lazy].sort());
    for (const spec of lazy) expect(editor.statyczne, spec).not.toContain(spec);
    // Bez bibliotek grafu - kanwa to HTML + jeden SVG z `layoutJourney`.
    for (const spec of [...route.statyczne, ...editor.statyczne]) {
      expect(spec).not.toMatch(/reactflow|@xyflow|dagre|elkjs|cytoscape|d3-/);
    }
  });

  it("arkusze kroku i wyzwalacza dociągane w bezczynności, dialogi - dopiero przy otwarciu (I9, Z-S8-09)", () => {
    const source = readFileSync("src/components/admin/journeys/editor/JourneyEditor.tsx", "utf8");
    const idle = /whenIdle\(\(\) => \{([\s\S]*?)\}, \d+\)/.exec(source)?.[1] ?? "";
    expect(idle).toContain("loadStepSheet()");
    expect(idle).toContain("loadTriggerSheet()");
    // Rzadkie części zostają leniwe do pierwszego otwarcia (koszt pierwszego wejścia).
    expect(idle).not.toMatch(/Publish|Simulate|TestPanel|Results|Settings/);
    // `lazy` korzysta z TEGO SAMEGO ładowacza - prefetch trafia w ten sam chunk.
    expect(source).toMatch(/lazy\(\(\) =>\s*loadStepSheet\(\)/);
    expect(source).toMatch(/lazy\(\(\) =>\s*loadTriggerSheet\(\)/);
  });
});
