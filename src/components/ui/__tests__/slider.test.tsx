// Slider to suwak Radiksa. Rola `slider` stoi na UCHWYCIE, nie na korzeniu,
// więc nazwa kontrolki musi trafić na uchwyt przez `thumbProps` - inaczej
// czytnik mówi „suwak, 4" bez nazwy. Test pilnuje tej drogi, obsługi
// klawiatury (strzałki, Home, End) i klas toru opartych na tokenie `primary`.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Slider } from "../slider";

afterEach(cleanup);

describe("Slider", () => {
  it("nadaje nazwę uchwytowi z rolą slider przez thumbProps", () => {
    render(
      <Slider
        defaultValue={[4]}
        min={0}
        max={10}
        aria-label="Ignorowana na korzeniu"
        thumbProps={{ "aria-label": "Liczba kolumn", className: "h-5 w-5" }}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Liczba kolumn" });
    expect(thumb).toHaveAttribute("aria-valuenow", "4");
    expect(thumb).toHaveAttribute("aria-valuemin", "0");
    expect(thumb).toHaveAttribute("aria-valuemax", "10");
    expect(thumb).toHaveAttribute("aria-orientation", "horizontal");
    expect(thumb).toHaveClass(
      "rounded-full",
      "bg-background",
      "focus-visible:ring-1",
      "h-5",
      "w-5",
    );
    expect(thumb).not.toHaveClass("h-4");
  });

  it("zmienia wartość strzałkami oraz skacze na skraje klawiszami Home i End", () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        defaultValue={[5]}
        max={10}
        step={1}
        onValueChange={onValueChange}
        thumbProps={{ "aria-label": "Głośność" }}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Głośność" });
    thumb.focus();
    expect(thumb).toHaveFocus();
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(thumb).toHaveAttribute("aria-valuenow", "6");
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    fireEvent.keyDown(thumb, { key: "ArrowLeft" });
    expect(thumb).toHaveAttribute("aria-valuenow", "4");
    fireEvent.keyDown(thumb, { key: "End" });
    expect(thumb).toHaveAttribute("aria-valuenow", "10");
    fireEvent.keyDown(thumb, { key: "Home" });
    expect(thumb).toHaveAttribute("aria-valuenow", "0");
    expect(onValueChange).toHaveBeenLastCalledWith([0]);
  });

  it("bez thumbProps renderuje uchwyt z klasami bazowymi i tor w kolorze tokenu", () => {
    const ref = createRef<HTMLSpanElement>();
    render(<Slider ref={ref} defaultValue={[30]} className="w-40" />);
    const thumb = screen.getByRole("slider");
    expect(thumb).toHaveAttribute("aria-valuenow", "30");
    expect(thumb).toHaveClass("h-4", "w-4", "border-primary/50");
    expect(ref.current).toHaveClass("relative", "flex", "touch-none", "w-40");
    expect(ref.current).not.toHaveClass("w-full");
    const track = ref.current?.querySelector(".bg-primary\\/20");
    expect(track).not.toBeNull();
    expect(track?.querySelector(".bg-primary")).not.toBeNull();
  });

  it("w stanie wyłączonym ignoruje klawiaturę i oznacza korzeń", () => {
    const onValueChange = vi.fn();
    render(
      <Slider
        defaultValue={[2]}
        disabled
        onValueChange={onValueChange}
        thumbProps={{ "aria-label": "Zablokowany" }}
      />,
    );
    const thumb = screen.getByRole("slider", { name: "Zablokowany" });
    fireEvent.keyDown(thumb, { key: "ArrowRight" });
    expect(thumb).toHaveAttribute("aria-valuenow", "2");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(thumb).toHaveAttribute("data-disabled", "");
  });
});
