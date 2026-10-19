// EDYTORY TREŚCI Z POWTARZALNYMI POZYCJAMI: `review` (Review Box), `faq`,
// `proscons` - CO REDAKTOR WIDZI I CO ZAPISUJE.
//
// PO CO TEN PLIK. Po zdjęciu przejazdu tabeli (`blockEditMatrix.*`, PR #475)
// `Review.tsx`, `Faq.tsx` i `ProsCons.tsx` nie miały ani jednego wykonania
// w testach. Każdy z nich to repeater: redaktor dopisuje, poprawia i usuwa
// pozycje, a strona publiczna (`components/blocks/renderer/molecules.tsx`)
// czyta te same dane własnymi czytnikami (`str`/`num`/`objList`/`strList`).
//
// CO MA TU DOWÓD
//  * każde pole zapisuje się pod WŁASNYM kluczem, z `id`/`type` i resztą
//    danych bez zmian; sam render niczego nie zapisuje,
//  * repeater: dopisanie, edycja i usunięcie trafiają w TĘ pozycję, a nie
//    w sąsiednią (przyciski usuwania mają nazwę dostępną),
//  * ocena łączna w nagłówku Review Box liczy się jak na stronie publicznej
//    (`ReviewBlockView` pomija kryteria bez nazwy), skala jest LICZBĄ,
//  * dane spoza dziedziny (obiekt zamiast napisu, słowo zamiast liczby,
//    liczba w liście napisów) nie wyciekają jako „[object Object]”/„NaN”, tylko
//    pokazują to, co narysuje strona,
//  * edytor plusów/minusów NIE przemontowuje pól przy każdym znaku - redaktor
//    nie traci fokusu w trakcie pisania.
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix, Supabase, sesja) niesie moduł
// wspólny tabeli edytorów - import PIERWSZY. `AdminSelect` to natywny
// `<select>` i zostaje prawdziwy. i18n PRAWDZIWE (`realT`), więc asercje
// czytają te same napisy, które widzi redaktor.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-blocks";
import { FaqBlock } from "../Faq";
import { ProsConsBlock } from "../ProsCons";
import { ReviewBlock } from "../Review";

const t = realT("pl");
const ed = (group: string, key: string, o?: Record<string, unknown>) =>
  t(`blocks.editors.${group}.${key}`, o) as string;
const USUN = ed("common", "remove");

function blok(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

function ostatniZapis(changes: Block[]): Block {
  expect(changes.length, "edytor nie zapisał niczego").toBeGreaterThan(0);
  return changes[changes.length - 1];
}

function wartosciPol(placeholder: string): string[] {
  return screen.queryAllByPlaceholderText<HTMLInputElement>(placeholder).map((pole) => pole.value);
}

// ---------------------------------------------------------------------------
// Review Box
// ---------------------------------------------------------------------------

describe("review - zapis pól", () => {
  const start = blok("review", {
    title: "Strategia 2030",
    scale: 10,
    criteria: [
      { label: "Merytoryka", score: 9 },
      { label: "Język", score: 7 },
    ],
  });

  it.each([
    ["title", "title", "Nowa recenzja"],
    ["summary", "summary", "Warto przeczytać."],
    ["ctaLabel", "ctaLabel", "Kup książkę"],
    ["ctaHref", "ctaHref", "https://example.org/ksiazka"],
  ])("pole „%s” zapisuje się pod kluczem `%s`", (klucz, pole, wartosc) => {
    const { changes } = renderEditor(ReviewBlock, start);
    fireEvent.change(screen.getByPlaceholderText(ed("review", klucz)), {
      target: { value: wartosc },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "review" });
    expect(zapis.data).toEqual({ ...start.data, [pole]: wartosc });
  });

  it("skala zapisuje się jako LICZBA, a nie napis z listy wyboru", () => {
    const { changes } = renderEditor(ReviewBlock, start);
    const skala = screen.getByRole<HTMLSelectElement>("combobox");
    expect(skala.value).toBe("10");
    fireEvent.change(skala, { target: { value: "5" } });
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, scale: 5 });
  });

  it("dopisanie dokłada kryterium z oceną 8, edycja i usunięcie trafiają w TO kryterium", () => {
    const { changes } = renderEditor(ReviewBlock, start);

    fireEvent.click(screen.getByRole("button", { name: ed("review", "addCriterion") }));
    expect(ostatniZapis(changes).data.criteria).toEqual([
      { label: "Merytoryka", score: 9 },
      { label: "Język", score: 7 },
      { label: "", score: 8 },
    ]);

    fireEvent.change(screen.getByPlaceholderText(ed("review", "criterion", { n: 2 })), {
      target: { value: "Styl" },
    });
    expect(ostatniZapis(changes).data.criteria).toEqual([
      { label: "Merytoryka", score: 9 },
      { label: "Styl", score: 7 },
    ]);

    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "6.5" } });
    expect(ostatniZapis(changes).data.criteria).toEqual([
      { label: "Merytoryka", score: 6.5 },
      { label: "Język", score: 7 },
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: ed("review", "removeCriterion") })[0]);
    expect(ostatniZapis(changes).data.criteria).toEqual([{ label: "Język", score: 7 }]);
  });
});

describe("review - odczyt", () => {
  it("pusty blok pokazuje „0.0 / 10”, skalę 10 i niczego nie zapisuje", () => {
    const { container, changes } = renderEditor(ReviewBlock, blok("review", {}));
    expect(container.textContent).toContain("0.0 / 10");
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("10");
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(changes).toEqual([]);
  });

  it("ocena łączna pomija kryteria BEZ nazwy - tak samo jak strona publiczna", () => {
    // NAPRAWIONE 2026-10-18: nagłówek uśredniał WSZYSTKIE kryteria, a
    // `ReviewBlockView` liczy tylko te z nazwą. Świeżo dopisane kryterium
    // (pusta nazwa, ocena 8) zmieniało więc ocenę w panelu z 6.0 na 7.0,
    // choć czytelnik dalej widział 6.0.
    const { container } = renderEditor(
      ReviewBlock,
      blok("review", {
        criteria: [
          { label: "Jakość", score: 6 },
          { label: "  ", score: 10 },
        ],
      }),
    );
    expect(container.textContent).toContain("6.0 / 10");
  });

  it("skala i oceny spoza dziedziny pokazują wartości strony, bez „NaN” i „[object Object]”", () => {
    // NAPRAWIONE 2026-10-18: `Number("dużo")` dawało `NaN` w nagłówku
    // („NaN / NaN”) i przy suwaku, a `String({ pl: … })` - „[object Object]”
    // w polu nazwy kryterium. Strona publiczna czyta to samo czytnikami
    // `num`/`str`: skala 10, ocena 0, pusta nazwa.
    const { container } = renderEditor(
      ReviewBlock,
      blok("review", {
        title: { pl: "Tytuł" },
        scale: "dużo",
        criteria: [{ label: { pl: "Kryterium" }, score: "wysoko" }, "nie-obiekt", null],
      }),
    );
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).toContain("0.0 / 10");
    expect(wartosciPol(ed("review", "criterion", { n: 1 }))).toEqual([""]);
    expect(wartosciPol(ed("review", "title"))).toEqual([""]);
    expect(screen.getByRole<HTMLInputElement>("slider").value).toBe("0");
  });

  it("skala z importu spoza 5/10 jest widoczna na liście wyboru, a nie jako puste pole", () => {
    // Strona rysuje „/ 7”, więc lista wyboru też ma pokazać 7 - natywny
    // `<select>` bez pasującej opcji pokazałby pierwszą opcję i zgubił ją
    // przy pierwszej zmianie innego pola.
    const { container } = renderEditor(ReviewBlock, blok("review", { scale: 7 }));
    const skala = screen.getByRole<HTMLSelectElement>("combobox");
    expect(skala.value).toBe("7");
    expect(Array.from(skala.options).map((o) => o.value)).toEqual(["5", "7", "10"]);
    expect(container.textContent).toContain("/ 7");
  });
});

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

describe("faq", () => {
  const start = blok("faq", {
    title: "Najczęstsze pytania",
    items: [
      { q: "Kim jesteście?", a: "Think-tankiem." },
      { q: "Gdzie?", a: "W Warszawie." },
    ],
  });

  it("tytuł sekcji zapisuje się pod `title`, a render niczego nie zapisuje", () => {
    const { changes } = renderEditor(FaqBlock, start);
    expect(changes).toEqual([]);
    fireEvent.change(screen.getByPlaceholderText(ed("faq", "sectionTitle")), {
      target: { value: "FAQ" },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "faq" });
    expect(zapis.data).toEqual({ ...start.data, title: "FAQ" });
  });

  it("pytanie i odpowiedź DRUGIEJ pozycji zapisują się tylko w niej", () => {
    const { changes } = renderEditor(FaqBlock, start);
    fireEvent.change(screen.getByPlaceholderText(ed("faq", "question", { n: 2 })), {
      target: { value: "Gdzie działacie?" },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      { q: "Kim jesteście?", a: "Think-tankiem." },
      { q: "Gdzie działacie?", a: "W Warszawie." },
    ]);
    fireEvent.change(screen.getAllByPlaceholderText(ed("faq", "answer"))[1], {
      target: { value: "W Brukseli." },
    });
    expect(ostatniZapis(changes).data.items).toEqual([
      { q: "Kim jesteście?", a: "Think-tankiem." },
      { q: "Gdzie?", a: "W Brukseli." },
    ]);
  });

  it("dopisanie dokłada pustą parę, usunięcie zabiera TĘ pozycję", () => {
    const { changes } = renderEditor(FaqBlock, start);
    fireEvent.click(screen.getByRole("button", { name: ed("faq", "addQuestion") }));
    expect(ostatniZapis(changes).data.items).toEqual([
      { q: "Kim jesteście?", a: "Think-tankiem." },
      { q: "Gdzie?", a: "W Warszawie." },
      { q: "", a: "" },
    ]);
    fireEvent.click(screen.getAllByRole("button", { name: USUN })[0]);
    expect(ostatniZapis(changes).data.items).toEqual([{ q: "Gdzie?", a: "W Warszawie." }]);
  });

  it("pozycje-nieobiekty są pominięte, a obiekt w treści nie wycieka jako „[object Object]”", () => {
    // NAPRAWIONE 2026-10-18: `String(o.q)` na obiekcie dawało „[object Object]”
    // w polu pytania. `renderFaq` czyta pytanie czytnikiem `str` - dla obiektu
    // to pusty napis, więc tyle pokazuje i panel.
    const { container, changes } = renderEditor(
      FaqBlock,
      blok("faq", { title: 7, items: ["luźny napis", null, { q: { pl: "Pytanie" }, a: 42 }] }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    expect(wartosciPol(ed("faq", "question", { n: 1 }))).toEqual([""]);
    expect(wartosciPol(ed("faq", "answer"))).toEqual([""]);
    expect(wartosciPol(ed("faq", "sectionTitle"))).toEqual([""]);

    fireEvent.change(screen.getByPlaceholderText(ed("faq", "question", { n: 1 })), {
      target: { value: "Czym się zajmujecie?" },
    });
    expect(ostatniZapis(changes).data.items).toEqual([{ q: "Czym się zajmujecie?", a: "" }]);
  });
});

// ---------------------------------------------------------------------------
// Plusy i minusy
// ---------------------------------------------------------------------------

describe("proscons", () => {
  const PLUSY = ed("prosCons", "pros");
  const MINUSY = ed("prosCons", "cons");
  const start = blok("proscons", {
    title: "Ocena raportu",
    pros: ["Rzetelne dane", "Jasne wnioski"],
    cons: ["Za długi"],
  });

  it("tytuł zapisuje się pod `title`, a render niczego nie zapisuje", () => {
    const { changes } = renderEditor(ProsConsBlock, start);
    expect(changes).toEqual([]);
    fireEvent.change(screen.getByPlaceholderText(ed("prosCons", "title")), {
      target: { value: "Werdykt" },
    });
    const zapis = ostatniZapis(changes);
    expect(zapis).toMatchObject({ id: start.id, type: "proscons" });
    expect(zapis.data).toEqual({ ...start.data, title: "Werdykt" });
  });

  it("edycja, dopisanie i usunięcie trafiają w WŁAŚCIWĄ kolumnę i pozycję", () => {
    const { changes } = renderEditor(ProsConsBlock, start);

    fireEvent.change(screen.getAllByPlaceholderText(PLUSY)[1], {
      target: { value: "Konkretne rekomendacje" },
    });
    expect(ostatniZapis(changes).data).toEqual({
      ...start.data,
      pros: ["Rzetelne dane", "Konkretne rekomendacje"],
    });

    // Dwa przyciski „Dodaj" - pierwszy w kolumnie plusów, drugi w minusach.
    fireEvent.click(screen.getAllByRole("button", { name: ed("prosCons", "add") })[1]);
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, cons: ["Za długi", ""] });

    // Przyciski „Usuń": dwa w plusach, potem jeden w minusach.
    fireEvent.click(screen.getAllByRole("button", { name: USUN })[0]);
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, pros: ["Jasne wnioski"] });
    fireEvent.click(screen.getAllByRole("button", { name: USUN })[2]);
    expect(ostatniZapis(changes).data).toEqual({ ...start.data, cons: [] });
  });

  it("lista z pozycjami-nienapisami pokazuje tylko napisy, jak strona publiczna", () => {
    // NAPRAWIONE 2026-10-18: `String(x)` pokazywało „7” i „[object Object]”
    // jako plusy, których `renderProsCons` (czytnik `strList`) nigdy nie
    // narysuje. Teraz panel pokazuje to samo co strona, a pierwszy zapis
    // zostawia w liście wyłącznie napisy.
    const { container, changes } = renderEditor(
      ProsConsBlock,
      blok("proscons", { pros: ["Szybki", 7, { pl: "x" }, null], cons: "tak" }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    expect(wartosciPol(PLUSY)).toEqual(["Szybki"]);
    expect(wartosciPol(MINUSY)).toEqual([]);

    fireEvent.change(screen.getByPlaceholderText(PLUSY), { target: { value: "Bardzo szybki" } });
    expect(ostatniZapis(changes).data.pros).toEqual(["Bardzo szybki"]);
  });

  it("pisanie w polu NIE przemontowuje go - redaktor nie traci fokusu po każdym znaku", () => {
    // NAPRAWIONE 2026-10-18: kolumna była komponentem deklarowanym WEWNĄTRZ
    // renderu (`const Col = (...) => ...`), więc każdy zapis dawał Reactowi
    // NOWY typ komponentu i cała kolumna montowała się od zera - pole, w
    // którym redaktor pisał, znikało z DOM-u razem z fokusem.
    function Kanwa() {
      const [block, setBlock] = useState(start);
      return <ProsConsBlock block={block} onChange={setBlock} />;
    }
    render(<Kanwa />);
    const pole = screen.getAllByPlaceholderText<HTMLInputElement>(PLUSY)[0];
    pole.focus();
    fireEvent.change(pole, { target: { value: "Rzetelne dane i źródła" } });

    expect(pole.isConnected).toBe(true);
    expect(document.activeElement).toBe(pole);
    expect(pole.value).toBe("Rzetelne dane i źródła");
    expect(within(pole.parentElement as HTMLElement).getByRole("button", { name: USUN })).toBe(
      screen.getAllByRole("button", { name: USUN })[0],
    );
  });
});
