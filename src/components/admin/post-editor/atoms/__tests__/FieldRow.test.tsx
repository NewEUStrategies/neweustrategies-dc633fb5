// CO DOWODZI TEN PLIK: `FieldRow` jest wspólnym wierszem pola w gęstych kartach
// edytora (oznaczenie komercyjne, dostęp, organizacja). Trzy rzeczy w nim są
// widoczne dla użytkownika i tylko one są tu testowane:
//   1. WIĄZANIE ETYKIETY Z KONTROLKĄ przez `htmlFor`. Kontrolka jest rodzeństwem
//      etykiety, nie jej dzieckiem, więc bez `htmlFor` pole zostaje BEZ NAZWY -
//      czytnik ekranu mówi „pole edycji", a klik w etykietę nie ustawia w nim
//      kursora. To najczęstszy błąd tej klasy wierszy (identyczny defekt
//      naprawiano już w dialogu tworzenia firmy, patrz komentarze w
//      vitest.config.ts).
//   2. ZNACZNIK BRAKU (gwiazdka) pojawia się WYŁĄCZNIE przy `missing` - wersja
//      robocza ma prawo być niekompletna, więc atom podświetla etykietę, ale nie
//      blokuje pisania. Gwiazdka bez powodu straszy redaktora, brak gwiazdki
//      przy braku - pozwala opublikować wpis bez wymaganego pola.
//   3. PODPOWIEDŹ „?" jest opcjonalna i dostaje dostępną nazwę równą treści
//      podpowiedzi (inaczej dla czytnika ekranu jest to nienazwany przycisk).
//
// Etykiety w teście są zwykłym tekstem, bo atom przyjmuje GOTOWY tekst z `t()`
// (a nie klucz) - to jego udokumentowany kontrakt.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { FieldRow } from "../FieldRow";

afterEach(cleanup);

describe("FieldRow - wiązanie etykiety z kontrolką", () => {
  it("z `htmlFor` pole jest nazwane etykietą (czytnik ekranu i klik w etykietę)", () => {
    render(
      <FieldRow label="Nazwa reklamodawcy" htmlFor="adv-name">
        <input id="adv-name" defaultValue="ACME" />
      </FieldRow>,
    );
    const field = screen.getByLabelText("Nazwa reklamodawcy");
    expect(field).toHaveValue("ACME");
    expect(field.tagName.toLowerCase()).toBe("input");
  });

  it("etykieta wskazuje na kontrolkę atrybutem `for`, nie zagnieżdżeniem", () => {
    render(
      <FieldRow label="Nazwa reklamodawcy" htmlFor="adv-name">
        <input id="adv-name" />
      </FieldRow>,
    );
    const label = screen.getByText("Nazwa reklamodawcy").closest("label");
    const input = screen.getByRole("textbox");
    expect(label).toHaveAttribute("for", "adv-name");
    // Kontrolka jest RODZEŃSTWEM etykiety - dlatego `htmlFor` jest jedynym
    // mechanizmem nazwy i jego brak nie da się „naprawić" przez zagnieżdżenie.
    expect(label?.contains(input)).toBe(false);
  });

  // SWIADEK DEFEKTU (D2): `htmlFor` jest opcjonalny, więc wywołanie bez niego
  // renderuje pole BEZ dostępnej nazwy - i nic tego nie zgłasza. W repo jest już
  // taki przypadek (`PostSponsoredCard`, wiersz „Nota EN"). Test opisuje stan
  // OBECNY: gdy atom zacznie generować własne `id`, ten test celowo pęknie.
  it("bez `htmlFor` pole zostaje BEZ nazwy, choć etykieta jest widoczna", () => {
    render(
      <FieldRow label="Nota EN">
        <textarea />
      </FieldRow>,
    );
    expect(screen.getByText("Nota EN")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nota EN")).toBeNull();
  });
});

describe("FieldRow - znacznik braku wymaganego pola", () => {
  it("`missing` dokłada gwiazdkę przy etykiecie", () => {
    render(
      <FieldRow label="Tytuł PL" missing htmlFor="title-pl">
        <input id="title-pl" />
      </FieldRow>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("domyślnie (pole wypełnione) gwiazdki NIE MA - nie straszymy bez powodu", () => {
    render(
      <FieldRow label="Tytuł PL" htmlFor="title-pl">
        <input id="title-pl" />
      </FieldRow>,
    );
    expect(screen.queryByText("*")).toBeNull();
  });

  it("gwiazdka jest ozdobą dla wzroku: ukryta dla technologii asystujących", () => {
    // Znacznik braku niesie informację redakcyjną, nie treść pola: gdyby wchodził
    // do nazwy dostępnej, czytnik ekranu czytałby „Tytuł PL gwiazdka", a nazwa
    // pola zmieniałaby się w zależności od tego, czy pole jest właśnie puste.
    // `aria-hidden` wypisuje go z wyliczania nazwy (accname wyklucza takie
    // poddrzewa; uproszczone `getByLabelText` z testing-library nadal czyta
    // textContent, dlatego pole szukamy wyrażeniem regularnym).
    render(
      <FieldRow label="Tytuł PL" missing htmlFor="title-pl">
        <input id="title-pl" />
      </FieldRow>,
    );
    expect(screen.getByLabelText(/Tytuł PL/)).toHaveAttribute("id", "title-pl");
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("FieldRow - podpowiedź", () => {
  it("`hint` dokłada przycisk pomocy o dostępnej nazwie równej treści podpowiedzi", () => {
    render(
      <FieldRow label="Kanoniczny URL" hint="Wskaż oryginał, jeśli wpis jest przedrukiem.">
        <input />
      </FieldRow>,
    );
    expect(
      screen.getByRole("button", { name: "Wskaż oryginał, jeśli wpis jest przedrukiem." }),
    ).toBeInTheDocument();
  });

  it("bez `hint` nie ma żadnego przycisku - wiersz zostaje czysty", () => {
    render(
      <FieldRow label="Kanoniczny URL">
        <input />
      </FieldRow>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("brak wymaganego pola i podpowiedź współistnieją w jednej etykiecie", () => {
    render(
      <FieldRow label="Okładka" missing hint="Zalecane 1200x630 px." htmlFor="cover">
        <input id="cover" />
      </FieldRow>,
    );
    const label = screen.getByText("Okładka").closest("label");
    expect(label).not.toBeNull();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(label?.contains(screen.getByRole("button", { name: "Zalecane 1200x630 px." }))).toBe(
      true,
    );
  });

  it("dzieci są przekazywane bez zmian - wiersz nie owija kontrolki w nic aktywnego", () => {
    render(
      <FieldRow label="Waluta" htmlFor="currency">
        <select id="currency" defaultValue="EUR">
          <option value="PLN">PLN</option>
          <option value="EUR">EUR</option>
        </select>
      </FieldRow>,
    );
    expect(screen.getByLabelText("Waluta")).toHaveValue("EUR");
  });
});
