// Karta słownika katalogu - warunek „karta bez wierszy znika”, cztery wejścia.
//
// CO TEN PLIK DOWODZI. Molekuła ma JEDEN warunek i cztery rozłączne wejścia:
// lista elementów, lista samych `null`, JEDNO dziecko (nie lista) i lista
// mieszana. Każde z nich prowadzi do innej gałęzi, a ta molekuła jest jedynym
// miejscem katalogu, gdzie o widoczności ramki decyduje nie reguła filtra,
// a to, co dzieci wyrenderowały.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE - i to jest tu najważniejsze zdanie. Test NIE
// twierdzi, że karta znika w KATALOGU. Nie znika: organizm podaje jej ELEMENTY
// `<ClubInboxCatalogVocabRow />`, a element jest obiektem także wtedy, gdy jego
// render zwróci `null`, więc warunek nigdy się tam nie domyka. Dowód na to stoi
// jako `it.fails` w `ClubElementsCatalog.test.tsx` i jest zgłoszony jako defekt.
// Tutaj sprawdzamy, że sam warunek robi to, co obiecuje, DLA WEJŚĆ, jakie
// naprawdę dostaje - żeby przyszła poprawka miała od czego odbić.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ClubInboxCatalogVocabCard } from "@/components/admin/clubs/molecules/ClubInboxCatalogVocabCard";

/** Ramka karty z `components/ui/card` - rozpoznajemy ją po klasie. */
function ramki(container: HTMLElement): number {
  return container.querySelectorAll(".rounded-xl").length;
}

describe("karta słownika", () => {
  it("lista wierszy renderuje ramkę z ich treścią", () => {
    const { container } = render(
      <ClubInboxCatalogVocabCard>
        {[<span key="a">widoczność</span>, <span key="b">polityka wejścia</span>]}
      </ClubInboxCatalogVocabCard>,
    );
    expect(ramki(container)).toBe(1);
    expect(container.textContent).toContain("widoczność");
  });

  it("lista samych pustek NIE renderuje ramki - pusta karta obiecuje zbiór", () => {
    const { container } = render(
      <ClubInboxCatalogVocabCard>{[null, null]}</ClubInboxCatalogVocabCard>,
    );
    expect(container.firstChild).toBeNull();
    expect(ramki(container)).toBe(0);
  });

  it("JEDNO dziecko (nie lista) renderuje ramkę", () => {
    const { container } = render(
      <ClubInboxCatalogVocabCard>
        <span>jedna oś</span>
      </ClubInboxCatalogVocabCard>,
    );
    expect(ramki(container)).toBe(1);
    expect(container.textContent).toBe("jedna oś");
  });

  it("lista mieszana zostawia ramkę - jeden widoczny wiersz wystarczy", () => {
    const { container } = render(
      <ClubInboxCatalogVocabCard>
        {[null, <span key="a">jedyna widoczna oś</span>]}
      </ClubInboxCatalogVocabCard>,
    );
    expect(ramki(container)).toBe(1);
    expect(container.textContent).toBe("jedyna widoczna oś");
  });
});
