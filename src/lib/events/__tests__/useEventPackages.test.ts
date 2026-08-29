// Hooki pakietow grupowych po stronie ORGANIZATORA: klucze pamieci podrecznej,
// przekazywanie argumentow do warstwy RPC i zasieg uniewaznienia po mutacji.
//
// PO CO TEN PLIK ISTNIEJE - trzy klasy bledow, ktorych nie zlapie zaden test
// renderujacy ekran pakietow.
//
// 1) KLUCZ, KTORY SIE ZLEWA Z INNYM, POKAZUJE CUDZE DANE. `orders(eventId,
//    null)` znaczy „wszystkie pakiety tego wydarzenia", a `seats(null)` znaczy
//    „nic nie wybrano". Obie funkcje sklejaja klucz z segmentow, wiec literowka
//    albo zgubiony segment nie wywala kompilacji - po prostu dwa rozne
//    zapytania zaczynaja dzielic jedna szuflade i ekran rysuje miejsca z
//    poprzednio otwartego zamowienia. Klucze sa tu asercja same w sobie.
//
// 2) MUTACJA, KTORA UNIEWAZNIA ZA MALO, ZOSTAWIA LICZNIKI KLAMIACE. Naglowek
//    modulu obiecuje, ze zaproszenie na miejsce rusza JEDNOCZESNIE liste
//    miejsc, licznik w zamowieniu, licznik w pakiecie i liste zgloszen. Ta
//    obietnica zyje w jednej wspolnej funkcji `useEventInvalidation`, wiec
//    kazdy hak mutacji dostaje wlasny przypadek: skasowanie `onSuccess` w
//    jednym z szesciu nie psuje niczego widocznego od razu.
//
// 3) ARGUMENTY GUBIONE PO DRODZE. `useSetPackageOrderStatus` jest jedynym
//    hakiem, ktory ROZPAKOWUJE obiekt na dwa argumenty pozycyjne - zamiana ich
//    miejscami przechodzi typowanie tylko dopoki oba sa napisami, a w bazie
//    konczy sie ustawieniem statusu na identyfikatorze zamowienia.
//
// Zaleznoscia jest tu `packagesApi` (siec) - i tylko ona jest atrapa. Klucze
// rejestracji bierzemy PRAWDZIWE z `useEventRegistrations`, bo test przepisany
// z tej samej stalej nie dowodzilby, ze oba moduly mowia o tym samym kluczu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchEventPackages: vi.fn(),
  fetchPackageOrders: vi.fn(),
  fetchPackageSeats: vi.fn(),
  saveEventPackage: vi.fn(),
  deleteEventPackage: vi.fn(),
  createPackageOrder: vi.fn(),
  setPackageOrderStatus: vi.fn(),
  invitePackageSeat: vi.fn(),
  revokePackageSeat: vi.fn(),
}));

// Klient bazy jest atrapowany wzorcem repozytorium, bo `useEventRegistrations`
// (zrodlo prawdziwych kluczy rejestracji) ciagnie go w imporcie.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/events/packagesApi", () => api);

import {
  packageKeys,
  useCreatePackageOrder,
  useDeleteEventPackage,
  useEventPackages,
  useInvitePackageSeat,
  usePackageOrders,
  usePackageSeats,
  useRevokePackageSeat,
  useSaveEventPackage,
  useSetPackageOrderStatus,
  type OrderStatusChange,
} from "@/lib/events/useEventPackages";
import { registrationKeys } from "@/lib/events/useEventRegistrations";
import type { EventPackageInput, PackageOrderInput } from "@/lib/events/packagesApi";

const EVENT = "evt-1";
const OTHER_EVENT = "evt-2";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

/**
 * Uruchamia funkcje pobierajaca ZAREJESTROWANEGO zapytania wprost z pamieci
 * podrecznej. Potrzebne dla galezi `orderId === null`, ktora w normalnym
 * przebiegu jest nieosiagalna: `enabled: orderId !== null` blokuje wywolanie,
 * a mimo to galaz istnieje w kodzie i musi zwracac pusta liste, a nie undefined.
 */
async function runQueryFn(key: QueryKey): Promise<unknown> {
  const query = client.getQueryCache().find({ queryKey: key });
  if (query === undefined) throw new Error("zapytanie nie trafilo do pamieci podrecznej");
  const queryFn = query.options.queryFn;
  if (typeof queryFn !== "function") throw new Error("zapytanie nie ma funkcji pobierajacej");
  return await queryFn({ queryKey: key, client, signal: new AbortController().signal } as never);
}

function packageInput(overrides: Partial<EventPackageInput> = {}): EventPackageInput {
  return {
    id: null,
    eventId: EVENT,
    key: "gold",
    ticketTypeId: "tt-1",
    namePl: "Zloty",
    nameEn: "Gold",
    descriptionPl: "",
    descriptionEn: "",
    audience: "public",
    seats: 5,
    priceCents: 100000,
    currency: "PLN",
    quota: null,
    salesFrom: null,
    salesTo: null,
    minTierRank: 0,
    requiresVerification: false,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

function orderInput(overrides: Partial<PackageOrderInput> = {}): PackageOrderInput {
  return {
    packageId: "pkg-1",
    buyerEmail: "kupujacy@example.com",
    buyerName: "Kupujacy",
    seatsTotal: null,
    amountCents: null,
    invoiceNote: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchEventPackages.mockResolvedValue([]);
  api.fetchPackageOrders.mockResolvedValue([]);
  api.fetchPackageSeats.mockResolvedValue([]);
});

describe("klucze pamieci podrecznej pakietow", () => {
  it("kazdy klucz wydarzenia zaczyna sie od korzenia `event-packages`", () => {
    // Uniewaznienie po mutacji kasuje `packageKeys.all`, wiec klucz, ktory
    // wypadlby spod tego korzenia, przezylby mutacje z nieaktualnymi danymi.
    expect(packageKeys.all).toEqual(["event-packages"]);
    expect(packageKeys.event(EVENT)).toEqual(["event-packages", EVENT]);
    expect(packageKeys.list(EVENT)).toEqual(["event-packages", EVENT, "list"]);
    expect(packageKeys.list(EVENT).slice(0, 2)).toEqual(packageKeys.event(EVENT));
  });

  it("rozne wydarzenia maja ROZLACZNE klucze list", () => {
    expect(packageKeys.list(EVENT)).not.toEqual(packageKeys.list(OTHER_EVENT));
  });

  it("zamowienia bez wybranego pakietu dostaja segment `all`", () => {
    expect(packageKeys.orders(EVENT, null)).toEqual(["event-packages", EVENT, "orders", "all"]);
  });

  it("zamowienia wybranego pakietu dostaja segment z jego identyfikatorem", () => {
    expect(packageKeys.orders(EVENT, "pkg-7")).toEqual([
      "event-packages",
      EVENT,
      "orders",
      "pkg-7",
    ]);
    expect(packageKeys.orders(EVENT, "pkg-7")).not.toEqual(packageKeys.orders(EVENT, null));
  });

  it("PUSTY identyfikator pakietu NIE jest traktowany jak brak wyboru", () => {
    // `??` reaguje wylacznie na null/undefined, wiec pusty napis zostaje pustym
    // segmentem. Utrwalone swiadomie: gdyby kiedys ekran zaczal podawac "",
    // dostalby wlasna szuflade, a nie liste wszystkich zamowien wydarzenia.
    expect(packageKeys.orders(EVENT, "")).toEqual(["event-packages", EVENT, "orders", ""]);
    expect(packageKeys.orders(EVENT, "")).not.toEqual(packageKeys.orders(EVENT, null));
  });

  it("miejsca bez wybranego zamowienia dostaja segment `idle`", () => {
    expect(packageKeys.seats(null)).toEqual(["event-packages", "seats", "idle"]);
  });

  it("miejsca wybranego zamowienia dostaja segment z jego identyfikatorem", () => {
    expect(packageKeys.seats("ord-1")).toEqual(["event-packages", "seats", "ord-1"]);
    expect(packageKeys.seats("ord-1")).not.toEqual(packageKeys.seats(null));
    expect(packageKeys.seats("ord-1")).not.toEqual(packageKeys.seats("ord-2"));
  });

  it("klucz miejsc wisi pod korzeniem, a NIE pod galezia wydarzenia", () => {
    // Zamowienie nie zna swojego wydarzenia w tym kluczu - dlatego
    // uniewaznienie musi siegac `packageKeys.all`, nie tylko `event(eventId)`.
    // Ten test pilnuje zalozenia, na ktorym stoi caly opis uniewaznien nizej.
    expect(packageKeys.seats("ord-1").slice(0, 1)).toEqual(packageKeys.all);
    expect(packageKeys.seats("ord-1")).not.toContain(EVENT);
  });
});

describe("useEventPackages", () => {
  it("pobiera pakiety WSKAZANEGO wydarzenia i oddaje je pod kluczem listy", async () => {
    const rows = [{ id: "pkg-1" }];
    api.fetchEventPackages.mockResolvedValue(rows);

    const { result } = renderHook(() => useEventPackages(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchEventPackages).toHaveBeenCalledWith(EVENT);
    expect(result.current.data).toBe(rows);
    expect(client.getQueryData(packageKeys.list(EVENT))).toBe(rows);
  });

  it("PUSTA lista z bazy jest poprawnym wynikiem, nie stanem ladowania", async () => {
    api.fetchEventPackages.mockResolvedValue([]);

    const { result } = renderHook(() => useEventPackages(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.isPending).toBe(false);
  });

  it("blad z bazy dociera do ekranu jako blad, a nie jako brak pakietow", async () => {
    api.fetchEventPackages.mockRejectedValue(new Error("brak uprawnien"));

    const { result } = renderHook(() => useEventPackages(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("brak uprawnien");
    expect(result.current.data).toBeUndefined();
  });

  it("lista pakietow zostaje swieza przez 30 sekund", async () => {
    const { result, unmount } = renderHook(() => useEventPackages(EVENT), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    unmount();

    // Ponowne wejscie na ekran w oknie swiezosci NIE moze isc do bazy.
    const second = renderHook(() => useEventPackages(EVENT), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(api.fetchEventPackages).toHaveBeenCalledTimes(1);
  });
});

describe("usePackageOrders", () => {
  it("przekazuje wydarzenie i wybrany pakiet w TEJ kolejnosci", async () => {
    const { result } = renderHook(() => usePackageOrders(EVENT, "pkg-3"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPackageOrders).toHaveBeenCalledWith(EVENT, "pkg-3");
  });

  it("brak wybranego pakietu jedzie do bazy jako `null`, a nie jako pominiety argument", async () => {
    const { result } = renderHook(() => usePackageOrders(EVENT, null), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPackageOrders).toHaveBeenCalledWith(EVENT, null);
  });

  it("zmiana wybranego pakietu pobiera OSOBNY zestaw zamowien", async () => {
    api.fetchPackageOrders.mockImplementation((_event: string, packageId: string | null) =>
      Promise.resolve([{ id: packageId ?? "all" }]),
    );

    const { result, rerender } = renderHook(
      ({ packageId }: { packageId: string | null }) => usePackageOrders(EVENT, packageId),
      { wrapper, initialProps: { packageId: null as string | null } },
    );
    await waitFor(() => expect(result.current.data).toEqual([{ id: "all" }]));

    rerender({ packageId: "pkg-9" });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "pkg-9" }]));

    // Poprzedni wybor zostaje w pamieci podrecznej pod wlasnym kluczem.
    expect(client.getQueryData(packageKeys.orders(EVENT, null))).toEqual([{ id: "all" }]);
    expect(api.fetchPackageOrders).toHaveBeenCalledTimes(2);
  });

  it("blad zamowien nie jest mylony z pusta lista", async () => {
    api.fetchPackageOrders.mockRejectedValue(new Error("timeout"));

    const { result } = renderHook(() => usePackageOrders(EVENT, null), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("timeout");
  });
});

describe("usePackageSeats", () => {
  it("bez wybranego zamowienia NIE pyta bazy o miejsca", async () => {
    const { result } = renderHook(() => usePackageSeats(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(api.fetchPackageSeats).not.toHaveBeenCalled();
  });

  it("funkcja pobierajaca dla braku zamowienia oddaje PUSTA LISTE, nie undefined", async () => {
    renderHook(() => usePackageSeats(null), { wrapper });

    // Galaz obronna: gdyby ktos kiedys zdjal `enabled`, zapytanie ma zwrocic
    // liste, po ktorej ekran moze iterowac, a nie wartosc wywracajaca `.map`.
    await expect(runQueryFn(packageKeys.seats(null))).resolves.toEqual([]);
    expect(api.fetchPackageSeats).not.toHaveBeenCalled();
  });

  it("z wybranym zamowieniem pobiera miejsca WLASNIE tego zamowienia", async () => {
    const seats = [{ id: "seat-1" }];
    api.fetchPackageSeats.mockResolvedValue(seats);

    const { result } = renderHook(() => usePackageSeats("ord-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPackageSeats).toHaveBeenCalledWith("ord-1");
    expect(client.getQueryData(packageKeys.seats("ord-1"))).toBe(seats);
  });

  it("wybranie zamowienia PO wejsciu na pusty ekran uruchamia pobranie", async () => {
    const { result, rerender } = renderHook(
      ({ orderId }: { orderId: string | null }) => usePackageSeats(orderId),
      { wrapper, initialProps: { orderId: null as string | null } },
    );
    expect(api.fetchPackageSeats).not.toHaveBeenCalled();

    rerender({ orderId: "ord-5" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPackageSeats).toHaveBeenCalledExactlyOnceWith("ord-5");
  });

  it("blad pobrania miejsc dociera do ekranu", async () => {
    api.fetchPackageSeats.mockRejectedValue(new Error("zamowienie nie istnieje"));

    const { result } = renderHook(() => usePackageSeats("ord-x"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("zamowienie nie istnieje");
  });
});

// DRUGI ARGUMENT `mutationFn`. TanStack Query 5 wola funkcje mutujaca jako
// (zmienne, kontekst), wiec asercje o argumentach domykamy `expect.anything()`.
// Bez tego czerwienilyby sie na samym wydaniu biblioteki, a nie na bledzie
// w kodzie - a wtedy pierwszym odruchem byloby oslabienie asercji do
// `toHaveBeenCalled()`, czyli utrata calego sensu tych przypadkow.
describe("mutacje pakietow - argumenty i wynik", () => {
  it("useSaveEventPackage oddaje warstwie RPC CALY formularz bez przerabiania", async () => {
    const input = packageInput({ id: "pkg-1", quota: 10 });
    api.saveEventPackage.mockResolvedValue("pkg-1");

    const { result } = renderHook(() => useSaveEventPackage(EVENT), { wrapper });
    const saved = await result.current.mutateAsync(input);

    expect(api.saveEventPackage).toHaveBeenCalledWith(input, expect.anything());
    expect(saved).toBe("pkg-1");
    await waitFor(() => expect(result.current.data).toBe("pkg-1"));
  });

  it("useDeleteEventPackage kasuje pakiet po identyfikatorze", async () => {
    api.deleteEventPackage.mockResolvedValue(true);

    const { result } = renderHook(() => useDeleteEventPackage(EVENT), { wrapper });
    const removed = await result.current.mutateAsync("pkg-2");

    expect(api.deleteEventPackage).toHaveBeenCalledWith("pkg-2", expect.anything());
    expect(removed).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("useCreatePackageOrder przekazuje zamowienie i zwraca jego identyfikator", async () => {
    const input = orderInput({ seatsTotal: 3, amountCents: 0 });
    api.createPackageOrder.mockResolvedValue("ord-77");

    const { result } = renderHook(() => useCreatePackageOrder(EVENT), { wrapper });
    const orderId = await result.current.mutateAsync(input);

    expect(api.createPackageOrder).toHaveBeenCalledWith(input, expect.anything());
    expect(orderId).toBe("ord-77");
    await waitFor(() => expect(result.current.data).toBe("ord-77"));
  });

  it("useSetPackageOrderStatus rozpakowuje obiekt na argumenty (id, status) w TEJ kolejnosci", async () => {
    // Jedyny hak, ktory przeklada ksztalt wejscia na argumenty pozycyjne.
    // Zamiana miejscami przeszlaby typowanie, a w bazie ustawilaby status
    // na identyfikatorze zamowienia.
    api.setPackageOrderStatus.mockResolvedValue(true);
    const change: OrderStatusChange = { id: "ord-1", status: "paid" };

    const { result } = renderHook(() => useSetPackageOrderStatus(EVENT), { wrapper });
    await result.current.mutateAsync(change);

    // Sprawdzamy DOKLADNA liste argumentow, nie sam ich podzbior: gdyby
    // `mutationFn` dostal wprost `setPackageOrderStatus`, wywolanie mialoby
    // ksztalt (obiekt, kontekst) - i asercja "nie wywolano z obiektem" by go
    // przepuscila, bo rozni sie liczba argumentow.
    expect(api.setPackageOrderStatus.mock.calls[0]).toEqual(["ord-1", "paid"]);
    expect(api.setPackageOrderStatus.mock.calls[0]).not.toContainEqual(change);
  });

  it("useSetPackageOrderStatus przepuszcza KAZDY status z dozwolonego zbioru", async () => {
    api.setPackageOrderStatus.mockResolvedValue(true);
    const { result } = renderHook(() => useSetPackageOrderStatus(EVENT), { wrapper });

    for (const status of ["pending", "paid", "cancelled", "refunded"] as const) {
      await result.current.mutateAsync({ id: `ord-${status}`, status });
      expect(api.setPackageOrderStatus).toHaveBeenLastCalledWith(`ord-${status}`, status);
    }
    expect(api.setPackageOrderStatus).toHaveBeenCalledTimes(4);
  });

  it("useInvitePackageSeat oddaje zaproszenie z tokenem jawnym", async () => {
    const invite = { seatId: "seat-1", inviteToken: "tok-abc" };
    api.invitePackageSeat.mockResolvedValue(invite);
    const input = { seatId: "seat-1", inviteEmail: "a@b.pl", inviteName: "Ala", validDays: 7 };

    const { result } = renderHook(() => useInvitePackageSeat(EVENT), { wrapper });
    const issued = await result.current.mutateAsync(input);

    expect(api.invitePackageSeat).toHaveBeenCalledWith(input, expect.anything());
    expect(issued).toEqual(invite);
    // Token jawny wraca RAZ - hak nie moze go po drodze zgubic ani przyciac.
    await waitFor(() => expect(result.current.data).toEqual(invite));
  });

  it("useRevokePackageSeat odwoluje miejsce po identyfikatorze", async () => {
    api.revokePackageSeat.mockResolvedValue(true);

    const { result } = renderHook(() => useRevokePackageSeat(EVENT), { wrapper });
    const revoked = await result.current.mutateAsync("seat-9");

    expect(api.revokePackageSeat).toHaveBeenCalledWith("seat-9", expect.anything());
    expect(revoked).toBe(true);
    await waitFor(() => expect(result.current.data).toBe(true));
  });

  it("funkcja z `packagesApi` podana WPROST dostaje drugi argument od React Query", async () => {
    // Piec z szesciu hakow podaje funkcje warstwy RPC bezposrednio jako
    // `mutationFn`, a React Query v5 wola ja z DWOMA argumentami: zmiennymi i
    // wlasnym kontekstem mutacji. Dzis jest to nieszkodliwe, bo `packagesApi`
    // przyjmuje jeden parametr - ale funkcja, ktora kiedys dostanie drugi
    // parametr opcjonalny, po cichu zacznie odbierac obiekt React Query.
    api.revokePackageSeat.mockResolvedValue(true);

    const { result } = renderHook(() => useRevokePackageSeat(EVENT), { wrapper });
    await result.current.mutateAsync("seat-9");

    const [first, second] = api.revokePackageSeat.mock.calls[0] ?? [];
    expect(first).toBe("seat-9");
    expect(second).toMatchObject({ client, mutationKey: undefined });
  });

  it("odrzucony zapis pakietu konczy sie bledem mutacji, a nie cichym sukcesem", async () => {
    api.saveEventPackage.mockRejectedValue(new Error("klucz zajety"));

    const { result } = renderHook(() => useSaveEventPackage(EVENT), { wrapper });
    await expect(result.current.mutateAsync(packageInput())).rejects.toThrow("klucz zajety");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("klucz zajety");
  });
});

describe("zasieg uniewaznienia po mutacji", () => {
  it("kazda z szesciu mutacji kasuje TRZY galezie: wydarzenie, korzen pakietow i rejestracje", async () => {
    // Naglowek modulu obiecuje, ze jedna akcja rusza liste miejsc, oba liczniki
    // i zakladke „Zgloszenia". Obietnica jest wspolna, ale `onSuccess` jest
    // dopisany OSOBNO przy kazdym haku - stad przebieg po wszystkich szesciu.
    api.saveEventPackage.mockResolvedValue("pkg-1");
    api.deleteEventPackage.mockResolvedValue(true);
    api.createPackageOrder.mockResolvedValue("ord-1");
    api.setPackageOrderStatus.mockResolvedValue(true);
    api.invitePackageSeat.mockResolvedValue({ seatId: "seat-1", inviteToken: "t" });
    api.revokePackageSeat.mockResolvedValue(true);

    const { result } = renderHook(
      () => ({
        save: useSaveEventPackage(EVENT),
        remove: useDeleteEventPackage(EVENT),
        createOrder: useCreatePackageOrder(EVENT),
        setStatus: useSetPackageOrderStatus(EVENT),
        invite: useInvitePackageSeat(EVENT),
        revoke: useRevokePackageSeat(EVENT),
      }),
      { wrapper },
    );

    const cases: ReadonlyArray<{ name: string; run: () => Promise<unknown> }> = [
      { name: "useSaveEventPackage", run: () => result.current.save.mutateAsync(packageInput()) },
      { name: "useDeleteEventPackage", run: () => result.current.remove.mutateAsync("pkg-1") },
      {
        name: "useCreatePackageOrder",
        run: () => result.current.createOrder.mutateAsync(orderInput()),
      },
      {
        name: "useSetPackageOrderStatus",
        run: () => result.current.setStatus.mutateAsync({ id: "ord-1", status: "paid" }),
      },
      {
        name: "useInvitePackageSeat",
        run: () =>
          result.current.invite.mutateAsync({
            seatId: "seat-1",
            inviteEmail: "a@b.pl",
            inviteName: "Ala",
            validDays: 7,
          }),
      },
      { name: "useRevokePackageSeat", run: () => result.current.revoke.mutateAsync("seat-1") },
    ];

    for (const testCase of cases) {
      const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
      await testCase.run();

      const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
      expect(keys, testCase.name).toEqual([
        packageKeys.event(EVENT),
        packageKeys.all,
        registrationKeys.event(EVENT),
      ]);
      invalidate.mockRestore();
    }
  });

  it("uniewaznienie idzie do galezi WSKAZANEGO wydarzenia, nie do dowolnego", async () => {
    api.revokePackageSeat.mockResolvedValue(true);
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useRevokePackageSeat(OTHER_EVENT), { wrapper });
    await result.current.mutateAsync("seat-1");

    const keys = invalidate.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toContainEqual(packageKeys.event(OTHER_EVENT));
    expect(keys).toContainEqual(registrationKeys.event(OTHER_EVENT));
    expect(keys).not.toContainEqual(packageKeys.event(EVENT));
  });

  it("klucz rejestracji pochodzi z modulu rejestracji, a nie z przepisanej stalej", () => {
    // Gdyby `registrationKeys.event` zmienil ksztalt, uniewaznienie przestaloby
    // trafiac w zakladke „Zgloszenia" - i nic by o tym nie krzyknelo.
    expect(registrationKeys.event(EVENT)).toEqual(["event-registrations", EVENT]);
  });

  it("po zaproszeniu na miejsce lista miejsc pobiera sie PONOWNIE bez odswiezenia strony", async () => {
    api.fetchPackageSeats.mockResolvedValue([{ id: "seat-1", state: "free" }]);
    api.invitePackageSeat.mockResolvedValue({ seatId: "seat-1", inviteToken: "t" });

    const { result } = renderHook(
      () => ({ seats: usePackageSeats("ord-1"), invite: useInvitePackageSeat(EVENT) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.seats.isSuccess).toBe(true));
    expect(api.fetchPackageSeats).toHaveBeenCalledTimes(1);

    api.fetchPackageSeats.mockResolvedValue([{ id: "seat-1", state: "invited" }]);
    await result.current.invite.mutateAsync({
      seatId: "seat-1",
      inviteEmail: "a@b.pl",
      inviteName: "Ala",
      validDays: 7,
    });

    // Klucz miejsc wisi pod korzeniem - dociera do niego dopiero `packageKeys.all`.
    await waitFor(() =>
      expect(result.current.seats.data).toEqual([{ id: "seat-1", state: "invited" }]),
    );
    expect(api.fetchPackageSeats).toHaveBeenCalledTimes(2);
  });

  it("uniewaznienie korzenia siega TAKZE list innych wydarzen", async () => {
    // Utrwalony skutek uboczny kasowania `packageKeys.all`: lista pakietow
    // sasiedniego wydarzenia rowniez sie przeladowuje. Swiadomie szeroki zasieg
    // - miejsca i zamowienia nie znaja w kluczu swojego wydarzenia.
    api.saveEventPackage.mockResolvedValue("pkg-1");

    const { result } = renderHook(
      () => ({ other: useEventPackages(OTHER_EVENT), save: useSaveEventPackage(EVENT) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.other.isSuccess).toBe(true));
    expect(api.fetchEventPackages).toHaveBeenCalledTimes(1);

    await result.current.save.mutateAsync(packageInput());

    await waitFor(() => expect(api.fetchEventPackages).toHaveBeenCalledTimes(2));
    expect(api.fetchEventPackages).toHaveBeenLastCalledWith(OTHER_EVENT);
  });

  it("NIEUDANA mutacja niczego nie uniewaznia", async () => {
    // Kasowanie pamieci podrecznej po bledzie kazaloby ekranowi pobrac
    // dokladnie te same dane i wygladaloby jak „cos sie stalo".
    api.deleteEventPackage.mockRejectedValue(new Error("pakiet ma sprzedane miejsca"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteEventPackage(EVENT), { wrapper });
    await expect(result.current.mutateAsync("pkg-1")).rejects.toThrow(
      "pakiet ma sprzedane miejsca",
    );

    expect(invalidate).not.toHaveBeenCalled();
  });
});
