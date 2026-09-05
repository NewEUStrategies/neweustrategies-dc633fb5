// Nadpisanie sekcji "Powiązane wpisy" na poziomie POJEDYNCZEGO wpisu -
// `RelatedOverrideEditor`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO. Ten edytor zapisuje CZĘŚCIOWY obiekt do
// `posts.related_override` (jsonb). Cała jego wartość leży w tym, czego w tym
// obiekcie NIE MA: brakujący klucz znaczy "weź globalne", a klucz obecny
// przykrywa ustawienie globalne dla tego jednego wpisu. Dlatego dowodzę
// czterech rzeczy, których żaden test wizualny nie złapie:
//   1. WARTOŚĆ "globalna" USUWA KLUCZ, a nie zapisuje napisu `"_"`. Zapisany
//      `"_"` przeszedłby przez jsonb do renderera publicznego i sekcja
//      dostałaby układ o nazwie `_` (czyli żaden).
//   2. USUNIĘCIE OSTATNIEGO KLUCZA ZWRACA `null`, a nie `{}`. Pusty obiekt
//      w kolumnie znaczy "wpis MA nadpisanie" - przy następnym otwarciu
//      przełącznik wstałby włączony, mimo że nic nie nadpisuje.
//   3. PRZEŁĄCZNIK WYŁĄCZONY CZYŚCI CAŁE NADPISANIE (`onChange(null)`) i
//      chowa formularz; włączenie go z powrotem NIE przywraca starych
//      wartości (komponent nie trzyma kopii - to jest zachowanie, nie usterka,
//      więc jest przypięte).
//   4. STAN POCZĄTKOWY PRZEŁĄCZNIKA IDZIE ZA `value !== null`: `{}` (obiekt
//      pusty) to nadal "nadpisanie włączone", `null` to "wyłączone".
//   Oraz: nadpisania są NIEZALEŻNE - ustawienie układu nie kasuje wcześniej
//   ustawionej pozycji (`setKey` kopiuje obiekt, nie podmienia go).
//
// LICZBY: pola liczbowe przepuszczają tylko dodatnie liczby skończone; `0`,
// wartość ujemna i wpis nieliczbowy kasują klucz - inaczej sekcja
// wyświetlałaby zero wpisów albo `NaN` trafiłby do zapytania.
//
// Radix Select i Switch nie działają pod happy-dom bez pełnego pointer API -
// oba są podmienione na natywne odpowiedniki z `@/test/reactStubs`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { radixSelectStub, radixSwitchStub } from "@/test/reactStubs";

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/components/ui/select", async () => radixSelectStub(await import("react")));
vi.mock("@/components/ui/switch", async () => radixSwitchStub(await import("react")));

const { RelatedOverrideEditor } = await import("@/components/admin/RelatedOverrideEditor");

/** Kolejność pól w siatce - atrapa Selecta nie ma etykiet dostępnych. */
const POLA = {
  pokazSekcje: 0,
  pozycja: 1,
  uklad: 2,
  strategia: 3,
} as const;

function renderuj(value: Record<string, unknown> | null) {
  const onChange = vi.fn<(next: Record<string, unknown> | null) => void>();
  const utils = render(<RelatedOverrideEditor value={value} onChange={onChange} />);
  return { ...utils, onChange };
}

function listy(): HTMLSelectElement[] {
  return screen.getAllByRole("combobox") as HTMLSelectElement[];
}

function liczby(): HTMLInputElement[] {
  return screen.getAllByRole("spinbutton") as HTMLInputElement[];
}

describe("RelatedOverrideEditor - przełącznik nadpisania", () => {
  it("dla `null` startuje wyłączony i nie pokazuje żadnego pola", () => {
    renderuj(null);

    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("dla PUSTEGO obiektu startuje włączony - `{}` to nadal nadpisanie", () => {
    renderuj({});

    expect(screen.getByRole("switch")).toBeChecked();
    expect(listy()).toHaveLength(4);
    expect(liczby()).toHaveLength(2);
  });

  it("włączenie przełącznika odsłania formularz i NIE dotyka jeszcze wartości", () => {
    const { onChange } = renderuj(null);

    fireEvent.click(screen.getByRole("switch"));

    expect(listy()).toHaveLength(4);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("wyłączenie przełącznika czyści całe nadpisanie do `null` i chowa pola", () => {
    const { onChange } = renderuj({ layout: "cards", items_limit: 4 });

    fireEvent.click(screen.getByRole("switch"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });
});

describe("RelatedOverrideEditor - wartość 'globalna' USUWA klucz", () => {
  it("wybór 'globalne' w liście układu kasuje klucz `layout`", () => {
    const { onChange } = renderuj({ layout: "cards", position: "sidebar" });

    fireEvent.change(listy()[POLA.uklad], { target: { value: "_" } });

    // Klucz znika, reszta nadpisania zostaje nietknięta.
    expect(onChange).toHaveBeenCalledWith({ position: "sidebar" });
  });

  it("wybór 'globalne' w OSTATNIM ustawionym polu zwraca `null`, nie `{}`", () => {
    const { onChange } = renderuj({ layout: "cards" });

    fireEvent.change(listy()[POLA.uklad], { target: { value: "_" } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("lista 'pokaż sekcję' zapisuje BOOLEAN, a nie napis 'yes'/'no'", () => {
    const { onChange } = renderuj({});

    fireEvent.change(listy()[POLA.pokazSekcje], { target: { value: "yes" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true });

    fireEvent.change(listy()[POLA.pokazSekcje], { target: { value: "no" } });
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false });

    fireEvent.change(listy()[POLA.pokazSekcje], { target: { value: "_" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it.each([
    ["enabled: true", true, "yes"],
    ["enabled: false", false, "no"],
    ["brak klucza", undefined, "_"],
  ])("%s odczytuje się jako '%s'", (_opis, zapisane, widoczne) => {
    renderuj(zapisane === undefined ? {} : { enabled: zapisane });

    expect(listy()[POLA.pokazSekcje]).toHaveValue(widoczne);
  });

  it("wybór 'globalne' kasuje klucz w KAŻDEJ z pozostałych list", () => {
    const { onChange } = renderuj({
      position: "sidebar",
      source_strategy: "tags",
      layout: "grid",
    });

    fireEvent.change(listy()[POLA.pozycja], { target: { value: "_" } });
    expect(onChange).toHaveBeenLastCalledWith({ source_strategy: "tags", layout: "grid" });

    fireEvent.change(listy()[POLA.strategia], { target: { value: "_" } });
    expect(onChange).toHaveBeenLastCalledWith({ position: "sidebar", layout: "grid" });
  });
});

describe("RelatedOverrideEditor - każde pole trafia we WŁASNY klucz", () => {
  it("pozycja sekcji", () => {
    const { onChange } = renderuj({});

    fireEvent.change(listy()[POLA.pozycja], { target: { value: "after_paragraph" } });

    expect(onChange).toHaveBeenCalledWith({ position: "after_paragraph" });
  });

  it("układ", () => {
    const { onChange } = renderuj({});

    fireEvent.change(listy()[POLA.uklad], { target: { value: "timeline" } });

    expect(onChange).toHaveBeenCalledWith({ layout: "timeline" });
  });

  it("strategia doboru wpisów", () => {
    const { onChange } = renderuj({});

    fireEvent.change(listy()[POLA.strategia], { target: { value: "tags" } });

    expect(onChange).toHaveBeenCalledWith({ source_strategy: "tags" });
  });

  it("nadpisania są niezależne - nowy klucz nie kasuje wcześniejszych", () => {
    const { onChange } = renderuj({ position: "sidebar", items_limit: 3 });

    fireEvent.change(listy()[POLA.strategia], { target: { value: "author" } });

    expect(onChange).toHaveBeenCalledWith({
      position: "sidebar",
      items_limit: 3,
      source_strategy: "author",
    });
  });

  it("listy pokazują wartości z propa, a brak klucza pokazuje 'globalne'", () => {
    renderuj({ layout: "slider" });

    expect(listy()[POLA.uklad]).toHaveValue("slider");
    expect(listy()[POLA.pozycja]).toHaveValue("_");
    expect(listy()[POLA.strategia]).toHaveValue("_");
  });
});

describe("RelatedOverrideEditor - pola liczbowe przepuszczają tylko dodatnie liczby", () => {
  it("liczba wpisów zapisuje się jako number", () => {
    const { onChange } = renderuj({});

    fireEvent.change(liczby()[0], { target: { value: "6" } });

    expect(onChange).toHaveBeenCalledWith({ items_limit: 6 });
  });

  it("numer akapitu zapisuje się jako number", () => {
    const { onChange } = renderuj({});

    fireEvent.change(liczby()[1], { target: { value: "2" } });

    expect(onChange).toHaveBeenCalledWith({ after_paragraph: 2 });
  });

  it.each([
    ["zero", "0"],
    ["wartość ujemna", "-3"],
    ["puste pole", ""],
  ])("%s kasuje klucz `items_limit` zamiast go zapisać", (_opis, wpisane) => {
    const { onChange } = renderuj({ items_limit: 5 });

    fireEvent.change(liczby()[0], { target: { value: wpisane } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it.each([
    ["zero", "0"],
    ["puste pole", ""],
  ])("%s kasuje też klucz `after_paragraph`", (_opis, wpisane) => {
    const { onChange } = renderuj({ after_paragraph: 3 });

    fireEvent.change(liczby()[1], { target: { value: wpisane } });

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("pole liczbowe pokazuje wartość z nadpisania, a puste przy jej braku", () => {
    renderuj({ items_limit: 8 });

    expect(liczby()[0]).toHaveValue(8);
    expect(liczby()[1]).toHaveValue(null);
  });
});
