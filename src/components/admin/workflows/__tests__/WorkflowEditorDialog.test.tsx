// Edytor przepisu „gdy X → zrób Y" (`WorkflowEditorDialog`, 0 z 39 funkcji —
// największy pojedynczy plik powierzchni automatyzacji).
//
// Formularz zapisuje do kolumny `steps`, którą czyta silnik SQL. Cztery rzeczy
// są tu warte testu, bo każda psuje się CICHO:
//
//   1. ŚWIEŻY SNAPSHOT PRZY KAŻDYM OTWARCIU. Dialog żyje w drzewie i jest
//      pokazywany/chowany, więc bez resetu edycja drugiego przepisu startowałaby
//      od stanu pierwszego — i zapis nadpisałby go cudzą treścią.
//   2. TRYB „INNY TYP ZDARZENIA" LICZONY Z `initial`, nie ze stanu. Policzony
//      ze stanu bierze wartość jeszcze SPRZED resetu (stale closure), więc pole
//      własnego typu nie pojawiłoby się dla przepisu, który go używa.
//   3. PARAMETR `roles` TRZYMANY JAKO SUROWY CSV podczas pisania. Podział na
//      tablicę przy każdym naciśnięciu klawisza zjadałby przecinek w chwili,
//      w której redaktor go wpisuje — nie dałoby się wpisać drugiej roli.
//   4. ZMIANA AKCJI ZERUJE PARAMETRY. Katalogi pól są rozłączne; przeniesienie
//      parametru między akcjami wysłałoby do silnika pole, którego jego CASE
//      nie zna — a silnik rzuca wtedy wyjątkiem w środku przebiegu.
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { emptyWorkflowDraft, type WorkflowDraft } from "@/lib/admin/workflows";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-workflows", () => ({}));

import { WorkflowEditorDialog } from "@/components/admin/workflows/WorkflowEditorDialog";

afterEach(cleanup);

type Mock = ReturnType<typeof vi.fn>;

function draftOf(over: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    ...emptyWorkflowDraft(),
    name: "Zgłoszenie do recenzji",
    triggerEventType: "post.status_changed.v1",
    steps: [{ action: "notify_staff", params: {} }],
    ...over,
  };
}

function renderDialog(opts: { initial?: WorkflowDraft; open?: boolean; saving?: boolean } = {}): {
  onSave: Mock;
  onClose: Mock;
  rerenderWith: (d: WorkflowDraft, open?: boolean) => void;
} {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const element = (initial: WorkflowDraft, open: boolean) => (
    <WorkflowEditorDialog
      open={open}
      initial={initial}
      saving={opts.saving ?? false}
      onClose={onClose}
      onSave={onSave}
    />
  );
  const { rerender } = render(element(opts.initial ?? draftOf(), opts.open ?? true));
  return {
    onSave,
    onClose,
    rerenderWith: (d, open = true) => rerender(element(d, open)),
  };
}

/** Otwiera listę Radiksa klawiaturą - pointer events nie działają w happy-dom. */
function openSelect(trigger: HTMLElement): HTMLElement {
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

// ---------------------------------------------------------------------------
// Reset przy otwarciu
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - świeży snapshot przy otwarciu", () => {
  it("otwarcie z INNYM przepisem podmienia całą treść formularza", () => {
    // Bez resetu edycja drugiego przepisu startowałaby od stanu pierwszego,
    // a zapis nadpisałby go cudzą treścią.
    const { rerenderWith } = renderDialog({ initial: draftOf({ name: "Pierwszy" }) });
    expect(screen.getByLabelText("adminWorkflows.editor.name")).toHaveValue("Pierwszy");

    rerenderWith(draftOf({ name: "Drugi", id: "wf-2" }), false);
    rerenderWith(draftOf({ name: "Drugi", id: "wf-2" }), true);

    expect(screen.getByLabelText("adminWorkflows.editor.name")).toHaveValue("Drugi");
  });

  it("nagłówek odróżnia NOWY przepis od edycji istniejącego", () => {
    renderDialog({ initial: draftOf({ id: null }) });
    expect(screen.getByText("adminWorkflows.editor.titleNew")).toBeInTheDocument();
    cleanup();

    renderDialog({ initial: draftOf({ id: "wf-1" }) });
    expect(screen.getByText("adminWorkflows.editor.titleEdit")).toBeInTheDocument();
  });

  it("zamknięty dialog nie renderuje formularza", () => {
    renderDialog({ open: false });
    expect(screen.queryByLabelText("adminWorkflows.editor.name")).toBeNull();
  });

  it("ponowne otwarcie KASUJE niezapisane zmiany poprzedniej sesji", () => {
    const initial = draftOf({ name: "Oryginał" });
    const { rerenderWith } = renderDialog({ initial });
    fireEvent.change(screen.getByLabelText("adminWorkflows.editor.name"), {
      target: { value: "Bazgroły" },
    });

    rerenderWith(initial, false);
    rerenderWith(initial, true);

    expect(screen.getByLabelText("adminWorkflows.editor.name")).toHaveValue("Oryginał");
  });
});

// ---------------------------------------------------------------------------
// Wyzwalacz
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - typ zdarzenia", () => {
  it("przepis o WŁASNYM typie zdarzenia otwiera się z polem tekstowym", () => {
    // Tryb liczony ze stanu (a nie z `initial`) wziąłby wartość sprzed resetu
    // i pole nie pojawiłoby się dla przepisu, który go używa.
    renderDialog({ initial: draftOf({ triggerEventType: "custom.thing.v9" }) });
    expect(screen.getByDisplayValue("custom.thing.v9")).toBeInTheDocument();
  });

  it("przepis o typie ZE SŁOWNIKA nie pokazuje pola własnego typu", () => {
    renderDialog({ initial: draftOf({ triggerEventType: "post.status_changed.v1" }) });
    expect(screen.queryByDisplayValue("post.status_changed.v1")).toBeNull();
  });

  it("nowy przepis (pusty wyzwalacz) też nie pokazuje pola własnego typu", () => {
    renderDialog({ initial: emptyWorkflowDraft() });
    expect(
      screen.queryByPlaceholderText("adminWorkflows.editor.triggerCustomPlaceholder"),
    ).toBeNull();
  });

  it("wybor wlasnego typu pokazuje pole i CZYSCI dotychczasowa wartosc", () => {
    // Zostawienie starej wartości sugerowałoby, że własny typ już jest wpisany.
    renderDialog({ initial: draftOf({ triggerEventType: "post.status_changed.v1" }) });
    const trigger = screen.getAllByRole("combobox")[0];

    fireEvent.click(
      within(openSelect(trigger)).getByRole("option", {
        name: "adminWorkflows.editor.triggerCustom",
      }),
    );

    const custom = screen.getByPlaceholderText("adminWorkflows.editor.triggerCustomPlaceholder");
    expect(custom).toBeInTheDocument();
    expect(custom).toHaveValue("");
  });

  it("powrót na typ ze słownika CHOWA pole własnego typu", () => {
    renderDialog({ initial: draftOf({ triggerEventType: "custom.thing.v9" }) });
    const trigger = screen.getAllByRole("combobox")[0];

    fireEvent.click(
      within(openSelect(trigger)).getByRole("option", { name: "post.status_changed.v1" }),
    );

    expect(
      screen.queryByPlaceholderText("adminWorkflows.editor.triggerCustomPlaceholder"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Walidacja
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - walidacja pojawia się PO próbie zapisu", () => {
  it("pusty formularz nie krzyczy przed pierwszym kliknieciem Zapisz", () => {
    // Czerwone pola od chwili otwarcia nowego przepisu to szum, nie pomoc.
    renderDialog({ initial: emptyWorkflowDraft() });
    expect(screen.queryByText("adminWorkflows.editor.validation.name")).toBeNull();
    expect(screen.queryByText("adminWorkflows.editor.validation.trigger")).toBeNull();
    expect(screen.queryByText("adminWorkflows.editor.validation.steps")).toBeNull();
  });

  it("próba zapisu pustego przepisu pokazuje WSZYSTKIE braki i NIE zapisuje", () => {
    const { onSave } = renderDialog({ initial: emptyWorkflowDraft() });

    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(screen.getByText("adminWorkflows.editor.validation.name")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.editor.validation.trigger")).toBeInTheDocument();
    expect(screen.getByText("adminWorkflows.editor.validation.steps")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("błędne pola są oznaczone dla technologii asystujących", () => {
    renderDialog({ initial: emptyWorkflowDraft() });
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(screen.getByLabelText("adminWorkflows.editor.name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("zdeformowany własny typ zdarzenia jest odrzucany", () => {
    // Kontrakt z CHECK-iem na domain_events: `<agregat>.<czasownik>.v<n>`.
    const { onSave } = renderDialog({ initial: draftOf({ triggerEventType: "byle.co" }) });

    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(screen.getByText("adminWorkflows.editor.validation.trigger")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("warunek z wartością, ale BEZ klucza, jest błędem", () => {
    // Para bez klucza wypada przy serializacji - przepis zapisałby się z inną
    // regułą, niż redaktor widział na ekranie.
    const { onSave } = renderDialog({
      initial: draftOf({ conditionPairs: [{ key: "", value: "pending" }] }),
    });

    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(screen.getByText("adminWorkflows.editor.validation.conditionKey")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("para CAŁKIEM pusta nie blokuje zapisu (świeżo dodany wiersz)", () => {
    const { onSave } = renderDialog({
      initial: draftOf({ conditionPairs: [{ key: "", value: "" }] }),
    });

    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("poprawny przepis jedzie do zapisu W CAŁOŚCI", () => {
    const initial = draftOf({ conditionPairs: [{ key: "new_status", value: "pending_review" }] });
    const { onSave } = renderDialog({ initial });

    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Zgłoszenie do recenzji",
        triggerEventType: "post.status_changed.v1",
        conditionPairs: [{ key: "new_status", value: "pending_review" }],
        steps: [{ action: "notify_staff", params: {} }],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Warunek
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - pary warunku", () => {
  it("dodanie pary daje pustą parę do wypełnienia", () => {
    renderDialog({ initial: draftOf({ conditionPairs: [] }) });
    expect(screen.queryByPlaceholderText("adminWorkflows.editor.conditionKey")).toBeNull();

    fireEvent.click(screen.getByText("adminWorkflows.editor.addCondition"));

    expect(screen.getByPlaceholderText("adminWorkflows.editor.conditionKey")).toHaveValue("");
    expect(screen.getByPlaceholderText("adminWorkflows.editor.conditionValue")).toHaveValue("");
  });

  it("edycja klucza i wartości trafia do zapisywanego draftu", () => {
    const { onSave } = renderDialog({ initial: draftOf({ conditionPairs: [] }) });
    fireEvent.click(screen.getByText("adminWorkflows.editor.addCondition"));

    fireEvent.change(screen.getByPlaceholderText("adminWorkflows.editor.conditionKey"), {
      target: { value: "status" },
    });
    fireEvent.change(screen.getByPlaceholderText("adminWorkflows.editor.conditionValue"), {
      target: { value: "won" },
    });
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ conditionPairs: [{ key: "status", value: "won" }] }),
    );
  });

  it("usunięcie kasuje WŁAŚCIWĄ parę, nie pierwszą z brzegu", () => {
    const { onSave } = renderDialog({
      initial: draftOf({
        conditionPairs: [
          { key: "a", value: "1" },
          { key: "b", value: "2" },
          { key: "c", value: "3" },
        ],
      }),
    });

    fireEvent.click(screen.getAllByLabelText("adminWorkflows.editor.removeCondition")[1]);
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionPairs: [
          { key: "a", value: "1" },
          { key: "c", value: "3" },
        ],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Kroki
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - sekwencja kroków", () => {
  it("dodanie kroku daje domyślną akcję powiadomienia redakcji", () => {
    const { onSave } = renderDialog({ initial: draftOf({ steps: [] }) });

    fireEvent.click(screen.getByText("adminWorkflows.editor.addStep"));
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ steps: [{ action: "notify_staff", params: {} }] }),
    );
  });

  it("kroki są numerowane od 1 (kolejność jest treścią, nie ozdobą)", () => {
    renderDialog({
      initial: draftOf({
        steps: [
          { action: "notify_staff", params: {} },
          { action: "create_crm_lead", params: {} },
        ],
      }),
    });
    expect(screen.getByText(/"index":1/)).toBeInTheDocument();
    expect(screen.getByText(/"index":2/)).toBeInTheDocument();
  });

  it("PIERWSZY krok nie da się przesunąć w górę, OSTATNI w dół", () => {
    // Granice sekwencji - bez blokady przesunięcie poza zakres cicho gubi krok.
    renderDialog({
      initial: draftOf({
        steps: [
          { action: "notify_staff", params: {} },
          { action: "create_crm_lead", params: {} },
        ],
      }),
    });

    expect(screen.getAllByLabelText("adminWorkflows.editor.moveUp")[0]).toBeDisabled();
    expect(screen.getAllByLabelText("adminWorkflows.editor.moveDown")[1]).toBeDisabled();
    expect(screen.getAllByLabelText("adminWorkflows.editor.moveUp")[1]).not.toBeDisabled();
    expect(screen.getAllByLabelText("adminWorkflows.editor.moveDown")[0]).not.toBeDisabled();
  });

  it("przesunięcie w dół ZAMIENIA kroki miejscami", () => {
    const { onSave } = renderDialog({
      initial: draftOf({
        steps: [
          { action: "notify_staff", params: {} },
          { action: "create_crm_lead", params: {} },
        ],
      }),
    });

    fireEvent.click(screen.getAllByLabelText("adminWorkflows.editor.moveDown")[0]);
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          { action: "create_crm_lead", params: {} },
          { action: "notify_staff", params: {} },
        ],
      }),
    );
  });

  it("przesunięcie w górę też zamienia (druga strona tej samej reguły)", () => {
    const { onSave } = renderDialog({
      initial: draftOf({
        steps: [
          { action: "notify_staff", params: {} },
          { action: "create_crm_task", params: {} },
        ],
      }),
    });

    fireEvent.click(screen.getAllByLabelText("adminWorkflows.editor.moveUp")[1]);
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          { action: "create_crm_task", params: {} },
          { action: "notify_staff", params: {} },
        ],
      }),
    );
  });

  it("usunięcie kasuje WŁAŚCIWY krok", () => {
    const { onSave } = renderDialog({
      initial: draftOf({
        steps: [
          { action: "notify_staff", params: {} },
          { action: "create_crm_lead", params: {} },
          { action: "add_cross_reference", params: {} },
        ],
      }),
    });

    fireEvent.click(screen.getAllByLabelText("adminWorkflows.editor.removeStep")[1]);
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [
          { action: "notify_staff", params: {} },
          { action: "add_cross_reference", params: {} },
        ],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Parametry kroku
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - parametry kroku", () => {
  it("formularz parametrów jest generowany z KATALOGU akcji", () => {
    // Katalog jest kontraktem z CASE w `public.run_workflow_step` - pole spoza
    // katalogu trafiłoby do silnika, który go nie zna.
    renderDialog({ initial: draftOf({ steps: [{ action: "create_crm_lead", params: {} }] }) });

    for (const key of ["email_from", "first_name_from", "last_name_from"]) {
      expect(screen.getByText(`adminWorkflows.params.${key}`)).toBeInTheDocument();
    }
    // Pola innej akcji się nie pojawiają.
    expect(screen.queryByText("adminWorkflows.params.target_type")).toBeNull();
  });

  it("ZMIANA AKCJI zeruje parametry poprzedniej", () => {
    // Katalogi pól są rozłączne; przeniesiony parametr trafiłby do silnika,
    // który rzuca wyjątkiem w środku przebiegu.
    const { onSave } = renderDialog({
      initial: draftOf({ steps: [{ action: "notify_user", params: { user_id: "abc" } }] }),
    });

    const actionSelect = screen.getAllByRole("combobox")[1];
    fireEvent.click(
      within(openSelect(actionSelect)).getByRole("option", {
        name: "adminWorkflows.actions.add_cross_reference.name",
      }),
    );
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ steps: [{ action: "add_cross_reference", params: {} }] }),
    );
  });

  it("pole tekstowe zapisuje wartość do parametru", () => {
    const { onSave } = renderDialog({
      initial: draftOf({ steps: [{ action: "add_cross_reference", params: {} }] }),
    });

    fireEvent.change(screen.getByPlaceholderText("post"), { target: { value: "page" } });
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [{ action: "add_cross_reference", params: { target_type: "page" } }],
      }),
    );
  });

  it("przełącznik zapisuje wartość logiczną", () => {
    const { onSave } = renderDialog({
      initial: draftOf({ steps: [{ action: "create_crm_lead", params: {} }] }),
    });

    fireEvent.click(screen.getByLabelText("adminWorkflows.params.newsletter"));
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [{ action: "create_crm_lead", params: { newsletter: true } }],
      }),
    );
  });

  it("parametr `roles` z bazy (tablica) jest pokazany jako lista po przecinku", () => {
    renderDialog({
      initial: draftOf({
        steps: [{ action: "notify_staff", params: { roles: ["admin", "editor"] } }],
      }),
    });
    expect(screen.getByDisplayValue("admin, editor")).toBeInTheDocument();
  });

  it("`roles` w trakcie pisania zostaje SUROWYM tekstem (przecinek nie znika)", () => {
    // Podział na tablicę przy każdym naciśnięciu klawisza zjadałby przecinek
    // w chwili, w której redaktor go wpisuje - nie dałoby się wpisać drugiej
    // roli. Podział robi dopiero `serializeWorkflowSteps` przy zapisie.
    const { onSave } = renderDialog({
      initial: draftOf({ steps: [{ action: "notify_staff", params: {} }] }),
    });

    const input = screen.getByPlaceholderText("admin, editor");
    fireEvent.change(input, { target: { value: "admin," } });
    expect(input).toHaveValue("admin,");

    fireEvent.change(input, { target: { value: "admin, editor" } });
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: [{ action: "notify_staff", params: { roles: "admin, editor" } }],
      }),
    );
  });

  it("parametr nie będący stringiem ani tablicą pokazuje pusty input", () => {
    // Wiersz zapisany ręcznie w bazie nie może wysypać edytora.
    renderDialog({
      initial: draftOf({
        steps: [{ action: "notify_staff", params: { roles: 42 as unknown as string } }],
      }),
    });
    expect(screen.getByPlaceholderText("admin, editor")).toHaveValue("");
  });
});

// ---------------------------------------------------------------------------
// Zamknięcie i stan zapisu
// ---------------------------------------------------------------------------

describe("WorkflowEditorDialog - zamknięcie i zapis w toku", () => {
  it("przycisk anulowania zamyka bez zapisu", () => {
    const { onClose, onSave } = renderDialog();

    fireEvent.click(screen.getByText("adminWorkflows.editor.cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("w trakcie zapisu przycisk zapisu jest zablokowany", () => {
    // Podwójne kliknięcie utworzyłoby DWA przepisy o tej samej treści.
    renderDialog({ saving: true });
    expect(screen.getByText("adminWorkflows.editor.save").closest("button")).toBeDisabled();
  });

  it("przelacznik wlaczenia zapisuje sie w drafcie", () => {
    const { onSave } = renderDialog({ initial: draftOf({ enabled: true }) });

    fireEvent.click(screen.getByLabelText("adminWorkflows.editor.enabled"));
    fireEvent.click(screen.getByText("adminWorkflows.editor.save"));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });
});
