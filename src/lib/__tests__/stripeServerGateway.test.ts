// @vitest-environment node
//
// WARSTWA DOSTĘPU DO OPERATORA PŁATNOŚCI PO STRONIE SERWERA - klient SDK
// przepięty na bramkę konektorów oraz weryfikacja podpisu webhooka.
//
// JAKIE RYZYKO PILNUJE TEN PLIK. Dwa miejsca, w których pomyłka kosztuje
// pieniądze albo bezpieczeństwo, a żadne z nich nie było dotąd wykonane przez
// test na PRAWDZIWYM kodzie (wszystkie testy rozliczeń podmieniają
// `getStripeClient`/`verifyWebhook` w całości):
//   1. TRANSPORT. Każde żądanie SDK musi wyjść na bramkę konektorów, z
//      poświadczeniami bramki w nagłówkach, z zachowaniem metody, treści i
//      sygnału przerwania (timeout SDK). Żądanie, które poleci wprost na
//      `api.stripe.com`, nie ma klucza i kończy się błędem płatności; żądanie
//      bez treści tworzy klienta bez e-maila.
//   2. CACHE KLIENTA. Rotacja klucza ma zbudować NOWEGO klienta, a chwilowa
//      awaria ładowania SDK albo konstruktora nie może zostać zapamiętana -
//      izolat Workera żyje minutami i trwale odmawiałby płatności.
//   3. PODPIS WEBHOOKA. Zdarzenie bez podpisu, z podpisem innego środowiska,
//      ze zmienioną treścią albo spoza okna 300 s musi zostać ODRZUCONE - to
//      jedyna warstwa autoryzacji odbiornika, a zdarzenie nadaje dostęp.
//
// GRANICE ATRAP: wyłącznie sieć (`fetch`) i - tam, gdzie trzeba zasymulować
// awarię - opakowanie modułu `stripe`. SDK operatora biegnie PRAWDZIWE, więc
// test dowodzi, że realne wywołanie `customers.retrieve` przechodzi przez
// bramkę, a nie że wywołano atrapę. Podpis liczymy NIEZALEŻNĄ implementacją
// (`node:crypto`), żeby test nie powtarzał błędu kodu produkcyjnego.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXED_NOW_MS, SEKUNDA, freezeClock } from "@/test/time";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const h = vi.hoisted(() => {
  const state = {
    /** Następne ładowanie modułu `stripe` kończy się tym błędem (np. zerwany chunk). */
    sdkLoadError: null as Error | null,
    /** Ile razy runtime faktycznie ładował moduł `stripe`. */
    sdkLoads: 0,
    /** Konstruktor SDK rzuca dla tego klucza połączenia (np. odrzucona wersja API). */
    ctorFailsForKey: null as string | null,
    /** Klucze, z którymi zbudowano klienta - po jednym wpisie na KONSTRUKCJĘ. */
    constructedWith: [] as string[],
  };

  /**
   * Moduł `stripe` widziany przez kod produkcyjny: PRAWDZIWE SDK opakowane tak,
   * żeby rejestrować konstrukcje i umieć zasymulować awarię ładowania albo
   * konstruktora. Klient, który wraca, to realny klient SDK.
   */
  async function stripeModule(importOriginal: <T>() => Promise<T>) {
    state.sdkLoads += 1;
    if (state.sdkLoadError) {
      const error = state.sdkLoadError;
      state.sdkLoadError = null;
      throw error;
    }
    const actual = await importOriginal<typeof import("stripe")>();
    const RealStripe = actual.default;
    function GatewayAwareStripe(key: string, config: ConstructorParameters<typeof RealStripe>[1]) {
      state.constructedWith.push(key);
      if (state.ctorFailsForKey === key) {
        throw new Error(`Stripe: invalid configuration for ${key}`);
      }
      return new RealStripe(key, config);
    }
    // Transport produkcji trafia do PRAWDZIWEGO klienta HTTP SDK - test nie
    // woła go bezpośrednio, tylko przez realne metody SDK (`customers.*`).
    GatewayAwareStripe.createFetchHttpClient = (fn: FetchFn) =>
      RealStripe.createFetchHttpClient(fn);
    return { ...actual, default: GatewayAwareStripe };
  }

  return Object.assign(state, { stripeModule });
});

vi.mock("stripe", (importOriginal) => h.stripeModule(importOriginal));

const GATEWAY = "https://connector-gateway.lovable.dev/stripe";

const fetchMock = vi.fn<FetchFn>();

function stripeJson(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "request-id": "req_test_1" },
  });
}

/** Klucze środowiska ustawione tak, jak w działającym wdrożeniu. */
function configureKeys(keys: { sandbox?: string; live?: string; lovable?: string } = {}) {
  vi.stubEnv("STRIPE_SANDBOX_API_KEY", keys.sandbox ?? "conn_sandbox_test_1");
  vi.stubEnv("STRIPE_LIVE_API_KEY", keys.live ?? "conn_live_test_1");
  vi.stubEnv("LOVABLE_API_KEY", keys.lovable ?? "lovable_test_1");
}

/** Świeża instancja modułu: pusty cache klientów i pusta pamięć załadowanego SDK. */
async function freshModule() {
  vi.resetModules();
  return import("@/lib/stripe.server");
}

beforeEach(() => {
  h.sdkLoadError = null;
  h.sdkLoads = 0;
  h.ctorFailsForKey = null;
  h.constructedWith.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () =>
    stripeJson({ id: "cus_test_1", object: "customer", email: "anna@example.com" }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getStripeClient - transport przez bramkę konektorów", () => {
  it("żądanie SDK idzie na bramkę z poświadczeniami bramki, nie na api.stripe.com", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();

    const stripe = await getStripeClient("sandbox");
    const customer = await stripe.customers.retrieve("cus_test_1");

    expect(customer.id).toBe("cus_test_1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${GATEWAY}/v1/customers/cus_test_1`);
    expect(String(url)).not.toContain("api.stripe.com");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Connection-Api-Key")).toBe("conn_sandbox_test_1");
    expect(headers.get("Lovable-API-Key")).toBe("lovable_test_1");
    // Nagłówki samego SDK (autoryzacja, wersja API) jadą dalej bez zmian.
    expect(headers.get("Authorization")).toBe("Bearer conn_sandbox_test_1");
    expect(headers.get("Stripe-Version")).toBe("2026-08-26.dahlia");
    expect(init?.method).toBe("GET");
    // Sygnał przerwania SDK (jego timeout) nie może zginąć przy przepięciu.
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("zapis zachowuje metodę i treść formularza - klient nie powstaje bez e-maila", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();

    const stripe = await getStripeClient("live");
    await stripe.customers.create({ email: "anna@example.com", name: "Anna Kowalska" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${GATEWAY}/v1/customers`);
    expect(init?.method).toBe("POST");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("email")).toBe("anna@example.com");
    expect(body.get("name")).toBe("Anna Kowalska");
    // Środowisko live jedzie WYŁĄCZNIE kluczem live.
    expect(new Headers(init?.headers).get("X-Connection-Api-Key")).toBe("conn_live_test_1");
  });

  it("klucz idempotencji SDK dojeżdża do bramki - ponowiony zapis nie tworzy drugiego obiektu", async () => {
    // Nagłówki SDK są SKŁADANE z poświadczeniami bramki, nie nimi zastępowane:
    // zgubiony `Idempotency-Key` zamieniłby ponowienie po timeoucie w drugi
    // klient/drugie obciążenie u operatora.
    configureKeys();
    const { getStripeClient } = await freshModule();

    const stripe = await getStripeClient("sandbox");
    await stripe.customers.create({ email: "anna@example.com" }, { idempotencyKey: "idem_test_1" });

    const headers = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(headers.get("Idempotency-Key")).toBe("idem_test_1");
    expect(headers.get("X-Connection-Api-Key")).toBe("conn_sandbox_test_1");
    expect(headers.get("Lovable-API-Key")).toBe("lovable_test_1");
  });
});

describe("getStripeClient - konfiguracja i cache per środowisko", () => {
  it("brak klucza połączenia rzuca od razu, zanim powstanie jakikolwiek klient", async () => {
    configureKeys();
    vi.stubEnv("STRIPE_LIVE_API_KEY", "");
    const { getStripeClient } = await freshModule();

    await expect(getStripeClient("live")).rejects.toThrow("STRIPE_LIVE_API_KEY is not configured");
    expect(h.constructedWith).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brak klucza bramki rzuca nawet przy poprawnym kluczu połączenia", async () => {
    configureKeys();
    vi.stubEnv("LOVABLE_API_KEY", "");
    const { getStripeClient } = await freshModule();

    await expect(getStripeClient("sandbox")).rejects.toThrow("LOVABLE_API_KEY is not configured");
    expect(h.constructedWith).toEqual([]);
  });

  it("ten sam klucz -> ten sam klient; sandbox i live to osobni klienci", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();

    const first = await getStripeClient("sandbox");
    const second = await getStripeClient("sandbox");
    const live = await getStripeClient("live");

    expect(second).toBe(first);
    expect(live).not.toBe(first);
    expect(h.constructedWith).toEqual(["conn_sandbox_test_1", "conn_live_test_1"]);
  });

  it("rotacja klucza buduje nowego klienta, który wysyła NOWY klucz", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();
    const before = await getStripeClient("sandbox");

    configureKeys({ sandbox: "conn_sandbox_rotated_2" });
    const after = await getStripeClient("sandbox");
    await after.customers.retrieve("cus_test_1");

    expect(after).not.toBe(before);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("X-Connection-Api-Key")).toBe(
      "conn_sandbox_rotated_2",
    );
  });

  it("rotacja samego klucza bramki też buduje nowego klienta", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();
    const before = await getStripeClient("sandbox");

    configureKeys({ lovable: "lovable_rotated_2" });
    const after = await getStripeClient("sandbox");

    expect(after).not.toBe(before);
    expect(h.constructedWith).toEqual(["conn_sandbox_test_1", "conn_sandbox_test_1"]);
  });

  it("nieudana konstrukcja klienta nie zostaje w cache - kolejne żądanie płatności działa", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();

    h.ctorFailsForKey = "conn_sandbox_test_1";
    await expect(getStripeClient("sandbox")).rejects.toThrow("invalid configuration");

    h.ctorFailsForKey = null;
    const stripe = await getStripeClient("sandbox");
    await stripe.customers.retrieve("cus_test_1");

    expect(h.constructedWith).toEqual(["conn_sandbox_test_1", "conn_sandbox_test_1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("spóźniona porażka STAREGO klucza nie usuwa z cache klienta zbudowanego po rotacji", async () => {
    // Dwa żądania w tym samym izolacie: pierwsze wystartowało jeszcze ze
    // starym kluczem, drugie już po rotacji. Porażka pierwszego dociera
    // później - nie wolno jej wyrzucić z cache zdrowego klienta drugiego.
    configureKeys({ sandbox: "conn_sandbox_old" });
    const { getStripeClient } = await freshModule();
    h.ctorFailsForKey = "conn_sandbox_old";

    const stale = getStripeClient("sandbox");
    configureKeys({ sandbox: "conn_sandbox_new" });
    const fresh = getStripeClient("sandbox");

    await expect(stale).rejects.toThrow("invalid configuration for conn_sandbox_old");
    const healthy = await fresh;
    const again = await getStripeClient("sandbox");

    expect(again).toBe(healthy);
    expect(h.constructedWith).toEqual(["conn_sandbox_old", "conn_sandbox_new"]);
  });

  it("zerwane ładowanie SDK nie zatruwa izolatu - następne żądanie ładuje SDK ponownie", async () => {
    configureKeys();
    const { getStripeClient } = await freshModule();

    // Świeża rejestracja modułu: rejestr atrap przeżywa `resetModules`, a ten
    // przypadek wymaga PIERWSZEGO ładowania SDK w tym izolacie.
    vi.doMock("stripe", (importOriginal) => h.stripeModule(importOriginal));
    h.sdkLoads = 0;
    const loadError = new Error("Failed to fetch dynamically imported module: stripe");
    h.sdkLoadError = loadError;

    const failure = await getStripeClient("sandbox").catch((e: unknown) => e);
    // Runtime testów owija błąd ładowania atrapy; pierwotna przyczyna jedzie
    // w `cause` - to ją dostałby wołający na produkcji.
    expect((failure as Error).cause).toBe(loadError);
    expect(h.constructedWith).toEqual([]);

    const stripe = await getStripeClient("sandbox");
    await stripe.customers.retrieve("cus_test_1");

    expect(h.sdkLoads).toBe(2);
    expect(h.constructedWith).toEqual(["conn_sandbox_test_1"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("getStripeErrorMessage - komunikat dla kupującego i logu", () => {
  it("wartość, która nie jest obiektem błędu, daje komunikat ogólny", async () => {
    const { getStripeErrorMessage } = await import("@/lib/stripe.server");

    expect(getStripeErrorMessage("timeout")).toBe("Stripe request failed");
    expect(getStripeErrorMessage(null)).toBe("Stripe request failed");
    expect(getStripeErrorMessage({})).toBe("Stripe request failed");
  });

  it("szczegóły z `raw` wygrywają z polami najwyższego poziomu", async () => {
    const { getStripeErrorMessage } = await import("@/lib/stripe.server");

    expect(
      getStripeErrorMessage({
        message: "ogólny",
        code: "ogolny_kod",
        raw: { message: "Your card was declined.", code: "card_declined", decline_code: "fraud" },
      }),
    ).toBe("Your card was declined. (card_declined, fraud)");
  });

  it("bez `raw` czyta pola najwyższego poziomu; bez szczegółów zostaje sam komunikat", async () => {
    const { getStripeErrorMessage } = await import("@/lib/stripe.server");

    expect(
      getStripeErrorMessage({
        message: "No such price: 'plus_monthly'",
        type: "invalid_request_error",
        code: "resource_missing",
        param: "price",
        requestId: "req_test_1",
      }),
    ).toBe(
      "No such price: 'plus_monthly' (invalid_request_error, resource_missing, price, req_test_1)",
    );
    expect(getStripeErrorMessage(new Error("socket hang up"))).toBe("socket hang up");
  });
});

describe("resolveEnvironment - środowisko zamówienia rozstrzyga serwer", () => {
  it("produkcja: zawsze live, nawet gdy klient prosi o sandbox", async () => {
    // Zamówienie ostemplowane „sandbox" na produkcji dałoby się opłacić kartą
    // testową i zrealizować sandboxowym webhookiem - realna treść za darmo.
    vi.stubEnv("NODE_ENV", "production");
    const { resolveEnvironment } = await import("@/lib/stripe.server");

    expect(resolveEnvironment("sandbox")).toBe("live");
    expect(resolveEnvironment(null)).toBe("live");
  });

  it("poza produkcją: honoruje jawną prośbę, a bez niej wybiera sandbox", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { resolveEnvironment } = await import("@/lib/stripe.server");

    expect(resolveEnvironment("live")).toBe("live");
    expect(resolveEnvironment("sandbox")).toBe("sandbox");
    expect(resolveEnvironment(undefined)).toBe("sandbox");
    expect(resolveEnvironment("staging" as never)).toBe("sandbox");
  });
});

describe("verifyWebhook - podpis zdarzenia od operatora", () => {
  freezeClock();

  const SANDBOX_SECRET = "whsec_sandbox_test_1";
  const LIVE_SECRET = "whsec_live_test_1";
  const NOW_S = Math.floor(FIXED_NOW_MS / SEKUNDA);
  const EVENT = {
    id: "evt_test_1",
    type: "checkout.session.completed",
    created: NOW_S,
    data: { object: { id: "cs_test_1", customer_email: "anna@example.com" } },
  };
  const BODY = JSON.stringify(EVENT);

  /** Podpis w schemacie operatora, liczony niezależnie od kodu produkcyjnego. */
  const v1 = (secret: string, timestamp: number, body = BODY) =>
    createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

  function delivery(signature: string | null, body = BODY): Request {
    return new Request("https://example.com/api/public/payments/webhook?env=sandbox", {
      method: "POST",
      headers: signature === null ? {} : { "stripe-signature": signature },
      body,
    });
  }

  beforeEach(() => {
    vi.stubEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET", SANDBOX_SECRET);
    vi.stubEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", LIVE_SECRET);
  });

  it("poprawny podpis sandboxa: zwraca zdarzenie dokładnie w kształcie z treści", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");

    const event = await verifyWebhook(
      delivery(`t=${NOW_S},v1=${v1(SANDBOX_SECRET, NOW_S)}`),
      "sandbox",
    );

    expect(event).toEqual(EVENT);
  });

  it("środowisko live weryfikuje WYŁĄCZNIE sekretem live", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");

    await expect(
      verifyWebhook(delivery(`t=${NOW_S},v1=${v1(LIVE_SECRET, NOW_S)}`), "live"),
    ).resolves.toEqual(EVENT);
    // Zdarzenie opłacone kartą testową (podpis sandboxa) nie może przejść
    // jako live - odblokowałoby realną treść bez realnej płatności.
    await expect(
      verifyWebhook(delivery(`t=${NOW_S},v1=${v1(SANDBOX_SECRET, NOW_S)}`), "live"),
    ).rejects.toThrow("Invalid webhook signature");
  });

  it("rotacja sekretu u operatora: wystarczy, że pasuje JEDEN z podpisów v1", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");
    const header = [
      `t=${NOW_S}`,
      `v1=${v1("whsec_poprzedni_sekret", NOW_S)}`,
      // Pusty wpis i schemat v0 (tryb testowy operatora) są ignorowane.
      "v1=",
      `v0=${v1(SANDBOX_SECRET, NOW_S)}`,
      `v1=${v1(SANDBOX_SECRET, NOW_S)}`,
    ].join(",");

    await expect(verifyWebhook(delivery(header), "sandbox")).resolves.toEqual(EVENT);
  });

  it("zmieniona treść przy oryginalnym podpisie jest odrzucana", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");
    const forged = JSON.stringify({ ...EVENT, type: "invoice.paid" });

    await expect(
      verifyWebhook(delivery(`t=${NOW_S},v1=${v1(SANDBOX_SECRET, NOW_S)}`, forged), "sandbox"),
    ).rejects.toThrow("Invalid webhook signature");
  });

  it("brak nagłówka podpisu albo pusta treść: odmowa przed jakimkolwiek liczeniem", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");

    await expect(verifyWebhook(delivery(null), "sandbox")).rejects.toThrow(
      "Missing signature or body",
    );
    await expect(
      verifyWebhook(delivery(`t=${NOW_S},v1=${v1(SANDBOX_SECRET, NOW_S, "")}`, ""), "sandbox"),
    ).rejects.toThrow("Missing signature or body");
  });

  it("nagłówek bez znacznika czasu albo bez podpisu v1 ma zły format", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");

    await expect(
      verifyWebhook(delivery(`v1=${v1(SANDBOX_SECRET, NOW_S)}`), "sandbox"),
    ).rejects.toThrow("Invalid signature format");
    await expect(
      verifyWebhook(delivery(`t=${NOW_S},v0=${v1(SANDBOX_SECRET, NOW_S)}`), "sandbox"),
    ).rejects.toThrow("Invalid signature format");
  });

  it("okno 300 s: granica przyjęta, starsze i z przyszłości odrzucone (powtórka)", async () => {
    const { verifyWebhook } = await import("@/lib/stripe.server");
    const signedAt = (t: number) => delivery(`t=${t},v1=${v1(SANDBOX_SECRET, t)}`);

    await expect(verifyWebhook(signedAt(NOW_S - 300), "sandbox")).resolves.toEqual(EVENT);
    await expect(verifyWebhook(signedAt(NOW_S - 301), "sandbox")).rejects.toThrow(
      "Webhook timestamp too old",
    );
    await expect(verifyWebhook(signedAt(NOW_S + 301), "sandbox")).rejects.toThrow(
      "Webhook timestamp too old",
    );
  });

  it("brak sekretu środowiska: odmowa zamiast weryfikacji pustym kluczem", async () => {
    vi.stubEnv("PAYMENTS_LIVE_WEBHOOK_SECRET", "");
    const { verifyWebhook } = await import("@/lib/stripe.server");

    await expect(verifyWebhook(delivery(`t=${NOW_S},v1=${v1("", NOW_S)}`), "live")).rejects.toThrow(
      "PAYMENTS_LIVE_WEBHOOK_SECRET is not configured",
    );
  });
});
