// Warstwa danych ekranu „Strony i menu" - KONTRAKT Z FUNKCJAMI BAZY.
//
// PO CO TEN PLIK ISTNIEJE. `eventPagesApi.test.ts` sprawdza czesc CZYSTA
// (podzial listy, etykieta, kolejnosc, znacznik modulu). Nie dotyka jednak
// tego, co ta warstwa robi z siecia - a wlasnie tam mieszkaja bledy, ktorych
// ani kompilator, ani ekran nie zobacza:
//
//   1. NAZWA FUNKCJI I NAZWY ARGUMENTOW. Kazda operacja ma wlasne RPC
//      (`admin_event_pages_list`, `…_upsert`, `…_detach`, `…_reorder`,
//      `…_create`), bo kazda robi w bazie wiecej, niz widzi klient. Literowka
//      w nazwie argumentu przechodzi przez `tsc` (obiekt argumentow jest luzny)
//      i konczy sie funkcja wolana z wartoscia domyslna zamiast z podana.
//   2. KLUCZ POMINIETY vs KLUCZ `null`. To jest CALA konwencja zapisu:
//      `undefined` znaczy „nie ruszaj", `null` znaczy „wyczysc" (ikona, kolor).
//      Zgubienie tej roznicy kasuje ikone przy kazdym przelaczeniu widocznosci.
//   3. ZWEZENIE ZNACZNIKA NA GRANICY. `module` przychodzi z bazy jako `text`;
//      nieznana wartosc ma sie czytac jako „zwykla pozycja", a nie wysadzac
//      ekran ani udawac znanego modulu.
//   4. ODMOWA MA DOJECHAC W CALOSCI. Glowa komunikatu plpgsql (`module_page:`)
//      jest jedynym nosnikiem powodu odmowy - warstwa danych, ktora zamieni ja
//      na wlasne zdanie, zamienia „strony modulowej nie da sie odpiac"
//      w „nie udalo sie".
//   5. PUSTKA TO PUSTKA, a nie awaria: `data: null` z listy oddaje pusta
//      tablice, a brak korzenia oddaje `null` BEZ wolania bazy.
//
// PARA „PRZECHODZI / ODMAWIA" NA KAZDYM WEJSCIU - kazda funkcja jest tu
// sprawdzona z obu stron, bo test samego przebiegu szczesliwego nie odroznia
// „warstwa zglasza blad" od „warstwa polyka blad i oddaje pustke".
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Funkcji czystych - `eventPagesApi.test.ts`.
// (2) Parytetu stalych z CHECK-ami - `eventPagesDbEnumParity.test.ts`.
// (3) Zachowania bazy (zasiew, idempotencja, faktyczna odmowa odpiecia) -
// `scripts/events-harness/runtime_test.d/90_module_pages.sql` na zywym
// Postgresie. (4) Ekranu - `EventPagesMenuPanel.test.tsx`.
//
// RODO: zadnych prawdziwych danych osobowych, adresy wylacznie `example.org`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import type { Database } from "@/integrations/supabase/types";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  from: null as SupabaseFromStub | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
    from: (table: string) => {
      if (h.from === null) throw new Error("test: atrapa tabel nie zostala ustawiona");
      return h.from.from(table);
    },
  },
}));

const api = await import("@/lib/events/eventPagesApi");

type ListRow = Database["public"]["Functions"]["admin_event_pages_list"]["Returns"][number];

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";
const ENTRY_ID = "5a1c0000-0000-4000-8000-000000000001";
const PAGE_ID = "6b2d0000-0000-4000-8000-000000000001";
const ROOT_PAGE_ID = "7c3e0000-0000-4000-8000-000000000001";

/**
 * Kolumny, ktore RPC oddaje NULL-em przy stronie NIEPRZYPIETEJ i przy pozycji
 * bez wlasnej ikony. Wygenerowany typ `RETURNS TABLE` opisuje kazda kolumne
 * jako non-null - `RETURNS TABLE` nie niesie informacji o nullowalnosci - wiec
 * atrapa musi to zwezenie obejsc, zeby byla WIERNA bazie. To jest ten waski,
 * usankcjonowany wyjatek od zakazu rzutowan (wzorzec z `EventGroupDialog`).
 */
const BRAK = null as unknown as string;

function listRow(overrides: Partial<ListRow> & { page_slug: string }): ListRow {
  return {
    color: "#D73953",
    icon: "users",
    id: `entry-${overrides.page_slug}`,
    in_menu: true,
    menu_label_en: BRAK,
    menu_label_pl: BRAK,
    module: BRAK,
    page_id: `page-${overrides.page_slug}`,
    page_path: `kongres/${overrides.page_slug}`,
    page_status: "published",
    sort_order: 10,
    title_en: overrides.page_slug,
    title_pl: overrides.page_slug,
    updated_at: "2026-08-26T10:00:00.000Z",
    visible_to_groups: [],
    ...overrides,
  };
}

function rpc(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

function tables(): SupabaseFromStub {
  if (h.from === null) throw new Error("test: atrapa tabel nie zostala ustawiona");
  return h.from;
}

/** Ladunek `p_payload` w ksztalcie, w ktorym czyta go funkcja bazy. */
function payloadOf(name: string): Record<string, unknown> {
  const call = rpc().lastCall(name);
  if (call === undefined) throw new Error(`test: ${name} nie zostalo wolane`);
  const payload = call.arg("p_payload");
  if (payload === null || typeof payload !== "object") {
    throw new Error(`test: ${name} dostalo p_payload, ktory nie jest obiektem`);
  }
  return payload as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.from = supabaseFromStub();
});

describe("odczyt listy podstron", () => {
  it("wola admin_event_pages_list z identyfikatorem wydarzenia", async () => {
    rpc().setData("admin_event_pages_list", [listRow({ page_slug: "agenda" })]);
    await api.fetchEventPages(EVENT_ID);

    expect(rpc().names()).toEqual(["admin_event_pages_list"]);
    expect(rpc().lastCall("admin_event_pages_list")?.arg("p_event_id")).toBe(EVENT_ID);
  });

  // ZWEZENIE ROBI SIE RAZ, NA GRANICY SIECI. Wartosc spoza piatki ma sie czytac
  // jak zwykla pozycja - pozycja z literowka w znaczniku ma zachowac sie jak
  // strona redakcyjna, a nie wysadzic caly ekran.
  it("zweza znacznik: znany zostaje, nieznany czyta sie jako brak", async () => {
    rpc().setData("admin_event_pages_list", [
      listRow({ page_slug: "agenda", module: "agenda" }),
      listRow({ page_slug: "sponsorzy", module: "sponsorzy" }),
      listRow({ page_slug: "prasa", module: BRAK }),
    ]);

    const rows = await api.fetchEventPages(EVENT_ID);
    expect(rows.map((row) => row.module)).toEqual(["agenda", null, null]);
  });

  // Reszta wiersza ma przejsc BEZ ZMIAN - zwezenie dotyczy jednej kolumny,
  // a nie jest okazja do przepisania calego wiersza po swojemu.
  it("pozostale kolumny wiersza przechodza nietkniete", async () => {
    rpc().setData("admin_event_pages_list", [
      listRow({ page_slug: "agenda", icon: "calendar-days", color: "#6A48C8", sort_order: 40 }),
    ]);

    const [row] = await api.fetchEventPages(EVENT_ID);
    expect(row.icon).toBe("calendar-days");
    expect(row.color).toBe("#6A48C8");
    expect(row.sort_order).toBe(40);
    expect(row.page_path).toBe("kongres/agenda");
  });

  // `data: null` z RPC to nie awaria, tylko brak wierszy - ekran ma wtedy
  // powiedziec „nic tu nie ma", a nie „nie udalo sie".
  it("brak danych oddaje PUSTA tablice, a nie wyjatek", async () => {
    rpc().setResponse("admin_event_pages_list", { data: null, error: null });
    await expect(api.fetchEventPages(EVENT_ID)).resolves.toEqual([]);
  });

  it("odmowa bazy jest zglaszana wyjatkiem z komunikatem bazy", async () => {
    rpc().setError("admin_event_pages_list", "forbidden: editor role required");
    await expect(api.fetchEventPages(EVENT_ID)).rejects.toThrow("forbidden: editor role required");
  });
});

describe("odczyt strony-korzenia", () => {
  it("czyta `pages` po identyfikatorze, z pominieciem skasowanych", async () => {
    tables().setResponse("pages", {
      data: {
        id: ROOT_PAGE_ID,
        slug: "kongres",
        title_pl: "Kongres",
        title_en: "Congress",
        status: "published",
      },
      error: null,
    });

    const root = await api.fetchEventRootPage(ROOT_PAGE_ID);
    expect(root?.slug).toBe("kongres");

    const chain = tables().lastChain("pages");
    expect(chain?.argsOf("eq")).toEqual(["id", ROOT_PAGE_ID]);
    // `deleted_at IS NULL` jest tu regula, nie ozdoba: korzen w koszu nadal
    // wisi na `events.root_page_id`, a odsylacz „Dostosuj w builderze" ma
    // prowadzic do strony, ktora istnieje.
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  // BRAK KORZENIA NIE JEST ZAPYTANIEM. Wydarzenie sprzed zasiewu nie ma
  // `root_page_id`, a zapytanie o `id = ''` odbiloby sie od bazy bledem.
  it("pusty i nieobecny identyfikator NIE wolaja bazy w ogole", async () => {
    await expect(api.fetchEventRootPage(null)).resolves.toBeNull();
    await expect(api.fetchEventRootPage("")).resolves.toBeNull();
    expect(tables().chains).toEqual([]);
  });

  it("brak wiersza oddaje `null`, odmowa - wyjatek", async () => {
    tables().setResponse("pages", { data: null, error: null });
    await expect(api.fetchEventRootPage(ROOT_PAGE_ID)).resolves.toBeNull();

    tables().setResponse("pages", {
      data: null,
      error: Object.assign(new Error("permission denied for table pages"), {
        name: "PostgrestError",
      }),
    });
    await expect(api.fetchEventRootPage(ROOT_PAGE_ID)).rejects.toThrow("permission denied");
  });
});

describe("zapis pozycji menu", () => {
  // KLUCZ POMINIETY NIE WCHODZI DO LADUNKU - to jest cala konwencja tej
  // warstwy. Ladunek z kluczami `undefined` znaczylby dla funkcji bazy „ustaw
  // pusto", czyli skasowalby ikone, kolor i widocznosc przy kazdej zmianie.
  it("klucze pominiete NIE wchodza do ladunku", async () => {
    rpc().setData("admin_event_page_upsert", ENTRY_ID);
    await api.saveEventPage({ id: ENTRY_ID, inMenu: false });

    expect(Object.keys(payloadOf("admin_event_page_upsert")).sort()).toEqual(["id", "in_menu"]);
  });

  // `null` TO INNA ODPOWIEDZ NIZ BRAK KLUCZA: znaczy „wyczysc ikone / kolor",
  // czyli wroc do wartosci z brandingu wydarzenia. Zlanie obu w jedno
  // odebraloby redakcji jedyny sposob na cofniecie wlasnej ikony.
  it("`null` przy ikonie i kolorze JEDZIE do bazy jako wyczyszczenie", async () => {
    rpc().setData("admin_event_page_upsert", ENTRY_ID);
    await api.saveEventPage({ id: ENTRY_ID, icon: null, color: null });

    const payload = payloadOf("admin_event_page_upsert");
    expect(payload).toHaveProperty("icon", null);
    expect(payload).toHaveProperty("color", null);
  });

  it("pelny wiersz jedzie pod nazwami kolumn bazy", async () => {
    rpc().setData("admin_event_page_upsert", ENTRY_ID);
    await api.saveEventPage({
      id: ENTRY_ID,
      eventId: EVENT_ID,
      pageId: PAGE_ID,
      menuLabelPl: "Program",
      menuLabelEn: "Programme",
      icon: "calendar-days",
      color: "#6A48C8",
      inMenu: true,
      sortOrder: 40,
      visibleToGroups: ["grupa-vip"],
    });

    expect(payloadOf("admin_event_page_upsert")).toEqual({
      id: ENTRY_ID,
      event_id: EVENT_ID,
      page_id: PAGE_ID,
      menu_label_pl: "Program",
      menu_label_en: "Programme",
      icon: "calendar-days",
      color: "#6A48C8",
      in_menu: true,
      sort_order: 40,
      visible_to_groups: ["grupa-vip"],
    });
  });

  // PUSTA TABLICA GRUP ZNACZY „WSZYSCY, TAKZE GOSCIE" - i musi dojechac jako
  // pusta tablica, a nie zniknac razem z kluczem.
  it("pusta lista grup jedzie jako pusta tablica, a nie jako brak klucza", async () => {
    rpc().setData("admin_event_page_upsert", ENTRY_ID);
    await api.saveEventPage({ id: ENTRY_ID, visibleToGroups: [] });

    expect(payloadOf("admin_event_page_upsert")).toEqual({ id: ENTRY_ID, visible_to_groups: [] });
  });

  it("oddaje identyfikator pozycji jako napis", async () => {
    rpc().setData("admin_event_page_upsert", ENTRY_ID);
    await expect(api.saveEventPage({ id: ENTRY_ID })).resolves.toBe(ENTRY_ID);
  });

  it("odmowa bazy jest zglaszana wyjatkiem", async () => {
    rpc().setError("admin_event_page_upsert", "invalid_group: group does not belong to event");
    await expect(api.saveEventPage({ id: ENTRY_ID })).rejects.toThrow("invalid_group");
  });
});

describe("odpiecie pozycji - strona modulowa vs redakcyjna", () => {
  // KONTRAPUNKT PIERWSZY: pozycja ZALOZONA PRZEZ REDAKCJE odpina sie bez
  // przeszkod. Bez tego przypadku asercja nizej dowodzilaby tylko tego, ze
  // funkcja zawsze pada.
  it("zwykla pozycja odpina sie i oddaje `true`", async () => {
    rpc().setData("admin_event_page_detach", true);
    await expect(api.detachEventPage(ENTRY_ID)).resolves.toBe(true);
    expect(rpc().lastCall("admin_event_page_detach")?.arg("p_id")).toBe(ENTRY_ID);
  });

  // TO JEST GLOWNA REGULA TEGO EKRANU (90/(d) w harnessie). Baza odmawia
  // odpiecia strony modulowej z NAZWANYM powodem, a warstwa danych ma ten powod
  // przepuscic w CALOSCI: glowa komunikatu (`module_page`) jest jedynym
  // nosnikiem, po ktorym mapper zna zdanie „schowaj ja, wylaczajac widocznosc".
  it("pozycja modulowa: odmowa niesie glowe `module_page` az do wolajacego", async () => {
    rpc().setError("admin_event_page_detach", "module_page: hide it with in_menu = false instead");

    await expect(api.detachEventPage(ENTRY_ID)).rejects.toThrow(
      /^module_page: hide it with in_menu = false instead$/,
    );
  });

  // `false` z bazy znaczy „nie bylo czego odpiac" (pozycja skasowana w innej
  // karcie) - to NIE jest awaria i nie ma prawa lecieć wyjatkiem.
  it("brak wiersza oddaje `false`, a nie wyjatek", async () => {
    rpc().setData("admin_event_page_detach", false);
    await expect(api.detachEventPage(ENTRY_ID)).resolves.toBe(false);
  });

  it("odpowiedz `null` tez czyta sie jako „nie odpieto”", async () => {
    rpc().setResponse("admin_event_page_detach", { data: null, error: null });
    await expect(api.detachEventPage(ENTRY_ID)).resolves.toBe(false);
  });
});

describe("kolejnosc pozycji menu", () => {
  // JEDEN ZAPIS NA CALA LISTE: seria osobnych zapisow zostawia menu w stanie
  // posrednim, gdy ktorys z nich padnie.
  it("wysyla CALA liste identyfikatorow jednym wolaniem", async () => {
    rpc().setData("admin_event_pages_reorder", 3);
    const count = await api.reorderEventPages(EVENT_ID, ["a", "b", "c"]);

    expect(count).toBe(3);
    expect(rpc().calls).toHaveLength(1);
    const call = rpc().lastCall("admin_event_pages_reorder");
    expect(call?.arg("p_event_id")).toBe(EVENT_ID);
    expect(call?.arg("p_ids")).toEqual(["a", "b", "c"]);
  });

  // Tablica wchodzi jako `readonly`, a do bazy ma pojsc KOPIA - inaczej warstwa
  // danych oddawalaby wolajacemu wskaznik na wlasny stan listy.
  it("do bazy jedzie KOPIA tablicy, nie ta sama referencja", async () => {
    rpc().setData("admin_event_pages_reorder", 2);
    const ids = ["a", "b"];
    await api.reorderEventPages(EVENT_ID, ids);

    expect(rpc().lastCall("admin_event_pages_reorder")?.arg("p_ids")).not.toBe(ids);
  });

  it("brak odpowiedzi czyta sie jako zero przestawionych pozycji", async () => {
    rpc().setResponse("admin_event_pages_reorder", { data: null, error: null });
    await expect(api.reorderEventPages(EVENT_ID, [])).resolves.toBe(0);
  });

  it("odmowa bazy jest zglaszana wyjatkiem", async () => {
    rpc().setError("admin_event_pages_reorder", "invalid_ids: entry does not belong to event");
    await expect(api.reorderEventPages(EVENT_ID, ["a"])).rejects.toThrow("invalid_ids");
  });
});

describe("zalozenie podstrony", () => {
  it("tytuly i ikona jada pod nazwami kolumn bazy, `in_menu` razem z nimi", async () => {
    rpc().setData("admin_event_page_create", ENTRY_ID);
    await api.createEventPage({
      eventId: EVENT_ID,
      titlePl: "Materialy prasowe",
      titleEn: "Press materials",
      icon: "newspaper",
      inMenu: true,
      templateId: null,
    });

    const payload = payloadOf("admin_event_page_create");
    expect(payload).toMatchObject({
      event_id: EVENT_ID,
      title_pl: "Materialy prasowe",
      title_en: "Press materials",
      icon: "newspaper",
      in_menu: true,
    });
  });

  // SZABLON JEDZIE W TEJ SAMEJ TRANSAKCJI: doklejenie tresci osobnym zapisem
  // zostawialoby przy bledzie sieci pozycje w menu, ktora niczego nie pokazuje.
  it("znany szablon dokleja dokument buildera do tego samego wolania", async () => {
    rpc().setData("admin_event_page_create", ENTRY_ID);
    await api.createEventPage({
      eventId: EVENT_ID,
      titlePl: "Agenda",
      titleEn: "Agenda",
      templateId: "event-page-agenda",
    });

    const document = payloadOf("admin_event_page_create")["builder_data"];
    expect(document).not.toBeUndefined();
    expect(document).toMatchObject({ version: 1 });
    const sections = (document as { sections: unknown[] }).sections;
    expect(sections.length).toBeGreaterThan(0);
  });

  // NIEZNANY IDENTYFIKATOR NIE JEST BLEDEM, tylko brakiem szablonu: RPC zaklada
  // wtedy pusta strone robocza, dokladnie jak przed wprowadzeniem szablonow.
  it("nieznany i pominiety szablon NIE dokladaja klucza `builder_data`", async () => {
    rpc().setData("admin_event_page_create", ENTRY_ID);

    await api.createEventPage({
      eventId: EVENT_ID,
      titlePl: "A",
      titleEn: "A",
      templateId: "szablon-ktorego-nie-ma",
    });
    expect(payloadOf("admin_event_page_create")).not.toHaveProperty("builder_data");

    await api.createEventPage({ eventId: EVENT_ID, titlePl: "B", titleEn: "B" });
    expect(payloadOf("admin_event_page_create")).not.toHaveProperty("builder_data");
  });

  it("oddaje identyfikator POZYCJI MENU, a odmowa leci wyjatkiem", async () => {
    rpc().setData("admin_event_page_create", ENTRY_ID);
    await expect(
      api.createEventPage({ eventId: EVENT_ID, titlePl: "A", titleEn: "A" }),
    ).resolves.toBe(ENTRY_ID);

    rpc().setError("admin_event_page_create", "invalid_titles: both titles are required");
    await expect(
      api.createEventPage({ eventId: EVENT_ID, titlePl: "", titleEn: "" }),
    ).rejects.toThrow("invalid_titles");
  });
});

describe("dokument podstrony dla podgladu", () => {
  it("czyta JEDNA kolumne JEDNEGO wiersza `pages`", async () => {
    tables().setResponse("pages", {
      data: {
        builder_data: {
          version: 1,
          sections: [{ id: "s1", kind: "section", children: [], props: {} }],
        },
      },
      error: null,
    });

    const doc = await api.fetchEventPageDocument(PAGE_ID);
    expect(doc?.sections).toHaveLength(1);

    const chain = tables().lastChain("pages");
    expect(chain?.argsOf("select")).toEqual(["builder_data"]);
    expect(chain?.argsOf("eq")).toEqual(["id", PAGE_ID]);
  });

  // PUSTA STRONA ODDAJE `null`, nie pusty dokument: podglad ma wtedy powiedziec
  // „ta strona nie ma jeszcze tresci", a nie narysowac pusta kanwe bez slowa.
  it("brak kolumny i dokument bez sekcji oddaja `null`", async () => {
    tables().setResponse("pages", { data: { builder_data: null }, error: null });
    await expect(api.fetchEventPageDocument(PAGE_ID)).resolves.toBeNull();

    tables().setResponse("pages", {
      data: { builder_data: { version: 1, sections: [] } },
      error: null,
    });
    await expect(api.fetchEventPageDocument(PAGE_ID)).resolves.toBeNull();
  });

  it("brak wiersza oddaje `null`", async () => {
    tables().setResponse("pages", { data: null, error: null });
    await expect(api.fetchEventPageDocument(PAGE_ID)).resolves.toBeNull();
  });

  it("odmowa bazy leci wyjatkiem, a nie pustym dokumentem", async () => {
    tables().setResponse("pages", {
      data: null,
      error: Object.assign(new Error("permission denied for table pages"), {
        name: "PostgrestError",
      }),
    });
    await expect(api.fetchEventPageDocument(PAGE_ID)).rejects.toThrow("permission denied");
  });
});
