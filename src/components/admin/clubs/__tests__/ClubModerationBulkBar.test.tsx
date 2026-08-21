// Molekuła: pasek operacji wsadowych kolejki i listy tematów.
//
// CO TO DOWODZI. Pasek jest wspólny dla DWÓCH zakładek panelu (kolejka
// moderacji i lista tematów), więc dowodem jest to, że oddaje dokładnie tyle
// zdarzeń, ile deskryptorów dostał - i nie woła żadnego z nich sam:
//
//   1. KAŻDY DESKRYPTOR daje jeden przycisk, a klik woła DOKŁADNIE jego
//      domknięcie (pomyłka w indeksie oznacza „usuń” pod „przypnij”).
//   2. AKCJA NIEODWRACALNA dostaje ton destrukcyjny - bez tego przycisk
//      kasujący pięćdziesiąt wpisów wygląda jak przycisk sortowania.
//   3. TRWAJĄCY WSAD wyłącza przyciski, żeby drugi klik nie wysłał drugiej
//      partii na tych samych wpisach.
//   4. „WYCZYŚĆ ZAZNACZENIE” jest osobnym zdarzeniem i stoi przy prawej
//      krawędzi (`ml-auto`) - to jedyne wyjście z paska bez wykonania akcji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Nie sprawdza, KIEDY pasek się pokazuje - o tym
// decyduje organizm (renderuje molekułę warunkowo) i dowodzą tego jego testy.
// Nie liczy zaznaczenia: molekuła dostaje gotową etykietę licznika.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

import { ClubModerationBulkBar } from "@/components/admin/clubs/molecules/ClubModerationBulkBar";

function actionButton(id: string): HTMLElement {
  const found = document.querySelector(`[data-bulk-action="${id}"]`);
  if (!(found instanceof HTMLElement)) throw new Error(`brak przycisku wsadu ${id}`);
  return found;
}

describe("pasek operacji wsadowych", () => {
  it("każdy deskryptor daje przycisk wołający WŁASNE domknięcie", () => {
    const pin = vi.fn();
    const remove = vi.fn();
    render(
      <ClubModerationBulkBar
        label="adminClubs.threads.selected(count=3)"
        clearLabel="adminClubs.threads.clearSelection"
        onClear={vi.fn()}
        actions={[
          { id: "pin", label: "adminClubs.threads.pin", icon: null, onSelect: pin },
          {
            id: "delete",
            label: "adminClubs.threads.delete",
            icon: null,
            destructive: true,
            onSelect: remove,
          },
        ]}
      />,
    );

    expect(screen.getByText("adminClubs.threads.selected(count=3)")).toBeTruthy();
    fireEvent.click(actionButton("pin"));

    expect(pin).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("akcja nieodwracalna dostaje ton destrukcyjny, odwracalna nie", () => {
    render(
      <ClubModerationBulkBar
        label="wsad"
        clearLabel="wyczyść"
        onClear={vi.fn()}
        actions={[
          { id: "approve", label: "zatwierdź", icon: null, onSelect: vi.fn() },
          { id: "delete", label: "usuń", icon: null, destructive: true, onSelect: vi.fn() },
        ]}
      />,
    );

    expect(actionButton("delete").className).toContain("text-destructive");
    expect(actionButton("approve").className).not.toContain("text-destructive");
  });

  it("trwający wsad wyłącza przycisk - drugi klik nie wysyła drugiej partii", () => {
    const onSelect = vi.fn();
    render(
      <ClubModerationBulkBar
        label="wsad"
        clearLabel="wyczyść"
        onClear={vi.fn()}
        actions={[{ id: "approve", label: "zatwierdź", icon: null, disabled: true, onSelect }]}
      />,
    );

    expect(actionButton("approve").hasAttribute("disabled")).toBe(true);
    fireEvent.click(actionButton("approve"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("„wyczyść zaznaczenie” jest osobnym zdarzeniem przy prawej krawędzi", () => {
    const onClear = vi.fn();
    render(
      <ClubModerationBulkBar label="wsad" clearLabel="wyczyść" onClear={onClear} actions={[]} />,
    );

    const clear = screen.getByRole("button", { name: "wyczyść" });
    expect(clear.className).toContain("ml-auto");
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
