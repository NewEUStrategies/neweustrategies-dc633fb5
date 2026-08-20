// Wizualny wybór punktu ostrości zdjęcia. Atom liczy PROCENTY z geometrii
// elementu, więc test podstawia deterministyczny prostokąt (happy-dom oddaje
// same zera i każdy wynik byłby NaN) i sprawdza trzy rzeczy, które w produkcji
// psują się najczęściej:
//   1. klik poza obrazkiem musi być klampowany do 0-100, a nie zapisywać
//      ujemnych procent (obraz „ucieka" wtedy z kadru),
//   2. przeciąganie działa tylko z wciśniętym przyciskiem myszy,
//   3. adres obrazka przechodzi przez `safeImageUrl` - `javascript:` i
//      `data:text/html` nie mogą wylądować w atrybucie `src`.
//
// NIEPOKRYTE ŚWIADOMIE: `if (!el) return` w `update` (FocalPointPicker.tsx:35).
// Referencja jest pusta wyłącznie przed montowaniem, a każdy z obsługiwanych
// tu zdarzeń wisi na TYM SAMYM elemencie, do którego wskazuje referencja -
// więc gałąź jest osiągalna tylko przez sztuczne wyzerowanie `ref.current`,
// co testowałoby atrapę, nie kod.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FocalPointPicker } from "../FocalPointPicker";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

/**
 * Prostokąt 200x100 zaczepiony w (100, 50). Dzięki temu przeliczenie jest
 * policzalne na piechotę: clientX 200 to 50% szerokości, clientY 100 to 50%
 * wysokości.
 */
function stubRect(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 50,
    left: 100,
    top: 50,
    right: 300,
    bottom: 150,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  });
}

const canvas = (): HTMLElement => screen.getByRole("application");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FocalPointPicker - przeliczanie kliknięcia", () => {
  it.each([
    ["środek", 200, 100, 50, 50],
    ["lewy górny róg", 100, 50, 0, 0],
    ["prawy dolny róg", 300, 150, 100, 100],
    ["ćwiartka", 150, 75, 25, 25],
    ["poza kadrem w lewo i w górę", 0, 0, 0, 0],
    ["poza kadrem w prawo i w dół", 9000, 9000, 100, 100],
  ])("%s", (_label, clientX, clientY, x, y) => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={50} y={50} onChange={onChange} />);
    fireEvent.mouseDown(canvas(), { clientX, clientY });
    expect(onChange).toHaveBeenLastCalledWith(x, y);
  });

  it("zaokrągla procenty do liczb całkowitych", () => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={0} y={0} onChange={onChange} />);
    // 101 z 200 to 0,5% - dokument ma dostać 1, nie 0.5.
    fireEvent.mouseDown(canvas(), { clientX: 101, clientY: 51 });
    expect(onChange).toHaveBeenLastCalledWith(1, 1);
  });
});

describe("FocalPointPicker - przeciąganie", () => {
  it("ruch myszy bez wciśniętego przycisku nic nie zmienia", () => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={0} y={0} onChange={onChange} />);
    fireEvent.mouseMove(canvas(), { clientX: 200, clientY: 100 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ruch po naciśnięciu aktualizuje punkt na bieżąco", () => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={0} y={0} onChange={onChange} />);
    fireEvent.mouseDown(canvas(), { clientX: 100, clientY: 50 });
    fireEvent.mouseMove(canvas(), { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(canvas(), { clientX: 300, clientY: 150 });
    expect(onChange).toHaveBeenNthCalledWith(2, 50, 50);
    expect(onChange).toHaveBeenLastCalledWith(100, 100);
  });

  it.each([
    ["puszczenie przycisku", "mouseUp"],
    ["wyjechanie kursorem poza kadr", "mouseLeave"],
  ] as const)("%s kończy przeciąganie", (_label, event) => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={0} y={0} onChange={onChange} />);
    fireEvent.mouseDown(canvas(), { clientX: 100, clientY: 50 });
    if (event === "mouseUp") fireEvent.mouseUp(canvas());
    else fireEvent.mouseLeave(canvas());
    onChange.mockClear();
    fireEvent.mouseMove(canvas(), { clientX: 250, clientY: 120 });
    // Bez zamknięcia przeciągania kursor „ciągnąłby" punkt po powrocie nad
    // kadr, mimo że użytkownik już puścił przycisk.
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FocalPointPicker - dotyk", () => {
  it("dotknięcie i przesunięcie palcem ustawia punkt", () => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={0} y={0} onChange={onChange} />);
    fireEvent.touchStart(canvas(), { touches: [{ clientX: 200, clientY: 100 }] });
    expect(onChange).toHaveBeenLastCalledWith(50, 50);
    fireEvent.touchMove(canvas(), { touches: [{ clientX: 300, clientY: 150 }] });
    // Dotyk NIE wymaga wcześniejszego „naciśnięcia" - palec na ekranie już
    // jest naciśnięciem, więc `touchmove` działa bez flagi przeciągania.
    expect(onChange).toHaveBeenLastCalledWith(100, 100);
  });

  it.each([
    ["dotknięcie", "touchStart"],
    ["przesunięcie", "touchMove"],
  ] as const)("zdarzenie dotyku bez punktów jest ignorowane: %s", (_label, event) => {
    stubRect();
    const onChange = vi.fn();
    render(<FocalPointPicker image="https://cdn.test/a.jpg" x={0} y={0} onChange={onChange} />);
    if (event === "touchStart") fireEvent.touchStart(canvas(), { touches: [] });
    else fireEvent.touchMove(canvas(), { touches: [] });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FocalPointPicker - obrazek i podgląd", () => {
  it("rysuje obrazek z pozycją obiektu wyliczoną z punktu", () => {
    const { container } = render(
      <FocalPointPicker image="https://cdn.test/a.jpg" x={20} y={80} onChange={vi.fn()} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.test/a.jpg");
    expect(img?.style.objectPosition).toBe("20% 80%");
    expect(img?.getAttribute("draggable")).toBe("false");
  });

  it("klampuje pozycję podglądu, gdy dokument trzyma wartości poza zakresem", () => {
    const { container } = render(
      <FocalPointPicker image="https://cdn.test/a.jpg" x={-40} y={400} onChange={vi.fn()} />,
    );
    // Dokument mógł zostać zapisany starszą wersją edytora - podgląd i tak
    // musi pokazać kadr, a nie wysunąć obraz poza ramkę.
    expect(container.querySelector("img")?.style.objectPosition).toBe("0% 100%");
  });

  it.each([
    ["brak adresu", ""],
    ["schemat javascript", "javascript:alert(1)"],
    ["data:text/html", "data:text/html,<b>x</b>"],
  ])("bez bezpiecznego obrazka pokazuje podpowiedź: %s", (_label, image) => {
    const { container } = render(
      <FocalPointPicker image={image} x={50} y={50} onChange={vi.fn()} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("builder.chrome.noImageAddUrl")).toBeInTheDocument();
  });

  it("przyjmuje własny współczynnik proporcji i kolor tła", () => {
    const { container } = render(
      <FocalPointPicker
        image=""
        x={50}
        y={50}
        onChange={vi.fn()}
        aspectCls="aspect-square"
        placeholderColor="#101010"
      />,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain("aspect-square");
    expect(box.style.background).toBe("#101010");
  });

  it("domyślnie 16:10 i brak tła zastępczego", () => {
    const { container } = render(<FocalPointPicker image="" x={50} y={50} onChange={vi.fn()} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toContain("aspect-[16/10]");
    expect(box.style.background).toBe("");
  });

  it("krzyżyk stoi w miejscu punktu ostrości", () => {
    const { container } = render(
      <FocalPointPicker image="https://cdn.test/a.jpg" x={30} y={70} onChange={vi.fn()} />,
    );
    const dot = container.querySelector<HTMLElement>("div.rounded-full");
    expect(dot?.style.left).toBe("30%");
    expect(dot?.style.top).toBe("70%");
  });
});
