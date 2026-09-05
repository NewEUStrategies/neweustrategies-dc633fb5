// Host okna „niezapisane zmiany" - jedyna bramka między klikiem w link
// a utratą pracy w edytorze (montowany raz w `__root.tsx`).
//
// CO TU JEST PRZYPINANE I DLACZEGO. Blokada nawigacji
// (`useUnsavedChangesGuard`) wstrzymuje przejście i CZEKA na odpowiedź z tego
// okna. Trzy rzeczy muszą być tu prawdziwe, a żadnej nie pilnują typy:
//
//   1. KIERUNEK DOMYŚLNY TO „ZOSTAŃ". Escape i przycisk anulowania mają
//      rozstrzygnąć obietnicę na `false`. Pomyłka w tę stronę wyrzuca
//      redaktora z edytora razem z niezapisaną pracą - dlatego każde z tych
//      wyjść ma tu własny przypadek. (Kliku w tło NIE ma na tej liście
//      świadomie: `AlertDialog` Radiksa z założenia NIE zamyka się od
//      kliknięcia poza oknem, więc taki przypadek mierzyłby bibliotekę,
//      a nie ten komponent.)
//
//   2. OKNO ISTNIEJE TYLKO NA ŻĄDANIE. Host wisi w korzeniu na KAŻDEJ
//      stronie; gdyby renderował treść bez oczekującego pytania, blokowałby
//      całą aplikację modalem.
//
//   3. OBIETNICA ROZSTRZYGA SIĘ RAZ I ZNIKA. Po odpowiedzi okno musi się
//      zamknąć, inaczej kolejna nawigacja trafia na wiszący modal.
//
// Magazyn (`@/lib/unsavedChanges`) jest PRAWDZIWY - to kilkadziesiąt linii
// bez sieci i bez DOM. Atrapowany jest wyłącznie `react-i18next`, i to
// PRAWDZIWYM tłumaczem (`realT`), żeby asercje mierzyły słownik rdzenia.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));

import { UnsavedChangesGuardHost } from "@/components/UnsavedChangesGuardHost";
import { requestLeaveConfirmation } from "@/lib/unsavedChanges";
import { realT } from "@/test/i18nReal";

h.fixedT = realT;

/** Blokada zgłasza pytanie synchronicznie, więc host aktualizuje stan w `act`. */
function askToLeave(): Promise<boolean> {
  let answer!: Promise<boolean>;
  act(() => {
    answer = requestLeaveConfirmation();
  });
  return answer;
}

function clickButton(name: string): void {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

const LEAVE = () => realT(h.lang)("admin.leave");
const STAY = () => realT(h.lang)("admin.stay");

beforeEach(() => {
  h.lang = "pl";
});

describe("host milczy, dopóki nikt nie próbuje wyjść", () => {
  it("nie renderuje okna bez oczekującego pytania", () => {
    render(<UnsavedChangesGuardHost />);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText(realT("pl")("admin.unsavedChangesTitle"))).toBeNull();
  });
});

describe("okno pyta o zgodę na utratę pracy", () => {
  it("zgłoszenie blokady otwiera okno z tytułem i ostrzeżeniem ze słownika", async () => {
    render(<UnsavedChangesGuardHost />);
    const answer = askToLeave();

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(realT("pl")("admin.unsavedChangesTitle"))).toBeInTheDocument();
    expect(screen.getByText(realT("pl")("admin.unsavedChanges"))).toBeInTheDocument();

    clickButton(STAY());
    await expect(answer).resolves.toBe(false);
  });

  it("wyjście bez zapisania oddaje `true`", async () => {
    render(<UnsavedChangesGuardHost />);
    const answer = askToLeave();

    clickButton(LEAVE());

    await expect(answer).resolves.toBe(true);
  });

  it("pozostanie w edytorze oddaje `false`", async () => {
    render(<UnsavedChangesGuardHost />);
    const answer = askToLeave();

    clickButton(STAY());

    await expect(answer).resolves.toBe(false);
  });

  it("Escape znaczy ZOSTAŃ - zamknięcie okna nie może kasować pracy", async () => {
    render(<UnsavedChangesGuardHost />);
    const answer = askToLeave();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });

    await expect(answer).resolves.toBe(false);
  });

  it("po odpowiedzi okno znika, więc kolejna nawigacja nie trafia na modal", async () => {
    render(<UnsavedChangesGuardHost />);
    const answer = askToLeave();

    clickButton(LEAVE());
    await answer;

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("przycisk wyjścia jest wyróżniony jako operacja niszcząca", () => {
    render(<UnsavedChangesGuardHost />);
    askToLeave();

    expect(screen.getByRole("button", { name: LEAVE() }).className).toContain("bg-destructive");
    clickButton(STAY());
  });

  it("drugie pytanie zamyka pierwsze jako ZOSTAŃ, zamiast gubić obietnicę", async () => {
    // Dwie blokady naraz to rzadkość, ale porzucony resolver zawiesiłby
    // pierwszą nawigację na zawsze.
    render(<UnsavedChangesGuardHost />);
    const first = askToLeave();
    const second = askToLeave();

    await expect(first).resolves.toBe(false);
    clickButton(LEAVE());
    await expect(second).resolves.toBe(true);
  });
});

describe("wariant angielski", () => {
  it("tytuł, ostrzeżenie i przyciski idą z angielskiego słownika", async () => {
    h.lang = "en";
    render(<UnsavedChangesGuardHost />);
    const answer = askToLeave();

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("You have unsaved changes - leave the editor anyway?")).toBeVisible();
    expect(screen.queryByText(realT("pl")("admin.unsavedChangesTitle"))).toBeNull();

    clickButton("Leave without saving");
    await expect(answer).resolves.toBe(true);
  });
});
