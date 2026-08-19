// Trasa `/admin/workflows` — sklejenie panelu „Automatyzacje" (0% przed zmianą).
//
// Panele mają własne testy; tutaj testujemy WYŁĄCZNIE to, czego żaden test
// pojedynczego panelu nie widzi:
//
//   1. WALIDACJA SEARCH PARAMS. Zakładka i kontekst (correlation_id, filtr
//      przepisu) żyją w adresie, żeby widoki były linkowalne. Parametr przychodzi
//      z ZEWNĄTRZ — z wklejonego linku — więc obca zakładka i zdeformowany UUID
//      muszą wypaść, a nie trafić do zapytania.
//   2. KPI LICZONE Z OKNA PRZEBIEGÓW. Liczba awarii jest jedynym miejscem, gdzie
//      redaktor widzi, że automatyzacje się psują. Zły licznik ukrywa awarię.
//   3. ORKIESTRACJA MUTACJI. Zapis, przełączenie i usunięcie muszą unieważnić
//      OBA zapytania (definicje i okno przebiegów) — inaczej lista pokazuje stan
//      sprzed zmiany, a KPI liczy ze starego okna.
//   4. NIEUDANE PRZEŁĄCZENIE MUSI SIĘ COFNĄĆ NA EKRANIE. Przełącznik jest
//      optymistyczny wobec oka użytkownika: bez inwalidacji po błędzie pokazuje
//      stan, którego baza nie przyjęła.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  definitions: [] as unknown[],
  runs: [] as unknown[],
  templates: [] as unknown[],
  save: null as unknown,
  setEnabled: null as unknown,
  remove: null as unknown,
  toast: null as unknown,
  captured: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

// Warstwa danych atrapowana; CZYSTE helpery (aggregateRunStats,
// draftFromDefinition, emptyWorkflowDraft) zostają oryginalne, bo to one liczą
// statystyki i budują draft - ich podmiana wydrążyłaby test z sensu.
vi.mock("@/lib/admin/workflows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/workflows")>();
  const { vi: v } = await import("vitest");
  h.save = v.fn(async () => "wf-1");
  h.setEnabled = v.fn(async () => undefined);
  h.remove = v.fn(async () => undefined);
  return {
    ...actual,
    fetchWorkflowDefinitions: async () => h.definitions,
    fetchRecentWorkflowRuns: async () => h.runs,
    fetchWorkflowTemplates: async () => h.templates,
    saveWorkflowDefinition: h.save,
    setWorkflowEnabled: h.setEnabled,
    deleteWorkflowDefinition: h.remove,
  };
});

/** Znacznik panelu - zapisuje otrzymane propy, żeby dało się je wywołać. */
function probe(name: string) {
  return (props: Record<string, unknown>) => {
    h.captured[name] = props;
    return <div data-testid={name} />;
  };
}

vi.mock("@/components/admin/workflows/WorkflowDefinitionsPanel", () => ({
  WorkflowDefinitionsPanel: probe("definitions"),
}));
vi.mock("@/components/admin/workflows/WorkflowTemplatesPanel", () => ({
  WorkflowTemplatesPanel: probe("templates"),
}));
vi.mock("@/components/admin/workflows/WorkflowRunsPanel", () => ({
  WorkflowRunsPanel: probe("runs"),
}));
vi.mock("@/components/admin/workflows/CorrelationTracePanel", () => ({
  CorrelationTracePanel: probe("trace"),
}));
vi.mock("@/components/admin/workflows/WorkflowEditorDialog", () => ({
  WorkflowEditorDialog: probe("editor"),
}));

import { renderRoute } from "@/test/routeHarness";
import { Route as WorkflowsRoute } from "@/routes/admin.workflows";
import { workflowDefinition, workflowRun, workflowTemplate } from "@/test/post-editor/fixtures";

type Mock = ReturnType<typeof vi.fn>;
const PATH = "/admin/workflows";
const props = (name: string) => h.captured[name] as Record<string, unknown>;
const toast = () => h.toast as Record<string, Mock>;

const CORRELATION = "6f1e0c1a-8b2d-4e3f-9a5c-2d7b8e9f0a1b";
const WF_ID = "55555555-5555-4555-8555-555555555555";

async function render(entry = PATH) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rendered = await renderRoute({
    route: WorkflowsRoute,
    path: PATH,
    initialEntry: entry,
    queryClient,
  });
  return { ...rendered, queryClient };
}

beforeEach(() => {
  h.definitions = [workflowDefinition()];
  h.runs = [workflowRun()];
  h.templates = [workflowTemplate()];
  h.captured = {};
  (h.save as Mock).mockReset();
  (h.save as Mock).mockResolvedValue("wf-1");
  (h.setEnabled as Mock).mockReset();
  (h.setEnabled as Mock).mockResolvedValue(undefined);
  (h.remove as Mock).mockReset();
  (h.remove as Mock).mockResolvedValue(undefined);
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Walidacja search params
// ---------------------------------------------------------------------------

describe("/admin/workflows - walidacja parametrów adresu", () => {
  it("domyślnie otwiera zakładkę przepisów", async () => {
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());
  });

  it("zakładka z adresu jest respektowana (widok linkowalny)", async () => {
    await render(`${PATH}?tab=trace`);
    await waitFor(() => expect(screen.getByTestId("trace")).toBeInTheDocument());
  });

  it("OBCA zakładka wypada i wraca widok domyślny", async () => {
    // Parametr przychodzi z wklejonego linku - nieznana wartość nie może
    // zostawić pustego ekranu.
    await render(`${PATH}?tab=nie-ma-takiej`);
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());
  });

  it("poprawny correlation_id z adresu dociera do panelu śladu", async () => {
    await render(`${PATH}?tab=trace&correlation=${CORRELATION}`);
    await waitFor(() => expect(props("trace").correlationId).toBe(CORRELATION));
  });

  it("ZDEFORMOWANY correlation_id jest odrzucany PRZED zapytaniem", async () => {
    // Zapytanie ze złym id zwróciłoby pustkę wyglądającą jak „nic się nie
    // wydarzyło". Walidacja stoi w `validateSearch`, więc panel dostaje `null`.
    await render(`${PATH}?tab=trace&correlation=to-nie-uuid`);
    await waitFor(() => expect(screen.getByTestId("trace")).toBeInTheDocument());
    expect(props("trace").correlationId).toBeNull();
  });

  it("ZDEFORMOWANY filtr przepisu również jest odrzucany", async () => {
    await render(`${PATH}?tab=runs&workflow=%27%20OR%201=1`);
    await waitFor(() => expect(screen.getByTestId("runs")).toBeInTheDocument());
    expect((props("runs").filter as { workflowId: string | null }).workflowId).toBeNull();
  });

  it("poprawny filtr przepisu dociera do panelu historii", async () => {
    await render(`${PATH}?tab=runs&workflow=${WF_ID}`);
    await waitFor(() =>
      expect((props("runs").filter as { workflowId: string }).workflowId).toBe(WF_ID),
    );
  });
});

// ---------------------------------------------------------------------------
// Nagłówek strony
// ---------------------------------------------------------------------------

describe("/admin/workflows - nagłówek dokumentu", () => {
  it("strona administracyjna jest WYŁĄCZONA z indeksowania", async () => {
    // Panel z listą automatyzacji tenanta nie może trafić do wyszukiwarki.
    const { routeMeta } = await import("@/test/routeHarness");
    const meta = await routeMeta(WorkflowsRoute);
    const robots = meta.find((m) => m.name === "robots");
    expect(robots?.content).toContain("noindex");
    expect(robots?.content).toContain("nofollow");
  });
});

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

describe("/admin/workflows - KPI z okna przebiegów", () => {
  it("liczy AKTYWNE przepisy, nie wszystkie", async () => {
    // Wyłączony przepis nie działa; policzenie go jako aktywnego mówiłoby, że
    // automatyzacje pracują, gdy nie pracują.
    h.definitions = [
      workflowDefinition({ id: "a", enabled: true }),
      workflowDefinition({ id: "b", enabled: false }),
    ];
    await render();
    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.kpi.activeDefinitions")).toBeInTheDocument(),
    );
    const card = screen.getByText("adminWorkflows.kpi.activeDefinitions")
      .parentElement as HTMLElement;
    expect(card.textContent).toContain("1");
  });

  it("liczy przepisy Z KATALOGU osobno od własnych", async () => {
    h.definitions = [
      workflowDefinition({ id: "a", template_key: "szablon" }),
      workflowDefinition({ id: "b", template_key: null }),
    ];
    await render();
    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.kpi.templatesInstalled")).toBeInTheDocument(),
    );
    const card = screen.getByText("adminWorkflows.kpi.templatesInstalled")
      .parentElement as HTMLElement;
    expect(card.textContent).toContain("1");
  });

  it("liczy AWARIE w oknie - to jedyne miejsce, gdzie widać psujące się przepisy", async () => {
    h.runs = [
      workflowRun({ id: "r1", status: "failed" }),
      workflowRun({ id: "r2", status: "succeeded" }),
      workflowRun({ id: "r3", status: "failed" }),
    ];
    await render();
    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.kpi\.failuresWindow/)).toBeInTheDocument(),
    );
    const card = screen.getByText(/adminWorkflows\.kpi\.failuresWindow/)
      .parentElement as HTMLElement;
    expect(card.textContent).toContain("2");
  });

  it("kafelek awarii jest KLIKALNY tylko wtedy, gdy są awarie", async () => {
    // Klikalny kafelek z zerem prowadziłby do pustej listy i wyglądał na usterkę.
    h.runs = [workflowRun({ status: "succeeded" })];
    await render();
    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.kpi\.failuresWindow/)).toBeInTheDocument(),
    );
    const card = screen
      .getByText(/adminWorkflows\.kpi\.failuresWindow/)
      .closest("div[class]") as HTMLElement;
    expect(card.className).not.toContain("cursor-pointer");
  });

  it("klik w kafelek awarii przełącza na historię i USTAWIA filtr awarii", async () => {
    // Skrót diagnostyczny: „widzę 3 awarie" -> „pokaż mi je".
    h.runs = [workflowRun({ status: "failed" })];
    await render();
    await waitFor(() =>
      expect(screen.getByText(/adminWorkflows\.kpi\.failuresWindow/)).toBeInTheDocument(),
    );

    const card = screen
      .getByText(/adminWorkflows\.kpi\.failuresWindow/)
      .closest("div.cursor-pointer") as HTMLElement;
    expect(card).not.toBeNull();
    fireEvent.click(card);

    await waitFor(() => expect(screen.getByTestId("runs")).toBeInTheDocument());
    expect((props("runs").filter as { status: string }).status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Orkiestracja mutacji
// ---------------------------------------------------------------------------

describe("/admin/workflows - orkiestracja mutacji", () => {
  it("zapis przepisu melduje sukces, ZAMYKA edytor i odświeża OBA zapytania", async () => {
    // Brak inwalidacji okna przebiegów zostawiłby KPI liczone ze starych danych.
    const { queryClient } = await render();
    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    (props("editor").onSave as (d: unknown) => void)({ id: null, name: "Nowy" });

    await waitFor(() =>
      expect((h.save as Mock).mock.calls[0]?.[0]).toMatchObject({ name: "Nowy" }),
    );
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith("adminWorkflows.common.saved"),
    );
    const keys = spy.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keys).toContain(JSON.stringify(["admin", "workflow-definitions"]));
    expect(keys).toContain(JSON.stringify(["admin", "workflow-runs-window", 500]));
    // Edytor zamknięty - `open` wraca na false.
    await waitFor(() => expect(props("editor").open).toBe(false));
  });

  it("nieudany zapis pokazuje BŁĄD i NIE zamyka edytora", async () => {
    // Zamknięcie edytora po nieudanym zapisie kasuje wpisany przepis.
    (h.save as Mock).mockRejectedValue(new Error("rls denied"));
    await render();
    await waitFor(() => expect(screen.getByTestId("editor")).toBeInTheDocument());

    // Otwórz edytor, potem zapisz.
    fireEvent.click(screen.getByText("adminWorkflows.definitions.newRecipe"));
    await waitFor(() => expect(props("editor").open).toBe(true));
    (props("editor").onSave as (d: unknown) => void)({ id: null, name: "Nowy" });

    await waitFor(() => expect(toast().error).toHaveBeenCalled());
    expect(String(toast().error.mock.calls[0][0])).toContain("rls denied");
    expect(toast().success).not.toHaveBeenCalled();
    expect(props("editor").open).toBe(true);
  });

  it("przycisk w nagłówku otwiera edytor z PUSTYM draftem", async () => {
    await render();
    await waitFor(() => expect(props("editor").open).toBe(false));

    fireEvent.click(screen.getByText("adminWorkflows.definitions.newRecipe"));

    await waitFor(() => expect(props("editor").open).toBe(true));
    expect(props("editor").initial).toMatchObject({ id: null, name: "", steps: [] });
  });

  it("edycja z listy otwiera edytor z draftem ZBUDOWANYM z wiersza", async () => {
    const row = workflowDefinition({ name: "Istniejący przepis" });
    h.definitions = [row];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());

    (props("definitions").onEdit as (r: unknown) => void)(row);

    await waitFor(() => expect(props("editor").open).toBe(true));
    expect(props("editor").initial).toMatchObject({
      id: row.id,
      name: "Istniejący przepis",
      triggerEventType: "post.status_changed.v1",
    });
  });

  it("zamknięcie edytora bez zapisu nic nie zapisuje", async () => {
    await render();
    fireEvent.click(screen.getByText("adminWorkflows.definitions.newRecipe"));
    await waitFor(() => expect(props("editor").open).toBe(true));

    (props("editor").onClose as () => void)();

    await waitFor(() => expect(props("editor").open).toBe(false));
    expect(h.save as Mock).not.toHaveBeenCalled();
  });

  it("przełączenie przepisu przekazuje id i NOWĄ wartość", async () => {
    const row = workflowDefinition({ enabled: true });
    h.definitions = [row];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());

    (props("definitions").onToggle as (r: unknown, e: boolean) => void)(row, false);

    await waitFor(() => expect(h.setEnabled as Mock).toHaveBeenCalledWith(row.id, false));
  });

  it("NIEUDANE przełączenie pokazuje błąd I odświeża listę (cofnięcie na ekranie)", async () => {
    // Bez inwalidacji przełącznik zostaje w pozycji, której baza nie przyjęła -
    // redaktor myśli, że automatyzacja jest wyłączona, a ona działa.
    (h.setEnabled as Mock).mockRejectedValue(new Error("denied"));
    const row = workflowDefinition();
    h.definitions = [row];
    const { queryClient } = await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    (props("definitions").onToggle as (r: unknown, e: boolean) => void)(row, false);

    await waitFor(() => expect(toast().error).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        spy.mock.calls.some(
          (c) =>
            JSON.stringify((c[0] as { queryKey: unknown }).queryKey) ===
            JSON.stringify(["admin", "workflow-definitions"]),
        ),
      ).toBe(true),
    );
  });

  it("usunięcie melduje sukces i odświeża listę", async () => {
    const row = workflowDefinition();
    h.definitions = [row];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());

    (props("definitions").onDelete as (r: unknown) => void)(row);

    // `deleteWorkflowDefinition` jest przekazane WPROST jako `mutationFn`, wiec
    // react-query dokleja mu drugi argument (kontekst mutacji) - asercja celuje
    // w PIERWSZY argument, bo to on jest kontraktem z warstwa danych.
    await waitFor(() => expect((h.remove as Mock).mock.calls[0]?.[0]).toBe(row.id));
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith("adminWorkflows.common.deleted"),
    );
  });

  it("nieudane usunięcie pokazuje błąd, nie sukces", async () => {
    (h.remove as Mock).mockRejectedValue("goły tekst");
    const row = workflowDefinition();
    h.definitions = [row];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());

    (props("definitions").onDelete as (r: unknown) => void)(row);

    await waitFor(() => expect(toast().error).toHaveBeenCalled());
    expect(String(toast().error.mock.calls[0][0])).toContain("goły tekst");
    expect(toast().success).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Przejścia między zakładkami
// ---------------------------------------------------------------------------

describe("/admin/workflows - przejścia kontekstowe", () => {
  it("pokaz przebiegi z karty przepisu przechodzi na historie Z FILTREM", async () => {
    // Bez przeniesienia id redaktor zobaczyłby przebiegi WSZYSTKICH przepisów
    // pod nagłówkiem jednego.
    const row = workflowDefinition({ id: WF_ID });
    h.definitions = [row];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());

    (props("definitions").onShowRuns as (r: unknown) => void)(row);

    await waitFor(() => expect(screen.getByTestId("runs")).toBeInTheDocument());
    expect((props("runs").filter as { workflowId: string }).workflowId).toBe(WF_ID);
  });

  it("slad z historii przebiegow przechodzi na zakladke sladu z tym id", async () => {
    await render(`${PATH}?tab=runs`);
    await waitFor(() => expect(screen.getByTestId("runs")).toBeInTheDocument());

    (props("runs").onShowTrace as (id: string) => void)(CORRELATION);

    await waitFor(() => expect(screen.getByTestId("trace")).toBeInTheDocument());
    expect(props("trace").correlationId).toBe(CORRELATION);
  });

  it("wyczyszczenie śladu w panelu usuwa parametr z adresu", async () => {
    await render(`${PATH}?tab=trace&correlation=${CORRELATION}`);
    await waitFor(() => expect(props("trace").correlationId).toBe(CORRELATION));

    (props("trace").onCorrelationIdChange as (id: string | null) => void)(null);

    await waitFor(() => expect(props("trace").correlationId).toBeNull());
  });

  it("zmiana filtra w panelu historii wraca do adresu", async () => {
    await render(`${PATH}?tab=runs`);
    await waitFor(() => expect(screen.getByTestId("runs")).toBeInTheDocument());

    (
      props("runs").onFilterChange as (f: {
        workflowId: string | null;
        status: string | null;
      }) => void
    )({ workflowId: WF_ID, status: "failed" });

    await waitFor(() =>
      expect((props("runs").filter as { workflowId: string }).workflowId).toBe(WF_ID),
    );
    expect((props("runs").filter as { status: string }).status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Przekazanie danych do paneli
// ---------------------------------------------------------------------------

describe("/admin/workflows - dane dla paneli", () => {
  it("statystyki przebiegów są policzone i przekazane do listy", async () => {
    // `aggregateRunStats` zostaje ORYGINALNY - to jego wynik trafia na karty.
    h.definitions = [workflowDefinition({ id: WF_ID })];
    h.runs = [
      workflowRun({ id: "r1", workflow_id: WF_ID, status: "failed" }),
      workflowRun({ id: "r2", workflow_id: WF_ID, status: "succeeded" }),
    ];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());

    const stats = props("definitions").stats as Map<string, { total: number; failed: number }>;
    expect(stats.get(WF_ID)).toMatchObject({ total: 2, failed: 1 });
  });

  it("katalog szablonów dostaje TAKŻE definicje (rozpoznanie zainstalowanych)", async () => {
    await render(`${PATH}?tab=templates`);
    await waitFor(() => expect(screen.getByTestId("templates")).toBeInTheDocument());
    expect(props("templates").templates).toHaveLength(1);
    expect(props("templates").definitions).toHaveLength(1);
  });

  it("pusta odpowiedź nie wysypuje strony - panele dostają puste listy", async () => {
    h.definitions = [];
    h.runs = [];
    h.templates = [];
    await render();
    await waitFor(() => expect(screen.getByTestId("definitions")).toBeInTheDocument());
    expect(props("definitions").definitions).toEqual([]);
  });
});
