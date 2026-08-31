// Odczyt WŁAŚCICIELA transakcji u operatora - 0 z 3 funkcji pokrytych
// do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. `retrieveTransactionOwners` jest wejściem do
// kontroli własności faktury: `invoice.server` pyta o właścicieli transakcji,
// a potem porównuje `owners.userId` z identyfikatorem zalogowanego
// (`ownsTransaction`). Jeżeli ten moduł zwróci ZŁEGO właściciela albo
// „jakiegokolwiek" zamiast żadnego, kontrola własności przepuszcza obcą
// fakturę - czyli dane rozliczeniowe innej osoby (imię, adres, kwota).
// Odwrotny błąd jest tańszy, ale też realny: `null` tam, gdzie właściciel
// istnieje, zabiera klientowi dostęp do własnego dokumentu księgowego.
//
// TRZY REGUŁY, KTÓRYCH PILNUJE TEN PLIK:
//   1. TRZY KSZTAŁTY REFERENCJI. `in_` (faktura), `cs_` (sesja checkoutu),
//      `pi_` (płatność) - dokładnie te trzy zapisujemy jako numer transakcji
//      pokazywany klientowi. Referencja spoza tej trójki NIE JEST pytaniem do
//      operatora, tylko odmową na wejściu.
//   2. `userId` TYLKO Z NAPISU. `metadata` u operatora jest workiem na
//      dowolne wartości; wartość nie będąca napisem MUSI dać `null`, bo
//      porównanie `owners.userId === userId` z liczbą albo obiektem cicho
//      przepuszczałoby błędne dopasowania.
//   3. AWARIA NIE RZUCA. Wyjątek operatora kończy się `null` i wpisem do
//      dziennika - wywołujący zamienia to na „nie znaleziono", a nie na
//      pustą stronę.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: wyłącznie budowa klienta operatora. Zero sieci,
// zero kluczy. `resolveEnvironment` biegnie PRAWDZIWY - moduł go re-eksportuje
// i to on jest jedyną RUNTIME'ową bramką wartości `sandbox`/`live` (typ
// `StripeEnv` żyje wyłącznie w kompilacji i nie chroni niczego w czasie
// wykonania).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Kształty obiektów operatora - tylko pola realnie czytane przez moduł. */
interface FakturaAtrapa {
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  metadata?: Record<string, unknown> | null;
}

interface SesjaAtrapa {
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  metadata?: Record<string, unknown> | null;
}

interface PlatnoscAtrapa {
  customer?: string | { id: string } | null;
  metadata?: Record<string, unknown> | null;
}

const h = vi.hoisted(() => ({
  envs: [] as string[],
  ids: [] as string[],
  invoice: {} as FakturaAtrapa,
  session: {} as SesjaAtrapa,
  paymentIntent: {} as PlatnoscAtrapa,
  /** Operator odmawia (nieistniejący zasób, 5xx, zły klucz). */
  throws: null as string | null,
}));

vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  createStripeClient: (env: string) => {
    h.envs.push(env);
    const odmowa = () => Promise.reject(new Error(h.throws ?? "operator"));
    return {
      invoices: {
        retrieve: (id: string) => {
          h.ids.push(id);
          return h.throws ? odmowa() : Promise.resolve(h.invoice);
        },
      },
      checkout: {
        sessions: {
          retrieve: (id: string) => {
            h.ids.push(id);
            return h.throws ? odmowa() : Promise.resolve(h.session);
          },
        },
      },
      paymentIntents: {
        retrieve: (id: string) => {
          h.ids.push(id);
          return h.throws ? odmowa() : Promise.resolve(h.paymentIntent);
        },
      },
    };
  },
}));

const { resolveEnvironment, retrieveTransactionOwners } =
  await import("@/lib/billing/transactions.server");
const stripeServer = await import("@/lib/stripe.server");

/** Identyfikatory testowe - bez związku z jakąkolwiek realną transakcją. */
const UZYTKOWNIK = "user-kupujacy";

beforeEach(() => {
  h.envs.length = 0;
  h.ids.length = 0;
  h.invoice = {};
  h.session = {};
  h.paymentIntent = {};
  h.throws = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("faktura (`in_...`)", () => {
  it("oddaje klienta, subskrypcję i właściciela z metadanych", async () => {
    // Trzy pola, trzy kształty w jednym obiekcie: klient jako napis,
    // subskrypcja jako obiekt zagnieżdżony. Operator oddaje raz tak, raz tak,
    // zależnie od rozwinięcia - obie postaci muszą dać ten sam identyfikator.
    h.invoice = {
      customer: "cus_test_1",
      subscription: { id: "sub_test_1" },
      metadata: { userId: UZYTKOWNIK },
    };

    await expect(retrieveTransactionOwners("sandbox", "in_test_1")).resolves.toEqual({
      customerId: "cus_test_1",
      subscriptionId: "sub_test_1",
      userId: UZYTKOWNIK,
    });
    expect(h.ids).toEqual(["in_test_1"]);
  });

  it("faktura bez subskrypcji (zakup jednorazowy) ma `subscriptionId` null", async () => {
    h.invoice = { customer: { id: "cus_test_1" }, metadata: { userId: UZYTKOWNIK } };

    await expect(retrieveTransactionOwners("sandbox", "in_test_2")).resolves.toEqual({
      customerId: "cus_test_1",
      subscriptionId: null,
      userId: UZYTKOWNIK,
    });
  });

  it("brak metadanych daje `userId` null, a nie właściciela „na wszelki wypadek”", async () => {
    // Faktura wystawiona poza checkoutem (ręcznie w panelu operatora) nie ma
    // naszego identyfikatora. Kontrola własności ma wtedy zejść do zapytania
    // o zamówienie w naszej bazie - a nie dostać fałszywego dopasowania.
    h.invoice = { customer: "cus_test_1" };

    await expect(retrieveTransactionOwners("sandbox", "in_test_3")).resolves.toEqual({
      customerId: "cus_test_1",
      subscriptionId: null,
      userId: null,
    });
  });

  it("`metadata.userId` NIE będące napisem jest odrzucane", async () => {
    // `metadata` u operatora jest workiem na dowolne wartości i da się je
    // ustawić spoza naszego kodu (integracje, import). Wartość liczbowa
    // przepuszczona dalej trafiłaby do porównania z identyfikatorem
    // użytkownika - a to jest bramka dostępu do cudzej faktury.
    h.invoice = { customer: "cus_test_1", metadata: { userId: 42 } };

    await expect(retrieveTransactionOwners("sandbox", "in_test_4")).resolves.toMatchObject({
      userId: null,
    });
  });

  it("brak klienta na fakturze daje `customerId` null", async () => {
    h.invoice = { customer: null, metadata: { userId: UZYTKOWNIK } };

    await expect(retrieveTransactionOwners("sandbox", "in_test_5")).resolves.toMatchObject({
      customerId: null,
    });
  });
});

describe("sesja checkoutu (`cs_...`)", () => {
  it("oddaje klienta jako obiekt, subskrypcję jako napis i właściciela", async () => {
    h.session = {
      customer: { id: "cus_test_2" },
      subscription: "sub_test_2",
      metadata: { userId: UZYTKOWNIK },
    };

    await expect(retrieveTransactionOwners("sandbox", "cs_test_1")).resolves.toEqual({
      customerId: "cus_test_2",
      subscriptionId: "sub_test_2",
      userId: UZYTKOWNIK,
    });
  });

  it("sesja gościa (bez konta) nie zmyśla właściciela", async () => {
    // Darowizna i bilet da się kupić bez konta - `userId` po prostu nie
    // istnieje. To normalny stan, nie awaria.
    h.session = { customer: "cus_test_2", subscription: null, metadata: {} };

    await expect(retrieveTransactionOwners("sandbox", "cs_test_2")).resolves.toEqual({
      customerId: "cus_test_2",
      subscriptionId: null,
      userId: null,
    });
  });
});

describe("płatność (`pi_...`)", () => {
  it("oddaje klienta i właściciela, a subskrypcję zawsze jako null", async () => {
    // PaymentIntent nie niesie subskrypcji - `null` jest tu regułą modułu,
    // nie brakiem danych.
    h.paymentIntent = { customer: "cus_test_3", metadata: { userId: UZYTKOWNIK } };

    await expect(retrieveTransactionOwners("sandbox", "pi_test_1")).resolves.toEqual({
      customerId: "cus_test_3",
      subscriptionId: null,
      userId: UZYTKOWNIK,
    });
  });

  it("`metadata.userId` jako obiekt jest odrzucane", async () => {
    h.paymentIntent = { customer: "cus_test_3", metadata: { userId: { id: UZYTKOWNIK } } };

    await expect(retrieveTransactionOwners("sandbox", "pi_test_2")).resolves.toMatchObject({
      userId: null,
    });
  });
});

describe("referencja spoza trzech znanych kształtów", () => {
  it("nieznany przedrostek to `null` BEZ pytania operatora", async () => {
    // Brak pytania jest tu istotą: nieznana referencja pochodzi z ładunku
    // żądania, więc każde takie pytanie byłoby darmowym ruchem do operatora
    // sterowanym z zewnątrz (i kanałem sondowania cudzych identyfikatorów).
    await expect(retrieveTransactionOwners("sandbox", "txn_stary_format")).resolves.toBeNull();

    expect(h.ids).toEqual([]);
  });

  it("pusta referencja to `null`", async () => {
    await expect(retrieveTransactionOwners("sandbox", "")).resolves.toBeNull();
    expect(h.ids).toEqual([]);
  });

  it("referencja z przedrostkiem w środku napisu nie jest akceptowana", async () => {
    // `startsWith` - nie `includes`. Referencja „podszywająca się" pod fakturę
    // (`evil_in_test`) nie może trafić do operatora.
    await expect(retrieveTransactionOwners("sandbox", "evil_in_test_1")).resolves.toBeNull();
    expect(h.ids).toEqual([]);
  });
});

describe("awaria operatora", () => {
  it("wyjątek kończy się `null` i wpisem do dziennika z numerem transakcji", async () => {
    // Numer transakcji w logu jest jedyną nicią, po której da się dojść do
    // zgłoszenia klienta („nie widzę faktury"). Bez niego wpis jest bezużyteczny.
    const dziennik = vi.spyOn(console, "error").mockImplementation(() => {});
    h.throws = "No such invoice: in_ghost";

    await expect(retrieveTransactionOwners("sandbox", "in_ghost")).resolves.toBeNull();

    expect(dziennik).toHaveBeenCalledTimes(1);
    expect(dziennik.mock.calls[0]).toContain("in_ghost");
  });

  it("awaria przy sesji checkoutu też nie rzuca", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.throws = "timeout";

    await expect(retrieveTransactionOwners("live", "cs_ghost")).resolves.toBeNull();
  });

  it("awaria przy płatności też nie rzuca", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.throws = "timeout";

    await expect(retrieveTransactionOwners("live", "pi_ghost")).resolves.toBeNull();
  });
});

describe("środowisko operatora", () => {
  it("klient budowany jest w środowisku podanym przez wywołującego", async () => {
    // Pomyłka środowiska to pytanie o transakcję w bazie, w której jej nie ma:
    // klient produkcyjny dostałby „nie znaleziono" dla opłaconej faktury.
    h.invoice = { customer: "cus_test_1" };

    await retrieveTransactionOwners("live", "in_test_1");
    await retrieveTransactionOwners("sandbox", "in_test_1");

    expect(h.envs).toEqual(["live", "sandbox"]);
  });

  it("re-eksport `resolveEnvironment` to TA SAMA funkcja, co w `stripe.server`", () => {
    // Moduł re-eksportuje bramkę środowiska, żeby wywołujący nie sięgał po
    // dwa różne źródła prawdy. Kopia (choćby identyczna) rozjechałaby się przy
    // pierwszej zmianie reguły produkcyjnej.
    expect(resolveEnvironment).toBe(stripeServer.resolveEnvironment);
  });

  it("bramka środowiska: brak żądanej wartości daje piaskownicę poza produkcją", () => {
    // Typ `StripeEnv` nie istnieje w czasie wykonania, więc to JEST cała
    // runtime'owa walidacja wartości `sandbox`/`live` na tej ścieżce.
    expect(resolveEnvironment(undefined)).toBe("sandbox");
    expect(resolveEnvironment(null)).toBe("sandbox");
    expect(resolveEnvironment("live")).toBe("live");
    expect(resolveEnvironment("sandbox")).toBe("sandbox");
  });

  it("na produkcji środowisko jest ZAWSZE `live`, cokolwiek poda wywołujący", () => {
    // Gdyby dało się wymusić piaskownicę na produkcji, transakcja
    // ostemplowana `sandbox` mogłaby zostać „opłacona" kartą testową.
    vi.stubEnv("NODE_ENV", "production");

    expect(resolveEnvironment("sandbox")).toBe("live");
    expect(resolveEnvironment(undefined)).toBe("live");
  });
});
