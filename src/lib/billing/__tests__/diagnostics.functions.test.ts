// Obudowa server fn DIAGNOSTYKI PŁATNOŚCI (`diagnostics.functions.ts`) -
// 31 linii, 0% pokrycia do 31.08.2026 (0 z 4 funkcji).
//
// PO CO TEN PLIK ISTNIEJE. Implementacja (`diagnostics.server.ts`) ma własne
// testy. Nieprzetestowane było opakowanie, a w nim jedno pole, które decyduje
// o wszystkim: `environment`. Ta wartość idzie prosto do `createStripeClient`,
// czyli do WYBORU KLUCZA API. Przy `getPaymentsDiagnostics` pomyłka daje tylko
// zły ekran, ale `syncCouponsToProvider` PISZE do konta operatora - zakłada
// i aktualizuje kupony rabatowe. Wysłanie kuponów testowych na konto
// produkcyjne to realne rabaty dla realnych klientów.
//
// TRZY RZECZY, KTÓRYCH PILNUJE TEN PLIK:
//   1. ENUM `environment` - wartość spoza listy MUSI być odrzucona, bez
//      normalizacji wielkości liter i bez wartości domyślnej. Tu NIE MA
//      bezpiecznego domyślnego kierunku: brak pola to odmowa.
//   2. KOLEJNOŚĆ BRAMEK - `assertAdmin` przed jakąkolwiek pracą, i to na
//      kliencie oraz użytkowniku Z KONTEKSTU, nie z ładunku żądania.
//   3. STRUKTURA OBUDOWY - obie funkcje deklarują `requireSupabaseAuth`;
//      rola sprawdzana jest osobno, serwerowo.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc deklarację bramki przybijamy STRUKTURALNIE, a odmowę roli tam, gdzie
// da się ją wywołać naprawdę - przez `assertAdmin`.
//
// Atrapy stoją na GRANICACH: cały moduł `diagnostics.server` (dotyka bazy
// i SDK operatora). Schemat zod biegnie PRAWDZIWY.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  buildPaymentsDiagnostics: vi.fn(),
  syncCouponDiscounts: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/billing/diagnostics.server", () => ({
  assertAdmin: h.assertAdmin,
  buildPaymentsDiagnostics: h.buildPaymentsDiagnostics,
  syncCouponDiscounts: h.syncCouponDiscounts,
}));

import {
  getPaymentsDiagnostics,
  syncCouponsToProvider,
} from "@/lib/billing/diagnostics.functions";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const DIAGNOSTYKA = { marker: "diagnostyka" };
const WYNIK_KUPONOW = { marker: "wynik-synchronizacji-kuponow" };
const KLIENT_UZYTKOWNIKA = { marker: "klient-z-kontekstu" };

/** Kształt oddawany przez schemat wejścia obu funkcji. */
interface WejscieSrodowiska {
  environment: "sandbox" | "live";
}

function kontekst() {
  return { supabase: KLIENT_UZYTKOWNIKA, userId: ADMIN_ID };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.assertAdmin.mockResolvedValue(undefined);
  h.buildPaymentsDiagnostics.mockResolvedValue(DIAGNOSTYKA);
  h.syncCouponDiscounts.mockResolvedValue(WYNIK_KUPONOW);
});

describe("obudowa - bramka i metoda", () => {
  it("obie funkcje deklarują bramkę uwierzytelnienia", () => {
    // Dowód STRUKTURALNY: harness nie wykonuje middleware. Gdyby ta deklaracja
    // zniknęła, ekran diagnostyczny (klucze, adresy webhooków, stan integracji)
    // dałoby się odczytać bez sesji - a to mapa całej integracji płatniczej.
    expect(serverFnMiddlewareNames(getPaymentsDiagnostics)).toEqual(["requireSupabaseAuth"]);
    expect(serverFnMiddlewareNames(syncCouponsToProvider)).toEqual(["requireSupabaseAuth"]);
  });

  it("odczyt idzie GET-em, a zapis kuponów POST-em", () => {
    // `syncCouponsToProvider` ZMIENIA kupony u operatora. Metoda POST jest
    // częścią tego kontraktu - zejście na GET zrobiłoby z niej akcję
    // wywoływalną przez samo wejście pod adres.
    expect(asServerFn(getPaymentsDiagnostics).method).toBe("GET");
    expect(asServerFn(syncCouponsToProvider).method).toBe("POST");
  });
});

describe("walidator - środowisko jest OBOWIĄZKOWE", () => {
  it("obie wartości enuma przechodzą", () => {
    expect(
      validateServerFnInput<WejscieSrodowiska>(getPaymentsDiagnostics, { environment: "sandbox" }),
    ).toEqual({ environment: "sandbox" });
    expect(
      validateServerFnInput<WejscieSrodowiska>(syncCouponsToProvider, { environment: "live" }),
    ).toEqual({ environment: "live" });
  });

  it("wartość spoza enuma jest ODRZUCANA - to jedyne rozróżnienie piaskownicy od produkcji", () => {
    // Bez tej bramki wartość poszłaby do wyboru klucza API. Przy synchronizacji
    // kuponów oznaczałoby to zakładanie rabatów nie na tym koncie - czyli
    // realny pieniądz oddany za darmo albo rabat, którego klient nie dostaje.
    for (const zle of ["prod", "production", "test", "staging", "", "sandboxes"]) {
      expect(() => validateServerFnInput(getPaymentsDiagnostics, { environment: zle })).toThrow(
        ZodError,
      );
      expect(() => validateServerFnInput(syncCouponsToProvider, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("wielkość liter i białe znaki NIE są normalizowane", () => {
    // Schemat nie ma `.trim()` ani `.toLowerCase()`. Pinujemy to świadomie:
    // dołożenie normalizacji zamieniłoby twardy enum w bramkę „mniej więcej".
    for (const zle of ["LIVE", "Live", " live", "live ", "SANDBOX"]) {
      expect(() => validateServerFnInput(getPaymentsDiagnostics, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("brak pola, `null` i brak całego ładunku to odmowa - nie ma wartości domyślnej", () => {
    // Tu, inaczej niż przy synchronizacji katalogu, NIE MA bezpiecznego
    // domyślnego kierunku: diagnostyka bez środowiska nie ma sensu, a domyślna
    // wartość ukryłaby pomyłkę panelu zamiast ją pokazać.
    expect(() => validateServerFnInput(getPaymentsDiagnostics, {})).toThrow(ZodError);
    expect(() => validateServerFnInput(getPaymentsDiagnostics, { environment: null })).toThrow(
      ZodError,
    );
    expect(() => validateServerFnInput(getPaymentsDiagnostics, undefined)).toThrow(ZodError);
    expect(() => validateServerFnInput(syncCouponsToProvider, undefined)).toThrow(ZodError);
    expect(() => validateServerFnInput(syncCouponsToProvider, null)).toThrow(ZodError);
  });

  it("typ inny niż tekst jest odrzucany", () => {
    for (const zle of [1, 0, true, ["live"], { name: "live" }]) {
      expect(() => validateServerFnInput(syncCouponsToProvider, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("nadmiarowe pola są odcinane", () => {
    // Gdyby ładunek przechodził w całości, przyszłe opcje synchronizacji
    // kuponów (np. „nadpisz istniejące") dałoby się włączyć z przeglądarki.
    expect(
      validateServerFnInput<WejscieSrodowiska>(syncCouponsToProvider, {
        environment: "sandbox",
        overwrite: true,
        apiKey: "sk_zmyslony",
      }),
    ).toEqual({ environment: "sandbox" });
  });
});

describe("handler diagnostyki - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED zbudowaniem diagnostyki", async () => {
    // Ekran diagnostyczny wypisuje adresy webhooków i stan kluczy. Zalogowany
    // bez roli nie może dostać ani jego fragmentu, ani komunikatu, z którego
    // dałoby się wywnioskować stan integracji.
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      callServerFn(getPaymentsDiagnostics, {
        data: { environment: "live" },
        context: kontekst(),
      }),
    ).rejects.toThrow("forbidden");
    expect(h.buildPaymentsDiagnostics).not.toHaveBeenCalled();
  });

  it("kontrola roli dostaje klienta i użytkownika Z KONTEKSTU, nie z ładunku", async () => {
    // Tożsamość bierze się z tokenu sesji. Gdyby handler czytał `userId`
    // z ładunku, kontrolę roli dałoby się przejść cudzym identyfikatorem.
    await callServerFn(getPaymentsDiagnostics, {
      data: { environment: "live", userId: "podstawiony" },
      context: kontekst(),
    });

    expect(h.assertAdmin).toHaveBeenCalledWith(KLIENT_UZYTKOWNIKA, ADMIN_ID);
  });

  it("środowisko jedzie do implementacji 1:1 i wynik wraca bez przetwarzania", async () => {
    const wynik = await callServerFn(getPaymentsDiagnostics, {
      data: { environment: "sandbox" },
      context: kontekst(),
    });

    expect(h.buildPaymentsDiagnostics).toHaveBeenCalledWith("sandbox");
    // `toBe`, nie `toEqual`: opakowanie nie ma prawa przycinać raportu.
    expect(wynik).toBe(DIAGNOSTYKA);
  });
});

describe("handler synchronizacji kuponów - co robi z argumentami", () => {
  it("rola jest sprawdzana PRZED dotknięciem kuponów u operatora", async () => {
    // To jest zapis do cudzego systemu i do pieniędzy. Sprawdzenie roli po
    // wykonaniu pracy byłoby bezwartościowe - rabat już by istniał.
    h.assertAdmin.mockRejectedValue(new Error("forbidden"));

    await expect(
      callServerFn(syncCouponsToProvider, { data: { environment: "live" }, context: kontekst() }),
    ).rejects.toThrow("forbidden");
    expect(h.syncCouponDiscounts).not.toHaveBeenCalled();
  });

  it("kupony jadą na WSKAZANE konto, a wynik wraca bez przetwarzania", async () => {
    const wynik = await callServerFn(syncCouponsToProvider, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(h.syncCouponDiscounts).toHaveBeenCalledWith("live");
    expect(wynik).toBe(WYNIK_KUPONOW);
  });

  it("piaskownica nie jest podmieniana na produkcję", async () => {
    // Asercja wygląda trywialnie, ale pilnuje jedynej rzeczy, która stoi
    // między testowym rabatem a rabatem dla płacących klientów.
    await callServerFn(syncCouponsToProvider, {
      data: { environment: "sandbox" },
      context: kontekst(),
    });

    expect(h.syncCouponDiscounts).toHaveBeenCalledWith("sandbox");
    expect(h.syncCouponDiscounts).toHaveBeenCalledTimes(1);
  });
});
