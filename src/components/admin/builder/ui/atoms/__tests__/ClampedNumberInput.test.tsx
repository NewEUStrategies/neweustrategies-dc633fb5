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
    fireEvent.blur(input, { target: { value: "99" } });
    expect(input.value).toBe("12");
    expect(onCommit).toHaveBeenLastCalledWith(12);
  });

  it("przywraca poprzednią wartość, gdy puste pole jest niedozwolone", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={4} min={1} max={12} ariaLabel="w" onCommit={onCommit} />);
    const input = screen.getByLabelText("w") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input, { target: { value: "" } });
    expect(input.value).toBe("4");
  });

  it("zatwierdza pustą wartość, gdy allowEmpty", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={200} min={0} max={2000} allowEmpty ariaLabel="h" onCommit={onCommit} />,
    );
    const input = screen.getByLabelText("h") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input, { target: { value: "" } });
    expect(onCommit).toHaveBeenLastCalledWith(undefined);
  });
});
