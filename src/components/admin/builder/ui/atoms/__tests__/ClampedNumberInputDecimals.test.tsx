// ClampedNumberInput w trybie ułamkowym i bez górnej granicy.
//
// Atom był dotąd wyłącznie całkowity, więc panele z polem ułamkowym (skala
// aktywnej pozycji koła, ocena pozycji listy) zostawały przy `<Input
// type="number">` z zapisem `Number(v) || domyślna` bez klamry - panel
// pokazywał wartość, której renderer nie rysował. Tryb ułamkowy włącza się
// JAWNIE (`precision`), więc dotychczasowe wywołania (pliki-bracia:
// `ClampedNumberInput.test.tsx`) zachowują się bez zmian - także filtr, który
// odrzuca „1.5" w polu całkowitym.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ClampedNumberInput } from "../ClampedNumberInput";

const field = () => screen.getByRole("textbox", { name: "skala" }) as HTMLInputElement;

describe("ClampedNumberInput - tryb ułamkowy", () => {
  it("przyjmuje ułamek z kropką i przecinkiem, zatwierdzając go w locie", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={1.15}
        min={1}
        max={1.6}
        step={0.05}
        precision={2}
        ariaLabel="skala"
        onCommit={onCommit}
      />,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "1.3" } });
    expect(field().value).toBe("1.3");
    expect(onCommit).toHaveBeenLastCalledWith(1.3);
    fireEvent.change(field(), { target: { value: "1,45" } });
    expect(field().value).toBe("1,45");
    expect(onCommit).toHaveBeenLastCalledWith(1.45);
  });

  it("stany pośrednie ułamka („1.”, „.”) nie blokują pisania", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={4}
        min={0}
        max={10}
        precision={1}
        ariaLabel="skala"
        onCommit={onCommit}
      />,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "." } });
    expect(field().value).toBe(".");
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "7." } });
    expect(field().value).toBe("7.");
    fireEvent.change(field(), { target: { value: "7.5" } });
    expect(field().value).toBe("7.5");
    expect(onCommit).toHaveBeenLastCalledWith(7.5);
  });

  it("odrzuca więcej miejsc po przecinku, niż pozwala precyzja", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={4.5}
        min={0}
        max={10}
        precision={1}
        ariaLabel="skala"
        onCommit={onCommit}
      />,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "4.55" } });
    // Druga cyfra po przecinku nie istnieje w modelu - pole jej nie przyjmuje,
    // zamiast pokazywać wartość, która po zapisie się zmieni.
    expect(field().value).toBe("4.5");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("klampuje i zaokrągla do precyzji przy zatwierdzeniu", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={1.15}
        min={1}
        max={1.6}
        step={0.05}
        precision={2}
        ariaLabel="skala"
        onCommit={onCommit}
      />,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "2.5" } });
    // Poza zakresem: widok trzyma wpis (można go poprawić), dokument - nie.
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(1.6);
    expect(field().value).toBe("1.6");
    // Wklejka obsłużona przez przeglądarkę może mieć więcej cyfr - zatwierdzenie
    // je zaokrągla, a nie zapisuje dosłownie.
    fireEvent.blur(field(), { target: { value: "1.234" } });
    expect(onCommit).toHaveBeenLastCalledWith(1.23);
  });

  it("samo przejście przez pole nie zapisuje, także wartości spoza zakresu", () => {
    // NAPRAWIONE 2026-10-19: wyjście z pola bez edycji klampowało i zapisywało
    // wartość dokumentu (ocena 15 -> 5): przejście Tabem przez panel zmieniało
    // dokument i dawało wpis w historii cofania.
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={15}
        min={0}
        max={5}
        precision={1}
        ariaLabel="skala"
        onCommit={onCommit}
      />,
    );
    fireEvent.focus(field());
    fireEvent.blur(field());
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    // Edycja dalej działa i jest klampowana.
    fireEvent.change(field(), { target: { value: "9" } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(5);
  });

  it("zatwierdzenie tej samej liczby co w dokumencie nie daje drugiego zapisu", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={2} min={0} max={5} ariaLabel="skala" onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "02" } });
    fireEvent.blur(field());
    // „02” w locie to już 2 - zapis byłby pustym krokiem historii.
    expect(onCommit.mock.calls).toEqual([[2]]);
    expect(field().value).toBe("2");
  });

  it("krok strzałki i wyjście z pola nie dają drugiego zapisu tej samej liczby", () => {
    // Rodzic, który jeszcze nie oddał nowej wartości (zapis asynchroniczny),
    // nie może dostać drugiego zapisu przy wyjściu z pola.
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={2} min={0} max={5} ariaLabel="skala" onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.blur(field());
    expect(onCommit.mock.calls).toEqual([[3]]);
  });

  it("wpis spoza zakresu domknięty do pokazanej wartości jest zapisywany", () => {
    // Pokazana wartość bywa ODZIEDZICZONA (rozpiętość kolumny na telefonie
    // pokazuje desktopową, gdy telefon nie ma własnej). Redaktor wpisał
    // liczbę - zapis musi pójść, tak jak poszedłby wpis „12” w zakresie,
    // inaczej „99” na telefonie nie przypinało niczego, a „12” przypinało.
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={12} min={1} max={12} ariaLabel="skala" onCommit={onCommit} />,
    );
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "99" } });
    fireEvent.blur(field());
    expect(onCommit.mock.calls).toEqual([[12]]);
    expect(field().value).toBe("12");
  });

  it("krok strzałki jest zaokrąglany, więc nie zostawia ogona binarnego", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput
        value={1.1}
        min={1}
        max={1.6}
        step={0.05}
        precision={2}
        ariaLabel="skala"
        onCommit={onCommit}
      />,
    );
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    // 1.1 + 0.05 w arytmetyce zmiennoprzecinkowej to 1.1500000000000001.
    expect(onCommit).toHaveBeenLastCalledWith(1.15);
    expect(field().value).toBe("1.15");
  });

  it("pole ułamkowe prosi o klawiaturę dziesiętną, całkowite - numeryczną", () => {
    const { unmount } = render(
      <ClampedNumberInput
        value={1}
        min={0}
        max={2}
        precision={1}
        ariaLabel="skala"
        onCommit={vi.fn()}
      />,
    );
    expect(field().getAttribute("inputmode")).toBe("decimal");
    unmount();
    render(<ClampedNumberInput value={1} min={0} max={2} ariaLabel="skala" onCommit={vi.fn()} />);
    expect(field().getAttribute("inputmode")).toBe("numeric");
  });
});

describe("ClampedNumberInput - bez górnej granicy", () => {
  // Część rendererów domyka wartość tylko od dołu (czas animacji >= 300 ms,
  // przesunięcie listy >= 0). Wymyślona górna granica w panelu byłaby
  // rozjazdem w drugą stronę: panel ucinałby to, co kanwa rysuje.
  it("zatwierdza dowolnie dużą wartość, a dolną granicę dalej domyka", () => {
    const onCommit = vi.fn();
    render(<ClampedNumberInput value={1600} min={300} ariaLabel="skala" onCommit={onCommit} />);
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "25000" } });
    expect(onCommit).toHaveBeenLastCalledWith(25000);
    fireEvent.change(field(), { target: { value: "120" } });
    fireEvent.blur(field());
    expect(onCommit).toHaveBeenLastCalledWith(300);
    expect(field().value).toBe("300");
  });

  it("strzałka z Shiftem nie ma sufitu", () => {
    const onCommit = vi.fn();
    render(
      <ClampedNumberInput value={1000} min={0} step={100} ariaLabel="skala" onCommit={onCommit} />,
    );
    fireEvent.keyDown(field(), { key: "ArrowUp", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(2000);
  });
});
