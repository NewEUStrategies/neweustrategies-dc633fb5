// Podgląd zapisanej metody płatności - 0 z 2 funkcji pokrytych do 31.08.2026.
//
// PO CO TEN PLIK ISTNIEJE. `fetchPaymentMethodPreview` to jedyne miejsce, w
// którym dane karty klienta przechodzą przez naszą warstwę serwerową w drodze
// na ekran profilu (`getMyPaymentMethod` w `src/utils/payments.functions.ts`).
// Moduł ma dwie odpowiedzialności i obie były niedotknięte:
//
//   1. ZAWĘŻENIE ŁADUNKU. Przez granicę RPC przepuszczamy WYŁĄCZNIE sześć pól
//      (marka, cztery ostatnie cyfry, miesiąc/rok ważności, portfel, typ).
//      Regresja polegająca na oddaniu całego obiektu operatora nie wywala się
//      głośno - po prostu wysyła do przeglądarki identyfikatory klienta,
//      adres rozliczeniowy i dane kontaktowe. Dlatego test porównuje CAŁY
//      kształt wyniku i osobno LISTĘ KLUCZY.
//   2. KOLEJNOŚĆ ŹRÓDEŁ. Domyślna metoda faktur -> domyślna metoda
//      subskrypcji -> pierwsza zapisana karta. Pomyłka w kolejności pokazuje
//      klientowi kartę, z której faktycznie NIE pobieramy pieniędzy, więc
//      wymiana „tej z ekranu" nie zatrzymuje nieudanych obciążeń.
//
// ŚCIEŻKI ODMOWY, które ten plik przybija: klient usunięty u operatora, brak
// rozwinięcia obiektu (operator oddaje sam identyfikator), brak subskrypcji,
// pusta lista metod, metoda bez karty (BLIK/przelew) oraz AWARIA OPERATORA -
// wyjątek MA wychodzić na zewnątrz, bo wywołujący (`getMyPaymentMethod`)
// zamienia go na komunikat; połknięcie go tutaj dałoby „brak karty" u klienta,
// który kartę ma.
//
// GRANICA, KTÓRĄ ATRAPUJEMY: wyłącznie budowa klienta operatora
// (`createStripeClient`). Reszta modułu `stripe.server` zostaje prawdziwa.
// Zero sieci, zero kluczy - atrapa nie wykonuje żadnego żądania.
// RODO: żadnych prawdziwych numerów kart ani danych osobowych.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Karta w kształcie, w jakim czyta ją moduł (tylko realnie używane pola). */
interface KartaAtrapa {
  brand?: string | null;
  last4?: string | null;
  exp_month?: number | null;
  exp_year?: number | null;
  wallet?: { type: string } | null;
}

/** Metoda płatności - `card` bywa nieobecna (BLIK, przelew, portfel). */
interface MetodaAtrapa {
  id: string;
  type: string;
  card?: KartaAtrapa | null;
}

/** Klient operatora; `deleted: true` to obiekt skasowanego klienta. */
interface KlientAtrapa {
  id: string;
  deleted?: true;
  invoice_settings?: { default_payment_method?: MetodaAtrapa | string | null } | null;
}

interface SubskrypcjaAtrapa {
  id: string;
  default_payment_method?: MetodaAtrapa | string | null;
}

const h = vi.hoisted(() => ({
  /** Środowiska, dla których zbudowano klienta - kontrakt sandbox/live. */
  envs: [] as string[],
  customerArgs: [] as Array<[string, Record<string, unknown> | undefined]>,
  subscriptionArgs: [] as Array<[string, Record<string, unknown> | undefined]>,
  listArgs: [] as Array<Record<string, unknown>>,
  customer: null as KlientAtrapa | null,
  subscription: null as SubskrypcjaAtrapa | null,
  methods: [] as MetodaAtrapa[],
  /** Awaria operatora na wskazanym wywołaniu (timeout, 5xx, zły klucz). */
  throwOn: null as "customer" | "subscription" | "list" | null,
}));

// Atrapa stoi na GRANICY: podmieniamy WYŁĄCZNIE budowę klienta, cała reszta
// `stripe.server` (w tym wymóg konfiguracji kluczy) zostaje prawdziwa.
// Bez rzutowania na typ `Stripe` - atrapa niesie tylko realnie wołane metody.
vi.mock("@/lib/stripe.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe.server")>()),
  createStripeClient: (env: string) => {
    h.envs.push(env);
    return {
      customers: {
        retrieve: (id: string, params?: Record<string, unknown>) => {
          h.customerArgs.push([id, params]);
          if (h.throwOn === "customer") return Promise.reject(new Error("operator: 503"));
          return Promise.resolve(h.customer);
        },
      },
      subscriptions: {
        retrieve: (id: string, params?: Record<string, unknown>) => {
          h.subscriptionArgs.push([id, params]);
          if (h.throwOn === "subscription") return Promise.reject(new Error("operator: 503"));
          return Promise.resolve(h.subscription);
        },
      },
      paymentMethods: {
        list: (params: Record<string, unknown>) => {
          h.listArgs.push(params);
          if (h.throwOn === "list") return Promise.reject(new Error("operator: 503"));
          return Promise.resolve({ data: h.methods });
        },
      },
    };
  },
}));

const { fetchPaymentMethodPreview } = await import("@/lib/billing/paymentMethod.server");

/** Karta testowa - marka i końcówka bez związku z jakąkolwiek realną kartą. */
function karta(over: Partial<KartaAtrapa> = {}): KartaAtrapa {
  return { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031, wallet: null, ...over };
}

function metoda(over: Partial<MetodaAtrapa> = {}): MetodaAtrapa {
  return { id: "pm_test_1", type: "card", card: karta(), ...over };
}

const WEJSCIE = { customerId: "cus_test_1", subscriptionId: "sub_test_1" } as const;

beforeEach(() => {
  h.envs.length = 0;
  h.customerArgs.length = 0;
  h.subscriptionArgs.length = 0;
  h.listArgs.length = 0;
  h.customer = { id: "cus_test_1" };
  h.subscription = { id: "sub_test_1" };
  h.methods = [];
  h.throwOn = null;
});

describe("kolejność źródeł metody płatności", () => {
  it("domyślna metoda FAKTUR wygrywa i zatrzymuje dalsze pytania", async () => {
    // Ta karta obciąża klienta przy odnowieniu, więc to ją ma zobaczyć na
    // ekranie. Asercja o BRAKU dalszych wywołań jest tu równie ważna jak
    // wynik: każde zbędne pytanie do operatora to kolejny punkt awarii na
    // ścieżce renderowania profilu.
    h.customer = {
      id: "cus_test_1",
      invoice_settings: { default_payment_method: metoda({ id: "pm_faktury" }) },
    };

    const preview = await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(preview).toEqual({
      brand: "visa",
      last4: "4242",
      expMonth: 4,
      expYear: 2031,
      wallet: null,
      type: "card",
    });
    expect(h.subscriptionArgs).toHaveLength(0);
    expect(h.listArgs).toHaveLength(0);
  });

  it("nierozwinięty identyfikator metody u klienta schodzi do subskrypcji", async () => {
    // Operator oddaje `default_payment_method` jako NAPIS, gdy rozwinięcie się
    // nie powiodło. Napis nie niesie ani marki, ani końcówki numeru - gdyby
    // moduł go przepuścił, ekran pokazałby identyfikator techniczny.
    h.customer = {
      id: "cus_test_1",
      invoice_settings: { default_payment_method: "pm_tylko_identyfikator" },
    };
    h.subscription = { id: "sub_test_1", default_payment_method: metoda({ id: "pm_subskrypcji" }) };

    const preview = await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(preview?.last4).toBe("4242");
    expect(h.subscriptionArgs).toHaveLength(1);
  });

  it("klient SKASOWANY u operatora nie blokuje odczytu z subskrypcji", async () => {
    // Skasowany klient to obiekt bez `invoice_settings` - odczyt „na ślepo"
    // wywaliłby się na undefined zamiast przejść dalej.
    h.customer = { id: "cus_test_1", deleted: true };
    h.subscription = { id: "sub_test_1", default_payment_method: metoda({ id: "pm_subskrypcji" }) };

    const preview = await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(preview?.type).toBe("card");
  });

  it("klient bez ustawień faktur schodzi do subskrypcji", async () => {
    h.customer = { id: "cus_test_1", invoice_settings: null };
    h.subscription = { id: "sub_test_1", default_payment_method: metoda() };

    await expect(
      fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" }),
    ).resolves.not.toBeNull();
  });

  it("pusta domyślna metoda faktur (null) schodzi do subskrypcji", async () => {
    h.customer = { id: "cus_test_1", invoice_settings: { default_payment_method: null } };
    h.subscription = { id: "sub_test_1", default_payment_method: metoda() };

    await expect(
      fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" }),
    ).resolves.not.toBeNull();
  });

  it("nierozwinięta metoda subskrypcji schodzi do listy zapisanych kart", async () => {
    h.subscription = { id: "sub_test_1", default_payment_method: "pm_tylko_identyfikator" };
    h.methods = [metoda({ id: "pm_z_listy", card: karta({ last4: "1111" }) })];

    const preview = await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(preview?.last4).toBe("1111");
  });

  it("BEZ subskrypcji pytamy od razu o listę zapisanych kart", async () => {
    // Dostęp z nadania i zakupy jednorazowe nie mają subskrypcji - pytanie
    // o nią byłoby żądaniem po identyfikatorze `null`.
    h.methods = [metoda({ card: karta({ last4: "0005" }) })];

    const preview = await fetchPaymentMethodPreview({
      customerId: "cus_test_1",
      subscriptionId: null,
      environment: "sandbox",
    });

    expect(h.subscriptionArgs).toHaveLength(0);
    expect(preview?.last4).toBe("0005");
  });

  it("brak jakiejkolwiek zapisanej metody to `null`, nie błąd", async () => {
    // Konto z dostępem z nadania NIE MA karty - to normalny stan, a nie
    // awaria. Wyjątek w tym miejscu wywróciłby cały ekran profilu.
    h.methods = [];

    await expect(
      fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" }),
    ).resolves.toBeNull();
  });
});

describe("kształt danych przepuszczanych przez granicę", () => {
  it("oddaje DOKŁADNIE sześć pól - nic z obiektu operatora nie wycieka", async () => {
    // Gdyby moduł oddał obiekt operatora (albo doklejał pola „na przyszłość"),
    // do przeglądarki poszłyby identyfikatory klienta i dane rozliczeniowe.
    // Lista kluczy jest tu kontraktem prywatności, nie kosmetyką.
    h.customer = {
      id: "cus_test_1",
      invoice_settings: { default_payment_method: metoda() },
    };

    const preview = await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(Object.keys(preview ?? {}).sort()).toEqual([
      "brand",
      "expMonth",
      "expYear",
      "last4",
      "type",
      "wallet",
    ]);
  });

  it("metoda BEZ karty (BLIK, przelew) oddaje same puste pola i sam typ", async () => {
    // Nie każda metoda ma numer i datę ważności. Wynik ma być czytelny dla
    // interfejsu (`type`), a nie udawać karty.
    h.methods = [{ id: "pm_blik", type: "blik" }];

    const preview = await fetchPaymentMethodPreview({
      customerId: "cus_test_1",
      subscriptionId: null,
      environment: "sandbox",
    });

    expect(preview).toEqual({
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      wallet: null,
      type: "blik",
    });
  });

  it("portfel (Apple Pay/Google Pay) trafia do podglądu jako typ portfela", async () => {
    // Karta w portfelu ma inne zasady wymiany niż karta wpisana ręcznie -
    // ekran musi to rozróżniać, inaczej instrukcja „zmień kartę" jest błędna.
    h.methods = [metoda({ card: karta({ wallet: { type: "apple_pay" } }) })];

    const preview = await fetchPaymentMethodPreview({
      customerId: "cus_test_1",
      subscriptionId: null,
      environment: "sandbox",
    });

    expect(preview?.wallet).toBe("apple_pay");
  });

  it("brak pól karty u operatora daje `null`, nigdy `undefined`", async () => {
    // `undefined` gubi się w serializacji RPC - pole zniknęłoby z odpowiedzi
    // zamiast dojechać jako „nieznane".
    h.methods = [{ id: "pm_okrojona", type: "card", card: {} }];

    const preview = await fetchPaymentMethodPreview({
      customerId: "cus_test_1",
      subscriptionId: null,
      environment: "sandbox",
    });

    expect(preview).toEqual({
      brand: null,
      last4: null,
      expMonth: null,
      expYear: null,
      wallet: null,
      type: "card",
    });
  });
});

describe("kontrakt wywołań u operatora", () => {
  it("prosi o ROZWINIĘCIE domyślnej metody klienta i subskrypcji", async () => {
    // Bez `expand` operator oddaje sam identyfikator - podgląd byłby pusty
    // przy poprawnie skonfigurowanym koncie. To jest kontrakt żądania, więc
    // sprawdzamy go wprost.
    h.subscription = { id: "sub_test_1", default_payment_method: "pm_id" };

    await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(h.customerArgs[0]).toEqual([
      "cus_test_1",
      { expand: ["invoice_settings.default_payment_method"] },
    ]);
    expect(h.subscriptionArgs[0]).toEqual(["sub_test_1", { expand: ["default_payment_method"] }]);
  });

  it("lista kart jest pytana o JEDNĄ pozycję i tylko dla tego klienta", async () => {
    // Limit 1 to nie oszczędność: podgląd pokazuje jedną kartę, a większa
    // strona to więcej cudzych danych w pamięci procesu, niż potrzeba.
    await fetchPaymentMethodPreview({
      customerId: "cus_test_1",
      subscriptionId: null,
      environment: "sandbox",
    });

    expect(h.listArgs[0]).toEqual({ customer: "cus_test_1", limit: 1 });
  });

  it("klient budowany jest w ŻĄDANYM środowisku - sandbox", async () => {
    await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" });

    expect(h.envs).toEqual(["sandbox"]);
  });

  it("klient budowany jest w ŻĄDANYM środowisku - live", async () => {
    // Pomyłka środowiska to zapytanie o kartę w bazie, w której tego klienta
    // nie ma - użytkownik produkcyjny zobaczyłby „brak metody płatności".
    await fetchPaymentMethodPreview({ ...WEJSCIE, environment: "live" });

    expect(h.envs).toEqual(["live"]);
  });
});

describe("awaria operatora", () => {
  it("błąd przy odczycie klienta wychodzi na zewnątrz", async () => {
    // Połknięcie wyjątku dałoby „brak karty" u klienta, który kartę ma -
    // i podpowiedź „dodaj metodę płatności" mimo działającej subskrypcji.
    // Wywołujący (`getMyPaymentMethod`) ma własny `catch` i zamienia to na
    // komunikat, więc odpowiedzialność jest przeniesiona świadomie.
    h.throwOn = "customer";

    await expect(fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" })).rejects.toThrow(
      "operator: 503",
    );
  });

  it("błąd przy odczycie subskrypcji wychodzi na zewnątrz", async () => {
    h.throwOn = "subscription";

    await expect(fetchPaymentMethodPreview({ ...WEJSCIE, environment: "sandbox" })).rejects.toThrow(
      "operator: 503",
    );
  });

  it("błąd przy liście metod wychodzi na zewnątrz", async () => {
    h.throwOn = "list";

    await expect(
      fetchPaymentMethodPreview({
        customerId: "cus_test_1",
        subscriptionId: null,
        environment: "sandbox",
      }),
    ).rejects.toThrow("operator: 503");
  });
});
