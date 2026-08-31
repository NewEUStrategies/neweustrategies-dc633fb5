// Obudowa server fn SYNCHRONIZACJI KATALOGU (`catalogSync.functions.ts`) -
// 32 linie, 0% pokrycia do 31.08.2026 (0 z 4 funkcji, 0 z 6 gałęzi).
//
// PO CO TEN PLIK ISTNIEJE. `syncPaymentCatalogNow` to jedyny przycisk w panelu,
// który PISZE do katalogu operatora płatności: zakłada produkty, zakłada ceny,
// archiwizuje pozycje, których nie ma już w źródle prawdy. Cała decyzja
// „na którym koncie to zrobić" mieści się w jednym polu enuma z tego pliku.
// Wartość spoza listy albo cicha zamiana piaskownicy na produkcję to nie jest
// błąd wyświetlania - to jest zmiana cennika, po której klienci płacą inne
// kwoty.
//
// CZTERY RZECZY, KTÓRYCH PILNUJE TEN PLIK:
//   1. ENUM `environment` - wartość spoza listy MUSI być odrzucona.
//   2. BEZPIECZNY DOMYŚLNY KIERUNEK. Brak środowiska w ładunku znaczy
//      PIASKOWNICA, nigdy produkcja. Gdyby domyślną wartością było „live",
//      zgubione pole w formularzu przepisywałoby prawdziwy cennik.
//   3. TO SAMO ŚRODOWISKO W OBU KROKACH. Handler robi dwie rzeczy: synchronizuje
//      katalog i zapisuje odcisk integracji. Rozjazd środowisk między tymi
//      krokami oznaczałby zapis „katalog aktualny" dla konta, którego nikt nie
//      ruszał - a automat przestałby naprawiać to, co naprawdę jest nieaktualne.
//   4. BRAMKA ROLI. Obie funkcje deklarują `requireAdmin` (admin/super_admin),
//      a nie samo uwierzytelnienie ani szersze `requireStaff`.
//
// CZEGO TEN PLIK NIE DOWODZI: AUTORYZACJI. Harness nie uruchamia middleware,
// więc deklarację bramki przybijamy STRUKTURALNIE.
//
// Atrapy stoją na GRANICACH: `catalogSync.server` (dotyka SDK operatora)
// i `catalogAutoSync.server` (pisze do bazy). Schemat zod biegnie PRAWDZIWY.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  asServerFn,
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({
  syncBillingCatalog: vi.fn(),
  recordManualSync: vi.fn(),
  getIntegrationState: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));
vi.mock("@/lib/billing/catalogSync.server", () => ({ syncBillingCatalog: h.syncBillingCatalog }));
vi.mock("@/lib/billing/catalogAutoSync.server", () => ({
  recordManualSync: h.recordManualSync,
  getIntegrationState: h.getIntegrationState,
}));

import { getCatalogSyncState, syncPaymentCatalogNow } from "@/lib/billing/catalogSync.functions";

/** Znaczniki tożsamości - dowodzą przekazania TEGO SAMEGO obiektu, nie kopii. */
const RAPORT = { marker: "raport-synchronizacji" };
const STAN = { marker: "stan-integracji" };

/** Kształt oddawany przez schemat wejścia obu funkcji. */
interface WejscieKatalogu {
  environment?: "sandbox" | "live";
}

/** Kontekst wstrzykiwany przez middleware; te handlery go nie czytają. */
function kontekst() {
  return { supabase: { marker: "klient-z-kontekstu" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.syncBillingCatalog.mockResolvedValue(RAPORT);
  h.recordManualSync.mockResolvedValue(undefined);
  h.getIntegrationState.mockResolvedValue(STAN);
});

describe("obudowa - bramka i metoda", () => {
  it("obie funkcje wymagają roli administratora, a nie samego zalogowania", () => {
    // `requireAdmin` to admin/super_admin PLUS step-up MFA. Zejście na
    // `requireSupabaseAuth` albo `requireStaff` oddałoby przepisywanie cennika
    // operatora autorom treści.
    expect(serverFnMiddlewareNames(syncPaymentCatalogNow)).toEqual(["requireAdmin"]);
    expect(serverFnMiddlewareNames(getCatalogSyncState)).toEqual(["requireAdmin"]);
  });

  it("zapis idzie POST-em, a odczyt stanu GET-em", () => {
    // Metoda jest tu deklaracją intencji: `syncPaymentCatalogNow` ZMIENIA stan
    // u operatora, więc nie ma prawa być wywoływalna prostym przejściem pod
    // adres (prefetch, skaner linków, podgląd w komunikatorze).
    expect(asServerFn(syncPaymentCatalogNow).method).toBe("POST");
    expect(asServerFn(getCatalogSyncState).method).toBe("GET");
  });
});

describe("walidator - środowisko", () => {
  it("obie wartości enuma przechodzą", () => {
    expect(
      validateServerFnInput<WejscieKatalogu>(syncPaymentCatalogNow, { environment: "sandbox" }),
    ).toEqual({ environment: "sandbox" });
    expect(
      validateServerFnInput<WejscieKatalogu>(syncPaymentCatalogNow, { environment: "live" }),
    ).toEqual({ environment: "live" });
  });

  it("wartość spoza enuma jest ODRZUCANA - także literówka i inna wielkość liter", () => {
    // Bez tej bramki wartość poszłaby do `createStripeClient(env)`, czyli do
    // wyboru KLUCZA API. Nietrafiona nazwa środowiska albo wywala się dopiero
    // przy pierwszym wywołaniu operatora (i to komunikatem o niczym), albo -
    // gorzej - wpada w gałąź „skoro nie live, to sandbox" gdzieś niżej.
    for (const zle of ["prod", "production", "LIVE", "Sandbox", " live", "live ", "", "test"]) {
      expect(() => validateServerFnInput(syncPaymentCatalogNow, { environment: zle })).toThrow(
        ZodError,
      );
      expect(() => validateServerFnInput(getCatalogSyncState, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });

  it("`null` nie jest tym samym co brak pola - jawny `null` jest odrzucany", () => {
    // Pole jest `.optional()`, a NIE `.nullable()`. Rozróżnienie ma znaczenie:
    // formularz, który oddaje `null` zamiast pominąć pole, dostanie czytelną
    // odmowę zamiast cichego zejścia do piaskownicy.
    expect(() => validateServerFnInput(syncPaymentCatalogNow, { environment: null })).toThrow(
      ZodError,
    );
  });

  it("typ inny niż tekst jest odrzucany", () => {
    for (const zle of [1, true, ["live"], { name: "live" }]) {
      expect(() => validateServerFnInput(syncPaymentCatalogNow, { environment: zle })).toThrow(
        ZodError,
      );
    }
  });
});

describe("walidator - brak ładunku i klucze spoza schematu", () => {
  it("brak ładunku jest DOPUSZCZALNY i daje pusty obiekt", () => {
    // Panel woła obie funkcje bez argumentów przy pierwszym wejściu na ekran.
    // `input ?? {}` jest tu świadomą różnicą wobec audytu i darowizn, gdzie
    // ładunek jest obowiązkowy - pinujemy to, żeby zniknięcie tego zapisu
    // wywalało test, a nie ekran administratora.
    expect(validateServerFnInput<WejscieKatalogu>(syncPaymentCatalogNow, undefined)).toEqual({});
    expect(validateServerFnInput<WejscieKatalogu>(syncPaymentCatalogNow, null)).toEqual({});
    expect(validateServerFnInput<WejscieKatalogu>(syncPaymentCatalogNow, {})).toEqual({});
    expect(validateServerFnInput<WejscieKatalogu>(getCatalogSyncState, undefined)).toEqual({});
  });

  it("ładunek, który nie jest obiektem, nadal jest odrzucany", () => {
    // `input ?? {}` ratuje tylko `null`/`undefined`. Tekst albo liczba to
    // nadal błąd wywołania, nie „pusty zakres".
    for (const zle of ["live", 7, true, ["live"]]) {
      expect(() => validateServerFnInput(syncPaymentCatalogNow, zle)).toThrow(ZodError);
    }
  });

  it("nadmiarowe pola są odcinane", () => {
    // Gdyby ładunek przechodził w całości, każde przyszłe pole opcji
    // synchronizacji (np. „archiwizuj bez pytania") dałoby się włączyć
    // z przeglądarki, zanim ktokolwiek doda dla niego bramkę.
    expect(
      validateServerFnInput<WejscieKatalogu>(syncPaymentCatalogNow, {
        environment: "live",
        force: true,
        apiKey: "sk_zmyslony",
      }),
    ).toEqual({ environment: "live" });
  });
});

describe("handler synchronizacji - co robi z argumentami", () => {
  it("BRAK środowiska schodzi do piaskownicy - nigdy odwrotnie", async () => {
    // To jest najważniejsza asercja tego pliku. Zgubione pole w ładunku
    // (starszy klient, błąd serializacji, ręczne wywołanie) nie może
    // przepisać PRAWDZIWEGO cennika.
    const wynik = await callServerFn(syncPaymentCatalogNow, { data: {}, context: kontekst() });

    expect(h.syncBillingCatalog).toHaveBeenCalledWith("sandbox");
    expect(wynik).toBe(RAPORT);
  });

  it("środowisko produkcyjne jedzie dalej dokładnie takie, jakie przyszło", async () => {
    await callServerFn(syncPaymentCatalogNow, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(h.syncBillingCatalog).toHaveBeenCalledWith("live");
  });

  it("odcisk integracji zapisuje się dla TEGO SAMEGO środowiska i z tym samym raportem", async () => {
    // Rozjazd środowisk między krokami zapisałby „katalog aktualny" przy
    // koncie, którego nikt nie ruszał - automat przestałby leczyć to konto,
    // które faktycznie jest nieaktualne, i zacząłby powtarzać pracę na drugim.
    await callServerFn(syncPaymentCatalogNow, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(h.recordManualSync).toHaveBeenCalledWith("live", RAPORT);
  });

  it("odcisk zapisuje się DOPIERO po synchronizacji, nie równolegle", async () => {
    // Kolejność jest częścią kontraktu: odcisk liczy się ze stanu PO
    // synchronizacji. Zapis przed pracą albo obok niej utrwaliłby stan
    // sprzed zmiany i uznał katalog za aktualny, choć właśnie się zmieniał.
    const kolejnosc: string[] = [];
    h.syncBillingCatalog.mockImplementation(async () => {
      kolejnosc.push("sync");
      return RAPORT;
    });
    h.recordManualSync.mockImplementation(async () => {
      kolejnosc.push("odcisk");
    });

    await callServerFn(syncPaymentCatalogNow, { data: {}, context: kontekst() });

    expect(kolejnosc).toEqual(["sync", "odcisk"]);
  });

  it("nieudana synchronizacja NIE zapisuje odcisku integracji", async () => {
    // Zapisany odcisk znaczy „katalog sprawdzony i zgodny". Utrwalenie go po
    // awarii operatora uśpiłoby automat naprawczy przy katalogu, który
    // NIGDY nie został zsynchronizowany.
    h.syncBillingCatalog.mockRejectedValue(new Error("stripe niedostępny"));

    await expect(
      callServerFn(syncPaymentCatalogNow, { data: { environment: "live" }, context: kontekst() }),
    ).rejects.toThrow("stripe niedostępny");
    expect(h.recordManualSync).not.toHaveBeenCalled();
  });

  it("awaria zapisu odcisku wywraca całe wywołanie, mimo że katalog został zsynchronizowany", async () => {
    // ŚWIADOME pinowanie stanu faktycznego, nie aprobata. Administrator widzi
    // błąd i kliknie ponownie; `syncBillingCatalog` jest idempotentne, więc
    // powtórka nie szkodzi. Gdyby ktoś chciał to zmienić (np. oddać raport
    // z ostrzeżeniem zamiast rzucać), ten test wymusi świadomą decyzję zamiast
    // cichej zmiany kontraktu panelu.
    h.recordManualSync.mockRejectedValue(new Error("zapis odcisku padł"));

    await expect(
      callServerFn(syncPaymentCatalogNow, { data: {}, context: kontekst() }),
    ).rejects.toThrow("zapis odcisku padł");
    expect(h.syncBillingCatalog).toHaveBeenCalledTimes(1);
  });

  it("oddaje raport implementacji bez własnego przetwarzania", async () => {
    const wynik = await callServerFn(syncPaymentCatalogNow, {
      data: { environment: "sandbox" },
      context: kontekst(),
    });

    // `toBe`, nie `toEqual`: opakowanie nie ma prawa kopiować ani przycinać
    // raportu (kopia gubi pozycje dodane po stronie implementacji).
    expect(wynik).toBe(RAPORT);
  });
});

describe("handler stanu integracji - co robi z argumentami", () => {
  it("brak środowiska pyta o stan PIASKOWNICY", async () => {
    const wynik = await callServerFn(getCatalogSyncState, { data: {}, context: kontekst() });

    expect(h.getIntegrationState).toHaveBeenCalledWith("sandbox");
    expect(wynik).toBe(STAN);
  });

  it("wskazane środowisko jedzie dalej bez zmian", async () => {
    // Ekran „integracja aktualna / nieaktualna" musi mówić o koncie, o które
    // pytał administrator. Podmiana środowiska pokazałaby zieleń piaskownicy
    // przy nieaktualnym katalogu produkcyjnym.
    await callServerFn(getCatalogSyncState, {
      data: { environment: "live" },
      context: kontekst(),
    });

    expect(h.getIntegrationState).toHaveBeenCalledWith("live");
  });
});
