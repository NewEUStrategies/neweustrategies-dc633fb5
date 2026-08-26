// Reguly czyste ekranu „Strony i menu" - podzial listy, etykieta, kolejnosc.
//
// TYLKO CZESC CZYSTA: odczyt i zapis chodza przez RPC (`admin_event_pages_list`,
// `admin_event_page_upsert`, `…_reorder`), a te maja pokrycie po stronie bazy.
// Tutaj chodzi o to, co ekran stanowi SAM i co da sie zepsuc bez odmowy z bazy.
//
// TRZY REGULY WARTE TESTU, bo ich zlamanie jest niewidoczne na ekranie:
//   1. podzial menu/pozostale - strona wypchnieta z menu przez pomylke to
//      strona, ktorej uczestnik nie znajdzie;
//   2. etykieta - pusty wiersz w liscie to wiersz, ktorego nie da sie kliknac
//      swiadomie, a tytul bywa uzupelniony tylko w jednym jezyku;
//   3. przesuniecie - ruch w gore musi byc odwracalny jednym ruchem w dol,
//      inaczej kolejnosc menu ustawia sie metoda prob i bledow.
import { describe, expect, it } from "vitest";
import {
  eventPageLabel,
  isEventPageAttached,
  moveEventPage,
  nextEventPageSortOrder,
  splitEventPages,
  type EventPageRow,
} from "@/lib/events/eventPagesApi";

/** Wiersz listy. `id: null` = strona istnieje, ale NIE jest przypieta do menu. */
function page(overrides: Partial<EventPageRow> & { page_slug: string }): EventPageRow {
  return {
    id: `entry-${overrides.page_slug}`,
    page_id: `page-${overrides.page_slug}`,
    page_path: `kongres/${overrides.page_slug}`,
    page_status: "published",
    title_pl: overrides.page_slug,
    title_en: overrides.page_slug,
    menu_label_pl: null,
    menu_label_en: null,
    icon: null,
    color: null,
    in_menu: true,
    sort_order: 10,
    visible_to_groups: [],
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("przypiecie pozycji menu", () => {
  it("brak identyfikatora mapowania znaczy strone nieprzypieta", () => {
    expect(isEventPageAttached(page({ page_slug: "agenda" }))).toBe(true);
    expect(isEventPageAttached(page({ page_slug: "agenda", id: null }))).toBe(false);
  });

  // Pusty napis jest tym samym stanem co NULL: RPC oddaje `id` z LEFT JOIN-a,
  // a warstwa transportu potrafi zamienic NULL na "" po drodze.
  it("pusty identyfikator tez znaczy nieprzypieta", () => {
    expect(isEventPageAttached(page({ page_slug: "agenda", id: "" }))).toBe(false);
  });
});

describe("podzial podstron na menu i pozostale", () => {
  it("do menu idzie tylko strona PRZYPIETA i oznaczona jako w menu", () => {
    const { menu, other } = splitEventPages([
      page({ page_slug: "agenda" }),
      page({ page_slug: "archiwum", in_menu: false }),
      page({ page_slug: "sierotka", id: null }),
    ]);
    expect(menu.map((row) => row.page_slug)).toEqual(["agenda"]);
    expect(other.map((row) => row.page_slug)).toEqual(["archiwum", "sierotka"]);
  });

  // Strona nieprzypieta z `in_menu = true` istnieje w odpowiedzi RPC (kolumna
  // ma COALESCE), ale bez wiersza mapowania nie ma czego pokazac w menu -
  // wpuszczenie jej tam dalo by pozycje, ktorej nie da sie edytowac.
  it("nieprzypieta strona nie wchodzi do menu, nawet gdy ma znacznik w menu", () => {
    const { menu, other } = splitEventPages([
      page({ page_slug: "sierotka", id: null, in_menu: true }),
    ]);
    expect(menu).toEqual([]);
    expect(other.map((row) => row.page_slug)).toEqual(["sierotka"]);
  });

  it("suma obu list jest rowna wejsciu - zadna strona nie ginie i nie dubluje sie", () => {
    const rows = [
      page({ page_slug: "a" }),
      page({ page_slug: "b", in_menu: false }),
      page({ page_slug: "c", id: null }),
      page({ page_slug: "d" }),
    ];
    const { menu, other } = splitEventPages(rows);
    expect(menu.length + other.length).toBe(rows.length);
    expect([...menu, ...other].map((row) => row.page_slug).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("kolejnosc wejscia jest zachowana w obu listach", () => {
    const { menu } = splitEventPages([
      page({ page_slug: "trzecia", sort_order: 30 }),
      page({ page_slug: "pierwsza", sort_order: 10 }),
    ]);
    expect(menu.map((row) => row.page_slug)).toEqual(["trzecia", "pierwsza"]);
  });
});

describe("etykieta pozycji menu", () => {
  it("wlasna etykieta wygrywa z tytulem strony", () => {
    const row = page({
      page_slug: "agenda",
      title_pl: "Program kongresu",
      menu_label_pl: "Agenda",
    });
    expect(eventPageLabel(row, "pl")).toBe("Agenda");
  });

  it("brak wlasnej etykiety siega po tytul strony w jezyku interfejsu", () => {
    const row = page({ page_slug: "agenda", title_pl: "Program", title_en: "Programme" });
    expect(eventPageLabel(row, "pl")).toBe("Program");
    expect(eventPageLabel(row, "en")).toBe("Programme");
  });

  // Tlumaczenie dopisuje sie pozniej, wiec wiersz bez wersji angielskiej
  // istnieje. Zapas w drugim jezyku jest lepszy niz pusty wiersz.
  it("brak tytulu w jezyku interfejsu siega do drugiego jezyka", () => {
    const row = page({ page_slug: "agenda", title_pl: "Program", title_en: "" });
    expect(eventPageLabel(row, "en")).toBe("Program");
  });

  it("biale znaki nie udaja etykiety", () => {
    const row = page({ page_slug: "agenda", menu_label_pl: "   ", title_pl: "Program" });
    expect(eventPageLabel(row, "pl")).toBe("Program");
  });

  it("wiersz bez zadnej nazwy oddaje pusty napis, a nie undefined", () => {
    const row = page({ page_slug: "x", title_pl: "", title_en: "" });
    expect(eventPageLabel(row, "pl")).toBe("");
  });
});

describe("kolejnosc pozycji menu", () => {
  it("nowa pozycja idzie za najwyzsza istniejaca", () => {
    expect(nextEventPageSortOrder([page({ page_slug: "a", sort_order: 10 })])).toBe(20);
    expect(nextEventPageSortOrder([page({ page_slug: "a", sort_order: 37 })])).toBe(47);
  });

  it("puste menu zaczyna od pierwszego kroku", () => {
    expect(nextEventPageSortOrder([])).toBe(10);
  });

  it("przesuniecie w gore i z powrotem w dol daje wyjsciowa kolejnosc", () => {
    const ids = ["a", "b", "c"];
    const up = moveEventPage(ids, "c", -1);
    expect(up).toEqual(["a", "c", "b"]);
    expect(moveEventPage(up, "c", 1)).toEqual(["a", "b", "c"]);
  });

  // Tozsamosc tablicy jest kontraktem: ekran po niej poznaje, ze nie ma czego
  // zapisywac, i nie wysyla zapisu bez zmiany.
  it("ruch poza zakres oddaje TE SAMA tablice", () => {
    const ids = ["a", "b"];
    expect(moveEventPage(ids, "a", -1)).toBe(ids);
    expect(moveEventPage(ids, "b", 1)).toBe(ids);
    expect(moveEventPage(ids, "nieistniejace", 1)).toBe(ids);
  });
});
