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
//  * klamrowanie NIE DZIAŁA dla wejść, które nie są liczbami - i to jest
//    zarejestrowany defekt (`it.fails` niżej): `Math.min(Math.max(Number(x),1),5)`
//    zwraca `NaN` dla każdego `x`, którego `Number()` nie umie przeczytać,
//    bo `Math.max(NaN, 1)` to `NaN`. To NIE jest teoretyczne: import WordPressa
//    zapisuje poziom nagłówka jako `"h2"`, a nie `2`,
//  * `String(x ?? "")` przepuszcza obiekt do pola formularza jako literalne
//    `[object Object]` - idiom powtórzony w ~55 plikach rodziny.
//
// DLACZEGO `it.fails`, A NIE POPRAWKA. Każda z tych naprawek to ZMIANA KODU
// PRODUKCYJNEGO (dodanie `Number.isFinite`, wymiana `String()` na strażnika
// typu), a tej gałęzi tego nie wolno. Zgodnie z regułą repozytorium defekt
// zostaje ZAREJESTROWANY jako `it.fails` z opisem wejścia i skutku - każdy
// z poniższych był najpierw uruchomiony jako zwykły `it` i potwierdzony, że
// pada NA ASERCJI DOCELOWEJ, a nie po drodze na błędzie przygotowania.
//
// GRANICE. Mockowane tylko: Radix `Select`/`Switch` (biblioteka, nie nasz kod -
// pod happy-dom nie rozwija listy), `sonner`, `<Link>` routera, klient
// Supabase i `fetch`. Wszystkie fabryki `vi.mock` niesie moduł wspólny tabeli,
// dlatego jego import jest PIERWSZY. i18n jest PRAWDZIWE.
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block, BlockType, Json } from "@/lib/blocks/types";
import { CHART_HEIGHT_MAX } from "@/lib/charts/parse";
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

describe("koercja niepoprawnych wartości - ZAREJESTROWANE DEFEKTY", () => {
  it.fails(
    'DEFEKT: nagłówek z poziomem „h2" (kształt z importu WordPressa) daje klasę cms-hNaN',
    () => {
      // WEJŚCIE: `block.data.level = "h2"`.
      // CO PSUJE: `Math.min(Math.max(Number("h2"), 1), 5)` = `NaN`, bo
      // `Math.max(NaN, 1)` to `NaN` - klamra nie klamruje. Nagłówek dostaje
      // `className="cms-hNaN"` (klasy o tej nazwie NIE MA w arkuszu, więc
      // podgląd traci rozmiar fontu i wygląda jak akapit) oraz
      // `data-heading-level="NaN"` - a to jest atrybut, z którego pasek
      // narzędzi nagłówka czyta bieżący poziom.
      const { container } = renderEditor(
        HeadingBlock,
        block("heading", { level: "h2", text: "T" }),
      );
      const el = container.querySelector("[data-heading-level]");
      const poziom = Number(el?.getAttribute("data-heading-level"));
      expect(Number.isFinite(poziom)).toBe(true);
      expect(poziom).toBeGreaterThanOrEqual(1);
      expect(poziom).toBeLessThanOrEqual(5);
      expect(el?.className).not.toContain("cms-hNaN");
    },
  );

  it.fails('DEFEKT: odstęp z wysokością „wysoko" pokazuje redaktorowi „NaNpx"', () => {
    // WEJŚCIE: `block.data.height = "wysoko"`.
    // CO PSUJE: `Number("wysoko")` = `NaN` idzie i do `style={{ height }}`
    // (element podglądu traci wysokość), i do etykiety obok suwaka - redaktor
    // widzi napis „NaNpx" zamiast liczby, a suwak stoi w pozycji domyślnej
    // przeglądarki, więc pokazuje wartość, której w dokumencie nie ma.
    const { container } = renderEditor(SpacerBlock, block("spacer", { height: "wysoko" }));
    expect(container.textContent).not.toContain("NaN");
  });

  it.fails('DEFEKT: pasek postępu z wartością „nic" pokazuje „NaN%"', () => {
    // WEJŚCIE: `block.data.value = "nic"`.
    // CO PSUJE: `Number("nic")` = `NaN` ląduje w etykiecie procentowej obok
    // suwaka (`{value}%`). Suwak ma `min={0} max={100}`, więc sam pokazuje 50,
    // a etykieta „NaN%" - dwie różne wartości tego samego pola naraz.
    const { container } = renderEditor(ProgressBlock, block("progress", { value: "nic" }));
    expect(container.textContent).not.toContain("NaN");
  });

  it.fails('DEFEKT: wykres z wysokością „wysoko" pokazuje „NaNpx"', () => {
    // WEJŚCIE: `block.data.height = "wysoko"`.
    // CO PSUJE: to samo, co w odstępie, ale skutek jest gorszy - warstwa
    // czytająca (`parseChartConfig`) ma dla wysokości PEŁNE klamrowanie
    // (`Math.max(CHART_HEIGHT_MIN, Math.min(CHART_HEIGHT_MAX, ...))`), więc
    // czytelnik zobaczy 320 px, a redaktor w panelu - „NaNpx".
    const { container } = renderEditor(ChartBlock, block("chart", { height: "wysoko" }));
    expect(container.textContent).not.toContain("NaN");
  });

  it.fails("DEFEKT: wykres pokazuje wysokość 99 999 px, choć strona narysuje najwyżej 640", () => {
    // WEJŚCIE: `block.data.height = 99999`.
    // CO PSUJE: etykieta obok suwaka czyta `block.data.height` SUROWO
    // (`Number(block.data.height ?? 320)`), a publiczny render przechodzi
    // przez `parseChartConfig`, które ścina do `CHART_HEIGHT_MAX`. Panel
    // podaje więc redaktorowi liczbę, której strona nigdy nie użyje -
    // a podgląd nad formą jest reklamowany jako „dokładnie ten sam render,
    // który trafi na stronę publiczną" (komentarz w `DataVizBlocks.tsx`).
    const { container } = renderEditor(ChartBlock, block("chart", { height: 99999 }));
    expect(container.textContent).not.toContain("99999px");
    expect(container.textContent).toContain(`${CHART_HEIGHT_MAX}px`);
  });

  it.fails('DEFEKT: obraz z podpisem jako OBIEKT wpisuje w pole „[object Object]"', () => {
    // WEJŚCIE: `block.data.caption = { pl: "Podpis" }` - dokładnie ten kształt
    // zostaje po migracji treści dwujęzycznej, która przeniosła podpisy do
    // obiektu per język.
    // CO PSUJE: `String(block.data.caption ?? "")` daje literalne
    // `[object Object]`, które wchodzi jako WARTOŚĆ pola tekstowego. Redaktor
    // nie widzi, że podpis istnieje - widzi śmieć; a gdy dopisze do niego
    // choćby znak, `onChange` utrwali ten śmieć w dokumencie jako podpis.
    const { container } = renderEditor(
      ImageBlock,
      block("image", { url: "https://cdn.example.com/a.png", caption: { pl: "Podpis" } }),
    );
    const wartosci = Array.from(
      container.querySelectorAll<HTMLInputElement>("input, textarea"),
    ).map((el) => el.value);
    expect(wartosci.join("|")).not.toContain("[object Object]");
  });

  it.fails(
    'DEFEKT: lista z pozycjami jako OBIEKTY renderuje „[object Object]" jako pozycję',
    () => {
      // WEJŚCIE: `block.data.items = [{ text: "Punkt" }]`.
      // CO PSUJE: `ListBlockEdit` robi `block.data.items as string[]` - RZUTOWANIE,
      // nie strażnik typu. TypeScript przestaje pilnować, a `InlineHtmlEditable`
      // dostaje obiekt i renderuje `[object Object]`. Kolejna edycja tej pozycji
      // zapisuje ten napis jako treść punktu, więc utrata treści jest trwała.
      const { container } = renderEditor(
        ListBlockEdit,
        block("list", { items: [{ text: "Punkt" }, "Drugi"] }),
      );
      expect(container.textContent).not.toContain("[object Object]");
    },
  );
});

describe("skutek defektu jest UTRWALANY - dowód na zapisie", () => {
  it('dopisanie znaku do zepsutego podpisu obrazu zapisuje „[object Object]" w dokumencie', () => {
    // To NIE `it.fails` - ten test opisuje STAN FAKTYCZNY i ma pilnować, że
    // skutek nie pogorszy się dalej. Pokazuje, dlaczego defekt wyżej nie jest
    // kosmetyczny: śmieć z pola JEST tym, co trafia do `onChange`.
    const { changes } = renderEditor(
      ImageBlock,
      block("image", { url: "https://cdn.example.com/a.png", caption: { pl: "Podpis" } }),
    );
    const pole = screen
      .getAllByRole("textbox")
      .find((el) => (el as HTMLInputElement).value.includes("[object Object]"));
    expect(pole, "pole z uszkodzonym podpisem musi istnieć - inaczej defekt zniknął").toBeDefined();
    fireEvent.change(pole as HTMLElement, { target: { value: "[object Object]x" } });
    expect(changes).toHaveLength(1);
    expect(String(changes[0].data.caption)).toBe("[object Object]x");
  });
});
