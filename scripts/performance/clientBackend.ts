// ŻYWY BACKEND KLIENTA DLA LOKALNEGO LIGHTHOUSE'A (P0.1, `--client-backend fixture`).
//
// PO CO. SSR artefaktu dostaje dane z fixture przez `replayFetch.mjs` (podmiana
// `fetch` w procesie Node), ale przeglądarka woła PostgREST bezpośrednio pod
// `SUPABASE_URL` = http://127.0.0.1:4199 - a tam nikt nie słuchał. Zapytania
// klienta padały natychmiast (EVIDENCE §0-cloud: „count them, do not time them"),
// więc w śladzie NIE było tego, co na produkcji robi TBT po hydratacji:
// odświeżeń react-query z danymi, re-renderów i przepisania arkusza
// `style[data-brand-tokens]` (werdykt H2: martwy backend ukrywa przepisanie
// 26,6 KB arkusza `:root`). Produkcja po hydratacji: 6 zapytań PostgREST +
// 6 preflightów (raport hydration).
//
// JAK. Serwer na 127.0.0.1:4199 odpowiada na `GET/HEAD/POST /rest/v1/*`
// i `/rest/v1/rpc/*` tymi samymi danymi co SSR (`homeFixture.fixtureResponse`),
// z nagłówkami CORS jak PostgREST za bramą Supabase (preflight 200, echo
// `access-control-request-headers`, `content-range`, `content-profile`).
// Ten sam port mówi HTTP i HTTPS (rozpoznanie po pierwszym bajcie: 0x16 =
// ClientHello TLS), bo CSP dokumentu ma `upgrade-insecure-requests`, a
// przeglądarka może podbić `http://127.0.0.1:4199` do https.
// Brakujące tabele/RPC fixture NIE wywracają serwera: odpowiedź 404 jak
// PostgREST (`PGRST205`) i licznik `unrecorded` w statystykach przebiegu.

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, createServer as createNetServer, type Socket } from "node:net";
import { fixtureTls, type Stoppable } from "./artifactServer.ts";
import { fixtureResponse } from "./homeFixture.ts";

/** Port z `SUPABASE_URL` artefaktu fixture (playwright.performance.config.ts, artifactServer.ts). */
export const CLIENT_BACKEND_PORT = 4199;

/** Nagłówki, które PostgREST (przez bramę Supabase) wystawia przeglądarce. */
export const POSTGREST_EXPOSE_HEADERS =
  "Content-Encoding, Content-Location, Content-Range, Content-Type, Date, Location, Server, Transfer-Encoding, Range-Unit";

/** Nagłówki CORS odpowiedzi PostgREST; `requestHeaders` = echo z preflightu. */
export function postgrestCorsHeaders(
  origin: string | undefined,
  requestHeaders?: string,
): Record<string, string> {
  return {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,HEAD,PUT,PATCH,POST,DELETE",
    "access-control-allow-headers":
      requestHeaders ?? "authorization,x-client-info,apikey,content-type,accept-profile",
    "access-control-expose-headers": POSTGREST_EXPOSE_HEADERS,
    vary: "Origin",
  };
}

export interface ClientBackendStats {
  readonly preflight: number;
  readonly requests: number;
  readonly ok: number;
  readonly unrecorded: number;
  readonly errors: number;
  /** `METODA /rest/v1/nazwa` -> liczba (bez query). */
  readonly byPath: Readonly<Record<string, number>>;
  /** Nazwy tabel/RPC, których fixture nie zna (404 PGRST205). */
  readonly unrecordedNames: readonly string[];
}

export function emptyClientBackendStats(): ClientBackendStats {
  return {
    preflight: 0,
    requests: 0,
    ok: 0,
    unrecorded: 0,
    errors: 0,
    byPath: {},
    unrecordedNames: [],
  };
}

/** Różnica statystyk (przebieg = stan po - stan przed). */
export function diffClientBackendStats(
  before: ClientBackendStats,
  after: ClientBackendStats,
): ClientBackendStats {
  const byPath: Record<string, number> = {};
  for (const [key, value] of Object.entries(after.byPath)) {
    const delta = value - (before.byPath[key] ?? 0);
    if (delta) byPath[key] = delta;
  }
  return {
    preflight: after.preflight - before.preflight,
    requests: after.requests - before.requests,
    ok: after.ok - before.ok,
    unrecorded: after.unrecorded - before.unrecorded,
    errors: after.errors - before.errors,
    byPath,
    unrecordedNames: after.unrecordedNames.filter((n) => !before.unrecordedNames.includes(n)),
  };
}

export function formatClientBackendStats(s: ClientBackendStats): string {
  const top = Object.entries(s.byPath)
    .filter(([key]) => !key.startsWith("OPTIONS "))
    .map(([key, n]) => `${key.replace(/^GET \/rest\/v1\//, "")}${n > 1 ? `x${n}` : ""}`)
    .join(",");
  return (
    `backend: ${s.requests} zapytań (${s.ok} ok) + ${s.preflight} preflight` +
    `${s.unrecorded ? `, ${s.unrecorded} bez fixture (${s.unrecordedNames.join(",")})` : ""}` +
    `${s.errors ? `, ${s.errors} błędów` : ""}${top ? ` [${top}]` : ""}`
  );
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "expect",
]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((done, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Odpowiedź błędu w kształcie PostgREST. */
function postgrestError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, details: null, hint: null, message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Jedno żądanie przeglądarki -> odpowiedź PostgREST z danymi fixture.
 * Eksportowane dla testów (bez gniazda): `handleClientBackendRequest(new Request(...))`.
 */
export async function handleClientBackendRequest(
  request: Request,
  options: { readonly delayMs?: number } = {},
): Promise<{ response: Response; kind: "preflight" | "ok" | "unrecorded" | "error" }> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin") ?? undefined;
  const cors = postgrestCorsHeaders(
    origin,
    request.headers.get("access-control-request-headers") ?? undefined,
  );
  const withCors = (res: Response, extra: Record<string, string> = {}): Response => {
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries({ ...cors, ...extra })) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  };
  if (request.method === "OPTIONS") {
    // Brama Supabase odpowiada na preflight 200 z pustym ciałem.
    return { response: withCors(new Response(null, { status: 200 })), kind: "preflight" };
  }
  if (!url.pathname.startsWith("/rest/v1/")) {
    return {
      response: withCors(postgrestError(404, "PGRST125", `Invalid path ${url.pathname}`)),
      kind: "unrecorded",
    };
  }
  try {
    const res = await fixtureResponse(request, { delayMs: options.delayMs ?? 0 });
    const text = request.method === "HEAD" ? "" : await res.text();
    let rows = 0;
    try {
      const parsed: unknown = text ? JSON.parse(text) : null;
      rows = Array.isArray(parsed) ? parsed.length : parsed === null ? 0 : 1;
    } catch {
      rows = 0;
    }
    const range = rows ? `0-${rows - 1}/*` : "*/*";
    return {
      response: withCors(
        new Response(request.method === "HEAD" ? null : text, {
          status: res.status,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
        { "content-range": range, "content-profile": "public" },
      ),
      kind: "ok",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^Unrecorded performance fixture|rejects database writes/.test(message)) {
      return {
        response: withCors(postgrestError(404, "PGRST205", message)),
        kind: "unrecorded",
      };
    }
    return { response: withCors(postgrestError(500, "XX000", message)), kind: "error" };
  }
}

/**
 * Czy ktoś słucha na `host:port` (sonda `connect`, bez wysyłania danych).
 * Tryb `--client-backend none` mierzy MARTWY backend klienta: pozostawiony
 * albo obcy proces na 4199 dałby po cichu żywy backend przy fladze `none`,
 * czyli wynik niezgodny z etykietą flag (recenzja P0.1, D2).
 */
export function isPortListening(
  port: number = CLIENT_BACKEND_PORT,
  host = "127.0.0.1",
  timeoutMs = 1000,
): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (open: boolean) => {
      socket.destroy();
      done(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export interface RunningClientBackend extends Stoppable {
  readonly port: number;
  stats(): ClientBackendStats;
}

/**
 * Startuje backend klienta na 127.0.0.1:`port` (domyślnie 4199). Zajęty port =
 * błąd z jasnym komunikatem (inny harness albo zapomniany proces), nie cichy
 * pomiar bez backendu.
 */
export async function startClientBackend(
  options: { readonly port?: number; readonly delayMs?: number } = {},
): Promise<RunningClientBackend> {
  const port = options.port ?? CLIENT_BACKEND_PORT;
  const delayMs = options.delayMs ?? 40;
  const counters = {
    preflight: 0,
    requests: 0,
    ok: 0,
    unrecorded: 0,
    errors: 0,
    byPath: {} as Record<string, number>,
    unrecordedNames: [] as string[],
  };
  const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
    void (async () => {
      const method = req.method ?? "GET";
      const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        // Nagłówki połączenia nie należą do żądania aplikacyjnego (undici
        // odrzuca np. `connection`/`transfer-encoding` w Request).
        if (HOP_BY_HOP.has(k)) continue;
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const request = new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
        method,
        headers,
        body: body?.length ? new Uint8Array(body) : undefined,
      });
      const { response, kind } = await handleClientBackendRequest(request, { delayMs });
      const path = `${method} ${new URL(request.url).pathname}`;
      counters.byPath[path] = (counters.byPath[path] ?? 0) + 1;
      if (kind === "preflight") counters.preflight += 1;
      else {
        counters.requests += 1;
        if (kind === "ok") counters.ok += 1;
        if (kind === "unrecorded") {
          counters.unrecorded += 1;
          const name = new URL(request.url).pathname.replace(/^\/rest\/v1\//, "");
          if (!counters.unrecordedNames.includes(name)) counters.unrecordedNames.push(name);
        }
        if (kind === "error") counters.errors += 1;
      }
      const out: Record<string, string> = {};
      response.headers.forEach((v, k) => (out[k] = v));
      const payload = Buffer.from(await response.arrayBuffer());
      res.writeHead(response.status, { ...out, "content-length": String(payload.length) });
      res.end(payload);
    })().catch((error: unknown) => {
      counters.errors += 1;
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error));
    });
  };
  const http = createHttpServer(onRequest);
  const https = createHttpsServer(fixtureTls(), onRequest);
  const sockets = new Set<Socket>();
  const front = createNetServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", (chunk: Buffer) => {
      socket.pause();
      socket.unshift(chunk);
      (chunk[0] === 0x16 ? https : http).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
  });
  await new Promise<void>((done, reject) => {
    front.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Port ${port} zajęty - inny harness albo zapomniany proces trzyma backend klienta ` +
                "(sprawdź `ss -ltnp | grep " +
                port +
                "`); --client-backend fixture wymaga wolnego portu z SUPABASE_URL",
            )
          : error,
      ),
    );
    front.listen(port, "127.0.0.1", () => done());
  });
  return {
    port,
    stats: () => ({
      ...counters,
      byPath: { ...counters.byPath },
      unrecordedNames: [...counters.unrecordedNames],
    }),
    stop: () =>
      new Promise<void>((closed) => {
        for (const socket of sockets) socket.destroy();
        front.close(() => closed());
        setTimeout(() => closed(), 1000).unref();
      }),
  };
}
