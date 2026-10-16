// TRASA `/admin/appearance/font-sizes` - TABELA ROZMIARÓW CZCIONEK. Do wydania
// 13 raportu pokrycia: 26 linii na zerze - a to JEDYNE miejsce, w którym tenant
// zmienia zmienne `--fs-*`, czyli rozmiar etykiet, pól, list rozwijanych,
// przycisków i pola czatu w całym serwisie i panelu.
//
// SIEDEM REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. POLE POKAZUJE TO, CO WPISANO. Wartość kontrolowana rozmiarem PRZYCIĘTYM
//      do zakresu robiła z „1” natychmiast „9” (dolna granica), dopisane „6”
//      dawało „96”, a zapis - 18 zamiast 16. Skasowanie pola od razu wstawiało
//      rozmiar domyślny, więc nie dało się wpisać nowej liczby od zera.
//   2. PRZYCIĘCIE PRZY WYJŚCIU Z POLA I PRZY ZAPISIE. W trakcie pisania szkic
//      trzyma liczbę bez przycinania (podgląd pokazuje już przyciętą); po
//      opuszczeniu pola i po kliknięciu „Zapisz” ekran pokazuje DOKŁADNIE to,
//      co poszło do bazy.
//   3. PUSTE POLE = ROZMIAR DOMYŚLNY. Usunięcie nadpisania to jedyny sposób na
//      powrót pojedynczego wiersza do wartości z arkusza.
//   4. WARTOŚĆ SPOZA ZAKRESU JEST OZNACZONA (`aria-invalid` + zakres jako opis
//      pola; granice 9 i 18 są dozwolone, puste pole też). Tekst, którego
//      przeglądarka nie umie odczytać jako liczby (`validity.badInput` - wtedy
//      `value` jest PUSTE), nie kasuje nadpisania. Przejście między takim
//      tekstem a pustym polem nie zmienia `value`, więc `onChange` Reacta go nie
//      zgłasza - ekran słucha też surowego `input`.
//   5. „PRZYWRÓĆ DOMYŚLNE” CZYŚCI TEŻ SUROWE WPISY - inaczej pole w edycji
//      pokazywałoby stary tekst nad wyzerowanym szkicem.
//   6. NAGŁÓWEK JEST SEKCYJNY. Bez `head()` trasa dziedziczyła ogólne „Admin”
//      (AGENTS.md: `adminPageHead` na prywatnych ekranach).
//   7. SZKIC TYLKO ZE ŚWIEŻEGO, UDANEGO ODCZYTU. Odczyt prezentacyjny zamienia
//      awarię bazy w pustą tabelę, a wpis w cache bywa sprzed minut - zapis
//      `font_scale` w całości skasowałby wtedy nadpisania najemcy. Edytor
//      czyta własnym zapytaniem (`useAdminFontScale`), czeka na odczyt po
//      wejściu na ekran, a błąd pokazuje jako błąd z ponowieniem.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: normalizacji i zapisu `site_design_tokens` -
// to kontrakt haka (`src/hooks/__tests__/useFontScale.test.tsx`) i biblioteki
// (`src/lib/theme/__tests__`); tutaj atrapą jest sam hak.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import type { AnyRoute } from "@tanstack/react-router";

const h = vi.hoisted(() => ({
  /** Dane zapytania; `undefined` = jeszcze się wczytują. */
  data: {} as Record<string, number> | undefined,
  /** Czy dane pochodzą z odczytu zakończonego PO wejściu na ekran. */
  fetchedAfterMount: true,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  isPending: false,
  saved: [] as unknown[],
}));

vi.mock("@/hooks/useFontScale", () => ({
  // Kształt `UseQueryResult` w zakresie, który czyta trasa.
  useAdminFontScale: () => ({
    data: h.data,
    isSuccess: h.data !== undefined && !h.isError,
    isFetchedAfterMount: h.fetchedAfterMount,
    isError: h.isError,
    isFetching: h.isFetching,
    refetch: h.refetch,
  }),
  useSaveFontScale: () => ({
    mutate: (value: unknown) => h.saved.push(value),
    isPending: h.isPending,
  }),
}));

import "@/test/i18nReal";
import { Route } from "@/routes/admin.appearance.font-sizes";
import { FONT_SCALE_TOKENS } from "@/lib/theme/fontScale";
import { renderRoute, routeMeta } from "@/test/routeHarness";

const Component = () => {
  const Page = (Route as AnyRoute).options.component as () => ReactNode;
  return <Page />;
};

const setup = () => render(<Component />);

/** Polskie etykiety wierszy - to je widzi redaktor i czytnik ekranu. */
const LABEL = {
  label: "Etykiety pól",
  input: "Pola tekstowe",
  placeholder: "Podpowiedzi w polach",
  droplist: "Listy rozwijane",
  button: "Przyciski",
  chatComposer: "Pole wiadomości czatu",
} as const;

const sizeInput = (label: string) =>
  screen.getByRole("spinbutton", { name: label }) as HTMLInputElement;

const rowOf = (label: string): HTMLElement => {
  const row = sizeInput(label).closest("tr");
  if (!row) throw new Error(`brak wiersza ${label}`);
  return row;
};

/** Komórka kolumny „Domyślnie” (czwarta) w wierszu tokenu. */
const defaultCell = (label: string) => within(rowOf(label)).getAllByRole("cell")[3];

const previewOf = (label: string) => within(rowOf(label)).getByText("Przykładowy tekst");

/**
 * Pisanie jak w przeglądarce: każdy znak DOKLEJA się do tego, co pole w tej
 * chwili pokazuje. Tylko tak widać, czy kontrolowana wartość podmienia tekst
 * pod palcami redaktora.
 */
function typeChars(input: HTMLInputElement, text: string) {
  for (const ch of text) fireEvent.change(input, { target: { value: input.value + ch } });
}

/**
 * `happy-dom` zawsze zgłasza `validity.badInput = false`. Przeglądarka przy
 * tekście, którego nie umie odczytać jako liczby (np. niepełne „1e”), zgłasza
 * `true` i PUSTE `value` - tę parę podstawiamy na elemencie; zdjęcie własnej
 * właściwości przywraca natywny getter.
 */
function setBadInput(input: HTMLInputElement, bad: boolean) {
  if (!bad) {
    Reflect.deleteProperty(input, "validity");
    return;
  }
  Object.defineProperty(input, "validity", {
    configurable: true,
    value: { badInput: true, valid: false },
  });
}

const saveButton = () => screen.getByRole("button", { name: /Zapisz zmiany|Zapisywanie/ });
const resetButton = () => screen.getByRole("button", { name: "Przywróć domyślne" });

beforeEach(() => {
  h.data = {};
  h.fetchedAfterMount = true;
  h.isError = false;
  h.isFetching = false;
  h.refetch.mockReset();
  h.isPending = false;
  h.saved.length = 0;
});

describe("rozmiary czcionek - nagłówek i wczytywanie", () => {
  it("nagłówek dokumentu ma SEKCYJNY tytuł, opis i noindex", async () => {
    // REGUŁA 6. Czytamy `head()` wprost i przez router - to drugie trafia do
    // `<HeadContent/>`.
    const expected = expect.arrayContaining([
      { title: "Font sizes | New European Strategies" },
      { name: "robots", content: "noindex, nofollow" },
      expect.objectContaining({ name: "description", content: expect.stringMatching(/font/i) }),
    ]);
    expect(await routeMeta(Route as AnyRoute)).toEqual(expected);

    const view = await renderRoute({
      route: Route as AnyRoute,
      path: "/admin/appearance/font-sizes",
      initialEntry: "/admin/appearance/font-sizes",
    });
    expect(view.meta()).toEqual(expected);
    expect(await screen.findByRole("spinbutton", { name: LABEL.label })).toBeInTheDocument();
  });

  it("do czasu wczytania nie pokazuje pól", () => {
    // Formularz na pustych danych zapisałby rozmiary domyślne po pierwszym
    // kliknięciu, kasując nadpisania tenanta.
    h.data = undefined;
    setup();

    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wpis w cache sprzed wejścia na ekran NIE startuje edytora", () => {
    // REGUŁA 7. „Zapisz” wysyła `font_scale` w całości: szkic zbudowany na
    // wpisie sprzed minut cofnąłby zmiany innego redaktora. Edytor czeka na
    // odczyt zakończony po wejściu - `renderToString` pokazuje pierwszy render.
    h.data = { label: 14 };
    h.fetchedAfterMount = false;
    const html = renderToString(<Component />);

    expect(html).toContain("Ładowanie…");
    expect(html).not.toContain('value="14"');
  });

  it("świeży odczyt po wejściu startuje edytor z danymi bazy", () => {
    h.data = { label: 14 };
    h.fetchedAfterMount = false;
    const view = setup();
    expect(screen.queryByRole("spinbutton")).toBeNull();

    h.fetchedAfterMount = true;
    view.rerender(<Component />);

    expect(sizeInput(LABEL.label).value).toBe("14");
  });

  it("błąd odczytu NIE udaje pustej tabeli: alert, bez pól, z ponowieniem", () => {
    // REGUŁA 7. Odczyt prezentacyjny zamienia awarię w pustą tabelę; tutaj
    // pola z samymi rozmiarami domyślnymi wyglądałyby jak stan najemcy,
    // a zapis jednego wiersza skasowałby pozostałe nadpisania.
    h.data = undefined;
    h.isError = true;
    setup();

    expect(screen.getByRole("alert")).toHaveTextContent("Nie udało się wczytać rozmiarów czcionek");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: /Zapisz/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("ponowienie w toku pokazuje wczytywanie, nie stary błąd", () => {
    h.data = undefined;
    h.isError = true;
    h.isFetching = true;
    setup();

    expect(screen.getByText("Ładowanie…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("nieudany refetch PO starcie edytora nie odmontowuje tabeli ani szkicu", () => {
    // Zatrzask: edytor bierze dane raz. Błąd odświeżenia w tle nie może
    // zabrać redaktorowi niezapisanej edycji.
    h.data = { label: 14 };
    const view = setup();
    fireEvent.change(sizeInput(LABEL.label), { target: { value: "16" } });

    h.isError = true;
    view.rerender(<Component />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(sizeInput(LABEL.label).value).toBe("16");
  });

  it("odświeżenie danych w tle nie nadpisuje szkicu redaktora", () => {
    // Szkic startuje z danych RAZ; późniejszy refetch (np. po powrocie do
    // karty) nie może cofnąć niezapisanej edycji.
    h.data = { label: 14 };
    const view = setup();
    fireEvent.change(sizeInput(LABEL.label), { target: { value: "16" } });
    fireEvent.blur(sizeInput(LABEL.label));

    h.data = { label: 10 };
    view.rerender(<Component />);

    expect(sizeInput(LABEL.label).value).toBe("16");
  });
});

describe("rozmiary czcionek - tabela tokenów", () => {
  it("każdy token ma wiersz z etykietą, zasięgiem, zmienną CSS i zakresem", () => {
    setup();

    expect(screen.getAllByRole("row")).toHaveLength(FONT_SCALE_TOKENS.length + 1);
    for (const token of FONT_SCALE_TOKENS) {
      const label = LABEL[token.key as keyof typeof LABEL];
      const row = rowOf(label);
      expect(within(row).getByText(token.cssVar)).toBeInTheDocument();
      // Zakres jest OPISEM pola - czytnik ekranu mówi go razem z błędem.
      expect(sizeInput(label)).toHaveAccessibleDescription(
        `Zakres ${token.minPx}–${token.maxPx} px`,
      );
    }
    expect(within(rowOf(LABEL.chatComposer)).getByText("Wpisywanie wiadomości w czacie.")).toBe(
      within(rowOf(LABEL.chatComposer)).getAllByRole("cell")[1],
    );
    for (const header of ["Element", "Gdzie działa", "Zmienna CSS", "Domyślnie", "Rozmiar (px)"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
  });

  it("kolumna „Domyślnie” podaje rozmiar z arkusza tylko przy nadpisanym wierszu", () => {
    h.data = { label: 14, chatComposer: 13 };
    setup();

    expect(defaultCell(LABEL.label)).toHaveTextContent("12 px");
    expect(defaultCell(LABEL.chatComposer)).toHaveTextContent("11.5 px");
    expect(defaultCell(LABEL.button)).toHaveTextContent("Domyślny");
  });

  it("pole i podgląd pokazują nadpisanie albo rozmiar domyślny", () => {
    h.data = { button: 15 };
    setup();

    expect(sizeInput(LABEL.button).value).toBe("15");
    expect(previewOf(LABEL.button)).toHaveStyle({ fontSize: "15px" });
    expect(sizeInput(LABEL.chatComposer).value).toBe("11.5");
    expect(previewOf(LABEL.chatComposer)).toHaveStyle({ fontSize: "11.5px" });
  });
});

describe("rozmiary czcionek - wpisywanie", () => {
  it("zaznaczone „12” nadpisane przez „1”, potem „6” daje 16, nie 18", () => {
    // REGUŁA 1. Dokładnie sekwencja redaktora: zaznacza starą wartość, pisze
    // pierwszą cyfrę (zastępuje zaznaczenie), dopisuje drugą.
    setup();
    const input = sizeInput(LABEL.label);

    fireEvent.change(input, { target: { value: "1" } });
    expect(input.value).toBe("1");
    typeChars(input, "6");
    expect(input.value).toBe("16");
    fireEvent.blur(input);
    fireEvent.click(saveButton());

    expect(h.saved).toEqual([{ label: 16 }]);
  });

  it("skasowane pole zostaje PUSTE i przyjmuje nową liczbę od zera", () => {
    h.data = { label: 14 };
    setup();
    const input = sizeInput(LABEL.label);

    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    // REGUŁA 3: puste = brak nadpisania, kolumna to od razu mówi - i nie jest
    // to błąd, tylko zamierzony gest powrotu do rozmiaru domyślnego.
    expect(defaultCell(LABEL.label)).toHaveTextContent("Domyślny");
    expect(input).toHaveAttribute("aria-invalid", "false");
    typeChars(input, "15");

    expect(input.value).toBe("15");
    expect(previewOf(LABEL.label)).toHaveStyle({ fontSize: "15px" });
  });

  it("puste pole po wyjściu wraca do rozmiaru domyślnego i znika z zapisu", () => {
    h.data = { label: 14, button: 16 };
    setup();
    const input = sizeInput(LABEL.label);

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    expect(input.value).toBe("12");
    expect(previewOf(LABEL.label)).toHaveStyle({ fontSize: "12px" });
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{ button: 16 }]);
  });

  it("surowy tekst z przecinkiem albo samymi spacjami czyta się jak liczba albo puste pole", () => {
    // OSŁONA ODCZYTU, NIE DOWÓD REGUŁY 1. Przeglądarka sanityzuje `value` pola
    // `number` do poprawnej liczby albo pustego tekstu, więc „13,5” ani „  ”
    // z niej nie przyjdą. Przepuszcza je `happy-dom` (i przepuściłoby pole
    // `text`, gdyby kiedyś zastąpiło `number`) - wtedy przecinek ma znaczyć
    // kropkę, a same spacje puste pole.
    h.data = { label: 14 };
    setup();
    const input = sizeInput(LABEL.input);

    fireEvent.change(input, { target: { value: "13,5" } });
    expect(input.value).toBe("13,5");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(previewOf(LABEL.input)).toHaveStyle({ fontSize: "13.5px" });
    fireEvent.blur(input);
    expect(input.value).toBe("13.5");

    fireEvent.change(sizeInput(LABEL.label), { target: { value: "  " } });
    expect(sizeInput(LABEL.label)).toHaveAttribute("aria-invalid", "false");
    fireEvent.blur(sizeInput(LABEL.label));
    expect(sizeInput(LABEL.label).value).toBe("12");

    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{ input: 13.5 }]);
  });

  it("wartość spoza zakresu jest widoczna i oznaczona, podgląd już przycięty", () => {
    // REGUŁA 4. Pole nie podmienia liczby pod palcami, ale mówi, że jest zła.
    setup();
    const input = sizeInput(LABEL.button);
    expect(input).toHaveAttribute("aria-invalid", "false");

    fireEvent.change(input, { target: { value: "30" } });

    expect(input.value).toBe("30");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(previewOf(LABEL.button)).toHaveStyle({ fontSize: "18px" });

    fireEvent.change(input, { target: { value: "17" } });
    expect(input).toHaveAttribute("aria-invalid", "false");

    // Granice są WŁĄCZNE: 18 to dokładnie to, co pole pokazuje po przycięciu
    // trzydziestki, więc nie może świecić na czerwono. Pół piksela dalej już tak.
    for (const [value, invalid] of [
      ["18", "false"],
      ["9", "false"],
      ["18.5", "true"],
      ["8.5", "true"],
    ] as const) {
      fireEvent.change(input, { target: { value } });
      expect(input, value).toHaveAttribute("aria-invalid", invalid);
    }
  });

  it("wyjście z pola przycina do zakresu - od góry i od dołu", () => {
    // REGUŁA 2.
    setup();
    const top = sizeInput(LABEL.button);
    const bottom = sizeInput(LABEL.droplist);

    fireEvent.change(top, { target: { value: "30" } });
    fireEvent.blur(top);
    fireEvent.change(bottom, { target: { value: "4" } });
    fireEvent.blur(bottom);

    expect(top.value).toBe("18");
    expect(top).toHaveAttribute("aria-invalid", "false");
    expect(bottom.value).toBe("9");
    expect(defaultCell(LABEL.droplist)).toHaveTextContent("12 px");
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{ button: 18, droplist: 9 }]);
  });

  it("wyjście z nieedytowanego pola niczego nie nadpisuje", () => {
    h.data = { label: 14 };
    setup();

    fireEvent.blur(sizeInput(LABEL.button));
    fireEvent.click(saveButton());

    expect(h.saved).toEqual([{ label: 14 }]);
  });

  it("tekst, którego przeglądarka nie odczyta jako liczby, nie kasuje nadpisania", () => {
    // Przeglądarka przy `validity.badInput` raportuje PUSTE `value` (np. „1e”
    // w trakcie pisania). Potraktowane jak skasowanie pola zerowałoby wiersz do
    // domyślnego, choć redaktor widzi w nim swój tekst.
    h.data = { label: 14 };
    setup();
    const input = sizeInput(LABEL.label);
    setBadInput(input, true);

    fireEvent.change(input, { target: { value: "" } });

    expect(defaultCell(LABEL.label)).toHaveTextContent("12 px");
    expect(input).toHaveAttribute("aria-invalid", "true");
    setBadInput(input, false);
    fireEvent.blur(input);
    expect(input.value).toBe("14");
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{ label: 14 }]);
  });

  it("nieczytelny tekst skasowany jednym ruchem zdejmuje nadpisanie od razu", () => {
    // „1e” (`badInput`, `value` "") → zaznacz wszystko + Delete (`value` "",
    // już bez `badInput`). `value` się nie zmienia, więc `onChange` Reacta
    // milczy; bez tego pole byłoby puste, a jednak czerwone, i po wyjściu
    // wracałoby do 14 - zapis wysłałby nadpisanie, które redaktor skasował.
    h.data = { label: 14 };
    setup();
    const input = sizeInput(LABEL.label);
    setBadInput(input, true);
    fireEvent.input(input, { target: { value: "" } });
    expect(input).toHaveAttribute("aria-invalid", "true");

    setBadInput(input, false);
    fireEvent.input(input, { target: { value: "" } });

    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(defaultCell(LABEL.label)).toHaveTextContent("Domyślny");
    fireEvent.blur(input);
    expect(input.value).toBe("12");
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{}]);
  });

  it("nieczytelny tekst wpisany w PUSTE pole jest oznaczony, a wyjście wraca do domyślnej", () => {
    // Ten sam niewidoczny dla `onChange` krok w drugą stronę: "" → „e”.
    h.data = { label: 14 };
    setup();
    const input = sizeInput(LABEL.label);
    fireEvent.input(input, { target: { value: "" } });
    expect(defaultCell(LABEL.label)).toHaveTextContent("Domyślny");

    setBadInput(input, true);
    fireEvent.input(input, { target: { value: "" } });

    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(input);
    setBadInput(input, false);
    expect(input.value).toBe("12");
    expect(input).toHaveAttribute("aria-invalid", "false");
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{}]);
  });
});

describe("rozmiary czcionek - reset i zapis", () => {
  it("„Przywróć domyślne” zeruje szkic i surowe wpisy w edycji", () => {
    // REGUŁA 5. `click` bez wcześniejszego `blur` - przycisk nie może polegać na
    // tym, że wyjście z pola wyczyściło surowy wpis za niego.
    h.data = { label: 14, button: 16 };
    setup();
    fireEvent.change(sizeInput(LABEL.label), { target: { value: "1" } });

    fireEvent.click(resetButton());

    expect(sizeInput(LABEL.label).value).toBe("12");
    expect(sizeInput(LABEL.label)).toHaveAttribute("aria-invalid", "false");
    expect(sizeInput(LABEL.button).value).toBe("12");
    expect(defaultCell(LABEL.label)).toHaveTextContent("Domyślny");
    fireEvent.click(saveButton());
    expect(h.saved).toEqual([{}]);
  });

  it("zapis wysyła szkic PRZYCIĘTY i ekran pokazuje dokładnie to, co wysłano", () => {
    // REGUŁA 2. Zapis kliknięty bez wyjścia z pola: szkic trzyma 30.
    h.data = { label: 14 };
    setup();
    const input = sizeInput(LABEL.button);
    fireEvent.change(input, { target: { value: "30" } });

    fireEvent.click(saveButton());

    expect(h.saved).toEqual([{ label: 14, button: 18 }]);
    expect(input.value).toBe("18");
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("w trakcie zapisu oba przyciski są zablokowane, a etykieta mówi „Zapisywanie…”", () => {
    h.isPending = true;
    setup();

    expect(saveButton()).toHaveTextContent("Zapisywanie…");
    expect(saveButton()).toBeDisabled();
    expect(resetButton()).toBeDisabled();
  });

  it("poza zapisem przyciski są aktywne", () => {
    setup();

    expect(saveButton()).toHaveTextContent("Zapisz zmiany");
    expect(saveButton()).toBeEnabled();
    expect(resetButton()).toBeEnabled();
  });
});
