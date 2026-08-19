// Reguły drzewa menu - najgęstsza logika modułu chrome, do 18.08.2026
// zamknięta w domknięciach `setItems(...)` wewnątrz komponentu na 1545 linii
// i przez to na okrągłym ZERZE pokrycia.
//
// Co te asercje pilnują, a czego nie pilnuje nic innego:
//   * hierarchia menu jest KONTRAKTEM NAWIGACJI całego serwisu - błąd tutaj
//     nie psuje jednego ekranu, tylko nagłówek każdej strony,
//   * zapis jest destrukcyjny (delete-all + insert-all), więc pozycja zgubiona
//     przez regułę drzewa znika Z BAZY przy pierwszym „Zapisz",
//   * limit poziomów i ochrona przed cyklem to jedyne, co dzieli edytor od
//     nieskończonej rekurencji przy przeciąganiu myszą.
import { describe, expect, it, vi } from "vitest";
import {
  MAX_MENU_DEPTH,
  appendMenuItems,
  buildMenuTree,
  depthOf,
  descendantIds,
  dropZoneForOffset,
  indentMenuItem,
  moveMenuItem,
  outdentMenuItem,
  parentToExpandOnIndent,
  removeMenuSubtree,
  toSavePayload,
  updateMenuItemById,
  type MenuClientItem,
  type MenuTreeItem,
} from "../tree";
import { DEFAULT_MEGA_CONFIG } from "../types";

/** Minimalna pozycja - reguły drzewa czytają wyłącznie te trzy pola. */
function node(local_id: string, parent_local_id: string | null, position: number): MenuTreeItem {
  return { local_id, parent_local_id, position };
}

/** Pełna pozycja modelu klienta - dla reguł, które dotykają treści. */
function clientItem(over: Partial<MenuClientItem> & { local_id: string }): MenuClientItem {
  return {
    parent_local_id: null,
    position: 0,
    item_type: "custom",
    ref_id: null,
    label_pl: "",
    label_en: "",
    href: "",
    target: "_self",
    css_class: "",
    icon: "",
    mega_enabled: false,
    mega_config: DEFAULT_MEGA_CONFIG,
    ...over,
  };
}

/** Płaski podgląd drzewa: „id(dzieci)" - czytelniejszy w asercji niż zagnieżdżenie. */
function shape(nodes: ReturnType<typeof buildMenuTree<MenuTreeItem>>): string {
  return nodes
    .map((n) => (n.children.length ? `${n.item.local_id}(${shape(n.children)})` : n.item.local_id))
    .join(",");
}

/** Rodzeństwo danego rodzica w kolejności `position` - do asercji porządku. */
function order(items: readonly MenuTreeItem[], parent: string | null): string {
  return items
    .filter((i) => i.parent_local_id === parent)
    .sort((a, b) => a.position - b.position)
    .map((i) => `${i.local_id}@${i.position}`)
    .join(",");
}

describe("buildMenuTree", () => {
  it("układa rodzeństwo po `position`, nie po kolejności w tablicy", () => {
    // Serwer zwraca pozycje posortowane, ale reduktory ruchu dopisują
    // przeniesioną pozycję na KONIEC tablicy - drzewo nie może tego widzieć.
    const items = [node("b", null, 1), node("a", null, 0), node("c", null, 2)];
    expect(shape(buildMenuTree(items))).toBe("a,b,c");
  });

  it("zagnieżdża trzy poziomy i sortuje każdy rząd osobno", () => {
    const items = [
      node("root", null, 0),
      node("child-2", "root", 1),
      node("child-1", "root", 0),
      node("grand", "child-1", 0),
    ];
    expect(shape(buildMenuTree(items))).toBe("root(child-1(grand),child-2)");
  });

  it("dla pustej listy zwraca puste drzewo (a nie wysypkę)", () => {
    expect(buildMenuTree([])).toEqual([]);
  });

  it("SIEROTA (rodzic spoza listy) wraca na najwyższy poziom, a nie znika", () => {
    // Do 18.08.2026 edytor gubił taką pozycję bez śladu, choć publiczne
    // `SiteMenu` pokazywało ją w nawigacji. Administrator nie mógł jej ani
    // poprawić, ani usunąć - a zapis (delete-all + insert-all) kasował ją
    // z bazy przy najbliższym kliknięciu „Zapisz".
    const items = [node("a", null, 0), node("orphan", "zniknięty-rodzic", 1)];
    expect(shape(buildMenuTree(items))).toBe("a,orphan");
  });

  it("sierota wchodzi w kolejność rzędu po swoim `position`", () => {
    const items = [node("a", null, 1), node("orphan", "duch", 0)];
    expect(shape(buildMenuTree(items))).toBe("orphan,a");
  });

  it("cykl w danych nie zawiesza budowy - pierścień po prostu nie ma korzenia", () => {
    const items = [node("a", "b", 0), node("b", "a", 0)];
    expect(buildMenuTree(items)).toEqual([]);
  });
});

describe("depthOf", () => {
  const items = [node("root", null, 0), node("mid", "root", 0), node("leaf", "mid", 0)];

  it("liczy poziomy od zera", () => {
    expect(depthOf(items, "root")).toBe(0);
    expect(depthOf(items, "mid")).toBe(1);
    expect(depthOf(items, "leaf")).toBe(2);
  });

  it("dla nieznanego identyfikatora zwraca zero, nie błąd", () => {
    expect(depthOf(items, "nie-ma-takiej")).toBe(0);
  });

  it("nie kręci się w kółko na cyklu - bezpiecznik przerywa pętlę", () => {
    // Bez bezpiecznika ta linia wiesza proces testowy, a w produkcji kartę.
    expect(depthOf([node("a", "b", 0), node("b", "a", 0)], "a")).toBeGreaterThan(MAX_MENU_DEPTH);
  });

  it("zatrzymuje się, gdy rodzic wypadł z listy", () => {
    expect(depthOf([node("a", "duch", 0)], "a")).toBe(1);
  });
});

describe("descendantIds", () => {
  it("zbiera pozycję razem z wnukami", () => {
    const items = [
      node("root", null, 0),
      node("mid", "root", 0),
      node("leaf", "mid", 0),
      node("obok", null, 1),
    ];
    expect([...descendantIds(items, "root")].sort()).toEqual(["leaf", "mid", "root"]);
  });

  it("kończy się na cyklu zamiast przepełnić stos", () => {
    // Wersja z komponentu nie miała tego bezpiecznika: `collect` wołał sam
    // siebie przez pierścień A->B->A aż do RangeError. Wystarczyły dwa wiersze
    // z uszkodzoną hierarchią w bazie, żeby kliknięcie „Usuń" zabiło kartę.
    const items = [node("a", "b", 0), node("b", "a", 0)];
    expect([...descendantIds(items, "a")].sort()).toEqual(["a", "b"]);
  });
});

describe("moveMenuItem", () => {
  const flat = [node("a", null, 0), node("b", null, 1), node("c", null, 2)];

  it("wstawia PRZED cel i renumeruje rząd bez dziur", () => {
    const out = moveMenuItem(flat, "c", "a", "before");
    expect(order(out, null)).toBe("c@0,a@1,b@2");
  });

  it("wstawia ZA cel", () => {
    const out = moveMenuItem(flat, "a", "b", "after");
    expect(order(out, null)).toBe("b@0,a@1,c@2");
  });

  it("upuszczenie na cel robi z pozycji jego OSTATNIE dziecko", () => {
    const items = [...flat, node("a1", "a", 0)];
    const out = moveMenuItem(items, "c", "a", "child");
    expect(order(out, "a")).toBe("a1@0,c@1");
  });

  it("upuszczenie w pustkę (`targetId === null`) wraca na najwyższy poziom", () => {
    const items = [node("root", null, 0), node("kid", "root", 0)];
    const out = moveMenuItem(items, "kid", null, "after");
    expect(order(out, null)).toBe("root@0,kid@1");
  });

  it("ODRZUCA ruch na własnego potomka - to zrobiłoby z drzewa pierścień", () => {
    const items = [node("root", null, 0), node("kid", "root", 0), node("grand", "kid", 0)];
    expect(moveMenuItem(items, "root", "grand", "child")).toBe(items);
  });

  it("ODRZUCA ruch przekraczający limit poziomów", () => {
    // MAX_MENU_DEPTH = 3, więc dziecko pozycji z poziomu 2 byłoby poziomem 4.
    const items = [
      node("l0", null, 0),
      node("l1", "l0", 0),
      node("l2", "l1", 0),
      node("wolna", null, 1),
    ];
    expect(moveMenuItem(items, "wolna", "l2", "child")).toBe(items);
  });

  it("ODRZUCA ruch nieznanej pozycji", () => {
    expect(moveMenuItem(flat, "duch", "a", "before")).toBe(flat);
  });

  it("cel spoza listy przy trybie `before` traktuje jak najwyższy poziom", () => {
    const items = [node("root", null, 0), node("kid", "root", 0)];
    const out = moveMenuItem(items, "kid", "duch", "before");
    expect(order(out, null)).toBe("root@0,kid@1");
  });

  it("nie mutuje wejścia", () => {
    const items = [node("a", null, 0), node("b", null, 1)];
    const snapshot = JSON.stringify(items);
    moveMenuItem(items, "b", "a", "before");
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});

describe("indentMenuItem", () => {
  it("robi z pozycji ostatnie dziecko poprzedniego rodzeństwa", () => {
    const items = [node("a", null, 0), node("b", null, 1), node("a1", "a", 0)];
    const out = indentMenuItem(items, "b");
    expect(order(out, "a")).toBe("a1@0,b@1");
    expect(order(out, null)).toBe("a@0");
  });

  it("PIERWSZA pozycja rzędu nie ma się pod co podpiąć", () => {
    const items = [node("a", null, 0), node("b", null, 1)];
    expect(indentMenuItem(items, "a")).toBe(items);
  });

  it("nie przekracza limitu poziomów", () => {
    const items = [
      node("l0", null, 0),
      node("l1", "l0", 0),
      node("l2a", "l1", 0),
      node("l2b", "l1", 1),
    ];
    expect(indentMenuItem(items, "l2b")).toBe(items);
  });

  it("nieznana pozycja nie rusza listy", () => {
    const items = [node("a", null, 0)];
    expect(indentMenuItem(items, "duch")).toBe(items);
  });
});

describe("parentToExpandOnIndent", () => {
  it("wskazuje gałąź, którą trzeba rozwinąć, żeby wcięta pozycja była widoczna", () => {
    const items = [node("a", null, 0), node("b", null, 1)];
    expect(parentToExpandOnIndent(items, "b")).toBe("a");
  });

  it("zwraca null, gdy wcięcie i tak nie miałoby skutku", () => {
    const items = [node("a", null, 0), node("b", null, 1)];
    expect(parentToExpandOnIndent(items, "a")).toBeNull();
    expect(parentToExpandOnIndent(items, "duch")).toBeNull();
  });
});

describe("outdentMenuItem", () => {
  it("wyprowadza pozycję TUŻ ZA jej dotychczasowego rodzica", () => {
    // „Tuż za", nie „na koniec rzędu" - inaczej pozycja gubi sąsiedztwo,
    // w którym redaktor ją zostawił.
    const items = [node("a", null, 0), node("b", null, 1), node("a1", "a", 0), node("a2", "a", 1)];
    const out = outdentMenuItem(items, "a1");
    expect(order(out, null)).toBe("a@0,a1@1,b@2");
    expect(order(out, "a")).toBe("a2@0");
  });

  it("pozycja najwyższego poziomu nie ma dokąd wyjść", () => {
    const items = [node("a", null, 0)];
    expect(outdentMenuItem(items, "a")).toBe(items);
  });

  it("nie rusza pozycji, której rodzic wypadł z listy", () => {
    const items = [node("sierota", "duch", 0)];
    expect(outdentMenuItem(items, "sierota")).toBe(items);
  });

  it("nieznana pozycja nie rusza listy", () => {
    const items = [node("a", null, 0)];
    expect(outdentMenuItem(items, "duch")).toBe(items);
  });

  it("z trzeciego poziomu schodzi na drugi, za swojego rodzica", () => {
    const items = [
      node("l0", null, 0),
      node("l1a", "l0", 0),
      node("l1b", "l0", 1),
      node("l2", "l1a", 0),
    ];
    const out = outdentMenuItem(items, "l2");
    expect(order(out, "l0")).toBe("l1a@0,l2@1,l1b@2");
  });
});

describe("removeMenuSubtree", () => {
  it("kasuje pozycję razem z dziećmi i wnukami", () => {
    const items = [
      node("a", null, 0),
      node("a1", "a", 0),
      node("a1x", "a1", 0),
      node("b", null, 1),
    ];
    expect(removeMenuSubtree(items, "a").map((i) => i.local_id)).toEqual(["b"]);
  });

  it("kasowanie nieistniejącej pozycji zostawia listę bez zmian", () => {
    const items = [node("a", null, 0)];
    expect(removeMenuSubtree(items, "duch").map((i) => i.local_id)).toEqual(["a"]);
  });
});

describe("updateMenuItemById", () => {
  it("zmienia wyłącznie wskazaną pozycję", () => {
    const items = [
      clientItem({ local_id: "a", label_pl: "Blog" }),
      clientItem({ local_id: "b", label_pl: "O nas" }),
    ];
    const out = updateMenuItemById(items, "a", { label_pl: "Analizy" });
    expect(out.map((i) => i.label_pl)).toEqual(["Analizy", "O nas"]);
  });
});

describe("appendMenuItems", () => {
  it("dokłada pozycje na koniec NAJWYŻSZEGO poziomu, numerując po kolei", () => {
    // Licznik idzie po pozycjach najwyższego poziomu, nie po całej liście -
    // inaczej dodanie pozycji do menu z zagnieżdżeniami zostawiało dziurę
    // w numeracji i porządek rzędu zależał od liczby wnuków.
    const existing = [
      clientItem({ local_id: "a" }),
      clientItem({ local_id: "a1", parent_local_id: "a" }),
    ];
    const makeId = vi.fn<() => string>().mockReturnValueOnce("n1").mockReturnValueOnce("n2");
    const out = appendMenuItems(
      existing,
      [
        { item_type: "page", ref_id: "p1", label_pl: "Kontakt", label_en: "Contact", href: "/k" },
        { item_type: "tag", ref_id: "t1", label_pl: "UE", label_en: "EU", href: "/tag/ue" },
      ],
      makeId,
    );
    expect(order(out, null)).toBe("a@0,n1@1,n2@2");
    expect(out.at(-1)).toMatchObject({
      item_type: "tag",
      ref_id: "t1",
      href: "/tag/ue",
      target: "_self",
      mega_enabled: false,
      mega_config: DEFAULT_MEGA_CONFIG,
    });
  });

  it("bez ładunków zwraca listę o tej samej treści", () => {
    const existing = [clientItem({ local_id: "a" })];
    expect(appendMenuItems(existing, [], () => "x")).toEqual(existing);
  });
});

describe("toSavePayload", () => {
  /** Etykieta zastępcza zawsze w obu językach - patrz test o wycieku języka panelu. */
  const FALLBACK = { pl: "Pozycja bez nazwy", en: "Untitled item" };

  it("pustą etykietę zastępuje adresem - schemat wymaga niepustej nazwy", () => {
    const payload = toSavePayload([clientItem({ local_id: "a", href: "/analizy" })], FALLBACK);
    expect(payload[0].label_pl).toBe("/analizy");
    // Adres wystarczy za nazwę, więc `label_en` zostaje puste - pustka w tej
    // kolumnie znaczy „dziedzicz z polskiej", a nie „brak nazwy".
    expect(payload[0].label_en).toBe("");
  });

  it("bez etykiety i bez adresu wchodzi etykieta zastępcza ZE SŁOWNIKA", () => {
    // Ta wartość ląduje W BAZIE i pokaże się czytelnikowi w nawigacji, więc
    // nie może być napisem zaszytym w module - podaje ją wywołujący.
    const payload = toSavePayload([clientItem({ local_id: "a" })], FALLBACK);
    expect(payload[0].label_pl).toBe("Pozycja bez nazwy");
  });

  it("etykieta zastępcza wchodzi do KAŻDEJ kolumny w swoim języku", () => {
    // Regresja: jeden napis dla obu kolumn oznaczał, że język panelu
    // administratora decyduje o tym, co zobaczy czytelnik. Panel po angielsku
    // wpisywał „Untitled item" do `label_pl`, więc polskie menu serwisu
    // pokazywało angielski napis.
    const payload = toSavePayload([clientItem({ local_id: "a" })], FALLBACK);
    expect(payload[0]).toMatchObject({
      label_pl: "Pozycja bez nazwy",
      label_en: "Untitled item",
    });
  });

  it("nazwa z drugiego języka wygrywa z etykietą zastępczą", () => {
    // Kolejność źródeł jest ta sama, co przy czytaniu (`pickMenuLabel`):
    // „Reports" w polskim menu niesie więcej niż „Pozycja bez nazwy".
    const payload = toSavePayload([clientItem({ local_id: "a", label_en: "Reports" })], FALLBACK);
    expect(payload[0]).toMatchObject({ label_pl: "Reports", label_en: "Reports" });
  });

  it("przenosi hierarchię i całą treść pozycji", () => {
    const payload = toSavePayload(
      [
        clientItem({ local_id: "a", label_pl: "Blog", label_en: "Blog", href: "/blog" }),
        clientItem({
          local_id: "a1",
          parent_local_id: "a",
          position: 3,
          label_pl: "Analizy",
          item_type: "category",
          ref_id: "c1",
          target: "_blank",
          css_class: "wyróżniony",
          icon: "star",
          mega_enabled: true,
        }),
      ],
      FALLBACK,
    );
    expect(payload[1]).toMatchObject({
      local_id: "a1",
      parent_local_id: "a",
      position: 3,
      item_type: "category",
      ref_id: "c1",
      target: "_blank",
      css_class: "wyróżniony",
      icon: "star",
      mega_enabled: true,
    });
  });
});

describe("dropZoneForOffset", () => {
  it("górna i dolna krawędź wiersza wstawiają obok, środek zagnieżdża", () => {
    expect(dropZoneForOffset(0.1, 0)).toBe("before");
    expect(dropZoneForOffset(0.5, 0)).toBe("child");
    expect(dropZoneForOffset(0.9, 0)).toBe("after");
  });

  it("na ostatnim dozwolonym poziomie środek degraduje do „za”", () => {
    // Inaczej UI zapraszałby do ruchu, który reduktor i tak odrzuci - kursor
    // pokazywał „upuść jako dziecko", a po puszczeniu nic się nie działo.
    expect(dropZoneForOffset(0.5, MAX_MENU_DEPTH - 1)).toBe("after");
  });
});
