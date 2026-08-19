// Karta wyboru opcji dwujęzycznych (programy / regiony) w edytorze wpisu.
//
// CO TU DOWODZIMY: że zaznaczenie i odznaczenie opcji daje rodzicowi POPRAWNĄ
// nową listę identyfikatorów (dopisanie zachowuje poprzednie, usunięcie zdejmuje
// TYLKO swój wpis) i że etykieta nie dubluje nazwy, gdy wersja PL i EN są takie
// same albo gdy EN jest puste.
//
// DLACZEGO TO WAŻNE: to jedyne miejsce, w którym redakcja przypina wpis do
// programu i regionu, a te przypisania decydują, na jakich stronach tematycznych
// wpis się w ogóle pokaże. Zły updater (nadpisanie listy jednym elementem
// zamiast dopisania albo dopisanie duplikatu) gubi wcześniejsze przypisania lub
// wysyła do bazy zdublowane wiersze - redaktor nie widzi żadnego błędu, a wpis
// znika ze strony programu. Zdublowana etykieta („Erasmus+ / Erasmus+") to szum
// w liście, przez który dłużej szuka się właściwej pozycji.
//
// Wybór jest STEROWANY (`selectedIds` + `onSelectedChange`), więc kliknięcia
// odpalamy na opakowaniu z prawdziwym `useState`: tylko wtedy React woła updater
// w swoim naturalnym momencie i asercja mówi o tym, CO WIDZI użytkownik, a nie
// o tym, jaką funkcję dostał rodzic.
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BilingualPickerCard } from "../BilingualPickerCard";

const PROGRAMS = [
  { id: "p1", name_pl: "Fundusze strukturalne", name_en: "Structural funds" },
  { id: "p2", name_pl: "Erasmus+", name_en: "Erasmus+" },
  { id: "p3", name_pl: "Horyzont Europa", name_en: "" },
];

/**
 * `options` jest JAWNE w każdym przypadku (bez wartości domyślnej), bo jednym
 * z testowanych stanów jest właśnie `undefined` - „słownik jeszcze się nie
 * wczytał".
 */
function Harness({
  initial = [],
  options,
  onChangeSpy,
}: {
  initial?: string[];
  options: typeof PROGRAMS | undefined;
  onChangeSpy?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  return (
    <div>
      <output data-testid="wybrane">{selected.join(",")}</output>
      <BilingualPickerCard
        label="etykieta.programow"
        options={options}
        selectedIds={selected}
        onSelectedChange={(next) => {
          onChangeSpy?.();
          setSelected(next);
        }}
        emptyHint="podpowiedz.brak"
      />
    </div>
  );
}

const boxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];
const selected = () => screen.getByTestId("wybrane").textContent;

describe("BilingualPickerCard - lista opcji", () => {
  it("pokazuje etykietę karty i po jednym checkboksie na opcję", () => {
    render(<Harness options={PROGRAMS} />);

    expect(screen.getByText("etykieta.programow")).toBeInTheDocument();
    expect(boxes()).toHaveLength(3);
  });

  it("dokleja wersję EN tylko wtedy, gdy różni się od PL i nie jest pusta", () => {
    render(<Harness options={PROGRAMS} />);

    // Różne nazwy - obie widoczne, bo redakcja pracuje w dwóch językach.
    expect(screen.getByText(/Fundusze strukturalne \/ Structural funds/)).toBeInTheDocument();
    // Nazwa identyczna w obu językach: bez dublowania.
    expect(screen.queryByText(/Erasmus\+ \/ Erasmus\+/)).not.toBeInTheDocument();
    expect(screen.getByText("Erasmus+")).toBeInTheDocument();
    // Puste EN to brak tłumaczenia, nie nazwa do pokazania.
    expect(screen.queryByText(/Horyzont Europa \//)).not.toBeInTheDocument();
    expect(screen.getByText("Horyzont Europa")).toBeInTheDocument();
  });

  it("zaznacza checkboksy zgodnie z listą wybranych identyfikatorów", () => {
    render(<Harness options={PROGRAMS} initial={["p2"]} />);

    expect(boxes()[0].checked).toBe(false);
    expect(boxes()[1].checked).toBe(true);
    expect(boxes()[2].checked).toBe(false);
  });
});

describe("BilingualPickerCard - zmiana wyboru", () => {
  it("zaznaczenie DOPISUJE opcję, zachowując wybraną wcześniej", () => {
    render(<Harness options={PROGRAMS} initial={["p3"]} />);

    fireEvent.click(boxes()[0]);

    expect(selected()).toBe("p3,p1");
    expect(boxes()[0].checked).toBe(true);
  });

  it("odznaczenie zdejmuje TYLKO swoją opcję", () => {
    render(<Harness options={PROGRAMS} initial={["p1", "p2"]} />);

    fireEvent.click(boxes()[1]);

    expect(selected()).toBe("p1");
    expect(boxes()[0].checked).toBe(true);
    expect(boxes()[1].checked).toBe(false);
  });

  it("dwuklik wraca do stanu wyjściowego (bez duplikatu na liście)", () => {
    render(<Harness options={PROGRAMS} initial={[]} />);

    fireEvent.click(boxes()[2]);
    expect(selected()).toBe("p3");
    fireEvent.click(boxes()[2]);

    expect(selected()).toBe("");
  });

  it("każde kliknięcie zgłasza zmianę rodzicowi (karta nie trzyma stanu u siebie)", () => {
    const spy = vi.fn();
    render(<Harness options={PROGRAMS} initial={[]} onChangeSpy={spy} />);

    fireEvent.click(boxes()[0]);
    fireEvent.click(boxes()[1]);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("BilingualPickerCard - stan pusty", () => {
  it("pokazuje podpowiedź, gdy słownik jeszcze się nie wczytał (undefined)", () => {
    render(<Harness options={undefined} />);

    expect(screen.getByText("podpowiedz.brak")).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("pokazuje podpowiedź także dla pustego słownika", () => {
    render(<Harness options={[]} />);

    expect(screen.getByText("podpowiedz.brak")).toBeInTheDocument();
  });

  it("nie pokazuje podpowiedzi, gdy są opcje do wyboru", () => {
    render(<Harness options={PROGRAMS} />);

    expect(screen.queryByText("podpowiedz.brak")).not.toBeInTheDocument();
  });
});
