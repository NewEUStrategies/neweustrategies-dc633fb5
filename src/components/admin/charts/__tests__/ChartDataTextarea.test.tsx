// Pole tekstowe danych wykresu w panelu widgetu: wklejony ARKUSZ zamienia
// się na format średnikowy z kropką dziesiętną (jedna zmiana pola), a zwykły
// tekst wkleja się natywnie.
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-admin-blocks";
import { ChartDataTextarea } from "../ChartDataTextarea";

function wklej(cel: Element, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (typ: string) => (typ === "text/plain" ? text : "") },
  });
  act(() => {
    cel.dispatchEvent(ev);
  });
  return ev;
}

/** Pole sterowane jak w panelu: wartość wraca od rodzica. */
function Host({ start, onChange }: { start: string; onChange: (v: string) => void }) {
  const [v, setV] = useState(start);
  return (
    <ChartDataTextarea
      value={v}
      onChange={(next) => {
        onChange(next);
        setV(next);
      }}
    />
  );
}

describe("ChartDataTextarea", () => {
  it("zakres z arkusza zastępuje treść pola formatem średnikowym", () => {
    const onChange = vi.fn();
    render(<Host start={"; A\n2024; 1"} onChange={onChange} />);
    const ev = wklej(screen.getByRole("textbox"), "\tEksport\n2023\t12,5\n2024\tabc");
    expect(ev.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("; Eksport\n2023; 12.5\n2024; ");
    // Komórka, która liczbą nie była, jest zgłoszona pod polem.
    expect(screen.getByText(/1 komórek nie jest liczbą/)).toBeInTheDocument();
  });

  it("problemy wklejki znikają, gdy pole przestaje trzymać jej tekst (edycja, cofnięcie)", () => {
    const { rerender } = render(<ChartDataTextarea value="" onChange={() => {}} />);
    wklej(screen.getByRole("textbox"), "\tEksport\n2023\tabc\n2024\t5");
    // Rodzic oddaje tekst wklejki - zgłoszenie stoi pod polem.
    rerender(<ChartDataTextarea value={"; Eksport\n2023; \n2024; 5"} onChange={() => {}} />);
    expect(screen.getByText(/1 komórek nie jest liczbą/)).toBeInTheDocument();
    // Następna edycja (albo Ctrl+Z w historii buildera) zmienia treść.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "; A\n2024; 1" } });
    rerender(<ChartDataTextarea value={"; A\n2024; 1"} onChange={() => {}} />);
    expect(screen.queryByText(/1 komórek nie jest liczbą/)).toBeNull();
  });

  it("zwykły tekst wkleja się natywnie", () => {
    const onChange = vi.fn();
    render(<ChartDataTextarea value="" onChange={onChange} />);
    const ev = wklej(screen.getByRole("textbox"), "; A\n2024; 1");
    expect(ev.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
