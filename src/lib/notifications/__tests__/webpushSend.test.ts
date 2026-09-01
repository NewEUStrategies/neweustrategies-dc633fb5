// ŚCIEŻKA WYSYŁKI web push - do 01.09.2026 bez jednego testu (krypto RFC 8291
// i JWT RFC 8292 mają swój `webpush.test.ts`, ale `sendWebPush` z całą obwódką
// HTTP - nie). Obwódka jest tu ważniejsza od krypto, bo to ONA decyduje, co
// dyspozytor (`dispatch.server.ts`) zrobi z wynikiem: ponowi, wyrzuci do
// dead-letter czy trwale odetnie urządzenie. Trzy rzeczy pilnowane tutaj i
// nigdzie indziej:
//
//   1. STRAŻNICA SSRF jest fail-closed. `endpoint` subskrypcji to napis
//      przysłany przez przeglądarkę użytkownika, czyli wejście wrogie: bez
//      bramki serwer POST-uje w cudzym imieniu na 169.254.169.254 (metadane
//      chmury), na localhost albo na `*.internal`. Kontrakt: żadnego `fetch`
//      i wynik `gone:true, permanent:false` - `gone` zatrzymuje ponowienia
//      tego urządzenia, a `permanent:false` zostawia szansę pozostałym
//      urządzeniom tego samego odbiorcy.
//   2. MAPOWANIE STATUSÓW. Pomylenie 410 (subskrypcja martwa) z 503 (usługa
//      chwilowo pada) to albo wykasowanie żywych urządzeń, albo osiem retry
//      na trupie.
//   3. HIGIENA POŁĄCZENIA: `redirect:"manual"` (30x nie może odbić po
//      przejściu strażnicy), domknięty strumień odpowiedzi (keep-alive dla
//      partii do jednego hosta) i skasowany timer (tick ma 25 s budżetu).
//
// ZERO RUCHU SIECIOWEGO: `fetch` jest atrapą, a endpointy testowe to albo
// adresy odrzucane przez strażnicę BEZ DNS-u (schemat, `localhost`, literalne
// IP, sufiks `.internal`), albo literalne IP z puli dokumentacyjnej TEST-NET-3
// (RFC 5737), które strażnica przepuszcza również bez zapytania DNS.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import {
  MAX_PUSH_PAYLOAD_BYTES,
  b64urlEncode,
  encodePushPayload,
  generateVapidKeys,
  resetVapidCaches,
  sendWebPush,
  vapidFromEnv,
  type PushPayload,
  type PushSubscriptionKeys,
  type VapidConfig,
} from "../webpush.server";

// Strażnica zostaje PRAWDZIWA (to jej zachowanie mierzymy), ale przez podmianę
// modułu widzimy, CZY i z czym została zawołana - bez tego nie da się dowieść,
// że gałąź „payload ponad budżet" odsiewa wiadomość PRZED strażnicą i DNS-em.
const guard = vi.hoisted(() => ({ calls: [] as string[], failWith: null as Error | null }));

vi.mock("@/lib/http/egressGuard.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http/egressGuard.server")>();
  return {
    ...actual,
    assertPublicHttpUrl: (raw: string): Promise<URL> => {
      guard.calls.push(raw);
      // `failWith` służy JEDNEMU przypadkowi: awarii strażnicy INNEJ niż
      // odmowa (patrz test „błąd inny niż BlockedUrlError"). Domyślnie
      // przechodzi do prawdziwej implementacji.
      if (guard.failWith) return Promise.reject(guard.failWith);
      return actual.assertPublicHttpUrl(raw);
    },
  };
});

/** Kształt opcji `fetch`, których dotyka `sendWebPush` (bez rzutowań typów). */
interface FetchInit {
  method?: string;
  redirect?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  body?: Uint8Array;
}

interface RecordedFetch {
  url: string;
  init: FetchInit;
}

/** Atrapa odpowiedzi usługi push - tylko pola czytane przez `sendWebPush`. */
interface StubResponse {
  status: number;
  headers: { get: (name: string) => string | null };
  body: { cancel: () => Promise<void> } | null;
}

interface ResponseSpec {
  status: number;
  /** Wartość nagłówka `retry-after`; pominięcie = nagłówka NIE MA. */
  retryAfter?: string;
  /** Domyślnie strumień z atrapą `cancel()`; `null` = odpowiedź bez ciała. */
  cancel?: Mock<() => Promise<void>> | null;
}

interface FetchStub {
  calls: RecordedFetch[];
  cancel: Mock<() => Promise<void>> | null;
}

function installFetch(spec: ResponseSpec): FetchStub {
  const cancel =
    spec.cancel === undefined ? vi.fn((): Promise<void> => Promise.resolve()) : spec.cancel;
  const calls: RecordedFetch[] = [];
  const response: StubResponse = {
    status: spec.status,
    headers: {
      get: (name: string): string | null =>
        name.toLowerCase() === "retry-after" ? (spec.retryAfter ?? null) : null,
    },
    body: cancel === null ? null : { cancel },
  };
  vi.stubGlobal("fetch", (url: string, init: FetchInit): Promise<StubResponse> => {
    calls.push({ url, init });
    return Promise.resolve(response);
  });
  return { calls, cancel };
}

/** Publiczny (dla strażnicy) endpoint bez DNS: literalne IP z TEST-NET-3. */
const PUBLIC_ENDPOINT = "https://203.0.113.10/push/device-1";

const VAPID_KEYS = generateVapidKeys();
const VAPID: VapidConfig = {
  publicKey: VAPID_KEYS.publicKey,
  privateKey: VAPID_KEYS.privateKey,
  subject: "mailto:push@example.com",
};

interface Subscriber {
  sub: PushSubscriptionKeys;
  ua: ReturnType<typeof createECDH>;
  auth: Buffer;
}

/** Subskrypcja z PRAWDZIWĄ parą P-256 - inaczej szyfrowanie odrzuci klucze. */
function subscriber(endpoint = PUBLIC_ENDPOINT): Subscriber {
  const ua = createECDH("prime256v1");
  ua.generateKeys();
  const auth = randomBytes(16);
  return {
    sub: { endpoint, p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(auth) },
    ua,
    auth,
  };
}

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk)
    .update(info)
    .update(Buffer.from([1]))
    .digest()
    .subarray(0, length);
}

/**
 * Odszyfrowanie jak w przeglądarce (RFC 8291) - potrzebne tylko po to, żeby
 * dowieść, CO poleciało w ciele żądania, gdy `payload` podano jako obiekt.
 */
function decryptAsBrowser(body: Buffer, who: Subscriber): string {
  const salt = body.subarray(0, 16);
  const asPublic = body.subarray(21, 21 + 65);
  const ciphertext = body.subarray(21 + 65);
  const sharedSecret = who.ua.computeSecret(asPublic);
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0", "ascii"),
    who.ua.getPublicKey(),
    asPublic,
  ]);
  const ikm = hkdf(who.auth, sharedSecret, keyInfo, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "ascii"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "ascii"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const record = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  return record.subarray(0, record.length - 1).toString("utf8"); // bez delimitera 0x02
}

beforeEach(() => {
  guard.calls = [];
  guard.failWith = null;
  resetVapidCaches();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("sendWebPush - strażnica SSRF (fail-closed)", () => {
  // Każdy z tych adresów jest odrzucany BEZ zapytania DNS (schemat, lista
  // hostów, literalne IP, sufiks `.internal`), więc test mierzy prawdziwą
  // strażnicę, a mimo to nie rusza sieci ani resolvera.
  const blocked: { label: string; endpoint: string }[] = [
    { label: "localhost", endpoint: "https://localhost/push/x" },
    { label: "metadane chmury (169.254.169.254)", endpoint: "https://169.254.169.254/push/x" },
    { label: "host wewnętrzny (.internal)", endpoint: "https://foo.internal/push/x" },
    { label: "adres nie-https", endpoint: "http://203.0.113.10/push/x" },
  ];

  for (const { label, endpoint } of blocked) {
    it(`odmawia wysyłki na ${label} i NIE dotyka fetch`, async () => {
      const stub = installFetch({ status: 201 });
      const who = subscriber(endpoint);

      const result = await sendWebPush(who.sub, Buffer.from("{}"), VAPID);

      // `gone:true` - dyspozytor przestaje ponawiać to urządzenie;
      // `permanent:false` - to błąd URZĄDZENIA, nie payloadu, więc pozostałe
      // urządzenia odbiorcy nadal mają prawo dostać to powiadomienie.
      expect(result).toEqual({
        ok: false,
        gone: true,
        permanent: false,
        status: 0,
        retryAfterSec: null,
      });
      expect(stub.calls).toHaveLength(0);
      expect(guard.calls).toEqual([endpoint]);
    });
  }

  it("błąd inny niż BlockedUrlError leci wyżej, zamiast udawać martwą subskrypcję", async () => {
    // Fail-closed dotyczy ODMOWY, nie AWARII. Gdyby `sendWebPush` łykał każdy
    // wyjątek strażnicy jako `gone:true`, jedna usterka po jej stronie (np.
    // wywrócony moduł DNS) trwale oznaczyłaby `mark_push_subscription_failed`
    // WSZYSTKIE urządzenia z partii - i push umarłby dla nich na zawsze,
    // zamiast wrócić do kolejki jako błąd przechodni.
    const stub = installFetch({ status: 201 });
    guard.failWith = new TypeError("dnsPromises.lookup is not a function");

    await expect(sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID)).rejects.toThrow(
      "dnsPromises.lookup is not a function",
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("przepuszcza publiczny endpoint - odmowy wyżej nie są efektem zepsutej atrapy", async () => {
    const stub = installFetch({ status: 201 });

    const result = await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    expect(result.ok).toBe(true);
    expect(stub.calls).toHaveLength(1);
  });
});

describe("sendWebPush - budżet payloadu", () => {
  it("odrzuca payload ponad budżet jako trwały 413, zanim ruszy strażnicę i krypto", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stub = installFetch({ status: 201 });
    const oversized = Buffer.alloc(MAX_PUSH_PAYLOAD_BYTES + 1, 0x61);

    const result = await sendWebPush(subscriber().sub, oversized, VAPID);

    expect(result).toEqual({
      ok: false,
      gone: false,
      permanent: true,
      status: 413,
      retryAfterSec: null,
    });
    // Sedno tej gałęzi: ani DNS-u, ani szyfrowania, ani żądania - usługa push
    // i tak odpowiedziałaby 413, a tick crona ma 25 s na całą partię.
    expect(guard.calls).toHaveLength(0);
    expect(stub.calls).toHaveLength(0);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("payload dokładnie na granicy budżetu jeszcze leci", async () => {
    const stub = installFetch({ status: 201 });
    const exact = Buffer.alloc(MAX_PUSH_PAYLOAD_BYTES, 0x61);

    const result = await sendWebPush(subscriber().sub, exact, VAPID);

    expect(result.ok).toBe(true);
    expect(stub.calls).toHaveLength(1);
  });
});

describe("sendWebPush - mapowanie odpowiedzi usługi push", () => {
  // Te cztery pola to CAŁA informacja, jaką dyspozytor ma o losie wysyłki
  // (`drainPushLane`): `gone` ucina kolejkę urządzenia i oznacza subskrypcję
  // jako martwą, `permanent` dead-letteruje zadanie, brak obu = retry.
  const cases: {
    status: number;
    ok: boolean;
    gone: boolean;
    permanent: boolean;
    retryAfter?: string;
    retryAfterSec: number | null;
  }[] = [
    { status: 200, ok: true, gone: false, permanent: false, retryAfterSec: null },
    { status: 201, ok: true, gone: false, permanent: false, retryAfterSec: null },
    { status: 400, ok: false, gone: false, permanent: true, retryAfterSec: null },
    { status: 404, ok: false, gone: true, permanent: false, retryAfterSec: null },
    { status: 410, ok: false, gone: true, permanent: false, retryAfterSec: null },
    { status: 413, ok: false, gone: false, permanent: true, retryAfterSec: null },
    { status: 429, ok: false, gone: false, permanent: false, retryAfter: "30", retryAfterSec: 30 },
    { status: 500, ok: false, gone: false, permanent: false, retryAfterSec: null },
    { status: 503, ok: false, gone: false, permanent: false, retryAfter: "60", retryAfterSec: 60 },
  ];

  for (const c of cases) {
    it(`status ${c.status} -> ok:${c.ok} gone:${c.gone} permanent:${c.permanent}`, async () => {
      installFetch({ status: c.status, retryAfter: c.retryAfter });

      const result = await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

      expect(result).toEqual({
        ok: c.ok,
        gone: c.gone,
        permanent: c.permanent,
        status: c.status,
        retryAfterSec: c.retryAfterSec,
      });
    });
  }
});

describe("sendWebPush - żądanie do usługi push", () => {
  it("niesie komplet nagłówków RFC 8030/8292 i domyślne TTL/Urgency", async () => {
    const stub = installFetch({ status: 201 });
    const who = subscriber();

    await sendWebPush(who.sub, Buffer.from("{}"), VAPID);

    const [call] = stub.calls;
    expect(call.url).toBe(who.sub.endpoint);
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers ?? {};
    // RFC 8292 sek. 3: `vapid t=<JWT>, k=<klucz publiczny>` - literówka w tym
    // nagłówku to 401 z KAŻDEJ usługi push, czyli cisza na wszystkich urządzeniach.
    expect(headers.Authorization).toMatch(
      new RegExp(
        `^vapid t=[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+, k=${VAPID.publicKey}$`,
      ),
    );
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers.TTL).toBe("86400");
    expect(headers.Urgency).toBe("normal");
    // Bez tematu nagłówka `Topic` NIE MA - pusty temat kolapsowałby ze sobą
    // niepowiązane powiadomienia po stronie usługi push.
    expect(headers).not.toHaveProperty("Topic");
  });

  it("ma redirect:'manual' - 30x nie może odbić na host wewnętrzny po przejściu strażnicy", async () => {
    const stub = installFetch({ status: 201 });

    await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    expect(stub.calls[0].init.redirect).toBe("manual");
  });

  it("przekazuje signal AbortControllera (twardy timeout wysyłki)", async () => {
    const stub = installFetch({ status: 201 });

    await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    const { signal } = stub.calls[0].init;
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
  });

  it("honoruje ttlSec, urgency i ucina Topic do 32 znaków (RFC 8030 sek. 5.4)", async () => {
    const stub = installFetch({ status: 201 });
    const longTopic = "0123456789abcdefghijklmnopqrstuvwxyz"; // 36 znaków

    await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID, {
      ttlSec: 60,
      urgency: "high",
      topic: longTopic,
    });

    const headers = stub.calls[0].init.headers ?? {};
    expect(headers.TTL).toBe("60");
    expect(headers.Urgency).toBe("high");
    // Za długi `Topic` to 400 z usługi push, czyli dead-letter całego zadania -
    // dlatego ucięcie musi być po stronie klienta, a nie „w praktyce się mieści".
    expect(headers.Topic).toHaveLength(32);
    expect(headers.Topic).toBe(longTopic.slice(0, 32));
  });

  it("payload podany jako obiekt jedzie zserializowany przez encodePushPayload", async () => {
    const stub = installFetch({ status: 201 });
    const who = subscriber();
    const payload: PushPayload = {
      title: "Zażółć gęślą jaźń",
      body: "Treść powiadomienia",
      href: "/events/x",
      lang: "pl",
      tag: "abc",
    };

    await sendWebPush(who.sub, payload, VAPID);

    const body = stub.calls[0].init.body;
    expect(body).toBeDefined();
    // Odszyfrowanie po stronie „przeglądarki": kontrakt z service workerem
    // (`public/push-sw.js`) jest bajtowy, więc sprawdzamy bajty, nie kształt.
    expect(decryptAsBrowser(Buffer.from(body ?? new Uint8Array()), who)).toBe(
      encodePushPayload(payload).toString("utf8"),
    );
  });
});

describe("sendWebPush - domknięcie strumienia i timer", () => {
  it("domyka ciało odpowiedzi (połączenie wraca do puli keep-alive)", async () => {
    const stub = installFetch({ status: 201 });

    await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    expect(stub.cancel).toHaveBeenCalledTimes(1);
  });

  it("odrzucone cancel() nie wywraca wysyłki", async () => {
    // Domknięcie strumienia to higiena połączenia, nie warunek dostarczenia:
    // gdyby wyjątek stąd leciał wyżej, dostarczone (201) powiadomienie byłoby
    // raportowane jako błąd i poszłoby ponownie - odbiorca dostałby duplikat.
    const rejecting = vi.fn((): Promise<void> => Promise.reject(new Error("stream już zamknięty")));
    installFetch({ status: 201, cancel: rejecting });

    const result = await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    expect(result.ok).toBe(true);
    expect(rejecting).toHaveBeenCalledTimes(1);
  });

  it("odpowiedź bez ciała (body: null) nie rzuca", async () => {
    installFetch({ status: 201, cancel: null });

    const result = await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    expect(result.ok).toBe(true);
  });

  it("nie zostawia wiszącego timera po powrocie", async () => {
    // `clearTimeout` w `finally`: bez niego KAŻDA wysyłka trzymałaby proces
    // (i pętlę zdarzeń workera) przez 10 s po odpowiedzi, a partia 200 zadań
    // zostawiałaby 200 takich timerów.
    vi.useFakeTimers();
    installFetch({ status: 201 });

    await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("sendWebPush - odczyt nagłówka Retry-After", () => {
  const NOW = Date.UTC(2026, 8, 1, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  async function retryAfterFrom(header?: string): Promise<number | null> {
    installFetch({ status: 429, retryAfter: header });
    const result = await sendWebPush(subscriber().sub, Buffer.from("{}"), VAPID);
    return result.retryAfterSec;
  }

  it("czyta liczbę sekund", async () => {
    expect(await retryAfterFrom("120")).toBe(120);
  });

  it("znosi białe znaki wokół liczby", async () => {
    expect(await retryAfterFrom("  90  ")).toBe(90);
  });

  it('"0" znaczy zero sekund, a nie brak wartości', async () => {
    // Rozróżnienie 0 vs null jest realne: null = „usługa nic nie powiedziała",
    // 0 = „ponów natychmiast". Gdyby 0 wpadło w gałąź daty, wyszłaby data 1970.
    expect(await retryAfterFrom("0")).toBe(0);
  });

  it("wartość ujemna wypada z gałęzi liczbowej i kończy się na 0", async () => {
    // `seconds >= 0` jest fałszem, więc "-5" idzie do `Date.parse`. UWAGA:
    // V8 NIE zwraca tu NaN - "-5" parsuje się jako data 2001-05-01, która jest
    // w przeszłości, więc `Math.max(0, ...)` daje 0. Wynik jest bezpieczny
    // (ponów od razu), ale bierze się z luźnego parsera dat, nie z odrzucenia
    // śmiecia - i to jest tu przypięte, żeby zmiana parsera nie przeszła cicho.
    expect(await retryAfterFrom("-5")).toBe(0);
  });

  it("czyta datę HTTP z przyszłości jako liczbę sekund (RFC 9110 sek. 10.2.3)", async () => {
    expect(await retryAfterFrom(new Date(NOW + 120_000).toUTCString())).toBe(120);
  });

  it("data z przeszłości daje 0, nie liczbę ujemną", async () => {
    // Ujemny backoff wyżej byłby czytany jako „ponów w przeszłości" i mógłby
    // wpaść w pętlę natychmiastowych ponowień usługi, która właśnie prosiła o pauzę.
    expect(await retryAfterFrom(new Date(NOW - 500_000).toUTCString())).toBe(0);
  });

  it("śmieć w nagłówku daje null", async () => {
    expect(await retryAfterFrom("wkrótce")).toBe(null);
  });

  it("brak nagłówka daje null", async () => {
    expect(await retryAfterFrom()).toBe(null);
  });
});

describe("vapidFromEnv", () => {
  const ENV_KEYS = [
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "VITE_VAPID_PUBLIC_KEY",
  ] as const;
  const saved = new Map<string, string | undefined>();
  // Klucze WYŁĄCZNIE z generatora modułu - żadnej wartości z prawdziwego .env.
  const keys = generateVapidKeys();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it("komplet zmiennych daje pełną konfigurację", () => {
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "mailto:ops@example.org";

    expect(vapidFromEnv()).toEqual({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:ops@example.org",
    });
  });

  it("brak klucza prywatnego wyłącza push (null), a nie wywraca ticku", () => {
    // `processPushJobs` rozpoznaje null jako „push nieskonfigurowany" i kończy
    // się `skipped: vapid_not_configured`. Wyjątek zamiast null zabijałby CAŁY
    // tick crona - razem z kolejką e-mail, która z VAPID nie ma nic wspólnego.
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;

    expect(vapidFromEnv()).toBe(null);
  });

  it("brak klucza publicznego przy obecnym prywatnym też daje null", () => {
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;

    expect(vapidFromEnv()).toBe(null);
  });

  it("spada na VITE_VAPID_PUBLIC_KEY, gdy nie ma wariantu serwerowego", () => {
    // Klucz publiczny bywa wystawiony tylko pod nazwą build-time (ta sama para
    // co w PushManager.subscribe) - bez tego fallbacku push milczy przy
    // POPRAWNIE skonfigurowanym froncie.
    process.env.VITE_VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;

    expect(vapidFromEnv()).toEqual({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: "mailto:marketing@neweuropeanstrategies.com",
    });
  });

  it("bez VAPID_SUBJECT bierze domyślny mailto z kodu", () => {
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;

    expect(vapidFromEnv()?.subject).toBe("mailto:marketing@neweuropeanstrategies.com");
  });

  it("puste napisy są traktowane jak brak zmiennej", () => {
    // Pusty sekret w panelu hostingu to najczęstsza forma „zapomniałem wkleić".
    // Gdyby przeszedł, `buildVapidJwt` rzucałby przy pierwszej wysyłce w ticku,
    // zamiast dać czytelne „push pominięty: brak VAPID_*".
    process.env.VAPID_PUBLIC_KEY = "";
    process.env.VAPID_PRIVATE_KEY = "";
    process.env.VAPID_SUBJECT = "";

    expect(vapidFromEnv()).toBe(null);
  });

  it("pusty VAPID_SUBJECT spada na domyślny mailto", () => {
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = "";

    expect(vapidFromEnv()?.subject).toBe("mailto:marketing@neweuropeanstrategies.com");
  });
});
