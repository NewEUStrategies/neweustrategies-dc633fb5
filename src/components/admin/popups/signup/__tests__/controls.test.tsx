// Kontrolki edytora popupu rejestracji - wspólne prymitywy wszystkich sześciu
// zakładek.
//
// PO CO OSOBNY PLIK. Te kontrolki są używane po kilkanaście razy każda, więc
// jeden błąd w prymitywie mnoży się przez cały edytor. Najgroźniejsze są dwie
// rzeczy:
//   1. POLE LICZBOWE. Klamrowanie na każdym znaku uniemożliwiało wpisanie „9"
//      w polu o minimum 12 (skok do 12) i wyczyszczenie pola. Dlatego pole
//      trzyma surowy tekst w trakcie pisania, a normalizuje przy opuszczeniu -
//      i to zachowanie musi być przybite, bo bez niego operator nie potrafi
//      wpisać docelowej wartości.
//   2. OSTRZEŻENIE O KONTRAŚCIE. To jedyna bariera przed wypuszczeniem popupu z
//      tekstem nieczytelnym dla części odwiedzających (WCAG AA = 4,5:1).
//      Ostrzeżenie, które nie zapala się przy 3:1, nie chroni nikogo.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Picker ikon ciągnie katalog całej platformy - w teście kontrolki wystarczy
// atrapa oddająca wybraną nazwę.
vi.mock("@/components/admin/builder/ui/molecules/LucideIconPicker", () => ({
  LucideIconPicker: ({ value, onChange }: { value?: string; onChange: (v?: string) => void }) => (
    <button type="button" aria-label="picker-ikon" onClick={() => onChange("Star")}>
      {value ?? "brak"}
    </button>
  ),
}));
vi.mock("@/lib/icons/DynamicIcon", () => ({
  DynamicIcon: ({ name }: { name: string }) => <span data-testid="ikona">{name}</span>,
}));

import {
  BilingualRow,
  ColorRow,
  ContrastNote,
  IconRow,
  NumberRow,
  OrderRow,
  SectionCard,
  SegmentedRow,
  TextRow,
  ToggleRow,
} from "@/components/admin/popups/signup/controls";

/** Pole tekstowe kontrolki (pole koloru ma osobny próbnik obok napisu). */
function textInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input:not([type="color"])');
  expect(input, "kontrolka bez pola tekstowego").toBeTruthy();
  return input!;
}

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
describe("etykiety są POWIĄZANE z polami", () => {
  // Bez powiązania czytnik ekranu ogłasza „pole edycji" i operator musi zgadywać,
  // które to z kilkunastu pokrętek zakładki.
  it("pole tekstowe da się znaleźć po etykiecie", () => {
    render(<TextRow label="Nagłówek" value="" onChange={vi.fn()} />);

    expect(screen.getByLabelText("Nagłówek")).toBeTruthy();
    expect(screen.getByLabelText("Nagłówek").tagName).toBe("INPUT");
  });

  it("pole liczbowe da się znaleźć po etykiecie", () => {
    render(<NumberRow label="Szerokość" value={20} onChange={vi.fn()} min={12} max={60} />);

    expect(screen.getByLabelText("Szerokość")).toBeTruthy();
    expect(screen.getByLabelText("Szerokość").getAttribute("type")).toBe("number");
  });

  it("para PL/EN ma DWIE różne, rozróżnialne etykiety", () => {
    render(<BilingualRow label="Tytuł" pl="Polski" en="English" onPl={vi.fn()} onEn={vi.fn()} />);

    expect((screen.getByLabelText("Tytuł (PL)") as HTMLInputElement).value).toBe("Polski");
    expect((screen.getByLabelText("Tytuł (EN)") as HTMLInputElement).value).toBe("English");
  });

  it("DWIE instancje tej samej kontrolki nie kolidują identyfikatorami", () => {
    // Paleta ciemna i jasna stoją obok siebie w tej samej zakładce.
    render(
      <>
        <TextRow label="Tło" value="a" onChange={vi.fn()} />
        <TextRow label="Tło" value="b" onChange={vi.fn()} />
      </>,
    );

    const ids = screen.getAllByLabelText("Tło").map((el) => el.getAttribute("id"));
    expect(ids.filter(Boolean)).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("karta sekcji", () => {
  it("pokazuje tytuł, podpowiedź i zawartość", () => {
    render(
      <SectionCard title="Układ" hint="Jak popup dzieli się na kolumny">
        <p>zawartość</p>
      </SectionCard>,
    );

    expect(screen.getByText("Układ")).toBeTruthy();
    expect(screen.getByText("Jak popup dzieli się na kolumny")).toBeTruthy();
    expect(screen.getByText("zawartość")).toBeTruthy();
  });

  it("bez podpowiedzi nie zostawia pustego akapitu", () => {
    const { container } = render(
      <SectionCard title="Układ">
        <span />
      </SectionCard>,
    );

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("pole tekstowe", () => {
  it("każdy znak leci do dokumentu", () => {
    const onChange = vi.fn<(v: string) => void>();
    const { container } = render(<TextRow label="Nagłówek" value="" onChange={onChange} />);

    fireEvent.change(textInput(container), { target: { value: "Zapisz się" } });

    expect(onChange).toHaveBeenCalledWith("Zapisz się");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("limit długości jest przekazany do pola - obcięcie po zapisie byłoby ciche", () => {
    const { container } = render(
      <TextRow label="Nagłówek" value="" onChange={vi.fn()} maxLength={40} />,
    );

    expect(textInput(container).getAttribute("maxlength")).toBe("40");
    expect(screen.getByText("Nagłówek")).toBeTruthy();
  });

  it("podpowiedź i placeholder są widoczne, gdy podane", () => {
    render(
      <TextRow
        label="Nagłówek"
        value=""
        onChange={vi.fn()}
        placeholder="np. Zapisz się"
        hint="Do 40 znaków"
      />,
    );

    expect(screen.getByPlaceholderText("np. Zapisz się")).toBeTruthy();
    expect(screen.getByText("Do 40 znaków")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("para pól PL/EN", () => {
  function mount(props: Record<string, unknown> = {}) {
    const onPl = vi.fn<(v: string) => void>();
    const onEn = vi.fn<(v: string) => void>();
    render(
      <BilingualRow label="Tytuł" pl="Polski" en="English" onPl={onPl} onEn={onEn} {...props} />,
    );
    return { onPl, onEn };
  }

  it("edycja POLSKIEJ wersji nie woła handlera angielskiej", () => {
    // Wspólny handler gubiłby drugi język przy każdej edycji.
    const { onPl, onEn } = mount();

    fireEvent.change(screen.getByDisplayValue("Polski"), { target: { value: "Nowy" } });

    expect(onPl).toHaveBeenCalledWith("Nowy");
    expect(onEn).not.toHaveBeenCalled();
  });

  it("edycja ANGIELSKIEJ wersji nie woła handlera polskiej", () => {
    const { onPl, onEn } = mount();

    fireEvent.change(screen.getByDisplayValue("English"), { target: { value: "New" } });

    expect(onEn).toHaveBeenCalledWith("New");
    expect(onPl).not.toHaveBeenCalled();
  });

  it("wariant wielolinijkowy daje DWA obszary tekstu", () => {
    const { container } = render(
      <BilingualRow label="Treść" pl="a" en="b" onPl={vi.fn()} onEn={vi.fn()} multiline rows={5} />,
    );

    const areas = container.querySelectorAll("textarea");
    expect(areas).toHaveLength(2);
    expect(areas[0]?.getAttribute("rows")).toBe("5");
  });

  it("wariant wielolinijkowy też edytuje oba języki NIEZALEŻNIE", () => {
    // Treść zgody RODO jest wielolinijkowa - to najdłuższy tekst tego popupu i
    // najkosztowniejszy do odtworzenia, gdy patch zgubi jeden język.
    const onPl = vi.fn<(v: string) => void>();
    const onEn = vi.fn<(v: string) => void>();
    render(
      <BilingualRow label="Zgoda" pl="Polska" en="English" onPl={onPl} onEn={onEn} multiline />,
    );

    fireEvent.change(screen.getByDisplayValue("English"), { target: { value: "New consent" } });

    expect(onEn).toHaveBeenCalledWith("New consent");
    expect(onPl).not.toHaveBeenCalled();
  });

  it("oba pola mają placeholdery i podpowiedź", () => {
    mount({ placeholderPl: "PL…", placeholderEn: "EN…", hint: "Obie wersje" });

    expect(screen.getByPlaceholderText("PL…")).toBeTruthy();
    expect(screen.getByPlaceholderText("EN…")).toBeTruthy();
    expect(screen.getByText("Obie wersje")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("pole liczbowe", () => {
  function mount(props: Partial<Parameters<typeof NumberRow>[0]> = {}) {
    const onChange = vi.fn<(v: number) => void>();
    const { container } = render(
      <NumberRow label="Szerokość" value={20} onChange={onChange} min={12} max={60} {...props} />,
    );
    return { onChange, input: textInput(container) };
  }

  it("wartość w zakresie leci od razu", () => {
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "35" } });

    expect(onChange).toHaveBeenCalledWith(35);
  });

  it("CYFRA PONIŻEJ minimum jest przyjmowana w polu, ale NIE leci do dokumentu", () => {
    // To jest sedno: bez tego operator chcący wpisać „35" w polu o minimum 12
    // po wpisaniu „3" dostawał natychmiastowy skok do 12 i nie mógł dokończyć.
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "3" } });

    expect(input.value).toBe("3");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("PUSTE pole da się zostawić w trakcie pisania", () => {
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "" } });

    expect(input.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opuszczenie pola NORMALIZUJE wartość do granicy", () => {
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(12);
    expect(input.value).toBe("12");
  });

  it("wartość ponad maksimum jest ścinana do maksimum przy opuszczeniu", () => {
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(60);
    expect(input.value).toBe("60");
  });

  it("opuszczenie PUSTEGO pola przywraca poprzednią wartość, nie zero", () => {
    // Zero w szerokości kolumny zwinęłoby galerię do niewidocznej kreski.
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(input.value).toBe("20");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("śmieci w polu też przywracają poprzednią wartość", () => {
    const { onChange, input } = mount();

    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input.value).toBe("20");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opuszczenie pola z wartością BEZ zmiany nie zapisuje niczego", () => {
    const { onChange, input } = mount();

    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("20");
  });

  it("zakres i krok są przekazane do pola", () => {
    const { input } = mount({ step: 5 });

    expect(input.getAttribute("min")).toBe("12");
    expect(input.getAttribute("max")).toBe("60");
    expect(input.getAttribute("step")).toBe("5");
  });

  it("zmiana wartości Z ZEWNĄTRZ jest widoczna, gdy pole nie jest edytowane", () => {
    const onChange = vi.fn<(v: number) => void>();
    const { container, rerender } = render(
      <NumberRow label="Szerokość" value={20} onChange={onChange} min={12} max={60} />,
    );

    rerender(<NumberRow label="Szerokość" value={44} onChange={onChange} min={12} max={60} />);

    expect(textInput(container).value).toBe("44");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zmiana Z ZEWNĄTRZ nie nadpisuje tego, co operator właśnie pisze", () => {
    // Inaczej podgląd na żywo wyrywałby kursor z pola przy każdym renderze.
    const onChange = vi.fn<(v: number) => void>();
    const { container, rerender } = render(
      <NumberRow label="Szerokość" value={20} onChange={onChange} min={12} max={60} />,
    );
    const input = textInput(container);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "3" } });
    rerender(<NumberRow label="Szerokość" value={44} onChange={onChange} min={12} max={60} />);

    expect(input.value).toBe("3");
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("pole koloru", () => {
  it("wpisany kolor leci do dokumentu w formie, jaką podał operator", () => {
    const onChange = vi.fn<(v: string) => void>();
    const { container } = render(<ColorRow label="Tło" value="#112233" onChange={onChange} />);

    fireEvent.change(textInput(container), { target: { value: "var(--brand)" } });

    expect(onChange).toHaveBeenCalledWith("var(--brand)");
  });

  it("wybór z próbnika też patchuje dokument", () => {
    const onChange = vi.fn<(v: string) => void>();
    const { container } = render(<ColorRow label="Tło" value="#112233" onChange={onChange} />);

    fireEvent.change(container.querySelector('input[type="color"]')!, {
      target: { value: "#445566" },
    });

    expect(onChange).toHaveBeenCalledWith("#445566");
  });

  it("wartość NIE-HEX nie wywala próbnika - schodzi na czerń", () => {
    // W tym edytorze kolory mogą być tokenami CSS („var(--brand)"), których
    // `input[type=color]` nie przyjmie; bez tej ochrony pole byłoby puste i
    // przeglądarka zgłaszałaby błąd na każdym renderze.
    const { container } = render(<ColorRow label="Tło" value="var(--brand)" onChange={vi.fn()} />);

    const swatch = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(swatch.value).toBe("#000000");
    expect(screen.getByDisplayValue("var(--brand)")).toBeTruthy();
  });

  it("skrócony hex też nie trafia do próbnika", () => {
    const { container } = render(<ColorRow label="Tło" value="#abc" onChange={vi.fn()} />);

    expect((container.querySelector('input[type="color"]') as HTMLInputElement).value).toBe(
      "#000000",
    );
  });
});

// ---------------------------------------------------------------------------
describe("przełącznik", () => {
  it("kliknięcie zapisuje BOOLEAN", () => {
    const onChange = vi.fn<(v: boolean) => void>();
    render(<ToggleRow label="Bez zawijania" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByText("Bez zawijania")).toBeTruthy();
  });

  it("ZABLOKOWANY przełącznik nie zapisuje niczego", () => {
    // Blokada oznacza „to pole jest wymuszone" - klik nie może jej obejść.
    const onChange = vi.fn<(v: boolean) => void>();
    render(<ToggleRow label="E-mail" checked onChange={onChange} disabled />);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toHaveProperty("disabled", true);
  });
});

// ---------------------------------------------------------------------------
describe("wybór segmentowany", () => {
  const OPTIONS = [
    { value: "left", label: "Lewa", desc: "Galeria po lewej" },
    { value: "right", label: "Prawa" },
  ] as const;

  it("aktywna opcja jest OZNACZONA dla czytnika ekranu", () => {
    render(<SegmentedRow label="Strona" value="left" options={OPTIONS} onChange={vi.fn()} />);

    expect(screen.getByText("Lewa").closest("button")!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Prawa").closest("button")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("kliknięcie oddaje WARTOŚĆ opcji, nie jej etykietę", () => {
    const onChange = vi.fn<(v: "left" | "right") => void>();
    render(<SegmentedRow label="Strona" value="left" options={OPTIONS} onChange={onChange} />);

    fireEvent.click(screen.getByText("Prawa"));

    expect(onChange).toHaveBeenCalledWith("right");
  });

  it("opis opcji jest pokazany, gdy podany", () => {
    render(<SegmentedRow value="left" options={OPTIONS} onChange={vi.fn()} hint="Podpowiedź" />);

    expect(screen.getByText("Galeria po lewej")).toBeTruthy();
    expect(screen.getByText("Podpowiedź")).toBeTruthy();
  });

  it("liczba kolumn siatki idzie za liczbą opcji, a jawna wygrywa", () => {
    const { container, unmount } = render(
      <SegmentedRow value="left" options={OPTIONS} onChange={vi.fn()} />,
    );
    expect(container.querySelector<HTMLElement>("div.grid")!.style.gridTemplateColumns).toContain(
      "repeat(2,",
    );
    unmount();

    const { container: c2 } = render(
      <SegmentedRow value="left" options={OPTIONS} onChange={vi.fn()} columns={1} />,
    );
    expect(c2.querySelector<HTMLElement>("div.grid")!.style.gridTemplateColumns).toContain(
      "repeat(1,",
    );
  });
});

// ---------------------------------------------------------------------------
describe("kolejność bloków", () => {
  const LABELS = { a: "Pierwszy", b: "Drugi", c: "Trzeci" } as const;

  function mount(items: Array<"a" | "b" | "c"> = ["a", "b", "c"]) {
    const onChange = vi.fn<(next: Array<"a" | "b" | "c">) => void>();
    render(
      <OrderRow
        label="Kolejność"
        items={items}
        labels={LABELS}
        onChange={onChange}
        upLabel="W górę"
        downLabel="W dół"
      />,
    );
    return onChange;
  }

  it("bloki są numerowane w kolejności ustawienia", () => {
    mount();

    expect(screen.getByText("1.")).toBeTruthy();
    expect(screen.getByText("3.")).toBeTruthy();
  });

  it("przesunięcie w dół oddaje CAŁĄ nową kolejność", () => {
    const onChange = mount();

    fireEvent.click(screen.getByLabelText("W dół: Pierwszy"));

    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("przesunięcie w górę też oddaje całą kolejność", () => {
    const onChange = mount();

    fireEvent.click(screen.getByLabelText("W górę: Trzeci"));

    expect(onChange).toHaveBeenCalledWith(["a", "c", "b"]);
  });

  it("na KRAŃCACH przyciski są zablokowane - blok nie wypada z listy", () => {
    mount();

    expect(screen.getByLabelText("W górę: Pierwszy")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("W dół: Trzeci")).toHaveProperty("disabled", true);
  });

  it("przesunięcie nie mutuje listy wejściowej", () => {
    const items: Array<"a" | "b" | "c"> = ["a", "b", "c"];
    const onChange = vi.fn();
    render(
      <OrderRow
        label="Kolejność"
        items={items}
        labels={LABELS}
        onChange={onChange}
        upLabel="W górę"
        downLabel="W dół"
      />,
    );

    fireEvent.click(screen.getByLabelText("W dół: Pierwszy"));

    expect(items).toEqual(["a", "b", "c"]);
  });

  it("podpowiedź jest pokazana, gdy podana", () => {
    const onChange = vi.fn();
    render(
      <OrderRow
        label="Kolejność"
        hint="Przeciągnij strzałkami"
        items={["a", "b"]}
        labels={LABELS}
        onChange={onChange}
        upLabel="W górę"
        downLabel="W dół"
      />,
    );

    expect(screen.getByText("Przeciągnij strzałkami")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("ostrzeżenie o kontraście", () => {
  const message = (ratio: string) => `Kontrast ${ratio}:1 jest za niski`;

  it("ZAPALA SIĘ przy kontraście poniżej progu WCAG AA", () => {
    // To jedyna bariera przed wypuszczeniem popupu z tekstem nieczytelnym dla
    // części odwiedzających.
    render(<ContrastNote bg="#777777" fg="#888888" message={message} />);

    expect(screen.getByText(/jest za niski/)).toBeTruthy();
  });

  it("MILCZY przy kontraście spełniającym próg", () => {
    render(<ContrastNote bg="#ffffff" fg="#000000" message={message} />);

    expect(screen.queryByText(/jest za niski/)).toBeNull();
  });

  it("podaje wyliczony współczynnik, nie sam komunikat", () => {
    // Bez liczby operator nie wie, o ile musi poprawić kolor.
    render(<ContrastNote bg="#777777" fg="#888888" message={message} />);

    expect(screen.getByText(/Kontrast \d+\.\d+:1/)).toBeTruthy();
  });

  it("kolor NIEROZPOZNANY (token CSS) nie daje fałszywego ostrzeżenia", () => {
    // Tokenu nie da się policzyć w przeglądarce, a ostrzeżenie „na wszelki
    // wypadek" przy każdym tokenie nauczyłoby operatora je ignorować.
    const { container } = render(<ContrastNote bg="var(--brand)" fg="#000000" message={message} />);

    expect(container.innerHTML).toBe("");
  });

  it("kolejność argumentów nie ma znaczenia - liczy się sam stosunek", () => {
    const { container: a } = render(<ContrastNote bg="#000000" fg="#ffffff" message={message} />);
    const { container: b } = render(<ContrastNote bg="#ffffff" fg="#000000" message={message} />);

    expect(a.innerHTML).toBe(b.innerHTML);
  });
});

// ---------------------------------------------------------------------------
describe("wybór ikony", () => {
  function mount(value = "") {
    const onChange = vi.fn<(v: string) => void>();
    render(
      <IconRow
        label="Ikona przycisku"
        value={value}
        onChange={onChange}
        clearLabel="Bez ikony"
        previewLabel="Podgląd"
      />,
    );
    return onChange;
  }

  it("wybór z pickera zapisuje NAZWĘ ikony", () => {
    const onChange = mount();

    fireEvent.click(screen.getByLabelText("picker-ikon"));

    expect(onChange).toHaveBeenCalledWith("Star");
  });

  it("„bez ikony” jest ZABLOKOWANE, gdy ikony nie ma", () => {
    mount();

    expect(screen.getByText("Bez ikony").closest("button")).toHaveProperty("disabled", true);
  });

  it("„bez ikony” CZYŚCI wybór - inaczej nie dałoby się go cofnąć", () => {
    const onChange = mount("Star");

    fireEvent.click(screen.getByText("Bez ikony"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("podgląd pokazuje wybraną ikonę, a bez wyboru kreskę", () => {
    mount("Star");
    expect(screen.getByTestId("ikona").textContent).toBe("Star");
    cleanup();

    mount("");
    expect(screen.queryByTestId("ikona")).toBeNull();
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("podpowiedź jest pokazana, gdy podana", () => {
    const onChange = vi.fn();
    render(
      <IconRow
        label="Ikona"
        value=""
        onChange={onChange}
        clearLabel="Bez ikony"
        previewLabel="Podgląd"
        hint="Z biblioteki platformy"
      />,
    );

    expect(screen.getByText("Z biblioteki platformy")).toBeTruthy();
  });
});
