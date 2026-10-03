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
  canIndentMenuItem,
  canReparentMenuItem,
  depthOf,
  descendantIds,
  dropZoneForOffset,
  indentMenuItem,
  moveMenuItem,
  outdentMenuItem,
  parentToExpandOnIndent,
  removeMenuSubtree,
  subtreeHeight,
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
    visibility: "all" as const,
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

/**
 * Najgłębszy poziom całej listy (0 = same pozycje najwyższego rzędu). To jest
 * dokładnie liczba, której pilnuje limit: drzewo jest poprawne, gdy wynik
 * leży poniżej `MAX_MENU_DEPTH`.
 */
function maxDepth(items: readonly MenuTreeItem[]): number {
  return Math.max(0, ...items.map((i) => depthOf(items, i.local_id)));
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

describe("subtreeHeight", () => {
  it("liść ma wysokość zero", () => {
    expect(subtreeHeight([node("a", null, 0)], "a")).toBe(0);
  });

  it("łańcuch dziecko-wnuk liczy poziomy POD pozycją, nie samą pozycję", () => {
    const items = [node("root", null, 0), node("mid", "root", 0), node("leaf", "mid", 0)];
    expect(subtreeHeight(items, "root")).toBe(2);
    expect(subtreeHeight(items, "mid")).toBe(1);
    expect(subtreeHeight(items, "leaf")).toBe(0);
  });

  it("przy rozgałęzieniu wygrywa NAJGŁĘBSZA gałąź, nie liczba dzieci", () => {
    // Trzy płytkie dzieci i jedno z wnukiem: wysokość to 2 (przez wnuka),
    // a nie 3 (liczba dzieci) ani 1 (pierwsze dziecko).
    const items = [
      node("root", null, 0),
      node("k1", "root", 0),
      node("k2", "root", 1),
      node("k3", "root", 2),
      node("w", "k3", 0),
      node("obok", null, 1),
    ];
    expect(subtreeHeight(items, "root")).toBe(2);
  });

  it("nieznana pozycja ma wysokość zero, jak w `depthOf`", () => {
    expect(subtreeHeight([node("a", null, 0)], "duch")).toBe(0);
  });

  it("kończy się na cyklu zamiast przepełnić stos", () => {
    // Bez bezpiecznika rekurencja A->B->A kończy się RangeError - a liczenie
    // biegnie przy każdym chwyceniu pozycji do przeciągania.
    expect(subtreeHeight([node("a", "b", 0), node("b", "a", 0)], "a")).toBe(1);
    expect(subtreeHeight([node("a", "a", 0)], "a")).toBe(0);
  });
});

describe("canReparentMenuItem", () => {
  // root(0) > mid(1) > leaf(2), a obok płaska pozycja i gałąź z dzieckiem.
  const items = [
    node("root", null, 0),
    node("mid", "root", 0),
    node("leaf", "mid", 0),
    node("wolna", null, 1),
    node("galaz", null, 2),
    node("galaz-dziecko", "galaz", 0),
  ];

  it("liść mieści się pod pozycją z poziomu 1, gałąź z dzieckiem już nie", () => {
    expect(canReparentMenuItem(items, "wolna", "mid")).toBe(true);
    // galaz na poziomie 2, jej dziecko na poziomie 3 - czwarty poziom menu.
    expect(canReparentMenuItem(items, "galaz", "mid")).toBe(false);
  });

  it("najwyższy poziom przyjmuje każde poddrzewo mieszczące się w limicie", () => {
    expect(canReparentMenuItem(items, "mid", null)).toBe(true);
  });

  it("ruch, który NIE pogłębia zbyt głębokiego menu, przechodzi (naprawa starych danych)", () => {
    // Menu zapisane przed regułą może mieć cztery poziomy. Zakaz każdego ruchu
    // w takiej gałęzi zablokowałby redaktorowi nawet zmianę kolejności
    // rodzeństwa i wyprowadzenie gałęzi wyżej - czyli samą naprawę.
    const legacy = [
      node("l0", null, 0),
      node("l1a", "l0", 0),
      node("l1b", "l0", 1),
      node("l2", "l1a", 0),
      node("l3", "l2", 0),
    ];
    expect(canReparentMenuItem(legacy, "l1a", "l0")).toBe(true); // ten sam rząd
    expect(canReparentMenuItem(legacy, "l1a", null)).toBe(true); // wyżej
    // Pogłębienie dalej podlega limitowi, także w starym menu.
    expect(canReparentMenuItem(legacy, "l1a", "l1b")).toBe(false);
  });

  it("pozycja w pierścieniu nie korzysta z wyjątku dla ruchów w górę", () => {
    // `depthOf` w pierścieniu zwraca wartość bezpiecznika, a nie głębokość -
    // gdyby wyjątek ją przyjął, każdy ruch takiej pozycji przechodziłby bez
    // sprawdzenia poddrzewa.
    const ring = [
      node("root", null, 0),
      node("mid", "root", 0),
      node("a", "b", 0),
      node("b", "a", 0),
    ];
    expect(canReparentMenuItem(ring, "a", "mid")).toBe(false);
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

  describe("limit liczony po CAŁYM przenoszonym poddrzewie", () => {
    // root(0) > mid(1), a obok gałąź z dzieckiem oraz luźny liść.
    const items = [
      node("root", null, 0),
      node("mid", "root", 0),
      node("galaz", null, 1),
      node("galaz-dziecko", "galaz", 0),
      node("lisc", null, 2),
    ];

    it("ODRZUCA pozycję z dzieckiem upuszczoną pod pozycję z poziomu 1", () => {
      // Regresja sprzed 03.10.2026: reduktor patrzył tylko na głębokość
      // rodzica (1 + 1 < 3), więc przepuszczał ruch, po którym dziecko
      // przenoszonej pozycji lądowało na czwartym poziomie.
      expect(moveMenuItem(items, "galaz", "mid", "child")).toBe(items);
    });

    it("ten sam cel przyjmuje LIŚĆ - limit nie jest zakazem ruchu w ogóle", () => {
      const out = moveMenuItem(items, "lisc", "mid", "child");
      expect(order(out, "mid")).toBe("lisc@0");
      expect(maxDepth(out)).toBeLessThan(MAX_MENU_DEPTH);
    });

    it("upuszczenie OBOK głęboko leżącej pozycji też liczy poddrzewo", () => {
      // „Za" pozycją z poziomu 2 to ten sam poziom 2 - jej dziecko byłoby na 3.
      const deep = [...items, node("leaf", "mid", 0)];
      expect(moveMenuItem(deep, "galaz", "leaf", "after")).toBe(deep);
    });

    it("to samo poddrzewo PRZENIESIONE NA NAJWYŻSZY POZIOM przechodzi", () => {
      const nested = [
        node("root", null, 0),
        node("galaz", "root", 0),
        node("galaz-dziecko", "galaz", 0),
      ];
      const out = moveMenuItem(nested, "galaz", null, "after");
      expect(order(out, null)).toBe("root@0,galaz@1");
      // Dziecko jedzie razem z rodzicem - hierarchia poddrzewa zostaje.
      expect(out.find((i) => i.local_id === "galaz-dziecko")?.parent_local_id).toBe("galaz");
    });

    it("pozycja z dzieckiem pod pozycją z poziomu 0 mieści się w limicie", () => {
      const out = moveMenuItem(items, "galaz", "root", "child");
      expect(order(out, "root")).toBe("mid@0,galaz@1");
      expect(maxDepth(out)).toBe(MAX_MENU_DEPTH - 1);
    });

    it("w zbyt głębokim (starym) menu przestawienie rodzeństwa dalej działa", () => {
      // Serwer nie odrzuca menu głębszych niż limit, więc edytor musi umieć
      // na nich pracować - inaczej nie dałoby się nawet zmienić kolejności.
      const legacy = [
        node("l0", null, 0),
        node("l1a", "l0", 0),
        node("l1b", "l0", 1),
        node("l2", "l1a", 0),
        node("l3", "l2", 0),
      ];
      const out = moveMenuItem(legacy, "l1a", "l1b", "after");
      expect(order(out, "l0")).toBe("l1b@0,l1a@1");
    });
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

  it("ODRZUCA wcięcie, po którym WNUK przenoszonej pozycji wyszedłby poza limit", () => {
    // b(0) > b1(1) > b2(2): po wcięciu pod `a` wnuk b2 stałby na poziomie 3.
    // Do 03.10.2026 reguła patrzyła tylko na `a` (0 + 1 < 3) i przepuszczała.
    const items = [node("a", null, 0), node("b", null, 1), node("b1", "b", 0), node("b2", "b1", 0)];
    expect(indentMenuItem(items, "b")).toBe(items);
  });

  it("wcięcie pozycji z dzieckiem przechodzi, gdy całe poddrzewo się mieści", () => {
    const items = [node("a", null, 0), node("b", null, 1), node("b1", "b", 0)];
    const out = indentMenuItem(items, "b");
    expect(order(out, "a")).toBe("b@0");
    expect(order(out, "b")).toBe("b1@0");
    expect(maxDepth(out)).toBe(MAX_MENU_DEPTH - 1);
  });
});

describe("canIndentMenuItem", () => {
  it("zgadza się z reduktorem: pierwsza w rzędzie i nieznana pozycja nie mają wcięcia", () => {
    const items = [node("a", null, 0), node("b", null, 1)];
    expect(canIndentMenuItem(items, "a")).toBe(false);
    expect(canIndentMenuItem(items, "duch")).toBe(false);
    expect(canIndentMenuItem(items, "b")).toBe(true);
  });

  it("liczy poddrzewo: pozycja z wnukiem nie ma wcięcia, ta sama bez wnuka ma", () => {
    // To jest stan przycisku „wcięcie" w edytorze - do 03.10.2026 liczony
    // z samej głębokości wiersza, więc przycisk był aktywny dla ruchu, który
    // dawał czwarty poziom.
    const withGrandchild = [
      node("a", null, 0),
      node("b", null, 1),
      node("b1", "b", 0),
      node("b2", "b1", 0),
    ];
    expect(canIndentMenuItem(withGrandchild, "b")).toBe(false);
    expect(canIndentMenuItem(withGrandchild.slice(0, 3), "b")).toBe(true);
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

  it("zwraca null, gdy wcięcie blokuje limit poziomów poddrzewa", () => {
    // Odrzucone wcięcie nie może rozwijać cudzej gałęzi.
    const items = [node("a", null, 0), node("b", null, 1), node("b1", "b", 0), node("b2", "b1", 0)];
    expect(parentToExpandOnIndent(items, "b")).toBeNull();
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

  it("środek degraduje do „za”, gdy pod wierszem nie zmieści się PRZECIĄGANE poddrzewo", () => {
    // Wiersz z poziomu 1 przyjmie liść (poziom 2), ale nie pozycję z dzieckiem
    // (dziecko lądowałoby na poziomie 3).
    expect(dropZoneForOffset(0.5, 1, 0)).toBe("child");
    expect(dropZoneForOffset(0.5, 1, 1)).toBe("after");
    // Wiersz najwyższego poziomu przyjmie dziecko z dzieckiem, ale nie z wnukiem.
    expect(dropZoneForOffset(0.5, 0, 1)).toBe("child");
    expect(dropZoneForOffset(0.5, 0, 2)).toBe("after");
  });

  it("strefa „dziecko” dla poddrzewa jest DOKŁADNIE tym ruchem, który reduktor przyjmie", () => {
    // Spójność heurystyki z reduktorem: dla każdej pary (wiersz, przeciągana
    // gałąź) środek wiersza proponuje „dziecko" wtedy i tylko wtedy, gdy
    // `moveMenuItem` faktycznie wykona ten ruch.
    const items = [
      node("root", null, 0),
      node("mid", "root", 0),
      node("leaf", "mid", 0),
      node("galaz", null, 1),
      node("galaz-dziecko", "galaz", 0),
      node("lisc", null, 2),
    ];
    for (const target of ["root", "mid", "leaf"]) {
      for (const dragged of ["galaz", "lisc"]) {
        const zone = dropZoneForOffset(0.5, depthOf(items, target), subtreeHeight(items, dragged));
        const accepted = moveMenuItem(items, dragged, target, "child") !== items;
        expect(zone === "child", `${dragged} -> ${target}`).toBe(accepted);
      }
    }
  });
});
