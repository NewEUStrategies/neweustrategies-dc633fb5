// Hooki POWIERZCHNI UCZESTNIKA: kto jest w kluczu pamieci podrecznej, ktore
// zapytanie w ogole wolno wyslac, jak dlugo odpowiedz jest swieza i co gasnie
// po klikniecu uczestnika.
//
// PO CO TEN PLIK ISTNIEJE - piec klas bledow, ktorych nie zlapie zaden test
// renderujacy strone wydarzenia, bo kazda z nich rysuje sie POPRAWNIE:
//
// 1) CACHE GOSCIA PRZEZYWAJACY LOGOWANIE (i odwrotnie). `event_sections`,
//    `event_agenda`, `event_menu` i `event_discussions` PERSONALIZUJA
//    odpowiedz: zamki sekcji, wlasny zapis na sesje, pozycje menu przyciete do
//    grup zapisu, watki grupy zamknietej. Klucz bez tozsamosci widza znaczy
//    program bez wlasnych zapisow albo - gorzej - cudzy, i pozycje menu, ktorych
//    gosc widziec nie ma prawa.
// 2) ZAPYTANIE WYSLANE MIMO BRAKU SESJI. `event_attendees` i
//    `event_bookmarks_mine` maja REVOKE dla roli `anon`. Rozsypana brama
//    `enabled` nie daje pustej listy - daje odmowe uprawnien, czyli AWARIE
//    w oczach czytelnika w miejscu, w ktorym ma stac zaproszenie do zalogowania.
// 3) OKNO SWIEZOSCI POMYLONE MIEDZY EKRANAMI. Program starzeje sie po
//    pietnastu sekundach (w dniu wydarzenia liczba wolnych miejsc jest tym, po
//    co uczestnik odswieza strone), migawka partnerow po pieciu minutach.
//    Zamiana tych stalych miejscami jest w kodzie niewidoczna.
// 4) UNIEWAZNIENIE, KTORE NIE SIEGA WSZYSTKIEGO, CO SIE ZMIENILO. Rezygnacja
//    z sesji wpuszcza kogos z rezerwy, wiec rusza liczniki takze w sesjach,
//    ktorych uczestnik nie dotknal; zapis otwiera sekcje zamkniete regula
//    `registered`; wypisanie sie z listy zmienia licznik calosci i licznik
//    grupy, a te jada w tej samej odpowiedzi co wiersze.
// 5) UNIEWAZNIENIE, KTORE SIEGA ZA DALEKO. Skasowanie calej galezi po
//    klikniecu gwiazdki kazaloby stronie pobrac na nowo program, partnerow
//    i materialy - trzy zapytania za jedno klikniecie, w dniu wydarzenia,
//    z telefonu.
//
// ATRAPOWANE SA WYLACZNIE GRANICE: klient Supabase (siec) i `useAuth`
// (tozsamosc widza). `publicEventApi` jedzie PRAWDZIWY, bo to on sklada ladunek
// RPC - test na atrapie warstwy danych dowodzilby tylko tego, ze atrapa
// oddaje to, co jej wpisano.
//
// ZAWEZENIE NAJEMCA nie przechodzi przez klienta: kazda z tych funkcji ustala
// najemce przez `public_tenant_id()` (naglowek hosta) po stronie bazy - pilnuje
// tego bramka `check:sql-tenant-scope`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
  user: null as { id: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

// Tozsamosc widza jest GRANICA tego modulu: hooki czytaja z niej jedna rzecz -
// identyfikator do klucza pamieci i do bramy `enabled`.
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user }) }));

import {
  publicEventKeys,
  useEventAgenda,
  useEventAttendeeVisibility,
  useEventAttendees,
  useEventBookmark,
  useEventDiscussions,
  useEventMenu,
  useEventSections,
  useMyBookmarks,
  usePublicEventMaterials,
  usePublicEventSponsors,
  useSessionAccess,
  useSessionSignup,
} from "@/lib/events/usePublicEvent";

const SLUG = "kongres-2026";
const OTHER_SLUG = "warsztat-2026";
const SESSION = "ses-8f21";
/** Identyfikator zalogowanego - syntetyczny, jak wszystko w tym pliku. */
const USER = "uzy-4c19";
const ANON = "anon";

const BASE_MS = Date.parse("2026-09-01T08:00:00.000Z");

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

/** Odpowiedzi bazy dla calej powierzchni - kazdy test planuje komplet. */
function planAll(): void {
  h.rpc?.setData("event_sections", []);
  h.rpc?.setData("event_menu", []);
  h.rpc?.setData("event_agenda", []);
  h.rpc?.setData("event_sponsors_public", []);
  h.rpc?.setData("event_sponsor_materials_public", []);
  h.rpc?.setData("event_discussions", { state: "ok", threads: [] });
  h.rpc?.setData("event_attendees", { rows: [], total_count: 0 });
  h.rpc?.setData("event_session_access", { can_watch: true, reason: "granted" });
  h.rpc?.setData("event_bookmarks_mine", []);
  h.rpc?.setData("event_session_signup", { status: "waitlist", registered: 30, seats_left: 0 });
  h.rpc?.setData("event_bookmark_toggle", { event_id: "wyd-1", bookmarked: true });
  h.rpc?.setData("event_meeting_directory_visibility_set", { listed: false });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.user = { id: USER };
  planAll();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  // Czesc przypadkow podmienia SAM ZEGAR (bez podmiany `setTimeout`), zeby
  // zmierzyc okno swiezosci.
  vi.useRealTimers();
});

describe("klucze pamieci podrecznej", () => {
  it("widz jest w kluczu tam, gdzie baza personalizuje odpowiedz", () => {
    // Cztery zapytania oddaja co innego gosciowi i co innego zalogowanemu.
    // Wspolna szuflada znaczy: program bez wlasnych zapisow zaraz po
    // zalogowaniu albo pozycje menu partnera widoczne dla goscia po wylogowaniu.
    for (const build of [
      publicEventKeys.sections,
      publicEventKeys.menu,
      publicEventKeys.agenda,
      publicEventKeys.discussions,
    ]) {
      expect(build(SLUG, ANON)).not.toEqual(build(SLUG, USER));
      expect(build(SLUG, USER).slice(0, 2)).toEqual(publicEventKeys.event(SLUG));
    }

    // Partnerzy i materialy NIE MAJA widza w kluczu i to jest decyzja, nie
    // przeoczenie: migawka jest ta sama dla wszystkich, a widz w kluczu
    // kazalby pobrac ja jeszcze raz przy kazdym zalogowaniu.
    expect(publicEventKeys.sponsors(SLUG)).toEqual([...publicEventKeys.event(SLUG), "sponsors"]);
    expect(publicEventKeys.materials(SLUG)).toEqual([...publicEventKeys.event(SLUG), "materials"]);
  });

  it("dwa wydarzenia maja rozlaczne szuflady na kazdym ekranie", () => {
    expect(publicEventKeys.event(SLUG)).not.toEqual(publicEventKeys.event(OTHER_SLUG));
    expect(publicEventKeys.agenda(SLUG, USER)).not.toEqual(
      publicEventKeys.agenda(OTHER_SLUG, USER),
    );
    expect(publicEventKeys.sponsors(SLUG)).not.toEqual(publicEventKeys.sponsors(OTHER_SLUG));
  });

  it("kazdy filtr listy uczestnikow ma WLASNA szuflade", () => {
    // Bez tego wpisanie nazwiska w wyszukiwarke nadpisaloby wynik bez filtra,
    // a powrot do pustego pola pokazalby cudzy wynik z pamieci.
    const base = publicEventKeys.attendees(SLUG, USER, "", null, 0);
    expect(publicEventKeys.attendees(SLUG, USER, "nowak", null, 0)).not.toEqual(base);
    expect(publicEventKeys.attendees(SLUG, USER, "", "gru-1", 0)).not.toEqual(base);
    expect(publicEventKeys.attendees(SLUG, USER, "", null, 24)).not.toEqual(base);
    // Brak grupy ma wlasny segment, a nie pusty - inaczej "wszyscy" i grupa
    // o pustym identyfikatorze trafialyby do jednej szuflady.
    expect(base).toContain("all");
    expect(base.slice(0, 2)).toEqual(publicEventKeys.event(SLUG));
  });

  it("zakladki wisza poza galezia wydarzenia, bo dotycza wielu wydarzen naraz", () => {
    const key = publicEventKeys.bookmarks(USER, "upcoming", 0);
    expect(key.slice(0, 2)).toEqual([...publicEventKeys.all, "bookmarks"]);
    expect(publicEventKeys.bookmarks(USER, "past", 0)).not.toEqual(key);
    expect(publicEventKeys.bookmarks(USER, "upcoming", 24)).not.toEqual(key);
    expect(publicEventKeys.bookmarks(ANON, "upcoming", 0)).not.toEqual(key);
  });
});

describe("brama `enabled`", () => {
  it("gosc NIE pyta o liste uczestnikow - to jest zaproszenie, nie awaria", async () => {
    // `event_attendees` ma REVOKE dla `anon`, wiec zapytanie bez sesji wroci
    // odmowa uprawnien. Komponent ma wtedy pokazac karte "zaloguj sie", a nie
    // czerwony komunikat o bledzie.
    h.user = null;
    const { result } = renderHook(() => useEventAttendees(SLUG), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(h.rpc?.callsFor("event_attendees")).toHaveLength(0);
    // I to jest cala stawka: BRAK bledu. Komponent rozroznia "nie pytalem"
    // od "odmowiono" wlasnie po tym polu - z `isError` narysowalby czerwony
    // komunikat o awarii w miejscu karty "zaloguj sie".
    expect(result.current.isError).toBe(false);
  });

  it("gosc NIE pyta o swoje zakladki", async () => {
    h.user = null;
    const { result } = renderHook(() => useMyBookmarks("upcoming", 24, 0), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.rpc?.callsFor("event_bookmarks_mine")).toHaveLength(0);
    // Lista zapisanych gosciowi sie nie nalezy, ale i nie wolno jej pokazac
    // jako PUSTEJ: "nic nie zapisales" i "nie wiemy, kim jestes" to dwa rozne
    // ekrany, a rozroznia je brak danych przy braku bledu.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it("gosc CZYTA tresc wydarzenia - sekcje, menu i program maja grant dla anon", async () => {
    h.user = null;
    const { result } = renderHook(
      () => ({
        sections: useEventSections(SLUG),
        menu: useEventMenu(SLUG),
        agenda: useEventAgenda(SLUG),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.sections.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.menu.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.agenda.isSuccess).toBe(true));
    // Odpowiedz gosca ma wlasna szuflade - po zalogowaniu nie wolno jej uzyc.
    expect(client.getQueryData(publicEventKeys.sections(SLUG, ANON))).toEqual([]);
    expect(client.getQueryData(publicEventKeys.sections(SLUG, USER))).toBeUndefined();
  });

  it("pusty slug nie idzie do bazy - trasa podaje go dopiero po zamontowaniu", async () => {
    const { result } = renderHook(
      () => ({
        sections: useEventSections(""),
        menu: useEventMenu(""),
        agenda: useEventAgenda(""),
        sponsors: usePublicEventSponsors(""),
        materials: usePublicEventMaterials(""),
        discussions: useEventDiscussions(""),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.sections.fetchStatus).toBe("idle"));
    expect(h.rpc?.names()).toEqual([]);
  });

  it("sesja bez identyfikatora nie pyta o dostep do transmisji", async () => {
    // Hook podstawia `sessionId ?? ""`, wiec zgubiona brama wyslalaby pytanie
    // o sesje o pustym identyfikatorze. Baza odpowiedzialaby `not_found`, a to
    // rysuje sie jako "nie masz dostepu do transmisji" na ekranie, na ktorym
    // widz nie wybral jeszcze zadnej sesji.
    const { result } = renderHook(() => useSessionAccess(null), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.rpc?.callsFor("event_session_access")).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
  });

  it("wylaczone zapytanie zostaje wylaczone mimo poprawnego slugu", async () => {
    // Drugi czlon bramy nalezy do wolajacego: sekcja programu montuje sie
    // takze wtedy, gdy wydarzenie w ogole nie ma programu. Zignorowany argument
    // dokladalby zapytanie do KAZDEGO wejscia na strone bez agendy.
    const { result } = renderHook(() => useEventAgenda(SLUG, false), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(h.rpc?.callsFor("event_agenda")).toHaveLength(0);
    expect(result.current.data).toBeUndefined();
    // Szuflada zostaje PUSTA - inaczej pozniejsze wlaczenie sekcji pokazaloby
    // program pobrany przy wylaczonej bramie.
    expect(client.getQueryData(publicEventKeys.agenda(SLUG, USER))).toBeUndefined();
  });
});

describe("zapytania - ladunek i bledy", () => {
  it("kazdy ekran wola SWOJA funkcje bazy i swoim argumentem", async () => {
    // Osiem hookow tego modulu rozni sie w kodzie jedna linia. Podmieniona
    // funkcja RPC nie wywala kompilacji ani nie daje bledu w czasie dzialania:
    // zakladka "Materialy" pokazuje logotypy partnerow, "Dyskusje" - program.
    const { result } = renderHook(
      () => ({
        sponsors: usePublicEventSponsors(SLUG),
        materials: usePublicEventMaterials(SLUG),
        discussions: useEventDiscussions(SLUG),
        access: useSessionAccess(SESSION),
        bookmarks: useMyBookmarks("past", 48, 96),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.sponsors.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.materials.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.discussions.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.access.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.bookmarks.isSuccess).toBe(true));

    expect(h.rpc?.lastCall("event_sponsors_public")?.arg("p_slug")).toBe(SLUG);
    expect(h.rpc?.lastCall("event_sponsor_materials_public")?.arg("p_slug")).toBe(SLUG);
    expect(h.rpc?.lastCall("event_discussions")?.arg("p_slug")).toBe(SLUG);
    expect(h.rpc?.lastCall("event_session_access")?.arg("_session_id")).toBe(SESSION);
    // Zakres i strona jada do bazy takie, jakie podal wolajacy - stopka
    // paginacji liczy z tych samych liczb.
    const bookmarks = h.rpc?.lastCall("event_bookmarks_mine");
    expect(bookmarks?.arg("p_scope")).toBe("past");
    expect(bookmarks?.arg("p_limit")).toBe(48);
    expect(bookmarks?.arg("p_offset")).toBe(96);
    expect(result.current.access.data?.canWatch).toBe(true);
    expect(result.current.discussions.data?.state).toBe("ok");
  });

  it("lista uczestnikow domyslnie bierze 24 osoby od poczatku", async () => {
    // Domyslna wielkosc strony jest kontraktem tego hooka, nie panelu: bez niej
    // pierwsze wejscie na liste pytaloby o `undefined` i dostaloby DEFAULT
    // funkcji, czyli inna liczbe niz ta, ktora paginacja pokazuje w stopce.
    const { result } = renderHook(() => useEventAttendees(SLUG), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(h.rpc?.lastCall("event_attendees")?.arg("p_payload")).toEqual({
      event_slug: SLUG,
      limit: 24,
      offset: 0,
    });
  });

  it("odmowa bazy dociera do ekranu jako blad, a nie jako pusty program", async () => {
    // Pusty program czyta sie jako "organizator jeszcze nie wpisal sesji" - to
    // jest inne zdanie niz "nie udalo sie pobrac" i prowadzi do innej decyzji
    // czytelnika (czeka zamiast odswiezyc).
    h.rpc?.setError("event_agenda", "permission_denied: brak grantu dla roli anon");
    const { result } = renderHook(() => useEventAgenda(SLUG), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toMatch(/permission_denied/);
  });
});

describe("okna swiezosci", () => {
  it("program starzeje sie SZYBCIEJ niz migawka partnerow", async () => {
    // Dwie rozne stale, dwa rozne powody: liczba wolnych miejsc zmienia sie
    // w trakcie wydarzenia, lista partnerow zmienia sie przed nim. Zamiana ich
    // miejscami albo bije w baze bez powodu, albo pokazuje w dniu wydarzenia
    // zajetosc sprzed kilku minut.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(
      () => ({ agenda: useEventAgenda(SLUG), sponsors: usePublicEventSponsors(SLUG) }),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.agenda.isSuccess).toBe(true));
    await waitFor(() => expect(first.result.current.sponsors.isSuccess).toBe(true));
    first.unmount();

    // Pol minuty pozniej - uczestnik wrocil na zakladke z programem.
    vi.setSystemTime(new Date(BASE_MS + 30_000));
    const second = renderHook(
      () => ({ agenda: useEventAgenda(SLUG), sponsors: usePublicEventSponsors(SLUG) }),
      { wrapper },
    );
    await waitFor(() => expect(h.rpc?.callsFor("event_agenda")).toHaveLength(2));

    expect(h.rpc?.callsFor("event_sponsors_public")).toHaveLength(1);
    second.unmount();
  });

  it("menu podstron nie odswieza sie w trakcie zwiedzania strony", async () => {
    // Menu zmienia sie w panelu organizatora, nie pod czytelnikiem. Zapytanie
    // przy kazdym przejsciu miedzy podstronami dokladaloby jedno wolanie do
    // KAZDEGO wejscia na strone wydarzenia i nie zmienialoby ani jednej decyzji.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(() => useEventMenu(SLUG), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    vi.setSystemTime(new Date(BASE_MS + 120_000));
    const second = renderHook(() => useEventMenu(SLUG), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(h.rpc?.callsFor("event_menu")).toHaveLength(1);
    second.unmount();
  });
});

describe("zapis na sesje", () => {
  it("oddaje stan USTALONY PRZEZ BAZE, a nie ten, o ktory poprosil uczestnik", async () => {
    // O miejscu decyduje SQL pod blokada wiersza sesji. Hook, ktory oddawalby
    // zadanie uczestnika, pokazywalby "jestes zapisany" komus, kto wlasnie
    // trafil na rezerwe.
    const { result } = renderHook(() => useSessionSignup(SLUG), { wrapper });
    const outcome = await result.current.mutateAsync({
      sessionId: SESSION,
      status: "registered",
    });

    expect(outcome.status).toBe("waitlist");
    expect(outcome.seatsLeft).toBe(0);
    expect(h.rpc?.lastCall("event_session_signup")?.arg("p_payload")).toEqual({
      session_id: SESSION,
      status: "registered",
    });
  });

  it("gasi CALY program i sekcje tego widza, ale nie migawke partnerow", async () => {
    // Rezygnacja wpuszcza kogos z rezerwy, wiec zmienia liczniki takze w
    // sesjach, ktorych uczestnik nie dotknal - stad caly program, a nie jeden
    // wiersz. Sekcje, bo zapis czyni z gosia uczestnika i otwiera sekcje
    // zamkniete regula `registered`. Partnerzy zostaja: zapis na sesje nie
    // zmienia ani jednego logotypu, a strona wydarzenia jest otwierana
    // z telefonu w dniu wydarzenia.
    client.setQueryData(publicEventKeys.agenda(SLUG, USER), []);
    client.setQueryData(publicEventKeys.sections(SLUG, USER), []);
    client.setQueryData(publicEventKeys.sponsors(SLUG), []);
    client.setQueryData(publicEventKeys.agenda(OTHER_SLUG, USER), []);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSessionSignup(SLUG), { wrapper });
    await result.current.mutateAsync({ sessionId: SESSION, status: "cancelled" });

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([
      publicEventKeys.agenda(SLUG, USER),
      publicEventKeys.sections(SLUG, USER),
    ]);
    expect(client.getQueryState(publicEventKeys.agenda(SLUG, USER))?.isInvalidated).toBe(true);
    expect(client.getQueryState(publicEventKeys.sections(SLUG, USER))?.isInvalidated).toBe(true);
    expect(client.getQueryState(publicEventKeys.sponsors(SLUG))?.isInvalidated).toBe(false);
    expect(client.getQueryState(publicEventKeys.agenda(OTHER_SLUG, USER))?.isInvalidated).toBe(
      false,
    );
    invalidate.mockRestore();
  });
});

describe("zakladka wydarzenia", () => {
  it("gasi KAZDY zakres listy zapisanych i gwiazdke na stronie wydarzenia", async () => {
    // Gwiazdka mieszka w `event_page_header` (`is_bookmarked`), czyli w kluczu
    // sasiedniego modulu - bez niego przelaczenie z listy zostawiloby na
    // stronie wydarzenia pusta gwiazdke przy zapisanym wydarzeniu.
    client.setQueryData(publicEventKeys.bookmarks(USER, "upcoming", 0), {
      rows: [],
      totalCount: 0,
    });
    client.setQueryData(publicEventKeys.bookmarks(USER, "past", 24), { rows: [], totalCount: 0 });
    client.setQueryData(["event-page-header", SLUG], {});
    client.setQueryData(publicEventKeys.sections(SLUG, USER), []);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useEventBookmark(), { wrapper });
    const outcome = await result.current.mutateAsync({ eventSlug: SLUG });

    expect(outcome.bookmarked).toBe(true);
    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([[...publicEventKeys.all, "bookmarks"], ["event-page-header"]]);
    expect(
      client.getQueryState(publicEventKeys.bookmarks(USER, "upcoming", 0))?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(publicEventKeys.bookmarks(USER, "past", 24))?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(["event-page-header", SLUG])?.isInvalidated).toBe(true);
    // Tresc strony nie zalezy od gwiazdki - pobranie jej na nowo byloby trzema
    // zapytaniami za jedno klikniecie.
    expect(client.getQueryState(publicEventKeys.sections(SLUG, USER))?.isInvalidated).toBe(false);
    invalidate.mockRestore();
  });
});

describe("wlasna obecnosc na liscie uczestnikow", () => {
  it("oddaje stan Z BAZY - zgoda platformowa moze zostac przy swoim", async () => {
    // `profiles.discoverable` zapadlo w profilu i strona wydarzenia nie ma
    // prawa rozszerzac go za czlowieka. Hook, ktory oddawalby zadanie zamiast
    // odpowiedzi, pokazywalby przelacznik ustawiony na "widoczny" komus, kto
    // na liscie sie nie pojawi.
    const { result } = renderHook(() => useEventAttendeeVisibility(SLUG), { wrapper });
    const listed = await result.current.mutateAsync(true);

    expect(listed).toBe(false);
    expect(h.rpc?.lastCall("event_meeting_directory_visibility_set")?.arg("p_payload")).toEqual({
      event_slug: SLUG,
      listed: true,
    });
  });

  it("gasi liste z KAZDYM filtrem oraz katalog gieldy spotkan", async () => {
    // Wypisanie sie zmienia moja karte, licznik calosci i licznik mojej grupy -
    // a te trzy rzeczy jada w jednej odpowiedzi. Katalog gieldy czyta TE SAMA
    // kolumne (`directory_opt_out`), wiec bez niego uczestnik wypisalby sie tu
    // i zobaczyl siebie na liscie gieldy w drugiej zakladce.
    client.setQueryData(publicEventKeys.attendees(SLUG, USER, "", null, 0), { rows: [] });
    client.setQueryData(publicEventKeys.attendees(SLUG, USER, "nowak", "gru-1", 24), { rows: [] });
    client.setQueryData(publicEventKeys.attendees(OTHER_SLUG, USER, "", null, 0), { rows: [] });
    client.setQueryData(publicEventKeys.sections(SLUG, USER), []);
    client.setQueryData(["event-meetings-mine", SLUG], {});
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useEventAttendeeVisibility(SLUG), { wrapper });
    await result.current.mutateAsync(false);

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([[...publicEventKeys.event(SLUG), "attendees"], ["event-meetings-mine"]]);
    expect(
      client.getQueryState(publicEventKeys.attendees(SLUG, USER, "", null, 0))?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(publicEventKeys.attendees(SLUG, USER, "nowak", "gru-1", 24))
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(["event-meetings-mine", SLUG])?.isInvalidated).toBe(true);
    // Lista uczestnikow drugiego wydarzenia i tresc tej strony zostaja swieze.
    expect(
      client.getQueryState(publicEventKeys.attendees(OTHER_SLUG, USER, "", null, 0))?.isInvalidated,
    ).toBe(false);
    expect(client.getQueryState(publicEventKeys.sections(SLUG, USER))?.isInvalidated).toBe(false);
    invalidate.mockRestore();
  });
});
