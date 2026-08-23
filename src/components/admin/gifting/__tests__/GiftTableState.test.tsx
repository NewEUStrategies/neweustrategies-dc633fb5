// Molekuła wierszy zastępczych tabel gifting - „W LOCIE" TO NIE „PUSTO".
//
// CO TEN PLIK DOWODZI.
//   1. STAN WCZYTYWANIA I STAN PUSTKI NIGDY NIE POJAWIAJĄ SIĘ RAZEM. Tabela,
//      która w trakcie odczytu mówi „brak linków spełniających kryteria",
//      kłamie o stanie tenanta - a `rows.length === 0` jest prawdą także wtedy,
//      gdy odpowiedź jeszcze nie dojechała. Ten warunek (`!isLoading &&`) jest
//      całą treścią molekuły i jego usunięcie nie ruszy ani typów, ani lintera.
//   2. COLSPAN JEST PARAMETREM. Przed ekstrakcją te wiersze stały zduplikowane
//      w dwóch tabelach o RÓŻNEJ liczbie kolumn (7 i 5); zły colSpan rozwala
//      szerokość tabeli i nic tego nie łapie.
//   3. GDY SĄ DANE, molekuła nie renderuje NICZEGO - nie dokłada pustego wiersza
//      pod listą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Napisów - molekuła dostaje je GOTOWE propsem
// (dwie tabele mają różne komunikaty pustki), więc nie ma tu ani jednego `t()`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { GiftTableState } from "@/components/admin/gifting/molecules/GiftTableState";

function stan(props: { isLoading: boolean; isEmpty: boolean; colSpan?: number }) {
  return render(
    <table>
      <tbody>
        <GiftTableState
          isLoading={props.isLoading}
          isEmpty={props.isEmpty}
          colSpan={props.colSpan ?? 7}
          loadingLabel="WCZYTUJĘ"
          emptyLabel="PUSTO"
        />
      </tbody>
    </table>,
  );
}

describe("wiersze zastępcze tabeli gifting", () => {
  it("odczyt w locie na pustej liście mówi WCZYTUJĘ, a NIE „brak wyników”", () => {
    stan({ isLoading: true, isEmpty: true });

    expect(screen.getByText("WCZYTUJĘ")).toBeTruthy();
    expect(screen.queryByText("PUSTO")).toBeNull();
  });

  it("pustka po zakończonym odczycie mówi PUSTO", () => {
    stan({ isLoading: false, isEmpty: true });

    expect(screen.getByText("PUSTO")).toBeTruthy();
    expect(screen.queryByText("WCZYTUJĘ")).toBeNull();
  });

  it("gdy są dane, molekuła nie renderuje ŻADNEGO wiersza", () => {
    const { container } = stan({ isLoading: false, isEmpty: false });

    expect(container.querySelectorAll("tr")).toHaveLength(0);
  });

  it("colSpan trafia do komórki - obie tabele mają inną liczbę kolumn", () => {
    stan({ isLoading: false, isEmpty: true, colSpan: 5 });

    expect(screen.getByText("PUSTO").getAttribute("colspan")).toBe("5");
  });
});
