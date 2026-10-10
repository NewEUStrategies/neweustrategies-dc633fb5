// KOMÓRKA LICZBY Z ZAPISANYM NAPISEM (`NumberCell storedText`).
//
// Kontrakt PR2, „DataGrid behaviour" 1: wpis, który liczbą nie jest, dostaje
// `aria-invalid` i zdanie - nigdy cichą lukę. Dotyczy to także napisu, który
// JUŻ STOI w treści („PL; 12%" w polu widgetu mapy): bez `storedText`
// komórka pokazywała pustą lukę, a najbliższy zapis innego wiersza utrwalał
// ją bez słowa. Bez `storedText` komórka zachowuje się jak dotąd.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberCell } from "../GridCells";

function zamontuj(storedText: string | undefined, value: number | null = null) {
  const onCommit = vi.fn<(v: number | null) => void>();
  function Host() {
    const [stan, setStan] = useState<{ value: number | null; stored?: string }>({
      value,
      stored: storedText,
    });
    return (
      <NumberCell
        row={0}
        col={1}
        value={stan.value}
        storedText={stan.stored}
        lang="pl"
        label="Polska - wartość"
        invalidText="Zapisana wartość nie jest liczbą"
        onTablePaste={() => undefined}
        onCommit={(v) => {
          onCommit(v);
          setStan({ value: v });
        }}
      />
    );
  }
  render(<Host />);
  return { onCommit, pole: screen.getByRole("textbox", { name: "Polska - wartość" }) };
}

describe("NumberCell - zapisany napis spoza liczb", () => {
  it("pokazuje napis z aria-invalid i zdaniem, a nie pustą lukę", () => {
    const { pole } = zamontuj("12%");
    expect((pole as HTMLInputElement).value).toBe("12%");
    expect(pole).toHaveAttribute("aria-invalid", "true");
    const opis = document.getElementById(pole.getAttribute("aria-describedby") ?? "");
    expect(opis?.textContent).toBe("Zapisana wartość nie jest liczbą");
  });

  it("samo przejście przez komórkę niczego nie zapisuje", () => {
    const { pole, onCommit } = zamontuj("abc");
    fireEvent.focus(pole);
    fireEvent.blur(pole);
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(pole).toHaveAttribute("aria-invalid", "true");
  });

  it("poprawiony wpis zapisuje liczbę i zdejmuje uwagę", () => {
    const { pole, onCommit } = zamontuj("1.234,5");
    fireEvent.change(pole, { target: { value: "1234,5" } });
    fireEvent.blur(pole);
    expect(onCommit).toHaveBeenCalledWith(1234.5);
    expect(pole).not.toHaveAttribute("aria-invalid");
  });

  it("wyczyszczona komórka zapisuje lukę - choć wartość już była null", () => {
    const { pole, onCommit } = zamontuj("abc");
    fireEvent.change(pole, { target: { value: "" } });
    fireEvent.blur(pole);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("Ctrl+Z po zmianie wraca do zapisanego napisu, a przy nietkniętym idzie dalej", () => {
    const { pole } = zamontuj("abc");
    fireEvent.change(pole, { target: { value: "ab" } });
    const cofniecie = fireEvent.keyDown(pole, { key: "z", ctrlKey: true });
    expect(cofniecie).toBe(false);
    expect((pole as HTMLInputElement).value).toBe("abc");
    expect(pole).toHaveAttribute("aria-invalid", "true");
    expect(fireEvent.keyDown(pole, { key: "z", ctrlKey: true })).toBe(true);
  });

  it("bez storedText - jak dotąd: pusta luka bez uwagi", () => {
    const { pole } = zamontuj(undefined);
    expect((pole as HTMLInputElement).value).toBe("");
    expect(pole).not.toHaveAttribute("aria-invalid");
  });
});
