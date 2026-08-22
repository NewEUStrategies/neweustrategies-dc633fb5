// Most zgodności `/lovable/*` -> kanoniczna `/platform/*`.
//
// DLACZEGO TEN PLIK MA TESTY. Tędy chodzi webhook maili autoryzacyjnych
// dostawcy - żądanie, którego NIE MOŻNA powtórzyć ręcznie. Mail już wysłany
// jest w skrzynce na zawsze, a mail nigdy niewysłany jest ciszą, o której nikt
// się nie dowie: użytkownik czeka na link do logowania, dostawca dostał 2xx,
// a w panelu nie ma nawet śladu próby. Cały dowód musi więc powstać PRZED
// wysyłką, na tym moście.
//
// Trzy rzeczy psują się tu nieodwracalnie i każda ma tu swój test:
//  1. najmniejsza zmiana bajtów ciała unieważnia podpis HMAC liczony nad
//     ciałem SUROWYM - webhook odrzuci wtedy każde żądanie ze ścieżki
//     zgodności, choć na kanonicznej to samo żądanie przechodzi,
//  2. przekazanie `content-length` z oryginału rozjeżdża długość deklarowaną
//     z faktycznie wysłaną - żądanie ucina się w połowie ciała,
//  3. awaria połączenia z trasą kanoniczną MUSI dać 502 i wpis w logu.
//     Cicha odpowiedź 2xx powiedziałaby dostawcy „przyjąłem", a dostawca nie
//     ponowi tego, co zostało przyjęte - mail przepada bez śladu.
//
// Zero sieci: `fetch` jest podmieniony w każdym teście.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forwardToPlatformRoute,
  type PlatformCompatTarget,
} from "@/lib/email/platformCompat.server";

/** Sygnatura globalnego `fetch` zawężona do tego, czym woła go ten moduł. */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<FetchLike>>;
let errorSpy: ReturnType<typeof vi.spyOn>;

const WEBHOOK: PlatformCompatTarget = "/platform/email/auth/webhook";

/** Ciało z niełacińskimi znakami - żeby bajt w bajt znaczyło coś więcej niż ASCII. */
const RAW_BODY = '{"type":"auth",  "email":"anna@example.test","note":"zażółć gęślą jaźń ✉"}';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-22T10:00:00.000Z"));
  fetchMock = vi.fn<FetchLike>(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  // Awaria mostu MA zostawiać ślad - spy jednocześnie wycisza raport testów
  // i pozwala udowodnić, że komunikat naprawdę powstaje.
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
  vi.useRealTimers();
});

/** Żądanie wchodzące na ścieżkę zgodności. */
function incoming(
  init: RequestInit = {},
  url = "https://neweuropeanstrategies.com/lovable/email/auth/webhook",
): Request {
  return new Request(url, init);
}

/** Argumenty jedynego wywołania `fetch` - brak wywołania to błąd testu. */
function forwardedCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("test: most nie zawołał trasy kanonicznej");
  return { url: call[0], init: call[1] };
}

/** Nagłówki przekazanego żądania jako `Headers` (inny kształt to błąd testu). */
function forwardedHeaders(): Headers {
  const { init } = forwardedCall();
  const headers = init.headers;
  if (!(headers instanceof Headers)) throw new Error("test: nagłówki nie są obiektem Headers");
  return headers;
}

/** Surowe bajty przekazanego ciała (bez re-serializacji przez test). */
function forwardedBodyBytes(): Uint8Array {
  const { init } = forwardedCall();
  const body = init.body;
  if (!(body instanceof ArrayBuffer)) {
    throw new Error("test: ciało nie zostało przekazane jako surowe bajty");
  }
  return new Uint8Array(body);
}

// ---------------------------------------------------------------------------
// Ciało żądania - warunek ważności podpisu
// ---------------------------------------------------------------------------
describe("ciało żądania", () => {
  it("POST dociera do trasy kanonicznej bajt w bajt - podpis liczony nad surowym ciałem nadal się zgadza", async () => {
    await forwardToPlatformRoute(incoming({ method: "POST", body: RAW_BODY }), WEBHOOK);

    const bytes = forwardedBodyBytes();
    const expected = new TextEncoder().encode(RAW_BODY);
    expect(Array.from(bytes)).toEqual(Array.from(expected));
    expect(new TextDecoder().decode(bytes)).toBe(RAW_BODY);
  });

  it("puste ciało POST-a zostaje puste, a nie znika", async () => {
    await forwardToPlatformRoute(incoming({ method: "POST", body: "" }), WEBHOOK);

    expect(forwardedBodyBytes()).toHaveLength(0);
  });

  it("GET idzie dalej bez ciała - podgląd szablonu nie ma czego przekazywać", async () => {
    await forwardToPlatformRoute(
      incoming({ method: "GET" }, "https://neweuropeanstrategies.com/lovable/email/auth/preview"),
      "/platform/email/auth/preview",
    );

    expect(forwardedCall().init.body).toBeUndefined();
    expect(forwardedCall().init.method).toBe("GET");
  });

  it("HEAD idzie dalej bez ciała", async () => {
    await forwardToPlatformRoute(incoming({ method: "HEAD" }), WEBHOOK);

    expect(forwardedCall().init.body).toBeUndefined();
    expect(forwardedCall().init.method).toBe("HEAD");
  });

  it("metoda żądania jest zachowana - trasa kanoniczna widzi ten sam czasownik", async () => {
    await forwardToPlatformRoute(incoming({ method: "POST", body: RAW_BODY }), WEBHOOK);

    expect(forwardedCall().init.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Nagłówki
// ---------------------------------------------------------------------------
describe("nagłówki", () => {
  it("nagłówki podpisu docierają bez zmian - bez nich webhook odrzuci żądanie jako obce", async () => {
    await forwardToPlatformRoute(
      incoming({
        method: "POST",
        body: RAW_BODY,
        headers: {
          "webhook-id": "msg_123",
          "webhook-timestamp": "1787738400",
          "webhook-signature": "v1,abcdef==",
          "content-type": "application/json",
        },
      }),
      WEBHOOK,
    );

    const headers = forwardedHeaders();
    expect(headers.get("webhook-id")).toBe("msg_123");
    expect(headers.get("webhook-timestamp")).toBe("1787738400");
    expect(headers.get("webhook-signature")).toBe("v1,abcdef==");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("usuwa content-length z oryginału - zadeklarowana długość rozjechana z wysłaną ucina ciało", async () => {
    await forwardToPlatformRoute(
      incoming({
        method: "POST",
        body: RAW_BODY,
        headers: { "content-length": "999", "content-type": "application/json" },
      }),
      WEBHOOK,
    );

    expect(forwardedHeaders().has("content-length")).toBe(false);
  });

  it("oznacza żądanie jako przekazane - inaczej pętla mostu byłaby niewidoczna w logach", async () => {
    await forwardToPlatformRoute(incoming({ method: "POST", body: RAW_BODY }), WEBHOOK);

    expect(forwardedHeaders().get("x-lovable-compat-forward")).toBe("1");
  });

  it("nie rusza nagłówków oryginalnego żądania - most nie może zmienić tego, co podpisano", async () => {
    const request = incoming({
      method: "POST",
      body: RAW_BODY,
      headers: { "webhook-signature": "v1,abcdef==" },
    });

    await forwardToPlatformRoute(request, WEBHOOK);

    expect(request.headers.has("x-lovable-compat-forward")).toBe(false);
    expect(request.headers.get("webhook-signature")).toBe("v1,abcdef==");
  });
});

// ---------------------------------------------------------------------------
// Adres docelowy
// ---------------------------------------------------------------------------
describe("adres docelowy", () => {
  it("podmienia samą ścieżkę - host i parametry zapytania zostają nietknięte", async () => {
    await forwardToPlatformRoute(
      incoming(
        { method: "GET" },
        "https://neweuropeanstrategies.com/lovable/email/transactional/preview?type=payment_failed&lang=en",
      ),
      "/platform/email/transactional/preview",
    );

    const forwarded = new URL(forwardedCall().url);
    expect(forwarded.origin).toBe("https://neweuropeanstrategies.com");
    expect(forwarded.pathname).toBe("/platform/email/transactional/preview");
    expect(forwarded.search).toBe("?type=payment_failed&lang=en");
  });

  it("każda ścieżka z zamkniętej listy trafia pod ten sam host", async () => {
    const targets: PlatformCompatTarget[] = [
      "/platform/email/auth/webhook",
      "/platform/email/auth/preview",
      "/platform/email/transactional/preview",
      "/platform/email/suppression",
      "/platform/email/queue/process",
    ];

    for (const target of targets) {
      await forwardToPlatformRoute(incoming({ method: "POST", body: RAW_BODY }), target);
      expect(forwardedCall().url).toBe(`https://neweuropeanstrategies.com${target}`);
    }

    expect(fetchMock).toHaveBeenCalledTimes(targets.length);
  });

  it("nie podąża za przekierowaniem - odpowiedź 3xx ma zobaczyć dostawca, nie most", async () => {
    await forwardToPlatformRoute(incoming({ method: "POST", body: RAW_BODY }), WEBHOOK);

    expect(forwardedCall().init.redirect).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// Odpowiedź trasy kanonicznej
// ---------------------------------------------------------------------------
describe("odpowiedź trasy kanonicznej", () => {
  it("wraca do dostawcy bez zmian - status, treść i nagłówki są te same", async () => {
    const upstream = new Response('{"queued":true}', {
      status: 202,
      headers: { "content-type": "application/json", "x-run-id": "run-1" },
    });
    fetchMock.mockResolvedValueOnce(upstream);

    const response = await forwardToPlatformRoute(
      incoming({ method: "POST", body: RAW_BODY }),
      WEBHOOK,
    );

    expect(response).toBe(upstream);
    expect(response.status).toBe(202);
    expect(response.headers.get("x-run-id")).toBe("run-1");
    await expect(response.text()).resolves.toBe('{"queued":true}');
  });

  it("odmowa podpisu (401) dociera do dostawcy jako 401, a nie jako sukces mostu", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid signature"}', { status: 401 }));

    const response = await forwardToPlatformRoute(
      incoming({ method: "POST", body: RAW_BODY }),
      WEBHOOK,
    );

    expect(response.status).toBe(401);
    await expect(response.text()).resolves.toContain("invalid signature");
  });

  it("przekierowanie z trasy kanonicznej oddawane jest w całości, z nagłówkiem Location", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "/platform/email/auth/webhook" } }),
    );

    const response = await forwardToPlatformRoute(
      incoming({ method: "POST", body: RAW_BODY }),
      WEBHOOK,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/platform/email/auth/webhook");
  });
});

// ---------------------------------------------------------------------------
// Awaria połączenia
// ---------------------------------------------------------------------------
describe("awaria połączenia z trasą kanoniczną", () => {
  it("wyjątek z fetch kończy się 502 - dostawca ma ponowić, a nie uznać sprawę za załatwioną", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const response = await forwardToPlatformRoute(
      incoming({ method: "POST", body: RAW_BODY }),
      WEBHOOK,
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Upstream unavailable" });
  });

  it("awaria zostawia w logu nazwę ścieżki, na której most się urwał", async () => {
    const boom = new Error("ECONNREFUSED");
    fetchMock.mockRejectedValueOnce(boom);

    await forwardToPlatformRoute(incoming({ method: "POST", body: RAW_BODY }), WEBHOOK);

    expect(errorSpy).toHaveBeenCalledWith("[platform-compat] forward failed", {
      target: WEBHOOK,
      error: boom,
    });
  });

  it("odmowa DNS przy podglądzie też daje 502, a nie pusty ekran", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const response = await forwardToPlatformRoute(
      incoming({ method: "GET" }, "https://neweuropeanstrategies.com/lovable/email/auth/preview"),
      "/platform/email/auth/preview",
    );

    expect(response.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
