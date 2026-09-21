// PRZECIAGANIE BLOKU W KANWIE - trzecia z czterech operacji groznych dla
// tresci redaktora, wymieniona w zadaniu wprost ("upuszczenie bloku na siebie
// i na wlasnego potomka").
//
// CO MA TU DOWOD
//   * `BlockCanvas.onDragEnd` odrzuca upuszczenie na SIEBIE (`active.id ===
//     over.id`) i upuszczenie "w nicosc" (`over === null`) - dokument nie
//     dostaje zadnego `onChange`, wiec autosave nie zapisuje przypadkowej
//     wersji,
//   * upuszczenie kontenera na WLASNE DZIECKO nie przestawia niczego, bo id
//     dziecka nie istnieje w indeksie najwyzszego poziomu (`to < 0`) - to jest
//     realny stroz przed cyklem (blok w sobie samym), tylko postawiony na
//     indeksie, nie na sprawdzeniu pokrewienstwa,
//   * kanwa zagniezdzona (`NestedBlocksEditor`) ma WLASNY `DndContext`, wiec
//     oba konteksty sa rozlaczne - jeden gest nie moze przeniesc bloku miedzy
//     poziomami drzewa; to wlasnie dlatego cykl jest dzis nieosiagalny,
//   * prawidlowa zmiana kolejnosci (i na poziomie glownym, i wewnatrz
//     kontenera) faktycznie przestawia bloki i nie gubi zadnego z nich -
//     kontrola dodatnia, zeby "brak zmiany" wyzej nie byl dowodem na to, ze
//     handler nie robi NIC.
//
// CZEGO TU NIE MA
//   * gestu myszy. Pod happy-dom `getBoundingClientRect` zwraca zera, wiec
//     @dnd-kit nie ma z czego policzyc kolizji - to samo obejscie, co w
//     `admin/clubs/__tests__/ClubGroupsTab.test.tsx` i
//     `admin/newsletter/__tests__/CampaignContentBuilder.test.tsx`: PRAWDZIWY
//     `DndContext` renderuje sie dalej (`useSortable` w wierszach musi miec
//     kontekst), przechwytujemy jedynie referencje do `onDragEnd` i wolamy ja
//     wprost. Przedmiotem dowodu jest handler kanwy, nie biblioteka,
//   * atrap warstw wlasnych. Kanwa renderuje PRAWDZIWY `BlockEditRenderer`,
//     PRAWDZIWY `SortableBlockItem` i PRAWDZIWE edytory blokow. Poza @dnd-kit
//     mockowany jest tylko `sonner` (toasty) - granica UI.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import { realT } from "@/test/i18nReal";

/** Minimalny kształt zdarzenia upuszczenia - tylko to, co czyta handler. */
type Upuszczenie = { active: { id: string }; over: { id: string } | null };
type Uchwyt = (e: Upuszczenie) => void;

const dnd = vi.hoisted(() => ({ uchwyty: [] as Uchwyt[] }));

// PRAWDZIWY DndContext zostaje w drzewie (wiersze wołają `useSortable`), a my
// tylko zapamiętujemy kolejne `onDragEnd` w kolejności renderowania:
// [0] = kanwa główna, [1] = kanwa zagnieżdżona kontenera.
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const t = realT("pl");

function akapit(id: string, tekst: string): Block {
  return { id, type: "paragraph", data: { html: `<p>${tekst}</p>` } } as Block;
}

/** Dokument: akapit + kontener `group` z dwoma dziećmi. */
function dokument(): BlocksDoc {
  return {
    version: 1,
    blocks: [
      akapit("p1", "pierwszy"),
      withChildBlocks({ id: "g1", type: "group", data: {} } as Block, "children", [
        akapit("c1", "dziecko A"),
        akapit("c2", "dziecko B"),
      ]),
      akapit("p2", "trzeci"),
    ],
  } as BlocksDoc;
}

function zamontuj(doc: BlocksDoc = dokument()) {
  dnd.uchwyty.length = 0;
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  const onSelect = vi.fn();
  const view = render(<BlockCanvasPod doc={doc} onChange={onChange} onSelect={onSelect} />);
  return { onChange, onSelect, view };
}

// Cienka obudowa, żeby test nie powtarzał sześciu propsów przy każdym renderze.
function BlockCanvasPod({
  doc,
  onChange,
  onSelect,
  activeId = null,
}: {
  doc: BlocksDoc;
  onChange: (next: BlocksDoc, immediate?: boolean) => void;
  onSelect: (id: string | null) => void;
  activeId?: string | null;
}) {
  return (
    <BlockCanvas
      doc={doc}
      activeId={activeId}
      onSelect={onSelect}
      onChange={onChange}
      selectedIds={[]}
      onSelectedIdsChange={() => {}}
    />
  );
}

// Import PO fabrykach `vi.mock` czyta już podmieniony @dnd-kit/core.
const { BlockCanvas } = await import("../BlockCanvas");

function idy(doc: BlocksDoc): string[] {
  return doc.blocks.map((b) => b.id);
}

describe("BlockCanvas - upuszczenie bloku (stróże przed utratą treści)", () => {
  it("upuszczenie bloku NA SIEBIE nie zmienia dokumentu", () => {
    const { onChange } = zamontuj();
    dnd.uchwyty[0]({ active: { id: "p1" }, over: { id: "p1" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("upuszczenie poza jakikolwiek cel (over === null) nie zmienia dokumentu", () => {
    const { onChange } = zamontuj();
    dnd.uchwyty[0]({ active: { id: "p1" }, over: null });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("upuszczenie kontenera na WŁASNE DZIECKO nie tworzy cyklu ani nie gubi bloków", () => {
    const { onChange } = zamontuj();
    // g1 jest rodzicem c1. Gdyby handler potraktował c1 jak pozycję listy
    // najwyższego poziomu, kontener trafiłby do swojego wnętrza.
    dnd.uchwyty[0]({ active: { id: "g1" }, over: { id: "c1" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("upuszczenie na id, którego nie ma w dokumencie, nie zmienia dokumentu", () => {
    const { onChange } = zamontuj();
    dnd.uchwyty[0]({ active: { id: "p1" }, over: { id: "duch" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("prawidłowa zmiana kolejności przestawia blok i NIE gubi żadnego (kontrola dodatnia)", () => {
    const { onChange } = zamontuj();
    dnd.uchwyty[0]({ active: { id: "p2" }, over: { id: "p1" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next, immediate] = onChange.mock.calls[0];
    expect(idy(next)).toEqual(["p2", "p1", "g1"]);
    // `immediate` = zapis bez debounce'u; przestawienie bloku to gest jawny.
    expect(immediate).toBe(true);
  });

  it("kanwa zagnieżdżona ma OSOBNY DndContext - konteksty @dnd-kit są rozłączne", () => {
    zamontuj();
    // Dwa konteksty: kanwa główna + mini-kanwa kontenera `group`.
    expect(dnd.uchwyty.length).toBeGreaterThanOrEqual(2);
    expect(dnd.uchwyty[0]).not.toBe(dnd.uchwyty[1]);
  });
});

describe("NestedBlocksEditor - upuszczenie dziecka kontenera", () => {
  it("dziecko upuszczone na siebie nie zmienia kontenera", () => {
    const { onChange } = zamontuj();
    dnd.uchwyty[1]({ active: { id: "c1" }, over: { id: "c1" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dziecko upuszczone na id z INNEGO poziomu drzewa nie zmienia kontenera", () => {
    const { onChange } = zamontuj();
    // p1 jest blokiem najwyższego poziomu - dla kanwy zagnieżdżonej nie istnieje.
    dnd.uchwyty[1]({ active: { id: "c1" }, over: { id: "p1" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("zmiana kolejności dzieci trafia do dokumentu przez data.children", () => {
    const { onChange } = zamontuj();
    dnd.uchwyty[1]({ active: { id: "c2" }, over: { id: "c1" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    const kontener = next.blocks.find((b) => b.id === "g1");
    expect(kontener).toBeDefined();
    expect(readChildBlocks(kontener!.data, "children").map((b) => b.id)).toEqual(["c2", "c1"]);
    // Poziom główny nietknięty - gest w kontenerze nie rusza kanwy.
    expect(idy(next)).toEqual(["p1", "g1", "p2"]);
  });
});

// Pasek akcji `SortableBlockItem` ma `aria-hidden` dopóki blok NIE JEST
// aktywny, więc drzewo dostępności widzi tylko toolbar bloku aktywnego - i to
// jest właśnie sposób adresowania przycisków bez indeksowania po DOM-ie.
// (Mini-kanwa kontenera ma własny, zawsze widoczny pasek - dlatego blok pod
// testem musi być aktywny, inaczej pierwszym trafieniem byłby wiersz dziecka.)
function zamontujAktywny(activeId: string) {
  dnd.uchwyty.length = 0;
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  const onSelect = vi.fn();
  render(
    <BlockCanvasPod doc={dokument()} onChange={onChange} onSelect={onSelect} activeId={activeId} />,
  );
  return { onChange, onSelect };
}

/**
 * Przycisk z paska akcji KONKRETNEGO bloku top-level. `data-widget-toolbar`
 * nosi wyłącznie pasek `SortableBlockItem`, więc zawężenie nim odcina paski
 * wierszy mini-kanwy, które leżą w tym samym poddrzewie DOM.
 */
function przyciskAkcji(blockId: string, nazwa: string): HTMLElement {
  const blok = document.querySelector(`[data-block-id="${blockId}"]`);
  const pasek = blok?.querySelector('[data-widget-toolbar="block"]');
  if (!(pasek instanceof HTMLElement)) throw new Error(`brak paska akcji bloku ${blockId}`);
  return within(pasek).getByRole("button", { name: nazwa });
}

describe("BlockCanvas - pasek akcji bloku (SortableBlockItem)", () => {
  it("pasek akcji NIEaktywnego bloku jest poza drzewem dostępności", () => {
    zamontuj();
    // Widoczne są wyłącznie paski wierszy mini-kanwy (kontener `group`).
    // Gdyby paski bloków top-level były w drzewie, byłoby ich sześć.
    expect(screen.getAllByRole("button", { name: t("blocks.actions.remove") })).toHaveLength(2);
  });

  it("strzałka w dół przenosi blok o jedną pozycję", () => {
    const { onChange } = zamontujAktywny("p1");
    fireEvent.click(przyciskAkcji("p1", t("blocks.actions.down")));
    expect(idy(onChange.mock.calls[0][0])).toEqual(["g1", "p1", "p2"]);
  });

  it("strzałka w górę na PIERWSZYM bloku jest wyłączona", () => {
    zamontujAktywny("p1");
    expect(przyciskAkcji("p1", t("blocks.actions.up"))).toBeDisabled();
  });

  it("strzałka w dół na OSTATNIM bloku jest wyłączona", () => {
    zamontujAktywny("p2");
    expect(przyciskAkcji("p2", t("blocks.actions.down"))).toBeDisabled();
  });

  it("duplikat wstawia kopię ZA oryginałem i nadaje jej nowe id", () => {
    const { onChange } = zamontujAktywny("p1");
    fireEvent.click(przyciskAkcji("p1", t("blocks.actions.duplicate")));
    const next = onChange.mock.calls[0][0];
    expect(next.blocks).toHaveLength(4);
    expect(next.blocks[1].type).toBe("paragraph");
    expect(next.blocks[1].id).not.toBe("p1");
    expect(next.blocks[1].data.html).toBe(next.blocks[0].data.html);
  });

  it("duplikat kontenera nadaje świeże id TAKŻE dzieciom (kopia nie dzieli id)", () => {
    const { onChange } = zamontujAktywny("g1");
    fireEvent.click(przyciskAkcji("g1", t("blocks.actions.duplicate")));
    const next = onChange.mock.calls[0][0];
    const kopia = next.blocks[2];
    expect(kopia.id).not.toBe("g1");
    const dzieci = readChildBlocks(kopia.data, "children").map((b) => b.id);
    expect(dzieci).toHaveLength(2);
    expect(dzieci).not.toContain("c1");
    expect(dzieci).not.toContain("c2");
    // Treść kopii jest ta sama - świeże id, nie świeży (pusty) blok.
    expect(readChildBlocks(kopia.data, "children")[0].data.html).toBe("<p>dziecko A</p>");
  });

  it("kosz usuwa blok z dokumentu i czyści zaznaczenie aktywnego", () => {
    const { onChange, onSelect } = zamontujAktywny("p1");
    fireEvent.click(przyciskAkcji("p1", t("blocks.actions.remove")));
    expect(idy(onChange.mock.calls[0][0])).toEqual(["g1", "p2"]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe("BlockCanvas - skróty klawiaturowe zaznaczenia", () => {
  it("Ctrl+Shift+D duplikuje AKTYWNY blok", () => {
    dnd.uchwyty.length = 0;
    const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
    render(
      <BlockCanvasPod doc={dokument()} onChange={onChange} onSelect={() => {}} activeId="p1" />,
    );
    fireEvent.keyDown(document, { key: "d", ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].blocks).toHaveLength(4);
  });

  it("Ctrl+Shift+D bez aktywnego bloku i bez zaznaczenia nie robi nic", () => {
    const { onChange } = zamontuj();
    fireEvent.keyDown(document, { key: "d", ctrlKey: true, shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Ctrl+A poza treścią zaznacza WSZYSTKIE bloki najwyższego poziomu", () => {
    dnd.uchwyty.length = 0;
    const onIds = vi.fn<(ids: readonly string[]) => void>();
    render(
      <BlockCanvas
        doc={dokument()}
        activeId={null}
        onSelect={() => {}}
        onChange={() => {}}
        selectedIds={[]}
        onSelectedIdsChange={onIds}
      />,
    );
    fireEvent.keyDown(document, { key: "a", ctrlKey: true });
    expect(onIds).toHaveBeenCalled();
    // Dzieci kontenera NIE wchodzą do zaznaczenia blokowego.
    expect(onIds.mock.calls.at(-1)?.[0]).toEqual(["p1", "g1", "p2"]);
  });

  it("Delete przy zaznaczeniu wielokrotnym usuwa zaznaczone bloki", () => {
    dnd.uchwyty.length = 0;
    const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
    render(
      <BlockCanvas
        doc={dokument()}
        activeId={null}
        onSelect={() => {}}
        onChange={onChange}
        selectedIds={["p1", "p2"]}
        onSelectedIdsChange={() => {}}
      />,
    );
    fireEvent.keyDown(document, { key: "Delete" });
    expect(idy(onChange.mock.calls[0][0])).toEqual(["g1"]);
  });
});

describe("BlockCanvas - pusty dokument", () => {
  it("pusty dokument pokazuje wiersz dopisania i wstawia akapit na pozycję 0", () => {
    dnd.uchwyty.length = 0;
    const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
    render(
      <BlockCanvas
        doc={{ version: 1, blocks: [] } as BlocksDoc}
        activeId={null}
        onSelect={() => {}}
        onChange={onChange}
        selectedIds={[]}
        onSelectedIdsChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("blocks.slash.hint") }));
    const next = onChange.mock.calls[0][0];
    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0].type).toBe("paragraph");
  });
});

// ── PUNKTY WSTAWIANIA: KTORY INSERTER, TAKA POZYCJA ─────────────────────────
// Kanwa ma TRZY osobne wejscia dla nowej tresci i kazde niesie wlasny indeks:
// inserter nad pierwszym blokiem (0), inserter pod blokiem n-tym (n+1) oraz
// appender na koncu dokumentu (`blocks.length`). Kazde z nich ma dodatkowo
// dwie sciezki: JEDEN blok (`insertAt`) i WZORZEC, czyli wiele blokow naraz
// (`insertBlocksAt`). Pomylony indeks nie zglasza sie bledem - po prostu
// przenosi tresc redaktora w inne miejsce dokumentu, niz wskazal.
/** Dwa akapity - dokument bez kontenera, zeby indeksy insererow byly jawne. */
function dwaAkapity(): BlocksDoc {
  return { version: 1, blocks: [akapit("p1", "pierwszy"), akapit("p2", "drugi")] } as BlocksDoc;
}

function zamontujKanwe(doc: BlocksDoc, activeId: string | null = null, selectedIds: string[] = []) {
  dnd.uchwyty.length = 0;
  const onChange = vi.fn<(next: BlocksDoc, immediate?: boolean) => void>();
  const onSelect = vi.fn<(id: string | null) => void>();
  const onSelectedIdsChange = vi.fn<(ids: readonly string[]) => void>();
  render(
    <BlockCanvas
      doc={doc}
      activeId={activeId}
      onSelect={onSelect}
      onChange={onChange}
      selectedIds={selectedIds}
      onSelectedIdsChange={onSelectedIdsChange}
    />,
  );
  return { onChange, onSelect, onSelectedIdsChange };
}

/**
 * Kolejny „+" kanwy w kolejnosci renderowania: [0] nad pierwszym blokiem,
 * [1..n] pod kolejnymi blokami, [n+1] appender na koncu dokumentu.
 */
function plus(idx: number): HTMLElement {
  return screen.getAllByRole("button", { name: t("blocks.addBlock") })[idx];
}

/** Otwiera wskazany „+" i wybiera z niego wzorzec „Kluczowe wnioski". */
function wstawWzorzec(idx: number): void {
  fireEvent.click(plus(idx));
  fireEvent.click(screen.getByRole("button", { name: t("blocks.inserter.browseAll") }));
  fireEvent.click(screen.getByRole("tab", { name: t("blocks.inserter.tabPatterns") }));
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp(t("blocks.patterns.items.key-takeaways.name")),
    }),
  );
}

/** Otwiera wskazany „+" i wybiera z szybkiej palety blok o danym typie. */
function wstawTyp(idx: number, typ: string): void {
  fireEvent.click(plus(idx));
  fireEvent.click(screen.getByRole("option", { name: t(`blocks.types.${typ}`) }));
}

describe("BlockCanvas - punkty wstawiania nowej tresci", () => {
  it("inserter NAD pierwszym blokiem wstawia na pozycję zero", () => {
    const { onChange, onSelect } = zamontujKanwe(dwaAkapity());
    wstawTyp(0, "quote");
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["quote", "paragraph", "paragraph"]);
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("inserter NAD pierwszym blokiem przyjmuje CAŁY wzorzec", () => {
    const { onChange, onSelect } = zamontujKanwe(dwaAkapity());
    wstawWzorzec(0);
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["heading", "list", "paragraph", "paragraph"]);
    // Zaznaczenie idzie na OSTATNI wstawiony blok - tam redaktor pisze dalej.
    expect(onSelect).toHaveBeenCalledWith(next.blocks[1].id);
  });

  it("inserter POD pierwszym blokiem wstawia dokładnie za nim", () => {
    const { onChange } = zamontujKanwe(dwaAkapity());
    wstawTyp(1, "separator");
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.id)).toEqual(["p1", expect.any(String), "p2"]);
    expect(next.blocks[1].type).toBe("separator");
  });

  it("inserter POD pierwszym blokiem przyjmuje wzorzec między bloki", () => {
    const { onChange } = zamontujKanwe(dwaAkapity());
    wstawWzorzec(1);
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "list", "paragraph"]);
    expect(next.blocks[0].id).toBe("p1");
    expect(next.blocks[3].id).toBe("p2");
  });

  it("appender pod ostatnim blokiem dokłada akapit na KONIEC dokumentu", () => {
    const { onChange, onSelect } = zamontujKanwe(dwaAkapity());
    fireEvent.click(screen.getByRole("button", { name: t("blocks.slash.hint") }));
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.id).slice(0, 2)).toEqual(["p1", "p2"]);
    expect(next.blocks).toHaveLength(3);
    expect(next.blocks[2].type).toBe("paragraph");
    expect(onSelect).toHaveBeenCalledWith(next.blocks[2].id);
  });

  it("appender pod ostatnim blokiem wstawia wybrany typ na KONIEC", () => {
    const { onChange } = zamontujKanwe(dwaAkapity());
    // Insertery: [0] nad p1, [1] pod p1, [2] pod p2, [3] appender.
    wstawTyp(3, "quote");
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "quote"]);
  });

  it("appender pod ostatnim blokiem przyjmuje wzorzec na KONIEC", () => {
    const { onChange } = zamontujKanwe(dwaAkapity());
    wstawWzorzec(3);
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "heading", "list"]);
  });

  it("blok NIETEKSTOWY zostaje zaznaczony, choć nie ma w nim gdzie pisać", () => {
    // `insertAt` prosi o karetkę TYLKO dla typów, w których da się pisać.
    // Separator zaznacza się jako blok - i na tym operacja się kończy.
    const { onChange, onSelect } = zamontujKanwe(dwaAkapity());
    wstawTyp(2, "separator");
    const [next] = onChange.mock.calls.at(-1)!;
    const wstawiony = next.blocks[2];
    expect(wstawiony.type).toBe("separator");
    expect(onSelect).toHaveBeenCalledWith(wstawiony.id);
  });

  it("PUSTY dokument przyjmuje blok wybrany z appendera", () => {
    const { onChange, onSelect } = zamontujKanwe({ version: 1, blocks: [] } as BlocksDoc);
    wstawTyp(0, "quote");
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["quote"]);
    expect(onSelect).toHaveBeenCalledWith(next.blocks[0].id);
  });

  it("PUSTY dokument przyjmuje CAŁY wzorzec z appendera", () => {
    const { onChange } = zamontujKanwe({ version: 1, blocks: [] } as BlocksDoc);
    wstawWzorzec(0);
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks.map((b) => b.type)).toEqual(["heading", "list"]);
  });
});

// ── ZAZNACZENIE WIELOKROTNE: DUPLIKAT, USUNIECIE WSZYSTKIEGO, ODMOWY ────────
describe("BlockCanvas - zaznaczenie wielokrotne w skrotach", () => {
  it("Ctrl+Shift+D duplikuje CAŁE zaznaczenie i przenosi je na kopie", () => {
    const { onChange, onSelectedIdsChange } = zamontujKanwe(dwaAkapity(), null, ["p1", "p2"]);
    fireEvent.keyDown(document, { key: "d", ctrlKey: true, shiftKey: true });
    const [next] = onChange.mock.calls.at(-1)!;
    // Kopie lądują ZA ostatnim duplikowanym blokiem, ze świeżymi id.
    expect(next.blocks.map((b) => b.id).slice(0, 2)).toEqual(["p1", "p2"]);
    expect(next.blocks).toHaveLength(4);
    expect(next.blocks[2].id).not.toBe("p1");
    expect(next.blocks[3].id).not.toBe("p2");
    // Zaznaczenie przechodzi na ZAKRES kopii - kolejny gest dotyczy już ich.
    expect(onSelectedIdsChange).toHaveBeenCalledWith([next.blocks[2].id, next.blocks[3].id]);
  });

  it("Ctrl+Shift+D przy aktywnym id, którego NIE MA w dokumencie, nie zmienia niczego", () => {
    // Stare `activeId` (blok usunięty w innym miejscu UI) nie może wstawić
    // do dokumentu kopii nieistniejącego bloku ani wywrócić skrótu.
    const { onChange } = zamontujKanwe(dwaAkapity(), "duch-po-usunietym-bloku");
    fireEvent.keyDown(document, { key: "d", ctrlKey: true, shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Delete przy zaznaczeniu WSZYSTKIEGO zostawia dokument bez bloków", () => {
    // Skrajny przypadek `removeSelected`: po filtrze nie zostaje nic, więc
    // kanwa musi oddać PUSTĄ listę bloków (i pokazać stan pusty), a nie
    // wersję z resztkami po zaznaczeniu.
    const { onChange, onSelect } = zamontujKanwe(dwaAkapity(), "p1", ["p1", "p2"]);
    fireEvent.keyDown(document, { key: "Delete" });
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toEqual([]);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("Backspace przy zaznaczeniu wielokrotnym usuwa je tak samo jak Delete", () => {
    const { onChange } = zamontujKanwe(dwaAkapity(), null, ["p1"]);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(idy(onChange.mock.calls.at(-1)![0])).toEqual(["p2"]);
  });
});

// ── USUNIECIE Z MENU KONTEKSTOWEGO: BLOK NIEAKTYWNY ────────────────────────
describe("BlockCanvas - usuniecie bloku spoza aktywnego", () => {
  it("kosz z menu kontekstowego NIEaktywnego bloku nie gasi aktywnego", async () => {
    // Pasek akcji ma tylko blok aktywny, ale menu kontekstowe jest na KAZDYM
    // wierszu - stąd jedyna droga do usunięcia bloku, który nie jest aktywny.
    // Kanwa nie może wtedy zerować zaznaczenia: redaktor dalej pisze tam,
    // gdzie pisał.
    const { onChange, onSelect } = zamontujKanwe(dwaAkapity(), "p1");
    fireEvent.contextMenu(
      document.querySelector('[data-block-canvas] [data-block-id="p2"]') as Element,
    );
    const menu = await waitFor(() => screen.getByRole("menu"));
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: new RegExp(t("blocks.actions.remove")) }),
    );
    expect(idy(onChange.mock.calls.at(-1)![0])).toEqual(["p1"]);
    expect(onSelect).not.toHaveBeenCalledWith(null);
  });
});

// ── TYP BLOKU SPOZA KATALOGU ───────────────────────────────────────────────
describe("BlockCanvas - blok o typie spoza rejestru", () => {
  /** Dokument z wpisu zapisanego przez NOWSZA wersje edytora (albo z importu). */
  function dokumentZObcymTypem(): BlocksDoc {
    return {
      version: 1,
      blocks: [{ id: "x1", type: "widget-z-przyszlosci", data: {} }],
    } as unknown as BlocksDoc;
  }

  it("nieznany typ NIE wywraca kanwy - blok zostaje w dokumencie z podglądem zastępczym", () => {
    // Wpis zapisany nowszą wersją edytora musi dać się otworzyć: alternatywą
    // jest biały ekran i redaktor bez dostępu do własnej treści.
    zamontujKanwe(dokumentZObcymTypem(), "x1");
    expect(document.querySelector('[data-block-id="x1"]')).not.toBeNull();
    expect(screen.getByText("[widget-z-przyszlosci]")).toBeInTheDocument();
  });

  it("nieznany typ nie dostaje menu przekształceń ani wariantów", () => {
    zamontujKanwe(dokumentZObcymTypem(), "x1");
    expect(screen.queryByRole("button", { name: t("blocks.transform.menuLabel") })).toBeNull();
    expect(screen.queryByRole("group", { name: t("blocks.actions.variant") })).toBeNull();
  });

  it("nieznany typ opisuje się w menu kontekstowym SUROWĄ nazwą typu", async () => {
    // Etykieta z rejestru nie istnieje, więc jedyne, co kanwa moze pokazac, to
    // sam typ - i to jest informacja, ktora pozwala redaktorowi zglosic problem.
    zamontujKanwe(dokumentZObcymTypem(), "x1");
    fireEvent.contextMenu(
      document.querySelector('[data-block-canvas] [data-block-id="x1"]') as Element,
    );
    const menu = await waitFor(() => screen.getByRole("menu"));
    expect(within(menu).getByText(/widget-z-przyszlosci/)).toBeInTheDocument();
  });
});

// ── UNIWERSALNY PASEK WIDGETU PODWIESZONY W KANWIE ─────────────────────────
// Bloki spoza `OWN_TOOLBAR_TYPES` (czyli cala reszta katalogu poza akapitem,
// naglowkiem, obrazem, wideo i audio) dostaja `GenericWidgetToolbar`. Sam pasek
// ma wlasny plik testowy; tutaj przedmiotem dowodu jest JEGO PODLACZENIE do
// kanwy: ktory blok dokumentu dostaje zapis z paska.
describe("BlockCanvas - pasek uniwersalny widgetu", () => {
  it("ustawienie z paska pisze WYŁĄCZNIE do aktywnego bloku", () => {
    const cytat = { id: "q1", type: "quote", data: { text: "Europa", cite: "" } } as Block;
    const sasiad = akapit("p2", "drugi");
    const { onChange } = zamontujKanwe({ version: 1, blocks: [cytat, sasiad] } as BlocksDoc, "q1");
    const pasek = document.querySelector('[data-widget-toolbar="generic"]');
    expect(pasek).not.toBeNull();
    fireEvent.click(
      within(pasek as HTMLElement).getByRole("button", { name: t("blocks.toolbar.alignCenter") }),
    );
    const [next] = onChange.mock.calls.at(-1)!;
    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0].data.align).toBe("center");
    // Treść cytatu przechodzi ustawienie bez zmian, sąsiad wraca tym samym obiektem.
    expect(next.blocks[0].data.text).toBe("Europa");
    expect(next.blocks[1]).toBe(sasiad);
  });

  it("pasek uniwersalny nie pojawia się przy bloku NIEaktywnym", () => {
    const cytat = { id: "q1", type: "quote", data: { text: "Europa", cite: "" } } as Block;
    zamontujKanwe({ version: 1, blocks: [cytat] } as BlocksDoc, null);
    expect(document.querySelector('[data-widget-toolbar="generic"]')).toBeNull();
  });
});
