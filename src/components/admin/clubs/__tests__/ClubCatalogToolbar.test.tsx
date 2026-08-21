// Molekuła nagłówka katalogu taksonomii - CO WIDAĆ NAD LISTĄ.
//
// CO TEN PLIK DOWODZI.
//   1. NAGŁÓWEK MA TRZY WARSTWY INFORMACJI: czym jest katalog (tytuł), po co
//      jest (zdanie wprowadzające) i w jakim jest stanie (licznik włączonych).
//      Licznik należy do nagłówka, nie do listy - zostaje na ekranie także wtedy,
//      gdy lista jest pusta.
//   2. TYTUŁ JEST NAGŁÓWKIEM DOKUMENTU, nie pogrubionym akapitem: przy czytniku
//      ekranu to jedyny sposób przeskoczenia do sekcji katalogu.
//   3. PRZYCISK DODANIA WOŁA WOŁAJĄCEGO - molekuła nie wie, co się otworzy,
//      więc dowodem jest realne wywołanie domknięcia po kliknięciu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Słownika - molekuła dostaje GOTOWE napisy
// (klucze obu katalogów mieszkają w różnych plikach i18n), więc nie ma tu ani
// jednego `t()`. (2) Liczenia włączonych wpisów - `catalogActiveCount` ma test
// w `lib/clubs/__tests__/adminTaxonomyCatalog.test.ts`. (3) Trzech stanów listy -
// to `ClubCatalogListState.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ClubCatalogToolbar } from "@/components/admin/clubs/molecules/ClubCatalogToolbar";

function nagłówek(onAdd = vi.fn()) {
  const widok = render(
    <ClubCatalogToolbar
      title="Obszary tematyczne"
      subtitle="Wspólna taksonomia dla klubów i wątków."
      addLabel="Dodaj obszar"
      onAdd={onAdd}
      summary="Aktywne: 4 z 9."
    />,
  );
  return { ...widok, onAdd };
}

describe("nagłówek katalogu", () => {
  it("pokazuje tytuł jako NAGŁÓWEK, zdanie wprowadzające i licznik", () => {
    nagłówek();

    expect(screen.getByRole("heading", { name: "Obszary tematyczne" })).toBeTruthy();
    expect(screen.getByText("Wspólna taksonomia dla klubów i wątków.")).toBeTruthy();
    expect(screen.getByText("Aktywne: 4 z 9.")).toBeTruthy();
  });

  it("przycisk dodania woła domknięcie wołającego DOKŁADNIE raz", () => {
    const { onAdd } = nagłówek();

    fireEvent.click(screen.getByRole("button", { name: "Dodaj obszar" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("nie woła nic, dopóki nikt nie kliknie", () => {
    const { onAdd } = nagłówek();

    expect(onAdd).not.toHaveBeenCalled();
  });
});
