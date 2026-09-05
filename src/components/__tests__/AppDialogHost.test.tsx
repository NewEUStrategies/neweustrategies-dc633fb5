// Wspólny host okien `confirm`/`prompt` - zamiennik `window.confirm()`
// i `window.prompt()` dla całej aplikacji (montowany raz w `__root.tsx`).
//
// CO TU JEST PRZYPINANE I DLACZEGO. Wołający NIE renderuje własnego okna;
// robi `await confirmDialog(...)` i ufa, że wróci odpowiedź użytkownika. Cała
// odpowiedzialność za to, CO wróci, leży w tym komponencie - i to są rzeczy,
// których typy nie pilnują:
//
//   1. KIERUNEK ODMOWY. Każde wyjście z okna INNE niż klik w potwierdzenie
//      musi znaczyć „nie": krzyżyk, klawisz Escape, przycisk anulowania.
//      Odwrotna pomyłka kasuje wpis, którego nikt nie kazał kasować - dlatego
//      każda z tych dróg ma tu własny przypadek.
//
//   2. `null` TO NIE PUSTY NAPIS. Anulowany `prompt` oddaje `null`, a pole
//      wyczyszczone i zatwierdzone - `""`. Wołający rozróżnia te dwa
//      przypadki (nie zmieniaj vs. wyczyść), więc test asertuje `null`
//      TOŻSAMOŚCIOWO, nie „coś fałszywego".
//
//   3. WARTOŚĆ WRACA TA, KTÓRĄ WPISANO. Okno startuje od `defaultValue`,
//      a oddaje stan pola z chwili zatwierdzenia.
//
//   4. ETYKIETY. Domyślne napisy przycisków pochodzą ze SŁOWNIKA rdzenia
//      (`common.confirm`, `common.cancel`, `common.save`), a etykieta podana
//      przez wołającego ma je przesłonić.
//
// Magazyn zgłoszeń (`@/lib/appDialogs`) jest PRAWDZIWY - to kilkadziesiąt
// linii bez sieci i bez DOM, więc atrapa zamieniłaby test w sprawdzanie samej
// siebie. Atrapowany jest wyłącznie `react-i18next`, i to PRAWDZIWYM
// tłumaczem (`realT`), żeby asercje mierzyły słownik.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { AppDialogHost } from "@/components/AppDialogHost";
import {
  confirmDialog,
  promptDialog,
  type ConfirmDialogRequest,
  type PromptDialogRequest,
} from "@/lib/appDialogs";
import { realT } from "@/test/i18nReal";

h.fixedT = realT;

/**
 * Zgłoszenie leci przez magazyn modułowy, więc powiadomienie hosta jest
 * synchroniczną aktualizacją stanu Reacta - stąd `act`.
 */
function openConfirm(opts: Omit<ConfirmDialogRequest, "kind">): Promise<boolean> {
  let answer!: Promise<boolean>;
  act(() => {
    answer = confirmDialog(opts);
  });
  return answer;
}

function openPrompt(opts: Omit<PromptDialogRequest, "kind">): Promise<string | null> {
  let answer!: Promise<string | null>;
  act(() => {
    answer = promptDialog(opts);
  });
  return answer;
}

/** Klik, po którym host rozstrzyga obietnicę i przerysowuje drzewo. */
function clickButton(name: string): void {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

const CONFIRM = () => realT(h.lang)("common.confirm");
const CANCEL = () => realT(h.lang)("common.cancel");
const SAVE = () => realT(h.lang)("common.save");

beforeEach(() => {
  h.lang = "pl";
});

afterEach(() => {
  h.lang = "pl";
});

describe("host bez zgłoszenia nie istnieje w DOM", () => {
  it("nie renderuje żadnego okna, dopóki nikt o nie nie poprosi", () => {
    const { container } = render(<AppDialogHost />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("potwierdzenie - kazde wyjscie inne niz zgoda znaczy odmowe", () => {
  it("pokazuje tytuł i opis podane przez wołającego", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({
      title: "Usunąć wpis?",
      description: "Tej operacji nie da się cofnąć.",
    });

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Usunąć wpis?")).toBeInTheDocument();
    expect(screen.getByText("Tej operacji nie da się cofnąć.")).toBeInTheDocument();

    clickButton(CANCEL());
    await expect(answer).resolves.toBe(false);
  });

  it("klik w potwierdzenie oddaje `true`", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Opublikować?" });

    clickButton(CONFIRM());

    await expect(answer).resolves.toBe(true);
  });

  it("klik w anulowanie oddaje `false`", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Opublikować?" });

    clickButton(CANCEL());

    await expect(answer).resolves.toBe(false);
  });

  it("klawisz Escape jest ODMOWĄ, nie zgodą", async () => {
    // Najłatwiejsza pomyłka w tym miejscu: potraktować zamknięcie okna jako
    // domyślne „tak" i skasować wpis, którego nikt nie kazał kasować.
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Usunąć wpis?" });

    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });

    await expect(answer).resolves.toBe(false);
  });

  it("po rozstrzygnięciu okno znika z DOM", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Opublikować?" });

    clickButton(CONFIRM());
    await answer;

    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("domyślne etykiety przycisków pochodzą ze słownika rdzenia", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Opublikować?" });

    expect(screen.getByRole("button", { name: "Potwierdź" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeInTheDocument();

    clickButton(CANCEL());
    await answer;
  });

  it("na angielskiej stronie domyślne etykiety są angielskie", async () => {
    h.lang = "en";
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Publish?" });

    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Potwierdź" })).toBeNull();

    clickButton("Cancel");
    await expect(answer).resolves.toBe(false);
  });

  it("etykiety wołającego przesłaniają domyślne", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({
      title: "Usunąć konto?",
      confirmLabel: "Usuń konto",
      cancelLabel: "Zostaw",
    });

    expect(screen.queryByRole("button", { name: CONFIRM() })).toBeNull();
    clickButton("Usuń konto");

    await expect(answer).resolves.toBe(true);
  });

  it("wariant destrukcyjny wyróżnia przycisk potwierdzenia", async () => {
    // Kolor jest tu jedynym ostrzeżeniem przed operacją nieodwracalną.
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Usunąć trwale?", destructive: true });

    expect(screen.getByRole("button", { name: CONFIRM() }).className).toContain("bg-destructive");

    clickButton(CANCEL());
    await answer;
  });

  it("zgłoszenie bez opisu nie renderuje pustego akapitu", async () => {
    render(<AppDialogHost />);
    const answer = openConfirm({ title: "Opublikować?" });

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toBe(`Opublikować?${CANCEL()}${CONFIRM()}`);

    clickButton(CANCEL());
    await answer;
  });
});

describe("pytanie o wartość - `null` to nie pusty napis", () => {
  it("pole startuje od wartości domyślnej, a zatwierdzenie oddaje WPISANY napis", async () => {
    render(<AppDialogHost />);
    const answer = openPrompt({
      title: "Nazwa kopii",
      label: "Nazwa",
      defaultValue: "Kopia robocza",
    });

    const input = screen.getByLabelText("Nazwa");
    expect(input).toHaveValue("Kopia robocza");
    fireEvent.change(input, { target: { value: "Wersja z 1 marca" } });
    clickButton(SAVE());

    await expect(answer).resolves.toBe("Wersja z 1 marca");
  });

  it("anulowanie oddaje `null`, a nie pusty napis", async () => {
    // Wołający rozróżnia „nie zmieniaj" (null) od „wyczyść" ("") - zlanie
    // tych dwóch przypadków kasuje wartość przy każdym anulowaniu.
    render(<AppDialogHost />);
    const answer = openPrompt({ title: "Nazwa kopii", defaultValue: "Kopia robocza" });

    clickButton(CANCEL());

    await expect(answer).resolves.toBeNull();
  });

  it("wyczyszczone pole zatwierdzone świadomie oddaje PUSTY NAPIS", async () => {
    render(<AppDialogHost />);
    const answer = openPrompt({ title: "Nazwa kopii", label: "Nazwa", defaultValue: "Kopia" });

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "" } });
    clickButton(SAVE());

    await expect(answer).resolves.toBe("");
  });

  it("Escape zamyka pytanie jako anulowane", async () => {
    render(<AppDialogHost />);
    const answer = openPrompt({ title: "Nazwa kopii" });

    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });

    await expect(answer).resolves.toBeNull();
  });

  it("opis, etykieta i podpowiedź pola pochodzą ze zgłoszenia", async () => {
    render(<AppDialogHost />);
    const answer = openPrompt({
      title: "Nowy adres",
      description: "Adres musi być unikalny w obrębie serwisu.",
      label: "Adres",
      placeholder: "np. analiza-rynku",
    });

    expect(screen.getByText("Adres musi być unikalny w obrębie serwisu.")).toBeInTheDocument();
    expect(screen.getByLabelText("Adres")).toHaveAttribute("placeholder", "np. analiza-rynku");

    clickButton(CANCEL());
    await answer;
  });

  it("zgłoszenie bez wartości domyślnej daje puste pole", async () => {
    render(<AppDialogHost />);
    const answer = openPrompt({ title: "Nowy adres", label: "Adres" });

    expect(screen.getByLabelText("Adres")).toHaveValue("");

    clickButton(CANCEL());
    await answer;
  });

  it("wlasna etykieta zatwierdzenia przeslania domyslny napis ze slownika", async () => {
    render(<AppDialogHost />);
    const answer = openPrompt({ title: "Nowy adres", confirmLabel: "Utwórz" });

    expect(screen.queryByRole("button", { name: SAVE() })).toBeNull();
    clickButton("Utwórz");

    await expect(answer).resolves.toBe("");
  });
});
