// Atom filtra fasetowego - reguła widoczności i mapowanie „wszystkie".
//
// Wyciągnięty z eksploratora materiałów, bo obie jego reguły były wcześniej
// nietestowalne osobno: wymiar bez opcji ma ZNIKNĄĆ (filtr, który niczego nie
// zawęzi, to szum w pasku), chyba że jest wymiarem szkieletowym - a wybór
// pozycji „wszystkie" musi wrócić do rodzica jako `null`, nie jako wartość
// wartownicza, bo to `null` decyduje o skasowaniu klucza z URL-a.
//
// PUŁAPKA HARNESSU: Radix Select nie otwiera się w happy-dom (konwencja repo,
// patrz `FormSelect.test.tsx`), więc prymitywy podmieniamy na natywny
// `<select>` - przedmiotem testu jest kontrakt atomu, nie rysowanie listy.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Props = Record<string, unknown> & { children?: React.ReactNode };
  const tag = (kind: string, Comp: (p: Props) => React.ReactNode) => Object.assign(Comp, { kind });

  const SelectItem = tag("item", ({ value, children }: Props) => (
    <option value={String(value)}>{children}</option>
  ));
  const SelectContent = tag("content", ({ children }: Props) => <>{children}</>);
  const SelectTrigger = tag("trigger", () => null);
  const SelectValue = tag("value", () => null);

  const Select = ({ value, onValueChange, children }: Props) => {
    let label: string | undefined;
    const items: React.ReactElement[] = [];
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const kind = (child.type as { kind?: string }).kind;
      const props = child.props as Props;
      if (kind === "trigger") label = props["aria-label"] as string;
      if (kind === "content") {
        React.Children.forEach(props.children, (item, i) => {
          if (React.isValidElement(item)) items.push(React.cloneElement(item, { key: i }));
        });
      }
    });
    return (
      <select
        aria-label={label}
        value={String(value ?? "")}
        onChange={(e) => (onValueChange as (v: string) => void)?.(e.target.value)}
      >
        {items}
      </select>
    );
  };

  return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

const { FACET_ALL, FacetSelect } = await import("@/components/experts/atoms/FacetSelect");

const OPTIONS = [
  { value: "energia", label: "Energia" },
  { value: "klimat", label: "Klimat" },
];

describe("FacetSelect", () => {
  it("wymiar BEZ opcji znika z paska", () => {
    const { container } = render(
      <FacetSelect
        value={null}
        onChange={() => {}}
        options={[]}
        allLabel="Wszystkie"
        ariaLabel="Temat"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("wymiar szkieletowy zostaje nawet pusty", () => {
    // Temat i region trzymają szerokość paska filtrów: znikanie i pojawianie
    // się kontrolek przy każdej zmianie wyniku przestawiałoby sąsiadów pod
    // kursorem użytkownika.
    render(
      <FacetSelect
        value={null}
        onChange={() => {}}
        options={[]}
        allLabel="Wszystkie"
        ariaLabel="Temat"
        alwaysShow
      />,
    );
    expect(screen.getByLabelText("Temat")).toBeInTheDocument();
  });

  it("pusta wartość pokazuje pozycję „wszystkie”", () => {
    render(
      <FacetSelect
        value={null}
        onChange={() => {}}
        options={OPTIONS}
        allLabel="Wszystkie formaty"
        ariaLabel="Format"
      />,
    );
    expect(screen.getByLabelText("Format")).toHaveValue(FACET_ALL);
  });

  it("wybór pozycji zwraca jej wartość", () => {
    const onChange = vi.fn();
    render(
      <FacetSelect
        value={null}
        onChange={onChange}
        options={OPTIONS}
        allLabel="Wszystkie"
        ariaLabel="Temat"
      />,
    );
    fireEvent.change(screen.getByLabelText("Temat"), { target: { value: "klimat" } });
    expect(onChange).toHaveBeenCalledWith("klimat");
  });

  it("wybór „wszystkie” zwraca NULL, nie wartość wartowniczą", () => {
    // Rodzic mapuje `null` na skasowanie klucza z URL-a. Gdyby atom oddawał
    // tu `"__all__"`, w adresie profilu lądowałoby `?topic=__all__`.
    const onChange = vi.fn();
    render(
      <FacetSelect
        value="klimat"
        onChange={onChange}
        options={OPTIONS}
        allLabel="Wszystkie"
        ariaLabel="Temat"
      />,
    );
    fireEvent.change(screen.getByLabelText("Temat"), { target: { value: FACET_ALL } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("liczność dopisuje się do etykiety tylko, gdy ją podano", () => {
    render(
      <FacetSelect
        value={null}
        onChange={() => {}}
        options={[
          { value: "a", label: "Artykuły", count: 12 },
          { value: "b", label: "Raporty" },
        ]}
        allLabel="Wszystkie"
        ariaLabel="Format"
      />,
    );
    const select = screen.getByLabelText("Format");
    expect(select.textContent).toContain("Artykuły (12)");
    expect(select.textContent).toContain("Raporty");
    expect(select.textContent).not.toContain("Raporty (");
  });

  it("liczność ZERO też jest wypisana - to nie to samo co brak liczby", () => {
    render(
      <FacetSelect
        value={null}
        onChange={() => {}}
        options={[{ value: "a", label: "Wideo", count: 0 }]}
        allLabel="Wszystkie"
        ariaLabel="Format"
      />,
    );
    expect(screen.getByLabelText("Format").textContent).toContain("Wideo (0)");
  });
});
