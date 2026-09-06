// PLYNNE PISANIE PRZEZ CALY DOKUMENT - te operacje kanwy, ktore mieszaja
// KARETKE z UKLADEM DOKUMENTU (parytet z WordPress Gutenberg).
//
// DLACZEGO WLASNIE TE. Kazda z nich zmienia liczbe blokow w reakcji na
// zwyklego klawisza w trakcie pisania, wiec kazda potrafi zabrac redaktorowi
// tekst, ktorego nawet nie zauwazy:
//   * Enter dzieli blok - ogon za karetka MUSI trafic do nowego bloku, a nie
//     zostac w obu (duplikat) albo w zadnym (utrata),
//   * Backspace na PUSTYM bloku usuwa blok i wraca karetka na sasiada,
//   * Backspace na POCZATKU niepustego bloku SCALA go z poprzednim - tu ginie
//     tekst, gdy scalenie zgubi jedna ze stron,
//   * strzalki na krawedziach tresci przenosza fokus do sasiedniego bloku
//     TEKSTOWEGO, przeskakujac bloki, w ktorych nie da sie pisac,
//   * transformacja typu (menu "Przeksztalc w") podmienia blok na inny -
//     tresc musi przezyc podmiane,
//   * zaznaczenie wielu blokow + pisanie zastepuje je JEDNYM akapitem; wpisany
//     znak musi wejsc ZAESCAPOWANY (inaczej `<` z klawiatury wstrzykuje markup).
//
// JAK TO JEST DOWODZONE. Przez PRAWDZIWE zdarzenia klawiatury na prawdziwym
// polu edycji prawdziwego `ParagraphBlock` (TipTap), w prawdziwej kanwie.
// Zadnej atrapy warstwy wlasnej - jedyny `vi.mock` to `sonner` (toasty).
// Karetke ustawiamy natywnym `Range` w DOM, tak jak robi to przegladarka.
//
// NOTA O KARETCE - WAZNA DLA ODCZYTU TYCH ASERCJI.
// Swiezo zamontowana instancja ProseMirror ma selekcje na POCZATKU dokumentu
// bloku, a happy-dom nie odwzorowuje layoutu, wiec pozycji karetki nie da sie
// tu przestawic w sposob, ktory ProseMirror uzna (`endOfTextblock` i mapowanie
// selekcji z DOM-u wymagaja realnych prostokatow). Swiadomie NIE udajemy wiec
// karetki sztucznym `Range` - to dawaloby asercje, ktora wyglada na dowod
// o karetce, a mierzy stan domyslny. Zamiast tego kazdy przypadek nizej jest
// opisany dla galezi KARETKA-NA-POCZATKU, ktora realnie tu dziala; scalanie
// i usuwanie pustego bloku to dokladnie ta galaz.
//
// CZEGO TU NIE MA
//   * asercji na to, GDZIE dokladnie stoi karetka po operacji. Zamiar karetki
//     jest tu widoczny przez `requestBlockFocus`, ktory ma wlasne testy
//     (`lib/blocks/focus`); happy-dom nie odwzorowuje layoutu, wiec asercja na
//     piksel bylaby asercja o atrapie,
//   * galezi karetka-na-koncu tresci (Enter dzielacy w srodku zdania) - z tego
//     samego powodu.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { realT } from "@/test/i18nReal";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { BlockCanvas } = await import("../BlockCanvas");

const t = realT("pl");

function akapit(id: string, html: string): Block {
  return { id, type: "paragraph", data: { html } } as Block;
}

function zamontuj(blocks: Block[], activeId: string | null = null, selectedIds: string[] = []) {
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  const onSelect = vi.fn<(id: string | null) => void>();
  const onSelectedIdsChange = vi.fn<(ids: readonly string[]) => void>();
  render(
    <BlockCanvas
      doc={{ version: 1, blocks } as BlocksDoc}
      activeId={activeId}
      onSelect={onSelect}
      onChange={onChange}
      selectedIds={selectedIds}
      onSelectedIdsChange={onSelectedIdsChange}
    />,
  );
  return { onChange, onSelect, onSelectedIdsChange };
}

/** Pole edycji bloku o danym id - to, w ktore realnie pisze redaktor. */
function pole(blockId: string): HTMLElement {
  const wiersz = document.querySelector(`[data-block-id="${blockId}"]`);
  const el = wiersz?.querySelector('[contenteditable="true"]');
  if (!(el instanceof HTMLElement)) throw new Error(`brak pola edycji bloku ${blockId}`);
  return el;
}

function idy(d: BlocksDoc): string[] {
  return d.blocks.map((b) => b.id);
}

function html(d: BlocksDoc): string[] {
  return d.blocks.map((b) => String(b.data.html ?? b.data.text ?? ""));
}

describe("BlockCanvas - Enter dzieli blok", () => {
  it("Enter dzieli blok i CAŁY ogon trafia do nowego bloku - nic nie ginie", () => {
    // Suma tresci przed i po musi byc ta sama: ogon nie moze zostac w obu
    // blokach (duplikat) ani wyparowac. Karetka stoi na poczatku (patrz nota
    // o karetce u gory pliku), wiec do nowego bloku idzie caly tekst.
    const { onChange, onSelect } = zamontuj([akapit("p1", "<p>alfa</p>")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "Enter" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toHaveLength(2);
    expect(html(next).join("").match(/alfa/g)).toHaveLength(1);
    expect(next.blocks[1].type).toBe("paragraph");
    // Nowy blok przejmuje zaznaczenie - redaktor pisze dalej bez klikania.
    expect(onSelect).toHaveBeenCalledWith(next.blocks[1].id);
  });

  it("Enter wstawia nowy blok DOKŁADNIE za bieżącym, nie na końcu dokumentu", () => {
    const { onChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>"), akapit("p3", "<p>gamma</p>")],
      "p2",
    );
    fireEvent.keyDown(pole("p2"), { key: "Enter" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next).slice(0, 2)).toEqual(["p1", "p2"]);
    expect(idy(next).at(-1)).toBe("p3");
    expect(next.blocks).toHaveLength(4);
  });

  it("Shift+Enter NIE tworzy nowego bloku (miękki łamany wiersz)", () => {
    const { onChange } = zamontuj([akapit("p1", "<p>alfa</p>")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "Enter", shiftKey: true });
    for (const [next] of onChange.mock.calls) {
      expect(next.blocks).toHaveLength(1);
    }
  });
});

describe("BlockCanvas - Backspace usuwa pusty blok", () => {
  it("Backspace na PUSTYM bloku usuwa go i wraca na sąsiada", () => {
    const { onChange, onSelect } = zamontuj([akapit("p1", "<p>alfa</p>"), akapit("p2", "")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["p1"]);
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("Backspace na JEDYNYM (pustym) bloku nie opróżnia dokumentu", () => {
    // Dokument bez ani jednego bloku nie ma jak przyjąć karetki - kanwa
    // pokazałaby wtedy stan pusty i redaktor traci miejsce do pisania.
    const { onChange } = zamontuj([akapit("p1", "")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Backspace na pustym bloku PIERWSZYM wraca na następnego sąsiada", () => {
    const { onChange, onSelect } = zamontuj([akapit("p1", ""), akapit("p2", "<p>beta</p>")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "Backspace" });
    expect(idy(onChange.mock.calls.at(-1)![0])).toEqual(["p2"]);
    expect(onSelect).toHaveBeenCalledWith("p2");
  });
});

describe("BlockCanvas - Backspace SCALA blok z poprzednim", () => {
  it("scalenie dwóch akapitów zachowuje treść OBU stron", () => {
    const { onChange, onSelect } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      "p2",
    );
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["p1"]);
    expect(html(next)[0]).toContain("alfa");
    expect(html(next)[0]).toContain("beta");
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("scalenie akapitu z NAGŁÓWKIEM dokleja tekst do nagłówka", () => {
    const naglowek = { id: "h1", type: "heading", data: { text: "Tytuł", level: 2 } } as Block;
    const { onChange } = zamontuj([naglowek, akapit("p2", "<p>ogon</p>")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["h1"]);
    expect(String(next.blocks[0].data.text)).toBe("Tytułogon");
  });

  it("scalenie z blokiem NIETEKSTOWYM nie zachodzi - dokument zostaje bez zmian", () => {
    // Separator nie ma pola tekstowego, więc scalenie nie ma sensu i kanwa
    // musi oddać sterowanie przeglądarce, a nie zjeść bloku.
    const separator = { id: "s1", type: "separator", data: {} } as Block;
    const { onChange } = zamontuj([separator, akapit("p2", "<p>beta</p>")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    for (const [next] of onChange.mock.calls) {
      expect(idy(next)).toEqual(["s1", "p2"]);
    }
  });

  it("scalenie PIERWSZEGO bloku nie zachodzi (nie ma poprzednika)", () => {
    const { onChange } = zamontuj([akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "Backspace" });
    for (const [next] of onChange.mock.calls) {
      expect(idy(next)).toEqual(["p1", "p2"]);
    }
  });
});

describe("BlockCanvas - strzalki na krawedziach tresci", () => {
  it("strzałka w górę z pierwszego wiersza przenosi fokus na blok wyżej", () => {
    const { onSelect } = zamontuj([akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("strzałka w dół z ostatniego wiersza przenosi fokus na blok niżej", () => {
    const { onSelect } = zamontuj([akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("p2");
  });

  it("strzałka PRZESKAKUJE blok nietekstowy i szuka najbliższego, w którym da się pisać", () => {
    const separator = { id: "s1", type: "separator", data: {} } as Block;
    const { onSelect } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), separator, akapit("p3", "<p>gamma</p>")],
      "p3",
    );
    fireEvent.keyDown(pole("p3"), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith("p1");
    expect(onSelect).not.toHaveBeenCalledWith("s1");
  });

  it("strzałka w górę z PIERWSZEGO bloku nie wyprowadza z dokumentu", () => {
    const { onSelect } = zamontuj([akapit("p1", "<p>alfa</p>")], "p1");
    fireEvent.keyDown(pole("p1"), { key: "ArrowUp" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("BlockCanvas - transformacja typu bloku", () => {
  it("menu przekształceń oferuje inne typy rodziny tekstowej", () => {
    zamontuj([akapit("p1", "<p>alfa</p>")], "p1");
    fireEvent.click(screen.getByRole("button", { name: t("blocks.transform.menuLabel") }));
    const menu = screen.getByRole("dialog");
    expect(within(menu).getByRole("button", { name: t("blocks.types.heading") })).toBeVisible();
    expect(within(menu).getByRole("button", { name: t("blocks.types.quote") })).toBeVisible();
    // Bieżący typ nie jest celem transformacji.
    expect(within(menu).queryByRole("button", { name: t("blocks.types.paragraph") })).toBeNull();
  });

  it("wybór celu PODMIENIA blok w miejscu i zachowuje treść", () => {
    const { onChange, onSelect } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      "p1",
    );
    fireEvent.click(screen.getByRole("button", { name: t("blocks.transform.menuLabel") }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: t("blocks.types.heading") }),
    );
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0].type).toBe("heading");
    expect(String(next.blocks[0].data.text)).toContain("alfa");
    expect(idy(next)[1]).toBe("p2");
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("blok bez transformacji nie pokazuje menu przekształceń", () => {
    const separator = { id: "s1", type: "separator", data: {} } as Block;
    zamontuj([separator], "s1");
    expect(screen.queryByRole("button", { name: t("blocks.transform.menuLabel") })).toBeNull();
  });
});

describe("BlockCanvas - warianty bloku w pasku akcji", () => {
  function cytat(variant = "default"): Block {
    return { id: "q1", type: "quote", data: { text: "Europa", variant } } as Block;
  }

  it("blok z wariantami pokazuje grupę przełączników z aktualnym wyborem", () => {
    zamontuj([cytat("card")], "q1");
    const grupa = screen.getByRole("group", { name: t("blocks.actions.variant") });
    expect(within(grupa).getByRole("button", { name: "Karta" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(grupa).getByRole("button", { name: "Plain" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("wybór wariantu zapisuje go w danych bloku, nie ruszając treści", () => {
    const { onChange } = zamontuj([cytat("default")], "q1");
    const grupa = screen.getByRole("group", { name: t("blocks.actions.variant") });
    fireEvent.click(within(grupa).getByRole("button", { name: "Minimal" }));
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks[0].data.variant).toBe("minimal");
    expect(next.blocks[0].data.text).toBe("Europa");
  });

  it("klik w wariant AKTUALNY nie generuje zmiany dokumentu", () => {
    const { onChange } = zamontuj([cytat("card")], "q1");
    const grupa = screen.getByRole("group", { name: t("blocks.actions.variant") });
    fireEvent.click(within(grupa).getByRole("button", { name: "Karta" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blok bez wariantów nie pokazuje przełączników", () => {
    zamontuj([akapit("p1", "<p>alfa</p>")], "p1");
    expect(screen.queryByRole("group", { name: t("blocks.actions.variant") })).toBeNull();
  });
});

describe("BlockCanvas - klik w blok z modyfikatorami", () => {
  const trzy = () => [
    akapit("p1", "<p>alfa</p>"),
    akapit("p2", "<p>beta</p>"),
    akapit("p3", "<p>gamma</p>"),
  ];

  function wiersz(id: string): Element {
    const el = document.querySelector(`[data-block-canvas] [data-block-id="${id}"]`);
    if (!el) throw new Error(`brak wiersza ${id}`);
    return el;
  }

  it("zwykły klik zaznacza pojedynczy blok i czyści zaznaczenie wielokrotne", () => {
    const { onSelect, onSelectedIdsChange } = zamontuj(trzy(), "p1", ["p1", "p2"]);
    fireEvent.click(wiersz("p3"));
    expect(onSelect).toHaveBeenCalledWith("p3");
    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
  });

  it("Ctrl+klik DOKŁADA blok do zaznaczenia wielokrotnego", () => {
    const { onSelectedIdsChange } = zamontuj(trzy(), "p1", ["p1"]);
    fireEvent.click(wiersz("p3"), { ctrlKey: true });
    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "p3"]);
  });

  it("Shift+klik zaznacza ZAKRES od kotwicy", () => {
    const { onSelect, onSelectedIdsChange } = zamontuj(trzy(), "p1", []);
    fireEvent.click(wiersz("p1"));
    onSelect.mockClear();
    onSelectedIdsChange.mockClear();
    fireEvent.click(wiersz("p3"), { shiftKey: true });
    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "p2", "p3"]);
  });
});

describe("BlockCanvas - pisanie po zaznaczeniu wielu blokow", () => {
  it("wpisany znak zastępuje CAŁE zaznaczenie jednym akapitem", () => {
    const { onChange, onSelect } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>"), akapit("p3", "<p>gamma</p>")],
      null,
      ["p1", "p2"],
    );
    const kanwa = document.querySelector("[data-block-canvas]");
    fireEvent.keyDown(kanwa as Element, { key: "x" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toHaveLength(2);
    expect(String(next.blocks[0].data.html)).toBe("<p>x</p>");
    expect(idy(next)[1]).toBe("p3");
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("wpisany znak wchodzi ZAESCAPOWANY - klawiatura nie wstrzykuje markupu", () => {
    const { onChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      null,
      ["p1", "p2"],
    );
    const kanwa = document.querySelector("[data-block-canvas]");
    fireEvent.keyDown(kanwa as Element, { key: "<" });
    const [next] = onChange.mock.calls.at(-1)!;
    const wynik = String(next.blocks[0].data.html);
    expect(wynik).toBe("<p>&lt;</p>");
    expect(wynik).not.toContain("<<");
  });

  it("Escape czyści zaznaczenie wielokrotne", () => {
    const { onSelectedIdsChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      null,
      ["p1", "p2"],
    );
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
  });
});

// ── SCALANIE: PRZYPADKI BRZEGOWE TRESCI ─────────────────────────────────────
// Scalanie jest w kanwie miejscem o najwyzszej stawce: znika CALY blok, a jego
// tresc ma dojechac do sasiada. Ponizsze przypadki to te warianty pary
// (blok znikajacy, blok przyjmujacy), ktorych nie pokrywa scalenie dwoch
// zwyklych akapitow wyzej - a kazdy z nich idzie inna galezia `mergeWithPrevious`.
describe("BlockCanvas - scalanie w przypadkach brzegowych", () => {
  it("scalenie NAGŁÓWKA z poprzednim akapitem wnosi tekst nagłówka do akapitu", () => {
    // Odwrotna strona pary „akapit -> nagłówek": tu znikającym blokiem jest
    // NAGŁÓWEK i to jego tekst musi dojechać do akapitu wyżej.
    const naglowek = { id: "h2", type: "heading", data: { text: "Podtytuł", level: 3 } } as Block;
    const { onChange, onSelect } = zamontuj([akapit("p1", "<p>alfa</p>"), naglowek], "h2");
    fireEvent.keyDown(pole("h2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["p1"]);
    expect(html(next)[0]).toContain("alfa");
    expect(html(next)[0]).toContain("Podtytuł");
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("scalenie z PUSTYM poprzednim akapitem nie gubi treści znikającego bloku", () => {
    // Poprzednik bez pola `html` (świeżo wstawiony akapit) - brak danych nie
    // może zamienić scalenia w utratę tekstu, który redaktor właśnie napisał.
    const pusty = { id: "p1", type: "paragraph", data: {} } as Block;
    const { onChange } = zamontuj([pusty, akapit("p2", "<p>beta</p>")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["p1"]);
    expect(html(next)[0]).toContain("beta");
  });

  it("scalenie z PUSTYM poprzednim nagłówkiem nie gubi treści znikającego bloku", () => {
    const pustyNaglowek = { id: "h1", type: "heading", data: { level: 2 } } as Block;
    const { onChange } = zamontuj([pustyNaglowek, akapit("p2", "<p>ogon</p>")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["h1"]);
    expect(String(next.blocks[0].data.text)).toBe("ogon");
  });

  it("scalenie w dokumencie o TRZECH blokach rusza wyłącznie scalaną parę", () => {
    // Dwa bloki to zbyt mały dowód: po scaleniu zostaje jeden i nie widać,
    // czy pozostałe bloki przechodzą przez mapowanie NIEZMIENIONE.
    const trzeci = akapit("p3", "<p>gamma</p>");
    const { onChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>"), trzeci],
      "p2",
    );
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["p1", "p3"]);
    expect(html(next)[0]).toContain("beta");
    // Trzeci blok wraca DOKŁADNIE tym samym obiektem - scalanie sąsiadów go
    // nie przepisuje (przepisany blok to zmiana identyczności bez zmiany
    // treści, czyli fałszywy krok w historii i fałszywy zapis).
    expect(next.blocks[1]).toBe(trzeci);
  });

  it("Backspace na pustym bloku wraca na sąsiada NIETEKSTOWEGO bez karetki", () => {
    // Sąsiadem jest separator - nie ma w nim gdzie postawić karetki, więc
    // kanwa może go tylko ZAZNACZYĆ. Blok pusty i tak musi zniknąć.
    const separator = { id: "s1", type: "separator", data: {} } as Block;
    const { onChange, onSelect } = zamontuj([separator, akapit("p2", "")], "p2");
    fireEvent.keyDown(pole("p2"), { key: "Backspace" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(idy(next)).toEqual(["s1"]);
    expect(onSelect).toHaveBeenCalledWith("s1");
  });
});

// ── MENU SLASH: TRANSFORMACJA Z KLAWIATURY ──────────────────────────────────
// Menu „/" to druga - obok paska „Przekształć w" - droga do podmiany bloku,
// i jedyna dostepna bez myszy. Idzie tym samym `replaceWith`, ale wchodzi doń
// z INNEJ strony (z wnetrza edytora bloku, nie z paska akcji), wiec ma wlasny
// kontrakt na karetke.
describe("BlockCanvas - menu slash w pustym akapicie", () => {
  function pusteDwa(): Block[] {
    return [
      { id: "p1", type: "paragraph", data: { html: "" } } as Block,
      akapit("p2", "<p>beta</p>"),
    ];
  }

  it("wybór z menu PODMIENIA pusty akapit w miejscu, nie dokłada bloku obok", () => {
    const { onChange, onSelect } = zamontuj(pusteDwa(), "p1");
    const p = pole("p1");
    fireEvent.keyDown(p, { key: "/" });
    fireEvent.keyDown(p, { key: "Enter" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0].id).not.toBe("p1");
    expect(idy(next)[1]).toBe("p2");
    // Zaznaczenie przechodzi na blok zamiennik - piszesz dalej bez klikania.
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("menu slash może podmienić akapit na blok NIETEKSTOWY", () => {
    // Trzecia pozycja palety slash to Obraz - blok bez pola pisania. Podmiana
    // musi się wykonać, ale karetki nie ma gdzie postawić (kanwa nie może
    // wtedy szukać pola edycji, którego w bloku nie ma).
    const { onChange, onSelect } = zamontuj(pusteDwa(), "p1");
    const p = pole("p1");
    fireEvent.keyDown(p, { key: "/" });
    fireEvent.keyDown(p, { key: "ArrowDown" });
    fireEvent.keyDown(p, { key: "ArrowDown" });
    fireEvent.keyDown(p, { key: "Enter" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks[0].type).toBe("image");
    expect(idy(next)[1]).toBe("p2");
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("Escape zamyka menu slash bez podmiany bloku", () => {
    const { onChange } = zamontuj(pusteDwa(), "p1");
    const p = pole("p1");
    fireEvent.keyDown(p, { key: "/" });
    fireEvent.keyDown(p, { key: "Escape" });
    fireEvent.keyDown(p, { key: "Enter" });
    // Enter po zamknięciu menu jest zwykłym Enterem: dzieli blok, a nie
    // podmienia go na wybrany typ.
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks[0].id).toBe("p1");
    expect(next.blocks).toHaveLength(3);
  });
});

// ── ESKALACJA ZAZNACZENIA Z WNETRZA BLOKU ───────────────────────────────────
describe("BlockCanvas - Shift+strzalka na krawedzi tresci", () => {
  it("Shift+strzałka w górę na początku bloku zaznacza blok BIEŻĄCY i POPRZEDNI", () => {
    // Zaznaczenie tekstowe nie potrafi przekroczyć granicy bloku, więc od
    // krawędzi zamienia się w zaznaczenie BLOKOWE (parytet z WP Gutenberg).
    const { onSelectedIdsChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      "p2",
    );
    fireEvent.keyDown(pole("p2"), { key: "ArrowUp", shiftKey: true });
    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("Shift+strzałka w górę w PIERWSZYM bloku nie zaznacza niczego", () => {
    // Nie ma bloku wyżej - eskalacja musi odmówić, a nie zaznaczyć bloku
    // bieżącego „na pocieszenie" (redaktor dostałby wtedy zaznaczenie blokowe
    // przy zwykłym Shift+strzałka w pierwszym akapicie wpisu).
    const { onSelectedIdsChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      "p1",
    );
    fireEvent.keyDown(pole("p1"), { key: "ArrowUp", shiftKey: true });
    expect(onSelectedIdsChange).not.toHaveBeenCalled();
  });
});

describe("BlockCanvas - Enter przy zaznaczeniu wielu blokow", () => {
  it("Enter zastępuje CAŁE zaznaczenie jednym PUSTYM akapitem", () => {
    // Enter (w odróżnieniu od zwykłego znaku) nie wnosi treści, więc w miejsce
    // zaznaczonych bloków wchodzi akapit bez treści - gotowy do pisania.
    const { onChange, onSelect } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>"), akapit("p3", "<p>gamma</p>")],
      null,
      ["p1", "p2"],
    );
    const kanwa = document.querySelector("[data-block-canvas]");
    fireEvent.keyDown(kanwa as Element, { key: "Enter" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0].type).toBe("paragraph");
    expect(next.blocks[0].data.html).toBe("");
    expect(idy(next)[1]).toBe("p3");
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("Shift+Enter przy zaznaczeniu wielu bloków NIE kasuje ich treści", () => {
    // Shift+Enter to miękki łamany wiersz - nie ma prawa zastąpić zaznaczenia.
    const { onChange } = zamontuj(
      [akapit("p1", "<p>alfa</p>"), akapit("p2", "<p>beta</p>")],
      null,
      ["p1", "p2"],
    );
    const kanwa = document.querySelector("[data-block-canvas]");
    fireEvent.keyDown(kanwa as Element, { key: "Enter", shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });
});
