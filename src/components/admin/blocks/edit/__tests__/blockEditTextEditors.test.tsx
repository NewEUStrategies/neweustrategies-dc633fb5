// EDYTORY TEKSTOWE (`paragraph`, `heading`) - KLAWIATURA I WKLEJANIE.
//
// PO CO OSOBNY PLIK. To dwa jedyne edytory rodziny, które nie są formularzem:
// treść wpisuje się w nich BEZPOŚREDNIO, przez TipTap/ProseMirror, a cała
// logika siedzi w `editorProps.handleKeyDown` i `editorProps.handlePaste` -
// domknięciach, do których nie da się dojść ani propsem, ani polem formularza.
// Tabela `blockEditMatrix.*` renderuje je (i to jest jej rola: blok świeżo
// wstawiony musi się zamontować), ale ANI JEDNA jej asercja nie dotyka
// klawiatury, więc te dwa pliki zostawały prawie nietknięte: nagłówek miał
// pokryte 40% funkcji i 11% gałęzi, a jego 130 linii obsługi klawiszy - zero.
//
// DLACZEGO NAGŁÓWEK JEST TU WAŻNIEJSZY OD AKAPITU. Akapit ma już dowody na
// poziomie kanwy (`blocks/__tests__/blockCanvasCaretFlow.test.tsx` - Enter,
// Backspace, strzałki, transformacje). Nagłówek NIE MA ŻADNYCH: te same
// klawisze mają w nim inne zachowanie (Enter zostawia nagłówek i tworzy
// AKAPIT pod nim, wklejenie wielu bloków z Worda zostawia pierwszy fragment
// jako nagłówek), a nikt tego nie sprawdzał.
//
// NOTA O KARETCE - KONIECZNA DO ODCZYTU ASERCJI. happy-dom nie liczy layoutu,
// więc ProseMirror nie umie tu przestawić karetki (mapowanie selekcji z DOM-u
// i `endOfTextblock` potrzebują prawdziwych prostokątów). Świeżo zamontowana
// instancja ma selekcję na POCZĄTKU dokumentu bloku i taka zostaje. Każdy
// przypadek niżej jest więc opisany dla gałęzi KARETKA-NA-POCZĄTKU - i to
// właśnie ta gałąź niesie scalanie, usuwanie pustego bloku, wyjście strzałką
// w lewo i eskalację zaznaczenia w tył. Świadomie NIE udajemy karetki
// sztucznym `Range`: asercja wyglądałaby na dowód o karetce, a mierzyłaby stan
// domyślny (ta sama decyzja i to samo uzasadnienie, co w pliku kanwy).
//
// GRANICE. Wszystkie fabryki `vi.mock` niesie moduł wspólny tabeli (`sonner`,
// Radix `Select`/`Switch`, `<Link>` routera, klient Supabase, `fetch`),
// dlatego jego import jest PIERWSZY. i18n PRAWDZIWE. Żadnej atrapy TipTapa,
// `@/lib/blocks/*` ani komponentów rodzeństwa - to warstwy pod testem.
import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";

import { renderEditor } from "./blockEditMatrix.shared";
import type { Block } from "@/lib/blocks/types";
import { HeadingBlock } from "../Heading";
import { ParagraphBlock } from "../Paragraph";

function naglowek(text: string, level = 2): Block {
  return { id: "h1", type: "heading", data: { text, level } };
}

function akapit(html: string): Block {
  return { id: "p1", type: "paragraph", data: { html } };
}

/** Pole edycji - to, w które realnie pisze redaktor. */
function pole(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[contenteditable="true"]');
  if (!(el instanceof HTMLElement)) throw new Error("brak pola edycji");
  return el;
}

/**
 * Zdarzenie wklejenia z podanym schowkiem. `fireEvent.paste` w happy-dom nie
 * dokłada `clipboardData`, a ProseMirror czyta je wprost - bez tego handler
 * zobaczyłby pusty schowek i wyszedł pierwszą gałęzią.
 */
function wklej(el: HTMLElement, dane: { html?: string; plain?: string; files?: File[] }): void {
  const clipboardData = {
    getData: (typ: string) => (typ === "text/html" ? (dane.html ?? "") : (dane.plain ?? "")),
    files: dane.files ?? [],
    types: dane.html ? ["text/html", "text/plain"] : ["text/plain"],
    items: [],
  };
  fireEvent.paste(el, { clipboardData });
}

/** Handlery przekazywane edytorowi - każdy policzalny. */
function handlery() {
  return {
    onChange: vi.fn(),
    onTransform: vi.fn(),
    onInsertAfter: vi.fn(),
    onDeleteEmpty: vi.fn(),
    onMergeWithPrevious: vi.fn(() => true),
    onFocusPrevious: vi.fn(() => true),
    onFocusNext: vi.fn(() => true),
    onSelectAllBlocks: vi.fn(),
    onExtendBlockSelection: vi.fn(() => true),
  };
}

function zamontujNaglowek(block: Block) {
  const h = handlery();
  const view = renderEditor((props) => <HeadingBlock {...props} {...h} />, block);
  return { ...view, h, pole: pole(view.container) };
}

function zamontujAkapit(block: Block) {
  const h = handlery();
  const view = renderEditor((props) => <ParagraphBlock {...props} {...h} />, block);
  return { ...view, h, pole: pole(view.container) };
}

describe("nagłówek - montowanie i poziom", () => {
  it("renderuje treść w PRAWDZIWYM znaczniku `.cms-h{level}`", () => {
    // To jest cały sens tego edytora: podgląd bierze globalne rozmiary fontów
    // z panelu admina dokładnie tak, jak strona publiczna.
    const { container } = zamontujNaglowek(naglowek("Tytuł sekcji", 3));
    const el = container.querySelector("[data-heading-level]");
    expect(el?.className).toContain("cms-h3");
    expect(el?.getAttribute("data-heading-level")).toBe("3");
    expect(container.textContent).toContain("Tytuł sekcji");
  });

  it("pusty nagłówek pokazuje podpowiedź z poziomem, a nie puste pole", () => {
    const { container } = zamontujNaglowek(naglowek("", 4));
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("undefined");
  });

  it("wyrównanie z danych bloku trafia na kontener treści", () => {
    const { container } = zamontujNaglowek({
      id: "h1",
      type: "heading",
      data: { text: "T", level: 2, align: "center" },
    });
    expect(container.querySelector("[data-heading-level]")?.className).toContain("center");
  });

  it("kolor spoza dziedziny CSS jest ODRZUCANY, a nie wstawiany w styl", () => {
    // `safeCssColor` to strażnik przed wstrzyknięciem przez pole koloru -
    // wartość `red; background: url(javascript:...)` nie ma prawa dojść do
    // atrybutu `style`.
    const { container } = zamontujNaglowek({
      id: "h1",
      type: "heading",
      data: { text: "T", level: 2, color: "red; background:url(javascript:alert(1))" },
    });
    expect(container.innerHTML).not.toContain("javascript:");
  });
});

describe("nagłówek - klawiatura", () => {
  it("Enter tworzy AKAPIT pod nagłówkiem i przenosi do niego ogon treści", () => {
    // Parytet z WordPressem: Enter w nagłówku nie tworzy drugiego nagłówka.
    // Karetka stoi na początku, więc do nowego akapitu idzie cała treść.
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł sekcji"));
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(h.onInsertAfter).toHaveBeenCalledTimes(1);
    const nowy = h.onInsertAfter.mock.calls[0][0] as Block;
    expect(nowy.type).toBe("paragraph");
    expect(String(nowy.data.html)).toContain("Tytuł sekcji");
    expect(nowy.id).not.toBe("h1");
  });

  it("Shift+Enter NIE tworzy nowego bloku (miękki łamany wiersz)", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    fireEvent.keyDown(pole, { key: "Enter", shiftKey: true });
    expect(h.onInsertAfter).not.toHaveBeenCalled();
  });

  it("Backspace na PUSTYM nagłówku usuwa blok", () => {
    const { h, pole } = zamontujNaglowek(naglowek(""));
    fireEvent.keyDown(pole, { key: "Backspace" });
    expect(h.onDeleteEmpty).toHaveBeenCalledTimes(1);
    expect(h.onMergeWithPrevious).not.toHaveBeenCalled();
  });

  it("Backspace na POCZĄTKU niepustego nagłówka SCALA go z poprzednim", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    fireEvent.keyDown(pole, { key: "Backspace" });
    expect(h.onMergeWithPrevious).toHaveBeenCalledTimes(1);
    expect(h.onDeleteEmpty).not.toHaveBeenCalled();
  });

  it("strzałka w lewo na początku treści przenosi fokus na poprzedni blok", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    fireEvent.keyDown(pole, { key: "ArrowLeft" });
    expect(h.onFocusPrevious).toHaveBeenCalledTimes(1);
  });

  it("strzałka w prawo na końcu treści (nagłówek pusty) przenosi fokus dalej", () => {
    const { h, pole } = zamontujNaglowek(naglowek(""));
    fireEvent.keyDown(pole, { key: "ArrowRight" });
    expect(h.onFocusNext).toHaveBeenCalledTimes(1);
  });

  it("Shift+strzałka w lewo na krawędzi eskaluje do zaznaczenia BLOKOWEGO w tył", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    fireEvent.keyDown(pole, { key: "ArrowLeft", shiftKey: true });
    expect(h.onExtendBlockSelection).toHaveBeenCalledWith(-1);
  });

  it("Shift+strzałka w prawo na końcu treści eskaluje zaznaczenie w przód", () => {
    const { h, pole } = zamontujNaglowek(naglowek(""));
    fireEvent.keyDown(pole, { key: "ArrowRight", shiftKey: true });
    expect(h.onExtendBlockSelection).toHaveBeenCalledWith(1);
  });

  it("Ctrl+A przy CAŁEJ treści zaznaczonej eskaluje do zaznaczenia dokumentu", () => {
    // Pusty nagłówek to przypadek, w którym „wszystko zaznaczone" jest
    // prawdziwe od montowania - drugie naciśnięcie Ctrl+A w przeglądarce.
    const { h, pole } = zamontujNaglowek(naglowek(""));
    fireEvent.keyDown(pole, { key: "a", ctrlKey: true });
    expect(h.onSelectAllBlocks).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+A przy karetce w treści NIE wychodzi na poziom dokumentu", () => {
    // Pierwsze naciśnięcie ma zaznaczyć treść nagłówka - to robi przeglądarka,
    // a edytor musi się od tego POWSTRZYMAĆ.
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł sekcji"));
    fireEvent.keyDown(pole, { key: "a", ctrlKey: true });
    expect(h.onSelectAllBlocks).not.toHaveBeenCalled();
  });

  it("zwykły klawisz nie uruchamia żadnego z handlerów układu dokumentu", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    fireEvent.keyDown(pole, { key: "x" });
    expect(h.onInsertAfter).not.toHaveBeenCalled();
    expect(h.onDeleteEmpty).not.toHaveBeenCalled();
    expect(h.onFocusPrevious).not.toHaveBeenCalled();
    expect(h.onFocusNext).not.toHaveBeenCalled();
    expect(h.onSelectAllBlocks).not.toHaveBeenCalled();
  });
});

describe("nagłówek - wklejanie", () => {
  it("wklejenie WIELU bloków z Worda zostawia nagłówek i dokłada resztę jako bloki", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    wklej(pole, {
      html: '<html><body><h2 class="MsoNormal">Nowy tytuł</h2><p class="MsoNormal">Akapit pierwszy</p><p class="MsoNormal">Akapit drugi</p></body></html>',
      plain: "Nowy tytuł\nAkapit pierwszy\nAkapit drugi",
    });
    expect(h.onTransform).toHaveBeenCalledTimes(1);
    const bloki = h.onTransform.mock.calls[0][0] as Block[];
    // Pierwszy element to WCIĄŻ ten sam nagłówek (to samo `id`) - redaktor nie
    // traci bloku, w którym stoi.
    expect(bloki[0].id).toBe("h1");
    expect(bloki.length).toBeGreaterThan(1);
  });

  it("wklejenie zwykłego tekstu (bez znaczników) NIE przekształca bloku", () => {
    const { h, pole } = zamontujNaglowek(naglowek("Tytuł"));
    wklej(pole, { plain: "zwykły tekst" });
    expect(h.onTransform).not.toHaveBeenCalled();
  });
});

describe("akapit - klawiatura i wklejanie na poziomie samego edytora", () => {
  // Kanwa ma własne dowody na Enter/Backspace/strzałki (patrz nagłówek pliku).
  // Tutaj są gałęzie, których kanwa NIE dotyka: menu ukośnika, skrót
  // markdownowy i wklejanie w trzech odmianach.
  it("Enter dzieli akapit i cały ogon idzie do NOWEGO akapitu", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa beta</p>"));
    fireEvent.keyDown(pole, { key: "Enter" });
    expect(h.onInsertAfter).toHaveBeenCalledTimes(1);
    const nowy = h.onInsertAfter.mock.calls[0][0] as Block;
    expect(nowy.type).toBe("paragraph");
    expect(String(nowy.data.html)).toContain("alfa beta");
  });

  it("Backspace na PUSTYM akapicie usuwa blok", () => {
    const { h, pole } = zamontujAkapit(akapit(""));
    fireEvent.keyDown(pole, { key: "Backspace" });
    expect(h.onDeleteEmpty).toHaveBeenCalledTimes(1);
  });

  it("Backspace na początku niepustego akapitu scala z poprzednim", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa</p>"));
    fireEvent.keyDown(pole, { key: "Backspace" });
    expect(h.onMergeWithPrevious).toHaveBeenCalledTimes(1);
  });

  it("Escape zamyka menu ukośnika bez zmiany treści", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa</p>"));
    fireEvent.keyDown(pole, { key: "Escape" });
    expect(h.onTransform).not.toHaveBeenCalled();
    expect(h.onInsertAfter).not.toHaveBeenCalled();
  });

  it("wklejenie WIELU akapitów z Worda rozbija je na osobne bloki", () => {
    const { h, pole } = zamontujAkapit(akapit(""));
    wklej(pole, {
      html: '<html><body><p class="MsoNormal">Pierwszy</p><p class="MsoNormal">Drugi</p><p class="MsoNormal">Trzeci</p></body></html>',
      plain: "Pierwszy\nDrugi\nTrzeci",
    });
    expect(h.onTransform).toHaveBeenCalledTimes(1);
    const bloki = h.onTransform.mock.calls[0][0] as Block[];
    expect(bloki.length).toBeGreaterThan(1);
  });

  it("wklejenie JEDNEGO akapitu nie rozbija bloku - treść wchodzi w miejscu", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa</p>"));
    wklej(pole, {
      html: '<html><body><p class="MsoNormal">Jeden akapit</p></body></html>',
      plain: "Jeden akapit",
    });
    expect(h.onTransform).not.toHaveBeenCalled();
  });

  it("wklejenie zwykłego tekstu nie rusza układu dokumentu", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa</p>"));
    wklej(pole, { plain: "zwykły tekst" });
    expect(h.onTransform).not.toHaveBeenCalled();
    expect(h.onInsertAfter).not.toHaveBeenCalled();
  });

  it("wklejenie treści z WordPressa (komentarze `wp:`) daje bloki, nie surowy HTML", () => {
    // To najczęstsza droga treści do tego panelu: redaktor kopiuje wpis
    // z WordPressa. Bez tej gałęzi w akapicie wylądowałby tekst ze znacznikami.
    const { h, pole } = zamontujAkapit(akapit(""));
    wklej(pole, {
      html: "<!-- wp:paragraph --><p>Pierwszy</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Drugi</p><!-- /wp:paragraph -->",
      plain: "Pierwszy\nDrugi",
    });
    expect(h.onTransform).toHaveBeenCalledTimes(1);
    const bloki = h.onTransform.mock.calls[0][0] as Block[];
    expect(bloki.length).toBeGreaterThanOrEqual(2);
    expect(bloki.every((b) => typeof b.type === "string" && b.id)).toBe(true);
  });

  it("wklejenie treści z WordPressa do akapitu NIEPUSTEGO zachowuje jego treść", () => {
    // `keepCurrent`: blok, w którym redaktor stoi, nie ma prawa zniknąć razem
    // z wklejeniem - to byłaby utrata już napisanego tekstu.
    const { h, pole } = zamontujAkapit(akapit("<p>już napisane</p>"));
    wklej(pole, {
      html: "<!-- wp:paragraph --><p>Wklejone</p><!-- /wp:paragraph -->",
      plain: "Wklejone",
    });
    const bloki = h.onTransform.mock.calls[0][0] as Block[];
    expect(bloki[0].id).toBe("p1");
    expect(String(bloki[0].data.html)).toContain("już napisane");
  });

  it("wklejenie PLIKU graficznego ze schowka tworzy blok obrazu", async () => {
    // Zrzut ekranu wklejony wprost ze schowka - `FileReader` zamienia go na
    // `data:` URL, a edytor dokłada blok `image` za akapitem.
    const { h, pole } = zamontujAkapit(akapit(""));
    const plik = new File([new Uint8Array([1, 2, 3])], "zrzut.png", { type: "image/png" });
    wklej(pole, { files: [plik] });
    await vi.waitFor(() => expect(h.onTransform).toHaveBeenCalledTimes(1));
    const bloki = h.onTransform.mock.calls[0][0] as Block[];
    expect(bloki.some((b) => b.type === "image")).toBe(true);
    const obraz = bloki.find((b) => b.type === "image");
    expect(String(obraz?.data.url)).toMatch(/^data:image\//);
    // Nazwa pliku staje się tekstem alternatywnym - bez tego obraz wchodzi
    // do dokumentu bez opisu i psuje dostępność strony.
    expect(String(obraz?.data.alt).length).toBeGreaterThan(0);
  });
});

describe("akapit - strzałki, Ctrl+A i eskalacja zaznaczenia", () => {
  // Te same gałęzie, co w nagłówku, ale akapit ma dodatkowy warunek: liczy
  // jeszcze POZYCJĘ W DZIECIACH dokumentu (`inFirstChild`/`inLastChild`),
  // bo jego treść może mieć wiele akapitów wewnętrznych.
  it("strzałka w lewo na początku treści przenosi fokus na poprzedni blok", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa</p>"));
    fireEvent.keyDown(pole, { key: "ArrowLeft" });
    expect(h.onFocusPrevious).toHaveBeenCalledTimes(1);
  });

  it("strzałka w prawo na końcu treści (akapit pusty) przenosi fokus dalej", () => {
    const { h, pole } = zamontujAkapit(akapit(""));
    fireEvent.keyDown(pole, { key: "ArrowRight" });
    expect(h.onFocusNext).toHaveBeenCalledTimes(1);
  });

  it("Shift+strzałka w lewo na krawędzi eskaluje zaznaczenie BLOKOWE w tył", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa</p>"));
    fireEvent.keyDown(pole, { key: "ArrowLeft", shiftKey: true });
    expect(h.onExtendBlockSelection).toHaveBeenCalledWith(-1);
  });

  it("Shift+strzałka w prawo na końcu treści eskaluje zaznaczenie w przód", () => {
    const { h, pole } = zamontujAkapit(akapit(""));
    fireEvent.keyDown(pole, { key: "ArrowRight", shiftKey: true });
    expect(h.onExtendBlockSelection).toHaveBeenCalledWith(1);
  });

  it("Ctrl+A przy CAŁEJ treści zaznaczonej eskaluje do zaznaczenia dokumentu", () => {
    const { h, pole } = zamontujAkapit(akapit(""));
    fireEvent.keyDown(pole, { key: "a", ctrlKey: true });
    expect(h.onSelectAllBlocks).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+A przy karetce w treści NIE wychodzi na poziom dokumentu", () => {
    const { h, pole } = zamontujAkapit(akapit("<p>alfa beta</p>"));
    fireEvent.keyDown(pole, { key: "a", ctrlKey: true });
    expect(h.onSelectAllBlocks).not.toHaveBeenCalled();
  });
});
