// Lista przepisów automatyzacji (`WorkflowDefinitionsPanel`, 0 z 7 funkcji).
//
// To ekran, na którym redaktor decyduje, CZY dana automatyzacja działa. Trzy
// rzeczy muszą się na nim zgadzać, bo pomyłka jest niewidoczna aż do awarii:
//
//   1. PRZEŁĄCZNIK MUSI NIEŚĆ NOWĄ WARTOŚĆ, nie starą. Odwrócenie tego jednego
//      argumentu daje przełącznik, który „nie działa" albo - gorzej - wyłącza
//      przepis, gdy redaktor go włącza.
//   2. USUNIĘCIE JEST POTWIERDZANE, a potwierdzenie wymienia NAZWĘ przepisu.
//      Przepisy różnią się często jednym słowem; usunięcie nie ma cofnięcia.
//   3. WARUNEK PUSTY ZNACZY „ZAWSZE" i musi to być napisane wprost. Puste pole
//      wygląda jak brak danych, a znaczy „ten przepis odpala się przy KAŻDYM
//      zdarzeniu tego typu" - czyli dokładnie odwrotnie niż „nic nie robi".
import { describe, expect, it, vi, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { workflowDefinition, workflowRunStats, BASE_ISO } from "@/test/post-editor/fixtures";
import type { WorkflowDefinitionRow, WorkflowRunStats } from "@/lib/admin/workflows";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-workflows", () => ({}));

import { WorkflowDefinitionsPanel } from "@/components/admin/workflows/WorkflowDefinitionsPanel";

afterEach(cleanup);

/**
 * Atrapy typowane SYGNATURA PROPU, nie golym `vi.fn()`. Goly `vi.fn()` ma typ
 * `Mock<Procedure | Constructable>`, ktorego TypeScript nie przyjmuje w miejsce
 * `(row: WorkflowDefinitionRow) => void` - a to wlasnie zgodnosc z ta sygnatura
 * chcemy tu dowiesc.
 */
interface Handlers {
  onCreate: Mock<() => void>;
  onEdit: Mock<(row: WorkflowDefinitionRow) => void>;
  onDelete: Mock<(row: WorkflowDefinitionRow) => void>;
  onToggle: Mock<(row: WorkflowDefinitionRow, enabled: boolean) => void>;
  onShowRuns: Mock<(row: WorkflowDefinitionRow) => void>;
}

function renderPanel(
  opts: {
    definitions?: WorkflowDefinitionRow[];
    stats?: Map<string, WorkflowRunStats>;
    loading?: boolean;
  } = {},
): Handlers {
  const handlers: Handlers = {
    onCreate: vi.fn<() => void>(),
    onEdit: vi.fn<(row: WorkflowDefinitionRow) => void>(),
    onDelete: vi.fn<(row: WorkflowDefinitionRow) => void>(),
    onToggle: vi.fn<(row: WorkflowDefinitionRow, enabled: boolean) => void>(),
    onShowRuns: vi.fn<(row: WorkflowDefinitionRow) => void>(),
  };
  render(
    <WorkflowDefinitionsPanel
      definitions={opts.definitions ?? [workflowDefinition()]}
      stats={opts.stats ?? new Map()}
      loading={opts.loading ?? false}
      {...handlers}
    />,
  );
  return handlers;
}

// ---------------------------------------------------------------------------
// Stan pusty
// ---------------------------------------------------------------------------

describe("WorkflowDefinitionsPanel - stan pusty", () => {
  it("brak przepisów pokazuje zachętę Z PRZYCISKIEM tworzenia", () => {
    // Pusty ekran bez drogi dalej zostawia redaktora bez pojęcia, co zrobić.
    const h = renderPanel({ definitions: [] });
    expect(screen.getByText("adminWorkflows.definitions.empty")).toBeInTheDocument();

    fireEvent.click(screen.getByText("adminWorkflows.definitions.newRecipe"));
    expect(h.onCreate).toHaveBeenCalledTimes(1);
  });

  it("podczas ŁADOWANIA nie pokazuje stanu pustego", () => {
    // Migający komunikat „brak przepisów" przy każdym wejściu sugerowałby, że
    // automatyzacje zniknęły.
    renderPanel({ definitions: [], loading: true });
    expect(screen.queryByText("adminWorkflows.definitions.empty")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Karta przepisu
// ---------------------------------------------------------------------------

describe("WorkflowDefinitionsPanel - karta przepisu", () => {
  it("pokazuje nazwę, wyzwalacz i kroki", () => {
    renderPanel();
    expect(screen.getByText(workflowDefinition().name)).toBeInTheDocument();
    expect(screen.getByText("post.status_changed.v1")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.actions.notify_staff.name")).toBeInTheDocument();
  });

  it("warunek jest wypisany jako pary klucz = wartość", () => {
    renderPanel();
    expect(screen.getByText("new_status = pending_review")).toBeInTheDocument();
  });

  it("PUSTY warunek mówi wprost „zawsze”, zamiast zostawić puste miejsce", () => {
    // Puste pole wygląda jak brak danych, a znaczy „odpala się przy KAŻDYM
    // zdarzeniu tego typu".
    renderPanel({ definitions: [workflowDefinition({ condition: {} })] });
    expect(screen.getByText("adminWorkflows.definitions.conditionNone")).toBeInTheDocument();
  });

  it("odróżnia przepis Z KATALOGU od własnego", () => {
    // Przepis z katalogu jest re-instalowalny i aktualizowany centralnie;
    // własny nie. Redaktor musi wiedzieć, który edytuje.
    renderPanel({ definitions: [workflowDefinition({ template_key: "comment-pending" })] });
    expect(screen.getByText("adminWorkflows.definitions.fromTemplate")).toBeInTheDocument();
    cleanup();

    renderPanel({ definitions: [workflowDefinition({ template_key: null })] });
    expect(screen.getByText("adminWorkflows.definitions.custom")).toBeInTheDocument();
  });

  it("statystyki okna: liczba przebiegów i data ostatniego", () => {
    const stats = new Map([[workflowDefinition().id, workflowRunStats({ total: 7 })]]);
    renderPanel({ stats });
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(BASE_ISO);
  });

  it("przepis bez przebiegów pokazuje zero i „nigdy”, nie pustkę", () => {
    renderPanel({ stats: new Map() });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.common.never")).toBeInTheDocument();
  });

  it("BŁĘDY przebiegów są wyróżnione liczbą", () => {
    // Przepis, który odpala się i pada, wygląda z listy tak samo jak działający.
    const stats = new Map([[workflowDefinition().id, workflowRunStats({ failed: 3 })]]);
    renderPanel({ stats });
    expect(screen.getByText(/adminWorkflows\.definitions\.failures/)).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("zero błędów NIE pokazuje plakietki awarii", () => {
    const stats = new Map([[workflowDefinition().id, workflowRunStats({ failed: 0 })]]);
    renderPanel({ stats });
    expect(screen.queryByText(/adminWorkflows\.definitions\.failures/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Akcje
// ---------------------------------------------------------------------------

describe("WorkflowDefinitionsPanel - akcje", () => {
  it("przełącznik przekazuje NOWĄ wartość, nie obecną", () => {
    // Odwrócenie tego argumentu daje przełącznik wyłączający przepis w chwili,
    // gdy redaktor go włącza - i odwrotnie.
    const row = workflowDefinition({ enabled: true });
    const h = renderPanel({ definitions: [row] });

    fireEvent.click(screen.getByRole("switch"));

    expect(h.onToggle).toHaveBeenCalledWith(row, false);
  });

  it("przełącznik wyłączonego przepisu włącza go", () => {
    const row = workflowDefinition({ enabled: false });
    const h = renderPanel({ definitions: [row] });

    fireEvent.click(screen.getByRole("switch"));

    expect(h.onToggle).toHaveBeenCalledWith(row, true);
  });

  it("etykieta przełącznika opisuje STAN OBECNY", () => {
    renderPanel({ definitions: [workflowDefinition({ enabled: true })] });
    expect(screen.getByRole("switch")).toHaveAttribute(
      "aria-label",
      "adminWorkflows.common.enabled",
    );
    cleanup();

    renderPanel({ definitions: [workflowDefinition({ enabled: false })] });
    expect(screen.getByRole("switch")).toHaveAttribute(
      "aria-label",
      "adminWorkflows.common.disabled",
    );
  });

  it("edycja i historia przebiegów przekazują CAŁY wiersz", () => {
    const row = workflowDefinition();
    const h = renderPanel({ definitions: [row] });

    fireEvent.click(screen.getByLabelText("adminWorkflows.definitions.edit"));
    expect(h.onEdit).toHaveBeenCalledWith(row);

    fireEvent.click(screen.getByText("adminWorkflows.definitions.showRuns"));
    expect(h.onShowRuns).toHaveBeenCalledWith(row);
  });

  it("usunięcie NIE dzieje się od razu - najpierw potwierdzenie z NAZWĄ", () => {
    // Przepisy różnią się często jednym słowem, a usunięcia nie da się cofnąć.
    const row = workflowDefinition();
    const h = renderPanel({ definitions: [row] });

    fireEvent.click(screen.getByLabelText("adminWorkflows.definitions.delete"));

    expect(h.onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText("adminWorkflows.definitions.deleteConfirmTitle"),
    ).toBeInTheDocument();
    // Nazwa jedzie do komunikatu jako parametr interpolacji.
    expect(within(dialog).getByText(new RegExp(row.name))).toBeInTheDocument();
  });

  it("potwierdzenie usuwa, anulowanie NIE", () => {
    const row = workflowDefinition();
    const h = renderPanel({ definitions: [row] });

    fireEvent.click(screen.getByLabelText("adminWorkflows.definitions.delete"));
    fireEvent.click(screen.getByText("adminWorkflows.definitions.cancel"));
    expect(h.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("adminWorkflows.definitions.delete"));
    fireEvent.click(screen.getByText("adminWorkflows.definitions.deleteConfirm"));
    expect(h.onDelete).toHaveBeenCalledWith(row);
  });

  it("każdy przepis ma WŁASNY komplet akcji", () => {
    // Wspólny stan dialogu między kartami usuwałby nie ten przepis, co trzeba.
    const a = workflowDefinition({ id: "wf-a", name: "Przepis A" });
    const b = workflowDefinition({ id: "wf-b", name: "Przepis B" });
    const h = renderPanel({ definitions: [a, b] });

    expect(screen.getAllByRole("switch")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("adminWorkflows.definitions.edit")[1]);
    expect(h.onEdit).toHaveBeenCalledWith(b);
  });
});
