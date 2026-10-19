// KOERCJA WARTOŚCI W EDYTORACH BLOKÓW - co jest odrzucane, a co przechodzi.
//
// PO CO OSOBNY PLIK. Tabela `blockEditMatrix.*` pilnuje PODŁOGI dla wszystkich
// 98 edytorów naraz (render, brak zapisu na renderze, limity pól, dziedzina
// list wyboru). Tutaj są przypadki POJEDYNCZE, z KONKRETNYM wejściem i
// KONKRETNYM skutkiem - bo „edytor odrzuca niepoprawną wartość" ma sens tylko
// wtedy, gdy widać, jaką wartość i na co ją zamienia.
//
// CO MA TU DOWÓD
//  * klamrowanie DZIAŁA dla wejść liczbowych spoza zakresu (poziom nagłówka
//    99 -> 5, -3 -> 1; poziom zagnieżdżenia listy 7 -> 6, -1 -> 1),
//  * klamrowanie DZIAŁA także dla wejść, które nie są liczbami - wartość
//    nieczytelna wraca do domyślnej, a nie do `NaN`. Do 2026-10-18 były to
//    zarejestrowane defekty (`it.fails`): `Math.min(Math.max(Number(x),1),5)`
//    zwracało `NaN` dla każdego `x`, którego `Number()` nie umie przeczytać,
//    bo `Math.max(NaN, 1)` to `NaN`. To nie było teoretyczne: import
//    WordPressa zapisuje poziom nagłówka jako `"h2"`, a nie `2`,
//  * pole formularza NIE dostaje obiektu jako literalnego `[object Object]`
//    (podpis obrazu, pozycje listy) - wcześniej przepuszczał go idiom
//    `String(x ?? "")`, a pierwsza edycja utrwalała śmieć w dokumencie.
//
// NAPRAWIONE 2026-10-18. Edytory czytają napisy przez strażnik typu
// `readText` z `dataVizShared.tsx`, a liczby - TĄ SAMĄ koercją, co ich
// render: odstęp i pasek postępu przez `num` z `renderer/data.ts` (napis
// z przecinkiem to dla niego nie liczba), wykres przez parser, który rysuje
// podgląd i stronę (`parseChartConfig`), a lista - tylko napisy, jak
// `strList` w renderze publicznym. Każdy przypadek niżej był
// wcześniej `it.fails` padającym NA ASERCJI DOCELOWEJ; teraz pilnuje, żeby
// defekt nie wrócił, i mówi, NA CO wartość jest zamieniana.
//
// GRANICE. Mockowane tylko: Radix `Select`/`Switch` (biblioteka, nie nasz kod -
// pod happy-dom nie rozwija listy), `sonner`, `<Link>` routera, klient
// Supabase i `fetch`. Wszystkie fabryki `vi.mock` niesie moduł wspólny tabeli,
// dlatego jego import jest PIERWSZY. i18n jest PRAWDZIWE.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { CHART_HEIGHT_DEFAULT, CHART_HEIGHT_MAX } from "@/lib/charts/parse";
import { HeadingBlock } from "../Heading";
import { SpacerBlock } from "../Spacer";
import { ProgressBlock } from "../InteractiveBlocks";
import { ChartBlock } from "../DataVizBlocks";
import { ImageBlock } from "../Image";
import { ListBlockEdit } from "../ListBlock";

function block(type: BlockType, data: Record<string, Json>): Block {
  return { id: `blk-${type}`, type, data };
}

describe("klamrowanie liczb - to, co DZIAŁA", () => {
  it("nagłówek z poziomem 99 renderuje się jako H5 (górny limit)", () => {
    const { container } = renderEditor(
      HeadingBlock,
      block("heading", { level: 99, text: "Tytuł" }),
    );
    const el = container.querySelector("[data-heading-level]");
    expect(el?.getAttribute("data-heading-level")).toBe("5");
    expect(el?.className).toContain("cms-h5");
  });

  it("nagłówek z poziomem -3 renderuje się jako H1 (dolny limit)", () => {
    const { container } = renderEditor(
      HeadingBlock,
      block("heading", { level: -3, text: "Tytuł" }),
    );
    expect(
      container.querySelector("[data-heading-level]")?.getAttribute("data-heading-level"),
    ).toBe("1");
  });

  it('nagłówek z poziomem jako NAPIS liczbowy „4" jest przyjęty', () => {
    // Import WordPressa zapisuje część liczb jako napisy - ta ścieżka działa.
    const { container } = renderEditor(HeadingBlock, block("heading", { level: "4", text: "T" }));
    expect(
      container.querySelector("[data-heading-level]")?.getAttribute("data-heading-level"),
    ).toBe("4");
  });

  it("lista klamruje poziom zagnieżdżenia z 7 do 6 i z -1 do 1", () => {
    // `readLevels` w `ListBlock.tsx` robi `Math.max(1, Math.min(6, raw[i]))`
    // i - w przeciwieństwie do nagłówka - najpierw SPRAWDZA TYP (`typeof
    // raw[i] === "number"`), więc `NaN` nie ma tu skąd wziąć się.
    const { container } = renderEditor(
      ListBlockEdit,
      block("list", { items: ["a", "b", "c"], levels: [7, -1, "trzy"] }),
    );
    const levels = Array.from(container.querySelectorAll("[data-level]")).map((el) =>
      el.getAttribute("data-level"),
    );
    expect(levels, "trzy pozycje listy = trzy poziomy w DOM-ie").toHaveLength(3);
    expect(levels[0]).toBe("6");
    expect(levels[1]).toBe("1");
    // `"trzy"` nie jest liczbą, więc strażnik typu odrzuca ją do wartości 1 -
    // dokładnie tego brakuje w nagłówku (defekt niżej).
    expect(levels[2]).toBe("1");
  });

  it("suwak wysokości odstępu przyjmuje wartość z zakresu i pokazuje ją w px", () => {
    const { container } = renderEditor(SpacerBlock, block("spacer", { height: 120 }));
    expect(container.textContent).toContain("120px");
    const suwak = container.querySelector<HTMLInputElement>('input[type="range"]');
    expect(suwak?.min).toBe("8");
    expect(suwak?.max).toBe("400");
    expect(suwak?.value).toBe("120");
  });
});

describe("koercja niepoprawnych wartości - NAPRAWIONE DEFEKTY", () => {
  it('nagłówek z poziomem „h2" (kształt z importu WordPressa) jest H2, a nie cms-hNaN', () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): `Math.min(Math.max(Number("h2"),
    // 1), 5)` dawało `NaN`, bo `Math.max(NaN, 1)` to `NaN` - nagłówek dostawał
    // `className="cms-hNaN"` (klasy o tej nazwie nie ma w arkuszu, więc
    // podgląd tracił rozmiar fontu) i `data-heading-level="NaN"`, z którego
    // pasek narzędzi czyta bieżący poziom. Teraz poziom nieczytelny to
    // domyślne 2 - tak samo jak w renderze publicznym (`num(..., 2)`).
    const { container } = renderEditor(HeadingBlock, block("heading", { level: "h2", text: "T" }));
    const el = container.querySelector("[data-heading-level]");
    expect(el?.getAttribute("data-heading-level")).toBe("2");
    expect(el?.className).toContain("cms-h2");
    expect(el?.className).not.toContain("NaN");
  });

  it("nagłówek z poziomem ułamkowym 3,6 dostaje całkowity poziom 4, a nie klasę cms-h3.6", () => {
    // Ta sama klamra bez zaokrąglenia przepuszczała ułamek do nazwy klasy -
    // klasy `cms-h3.6` nie ma w arkuszu, a pasek narzędzi czytałby poziom,
    // którego żaden przycisk nie zaznacza.
    const { container } = renderEditor(HeadingBlock, block("heading", { level: 3.6, text: "T" }));
    expect(
      container.querySelector("[data-heading-level]")?.getAttribute("data-heading-level"),
    ).toBe("4");
  });

  it("nagłówek z treścią-OBIEKTEM startuje pusty (z podpowiedzią), a nie z „[object Object]”", () => {
    // `String({ pl: "Tytuł" })` szło do TipTapa jako treść nagłówka, a pierwsze
    // naciśnięcie klawisza utrwalało „[object Object]" w dokumencie.
    const { container, changes } = renderEditor(
      HeadingBlock,
      block("heading", { level: 2, text: { pl: "Tytuł" } }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    expect(container.querySelector('[contenteditable="true"]')?.textContent).toBe("");
    expect(changes).toEqual([]);
  });

  it('odstęp z wysokością „wysoko" pokazuje domyślne 40 px - etykieta i suwak zgodnie', () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): `Number("wysoko")` = `NaN` szło
    // i do `style={{ height }}` (podgląd bez wysokości), i do etykiety obok
    // suwaka („NaNpx"), a suwak stał w pozycji domyślnej przeglądarki - dwie
    // różne wartości tego samego pola naraz.
    const { container } = renderEditor(SpacerBlock, block("spacer", { height: "wysoko" }));
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).toContain("40px");
    expect(screen.getByRole<HTMLInputElement>("slider").value).toBe("40");
  });

  it('odstęp z wysokością „33,5" (przecinek) pokazuje domyślne 40 px, jak strona', () => {
    // Render publiczny czyta napis przez `Number()` (`num` z `renderer/data.ts`),
    // więc „33,5" to dla niego NIE liczba i rysuje domyślne 40 px. Panel czyta
    // tą samą funkcją - pokazanie 33,5 px obiecywałoby odstęp, którego nie ma.
    const { container } = renderEditor(SpacerBlock, block("spacer", { height: "33,5" }));
    expect(container.textContent).toContain("40px");
    expect(screen.getByRole<HTMLInputElement>("slider").value).toBe("40");
  });

  it("odstęp spoza zakresu suwaka pokazuje najbliższy kraniec, a nie liczbę spoza suwaka", () => {
    const duzy = renderEditor(SpacerBlock, block("spacer", { height: 5000 }));
    expect(duzy.container.textContent).toContain("400px");
    duzy.unmount();
    const ujemny = renderEditor(SpacerBlock, block("spacer", { height: -20 }));
    expect(ujemny.container.textContent).toContain("8px");
  });

  it('pasek postępu z wartością „nic" pokazuje 0% - tyle narysuje strona', () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): `Number("nic")` = `NaN` lądowało
    // w etykiecie procentowej obok suwaka („NaN%"), a suwak z `min={0}
    // max={100}` pokazywał 50 - dwie różne wartości tego samego pola.
    // Render publiczny czyta tę wartość jako 0 (`num(..., 0)`).
    const { container } = renderEditor(ProgressBlock, block("progress", { value: "nic" }));
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).toContain("0%");
    expect(screen.getByRole<HTMLInputElement>("slider").value).toBe("0");
  });

  it("pasek postępu 250 pokazuje 100% - etykieta nie wychodzi poza suwak", () => {
    // `ProgressView` ścina do 0-100, więc „250%" obok suwaka na 100 mówiło
    // redaktorowi co innego niż strona.
    const { container } = renderEditor(ProgressBlock, block("progress", { value: 250 }));
    expect(container.textContent).toContain("100%");
    expect(container.textContent).not.toContain("250%");
  });

  it('wykres z wysokością „wysoko" pokazuje domyślne 320 px, które narysuje parser', () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): parser (`parseChartConfig`) ma
    // dla wysokości pełne klamrowanie, więc czytelnik widział 320 px, a panel
    // - „NaNpx". Forma czyta teraz wysokość z tego samego parsera.
    const { container } = renderEditor(ChartBlock, block("chart", { height: "wysoko" }));
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).toContain(`${CHART_HEIGHT_DEFAULT}px`);
  });

  it("wykres z wysokością 99 999 pokazuje 640 px - najwyżej tyle narysuje strona", () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): etykieta czytała `block.data.height`
    // SUROWO, a render publiczny ścina do `CHART_HEIGHT_MAX` - panel podawał
    // liczbę, której strona nigdy nie użyje, choć podgląd nad formą jest
    // „dokładnie tym samym renderem, który trafi na stronę publiczną".
    const { container } = renderEditor(ChartBlock, block("chart", { height: 99999 }));
    expect(container.textContent).not.toContain("99999px");
    expect(container.textContent).toContain(`${CHART_HEIGHT_MAX}px`);
    expect(screen.getByRole<HTMLInputElement>("slider", { name: "Wysokość wykresu" }).value).toBe(
      String(CHART_HEIGHT_MAX),
    );
  });

  it("obraz z podpisem jako OBIEKT pokazuje PUSTE pole podpisu, a nie „[object Object]”", () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): `String({ pl: "Podpis" })` - kształt
    // po migracji treści dwujęzycznej - wchodził jako WARTOŚĆ pola podpisu.
    // Strona publiczna takiego podpisu nie pokazuje (`str(..., "caption")`),
    // więc puste pole mówi redaktorowi prawdę o tym, co zobaczy czytelnik.
    renderEditor(
      ImageBlock,
      block("image", { url: "https://cdn.example.com/a.png", caption: { pl: "Podpis" } }),
    );
    const pole = screen.getByPlaceholderText<HTMLInputElement>("Podpis (opcjonalnie)…");
    expect(pole.value).toBe("");
    const wartosci = screen.getAllByRole<HTMLInputElement>("textbox").map((el) => el.value);
    expect(wartosci.join("|")).not.toContain("[object Object]");
  });

  it("lista z pozycją-OBIEKTEM pokazuje tylko pozycje tekstowe, jak strona publiczna", () => {
    // NAPRAWIONE 2026-10-18 (był `it.fails`): `items as string[]` było
    // rzutowaniem, nie strażnikiem - obiekt szedł do `InlineHtmlEditable`
    // i renderował się jako „[object Object]". Teraz edytor czyta pozycje jak
    // `strList` w renderze publicznym: wyłącznie napisy.
    const { container } = renderEditor(
      ListBlockEdit,
      block("list", { items: [{ text: "Punkt" }, "Drugi"] }),
    );
    expect(container.textContent).not.toContain("[object Object]");
    const pozycje = container.querySelectorAll('[data-field="list-item"]');
    expect(Array.from(pozycje, (el) => el.textContent)).toEqual(["Drugi"]);
  });

  it("lista bez ŻADNEJ pozycji tekstowej daje jedną pustą pozycję do pisania", () => {
    // Bez tego lista z samymi obiektami (albo `items: []`) renderowała się
    // bez pozycji - redaktor nie miał gdzie postawić kursora.
    const { container } = renderEditor(ListBlockEdit, block("list", { items: [{ text: "x" }, 7] }));
    expect(container.querySelectorAll('[data-field="list-item"]')).toHaveLength(1);
  });
});

describe("zapis po koercji - do dokumentu trafia to, co wpisał redaktor", () => {
  it("wpis w puste pole podpisu-obiektu zapisuje NAPIS redaktora, bez „[object Object]”", () => {
    // NAPRAWIONE 2026-10-18. Do tej daty ten test opisywał STAN FAKTYCZNY:
    // pole pokazywało „[object Object]", a dopisany znak utrwalał w dokumencie
    // podpis „[object Object]x". Teraz pole startuje puste, a zapis niesie
    // dokładnie wpis redaktora - z tym samym `id` i typem bloku.
    const { changes } = renderEditor(
      ImageBlock,
      block("image", { url: "https://cdn.example.com/a.png", caption: { pl: "Podpis" } }),
    );
    fireEvent.change(screen.getByPlaceholderText("Podpis (opcjonalnie)…"), {
      target: { value: "Nowy podpis" },
    });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: "blk-image", type: "image" });
    expect(changes[0].data.caption).toBe("Nowy podpis");
    expect(changes[0].data.url).toBe("https://cdn.example.com/a.png");
  });

  it("edycja pozycji listy obok obiektu zapisuje SAME napisy, z poziomem tej pozycji", () => {
    // Poziomy (`levels`) są indeksowane pozycjami TEKSTOWYMI - tak samo liczy
    // je render publiczny, więc wcięcie zostaje przy punkcie, który je miał.
    const { container, changes } = renderEditor(
      ListBlockEdit,
      block("list", { items: [{ text: "Punkt" }, "Pierwszy", "Drugi"], levels: [1, 2] }),
    );
    const [, druga] = Array.from(
      container.querySelectorAll<HTMLElement>('[data-field="list-item"]'),
    );
    druga.innerHTML = "Drugi poprawiony";
    fireEvent.input(druga);
    const zapis = changes.at(-1);
    expect(zapis?.data.items).toEqual(["Pierwszy", "Drugi poprawiony"]);
    expect(zapis?.data.levels).toEqual([1, 2]);
  });
});

describe("wykres - NUMER kategorii wobec INDEKSU", () => {
  // Etykieta pola mówi „Prognoza od kategorii numer", a ludzie liczą kategorie
  // od jednej. Silnik trzyma tę samą wartość jako indeks liczony od zera
  // (`forecastFrom` wchodzi do `i >= forecastFrom` i do
  // `catCenter(forecastFrom)`). Bez przeliczenia w polu redaktor wpisujący 2
  // dostawał prognozę od TRZECIEJ kategorii - cicho i na każdym wykresie.
  const wykres = (data: Record<string, Json>): Block =>
    block("chart", {
      categories: ["2021", "2022", "2023", "2024"],
      series: [{ name: "S", values: [1, 2, 3, 4], colorSlot: 1 }],
      ...data,
    });

  const poleProgozy = (container: HTMLElement): HTMLInputElement => {
    const pole = container.querySelector<HTMLInputElement>(
      'input[placeholder="Prognoza od kategorii numer"]',
    );
    if (!pole) throw new Error("brak pola prognozy w edytorze wykresu");
    return pole;
  };

  it("wpisany NUMER 3 zapisuje się jako indeks 2", () => {
    const { container, changes } = renderEditor(ChartBlock, wykres({}));
    fireEvent.change(poleProgozy(container), { target: { value: "3" } });
    expect(changes.at(-1)?.data.forecastFrom).toBe(2);
  });

  it("zapisany indeks 2 wyświetla się jako NUMER 3 - przeliczenie działa w OBIE strony", () => {
    // Jednostronne przeliczenie byłoby gorsze od żadnego: pole pokazywałoby
    // inną kategorię niż ta, od której wykres rysuje prognozę.
    const { container } = renderEditor(ChartBlock, wykres({ forecastFrom: 2 }));
    expect(poleProgozy(container).value).toBe("3");
  });

  it("puste pole znaczy BRAK prognozy, a nie kategorię zerową", () => {
    const { container, changes } = renderEditor(ChartBlock, wykres({ forecastFrom: 2 }));
    fireEvent.change(poleProgozy(container), { target: { value: "" } });
    expect(changes.at(-1)?.data.forecastFrom).toBeNull();
  });

  it("wejście nieliczbowe nie zapisuje NaN - pole wraca do braku", () => {
    // `Number("abc")` to `NaN`, a `NaN` zapisany do treści bloku przechodzi
    // przez JSON jako `null` i wraca jako cichy brak prognozy; lepiej zapisać
    // brak wprost niż wartość, która nią zostanie po drodze.
    const { container, changes } = renderEditor(ChartBlock, wykres({}));
    fireEvent.change(poleProgozy(container), { target: { value: "od drugiej" } });
    expect(changes.at(-1)?.data.forecastFrom).toBeNull();
  });
});
