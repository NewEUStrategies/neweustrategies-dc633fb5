// @vitest-environment node
//
// ŚRODOWISKO NODE: handler biegnie na serwerze; `Request`/`Response` z Node są
// tymi, które dostaje trasa (konwencja `-related-click.test.ts`).
//
// Redakcyjna synteza mowy: POST /api/tts. Do 2026-10 test sprawdzał wyłącznie
// `normalizeTtsInput` - sam handler (sesja, rola staff, limity, klucz, kontrakt
// z ElevenLabs, mapowanie awarii) nie miał ANI JEDNEGO przypadku, a to on
// decyduje, czy płatna synteza w ogóle ruszy.
//
// Atrapy: klient Supabase (`auth.getUser`, RPC `is_staff`), licznik rate-limit
// i `fetch` do dostawcy - granice sieci. Reguły handlera biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "staff-1" } as { id: string } | null,
  userError: null as { message: string } | null,
  staff: { data: true, error: null } as { data: boolean | null; error: { message: string } | null },
  clients: [] as { authorization: string | undefined }[],
  rpcCalls: [] as string[],
  limits: {} as Record<string, boolean>,
  limitCalls: [] as { scope: string; subjectId: string; max: number; failClosed?: boolean }[],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    _url: string,
    _key: string,
    options: { global: { headers: Record<string, string> } },
  ) => {
    h.clients.push({ authorization: options.global.headers.Authorization });
    return {
      auth: {
        getUser: async () => ({ data: { user: h.user }, error: h.userError }),
      },
      rpc: async (fn: string) => {
        h.rpcCalls.push(fn);
        return h.staff;
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
import { normalizeTtsInput, Route, TTS_UPSTREAM_TIMEOUT_MS } from "./tts";
import {
  DEFAULT_TTS_MODEL_ID,
  DEFAULT_TTS_VOICE_ID,
  TTS_MAX_CHARS,
  TTS_MODELS,
  TTS_VOICES,
} from "@/lib/audio/ttsCanonical";

// Stałe importujemy ze ŹRÓDŁA PRAWDY, a nie przepisujemy do testu. Przepisana
// wartość rozjeżdża się po cichu przy pierwszej zmianie allowlisty - a to jest
// dokładnie ten rodzaj rozjazdu, który ten plik ma wykrywać.
//
// Szukamy pozycji INNEJ niż domyślna, żeby przypadek „przyjmuje wartość
// z allowlisty" nie przechodził przypadkiem przez gałąź wartości domyślnej.
// Wyszukiwaniem, a nie indeksem: indeks wybuchłby, gdyby ktoś legalnie skrócił
// allowlistę do jednej pozycji, i test padłby z powodu, który nie jest defektem.
const GLOS_NIEDOMYSLNY = TTS_VOICES.find((v) => v.id !== DEFAULT_TTS_VOICE_ID)?.id;
const MODEL_NIEDOMYSLNY = TTS_MODELS.find((m) => m.id !== DEFAULT_TTS_MODEL_ID)?.id;

describe("normalizeTtsInput", () => {
  it("odrzuca brak tekstu i tekst złożony z samych spacji", () => {
    expect(normalizeTtsInput({})).toEqual({ ok: false, error: "Missing text" });
    expect(normalizeTtsInput({ text: "   " })).toEqual({ ok: false, error: "Missing text" });
  });

  it("przycina tekst i stosuje kanoniczne wartości domyślne głosu i modelu", () => {
    const r = normalizeTtsInput({ text: "  hello  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.safeText).toBe("hello");
      expect(r.voiceId).toBe(DEFAULT_TTS_VOICE_ID);
      expect(r.model).toBe(DEFAULT_TTS_MODEL_ID);
    }
  });

  it("przyjmuje głos i model z allowlisty kanonicznej inne niż domyślne", () => {
    // Gdyby allowlista miała po jednej pozycji, ten przypadek nie ma czego
    // sprawdzić - i ma to powiedzieć wprost, zamiast paść na `undefined`.
    expect(GLOS_NIEDOMYSLNY, "allowlista głosów ma tylko pozycję domyślną").toBeDefined();
    expect(MODEL_NIEDOMYSLNY, "allowlista modeli ma tylko pozycję domyślną").toBeDefined();
    const r = normalizeTtsInput({
      text: "hi",
      voiceId: GLOS_NIEDOMYSLNY,
      model: MODEL_NIEDOMYSLNY,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.voiceId).toBe(GLOS_NIEDOMYSLNY);
      expect(r.model).toBe(MODEL_NIEDOMYSLNY);
    }
  });

  it("odrzuca głos o niepoprawnym kształcie", () => {
    for (const voiceId of ["short", "has space 1234", "../../secret0000"]) {
      expect(normalizeTtsInput({ text: "hi", voiceId })).toEqual({
        ok: false,
        error: "Invalid voiceId",
      });
    }
  });

  // TO JEST REGRESJA DEFEKTU, NIE KOLEJNY PRZYPADEK BRZEGOWY.
  //
  // Do 2026-09-14 walidacja głosu była regexem `[A-Za-z0-9]{8,40}`, czyli
  // sprawdzeniem KSZTAŁTU. Ten identyfikator ma poprawny kształt i przechodził -
  // mimo że nie jest żadnym z sześciu głosów opłaconych przez platformę.
  // Jeżeli ten test kiedyś zzielenieje na `ok: true`, znaczy to, że walidacja
  // wróciła do sprawdzania kształtu zamiast przynależności.
  it("odrzuca głos o poprawnym kształcie, ale spoza allowlisty", () => {
    const ksztaltOk = "ABCdef123456";
    expect(/^[A-Za-z0-9]{8,40}$/.test(ksztaltOk)).toBe(true);
    expect(TTS_VOICES.some((v) => v.id === ksztaltOk)).toBe(false);
    expect(normalizeTtsInput({ text: "hi", voiceId: ksztaltOk })).toEqual({
      ok: false,
      error: "Invalid voiceId",
    });
  });

  // DRUGA POŁOWA TEJ SAMEJ REGRESJI. Trasa miała własną listę czterech modeli,
  // z czego dwa nie występują w kanonicznej `TTS_MODELS`. Model jest wymiarem
  // KOSZTOWYM, więc każdy z nich był furtką do syntezy w cenniku, którego
  // najemca nigdy nie wybrał.
  it("odrzuca modele z nieistniejącej już lokalnej listy trasy", () => {
    for (const model of ["eleven_monolingual_v1", "eleven_turbo_v2"]) {
      expect(TTS_MODELS.some((m) => m.id === model)).toBe(false);
      expect(normalizeTtsInput({ text: "hi", model })).toEqual({
        ok: false,
        error: "Invalid model",
      });
    }
  });

  it("przycina tekst do kanonicznego limitu znaków", () => {
    const r = normalizeTtsInput({ text: "a".repeat(TTS_MAX_CHARS + 1000) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.safeText.length).toBe(TTS_MAX_CHARS);
  });
});

// ── HANDLER ─────────────────────────────────────────────────────────────────

type FetchArgs = [input: string | URL | Request, init?: RequestInit];
const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]);

const post = (request: Request) => routeServerHandlers(Route).POST({ request });

function ttsRequest(
  body: unknown,
  opts: { authorization?: string | null; raw?: string } = {},
): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const authorization = opts.authorization === undefined ? "Bearer tok-1" : opts.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return new Request("https://example.test/api/tts", {
    method: "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

/** Ciało JSON wysłane do ElevenLabs w ostatnim wywołaniu. */
function upstreamBody(): unknown {
  const body = fetchMock.mock.calls.at(-1)?.[1]?.body;
  if (typeof body !== "string") throw new Error("test: dostawca nie dostał ciała JSON");
  return JSON.parse(body);
}

const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "ELEVENLABS_API_KEY"] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  h.user = { id: "staff-1" };
  h.userError = null;
  h.staff = { data: true, error: null };
  h.clients.length = 0;
  h.rpcCalls.length = 0;
  h.limits = {};
  h.limitCalls.length = 0;
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.SUPABASE_URL = "https://db.example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.ELEVENLABS_API_KEY = "xi-test-key";
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(MP3, { status: 200 }));
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

describe("POST /api/tts - sesja i rola", () => {
  it("bez tokenu daje 401 i nie tworzy klienta bazy", async () => {
    const res = await post(ttsRequest({ text: "hi" }, { authorization: null }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(h.clients).toHaveLength(0);
  });

  it("brak konfiguracji Supabase zamyka bramkę (401)", async () => {
    delete process.env.SUPABASE_URL;
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token odrzucony przez Supabase daje 401, zanim padnie pytanie o rolę", async () => {
    h.user = null;
    h.userError = { message: "invalid JWT" };
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(401);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("konto czytelnika (nie staff) dostaje 403 i nie zużywa limitu ani kwoty", async () => {
    h.staff = { data: false, error: null };
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(h.rpcCalls).toEqual(["is_staff"]);
    expect(h.limitCalls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("awaria RPC roli ODMAWIA (403), a nie przepuszcza", async () => {
    h.staff = { data: null, error: { message: "rpc down" } };
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token wywołującego trafia do klienta, a limit liczy się per JEGO id, fail-closed", async () => {
    await post(ttsRequest({ text: "hi" }, { authorization: "Bearer tok-staff" }));
    expect(h.clients[0]?.authorization).toBe("Bearer tok-staff");
    expect(h.limitCalls.map((c) => [c.scope, c.subjectId, c.failClosed])).toEqual([
      ["tts.minute", "staff-1", true],
      ["tts.hour", "staff-1", true],
    ]);
  });
});

describe("POST /api/tts - limity, klucz i ciało", () => {
  it.each(["tts.minute", "tts.hour"])("odmowa limitu %s daje 429 bez syntezy", async (scope) => {
    h.limits[scope] = false;
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brak klucza ElevenLabs daje 500 bez wywołania dostawcy", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "ELEVENLABS_API_KEY not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nieparsowalny JSON daje 400", async () => {
    const res = await post(ttsRequest(null, { raw: "{tekst" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  // REGRESJA: `null` to poprawny JSON, a `normalizeTtsInput(null)` czytał
  // `body.text` z `null` - handler kończył się nieobsłużonym TypeError.
  it("ciało `null` daje 400, nie nieobsłużony wyjątek", async () => {
    const res = await post(ttsRequest(null, { raw: "null" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([["[]"], ['"tekst"'], ["42"]])(
    "ciało %s (JSON, ale nie obiekt) dostaje ten sam komunikat co zły JSON",
    async (raw) => {
      const res = await post(ttsRequest(null, { raw }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid JSON" });
    },
  );

  it("odrzucenie normalizacji (brak tekstu, obcy głos, obcy model) daje 400 bez syntezy", async () => {
    const missing = await post(ttsRequest({ text: "   " }));
    const voice = await post(ttsRequest({ text: "hi", voiceId: "ABCdef123456" }));
    const model = await post(ttsRequest({ text: "hi", model: "eleven_turbo_v2" }));
    expect(await missing.json()).toEqual({ error: "Missing text" });
    expect(await voice.json()).toEqual({ error: "Invalid voiceId" });
    expect(await model.json()).toEqual({ error: "Invalid model" });
    expect([missing.status, voice.status, model.status]).toEqual([400, 400, 400]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/tts - kontrakt z ElevenLabs", () => {
  it("synteza idzie na głos z allowlisty, z kluczem serwera i przyciętym tekstem", async () => {
    expect(GLOS_NIEDOMYSLNY).toBeDefined();
    await post(
      ttsRequest({
        text: `  ${"a".repeat(TTS_MAX_CHARS + 50)}  `,
        voiceId: GLOS_NIEDOMYSLNY,
        model: MODEL_NIEDOMYSLNY,
      }),
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${GLOS_NIEDOMYSLNY}?output_format=mp3_44100_128`,
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("xi-api-key")).toBe("xi-test-key");
    expect(headers.get("Accept")).toBe("audio/mpeg");
    expect(upstreamBody()).toMatchObject({
      text: "a".repeat(TTS_MAX_CHARS),
      model_id: MODEL_NIEDOMYSLNY,
    });
  });

  it("bez głosu i modelu w ciele synteza używa wartości kanonicznych", async () => {
    await post(ttsRequest({ text: "Dzień dobry" }));
    const [url] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(`/text-to-speech/${DEFAULT_TTS_VOICE_ID}?`);
    expect(upstreamBody()).toMatchObject({ text: "Dzień dobry", model_id: DEFAULT_TTS_MODEL_ID });
  });

  // REGRESJA: `public` to dyrektywa, która pozwala cache'owi współdzielonemu
  // przechować odpowiedź na żądanie z `Authorization` (RFC 9111, 3.5).
  it("oddaje bajty MP3 dostawcy z cache'owaniem PRYWATNYM, nie publicznym", async () => {
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(MP3);
  });
});

describe("POST /api/tts - awarie dostawcy", () => {
  it("błąd ElevenLabs to 502, a jego treść zostaje w logu serwera", async () => {
    const secret = '{"detail":{"status":"invalid_api_key","message":"key xi-test-key"}}';
    fetchMock.mockResolvedValueOnce(new Response(secret, { status: 401 }));
    const res = await post(ttsRequest({ text: "hi" }));
    const body = await res.text();
    expect(res.status).toBe(502);
    expect(body).not.toContain("invalid_api_key");
    expect(JSON.parse(body)).toEqual({ error: "TTS upstream error", status: 401 });
    expect(console.error).toHaveBeenCalledWith("ElevenLabs TTS error", 401, secret);
  });

  // REGRESJA: `await upstream.text()` bez `.catch` - zerwany strumień ciała
  // błędu wychodził z handlera jako wyjątek.
  it("zerwany strumień ciała błędu nie wywraca handlera - nadal 502", async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(broken, { status: 503 }));
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "TTS upstream error", status: 503 });
  });

  // REGRESJA: wyjątek `fetch` (DNS, zerwane TLS) wychodził z handlera.
  it("padnięte połączenie daje 502 z handlera, nie nieobsłużony wyjątek", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await post(ttsRequest({ text: "hi" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "TTS upstream error" });
  });

  // REGRESJA: synteza nie miała terminu - zawieszone połączenie trzymało
  // edytor na spinnerze bez końca.
  it("synteza ma termin, a jego przekroczenie daje 504", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const pending = post(ttsRequest({ text: "hi" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    deadline.abort(new DOMException("The operation timed out.", "TimeoutError"));
    const res = await pending;

    expect(timeout).toHaveBeenCalledWith(TTS_UPSTREAM_TIMEOUT_MS);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(deadline.signal);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "TTS upstream timeout" });
  });
});
