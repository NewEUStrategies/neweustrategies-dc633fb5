// `ColorField` i `ColorInput` to dwie fasady jednego pickera admina. Różnica
// nie jest kosmetyczna: `ColorField` UMIE wrócić do wartości dziedziczonej
// (kaskada kolorów globalnych), a `ColorInput` NIE - w widgetach reset i tak
// robi przycisk sekcji. Test przypina właśnie tę różnicę oraz to, że pole
// tekstowe przepuszcza tokeny, których picker nie potrafi narysować
// (`var(--brand)`, `oklch(...)`, `transparent`).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorField } from "../ColorField";
import { ColorInput } from "../ColorInput";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

/** Pole tekstowe pickera - jedyne, które przyjmuje dowolny token CSS. */
function tokenInput(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>("input.font-mono");
  if (!found) throw new Error("test: brak pola tekstowego pickera");
  return found;
}

describe("ColorField", () => {
  it("pokazuje ustawioną wartość", () => {
    render(<ColorField value="#ff8800" onChange={vi.fn()} />);
    expect(tokenInput().value).toBe("#ff8800");
  });

  it.each([
    ["hex 3-znakowy", "#f80"],
    ["hex 6-znakowy", "#ff8800"],
    ["hex z alfą", "#ff880080"],
    ["rgba", "rgba(255,136,0,.5)"],
    ["zmienna CSS", "var(--brand)"],
    ["oklch", "oklch(0.7 0.2 40)"],
    ["transparent", "transparent"],
    ["wartość śmieciowa", "nie-kolor"],
  ])("przepuszcza wpisany token: %s", (_label, token) => {
    const onChange = vi.fn();
    render(<ColorField value={undefined} onChange={onChange} />);
    fireEvent.change(tokenInput(), { target: { value: token } });
    // Pole NIE waliduje - walidacja żyje w renderze (`safeCssColor`). Gdyby
    // filtrowało tutaj, nie dałoby się wpisać tokena projektu.
    expect(onChange).toHaveBeenLastCalledWith(token);
  });

  it("wyczyszczenie pola zdejmuje nadpisanie", () => {
    const onChange = vi.fn();
    render(<ColorField value="#123456" onChange={onChange} />);
    fireEvent.change(tokenInput(), { target: { value: "" } });
    // `undefined`, a nie `""` - inaczej dokument zapisałby PUSTY kolor i
    // kaskada dziedziczenia przestałaby działać.
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("bez nadpisania podpowiada wartość dziedziczoną", () => {
    render(<ColorField value={undefined} onChange={vi.fn()} inheritedValue="#01112f" />);
    expect(tokenInput().placeholder).toBe("dziedziczy: #01112f");
  });

  it("własny placeholder wygrywa, gdy nie ma dziedziczenia", () => {
    render(<ColorField value={undefined} onChange={vi.fn()} placeholder="kolor nagłówka" />);
    expect(tokenInput().placeholder).toBe("kolor nagłówka");
  });

  it("daje przycisk resetu do wartości domyślnej", () => {
    const onChange = vi.fn();
    render(<ColorField value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("blocks.editors.adminControls.resetDefault"));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe("ColorInput", () => {
  it("podpowiada domyślnym placeholderem dopuszczalne formaty", () => {
    render(<ColorInput onChange={vi.fn()} />);
    expect(tokenInput().placeholder).toBe("#000 / rgba(...) / transparent / var(--brand)");
  });

  it("własny placeholder nadpisuje domyślny", () => {
    render(<ColorInput onChange={vi.fn()} placeholder="kolor tła sekcji" />);
    expect(tokenInput().placeholder).toBe("kolor tła sekcji");
  });

  it("NIE daje przycisku resetu", () => {
    render(<ColorInput value="#fff" onChange={vi.fn()} />);
    // `allowReset={false}` jest tu decyzją produktową, nie przypadkiem:
    // w widgetach reset robi przycisk całej sekcji właściwości.
    expect(screen.queryByLabelText("blocks.editors.adminControls.resetDefault")).toBeNull();
  });

  it("przekazuje wpisaną wartość i czyszczenie", () => {
    const onChange = vi.fn();
    render(<ColorInput value="#101010" onChange={onChange} />);
    const input = tokenInput();
    fireEvent.change(input, { target: { value: "var(--accent)" } });
    expect(onChange).toHaveBeenLastCalledWith("var(--accent)");
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});
