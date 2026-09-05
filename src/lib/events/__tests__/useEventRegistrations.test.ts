// Hooki PANELU ZAPISOW: klucze pamieci podrecznej, brama `enabled`, okna
// swiezosci i zasieg uniewaznienia po decyzji organizatora.
//
// PO CO TEN PLIK ISTNIEJE - cztery klasy bledow, ktorych nie zlapie zaden test
// renderujacy zakladke "Zgloszenia".
//
// 1) KLUCZ, KTORY SIE ZLEWA Z INNYM, POKAZUJE CUDZE ZGLOSZENIA. Klucze listy
//    i licznikow sklejaja identyfikator wydarzenia z CALYM zapytaniem filtra.
//    Zgubiony segment znaczy, ze ekran kongresu rysuje zgloszenia warsztatu -
//    czyli dane osobowe uczestnikow innego wydarzenia.
// 2) UNIEWAZNIENIE, KTORE NIE SIEGA WSZYSTKICH TRZECH LIST, ZOSTAWIA LICZNIKI
//    KLAMIACE. Naglowek modulu (`useEventRegistrations.ts:3-12`) obiecuje, ze
//    jedna decyzja rusza liste, liczniki statusow i pule biletu naraz. Obietnica
//    zyje w jednej prywatnej funkcji `useInvalidateEvent`, ale `onSuccess` jest
//    dopisany OSOBNO przy kazdym z osmiu hakow - skasowanie jednego nie psuje
//    niczego widocznego od razu, bo liczby nadal wygladaja wiarygodnie.
// 3) OKNO SWIEZOSCI POMYLONE MIEDZY EKRANAMI. Lista i liczniki starzeja sie po
//    pietnastu sekundach (w dniu wydarzenia organizator patrzy na ekran co
//    kilkadziesiat sekund), bilety i pola formularza po minucie. Zamiana tych
//    stalych miejscami jest w kodzie niewidoczna.
// 4) IDENTYFIKATOR PODMIENIONY PO DRODZE. Decyzja organizatora, promocja
//    z rezerwy i odznaczenie powiadomienia operuja na ZGLOSZENIU, a nie na
//    wydarzeniu ani na bilecie. Oba identyfikatory sa napisami, wiec zamiana
//    przechodzi typowanie, a w bazie konczy sie decyzja na cudzym wierszu.
//
// Zaleznoscia jest tu `registrationsApi` (siec) - i tylko ona jest atrapa.
// Zostawiamy jej PRAWDZIWE stale (`REGISTRATION_STATUSES`,
// `DEFAULT_REGISTRATIONS_QUERY`), bo `registrationCounts.ts` czyta z niej liste
// statusow, a test przepisany z wlasnej kopii nie dowodzilby, ze oba moduly
// mowia o tym samym zbiorze stanow.
//
// ZAWEZENIE NAJEMCA siedzi w SQL-u: kazda operacja tego modulu idzie przez RPC
// `admin_event_*` z bramka po stronie bazy, a nie przez `.from(...)`. Tutaj
// pilnujemy nazwy funkcji warstwy API i ladunku; filtra tenanta pilnuje bramka
// `check:sql-tenant-scope`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchEventTickets: vi.fn(),
  fetchRegistrationFields: vi.fn(),
  fetchRegistrations: vi.fn(),
  fetchRegistrationCounts: vi.fn(),
  saveEventTicket: vi.fn(),
  deleteEventTicket: vi.fn(),
  saveRegistrationField: vi.fn(),
  deleteRegistrationField: vi.fn(),
  decideRegistration: vi.fn(),
  saveRegistration: vi.fn(),
  promoteFromWaitlist: vi.fn(),
  markRegistrationsNotified: vi.fn(),
}));

// Klient bazy jest atrapowany wzorcem repozytorium, bo prawdziwy modul
// `registrationsApi` (wciagany nizej przez `importOriginal`) ciagnie go
// w imporcie.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

// Podmieniamy WYLACZNIE funkcje sieciowe; stale domenowe zostaja prawdziwe.
vi.mock("@/lib/events/registrationsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/registrationsApi")>()),
  ...api,
}));

import {
  registrationKeys,
  useDecideRegistration,
  useDeleteEventTicket,
  useDeleteRegistrationField,
  useEventTickets,
  useMarkRegistrationsNotified,
  usePromoteFromWaitlist,
  useRegistrationCounts,
  useRegistrationFields,
  useRegistrationsList,
  useSaveEventTicket,
  useSaveRegistration,
  useSaveRegistrationField,
} from "@/lib/events/useEventRegistrations";
import {
  DEFAULT_REGISTRATIONS_QUERY,
  type EventTicketInput,
  type RegistrationCountsQuery,
  type RegistrationFieldInput,
  type RegistrationUpsertInput,
  type RegistrationsQuery,
} from "@/lib/events/registrationsApi";

const EVENT = "evt-kongres";
const OTHER_EVENT = "evt-warsztat";
/** Identyfikator zgloszenia - syntetyczny, jak wszystkie dane w tym pliku. */
const REGISTRATION = "zgl-8f21";

const BASE_MS = Date.parse("2026-05-11T09:00:00.000Z");

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

function listQuery(overrides: Partial<RegistrationsQuery> = {}): RegistrationsQuery {
  return { eventId: EVENT, ...DEFAULT_REGISTRATIONS_QUERY, ...overrides };
}

function countsQuery(overrides: Partial<RegistrationCountsQuery> = {}): RegistrationCountsQuery {
  return {
    eventId: EVENT,
    ticketTypeId: null,
    groupId: null,
    q: "",
    from: null,
    to: null,
    ...overrides,
  };
}

function ticketInput(overrides: Partial<EventTicketInput> = {}): EventTicketInput {
  return {
    id: null,
    eventId: EVENT,
    key: "standard",
    namePl: "Wstep standardowy",
    nameEn: "Standard entry",
    descriptionPl: "",
    descriptionEn: "",
    priceCents: 25000,
    currency: "PLN",
    quota: 100,
    salesFrom: null,
    salesTo: null,
    minTierRank: 0,
    requiresApproval: false,
    groupId: null,
    isActive: true,
    sortOrder: 0,
    earlyBirdPriceCents: null,
    earlyBirdUntil: null,
    accessCodeHint: "",
    waitlistEnabled: true,
    benefitsPl: [],
    benefitsEn: [],
    priceSchedule: [],
    ...overrides,
  };
}

function fieldInput(overrides: Partial<RegistrationFieldInput> = {}): RegistrationFieldInput {
  return {
    id: null,
    eventId: EVENT,
    key: "dieta",
    fieldType: "select",
    labelPl: "Preferencje zywieniowe",
    labelEn: "Dietary preferences",
    helpPl: "",
    helpEn: "",
    consentUrlPl: "",
    consentUrlEn: "",
    isRequired: false,
    options: ["standard", "wege"],
    sortOrder: 0,
    isQualifying: false,
    qualifyOperator: "none",
    qualifyValue: null,
    qualifyOutcome: "approval",
    isActive: true,
    ...overrides,
  };
}

function registrationInput(
  overrides: Partial<RegistrationUpsertInput> = {},
): RegistrationUpsertInput {
  return {
    id: null,
    eventId: EVENT,
    firstName: "Anna",
    lastName: "Przykladowa",
    email: "anna.przykladowa@example.com",
    phone: "+48 000 000 000",
    jobTitle: "Analityczka",
    companyText: "Instytut Przykladowy",
    socialProfileUrl: null,
    ticketTypeId: null,
    groupId: null,
    status: null,
    answers: undefined,
    note: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchEventTickets.mockResolvedValue([]);
  api.fetchRegistrationFields.mockResolvedValue([]);
  api.fetchRegistrations.mockResolvedValue({ rows: [], total: 0 });
  api.fetchRegistrationCounts.mockResolvedValue({});
  api.saveEventTicket.mockResolvedValue("bil-1");
  api.deleteEventTicket.mockResolvedValue(true);
  api.saveRegistrationField.mockResolvedValue("pole-1");
  api.deleteRegistrationField.mockResolvedValue(true);
  api.decideRegistration.mockResolvedValue({ ok: true });
  api.saveRegistration.mockResolvedValue(REGISTRATION);
  api.promoteFromWaitlist.mockResolvedValue({ promoted: 1 });
  api.markRegistrationsNotified.mockResolvedValue(1);
});

afterEach(() => {
  // Czesc przypadkow podmienia SAM ZEGAR (bez podmiany `setTimeout`), zeby
  // zmierzyc okno swiezosci.
  vi.useRealTimers();
});

describe("klucze pamieci podrecznej zapisow", () => {
  it("wszystkie ekrany wydarzenia wisza pod JEDNA galezia", () => {
    // Kazda mutacja kasuje `registrationKeys.event(eventId)`. Klucz, ktory
    // wypadlby spod tej galezi, przezylby decyzje organizatora z nieaktualnymi
    // danymi - a to sa liczby, po ktorych organizator otwiera lub zamyka zapisy.
    expect(registrationKeys.all).toEqual(["event-registrations"]);
    expect(registrationKeys.event(EVENT)).toEqual(["event-registrations", EVENT]);
    expect(registrationKeys.tickets(EVENT)).toEqual(["event-registrations", EVENT, "tickets"]);
    expect(registrationKeys.fields(EVENT)).toEqual(["event-registrations", EVENT, "fields"]);
    expect(registrationKeys.tickets(EVENT).slice(0, 2)).toEqual(registrationKeys.event(EVENT));
    expect(registrationKeys.fields(EVENT).slice(0, 2)).toEqual(registrationKeys.event(EVENT));
  });

  it("lista i liczniki tez wisza pod galezia wydarzenia, a nie obok niej", () => {
    // Filtr jedzie w OSTATNIM segmencie, wiec uniewaznienie galezi wydarzenia
    // siega kazdego przekroju naraz. Gdyby filtr wskoczyl przed identyfikator
    // wydarzenia, decyzja odswiezalaby tylko ten przekroj, na ktorym stoi
    // kursor - i zakladka obok pokazywalaby stara pule.
    const query = listQuery({ status: "pending" });
    expect(registrationKeys.list(query).slice(0, 2)).toEqual(registrationKeys.event(EVENT));
    expect(registrationKeys.list(query)).toEqual(["event-registrations", EVENT, "list", query]);

    const counts = countsQuery();
    expect(registrationKeys.counts(counts).slice(0, 2)).toEqual(registrationKeys.event(EVENT));
    expect(registrationKeys.counts(counts)).toEqual([
      "event-registrations",
      EVENT,
      "counts",
      counts,
    ]);
  });

  it("brak wybranego wydarzenia dostaje segment `idle`, a nie pusty identyfikator", () => {
    // `null` opisuje stan wylaczenia wprost (komentarz :52-54). Pusty napis
    // w miejscu identyfikatora wpadlby do galezi `event("")`, czyli do
    // szuflady, ktora uniewaznienie jakiegokolwiek wydarzenia moglo by ruszyc.
    expect(registrationKeys.list(null)).toEqual(["event-registrations", "list", "idle"]);
    expect(registrationKeys.counts(null)).toEqual(["event-registrations", "counts", "idle"]);
    expect(registrationKeys.list(null)).not.toContain(EVENT);
  });

  it("dwa wydarzenia maja ROZLACZNE szuflady na kazdym ekranie", () => {
    expect(registrationKeys.event(EVENT)).not.toEqual(registrationKeys.event(OTHER_EVENT));
    expect(registrationKeys.tickets(EVENT)).not.toEqual(registrationKeys.tickets(OTHER_EVENT));
    expect(registrationKeys.list(listQuery())).not.toEqual(
      registrationKeys.list(listQuery({ eventId: OTHER_EVENT })),
    );
  });

  it("kazdy przekroj filtra dostaje WLASNA szuflade", () => {
    // Zlanie przekrojow pokazaloby pod zakladka "Oczekujace" wiersze
    // zatwierdzone - z widocznym licznikiem, ktory sie z nimi nie zgadza.
    expect(registrationKeys.list(listQuery({ status: "pending" }))).not.toEqual(
      registrationKeys.list(listQuery({ status: "approved" })),
    );
    expect(registrationKeys.list(listQuery({ offset: 0 }))).not.toEqual(
      registrationKeys.list(listQuery({ offset: 25 })),
    );
    expect(registrationKeys.counts(countsQuery({ ticketTypeId: "bil-1" }))).not.toEqual(
      registrationKeys.counts(countsQuery({ ticketTypeId: "bil-2" })),
    );
  });

  it("fraza rozniaca sie samymi spacjami trafia do TEJ SAMEJ szuflady", () => {
    // NAPRAWIONY DEFEKT. `fetchRegistrations` przepuszcza fraze przez
    // `trimmedOrNull` (`registrationsApi.ts` - `p_q: trimmedOrNull(query.q) ??
    // undefined`), wiec "Kowalska" i "Kowalska " pytaja baze o DOKLADNIE te
    // same wiersze. Klucz pamieci bral wczesniej `query.q` surowe, a panel
    // wklada tam tresc pola bez przyciecia
    // (`RegistrationsListPanel.tsx` - `setQ(search)`).
    //
    // DLACZEGO TO BOLALO. Spacja doklejona przy wklejaniu nazwiska ze schowka
    // kasowala trafienie w pamiec: lista I liczniki szly do bazy jeszcze raz po
    // te same wiersze, a organizator widzial pusty ekran z kreciolka w dniu
    // wydarzenia.
    expect(registrationKeys.list(listQuery({ q: "Kowalska " }))).toEqual(
      registrationKeys.list(listQuery({ q: "Kowalska" })),
    );
    // Spacja z KAZDEJ strony, nie tylko doklejona na koncu.
    expect(registrationKeys.counts(countsQuery({ q: "  Kowalska" }))).toEqual(
      registrationKeys.counts(countsQuery({ q: "Kowalska" })),
    );
    // Skasowanie frazy "do konca": "" i " " to dla bazy jeden przypadek (brak
    // filtra), wiec musza byc jednym przypadkiem takze dla pamieci.
    expect(registrationKeys.list(listQuery({ q: " " }))).toEqual(
      registrationKeys.list(listQuery({ q: "" })),
    );
    // Przyciecie NIE zlewa roznych fraz - to nadal sa dwie szuflady.
    expect(registrationKeys.list(listQuery({ q: "Kowalska" }))).not.toEqual(
      registrationKeys.list(listQuery({ q: "Kowalski" })),
    );
  });
});

describe("useEventTickets", () => {
  it("pobiera bilety WSKAZANEGO wydarzenia i oddaje je pod kluczem biletow", async () => {
    const rows = [{ id: "bil-1", key: "standard" }];
    api.fetchEventTickets.mockResolvedValue(rows);

    const { result } = renderHook(() => useEventTickets(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchEventTickets).toHaveBeenCalledWith(EVENT);
    expect(client.getQueryData(registrationKeys.tickets(EVENT))).toBe(rows);
  });

  it("bez wybranego wydarzenia NIE pyta bazy o bilety", async () => {
    // Panel montuje sie, zanim trasa poda identyfikator. Zapytanie z pustym
    // wydarzeniem konczy sie odmowa, ktora panel pokazuje jako blad na czystym
    // ekranie.
    const { result } = renderHook(() => useEventTickets(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(api.fetchEventTickets).not.toHaveBeenCalled();
  });

  it("blad biletow dociera do ekranu jako blad, a nie jako brak biletow", async () => {
    // "Brak biletow" znaczy dla organizatora "wydarzenie bezplatne" - i tak tez
    // wyglada ekran. Sciszony blad kaze mu zalozyc bilet, ktory juz istnieje.
    api.fetchEventTickets.mockRejectedValue(new Error("brak uprawnien"));

    const { result } = renderHook(() => useEventTickets(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    // Tresc bledu jedzie do panelu bez podmiany na komunikat ogolny - to po
    // niej organizator pozna, ze problemem jest rola, a nie siec.
    expect(result.current.error?.message).toBe("brak uprawnien");
  });
});

describe("useRegistrationFields", () => {
  it("pobiera pola formularza wskazanego wydarzenia", async () => {
    const rows = [{ id: "pole-1", key: "dieta" }];
    api.fetchRegistrationFields.mockResolvedValue(rows);

    const { result } = renderHook(() => useRegistrationFields(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchRegistrationFields).toHaveBeenCalledWith(EVENT);
    expect(client.getQueryData(registrationKeys.fields(EVENT))).toBe(rows);
  });

  it("bez wybranego wydarzenia NIE pyta bazy o pola", async () => {
    const { result } = renderHook(() => useRegistrationFields(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchRegistrationFields).not.toHaveBeenCalled();
    // Brak wydarzenia to stan "jeszcze nie wiem", a nie "formularz bez pytan
    // dodatkowych" - te dwa stany rysuja w panelu dwa rozne ekrany.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });

  it("wybranie wydarzenia PO montazu uruchamia pobranie", async () => {
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string | null }) => useRegistrationFields(eventId),
      { wrapper, initialProps: { eventId: null as string | null } },
    );
    expect(api.fetchRegistrationFields).not.toHaveBeenCalled();

    rerender({ eventId: EVENT });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchRegistrationFields).toHaveBeenCalledExactlyOnceWith(EVENT);
  });

  it("PUSTA lista pol jest poprawnym wynikiem - formularz bez pytan dodatkowych", async () => {
    api.fetchRegistrationFields.mockResolvedValue([]);

    const { result } = renderHook(() => useRegistrationFields(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });

  it("blad pol formularza dociera do ekranu", async () => {
    // Pusta lista pol znaczy "formularz bez pytan dodatkowych" i tak tez
    // wyglada panel. Sciszony blad kazalby redaktorowi zdefiniowac pola,
    // ktore juz istnieja - a po zapisie baza odbilaby duplikat klucza.
    api.fetchRegistrationFields.mockRejectedValue(new Error("brak uprawnien"));

    const { result } = renderHook(() => useRegistrationFields(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe("brak uprawnien");
  });
});

describe("useRegistrationsList", () => {
  it("oddaje warstwie API CALE zapytanie filtra, nie samo wydarzenie", async () => {
    // Strona, limit i filtry sa czescia zapytania do bazy. Zgubiony `offset`
    // znaczy, ze przycisk "dalej" pokazuje wciaz pierwsza strone.
    const query = listQuery({ status: "waitlist", offset: 25, q: "Kowalska" });
    api.fetchRegistrations.mockResolvedValue({ rows: [{ id: REGISTRATION }], total: 42 });

    const { result } = renderHook(() => useRegistrationsList(query), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchRegistrations).toHaveBeenCalledWith(query);
    expect(result.current.data?.total).toBe(42);
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("bez zapytania NIE pyta bazy o zgloszenia", async () => {
    const { result } = renderHook(() => useRegistrationsList(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchRegistrations).not.toHaveBeenCalled();
  });

  it("zmiana strony pobiera OSOBNY zestaw wierszy, a poprzednia strona zostaje w pamieci", async () => {
    api.fetchRegistrations.mockImplementation((query: RegistrationsQuery) =>
      Promise.resolve({ rows: [{ id: `wiersz-${query.offset}` }], total: 50 }),
    );

    const { result, rerender } = renderHook(
      ({ offset }: { offset: number }) => useRegistrationsList(listQuery({ offset })),
      { wrapper, initialProps: { offset: 0 } },
    );
    await waitFor(() => expect(result.current.data?.rows).toEqual([{ id: "wiersz-0" }]));

    rerender({ offset: 25 });
    await waitFor(() => expect(result.current.data?.rows).toEqual([{ id: "wiersz-25" }]));

    // Powrot na pierwsza strone ma byc natychmiastowy, bez ponownego pytania.
    expect(client.getQueryData(registrationKeys.list(listQuery({ offset: 0 })))).toEqual({
      rows: [{ id: "wiersz-0" }],
      total: 50,
    });
    expect(api.fetchRegistrations).toHaveBeenCalledTimes(2);
  });

  it("blad listy nie jest mylony z brakiem zgloszen", async () => {
    // Pusta lista znaczy "nikt sie nie zapisal" - komunikat, po ktorym
    // organizator zaczyna promowac wydarzenie. Blad musi wygladac inaczej.
    api.fetchRegistrations.mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => useRegistrationsList(listQuery()), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Ani wierszy, ani licznika calosci: `total` sciszony do zera pokazalby
    // "0 zgloszen" nad pusta tabela, czyli ekran nie do odroznienia od prawdy.
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe("timeout");
  });
});

describe("useRegistrationCounts", () => {
  it("przepuszcza surowy jsonb z bazy przez czytnik licznikow", async () => {
    // Hak nie oddaje ekranowi `jsonb` do rzutowania - to jest cala jego robota
    // ponad zwyklym pobraniem. Bez tego "NaN" wrenderowany na zakladce statusu
    // jest kwestia pierwszej zmiany nazwy pola w SQL-u.
    api.fetchRegistrationCounts.mockResolvedValue({
      all: 12,
      pending: 3,
      approved: 7,
      waitlist: 2,
      awaiting_notice: 2,
      capacity: null,
      seats_left: null,
    });

    const { result } = renderHook(() => useRegistrationCounts(countsQuery()), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.all).toBe(12);
    expect(result.current.data?.byStatus.pending).toBe(3);
    expect(result.current.data?.byStatus.approved).toBe(7);
    expect(result.current.data?.awaitingNotice).toBe(2);
    // Statusy nieobecne w odpowiedzi maja byc zerami, a nie brakiem klucza -
    // zakladka "Odrzucone" musi pokazac "0", a nie puste miejsce.
    expect(result.current.data?.byStatus.rejected).toBe(0);
  });

  it("BRAK LIMITU MIEJSC nie jest zerem wolnych miejsc", async () => {
    // `null` przy pojemnosci znaczy "wydarzenie bez limitu". Sklejenie go
    // z zerem pokazaloby "0 wolnych miejsc" na wydarzeniu, ktore przyjmuje
    // kazdego - komunikat dokladnie odwrotny do prawdy.
    api.fetchRegistrationCounts.mockResolvedValue({ all: 5, capacity: null, seats_left: null });

    const { result } = renderHook(() => useRegistrationCounts(countsQuery()), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.capacity).toBeNull();
    expect(result.current.data?.seatsLeft).toBeNull();
  });

  it("SALA PELNA to zero wolnych miejsc, a nie brak limitu", async () => {
    api.fetchRegistrationCounts.mockResolvedValue({ all: 100, capacity: 100, seats_left: 0 });

    const { result } = renderHook(() => useRegistrationCounts(countsQuery()), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.capacity).toBe(100);
    expect(result.current.data?.seatsLeft).toBe(0);
  });

  it("bez zapytania NIE pyta bazy o liczniki", async () => {
    const { result } = renderHook(() => useRegistrationCounts(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchRegistrationCounts).not.toHaveBeenCalled();
  });

  it("blad licznikow dociera do ekranu, zamiast pokazywac same zera", async () => {
    // Zera sa wiarygodne. Zera zamiast bledu to jedyny przypadek, w ktorym
    // organizator zamyka zapisy, bo "nikt nie przyszedl".
    api.fetchRegistrationCounts.mockRejectedValue(new Error("brak uprawnien"));

    const { result } = renderHook(() => useRegistrationCounts(countsQuery()), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    // Czytnik licznikow nie ma prawa zamienic bledu na komplet zer - to jest
    // ten jeden ekran, po ktorym organizator zamyka zapisy.
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe("brak uprawnien");
  });
});

describe("okna swiezosci", () => {
  it("lista zgloszen starzeje sie SZYBCIEJ niz konfiguracja biletow i pol", async () => {
    // Dwie rozne stale, dwa rozne powody: lista i liczniki zmieniaja sie
    // w trakcie wydarzenia co chwile, bilety i pola formularza zmieniaja sie
    // PRZED nim. Zamiana ich miejscami albo bije w baze bez powodu, albo
    // pokazuje w dniu wydarzenia liczby sprzed minuty.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(
      () => ({ list: useRegistrationsList(listQuery()), fields: useRegistrationFields(EVENT) }),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.list.isSuccess).toBe(true));
    await waitFor(() => expect(first.result.current.fields.isSuccess).toBe(true));
    first.unmount();

    // Dwadziescia sekund pozniej - organizator wrocil na zakladke.
    vi.setSystemTime(new Date(BASE_MS + 20_000));
    const second = renderHook(
      () => ({ list: useRegistrationsList(listQuery()), fields: useRegistrationFields(EVENT) }),
      { wrapper },
    );
    await waitFor(() => expect(api.fetchRegistrations).toHaveBeenCalledTimes(2));

    expect(api.fetchRegistrationFields).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("konfiguracja biletow zostaje swieza przez minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(BASE_MS));

    const first = renderHook(() => useEventTickets(EVENT), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    vi.setSystemTime(new Date(BASE_MS + 50_000));
    const second = renderHook(() => useEventTickets(EVENT), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(api.fetchEventTickets).toHaveBeenCalledTimes(1);
    second.unmount();

    // Po minucie bilet zmieniony przez wspolpracownika ma sie pojawic sam.
    vi.setSystemTime(new Date(BASE_MS + 70_000));
    const third = renderHook(() => useEventTickets(EVENT), { wrapper });
    await waitFor(() => expect(api.fetchEventTickets).toHaveBeenCalledTimes(2));
    third.unmount();
  });
});

// DRUGI ARGUMENT `mutationFn`. TanStack Query 5 wola funkcje mutujaca jako
// (zmienne, kontekst), a wszystkie osiem hakow tego modulu podaje funkcje
// warstwy API WPROST - stad `expect.anything()` w asercjach argumentow.
describe("mutacje zapisow - argumenty i wynik", () => {
  it("useSaveEventTicket oddaje warstwie API caly formularz biletu", async () => {
    const input = ticketInput({ id: "bil-1", quota: null, waitlistEnabled: false });
    api.saveEventTicket.mockResolvedValue("bil-1");

    const { result } = renderHook(() => useSaveEventTicket(EVENT), { wrapper });
    const saved = await result.current.mutateAsync(input);

    expect(api.saveEventTicket).toHaveBeenCalledWith(input, expect.anything());
    expect(saved).toBe("bil-1");
  });

  it("useDeleteEventTicket kasuje bilet po identyfikatorze BILETU, nie wydarzenia", async () => {
    // Hak zna wydarzenie (dostaje je w argumencie) i identyfikator biletu
    // (dostaje go w mutacji). Podmiana jednego na drugi przechodzi typowanie.
    const { result } = renderHook(() => useDeleteEventTicket(EVENT), { wrapper });
    const removed = await result.current.mutateAsync("bil-2");

    expect(api.deleteEventTicket).toHaveBeenCalledWith("bil-2", expect.anything());
    expect(api.deleteEventTicket).not.toHaveBeenCalledWith(EVENT, expect.anything());
    expect(removed).toBe(true);
  });

  it("useSaveRegistrationField oddaje warstwie API cale pole formularza", async () => {
    const input = fieldInput({
      isQualifying: true,
      qualifyOperator: "equals",
      qualifyValue: "wege",
    });
    api.saveRegistrationField.mockResolvedValue("pole-1");

    const { result } = renderHook(() => useSaveRegistrationField(EVENT), { wrapper });
    const saved = await result.current.mutateAsync(input);

    // Pole kwalifikujace wyznacza werdykt zgloszenia (auto-zatwierdzenie,
    // rezerwa, odrzucenie) - zgubiony operator zmienia regule na "zawsze tak".
    expect(api.saveRegistrationField).toHaveBeenCalledWith(input, expect.anything());
    expect(saved).toBe("pole-1");
  });

  it("useDeleteRegistrationField kasuje pole po identyfikatorze POLA", async () => {
    const { result } = renderHook(() => useDeleteRegistrationField(EVENT), { wrapper });
    const removed = await result.current.mutateAsync("pole-2");

    expect(api.deleteRegistrationField).toHaveBeenCalledWith("pole-2", expect.anything());
    expect(api.deleteRegistrationField).not.toHaveBeenCalledWith(EVENT, expect.anything());
    expect(removed).toBe(true);
  });

  it("useDecideRegistration przenosi decyzje razem z uzasadnieniem", async () => {
    // Baza wymaga uzasadnienia przy odrzuceniu (`reason_required`). Zgubione
    // `note` konczy sie odmowa po stronie bazy - albo, gorzej, odrzuceniem bez
    // powodu w wiadomosci do uczestnika.
    api.decideRegistration.mockResolvedValue({ status: "rejected" });

    const { result } = renderHook(() => useDecideRegistration(EVENT), { wrapper });
    const outcome = await result.current.mutateAsync({
      registrationId: REGISTRATION,
      action: "reject",
      note: "Brak miejsc w tej edycji",
    });

    expect(api.decideRegistration).toHaveBeenCalledWith(
      { registrationId: REGISTRATION, action: "reject", note: "Brak miejsc w tej edycji" },
      expect.anything(),
    );
    expect(outcome).toEqual({ status: "rejected" });
  });

  it("useSaveRegistration oddaje dane uczestnika i zwraca identyfikator zgloszenia", async () => {
    const input = registrationInput({
      status: "approved",
      note: "Zapis recznie przez organizatora",
    });
    api.saveRegistration.mockResolvedValue(REGISTRATION);

    const { result } = renderHook(() => useSaveRegistration(EVENT), { wrapper });
    const saved = await result.current.mutateAsync(input);

    expect(api.saveRegistration).toHaveBeenCalledWith(input, expect.anything());
    expect(saved).toBe(REGISTRATION);
  });

  it("usePromoteFromWaitlist przenosi LICZBE osob do awansu, gdy nie wskazano wiersza", async () => {
    // `registrationId: null` znaczy "promuj po kolejce"; wtedy liczba jest
    // jedyna informacja o zasiegu operacji. Zgubiona konczy sie awansem
    // jednej osoby zamiast dziesieciu - bez sladu w interfejsie.
    api.promoteFromWaitlist.mockResolvedValue({ promoted: 10 });

    const { result } = renderHook(() => usePromoteFromWaitlist(EVENT), { wrapper });
    const outcome = await result.current.mutateAsync({
      eventId: EVENT,
      registrationId: null,
      ticketTypeId: "bil-1",
      count: 10,
    });

    expect(api.promoteFromWaitlist).toHaveBeenCalledWith(
      { eventId: EVENT, registrationId: null, ticketTypeId: "bil-1", count: 10 },
      expect.anything(),
    );
    expect(outcome).toEqual({ promoted: 10 });
  });

  it("useMarkRegistrationsNotified oddaje CALA liste zgloszen i zwraca liczbe wierszy", async () => {
    // Przycisk "oznacz jako powiadomionych" dziala na zaznaczeniu. Przyciecie
    // listy do pierwszego wiersza zostawialoby reszte w stanie "czeka na
    // powiadomienie" - czyli organizator wysylalby te wiadomosci drugi raz.
    const ids = [REGISTRATION, "zgl-4b70", "zgl-c19d"];
    api.markRegistrationsNotified.mockResolvedValue(3);

    const { result } = renderHook(() => useMarkRegistrationsNotified(EVENT), { wrapper });
    const stamped = await result.current.mutateAsync(ids);

    expect(api.markRegistrationsNotified).toHaveBeenCalledWith(ids, expect.anything());
    expect(stamped).toBe(3);
  });

  it("odrzucona decyzja konczy sie bledem mutacji, a nie cichym sukcesem", async () => {
    // Organizator, ktory zobaczy zielony komunikat po nieudanej decyzji,
    // zamknie dialog przekonany, ze uczestnik zostal zatwierdzony.
    api.decideRegistration.mockRejectedValue(new Error("reason_required"));

    const { result } = renderHook(() => useDecideRegistration(EVENT), { wrapper });
    await expect(
      result.current.mutateAsync({ registrationId: REGISTRATION, action: "reject", note: null }),
    ).rejects.toThrow("reason_required");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("reason_required");
  });
});

describe("decyzja i powiadomienie na TYM SAMYM zgloszeniu", () => {
  it("decyzja, awans z rezerwy i pieczec powiadomienia niosa jeden identyfikator", async () => {
    // Klienckie odpowiedniki tego, co po stronie serwera robi wysylka
    // powiadomien. Wszystkie trzy kroki musza wskazywac TEN SAM wiersz
    // zgloszenia: zatwierdzenie jednej osoby, awans drugiej i pieczec na
    // trzeciej to trzy niezalezne klamstwa w skrzynce uczestnika. Identyfikator
    // wydarzenia i identyfikator zgloszenia sa oba napisami, wiec zamiana
    // przechodzi typowanie.
    const { result } = renderHook(
      () => ({
        decide: useDecideRegistration(EVENT),
        promote: usePromoteFromWaitlist(EVENT),
        markNotified: useMarkRegistrationsNotified(EVENT),
      }),
      { wrapper },
    );

    await result.current.decide.mutateAsync({
      registrationId: REGISTRATION,
      action: "approve",
      note: null,
    });
    await result.current.promote.mutateAsync({
      eventId: EVENT,
      registrationId: REGISTRATION,
      ticketTypeId: null,
      count: 1,
    });
    await result.current.markNotified.mutateAsync([REGISTRATION]);

    expect(api.decideRegistration).toHaveBeenCalledWith(
      { registrationId: REGISTRATION, action: "approve", note: null },
      expect.anything(),
    );
    expect(api.promoteFromWaitlist).toHaveBeenCalledWith(
      { eventId: EVENT, registrationId: REGISTRATION, ticketTypeId: null, count: 1 },
      expect.anything(),
    );
    expect(api.markRegistrationsNotified).toHaveBeenCalledWith([REGISTRATION], expect.anything());
    // Zadna z trzech operacji nie ma prawa dostac identyfikatora WYDARZENIA
    // w miejscu zgloszenia - to jest wlasnie ta zamiana, ktora przechodzi
    // typowanie i konczy sie decyzja na cudzym wierszu.
    expect(api.markRegistrationsNotified).not.toHaveBeenCalledWith([EVENT], expect.anything());
  });

  it("awans WSKAZANEGO wiersza jedzie z jego identyfikatorem, a nie z kolejka", async () => {
    // "Promuj te osobe" i "promuj pierwsze N z kolejki" to dwie rozne operacje
    // rozroznione WYLACZNIE przez `registrationId`. Zgubiony identyfikator
    // zamienia decyzje organizatora w awans przypadkowej osoby.
    const { result } = renderHook(() => usePromoteFromWaitlist(EVENT), { wrapper });
    await result.current.mutateAsync({
      eventId: EVENT,
      registrationId: REGISTRATION,
      ticketTypeId: null,
      count: 1,
    });

    expect(api.promoteFromWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: REGISTRATION }),
      expect.anything(),
    );
  });
});

describe("zasieg uniewaznienia po mutacji", () => {
  it("kazdy z osmiu hakow kasuje galaz SWOJEGO wydarzenia", async () => {
    // Naglowek modulu obiecuje, ze jedna akcja rusza liste, liczniki i pule
    // biletu naraz. Obietnica jest wspolna, ale `onSuccess` jest dopisany
    // OSOBNO przy kazdym haku - stad przebieg po wszystkich osmiu.
    //
    // PODGLAD NIE ZASTEPUJE IMPLEMENTACJI. Sama lista kluczy dowodzi tylko
    // tego, ze hak o cos poprosil; dopiero cztery zaslane szuflady pokazuja,
    // ze uniewaznienie SIEGA obu list, licznikow i konfiguracji biletow -
    // i ze zatrzymuje sie przed drugim wydarzeniem tego samego organizatora.
    const { result } = renderHook(
      () => ({
        saveTicket: useSaveEventTicket(EVENT),
        deleteTicket: useDeleteEventTicket(EVENT),
        saveField: useSaveRegistrationField(EVENT),
        deleteField: useDeleteRegistrationField(EVENT),
        decide: useDecideRegistration(EVENT),
        saveRegistration: useSaveRegistration(EVENT),
        promote: usePromoteFromWaitlist(EVENT),
        markNotified: useMarkRegistrationsNotified(EVENT),
      }),
      { wrapper },
    );

    const cases: ReadonlyArray<{ name: string; run: () => Promise<unknown> }> = [
      {
        name: "useSaveEventTicket",
        run: () => result.current.saveTicket.mutateAsync(ticketInput()),
      },
      { name: "useDeleteEventTicket", run: () => result.current.deleteTicket.mutateAsync("bil-1") },
      {
        name: "useSaveRegistrationField",
        run: () => result.current.saveField.mutateAsync(fieldInput()),
      },
      {
        name: "useDeleteRegistrationField",
        run: () => result.current.deleteField.mutateAsync("pole-1"),
      },
      {
        name: "useDecideRegistration",
        run: () =>
          result.current.decide.mutateAsync({
            registrationId: REGISTRATION,
            action: "approve",
            note: null,
          }),
      },
      {
        name: "useSaveRegistration",
        run: () => result.current.saveRegistration.mutateAsync(registrationInput()),
      },
      {
        name: "usePromoteFromWaitlist",
        run: () =>
          result.current.promote.mutateAsync({
            eventId: EVENT,
            registrationId: null,
            ticketTypeId: null,
            count: 1,
          }),
      },
      {
        name: "useMarkRegistrationsNotified",
        run: () => result.current.markNotified.mutateAsync([REGISTRATION]),
      },
    ];

    // Cztery ekrany wydarzenia plus bilety wydarzenia OBOK - `setQueryData`
    // zeruje znacznik uniewaznienia, wiec kazdy obieg zaczyna od swiezych
    // szuflad.
    const inFamily = [
      registrationKeys.tickets(EVENT),
      registrationKeys.fields(EVENT),
      registrationKeys.list(listQuery()),
      registrationKeys.counts(countsQuery()),
    ];

    for (const testCase of cases) {
      for (const key of inFamily) client.setQueryData(key, []);
      client.setQueryData(registrationKeys.tickets(OTHER_EVENT), []);

      const invalidate = vi.spyOn(client, "invalidateQueries");
      await testCase.run();

      const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
      expect(keys, testCase.name).toEqual([registrationKeys.event(EVENT)]);
      for (const key of inFamily) {
        expect(
          client.getQueryState(key)?.isInvalidated,
          `${testCase.name} / ${key.join("/")}`,
        ).toBe(true);
      }
      expect(
        client.getQueryState(registrationKeys.tickets(OTHER_EVENT))?.isInvalidated,
        testCase.name,
      ).toBe(false);
      invalidate.mockRestore();
    }
  });

  it("uniewaznienie idzie do galezi WSKAZANEGO wydarzenia, nie do calego modulu", async () => {
    // Sam dowod "cos sie uniewaznilo" przeszedlby takze dla
    // `invalidateQueries()` bez klucza, czyli dla skasowania calej pamieci
    // aplikacji - a to jest inna, kosztowna operacja.
    client.setQueryData(registrationKeys.tickets(OTHER_EVENT), []);
    client.setQueryData(registrationKeys.tickets(EVENT), []);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDecideRegistration(OTHER_EVENT), { wrapper });
    await result.current.mutateAsync({
      registrationId: REGISTRATION,
      action: "approve",
      note: null,
    });

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual([registrationKeys.event(OTHER_EVENT)]);
    expect(keys).not.toContainEqual(registrationKeys.all);
    expect(keys).not.toContainEqual(registrationKeys.event(EVENT));
    // I to samo od strony pamieci: waznosc traci wylacznie galaz wydarzenia,
    // na ktorym zapadla decyzja.
    expect(client.getQueryState(registrationKeys.tickets(OTHER_EVENT))?.isInvalidated).toBe(true);
    expect(client.getQueryState(registrationKeys.tickets(EVENT))?.isInvalidated).toBe(false);
  });

  it("po decyzji lista I liczniki pobieraja sie ponownie, bez odswiezenia strony", async () => {
    // Dowod na to, ze galaz naprawde siega obu ekranow naraz: sama asercja na
    // ksztalt klucza przeszlaby takze dla klucza, ktorego nikt nie czyta.
    api.fetchRegistrations.mockResolvedValue({ rows: [{ id: REGISTRATION }], total: 1 });
    api.fetchRegistrationCounts.mockResolvedValue({ all: 1, pending: 1 });

    const { result } = renderHook(
      () => ({
        list: useRegistrationsList(listQuery({ status: "pending" })),
        counts: useRegistrationCounts(countsQuery()),
        decide: useDecideRegistration(EVENT),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.counts.isSuccess).toBe(true));

    api.fetchRegistrations.mockResolvedValue({ rows: [], total: 0 });
    api.fetchRegistrationCounts.mockResolvedValue({ all: 1, approved: 1 });
    await result.current.decide.mutateAsync({
      registrationId: REGISTRATION,
      action: "approve",
      note: null,
    });

    // Zatwierdzony wiersz znika z zakladki "Oczekujace", a licznik przenosi go
    // do "Zatwierdzonych" - i jedno bez drugiego bylo by ekranem klamiacym.
    await waitFor(() => expect(result.current.list.data?.total).toBe(0));
    await waitFor(() => expect(result.current.counts.data?.byStatus.approved).toBe(1));
    expect(result.current.counts.data?.byStatus.pending).toBe(0);
  });

  it("zapisy INNEGO wydarzenia zostaja nietkniete", async () => {
    // Organizator prowadzacy dwa wydarzenia naraz ma otwarte obie zakladki.
    // Zbyt szerokie uniewaznienie bije w baze zapytaniem, ktore niczego nie
    // zmienia - i miga lista, na ktora nikt nie patrzyl.
    api.fetchRegistrations.mockResolvedValue({ rows: [], total: 0 });

    const { result } = renderHook(
      () => ({
        other: useRegistrationsList(listQuery({ eventId: OTHER_EVENT })),
        decide: useDecideRegistration(EVENT),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.other.isSuccess).toBe(true));
    expect(api.fetchRegistrations).toHaveBeenCalledTimes(1);

    await result.current.decide.mutateAsync({
      registrationId: REGISTRATION,
      action: "approve",
      note: null,
    });

    const state = client.getQueryState(registrationKeys.list(listQuery({ eventId: OTHER_EVENT })));
    expect(state?.isInvalidated).toBe(false);
    expect(api.fetchRegistrations).toHaveBeenCalledTimes(1);
  });

  it("zapis biletu odswieza takze LISTE zgloszen, nie tylko bilety", async () => {
    // Bilet wyznacza pule miejsc, a wiersz zgloszenia niesie nazwe biletu.
    // Uniewaznienie samego klucza biletow zostawialoby w liscie stara nazwe
    // i stary limit.
    const { result } = renderHook(
      () => ({
        tickets: useEventTickets(EVENT),
        list: useRegistrationsList(listQuery()),
        save: useSaveEventTicket(EVENT),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.tickets.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    await result.current.save.mutateAsync(ticketInput());

    await waitFor(() => expect(api.fetchEventTickets).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.fetchRegistrations).toHaveBeenCalledTimes(2));
  });

  it("NIEUDANA mutacja niczego nie uniewaznia", async () => {
    // Kasowanie pamieci po bledzie kazaloby ekranowi pobrac dokladnie te same
    // dane i wygladaloby jak "cos sie stalo" - a decyzja nie przeszla.
    api.decideRegistration.mockRejectedValue(new Error("reason_required"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useDecideRegistration(EVENT), { wrapper });
    await expect(
      result.current.mutateAsync({ registrationId: REGISTRATION, action: "reject", note: null }),
    ).rejects.toThrow("reason_required");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("NIEUDANY awans z rezerwy zostawia liste w stanie sprzed proby", async () => {
    // Awans potrafi upasc na braku wolnych miejsc. Wtedy nikt nie zmienil
    // statusu, wiec lista rezerwy jest nadal prawdziwa.
    api.promoteFromWaitlist.mockRejectedValue(new Error("sold_out"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => usePromoteFromWaitlist(EVENT), { wrapper });
    await expect(
      result.current.mutateAsync({
        eventId: EVENT,
        registrationId: null,
        ticketTypeId: null,
        count: 5,
      }),
    ).rejects.toThrow("sold_out");

    expect(invalidate).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
