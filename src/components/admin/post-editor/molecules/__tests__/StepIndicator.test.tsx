// Wskaźnik kroków edytora wpisu: 1 (Szczegóły) -> 2 (Treść).
//
// CO TU DOWODZIMY: że oba kroki są KLIKALNE w obie strony (skok wprzód i powrót)
// i że każdy przycisk zgłasza swój krok, niezależnie od kroku aktywnego.
//
// DLACZEGO TO WAŻNE: to jedyna nawigacja między metadanymi wpisu a jego treścią.
// Przycisk zgłaszający zły krok albo działający tylko w jedną stronę zamyka
// redakcję w połowie edytora - a ponieważ krok jest stanem lokalnym strony, taka
// pomyłka wygląda jak „edytor się zawiesił".
//
// Dodatkowo pilnujemy dwóch rzeczy, które w tym pliku są dziś NIEZAŁATANE
// (świadkowie defektów niżej): braku programowego stanu kroku i braku
// `type="button"`.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { EditorStep } from "@/components/admin/post-editor/types";

vi.mock("react-i18next", async () =>
  (await import("@/test/post-editor/fixtures")).reactI18nextStub(),
);
vi.mock("@/lib/i18n-admin-post-panes", () => ({}));

import { StepIndicator } from "../StepIndicator";

function renderIndicator(step: EditorStep) {
  const onStepChange = vi.fn<(step: EditorStep) => void>();
  const view = render(<StepIndicator step={step} onStepChange={onStepChange} />);
  return { ...view, onStepChange };
}

const stepOne = () => screen.getByRole("button", { name: /adminPostPanes\.editor\.step1/ });
const stepTwo = () => screen.getByRole("button", { name: /adminPostPanes\.editor\.step2/ });

describe("StepIndicator - etykiety kroków", () => {
  it("pokazuje oba kroki po kluczach i18n", () => {
    renderIndicator("details");

    expect(stepOne()).toBeInTheDocument();
    expect(stepTwo()).toBeInTheDocument();
  });

  it("pokazuje dokładnie dwa kroki (jeden wpis = szczegóły + treść)", () => {
    renderIndicator("content");

    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("StepIndicator - nawigacja", () => {
  it("z kroku szczegółów można przejść do treści", () => {
    const { onStepChange } = renderIndicator("details");

    fireEvent.click(stepTwo());

    expect(onStepChange).toHaveBeenCalledWith("content");
  });

  it("z kroku treści można wrócić do szczegółów", () => {
    const { onStepChange } = renderIndicator("content");

    fireEvent.click(stepOne());

    expect(onStepChange).toHaveBeenCalledWith("details");
  });

  it("klik w krok już aktywny zgłasza ten sam krok (wskaźnik nie trzyma stanu)", () => {
    const { onStepChange } = renderIndicator("details");

    fireEvent.click(stepOne());

    expect(onStepChange).toHaveBeenCalledTimes(1);
    expect(onStepChange).toHaveBeenCalledWith("details");
  });
});

describe("StepIndicator - świadkowie defektów", () => {
  it("SWIADEK DEFEKTU: aktywny krok nie jest podany programowo (brak aria-current)", () => {
    // Aktywny krok niesie dziś WYŁĄCZNIE kolor tła (klasa `bg-brand`). Dla
    // czytnika ekranu oba przyciski są nierozróżnialne, więc osoba niewidząca
    // nie wie, czy jest w „Szczegółach" czy w „Treści" - a to dwa zupełnie różne
    // zestawy pól. Siostrzany przełącznik silnika (EditorModeToggle) ma tu
    // `aria-pressed`, więc rozjazd jest w obrębie jednego paska narzędzi.
    renderIndicator("details");

    expect(stepOne().getAttribute("aria-current")).toBeNull();
    expect(stepOne().getAttribute("aria-pressed")).toBeNull();
    expect(stepTwo().getAttribute("aria-current")).toBeNull();
  });

  it("SWIADEK DEFEKTU: przyciski kroków nie mają type=button (domyślnie submit)", () => {
    // Dziś pasek edytora nie stoi w <form>, więc defekt jest UTAJONY. W chwili,
    // gdy nagłówek trafi do formularza (albo wskaźnik zostanie użyty w innym
    // ekranie panelu), klik w „Szczegóły" wyśle formularz i przeładuje stronę,
    // gubiąc niezapisane zmiany wpisu. Pozostałe przyciski tej powierzchni
    // (żetony silnika, przyciski taksonomii) mają type="button" jawnie.
    renderIndicator("details");

    expect(stepOne().getAttribute("type")).toBeNull();
    expect(stepTwo().getAttribute("type")).toBeNull();
  });
});
