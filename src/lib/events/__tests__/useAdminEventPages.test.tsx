// Hooki ekranu „Strony i menu": klucze cache, bramki `enabled`, uniewaznianie.
//
// PO CO TEN PLIK ISTNIEJE. Ten modul nie liczy niczego sam - jest UMOWA O TO,
// CO SIE ODSWIEZA I KIEDY. Zepsuta umowa nie wywraca ekranu; zostawia na nim
// nieprawde, ktora redaktor bierze za stan bazy:
//
//   1. UTWORZENIE STRONY SIEGA POZA TEN EKRAN. `admin_event_page_create`
//      zaklada korzen wydarzenia, gdy go nie ma - czyli zmienia
//      `events.root_page_id`, z ktorego rama studia buduje odsylacz „Dostosuj
//      w builderze" - i dopisuje wiersz do drzewa `/admin/pages`. Bez
//      uniewaznienia TYCH DWOCH galezi redaktor po utworzeniu pierwszej
//      podstrony nadal czyta „wydarzenie nie ma jeszcze strony glownej".
//   2. GALAZ JEST PER WYDARZENIE. Organizator prowadzi dwa kongresy w jednej
//      karcie; wspolny klucz pokazalby menu sasiedniego wydarzenia.
//   3. ZAPYTANIE WYLACZONE MA NIE PYTAC. Wydarzenie bez korzenia i podglad bez
//      wybranej strony to stany ZWYKLE, nie bledy - zapytanie o `id = ''`
//      odbiloby sie od bazy komunikatem, ktorego nie ma jak wytlumaczyc.
//   4. ODMOWA MA DOJECHAC DO EKRANU W CALOSCI. Glowa komunikatu plpgsql
//      (`module_page:`) jest jedynym nosnikiem powodu odmowy; hook, ktory
//      zamieni ja na wlasny blad, zamienia „strony modulowej nie da sie
//      odpiac" w „nie udalo sie".
//
// WARSTWA DOSTEPU JEST ZASLEPIONA - test nie wychodzi do sieci. Ksztalt
// ladunkow ma wlasny plik (`eventPagesRpc.test.ts`), a reguly czyste swoj
// (`eventPagesApi.test.ts`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { eventDetailKeys } from "@/lib/events/useAdminEventDetail";

const pages = vi.hoisted(() => ({
  createEventPage: vi.fn(),
  detachEventPage: vi.fn(),
  fetchEventPageDocument: vi.fn(),
  fetchEventPages: vi.fn(),
  fetchEventRootPage: vi.fn(),
  reorderEventPages: vi.fn(),
  saveEventPage: vi.fn(),
}));

vi.mock("@/lib/events/eventPagesApi", () => pages);

const {
  eventPagesKeys,
  useAdminEventPages,
  useCreateEventPage,
  useDetachEventPage,
  useEventPageDocument,
  useEventRootPage,
  useReorderEventPages,
  useSaveEventPage,
} = await import("@/lib/events/useAdminEventPages");

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";
const OTHER_EVENT_ID = "9f9a0c8e-0000-4000-8000-000000000099";
const ENTRY_ID = "5a1c0000-0000-4000-8000-000000000001";
const PAGE_ID = "6b2d0000-0000-4000-8000-000000000001";
const ROOT_PAGE_ID = "7c3e0000-0000-4000-8000-000000000001";

/** Odmowa odpiecia strony modulowej - dokladnie taka, jaka podnosi migracja. */
const ODMOWA_MODULOWA = "module_page: hide it with in_menu = false instead";

beforeEach(() => {
  vi.clearAllMocks();
  pages.fetchEventPages.mockResolvedValue([]);
  pages.fetchEventRootPage.mockResolvedValue(null);
  pages.fetchEventPageDocument.mockResolvedValue(null);
  pages.saveEventPage.mockResolvedValue(ENTRY_ID);
  pages.detachEventPage.mockResolvedValue(true);
  pages.reorderEventPages.mockResolvedValue(3);
  pages.createEventPage.mockResolvedValue(ENTRY_ID);
});

describe("fabryka kluczy", () => {
  // Lista wisi na GALEZI WYDARZENIA, bo kazda mutacja tego ekranu zmienia
  // dokladnie ta jedna liste - a jedno uniewaznienie ma ja objac w calosci.
  it("lista wisi na galezi wydarzenia", () => {
    const branch = eventPagesKeys.event(EVENT_ID);
    expect(eventPagesKeys.list(EVENT_ID).slice(0, branch.length)).toEqual([...branch]);
  });

  it("dwa wydarzenia NIE mieszaja sie w cache", () => {
    expect(eventPagesKeys.list(EVENT_ID)).not.toEqual(eventPagesKeys.list(OTHER_EVENT_ID));
    expect(eventPagesKeys.event(EVENT_ID)).not.toEqual(eventPagesKeys.event(OTHER_EVENT_ID));
  });

  // KORZEN I DOKUMENT STOJA POZA GALEZIA WYDARZENIA celowo: adresuje je
  // identyfikator STRONY, a ta sama strona moze byc czytana z kilku miejsc
  // panelu. Gdyby wisialy na wydarzeniu, uniewaznienie listy ciagneloby za soba
  // dokument otwarty w podgladzie - i podglad migalby przy kazdej zmianie
  // kolejnosci menu.
  it("korzen i dokument adresuje STRONA, nie wydarzenie", () => {
    expect(eventPagesKeys.root(ROOT_PAGE_ID)).toEqual(["admin-event-pages", "root", ROOT_PAGE_ID]);
    expect(eventPagesKeys.document(PAGE_ID)).toEqual(["admin-event-pages", "document", PAGE_ID]);
    expect(eventPagesKeys.document(PAGE_ID)).not.toEqual(eventPagesKeys.root(PAGE_ID));
  });
});

describe("bramki zapytan", () => {
  it("lista pyta baze o TO wydarzenie", async () => {
    renderHookWithQueryClient(() => useAdminEventPages(EVENT_ID));
    await waitFor(() => expect(pages.fetchEventPages).toHaveBeenCalledWith(EVENT_ID));
  });

  it("bez identyfikatora wydarzenia lista NIE pyta bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useAdminEventPages(""));
    await act(async () => {});

    expect(pages.fetchEventPages).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  // WYLACZENIE JAWNE jest drugim wejsciem do tej samej bramki - rama studia
  // gasi liste, gdy sekcja „Strony i menu" jest wylaczona w funkcjach.
  it("jawne wylaczenie tez nie dotyka bazy, mimo poprawnego wydarzenia", async () => {
    renderHookWithQueryClient(() => useAdminEventPages(EVENT_ID, false));
    await act(async () => {});
    expect(pages.fetchEventPages).not.toHaveBeenCalled();
  });

  // ZAPYTANIE WYLACZONE ZOSTAJE W `pending` NA ZAWSZE - dlatego ekran czyta
  // `isLoading`, a nie `isPending`. Ta asercja pilnuje faktu, na ktorym stoi
  // rozroznienie trzech stanow pustej listy w panelu.
  it("wylaczone zapytanie zostaje w `pending`, ale bez pobierania", async () => {
    const { result } = renderHookWithQueryClient(() => useAdminEventPages(""));
    await act(async () => {});

    expect(result.current.isPending).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("dokument podstrony pyta o WYBRANA strone", async () => {
    renderHookWithQueryClient(() => useEventPageDocument(PAGE_ID));
    await waitFor(() => expect(pages.fetchEventPageDocument).toHaveBeenCalledWith(PAGE_ID));
  });

  // BRAK WYBRANEJ STRONY TO STAN ZWYKLY - podglad stoi wtedy na stronie
  // glownej, a nie czeka na dokument, ktorego nikt nie zamowil.
  it("bez wybranej strony dokument NIE jest pobierany", async () => {
    for (const pageId of [null, ""]) {
      renderHookWithQueryClient(() => useEventPageDocument(pageId));
      await act(async () => {});
    }
    expect(pages.fetchEventPageDocument).not.toHaveBeenCalled();
  });

  it("korzen pyta o strone wskazana przez wydarzenie", async () => {
    renderHookWithQueryClient(() => useEventRootPage(ROOT_PAGE_ID));
    await waitFor(() => expect(pages.fetchEventRootPage).toHaveBeenCalledWith(ROOT_PAGE_ID));
  });

  // WYDARZENIE SPRZED ZASIEWU NIE MA KORZENIA. Panel pokazuje wtedy zdanie
  // „wydarzenie nie ma jeszcze strony glownej", a nie awarie zapytania.
  it("wydarzenie bez korzenia nie wysyla zapytania", async () => {
    for (const rootId of [null, ""]) {
      renderHookWithQueryClient(() => useEventRootPage(rootId));
      await act(async () => {});
    }
    expect(pages.fetchEventRootPage).not.toHaveBeenCalled();
  });
});

describe("mutacje: kazda uniewaznia te same trzy galezie", () => {
  /**
   * Trzy uniewaznienia, ktore MUSZA wyjsc po kazdej zmianie listy.
   *
   * Lista wydarzenia - bo to ona sie zmienila. Wiersz wydarzenia - bo niesie
   * `root_page_id`, ktory zasiew mogl wlasnie zalozyc. Drzewo stron panelu -
   * bo nowa strona nalezy takze do `/admin/pages`.
   */
  function oczekiwaneGalezie(): unknown[][] {
    return [
      [{ queryKey: eventPagesKeys.event(EVENT_ID) }],
      [{ queryKey: eventDetailKeys.one(EVENT_ID) }],
      [{ queryKey: ["admin-pages"] }],
    ];
  }

  it("zapis pozycji menu uniewaznia liste, wiersz wydarzenia i drzewo stron", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveEventPage(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ id: ENTRY_ID, inMenu: false });
    });

    expect(pages.saveEventPage).toHaveBeenCalledWith({ id: ENTRY_ID, inMenu: false });
    expect(invalidate.mock.calls).toEqual(oczekiwaneGalezie());
  });

  it("odpiecie uniewaznia te same trzy galezie", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useDetachEventPage(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync(ENTRY_ID);
    });

    expect(pages.detachEventPage).toHaveBeenCalledWith(ENTRY_ID);
    expect(invalidate.mock.calls).toEqual(oczekiwaneGalezie());
  });

  it("kolejnosc jedzie jednym wolaniem i uniewaznia te same trzy galezie", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useReorderEventPages(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync(["a", "b", "c"]);
    });

    expect(pages.reorderEventPages).toHaveBeenCalledWith(EVENT_ID, ["a", "b", "c"]);
    expect(invalidate.mock.calls).toEqual(oczekiwaneGalezie());
  });

  // TO JEST TA MUTACJA, DLA KTOREJ POZOSTALE DWA UNIEWAZNIENIA W OGOLE
  // ISTNIEJA: utworzenie strony zaklada korzen i dopisuje wiersz do `pages`.
  it("utworzenie strony uniewaznia takze wiersz wydarzenia i drzewo stron", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateEventPage(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        eventId: EVENT_ID,
        titlePl: "Materialy prasowe",
        titleEn: "Press materials",
      });
    });

    expect(invalidate.mock.calls).toEqual(oczekiwaneGalezie());
  });

  // GALAZ SASIADA ZOSTAJE NIETKNIETA. Bez tego kontrapunktu asercje wyzej
  // przechodzilyby takze dla `invalidateQueries()` bez klucza, czyli dla
  // uniewaznienia CALEGO cache panelu.
  it("uniewaznienie NIE dotyka galezi drugiego wydarzenia", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSaveEventPage(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ id: ENTRY_ID });
    });

    for (const [call] of invalidate.mock.calls) {
      expect(call).not.toEqual({ queryKey: eventPagesKeys.event(OTHER_EVENT_ID) });
    }
  });
});

describe("odmowy bazy dojezdzaja do ekranu w calosci", () => {
  // STRONA MODULOWA: baza odmawia odpiecia z NAZWANYM powodem (90/(d)
  // w harnessie). Hook ma go przepuscic bez zmiany - mapper panelu rozpoznaje
  // wylacznie GLOWE komunikatu, wiec kazde przepisanie zamienia to zdanie
  // w ogolne „nie udalo sie".
  it("odmowa odpiecia strony modulowej zachowuje glowe `module_page`", async () => {
    pages.detachEventPage.mockRejectedValue(new Error(ODMOWA_MODULOWA));
    const { result } = renderHookWithQueryClient(() => useDetachEventPage(EVENT_ID));

    await act(async () => {
      await expect(result.current.mutateAsync(ENTRY_ID)).rejects.toThrow(ODMOWA_MODULOWA);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(ODMOWA_MODULOWA);
  });

  // KONTRAPUNKT: pozycja REDAKCYJNA odpina sie bez przeszkod. Bez niego
  // asercja wyzej dowodzilaby tylko tego, ze odpiecie zawsze pada.
  it("pozycja redakcyjna odpina sie i mutacja konczy sie sukcesem", async () => {
    const { result } = renderHookWithQueryClient(() => useDetachEventPage(EVENT_ID));

    await act(async () => {
      await expect(result.current.mutateAsync(ENTRY_ID)).resolves.toBe(true);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.error).toBeNull();
  });

  // NIEUDANA MUTACJA NIE ODSWIEZA LISTY: uniewaznienie po odmowie kazaloby
  // ekranowi pobrac te sama liste jeszcze raz i wygladalo by jak zmiana, ktorej
  // nie bylo.
  it("odmowa NIE uniewaznia zadnej galezi", async () => {
    pages.detachEventPage.mockRejectedValue(new Error(ODMOWA_MODULOWA));
    const { result, queryClient } = renderHookWithQueryClient(() => useDetachEventPage(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await expect(result.current.mutateAsync(ENTRY_ID)).rejects.toThrow();
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("odmowa zapisu pozycji tez dojezdza z komunikatem bazy", async () => {
    pages.saveEventPage.mockRejectedValue(
      new Error("invalid_group: group does not belong to event"),
    );
    const { result } = renderHookWithQueryClient(() => useSaveEventPage(EVENT_ID));

    await act(async () => {
      await expect(result.current.mutateAsync({ id: ENTRY_ID })).rejects.toThrow("invalid_group");
    });
  });
});
