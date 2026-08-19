// Edytor przepisu „gdy X -> zrób Y". Plik stał na 0% mimo 70 mierzonych linii
// i 39 funkcji - najwięcej funkcji na zerze w całym module 2.
//
// Reguły policzalne (kolejność kroków, tryb wyzwalacza, CSV parametrów) mają
// osobny plik: `lib/__tests__/editorDraft.test.ts`. Tutaj sprawdzamy to, co
// widać dopiero w złożeniu: bramkę zapisu, moment pokazania błędów i RESET
// stanu przy otwarciu na innym wierszu.
//
// Radix `<Select>` nie daje się otworzyć w happy-dom (potrzebuje pomiarów
// layoutu), więc wybór akcji i zdarzenia z listy jest sprawdzany przez stan
// początkowy, a nie przez klikanie w rozwijkę. Wszystko poza tym - pola,
// przełączniki, przyciski - jest sterowane normalnie.
import "@/lib/i18n-admin-workflows";
import i18n from "@/lib/i18n";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DOMAIN_EVENT_TYPES } from "@/lib/realtime/domainEvents";
import type { WorkflowDraft } from "@/lib/admin/workflows";
import { WorkflowEditorDialog } from "../WorkflowEditorDialog";

const t = i18n.getFixedT("pl");
const KNOWN_EVENT = DOMAIN_EVENT_TYPES[0];

function draft(over: Partial<WorkflowDraft> = {}): WorkflowDraft {
  return {
    id: null,
    name: "Powiadom redakcję",
    enabled: true,
    triggerEventType: KNOWN_EVENT,
    conditionPairs: [],
    steps: [{ action: "notify_staff", params: {} }],
    ...over,
  };
}

function open(over: Partial<WorkflowDraft> = {}, props: Partial<{ saving: boolean }> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <WorkflowEditorDialog
      open
      initial={draft(over)}
      saving={props.saving ?? false}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { onSave, onClose, view };
}

const saveButton = () => screen.getByRole("button", { name: t("adminWorkflows.editor.save") });
const nameInput = () =>
  screen.getByPlaceholderText(t("adminWorkflows.editor.namePlaceholder")) as HTMLInputElement;

describe("WorkflowEditorDialog - bramka zapisu", () => {
  it("poprawny przepis wychodzi na zewnątrz DOKŁADNIE taki, jak w formularzu", () => {
    const { onSave } = open();
    fireEvent.change(nameInput(), { target: { value: "Nowa nazwa" } });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      name: "Nowa nazwa",
      triggerEventType: KNOWN_EVENT,
      enabled: true,
    });
  });

  it("REGUŁA: przepis z błędem NIE wychodzi na zapis", () => {
    // Silnik czyta `steps` z kolumny `jsonb` - przepis bez kroków zapisałby się
    // bez błędu i cicho nie robiłby nic przy każdym zdarzeniu.
    const { onSave } = open({ steps: [] });
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("błędy pokazują się DOPIERO po próbie zapisu, nie od razu", () => {
    // Świeżo otwarty formularz nowego przepisu jest z definicji niepełny.
    // Czerwony komunikat przy pierwszym renderze uczy ignorowania walidacji.
    open({ name: "", steps: [] });
    expect(screen.queryByText(t("adminWorkflows.editor.validation.name"))).not.toBeInTheDocument();

    fireEvent.click(saveButton());
    expect(screen.getByText(t("adminWorkflows.editor.validation.name"))).toBeInTheDocument();
    expect(screen.getByText(t("adminWorkflows.editor.validation.steps"))).toBeInTheDocument();
  });

  it("poprawienie pola gasi jego komunikat bez ponownej próby zapisu", () => {
    open({ name: "" });
    fireEvent.click(saveButton());
    expect(screen.getByText(t("adminWorkflows.editor.validation.name"))).toBeInTheDocument();

    fireEvent.change(nameInput(), { target: { value: "Ma nazwę" } });
    expect(screen.queryByText(t("adminWorkflows.editor.validation.name"))).not.toBeInTheDocument();
  });

  it("warunek z wartością, ale bez klucza, blokuje zapis", () => {
    // Para bez klucza nie ma jak trafić do `condition` - przepis odpalałby się
    // szerzej, niż redaktor zamierzał.
    const { onSave } = open({ conditionPairs: [{ key: "", value: "published" }] });
    fireEvent.click(saveButton());

    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(t("adminWorkflows.editor.validation.conditionKey")),
    ).toBeInTheDocument();
  });

  it("zapis w toku wyłącza przycisk - jedno kliknięcie, jeden przepis", () => {
    open({}, { saving: true });
    expect(saveButton()).toBeDisabled();
  });

  it("anulowanie zamyka i nie zapisuje", () => {
    const { onSave, onClose } = open();
    fireEvent.click(screen.getByRole("button", { name: t("adminWorkflows.editor.cancel") }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("WorkflowEditorDialog - reset przy otwarciu", () => {
  it("REGRESJA: otwarcie na INNYM wierszu nie wnosi poprzedniej nazwy", () => {
    // Dialog jest jeden na całą listę. Bez resetu redaktor otwiera drugi
    // przepis i widzi nazwę pierwszego - a zapis nadpisuje nią wiersz, którego
    // nie chciał tknąć.
    const { view } = open({ name: "Pierwszy" });
    fireEvent.change(nameInput(), { target: { value: "Zmieniona w locie" } });

    view.rerender(
      <WorkflowEditorDialog
        open
        initial={draft({ name: "Drugi" })}
        saving={false}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(nameInput().value).toBe("Drugi");
  });

  it("reset czyści też pokazane błędy poprzedniego wiersza", () => {
    const { view } = open({ name: "" });
    fireEvent.click(saveButton());
    expect(screen.getByText(t("adminWorkflows.editor.validation.name"))).toBeInTheDocument();

    view.rerender(
      <WorkflowEditorDialog
        open
        initial={draft({ name: "Poprawny" })}
        saving={false}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(screen.queryByText(t("adminWorkflows.editor.validation.name"))).not.toBeInTheDocument();
  });

  it("tytuł odróżnia edycję istniejącego przepisu od zakładania nowego", () => {
    open({ id: "wf-1" });
    expect(screen.getByText(t("adminWorkflows.editor.titleEdit"))).toBeInTheDocument();
  });

  it("nowy przepis ma tytuł zakładania", () => {
    open({ id: null });
    expect(screen.getByText(t("adminWorkflows.editor.titleNew"))).toBeInTheDocument();
  });
});

describe("WorkflowEditorDialog - wyzwalacz spoza katalogu", () => {
  it("zapisany typ własny otwiera się w trybie ręcznym, z widoczną wartością", () => {
    // Bez tego przepis z typem spoza katalogu pokazywałby PUSTY wybierak -
    // wygląda jak utrata konfiguracji i zaprasza do wybrania czegokolwiek.
    open({ triggerEventType: "moje.zdarzenie.v1" });
    expect(
      screen.getByPlaceholderText(t("adminWorkflows.editor.triggerCustomPlaceholder")),
    ).toHaveValue("moje.zdarzenie.v1");
  });

  it("typ z katalogu NIE otwiera pola ręcznego", () => {
    open({ triggerEventType: KNOWN_EVENT });
    expect(
      screen.queryByPlaceholderText(t("adminWorkflows.editor.triggerCustomPlaceholder")),
    ).not.toBeInTheDocument();
  });

  it("nowy przepis (pusty typ) też nie otwiera pola ręcznego", () => {
    open({ triggerEventType: "" });
    expect(
      screen.queryByPlaceholderText(t("adminWorkflows.editor.triggerCustomPlaceholder")),
    ).not.toBeInTheDocument();
  });

  it("wpisany ręcznie typ trafia do zapisu", () => {
    const { onSave } = open({ triggerEventType: "moje.zdarzenie.v1" });
    fireEvent.change(
      screen.getByPlaceholderText(t("adminWorkflows.editor.triggerCustomPlaceholder")),
      {
        target: { value: "inne.zdarzenie.v2" },
      },
    );
    fireEvent.click(saveButton());
    expect(onSave.mock.calls[0][0].triggerEventType).toBe("inne.zdarzenie.v2");
  });
});

describe("WorkflowEditorDialog - warunki", () => {
  it("dodanie warunku daje PUSTĄ parę do wypełnienia", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: t("adminWorkflows.editor.addCondition") }));
    expect(screen.getByPlaceholderText(t("adminWorkflows.editor.conditionKey"))).toHaveValue("");
  });

  it("klucz i wartość zapisują się osobno w tej samej parze", () => {
    const { onSave } = open({ conditionPairs: [{ key: "", value: "" }] });
    fireEvent.change(screen.getByPlaceholderText(t("adminWorkflows.editor.conditionKey")), {
      target: { value: "status" },
    });
    fireEvent.change(screen.getByPlaceholderText(t("adminWorkflows.editor.conditionValue")), {
      target: { value: "published" },
    });
    fireEvent.click(saveButton());

    expect(onSave.mock.calls[0][0].conditionPairs).toEqual([{ key: "status", value: "published" }]);
  });

  it("usunięcie warunku zabiera DOKŁADNIE ten wiersz", () => {
    const { onSave } = open({
      conditionPairs: [
        { key: "status", value: "published" },
        { key: "lang", value: "pl" },
      ],
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: t("adminWorkflows.editor.removeCondition") })[0],
    );
    fireEvent.click(saveButton());

    expect(onSave.mock.calls[0][0].conditionPairs).toEqual([{ key: "lang", value: "pl" }]);
  });
});

describe("WorkflowEditorDialog - sekwencja kroków", () => {
  const twoSteps = [
    { action: "notify_staff" as const, params: {} },
    { action: "create_crm_task" as const, params: {} },
  ];

  it("dodanie kroku dokłada go NA KOŃCU sekwencji", () => {
    // Silnik wykonuje kroki po kolei - wstawienie nowego na początek zmieniłoby
    // zachowanie istniejącego przepisu.
    const { onSave } = open({ steps: [twoSteps[0]] });
    fireEvent.click(screen.getByRole("button", { name: t("adminWorkflows.editor.addStep") }));
    fireEvent.click(saveButton());

    const steps = onSave.mock.calls[0][0].steps;
    expect(steps).toHaveLength(2);
    expect(steps[0].action).toBe("notify_staff");
  });

  it("przesunięcie w dół zamienia kroki miejscami", () => {
    const { onSave } = open({ steps: twoSteps });
    fireEvent.click(
      screen.getAllByRole("button", { name: t("adminWorkflows.editor.moveDown") })[0],
    );
    fireEvent.click(saveButton());

    expect(onSave.mock.calls[0][0].steps.map((s: { action: string }) => s.action)).toEqual([
      "create_crm_task",
      "notify_staff",
    ]);
  });

  it("krańce sekwencji mają wyłączone strzałki", () => {
    open({ steps: twoSteps });
    const up = screen.getAllByRole("button", { name: t("adminWorkflows.editor.moveUp") });
    const down = screen.getAllByRole("button", { name: t("adminWorkflows.editor.moveDown") });
    expect(up[0]).toBeDisabled();
    expect(down[down.length - 1]).toBeDisabled();
    expect(up[1]).not.toBeDisabled();
  });

  it("usunięcie kroku zabiera dokładnie ten krok", () => {
    const { onSave } = open({ steps: twoSteps });
    fireEvent.click(
      screen.getAllByRole("button", { name: t("adminWorkflows.editor.removeStep") })[0],
    );
    fireEvent.click(saveButton());

    expect(onSave.mock.calls[0][0].steps.map((s: { action: string }) => s.action)).toEqual([
      "create_crm_task",
    ]);
  });

  it("numeracja kroków jest liczona od 1, nie od 0", () => {
    open({ steps: twoSteps });
    expect(
      screen.getByText(t("adminWorkflows.editor.stepLabel", { index: 1 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("adminWorkflows.editor.stepLabel", { index: 2 })),
    ).toBeInTheDocument();
  });
});

describe("WorkflowEditorDialog - przełącznik aktywności", () => {
  it("wyłączenie przepisu trafia do zapisu", () => {
    // Wyłączony przepis zostaje w bazie, ale nie odpala się - to jedyny sposób
    // zatrzymania automatu bez kasowania jego historii.
    const { onSave } = open({ enabled: true });
    fireEvent.click(screen.getByLabelText(t("adminWorkflows.editor.enabled")));
    fireEvent.click(saveButton());
    expect(onSave.mock.calls[0][0].enabled).toBe(false);
  });
});
