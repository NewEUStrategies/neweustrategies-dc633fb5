// CO DOWODZI TEN PLIK: `TriStateSelect` tłumaczy trójstan nadpisania („dziedzicz
// z ustawień globalnych / włącz / wyłącz") na jeden mały select - w obie strony.
// Istniejący `TriStateSelect.test.tsx` sprawdza kierunek WARTOŚĆ -> ETYKIETA;
// tutaj domykamy kierunek WYBÓR -> WARTOŚĆ, który jest tym groźniejszym.
//
// Dlaczego to ważne dla użytkownika: `undefined` znaczy „NIE nadpisuj, słuchaj
// ustawień globalnych", a `false` znaczy „nadpisz na WYŁĄCZONE". Pomyłka między
// nimi jest niewidoczna w interfejsie i trwała w bazie: wpis z „dziedzicz"
// zapisany jako `false` przestaje reagować na globalną zmianę layoutu (np.
// włączenie stopki autora dla całego serwisu ominie stare wpisy), a wpis
// zapisany jako `undefined` zamiast `false` nagle pokazuje sekcję, którą
// redakcja świadomie wyłączyła.
//
// Osie macierzy: trzy wartości wejściowe (null/undefined, true, false) x trzy
// wybory użytkownika (dziedzicz, włącz, wyłącz), plus kontrakt propu `className`
// (atom jedzie w gęstym wierszu i wywołujący musi móc go zwężyć).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { TriStateSelect } from "../TriStateSelect";

// Etykiety podaje wywołujący (gotowe teksty z `t()`), więc atom jest wolny od
// i18n - tu wystarczą jednoznaczne stałe.
const LABELS = { inherit: "Dziedzicz", on: "Włącz", off: "Wyłącz" };

function renderSelect(
  value: boolean | null | undefined,
  extra: { className?: string } = {},
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <TriStateSelect
      value={value}
      onChange={onChange}
      labels={LABELS}
      className={extra.className}
    />,
  );
  return onChange as unknown as ReturnType<typeof vi.fn>;
}

/** Otwiera listę Radiksa klawiaturą (pointer events nie działają w happy-dom). */
function openOptions(): HTMLElement {
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

function pick(optionLabel: string): void {
  fireEvent.click(within(openOptions()).getByRole("option", { name: optionLabel }));
}

afterEach(cleanup);

describe("TriStateSelect - wybór użytkownika trafia do wywołującego jako właściwa wartość", () => {
  it("„włącz” to twarde nadpisanie `true`", () => {
    const onChange = renderSelect(undefined);
    pick("Włącz");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("„wyłącz” to twarde nadpisanie `false`, a NIE wyczyszczenie nadpisania", () => {
    const onChange = renderSelect(undefined);
    pick("Wyłącz");
    expect(onChange).toHaveBeenCalledWith(false);
    // Kluczowa różnica: `false` musi być prawdziwym `false`, nie czymś fałszywym
    // jak `undefined`/`null` - inaczej wpis wróciłby pod ustawienia globalne.
    expect(onChange.mock.calls[0]?.[0]).toBe(false);
  });

  it("„dziedzicz” CZYŚCI nadpisanie (`undefined`), nie ustawia `false`", () => {
    const onChange = renderSelect(true);
    pick("Dziedzicz");
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(onChange.mock.calls[0]?.[0]).toBeUndefined();
  });

  it("z nadpisania „wyłączone” da się wrócić do dziedziczenia", () => {
    const onChange = renderSelect(false);
    pick("Dziedzicz");
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("wybór tej samej wartości nie generuje pustego zapisu", () => {
    // Radix nie woła `onValueChange`, gdy wartość się nie zmienia. Dzięki temu
    // otwarcie i zamknięcie selecta nie brudzi formularza (autosave nie strzela).
    const onChange = renderSelect(true);
    pick("Włącz");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("TriStateSelect - stan widoczny dla użytkownika", () => {
  it.each([
    ["dziedziczenie przy `undefined`", undefined, "Dziedzicz"],
    ["dziedziczenie przy `null` (kolumna z bazy bez nadpisania)", null, "Dziedzicz"],
    ["włączone przy `true`", true, "Włącz"],
    ["wyłączone przy `false`", false, "Wyłącz"],
  ] as const)("kontrolka ogłasza %s", (_opis, value, expected) => {
    renderSelect(value);
    // Nazwa dostępna triggera bierze się z wybranej opcji - czytnik ekranu
    // ogłasza dokładnie ten sam stan, który widzi osoba patrząca.
    expect(screen.getByRole("combobox")).toHaveTextContent(expected);
  });

  it("słownik jest domknięty do trzech opcji w stałej kolejności", () => {
    // Kolejność jest częścią kontraktu: „dziedzicz" jest pierwszy, bo to stan
    // domyślny i najczęstszy wybór powrotny.
    renderSelect(undefined);
    expect(
      within(openOptions())
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Dziedzicz", "Włącz", "Wyłącz"]);
  });

  it("na rozwiniętej liście zaznaczona jest AKTUALNA wartość, nie pierwsza opcja", () => {
    // Redaktor otwierający listę musi od razu widzieć, co jest ustawione teraz -
    // inaczej „dziedzicz" (pierwsza pozycja) wygląda na wybrane zawsze.
    renderSelect(false);
    const options = within(openOptions()).getAllByRole("option");
    const checked = options.filter((o) => o.getAttribute("data-state") === "checked");
    expect(checked.map((o) => o.textContent)).toEqual(["Wyłącz"]);
  });
});

describe("TriStateSelect - kontrakt propów", () => {
  it("wywołujący może przewymiarować kontrolkę własnym `className`", () => {
    // Atom jedzie w wierszu „etykieta ..... kontrolka" o wysokości 28 px; bez
    // tego propu każdy wywołujący musiałby owijać go dodatkowym divem.
    renderSelect(undefined, { className: "h-6 w-44" });
    expect(screen.getByRole("combobox").className).toContain("w-44");
  });

  it("bez `className` zostaje domyślny, kompaktowy rozmiar", () => {
    renderSelect(undefined);
    expect(screen.getByRole("combobox").className).toContain("w-32");
  });

  // SWIADEK DEFEKTU (D4): atom nie przyjmuje ani `id`, ani `aria-label`, ani
  // `aria-labelledby`, więc kontrolki NIE DA SIĘ nazwać z zewnątrz. W karcie
  // nadpisań layoutu (`LayoutOverridesCard`) wiersze mają etykiety w zwykłym
  // `<span>`, więc czytnik ekranu ogłasza pięć identycznych, nienazwanych list
  // rozwijanych - użytkownik niewidzący nie wie, którą stopkę właśnie zmienia.
  // Test opisuje stan OBECNY: po dodaniu przekazywania nazwy celowo pęknie.
  it("kontrolka nie ma żadnej dostępnej nazwy poza wybraną wartością", () => {
    renderSelect(undefined);
    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toHaveAttribute("aria-label");
    expect(trigger).not.toHaveAttribute("aria-labelledby");
  });
});
