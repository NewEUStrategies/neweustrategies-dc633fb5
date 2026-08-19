// Układ kolumn mega panelu - reduktory wyprowadzone z `MegaColumnsEditor`.
//
// Dlaczego to jest warte asercji, choć wygląda na arytmetykę tablic: mega panel
// jest jedyną powierzchnią chrome, którą redaktor układa RĘCZNIE, a każda z tych
// operacji przepisuje CAŁĄ konfigurację (`{...config, columns: [...]}`).
// Zgubione pole to zgubiona kolumna w nagłówku każdej strony - i nikt tego nie
// zauważy do czasu zapisu, bo edytor pokazuje własny stan, nie bazę.
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEGA_COLUMN,
  EMPTY_MEGA_LINK,
  addMegaColumn,
  addMegaLink,
  columnPickedContent,
  deriveMegaColumns,
  linkPickedContent,
  removeMegaColumn,
  removeMegaLink,
  updateMegaColumn,
  updateMegaLink,
} from "../megaColumns";
import { DEFAULT_MEGA_CONFIG, type MegaColumn, type MegaConfig } from "../types";
import type { MenuClientItem, MenuTreeNode } from "../tree";

function config(columns: MegaColumn[], over: Partial<MegaConfig> = {}): MegaConfig {
  return { ...DEFAULT_MEGA_CONFIG, columns, ...over };
}

function column(title_pl: string, links: MegaColumn["links"] = []): MegaColumn {
  return { title_pl, title_en: "", href: "", links };
}

function treeNode(
  over: Partial<MenuClientItem> & { local_id: string },
  children: MenuTreeNode<MenuClientItem>[] = [],
): MenuTreeNode<MenuClientItem> {
  return {
    item: {
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
    },
    children,
  };
}

describe("deriveMegaColumns", () => {
  it("dziecko staje się kolumną, wnuk linkiem w tej kolumnie", () => {
    const cols = deriveMegaColumns([
      treeNode({ local_id: "c1", label_pl: "Analizy", label_en: "Analyses", href: "/analizy" }, [
        treeNode({ local_id: "l1", label_pl: "Raporty", label_en: "Reports", href: "/raporty" }),
      ]),
    ]);
    expect(cols).toEqual([
      {
        title_pl: "Analizy",
        title_en: "Analyses",
        href: "/analizy",
        links: [{ label_pl: "Raporty", label_en: "Reports", href: "/raporty", icon: "" }],
      },
    ]);
  });

  it("przenosi ikonę wnuka - to ona rysuje się przy linku w panelu", () => {
    const [col] = deriveMegaColumns([
      treeNode({ local_id: "c1" }, [treeNode({ local_id: "l1", icon: "book-open" })]),
    ]);
    expect(col.links[0].icon).toBe("book-open");
  });

  it("kolumna bez wnuków to kolumna bez linków, nie brak kolumny", () => {
    const cols = deriveMegaColumns([treeNode({ local_id: "c1", label_pl: "Sama" })]);
    expect(cols).toHaveLength(1);
    expect(cols[0].links).toEqual([]);
  });

  it("brak dzieci daje pusty układ (przycisk importu ma się nie pokazać)", () => {
    expect(deriveMegaColumns([])).toEqual([]);
  });
});

describe("kolumny", () => {
  it("dokłada PUSTĄ kolumnę na koniec, nie ruszając poprzednich", () => {
    const out = addMegaColumn(config([column("Pierwsza")]));
    expect(out.columns).toHaveLength(2);
    expect(out.columns[1]).toEqual(EMPTY_MEGA_COLUMN);
    expect(out.columns[0].title_pl).toBe("Pierwsza");
  });

  it("każde wywołanie `add` daje WŁASNY obiekt kolumny", () => {
    // Współdzielona referencja sprawiłaby, że wpisanie tytułu w jednej nowej
    // kolumnie zmienia tytuł w drugiej.
    const out = addMegaColumn(addMegaColumn(config([])));
    out.columns[0].title_pl = "A";
    expect(out.columns[1].title_pl).toBe("");
    expect(EMPTY_MEGA_COLUMN.title_pl).toBe("");
  });

  it("aktualizuje wskazaną kolumnę i tylko ją", () => {
    const out = updateMegaColumn(config([column("A"), column("B")]), 1, { title_pl: "Nowe" });
    expect(out.columns.map((c) => c.title_pl)).toEqual(["A", "Nowe"]);
  });

  it("usuwa ŚRODKOWĄ kolumnę bez przesuwania pozostałych treści", () => {
    const out = removeMegaColumn(config([column("A"), column("B"), column("C")]), 1);
    expect(out.columns.map((c) => c.title_pl)).toEqual(["A", "C"]);
  });

  it("zachowuje ustawienia panelu (szerokość, kolumn/rząd, wpis wyróżniony)", () => {
    const base = config([column("A")], {
      columns_per_row: 2,
      width: "full",
      featured_post_id: "11111111-1111-1111-1111-111111111111",
    });
    const out = removeMegaColumn(addMegaColumn(base), 0);
    expect(out).toMatchObject({
      columns_per_row: 2,
      width: "full",
      featured_post_id: "11111111-1111-1111-1111-111111111111",
    });
  });
});

describe("linki w kolumnie", () => {
  const base = config([
    column("A", [{ label_pl: "Raporty", label_en: "Reports", href: "/r", icon: "" }]),
  ]);

  it("dokłada pusty link na koniec kolumny", () => {
    const out = addMegaLink(base, 0);
    expect(out.columns[0].links).toHaveLength(2);
    expect(out.columns[0].links[1]).toEqual(EMPTY_MEGA_LINK);
  });

  it("dokłada link z podanej treści (picker wewnętrzny)", () => {
    const out = addMegaLink(base, 0, {
      label_pl: "Wydarzenia",
      label_en: "Events",
      href: "/wydarzenia",
      icon: "calendar",
    });
    expect(out.columns[0].links[1]).toMatchObject({ label_pl: "Wydarzenia", icon: "calendar" });
  });

  it("aktualizuje wskazany link", () => {
    const out = updateMegaLink(base, 0, 0, { href: "/nowy" });
    expect(out.columns[0].links[0]).toMatchObject({ label_pl: "Raporty", href: "/nowy" });
  });

  it("usuwa wskazany link", () => {
    expect(removeMegaLink(base, 0, 0).columns[0].links).toEqual([]);
  });

  it("operacja na NIEISTNIEJĄCEJ kolumnie zwraca konfigurację bez zmian", () => {
    // Indeks kolumny przychodzi z domknięcia w JSX-ie; po usunięciu kolumny
    // zdarzenie z jej pola potrafi dolecieć jako ostatnie. Reduktor ma wtedy
    // NIC nie zrobić, a nie wysypać się na `undefined.links`.
    expect(addMegaLink(base, 9)).toBe(base);
    expect(updateMegaLink(base, 9, 0, { href: "/x" })).toBe(base);
    expect(removeMegaLink(base, 9, 0)).toBe(base);
  });
});

describe("powiązanie z treścią wewnętrzną", () => {
  const picked = { label_pl: "Kontakt", label_en: "Contact", href: "/kontakt" };

  it("adres bierze się ZAWSZE ze wskazanej treści", () => {
    const out = linkPickedContent(
      { label_pl: "Napisz", label_en: "Write", href: "/stary", icon: "" },
      picked,
    );
    expect(out.href).toBe("/kontakt");
  });

  it("etykieta wpisana ręcznie WYGRYWA z tytułem treści", () => {
    const out = linkPickedContent(
      { label_pl: "Napisz", label_en: "", href: "", icon: "mail" },
      picked,
    );
    expect(out).toMatchObject({ label_pl: "Napisz", label_en: "Contact", icon: "mail" });
  });

  it("pusta etykieta jest uzupełniana tytułem treści", () => {
    const out = linkPickedContent(EMPTY_MEGA_LINK, picked);
    expect(out).toMatchObject({ label_pl: "Kontakt", label_en: "Contact" });
  });

  it("nagłówek kolumny działa tą samą regułą", () => {
    expect(columnPickedContent(column("Moja nazwa"), picked)).toEqual({
      title_pl: "Moja nazwa",
      title_en: "Contact",
      href: "/kontakt",
    });
    expect(columnPickedContent(EMPTY_MEGA_COLUMN, picked)).toEqual({
      title_pl: "Kontakt",
      title_en: "Contact",
      href: "/kontakt",
    });
  });
});
