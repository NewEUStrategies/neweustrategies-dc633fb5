// @vitest-environment node
//
// ŚRODOWISKO NODE: handler biegnie na serwerze, a `Request`/`FormData`/`File`
// z Node parsują multipart dokładnie tak, jak runtime trasy. happy-dom ma
// własne, przeglądarkowe implementacje - test mierzyłby nie ten parser.
//
// Transkrypcja mowy: POST /api/stt. Trasa stała na ZERZE pokrycia, a jest
// bramką do PŁATNEGO dostawcy (bramka AI, `gpt-4o-mini-transcribe`) dla
// każdego zalogowanego konta - wyszukiwanie głosowe woła ją przy każdym
// nagraniu.
//
// Gwarancje, których pilnuje ten plik:
//   1. KOSZT. Bez sesji, bez klucza, ponad limitem albo z wejściem, które nie
//      jest nagraniem, dostawca NIE jest wołany - mierzymy brak wywołania
//      `fetch`, nie sam kod odpowiedzi.
//   2. PAMIĘĆ. Zadeklarowany rozmiar ponad limit jest odrzucany ZANIM parser
//      multipart zbuforuje ciało (`bodyUsed === false`).
//   3. TYP. Do dostawcy idzie wyłącznie `audio/*` (i kontenery webm/mp4
//      z MediaRecordera); HTML czy PDF dostaje 415.
//   4. AWARIA DOSTAWCY. Zerwane połączenie, przekroczony czas i odpowiedź,
//      która nie jest JSON-em, kończą się kodem 5xx z handlera, a nie
//      nieobsłużonym wyjątkiem. Treść błędu dostawcy zostaje w logu serwera.
//
// Atrapy: klient Supabase (`auth.getUser`), licznik rate-limit i `fetch` do
// dostawcy - granice sieci. Reguły decyzyjne handlera biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  userError: null as { message: string } | null,
  clients: [] as { url: string; key: string; authorization: string | undefined }[],
  limits: {} as Record<string, boolean>,
  limitCalls: [] as { scope: string; subjectId: string; max: number; failClosed?: boolean }[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    url: string,
    key: string,
    options: { global: { headers: Record<string, string> } },
  ) => {
    h.clients.push({ url, key, authorization: options.global.headers.Authorization });
    return {
      auth: {
        getUser: async () => ({ data: { user: h.user }, error: h.userError }),
      },
    };
  },
}));

vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async (input: {
    scope: string;
    subjectId: string;
    max: number;
    failClosed?: boolean;
  }): Promise<boolean> => {
    h.limitCalls.push(input);
    return h.limits[input.scope] ?? true;
  },
}));

import { routeServerHandlers } from "@/test/routeHarness";
import { Route, STT_UPSTREAM_TIMEOUT_MS } from "./stt";

const GATEWAY = "https://ai.gateway.lovable.dev/v1/audio/transcriptions";
const MAX_BYTES = 8 * 1024 * 1024;

type FetchArgs = [input: string | URL | Request, init?: RequestInit];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

const post = (request: Request) => routeServerHandlers(Route).POST({ request });

function audio(bytes = 2048, type = "audio/webm;codecs=opus"): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

interface SttRequestOptions {
  file?: Blob | string | null;
  filename?: string;
  lang?: string;
  authorization?: string | null;
  headers?: Record<string, string>;
}

function sttRequest(opts: SttRequestOptions = {}): Request {
  const fd = new FormData();
  const file = opts.file === undefined ? audio() : opts.file;
  if (typeof file === "string") fd.append("file", file);
  else if (file) fd.append("file", file, opts.filename ?? "voice.webm");
  if (opts.lang !== undefined) fd.append("lang", opts.lang);
  const headers: Record<string, string> = { ...opts.headers };
  const authorization = opts.authorization === undefined ? "Bearer tok-1" : opts.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return new Request("https://example.test/api/stt", { method: "POST", body: fd, headers });
}

/**
 * `Request`, którego `formData()` oddaje GOTOWY zestaw pól. Parser Node zawsze
 * nadaje plikowi nazwę („blob" albo nazwę z nagłówka), więc ścieżki bez nazwy
 * pliku nie da się wywołać przez prawdziwy multipart - a runtime brzegowy
 * potrafi oddać `File` z pustą nazwą. Podklasa, nie rzutowanie: obiekt JEST
 * prawdziwym `Request`, podmieniony jest jeden sposób odczytu ciała.
 */
class PreparsedRequest extends Request {
  readonly #fields: FormData;
  constructor(fields: FormData) {
    super("https://example.test/api/stt", {
      method: "POST",
      headers: { authorization: "Bearer tok-1" },
    });
    this.#fields = fields;
  }
  override formData(): Promise<FormData> {
    return Promise.resolve(this.#fields);
  }
}

/** Ostatnie ciało wysłane do dostawcy - to `FormData`, nie napis. */
function forwarded(): FormData {
  const init = fetchMock.mock.calls.at(-1)?.[1];
  const body = init?.body;
  if (!(body instanceof FormData)) throw new Error("test: dostawca nie dostał FormData");
  return body;
}

function forwardedFile(): File {
  const file = forwarded().get("file");
  if (!(file instanceof File)) throw new Error("test: brak pliku w żądaniu do dostawcy");
  return file;
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "LOVABLE_API_KEY"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  h.user = { id: "user-1" };
  h.userError = null;
  h.clients.length = 0;
  h.limits = {};
  h.limitCalls.length = 0;
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.SUPABASE_URL = "https://db.example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.LOVABLE_API_KEY = "lov-test-key";
  fetchMock.mockReset();
  // Świeża odpowiedź na KAŻDE wywołanie - ciało `Response` da się przeczytać raz.
  fetchMock.mockImplementation(async () => Response.json({ text: "  Ala ma kota \n" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/stt - uwierzytelnienie", () => {
  it("bez nagłówka Authorization daje 401 i nie tworzy nawet klienta bazy", async () => {
    const res = await post(sttRequest({ authorization: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(h.clients).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("schemat inny niż Bearer (np. Basic) jest traktowany jak brak tokenu", async () => {
    const res = await post(sttRequest({ authorization: "Basic dXNlcjpwYXNz" }));
    expect(res.status).toBe(401);
    expect(h.clients).toHaveLength(0);
  });

  it("brak konfiguracji Supabase ZAMYKA bramkę (401), zamiast ją otworzyć", async () => {
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    const res = await post(sttRequest());
    expect(res.status).toBe(401);
    expect(h.limitCalls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token odrzucony przez Supabase daje 401, zanim ruszy licznik limitu", async () => {
    h.user = null;
    h.userError = { message: "JWT expired" };
    const res = await post(sttRequest());
    expect(res.status).toBe(401);
    expect(h.limitCalls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token wywołującego trafia do klienta bazy, a limit liczy się per JEGO id", async () => {
    await post(sttRequest({ authorization: "Bearer  tok-xyz  " }));
    expect(h.clients[0]).toEqual({
      url: "https://db.example.supabase.co",
      key: "sb_publishable_test",
      authorization: "Bearer tok-xyz",
    });
    expect(h.limitCalls.map((c) => [c.scope, c.subjectId, c.failClosed])).toEqual([
      ["stt.minute", "user-1", true],
      ["stt.hour", "user-1", true],
    ]);
  });
});

describe("POST /api/stt - limity i konfiguracja", () => {
  it.each(["stt.minute", "stt.hour"])(
    "odmowa limitu %s daje 429 z Retry-After i NIE woła dostawcy",
    async (scope) => {
      h.limits[scope] = false;
      const res = await post(sttRequest());
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("60");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("brak klucza bramki AI daje 500 bez wywołania dostawcy", async () => {
    delete process.env.LOVABLE_API_KEY;
    const res = await post(sttRequest());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "LOVABLE_API_KEY not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/stt - walidacja nagrania", () => {
  // REGRESJA: limit 8 MB był sprawdzany dopiero na SPARSOWANYM pliku, czyli
  // po tym, jak `formData()` zbuforował całe ciało w pamięci izolatu.
  it("zadeklarowany rozmiar ponad limit daje 413 BEZ parsowania ciała", async () => {
    const request = sttRequest({ headers: { "content-length": String(MAX_BYTES * 2) } });
    const res = await post(request);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Audio too large" });
    expect(request.bodyUsed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deklaracja w granicy limitu (z zapasem na multipart) przechodzi do parsowania", async () => {
    const request = sttRequest({ headers: { "content-length": String(MAX_BYTES + 1024) } });
    const res = await post(request);
    expect(res.status).toBe(200);
    expect(request.bodyUsed).toBe(true);
  });

  it("plik ponad 8 MB bez deklaracji rozmiaru i tak dostaje 413", async () => {
    const res = await post(sttRequest({ file: audio(MAX_BYTES + 1) }));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ciało, które nie jest multipart, daje 400 z nazwą oczekiwanego formatu", async () => {
    const res = await post(
      new Request("https://example.test/api/stt", {
        method: "POST",
        headers: { authorization: "Bearer tok-1", "content-type": "application/json" },
        body: JSON.stringify({ file: "x" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Expected multipart/form-data" });
  });

  it("brak pola `file` albo pole tekstowe zamiast pliku daje 400", async () => {
    const missing = await post(sttRequest({ file: null }));
    const text = await post(sttRequest({ file: "to nie jest nagranie" }));
    expect(missing.status).toBe(400);
    expect(await text.json()).toEqual({ error: "Missing audio file" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puste nagranie daje 400, bez płatnego wywołania", async () => {
    const res = await post(sttRequest({ file: audio(0) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Empty audio" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // REGRESJA: typ pliku nie był sprawdzany wcale - dowolny plik do 8 MB szedł
  // do płatnego dostawcy, a `guessFilename` dokładał mu rozszerzenie `.webm`.
  it.each(["text/html", "application/pdf", "application/octet-stream", ""])(
    "plik typu %j nie jest nagraniem: 415 i dostawca nie jest wołany",
    async (type) => {
      const res = await post(sttRequest({ file: audio(2048, type), filename: "plik.bin" }));
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: "Unsupported audio type" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["audio/webm;codecs=opus", "audio/ogg", "video/webm", "video/mp4"])(
    "nagranie typu %s przechodzi do transkrypcji",
    async (type) => {
      const res = await post(sttRequest({ file: audio(2048, type) }));
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe("POST /api/stt - żądanie do dostawcy", () => {
  it("idzie na bramkę AI z kluczem serwera, modelem i ORYGINALNĄ nazwą pliku", async () => {
    await post(sttRequest({ filename: "voice.mp4", file: audio(4096, "audio/mp4") }));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(GATEWAY);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer lov-test-key");
    expect(forwarded().get("model")).toBe("openai/gpt-4o-mini-transcribe");
    expect(forwardedFile().name).toBe("voice.mp4");
    expect(forwardedFile().size).toBe(4096);
  });

  it("dozwolony język idzie do dostawcy, `auto` i nieznany - nie", async () => {
    const pl = await post(sttRequest({ lang: "pl" }));
    expect(forwarded().get("language")).toBe("pl");
    await post(sttRequest({ lang: "auto" }));
    expect(forwarded().has("language")).toBe(false);
    const unknown = await post(sttRequest({ lang: "de" }));
    expect(forwarded().has("language")).toBe(false);
    expect([pl.status, unknown.status]).toEqual([200, 200]);
  });

  it.each([
    ["audio/mp4", "recording.mp4"],
    ["audio/mpeg", "recording.mp3"],
    ["audio/wav", "recording.wav"],
    ["audio/x-wav", "recording.wav"],
    ["audio/ogg;codecs=opus", "recording.ogg"],
    ["audio/webm", "recording.webm"],
    ["audio/flac", "recording.webm"],
  ])(
    "plik BEZ nazwy typu %s dostaje nazwę %s - dostawca wnioskuje format z rozszerzenia",
    async (type, expected) => {
      const fields = new FormData();
      fields.append("file", new File([new Uint8Array(512)], "", { type }));
      const res = await post(new PreparsedRequest(fields));
      expect(res.status).toBe(200);
      expect(forwardedFile().name).toBe(expected);
    },
  );
});

describe("POST /api/stt - odpowiedź i awarie dostawcy", () => {
  it("oddaje PRZYCIĘTY tekst transkrypcji jako JSON", async () => {
    const res = await post(sttRequest());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(await res.json()).toEqual({ text: "Ala ma kota" });
  });

  // REGRESJA: `{ text: 42 }` wywracało `(data.text ?? "").trim()` poza handler.
  it("odpowiedź bez pola `text` (albo z nie-tekstem) to pusta transkrypcja, nie błąd", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({}));
    const empty = await post(sttRequest());
    fetchMock.mockResolvedValueOnce(Response.json({ text: 42 }));
    const odd = await post(sttRequest());
    expect(await empty.json()).toEqual({ text: "" });
    expect(await odd.json()).toEqual({ text: "" });
  });

  it("402 dostawcy (wyczerpane kredyty) przechodzi jako 402", async () => {
    fetchMock.mockResolvedValueOnce(new Response("payment required", { status: 402 }));
    const res = await post(sttRequest());
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "STT upstream error", status: 402 });
  });

  it("inny błąd dostawcy to 502, a TREŚĆ jego odpowiedzi zostaje w logu serwera", async () => {
    const secret = "invalid_api_key: lov-test-key rejected for org_42";
    fetchMock.mockResolvedValueOnce(new Response(secret, { status: 401 }));
    const res = await post(sttRequest());
    const body = await res.text();
    expect(res.status).toBe(502);
    expect(body).not.toContain("org_42");
    expect(JSON.parse(body)).toEqual({ error: "STT upstream error", status: 401 });
    expect(console.error).toHaveBeenCalledWith("STT upstream error", 401, secret);
  });

  it("zerwany strumień ciała błędu nie wywraca handlera - nadal 502", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(broken, { status: 500 }));
    const res = await post(sttRequest());
    expect(res.status).toBe(502);
    expect(console.error).toHaveBeenCalledWith("STT upstream error", 500, "");
  });

  // REGRESJA: odpowiedź 200, która nie jest JSON-em (strona błędu proxy),
  // rzucała z `res.json()` poza handler.
  it("odpowiedź 200, która nie jest JSON-em, daje 502 zamiast wyjątku", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 200 }));
    const res = await post(sttRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "STT upstream error" });
  });

  // REGRESJA: wyjątek `fetch` (DNS, zerwane TLS) wychodził z handlera.
  it("padnięte połączenie z dostawcą daje 502 z handlera, nie nieobsłużony wyjątek", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await post(sttRequest());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "STT upstream error" });
  });

  // REGRESJA: żądanie do dostawcy nie miało terminu - zawieszona bramka
  // trzymała czytelnika w stanie „transkrybuję" bez końca.
  it("żądanie do dostawcy ma termin, a jego przekroczenie daje 504", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const pending = post(sttRequest());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
    const res = await pending;

    expect(timeout).toHaveBeenCalledWith(STT_UPSTREAM_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(deadline.signal);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "STT upstream timeout" });
  });
});
