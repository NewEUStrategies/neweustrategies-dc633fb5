// Hooki zakupu pakietu grupowego po stronie KUPUJACEGO: kiedy zapytanie w ogole
// rusza, jak sklada sie klucz wyceny i co sie przeladowuje po zakupie.
//
// PO CO TEN PLIK ISTNIEJE - cztery klasy bledow, ktore na ekranie wygladaja
// jak zwykle dzialanie, a nie jak awaria.
//
// 1) KLUCZ WYCENY JEST TU JEDYNYM MECHANIZMEM POPRAWNOSCI CENY. Naglowek modulu
//    uzasadnia, ze wycena to ZAPYTANIE, nie mutacja - a zapytanie oddaje dane z
//    pamieci podrecznej, gdy klucz sie zgadza. Klucz nie zawiera calego wejscia,
//    tylko trzy zeskladane segmenty. Zgubienie segmentu kodu rabatowego pokazuje
//    kupujacemu cene sprzed wpisania kodu; zapomniany `toUpperCase()` pyta bazy
//    o to samo dwa razy przy „kod" i „KOD". Oba wyniki sa wiarygodne z wygladu.
//
// 2) ZAPYTANIE, KTORE RUSZA ZA WCZESNIE, IDZIE DO BAZY Z PUSTYM WEJSCIEM.
//    `usePackagesOffer` ma warunek zlozony (`enabled && slug !== ""`), a
//    `useAdmissionQuote` rusza dopiero, gdy jest co wyceniac. Kazda kombinacja
//    dostaje wlasny przypadek, bo `&&` odwrocone na `||` przechodzi typowanie.
//
// 3) ODMOWA WYCENY TO DANE, NIE BLAD. `event_admission_quote` odpowiada
//    `{ ok: false, reason }` ze statusem sukcesu. Gdyby hak traktowal to jak
//    porazke, ekran zamiast zdania „limit na osobe wyczerpany" pokazalby
//    ogolny komunikat awarii.
//
// 4) PO ZAKUPIE MUSI SIE PRZELICZYC OFERTA. Zakup zdejmuje zestaw z puli, wiec
//    „zostalo 3" na sasiedniej karcie jest natychmiast nieprawda. Test
//    sprawdza faktyczne PONOWNE POBRANIE oferty, nie samo wywolanie
//    `invalidateQueries`.
//
// Atrapa obejmuje wylacznie `admissionApi` - czyli siec. Same haki sa testowane
// w prawdziwym `QueryClientProvider`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  fetchPackagesOffer: vi.fn(),
  fetchMyPackageOrders: vi.fn(),
  fetchMyPackageSeats: vi.fn(),
  quoteAdmission: vi.fn(),
  purchasePackage: vi.fn(),
  inviteMyPackageSeat: vi.fn(),
}));

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
vi.mock("@/lib/events/admissionApi", () => api);

import {
  admissionKeys,
  useAdmissionQuote,
  useInviteMyPackageSeat,
  useMyPackageOrders,
  useMyPackageSeats,
  usePackagesOffer,
  usePurchasePackage,
} from "@/lib/events/useEventPackagePurchase";
import type {
  AdmissionQuote,
  BuyerSeatInviteInput,
  PackagePurchaseInput,
} from "@/lib/events/admissionApi";

const SLUG = "kongres-2026";

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

/**
 * Uruchamia funkcje pobierajaca zarejestrowanego zapytania wprost z pamieci
 * podrecznej. Sluzy do galezi `orderId === null` w `useMyPackageSeats`, ktora
 * przy wlaczonym `enabled` jest nieosiagalna normalna droga.
 */
async function runQueryFn(key: QueryKey): Promise<unknown> {
  const query = client.getQueryCache().find({ queryKey: key });
  if (query === undefined) throw new Error("zapytanie nie trafilo do pamieci podrecznej");
  const queryFn = query.options.queryFn;
  if (typeof queryFn !== "function") throw new Error("zapytanie nie ma funkcji pobierajacej");
  return await queryFn({ queryKey: key, client, signal: new AbortController().signal } as never);
}

function purchaseInput(overrides: Partial<PackagePurchaseInput> = {}): PackagePurchaseInput {
  return {
    packageId: "pkg-1",
    buyerName: "Kupujacy",
    buyerEmail: "kupujacy@example.com",
    companyId: null,
    invoiceNote: "",
    couponCode: "",
    ...overrides,
  };
}

function seatInviteInput(overrides: Partial<BuyerSeatInviteInput> = {}): BuyerSeatInviteInput {
  return {
    orderId: "ord-1",
    email: "gosc@example.com",
    name: "Gosc",
    expiresInDays: 7,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  api.fetchPackagesOffer.mockResolvedValue([]);
  api.fetchMyPackageOrders.mockResolvedValue([]);
  api.fetchMyPackageSeats.mockResolvedValue([]);
});

describe("klucze pamieci podrecznej zakupu", () => {
  it("wszystkie klucze wyrastaja z jednego korzenia `event-admission`", () => {
    // Uniewaznienie po zakupie kasuje wylacznie korzen, wiec klucz spoza niego
    // przezylby zakup z nieaktualna oferta.
    expect(admissionKeys.all).toEqual(["event-admission"]);
    for (const key of [
      admissionKeys.offer(SLUG),
      admissionKeys.quote({}),
      admissionKeys.myOrders(),
      admissionKeys.mySeats(null),
      admissionKeys.mySeats("ord-1"),
    ]) {
      expect(key.slice(0, 1)).toEqual(admissionKeys.all);
    }
  });

  it("oferta jest kluczowana slugiem wydarzenia", () => {
    expect(admissionKeys.offer(SLUG)).toEqual(["event-admission", "offer", SLUG]);
    expect(admissionKeys.offer("")).toEqual(["event-admission", "offer", ""]);
    expect(admissionKeys.offer(SLUG)).not.toEqual(admissionKeys.offer("inne"));
  });

  it("moje miejsca bez wybranego zamowienia dostaja segment `idle`", () => {
    expect(admissionKeys.mySeats(null)).toEqual(["event-admission", "my-seats", "idle"]);
    expect(admissionKeys.mySeats("ord-1")).toEqual(["event-admission", "my-seats", "ord-1"]);
  });

  it("moje zamowienia maja klucz bez zmiennych czesci", () => {
    expect(admissionKeys.myOrders()).toEqual(["event-admission", "my-orders"]);
  });
});

describe("klucz wyceny", () => {
  it("pakiet ma PIERWSZENSTWO nad typem biletu", () => {
    expect(admissionKeys.quote({ packageId: "pkg-1", ticketTypeId: "tt-1" })).toEqual([
      "event-admission",
      "quote",
      "pkg-1",
      "",
    ]);
  });

  it("sam typ biletu trafia do klucza, gdy pakietu nie ma", () => {
    expect(admissionKeys.quote({ ticketTypeId: "tt-1" })).toEqual([
      "event-admission",
      "quote",
      "tt-1",
      "",
    ]);
  });

  it("brak obu przedmiotow wyceny daje segment `none`", () => {
    expect(admissionKeys.quote({})).toEqual(["event-admission", "quote", "none", ""]);
  });

  it("PUSTY identyfikator pakietu nie przepuszcza typu biletu do klucza", () => {
    // `??` reaguje tylko na null/undefined, wiec "" wygrywa z `ticketTypeId`.
    // Utrwalone jako zachowanie obecne: baza i tak odrzuca oba pola naraz,
    // a wejscie z pustym `packageId` nie powstaje na zadnym ekranie.
    expect(admissionKeys.quote({ packageId: "", ticketTypeId: "tt-1" })).toEqual([
      "event-admission",
      "quote",
      "",
      "",
    ]);
  });

  it("brak kodu rabatowego i kod pusty daja TEN SAM klucz", () => {
    expect(admissionKeys.quote({ packageId: "pkg-1" })).toEqual(
      admissionKeys.quote({ packageId: "pkg-1", couponCode: "" }),
    );
  });

  it("kod rabatowy jest przycinany i podnoszony do wielkich liter", () => {
    expect(admissionKeys.quote({ packageId: "pkg-1", couponCode: "  wczesny-ptak  " })).toEqual([
      "event-admission",
      "quote",
      "pkg-1",
      "WCZESNY-PTAK",
    ]);
  });

  it("kod z samych spacji liczy sie jak brak kodu", () => {
    expect(admissionKeys.quote({ packageId: "pkg-1", couponCode: "   " })).toEqual(
      admissionKeys.quote({ packageId: "pkg-1" }),
    );
  });

  it("ten sam kod pisany roznie NIE mnozy zapytan do bazy", async () => {
    // Sedno normalizacji: kupujacy poprawiajacy wielkosc liter ma dostac cene z
    // pamieci podrecznej, a nie kolejne odpytanie i migotanie kwoty.
    api.quoteAdmission.mockResolvedValue({ ok: true, totalCents: 100 });

    const { result, rerender } = renderHook(
      ({ code }: { code: string }) => useAdmissionQuote({ packageId: "pkg-1", couponCode: code }),
      { wrapper, initialProps: { code: "lato" } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ code: " LATO " });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.quoteAdmission).toHaveBeenCalledTimes(1);
  });

  it("ROZNE kody rabatowe dostaja osobne klucze i osobne odpytania", async () => {
    api.quoteAdmission.mockImplementation((input: { couponCode?: string }) =>
      Promise.resolve({ ok: true, code: input.couponCode }),
    );

    const { result, rerender } = renderHook(
      ({ code }: { code: string }) => useAdmissionQuote({ packageId: "pkg-1", couponCode: code }),
      { wrapper, initialProps: { code: "lato" } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ ok: true, code: "lato" }));

    rerender({ code: "zima" });
    await waitFor(() => expect(result.current.data).toEqual({ ok: true, code: "zima" }));

    expect(api.quoteAdmission).toHaveBeenCalledTimes(2);
  });
});

describe("usePackagesOffer", () => {
  it("z domyslnym wlacznikiem i niepustym slugiem pobiera oferte", async () => {
    const offer = [{ id: "pkg-1" }];
    api.fetchPackagesOffer.mockResolvedValue(offer);

    const { result } = renderHook(() => usePackagesOffer(SLUG), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPackagesOffer).toHaveBeenCalledExactlyOnceWith(SLUG);
    expect(client.getQueryData(admissionKeys.offer(SLUG))).toBe(offer);
  });

  it("PUSTY slug wstrzymuje zapytanie mimo wlaczonego haka", async () => {
    // Slug pusty znaczy „adres jeszcze nie sparsowany" - odpytanie bazy o ""
    // wrocilo by pusta oferta i ekran napisalby „brak pakietow" zamiast czekac.
    const { result } = renderHook(() => usePackagesOffer(""), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchPackagesOffer).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("wylacznik na `false` wstrzymuje zapytanie mimo poprawnego sluga", async () => {
    const { result } = renderHook(() => usePackagesOffer(SLUG, false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchPackagesOffer).not.toHaveBeenCalled();
  });

  it("wylacznik `false` i pusty slug naraz rowniez wstrzymuja zapytanie", async () => {
    const { result } = renderHook(() => usePackagesOffer("", false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchPackagesOffer).not.toHaveBeenCalled();
  });

  it("wlaczenie haka PO montazu uruchamia pobranie", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => usePackagesOffer(SLUG, enabled),
      { wrapper, initialProps: { enabled: false } },
    );
    expect(api.fetchPackagesOffer).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchPackagesOffer).toHaveBeenCalledExactlyOnceWith(SLUG);
  });

  it("blad pobrania oferty dociera do ekranu", async () => {
    api.fetchPackagesOffer.mockRejectedValue(new Error("wydarzenie nieopublikowane"));

    const { result } = renderHook(() => usePackagesOffer(SLUG), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("wydarzenie nieopublikowane");
  });
});

describe("useAdmissionQuote", () => {
  it("bez wejscia NIE pyta bazy o wycene", async () => {
    const { result } = renderHook(() => useAdmissionQuote(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.quoteAdmission).not.toHaveBeenCalled();
  });

  it("bez wejscia zapytanie stoi pod kluczem pustego wejscia", () => {
    renderHook(() => useAdmissionQuote(null), { wrapper });

    expect(client.getQueryCache().find({ queryKey: admissionKeys.quote({}) })).toBeDefined();
  });

  it("wejscie idzie do bazy w CALOSCI, nie w postaci skroconej do klucza", async () => {
    // Klucz gubi `ticketTypeId`, gdy jest `packageId` - ale zapytanie musi
    // dostac oryginalny obiekt, bo to baza decyduje, co odrzucic.
    api.quoteAdmission.mockResolvedValue({ ok: true });
    const input = { packageId: "pkg-1", couponCode: "  lato  " };

    const { result } = renderHook(() => useAdmissionQuote(input), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.quoteAdmission).toHaveBeenCalledWith(input);
  });

  it("ODMOWA wyceny jest danymi, a nie bledem zapytania", async () => {
    const refused: AdmissionQuote = {
      ok: false,
      reason: "per_person_limit",
      detail: { max_per_person: 2, owned: 2 },
    };
    api.quoteAdmission.mockResolvedValue(refused);

    const { result } = renderHook(() => useAdmissionQuote({ packageId: "pkg-1" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.isError).toBe(false);
    expect(result.current.data).toEqual(refused);
  });

  it("blad polaczenia przy wycenie jest bledem zapytania", async () => {
    api.quoteAdmission.mockRejectedValue(new Error("brak polaczenia"));

    const { result } = renderHook(() => useAdmissionQuote({ packageId: "pkg-1" }), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("brak polaczenia");
  });

  it("wybranie przedmiotu wyceny PO wejsciu na ekran uruchamia odpytanie", async () => {
    api.quoteAdmission.mockResolvedValue({ ok: true });

    const { result, rerender } = renderHook(
      ({ input }: { input: { packageId: string } | null }) => useAdmissionQuote(input),
      { wrapper, initialProps: { input: null as { packageId: string } | null } },
    );
    expect(api.quoteAdmission).not.toHaveBeenCalled();

    rerender({ input: { packageId: "pkg-1" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.quoteAdmission).toHaveBeenCalledExactlyOnceWith({ packageId: "pkg-1" });
  });
});

describe("useMyPackageOrders", () => {
  it("domyslnie pobiera zamowienia zalogowanego kupujacego", async () => {
    const orders = [{ id: "ord-1" }];
    api.fetchMyPackageOrders.mockResolvedValue(orders);

    const { result } = renderHook(() => useMyPackageOrders(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchMyPackageOrders).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(admissionKeys.myOrders())).toBe(orders);
  });

  it("wylacznik `false` wstrzymuje zapytanie", async () => {
    // Ekran goscia montuje ten hak przed rozstrzygnieciem sesji; odpytanie bez
    // zalogowania wrocilo by bledem uprawnien.
    const { result } = renderHook(() => useMyPackageOrders(false), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchMyPackageOrders).not.toHaveBeenCalled();
  });

  it("zalogowanie sie w trakcie zycia ekranu uruchamia pobranie", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useMyPackageOrders(enabled),
      { wrapper, initialProps: { enabled: false } },
    );

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchMyPackageOrders).toHaveBeenCalledTimes(1);
  });

  it("blad pobrania zamowien dociera do ekranu", async () => {
    api.fetchMyPackageOrders.mockRejectedValue(new Error("sesja wygasla"));

    const { result } = renderHook(() => useMyPackageOrders(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("sesja wygasla");
  });
});

describe("useMyPackageSeats", () => {
  it("bez wybranego zamowienia NIE pyta bazy o miejsca", async () => {
    const { result } = renderHook(() => useMyPackageSeats(null), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.fetchMyPackageSeats).not.toHaveBeenCalled();
    expect(result.current.data).toBeUndefined();
  });

  it("funkcja pobierajaca dla braku zamowienia oddaje PUSTA LISTE, nie undefined", async () => {
    renderHook(() => useMyPackageSeats(null), { wrapper });

    await expect(runQueryFn(admissionKeys.mySeats(null))).resolves.toEqual([]);
    expect(api.fetchMyPackageSeats).not.toHaveBeenCalled();
  });

  it("z wybranym zamowieniem pobiera miejsca WLASNIE tego zamowienia", async () => {
    const seats = [{ id: "seat-1" }];
    api.fetchMyPackageSeats.mockResolvedValue(seats);

    const { result } = renderHook(() => useMyPackageSeats("ord-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.fetchMyPackageSeats).toHaveBeenCalledExactlyOnceWith("ord-1");
    expect(client.getQueryData(admissionKeys.mySeats("ord-1"))).toBe(seats);
  });

  it("przelaczenie zamowienia pobiera OSOBNY zestaw miejsc", async () => {
    api.fetchMyPackageSeats.mockImplementation((orderId: string) =>
      Promise.resolve([{ id: `seat-${orderId}` }]),
    );

    const { result, rerender } = renderHook(
      ({ orderId }: { orderId: string | null }) => useMyPackageSeats(orderId),
      { wrapper, initialProps: { orderId: "ord-1" as string | null } },
    );
    await waitFor(() => expect(result.current.data).toEqual([{ id: "seat-ord-1" }]));

    rerender({ orderId: "ord-2" });
    await waitFor(() => expect(result.current.data).toEqual([{ id: "seat-ord-2" }]));

    expect(client.getQueryData(admissionKeys.mySeats("ord-1"))).toEqual([{ id: "seat-ord-1" }]);
  });

  it("blad pobrania moich miejsc dociera do ekranu", async () => {
    api.fetchMyPackageSeats.mockRejectedValue(new Error("nie twoje zamowienie"));

    const { result } = renderHook(() => useMyPackageSeats("ord-9"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("nie twoje zamowienie");
  });
});

describe("mutacje kupujacego", () => {
  it("usePurchasePackage oddaje warstwie RPC CALY formularz zakupu", async () => {
    const input = purchaseInput({ companyId: "co-1", couponCode: "LATO", invoiceNote: "PO 12" });
    const outcome = {
      orderId: "ord-1",
      seats: 5,
      currency: "PLN",
      totalCents: 90000,
      discountCents: 10000,
      status: "pending",
    };
    api.purchasePackage.mockResolvedValue(outcome);

    const { result } = renderHook(() => usePurchasePackage(), { wrapper });
    const returned = await result.current.mutateAsync(input);

    // PIERWSZY argument, nie caly zestaw: React Query dokleda mutacji wlasny
    // kontekst jako drugi argument (patrz osobny przypadek nizej).
    expect(api.purchasePackage).toHaveBeenCalledTimes(1);
    expect(api.purchasePackage.mock.calls[0]?.[0]).toBe(input);
    // Wynik wraca i z `mutateAsync`, i - po przerysowaniu - ze stanu haka.
    expect(returned).toEqual(outcome);
    await waitFor(() => expect(result.current.data).toEqual(outcome));
  });

  it("useInviteMyPackageSeat oddaje zaproszenie z tokenem jawnym", async () => {
    const invite = { seatId: "seat-1", inviteToken: "tok-abc", expiresAt: null };
    api.inviteMyPackageSeat.mockResolvedValue(invite);
    const input = seatInviteInput();

    const { result } = renderHook(() => useInviteMyPackageSeat(), { wrapper });
    const returned = await result.current.mutateAsync(input);

    expect(api.inviteMyPackageSeat).toHaveBeenCalledTimes(1);
    expect(api.inviteMyPackageSeat.mock.calls[0]?.[0]).toBe(input);
    expect(returned).toEqual(invite);
    await waitFor(() => expect(result.current.data).toEqual(invite));
  });

  it("funkcja z `admissionApi` podana WPROST dostaje drugi argument od React Query", async () => {
    // Oba haki podaja funkcje warstwy RPC bezposrednio jako `mutationFn`, a
    // React Query v5 wola ja ze zmiennymi ORAZ wlasnym kontekstem mutacji.
    // Dzis nieszkodliwe (obie przyjmuja jeden parametr), ale dopisanie im
    // drugiego parametru opcjonalnego zaczeloby po cichu odbierac ten obiekt.
    api.purchasePackage.mockResolvedValue({ orderId: "ord-1" });

    const { result } = renderHook(() => usePurchasePackage(), { wrapper });
    const input = purchaseInput();
    await result.current.mutateAsync(input);

    const [first, second] = api.purchasePackage.mock.calls[0] ?? [];
    expect(first).toBe(input);
    expect(second).toMatchObject({ client, mutationKey: undefined });
  });

  it("odrzucony zakup konczy sie bledem mutacji, a nie cichym sukcesem", async () => {
    api.purchasePackage.mockRejectedValue(new Error("pula wyczerpana"));

    const { result } = renderHook(() => usePurchasePackage(), { wrapper });
    await expect(result.current.mutateAsync(purchaseInput())).rejects.toThrow("pula wyczerpana");
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe("pula wyczerpana");
  });

  it("odrzucone zaproszenie na miejsce konczy sie bledem mutacji", async () => {
    api.inviteMyPackageSeat.mockRejectedValue(new Error("brak wolnych miejsc"));

    const { result } = renderHook(() => useInviteMyPackageSeat(), { wrapper });
    await expect(result.current.mutateAsync(seatInviteInput())).rejects.toThrow(
      "brak wolnych miejsc",
    );
  });
});

describe("zasieg uniewaznienia po zakupie i zaproszeniu", () => {
  it("obie mutacje kasuja DOKLADNIE korzen `event-admission`", async () => {
    api.purchasePackage.mockResolvedValue({ orderId: "ord-1" });
    api.inviteMyPackageSeat.mockResolvedValue({ seatId: "seat-1" });

    const { result } = renderHook(
      () => ({ purchase: usePurchasePackage(), invite: useInviteMyPackageSeat() }),
      { wrapper },
    );

    const cases: ReadonlyArray<{ name: string; run: () => Promise<unknown> }> = [
      {
        name: "usePurchasePackage",
        run: () => result.current.purchase.mutateAsync(purchaseInput()),
      },
      {
        name: "useInviteMyPackageSeat",
        run: () => result.current.invite.mutateAsync(seatInviteInput()),
      },
    ];

    for (const testCase of cases) {
      const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
      await testCase.run();

      // Jedno wywolanie, jeden klucz: waskie uniewaznienie zostawiloby
      // „zostalo 3" na sasiedniej karcie, szersze nie ma tu czego objac.
      expect(
        invalidate.mock.calls.map((call) => call[0]?.queryKey),
        testCase.name,
      ).toEqual([admissionKeys.all]);
      invalidate.mockRestore();
    }
  });

  it("po zakupie OFERTA pobiera sie ponownie bez odswiezania strony", async () => {
    api.fetchPackagesOffer.mockResolvedValue([{ id: "pkg-1", remaining: 3 }]);
    api.purchasePackage.mockResolvedValue({ orderId: "ord-1" });

    const { result } = renderHook(
      () => ({ offer: usePackagesOffer(SLUG), purchase: usePurchasePackage() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.offer.isSuccess).toBe(true));
    expect(api.fetchPackagesOffer).toHaveBeenCalledTimes(1);

    api.fetchPackagesOffer.mockResolvedValue([{ id: "pkg-1", remaining: 2 }]);
    await result.current.purchase.mutateAsync(purchaseInput());

    await waitFor(() => expect(result.current.offer.data).toEqual([{ id: "pkg-1", remaining: 2 }]));
  });

  it("po zaproszeniu na miejsce lista moich miejsc pobiera sie ponownie", async () => {
    api.fetchMyPackageSeats.mockResolvedValue([{ id: "seat-1", state: "free" }]);
    api.inviteMyPackageSeat.mockResolvedValue({ seatId: "seat-1" });

    const { result } = renderHook(
      () => ({ seats: useMyPackageSeats("ord-1"), invite: useInviteMyPackageSeat() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.seats.isSuccess).toBe(true));

    api.fetchMyPackageSeats.mockResolvedValue([{ id: "seat-1", state: "invited" }]);
    await result.current.invite.mutateAsync(seatInviteInput());

    await waitFor(() =>
      expect(result.current.seats.data).toEqual([{ id: "seat-1", state: "invited" }]),
    );
    expect(api.fetchMyPackageSeats).toHaveBeenCalledTimes(2);
  });

  it("NIEUDANY zakup niczego nie uniewaznia", async () => {
    api.purchasePackage.mockRejectedValue(new Error("pula wyczerpana"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => usePurchasePackage(), { wrapper });
    await expect(result.current.mutateAsync(purchaseInput())).rejects.toThrow("pula wyczerpana");

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("NIEUDANE zaproszenie niczego nie uniewaznia", async () => {
    api.inviteMyPackageSeat.mockRejectedValue(new Error("brak wolnych miejsc"));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);

    const { result } = renderHook(() => useInviteMyPackageSeat(), { wrapper });
    await expect(result.current.mutateAsync(seatInviteInput())).rejects.toThrow(
      "brak wolnych miejsc",
    );

    expect(invalidate).not.toHaveBeenCalled();
  });
});
