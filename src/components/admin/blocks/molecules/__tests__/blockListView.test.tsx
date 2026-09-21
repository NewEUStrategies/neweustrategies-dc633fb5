// LIST VIEW EDYTORA BLOKOW (`BlockListView`) - drzewo CALEGO dokumentu w panelu
// bocznym, odpowiednik "Widoku listy" z WordPress Gutenberg.
//
// To jedyne miejsce, w ktorym redakcja widzi dokument jako STRUKTURE, a nie jako
// kanwe. Blok schowany w kontenerze (`group`, `columns`) nie ma w kanwie wlasnego
// paska akcji - do bloku w srodku kolumny redaktor dociera WYLACZNIE stad. Ta
// lista jest tez jedynym miejscem, gdzie skroty zaznaczenia blokowego (Shift,
// Ctrl/Cmd) sa w ogole napisane na ekranie.
//
// CO TU JEST NAPRAWDE DO OBRONY
//
// 1. KLIK W WIERSZ ZAGNIEZDZONY MUSI ROZROZNIAC DWA ID. Wiersz dziecka niesie
//    `row.id` (samo dziecko) i `row.rootId` (jego blok najwyzszego poziomu).
//    Zaznaczenie idzie na KORZEN (bo model zaznaczen kanwy i DnD operuja na
//    najwyzszym poziomie), a przewiniecie kanwy na `row.id`, czyli na to, co
//    redaktor faktycznie kliknal. Zamiana tych dwoch id miejscami nie daje bledu
//    - daje skok kanwy na poczatek kontenera i zaznaczenie nie tego bloku.
//
// 2. TRZY TRYBY KLIKNIECIA TO TRZY ROZNE WYJSCIA DO RODZICA. Zwykly klik:
//    zaznaczenie wielokrotne CZYSCI SIE, a blok staje sie aktywny. Ctrl/Cmd+klik
//    i Shift+klik: odwrotnie - buduja zaznaczenie wielokrotne i GASZA blok
//    aktywny (`onSelect(null)`). Gdyby ktorykolwiek tryb zapomnial o drugim
//    wywolaniu, edytor stalby z dwoma sprzecznymi zaznaczeniami naraz (blok
//    aktywny + zbior), a operacje masowe (usun, skopiuj) dzialalyby na innym
//    zbiorze, niz podswietla kanwa.
//
// 3. UCHWYT PRZECIAGANIA MA ISTNIEC WYLACZNIE DLA BLOKOW NAJWYZSZEGO POZIOMU.
//    `SortableContext` dostaje `items={topLevelIds}`, ale `useSortable` wola
//    KAZDY wiersz (takze zagniezdzony) z `disabled: !isTopLevel`. Do tego
//    `onDragEnd` mapuje `active.id`/`over.id` przez `topLevelIds.indexOf` i przy
//    -1 milczy. To jest straz przed przeniesieniem bloku "z kontenera na
//    poziom glowny" jednym gestem, czyli przed cicha zmiana struktury dokumentu.
//
// 4. PUSTY DOKUMENT MA MIEC KOMUNIKAT, NIE PUSTE DRZEWO. `role="tree"` bez ani
//    jednego `treeitem` jest naruszeniem ARIA i wyglada jak panel, ktory sie nie
//    wczytal.
//
// GRANICA DOWODU
//  * GEST MYSZY NIE JEST TU DOWODZONY. Pod happy-dom `getBoundingClientRect`
//    zwraca zera, wiec @dnd-kit nie ma z czego policzyc kolizji. Obejscie jest
//    to samo, co w `blocks/__tests__/blockCanvasDragDrop.test.tsx`: PRAWDZIWY
//    `DndContext` zostaje w drzewie (wiersze wolaja `useSortable` i bez kontekstu
//    by wybuchly), a test przechwytuje referencje do `onDragEnd` i wola ja
//    wprost. Przedmiotem dowodu jest handler listy, nie biblioteka.
//  * `isDragging` (wygaszenie wiersza w trakcie ciagniecia) zyje w stanie
//    wewnetrznym @dnd-kit, ktory bez gestu myszy nie wstaje - klasa `opacity-45`
//    nie ma tu wiec asercji.
//  * `if (anchor)` w BlockListView.tsx:72 jest GALEZIA MARTWA i zadnym wejsciem
//    sie jej nie osiagnie: warunek zewnetrzny (:70) przepuszcza dalej tylko
//    wtedy, gdy `activeId` jest prawdziwe ALBO `selectedIds` jest niepuste,
//    a `selectedIds[0] ?? activeId` jest wtedy zawsze prawdziwe (id bloku to
//    `b_[a-z0-9]+`, nigdy pusty napis). To nie luka w tescie, tylko nadmiarowy
//    straz w kodzie - i dlatego pokrycie GALEZI tego pliku nie dojdzie do 100%.
//  * `scrollIntoView` nie istnieje w happy-dom, wiec kanwa jest tu zastapiona
//    golym elementem `[data-block-id]` z podstawiona atrapa metody. Dowodzone
//    jest to, KTORY blok kanwy zostaje wskazany, a nie samo przewijanie.
//  * Slownik jest PRAWDZIWY (`realT("pl")`) - zniknieciu klucza `blocks.*`
//    towarzyszy czerwony test, a nie cicho wyswietlony identyfikator klucza.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { withChildBlocks } from "@/lib/blocks/nested";
import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";

/** Minimalny ksztalt zdarzenia upuszczenia - tylko to, co czyta handler. */
type Upuszczenie = { active: { id: string }; over: { id: string } | null };
type Uchwyt = (e: Upuszczenie) => void;

const dnd = vi.hoisted(() => ({ uchwyty: [] as Uchwyt[] }));

// PRAWDZIWY DndContext zostaje w drzewie (kazdy wiersz wola `useSortable`),
// a my zapamietujemy jedynie jego `onDragEnd`. Lista renderuje dokladnie jeden
// kontekst, wiec interesuje nas `dnd.uchwyty[0]`.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  const { createElement } = await import("react");
  const Real = actual.DndContext;
  return {
    ...actual,
    DndContext: (props: { onDragEnd?: Uchwyt; children?: ReactNode }) => {
      if (props.onDragEnd && !dnd.uchwyty.includes(props.onDragEnd)) {
        dnd.uchwyty.push(props.onDragEnd);
      }
      return createElement(Real, props as never);
    },
  };
});

// Import PO fabryce `vi.mock` czyta juz podmieniony @dnd-kit/core.
const { BlockListView } = await import("../BlockListView");

const t = realT("pl");

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

function naglowek(id: string, tekst: string): Block {
  return { id, type: "heading", data: { level: 2, text: tekst } } as Block;
}

function grupa(id: string, dzieci: Block[]): Block {
  return withChildBlocks({ id, type: "group", data: {} } as Block, "children", dzieci);
}

function doc(blocks: Block[]): BlocksDoc {
  return { version: 1, blocks } as BlocksDoc;
}

/**
 * Dokument kontrolny: akapit, kontener `group` z dwoma dziecmi, naglowek.
 * Wiersze w kolejnosci dokumentu: p1, g1, c1, c2, h1 (rodzic przed dziecmi).
 */
function dokument(): BlocksDoc {
  return doc([
    akapit("p1", "pierwszy"),
    grupa("g1", [akapit("c1", "dziecko A"), akapit("c2", "dziecko B")]),
    naglowek("h1", "Tytul sekcji"),
  ]);
}

interface Opcje {
  doc?: BlocksDoc;
  activeId?: string | null;
  selectedIds?: readonly string[];
}

function zamontuj({
  doc: dokumentWejsciowy = dokument(),
  activeId = null,
  selectedIds = [],
}: Opcje = {}) {
  dnd.uchwyty.length = 0;
  const onSelect = vi.fn<(id: string | null) => void>();
  const onSelectedIdsChange = vi.fn<(ids: readonly string[]) => void>();
  const onReorder = vi.fn<(fromIdx: number, toIdx: number) => void>();
  const view = render(
    <BlockListView
      doc={dokumentWejsciowy}
      activeId={activeId}
      selectedIds={selectedIds}
      onSelect={onSelect}
      onSelectedIdsChange={onSelectedIdsChange}
      onReorder={onReorder}
    />,
  );
  return { onSelect, onSelectedIdsChange, onReorder, view };
}

/**
 * Przycisk wyboru wiersza o podanej tresci (etykieta typu + skrot tresci bloku).
 *
 * ADRESOWANIE PRZEZ TRESC, NIE PRZEZ NAZWE DOSTEPNA, jest tu SWIADOME: uchwyt
 * przeciagania siedzi WEWNATRZ przycisku wiersza i sam ma `role="button"`
 * (`{...attributes}` z `useSortable`), wiec zapytanie o rolę „button” zwraca
 * dwa elementy na wiersz, a nazwa dostepna wiersza wsysa jeszcze `title`
 * uchwytu. To jest defekt opisany nizej (`nested-interactive`) - dopoki zyje,
 * test siega po JEDYNY prawdziwy element `<button>` w wierszu.
 */
function wiersz(tresc: string): HTMLElement {
  const li = screen.getAllByRole("treeitem").find((el) => (el.textContent ?? "").trim() === tresc);
  if (!li) throw new Error(`test: brak wiersza o tresci „${tresc}”`);
  const przycisk = li.querySelector("button");
  if (!przycisk) throw new Error(`test: wiersz „${tresc}” nie ma przycisku wyboru`);
  return przycisk;
}

/** Tresci wierszy drzewa w kolejnosci renderowania. */
function etykietyWierszy(): string[] {
  return screen.getAllByRole("treeitem").map((li) => (li.textContent ?? "").trim());
}

/**
 * Podstawia w DOM-ie atrape wiersza kanwy (`[data-block-id]`) razem z
 * `scrollIntoView`, ktorego happy-dom nie implementuje. Zwraca szpiega metody.
 */
function atrapaWierszaKanwy(blockId: string): ReturnType<typeof vi.fn> {
  const el = document.createElement("div");
  el.setAttribute("data-block-id", blockId);
  const scroll = vi.fn();
  el.scrollIntoView = scroll;
  document.body.appendChild(el);
  return scroll;
}

// ── DRZEWO DOKUMENTU ────────────────────────────────────────────────────────

describe("BlockListView - drzewo dokumentu", () => {
  it("pusty dokument pokazuje komunikat ze slownika zamiast pustego drzewa", () => {
    zamontuj({ doc: doc([]) });

    expect(screen.getByText(t("blocks.listView.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("kazdy blok dokumentu, takze zagniezdzony, dostaje wlasny wiersz w kolejnosci dokumentu", () => {
    zamontuj();

    // Piec wierszy z trzech blokow najwyzszego poziomu - dwa dzieci kontenera
    // sa widoczne TYLKO tutaj, bo w kanwie nie maja wlasnego paska akcji.
    expect(screen.getAllByRole("treeitem")).toHaveLength(5);
    expect(etykietyWierszy()).toEqual([
      `${t("blocks.types.paragraph")}pierwszy`,
      t("blocks.types.group"),
      `${t("blocks.types.paragraph")}dziecko A`,
      `${t("blocks.types.paragraph")}dziecko B`,
      `${t("blocks.types.heading")}Tytul sekcji`,
    ]);
  });

  it("wiersz dziecka jest wciety i ma glebszy poziom drzewa niz jego kontener", () => {
    zamontuj();
    const wiersze = screen.getAllByRole("treeitem");

    expect(wiersze[1]).toHaveAttribute("aria-level", "1");
    expect(wiersze[1].style.paddingLeft).toBe("0px");
    expect(wiersze[2]).toHaveAttribute("aria-level", "2");
    expect(wiersze[2].style.paddingLeft).toBe("14px");
  });

  it("drzewo i jego naglowek biora nazwe z tego samego klucza slownika", () => {
    zamontuj();

    expect(screen.getByRole("tree", { name: t("blocks.listView.title") })).toBeInTheDocument();
    expect(screen.getByText(t("blocks.listView.title"))).toBeInTheDocument();
  });

  it("lista wypisuje skroty zaznaczenia blokowego - jedyne miejsce, gdzie redakcja je zobaczy", () => {
    zamontuj();

    expect(screen.getByText(t("blocks.selection.hint"))).toBeInTheDocument();
  });

  it("uchwyt przeciagania dostaja WYLACZNIE bloki najwyzszego poziomu", () => {
    zamontuj();

    // Trzy bloki top-level maja uchwyt, dwa wiersze dzieci nie maja go wcale.
    expect(screen.getAllByTitle(t("blocks.actions.drag"))).toHaveLength(3);
  });

  it("blok bez tresci tekstowej pokazuje sama etykiete typu, bez pustego dopisku", () => {
    zamontuj({ doc: doc([{ id: "s1", type: "spacer", data: { height: 40 } } as Block]) });

    expect(etykietyWierszy()).toEqual([t("blocks.types.spacer")]);
  });

  it("blok o typie SPOZA REJESTRU nie wywraca listy - wiersz zostaje bez ikony", () => {
    // Dokument zapisany przez nowsza wersje edytora (albo typ wycofany
    // z `BLOCK_SPECS`) daje `BLOCK_SPECS[type] === undefined`. Lista musi go
    // pokazac, a nie zgasnac razem z calym panelem bocznym - inaczej redaktor
    // traci dostep do WSZYSTKICH blokow wpisu przez jeden nieznany typ.
    // Rzutowanie `as unknown as Block`, bo `type` jest unia zamknieta i taki
    // dokument z definicji nie da sie zapisac przez biezacy typ.
    const zPrzyszlosci = { id: "x1", type: "blok-z-przyszlosci", data: {} } as unknown as Block;
    zamontuj({ doc: doc([akapit("p1", "pierwszy"), zPrzyszlosci]) });

    const wiersze = screen.getAllByRole("treeitem");
    expect(wiersze).toHaveLength(2);
    // Brak wpisu w rejestrze = brak ikony; sam klucz typu zostaje etykieta.
    expect(wiersze[1].querySelectorAll("svg")).toHaveLength(1); // tylko uchwyt
    expect(wiersze[0].querySelectorAll("svg")).toHaveLength(2); // uchwyt + ikona
  });
});

// ── ZAZNACZENIE WIERSZA ─────────────────────────────────────────────────────

describe("BlockListView - zwykly klik w wiersz", () => {
  it("czysci zaznaczenie wielokrotne, ustawia blok aktywny i przewija kanwe do niego", () => {
    const scroll = atrapaWierszaKanwy("h1");
    const { onSelect, onSelectedIdsChange } = zamontuj({ selectedIds: ["p1", "g1"] });

    fireEvent.click(wiersz(`${t("blocks.types.heading")}Tytul sekcji`));

    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
    expect(onSelect).toHaveBeenCalledWith("h1");
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  });

  it("klik w wiersz ZAGNIEZDZONY aktywuje blok najwyzszego poziomu, a przewija do dziecka", () => {
    const scrollDziecka = atrapaWierszaKanwy("c2");
    const scrollKontenera = atrapaWierszaKanwy("g1");
    const { onSelect } = zamontuj();

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}dziecko B`));

    // Zaznaczenie idzie na KORZEN (model zaznaczen kanwy jest top-level)...
    expect(onSelect).toHaveBeenCalledWith("g1");
    // ...ale kanwa skacze do tego, co redaktor faktycznie kliknal.
    expect(scrollDziecka).toHaveBeenCalledTimes(1);
    expect(scrollKontenera).not.toHaveBeenCalled();
  });

  it("klik jest bezpieczny, gdy kanwa nie ma wiersza o takim id (np. zwiniety kontener)", () => {
    const { onSelect } = zamontuj();

    expect(() => fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`))).not.toThrow();
    expect(onSelect).toHaveBeenCalledWith("p1");
  });

  it("klik w uchwyt przeciagania NIE zmienia zaznaczenia - uchwyt sluzy do ciagniecia", () => {
    const { onSelect, onSelectedIdsChange } = zamontuj();

    fireEvent.click(screen.getAllByTitle(t("blocks.actions.drag"))[0]);

    expect(onSelect).not.toHaveBeenCalled();
    expect(onSelectedIdsChange).not.toHaveBeenCalled();
  });
});

describe("BlockListView - Ctrl/Cmd+klik (przelaczanie zaznaczenia)", () => {
  it("doklada blok do zaznaczenia i zachowuje kolejnosc dokumentu, nie kolejnosc klikania", () => {
    const { onSelect, onSelectedIdsChange } = zamontuj({ selectedIds: ["h1"] });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`), { ctrlKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "h1"]);
    // Blok aktywny GASNIE - inaczej edytor mialby dwa sprzeczne zaznaczenia.
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("ponowny Ctrl+klik na zaznaczonym wierszu usuwa go ze zbioru", () => {
    const { onSelectedIdsChange } = zamontuj({ selectedIds: ["p1", "h1"] });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`), { ctrlKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["h1"]);
  });

  it("Cmd+klik (macOS) robi dokladnie to samo, co Ctrl+klik", () => {
    const { onSelectedIdsChange } = zamontuj({ selectedIds: ["h1"] });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`), { metaKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "h1"]);
  });

  it("przy pustym zaznaczeniu punktem wyjscia jest blok AKTYWNY, a nie pustka", () => {
    const { onSelectedIdsChange } = zamontuj({ activeId: "h1" });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`), { ctrlKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "h1"]);
  });

  it("Ctrl+klik bez zaznaczenia i bez bloku aktywnego zaznacza sam kliknięty blok", () => {
    const { onSelectedIdsChange } = zamontuj();

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`), { ctrlKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1"]);
  });

  it("Ctrl+klik w wiersz zagniezdzony przelacza KORZEN, a nie samo dziecko", () => {
    const { onSelectedIdsChange } = zamontuj({ selectedIds: ["p1"] });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}dziecko A`), { ctrlKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "g1"]);
  });
});

describe("BlockListView - Shift+klik (zakres)", () => {
  it("zaznacza ciagly zakres od bloku aktywnego do klikniętego i gasi blok aktywny", () => {
    const { onSelect, onSelectedIdsChange } = zamontuj({ activeId: "p1" });

    fireEvent.click(wiersz(`${t("blocks.types.heading")}Tytul sekcji`), { shiftKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "g1", "h1"]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("zakres klikniety W GORE wraca w kolejnosci dokumentu, nie odwrotnie", () => {
    const { onSelectedIdsChange } = zamontuj({ activeId: "h1" });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}pierwszy`), { shiftKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "g1", "h1"]);
  });

  it("Shift+klik w wiersz zagniezdzony rozciaga zakres do jego KORZENIA", () => {
    const { onSelectedIdsChange } = zamontuj({ activeId: "p1" });

    fireEvent.click(wiersz(`${t("blocks.types.paragraph")}dziecko B`), { shiftKey: true });

    // Dziecko nie istnieje na poziomie glownym - zakres konczy sie na `g1`.
    expect(onSelectedIdsChange).toHaveBeenCalledWith(["p1", "g1"]);
  });

  it("bez kotwicy (brak aktywnego bloku i puste zaznaczenie) zachowuje sie jak zwykly klik", () => {
    const scroll = atrapaWierszaKanwy("h1");
    const { onSelect, onSelectedIdsChange } = zamontuj();

    fireEvent.click(wiersz(`${t("blocks.types.heading")}Tytul sekcji`), { shiftKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
    expect(onSelect).toHaveBeenCalledWith("h1");
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  // DEFEKT: KOTWICA ZAKRESU UCIEKA NA KONIEC POPRZEDNIEGO ZAZNACZENIA.
  //
  // WEJSCIE: redaktor klika blok TRZECI (`h1` staje sie aktywny), po czym
  //   Shift+klika blok PIERWSZY - zakres idzie w gore i daje `["p1","g1","h1"]`.
  //   Rodzic oddaje to jako `selectedIds`, a `activeId` gasnie. Teraz redaktor
  //   Shift+klika blok DRUGI (`g1`), zeby ZWEZIC zaznaczenie do `["g1","h1"]`.
  // CO PSUJE: `handleRowClick` (BlockListView.tsx:71) wylicza kotwice jako
  //   `selectedIds[0] ?? activeId`, czyli bierze PIERWSZY ELEMENT ZBIORU
  //   w kolejnosci dokumentu. Po zakresie zaznaczonym W GORE pierwszym
  //   elementem jest `p1` - blok, ktory byl KONCEM gestu, nie jego poczatkiem.
  //   Kotwica przeskakuje wiec na przeciwna krawedz zaznaczenia.
  // KONSEKWENCJA: zamiast zwezenia do `["g1","h1"]` redaktor dostaje
  //   `["p1","g1"]` - zbior, ktorego nigdy nie wskazal, i to po CICHU (nie ma
  //   bledu, jest inne podswietlenie). Kolejna operacja masowa - „usun
  //   zaznaczone” - kasuje wtedy blok `p1`, ktory redaktor wlasnie probowal
  //   z zaznaczenia wypuscic. Ta sama pomylka dotyczy KAZDEGO zakresu
  //   zaznaczonego w gore, wiec polowy gestow Shift.
  // WYMAGANA POPRAWKA: kotwica musi byc PAMIETANA (np. `useRef` ustawiany przy
  //   zwyklym kliknieciu i przy pierwszym Shift+kliknieciu), a nie odtwarzana
  //   z `selectedIds[0]`. Dopoki redaktor trzyma Shift, kotwica ma zostac tam,
  //   gdzie zaczal - dokladnie tak dziala zaznaczanie zakresu w Gutenbergu
  //   i w kazdym menedzerze plikow.
  it.fails("DEFEKT: Shift+klik po zakresie W GORE musi zwezac zaznaczenie od kotwicy", () => {
    // Stan po pierwszym gescie: zakres `h1` -> `p1` zaznaczony, kotwica = `h1`.
    const { onSelectedIdsChange } = zamontuj({ activeId: null, selectedIds: ["p1", "g1", "h1"] });

    fireEvent.click(wiersz(t("blocks.types.group")), { shiftKey: true });

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["g1", "h1"]);
  });
});

// ── PODSWIETLENIE DLA CZYTNIKA EKRANU ───────────────────────────────────────

describe("BlockListView - stan wiersza w drzewie dostepnosci", () => {
  it("blok aktywny oznacza jako wybrany takze WIERSZE SWOICH DZIECI", () => {
    zamontuj({ activeId: "g1" });
    const wiersze = screen.getAllByRole("treeitem");

    expect(wiersze[0]).toHaveAttribute("aria-selected", "false");
    expect(wiersze[1]).toHaveAttribute("aria-selected", "true");
    expect(wiersze[2]).toHaveAttribute("aria-selected", "true");
    expect(wiersze[3]).toHaveAttribute("aria-selected", "true");
  });

  it("zaznaczenie wielokrotne oznacza wiersz korzenia i jego dzieci", () => {
    zamontuj({ selectedIds: ["g1"] });
    const wiersze = screen.getAllByRole("treeitem");

    expect(wiersze[1]).toHaveAttribute("aria-selected", "true");
    expect(wiersze[2]).toHaveAttribute("aria-selected", "true");
    expect(wiersze[4]).toHaveAttribute("aria-selected", "false");
  });
});

// ── ZMIANA KOLEJNOSCI PRZECIAGANIEM ─────────────────────────────────────────

describe("BlockListView - upuszczenie wiersza (straze przed zmiana struktury)", () => {
  it("prawidlowe upuszczenie zglasza rodzicowi indeksy OD i DO na poziomie glownym", () => {
    const { onReorder } = zamontuj();

    dnd.uchwyty[0]({ active: { id: "h1" }, over: { id: "p1" } });

    expect(onReorder).toHaveBeenCalledWith(2, 0);
  });

  it("upuszczenie bloku NA SIEBIE nie przestawia niczego", () => {
    const { onReorder } = zamontuj();

    dnd.uchwyty[0]({ active: { id: "p1" }, over: { id: "p1" } });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("upuszczenie poza jakikolwiek cel (over === null) nie przestawia niczego", () => {
    const { onReorder } = zamontuj();

    dnd.uchwyty[0]({ active: { id: "p1" }, over: null });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("upuszczenie nad WIERSZEM ZAGNIEZDZONYM nie wciaga bloku do kontenera", () => {
    const { onReorder } = zamontuj();

    // `c1` jest dzieckiem `g1` - nie istnieje w indeksie poziomu glownego,
    // wiec handler milczy zamiast przestawic blok pod losowy indeks.
    dnd.uchwyty[0]({ active: { id: "p1" }, over: { id: "c1" } });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("upuszczenie bloku, ktorego nie ma w dokumencie, nie przestawia niczego", () => {
    const { onReorder } = zamontuj();

    dnd.uchwyty[0]({ active: { id: "duch" }, over: { id: "p1" } });

    expect(onReorder).not.toHaveBeenCalled();
  });
});

// ── DOSTEPNOSC ──────────────────────────────────────────────────────────────

describe("BlockListView - dostepnosc drzewa", () => {
  it("pusta lista nie zostawia w DOM-ie drzewa bez elementow", async () => {
    const { view } = zamontuj({ doc: doc([]) });

    const naruszenia = await axeViolations(view.container);
    expect(summarize(naruszenia)).toBe("");
  });

  // DEFEKT: UCHWYT PRZECIAGANIA JEST KONTROLKA WEWNATRZ KONTROLKI.
  //
  // WEJSCIE: dowolny dokument z blokiem najwyzszego poziomu - wystarczy jeden
  //   akapit; drzewo renderuje wtedy jeden wiersz z uchwytem.
  // CO PSUJE: wiersz to `<button>` (BlockListView.tsx:166), a uchwyt w jego
  //   srodku (:177-186) dostaje `{...attributes}` z `useSortable`, czyli
  //   `role="button"` i `tabIndex=0`. Powstaje kontrolka zagniezdzona
  //   w kontrolce: HTML zabrania tresci interaktywnej wewnatrz `<button>`,
  //   a axe zglasza to regula `nested-interactive`.
  // KONSEKWENCJA: czytnik ekranu widzi w wierszu DWA przyciski o niejasnej
  //   relacji i czesc czytnikow w ogole nie oglasza zagniezdzonego. Uchwyt jest
  //   przy tym niewidoczny do czasu najechania myszą (`opacity-0
  //   group-hover/row:opacity-100`), wiec uzytkownik klawiatury zatrzymuje sie
  //   na nim tabulatorem, nie widzac na czym stoi - a `KeyboardSensor` jest
  //   podpiety wlasnie do niego, wiec to JEDYNA klawiaturowa droga do zmiany
  //   kolejnosci blokow. Przeciaganie z klawiatury jest wiec dzis dostepne
  //   wylacznie „na slepo”.
  // WYMAGANA POPRAWKA: wiersz i uchwyt musza byc RODZENSTWEM, nie zagniezdzeniem
  //   - `<li>` z osobnym `<button>` wyboru bloku i osobnym `<button>` uchwytu
  //   (z `aria-label` zamiast samego `title` i bez `opacity-0` przy `:focus`).
  //   Wtedy `nested-interactive` znika, a uchwyt staje sie widoczny w momencie,
  //   w ktorym dostaje focus.
  it.fails(
    "DEFEKT: uchwyt przeciagania nie moze byc przyciskiem wewnatrz przycisku wiersza",
    async () => {
      const { view } = zamontuj({ doc: doc([akapit("p1", "pierwszy")]) });

      const naruszenia = await axeViolations(view.container);
      expect(summarize(naruszenia)).toBe("");
    },
  );
});

// Drzewo z poprzedniego przypadku znika razem z `cleanup` RTL, ale atrapy
// wierszy kanwy dopisujemy do `document.body` recznie - sprzatamy je tak samo.
afterEach(() => {
  cleanup();
  for (const el of Array.from(document.querySelectorAll("[data-block-id]"))) el.remove();
});
