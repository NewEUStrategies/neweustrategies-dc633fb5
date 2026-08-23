// Kafel liczby w widgecie darowizn (atom `stats-strip`). RYZYKIEM jest tu
// KONTRAST: akcent koloru wpisuje redakcja w edytorze CMS, a kafel wstrzykuje
// go inline - jeśli trafi na liczbę, kwota zbiórki może zniknąć na tle karty.
//
// CO TEN PLIK DOWODZI.
//   1. Akcent maluje WYŁĄCZNIE wiersz etykiety; liczba zostaje na kolorze
//      motywu. To jedna linia `style={accent ? ... : undefined}` - tsc widzi ją
//      jako poprawną w obu wariantach, a różnicę widać tylko na ekranie.
//   2. Brak akcentu nie zostawia pustego atrybutu `style` (inline pusty styl
//      wygrywa z motywem w niektórych przeglądarkach).
//   3. Atom NIE formatuje kwoty - dostaje gotowy napis, więc waluta i grosze
//      są decyzją modelu, nie kafla.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Formatowania kwot dowodzi
// `__tests__/donationsWidgetModel.test.ts` (fmtMoney).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DonationStatBox } from "../DonationStatBox";

afterEach(cleanup);

function renderBox(accent?: string) {
  const { container } = render(
    <DonationStatBox
      icon={<svg data-testid="ikona" />}
      label="Suma wsparcia"
      value="1 234,56 zł"
      accent={accent}
    />,
  );
  const kafel = container.firstElementChild as HTMLElement;
  const label = kafel.children[0] as HTMLElement;
  const value = kafel.children[1] as HTMLElement;
  return { container, kafel, label, value };
}

describe("DonationStatBox", () => {
  it("DECYZJA: akcent maluje etykietę, a NIE liczbę", () => {
    const { label, value } = renderBox("#c0392b");
    expect(label.style.color).toBe("#c0392b");
    expect(value.getAttribute("style")).toBeNull();
    expect(value).toHaveTextContent("1 234,56 zł");
  });

  it("DECYZJA: bez akcentu kafel nie wstawia inline stylu - kolor zostaje przy motywie", () => {
    const { label } = renderBox();
    expect(label.getAttribute("style")).toBeNull();
    expect(label.className).toContain("text-muted-foreground");
  });

  it("DECYZJA: pusty napis akcentu jest traktowany jak brak akcentu", () => {
    const { label } = renderBox("");
    expect(label.getAttribute("style")).toBeNull();
  });

  it("DECYZJA: ikona i etykieta jadą w jednym wierszu, wartość osobno pod spodem", () => {
    const { label, value, kafel } = renderBox("#000");
    expect(label.querySelector("[data-testid='ikona']")).not.toBeNull();
    expect(value.querySelector("[data-testid='ikona']")).toBeNull();
    expect(kafel.textContent).toBe("Suma wsparcia1 234,56 zł");
  });

  it("DECYZJA: atom nie formatuje liczby - oddaje dokładnie ten napis, który dostał", () => {
    const { value } = renderBox();
    expect(value.textContent).toBe("1 234,56 zł");
  });
});
