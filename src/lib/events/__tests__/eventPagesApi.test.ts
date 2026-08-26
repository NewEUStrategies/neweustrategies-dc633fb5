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
//      inaczej kolejnosc menu ustawia sie metoda prob i bledow;
//   4. ZNACZNIK POZYCJI MODULOWEJ - od migracji 20260826181500 piec pozycji
//      (Uczestnicy, Prelegenci, Partnerzy, Agenda, Dyskusje) ma inny zestaw
//      akcji niz pozostale. Zgubiony znacznik znaczy przycisk odpiecia, ktory
//      zawsze konczy sie odmowa bazy - a zgubic go da sie po cichu, bo w typach
//      to zwykly napis.
import { describe, expect, it } from "vitest";
import {
  EVENT_PAGE_MODULES,
  eventPageInput,
  eventPageLabel,
  eventPageModule,
  isEventPageAttached,
  isModuleEventPage,
  moveEventPage,
  nextEventPageSortOrder,
  splitEventPages,
  type AttachedEventPageRow,
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
    module: null,
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

describe("znacznik pozycji modulowej", () => {
  // ZBIOR JEST KONTRAKTEM Z BAZA (`event_pages_module_values`). Rownosc, nie
  // "co najmniej": szosty modul ma przyjsc razem ze swiadoma zmiana ekranu
  // i frontu, a nie po cichu.
  it("piec modulow, w kolejnosci wzorca", () => {
    expect([...EVENT_PAGE_MODULES]).toEqual([
      "participants",
      "speakers",
      "partners",
      "agenda",
      "discussions",
    ]);
  });

  it("znany znacznik przechodzi, nieznany czyta sie jako brak", () => {
    expect(eventPageModule("agenda")).toBe("agenda");
    expect(eventPageModule("sponsorzy")).toBeNull();
    expect(eventPageModule("")).toBeNull();
    expect(eventPageModule(null)).toBeNull();
    expect(eventPageModule(undefined)).toBeNull();
  });

  // Wartosc poza zbiorem MA sie zachowac jak zwykla pozycja, a nie wysadzic
  // ekran: baza pilnuje zbioru `CHECK`-iem, ale `CHECK` nie przechodzi do typow,
  // wiec klient musi miec odpowiedz na wartosc, ktorej nie zna.
  it("wiersz z nieznanym znacznikiem nie jest pozycja modulowa", () => {
    const row = page({ page_slug: "agenda", module: null });
    expect(isModuleEventPage(row)).toBe(false);
  });

  it("wiersz ze znacznikiem I mapowaniem jest pozycja modulowa", () => {
    expect(isModuleEventPage(page({ page_slug: "agenda", module: "agenda" }))).toBe(true);
  });

  // WARUNEK JEST PODWOJNY. `id` bierze sie z LEFT JOIN-a, wiec typ dopuszcza
  // brak mapowania takze przy ustawionym znaczniku - a pozycji bez mapowania
  // nie ma jak zapisac, bo RPC adresuje ja przez `id`.
  it("znacznik bez mapowania NIE wystarcza", () => {
    expect(isModuleEventPage(page({ page_slug: "agenda", module: "agenda", id: null }))).toBe(
      false,
    );
    expect(isModuleEventPage(page({ page_slug: "agenda", module: "agenda", id: "" }))).toBe(false);
  });

  // Pozycja modulowa ukryta przelacznikiem laduje w "Pozostalych" - i tam tez
  // nie wolno jej odpiac. Ta asercja pilnuje, ze podzial listy o znaczniku wie,
  // bo interfejs czyta go wlasnie z tych dwoch tablic.
  it("ukryta pozycja modulowa idzie do pozostalych i NADAL jest modulowa", () => {
    const { menu, other } = splitEventPages([
      page({ page_slug: "agenda", module: "agenda" }),
      page({ page_slug: "dyskusje", module: "discussions", in_menu: false }),
    ]);
    expect(menu.map((row) => row.module)).toEqual(["agenda"]);
    expect(other.map((row) => row.module)).toEqual(["discussions"]);
    expect(other.filter(isModuleEventPage)).toHaveLength(1);
  });

  // TO JEST TA REGRESJA, KTOREJ NIE WIDAC NA EKRANIE. Klient wysyla przy kazdej
  // zmianie CALY wiersz, wiec gdyby `eventPageInput` niosl `module`, pierwsze
  // przelaczenie "w menu / poza menu" wyslaloby znacznik do RPC - a wtedy cala
  // ochrona piatki stalaby na tym, ze baza go ignoruje.
  it("wejscie zapisu NIE niesie znacznika modulu", () => {
    const row = page({ page_slug: "agenda", module: "agenda" });
    // Zwezenie przez STRAZNIKA, nie przez `as`: gdyby straznik przestal
    // dzialac, ten test padnie tutaj, a nie na cichym rzutowaniu.
    if (!isModuleEventPage(row)) throw new Error("wiersz modulowy nie przeszedl straznika");
    const entry: AttachedEventPageRow = row;
    const input = eventPageInput(entry, { inMenu: false });
    expect(Object.keys(input)).not.toContain("module");
    expect(input.inMenu).toBe(false);
    expect(input.id).toBe(entry.id);
  });
});
