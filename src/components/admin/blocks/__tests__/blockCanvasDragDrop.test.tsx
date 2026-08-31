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
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { readChildBlocks } from "@/lib/blocks/nested";
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
      {
        id: "g1",
        type: "group",
        data: { children: [akapit("c1", "dziecko A"), akapit("c2", "dziecko B")] },
      } as Block,
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
