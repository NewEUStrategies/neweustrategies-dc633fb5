// Trzy atomy liczbowe paneli właściwości: `NumberInput` (czysta liczba),
// `StepperInput` (liczba Z JEDNOSTKĄ CSS) i wspólne strzałki `StepperButtons`.
//
// Najczęstszy prawdziwy błąd w takich polach to potraktowanie zera jak braku
// wartości ("0 jest falsy") oraz zgubienie jednostki przy klikaniu strzałką
// (`16rem` -> `17px` psuje typografię całej strony). Oba przypadki mają tu
// własne asercje, a nie tylko przypadkowe pokrycie linii.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NumberInput } from "../NumberInput";
import { StepperInput } from "../StepperInput";
import { StepperButtons } from "../StepperButtons";
import { SidesInput } from "../SidesInput";
import type { BoxSides } from "@/lib/builder/types";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

const UP = "builder.stepper.increase";
const DOWN = "builder.stepper.decrease";

describe("NumberInput - wpisywanie", () => {
  it.each([
    ["wartość prawidłowa", "24", 24],
    ["zero", "0", 0],
    ["wartość ujemna", "-8", -8],
    ["ułamek", "1.5", 1.5],
  ])("przekazuje %s", (_label, typed, expected) => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} ariaLabel="rozmiar" />);
    fireEvent.change(screen.getByLabelText("rozmiar"), { target: { value: typed } });
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("puste pole zapisuje undefined, a nie zero", () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} ariaLabel="rozmiar" />);
    fireEvent.change(screen.getByLabelText("rozmiar"), { target: { value: "" } });
    // Zero i „brak wartości" to w dokumencie DWA różne stany: 0 znaczy
    // „zeruj odstęp", undefined znaczy „dziedzicz / auto".
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("pokazuje pustkę dla wartości undefined, a zero pokazuje jako zero", () => {
    const { rerender } = render(
      <NumberInput value={undefined} onChange={vi.fn()} ariaLabel="rozmiar" />,
    );
    expect((screen.getByLabelText("rozmiar") as HTMLInputElement).value).toBe("");
    rerender(<NumberInput value={0} onChange={vi.fn()} ariaLabel="rozmiar" />);
    expect((screen.getByLabelText("rozmiar") as HTMLInputElement).value).toBe("0");
  });

  it("przekazuje zakres i krok do kontrolki", () => {
    render(<NumberInput value={2} onChange={vi.fn()} min={0} max={5} step={0.5} ariaLabel="r" />);
    const input = screen.getByLabelText("r");
    expect(input).toHaveAttribute("min", "0");
    expect(input).toHaveAttribute("max", "5");
    expect(input).toHaveAttribute("step", "0.5");
  });

  it("rysuje sufiks jednostki, gdy podany", () => {
    const { rerender } = render(<NumberInput value={1} onChange={vi.fn()} suffix="s" />);
    expect(screen.getByText("s")).toBeInTheDocument();
    rerender(<NumberInput value={1} onChange={vi.fn()} />);
    expect(screen.queryByText("s")).toBeNull();
  });

  it("przekazuje placeholder", () => {
    render(<NumberInput value={undefined} onChange={vi.fn()} placeholder="auto" ariaLabel="r" />);
    expect((screen.getByLabelText("r") as HTMLInputElement).placeholder).toBe("auto");
  });
});

describe("NumberInput - strzałki", () => {
  it.each([
    ["w górę", "ArrowUp", false, 11],
    ["w dół", "ArrowDown", false, 9],
    ["w górę z Shift", "ArrowUp", true, 20],
    ["w dół z Shift", "ArrowDown", true, 0],
  ])("klawiatura %s", (_label, key, shiftKey, expected) => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} ariaLabel="r" />);
    fireEvent.keyDown(screen.getByLabelText("r"), { key, shiftKey });
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("ignoruje pozostałe klawisze", () => {
    const onChange = vi.fn();
    render(<NumberInput value={10} onChange={onChange} ariaLabel="r" />);
    fireEvent.keyDown(screen.getByLabelText("r"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("liczy od zera, gdy wartości nie ma", () => {
    const onChange = vi.fn();
    render(<NumberInput value={undefined} onChange={onChange} ariaLabel="r" />);
    fireEvent.click(screen.getByLabelText(UP));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it.each([
    ["dolny kraniec", DOWN, 0],
    ["górny kraniec", UP, 4],
  ])("klampuje na %s", (_label, label, expected) => {
    const onChange = vi.fn();
    const value = label === DOWN ? 0 : 4;
    render(<NumberInput value={value} onChange={onChange} min={0} max={4} ariaLabel="r" />);
    fireEvent.click(screen.getByLabelText(label));
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("nie klampuje, gdy zakres jest otwarty z jednej strony", () => {
    const onChange = vi.fn();
    render(<NumberInput value={0} onChange={onChange} max={10} ariaLabel="r" />);
    fireEvent.click(screen.getByLabelText(DOWN));
    // Brak `min` to nie „min = 0": ujemne przesunięcie cienia MUSI być możliwe.
    expect(onChange).toHaveBeenLastCalledWith(-1);
  });

  it.each([
    ["krok dziesiętny", 0.05, 0.1, 0.15],
    ["krok połówkowy", 0.5, 1, 1.5],
    ["krok całkowity", 2, 4, 6],
  ])("zaokrągla wynik dla: %s", (_label, step, start, expected) => {
    const onChange = vi.fn();
    render(<NumberInput value={start} onChange={onChange} step={step} ariaLabel="r" />);
    fireEvent.click(screen.getByLabelText(UP));
    // Bez zaokrąglenia po liczbie miejsc krok 0,05 dałby 0.15000000000000002
    // i taka wartość wylądowałaby w dokumencie.
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("dla kroku w notacji wykładniczej używa zapasowej precyzji", () => {
    const onChange = vi.fn();
    // `String(1e-7)` to "1e-7" - nie ma części po kropce, więc gałąź `?? 2`
    // decyduje o zaokrągleniu. Bez niej byłoby `undefined` w `toFixed`.
    render(<NumberInput value={1} onChange={onChange} step={1e-7} ariaLabel="r" />);
    fireEvent.click(screen.getByLabelText(UP));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });
});

describe("StepperButtons", () => {
  it("obie strzałki mają etykiety i wywołują swoje akcje", () => {
    const onIncrement = vi.fn();
    const onDecrement = vi.fn();
    render(<StepperButtons onIncrement={onIncrement} onDecrement={onDecrement} />);
    fireEvent.click(screen.getByLabelText(UP));
    fireEvent.click(screen.getByLabelText(DOWN));
    expect(onIncrement).toHaveBeenCalledTimes(1);
    expect(onDecrement).toHaveBeenCalledTimes(1);
  });

  it("strzałki są poza kolejnością Tab", () => {
    render(<StepperButtons onIncrement={vi.fn()} onDecrement={vi.fn()} />);
    // Tabowanie po dwóch strzałkach przy każdym polu panelu zamieniłoby
    // klawiaturową nawigację po formularzu w mękę - stąd tabIndex -1.
    expect(screen.getByLabelText(UP)).toHaveAttribute("tabindex", "-1");
    expect(screen.getByLabelText(DOWN)).toHaveAttribute("tabindex", "-1");
  });
});

describe("StepperInput - jednostki", () => {
  const value = (): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>("input");
    if (!el) throw new Error("test: brak kontrolki");
    return el;
  };

  it.each([
    ["piksele", "16px", "17px"],
    ["rem", "1.25rem", "2.25rem"],
    ["em", "2em", "3em"],
    ["procenty", "120%", "121%"],
    ["vh", "50vh", "51vh"],
    ["vw", "10vw", "11vw"],
    ["jednostka wielkimi literami", "16PX", "17px"],
    ["ze spacjami", " 16 px ", "17px"],
    ["bez jednostki", "16", "17px"],
    ["ułamek", "0.5rem", "1.5rem"],
    ["ujemna", "-4px", "-3px"],
  ])("zachowuje jednostkę przy strzałce: %s", (_label, start, expected) => {
    const onChange = vi.fn();
    render(<StepperInput value={start} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(UP));
    // Podmiana jednostki na px psułaby skalowanie typografii - stąd parser
    // czyta jednostkę z aktualnej wartości i oddaje ją nietkniętą.
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it.each([
    ["puste", undefined],
    ["pusty napis", ""],
    ["śmieci", "abc"],
    ["sama jednostka", "px"],
    ["nieznana jednostka", "16ch"],
  ])("liczy od zera i domyśla się px dla wartości: %s", (_label, start) => {
    const onChange = vi.fn();
    render(<StepperInput value={start} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(UP));
    expect(onChange).toHaveBeenLastCalledWith("1px");
  });

  it("zaokrągla px i procenty do liczb całkowitych", () => {
    const onChange = vi.fn();
    render(<StepperInput value="16.4px" onChange={onChange} step={0.3} />);
    fireEvent.click(screen.getByLabelText(UP));
    expect(onChange).toHaveBeenLastCalledWith("17px");
  });

  it("zostawia dwie cyfry po kropce dla jednostek względnych", () => {
    const onChange = vi.fn();
    render(<StepperInput value="1rem" onChange={onChange} step={0.125} />);
    fireEvent.click(screen.getByLabelText(UP));
    expect(onChange).toHaveBeenLastCalledWith("1.13rem");
  });

  it.each([
    ["dolny", DOWN, 0, "0px"],
    ["górny", UP, 100, "100px"],
  ])("klampuje kraniec %s", (_label, label, _bound, expected) => {
    const onChange = vi.fn();
    render(<StepperInput value={expected} onChange={onChange} min={0} max={100} />);
    fireEvent.click(screen.getByLabelText(label));
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it.each([
    ["w górę o dziesięć kroków", "ArrowUp", true, "26px"],
    ["w dół o dziesięć kroków", "ArrowDown", true, "6px"],
    ["w górę o krok", "ArrowUp", false, "17px"],
    ["w dół o krok", "ArrowDown", false, "15px"],
  ])("klawiatura: %s", (_label, key, shiftKey, expected) => {
    const onChange = vi.fn();
    render(<StepperInput value="16px" onChange={onChange} />);
    fireEvent.keyDown(value(), { key, shiftKey });
    expect(onChange).toHaveBeenLastCalledWith(expected);
  });

  it("ignoruje pozostałe klawisze", () => {
    const onChange = vi.fn();
    render(<StepperInput value="16px" onChange={onChange} />);
    fireEvent.keyDown(value(), { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wyczyszczenie pola zapisuje undefined", () => {
    const onChange = vi.fn();
    render(<StepperInput value="16px" onChange={onChange} />);
    fireEvent.change(value(), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("przepuszcza wpisywanie w trakcie, bez normalizacji", () => {
    const onChange = vi.fn();
    render(<StepperInput value="" onChange={onChange} />);
    fireEvent.change(value(), { target: { value: "1.2" } });
    // Normalizacja w locie („1.2" -> „1.2px") uniemożliwiłaby dopisanie „rem".
    expect(onChange).toHaveBeenLastCalledWith("1.2");
  });

  it("placeholder: domyślny i własny", () => {
    const { rerender } = render(<StepperInput value={undefined} onChange={vi.fn()} />);
    expect(value().placeholder).toBe("16px");
    rerender(<StepperInput value={undefined} onChange={vi.fn()} placeholder="auto" />);
    expect(value().placeholder).toBe("auto");
  });

  it("scala własną klasę z klasą bazową", () => {
    const { container } = render(<StepperInput value="1px" onChange={vi.fn()} className="mt-2" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("mt-2");
  });
});

describe("SidesInput", () => {
  const cell = (label: string): HTMLInputElement => {
    const el = document.querySelector<HTMLInputElement>(`input[placeholder="${label}"]`);
    if (!el) throw new Error(`test: brak pola ${label}`);
    return el;
  };

  it("rysuje cztery strony z jednostką", () => {
    render(<SidesInput value={{ top: 1, right: 2, bottom: 3, left: 4 }} onChange={vi.fn()} />);
    expect(cell("T").value).toBe("1");
    expect(cell("R").value).toBe("2");
    expect(cell("B").value).toBe("3");
    expect(cell("L").value).toBe("4");
    expect(screen.getByText("top (px)")).toBeInTheDocument();
  });

  it("pokazuje własną jednostkę", () => {
    render(<SidesInput value={{}} onChange={vi.fn()} suffix="%" />);
    expect(screen.getByText("left (%)")).toBeInTheDocument();
  });

  it("bez wartości pokazuje cztery puste pola", () => {
    render(<SidesInput onChange={vi.fn()} />);
    for (const k of ["T", "R", "B", "L"]) expect(cell(k).value).toBe("");
  });

  it.each([
    ["top", "T", 5],
    ["right", "R", 6],
    ["bottom", "B", 7],
    ["left", "L", 8],
  ])("zapisuje stronę %s zachowując pozostałe", (side, label, next) => {
    const onChange = vi.fn<(v: BoxSides) => void>();
    render(<SidesInput value={{ top: 1, right: 1, bottom: 1, left: 1 }} onChange={onChange} />);
    fireEvent.change(cell(label), { target: { value: String(next) } });
    // Zapis MUSI być scalający - inaczej ustawienie góry zerowałoby resztę.
    expect(onChange).toHaveBeenLastCalledWith({
      top: 1,
      right: 1,
      bottom: 1,
      left: 1,
      [side]: next,
    });
  });

  it("zero jest wartością, pustka jest brakiem wartości", () => {
    const onChange = vi.fn<(v: BoxSides) => void>();
    render(<SidesInput value={{ top: 4 }} onChange={onChange} />);
    fireEvent.change(cell("T"), { target: { value: "0" } });
    expect(onChange).toHaveBeenLastCalledWith({ top: 0 });
    fireEvent.change(cell("T"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ top: undefined });
  });
});
