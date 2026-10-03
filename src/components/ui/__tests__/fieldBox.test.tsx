// `FieldBox` - pole popupu rejestracji z platformową etykietą pływającą.
//
// CO TEN PLIK DOWODZI.
//   1. PUSTY PLACEHOLDER Z KONFIGURACJI NIE UNOSI ETYKIETY. `""` przechodził
//      przez `??`, a pole z pustą podpowiedzią nie pasuje do `:placeholder-shown`,
//      więc etykieta wisiała nad pustym polem. Pusty i biały placeholder dają
//      teraz spację-spacer, jak brak placeholdera.
//   2. BŁĄD JEST CZYTANY: `invalid` daje `aria-invalid` na polu, nie tylko
//      `data-invalid` na ramce, którego czytnik ekranu nie widzi.
//   3. ETYKIETA JEST POWIĄZANA z polem, także przy `id` podanym z zewnątrz
//      (dawniej `useId` je nadpisywał i zewnętrzne `htmlFor` trafiały w próżnię).
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { FieldBox } from "@/components/ui/field-box";

describe("FieldBox - etykieta pływająca", () => {
  it("etykieta jest nazwą pola, a gwiazdka oznacza pole wymagane", () => {
    render(<FieldBox label="Imię" required />);
    const pole = screen.getByRole("textbox", { name: "Imię *" });
    expect(pole).toBeRequired();
    expect(pole.className).toBe("input");
  });

  it("bez placeholdera pole dostaje spację, na której stoi mechanika pływania", () => {
    render(<FieldBox label="Imię" />);
    expect(screen.getByRole("textbox", { name: "Imię" })).toHaveAttribute("placeholder", " ");
  });

  it.each(["", "   "])("pusty placeholder %j z konfiguracji też daje spację", (placeholder) => {
    render(<FieldBox label="Firma" placeholder={placeholder} />);
    expect(screen.getByRole("textbox", { name: "Firma" })).toHaveAttribute("placeholder", " ");
  });

  it("niepusty placeholder zostaje bez zmian", () => {
    render(<FieldBox label="E-mail" placeholder="jan@przyklad.pl" />);
    expect(screen.getByRole("textbox", { name: "E-mail" })).toHaveAttribute(
      "placeholder",
      "jan@przyklad.pl",
    );
  });

  it("zewnętrzne `id` zostaje na polu i wiąże etykietę", () => {
    render(
      <>
        <FieldBox label="Telefon" id="telefon" />
        <label htmlFor="telefon">Druga etykieta</label>
      </>,
    );
    const pole = screen.getByRole("textbox", { name: "Telefon Druga etykieta" });
    expect(pole.id).toBe("telefon");
  });

  it("dwa pola bez `id` mają różne identyfikatory", () => {
    render(
      <>
        <FieldBox label="A" />
        <FieldBox label="B" />
      </>,
    );
    const a = screen.getByRole("textbox", { name: "A" });
    const b = screen.getByRole("textbox", { name: "B" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("FieldBox - stan błędu i dodatki", () => {
  it("`invalid` oznacza pole dla czytnika ekranu i ramkę dla stylu", () => {
    render(<FieldBox label="E-mail" invalid aria-describedby="blad" />);
    const pole = screen.getByRole("textbox", { name: "E-mail" });
    expect(pole).toHaveAttribute("aria-invalid", "true");
    expect(pole).toHaveAttribute("aria-describedby", "blad");
    expect(pole.parentElement).toHaveAttribute("data-invalid", "true");
  });

  it("poprawne pole nie ma `aria-invalid`, a jawne `aria-invalid` wygrywa", () => {
    const { rerender } = render(<FieldBox label="E-mail" />);
    const pole = screen.getByRole("textbox", { name: "E-mail" });
    expect(pole).not.toHaveAttribute("aria-invalid");
    expect(pole.parentElement).not.toHaveAttribute("data-invalid");
    rerender(<FieldBox label="E-mail" aria-invalid="false" invalid />);
    expect(pole).toHaveAttribute("aria-invalid", "false");
  });

  it("element po prawej zostawia miejsce w polu i jest klikalny", () => {
    const onClick = vi.fn();
    render(
      <FieldBox
        label="Hasło"
        type="password"
        className="col-span-2"
        trailing={
          <button type="button" onClick={onClick}>
            Pokaż
          </button>
        }
      />,
    );
    const pole = screen.getByLabelText("Hasło");
    expect(pole.className).toBe("input pr-11");
    expect(pole.parentElement?.className).toBe("input-group min-w-0 col-span-2");
    fireEvent.click(screen.getByRole("button", { name: "Pokaż" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("przekazuje ref i zdarzenia do pola", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    render(<FieldBox ref={ref} label="Miasto" onChange={onChange} />);
    const pole = screen.getByRole("textbox", { name: "Miasto" });
    expect(ref.current).toBe(pole);
    fireEvent.change(pole, { target: { value: "Gdańsk" } });
    expect(onChange).toHaveBeenCalledOnce();
    expect((pole as HTMLInputElement).value).toBe("Gdańsk");
  });
});
