// Hooki PANELU UCZESTNIKA („moje wydarzenie"): brama zalogowania, jeden klucz
// pamieci podrecznej na wydarzenie i zasieg uniewaznienia po zapisie profilu.
//
// PO CO TEN PLIK ISTNIEJE - cztery klasy bledow, ktorych nie zlapie zaden test
// renderujacy ekran panelu.
//
// 1) ZAPYTANIE WYSLANE MIMO BRAKU ZALOGOWANIA. `enabled: enabled &&
//    slug.length > 0` to jedyna brama miedzy anonimowym gosciem a RPC, ktore
//    czyta kartoteke osobowa i wlasna agende. Rozsypanie tego warunku (albo
//    zgubienie drugiego czlonu na trasie bez slugu) nie wywala kompilacji -
//    daje ciche zapytanie o dane osobowe przy kazdym wejsciu na strone.
//
// 2) KARTOTEKA Z CUDZEGO WYDARZENIA. Klucz `["event-me", slug, ...]` rozdziela
//    panele dwoch wydarzen. Zgubiony segment slugu znaczy: uczestnik dwoch
//    konferencji widzi w drugiej dane wpisane w pierwszej.
//
// 3) ODPOWIEDZ ZAPISU WYRZUCONA DO KOSZA. `onSuccess` wstawia nowy stan
//    WPROST do pamieci podrecznej zamiast wolac drugie zapytanie. Zamiana na
//    uniewaznienie kosztuje dodatkowy przejazd do bazy przy kazdym zapisie
//    formularza - i nie krzyczy o tym zaden test renderujacy.
//
// 4) NIEUDANY ZAPIS, KTORY CZYSCI KARTOTEKE. `onSuccess` zamieniony na
//    `onSettled` wstawilby do pamieci `undefined` po odmowie RPC - formularz
//    zgubilby wypelnione pola dokladnie w momencie bledu.
//
// Zaleznoscia jest tu `myEventProfileApi` (siec) - i tylko ona jest atrapa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchMyEventProfile: vi.fn(),
  fetchMyAgenda: vi.fn(),
  saveMyEventProfile: vi.fn(),
  syncMyEventProfileFromAccount: vi.fn(),
}));

vi.mock("@/lib/events/myEventProfileApi", () => api);

import {
  myAgendaKey,
  myEventPanelKey,
  useMyAgenda,
  useMyEventProfile,
  useSaveMyEventProfile,
  useSyncMyEventProfileFromAccount,
} from "@/lib/events/useMyEventPanel";
import type {
  MyEventPanelState,
  MyEventProfile,
  MyEventProfileInput,
} from "@/lib/events/myEventProfileApi";

const SLUG = "forum-2026";
const OTHER_SLUG = "gala-2026";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function profile(personId: string, jobTitle: string): MyEventProfile {
  return {
    personId,
    firstName: "Ala",
    lastName: "Kowalska",
    email: "ala@example.org",
    phone: null,
    emailVisible: false,
    phoneVisible: false,
    jobTitle,
    companyId: null,
    companyText: "Firma",
    industry: null,
    specialization: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    socialProfileUrl: null,
    socialLinks: {},
    photoUrl: null,
    bioPl: null,
    bioEn: null,
  };
}

function panelState(overrides: Partial<MyEventPanelState> = {}): MyEventPanelState {
  return { profile: null, account: null, registration: null, ...overrides };
}

/** Formularz oddaje hakowi pola BEZ slugu - slug nalezy do adresu strony. */
function formInput(
  overrides: Partial<Omit<MyEventProfileInput, "slug">> = {},
): Omit<MyEventProfileInput, "slug"> {
  return { job_title: "Analityk", email_visible: true, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchMyEventProfile.mockResolvedValue(panelState());
  api.fetchMyAgenda.mockResolvedValue([]);
});

describe("klucze panelu uczestnika", () => {
  it("kartoteka i agenda dziela galaz wydarzenia, ale maja WLASNE liscie", () => {
    // Wspolny prefiks jest zalozeniem calego modulu („jeden klucz cache na
    // wydarzenie"); wspolny CALY klucz znaczylby, ze agenda nadpisuje profil
    // w tej samej szufladzie.
    expect(myEventPanelKey(SLUG)).toEqual(["event-me", SLUG, "profile"]);
    expect(myAgendaKey(SLUG)).toEqual(["event-me", SLUG, "agenda"]);
    expect(myEventPanelKey(SLUG)).not.toEqual(myAgendaKey(SLUG));
    expect(myEventPanelKey(SLUG).slice(0, 2)).toEqual(myAgendaKey(SLUG).slice(0, 2));
  });

  it("dwa wydarzenia maja ROZLACZNE klucze kartoteki i agendy", () => {
    // Uczestnik dwoch konferencji ma dwie osobne kartoteki. Zgubiony segment
    // slugu pokazalby mu w drugiej dane wpisane w pierwszej.
    expect(myEventPanelKey(SLUG)).not.toEqual(myEventPanelKey(OTHER_SLUG));
    expect(myAgendaKey(SLUG)).not.toEqual(myAgendaKey(OTHER_SLUG));
  });
});

describe("useMyEventProfile - brama zalogowania", () => {
  it("NIEZALOGOWANY gosc nie pyta bazy o kartoteke osobowa", async () => {
    // Najwazniejszy przypadek tego pliku: sprawdzamy, ze zapytanie NIE
    // poszlo i ze na wyjsciu ORAZ w pamieci podrecznej nie ma zadnych danych -
    // nie tylko ze hook nie rzucil.
    const { result } = renderHook(() => useMyEventProfile(SLUG, false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchMyEventProfile).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    expect(client.getQueryData(myEventPanelKey(SLUG))).toBeUndefined();
  });

  it("PUSTY slug blokuje zapytanie nawet po zalogowaniu", async () => {
    // Drugi czlon bramy. Trasa panelu potrafi wyrenderowac sie na moment bez
    // slugu (przejscie miedzy ekranami) - zapytanie z pustym slugiem poszloby
    // do bazy po kartoteke „nie wiadomo czyjego" wydarzenia.
    const { result } = renderHook(() => useMyEventProfile("", true), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchMyEventProfile).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("zalogowany uczestnik dostaje kartoteke WSKAZANEGO wydarzenia", async () => {
    const state = panelState({ profile: profile("person-1", "Analityk") });
    api.fetchMyEventProfile.mockResolvedValue(state);

    const { result } = renderHook(() => useMyEventProfile(SLUG, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchMyEventProfile).toHaveBeenCalledExactlyOnceWith(SLUG);
    expect(result.current.data).toBe(state);
    expect(client.getQueryData(myEventPanelKey(SLUG))).toBe(state);
  });

  it("zalogowanie W TRAKCIE ogladania strony uruchamia pobranie", async () => {
    // Sesja przychodzi asynchronicznie, wiec pierwszy render panelu jest
    // zawsze „niezalogowany". Brama, ktora nie odblokowuje sie po sesji,
    // zostawilaby panel pusty do czasu przeladowania strony.
    const { result, rerender } = renderHook(
      ({ signedIn }: { signedIn: boolean }) => useMyEventProfile(SLUG, signedIn),
      { wrapper, initialProps: { signedIn: false } },
    );
    expect(api.fetchMyEventProfile).not.toHaveBeenCalled();

    rerender({ signedIn: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchMyEventProfile).toHaveBeenCalledExactlyOnceWith(SLUG);
  });

  it("ODMOWA bazy nie podstawia kartoteki z poprzedniego wydarzenia", async () => {
    // Uczestnik przechodzi z panelu jednej konferencji do drugiej, na ktora
    // nie jest zapisany. Gdyby hook trzymal poprzednie dane przy zmianie
    // klucza, zobaczylby w niej swoja kartoteke z tamtej pierwszej.
    const mine = panelState({ profile: profile("person-1", "Analityk") });
    api.fetchMyEventProfile.mockResolvedValueOnce(mine);
    api.fetchMyEventProfile.mockRejectedValueOnce(new Error("not_registered"));

    const { result, rerender } = renderHook(
      ({ slug }: { slug: string }) => useMyEventProfile(slug, true),
      { wrapper, initialProps: { slug: SLUG } },
    );
    await waitFor(() => expect(result.current.data).toBe(mine));

    rerender({ slug: OTHER_SLUG });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("not_registered");
    expect(result.current.data).toBeUndefined();
    expect(client.getQueryData(myEventPanelKey(OTHER_SLUG))).toBeUndefined();
    expect(client.getQueryData(myEventPanelKey(SLUG))).toBe(mine);
  });

  it("kartoteka zostaje swieza przez 30 sekund - przelaczanie zakladek nie pyta bazy", async () => {
    // Obietnica z naglowka modulu: profil i agenda sa czytane w kilku
    // zakladkach jednego ekranu.
    const first = renderHook(() => useMyEventProfile(SLUG, true), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = renderHook(() => useMyEventProfile(SLUG, true), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(api.fetchMyEventProfile).toHaveBeenCalledTimes(1);
  });
});

describe("useMyAgenda - brama zalogowania", () => {
  it("NIEZALOGOWANY gosc nie pyta bazy o cudze zapisy na sesje", async () => {
    // Agenda to zapisy wolajacego, a nie program wydarzenia - dla goscia bez
    // sesji zapytanie nie ma nawet sensownej odpowiedzi.
    const { result } = renderHook(() => useMyAgenda(SLUG, false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchMyAgenda).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
    expect(client.getQueryData(myAgendaKey(SLUG))).toBeUndefined();
  });

  it("PUSTY slug blokuje pobranie agendy nawet po zalogowaniu", async () => {
    const { result } = renderHook(() => useMyAgenda("", true), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchMyAgenda).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("zalogowany uczestnik dostaje WLASNE sesje tego wydarzenia", async () => {
    const sessions = [{ sessionId: "ses-1" }];
    api.fetchMyAgenda.mockResolvedValue(sessions);

    const { result } = renderHook(() => useMyAgenda(SLUG, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchMyAgenda).toHaveBeenCalledExactlyOnceWith(SLUG);
    expect(result.current.data).toBe(sessions);
    expect(client.getQueryData(myAgendaKey(SLUG))).toBe(sessions);
  });

  it("PUSTA agenda jest poprawnym wynikiem, nie stanem ladowania", async () => {
    // Ekran rozroznia „nie zapisalem sie na nic" od „jeszcze nie wiem".
    api.fetchMyAgenda.mockResolvedValue([]);

    const { result } = renderHook(() => useMyAgenda(SLUG, true), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });

  it("blad agendy dociera do ekranu i NIE zabiera kartoteki", async () => {
    // Dwa osobne klucze znacza dwie niezalezne awarie: pusta agenda nie moze
    // wyczyscic formularza profilu obok.
    const state = panelState({ profile: profile("person-1", "Analityk") });
    api.fetchMyEventProfile.mockResolvedValue(state);
    api.fetchMyAgenda.mockRejectedValue(new Error("agenda_timeout"));

    const { result } = renderHook(
      () => ({ panel: useMyEventProfile(SLUG, true), agenda: useMyAgenda(SLUG, true) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.agenda.isError).toBe(true));
    await waitFor(() => expect(result.current.panel.isSuccess).toBe(true));

    expect(result.current.agenda.error?.message).toBe("agenda_timeout");
    expect(result.current.panel.data).toBe(state);
  });
});

describe("useSaveMyEventProfile", () => {
  it("slug HOOKA wygrywa z jakimkolwiek slugiem podanym w formularzu", async () => {
    // Slug jedzie do RPC jako wskazanie wydarzenia. Kolejnosc rozpakowania
    // (`{ ...input, slug }`, a nie `{ slug, ...input }`) jest jedynym miejscem,
    // ktore gwarantuje, ze pole przemycone w formularzu nie przekieruje zapisu
    // do kartoteki innego wydarzenia.
    api.saveMyEventProfile.mockResolvedValue(panelState());
    const smuggled = { ...formInput(), slug: OTHER_SLUG } as Omit<MyEventProfileInput, "slug">;

    const { result } = renderHook(() => useSaveMyEventProfile(SLUG), { wrapper });
    await result.current.mutateAsync(smuggled);

    expect(api.saveMyEventProfile).toHaveBeenCalledExactlyOnceWith({
      job_title: "Analityk",
      email_visible: true,
      slug: SLUG,
    });
  });

  it("pola formularza ida do RPC bez przerabiania, ze slugiem doklejonym", async () => {
    api.saveMyEventProfile.mockResolvedValue(panelState());
    const input = formInput({ bio_pl: "", phone_visible: false });

    const { result } = renderHook(() => useSaveMyEventProfile(SLUG), { wrapper });
    await result.current.mutateAsync(input);

    expect(api.saveMyEventProfile).toHaveBeenCalledExactlyOnceWith({ ...input, slug: SLUG });
  });

  it("odpowiedz RPC ląduje w kartotece ZAMIAST drugiego zapytania", async () => {
    // Sedno `setQueryData` w `onSuccess`. Zamiana na uniewaznienie kluczem
    // kartoteki przeszlaby kazdy test „dane sie odswiezyly", ale kosztowalaby
    // dodatkowy przejazd do bazy po KAZDYM zapisie formularza.
    const before = panelState({ profile: profile("person-1", "Analityk") });
    const after = panelState({ profile: profile("person-1", "Kierownik") });
    api.fetchMyEventProfile.mockResolvedValue(before);
    api.saveMyEventProfile.mockResolvedValue(after);

    const { result } = renderHook(
      () => ({ panel: useMyEventProfile(SLUG, true), save: useSaveMyEventProfile(SLUG) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.panel.data).toBe(before));

    await result.current.save.mutateAsync(formInput({ job_title: "Kierownik" }));

    // Porownanie po wartosci, bo TanStack przepuszcza wstawiony stan przez
    // wspoldzielenie struktury i oddaje wlasna kopie.
    await waitFor(() => expect(result.current.panel.data).toEqual(after));
    expect(client.getQueryData(myEventPanelKey(SLUG))).toEqual(after);
    expect(api.fetchMyEventProfile).toHaveBeenCalledTimes(1);
  });

  it("zapis kasuje katalog uczestnikow TEGO wydarzenia i karte widza", async () => {
    // Dwie osobne linie `onSuccess`, kazda dla innego ekranu: karta w katalogu
    // pokazywalaby poprzednia role, a powitanie w naglowku - poprzednie
    // nazwisko. Kolejnosc i komplet kluczy sa tu asercja.
    api.saveMyEventProfile.mockResolvedValue(panelState());
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useSaveMyEventProfile(SLUG), { wrapper });
    await result.current.mutateAsync(formInput());

    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ["public-event-surface", SLUG],
      ["header-profile"],
    ]);
  });

  it("kasowanie katalogu celuje w slug HOOKA, a nie w dowolny", async () => {
    api.saveMyEventProfile.mockResolvedValue(panelState());
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useSaveMyEventProfile(OTHER_SLUG), { wrapper });
    await result.current.mutateAsync(formInput());

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(["public-event-surface", OTHER_SLUG]);
    expect(keys).not.toContainEqual(["public-event-surface", SLUG]);
  });

  it("NIEUDANY zapis nie nadpisuje kartoteki i niczego nie kasuje", async () => {
    // `onSettled` zamiast `onSuccess` wstawilby tu `undefined` - formularz
    // zgubilby wypelnione pola dokladnie w momencie bledu.
    const before = panelState({ profile: profile("person-1", "Analityk") });
    api.fetchMyEventProfile.mockResolvedValue(before);
    api.saveMyEventProfile.mockRejectedValue(new Error("registration_closed"));

    const { result } = renderHook(
      () => ({ panel: useMyEventProfile(SLUG, true), save: useSaveMyEventProfile(SLUG) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.panel.data).toBe(before));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    await expect(result.current.save.mutateAsync(formInput())).rejects.toThrow(
      "registration_closed",
    );

    expect(client.getQueryData(myEventPanelKey(SLUG))).toBe(before);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useSyncMyEventProfileFromAccount", () => {
  it("uzupelnienie z konta wola RPC z samym slugiem wydarzenia", async () => {
    // Hak nie ma zadnego wejscia od uzytkownika - kopiowanie wybiera baza.
    // Przepuszczenie tu zmiennej mutacji dodaloby argument, ktorego RPC
    // nie zna.
    api.syncMyEventProfileFromAccount.mockResolvedValue(panelState());

    const { result } = renderHook(() => useSyncMyEventProfileFromAccount(SLUG), { wrapper });
    await result.current.mutateAsync();

    expect(api.syncMyEventProfileFromAccount).toHaveBeenCalledExactlyOnceWith(SLUG);
  });

  it("wynik uzupelnienia ląduje w kartotece BEZ ponownego zapytania", async () => {
    const before = panelState({ profile: profile("person-1", "Analityk") });
    const after = panelState({ profile: profile("person-1", "Kierownik") });
    api.fetchMyEventProfile.mockResolvedValue(before);
    api.syncMyEventProfileFromAccount.mockResolvedValue(after);

    const { result } = renderHook(
      () => ({
        panel: useMyEventProfile(SLUG, true),
        sync: useSyncMyEventProfileFromAccount(SLUG),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.panel.data).toBe(before));

    await result.current.sync.mutateAsync();

    await waitFor(() => expect(result.current.panel.data).toEqual(after));
    expect(api.fetchMyEventProfile).toHaveBeenCalledTimes(1);
  });

  it("uzupelnienie kasuje katalog uczestnikow, ale NIE karte widza", async () => {
    // Roznica wobec zapisu jest zamierzona: kopiowanie idzie Z konta DO
    // kartoteki wydarzenia, wiec dane konta (naglowek, powitanie) sie nie
    // zmieniaja. Dopisanie tu `header-profile` byloby pustym przejazdem
    // do bazy przy kazdym klikniciu „Uzupelnij z konta".
    api.syncMyEventProfileFromAccount.mockResolvedValue(panelState());
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useSyncMyEventProfileFromAccount(SLUG), { wrapper });
    await result.current.mutateAsync();

    expect(invalidate.mock.calls.map((call) => call[0]?.queryKey)).toEqual([
      ["public-event-surface", SLUG],
    ]);
  });

  it("NIEUDANE uzupelnienie nie rusza kartoteki", async () => {
    const before = panelState({ profile: profile("person-1", "Analityk") });
    api.fetchMyEventProfile.mockResolvedValue(before);
    api.syncMyEventProfileFromAccount.mockRejectedValue(new Error("no_account_profile"));

    const { result } = renderHook(
      () => ({
        panel: useMyEventProfile(SLUG, true),
        sync: useSyncMyEventProfileFromAccount(SLUG),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.panel.data).toBe(before));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    await expect(result.current.sync.mutateAsync()).rejects.toThrow("no_account_profile");

    expect(client.getQueryData(myEventPanelKey(SLUG))).toBe(before);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
