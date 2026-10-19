// DYSPOZYTOR EDYTORÓW (`BlockEditRenderer`) I JEGO OPAKOWANIE (`BlockWithToolbar`).
//
// PO CO. Dyspozytor to `switch` po `block.type`, przez który przechodzi KAŻDY
// blok kanwy - top-level (`BlockCanvas`) i zagnieżdżony (`NestedBlocksEditor`).
// Do tej pory jego `case`-y były „sprawdzane" wyłącznie czytaniem źródła
// (`blockEditContracts`, `blockEditorRegistryParity`), a samo wywołanie
// dyspozytora wykonywało się w testach dla kilku typów. Pomyłka w `case`
// (zły komponent, zgubiony prop) przechodziła więc niezauważona.
//
// CO MA TU DOWÓD
//   * TYP -> TEN EDYTOR. Dla każdego wpisu tabeli `ALL_EDITORS` dyspozytor,
//     dostając blok prosto z palety (`BLOCK_SPECS[typ].create()`), montuje
//     dokładnie ten edytor, który tabela przypisuje typowi: ta sama
//     powierzchnia dostępna (role, nazwy, podpowiedzi pól, napisy przycisków)
//     co przy montażu edytora wprost. Kontenery `row`/`stack`/`grid` dostają
//     edytor grupy,
//   * dyspozytor nie zapisuje niczego na samym montażu,
//   * PRZEKAZANIE PROPSÓW: `isActive` dociera do edytorów z własnym paskiem
//     (akapit, nagłówek, obraz, wideo, audio), a pełny zestaw handlerów
//     klawiatury - do akapitu i nagłówka. Zgubiony handler nie wywraca
//     niczego: klawisz po prostu przestaje działać, więc tylko ten dowód go
//     wyłapie,
//   * `BlockWithToolbar`: pasek generyczny pojawia się WYŁĄCZNIE nad aktywnym
//     blokiem bez własnego paska i nigdy nie dubluje paska akapitu, nagłówka
//     ani mediów; jego zapisy zachowują `id` i `type` bloku.
//
// GRANICE. Fabryki `vi.mock` (sonner, Radix Select/Switch, `<Link>` routera,
// klient Supabase, kontekst najemcy, `fetch`) niesie moduł wspólny tabeli
// edytorów - dlatego jego import jest PIERWSZY. i18n prawdziwe.
import { ALL_EDITORS, type BlockEditor } from "../edit/__tests__/blockEditMatrix.shared";

import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { BLOCK_SPECS } from "@/lib/blocks/registry";
import type { Block, BlockType } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";
import { GroupBlock } from "../edit/Group";
import { BlockEditRenderer, BlockWithToolbar } from "../BlockEditRenderer";
import "@/lib/i18n-admin-blocks";

const t = realT("pl");

beforeEach(() => {
  // Edytory z podglądem na żywo logują ostrzeżenia Reacta na danych z palety
  // (np. wykres bez serii) - to nie jest przedmiotem dowodu dyspozytora.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function handlery() {
  return {
    onChange: vi.fn<(next: Block) => void>(),
    onTransform: vi.fn<(replacement: Block[]) => void>(),
    onInsertAfter: vi.fn<(block: Block) => void>(),
    onDeleteEmpty: vi.fn<() => void>(),
    onMergeWithPrevious: vi.fn(() => true),
    onFocusPrevious: vi.fn(() => true),
    onFocusNext: vi.fn(() => true),
    onSelectAllBlocks: vi.fn<() => void>(),
    onExtendBlockSelection: vi.fn((_dir: -1 | 1) => true),
  };
}

function zamontuj(block: Block, isActive = true) {
  const h = handlery();
  const view = renderWithQueryClient(
    <BlockEditRenderer block={block} isActive={isActive} {...h} />,
  );
  return { ...view, ...h };
}

function zamontujWprost(Editor: BlockEditor, block: Block) {
  const h = handlery();
  return renderWithQueryClient(<Editor block={block} isActive {...h} />);
}

/** Blok dokładnie taki, jaki wstawia paleta - z identyfikatorem ustalonym dla porównań. */
function zPalety(type: BlockType): Block {
  return { ...BLOCK_SPECS[type].create(), id: `blk-${type}` };
}

const OPIS = ["role", "aria-label", "placeholder", "type", "title", "name"] as const;

/** Identyfikatory z `useId` (`_r_1r_`) różnią się między dwoma montażami - neutralizujemy je. */
const USE_ID_RE = /_r_[0-9a-z]+_/g;

/**
 * Powierzchnia dostępna edytora: każdy element sterujący z jego rolą, nazwą,
 * podpowiedzią i napisem. Atrybut `id` pomijamy w ogóle, a fragmenty z `useId`
 * wewnątrz innych atrybutów (np. `name` grupy radiowej) zastępujemy znacznikiem.
 */
function powierzchnia(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll("input, textarea, select, button, [contenteditable], [role]"),
  ).map((el) =>
    [
      el.tagName.toLowerCase(),
      ...OPIS.map((atrybut) => (el.getAttribute(atrybut) ?? "").replace(USE_ID_RE, "<id>")),
      el.tagName === "BUTTON" ? (el.textContent ?? "").trim() : "",
    ].join("|"),
  );
}

describe("BlockEditRenderer - typ bloku wybiera TEN edytor, który przypisuje mu tabela", () => {
  it.each(ALL_EDITORS)("%s: dyspozytor montuje go dla typu bloku z palety", (_n, Editor, type) => {
    const block = zPalety(type);
    const przezDyspozytor = zamontuj(block);
    const zDyspozytora = {
      powierzchnia: powierzchnia(przezDyspozytor.container),
      tekst: przezDyspozytor.container.textContent ?? "",
    };
    expect(zDyspozytora.tekst).not.toContain(`[${type}]`);
    przezDyspozytor.unmount();

    const wprost = zamontujWprost(Editor, block);
    expect(zDyspozytora.powierzchnia).toEqual(powierzchnia(wprost.container));
    expect(zDyspozytora.tekst).toBe(wprost.container.textContent ?? "");
  });

  it.each(["row", "stack", "grid"] as const)(
    "kontener %s dostaje edytor grupy (zagnieżdżona kanwa)",
    (type) => {
      const block = zPalety(type);
      const przezDyspozytor = zamontuj(block);
      const zDyspozytora = powierzchnia(przezDyspozytor.container);
      przezDyspozytor.unmount();
      expect(zDyspozytora).toEqual(powierzchnia(zamontujWprost(GroupBlock, block).container));
    },
  );

  it.each(ALL_EDITORS)("%s: sam montaż przez dyspozytor nie zapisuje niczego", (_n, _E, type) => {
    const { onChange, onTransform, onInsertAfter } = zamontuj(zPalety(type));
    expect(onChange).not.toHaveBeenCalled();
    expect(onTransform).not.toHaveBeenCalled();
    expect(onInsertAfter).not.toHaveBeenCalled();
  });

  it("podłączony edytor podglądu linku zapisuje wpis z zachowanym id i typem bloku", () => {
    // `link-preview` był jedynym typem rejestru bez `case` (atrapa zamiast
    // edytora). Dowód, że podłączenie przenosi też `onChange`, a nie tylko render.
    const block = zPalety("link-preview");
    const { onChange } = zamontuj(block);
    fireEvent.change(screen.getByPlaceholderText(t("blocks.editors.linkPreview.introPl")), {
      target: { value: "Zobacz też" },
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      ...block,
      data: { ...block.data, introPl: "Zobacz też" },
    });
  });
});

describe("BlockEditRenderer - isActive dociera do edytorów z własnym paskiem", () => {
  // Paski mediów pokazują się dopiero przy wskazanym pliku - pusty blok
  // z palety ma w tym miejscu pole adresu, a nie podgląd medium.
  const PASKI: ReadonlyArray<[BlockType, string, Record<string, string>]> = [
    ["paragraph", t("blocks.toolbar.undo"), {}],
    ["heading", "H1", {}],
    ["image", t("blocks.toolbar.replaceUrl"), { url: "https://cdn.example.com/a.jpg" }],
    ["video", t("blocks.toolbar.replaceUrl"), { url: "https://cdn.example.com/v.mp4" }],
    ["audio", t("blocks.toolbar.replaceUrl"), { url: "https://cdn.example.com/a.mp3" }],
  ];

  it.each(PASKI)("%s aktywny pokazuje własny pasek", (type, przycisk, dane) => {
    const block = zPalety(type);
    zamontuj({ ...block, data: { ...block.data, ...dane } }, true);
    expect(screen.getByRole("button", { name: przycisk })).toBeInTheDocument();
  });

  it.each(PASKI)("%s nieaktywny NIE zasłania treści paskiem", (type, przycisk, dane) => {
    const block = zPalety(type);
    zamontuj({ ...block, data: { ...block.data, ...dane } }, false);
    expect(screen.queryByRole("button", { name: przycisk })).toBeNull();
  });
});

describe("BlockEditRenderer - handlery klawiatury docierają do akapitu i nagłówka", () => {
  // happy-dom nie liczy layoutu, więc karetka świeżo zamontowanego edytora
  // stoi na POCZĄTKU treści (zob. nota w `blockEditTextEditors.test.tsx`).
  // Każdy klawisz niżej jest dobrany do tej pozycji.
  function pole(container: HTMLElement): HTMLElement {
    const el = container.querySelector('[contenteditable="true"]');
    if (!(el instanceof HTMLElement)) throw new Error("brak pola edycji");
    return el;
  }

  const TEKSTOWE: ReadonlyArray<[BlockType, Block]> = [
    ["paragraph", { id: "p1", type: "paragraph", data: { html: "<p>Treść</p>" } }],
    ["heading", { id: "h1", type: "heading", data: { level: 2, text: "Treść" } }],
  ];
  const PUSTE: Record<"paragraph" | "heading", Block> = {
    paragraph: { id: "p1", type: "paragraph", data: { html: "" } },
    heading: { id: "h1", type: "heading", data: { level: 2, text: "" } },
  };

  it.each(TEKSTOWE)("%s: Enter wstawia nowy akapit POD blokiem", (_typ, block) => {
    const { container, onInsertAfter } = zamontuj(block);
    fireEvent.keyDown(pole(container), { key: "Enter" });
    expect(onInsertAfter).toHaveBeenCalledTimes(1);
    expect(onInsertAfter.mock.calls[0][0]).toMatchObject({ type: "paragraph" });
  });

  it.each(TEKSTOWE)("%s: Backspace na początku treści scala z poprzednim", (_typ, block) => {
    const { container, onMergeWithPrevious, onDeleteEmpty } = zamontuj(block);
    fireEvent.keyDown(pole(container), { key: "Backspace" });
    expect(onMergeWithPrevious).toHaveBeenCalledTimes(1);
    expect(onDeleteEmpty).not.toHaveBeenCalled();
  });

  it.each(["paragraph", "heading"] as const)("%s: Backspace w PUSTYM bloku go usuwa", (typ) => {
    const { container, onDeleteEmpty } = zamontuj(PUSTE[typ]);
    fireEvent.keyDown(pole(container), { key: "Backspace" });
    expect(onDeleteEmpty).toHaveBeenCalledTimes(1);
  });

  it.each(TEKSTOWE)("%s: strzałka w lewo na początku przenosi do poprzedniego bloku", (_t, b) => {
    const { container, onFocusPrevious } = zamontuj(b);
    fireEvent.keyDown(pole(container), { key: "ArrowLeft" });
    expect(onFocusPrevious).toHaveBeenCalledTimes(1);
  });

  it.each(["paragraph", "heading"] as const)(
    "%s: strzałka w prawo na końcu (pusty blok) przenosi do następnego",
    (typ) => {
      const { container, onFocusNext } = zamontuj(PUSTE[typ]);
      fireEvent.keyDown(pole(container), { key: "ArrowRight" });
      expect(onFocusNext).toHaveBeenCalledTimes(1);
    },
  );

  it.each(TEKSTOWE)("%s: Shift+strzałka w lewo eskaluje zaznaczenie do bloków", (_t, b) => {
    const { container, onExtendBlockSelection } = zamontuj(b);
    fireEvent.keyDown(pole(container), { key: "ArrowLeft", shiftKey: true });
    expect(onExtendBlockSelection).toHaveBeenCalledWith(-1);
  });

  it.each(["paragraph", "heading"] as const)(
    "%s: Ctrl+A na całej treści zaznacza wszystkie bloki",
    (typ) => {
      const { container, onSelectAllBlocks } = zamontuj(PUSTE[typ]);
      fireEvent.keyDown(pole(container), { key: "a", ctrlKey: true });
      expect(onSelectAllBlocks).toHaveBeenCalledTimes(1);
    },
  );

  it("akapit: menu „/” + Enter zamienia blok przez onTransform", () => {
    const { container, onTransform } = zamontuj(PUSTE.paragraph);
    fireEvent.keyDown(pole(container), { key: "/" });
    fireEvent.keyDown(pole(container), { key: "Enter" });
    expect(onTransform).toHaveBeenCalledTimes(1);
    expect(onTransform.mock.calls[0][0]).toHaveLength(1);
  });

  it("nagłówek: wklejenie kilku akapitów z Worda rozbija treść przez onTransform", () => {
    const { container, onTransform } = zamontuj(TEKSTOWE[1][1]);
    const html =
      '<html><body><p class="MsoNormal">Pierwszy</p><p class="MsoNormal">Drugi</p></body></html>';
    fireEvent.paste(pole(container), {
      clipboardData: {
        getData: (typ: string) => (typ === "text/html" ? html : "Pierwszy Drugi"),
        files: [],
        types: ["text/html", "text/plain"],
        items: [],
      },
    });
    expect(onTransform).toHaveBeenCalledTimes(1);
    const [zamiana] = onTransform.mock.calls[0];
    // Pierwszy element to TEN SAM nagłówek (id zachowane), reszta to nowe bloki.
    expect(zamiana[0]).toMatchObject({ id: "h1", type: "heading" });
    expect(zamiana.length).toBeGreaterThan(1);
  });
});

describe("BlockEditRenderer - typ bez edytora", () => {
  it("nieznany typ daje WIDOCZNĄ atrapę z nazwą typu, a nie pusty obszar", () => {
    const block = { id: "x1", type: "nieznany-typ", data: {} } as unknown as Block;
    const { onChange } = zamontuj(block);
    expect(screen.getByText("[nieznany-typ]")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("BlockWithToolbar - pasek generyczny bez dublowania", () => {
  const TRESC = <p data-testid="tresc">Treść bloku</p>;

  function owin(block: Block, isActive: boolean, dziecko: ReactElement = TRESC) {
    const onChange = vi.fn<(next: Block) => void>();
    const view = renderWithQueryClient(
      <BlockWithToolbar block={block} isActive={isActive} onChange={onChange}>
        {dziecko}
      </BlockWithToolbar>,
    );
    return { ...view, onChange };
  }

  function paskiGeneryczne(container: HTMLElement): Element[] {
    return Array.from(container.querySelectorAll('[data-widget-toolbar="generic"]'));
  }

  it("aktywny blok bez własnego paska dostaje JEDEN pasek generyczny nad treścią", () => {
    const { container } = owin(zPalety("quote"), true);
    expect(paskiGeneryczne(container)).toHaveLength(1);
    expect(screen.getByTestId("tresc")).toBeInTheDocument();
  });

  it("nieaktywny blok nie ma paska, ale treść zostaje", () => {
    const { container } = owin(zPalety("quote"), false);
    expect(paskiGeneryczne(container)).toHaveLength(0);
    expect(screen.getByTestId("tresc")).toBeInTheDocument();
  });

  it.each(["paragraph", "heading", "image", "video", "audio"] as const)(
    "%s ma własny pasek - opakowanie NIE dokłada generycznego",
    (type) => {
      const { container } = owin(zPalety(type), true);
      expect(paskiGeneryczne(container)).toHaveLength(0);
      // Treść idzie bez dodatkowego kontenera - własny pasek bloku pozycjonuje
      // się względem edytora, nie opakowania.
      expect(screen.getByTestId("tresc").parentElement).toBe(container);
    },
  );

  it("zapis z paska generycznego zachowuje id, typ i dane bloku", () => {
    const block = zPalety("quote");
    const { onChange } = owin(block, true);
    fireEvent.click(screen.getByRole("button", { name: t("blocks.toolbar.alignCenter") }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      ...block,
      data: { ...block.data, align: "center" },
    });
  });

  it("aktywny akapit w kanwie ma WYŁĄCZNIE swój pasek formatowania", () => {
    // Złożenie tak jak w `BlockCanvas`: opakowanie + dyspozytor.
    const block = zPalety("paragraph");
    const h = handlery();
    const { container } = owin(block, true, <BlockEditRenderer block={block} isActive {...h} />);
    expect(paskiGeneryczne(container)).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: t("blocks.toolbar.undo") })).toHaveLength(1);
  });

  it("aktywny cytat w kanwie ma pasek generyczny i edytor cytatu naraz", () => {
    const block = zPalety("quote");
    const h = handlery();
    const { container } = owin(block, true, <BlockEditRenderer block={block} isActive {...h} />);
    expect(paskiGeneryczne(container)).toHaveLength(1);
    expect(container.querySelector("textarea, [contenteditable], input")).not.toBeNull();
  });
});
