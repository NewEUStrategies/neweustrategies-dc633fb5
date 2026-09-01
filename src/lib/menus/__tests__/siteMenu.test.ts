// Reguły PUBLICZNEJ nawigacji - do 18.08.2026 `SiteMenu.tsx` miał 0 z 47
// funkcji w pomiarze, mimo że renderuje nagłówek KAŻDEJ strony (SSR od
// pierwszego bajtu). Reguły siedziały w ciele komponentów i w anonimowym IIFE
// wewnątrz `createPortal` - żeby sprawdzić, gdzie stanie panel, trzeba było
// zamontować portal i podstawić wymiary okna.
//
// Asercje pilnują czterech rzeczy, których typy nie łapią:
//   1. co ZOBACZY czytelnik (etykieta, jej zejście na drugi język),
//   2. w JAKIM wariancie (link / dropdown / mega, razem z auto-promocją),
//   3. czy adres jest BEZPIECZNY (menu jest treścią z bazy, nie stałą w kodzie),
//   4. czy panel MIEŚCI SIĘ w oknie na wąskim ekranie.
import { describe, expect, it } from "vitest";
import {
  activeMenuIndex,
  buildPublicMenuTree,
  canonicalMenuPath,
  hasNestedChildren,
  hasPanel,
  isMenuItemVisible,
  isMenuPathActive,
  megaColumnsFor,
  megaPanelHasContent,
  menuItemHref,
  menuItemRel,
  menuItemTarget,
  mobileMegaLinks,
  panelGeometry,
  panelKindFor,
  pickMenuLabel,
  type SiteMenuNode,
} from "../siteMenu";
import { DEFAULT_MEGA_CONFIG, type MegaConfig, type MenuItemRow } from "../types";

function row(over: Partial<MenuItemRow> & { id: string }): MenuItemRow {
  return {
    menu_id: "menu-1",
    parent_id: null,
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

function treeNode(
  over: Partial<MenuItemRow> & { id: string },
  children: SiteMenuNode[] = [],
): SiteMenuNode {
  return { ...row(over), children };
}

function megaConfig(over: Partial<MegaConfig>): MegaConfig {
  return { ...DEFAULT_MEGA_CONFIG, ...over };
}

function shape(nodes: SiteMenuNode[]): string {
  return nodes.map((n) => (n.children.length ? `${n.id}(${shape(n.children)})` : n.id)).join(",");
}

describe("buildPublicMenuTree", () => {
  it("sortuje każdy poziom po `position`, nie po kolejności z bazy", () => {
    const tree = buildPublicMenuTree([
      row({ id: "b", position: 1 }),
      row({ id: "a", position: 0 }),
      row({ id: "a2", parent_id: "a", position: 1 }),
      row({ id: "a1", parent_id: "a", position: 0 }),
    ]);
    expect(shape(tree)).toBe("a(a1,a2),b");
  });

  it("pozycja z rodzicem spoza wyniku wraca na najwyższy poziom", () => {
    // Rodzic mógł zostać skasowany albo odfiltrowany przez RLS. Lepiej pokazać
    // pozycję bez kontekstu niż wyciąć całą gałąź nawigacji.
    const tree = buildPublicMenuTree([row({ id: "sierota", parent_id: "duch" })]);
    expect(shape(tree)).toBe("sierota");
  });

  it("pusty wynik daje puste drzewo", () => {
    expect(buildPublicMenuTree([])).toEqual([]);
  });

  it("sortuje także trzeci poziom", () => {
    const tree = buildPublicMenuTree([
      row({ id: "a" }),
      row({ id: "a1", parent_id: "a" }),
      row({ id: "x2", parent_id: "a1", position: 1 }),
      row({ id: "x1", parent_id: "a1", position: 0 }),
    ]);
    expect(shape(tree)).toBe("a(a1(x1,x2))");
  });
});

describe("etykieta pozycji", () => {
  it("bierze wersję bieżącego języka", () => {
    const item = row({ id: "a", label_pl: "Analizy", label_en: "Analyses" });
    expect(pickMenuLabel(item, "pl")).toBe("Analizy");
    expect(pickMenuLabel(item, "en")).toBe("Analyses");
  });

  it("schodzi na drugi język, gdy tłumaczenia brak", () => {
    // Redakcja dodaje pozycję po polsku i tłumaczy ją później - do tego czasu
    // angielski nagłówek ma pokazać polską nazwę, a nie pustkę.
    expect(pickMenuLabel(row({ id: "a", label_pl: "Analizy" }), "en")).toBe("Analizy");
    expect(pickMenuLabel(row({ id: "a", label_en: "Analyses" }), "pl")).toBe("Analyses");
  });

  it("przycina białe znaki - „   ” to brak nazwy, nie nazwa", () => {
    expect(pickMenuLabel(row({ id: "a", label_pl: "  Blog  " }), "pl")).toBe("Blog");
    expect(pickMenuLabel(row({ id: "a", label_pl: "   " }), "pl")).toBe("");
  });

  it("pozycja bez nazwy w OBU językach nie trafia do nawigacji", () => {
    expect(isMenuItemVisible(row({ id: "a" }), "pl")).toBe(false);
    expect(isMenuItemVisible(row({ id: "a", label_en: "Only EN" }), "pl")).toBe(true);
  });
});

describe("adres i cel pozycji", () => {
  it("przepuszcza zwykłe ścieżki i adresy absolutne", () => {
    expect(menuItemHref(row({ id: "a", href: "/blog" }))).toBe("/blog");
    expect(menuItemHref(row({ id: "a", href: "https://ec.europa.eu" }))).toBe(
      "https://ec.europa.eu",
    );
  });

  it("ODRZUCA adres wykonujący skrypt - menu to treść z bazy", () => {
    expect(menuItemHref(row({ id: "a", href: "javascript:alert(1)" }))).toBe("#");
  });

  it("pusty adres daje kotwicę, nie `undefined` w href", () => {
    expect(menuItemHref(row({ id: "a", href: "" }))).toBe("#");
  });

  it("nowa karta niesie rel chroniący przed przejęciem okna", () => {
    expect(menuItemTarget(row({ id: "a", target: "_blank" }))).toBe("_blank");
    expect(menuItemRel(row({ id: "a", target: "_blank" }))).toBe("noopener noreferrer");
  });

  it("nieznana wartość `target` schodzi na to samo okno i nie dokłada rel", () => {
    expect(menuItemTarget(row({ id: "a", target: "_parent" }))).toBe("_self");
    expect(menuItemRel(row({ id: "a", target: "_parent" }))).toBeUndefined();
  });
});

describe("wariant panelu", () => {
  it("pozycja bez dzieci to zwykły link", () => {
    expect(panelKindFor(treeNode({ id: "a" }))).toBe("link");
    expect(hasPanel(treeNode({ id: "a" }))).toBe(false);
  });

  it("jeden poziom dzieci to płaski dropdown", () => {
    const node = treeNode({ id: "a" }, [treeNode({ id: "a1" })]);
    expect(panelKindFor(node)).toBe("dropdown");
    expect(hasPanel(node)).toBe(true);
  });

  it("jawna zgoda administratora włącza mega nawet bez dzieci", () => {
    expect(panelKindFor(treeNode({ id: "a", mega_enabled: true }))).toBe("mega");
    expect(hasPanel(treeNode({ id: "a", mega_enabled: true }))).toBe(true);
  });

  it("INWARIANT: dropdown nigdy nie dostaje dziecka z własnymi dziećmi", () => {
    // Na tym inwariancie stoi uproszczenie renderera płaskiej listy
    // (`SubmenuItem` nie ma gałęzi zagnieżdżenia). Gdyby reguła promocji się
    // zmieniła, drugi poziom zniknąłby z nawigacji bez śladu - i wtedy ten
    // test ma zgasnąć PIERWSZY.
    const cases: SiteMenuNode[] = [
      treeNode({ id: "a" }, [treeNode({ id: "a1" }), treeNode({ id: "a2" })]),
      treeNode({ id: "b" }, [treeNode({ id: "b1" }, [treeNode({ id: "x" })])]),
      treeNode({ id: "c", mega_enabled: true }, [treeNode({ id: "c1" })]),
    ];
    for (const node of cases) {
      if (panelKindFor(node) !== "dropdown") continue;
      expect(node.children.every((child) => child.children.length === 0)).toBe(true);
    }
  });

  it("WNUKI promują dropdown do mega automatycznie", () => {
    // Płaska lista nie umie pokazać drugiego poziomu - bez tej promocji wnuki
    // znikały z nawigacji, mimo że administrator je ułożył.
    const node = treeNode({ id: "a" }, [treeNode({ id: "a1" }, [treeNode({ id: "x" })])]);
    expect(hasNestedChildren(node)).toBe(true);
    expect(panelKindFor(node)).toBe("mega");
  });
});

describe("kolumny mega panelu", () => {
  it("konfiguracja administratora WYGRYWA z układem z drzewa", () => {
    const node = treeNode(
      {
        id: "a",
        mega_enabled: true,
        mega_config: megaConfig({
          columns: [
            {
              title_pl: "Ręczna",
              title_en: "Manual",
              href: "/reczna",
              links: [{ label_pl: "Link", label_en: "Link", href: "/l", icon: "star" }],
            },
          ],
        }),
      },
      [treeNode({ id: "a1", label_pl: "Z drzewa" })],
    );
    expect(megaColumnsFor(node).map((c) => c.title_pl)).toEqual(["Ręczna"]);
    expect(megaColumnsFor(node)[0].links[0].icon).toBe("star");
  });

  it("bez konfiguracji układ powstaje z dzieci i wnuków", () => {
    const node = treeNode({ id: "a", mega_enabled: true }, [
      treeNode({ id: "a1", label_pl: "Analizy", label_en: "Analyses", href: "/analizy" }, [
        treeNode({ id: "x", label_pl: "Raporty", href: "/raporty" }),
      ]),
    ]);
    expect(megaColumnsFor(node)).toEqual([
      {
        title_pl: "Analizy",
        title_en: "Analyses",
        href: "/analizy",
        links: [{ label_pl: "Raporty", label_en: "", href: "/raporty", icon: "" }],
      },
    ]);
  });

  it("kolumna bez linków w konfiguracji nie wysypuje mapowania", () => {
    const node = treeNode({
      id: "a",
      mega_config: megaConfig({
        columns: [
          {
            title_pl: "Pusta",
            title_en: "",
            href: "",
            links: [] as MegaConfig["columns"][number]["links"],
          },
        ],
      }),
    });
    expect(megaColumnsFor(node)[0].links).toEqual([]);
  });

  it("panel bez kolumn i bez dzieci nie ma czego pokazać", () => {
    expect(megaPanelHasContent(treeNode({ id: "a", mega_enabled: true }))).toBe(false);
    expect(megaPanelHasContent(treeNode({ id: "a" }, [treeNode({ id: "a1" })]))).toBe(true);
  });
});

describe("linki mega w akordeonie mobilnym", () => {
  const withColumns = treeNode({
    id: "a",
    mega_enabled: true,
    mega_config: megaConfig({
      columns: [
        {
          title_pl: "Analizy",
          title_en: "",
          href: "",
          links: [
            { label_pl: "Raporty", label_en: "Reports", href: "/raporty", icon: "" },
            { label_pl: "Tylko PL", label_en: "", href: "/pl", icon: "" },
          ],
        },
      ],
    }),
  });

  it("spłaszcza kolumny do listy linków w bieżącym języku", () => {
    expect(mobileMegaLinks(withColumns, "en")).toEqual([
      { label: "Reports", href: "/raporty" },
      // Brak tłumaczenia -> polska etykieta, nie pusty wiersz.
      { label: "Tylko PL", href: "/pl" },
    ]);
  });

  it("sanityzuje adresy tak samo jak wersja desktopowa", () => {
    const node = treeNode({
      id: "a",
      mega_enabled: true,
      mega_config: megaConfig({
        columns: [
          {
            title_pl: "",
            title_en: "",
            href: "",
            links: [{ label_pl: "Zły", label_en: "", href: "javascript:alert(1)", icon: "" }],
          },
        ],
      }),
    });
    expect(mobileMegaLinks(node, "pl")[0].href).toBe("#");
  });

  it("bez włączonego mega panelu nie pokazuje niczego", () => {
    expect(mobileMegaLinks({ ...withColumns, mega_enabled: false }, "pl")).toEqual([]);
  });

  it("mega bez kolumn daje pustą listę", () => {
    expect(mobileMegaLinks(treeNode({ id: "a", mega_enabled: true }), "pl")).toEqual([]);
  });
});

describe("panelGeometry", () => {
  it("mega jest WYŚRODKOWANY względem okna, nie kotwiczony do triggera", () => {
    const { left, width } = panelGeometry({ isMega: true, anchorLeft: 40, viewportWidth: 1440 });
    expect(width).toBe(1120);
    expect(left).toBe(160);
    // Symetria: ten sam odstęp z lewej i z prawej.
    expect(1440 - (left + width)).toBe(left);
  });

  it("zwykły dropdown trzyma się triggera", () => {
    expect(panelGeometry({ isMega: false, anchorLeft: 300, viewportWidth: 1440 }).left).toBe(300);
  });

  it("dropdown przy PRAWEJ krawędzi jest docisnięty do środka okna", () => {
    // Bez tego panel pozycji z końca nawigacji wychodził poza ekran i użytkownik
    // dostawał poziomy pasek przewijania na całej stronie.
    const { left, width } = panelGeometry({
      isMega: false,
      anchorLeft: 1380,
      viewportWidth: 1440,
    });
    expect(left + width).toBeLessThanOrEqual(1440 - 16);
  });

  it("na wąskim telefonie panel nigdy nie dotyka krawędzi", () => {
    const { left, width } = panelGeometry({ isMega: true, anchorLeft: 0, viewportWidth: 320 });
    expect(width).toBe(288); // 320 - 2 * 16
    expect(left).toBe(16);
  });

  it("trigger przy lewej krawędzi nie wypycha panelu poza okno", () => {
    expect(panelGeometry({ isMega: false, anchorLeft: -50, viewportWidth: 1440 }).left).toBe(16);
  });
});

describe("rozwiązywanie aktywnej ścieżki", () => {
  // UWAGA: nagłówek jeszcze NIE UŻYWA tej reguły - podświetlenie aktywnej
  // sekcji to zmiana zachowania ścieżki krytycznej i idzie osobną decyzją.
  // Reguła należy do menu, więc mieszka i jest sprawdzana tutaj.
  it("podstrona podświetla swoją sekcję", () => {
    expect(isMenuPathActive("/blog", "/blog/analiza-ue")).toBe(true);
  });

  it("nie łapie ścieżki, która tylko ZACZYNA SIĘ tymi znakami", () => {
    // `/blogowanie` nie jest podstroną `/blog` - porównanie idzie po segmentach.
    expect(isMenuPathActive("/blog", "/blogowanie")).toBe(false);
  });

  it("prefiks języka nie gasi podświetlenia", () => {
    expect(isMenuPathActive("/blog", "/en/blog/analiza")).toBe(true);
    expect(isMenuPathActive("/en/blog", "/blog")).toBe(true);
  });

  it("strona główna świeci WYŁĄCZNIE na dokładne trafienie", () => {
    expect(isMenuPathActive("/", "/")).toBe(true);
    expect(isMenuPathActive("/", "/en")).toBe(true);
    expect(isMenuPathActive("/", "/blog")).toBe(false);
  });

  it("query, hash i końcowy ukośnik nie mają znaczenia", () => {
    expect(canonicalMenuPath("/blog/?page=2#lista")).toBe("/blog");
    expect(canonicalMenuPath("https://neweuropeanstrategies.com/blog/")).toBe("/blog");
    expect(canonicalMenuPath("")).toBe("/");
  });

  it("wygrywa NAJDŁUŻSZE dopasowanie, nie pierwsze z brzegu", () => {
    const nodes = [
      treeNode({ id: "blog", href: "/blog" }),
      treeNode({ id: "analizy", href: "/blog/analizy" }),
      treeNode({ id: "home", href: "/" }),
    ];
    expect(activeMenuIndex(nodes, "/blog/analizy/raport")).toBe(1);
    expect(activeMenuIndex(nodes, "/blog")).toBe(0);
    expect(activeMenuIndex(nodes, "/")).toBe(2);
  });

  it("ścieżka spoza menu nie podświetla niczego", () => {
    expect(activeMenuIndex([treeNode({ id: "blog", href: "/blog" })], "/kontakt")).toBe(-1);
  });
});
