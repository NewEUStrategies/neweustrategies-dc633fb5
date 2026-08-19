// Historia przebiegów silnika (`WorkflowRunsPanel`, 0 z 8 funkcji).
//
// To narzędzie diagnostyczne: „dlaczego ta automatyzacja się nie odpaliła"
// zaczyna się tutaj. Trzy rzeczy muszą być prawdziwe, żeby odpowiedź była
// wiarygodna:
//
//   1. FILTR MUSI DOJŚĆ DO ZAPYTANIA. Filtr, który zmienia tylko wygląd selecta,
//      pokazuje przebiegi INNEGO przepisu pod nazwą wybranego — najgorszy
//      możliwy wynik w narzędziu diagnostycznym.
//   2. PRZEBIEG USUNIĘTEGO PRZEPISU MUSI ZOSTAĆ WIDOCZNY. Historia jest zapisem
//      tego, co się WYDARZYŁO; zniknięcie wierszy po usunięciu przepisu
//      kasowałoby dowód.
//   3. LINK „ŚLAD" TYLKO PRZY correlation_id. Przycisk prowadzący do pustego
//      śladu wygląda jak awaria panelu, a jest brakiem danych w wierszu.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { workflowDefinition, workflowRun } from "@/test/post-editor/fixtures";
import type { WorkflowDefinitionRow } from "@/lib/admin/workflows";

const h = vi.hoisted(() => ({ fetchRuns: null as unknown }));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-workflows", () => ({}));

vi.mock("@/lib/admin/workflows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/workflows")>();
  const { vi: v } = await import("vitest");
  h.fetchRuns = v.fn(async () => [] as unknown[]);
  return { ...actual, fetchWorkflowRuns: h.fetchRuns };
});

import { WorkflowRunsPanel } from "@/components/admin/workflows/WorkflowRunsPanel";

type Mock = ReturnType<typeof vi.fn>;
const fetchRuns = () => h.fetchRuns as Mock;

type Filter = { workflowId: string | null; status: "succeeded" | "failed" | null };

function renderPanel(opts: { definitions?: WorkflowDefinitionRow[]; filter?: Filter } = {}): {
  onFilterChange: Mock;
  onShowTrace: Mock;
} {
  const onFilterChange = vi.fn();
  const onShowTrace = vi.fn();
  renderWithQueryClient(
    <WorkflowRunsPanel
      definitions={opts.definitions ?? [workflowDefinition()]}
      filter={opts.filter ?? { workflowId: null, status: null }}
      onFilterChange={onFilterChange}
      onShowTrace={onShowTrace}
    />,
  );
  return { onFilterChange, onShowTrace };
}

beforeEach(() => {
  fetchRuns().mockReset();
  fetchRuns().mockResolvedValue([workflowRun()]);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Filtr -> zapytanie
// ---------------------------------------------------------------------------

describe("WorkflowRunsPanel - filtr dociera do zapytania", () => {
  it("brak filtrów pyta o WSZYSTKO, z limitem okna", async () => {
    renderPanel();
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalled());
    // Bez `workflowId`/`status` w parametrach - nie `undefined` przekazane jawnie.
    expect(fetchRuns()).toHaveBeenCalledWith({ limit: 200 });
  });

  it("wybrany przepis trafia do zapytania jako workflowId", async () => {
    // Filtr, który zmienia tylko wygląd selecta, pokazywałby przebiegi INNEGO
    // przepisu pod nazwą wybranego.
    renderPanel({ filter: { workflowId: "wf-77", status: null } });
    await waitFor(() =>
      expect(fetchRuns()).toHaveBeenCalledWith({ limit: 200, workflowId: "wf-77" }),
    );
  });

  it("wybrany status trafia do zapytania", async () => {
    renderPanel({ filter: { workflowId: null, status: "failed" } });
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalledWith({ limit: 200, status: "failed" }));
  });

  it("oba filtry naraz jadą razem", async () => {
    renderPanel({ filter: { workflowId: "wf-77", status: "succeeded" } });
    await waitFor(() =>
      expect(fetchRuns()).toHaveBeenCalledWith({
        limit: 200,
        workflowId: "wf-77",
        status: "succeeded",
      }),
    );
  });

  it("zmiana filtra to NOWY klucz zapytania (nie odczyt z cache poprzedniego)", async () => {
    // Wspólny klucz dla różnych filtrów pokazywałby wyniki poprzedniego filtra.
    // Montujemy wlasnego providera, bo `rerender` z RTL renderuje przekazany
    // element BEZ opakowania uzytego przy pierwszym renderze.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const panel = (filter: Filter) => (
      <QueryClientProvider client={client}>
        <WorkflowRunsPanel
          definitions={[workflowDefinition()]}
          filter={filter}
          onFilterChange={vi.fn()}
          onShowTrace={vi.fn()}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(panel({ workflowId: null, status: null }));
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalledTimes(1));

    rerender(panel({ workflowId: "wf-77", status: null }));

    await waitFor(() => expect(fetchRuns()).toHaveBeenCalledTimes(2));
  });
});

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

describe("WorkflowRunsPanel - tabela przebiegów", () => {
  it("pusta historia pokazuje komunikat, nie pustą tabelę", async () => {
    fetchRuns().mockResolvedValue([]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("adminWorkflows.runs.empty")).toBeInTheDocument());
  });

  it("wiersz niesie datę, nazwę przepisu, typ zdarzenia, status i liczbę kroków", async () => {
    fetchRuns().mockResolvedValue([workflowRun({ steps_completed: 4 })]);
    renderPanel();

    await waitFor(() => expect(screen.getByText(workflowDefinition().name)).toBeInTheDocument());
    expect(screen.getByText("post.published.v1")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.runs.statusSucceeded")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("przebieg USUNIĘTEGO przepisu zostaje w historii z etykietą zastępczą", async () => {
    // Historia jest zapisem tego, co się WYDARZYŁO. Zniknięcie wierszy po
    // usunięciu przepisu kasowałoby dowód, że automatyzacja kiedyś działała.
    fetchRuns().mockResolvedValue([workflowRun({ workflow_definitions: null })]);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.runs.deletedWorkflow")).toBeInTheDocument(),
    );
  });

  it("błąd przebiegu jest widoczny w wierszu i w podpowiedzi", async () => {
    // Bez treści błędu wiersz mówi tylko „nie udało się" - a redaktor musi
    // wiedzieć, CZY to jego warunek, czy awaria integracji.
    fetchRuns().mockResolvedValue([
      workflowRun({ status: "failed", error: "unknown action: wyslij_gołębia" }),
    ]);
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("unknown action: wyslij_gołębia")).toBeInTheDocument(),
    );
    expect(screen.getByTitle("unknown action: wyslij_gołębia")).toBeInTheDocument();
  });

  it("przebieg bez błędu nie renderuje pustego znaku w kolumnie błędu", async () => {
    fetchRuns().mockResolvedValue([workflowRun({ error: null })]);
    renderPanel();
    await waitFor(() => expect(screen.getByText("post.published.v1")).toBeInTheDocument());
    expect(screen.queryByText("null")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ślad korelacji
// ---------------------------------------------------------------------------

describe("WorkflowRunsPanel - przejście do śladu", () => {
  it("przebieg Z correlation_id ma przycisk, który przekazuje TO id", async () => {
    const run = workflowRun({ correlation_id: "corr-abc" });
    fetchRuns().mockResolvedValue([run]);
    const { onShowTrace } = renderPanel();

    await waitFor(() => expect(screen.getByText("adminWorkflows.runs.trace")).toBeInTheDocument());
    fireEvent.click(screen.getByText("adminWorkflows.runs.trace"));

    expect(onShowTrace).toHaveBeenCalledWith("corr-abc");
  });

  it("przebieg BEZ correlation_id nie ma przycisku śladu", async () => {
    // Przycisk prowadzący do pustego śladu wygląda jak awaria panelu, a jest
    // brakiem danych w wierszu.
    fetchRuns().mockResolvedValue([workflowRun({ correlation_id: null })]);
    renderPanel();

    await waitFor(() => expect(screen.getByText("post.published.v1")).toBeInTheDocument());
    expect(screen.queryByText("adminWorkflows.runs.trace")).toBeNull();
  });

  it("każdy wiersz prowadzi do WŁASNEGO śladu", async () => {
    fetchRuns().mockResolvedValue([
      workflowRun({ id: "r1", correlation_id: "corr-1" }),
      workflowRun({ id: "r2", correlation_id: "corr-2" }),
    ]);
    const { onShowTrace } = renderPanel();

    await waitFor(() => expect(screen.getAllByText("adminWorkflows.runs.trace")).toHaveLength(2));
    fireEvent.click(screen.getAllByText("adminWorkflows.runs.trace")[1]);

    expect(onShowTrace).toHaveBeenCalledWith("corr-2");
  });
});

// ---------------------------------------------------------------------------
// Odświeżenie
// ---------------------------------------------------------------------------

describe("WorkflowRunsPanel - odświeżenie", () => {
  it("przycisk odświeżania ponawia zapytanie", async () => {
    renderPanel();
    // Czekamy na WYRENDEROWANE dane, nie na samo wywolanie zapytania: w trakcie
    // pobierania przycisk odswiezania jest zablokowany, wiec klik bylby pusty.
    await waitFor(() => expect(screen.getByText("post.published.v1")).toBeInTheDocument());

    fireEvent.click(screen.getByText("adminWorkflows.runs.refresh"));

    await waitFor(() => expect(fetchRuns()).toHaveBeenCalledTimes(2));
  });

  it("w trakcie pobierania przycisk jest zablokowany", async () => {
    fetchRuns().mockImplementation(() => new Promise(() => {}));
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText("adminWorkflows.runs.refresh").closest("button")).toBeDisabled(),
    );
  });
});

// ---------------------------------------------------------------------------
// Zmiana filtra przez interfejs (nie przez prop)
// ---------------------------------------------------------------------------

/** Otwiera listę Radiksa klawiaturą - pointer events nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

describe("WorkflowRunsPanel - wybór filtra zgłasza się w GÓRĘ", () => {
  it("wybór przepisu przekazuje jego id, zachowując filtr statusu", async () => {
    // Filtr jest stanem TRASY (deep-link), więc panel go tylko zgłasza.
    // Zgubienie drugiego pola przy zmianie pierwszego kasowałoby wybór
    // użytkownika bez żadnego sygnału.
    const def = workflowDefinition({ id: "wf-alfa", name: "Przepis Alfa" });
    const { onFilterChange } = renderPanel({
      definitions: [def],
      filter: { workflowId: null, status: "failed" },
    });
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalled());

    const trigger = screen.getAllByRole("combobox")[0];
    fireEvent.click(within(openSelect(trigger)).getByRole("option", { name: "Przepis Alfa" }));

    expect(onFilterChange).toHaveBeenCalledWith({ workflowId: "wf-alfa", status: "failed" });
  });

  it("wybor wszystkich przepisow czysci filtr do null, nie do pustego stringa", async () => {
    // Pusty string trafiłby do zapytania jako `workflowId: ""` i nie
    // dopasowałby żadnego wiersza - lista wyglądałaby na pustą.
    const { onFilterChange } = renderPanel({
      filter: { workflowId: "wf-alfa", status: null },
    });
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalled());

    const trigger = screen.getAllByRole("combobox")[0];
    fireEvent.click(
      within(openSelect(trigger)).getByRole("option", {
        name: "adminWorkflows.runs.allWorkflows",
      }),
    );

    expect(onFilterChange).toHaveBeenCalledWith({ workflowId: null, status: null });
  });

  it("wybor statusu nieudane i udane przekazuje wlasciwa wartosc", async () => {
    const { onFilterChange } = renderPanel({ filter: { workflowId: null, status: null } });
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalled());

    const statusTrigger = screen.getAllByRole("combobox")[1];
    fireEvent.click(
      within(openSelect(statusTrigger)).getByRole("option", {
        name: "adminWorkflows.runs.statusFailed",
      }),
    );
    expect(onFilterChange).toHaveBeenCalledWith({ workflowId: null, status: "failed" });

    onFilterChange.mockClear();
    fireEvent.click(
      within(openSelect(screen.getAllByRole("combobox")[1])).getByRole("option", {
        name: "adminWorkflows.runs.statusSucceeded",
      }),
    );
    expect(onFilterChange).toHaveBeenCalledWith({ workflowId: null, status: "succeeded" });
  });

  it("wybor wszystkich statusow czysci filtr statusu do null", async () => {
    const { onFilterChange } = renderPanel({ filter: { workflowId: null, status: "failed" } });
    await waitFor(() => expect(fetchRuns()).toHaveBeenCalled());

    const statusTrigger = screen.getAllByRole("combobox")[1];
    fireEvent.click(
      within(openSelect(statusTrigger)).getByRole("option", {
        name: "adminWorkflows.runs.allStatuses",
      }),
    );

    expect(onFilterChange).toHaveBeenCalledWith({ workflowId: null, status: null });
  });
});
