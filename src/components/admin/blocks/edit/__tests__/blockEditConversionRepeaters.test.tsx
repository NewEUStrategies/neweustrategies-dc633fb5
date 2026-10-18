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
//  * wiersz krótszy niż liczba kolumn dostaje PUSTE komórki, a nie brak pola,
//  * wyróżnienie kolumny (`featuredIndex`) jedzie RAZEM ze swoją kolumną, gdy
//    redaktor usuwa kolumnę wcześniejszą albo samą wyróżnioną - renderer
//    publiczny (`ComparisonTableView`) podświetla kolumnę wyłącznie po indeksie,
//    więc indeks nieprzesunięty to podświetlony INNY plan cennika,
//  * powtarzalne kroki listy (`step-list`): dopisanie, usunięcie i edycja
//    trafiają w TEN krok, a pola spoza formularza (`icon`) przeżywają zapis.
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

describe("lista kroków - zapis", () => {
  function kroki(data: Record<string, Json>): Block {
    return { id: "s1", type: "step-list", data };
  }

  it("dopisanie kroku dokłada PUSTY krok na końcu i nie rusza istniejących", () => {
    const { container, changes } = renderEditor(
      StepListBlock,
      kroki({
        title: "Jak to działa",
        items: [{ title: "Zgłoszenie", description: "", icon: "" }],
      }),
    );
    fireEvent.click(przyciskZTekstem(container, cb("addStep")));
    const zapis = ostatniZapis(changes);
    expect(zapis.data.items).toEqual([
      { title: "Zgłoszenie", description: "", icon: "" },
      { title: "", description: "", icon: "" },
    ]);
    // Tytuł sekcji i tożsamość bloku jadą bez zmian - zapis zmienia WYŁĄCZNIE listę.
    expect(zapis).toMatchObject({ id: "s1", type: "step-list" });
    expect(zapis.data.title).toBe("Jak to działa");
  });

  it("usunięcie kroku zabiera TEN krok, a numeracja reszty idzie od nowa", () => {
    const { container, changes } = renderEditor(
      StepListBlock,
      kroki({
        items: [
          { title: "Pierwszy", description: "", icon: "" },
          { title: "Drugi", description: "", icon: "" },
          { title: "Trzeci", description: "", icon: "" },
        ] as unknown as Json,
      }),
    );
    const usun = przyciskOEtykiecie(container, cb("removeStep"));
    expect(usun).toHaveLength(3);
    fireEvent.click(usun[1]);
    const zapis = ostatniZapis(changes);
    expect((zapis.data.items as { title: string }[]).map((k) => k.title)).toEqual([
      "Pierwszy",
      "Trzeci",
    ]);
  });

  it("edycja tytułu i opisu kroku ZACHOWUJE jego ikonę, której formularz nie pokazuje", () => {
    // `icon` nie ma pola w edytorze, ale renderer publiczny je czyta - zapis
    // tytułu nie może po cichu wyzerować ikony ustawionej wcześniej.
    const { container, changes } = renderEditor(
      StepListBlock,
      kroki({ items: [{ title: "Krok", description: "", icon: "rocket" }] as unknown as Json }),
    );
    fireEvent.change(poPlaceholderze(container, cb("stepTitle"))[0], {
      target: { value: "Rejestracja" },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      { title: "Rejestracja", description: "", icon: "rocket" },
    ]);
    fireEvent.change(container.querySelector("textarea")!, {
      target: { value: "Zakładasz konto w minutę." },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      { title: "Krok", description: "Zakładasz konto w minutę.", icon: "rocket" },
    ]);
  });

  it("tytuł sekcji, orientacja i styl numeru zapisują się pod WŁASNYMI kluczami", () => {
    const { container, changes } = renderEditor(StepListBlock, kroki({}));
    // Pusty blok pokazuje wartości domyślne renderera: pionowo i numer w kole.
    const [orientacja, styl] = Array.from(container.querySelectorAll("select"));
    expect(orientacja.value).toBe("vertical");
    expect(styl.value).toBe("circle");

    fireEvent.change(poPlaceholderze(container, cb("sectionTitle"))[0], {
      target: { value: "Jak zacząć" },
    });
    expect(ostatniZapis(changes).data).toEqual({ title: "Jak zacząć" });
    fireEvent.change(orientacja, { target: { value: "horizontal" } });
    expect(ostatniZapis(changes).data).toEqual({ orientation: "horizontal" });
    fireEvent.change(styl, { target: { value: "plain" } });
    expect(ostatniZapis(changes).data).toEqual({ numberStyle: "plain" });
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

  // NAPRAWIONE 2026-10-18 (był `it.fails`): usunięcie kolumny ŚRODKOWEJ
  // wycina komórkę o TYM SAMYM indeksie z każdego wiersza.
  //
  // WEJŚCIE: kolumny ["Plan A", "Plan B", "Plan C"], wiersz ["a", "b", "c"],
  //   redaktor usuwa kolumnę środkową (indeks 1).
  // KONTRAKT: wiersz dostaje ["a", "c"] - wartość planu „Plan C" zostaje przy
  //   swojej kolumnie. Wcześniej przycisk szedł przez `setColumns`, które
  //   czytało STARE wartości po NOWYCH indeksach i dawało ["a", "b"]: wartość
  //   usuniętego planu zostawała, a ostatniego przepadała - cicha podmiana
  //   cennika na stronie publicznej. Teraz usuwa `removeColumn` w
  //   `ConversionBlocks.tsx`, które filtruje `values` po indeksie kolumny.
  it("usunięcie kolumny środkowej NIE gubi komórek dalszych", () => {
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

  it("gwiazdka ogłasza stan wyróżnienia przez `aria-pressed`, nie tylko glifem", () => {
    // Przełącznik bez stanu ARIA czytnik ekranu czyta jako zwykły przycisk
    // „Wyróżnij kolumnę" przy KAŻDEJ kolumnie - bez `aria-pressed` nie da się
    // usłyszeć, który plan jest wyróżniony.
    const { container } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B", "Plan C"], featuredIndex: 1 }),
    );
    const gwiazdki = przyciskOEtykiecie(container, cb("highlightColumn"));
    expect(gwiazdki.map((g) => g.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  });

  // NOWY DEFEKT (znaleziony 2026-10-18 przy naprawie usuwania kolumny,
  // NAPRAWIONY w tym samym kroku): usunięcie kolumny nie ruszało
  // `featuredIndex`. Renderer publiczny podświetla kolumnę WYŁĄCZNIE po
  // indeksie (`i === featuredIndex` w `ComparisonTableView`), więc po
  // usunięciu planu PRZED wyróżnionym podświetlenie przeskakiwało na plan
  // następny, a po usunięciu SAMEGO wyróżnionego - na jego sąsiada z prawej.
  it("usunięcie kolumny PRZED wyróżnioną przesuwa wyróżnienie razem z jej kolumną", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B", "Plan C"], featuredIndex: 2 }),
    );
    fireEvent.click(przyciskOEtykiecie(container, cb("removeColumn"))[0]);
    const zapis = ostatniZapis(changes);
    expect(zapis.data.columns).toEqual(["Plan B", "Plan C"]);
    // „Plan C" był wyróżniony i ZOSTAJE wyróżniony - teraz pod indeksem 1.
    expect(zapis.data.featuredIndex).toBe(1);
  });

  it("usunięcie WYRÓŻNIONEJ kolumny zdejmuje wyróżnienie, a nie oddaje go sąsiadowi", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B", "Plan C"], featuredIndex: 1 }),
    );
    fireEvent.click(przyciskOEtykiecie(container, cb("removeColumn"))[1]);
    const zapis = ostatniZapis(changes);
    expect(zapis.data.columns).toEqual(["Plan A", "Plan C"]);
    expect(zapis.data.featuredIndex).toBe(-1);
  });

  it("usunięcie kolumny ZA wyróżnioną nie rusza wyróżnienia ani nie dopisuje klucza", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: ["Plan A", "Plan B", "Plan C"], featuredIndex: 0 }),
    );
    fireEvent.click(przyciskOEtykiecie(container, cb("removeColumn"))[2]);
    expect(ostatniZapis(changes).data.featuredIndex).toBe(0);

    // Tabela bez wyróżnienia: usunięcie kolumny nie wymyśla `featuredIndex`.
    const bez = renderEditor(ComparisonTableBlock, tabela({ columns: ["Plan A", "Plan B"] }));
    fireEvent.click(przyciskOEtykiecie(bez.container, cb("removeColumn"))[0]);
    expect("featuredIndex" in ostatniZapis(bez.changes).data).toBe(false);
  });

  it("usunięcie kolumny z wiersza KRÓTSZEGO niż liczba kolumn oddaje pełny wiersz bez dziur", () => {
    // Wiersz po imporcie z jedną wartością na trzy kolumny: po usunięciu
    // pierwszej zostają dwie PUSTE komórki, a nie tablica krótsza od kolumn.
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B", "Plan C"],
        rows: [{ feature: "Wsparcie", values: ["a"] }] as unknown as Json,
      }),
    );
    fireEvent.click(przyciskOEtykiecie(container, cb("removeColumn"))[0]);
    expect(wiersze(ostatniZapis(changes))[0].values).toEqual(["", ""]);
  });

  it("tytuł tabeli zapisuje się pod `title` i nie rusza kolumn ani wierszy", () => {
    const start = tabela({
      columns: ["Plan A"],
      rows: [{ feature: "Wsparcie", values: ["tak"] }] as unknown as Json,
    });
    const { container, changes } = renderEditor(ComparisonTableBlock, start);
    fireEvent.change(poPlaceholderze(container, cb("title"))[0], {
      target: { value: "Porównanie planów" },
    });
    expect(ostatniZapis(changes)).toEqual({
      ...start,
      data: { ...start.data, title: "Porównanie planów" },
    });
  });

  it("`columns` podane jako NAPIS daje tabelę bez kolumn zamiast awarii", () => {
    const { container } = renderEditor(
      ComparisonTableBlock,
      tabela({ columns: "Basic, Pro" as unknown as Json }),
    );
    expect(przyciskOEtykiecie(container, cb("removeColumn"))).toHaveLength(0);
    expect(przyciskZTekstem(container, cb("addColumn"))).toBeTruthy();
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

  // NAPRAWIONE 2026-10-18 (był `it.fails`): wpis w dalszą komórkę wiersza
  // KRÓTSZEGO niż liczba kolumn nie zostawia dziury w `values`.
  //
  // WEJŚCIE: trzy kolumny, wiersz po imporcie z JEDNĄ wartością
  //   (`values: ["tak"]`); redaktor wpisuje treść w TRZECIĄ komórkę.
  // KONTRAKT: zapis oddaje `["tak", "", "nie"]` - PEŁNĄ tablicę napisów.
  //   Wcześniej `v = [...r.values]; v[2] = …` tworzyło tablicę RZADKĄ, a dziura
  //   po `JSON.stringify` wracała z bazy jako `null`, czyli komórka innego typu
  //   niż reszta. Teraz wiersz jest najpierw dopełniany do liczby kolumn
  //   (`columns.map((_, k) => r.values[k] ?? "")`), jak w `setColumns`.
  //   Druga asercja patrzy na SUROWĄ tablicę zapisu: indeks 1 ISTNIEJE
  //   i każda komórka jest napisem - dokładnie to, co przeżyje `JSON.stringify`.
  it("wpis w dalszą komórkę NIE zostawia dziury w `values`", () => {
    const { container, changes } = renderEditor(
      ComparisonTableBlock,
      tabela({
        columns: ["Plan A", "Plan B", "Plan C"],
        rows: [{ feature: "Wsparcie", values: ["tak"] }] as unknown as Json,
      }),
    );
    const komorki = poPlaceholderze(container, cb("cellHint"));
    fireEvent.change(komorki[2], { target: { value: "nie" } });
    const zapis = ostatniZapis(changes);
    expect(wiersze(zapis)[0].values).toEqual(["tak", "", "nie"]);
    const surowe = ((zapis.data.rows as Json[])[0] as { values: Json[] }).values;
    expect(1 in surowe, "dziura w tablicy `values`").toBe(true);
    expect(surowe.map((v) => typeof v)).toEqual(["string", "string", "string"]);
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
