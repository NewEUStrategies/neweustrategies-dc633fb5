// Hooki modulu ON-SITE: klucze cache, bramki `enabled` i uniewaznianie.
//
// PO CO TEN PLIK ISTNIEJE. Ten modul nie liczy niczego sam - jest wylacznie
// UMOWA O TO, CO SIE ODSWIEZA I KIEDY. Zepsuta umowa nie wywraca ekranu, tylko
// pokazuje nieaktualne liczby, a w dniu wydarzenia nieaktualna zajetosc sali
// znaczy przepelniona sala.
//
// CO PSUJE SIE BEZ TEGO PLIKU:
//   1. odprawa przestaje uniewazniac CALA galaz wydarzenia i po pikniecu
//      odswieza sie tylko ten panel, na ktorym stoi kursor - dziennik mowi
//      co innego niz zajetosc punktu;
//   2. wyszukiwarka osoby przy bramce odpytuje baze na jednym znaku, a baza
//      odmawia krotszym niz dwa - operator dostaje blad zamiast podpowiedzi;
//   3. pulpit przestaje sie odswiezac sam i klamie po pierwszej minucie;
//   4. token urzadzenia wchodzi do `queryKey` i laduje w narzedziach
//      deweloperskich oraz w kazdym zrzucie stanu strony.
//
// WARSTWA DOSTEPU JEST ZASLEPIONA - test nie wychodzi do sieci. Sprawdzamy
// UMOWE hookow z React Query, a nie ksztalt payloadow (te maja wlasny plik:
// `onsiteApi.test.ts`).
//
// RODO: dane sa wymyslone, adresy wylacznie `example.org`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import type { QueryClient, UseMutationResult } from "@tanstack/react-query";

import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";

const onsite = vi.hoisted(() => ({
  deleteBadgeTemplate: vi.fn(),
  deleteCheckpoint: vi.fn(),
  fetchBadgePrints: vi.fn(),
  fetchBadgeTemplates: vi.fn(),
  fetchCheckins: vi.fn(),
  fetchCheckpoints: vi.fn(),
  fetchLeadScans: vi.fn(),
  fetchLeadScansExport: vi.fn(),
  fetchOnsiteLiveStats: vi.fn(),
  fetchOnsiteStats: vi.fn(),
  fetchScannerDevices: vi.fn(),
  issueBadgeBatch: vi.fn(),
  issueScannerDevice: vi.fn(),
  recordBadgePrint: vi.fn(),
  recordManualCheckin: vi.fn(),
  revokeScannerDevice: vi.fn(),
  saveBadgeTemplate: vi.fn(),
  saveCheckpoint: vi.fn(),
  searchCheckinPeople: vi.fn(),
  setScannerDeviceActive: vi.fn(),
}));

vi.mock("@/lib/events/onsiteApi", () => onsite);

const {
  onsiteKeys,
  useBadgePrints,
  useBadgeTemplates,
  useCheckinSearch,
  useCheckins,
  useCheckpoints,
  useDeleteBadgeTemplate,
  useDeleteCheckpoint,
  useIssueBadgeBatch,
  useIssueScannerDevice,
  useLeadExport,
  useLeadScans,
  useManualCheckin,
  useOnsiteLiveStats,
  useOnsiteStats,
  useRecordBadgePrint,
  useRevokeScannerDevice,
  useSaveBadgeTemplate,
  useSaveCheckpoint,
  useScannerDevices,
  useSetScannerDeviceActive,
} = await import("@/lib/events/useEventOnsite");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT_ID = "99999999-9999-4999-8999-999999999999";
const CHECKPOINT_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";
const SPONSOR_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_SPONSOR_ID = "88888888-8888-4888-8888-888888888888";

/** Jawny token urzadzenia - wraca DOKLADNIE RAZ i nie ma prawa wejsc do cache. */
const DEVICE_TOKEN = "SCN-abcdefghijklmnopqrstuvwxyz01";

beforeEach(() => {
  vi.clearAllMocks();
  onsite.fetchCheckpoints.mockResolvedValue([]);
  onsite.fetchCheckins.mockResolvedValue([]);
  onsite.searchCheckinPeople.mockResolvedValue([]);
  onsite.fetchScannerDevices.mockResolvedValue([]);
  onsite.fetchOnsiteStats.mockResolvedValue({ bucketMinutes: 15 });
  onsite.fetchOnsiteLiveStats.mockResolvedValue({ sessions: [], rooms: [] });
  onsite.fetchBadgeTemplates.mockResolvedValue([]);
  onsite.fetchBadgePrints.mockResolvedValue([]);
  onsite.fetchLeadScans.mockResolvedValue([]);
});

/* ----------------------------------------------------------- klucze --- */

describe("useEventOnsite - jedna fabryka kluczy na caly modul", () => {
  it("kazdy klucz modulu wisi na GALEZI WYDARZENIA - dlatego jedno uniewaznienie starcza", () => {
    // Gdyby kazdy ekran mial wlasny literal klucza, po pikniecu odswiezalby sie
    // tylko ten panel, na ktorym stoi kursor.
    const branch = onsiteKeys.event(EVENT_ID);
    const keys = [
      onsiteKeys.checkpoints(EVENT_ID),
      onsiteKeys.search(EVENT_ID, "kowal"),
      onsiteKeys.checkins({ eventId: EVENT_ID }),
      onsiteKeys.stats(EVENT_ID, 15),
      onsiteKeys.devices(EVENT_ID),
      onsiteKeys.templates(EVENT_ID),
      onsiteKeys.prints({ eventId: EVENT_ID }),
      onsiteKeys.leads({ eventId: EVENT_ID }),
      onsiteKeys.liveStats(EVENT_ID, 60),
    ];
    for (const key of keys) {
      expect(key.slice(0, branch.length)).toEqual([...branch]);
    }
  });

  it("dwa wydarzenia NIE mieszaja sie w cache", () => {
    // Organizator prowadzi dwa kongresy w tym samym tygodniu; wspolny klucz
    // pokazalby zajetosc bramki z sasiedniego wydarzenia.
    expect(onsiteKeys.stats(EVENT_ID, 15)).not.toEqual(onsiteKeys.stats(OTHER_EVENT_ID, 15));
    expect(onsiteKeys.stats(EVENT_ID, 15)).not.toEqual(onsiteKeys.stats(EVENT_ID, 30));
    expect(onsiteKeys.liveStats(EVENT_ID, 15)).not.toEqual(onsiteKeys.liveStats(EVENT_ID, 60));
  });
});

/* --------------------------------------------------------- zapytania --- */

describe("useEventOnsite - bramki zapytan", () => {
  it("bez identyfikatora wydarzenia NIE ma zapytania do bazy", async () => {
    const { result } = renderHookWithQueryClient(() => useCheckpoints(""));

    await act(async () => {});

    expect(onsite.fetchCheckpoints).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("wylaczone zapytanie tez nie dotyka bazy, mimo poprawnego wydarzenia", async () => {
    renderHookWithQueryClient(() => useCheckpoints(EVENT_ID, false));
    await act(async () => {});
    expect(onsite.fetchCheckpoints).not.toHaveBeenCalled();
  });

  it("wyszukiwarka osoby przy bramce milczy ponizej DWOCH znakow - baza odmawia krotszym", async () => {
    for (const phrase of ["", " ", " k ", "\t"]) {
      renderHookWithQueryClient(() => useCheckinSearch(EVENT_ID, phrase));
      await act(async () => {});
      expect(onsite.searchCheckinPeople).not.toHaveBeenCalled();
    }
  });

  it("wyszukiwarka wysyla fraze PRZYCIETA i tak samo ja kluczuje", async () => {
    // Bez przyciecia „kowal” i „kowal ” to dwa wpisy w cache i dwa zapytania
    // do bazy o to samo - przy bramce kazda spacja to jedno takie zapytanie.
    const { queryClient } = renderHookWithQueryClient(() => useCheckinSearch(EVENT_ID, "  kowal "));

    await waitFor(() => expect(onsite.searchCheckinPeople).toHaveBeenCalledTimes(1));
    expect(onsite.searchCheckinPeople).toHaveBeenCalledWith({ eventId: EVENT_ID, q: "kowal" });
    const cached = queryClient
      .getQueryCache()
      .find({ queryKey: onsiteKeys.search(EVENT_ID, "kowal") });
    expect(cached).toBeDefined();
  });

  it("filtr dziennika jedzie do warstwy dostepu w calosci", async () => {
    const query = {
      eventId: EVENT_ID,
      checkpointId: CHECKPOINT_ID,
      direction: "in" as const,
      result: "granted",
      limit: 50,
    };
    renderHookWithQueryClient(() => useCheckins(query));

    await waitFor(() => expect(onsite.fetchCheckins).toHaveBeenCalledWith(query));
  });

  it("pulpit odswieza sie SAM co 30 s, a wylaczony nie tyka wcale", async () => {
    // Pulpit organizatora w dniu wydarzenia bez odswiezania klamie po pierwszej
    // minucie. Odstep jest czescia umowy, nie ozdoba.
    const live = renderHookWithQueryClient(() => useOnsiteStats(EVENT_ID));
    await waitFor(() => expect(onsite.fetchOnsiteStats).toHaveBeenCalled());
    const query = live.queryClient
      .getQueryCache()
      .find({ queryKey: onsiteKeys.stats(EVENT_ID, 15) });
    expect(query?.observers[0]?.options.refetchInterval).toBe(30_000);

    const off = renderHookWithQueryClient(() => useOnsiteStats(EVENT_ID, 15, false));
    await act(async () => {});
    const idle = off.queryClient.getQueryCache().find({ queryKey: onsiteKeys.stats(EVENT_ID, 15) });
    expect(idle?.observers[0]?.options.refetchInterval).toBe(false);
  });

  it("wejscia na zywo odswiezaja sie CZESCIEJ niz pulpit - to na nich stoi decyzja o wpuszczaniu do sali", async () => {
    const view = renderHookWithQueryClient(() => useOnsiteLiveStats(EVENT_ID));
    await waitFor(() => expect(onsite.fetchOnsiteLiveStats).toHaveBeenCalledWith(EVENT_ID, 60));
    const query = view.queryClient
      .getQueryCache()
      .find({ queryKey: onsiteKeys.liveStats(EVENT_ID, 60) });
    expect(query?.observers[0]?.options.refetchInterval).toBe(15_000);
  });

  // TRZY POZOSTALE ODCZYTY MODULU. Wzorce identyfikatorow rozni sie w nich
  // ksztaltem wejscia: szablony biora sam identyfikator wydarzenia, a wydruki
  // i leady - CALY filtr. Brama `enabled` musi czytac wlasciwe pole obu
  // ksztaltow, inaczej panel identyfikatorow pyta baze, zanim wiadomo o co.
  //
  // WPISY TABELI ODDAJA `void`, A NIE `UseQueryResult<...>`. Kazdy z trzech
  // hakow ma INNY wiersz wyniku (`badge_layouts`, wydruki, leady), wiec
  // wspolna tabela zawezilaby parametr do PIERWSZEGO wariantu unii i odrzucila
  // dwa pozostale. Ten plik i tak nie czyta wyniku - dowodem jest to, czy
  // warstwa dostepu zostala wywolana - wiec zamiast rzutowac, nie oddajemy go
  // w ogole.
  it.each([
    [
      "szablony identyfikatorow",
      () => {
        useBadgeTemplates(EVENT_ID);
      },
      () => {
        useBadgeTemplates("");
      },
      () => {
        useBadgeTemplates(EVENT_ID, false);
      },
      onsite.fetchBadgeTemplates,
    ],
    [
      "dziennik wydrukow",
      () => {
        useBadgePrints({ eventId: EVENT_ID });
      },
      () => {
        useBadgePrints({ eventId: "" });
      },
      () => {
        useBadgePrints({ eventId: EVENT_ID }, false);
      },
      onsite.fetchBadgePrints,
    ],
    [
      "leady sponsorow",
      () => {
        useLeadScans({ eventId: EVENT_ID });
      },
      () => {
        useLeadScans({ eventId: "" });
      },
      () => {
        useLeadScans({ eventId: EVENT_ID }, false);
      },
      onsite.fetchLeadScans,
    ],
  ] as const)(
    "%s: para „pyta / nie pyta” - wydarzenie jest, wydarzenia nie ma, jawne wylaczenie",
    async (_nazwa, zWydarzeniem, bezWydarzenia, wylaczone, atrapa) => {
      renderHookWithQueryClient(zWydarzeniem);
      await waitFor(() => expect(atrapa).toHaveBeenCalledTimes(1));

      atrapa.mockClear();
      renderHookWithQueryClient(bezWydarzenia);
      await act(async () => {});
      expect(atrapa).not.toHaveBeenCalled();

      renderHookWithQueryClient(wylaczone);
      await act(async () => {});
      expect(atrapa).not.toHaveBeenCalled();
    },
  );

  it("filtr wydrukow i filtr leadow jada do warstwy dostepu W CALOSCI, nie samym wydarzeniem", async () => {
    const wydruki = { eventId: EVENT_ID, personId: PERSON_ID, limit: 20, offset: 40 };
    const leady = { eventId: EVENT_ID, sponsorId: SPONSOR_ID, limit: 100, offset: 0 };
    renderHookWithQueryClient(() => useBadgePrints(wydruki));
    renderHookWithQueryClient(() => useLeadScans(leady));

    await waitFor(() => expect(onsite.fetchBadgePrints).toHaveBeenCalledWith(wydruki));
    expect(onsite.fetchLeadScans).toHaveBeenCalledWith(leady);
  });

  it("dwa FILTRY leadow to dwie szuflady - lead sponsora A nie wpada do listy sponsora B", async () => {
    const { queryClient } = renderHookWithQueryClient(() => ({
      alfa: useLeadScans({ eventId: EVENT_ID, sponsorId: SPONSOR_ID }),
      beta: useLeadScans({ eventId: EVENT_ID, sponsorId: OTHER_SPONSOR_ID }),
    }));

    await waitFor(() => expect(onsite.fetchLeadScans).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
  });

  it("ODMOWA odczytu wychodzi z hakiem jako blad, a nie jako pusta lista", async () => {
    // Pusta lista po nieudanym zapytaniu klamie: panel narysowalby „brak
    // urzadzen” dla wydarzenia, ktore ma ich szesc.
    onsite.fetchScannerDevices.mockRejectedValue(new Error("permission_denied: brak dostepu"));
    const { result } = renderHookWithQueryClient(() => useScannerDevices(EVENT_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("permission_denied: brak dostepu");
    expect(result.current.data).toBeUndefined();
  });
});

/* ----------------------------------------------------------- mutacje --- */

describe("useEventOnsite - mutacje i uniewaznianie", () => {
  it("odprawa uniewaznia CALA galaz wydarzenia, nie sam dziennik", async () => {
    // Odprawa zmienia dziennik ORAZ zajetosc punktu ORAZ statystyki.
    onsite.recordManualCheckin.mockResolvedValue({ outcome: "granted", admit: true });
    const { result, queryClient } = renderHookWithQueryClient(() => useManualCheckin(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        eventId: EVENT_ID,
        checkpointId: CHECKPOINT_ID,
        personId: PERSON_ID,
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: onsiteKeys.event(EVENT_ID) });
  });

  // -------------------------------------------------------------------------
  // REGRESJA NA MIGRACJE 20260828206000 I 20260830090000.
  //
  // Po tamtej naprawie zgloszenie z `payment_status = 'unpaid'` NIE MA kodu QR
  // i nie moze byc `approved`. Przy bramce ta osoba trafia wiec do wyszukiwarki
  // nazwisk, a reczna odprawa konczy sie `denied_registration_status`.
  //
  // Warstwa hookow ma dwie powinnosci i obie sa tu sprawdzone: PRZENIESC odmowe
  // bez zmian (`admit` zostaje `false`) i MIMO ODMOWY uniewaznic galaz - odmowa
  // jest wpisem w dzienniku i podbija licznik odmow na pulpicie. Gdyby hook
  // uniewazniał tylko przy `admit === true`, organizator nie zobaczylby, ilu
  // ludzi odbilo sie od bramki na nieoplaconym bilecie.
  // -------------------------------------------------------------------------
  it("REGRESJA (20260828206000 + 20260830090000): odmowa dla zgloszenia `unpaid` przechodzi BEZ ZMIAN i tak samo odswieza pulpit", async () => {
    onsite.recordManualCheckin.mockResolvedValue({
      outcome: "denied_registration_status",
      admit: false,
      result: "denied_registration_status",
      checkinId: "55555555-5555-4555-8555-555555555555",
      direction: "in",
      occurredAt: "2026-09-01T08:05:00.000Z",
      repeatCount: 0,
      previousCheckinAt: null,
      checkpoint: { id: CHECKPOINT_ID },
      person: { person_id: PERSON_ID, registration_status: "pending" },
    });
    const { result, queryClient } = renderHookWithQueryClient(() => useManualCheckin(EVENT_ID));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        eventId: EVENT_ID,
        checkpointId: CHECKPOINT_ID,
        personId: PERSON_ID,
        source: "name_search",
      });
    });

    // Stan mutacji dociera do komponentu przez kolejke powiadomien React Query,
    // wiec czekamy na niego, zamiast czytac migawke sprzed powiadomienia.
    await waitFor(() => expect(result.current.data?.admit).toBe(false));
    expect(result.current.data?.outcome).toBe("denied_registration_status");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: onsiteKeys.event(EVENT_ID) });
    // Kod QR nie istnieje dla takiego zgloszenia - nie ma go czym przeniesc.
    expect(JSON.stringify(result.current.data)).not.toContain("qr_token");
  });

  it("odmowa bazy NIE uniewaznia galezi - nieudany zapis nie ma czego odswiezac", async () => {
    onsite.setScannerDeviceActive.mockRejectedValue(new Error("device_not_found: brak urzadzenia"));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSetScannerDeviceActive(EVENT_ID),
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current
        .mutateAsync({ deviceId: DEVICE_ID, isActive: false })
        .catch(() => undefined);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("przelacznik urzadzenia sklada DWA argumenty w jedno wywolanie warstwy dostepu", async () => {
    onsite.setScannerDeviceActive.mockResolvedValue(true);
    const { result } = renderHookWithQueryClient(() => useSetScannerDeviceActive(EVENT_ID));

    await act(async () => {
      await result.current.mutateAsync({ deviceId: DEVICE_ID, isActive: false });
    });

    expect(onsite.setScannerDeviceActive).toHaveBeenCalledWith(DEVICE_ID, false);
  });

  it("TOKEN URZADZENIA nie wchodzi do cache zapytan - ani w kluczu, ani w danych", async () => {
    // React Query trzyma dane w pamieci strony i w narzedziach deweloperskich.
    // Poswiadczenie bramki nie ma tam czego szukac - wyswietla je JEDEN raz UI.
    onsite.fetchScannerDevices.mockResolvedValue([
      { id: DEVICE_ID, label: "Recepcja A", token_prefix: "SCN-abcd", state: "active" },
    ]);
    onsite.issueScannerDevice.mockResolvedValue({
      deviceId: DEVICE_ID,
      label: "Recepcja A",
      token: DEVICE_TOKEN,
      tokenPrefix: "SCN-abcd",
      scopes: ["checkin"],
      expiresAt: null,
    });

    const { result, queryClient } = renderHookWithQueryClient(() => ({
      devices: useScannerDevices(EVENT_ID),
      issue: useIssueScannerDevice(EVENT_ID),
    }));
    await waitFor(() => expect(result.current.devices.data).toBeDefined());

    await act(async () => {
      await result.current.issue.mutateAsync({
        eventId: EVENT_ID,
        label: "Recepcja A",
        scopes: ["checkin"],
      });
    });

    // Token wraca WYWOLUJACEMU - to jedyna droga, zeby go pokazac.
    await waitFor(() => expect(result.current.issue.data?.token).toBe(DEVICE_TOKEN));
    const cache = queryClient.getQueryCache().getAll();
    expect(cache.length).toBeGreaterThan(0);
    for (const query of cache) {
      expect(JSON.stringify(query.queryKey)).not.toContain(DEVICE_TOKEN);
      expect(JSON.stringify(query.state.data ?? null)).not.toContain(DEVICE_TOKEN);
    }
  });

  it("eksport leadow jest MUTACJA - nie zaklada zadnego wpisu w cache zapytan", async () => {
    // Jednorazowe pobranie danych kontaktowych nie ma po co lezec w cache
    // zapytan, gdzie zylo by do konca sesji przegladarki.
    onsite.fetchLeadScansExport.mockResolvedValue([
      { first_name: "Anna", last_name: "Testowa", email: "anna@example.org", consent: true },
    ]);
    const { result, queryClient } = renderHookWithQueryClient(() => useLeadExport(EVENT_ID));

    await act(async () => {
      await result.current.mutateAsync({});
    });

    expect(onsite.fetchLeadScansExport).toHaveBeenCalledWith(EVENT_ID, undefined);
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });
});

/* ------------------------------------------- tabela wszystkich mutacji --- */

/**
 * KAZDA mutacja modulu w jednej tabeli.
 *
 * Jedenascie z dwunastu hakow zapisu przechodzi przez TE SAMA prywatna funkcje
 * `useOnsiteMutation` - i wlasnie dlatego kazdy musi byc tu wymieniony
 * z osobna. Gdyby ktorys ominal wspolna sciezke (bo „ten jeden przeciez niczego
 * nie zmienia”), zapis wygladalby na udany, a pulpit przy bramce pokazywalby
 * stan sprzed niego. Dwunasty (`useLeadExport`) NIE uniewaznia niczego z zasady
 * i ma wlasne przypadki wyzej.
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
  /** Atrapa warstwy dostepu, ktora hak ma wywolac. */
  atrapa: Mock;
  /** Argumenty, z jakimi hak ma ja wywolac - nie zawsze jest to samo wejscie. */
  argumenty: readonly unknown[];
  /** Odpowiedz warstwy dostepu - hak ma ja oddac bez podmiany. */
  wynik: unknown;
  /** Renderuje hak i wysyla mutacje; zamyka w sobie wlasny typ wejscia. */
  wyslij: () => UchwytMutacji;
}

/** Renderuje hak mutacji i od razu ja wysyla - wspolny ksztalt dla tabeli. */
function wyslij<TInput, TResult>(
  hak: (eventId: string) => UseMutationResult<TResult, Error, TInput>,
  input: TInput,
): UchwytMutacji {
  const uchwyt = renderHookWithQueryClient(() => hak(EVENT_ID));
  uchwyt.result.current.mutate(input);
  return { result: uchwyt.result, queryClient: uchwyt.queryClient };
}

/** Obietnica sterowana z testu - stan „zapis w toku” bez wyscigu z zegarem. */
function odroczona<T>(): { promise: Promise<T>; spelnij: (value: T) => void } {
  let spelnij: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    spelnij = resolve;
  });
  return { promise, spelnij };
}

const WEJSCIE_PUNKTU = {
  id: CHECKPOINT_ID,
  namePl: "Brama glowna",
  nameEn: "Main gate",
  kind: "event_entry" as const,
};
const WEJSCIE_ODPRAWY = {
  eventId: EVENT_ID,
  checkpointId: CHECKPOINT_ID,
  personId: PERSON_ID,
  clientScanUid: "scan-0001",
};
const WEJSCIE_URZADZENIA = {
  eventId: EVENT_ID,
  label: "Brama - telefon 1",
  scopes: ["checkin" as const],
};
const WEJSCIE_SZABLONU = {
  id: TEMPLATE_ID,
  name: "Identyfikator A6",
  paperFormat: "a6" as const,
  orientation: "portrait" as const,
};
const WEJSCIE_WYDRUKU = { eventId: EVENT_ID, personId: PERSON_ID, copies: 2 };
const WEJSCIE_PARTII = { eventId: EVENT_ID, personIds: [PERSON_ID], templateId: TEMPLATE_ID };

const ODMOWA = new Error("checkpoint_in_use: 12 check-in(s) recorded");

const MUTACJE: ReadonlyArray<readonly [string, PrzypadekMutacji]> = [
  [
    "zapis punktu kontrolnego",
    {
      atrapa: onsite.saveCheckpoint,
      argumenty: [WEJSCIE_PUNKTU],
      wynik: CHECKPOINT_ID,
      wyslij: () => wyslij(useSaveCheckpoint, WEJSCIE_PUNKTU),
    },
  ],
  [
    "usuniecie punktu kontrolnego",
    {
      atrapa: onsite.deleteCheckpoint,
      argumenty: [CHECKPOINT_ID],
      wynik: true,
      wyslij: () => wyslij(useDeleteCheckpoint, CHECKPOINT_ID),
    },
  ],
  [
    "reczna odprawa",
    {
      atrapa: onsite.recordManualCheckin,
      argumenty: [WEJSCIE_ODPRAWY],
      wynik: { outcome: "granted", admit: true },
      wyslij: () => wyslij(useManualCheckin, WEJSCIE_ODPRAWY),
    },
  ],
  [
    "wydanie poswiadczenia urzadzenia",
    {
      atrapa: onsite.issueScannerDevice,
      argumenty: [WEJSCIE_URZADZENIA],
      wynik: {
        deviceId: DEVICE_ID,
        label: "Brama - telefon 1",
        token: DEVICE_TOKEN,
        tokenPrefix: "SCN-abcd",
        scopes: ["checkin"],
        expiresAt: null,
      },
      wyslij: () => wyslij(useIssueScannerDevice, WEJSCIE_URZADZENIA),
    },
  ],
  [
    "uniewaznienie poswiadczenia",
    {
      atrapa: onsite.revokeScannerDevice,
      argumenty: [DEVICE_ID],
      wynik: true,
      wyslij: () => wyslij(useRevokeScannerDevice, DEVICE_ID),
    },
  ],
  [
    "pauza i wznowienie poswiadczenia",
    {
      // Hak ROZBIJA jedno wejscie na dwa argumenty warstwy dostepu - to jest
      // miejsce, w ktorym latwo zgubic flage i WZNOWIC zamiast zapauzowac.
      atrapa: onsite.setScannerDeviceActive,
      argumenty: [DEVICE_ID, false],
      wynik: true,
      wyslij: () => wyslij(useSetScannerDeviceActive, { deviceId: DEVICE_ID, isActive: false }),
    },
  ],
  [
    "zapis szablonu identyfikatora",
    {
      atrapa: onsite.saveBadgeTemplate,
      argumenty: [WEJSCIE_SZABLONU],
      wynik: TEMPLATE_ID,
      wyslij: () => wyslij(useSaveBadgeTemplate, WEJSCIE_SZABLONU),
    },
  ],
  [
    "usuniecie szablonu identyfikatora",
    {
      atrapa: onsite.deleteBadgeTemplate,
      argumenty: [TEMPLATE_ID],
      wynik: true,
      wyslij: () => wyslij(useDeleteBadgeTemplate, TEMPLATE_ID),
    },
  ],
  [
    "zapis wydruku identyfikatora",
    {
      atrapa: onsite.recordBadgePrint,
      argumenty: [WEJSCIE_WYDRUKU],
      wynik: { print_id: "aaaaaaaa-1111-4111-8111-111111111111", copies: 2 },
      wyslij: () => wyslij(useRecordBadgePrint, WEJSCIE_WYDRUKU),
    },
  ],
  [
    "wydanie partii identyfikatorow",
    {
      atrapa: onsite.issueBadgeBatch,
      argumenty: [WEJSCIE_PARTII],
      wynik: { badges: [], template: null },
      wyslij: () => wyslij(useIssueBadgeBatch, WEJSCIE_PARTII),
    },
  ],
];

// `vi.clearAllMocks()` z gornego `beforeEach` czysci WYWOLANIA, ale zostawia
// implementacje - `mockRejectedValue` z przypadku „odmowa bazy” przeciekloby do
// nastepnego pliku tabeli i zamienilo sukces w porazke. Dlatego kazda mutacja
// dostaje tu SWOJ stan wyjsciowy: pelny reset i odpowiedz z wlasnego wiersza.
beforeEach(() => {
  for (const [, przypadek] of MUTACJE) {
    przypadek.atrapa.mockReset();
    przypadek.atrapa.mockResolvedValue(przypadek.wynik);
  }
});

describe("useEventOnsite - tabela mutacji: ladunek do warstwy dostepu", () => {
  it("tabela obejmuje KAZDA mutacje uniewazniajaca galaz modulu", () => {
    // Nowy hak zapisu bez wpisu w tabeli przeszedlby ten plik nietkniety.
    expect(MUTACJE).toHaveLength(10);
  });

  it.each(MUTACJE)(
    "%s: wysyla dokladnie to, co dostala, i oddaje odpowiedz bazy bez podmiany",
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

  // PULAPKA NA PRZYSZLOSC, NIE DZISIEJSZY BLAD. Dziewiec z dziesieciu mutacji
  // podaje funkcje warstwy dostepu PRZEZ REFERENCJE (`mutationFn: run`), wiec
  // react-query wklada w jej DRUGI parametr wlasny kontekst. Dzis wszystkie te
  // funkcje maja jeden parametr i nadmiarowy argument ginie. W dniu, w ktorym
  // ktoras dostanie opcjonalny drugi parametr, wypelni go obiekt kontekstu -
  // czyli wartosc PRAWDZIWOSCIOWA, ktorej nikt nie przekazal.
  it("mutacje podane przez referencje dostaja tez kontekst react-query jako drugi argument", async () => {
    const { result } = wyslij(useDeleteCheckpoint, CHECKPOINT_ID);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(onsite.deleteCheckpoint.mock.calls[0]).toHaveLength(2);
    expect(onsite.deleteCheckpoint.mock.calls[0][0]).toBe(CHECKPOINT_ID);
  });

  // JEDYNA mutacja z wlasnym domknieciem - i wtedy do warstwy dostepu nie
  // dojezdza NIC PONAD to, co ta lambda zbudowala.
  it("przelacznik urzadzenia wysyla DOKLADNIE dwa argumenty, bez kontekstu react-query", async () => {
    const { result } = wyslij(useSetScannerDeviceActive, { deviceId: DEVICE_ID, isActive: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(onsite.setScannerDeviceActive).toHaveBeenCalledExactlyOnceWith(DEVICE_ID, true);
  });
});

describe("useEventOnsite - tabela mutacji: stan „zapis w toku”", () => {
  // ZAPIS W TOKU JEST JEDYNYM ZRODLEM BLOKADY PRZYCISKU. Hak, ktory nie
  // wystawia `isPending`, pozwala kliknac drugi raz - a przy bramce drugie
  // klikniecie „Odpraw” to druga proba odprawy tej samej osoby.
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

describe("useEventOnsite - tabela mutacji: odmowa bazy", () => {
  it.each(MUTACJE)("%s: odmowa wychodzi z hakiem, a nie w cisze", async (_n, przypadek) => {
    przypadek.atrapa.mockRejectedValue(ODMOWA);

    const { result } = przypadek.wyslij();
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(ODMOWA.message);
    expect(result.current.data).toBeUndefined();
  });

  // NIEUDANY ZAPIS NIE UNIEWAZNIA NICZEGO. Odswiezenie pulpitu po odmowie
  // sugerowaloby, ze cos sie zmienilo - a nie zmienilo.
  it.each(MUTACJE)("%s: odmowa NIE rusza pamieci podrecznej", async (_n, przypadek) => {
    przypadek.atrapa.mockRejectedValue(ODMOWA);

    const { result, queryClient } = przypadek.wyslij();
    const szpieg = vi.spyOn(queryClient, "invalidateQueries");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(szpieg).not.toHaveBeenCalled();
  });
});

describe("useEventOnsite - tabela mutacji: DOKLADNY zasieg uniewaznienia", () => {
  it.each(MUTACJE)(
    "%s: uniewaznia DOKLADNIE galaz tego wydarzenia - ani szerzej, ani wezej",
    async (_n, przypadek) => {
      const { result, queryClient } = przypadek.wyslij();
      const szpieg = vi.spyOn(queryClient, "invalidateQueries");
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const klucze = szpieg.mock.calls.map((call) => call[0]?.queryKey);
      expect(klucze).toEqual([onsiteKeys.event(EVENT_ID)]);
    },
  );

  /** Sadzi wartownika w kazdej galezi, ktorej dotyczy asercja pary. */
  function posiej(client: QueryClient): void {
    client.setQueryData(onsiteKeys.checkpoints(EVENT_ID), []);
    client.setQueryData(onsiteKeys.checkins({ eventId: EVENT_ID }), []);
    client.setQueryData(onsiteKeys.stats(EVENT_ID, 15), { bucketMinutes: 15 });
    client.setQueryData(onsiteKeys.devices(EVENT_ID), []);
    client.setQueryData(onsiteKeys.templates(EVENT_ID), []);
    client.setQueryData(onsiteKeys.prints({ eventId: EVENT_ID }), []);
    client.setQueryData(onsiteKeys.leads({ eventId: EVENT_ID }), []);
    client.setQueryData(onsiteKeys.liveStats(EVENT_ID, 60), { sessions: [], rooms: [] });
    client.setQueryData(onsiteKeys.checkpoints(OTHER_EVENT_ID), []);
    client.setQueryData(onsiteKeys.stats(OTHER_EVENT_ID, 15), { bucketMinutes: 15 });
  }

  const zwietrzal = (client: QueryClient, klucz: readonly unknown[]): boolean =>
    client.getQueryState(klucz)?.isInvalidated === true;

  // JEDNO PIKNIECIE RUSZA OSIEM EKRANOW. Dziennik - bo doszedl wiersz.
  // Zajetosc punktu - bo ktos wszedl. Statystyki - bo licznik urosl. Bez
  // tego jednego uniewaznienia operator czyta zajetosc sprzed odprawy.
  it("odprawa wietrzy WSZYSTKIE osiem szuflad TEGO wydarzenia", async () => {
    const { result, queryClient } = wyslij(useManualCheckin, WEJSCIE_ODPRAWY);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    for (const klucz of [
      onsiteKeys.checkpoints(EVENT_ID),
      onsiteKeys.checkins({ eventId: EVENT_ID }),
      onsiteKeys.stats(EVENT_ID, 15),
      onsiteKeys.devices(EVENT_ID),
      onsiteKeys.templates(EVENT_ID),
      onsiteKeys.prints({ eventId: EVENT_ID }),
      onsiteKeys.leads({ eventId: EVENT_ID }),
      onsiteKeys.liveStats(EVENT_ID, 60),
    ]) {
      expect(zwietrzal(queryClient, klucz)).toBe(true);
    }
  });

  it("odprawa NIE rusza szuflad SASIEDNIEGO wydarzenia", async () => {
    // Organizator prowadzi dwa kongresy w tym samym tygodniu; szersze
    // uniewaznienie kazaloby drugiemu pulpitowi odpytac baze bez powodu.
    const { result, queryClient } = wyslij(useManualCheckin, WEJSCIE_ODPRAWY);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, onsiteKeys.checkpoints(OTHER_EVENT_ID))).toBe(false);
    expect(zwietrzal(queryClient, onsiteKeys.stats(OTHER_EVENT_ID, 15))).toBe(false);
  });

  // WYDANIE PARTII IDENTYFIKATOROW ROTUJE KODY QR - stary wydruk przestaje
  // wpuszczac. Dlatego to mutacja i dlatego MUSI zwietrzyc dziennik odpraw:
  // inaczej operator patrzy na liste, w ktorej polowa kodow juz nie dziala.
  it("wydanie partii identyfikatorow wietrzy dziennik odpraw, nie tylko liste wydrukow", async () => {
    const { result, queryClient } = wyslij(useIssueBadgeBatch, WEJSCIE_PARTII);
    posiej(queryClient);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(zwietrzal(queryClient, onsiteKeys.checkins({ eventId: EVENT_ID }))).toBe(true);
    expect(zwietrzal(queryClient, onsiteKeys.prints({ eventId: EVENT_ID }))).toBe(true);
  });
});

/* ------------------------------------------------------------ defekty --- */

// -----------------------------------------------------------------------------
// DEFEKT: eksport leadow z DANYMI KONTAKTOWYMI zostaje w cache mutacji.
//
// Naglowek `useLeadExport` uzasadnia wybor mutacji zdaniem „to jednorazowe
// pobranie danych kontaktowych i nie ma powodu, zeby lezalo w cache". Wpisu
// w cache ZAPYTAN faktycznie nie ma (test wyzej tego dowodzi), ale `useMutation`
// trzyma `data` w cache MUTACJI - domyslnie przez `gcTime` (5 minut) po
// odmontowaniu ekranu. Przez ten czas komplet maili i telefonow uczestnikow
// lezy w pamieci strony i jest widoczny w narzedziach deweloperskich React
// Query dokladnie tak samo, jak lezalby w cache zapytan.
//
// To nie jest awaria - to rozjazd miedzy obietnica modulu a zachowaniem
// biblioteki, i dotyczy danych osobowych, wiec nie jest kosmetyczny.
//
// Naprawa nalezy do produkcji: `gcTime: 0` na tej mutacji albo jawne
// `reset()` po wydaniu pliku wywolujacemu.
// -----------------------------------------------------------------------------
describe("useEventOnsite - znane defekty", () => {
  it.fails(
    "eksport leadow obiecuje, ze dane kontaktowe „nie leza w cache”, a `useMutation` trzyma je w cache MUTACJI przez cale `gcTime`",
    async () => {
      onsite.fetchLeadScansExport.mockResolvedValue([
        { first_name: "Anna", last_name: "Testowa", email: "anna@example.org", consent: true },
      ]);
      const { result, queryClient } = renderHookWithQueryClient(() => useLeadExport(EVENT_ID));

      await act(async () => {
        await result.current.mutateAsync({});
      });

      const held = queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => JSON.stringify(mutation.state.data ?? null))
        .join(" ");
      expect(held).not.toContain("anna@example.org");
    },
  );
});
