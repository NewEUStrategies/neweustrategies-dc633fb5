// Katalog gotowych przepisów (`WorkflowTemplatesPanel`, 0 z 8 funkcji).
//
// Instalacja idzie przez RPC `install_workflow_template` (SECURITY DEFINER,
// idempotentne per tenant+template_key). Dwie rzeczy są tu warte testu:
//
//   1. ROZPOZNANIE „JUŻ ZAINSTALOWANY". Szablon uznajemy za zainstalowany, gdy
//      w tenancie istnieje definicja z jego `template_key` — NIEZALEŻNIE od
//      `enabled`. Gdyby liczył się tylko przepis włączony, redaktor, który
//      świadomie wyłączył automatyzację, zobaczyłby przycisk „Zainstaluj"
//      i re-aktywował ją jednym kliknięciem, nie wiedząc o tym.
//   2. DWUJĘZYCZNOŚĆ Z DANYCH, NIE ZE SŁOWNIKA. Nazwy i opisy szablonów żyją
//      w kolumnach `name_pl`/`name_en`, więc bramka i18n ich nie pilnuje —
//      pilnuje ich ten test.
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { workflowDefinition, workflowTemplate } from "@/test/post-editor/fixtures";
import type { WorkflowDefinitionRow, WorkflowTemplateRow } from "@/lib/admin/workflows";

const h = vi.hoisted(() => ({
  language: "pl" as string,
  install: null as unknown,
  toast: null as unknown,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(() => h.language),
);
vi.mock("@/lib/i18n-admin-workflows", () => ({}));

vi.mock("sonner", async () => {
  const { toastStub } = await import("@/test/post-editor/fixtures");
  const toast = toastStub();
  h.toast = toast;
  return { toast, Toaster: () => null };
});

// Zachowujemy czyste helpery z oryginału (StepChips woła `parseWorkflowSteps`),
// a atrapujemy WYŁĄCZNIE wywołanie RPC instalacji.
vi.mock("@/lib/admin/workflows", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/admin/workflows")>();
  const { vi: v } = await import("vitest");
  h.install = v.fn(async () => "wf-new");
  return { ...actual, installWorkflowTemplate: h.install };
});

import { WorkflowTemplatesPanel } from "@/components/admin/workflows/WorkflowTemplatesPanel";

type Mock = ReturnType<typeof vi.fn>;
const install = () => h.install as Mock;
const toast = () => h.toast as Record<string, Mock>;

function renderPanel(
  opts: {
    templates?: WorkflowTemplateRow[];
    definitions?: WorkflowDefinitionRow[];
    loading?: boolean;
  } = {},
) {
  return renderWithQueryClient(
    <WorkflowTemplatesPanel
      templates={opts.templates ?? [workflowTemplate()]}
      definitions={opts.definitions ?? []}
      loading={opts.loading ?? false}
    />,
  );
}

beforeEach(() => {
  h.language = "pl";
  install().mockReset();
  install().mockResolvedValue("wf-new");
  for (const fn of Object.values(toast())) fn.mockReset();
});

afterEach(cleanup);

describe("WorkflowTemplatesPanel - stany", () => {
  it("pusty katalog pokazuje komunikat", () => {
    renderPanel({ templates: [] });
    expect(screen.getByText("adminWorkflows.templates.empty")).toBeInTheDocument();
  });

  it("podczas ładowania NIE pokazuje stanu pustego", () => {
    renderPanel({ templates: [], loading: true });
    expect(screen.queryByText("adminWorkflows.templates.empty")).toBeNull();
  });

  it("karta szablonu pokazuje wyzwalacz i kroki", () => {
    renderPanel();
    expect(screen.getByText("comment.created.v1")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.actions.notify_staff.name")).toBeInTheDocument();
  });
});

describe("WorkflowTemplatesPanel - dwujęzyczność z danych", () => {
  it("panel po polsku czyta name_pl i description_pl", () => {
    h.language = "pl";
    renderPanel();
    expect(screen.getByText(workflowTemplate().name_pl as string)).toBeInTheDocument();
    expect(screen.getByText(workflowTemplate().description_pl as string)).toBeInTheDocument();
  });

  it("panel po angielsku czyta name_en i description_en", () => {
    // Te teksty żyją w KOLUMNACH, nie w słowniku - bramka i18n ich nie widzi.
    h.language = "en";
    renderPanel();
    expect(screen.getByText(workflowTemplate().name_en as string)).toBeInTheDocument();
    expect(screen.getByText(workflowTemplate().description_en as string)).toBeInTheDocument();
  });
});

describe("WorkflowTemplatesPanel - rozpoznanie zainstalowanego", () => {
  it("szablon NIEzainstalowany ma przycisk instalacji", () => {
    renderPanel({ definitions: [] });
    expect(screen.getByText("adminWorkflows.templates.install")).toBeInTheDocument();
    expect(screen.queryByText("adminWorkflows.templates.installed")).toBeNull();
  });

  it("szablon zainstalowany ma plakietkę zamiast przycisku", () => {
    renderPanel({
      definitions: [workflowDefinition({ template_key: workflowTemplate().key })],
    });
    expect(screen.getByText("adminWorkflows.templates.installed")).toBeInTheDocument();
    expect(screen.queryByText("adminWorkflows.templates.install")).toBeNull();
  });

  it("szablon zainstalowany, ale WYŁĄCZONY, dalej liczy się jako zainstalowany", () => {
    // Gdyby liczył się tylko przepis włączony, redaktor, który świadomie
    // wyłączył automatyzację, zobaczyłby „Zainstaluj" i re-aktywował ją jednym
    // kliknięciem, nie wiedząc o tym.
    renderPanel({
      definitions: [workflowDefinition({ template_key: workflowTemplate().key, enabled: false })],
    });
    expect(screen.getByText("adminWorkflows.templates.installed")).toBeInTheDocument();
  });

  it("definicja WŁASNA (template_key: null) nie blokuje żadnego szablonu", () => {
    // `null` w zbiorze kluczy fałszywie oznaczyłby szablony jako zainstalowane.
    renderPanel({ definitions: [workflowDefinition({ template_key: null })] });
    expect(screen.getByText("adminWorkflows.templates.install")).toBeInTheDocument();
  });

  it("zainstalowany INNY szablon nie blokuje tego", () => {
    renderPanel({ definitions: [workflowDefinition({ template_key: "zupelnie-inny" })] });
    expect(screen.getByText("adminWorkflows.templates.install")).toBeInTheDocument();
  });
});

describe("WorkflowTemplatesPanel - instalacja", () => {
  it("klik instaluje szablon PO JEGO KLUCZU i melduje sukces", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("adminWorkflows.templates.install"));

    // `mutate()` jest asynchroniczne - `mutationFn` startuje dopiero w kolejnym
    // takcie, więc asercja na wywołanie RPC musi zaczekać.
    await waitFor(() => expect(install()).toHaveBeenCalledWith(workflowTemplate().key));
    await waitFor(() =>
      expect(toast().success).toHaveBeenCalledWith("adminWorkflows.templates.installedToast"),
    );
  });

  it("po instalacji odświeża listę definicji", async () => {
    // Bez tej inwalidacji zakładka „Przepisy" nie pokazałaby świeżo
    // zainstalowanej automatyzacji do czasu przeładowania strony.
    const { queryClient } = renderPanel();
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByText("adminWorkflows.templates.install"));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["admin", "workflow-definitions"] }),
      ),
    );
  });

  it("błąd instalacji jest POKAZANY, nie zjedzony", async () => {
    install().mockRejectedValue(new Error("brak uprawnień"));
    renderPanel();

    fireEvent.click(screen.getByText("adminWorkflows.templates.install"));

    await waitFor(() => expect(toast().error).toHaveBeenCalled());
    const message = String(toast().error.mock.calls[0][0]);
    expect(message).toContain("adminWorkflows.common.error");
    expect(message).toContain("brak uprawnień");
    expect(toast().success).not.toHaveBeenCalled();
  });

  it("błąd nie będący instancją Error też ma czytelny komunikat", async () => {
    install().mockRejectedValue("goły tekst z serwera");
    renderPanel();

    fireEvent.click(screen.getByText("adminWorkflows.templates.install"));

    await waitFor(() => expect(toast().error).toHaveBeenCalled());
    expect(String(toast().error.mock.calls[0][0])).toContain("goły tekst z serwera");
  });

  it("w trakcie instalacji przyciski są zablokowane (brak podwójnej instalacji)", async () => {
    install().mockImplementation(() => new Promise(() => {}));
    renderPanel({
      templates: [workflowTemplate(), workflowTemplate({ key: "drugi", name_pl: "Drugi" })],
    });

    const buttons = screen.getAllByText("adminWorkflows.templates.install");
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      for (const b of screen.getAllByText("adminWorkflows.templates.install")) {
        expect(b.closest("button")).toBeDisabled();
      }
    });
  });
});
