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
  useCheckinSearch,
  useCheckins,
  useCheckpoints,
  useIssueScannerDevice,
  useLeadExport,
  useManualCheckin,
  useOnsiteLiveStats,
  useOnsiteStats,
  useScannerDevices,
  useSetScannerDeviceActive,
} = await import("@/lib/events/useEventOnsite");

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT_ID = "99999999-9999-4999-8999-999999999999";
const CHECKPOINT_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";

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
