import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BilingualRow } from "@/components/admin/atoms/BilingualRow";

afterEach(cleanup);

describe("BilingualRow", () => {
  it("wiąże dwa pola tekstowe z jednoznacznymi etykietami", () => {
    render(<BilingualRow label="Tytuł" pl="Polski" en="English" onPl={vi.fn()} onEn={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Tytuł (PL)" })).toHaveValue("Polski");
    expect(screen.getByRole("textbox", { name: "Tytuł (EN)" })).toHaveValue("English");
  });

  it("przekazuje zmianę wyłącznie do właściwej wersji językowej", () => {
    const onPl = vi.fn();
    const onEn = vi.fn();
    render(<BilingualRow label="Tytuł" pl="" en="" onPl={onPl} onEn={onEn} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Tytuł (PL)" }), {
      target: { value: "Nowy" },
    });

    expect(onPl).toHaveBeenCalledWith("Nowy");
    expect(onEn).not.toHaveBeenCalled();
  });

  it("wariant wielolinijkowy zachowuje role, etykiety i liczbę wierszy", () => {
    render(
      <BilingualRow
        label="Opis"
        pl="PL"
        en="EN"
        onPl={vi.fn()}
        onEn={vi.fn()}
        multiline
        rows={5}
        hint="Obie wersje"
      />,
    );

    expect(screen.getByRole("textbox", { name: "Opis (PL)" })).toHaveAttribute("rows", "5");
    expect(screen.getByRole("textbox", { name: "Opis (EN)" })).toHaveAttribute("rows", "5");
    expect(screen.getByText("Obie wersje")).toBeInTheDocument();
  });

  it("blokuje oba pola bez utraty ich etykiet", () => {
    render(
      <BilingualRow label="Etykieta" pl="PL" en="EN" onPl={vi.fn()} onEn={vi.fn()} disabled />,
    );

    expect(screen.getByRole("textbox", { name: "Etykieta (PL)" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Etykieta (EN)" })).toBeDisabled();
  });
});
