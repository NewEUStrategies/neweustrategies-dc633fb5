// POWTARZALNE WIERSZE BLOKÓW KONWERSYJNYCH (`step-list`, `comparison-table`).
//
// PO CO OSOBNY PLIK. Przejazd tabeli (`blockEditMatrix.*`) montuje te edytory
// na danych z palety (`spec.create()`), a paleta daje je BEZ ANI JEDNEJ
// kolumny i BEZ ANI JEDNEGO WIERSZA. Skutek: cała maszyneria repeatera -
// zmiana nazwy kolumny, wyróżnienie kolumny gwiazdką, usunięcie kolumny,
// wpisanie komórki, dodanie wiersza - nigdy się nie wykonywała, bo w DOM-ie
// nie było kontrolek, którymi przejazd mógłby ruszyć. To NIE jest kod
// marginalny: `setColumns` przy każdej zmianie PRZEBUDOWUJE tablicę `values`
// w każdym wierszu, czyli to jedno miejsce decyduje, czy redaktor po dodaniu
// kolumny zachowa wpisane wcześniej komórki, czy je zgubi.
//
// CO MA TU DOWÓD (niezmienniki, nie kształt DOM-u)
//  * dodanie i usunięcie kolumny PRZESTAWIA komórki każdego wiersza tak, żeby
//    zostały przy swoich kolumnach - a nie przesunęły się o jedno pole,
//  * wyróżnienie kolumny jest PRZEŁĄCZNIKIEM: powtórne kliknięcie gwiazdki
//    zdejmuje wyróżnienie (`featuredIndex: -1`), a nie wyróżnia jej drugi raz,
//  * dane z importu (element `null` na liście, wiersz bez `values`, kolumna
//    jako `null`) NIE pokazują redaktorowi napisów „null"/„undefined"
//    i nie wywracają edytora,
//  * wiersz krótszy niż liczba kolumn dostaje PUSTE komórki, a nie brak pola.
//
// GRANICE. Wszystkie fabryki `vi.mock` niesie moduł wspólny tabeli (`sonner`,
// Radix `Select`/`Switch`, `<Link>` routera, klient Supabase, `fetch`),
// dlatego jego import jest PIERWSZY. i18n PRAWDZIWE - etykiety i podpowiedzi
// pól bierzemy ze słownika (`realT`), więc zniknięcie klucza oblewa test
// zamiast przechodzić na echu nazwy klucza.
import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { ComparisonTableBlock, StepListBlock } from "../ConversionBlocks";

const t = realT("pl");
const cb = (key: string, opts?: Record<string, unknown>) =>
  t(`blocks.editors.conversionBlocks.${key}`, opts) as string;

function poPlaceholderze(container: HTMLElement, placeholder: string): HTMLInputElement[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(`input[placeholder="${placeholder}"]`),
  );
}

function przyciskOEtykiecie(container: HTMLElement, label: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`));
}

function przyciskZTekstem(container: HTMLElement, tekst: string): HTMLElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(tekst),
  );
  if (!btn) throw new Error(`brak przycisku „${tekst}"`);
  return btn;
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

/** Wiersze tabeli porównawczej w kształcie, w jakim leżą w dokumencie. */
function wiersze(block: Block): { feature: string; values: string[] }[] {
  const raw = block.data.rows;
  expect(Array.isArray(raw), "`rows` musi zostać TABLICĄ").toBe(true);
  return (raw as Json[]).map((r) => {
    const o = (r ?? {}) as Record<string, Json>;
    return {
      feature: String(o.feature ?? ""),
      values: (Array.isArray(o.values) ? (o.values as Json[]) : []).map((v) => String(v ?? "")),
    };
  });
}

function tabela(data: Record<string, Json>): Block {
  return { id: "c1", type: "comparison-table", data };
}

describe("lista kroków - dane z importu", () => {
  it("pozycja `null` na liście daje PUSTY krok, a nie napis „null”", () => {
    // Kształt z importu: eksporter potrafi zostawić dziurę w tablicy. Krok bez
    // danych ma się wyrenderować jako pusty formularz, żeby redaktor mógł go
    // uzupełnić albo usunąć - inaczej w polach siedzi słowo „null" i wchodzi
    // do treści przy pierwszym zapisie.
    const { container } = renderEditor(StepListBlock, {
      id: "s1",
      type: "step-list",
      data: { items: [null, {}] as unknown as Json },
    });
    const tytuly = poPlaceholderze(container, cb("stepTitle"));
    expect(tytuly).toHaveLength(2);
    expect(tytuly.every((i) => i.value === "")).toBe(true);
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("undefined");
  });

  it("krok bez pola `description` pokazuje puste pole opisu, nie „undefined”", () => {
    const { container } = renderEditor(StepListBlock, {
      id: "s1",
      type: "step-list",
      data: { items: [{ title: "Zgłoszenie" }] as unknown as Json },
    });
    const opisy = Array.from(container.querySelectorAll("textarea"));
    expect(opisy).toHaveLength(1);
    expect(opisy[0].value).toBe("");
    expect(poPlaceholderze(container, cb("stepTitle"))[0].value).toBe("Zgłoszenie");
  });

  it("`items` podane jako NAPIS nie wywraca edytora - lista jest pusta", () => {
    // Złe wejście wymuszone przez `as unknown as Json` - dokładnie taki kształt
    // przychodzi z ręcznie edytowanego JSON-a dokumentu.
    const { container } = renderEditor(StepListBlock, {
      id: "s1",
      type: "step-list",
      data: { items: "trzy kroki" as unknown as Json },
    });
    expect(poPlaceholderze(container, cb("stepTitle"))).toHaveLength(0);
    expect(przyciskZTekstem(container, cb("addStep"))).toBeTruthy();
  });
});

describe("tabela porównawcza - kolumny", () => {
  it("zmiana nazwy kolumny ZACHOWUJE komórki przy ich kolumnach", () => {
    // `setColumns` przebudowuje `values` każdego wiersza po indeksie kolumny.
    // Gdyby liczyło je od nowa, redaktor po samej korekcie literówki
    // w nagłówku traciłby całą zawartość tabeli.
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B"],
        rows: [{ feature: "Wsparcie", values: ["tak", "nie"] }] as unknown as Json,
      }),
    );
    const kolumna1 = poPlaceholderze(container, cb("columnN", { n: 1 }))[0];
    fireEvent.change(kolumna1, { target: { value: "Plan Start" } });
    const zapis = ostatniZapis(changes);
    expect(zapis.data.columns).toEqual(["Plan Start", "Plan B"]);
    expect(wiersze(zapis)).toEqual([{ feature: "Wsparcie", values: ["tak", "nie"] }]);
  });

  it("dodanie kolumny dokłada PUSTĄ komórkę w każdym wierszu, nie przesuwa istniejących", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A"],
        rows: [{ feature: "Wsparcie", values: ["tak"] }] as unknown as Json,
      }),
    );
    fireEvent.click(przyciskZTekstem(container, cb("addColumn")));
    const zapis = ostatniZapis(changes);
    expect(zapis.data.columns).toEqual(["Plan A", ""]);
    expect(wiersze(zapis)[0].values).toEqual(["tak", ""]);
  });

  it("usunięcie OSTATNIEJ kolumny przycina komórki każdego wiersza", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B"],
        rows: [{ feature: "Wsparcie", values: ["a", "b"] }] as unknown as Json,
      }),
    );
    const usun = przyciskOEtykiecie(container, cb("removeColumn"));
    expect(usun).toHaveLength(2);
    fireEvent.click(usun[1]);
    const zapis = ostatniZapis(changes);
    expect(zapis.data.columns).toEqual(["Plan A"]);
    expect(wiersze(zapis)[0].values).toEqual(["a"]);
  });

  // DEFEKT: USUNIĘCIE KOLUMNY ŚRODKOWEJ PRZESTAWIA KOMÓRKI O JEDNO POLE.
  //
  // WEJŚCIE: tabela z kolumnami ["Plan A", "Plan B", "Plan C"] i wierszem
  //   o wartościach ["a", "b", "c"]. Redaktor klika „Usuń kolumnę" przy
  //   kolumnie ŚRODKOWEJ (indeks 1).
  // CO PSUJE: przycisk woła `setColumns(columns.filter((_, k) => k !== i))`
  //   (src/components/admin/blocks/edit/ConversionBlocks.tsx:220), a
  //   `setColumns` przebudowuje wiersze jako `next.map((_, i) => r.values[i])`
  //   (:159-160) - czyta STARE wartości po NOWYCH indeksach. Po usunięciu
  //   kolumny 1 nowe indeksy to 0 i 1, więc wiersz dostaje ["a", "b"]:
  //   wartość usuniętej kolumny ZOSTAJE, a wartość kolumny „Plan C" przepada.
  // KONSEKWENCJA: cicha PODMIANA danych w tabeli cennika. Redaktor usuwa
  //   nieaktualny plan, a w kolumnie ostatniego planu widzi wartości planu,
  //   którego już nie ma - i nie ma jak zauważyć, bo liczba kolumn i liczba
  //   komórek się zgadzają. Publiczna strona pokazuje wtedy błędny cennik.
  // WYMAGANA POPRAWKA: usunięcie kolumny musi wycinać komórkę o TYM SAMYM
  //   indeksie z każdego wiersza (`values.filter((_, k) => k !== i)`), a nie
  //   przechodzić przez `setColumns`, które umie tylko dopasować DŁUGOŚĆ.
  it.fails("DEFEKT: usunięcie kolumny środkowej NIE może gubić komórek dalszych", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B", "Plan C"],
        rows: [{ feature: "Wsparcie", values: ["a", "b", "c"] }] as unknown as Json,
      }),
    );
    const usun = przyciskOEtykiecie(container, cb("removeColumn"));
    expect(usun).toHaveLength(3);
    fireEvent.click(usun[1]);
    const zapis = ostatniZapis(changes);
    expect(zapis.data.columns).toEqual(["Plan A", "Plan C"]);
    expect(wiersze(zapis)[0].values).toEqual(["a", "c"]);
  });

  it("gwiazdka WYRÓŻNIA kolumnę, a powtórne kliknięcie wyróżnienie ZDEJMUJE", () => {
    // Wyróżnienie to przełącznik jednej kolumny - bez gałęzi „to samo id"
    // redaktor nie miałby jak odwołać wyboru inaczej niż usunięciem kolumny.
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B"] }),
    );
    const gwiazdki = przyciskOEtykiecie(container, cb("highlightColumn"));
    fireEvent.click(gwiazdki[1]);
    expect(ostatniZapis(changes).data.featuredIndex).toBe(1);
  });

  it("powtórne kliknięcie gwiazdki JUŻ wyróżnionej kolumny zeruje wyróżnienie", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B"], featuredIndex: 1 }),
    );
    const gwiazdki = przyciskOEtykiecie(container, cb("highlightColumn"));
    fireEvent.click(gwiazdki[1]);
    expect(ostatniZapis(changes).data.featuredIndex).toBe(-1);
  });

  it("kolumna zapisana jako `null` renderuje PUSTE pole nazwy, nie napis „null”", () => {
    const { container } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", null] as unknown as Json }),
    );
    const nazwy = [
      poPlaceholderze(container, cb("columnN", { n: 1 }))[0],
      poPlaceholderze(container, cb("columnN", { n: 2 }))[0],
    ];
    expect(nazwy.map((i) => i.value)).toEqual(["Plan A", ""]);
    expect(container.textContent).not.toContain("null");
  });
});

describe("tabela porównawcza - wiersze i komórki", () => {
  it("wpisanie komórki trafia DOKŁADNIE pod swoją kolumnę", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B"],
        rows: [{ feature: "Wsparcie", values: ["", ""] }] as unknown as Json,
      }),
    );
    const komorki = poPlaceholderze(container, cb("cellHint"));
    expect(komorki).toHaveLength(2);
    fireEvent.change(komorki[1], { target: { value: "24/7" } });
    expect(wiersze(ostatniZapis(changes))[0].values).toEqual(["", "24/7"]);
  });

  it("wiersz KRÓTSZY niż liczba kolumn POKAZUJE komplet pustych pól", () => {
    // Import z arkusza potrafi przyciąć wiersz do ostatniej niepustej komórki.
    // Redaktor musi zobaczyć komplet pól, inaczej nie ma jak dopisać wartości
    // w kolumnach dalszych.
    const { container } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B", "Plan C"],
        rows: [{ feature: "Wsparcie", values: ["tak"] }] as unknown as Json,
      }),
    );
    expect(poPlaceholderze(container, cb("cellHint")).map((i) => i.value)).toEqual(["tak", "", ""]);
  });

  // DEFEKT: WPIS W DALSZĄ KOMÓRKĘ WIERSZA KRÓTSZEGO ZOSTAWIA DZIURĘ W TABLICY.
  //
  // WEJŚCIE: tabela z trzema kolumnami i wierszem po imporcie, który ma tylko
  //   JEDNĄ wartość (`values: ["tak"]`). Redaktor wpisuje treść w TRZECIĄ
  //   komórkę tego wiersza, drugą zostawiając pustą.
  // CO PSUJE: obsługa komórki robi `const v = [...r.values]; v[ci] = …`
  //   (src/components/admin/blocks/edit/ConversionBlocks.tsx:274-275) na
  //   tablicy krótszej niż `ci`. JavaScript tworzy wtedy tablicę RZADKĄ
  //   (`["tak", <1 empty item>, "nie"]`), a `toJsonArray` to wyłącznie
  //   rzutowanie typu (src/lib/content-model/json.ts:38) - dziura wchodzi do
  //   dokumentu bez zmiany.
  // KONSEKWENCJA: dziura NIE PRZEŻYWA zapisu do bazy: `JSON.stringify` zamienia
  //   pustą pozycję na `null`, więc dokument po odczycie ma w komórce `null`
  //   zamiast pustego napisu. Każdy konsument, który czyta komórkę bez
  //   zabezpieczenia (renderer publiczny, eksport), dostaje wartość innego typu
  //   niż w pozostałych komórkach - to ta sama klasa błędu, którą reszta tego
  //   pliku wyłapuje po stronie ODCZYTU.
  // WYMAGANA POPRAWKA: przed przypisaniem komórki wiersz musi zostać dopełniony
  //   do liczby kolumn pustymi napisami
  //   (`const v = columns.map((_, k) => r.values[k] ?? "")`), tak jak robi to
  //   `setColumns` przy zmianie liczby kolumn.
  it.fails("DEFEKT: wpis w dalszą komórkę NIE może zostawiać dziury w `values`", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B", "Plan C"],
        rows: [{ feature: "Wsparcie", values: ["tak"] }] as unknown as Json,
      }),
    );
    const komorki = poPlaceholderze(container, cb("cellHint"));
    fireEvent.change(komorki[2], { target: { value: "nie" } });
    expect(wiersze(ostatniZapis(changes))[0].values).toEqual(["tak", "", "nie"]);
  });

  it("dodanie wiersza tworzy KOMPLET pustych komórek pod istniejące kolumny", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B"] }),
    );
    fireEvent.click(przyciskZTekstem(container, cb("addRow")));
    const zapis = ostatniZapis(changes);
    expect(wiersze(zapis)).toEqual([{ feature: "", values: ["", ""] }]);
  });

  it("usunięcie wiersza zabiera TEN wiersz, a nie pierwszy z brzegu", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A"],
        rows: [
          { feature: "Wsparcie", values: ["tak"] },
          { feature: "Raporty", values: ["nie"] },
        ] as unknown as Json,
      }),
    );
    const usun = przyciskOEtykiecie(container, cb("removeRow"));
    expect(usun).toHaveLength(2);
    fireEvent.click(usun[1]);
    expect(wiersze(ostatniZapis(changes)).map((r) => r.feature)).toEqual(["Wsparcie"]);
  });

  it("zmiana nazwy funkcji nie rusza komórek tego wiersza", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A"],
        rows: [{ feature: "Wsparcie", values: ["tak"] }] as unknown as Json,
      }),
    );
    fireEvent.change(poPlaceholderze(container, cb("featureName"))[0], {
      target: { value: "Wsparcie 24/7" },
    });
    expect(wiersze(ostatniZapis(changes))).toEqual([{ feature: "Wsparcie 24/7", values: ["tak"] }]);
  });

  it("wiersz `null` i komórka `null` z importu nie pokazują napisu „null”", () => {
    // Trzy kształty naraz, wszystkie realne dla dokumentu po imporcie:
    // dziura w tablicy wierszy, wiersz bez `feature` i komórka `null`.
    const { container } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B"],
        rows: [null, { values: [null, "tak"] }] as unknown as Json,
      }),
    );
    expect(poPlaceholderze(container, cb("featureName")).map((i) => i.value)).toEqual(["", ""]);
    const komorki = poPlaceholderze(container, cb("cellHint")).map((i) => i.value);
    expect(komorki).toEqual(["", "", "", "tak"]);
    expect(container.textContent).not.toContain("null");
    expect(container.textContent).not.toContain("undefined");
  });

  it("`rows` podane jako OBIEKT (nie tablica) daje tabelę bez wierszy zamiast awarii", () => {
    const { container } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A"], rows: { a: 1 } as unknown as Json }),
    );
    expect(poPlaceholderze(container, cb("featureName"))).toHaveLength(0);
    expect(przyciskZTekstem(container, cb("addRow"))).toBeTruthy();
  });
});
