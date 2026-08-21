// Combobox krajów: wyszukiwanie, diakrytyki, klawiatura, wolny tekst, flaga.
//
// CO TEN PLIK DOWODZI. `CountryCombobox.tsx` stał na 4% linii przy 85
// niepokrytych - najniżej w całym obszarze zainteresowań. Jest polem formularza
// „Dołącz do nas" i widgetu newslettera, więc każda jego wada kończy się
// porzuconym zapisem. Cztery reguły, których złamanie widzi wypełniający:
//
//   1. WYSZUKIWANIE IGNORUJE DIAKRYTYKI I WIELKOŚĆ ZNAKÓW. Kto wpisze „niemcy"
//      albo „austria", ma znaleźć „Niemcy" i „Austria"; kto wpisze „wlochy" bez
//      ogonków - „Włochy". Bez normalizacji NFD lista jest pusta, a użytkownik
//      wnioskuje, że jego kraju nie ma.
//   2. WOLNY TEKST JEST DOZWOLONY. Kraj, którego nie ma w katalogu ISO (albo
//      wpisany po swojemu), zapisuje się 1:1. Wymuszenie wyboru z listy odcina
//      terytoria zależne i nazwy potoczne.
//   3. KLAWIATURA: ↓ ↑ Enter Esc. Formularz jest wypełniany tabulatorem;
//      combobox, z którego nie da się wybrać bez myszki, blokuje wysłanie.
//   4. FLAGA POJAWIA SIĘ TYLKO DLA ROZPOZNANEGO KRAJU i NIE PRZYKRYWA tekstu
//      (wcięcie liczone razem z flagą).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - KATALOGU KRAJÓW: `lib/countries` to opakowanie na `i18n-iso-countries`
//   z własnymi testami; tutaj asertujemy przez `getNames`, żeby test nie zależał
//   od tego, jak biblioteka nazywa dane państwo w danej wersji.
// - GEOMETRII POLA: `joinUsWidgetSizes.test.tsx` dowodzi, że rozmiary
//   z buildera docierają do DOM.
// - ZAPISU DO CRM: kształt payloadu jest w `joinUsForm.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CountryCombobox } from "@/components/interests/CountryCombobox";
import { getAlpha2Code, getNames } from "@/lib/countries";
import { axeViolations, summarize } from "@/test/axe";

/** Nazwa kraju w danym języku prosto z katalogu - bez zgadywania brzmienia. */
function countryName(code: string, lang: "pl" | "en"): string {
  const name = getNames(lang)[code.toUpperCase()];
  if (!name) throw new Error(`test: katalog nie zna kraju ${code} (${lang})`);
  return name;
}

const PL_GERMANY = countryName("DE", "pl");
const EN_GERMANY = countryName("DE", "en");

/** Znaki diakrytyczne po dekompozycji NFD - to je zdejmuje normalizacja pola. */
function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Kraj, którego POLSKA nazwa realnie traci znaki po zdjęciu diakrytyków.
 *
 * Wybierany z katalogu, nie wpisany z ręki: „Włochy" NIE nadaje się do tego
 * testu, bo „ł" jest osobną literą z kreską, a nie literą ze znakiem
 * diakrytycznym - NFD go nie rozkłada i normalizacja zostawia napis bez zmian.
 * Test na takiej nazwie przechodziłby, nie dowodząc niczego.
 */
const PL_DIACRITIC_COUNTRY = (() => {
  const found = Object.values(getNames("pl")).find(
    (name) => stripDiacritics(name) !== name && !name.includes(","),
  );
  if (!found) throw new Error("test: katalog PL nie ma nazwy z rozkładalnym diakrytykiem");
  return found;
})();

/**
 * Combobox z WŁASNYM stanem wartości - komponent jest sterowany, a testujemy
 * wpisywanie, więc bez tego każde `change` byłoby natychmiast cofane.
 */
function mount(initial = "", props: Partial<React.ComponentProps<typeof CountryCombobox>> = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = React.useState(initial);
    return (
      <CountryCombobox
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        lang="pl"
        label="Kraj"
        {...props}
      />
    );
  }
  return { ...render(<Harness />), onChange };
}

const input = () => screen.getByRole("combobox") as HTMLInputElement;
const options = () => screen.queryAllByRole("option");
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

afterEach(() => cleanup());

describe("otwieranie i zamykanie listy", () => {
  it("lista jest zamknięta przed interakcją", () => {
    mount();
    expect(options()).toHaveLength(0);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("fokus otwiera listę z podpowiedziami", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("lista jedzie PRZEZ PORTAL - nie przycina jej kontener formularza", async () => {
    const { container } = mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it("kliknięcie POZA polem zamyka listę", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(options()).toHaveLength(0));
  });

  it("kliknięcie w SAMO POLE nie zamyka listy", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    fireEvent.mouseDown(input());
    expect(options().length).toBeGreaterThan(0);
  });

  it("kliknięcie WEWNĄTRZ listy nie zamyka jej przed wyborem", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(options().length).toBeGreaterThan(0);
  });

  it("lista przy krawędzi dolnej otwiera się DO GÓRY", async () => {
    // Lista wychodząca poza dolną krawędź jest nieużywalna na telefonie:
    // widać pierwszy kraj i nic więcej.
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 10, width: 300, top: 700, bottom: 740 } as DOMRect);
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 760, configurable: true });

    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    const popup = screen.getByRole("listbox");
    expect(popup.style.bottom).not.toBe("");
    expect(popup.style.top).toBe("");

    Object.defineProperty(window, "innerHeight", { value: originalHeight, configurable: true });
    rect.mockRestore();
  });

  it("przeliczenie pozycji jedzie przy przewijaniu i zmianie rozmiaru okna", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ left: 321, width: 300, top: 10, bottom: 50 } as DOMRect);
    fireEvent.scroll(window);
    await waitFor(() => expect(screen.getByRole("listbox").style.left).toBe("321px"));
    fireEvent(window, new Event("resize"));
    rect.mockRestore();
  });

  it("lista bez wyników nie renderuje pustej ramki", async () => {
    mount();
    type("zzzzzzz-nie-ma-takiego-kraju");
    await waitFor(() => expect(options()).toHaveLength(0));
    // Puste okno pod polem wygląda jak awaria - lepiej nic nie pokazać.
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("wyszukiwanie", () => {
  it("filtruje po fragmencie nazwy", async () => {
    mount();
    type(PL_GERMANY.slice(0, 4));
    await waitFor(() => expect(screen.getByRole("option", { name: PL_GERMANY })).toBeTruthy());
  });

  it("IGNORUJE WIELKOŚĆ ZNAKÓW", async () => {
    mount();
    type(PL_GERMANY.toUpperCase());
    await waitFor(() => expect(screen.getByRole("option", { name: PL_GERMANY })).toBeTruthy());
  });

  it("IGNORUJE DIAKRYTYKI - nazwa bez ogonków znajduje kraj z ogonkami", async () => {
    // To jest cała treść tego testu. Bez normalizacji NFD zapytanie „wegry"
    // daje pustą listę, a użytkownik wnioskuje, że jego kraju w serwisie nie ma.
    const stripped = stripDiacritics(PL_DIACRITIC_COUNTRY);
    expect(stripped).not.toBe(PL_DIACRITIC_COUNTRY);
    mount();
    type(stripped.toLowerCase());
    await waitFor(() =>
      expect(screen.getByRole("option", { name: PL_DIACRITIC_COUNTRY })).toBeTruthy(),
    );
  });

  it("zapytanie Z diakrytykami też znajduje kraj", async () => {
    mount();
    type(PL_DIACRITIC_COUNTRY.toLowerCase());
    await waitFor(() =>
      expect(screen.getByRole("option", { name: PL_DIACRITIC_COUNTRY })).toBeTruthy(),
    );
  });

  it("obcina spacje wokół zapytania", async () => {
    mount();
    type(`   ${PL_GERMANY}   `);
    await waitFor(() => expect(screen.getByRole("option", { name: PL_GERMANY })).toBeTruthy());
  });

  it("puste zapytanie pokazuje początek listy, nie pustkę", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(10));
  });

  it("lista jest ucięta do 200 pozycji - katalog ma ich ponad 240", async () => {
    // Renderowanie całego katalogu w portalu przy każdym naciśnięciu klawisza
    // jest odczuwalne na telefonie.
    expect(Object.keys(getNames("pl")).length).toBeGreaterThan(200);
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBe(200));
  });

  it("lista jest posortowana alfabetycznie w bieżącym języku", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(2));
    const names = options().map((o) => o.textContent ?? "");
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b, "pl")));
  });

  it("język EN zmienia katalog nazw", async () => {
    render(<CountryCombobox value="" onChange={vi.fn()} lang="en" label="Country" />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: EN_GERMANY } });
    await waitFor(() => expect(screen.getByRole("option", { name: EN_GERMANY })).toBeTruthy());
  });
});

describe("wybór", () => {
  it("kliknięcie opcji zapisuje nazwę i zamyka listę", async () => {
    const { onChange } = mount();
    type(PL_GERMANY.slice(0, 4));
    await waitFor(() => expect(screen.getByRole("option", { name: PL_GERMANY })).toBeTruthy());
    // `onMouseDown`, nie `click`: wybór musi zadziałać, zanim pole straci fokus.
    fireEvent.mouseDown(screen.getByRole("option", { name: PL_GERMANY }));
    expect(onChange).toHaveBeenLastCalledWith(PL_GERMANY);
    await waitFor(() => expect(options()).toHaveLength(0));
  });

  it("najechanie myszką przenosi podświetlenie", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    fireEvent.mouseEnter(options()[2]);
    expect(options()[2].getAttribute("aria-selected")).toBe("true");
    expect(options()[0].getAttribute("aria-selected")).toBe("false");
  });

  it("WOLNY TEKST zostaje zapisany 1:1 - kraj spoza katalogu jest dozwolony", async () => {
    // Wymuszenie wyboru z listy odcina terytoria zależne i nazwy potoczne;
    // pole zapisuje to, co wpisał człowiek.
    const { onChange } = mount();
    type("Kosowo (własna nazwa)");
    expect(onChange).toHaveBeenLastCalledWith("Kosowo (własna nazwa)");
    expect(input().value).toBe("Kosowo (własna nazwa)");
  });

  it("maksymalna długość pola jest ograniczona", () => {
    mount("", { maxLength: 30 });
    expect(input().maxLength).toBe(30);
  });
});

describe("klawiatura", () => {
  it("↓ na zamkniętej liście OTWIERA ją i podświetla PIERWSZĄ pozycję", async () => {
    // Otwarcie zeruje podświetlenie (efekt na `[value, open]`), więc pierwsze ↓
    // nie przeskakuje od razu na drugi kraj - i tak być powinno: użytkownik
    // dopiero otworzył listę i nie zdążył jej zobaczyć.
    mount();
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("↓ na OTWARTEJ liście przenosi podświetlenie o jedną pozycję w dół", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
  });

  it("↑ przenosi podświetlenie w górę i nie schodzi poniżej zera", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    fireEvent.keyDown(input(), { key: "ArrowUp" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("↓ nie wychodzi poza koniec listy", async () => {
    mount();
    type(PL_GERMANY);
    await waitFor(() => expect(options()).toHaveLength(1));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
  });

  it("`Enter` wybiera podświetloną pozycję", async () => {
    const { onChange } = mount();
    type(PL_GERMANY.slice(0, 4));
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    const highlighted = options()[0].textContent;
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(highlighted);
    await waitFor(() => expect(options()).toHaveLength(0));
  });

  it("`Enter` przy ZAMKNIĘTEJ liście nie wybiera nic - formularz może się wysłać", async () => {
    // Przechwycenie Entera przy zamkniętej liście blokowałoby wysłanie
    // formularza z klawiatury.
    const { onChange } = mount("Moja nazwa");
    onChange.mockClear();
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("`Escape` zamyka listę bez zmiany wartości", async () => {
    const { onChange } = mount();
    type(PL_GERMANY.slice(0, 4));
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    onChange.mockClear();
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(options()).toHaveLength(0));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("`Escape` przy zamkniętej liście jest bezczynne", () => {
    mount();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(options()).toHaveLength(0);
  });

  it("inny klawisz nie rusza listy", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    const before = options().length;
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(options()).toHaveLength(before);
  });

  it("podświetlona pozycja jest ogłaszana przez `aria-activedescendant`", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0].id);
  });

  it("zamknięta lista nie zostawia wskazania na nieistniejący element", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    fireEvent.keyDown(input(), { key: "Escape" });
    await waitFor(() => expect(input().getAttribute("aria-activedescendant")).toBeNull());
  });

  it("zmiana zapytania resetuje podświetlenie na pierwszą pozycję", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(1));
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    type(PL_GERMANY.slice(0, 3));
    // Bez resetu Enter wybrałby pozycję z POPRZEDNIEJ listy.
    await waitFor(() => expect(options()[0].getAttribute("aria-selected")).toBe("true"));
  });
});

describe("flaga rozpoznanego kraju", () => {
  it("pole bez wartości nie ma flagi", () => {
    const { container } = mount();
    expect(container.querySelector("img")).toBeNull();
  });

  it("rozpoznany kraj dokłada flagę i WCIĘCIE tekstu, żeby go nie przykryła", () => {
    const code = getAlpha2Code(PL_GERMANY, "pl")?.toLowerCase();
    expect(code).toBeTruthy();
    const { container } = mount(PL_GERMANY);
    const flag = container.querySelector("img");
    expect(flag?.getAttribute("src")).toContain(`/${code}.png`);
    expect(input().style.paddingLeft).not.toBe("");
  });

  it("wartość spoza katalogu NIE dokłada flagi ani wcięcia", () => {
    // Flaga przy nierozpoznanej nazwie sugerowałaby, że pole zostało zrozumiane.
    const { container } = mount("Zupełnie własna nazwa");
    expect(container.querySelector("img")).toBeNull();
    expect(input().style.paddingLeft).toBe("");
  });

  it("nazwa ANGIELSKA w polskim interfejsie też jest rozpoznawana", () => {
    // Fallback na katalog EN: ludzie wklejają „Germany" w polski formularz.
    const { container } = mount(EN_GERMANY);
    expect(container.querySelector("img")).toBeTruthy();
  });

  it("flaga jest dekoracją - nie ogłasza się jako treść", () => {
    const { container } = mount(PL_GERMANY);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("opcja bez kodu kraju dostaje pusty kadr, nie zepsuty obrazek", async () => {
    // Katalog ISO zawiera nazwy, dla których `getAlpha2Code` nie zwraca kodu
    // (nazwy złożone). Taka pozycja musi mieć placeholder o tych samych
    // wymiarach - inaczej lista skacze w pionie.
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    for (const option of options()) {
      const hasFlag = option.querySelector("img") !== null;
      const hasPlaceholder = option.querySelector("span.bg-muted") !== null;
      expect(hasFlag || hasPlaceholder).toBe(true);
    }
  });
});

describe("kontrakt pola formularza", () => {
  it("etykieta jest powiązana z polem", () => {
    mount("", { label: "Kraj zamieszkania" });
    expect(screen.getByLabelText("Kraj zamieszkania")).toBe(input());
  });

  it("wymagalność jedzie do DOM i do drzewa dostępności", () => {
    mount("", { required: true });
    expect(input().required).toBe(true);
    expect(input().getAttribute("aria-required")).toBe("true");
  });

  it("pole nieobowiązkowe nie kłamie `aria-required=false`", () => {
    mount();
    expect(input().getAttribute("aria-required")).toBeNull();
  });

  it("nazwa pola jedzie do DOM - formularz musi je umieć wysłać", () => {
    mount("", { name: "country" });
    expect(input().getAttribute("name")).toBe("country");
  });

  it("autouzupełnianie i menedżery haseł są wyłączone", () => {
    // Menedżer haseł podstawiający tu login jest realnym zgłoszeniem
    // użytkowników - stąd komplet atrybutów wyłączających.
    mount();
    expect(input().getAttribute("autocomplete")).toBe("off");
    expect(input().getAttribute("data-lpignore")).toBe("true");
    expect(input().getAttribute("data-1p-ignore")).toBe("true");
  });

  it("lista jest powiązana z polem przez `aria-controls`", async () => {
    mount();
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(input().getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
  });

  it("nie ma naruszeń dostępności z otwartą listą", async () => {
    mount(PL_GERMANY);
    fireEvent.focus(input());
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(await axeViolations(document.body).then(summarize)).toBe("");
  });
});
