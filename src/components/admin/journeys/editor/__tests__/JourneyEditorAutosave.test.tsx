// Autozapis złożonego edytora ścieżki (S8.3d, SPEC §6.3 „autozapis szkicu
// 2 s”, §3.4 współbieżność optymistyczna) - na atrapie serwera z PRAWDZIWYM
// CAS: `saveJourneyDraft` przyjmuje zapis tylko z tokenem równym bieżącemu
// `updated_at` atrapy, jak `admin_journey_save_draft`.
//
// CO TEN PLIK DOWODZI (przez UI edytora, nie przez hook).
//   1. Zmiana na kanwie -> pasek „niezapisane”, ochrona przed utratą
//      (`useUnsavedChangesGuard(true)`), zapis dopiero po 2 s bezczynności
//      z `p_expected_updated_at` z odczytu szczegółu; następny zapis z tokenem
//      z WYNIKU poprzedniego; po zapisie „zapisano” i ochrona zdjęta.
//   2. Własny zapis wraca szyną (`journey.changed.v1` unieważnia szczegół) -
//      szkic, historia (cofnij) i edytor bez dialogu.
//   3. Obcy zapis przy czystym szkicu: wersja z innej karty wczytana sama,
//      komunikat w regionie `aria-live` kanwy, bez zapisu.
//   4. Obcy zapis przy brudnym szkicu: dialog różnic (`JourneyConflictDialog`),
//      autozapis stoi, kanwa tylko do odczytu, Esc zostawia pasek „Pokaż
//      różnice”; „Zachowaj moje” zapisuje z tokenem serwera.
//   5. Zapis odrzucony przez CAS: pobranie wersji serwera i dialog różnic;
//      „Weź wersję z innej karty” bez zapisu, ochrona zdjęta.
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

// Przewodnik (I9, Z-S8-01): nakładka przejmuje fokus - atrapa; montaż
// sprawdzają `RevenueJourneysTab.test`, `JourneyEditorRoute.test`
// i `JourneyTour.test`.
vi.mock("@/components/admin/journeys/tour/JourneyTour", () => ({ JourneyTour: () => null }));
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

import { JourneyEditor } from "../JourneyEditor";
import { journeyCapabilities } from "@/lib/admin/journeys/access";
import { JOURNEY_AUTOSAVE_DELAY_MS } from "@/lib/admin/journeys/editorSession";
import type { JourneyEditorSearch } from "@/lib/journeys/editorSearch";
import { emptyJourneyGraph, type JourneyDraft } from "@/lib/journeys/graph";
import { journeyKeys } from "@/lib/journeys/keys";
import { realT } from "@/test/i18nReal";

h.fixedT = realT;
const t = realT("pl");
const J = "4cab3de7-f976-404a-b54e-c37337942b7e";
const T = "11111111-1111-4111-8111-111111111111";
const TRIGGER = "account.registered.v1";

/** Fikstury przez JSON - kopia bez wspólnych referencji (jak jsonb). */
const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Wyzwalacz -> czekanie `w` -> wyjście. */
function draftWithWait(): JourneyDraft {
  const graph = emptyJourneyGraph();
  return {
    graph: {
      nodes: [...graph.nodes, { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } }],
      edges: [
        { from: "trigger", to: "w", branch: "next" },
        { from: "w", to: "exit", branch: "next" },
      ],
    },
    settings: { triggerEventType: TRIGGER },
  };
}

/** Szkic bez czekania (wynik usunięcia `w` z ponownym połączeniem). */
function draftWithoutWait(): JourneyDraft {
  return { graph: emptyJourneyGraph(), settings: { triggerEventType: TRIGGER } };
}

interface FakeServer {
  seq: number;
  token: string;
  draft: unknown;
  name: string;
}

let server: FakeServer;

function tokenFor(seq: number) {
  return `2026-10-21T10:00:${String(seq).padStart(2, "0")}.123456+00:00`;
}

/** Zapis z „innej karty” prosto w atrapie bazy (nowy token). */
function foreignSave(patch: Partial<Pick<FakeServer, "draft" | "name">>) {
  Object.assign(server, clone(patch));
  server.seq += 1;
  server.token = tokenFor(server.seq);
}

function wire() {
  return {
    state: "ready" as const,
    data: {
      definition: {
        id: J,
        key: "powitanie",
        name: server.name,
        description: null,
        status: "draft",
        category: "marketing",
        legalBasis: null,
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
  data: { journeyId: string; expectedUpdatedAt: string; draft: unknown; name?: string };
}

const saveTimes: number[] = [];

beforeEach(() => {
  server = { seq: 0, token: tokenFor(0), draft: clone(draftWithWait()), name: "Powitanie" };
  saveTimes.length = 0;
  h.guard.mockReset();
  h.getDetail.mockReset();
  h.getDetail.mockImplementation(async () => wire());
  h.saveDraft.mockReset();
  h.saveDraft.mockImplementation(async ({ data }: SaveInput) => {
    saveTimes.push(Date.now());
    if (data.expectedUpdatedAt !== server.token) {
      return { ok: false, error: "conflict", reason: "conflict", detail: null };
    }
    server.draft = clone(data.draft);
    if (data.name !== undefined) server.name = data.name.trim();
    server.seq += 1;
    server.token = tokenFor(server.seq);
    return { ok: true, data: { id: J, updatedAt: server.token, status: "draft" } };
  });
});

afterEach(cleanup);

function Harness() {
  const [search, setSearch] = useState<JourneyEditorSearch>({});
  return (
    <JourneyEditor
      journeyId={J}
      search={search}
      view={search.view ?? "canvas"}
      capabilities={journeyCapabilities(["editor"])}
      tenantId={T}
      onSearchChange={(patch) => setSearch((previous) => ({ ...previous, ...patch }))}
    />
  );
}

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1, name: "Powitanie" });
  await screen.findByTestId("journey-canvas");
  // Kontekst blokad (ustawienia, zdrowie, lista, przepisy) wczytany - „Sprawdź (n)”.
  await within(screen.getByTestId("journey-toolbar")).findByRole("button", {
    name: /\(\d+\)$/,
  });
  /** Zdarzenie `journey.changed.v1` - szyna unieważnia szczegół w każdej karcie. */
  const bus = async () => {
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: journeyKeys.detail(J) });
    });
  };
  return { queryClient, bus };
}

const card = (id: string) =>
  screen.getByTestId("journey-canvas").querySelector<HTMLElement>(`[data-focus-key="node:${id}"]`);

/** Usunięcie czekania z kanwy klawiszem Delete - zmiana szkicu bez zapisu. */
async function deleteWait(): Promise<number> {
  act(() => card("w")?.focus());
  const at = Date.now();
  fireEvent.keyDown(document.activeElement as Element, { key: "Delete" });
  await waitFor(() => expect(card("w")).toBeNull());
  return at;
}

const toolbar = () => screen.getByTestId("journey-toolbar");
const statusText = (key: string) => within(toolbar()).getByText(t(key));
const SAVE_WAIT = { timeout: JOURNEY_AUTOSAVE_DELAY_MS + 2_000 };

function payloads() {
  return h.saveDraft.mock.calls.map(([input]) => (input as SaveInput).data);
}

describe("autozapis edytora - 2 s z p_expected_updated_at", () => {
  it("zmiana: pasek „niezapisane” i ochrona; zapis po 2 s z tokenem z odczytu, potem z wyniku zapisu", async () => {
    await mount();
    expect(h.guard).toHaveBeenLastCalledWith(false);
    const editedAt = await deleteWait();
    expect(statusText("admin.autosave.dirty")).toBeInTheDocument();
    expect(h.guard).toHaveBeenLastCalledWith(true);
    expect(h.saveDraft).not.toHaveBeenCalled();

    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(1), SAVE_WAIT);
    expect(saveTimes[0] - editedAt).toBeGreaterThanOrEqual(JOURNEY_AUTOSAVE_DELAY_MS - 50);
    expect(payloads()[0]).toMatchObject({
      journeyId: J,
      expectedUpdatedAt: tokenFor(0),
      draft: draftWithoutWait(),
      name: "Powitanie",
    });
    await waitFor(() => expect(statusText("admin.autosave.saved")).toBeInTheDocument());
    expect(h.guard).toHaveBeenLastCalledWith(false);

    // Cofnięcie przyciskiem paska to kolejna zmiana - zapis z tokenem z WYNIKU.
    fireEvent.click(within(toolbar()).getByRole("button", { name: t("admin.autosave.undo") }));
    await waitFor(() => expect(card("w")).not.toBeNull());
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(2), SAVE_WAIT);
    expect(payloads()[1]).toMatchObject({
      expectedUpdatedAt: tokenFor(1),
      draft: draftWithWait(),
    });
    expect(server.token).toBe(tokenFor(2));
  });

  it("własny zapis wraca szyną: szkic, historia i edytor bez dialogu różnic", async () => {
    const { bus } = await mount();
    await deleteWait();
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(1), SAVE_WAIT);
    await waitFor(() => expect(statusText("admin.autosave.saved")).toBeInTheDocument());
    await bus();
    expect(card("w")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: t("admin.autosave.undo") })).toBeEnabled();
  });

  it("obcy zapis przy czystym szkicu: wersja z innej karty wczytana, komunikat aria-live, bez zapisu", async () => {
    const { bus } = await mount();
    foreignSave({ name: "Z innej karty", draft: draftWithoutWait() });
    await bus();
    await screen.findByRole("heading", { level: 1, name: "Z innej karty" });
    expect(card("w")).toBeNull();
    const live = screen
      .getByTestId("journey-canvas")
      .querySelector('[aria-live="polite"]') as HTMLElement;
    await waitFor(() =>
      expect(live.textContent?.trim()).toBe(t("adminJourneys.editor.session.announce.external")),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.saveDraft).not.toHaveBeenCalled();
  });

  it("obcy zapis przy brudnym szkicu: dialog różnic, autozapis stoi, Esc zostawia pasek; „Zachowaj moje” z tokenem serwera", async () => {
    const { bus } = await mount();
    await deleteWait();
    foreignSave({ name: "Z innej karty" });
    const foreignToken = server.token;
    await bus();
    const dialog = await screen.findByRole("dialog", {
      name: t("adminJourneys.editor.conflict.title"),
    });
    expect(h.guard).toHaveBeenLastCalledWith(true);
    // Kanwa w konflikcie jest tylko do odczytu (bez „+”).
    expect(screen.getByTestId("journey-canvas").querySelector("[data-insert-key]")).toBeNull();

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const reopen = screen.getByRole("button", {
      name: t("adminJourneys.editor.notice.showConflict"),
    });
    expect(screen.getByText(t("adminJourneys.editor.session.notice.conflict"))).toBeVisible();
    fireEvent.click(reopen);
    const again = await screen.findByRole("dialog", {
      name: t("adminJourneys.editor.conflict.title"),
    });
    expect(h.saveDraft).not.toHaveBeenCalled();

    fireEvent.click(
      within(again).getByRole("button", { name: t("adminJourneys.editor.conflict.keepMine") }),
    );
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(1));
    expect(payloads()[0]).toMatchObject({
      expectedUpdatedAt: foreignToken,
      draft: draftWithoutWait(),
      name: "Powitanie",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.name).toBe("Powitanie");
    await waitFor(() => expect(h.guard).toHaveBeenLastCalledWith(false));
  });

  it("zapis odrzucony przez CAS: dialog różnic z wersją serwera; „Weź wersję z innej karty” bez zapisu", async () => {
    await mount();
    // Inna karta zapisała, a szyna jeszcze nie dotarła - nasz zapis trafi w CAS.
    foreignSave({ name: "Obca", draft: draftWithoutWait() });
    act(() => card("w")?.focus());
    fireEvent.keyDown(document.activeElement as Element, { key: "Delete" });
    await waitFor(() => expect(card("w")).toBeNull());
    // Lokalnie usuwamy czekanie, serwer ma inną nazwę - różnica w definicji.
    const dialog = await screen.findByRole(
      "dialog",
      { name: t("adminJourneys.editor.conflict.title") },
      SAVE_WAIT,
    );
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByText(t("adminJourneys.editor.conflict.sections.definition")),
    ).toBeVisible();

    fireEvent.click(
      within(dialog).getByRole("button", { name: t("adminJourneys.editor.conflict.takeServer") }),
    );
    await screen.findByRole("heading", { level: 1, name: "Obca" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(h.guard).toHaveBeenLastCalledWith(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.saveDraft).toHaveBeenCalledTimes(1);
  });
});
