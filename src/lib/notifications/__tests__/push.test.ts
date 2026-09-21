// Klient Web Push (`src/lib/notifications/push.ts`) - powierzchnia, która do tej
// pory stała na ZERZE pokrycia, mimo że decyduje o dwóch rzeczach naraz:
// o tym, czy przeglądarka w ogóle dostanie prompt o uprawnieniu, i o tym, co
// wyląduje w `push_subscriptions` (tabela z kluczami kryptograficznymi kanału).
//
// Test nie wychodzi do sieci ani do Supabase: klient jest atrapą łańcucha
// PostgREST, a `navigator.serviceWorker` / `PushManager` / `Notification` są
// budowane przez `vi.stubGlobal`, bo happy-dom nie zna żadnego z nich.
//
// Wszystkie adresy endpointów są z domeny example.com - subskrypcja push jest
// danymi osobowymi (identyfikuje przeglądarkę), więc w fixture'ach nie ma
// ani jednego prawdziwego adresu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabase";

const stub = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => stub.from(table) },
}));

// Server-fn z kluczem VAPID. Podmieniona, bo prawdziwa wychodzi poza runtime
// TanStack Start - a przedmiotem dowodu jest LICZBA jej wywołań (cache), nie
// jej implementacja.
const getPushPublicKey = vi.fn<() => Promise<{ publicKey: string | null }>>();
vi.mock("../pushConfig.functions", () => ({
  getPushPublicKey: () => getPushPublicKey(),
}));

// -------------------- typowane atrapy Web Push --------------------
// Bez rzutowań: `vi.stubGlobal` przyjmuje `unknown`, więc wystarczy, że atrapy
// są spójne SAME W SOBIE i mają dokładnie te ogniwa, których dotyka `push.ts`.

interface FakeSubscriptionJson {
  keys?: { p256dh?: string; auth?: string };
}

interface FakeSubscription {
  endpoint: string;
  toJSON: () => FakeSubscriptionJson;
  unsubscribe: () => Promise<boolean>;
}

interface SubscribeOptions {
  userVisibleOnly: boolean;
  applicationServerKey: ArrayBuffer;
}

interface FakePushManager {
  getSubscription: () => Promise<FakeSubscription | null>;
  subscribe: (options: SubscribeOptions) => Promise<FakeSubscription>;
}

interface FakeRegistration {
  pushManager: FakePushManager;
}

interface FakeServiceWorkerContainer {
  register: (path: string) => Promise<FakeRegistration>;
  getRegistration: (path?: string) => Promise<FakeRegistration | undefined>;
  ready: Promise<FakeRegistration>;
}

interface PushEnvironment {
  register: ReturnType<typeof vi.fn<(path: string) => Promise<FakeRegistration>>>;
  getRegistration: ReturnType<
    typeof vi.fn<(path?: string) => Promise<FakeRegistration | undefined>>
  >;
  getSubscription: ReturnType<typeof vi.fn<() => Promise<FakeSubscription | null>>>;
  subscribe: ReturnType<typeof vi.fn<(options: SubscribeOptions) => Promise<FakeSubscription>>>;
  unsubscribe: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
  subscription: FakeSubscription;
}

/** Klucz publiczny VAPID (65 bajtów). Długość base64url = 87, czyli NIE dzieli
 *  się przez 4 - bez dopełnienia i bez podmiany `-`/`_` łańcuch nie jest
 *  poprawnym wejściem `atob`. */
const VAPID_87 =
  "-wIJEBceJSwzOkFIT1ZdZGtyeYCHjpWco6qxuL_GzdTb4unw9_4FDBMaISgvNj1ES1JZYGdudXyDipGYn6attLs";

/** Klucz, którego base64url ma długość 64 - PODZIELNĄ przez 4. Łapie klasyczny
 *  błąd dopełnienia `"=".repeat(4 - len % 4)` bez zewnętrznego `% 4`: taki kod
 *  dokleiłby tu cztery znaki `=` i wywrócił `atob`. */
const VAPID_64 = "-_-_PgABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSor";

/** Krótki wektor z OBOMA znakami alfabetu URL-safe: `-` i `_`. */
const B64URL_DASHES = "-_-_Pg";
const B64URL_DASHES_BYTES = [0xfb, 0xff, 0xbf, 0x3e];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function makeSubscription(
  endpoint: string,
  keys: FakeSubscriptionJson["keys"],
  unsubscribe: () => Promise<boolean>,
): FakeSubscription {
  return { endpoint, toJSON: () => ({ keys }), unsubscribe };
}

interface EnvironmentOptions {
  /** Subskrypcja zwracana przez `getSubscription()` - `null` wymusza `subscribe()`. */
  existing?: FakeSubscription | null;
  /** Klucze w `toJSON()` nowej subskrypcji. */
  keys?: FakeSubscriptionJson["keys"];
  permission?: NotificationPermission;
  userAgent?: string;
  /** `undefined` = brak zarejestrowanego workera (ścieżka `disable`). */
  registration?: "present" | "absent";
  unsubscribeResult?: () => Promise<boolean>;
}

/**
 * Buduje KOMPLETNE środowisko push. Poszczególne testy wyłączają z niego po
 * jednym filarze, bo `isPushSupported()` to koniunkcja czterech warunków i
 * tylko rozłączne wyłączanie dowodzi, że każdy z nich realnie bramkuje.
 */
function installPushEnvironment(options: EnvironmentOptions = {}): PushEnvironment {
  const unsubscribe = vi.fn<() => Promise<boolean>>(
    options.unsubscribeResult ?? (() => Promise.resolve(true)),
  );
  const subscription = makeSubscription(
    "https://push.example.com/endpoint/abc",
    options.keys ?? { p256dh: "p256dh-test", auth: "auth-test" },
    unsubscribe,
  );
  const existing = options.existing === undefined ? null : options.existing;

  const getSubscription = vi.fn<() => Promise<FakeSubscription | null>>(() =>
    Promise.resolve(existing),
  );
  const subscribe = vi.fn<(o: SubscribeOptions) => Promise<FakeSubscription>>(() =>
    Promise.resolve(subscription),
  );
  const registration: FakeRegistration = { pushManager: { getSubscription, subscribe } };

  const register = vi.fn<(path: string) => Promise<FakeRegistration>>(() =>
    Promise.resolve(registration),
  );
  const getRegistration = vi.fn<(path?: string) => Promise<FakeRegistration | undefined>>(() =>
    Promise.resolve(options.registration === "absent" ? undefined : registration),
  );
  const serviceWorker: FakeServiceWorkerContainer = {
    register,
    getRegistration,
    ready: Promise.resolve(registration),
  };

  const requestPermission = vi.fn<() => Promise<NotificationPermission>>(() =>
    Promise.resolve(options.permission ?? "granted"),
  );

  vi.stubGlobal("navigator", {
    serviceWorker,
    userAgent: options.userAgent ?? "Mozilla/5.0 (Test) TestBrowser/1.0",
  });
  vi.stubGlobal("PushManager", {});
  vi.stubGlobal("Notification", { requestPermission });

  return {
    register,
    getRegistration,
    getSubscription,
    subscribe,
    unsubscribe,
    requestPermission,
    subscription,
  };
}

/**
 * `cachedKey` w `push.ts` to stan MODUŁOWY żyjący przez całą kartę. Bez
 * `resetModules()` drugi test dostałby klucz zapamiętany przez pierwszy i
 * „dowodziłby" cache'u, którego nie zmierzył.
 */
async function loadPush() {
  vi.resetModules();
  return import("../push");
}

beforeEach(() => {
  stub.reset();
  stub.setResponse("push_subscriptions", ok(null));
  getPushPublicKey.mockReset();
  getPushPublicKey.mockResolvedValue({ publicKey: VAPID_87 });
  // Pusty łańcuch, a nie brak zmiennej: `import.meta.env` może nieść wartość z
  // `.env` maszyny, a wtedy testy ścieżki serwerowej mierzyłyby cudzą konfigurację.
  vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isPushSupported - każdy filar osobno", () => {
  it("komplet czterech warunków daje true", async () => {
    installPushEnvironment();
    const { isPushSupported } = await loadPush();
    expect(isPushSupported()).toBe(true);
  });

  // SSR i workerdy: `window` nie istnieje. Gdyby warunek zniknął, sam odczyt
  // `navigator` wywaliłby render serwerowy, a nie zwrócił „brak wsparcia".
  it("brak `window` daje false", async () => {
    installPushEnvironment();
    vi.stubGlobal("window", undefined);
    const { isPushSupported } = await loadPush();
    expect(isPushSupported()).toBe(false);
  });

  // Safari w trybie prywatnym i osadzone webviews: `navigator` jest, workerów nie ma.
  it("brak `serviceWorker` w navigatorze daje false", async () => {
    installPushEnvironment();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Test) TestBrowser/1.0" });
    const { isPushSupported } = await loadPush();
    expect(isPushSupported()).toBe(false);
  });

  // Przeglądarki z SW, ale bez Push API (dawne iOS-y) - subscribe by nie istniał.
  it("brak `PushManager` w oknie daje false", async () => {
    const env = installPushEnvironment();
    vi.unstubAllGlobals();
    vi.stubGlobal("navigator", {
      serviceWorker: { register: env.register, getRegistration: env.getRegistration },
      userAgent: "Mozilla/5.0 (Test) TestBrowser/1.0",
    });
    vi.stubGlobal("Notification", { requestPermission: env.requestPermission });
    const { isPushSupported } = await loadPush();
    expect(isPushSupported()).toBe(false);
  });

  // Bez `Notification` nie da się zapytać o uprawnienie - wolno tylko odmówić
  // wsparcia, nigdy rzucić `ReferenceError` w handlerze przełącznika.
  it("brak `Notification` w oknie daje false", async () => {
    const env = installPushEnvironment();
    vi.unstubAllGlobals();
    vi.stubGlobal("navigator", {
      serviceWorker: { register: env.register, getRegistration: env.getRegistration },
      userAgent: "Mozilla/5.0 (Test) TestBrowser/1.0",
    });
    vi.stubGlobal("PushManager", {});
    const { isPushSupported } = await loadPush();
    expect(isPushSupported()).toBe(false);
  });
});

describe("vapidPublicKey - cache na czas życia karty", () => {
  // SEDNO: klucz VAPID jest STAŁĄ KONFIGURACYJNĄ, nie danymi użytkownika.
  // Bez cache'u każde otwarcie ustawień powiadomień biłoby po serwerze, a każdy
  // ponowny render przełącznika - jeszcze raz.
  it("dwa wywołania robią JEDNO zapytanie do serwera", async () => {
    const { vapidPublicKey } = await loadPush();
    await expect(vapidPublicKey()).resolves.toBe(VAPID_87);
    await expect(vapidPublicKey()).resolves.toBe(VAPID_87);
    expect(getPushPublicKey).toHaveBeenCalledTimes(1);
  });

  // Zmienna build-time to wyjątek dla instalacji, które wolą klucz w buildzie.
  // Musi WYGRAĆ z serwerem, inaczej rotacja przez sekret cicho by ją unieważniła.
  it("zmienna build-time ma pierwszeństwo i w ogóle nie pyta serwera", async () => {
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "build-time-key");
    const { vapidPublicKey } = await loadPush();
    await expect(vapidPublicKey()).resolves.toBe("build-time-key");
    expect(getPushPublicKey).not.toHaveBeenCalled();
  });

  // Pusty klucz z serwera = push nie jest skonfigurowany. Zwrot `null`, nie "".
  it("pusty klucz z serwera daje null", async () => {
    getPushPublicKey.mockResolvedValue({ publicKey: "" });
    const { vapidPublicKey } = await loadPush();
    await expect(vapidPublicKey()).resolves.toBeNull();
  });

  it("null z serwera daje null", async () => {
    getPushPublicKey.mockResolvedValue({ publicKey: null });
    const { vapidPublicKey } = await loadPush();
    await expect(vapidPublicKey()).resolves.toBeNull();
  });

  // Push WYŁĄCZONY, nie wyjątek: awaria server-fn nie może wywrócić ustawień.
  it("odrzucone wywołanie server-fn daje null zamiast wyjątku", async () => {
    getPushPublicKey.mockRejectedValue(new Error("network down"));
    const { vapidPublicKey } = await loadPush();
    await expect(vapidPublicKey()).resolves.toBeNull();
  });

  it("synchroniczny rzut server-fn też daje null", async () => {
    getPushPublicKey.mockImplementation(() => {
      throw new Error("import failed");
    });
    const { vapidPublicKey } = await loadPush();
    await expect(vapidPublicKey()).resolves.toBeNull();
  });

  // `null` też jest wynikiem, więc też podlega cache'owi (`!== undefined`).
  // Bez tego brak konfiguracji generowałby zapytanie przy KAŻDYM renderze.
  it("zapamiętany brak klucza nie odpytuje serwera drugi raz", async () => {
    getPushPublicKey.mockResolvedValue({ publicKey: null });
    const { vapidPublicKey } = await loadPush();
    await vapidPublicKey();
    await vapidPublicKey();
    expect(getPushPublicKey).toHaveBeenCalledTimes(1);
  });

  // Kontrola do testu cache'u: świeży moduł MUSI odpytać serwer ponownie.
  // Bez tej asercji „jedno wywołanie" mogłoby znaczyć „zero wywołań w ogóle".
  it("świeży moduł (nowa karta) pyta serwer od nowa", async () => {
    const first = await loadPush();
    await first.vapidPublicKey();
    const second = await loadPush();
    await second.vapidPublicKey();
    expect(getPushPublicKey).toHaveBeenCalledTimes(2);
  });
});

describe("enablePushForThisBrowser - bramki wejściowe", () => {
  it("brak wsparcia rzuca push_unsupported przed jakimkolwiek zapytaniem", async () => {
    installPushEnvironment();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Test) TestBrowser/1.0" });
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_unsupported");
    expect(getPushPublicKey).not.toHaveBeenCalled();
    expect(stub.chains).toHaveLength(0);
  });

  // Brak klucza to błąd KONFIGURACJI, nie odmowa użytkownika - i nie wolno przy
  // nim zapytać o uprawnienie, bo prompt spalony bez pożytku już nie wróci.
  it("brak klucza VAPID rzuca push_not_configured i NIE pyta o uprawnienie", async () => {
    getPushPublicKey.mockResolvedValue({ publicKey: null });
    const env = installPushEnvironment();
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_not_configured");
    expect(env.requestPermission).not.toHaveBeenCalled();
  });

  // Odmowa uprawnienia kończy ścieżkę PRZED rejestracją workera - inaczej
  // zostawialibyśmy w przeglądarce SW obsługujący kanał, którego nie ma.
  it("odmowa uprawnienia rzuca push_denied i nie rejestruje workera", async () => {
    const env = installPushEnvironment({ permission: "denied" });
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_denied");
    expect(env.register).not.toHaveBeenCalled();
    expect(stub.chains).toHaveLength(0);
  });

  it("stan `default` (prompt zamknięty bez decyzji) też rzuca push_denied", async () => {
    installPushEnvironment({ permission: "default" });
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_denied");
  });
});

describe("enablePushForThisBrowser - ścieżka szczęśliwa", () => {
  it("rejestruje worker pod /push-sw.js i czeka na gotowość", async () => {
    const env = installPushEnvironment();
    const { enablePushForThisBrowser } = await loadPush();
    await enablePushForThisBrowser("user-1");
    expect(env.register).toHaveBeenCalledWith("/push-sw.js");
  });

  // REUŻYCIE: powtórne włączenie pusha w tej samej przeglądarce nie może tworzyć
  // drugiej subskrypcji - to byłby drugi endpoint na to samo urządzenie i
  // podwójne powiadomienia dla użytkownika.
  it("istniejąca subskrypcja jest reużywana - subscribe() NIE jest wołane", async () => {
    const existing = makeSubscription(
      "https://push.example.com/endpoint/existing",
      { p256dh: "p256dh-existing", auth: "auth-existing" },
      () => Promise.resolve(true),
    );
    const env = installPushEnvironment({ existing });
    const { enablePushForThisBrowser } = await loadPush();
    await enablePushForThisBrowser("user-1");
    expect(env.subscribe).not.toHaveBeenCalled();
    const payload = stub.lastChain("push_subscriptions")?.argsOf("upsert")?.[0];
    expect(isRecord(payload) && payload.endpoint).toBe(
      "https://push.example.com/endpoint/existing",
    );
  });

  // `userVisibleOnly: true` jest wymogiem Chrome - subskrypcja bez tej flagi
  // jest odrzucana przez przeglądarkę, a błąd widać dopiero na produkcji.
  it("brak subskrypcji tworzy nową z userVisibleOnly", async () => {
    const env = installPushEnvironment({ existing: null });
    const { enablePushForThisBrowser } = await loadPush();
    await enablePushForThisBrowser("user-1");
    expect(env.subscribe).toHaveBeenCalledTimes(1);
    const options = env.subscribe.mock.calls[0][0];
    expect(options.userVisibleOnly).toBe(true);
  });

  it("zapisuje komplet pól subskrypcji z onConflict na endpoincie", async () => {
    installPushEnvironment();
    const { enablePushForThisBrowser } = await loadPush();
    await enablePushForThisBrowser("user-42");
    const args = stub.lastChain("push_subscriptions")?.argsOf("upsert");
    const payload = args?.[0];
    expect(isRecord(payload)).toBe(true);
    if (!isRecord(payload)) return;
    expect(payload.user_id).toBe("user-42");
    expect(payload.endpoint).toBe("https://push.example.com/endpoint/abc");
    expect(payload.p256dh).toBe("p256dh-test");
    expect(payload.auth).toBe("auth-test");
    // `failed_at: null` KASUJE poprzedni znacznik martwego kanału: ponowne
    // włączenie pusha musi wskrzesić subskrypcję wygaszoną przez 410 z serwera.
    expect(payload.failed_at).toBeNull();
    expect(args?.[1]).toEqual({ onConflict: "endpoint" });
  });

  // Kolumna `user_agent` ma limit w bazie; przycięcie po stronie klienta jest
  // JEDYNYM miejscem, w którym długi UA nie wywala całego zapisu subskrypcji.
  it("user_agent jest ucinany do 250 znaków", async () => {
    installPushEnvironment({ userAgent: "U".repeat(400) });
    const { enablePushForThisBrowser } = await loadPush();
    await enablePushForThisBrowser("user-1");
    const payload = stub.lastChain("push_subscriptions")?.argsOf("upsert")?.[0];
    expect(isRecord(payload)).toBe(true);
    if (!isRecord(payload)) return;
    expect(payload.user_agent).toBe("U".repeat(250));
  });

  // Błąd zapisu MUSI dojechać do wołającego: bez tego przełącznik pokazałby
  // „push włączony", a serwer nie miałby dokąd wysłać ani jednego powiadomienia.
  it("błąd upsertu propaguje się do wołającego", async () => {
    installPushEnvironment();
    stub.setResponse("push_subscriptions", fail("duplicate key value", "23505"));
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("duplicate key value");
  });
});

describe("enablePushForThisBrowser - dekodowanie klucza VAPID (b64urlToUint8)", () => {
  async function applicationServerKey(publicKey: string): Promise<Uint8Array> {
    getPushPublicKey.mockResolvedValue({ publicKey });
    const env = installPushEnvironment({ existing: null });
    const { enablePushForThisBrowser } = await loadPush();
    await enablePushForThisBrowser("user-1");
    return new Uint8Array(env.subscribe.mock.calls[0][0].applicationServerKey);
  }

  // Alfabet URL-safe: `-` i `_` NIE są znakami base64. Bez podmiany na `+`/`/`
  // `atob` rzuca InvalidCharacterError, a push nigdy się nie włącza.
  it("zamienia `-` na `+` i `_` na `/` - bajty zgadzają się co do jednego", async () => {
    const bytes = await applicationServerKey(B64URL_DASHES);
    expect([...bytes]).toEqual(B64URL_DASHES_BYTES);
  });

  // Długość base64url = 87 (mod 4 = 3). Realny klucz P-256 ma 65 bajtów i jeśli
  // arytmetyka dopełnienia jest zła, wychodzi klucz o innej długości - serwer
  // push odrzuca wtedy CAŁĄ subskrypcję komunikatem o niepoprawnym kluczu.
  it("klucz o długości niepodzielnej przez 4 daje pełne 65 bajtów", async () => {
    const bytes = await applicationServerKey(VAPID_87);
    expect(bytes).toHaveLength(65);
    // Pierwszy bajt niekompresowanego punktu EC - dowód, że dekodowanie nie
    // przesunęło się o znak dopełnienia.
    expect(bytes[0]).toBe(0xfb);
  });

  // Kontrapunkt: długość PODZIELNA przez 4 nie może dostać dopełnienia wcale.
  // `"=".repeat(4 - len % 4)` bez zewnętrznego `% 4` dokleiłby tu `====`.
  it("klucz o długości podzielnej przez 4 nie dostaje nadmiarowego dopełnienia", async () => {
    const bytes = await applicationServerKey(VAPID_64);
    expect(bytes).toHaveLength(48);
  });
});

describe("enablePushForThisBrowser - subscriptionKeys", () => {
  // Subskrypcja bez kompletu kluczy jest bezużyteczna: `p256dh` i `auth` są
  // wejściem szyfrowania aes128gcm (RFC 8291). Zapis takiego wiersza dałby
  // kanał, który po stronie serwera wywala się dopiero przy wysyłce.
  it("brak p256dh rzuca push_bad_subscription i nic nie zapisuje", async () => {
    installPushEnvironment({ keys: { auth: "auth-only" } });
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_bad_subscription");
    expect(stub.chainsFor("push_subscriptions")).toHaveLength(0);
  });

  it("brak auth rzuca push_bad_subscription i nic nie zapisuje", async () => {
    installPushEnvironment({ keys: { p256dh: "p256dh-only" } });
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_bad_subscription");
    expect(stub.chainsFor("push_subscriptions")).toHaveLength(0);
  });

  it("całkowicie pusty obiekt kluczy też rzuca push_bad_subscription", async () => {
    installPushEnvironment({ keys: {} });
    const { enablePushForThisBrowser } = await loadPush();
    await expect(enablePushForThisBrowser("user-1")).rejects.toThrow("push_bad_subscription");
  });
});

describe("disablePushForThisBrowser", () => {
  // Wyłączenie na przeglądarce bez pusha to NIE-ZDARZENIE. Rzucony wyjątek
  // wywróciłby ustawienia komuś, kto pusha nigdy nie miał.
  it("brak wsparcia kończy się cicho i nie dotyka bazy", async () => {
    installPushEnvironment();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Test) TestBrowser/1.0" });
    const { disablePushForThisBrowser } = await loadPush();
    await expect(disablePushForThisBrowser()).resolves.toBeUndefined();
    expect(stub.chains).toHaveLength(0);
  });

  // Brak rejestracji: nie ma czego wypisywać ani czego kasować. Kasowanie „na
  // wszelki wypadek" po user_id zdjęłoby subskrypcje INNYCH urządzeń.
  it("brak rejestracji workera nic nie kasuje", async () => {
    const env = installPushEnvironment({ registration: "absent" });
    const { disablePushForThisBrowser } = await loadPush();
    await disablePushForThisBrowser();
    expect(env.getRegistration).toHaveBeenCalledWith("/push-sw.js");
    expect(stub.chains).toHaveLength(0);
  });

  it("rejestracja bez subskrypcji nic nie kasuje", async () => {
    installPushEnvironment({ existing: null });
    const { disablePushForThisBrowser } = await loadPush();
    await disablePushForThisBrowser();
    expect(stub.chains).toHaveLength(0);
  });

  // Dwa kroki, oba obowiązkowe: usunięcie wiersza (serwer przestaje wysyłać) i
  // `unsubscribe()` (przeglądarka przestaje przyjmować). Sam pierwszy zostawia
  // martwy kanał w przeglądarce, sam drugi - endpoint w bazie dostający 410.
  it("kasuje wiersz po endpoincie ORAZ wypisuje subskrypcję w przeglądarce", async () => {
    const unsubscribe = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true));
    const existing = makeSubscription(
      "https://push.example.com/endpoint/to-remove",
      { p256dh: "p", auth: "a" },
      unsubscribe,
    );
    installPushEnvironment({ existing });
    const { disablePushForThisBrowser } = await loadPush();
    await disablePushForThisBrowser();
    const chain = stub.lastChain("push_subscriptions");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual([
      "endpoint",
      "https://push.example.com/endpoint/to-remove",
    ]);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  // Przeglądarka potrafi odmówić `unsubscribe()` (np. worker już zniknął).
  // Wiersz jest już skasowany, więc odrzucenie NIE MOŻE wywrócić wyłączania -
  // inaczej użytkownik zobaczyłby błąd po udanej operacji.
  it("odrzucone unsubscribe() nie wywraca wyłączania", async () => {
    const rejecting = makeSubscription(
      "https://push.example.com/endpoint/stubborn",
      { p256dh: "p", auth: "a" },
      () => Promise.reject(new Error("worker gone")),
    );
    installPushEnvironment({ existing: rejecting });
    const { disablePushForThisBrowser } = await loadPush();
    await expect(disablePushForThisBrowser()).resolves.toBeUndefined();
    expect(stub.lastChain("push_subscriptions")?.has("delete")).toBe(true);
  });
});
