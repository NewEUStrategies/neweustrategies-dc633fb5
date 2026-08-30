// Hooki GRUP UCZESTNIKOW i REGULAMINOW: klucze pamieci podrecznej, brama
// `enabled` i zasieg uniewaznienia po zapisie.
//
// PO CO TEN PLIK ISTNIEJE. To sa hooki UPRAWNIENIOWE. Grupa rozstrzyga, kto
// kogo widzi i kto moze sie z kim spotkac; regulamin rozstrzyga, czyja zgoda
// jest dowodem. Trzy klasy bledow, ktorych nie zlapie zaden test renderujacy
// panel:
//
//   1. KLUCZ, KTORY SIE ZLEWA, POKAZUJE CUDZE GRUPY. Klucz jest sklejany
//      z identyfikatora wydarzenia. Zgubiony segment znaczy, ze ekran grup
//      kongresu rysuje grupy warsztatu - czyli uprawnienia z innego wydarzenia.
//   2. BRAMA `enabled`, KTORA NIE DZIALA, PYTA BAZE O GRUPY, ZANIM WIADOMO,
//      O KTORE WYDARZENIE CHODZI. `eventId === ""` to stan „jeszcze nie
//      wybrano" - zapytanie z pustym identyfikatorem konczy sie odmowa, ktora
//      panel pokazuje jako blad na czystym ekranie.
//   3. UNIEWAZNIENIE, KTORE NIE SIEGA LISTY ZGLOSZEN, ZOSTAWIA EKRAN KLAMIACY.
//      Zapis grupy zmienia grupe DOMYSLNA (wchodzi do nowych zapisow), a zapis
//      regulaminu zmienia licznik brakujacych zgod w wierszu zgloszenia.
//      Obietnica zyje w jednej prywatnej funkcji `useEventScopedInvalidation` -
//      skasowanie jednej z dwoch linii nie psuje niczego widocznego od razu.
//
// PARA „RUSZA SWOJE / NIE RUSZA CUDZEGO". Kazde uniewaznienie jest sprawdzane
// z DRUGIEJ strony: galaz TEGO wydarzenia ma zniknac, galaz innego wydarzenia
// ma zostac. Sam dowod „cos sie uniewaznilo" przechodzilby takze dla
// `invalidateQueries()` bez klucza, czyli dla skasowania calej pamieci.
//
// Zaleznoscia jest tu `termsGroupsApi` (siec) - i tylko ona jest atrapa.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchEventGroups: vi.fn(),
  fetchEventTerms: vi.fn(),
  saveEventGroup: vi.fn(),
  deleteEventGroup: vi.fn(),
  setEventGroupMember: vi.fn(),
  saveEventTerm: vi.fn(),
  deleteEventTerm: vi.fn(),
}));

vi.mock("@/lib/events/termsGroupsApi", () => api);

import {
  termsGroupsKeys,
  useDeleteEventGroup,
  useDeleteEventTerm,
  useEventGroups,
  useEventTerms,
  useSaveEventGroup,
  useSaveEventTerm,
  useSetEventGroupMember,
} from "@/lib/events/useEventTermsGroups";
import { registrationKeys } from "@/lib/events/useEventRegistrations";

const EVENT = "evt-kongres";
const OTHER_EVENT = "evt-warsztat";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

/** Wstawia do pamieci wartownika pod kluczem, zeby bylo co uniewaznic. */
function seed(key: readonly unknown[], value: unknown): void {
  client.setQueryData(key, value);
}

/** Czy zapytanie pod kluczem zostalo oznaczone jako niewazne. */
function isStale(key: readonly unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated === true;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchEventGroups.mockResolvedValue([]);
  api.fetchEventTerms.mockResolvedValue([]);
  api.saveEventGroup.mockResolvedValue("grupa-1");
  api.deleteEventGroup.mockResolvedValue(true);
  api.setEventGroupMember.mockResolvedValue(true);
  api.saveEventTerm.mockResolvedValue("zgoda-1");
  api.deleteEventTerm.mockResolvedValue(true);
});

describe("klucze pamieci podrecznej", () => {
  it("obie listy wisza pod jednym korzeniem i pod galezia SWOJEGO wydarzenia", () => {
    expect(termsGroupsKeys.all).toEqual(["event-terms-groups"]);
    expect(termsGroupsKeys.event(EVENT)).toEqual(["event-terms-groups", EVENT]);
    expect(termsGroupsKeys.groups(EVENT)).toEqual(["event-terms-groups", EVENT, "groups"]);
    expect(termsGroupsKeys.terms(EVENT)).toEqual(["event-terms-groups", EVENT, "terms"]);
  });

  // GRUPY I REGULAMINY TO DWIE ROZNE SZUFLADY. Zlanie ich znaczyloby, ze lista
  // regulaminow rysuje wiersze grup - obie sa tablicami obiektow z `id`
  // i `key`, wiec pomylka nie wywalilaby renderu, tylko pokazala bzdury.
  it("grupy i regulaminy nie dziela jednej szuflady", () => {
    expect(termsGroupsKeys.groups(EVENT)).not.toEqual(termsGroupsKeys.terms(EVENT));
  });

  // UPRAWNIENIA JEDNEGO WYDARZENIA NIE MOGA WYCIEC DO DRUGIEGO.
  it("kazde wydarzenie ma wlasna galaz", () => {
    expect(termsGroupsKeys.groups(EVENT)).not.toEqual(termsGroupsKeys.groups(OTHER_EVENT));
    expect(termsGroupsKeys.event(EVENT)).not.toEqual(termsGroupsKeys.event(OTHER_EVENT));
  });
});

describe("brama `enabled` - para „pyta / nie pyta”", () => {
  it("z identyfikatorem wydarzenia grupy SA pobierane", async () => {
    const rows = [{ id: "g-1" }];
    api.fetchEventGroups.mockResolvedValue(rows);
    const { result } = renderHook(() => useEventGroups(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchEventGroups).toHaveBeenCalledExactlyOnceWith(EVENT);
    expect(client.getQueryData(termsGroupsKeys.groups(EVENT))).toBe(rows);
  });

  // PUSTY IDENTYFIKATOR TO STAN „JESZCZE NIE WIADOMO, KTORE WYDARZENIE".
  // Zapytanie wyslane w tym stanie konczy sie odmowa bazy, a panel rysuje
  // czerwone zdanie na ekranie, na ktorym uzytkownik nie zdazyl nic zrobic.
  it("bez identyfikatora wydarzenia zapytanie o grupy NIE idzie do bazy", async () => {
    const { result } = renderHook(() => useEventGroups(""), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchEventGroups).not.toHaveBeenCalled();
    expect(client.getQueryData(termsGroupsKeys.groups(""))).toBeUndefined();
  });

  it("jawne wylaczenie wstrzymuje odczyt grup mimo poprawnego wydarzenia", async () => {
    const { result } = renderHook(() => useEventGroups(EVENT, false), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchEventGroups).not.toHaveBeenCalled();
  });

  it("z identyfikatorem wydarzenia regulaminy SA pobierane", async () => {
    const rows = [{ id: "t-1", version: 2 }];
    api.fetchEventTerms.mockResolvedValue(rows);
    const { result } = renderHook(() => useEventTerms(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.fetchEventTerms).toHaveBeenCalledExactlyOnceWith(EVENT);
  });

  it("bez identyfikatora wydarzenia zapytanie o regulaminy NIE idzie do bazy", async () => {
    const { result } = renderHook(() => useEventTerms(""), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchEventTerms).not.toHaveBeenCalled();
  });

  it("jawne wylaczenie wstrzymuje odczyt regulaminow", async () => {
    const { result } = renderHook(() => useEventTerms(EVENT, false), { wrapper });
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchEventTerms).not.toHaveBeenCalled();
  });

  // ODMOWA NIE PODSTAWIA WYNIKOW POPRZEDNIEGO WYDARZENIA. Bez tego przejscie
  // na wydarzenie, do ktorego wolajacy nie ma dostepu, rysowaloby liste grup
  // poprzedniego - czyli uprawnienia, ktorych nie wolno mu ogladac.
  it("odmowa dla drugiego wydarzenia nie podstawia grup pierwszego", async () => {
    const moje = [{ id: "g-moja" }];
    api.fetchEventGroups.mockResolvedValueOnce(moje);
    api.fetchEventGroups.mockRejectedValueOnce(new Error("forbidden: editor role required"));

    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) => useEventGroups(eventId),
      { wrapper, initialProps: { eventId: EVENT } },
    );
    await waitFor(() => expect(result.current.data).toBe(moje));

    rerender({ eventId: OTHER_EVENT });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(client.getQueryData(termsGroupsKeys.groups(EVENT))).toBe(moje);
    expect(client.getQueryData(termsGroupsKeys.groups(OTHER_EVENT))).toBeUndefined();
  });
});

describe("uniewaznienie po zapisie - para „rusza swoje / nie rusza cudzego”", () => {
  /** Sadzi po jednym wartowniku w kazdej galezi, ktorej dotyczy asercja. */
  function seedAll(): void {
    seed(termsGroupsKeys.groups(EVENT), []);
    seed(termsGroupsKeys.terms(EVENT), []);
    seed(registrationKeys.event(EVENT), []);
    seed(termsGroupsKeys.groups(OTHER_EVENT), []);
    seed(registrationKeys.event(OTHER_EVENT), []);
  }

  // ZAPIS GRUPY RUSZA TAKZE LISTE ZGLOSZEN: grupa domyslna wchodzi do nowych
  // zapisow, a wiersz zgloszenia niesie nazwe i kolor grupy. Lista bez
  // uniewaznienia pokazywalaby uprawnienia sprzed zapisu.
  it("zapis grupy uniewaznia grupy, regulaminy i zgloszenia TEGO wydarzenia", async () => {
    seedAll();
    const { result } = renderHook(() => useSaveEventGroup(EVENT), { wrapper });
    result.current.mutate({ namePl: "VIP", nameEn: "VIP" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isStale(termsGroupsKeys.groups(EVENT))).toBe(true);
    expect(isStale(termsGroupsKeys.terms(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(EVENT))).toBe(true);
  });

  it("zapis grupy NIE rusza galezi innego wydarzenia", async () => {
    seedAll();
    const { result } = renderHook(() => useSaveEventGroup(EVENT), { wrapper });
    result.current.mutate({ namePl: "VIP", nameEn: "VIP" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isStale(termsGroupsKeys.groups(OTHER_EVENT))).toBe(false);
    expect(isStale(registrationKeys.event(OTHER_EVENT))).toBe(false);
  });

  it("usuniecie grupy uniewaznia te same dwie galezie", async () => {
    seedAll();
    const { result } = renderHook(() => useDeleteEventGroup(EVENT), { wrapper });
    result.current.mutate("g-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isStale(termsGroupsKeys.groups(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(EVENT))).toBe(true);
    expect(isStale(termsGroupsKeys.groups(OTHER_EVENT))).toBe(false);
  });

  // CZLONKOSTWO DODATKOWE ZMIENIA UPRAWNIENIA JEDNEJ OSOBY, a licznik grup
  // dodatkowych stoi w wierszu zgloszenia - stad ta sama para galezi.
  it("zmiana czlonkostwa uniewaznia grupy i zgloszenia TEGO wydarzenia", async () => {
    seedAll();
    const { result } = renderHook(() => useSetEventGroupMember(EVENT), { wrapper });
    result.current.mutate({ groupId: "g-1", personId: "p-1", isMember: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isStale(termsGroupsKeys.groups(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(OTHER_EVENT))).toBe(false);
  });

  // ZAPIS REGULAMINU RUSZA LISTE ZGLOSZEN, bo wiersz zgloszenia niesie licznik
  // BRAKUJACYCH zgod (`required_terms_missing`). Po podniesieniu wersji ten
  // licznik zmienia sie kazdemu uczestnikowi naraz.
  it("zapis regulaminu uniewaznia regulaminy i zgloszenia TEGO wydarzenia", async () => {
    seedAll();
    const { result } = renderHook(() => useSaveEventTerm(EVENT), { wrapper });
    result.current.mutate({ labelPl: "RODO", labelEn: "GDPR", bumpVersion: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isStale(termsGroupsKeys.terms(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(OTHER_EVENT))).toBe(false);
  });

  it("usuniecie regulaminu uniewaznia te same dwie galezie", async () => {
    seedAll();
    const { result } = renderHook(() => useDeleteEventTerm(EVENT), { wrapper });
    result.current.mutate("t-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(isStale(termsGroupsKeys.terms(EVENT))).toBe(true);
    expect(isStale(registrationKeys.event(EVENT))).toBe(true);
    expect(isStale(termsGroupsKeys.terms(OTHER_EVENT))).toBe(false);
  });

  // NIEUDANY ZAPIS NIE UNIEWAZNIA NICZEGO. Odswiezenie listy po odmowie
  // sugerowaloby, ze cos sie zmienilo - a nie zmienilo.
  it("odmowa zapisu grupy nie uniewaznia zadnej galezi", async () => {
    seedAll();
    api.saveEventGroup.mockRejectedValue(new Error("forbidden: editor role required"));
    const { result } = renderHook(() => useSaveEventGroup(EVENT), { wrapper });
    result.current.mutate({ namePl: "VIP", nameEn: "VIP" });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(isStale(termsGroupsKeys.groups(EVENT))).toBe(false);
    expect(isStale(registrationKeys.event(EVENT))).toBe(false);
  });

  it("odmowa usuniecia regulaminu (`term_in_use`) nie uniewaznia zadnej galezi", async () => {
    seedAll();
    api.deleteEventTerm.mockRejectedValue(
      new Error("term_in_use: 3 acceptance(s) recorded - deactivate instead"),
    );
    const { result } = renderHook(() => useDeleteEventTerm(EVENT), { wrapper });
    result.current.mutate("t-1");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(isStale(termsGroupsKeys.terms(EVENT))).toBe(false);
    expect(isStale(registrationKeys.event(EVENT))).toBe(false);
  });
});

describe("mutacje oddaja warstwie danych to, co dostaly", () => {
  it("zapis grupy przekazuje szkic bez podmiany pol", async () => {
    const input = {
      id: "g-1",
      namePl: "Goscie honorowi",
      nameEn: "VIP guests",
      canMeet: false,
      isDefault: true,
    };
    const { result } = renderHook(() => useSaveEventGroup(EVENT), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.saveEventGroup).toHaveBeenCalledExactlyOnceWith(input);
    expect(result.current.data).toBe("grupa-1");
  });

  it("zapis regulaminu przekazuje szkic razem z decyzja o wersji", async () => {
    const input = { id: "t-1", labelPl: "RODO", labelEn: "GDPR", bumpVersion: true };
    const { result } = renderHook(() => useSaveEventTerm(EVENT), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.saveEventTerm).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("zmiana czlonkostwa przekazuje komplet trojki grupa-osoba-stan", async () => {
    const input = { groupId: "g-1", personId: "p-1", isMember: false };
    const { result } = renderHook(() => useSetEventGroupMember(EVENT), { wrapper });
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.setEventGroupMember).toHaveBeenCalledExactlyOnceWith(input);
  });
});
