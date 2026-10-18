// Regresja: pole "Szerokość (1-12)" nie może nadpisywać wpisywanej wartości.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClampedNumberInput } from "../ClampedNumberInput";

describe("ClampedNumberInput", () => {
  it("pozwala wyczyścić pole i wpisać nową wartość bez wskakiwania domyślnej", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={1} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "6" } });
    expect(input.value).toBe("6");
    expect(onCommit).toHaveBeenLastCalledWith(6);
  });

  it("clampuje dopiero przy zatwierdzeniu (blur)", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={3} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "99" } });
    expect(input.value).toBe("99");
    fireEvent.blur(input);
    expect(input.value).toBe("12");
    expect(onCommit).toHaveBeenLastCalledWith(12);
  });

  it("przywraca poprzednią wartość, gdy puste pole jest niedozwolone", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={4} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("4");
  });

  it("zatwierdza pustą wartość, gdy allowEmpty", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={200}
        min={0}
        max={2000}
        allowEmpty
        ariaLabel="h"
        onCommit={onCommit}
      />,
    );
    const input = screen.getByLabelText("h") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });
});

describe("ClampedNumberInput - synchronizacja z dokumentem", () => {
  // Efekt synchronizujący jest sercem tego atomu: pole MUSI przyjąć nową
  // wartość z dokumentu (np. cofnięcie zmiany), ale NIE MOŻE kasować tego, co
  // użytkownik właśnie wpisuje. Dwa te przypadki to dwie różne gałęzie.
  it("przyjmuje nową wartość z zewnątrz, gdy pole nie jest edytowane", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <ClampedNumberInput value={2} min={1} max={12} ariaLabel="w" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    expect(input.value).toBe("2");
    rerender(<ClampedNumberInput value={7} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    expect(input.value).toBe("7");
  });

  it("nie nadpisuje draftu, gdy pole jest w trakcie edycji", () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <ClampedNumberInput value={2} min={1} max={12} ariaLabel="w" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1" } });
    rerender(<ClampedNumberInput value={9} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    // Draft użytkownika wygrywa - inaczej nie da się dopisać drugiej cyfry.
    expect(input.value).toBe("1");
  });

  it("startuje z pustym polem dla wartości undefined", () => {
    render(
      <ClampedNumberInput value={undefined} min={0} max={99} ariaLabel="w" onCommit={vi.fn()} />,
    );
    expect((screen.getByLabelText("w") as HTMLInputElement).value).toBe("");
  });
});

describe("ClampedNumberInput - filtr wpisywanych znaków", () => {
  it.each([
    ["litery", "abc"],
    ["mieszane", "12a"],
    ["ułamek z kropką", "1.5"],
    ["dwa minusy", "--3"],
  ])("ignoruje wpis: %s", (_label, raw) => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={-10} max={10} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: raw } });
    // Wzorzec `^-?\d*$` odrzuca wpis w całości - w polu zostaje poprzedni stan.
    expect(input.value).toBe("5");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each([
    ["sam minus", "-"],
    ["puste", ""],
  ])("przyjmuje wpis pośredni bez zatwierdzania: %s", (_label, raw) => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={-10} max={10} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: raw } });
    expect(input.value).toBe(raw);
    // "-" i "" to stany PRZEJŚCIOWE: pole je pokazuje, ale nic nie zatwierdza.
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("nie zatwierdza w locie wartości poza zakresem", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "99" } });
    // Widok pokazuje 99 (żeby dało się dopisać cyfrę), ale dokument dostaje
    // wartość dopiero po zatwierdzeniu - i już sklampowaną.
    expect(input.value).toBe("99");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("zatwierdza w locie zero, gdy zero jest w zakresie", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={0} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "0" } });
    // Zero jest wartością PRAWIDŁOWĄ, nie „brakiem wartości" - najczęstszy
    // błąd w takich polach to potraktowanie go jak pustego.
    expect(onCommit).toHaveBeenLastCalledWith(0);
  });
});

describe("ClampedNumberInput - zatwierdzanie", () => {
  it("zatwierdza Enterem bez czekania na blur", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={1} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(12);
    expect(input.value).toBe("12");
  });

  it("przyjmuje przecinek jako separator dziesiętny przy zatwierdzeniu", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={1} min={0} max={10} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    // Przecinek nie przejdzie przez filtr onChange, ale MOŻE przyjść z wklejenia
    // obsłużonego przez przeglądarkę - dlatego `commit` go normalizuje.
    fireEvent.blur(input, { target: { value: "3,5" } });
    expect(onCommit).toHaveBeenLastCalledWith(3.5);
  });

  // UWAGA na kolejność i na sposób ODCZYTU draftu.
  //
  // `blur`/`keyDown` z podmienionym `target.value` wpisuje wartość wprost do
  // DOM, ale React nie przepisuje jej z powrotem po zmianie stanu (jego licznik
  // wartości został już ustawiony na to, co wpisał test). Draft odczytujemy
  // więc ZACHOWANIEM: strzałka w górę liczy od draftu, więc jej wynik mówi,
  // czy pole faktycznie wróciło do wartości dokumentu.
  //
  // Draft primujemy wartością POZA zakresem, bo taka nie jest zatwierdzana
  // w locie - dzięki temu `onCommit` mierzy wyłącznie zatwierdzenie wadliwe.
  function primeOutOfRange(input: HTMLInputElement): void {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "99" } });
  }

  it("odrzuca wartość nienumeryczną przy zatwierdzeniu i wraca do poprzedniej", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={4} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    primeOutOfRange(input);
    fireEvent.blur(input, { target: { value: "abc" } });
    expect(onCommit).not.toHaveBeenCalled();
    // Draft = "4" (wartość dokumentu), więc strzałka daje 5. Gdyby zostało
    // "99", klamp dałby 12.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(5);
  });

  it("odrzuca wartość nienumeryczną i czyści pole, gdy nie ma poprzedniej wartości", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={undefined} min={1} max={12} ariaLabel="w" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    primeOutOfRange(input);
    fireEvent.blur(input, { target: { value: "abc" } });
    expect(onCommit).not.toHaveBeenCalled();
    // Draft = "" -> strzałka startuje od dolnego krańca (1) i dodaje krok.
    // (Przed naprawą z 2026-10-18 liczyła od zera i trafiała w 1 klampem.)
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(2);
  });

  it("czyści pole na puste zatwierdzenie bez wartości poprzedniej i bez allowEmpty", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={undefined} min={1} max={12} ariaLabel="w" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    primeOutOfRange(input);
    // Same białe znaki to dla `commit` wpis PUSTY - `trim()` przed testem.
    fireEvent.blur(input, { target: { value: "   " } });
    expect(onCommit).not.toHaveBeenCalled();
    // Pusty draft -> start od min (1) + krok.
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(2);
  });

  it("klampuje w dół do min przy zatwierdzeniu", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={2} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    primeOutOfRange(input);
    fireEvent.blur(input, { target: { value: "-30" } });
    expect(onCommit).toHaveBeenLastCalledWith(2);
    // Draft = "2", więc kolejna strzałka daje 3 (a nie klamp z -29).
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(3);
  });
});

describe("ClampedNumberInput - strzałki klawiatury", () => {
  it.each([
    ["w górę o krok", "ArrowUp", false, 6],
    ["w dół o krok", "ArrowDown", false, 4],
    ["w górę o dziesięć kroków", "ArrowUp", true, 12],
    ["w dół o dziesięć kroków", "ArrowDown", true, 1],
  ])("%s", (_label, key, shiftKey, expected) => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.keyDown(input, { key, shiftKey });
    // Shift x10 też jest KLAMPOWANY - stąd 12 i 1 na krańcach zakresu.
    expect(onCommit).toHaveBeenLastCalledWith(expected);
    expect(input.value).toBe(String(expected));
  });

  it("startuje od min, gdy draft nie jest liczbą i nie ma wartości", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={undefined} min={3} max={12} ariaLabel="w" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-" } });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    // Number("-") to NaN - fallback musi wziąć wartość dokumentu, a przy jej
    // braku dolny kraniec zakresu. Bez tego pole zatwierdzałoby NaN.
    expect(onCommit).toHaveBeenLastCalledWith(4);
  });

  // NAPRAWIONE 2026-10-18 (był `it.fails`): `bump` wraca do wartości
  // dokumentu, gdy draft nie jest liczbą - ale `Number("")` to ZERO, nie NaN,
  // więc dla pola WYCZYSZCZONEGO gałąź zapasowa nie wchodziła i strzałka
  // liczyła od zera (wyczyszczona „Szerokość" 8 + strzałka w dół dawała 1,
  // klamp z -1, zamiast 7). Warunek brzmi teraz
  // `draft.trim() !== "" && Number.isFinite(base)`.
  it("startuje od wartości dokumentu, gdy draft jest pusty", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={8} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onCommit).toHaveBeenLastCalledWith(7);
    expect(input.value).toBe("7");
  });

  it("pusty draft bez wartości dokumentu startuje od dolnego krańca zakresu", () => {
    // Druga połowa tej samej gałęzi: bez wartości w dokumencie punktem
    // wyjścia jest `min`, a nie zero spoza zakresu (min 3 + krok 1 = 4,
    // dawniej klamp z 0 + 1 dawał 3).
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={undefined} min={3} max={12} ariaLabel="w" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(4);
  });

  it("respektuje własny krok", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={100}
        min={0}
        max={1000}
        step={25}
        ariaLabel="w"
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("w"), { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(125);
  });

  it("ignoruje pozostałe klawisze", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={5} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByLabelText("w"), { key: "Tab" });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe("ClampedNumberInput - prezentacja", () => {
  it("przekazuje placeholder i klasę", () => {
    render(
      <ClampedNumberInput
        value={undefined}
        min={0}
        max={10}
        placeholder="auto"
        className="w-20"
        ariaLabel="w"
        onCommit={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("w") as HTMLInputElement;
    expect(input.placeholder).toBe("auto");
    expect(input.className).toContain("w-20");
    // Klasa bazowa NIE może zniknąć przy nadpisaniu - `cn` scala, nie zamienia.
    expect(input.className).toContain("h-8");
  });
});
