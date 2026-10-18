// AKORDEON, ZAKŁADKI, ODLICZANIE, PASEK POSTĘPU - kontrakt ZAPISU edytorów
// z `InteractiveBlocks.tsx`.
//
// PO CO OSOBNY PLIK. Cztery edytory interaktywne miały pokryte 12% linii:
// render bloku świeżo wstawionego - i nic więcej. Tymczasem to tu siedzą
// zapisy, które redaktor robi najczęściej: dopisanie i usunięcie sekcji
// akordeonu albo zakładki, data końca odliczania, wartość paska postępu.
//
// CO MA TU DOWÓD
//  * każdy zapis niesie TEN SAM `id` i `type` bloku, a pozostałe klucze
//    `data` zostają nietknięte,
//  * „Dodaj" dopisuje pustą pozycję NA KOŃCU, „Usuń" usuwa WSKAZANĄ, pole
//    pozycji pisze tylko w swoją pozycję,
//  * data odliczania zapisuje się jako LOKALNA data i godzina bez strefy
//    (`2026-12-31T18:30`), a wyczyszczenie - jako pusty napis; zmiana godziny
//    nie przesuwa dnia,
//  * pasek postępu pokazuje i zapisuje wartość w zakresie 0-100, tak jak
//    narysuje ją strona (blok bez wartości to 0%, nie 50%),
//  * pozycja-OBIEKT (treść per język) daje puste pole, a nie „[object Object]".
//
// GRANICE. Fabryki `vi.mock` niesie moduł wspólny tabeli, dlatego jego
// import jest PIERWSZY. i18n PRAWDZIWE. Kalendarz i pole godziny
// (`AdminDateTimePicker`) są PRAWDZIWE - to one tworzą zapisywany napis daty,
// więc ich atrapa przykryłaby dokładnie to, czego test dowodzi.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { AccordionBlock, CountdownBlock, ProgressBlock, TabsBlock } from "../InteractiveBlocks";

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatni(changes: readonly Block[], wzor: Block): Block {
  const zapis = changes.at(-1);
  if (!zapis) throw new Error("edytor nie zapisał niczego");
  expect({ id: zapis.id, type: zapis.type }).toEqual({ id: wzor.id, type: wzor.type });
  return zapis;
}

const pola = (placeholder: string) => screen.getAllByPlaceholderText<HTMLInputElement>(placeholder);

describe("akordeon", () => {
  const S1 = { title: "Pytanie 1", body: "Odpowiedź 1" };
  const S2 = { title: "Pytanie 2", body: "Odpowiedź 2" };

  it("sam render nie zapisuje; „wiele otwartych” jest domyślnie WYŁĄCZONE", () => {
    const { changes } = renderEditor(AccordionBlock, blok("accordion", { items: [S1] }));
    expect(changes).toEqual([]);
    expect(
      screen.getByRole("checkbox", { name: "Zezwalaj na otwieranie wielu sekcji" }),
    ).not.toBeChecked();
  });

  it("przełącznik zapisuje `allowMultiple: true`, zachowując sekcje", () => {
    const b = blok("accordion", { items: [S1] });
    const { changes } = renderEditor(AccordionBlock, b);
    fireEvent.click(screen.getByRole("checkbox", { name: "Zezwalaj na otwieranie wielu sekcji" }));
    expect(ostatni(changes, b).data).toEqual({ items: [S1], allowMultiple: true });
  });

  it("„Dodaj sekcję” dopisuje pustą sekcję na końcu - także gdy `items` nie jest tablicą", () => {
    const zTablica = blok("accordion", { items: [S1] });
    const a = renderEditor(AccordionBlock, zTablica);
    fireEvent.click(screen.getByRole("button", { name: /Dodaj sekcję/ }));
    expect(ostatni(a.changes, zTablica).data.items).toEqual([S1, { title: "", body: "" }]);
    a.unmount();

    const zNapisem = blok("accordion", { items: "nie-tablica" });
    const b = renderEditor(AccordionBlock, zNapisem);
    expect(screen.queryAllByPlaceholderText("Tytuł sekcji")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Dodaj sekcję/ }));
    expect(ostatni(b.changes, zNapisem).data.items).toEqual([{ title: "", body: "" }]);
  });

  it("tytuł i treść piszą tylko w swoją sekcję, a „Usuń sekcję” usuwa wskazaną", () => {
    const b = blok("accordion", { items: [S1, S2] });
    const { changes } = renderEditor(AccordionBlock, b);
    fireEvent.change(pola("Tytuł sekcji")[1], { target: { value: "Nowe" } });
    expect(ostatni(changes, b).data.items).toEqual([S1, { ...S2, title: "Nowe" }]);
    fireEvent.change(pola("Treść (HTML / markdown)")[0], { target: { value: "<p>T</p>" } });
    expect(ostatni(changes, b).data.items).toEqual([{ ...S1, body: "<p>T</p>" }, S2]);
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń sekcję" })[0]);
    expect(ostatni(changes, b).data.items).toEqual([S2]);
  });

  it("sekcja z polami-OBIEKTAMI albo `null` daje puste pola, a nie „[object Object]”", () => {
    renderEditor(AccordionBlock, blok("accordion", { items: [{ title: { pl: "P" } }, null] }));
    expect(pola("Tytuł sekcji").map((el) => el.value)).toEqual(["", ""]);
    expect(pola("Treść (HTML / markdown)").map((el) => el.value)).toEqual(["", ""]);
  });
});

describe("zakładki", () => {
  const T1 = { label: "Opis", body: "<p>A</p>" };
  const T2 = { label: "Dane", body: "<p>B</p>" };

  it("orientacja spoza opcji pokazuje „Poziomo” - tak narysuje ją strona", () => {
    renderEditor(TabsBlock, blok("tabs", { orientation: "ukośnie" }));
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("horizontal");
  });

  it("zmiana orientacji zapisuje `orientation`, zachowując zakładki", () => {
    const b = blok("tabs", { items: [T1] });
    const { changes } = renderEditor(TabsBlock, b);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "vertical" } });
    expect(ostatni(changes, b).data).toEqual({ items: [T1], orientation: "vertical" });
  });

  it("dodanie, edycja i usunięcie zakładki - każde jednym zapisem", () => {
    const b = blok("tabs", { items: [T1, T2] });
    const { changes } = renderEditor(TabsBlock, b);
    fireEvent.click(screen.getByRole("button", { name: /Dodaj zakładkę/ }));
    expect(ostatni(changes, b).data.items).toEqual([T1, T2, { label: "", body: "" }]);
    fireEvent.change(pola("Etykieta zakładki")[0], { target: { value: "Opis+" } });
    expect(ostatni(changes, b).data.items).toEqual([{ ...T1, label: "Opis+" }, T2]);
    fireEvent.change(pola("Treść (HTML)")[1], { target: { value: "<p>C</p>" } });
    expect(ostatni(changes, b).data.items).toEqual([T1, { ...T2, body: "<p>C</p>" }]);
    fireEvent.click(screen.getAllByRole("button", { name: "Usuń zakładkę" })[1]);
    expect(ostatni(changes, b).data.items).toEqual([T1]);
    expect(changes).toHaveLength(4);
  });

  it("zakładka z etykietą-OBIEKTEM ma puste pole etykiety", () => {
    renderEditor(TabsBlock, blok("tabs", { items: [{ label: { en: "Tab" }, body: "x" }] }));
    expect(pola("Etykieta zakładki")[0].value).toBe("");
    expect(pola("Treść (HTML)")[0].value).toBe("x");
  });
});

describe("odliczanie", () => {
  it("zapisana data pokazuje się w polu godziny, a zmiana godziny NIE przesuwa dnia", () => {
    // Napis bez strefy czasowej to kontrakt bloku: render publiczny czyta go
    // jako czas lokalny. Konwersja przez UTC przesunęłaby koniec promocji
    // o przesunięcie strefy redaktora.
    const b = blok("countdown", { targetAt: "2026-12-31T10:00", label: "Do końca" });
    const { changes } = renderEditor(CountdownBlock, b);
    const godzina = screen.getByLabelText<HTMLInputElement>("Godzina");
    expect(godzina.value).toBe("10:00");
    fireEvent.change(godzina, { target: { value: "18:30" } });
    expect(ostatni(changes, b).data).toEqual({ targetAt: "2026-12-31T18:30", label: "Do końca" });
  });

  it("„Wyczyść” zapisuje PUSTY napis daty, a nie `null`", () => {
    // Pusty napis jest stanem „bez daty", który rejestr nadaje nowemu blokowi
    // (`targetAt: ""`) - `null` byłby trzecim stanem tego samego znaczenia.
    const b = blok("countdown", { targetAt: "2026-12-31T10:00" });
    const { changes } = renderEditor(CountdownBlock, b);
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(ostatni(changes, b).data.targetAt).toBe("");
  });

  it("opis i tekst po wygaśnięciu zapisują się pod swoimi kluczami", () => {
    const b = blok("countdown", { targetAt: "" });
    const { changes } = renderEditor(CountdownBlock, b);
    fireEvent.change(screen.getByPlaceholderText("Opis (np. Do końca promocji)"), {
      target: { value: "Zostało" },
    });
    expect(ostatni(changes, b).data).toEqual({ targetAt: "", label: "Zostało" });
    fireEvent.change(
      screen.getByPlaceholderText("Tekst po wygaśnięciu (np. Promocja zakończona)"),
      { target: { value: "Po wszystkim" } },
    );
    expect(ostatni(changes, b).data).toEqual({ targetAt: "", expiredText: "Po wszystkim" });
  });

  it("data zapisana jako OBIEKT to brak daty, a nie śmieć w polach", () => {
    const { changes } = renderEditor(CountdownBlock, blok("countdown", { targetAt: { at: 1 } }));
    expect(changes).toEqual([]);
    expect(screen.getByLabelText<HTMLInputElement>("Godzina").value).toBe("");
    expect(screen.getByRole("button", { name: /Wybierz datę/ })).toBeInTheDocument();
  });
});

describe("pasek postępu", () => {
  it("suwak zapisuje LICZBĘ, a etykieta procentowa pokazuje zapisaną wartość", () => {
    const b = blok("progress", { value: 40, label: "Zbiórka" });
    const { changes, rerender } = renderEditor(ProgressBlock, b);
    expect(screen.getByText("40%")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "65" } });
    const zapis = ostatni(changes, b);
    expect(zapis.data).toEqual({ value: 65, label: "Zbiórka" });

    rerender(<ProgressBlock block={zapis} onChange={() => undefined} />);
    expect(screen.getByText("65%")).toBeInTheDocument();
  });

  it("blok BEZ wartości pokazuje 0% - pusty pasek, który rysuje strona", () => {
    // Render publiczny czyta brak jako 0 (`num(..., 0)`); wcześniej panel
    // pokazywał tu 50%, czyli inny pasek niż ten, który widzi czytelnik.
    // Nowy blok z rejestru i tak dostaje jawne `value: 50`.
    const { changes } = renderEditor(ProgressBlock, blok("progress", {}));
    expect(changes).toEqual([]);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByRole<HTMLInputElement>("slider").value).toBe("0");
  });

  it("wartość jako napis z przecinkiem („33,5”) jest liczbą, a ujemna - zerem", () => {
    const a = renderEditor(ProgressBlock, blok("progress", { value: "33,5" }));
    expect(screen.getByText("33.5%")).toBeInTheDocument();
    a.unmount();
    renderEditor(ProgressBlock, blok("progress", { value: -12 }));
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("etykieta, kolor i przełącznik procentu zapisują się pod swoimi kluczami", () => {
    const b = blok("progress", { value: 10 });
    const { changes } = renderEditor(ProgressBlock, b);
    expect(screen.getByRole("checkbox", { name: "Pokaż %" })).toBeChecked();

    fireEvent.change(screen.getByPlaceholderText("Etykieta"), { target: { value: "Postęp" } });
    expect(ostatni(changes, b).data).toEqual({ value: 10, label: "Postęp" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "danger" } });
    expect(ostatni(changes, b).data).toEqual({ value: 10, color: "danger" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Pokaż %" }));
    expect(ostatni(changes, b).data).toEqual({ value: 10, showValue: false });
  });
});
