// MENU SLASH W AKAPICIE (`SlashMenu`) - lista podpowiedzi pod karetka po „/".
//
// Komponent jest CZYSTO PREZENTACYJNY: filtr („/nag" -> Nagłówek) liczy
// rodzic (`Paragraph`), a strzalki/Enter sa routowane z TipTapa. Do obrony
// zostaje wiec to, co menu samo oddaje redaktorowi i rodzicowi:
//   * NAZWY pozycji ida ze slownika (`blocks.types.*`) - te same co w inserterze
//     i na liscie dokumentu, a lista ma nazwe dostepna (listbox),
//   * `aria-selected` stoi WYLACZNIE na pozycji aktywnej - to jedyny sygnal dla
//     czytnika ekranu, ktora pozycja wybierze Enter,
//   * klik oddaje rodzicowi DOKLADNIE kliknieta specyfikacje, a najechanie -
//     jej indeks (rodzic trzyma aktywna pozycje u siebie),
//   * `mousedown` jest anulowany: TipTap trzyma fokus w akapicie i gdyby klik
//     go zabral, menu zamknieloby sie PRZED kliknieciem (wybor mysza nie
//     dzialalby wcale),
//   * aktywna pozycja jest przewijana do widoku przy zmianie aktywnej pozycji,
//     a indeks spoza listy (rodzic po zawezeniu filtra) niczego nie przewija,
//   * pusta lista mowi „Brak wynikow", zamiast rysowac pusty listbox.
//
// GRANICE: `scrollIntoView` nie istnieje w happy-dom, wiec stoi tu szpieg na
// prototypie (granica przegladarki). Slownik jest prawdziwy (`realT`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { BLOCK_SPECS, type BlockSpec } from "@/lib/blocks/registry";
import { realT } from "@/test/i18nReal";
import { SlashMenu } from "../SlashMenu";

const t = realT("pl");

const SPECS: readonly BlockSpec[] = [BLOCK_SPECS.heading, BLOCK_SPECS.quote, BLOCK_SPECS.image];

let przewin: ReturnType<typeof vi.fn>;
const oryginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  przewin = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    writable: true,
    value: przewin,
  });
});

afterEach(() => {
  if (oryginal) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", oryginal);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

function zamontuj(specs: readonly BlockSpec[] = SPECS, activeIndex = 0) {
  const onPick = vi.fn<(spec: BlockSpec) => void>();
  const onHover = vi.fn<(index: number) => void>();
  const view = render(
    <SlashMenu specs={specs} activeIndex={activeIndex} onPick={onPick} onHover={onHover} />,
  );
  const rerender = (nextIndex: number, nextSpecs: readonly BlockSpec[] = specs) =>
    view.rerender(
      <SlashMenu specs={nextSpecs} activeIndex={nextIndex} onPick={onPick} onHover={onHover} />,
    );
  return { onPick, onHover, rerender };
}

function lista(): HTMLElement {
  return screen.getByRole("listbox", { name: t("blocks.inserter.resultsLabel") });
}

describe("SlashMenu - co widzi redaktor i czytnik ekranu", () => {
  it("pozycje nazywaja sie ze slownika, w kolejnosci podanej przez rodzica", () => {
    zamontuj();

    // Nazwa dostepna pozycji zaczyna sie od nazwy typu ze slownika (dalej stoi
    // opis z rejestru).
    const opcje = within(lista()).getAllByRole("option");
    expect(opcje).toHaveLength(3);
    for (const [i, typ] of (["heading", "quote", "image"] as const).entries()) {
      expect(opcje[i]).toHaveAccessibleName(new RegExp(`^${t(`blocks.types.${typ}`)}\\b`));
    }
  });

  it("aria-selected stoi WYLACZNIE na pozycji aktywnej", () => {
    zamontuj(SPECS, 1);

    const opcje = within(lista()).getAllByRole("option");
    expect(opcje.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  });

  it("pusta lista mowi „Brak wynikow” i nie rysuje zadnej pozycji", () => {
    zamontuj([]);

    expect(within(lista()).getByText(t("blocks.noResults"))).toBeInTheDocument();
    expect(within(lista()).queryAllByRole("option")).toHaveLength(0);
  });
});

describe("SlashMenu - wybor mysza", () => {
  it("klik oddaje rodzicowi DOKLADNIE kliknieta specyfikacje", () => {
    const { onPick } = zamontuj();

    fireEvent.click(within(lista()).getAllByRole("option")[2]);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(BLOCK_SPECS.image);
  });

  it("najechanie mysza zglasza indeks pozycji, a nie jej typ", () => {
    const { onHover, onPick } = zamontuj();

    fireEvent.mouseEnter(within(lista()).getAllByRole("option")[1]);

    expect(onHover).toHaveBeenCalledWith(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("mousedown na pozycji jest anulowany - fokus zostaje w akapicie", () => {
    zamontuj();

    // `fireEvent` oddaje `false`, gdy handler zawolal `preventDefault()`.
    const przepuszczony = fireEvent.mouseDown(within(lista()).getAllByRole("option")[0]);

    expect(przepuszczony).toBe(false);
  });
});

describe("SlashMenu - aktywna pozycja w widoku", () => {
  it("zmiana aktywnej pozycji przewija DOKLADNIE ja do widoku listy", () => {
    const { rerender } = zamontuj(SPECS, 0);
    przewin.mockClear();

    rerender(2);

    expect(przewin).toHaveBeenCalledTimes(1);
    expect(przewin).toHaveBeenCalledWith({ block: "nearest" });
    expect(przewin.mock.contexts[0]).toBe(within(lista()).getAllByRole("option")[2]);
  });

  it("indeks spoza listy (filtr wlasnie ja zawezil) niczego nie przewija", () => {
    const { rerender } = zamontuj(SPECS, 0);
    przewin.mockClear();

    rerender(5, [BLOCK_SPECS.heading]);

    expect(przewin).not.toHaveBeenCalled();
  });
});
