// Hooki modulu SPONSORZY: fabryka kluczy pamieci podrecznej, brama `enabled`
// i zasieg uniewaznienia po kazdej z dwunastu mutacji.
//
// PO CO TEN PLIK ISTNIEJE. Panel sponsorow to CZTERY ekrany czytajace TE SAME
// dane pod czterema roznymi kluczami: lista przypiec, lista poziomow,
// wyszukiwarka firm z CRM i szczegol jednego przypiecia. Zapis jednego sponsora
// zmienia je wszystkie naraz - licznik `sponsors_count` w poziomie, znacznik
// `is_pinned` w wyszukiwarce, wiersz na liscie i material w szczegole. Trzy
// klasy bledow, ktorych nie zlapie zaden test renderujacy panel:
//
//   1. KLUCZ, KTORY SIE ZLEWA, POKAZUJE SPONSOROW CUDZEGO WYDARZENIA. Klucz
//      jest sklejany z identyfikatora wydarzenia. Zgubiony segment znaczy, ze
//      ekran kongresu rysuje logotypy warsztatu - czyli firmy, ktore za TO
//      wydarzenie nie zaplacily, staja na jego stronie publicznej.
//   2. BRAMA `enabled`, KTORA NIE DZIALA, PYTA BAZE, ZANIM WIADOMO O CO.
//      `eventId === ""` i `sponsorId === ""` to stany „jeszcze nie wybrano" -
//      zapytanie wyslane w tym stanie konczy sie odmowa, ktora panel pokazuje
//      jako czerwone zdanie na ekranie, na ktorym nikt nic jeszcze nie zrobil.
//   3. UNIEWAZNIENIE, KTORE NIE SIEGA WSZYSTKICH CZTERECH EKRANOW, ZOSTAWIA
//      PANEL KLAMIACY. Cala obietnica zyje w JEDNEJ prywatnej funkcji
//      `useSponsorMutation` - skasowanie jednej z dwoch linii nie psuje niczego
//      widocznego od razu, a po tygodniu organizator liczy wolne miejsca
//      z licznika sprzed trzech zapisow.
//
// PARA „RUSZA SWOJE / NIE RUSZA CUDZEGO". Kazde uniewaznienie sprawdzamy
// z DRUGIEJ strony: galaz TEGO wydarzenia ma zwietrzec, galaz innego wydarzenia
// ma zostac. Sam dowod „cos sie uniewaznilo" przechodzilby takze dla
// `invalidateQueries()` bez klucza, czyli dla skasowania calej pamieci.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Ladunkow RPC - to `sponsorsApi.test.ts`;
// tutaj `sponsorsApi` jest w calosci atrapa i liczy sie WYLACZNIE styk hakow
// z pamiecia podreczna. (2) Slownika odmow bazy (`adminSponsorErrors.test.ts`).
// (3) Formularzy i paneli - maja wlasne pliki.
//
// RODO: same UUID-y i nazwy wymyslonych firm, zadnych osob.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import type { QueryClient, UseMutationResult } from "@tanstack/react-query";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const api = vi.hoisted(() => ({
  fetchSponsors: vi.fn(),
  fetchSponsorTiers: vi.fn(),
  fetchSponsorDetail: vi.fn(),
  searchSponsorCompanies: vi.fn(),
  saveSponsorTier: vi.fn(),
  deleteSponsorTier: vi.fn(),
  reorderSponsorTiers: vi.fn(),
  saveSponsor: vi.fn(),
  deleteSponsor: vi.fn(),
  reorderSponsors: vi.fn(),
  setSponsorsPublished: vi.fn(),
  refreshSponsorSnapshots: vi.fn(),
  setSponsorContacts: vi.fn(),
  saveSponsorMaterial: vi.fn(),
  deleteSponsorMaterial: vi.fn(),
  reorderSponsorMaterials: vi.fn(),
}));

// Warstwa sieci jest tu JEDYNA atrapa - reszta to prawdziwy react-query.
vi.mock("@/lib/events/sponsorsApi", () => api);

import {
  sponsorKeys,
  useDeleteSponsor,
  useDeleteSponsorMaterial,
  useDeleteSponsorTier,
  useRefreshSponsorSnapshots,
  useReorderSponsorMaterials,
  useReorderSponsorTiers,
  useReorderSponsors,
  useSaveSponsor,
  useSaveSponsorMaterial,
  useSaveSponsorTier,
  useSetSponsorContacts,
  useSetSponsorsPublished,
  useSponsorCompanySearch,
  useSponsorDetail,
  useSponsorTiers,
  useSponsors,
} from "@/lib/events/useEventSponsors";
import type {
  EventSponsorDetailRow,
  EventSponsorRow,
  EventSponsorTierRow,
  SponsorCompanyRow,
  SponsorOrderItem,
  SponsorsQuery,
} from "@/lib/events/sponsorsApi";

const WYDARZENIE = "11111111-1111-4111-8111-111111111111";
const INNE_WYDARZENIE = "99999999-9999-4999-8999-999999999999";
const PRZYPIECIE = "22222222-2222-4222-8222-222222222222";
const OBCE_PRZYPIECIE = "88888888-8888-4888-8888-888888888888";
const POZIOM = "33333333-3333-4333-8333-333333333333";
const MATERIAL = "44444444-4444-4444-8444-444444444444";
const FIRMA = "55555555-5555-4555-8555-555555555555";
const KONTAKT = "66666666-6666-4666-8666-666666666666";

/**
 * Kolumny NULL-owalne, ktore GENERATOR typuje jako `string`.
 *
 * `admin_event_sponsor_detail` oddaje `booth_label`, `tier_*` i `internal_note`
 * jako NULL (przypiecie bez stanowiska, bez poziomu, bez notatki), a
 * wygenerowany typ obiecuje `string`.
 */
const BRAK_NAPISU = null as unknown as string;

/** Wiersz `admin_event_sponsor_detail` - ksztalt bierzemy z generowanego typu. */
function szczegolPrzypiecia(overrides: Partial<EventSponsorDetailRow> = {}): EventSponsorDetailRow {
  return {
    booth_label: "A12",
    company_id: FIRMA,
    contacts: [],
    created_at: "2026-08-01T10:00:00.000Z",
    crm_city: "Warszawa",
    crm_country: "PL",
    crm_domain: "alfa.example.com",
    crm_drift_fields: [],
    crm_logo_url: "https://alfa.example.com/logo.png",
    crm_name: "Alfa sp. z o.o.",
    crm_website: "https://alfa.example.com",
    event_id: WYDARZENIE,
    id: PRZYPIECIE,
    internal_note: BRAK_NAPISU,
    is_published: true,
    materials: [],
    role: "sponsor",
    snapshot_country: "PL",
    snapshot_description_en: "Leading logistics",
    snapshot_description_pl: "Lider logistyki",
    snapshot_logo_url: "https://alfa.example.com/logo.png",
    snapshot_name: "Alfa",
    snapshot_source: "crm",
    snapshot_taken_at: "2026-08-01T10:00:00.000Z",
    snapshot_website: "https://alfa.example.com",
    sort_order: 10,
    tier_id: POZIOM,
    tier_key: "gold",
    tier_name_en: "Gold",
    tier_name_pl: "Zloty",
    tier_rank: 1,
    updated_at: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Listy trzymamy jako PUSTE tablice o typie wiersza z generatora.
 *
 * Hak nie czyta z wiersza ani jednej kolumny - oddaje go dalej takim, jaki
 * przyszedl. Dowodem jest wiec TOZSAMOSC obiektu i klucz, pod ktorym wyladowal,
 * a nie tresc kolumn; te maja wlasne pliki (`sponsorsApi.test.ts`, panele).
 */
const LISTA_SPONSOROW: EventSponsorRow[] = [];
const LISTA_POZIOMOW: EventSponsorTierRow[] = [];
const LISTA_FIRM: SponsorCompanyRow[] = [];

const PORZADEK: SponsorOrderItem[] = [
  { id: POZIOM, sortOrder: 10, rank: 1 },
  { id: MATERIAL, sortOrder: 20 },
];

/** Odmowa, ktora baza wystawia edytorowi bez roli - komunikat jedzie w wyjatku. */
const ODMOWA = new Error("forbidden: event editor role required");

/** Sterowana obietnica - do dowodu na stan „zapis w toku". */
function odroczona<T>(): { promise: Promise<T>; spelnij: (value: T) => void } {
  let spelnij: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    spelnij = resolve;
  });
  return { promise, spelnij };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  api.fetchSponsors.mockResolvedValue(LISTA_SPONSOROW);
  api.fetchSponsorTiers.mockResolvedValue(LISTA_POZIOMOW);
  api.fetchSponsorDetail.mockResolvedValue(null);
  api.searchSponsorCompanies.mockResolvedValue(LISTA_FIRM);
  api.saveSponsorTier.mockResolvedValue(POZIOM);
  api.deleteSponsorTier.mockResolvedValue(true);
  api.reorderSponsorTiers.mockResolvedValue(2);
  api.saveSponsor.mockResolvedValue(PRZYPIECIE);
  api.deleteSponsor.mockResolvedValue(true);
  api.reorderSponsors.mockResolvedValue(3);
  api.setSponsorsPublished.mockResolvedValue(1);
  api.refreshSponsorSnapshots.mockResolvedValue(4);
  api.setSponsorContacts.mockResolvedValue(1);
  api.saveSponsorMaterial.mockResolvedValue(MATERIAL);
  api.deleteSponsorMaterial.mockResolvedValue(true);
  api.reorderSponsorMaterials.mockResolvedValue(2);
});

/* ------------------------------------------------------------------ klucze --- */

describe("fabryka kluczy pamieci podrecznej", () => {
  it("wszystkie cztery odczyty wisza pod jednym korzeniem", () => {
    expect(sponsorKeys.all).toEqual(["event-sponsors"]);
    expect(sponsorKeys.event(WYDARZENIE)).toEqual(["event-sponsors", WYDARZENIE]);
    expect(sponsorKeys.tiers(WYDARZENIE)).toEqual(["event-sponsors", WYDARZENIE, "tiers"]);
    expect(sponsorKeys.companies(WYDARZENIE, "alfa")).toEqual([
      "event-sponsors",
      WYDARZENIE,
      "companies",
      "alfa",
    ]);
    expect(sponsorKeys.detail(PRZYPIECIE)).toEqual(["event-sponsors", "detail", PRZYPIECIE]);
  });

  // KLUCZ LISTY NIESIE CALY FILTR. Dwa filtry to dwie rozne odpowiedzi bazy:
  // „tylko patroni medialni" i „wszyscy". Wspolny klucz pokazywalby po zmianie
  // filtra wiersze poprzedniego zapytania - czyli firmy, ktorych filtr nie
  // przepuszcza.
  it("klucz listy niesie CALY filtr, nie samo wydarzenie", () => {
    const filtr: SponsorsQuery = { eventId: WYDARZENIE, role: "media_partner", limit: 25 };
    expect(sponsorKeys.list(filtr)).toEqual(["event-sponsors", WYDARZENIE, "list", filtr]);
    expect(sponsorKeys.list(filtr)).not.toEqual(
      sponsorKeys.list({ eventId: WYDARZENIE, role: "all", limit: 25 }),
    );
  });

  // CZTERY EKRANY TO CZTERY SZUFLADY. Wszystkie oddaja tablice obiektow z `id`
  // - zlanie kluczy nie wywrocilo by renderu, tylko pokazalo poziomy w miejscu
  // sponsorow.
  it("lista, poziomy i firmy nie dziela jednej szuflady", () => {
    const filtr: SponsorsQuery = { eventId: WYDARZENIE };
    expect(sponsorKeys.list(filtr)).not.toEqual(sponsorKeys.tiers(WYDARZENIE));
    expect(sponsorKeys.tiers(WYDARZENIE)).not.toEqual(sponsorKeys.companies(WYDARZENIE, ""));
  });

  // SPONSORZY JEDNEGO WYDARZENIA NIE MOGA WYCIEC DO DRUGIEGO.
  it("kazde wydarzenie ma wlasna galaz", () => {
    expect(sponsorKeys.event(WYDARZENIE)).not.toEqual(sponsorKeys.event(INNE_WYDARZENIE));
    expect(sponsorKeys.tiers(WYDARZENIE)).not.toEqual(sponsorKeys.tiers(INNE_WYDARZENIE));
    expect(sponsorKeys.companies(WYDARZENIE, "alfa")).not.toEqual(
      sponsorKeys.companies(INNE_WYDARZENIE, "alfa"),
    );
  });

  // SZCZEGOL STOI POZA GALEZIA WYDARZENIA - i to jest przyczyna DRUGIEGO
  // uniewaznienia w `useSponsorMutation`. Bez niego zapis materialu nie
  // odswiezalby okna, w ktorym ten material wlasnie powstal.
  it("szczegol przypiecia NIE lezy w galezi wydarzenia - stad drugie uniewaznienie", () => {
    expect(sponsorKeys.detail(PRZYPIECIE)[1]).toBe("detail");
    expect(sponsorKeys.detail(PRZYPIECIE)).not.toContain(WYDARZENIE);
  });

  it("kazde przypiecie ma wlasny szczegol", () => {
    expect(sponsorKeys.detail(PRZYPIECIE)).not.toEqual(sponsorKeys.detail(OBCE_PRZYPIECIE));
  });
});

/* ------------------------------------------------------------------ odczyt --- */

describe("brama `enabled` - para „pyta / nie pyta”", () => {
  it("lista sponsorow z identyfikatorem wydarzenia IDZIE do bazy", async () => {
    const filtr: SponsorsQuery = { eventId: WYDARZENIE, published: "published" };
    const { result, queryClient } = renderHookWithQueryClient(() => useSponsors(filtr));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchSponsors).toHaveBeenCalledExactlyOnceWith(filtr);
    expect(queryClient.getQueryData(sponsorKeys.list(filtr))).toBe(LISTA_SPONSOROW);
  });

  // PUSTY IDENTYFIKATOR TO STAN „JESZCZE NIE WIADOMO, KTORE WYDARZENIE".
  it("lista BEZ identyfikatora wydarzenia nie rusza do bazy", async () => {
    const filtr: SponsorsQuery = { eventId: "" };
    const { result, queryClient } = renderHookWithQueryClient(() => useSponsors(filtr));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSponsors).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(sponsorKeys.list(filtr))).toBeUndefined();
  });

  it("jawne wylaczenie wstrzymuje liste mimo poprawnego wydarzenia", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsors({ eventId: WYDARZENIE }, false));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSponsors).not.toHaveBeenCalled();
  });

  it("poziomy z identyfikatorem wydarzenia IDA do bazy", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() => useSponsorTiers(WYDARZENIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchSponsorTiers).toHaveBeenCalledExactlyOnceWith(WYDARZENIE);
    expect(queryClient.getQueryData(sponsorKeys.tiers(WYDARZENIE))).toBe(LISTA_POZIOMOW);
  });

  it("poziomy BEZ identyfikatora wydarzenia nie rusza do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorTiers(""));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSponsorTiers).not.toHaveBeenCalled();
  });

  it("jawne wylaczenie wstrzymuje poziomy", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorTiers(WYDARZENIE, false));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSponsorTiers).not.toHaveBeenCalled();
  });

  it("szczegol przypiecia z identyfikatorem IDZIE do bazy", async () => {
    const wiersz = szczegolPrzypiecia();
    api.fetchSponsorDetail.mockResolvedValue(wiersz);
    const { result, queryClient } = renderHookWithQueryClient(() => useSponsorDetail(PRZYPIECIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchSponsorDetail).toHaveBeenCalledExactlyOnceWith(PRZYPIECIE);
    expect(queryClient.getQueryData(sponsorKeys.detail(PRZYPIECIE))).toBe(wiersz);
  });

  // BRAK PRZYPIECIA TO `null`, NIE PUSTA TABLICA. Okno edycji rozroznia „jeszcze
  // nie wiem" (`undefined`) od „nie ma czego edytowac" (`null`) - od tego zalezy,
  // czy klucz `internal_note` wejdzie do ladunku zapisu.
  it("szczegol nieistniejacego przypiecia oddaje `null`, a nie `undefined`", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorDetail(PRZYPIECIE));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  // PUSTY IDENTYFIKATOR PRZYPIECIA TO STAN „OKNO ZAMKNIETE".
  it("szczegol BEZ identyfikatora przypiecia nie rusza do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorDetail(""));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSponsorDetail).not.toHaveBeenCalled();
  });

  it("jawne wylaczenie wstrzymuje szczegol - okno zamkniete nie dobiera notatki", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorDetail(PRZYPIECIE, false));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.fetchSponsorDetail).not.toHaveBeenCalled();
  });

  it("wyszukiwarka firm niesie fraze do warstwy zapytan", async () => {
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSponsorCompanySearch(WYDARZENIE, "alfa"),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.searchSponsorCompanies).toHaveBeenCalledExactlyOnceWith(WYDARZENIE, "alfa");
    expect(queryClient.getQueryData(sponsorKeys.companies(WYDARZENIE, "alfa"))).toBe(LISTA_FIRM);
  });

  // PUSTA FRAZA JEST WARTOSCIA, NIE BRAKIEM. Okno przypiecia otwiera sie
  // z lista firm „na wejscie" - brama patrzy wylacznie na wydarzenie.
  it("PUSTA fraza nadal pyta o firmy - to jest tryb przegladania CRM-u", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorCompanySearch(WYDARZENIE, ""));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.searchSponsorCompanies).toHaveBeenCalledExactlyOnceWith(WYDARZENIE, "");
  });

  it("wyszukiwarka BEZ identyfikatora wydarzenia nie rusza do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useSponsorCompanySearch("", "alfa"));
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.searchSponsorCompanies).not.toHaveBeenCalled();
  });

  it("jawne wylaczenie wstrzymuje wyszukiwarke - edycja nie przeszukuje CRM-u", async () => {
    const { result } = renderHookWithQueryClient(() =>
      useSponsorCompanySearch(WYDARZENIE, "alfa", false),
    );
    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));

    expect(api.searchSponsorCompanies).not.toHaveBeenCalled();
  });
});

describe("odmowa bazy w odczycie", () => {
  it("odmowa listy wychodzi z hakiem jako blad, a nie jako pusta lista", async () => {
    api.fetchSponsors.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useSponsors({ eventId: WYDARZENIE }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe(ODMOWA.message);
  });

  it("odmowa poziomow wychodzi z hakiem jako blad", async () => {
    api.fetchSponsorTiers.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useSponsorTiers(WYDARZENIE));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("odmowa szczegolu wychodzi z hakiem jako blad", async () => {
    api.fetchSponsorDetail.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useSponsorDetail(PRZYPIECIE));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  it("odmowa wyszukiwarki firm wychodzi z hakiem jako blad", async () => {
    api.searchSponsorCompanies.mockRejectedValue(ODMOWA);
    const { result } = renderHookWithQueryClient(() => useSponsorCompanySearch(WYDARZENIE, "alfa"));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
  });

  // ODMOWA DLA DRUGIEGO WYDARZENIA NIE PODSTAWIA WYNIKOW PIERWSZEGO. Bez tego
  // przejscie na wydarzenie, do ktorego wolajacy nie ma dostepu, rysowaloby
  // liste sponsorow poprzedniego - czyli dane, ktorych nie wolno mu ogladac.
  it("odmowa dla drugiego wydarzenia nie podstawia poziomow pierwszego", async () => {
    const moje: EventSponsorTierRow[] = [];
    api.fetchSponsorTiers.mockResolvedValueOnce(moje);
    api.fetchSponsorTiers.mockRejectedValueOnce(ODMOWA);

    const stan = { eventId: WYDARZENIE };
    const { result, rerender, queryClient } = renderHookWithQueryClient(() =>
      useSponsorTiers(stan.eventId),
    );
    await waitFor(() => expect(result.current.data).toBe(moje));

    stan.eventId = INNE_WYDARZENIE;
    rerender();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(queryClient.getQueryData(sponsorKeys.tiers(WYDARZENIE))).toBe(moje);
    expect(queryClient.getQueryData(sponsorKeys.tiers(INNE_WYDARZENIE))).toBeUndefined();
  });
});

/* ----------------------------------------------------------------- mutacje --- */

/**
 * Kazda mutacja modulu w jednej tabeli.
 *
 * Wszystkie dwanascie przechodzi przez TE SAMA prywatna funkcje
 * `useSponsorMutation` - i wlasnie dlatego kazda musi byc tu wymieniona
 * z osobna. Gdyby ktorys hak omijal wspolna sciezke (bo „ten jeden przeciez
 * niczego nie zmienia"), zapis wygladalby na udany, a panel pokazywalby stan
 * sprzed niego.
 */
/**
 * Tyle stanu mutacji, ile ten plik naprawde czyta.
 *
 * Kazdy hak ma WLASNY typ wejscia i wyniku, wiec tabela nie moze trzymac ich
 * pod jednym `UseMutationResult` bez rzutowania. Zamiast rzutowac, zawezamy
 * odczyt do wspolnego podzbioru - kompilator sprawdza zgodnosc przy zwrocie
 * z `wyslij`, a kazdy wpis tabeli zamyka swoje typy w domknieciu.
 */
interface StanMutacji {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  data: unknown;
  error: Error | null;
}

interface UchwytMutacji {
  result: { current: StanMutacji };
  queryClient: QueryClient;
}

interface PrzypadekMutacji {
  /** Atrapa warstwy sieci, ktora hak ma wywolac. */
  atrapa: Mock;
  /** Argumenty, z jakimi hak ma ja wywolac - nie zawsze jest to samo wejscie. */
  argumenty: readonly unknown[];
  /** Odpowiedz warstwy sieci - hak ma ja oddac bez podmiany. */
  wynik: unknown;
  /** Renderuje hak i wysyla mutacje; zamyka w sobie wlasny typ wejscia. */
  wyslij: () => UchwytMutacji;
}

/** Renderuje hak mutacji i od razu ja wysyla - wspolny ksztalt dla tabeli. */
function wyslij<TInput, TResult>(
  hak: (eventId: string) => UseMutationResult<TResult, Error, TInput>,
  input: TInput,
): UchwytMutacji {
  const uchwyt = renderHookWithQueryClient(() => hak(WYDARZENIE));
  uchwyt.result.current.mutate(input);
  return { result: uchwyt.result, queryClient: uchwyt.queryClient };
}

const WEJSCIE_KONTAKTOW = {
  sponsorId: PRZYPIECIE,
  items: [{ leadId: KONTAKT, role: "primary" as const, isPrimary: true }],
};
const WEJSCIE_PUBLIKACJI = { ids: [PRZYPIECIE], isPublished: true };
const WEJSCIE_MIGAWEK = { eventId: WYDARZENIE, includeManual: false };

const MUTACJE: ReadonlyArray<readonly [string, PrzypadekMutacji]> = [
  [
    "zapis poziomu",
    {
      atrapa: api.saveSponsorTier,
      argumenty: [{ id: POZIOM, namePl: "Zloty", nameEn: "Gold" }],
      wynik: POZIOM,
      wyslij: () => wyslij(useSaveSponsorTier, { id: POZIOM, namePl: "Zloty", nameEn: "Gold" }),
    },
  ],
  [
    "usuniecie poziomu",
    {
      atrapa: api.deleteSponsorTier,
      argumenty: [POZIOM],
      wynik: true,
      wyslij: () => wyslij(useDeleteSponsorTier, POZIOM),
    },
  ],
  [
    "porzadkowanie poziomow",
    {
      atrapa: api.reorderSponsorTiers,
      argumenty: [PORZADEK],
      wynik: 2,
      wyslij: () => wyslij(useReorderSponsorTiers, PORZADEK),
    },
  ],
  [
    "zapis przypiecia firmy",
    {
      atrapa: api.saveSponsor,
      argumenty: [{ id: PRZYPIECIE, tierId: POZIOM }],
      wynik: PRZYPIECIE,
      wyslij: () => wyslij(useSaveSponsor, { id: PRZYPIECIE, tierId: POZIOM }),
    },
  ],
  [
    "usuniecie przypiecia",
    {
      atrapa: api.deleteSponsor,
      argumenty: [PRZYPIECIE],
      wynik: true,
      wyslij: () => wyslij(useDeleteSponsor, PRZYPIECIE),
    },
  ],
  [
    "porzadkowanie przypiec",
    {
      atrapa: api.reorderSponsors,
      argumenty: [PORZADEK],
      wynik: 3,
      wyslij: () => wyslij(useReorderSponsors, PORZADEK),
    },
  ],
  [
    "publikacja hurtem",
    {
      atrapa: api.setSponsorsPublished,
      // Hak ROZBIJA jedno wejscie na dwa argumenty warstwy sieci - to jest
      // miejsce, w ktorym latwo zgubic flage i opublikowac zamiast wycofac.
      argumenty: [[PRZYPIECIE], true],
      wynik: 1,
      wyslij: () => wyslij(useSetSponsorsPublished, WEJSCIE_PUBLIKACJI),
    },
  ],
  [
    "odswiezenie migawek",
    {
      atrapa: api.refreshSponsorSnapshots,
      argumenty: [WEJSCIE_MIGAWEK],
      wynik: 4,
      wyslij: () => wyslij(useRefreshSponsorSnapshots, WEJSCIE_MIGAWEK),
    },
  ],
  [
    "zapis kontaktow przypiecia",
    {
      atrapa: api.setSponsorContacts,
      argumenty: [PRZYPIECIE, WEJSCIE_KONTAKTOW.items],
      wynik: 1,
      wyslij: () => wyslij(useSetSponsorContacts, WEJSCIE_KONTAKTOW),
    },
  ],
  [
    "zapis materialu",
    {
      atrapa: api.saveSponsorMaterial,
      argumenty: [{ id: MATERIAL, titlePl: "Prezentacja", titleEn: "Deck", isPublished: false }],
      wynik: MATERIAL,
      wyslij: () =>
        wyslij(useSaveSponsorMaterial, {
          id: MATERIAL,
          titlePl: "Prezentacja",
          titleEn: "Deck",
          isPublished: false,
        }),
    },
  ],
  [
    "usuniecie materialu",
    {
      atrapa: api.deleteSponsorMaterial,
      argumenty: [MATERIAL],
      wynik: true,
      wyslij: () => wyslij(useDeleteSponsorMaterial, MATERIAL),
    },
  ],
  [
    "porzadkowanie materialow",
    {
      atrapa: api.reorderSponsorMaterials,
      argumenty: [PORZADEK],
      wynik: 2,
      wyslij: () => wyslij(useReorderSponsorMaterials, PORZADEK),
    },
  ],
];

describe("mutacje - sukces i to, co dojechalo do warstwy sieci", () => {
  it("tabela obejmuje KAZDA mutacje modulu", () => {
    // Nowy hak zapisu bez wpisu w tabeli przeszedlby ten plik nietkniety.
    expect(MUTACJE).toHaveLength(12);
  });

  it.each(MUTACJE)(
    "%s: wysyla dokladnie to, co dostala, i oddaje odpowiedz bazy",
    async (_nazwa, przypadek) => {
      const { result } = przypadek.wyslij();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(przypadek.atrapa).toHaveBeenCalledOnce();
      // Porownujemy ARGUMENTY ZNACZACE - react-query dokleja jeszcze wlasny
      // kontekst, co ma tu wlasny przypadek nizej.
      const wyslane = przypadek.atrapa.mock.calls[0].slice(0, przypadek.argumenty.length);
      expect(wyslane).toEqual([...przypadek.argumenty]);
      expect(result.current.data).toEqual(przypadek.wynik);
    },
  );

  // PULAPKA NA PRZYSZLOSC, NIE DZISIEJSZY BLAD. Dziesiec z dwunastu mutacji
  // podaje funkcje warstwy sieci PRZEZ REFERENCJE (`mutationFn: run`), wiec
  // react-query wklada w jej DRUGI parametr wlasny kontekst. Dzis wszystkie te
  // funkcje maja jeden parametr i nadmiarowy argument ginie. W dniu, w ktorym
  // ktoras dostanie opcjonalny drugi parametr (`deleteSponsor(id, hard?)`),
  // wypelni go obiekt kontekstu - czyli wartosc PRAWDZIWOSCIOWA, ktorej nikt
  // nie przekazal. Ten przypadek pilnuje, zeby taka zmiana nie przeszla po
  // cichu.
  it("mutacje podane przez referencje dostaja tez kontekst react-query jako drugi argument", async () => {
    const { result } = wyslij(useDeleteSponsor, PRZYPIECIE);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.deleteSponsor.mock.calls[0]).toHaveLength(2);
    expect(api.deleteSponsor.mock.calls[0][0]).toBe(PRZYPIECIE);
  });

  // DWIE MUTACJE ROZBIJAJA WEJSCIE WE WLASNYM DOMKNIECIU - i wtedy do warstwy
  // sieci nie dojezdza NIC PONAD to, co ta lambda zbudowala.
  it("mutacje z wlasnym domknieciem wysylaja DOKLADNIE dwa argumenty, bez kontekstu", async () => {
    const { result } = wyslij(useSetSponsorsPublished, WEJSCIE_PUBLIKACJI);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.setSponsorsPublished).toHaveBeenCalledExactlyOnceWith([PRZYPIECIE], true);
  });
});

describe("mutacje - stan „zapis w toku”", () => {
  // ZAPIS W TOKU JEST JEDYNYM ZRODLEM BLOKADY PRZYCISKU W OKNIE. Hak, ktory nie
  // wystawia `isPending`, pozwala kliknac „Zapisz" drugi raz - a to drugi
  // wiersz w bazie i druga faktura za to samo.
  it.each(MUTACJE)("%s: melduje `isPending`, dopoki baza nie odpowie", async (_n, przypadek) => {
    const bramka = odroczona<unknown>();
    przypadek.atrapa.mockReturnValue(bramka.promise);

    const { result } = przypadek.wyslij();
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.isSuccess).toBe(false);

    bramka.spelnij(przypadek.wynik);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPending).toBe(false);
  });
});

describe("mutacje - odmowa bazy", () => {
  it.each(MUTACJE)("%s: odmowa wychodzi z hakiem, a nie w cisze", async (_n, przypadek) => {
    przypadek.atrapa.mockRejectedValue(ODMOWA);

    const { result } = przypadek.wyslij();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(ODMOWA.message);
    expect(result.current.data).toBeUndefined();
  });

  // NIEUDANY ZAPIS NIE UNIEWAZNIA NICZEGO. Odswiezenie listy po odmowie
  // sugerowaloby, ze cos sie zmienilo - a nie zmienilo.
  it.each(MUTACJE)("%s: odmowa NIE rusza pamieci podrecznej", async (_n, przypadek) => {
    przypadek.atrapa.mockRejectedValue(ODMOWA);

    const { result, queryClient } = przypadek.wyslij();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("mutacje - zasieg uniewaznienia", () => {
  it.each(MUTACJE)(
    "%s: uniewaznia galaz TEGO wydarzenia oraz galaz szczegolow",
    async (_n, przypadek) => {
      const { result, queryClient } = przypadek.wyslij();
      const spy = vi.spyOn(queryClient, "invalidateQueries");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const klucze = spy.mock.calls.map((call) => call[0]?.queryKey);
      expect(klucze).toEqual([sponsorKeys.event(WYDARZENIE), [...sponsorKeys.all, "detail"]]);
    },
  );

  /** Sadzi wartownika w kazdej galezi, ktorej dotyczy asercja pary. */
  function posiej(client: QueryClient): void {
    client.setQueryData(sponsorKeys.list({ eventId: WYDARZENIE }), LISTA_SPONSOROW);
    client.setQueryData(sponsorKeys.tiers(WYDARZENIE), LISTA_POZIOMOW);
    client.setQueryData(sponsorKeys.companies(WYDARZENIE, "alfa"), LISTA_FIRM);
    client.setQueryData(sponsorKeys.detail(PRZYPIECIE), null);
    client.setQueryData(sponsorKeys.list({ eventId: INNE_WYDARZENIE }), LISTA_SPONSOROW);
    client.setQueryData(sponsorKeys.tiers(INNE_WYDARZENIE), LISTA_POZIOMOW);
    client.setQueryData(sponsorKeys.companies(INNE_WYDARZENIE, "alfa"), LISTA_FIRM);
  }

  const zwietrzal = (client: QueryClient, klucz: readonly unknown[]): boolean =>
    client.getQueryState(klucz)?.isInvalidated === true;

  // ZAPIS SPONSORA RUSZA WSZYSTKIE TRZY EKRANY TEGO WYDARZENIA. Lista - bo
  // doszedl wiersz. Poziomy - bo `sponsors_count` i `slots_left` sa liczone
  // z przypiec. Wyszukiwarka firm - bo firma wlasnie stala sie `is_pinned`
  // i nie wolno jej przypiac drugi raz.
  it("zapis sponsora wietrzy liste, poziomy, wyszukiwarke i szczegol TEGO wydarzenia", async () => {
    const { result, queryClient } = wyslij(useSaveSponsor, { id: PRZYPIECIE });
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, sponsorKeys.list({ eventId: WYDARZENIE }))).toBe(true);
    expect(zwietrzal(queryClient, sponsorKeys.tiers(WYDARZENIE))).toBe(true);
    expect(zwietrzal(queryClient, sponsorKeys.companies(WYDARZENIE, "alfa"))).toBe(true);
    expect(zwietrzal(queryClient, sponsorKeys.detail(PRZYPIECIE))).toBe(true);
  });

  it("zapis sponsora NIE rusza listy ani poziomow INNEGO wydarzenia", async () => {
    const { result, queryClient } = wyslij(useSaveSponsor, { id: PRZYPIECIE });
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, sponsorKeys.list({ eventId: INNE_WYDARZENIE }))).toBe(false);
    expect(zwietrzal(queryClient, sponsorKeys.tiers(INNE_WYDARZENIE))).toBe(false);
    expect(zwietrzal(queryClient, sponsorKeys.companies(INNE_WYDARZENIE, "alfa"))).toBe(false);
  });

  // ZAPIS MATERIALU WIDAC WYLACZNIE W SZCZEGOLE - lista materialow czytana jest
  // z kolumny `materials` wiersza `admin_event_sponsor_detail`. Bez drugiego
  // uniewaznienia okno pokazywaloby material sprzed zapisu.
  it("zapis materialu wietrzy szczegol przypiecia, w ktorym ten material stoi", async () => {
    const { result, queryClient } = wyslij(useSaveSponsorMaterial, {
      id: MATERIAL,
      titlePl: "Prezentacja",
      titleEn: "Deck",
    });
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, sponsorKeys.detail(PRZYPIECIE))).toBe(true);
    expect(zwietrzal(queryClient, sponsorKeys.list({ eventId: WYDARZENIE }))).toBe(true);
  });

  // PORZADKOWANIE TO TEZ ZAPIS. Przeciagniecie logotypu zmienia kolejnosc na
  // stronie publicznej - lista bez uniewaznienia wrocilaby do starej kolejnosci
  // przy pierwszym odswiezeniu.
  it("porzadkowanie poziomow wietrzy galaz TEGO wydarzenia i zostawia cudza", async () => {
    const { result, queryClient } = wyslij(useReorderSponsorTiers, PORZADEK);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, sponsorKeys.tiers(WYDARZENIE))).toBe(true);
    expect(zwietrzal(queryClient, sponsorKeys.tiers(INNE_WYDARZENIE))).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT: naglowek `useEventSponsors.ts` obiecuje wprost „UNIEWAZNIAMY GALAZ
  // WYDARZENIA (...) zapytania innych wydarzen zostaja nietkniete". Drugie
  // uniewaznienie tej obietnicy nie dotrzymuje: `[...sponsorKeys.all, "detail"]`
  // jest przedrostkiem KAZDEGO szczegolu w calej aplikacji, bo klucz szczegolu
  // nie niesie identyfikatora wydarzenia. Zapis pojedynczego materialu na
  // kongresie wietrzy wiec szczegoly przypiec warsztatu otwartego w drugiej
  // karcie - a te odpytuja baze ponownie, mimo ze nic sie w nich nie zmienilo.
  // Zeby uniewaznienie dalo sie zawezic, klucz szczegolu musialby lezec
  // w galezi wydarzenia (`event(eventId), "detail", sponsorId`).
  // ---------------------------------------------------------------------------
  it.fails(
    "DEFEKT: zapis w JEDNYM wydarzeniu wietrzy szczegoly przypiec INNEGO wydarzenia",
    async () => {
      const { result, queryClient } = wyslij(useSaveSponsor, { id: PRZYPIECIE });
      queryClient.setQueryData(sponsorKeys.detail(OBCE_PRZYPIECIE), null);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(zwietrzal(queryClient, sponsorKeys.detail(OBCE_PRZYPIECIE))).toBe(false);
    },
  );
});
