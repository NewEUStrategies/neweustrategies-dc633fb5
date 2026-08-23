// Stan URL listy wydarzeń - WALIDATOR i tłumaczenie na argumenty RPC.
//
// CO TEN PLIK DOWODZI.
//   1. ADRES WPISANY Z RĘKI NIE WYWRACA LISTY. Nieznana zakładka, nie-UUID
//      w rodzaju, format spoza zbioru i ujemna strona degradują do stanu
//      domyślnego, a nie do odmowy bazy (`22P02` na uuid nie mówi redaktorowi nic).
//   2. STAN KANONICZNY MA JEDNĄ POSTAĆ. `tab=all` i brak `tab` to ten sam stan,
//      więc muszą dać ten sam klucz cache - inaczej dwa adresy o tym samym
//      znaczeniu tworzą dwa wpisy i dwa zapytania.
//   3. ZAKŁADKI `upcoming` I `past` NIE SĄ STATUSAMI, tylko statusem `published`
//      plus granicą czasu. Rozdzielenie żyje w tym module, żeby RPC miało jeden
//      przewidywalny kontrakt.
//   4. ARGUMENTY NIEUSTAWIONE SĄ POMINIĘTE, nie podane jako `null`: Postgres
//      bierze wtedy DEFAULT z sygnatury, a wygenerowane typy deklarują je jako
//      opcjonalne.
//   5. PODPIS PAGINACJI NIE KŁAMIE na ostatniej stronie.
import { describe, expect, it } from "vitest";
import {
  EVENT_LIST_PAGE_SIZE,
  EVENT_LIST_TABS,
  EVENT_LIST_TAB_LABEL_KEYS,
  eventCountsQueryArgs,
  eventListPageCount,
  eventListPageSize,
  eventListQueryArgs,
  eventListRange,
  eventListTab,
  hasEventListFilters,
  parseEventListParams,
} from "@/lib/events/eventListParams";

const TERAZ = new Date("2026-08-23T10:00:00.000Z");
const UUID = "11111111-1111-4111-8111-111111111111";

describe("zbiór zakładek", () => {
  it("każda zakładka ma klucz etykiety i żaden klucz nie wisi bez zakładki", () => {
    expect(Object.keys(EVENT_LIST_TAB_LABEL_KEYS).sort()).toEqual([...EVENT_LIST_TABS].sort());
  });
});

describe("walidacja stanu URL", () => {
  it("czysty adres daje stan pusty i zakładkę `all`", () => {
    const params = parseEventListParams({});
    expect(params).toEqual({
      tab: undefined,
      q: undefined,
      t: undefined,
      f: undefined,
      page: undefined,
    });
    expect(eventListTab(params)).toBe("all");
  });

  it("`tab=all` kanonizuje się do BRAKU parametru", () => {
    // Dwa adresy o tym samym znaczeniu muszą dać ten sam klucz cache.
    expect(parseEventListParams({ tab: "all" }).tab).toBeUndefined();
    expect(eventListTab(parseEventListParams({ tab: "all" }))).toBe("all");
  });

  it("przepuszcza zakładki ze zbioru", () => {
    for (const tab of EVENT_LIST_TABS) {
      const parsed = parseEventListParams({ tab });
      expect(eventListTab(parsed)).toBe(tab);
    }
  });

  it("odrzuca zakładkę spoza zbioru", () => {
    expect(eventListTab(parseEventListParams({ tab: "wymyslona" }))).toBe("all");
    expect(eventListTab(parseEventListParams({ tab: 7 }))).toBe("all");
  });

  it("frazę przycina i obcina do limitu adresu", () => {
    expect(parseEventListParams({ q: "  panel  " }).q).toBe("panel");
    expect(parseEventListParams({ q: "   " }).q).toBeUndefined();
    expect(parseEventListParams({ q: "x".repeat(500) }).q).toHaveLength(200);
  });

  it("rodzaj MUSI wyglądać na UUID, inaczej jest odrzucany", () => {
    // Bez tego warunku tekst leci do RPC i wraca `22P02 invalid input syntax
    // for type uuid` - komunikat, który redaktorowi nic nie mówi.
    expect(parseEventListParams({ t: UUID }).t).toBe(UUID);
    expect(parseEventListParams({ t: "webinar" }).t).toBeUndefined();
    expect(parseEventListParams({ t: "11111111-1111-4111-8111" }).t).toBeUndefined();
  });

  it("rodzaj kanonizuje się do małych liter", () => {
    expect(parseEventListParams({ t: UUID.toUpperCase() }).t).toBe(UUID);
  });

  it("format przepuszcza tylko wartości ze zbioru enuma", () => {
    expect(parseEventListParams({ f: "hybrid" }).f).toBe("hybrid");
    expect(parseEventListParams({ f: "webinar" }).f).toBeUndefined();
  });

  it("strona pierwsza i wartości bezsensowne kanonizują się do BRAKU parametru", () => {
    expect(parseEventListParams({ page: 1 }).page).toBeUndefined();
    expect(parseEventListParams({ page: 0 }).page).toBeUndefined();
    expect(parseEventListParams({ page: -5 }).page).toBeUndefined();
    expect(parseEventListParams({ page: "trzecia" }).page).toBeUndefined();
    expect(parseEventListParams({ page: 3.7 }).page).toBe(3);
  });

  it("nieznane pola są odrzucane", () => {
    const params = parseEventListParams({ tab: "draft", zlosliwe: "1" });
    expect(Object.keys(params).sort()).toEqual(["f", "page", "q", "size", "t", "tab"]);
  });
});

describe("argumenty RPC listy", () => {
  it("zakładka `all` nie podaje statusu WCALE", () => {
    const args = eventListQueryArgs(parseEventListParams({}), TERAZ);
    expect("p_status" in args).toBe(false);
    expect(args.p_limit).toBe(EVENT_LIST_PAGE_SIZE);
    expect(args.p_offset).toBe(0);
  });

  it("zakładki statusowe podają swój status", () => {
    expect(eventListQueryArgs(parseEventListParams({ tab: "draft" }), TERAZ).p_status).toBe(
      "draft",
    );
    expect(eventListQueryArgs(parseEventListParams({ tab: "cancelled" }), TERAZ).p_status).toBe(
      "cancelled",
    );
    expect(eventListQueryArgs(parseEventListParams({ tab: "published" }), TERAZ).p_status).toBe(
      "published",
    );
  });

  it("`upcoming` to `published` PLUS dolna granica czasu", () => {
    const args = eventListQueryArgs(parseEventListParams({ tab: "upcoming" }), TERAZ);
    expect(args.p_status).toBe("published");
    expect(args.p_from).toBe(TERAZ.toISOString());
    expect("p_to" in args).toBe(false);
  });

  it("`past` to `published` PLUS górna granica czasu", () => {
    const args = eventListQueryArgs(parseEventListParams({ tab: "past" }), TERAZ);
    expect(args.p_status).toBe("published");
    expect(args.p_to).toBe(TERAZ.toISOString());
    expect("p_from" in args).toBe(false);
  });

  it("filtry nieustawione są POMINIĘTE, nie podane jako null", () => {
    const args = eventListQueryArgs(parseEventListParams({}), TERAZ);
    expect("p_type_id" in args).toBe(false);
    expect("p_format" in args).toBe(false);
    expect("p_q" in args).toBe(false);
  });

  it("przesunięcie liczy się ze strony liczonej od jedynki", () => {
    expect(eventListQueryArgs(parseEventListParams({ page: 3 }), TERAZ).p_offset).toBe(
      2 * EVENT_LIST_PAGE_SIZE,
    );
  });

  it("przesunięcie respektuje rozmiar strony z adresu", () => {
    expect(eventListQueryArgs(parseEventListParams({ page: 3, size: 50 }), TERAZ).p_offset).toBe(
      100,
    );
  });
});

describe("argumenty RPC liczników", () => {
  it("NIE zawierają statusu ani granicy czasu", () => {
    // Licznik zakładki musi ignorować zakładkę - inaczej „Szkice" pokazują
    // liczbę szkiców wśród szkiców.
    const args = eventCountsQueryArgs(parseEventListParams({ tab: "draft", q: "panel" }));
    expect(Object.keys(args)).toEqual(["p_q"]);
    expect(args.p_q).toBe("panel");
  });

  it("RESPEKTUJĄ pozostałe filtry", () => {
    const args = eventCountsQueryArgs(parseEventListParams({ t: UUID, f: "online" }));
    expect(args.p_type_id).toBe(UUID);
    expect(args.p_format).toBe("online");
  });
});

describe("przycisk czyszczenia filtrów", () => {
  it("pojawia się tylko gdy jest co czyścić", () => {
    expect(hasEventListFilters(parseEventListParams({}))).toBe(false);
    // Zakładka NIE jest filtrem do wyczyszczenia - „Szkice" to widok, nie zawężenie.
    expect(hasEventListFilters(parseEventListParams({ tab: "draft" }))).toBe(false);
    expect(hasEventListFilters(parseEventListParams({ q: "panel" }))).toBe(true);
    expect(hasEventListFilters(parseEventListParams({ t: UUID }))).toBe(true);
    expect(hasEventListFilters(parseEventListParams({ f: "online" }))).toBe(true);
  });
});

describe("paginacja", () => {
  it("zero wierszy to jedna strona, nie zero stron", () => {
    expect(eventListPageCount(0, EVENT_LIST_PAGE_SIZE)).toBe(1);
  });

  it("liczba stron zaokrągla w górę", () => {
    expect(eventListPageCount(EVENT_LIST_PAGE_SIZE, EVENT_LIST_PAGE_SIZE)).toBe(1);
    expect(eventListPageCount(EVENT_LIST_PAGE_SIZE + 1, EVENT_LIST_PAGE_SIZE)).toBe(2);
  });

  it("rozmiar strony z adresu wygrywa nad domyslnym", () => {
    // Kontrolka rozmiaru w `AdminPagination` nie moze byc atrapa: wybor 100
    // musi zmienic `p_limit` w RPC i przeliczyc liczbe stron.
    const params = parseEventListParams({ size: 100 });
    expect(eventListPageSize(params)).toBe(100);
    expect(eventListQueryArgs(params, TERAZ).p_limit).toBe(100);
    expect(eventListPageCount(250, 100)).toBe(3);
  });

  it("rozmiar domyslny i rozmiar spoza zbioru kanonizuja sie do BRAKU parametru", () => {
    expect(parseEventListParams({ size: EVENT_LIST_PAGE_SIZE }).size).toBeUndefined();
    expect(parseEventListParams({ size: 37 }).size).toBeUndefined();
    expect(parseEventListParams({ size: "sto" }).size).toBeUndefined();
  });

  it("podpis zakresu nie kłamie na OSTATNIEJ stronie", () => {
    // 137 wierszy po 20 na strone, strona 7: „121-137 z 137", nie „121-140".
    expect(eventListRange(parseEventListParams({ page: 7 }), 137)).toEqual({
      from: 121,
      to: 137,
    });
  });

  it("podpis dla pustej listy to dwa zera", () => {
    expect(eventListRange(parseEventListParams({}), 0)).toEqual({ from: 0, to: 0 });
  });

  it("podpis pierwszej strony startuje od jedynki", () => {
    expect(eventListRange(parseEventListParams({}), 137)).toEqual({
      from: 1,
      to: EVENT_LIST_PAGE_SIZE,
    });
  });
});
