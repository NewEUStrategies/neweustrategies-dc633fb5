// SERWOWANIE ARTEFAKTU `build:smoke` DO POMIARÓW LABORATORYJNYCH.
//
// Wspólna warstwa dla `lighthouse-local.mjs` i `check-document-weight.ts`.
// Uruchamia `.output/server/index.mjs` DOKŁADNIE tak jak
// `playwright.performance.config.ts` (backend fixture przez
// `node --import scripts/performance/replayFetch.mjs`, SUPABASE_URL na
// 127.0.0.1:4199), opcjonalnie z prawdziwym środowiskiem z `.env`
// (NES_PERFORMANCE_FIXTURE=0), i stawia przed nim proxy kompresujące.
//
// DLACZEGO PROXY. Preset `node-server` nie kompresuje odpowiedzi, a produkcja
// (Cloudflare) tak. Bez kompresji symulator sieci Lighthouse'a (Lantern) widzi
// surowe bajty i FCP/LCP są absurdalnie pesymistyczne.
//
// DLACZEGO DOMYŚLNIE HTTPS + HTTP/2 NA JEDNYM ORIGINIE. Zmierzone 2026-10-03:
// produkcja podaje 99 ze 121 żądań przez `h2` z originu dokumentu (w tym obraz
// LCP z `/media`), a dawny harness - `http/1.1` po gołym HTTP, z obrazami
// fixture na OSOBNYM originie `fixture.invalid`. Lantern modeluje te dwa
// przypadki inaczej (`ConnectionPool.js` w @paulirish/trace_engine:
// `minConnections = isH2 ? 1 : CONNECTIONS_PER_ORIGIN` = 6, TLS dokłada
// round-trip na połączenie). Na h1 obraz hero z osobnego originu dostaje
// własne połączenia i NIE kolejkuje się za preloadami JS - czyli harness
// zaniżał dokładnie tę rywalizację o pasmo, która na produkcji robi LCP.
// Tryb `h2` serwuje dokument, zasoby i obrazy fixture z JEDNEGO originu
// `https://fixture.invalid` (Chrome mapuje go na lokalny port przez
// `--host-resolver-rules`), więc obraz LCP jest same-origin jak `/media`.
// Tryb `h1` zostaje wyłącznie dla porównania z pomiarami sprzed tej zmiany.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import {
  createSecureServer,
  type Http2SecureServer,
  type Http2ServerRequest,
  Http2ServerResponse,
} from "node:http2";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  constants as zlibConstants,
  brotliCompressSync,
  createBrotliCompress,
  createGzip,
  gzipSync,
  type BrotliCompress,
  type Gzip,
} from "node:zlib";
import {
  DOCUMENT_FRESH_WINDOW_S,
  documentVariant,
  formatVariant,
  isFullFreshness,
  observeDocument,
  uncachedReason,
  variantMismatch,
  VARIANT_BYTES_TOLERANCE,
  type DocumentObservation,
  type DocumentVariant,
} from "./lighthouseReport.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Korzeń repozytorium, w którym leży TEN skrypt (źródło fixture i obrazów). */
export const HARNESS_ROOT = resolve(HERE, "../..");

/** Host obrazów z `e2e/fixtures/first-visit.json`; w trybie `h2` także host dokumentu. */
export const FIXTURE_HOST = "fixture.invalid";

/** Nagłówek języka czytelnika z Polski. Bez niego Chrome en-US dostaje redirect `/` -> `/en`. */
export const DEFAULT_ACCEPT_LANGUAGE = "pl-PL,pl;q=0.9,en;q=0.5";

/**
 * UA przeglądarki do rozgrzewki. NIE `curl`: isbot() ocenia `curl/x.y` jako bota,
 * a router renderuje botom INNĄ (buforowaną) gałąź i zapisuje ją w cache dokumentu
 * (uzasadnienie w `.github/workflows/lighthouse.yml`, krok rozgrzewki).
 */
export const WARM_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

/** UA gołego `curl` - isbot() = true, router renderuje wariant buforowany (`allReady`). */
export const BOT_USER_AGENT = "curl/8.5.0";

const COMPRESSIBLE =
  /^(text\/|application\/(javascript|json|xml|ld\+json|rss\+xml|manifest\+json)|image\/svg\+xml)/i;

/** Nagłówki zakazane w HTTP/2 (RFC 9113 §8.2.2) - Node rzuca, gdy proxy je przepisze. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
]);

export type Transport = "h1" | "h2";

export interface Stoppable {
  stop(): Promise<void>;
}

/** Wolny port TCP na 127.0.0.1 (system przydziela, my zwalniamy). */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address ? address.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Czeka, aż serwer odpowie czymkolwiek < 500 (np. 200 albo redirect). */
export async function waitForHttp(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "user-agent": WARM_USER_AGENT, "accept-language": DEFAULT_ACCEPT_LANGUAGE },
      });
      await res.arrayBuffer();
      if (res.status < 500) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Serwer ${url} nie odpowiedział w ${timeoutMs} ms (ostatnio: ${lastError})`);
}

/** Minimalny parser `.env` (KEY=VALUE, `#` komentarze, opcjonalne cudzysłowy). */
export function parseDotEnv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

export interface ArtifactOptions {
  /** Katalog z `.output/` (worktree). */
  readonly root: string;
  readonly port: number;
  /** true = backend fixture (domyślnie); false = środowisko z `<root>/.env`. */
  readonly fixture: boolean;
  /** Plik logu serwera; brak = logi idą w próżnię. */
  readonly logFile?: string;
  /** `NES_PERFORMANCE_CASE` dla replayFetch (domyślnie `lighthouse-local`). */
  readonly measurementCase?: string;
  /** Limit czekania na gotowość procesu (start i restart), domyślnie 60 s. */
  readonly readyTimeoutMs?: number;
}

export interface RunningArtifact extends Stoppable {
  readonly port: number;
  readonly origin: string;
  /** Bieżący proces serwera (po `restart()` - nowy). */
  readonly child: ChildProcess;
  /**
   * Restart procesu na TYM SAMYM porcie, z pustym magazynem cache dokumentu
   * (P0.1-FIX, B1): jedyny sposób, żeby wpis znów zasiał pierwszy MISS na
   * zimnym procesie (pełny wariant). Log serwera jest DOPISYWANY (kursory
   * `logCursor` liczą bajty od początku pliku). Front i jego port zostają.
   */
  restart(): Promise<void>;
}

/** Zatrzymanie procesu serwera: SIGTERM, po 3 s SIGKILL. */
function stopChild(child: ChildProcess): Promise<void> {
  return new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    // Timer NIE jest `unref()`: Nitro na SIGTERM czeka na zamknięcie
    // połączeń keep-alive frontu, a proces harnessu bez aktywnych uchwytów
    // kończył się wcześniej i zostawiał serwer-sierotę (zmierzone
    // 2026-10-04: kolejne serie dokładały procesy na porcie i CPU).
    const kill = setTimeout(() => child.kill("SIGKILL"), 3000);
    child.once("exit", () => {
      clearTimeout(kill);
      done();
    });
    child.kill("SIGTERM");
  });
}

/** Uruchamia `.output/server/index.mjs` jak `playwright.performance.config.ts`. */
export async function startArtifact(options: ArtifactOptions): Promise<RunningArtifact> {
  const root = resolve(options.root);
  const entry = join(root, ".output/server/index.mjs");
  if (!existsSync(entry)) {
    throw new Error(`Brak ${entry} - zbuduj artefakt: BUNDLE_INVENTORY=1 bun run build:smoke`);
  }
  const portEnv = {
    PORT: String(options.port),
    HOST: "127.0.0.1",
    NITRO_PORT: String(options.port),
    NITRO_HOST: "127.0.0.1",
  };
  const args: string[] = [];
  let env: NodeJS.ProcessEnv;
  if (options.fixture) {
    // replayFetch z worktree artefaktu, jeśli go ma (A/B mierzy własny fixture
    // każdej strony); w przeciwnym razie z repo harnessu.
    const own = join(root, "scripts/performance/replayFetch.mjs");
    const replay = existsSync(own)
      ? own
      : join(HARNESS_ROOT, "scripts/performance/replayFetch.mjs");
    args.push("--import", replay);
    env = {
      ...process.env,
      ...portEnv,
      SUPABASE_URL: "http://127.0.0.1:4199",
      SUPABASE_PUBLISHABLE_KEY: "performance-fixture",
      SUPABASE_SERVICE_ROLE_KEY: "performance-fixture-admin",
      NES_PERFORMANCE_CASE: options.measurementCase ?? "lighthouse-local",
    };
  } else {
    const envFile = join(root, ".env");
    const fromFile = existsSync(envFile) ? parseDotEnv(readFileSync(envFile, "utf8")) : {};
    env = { ...process.env, ...fromFile, ...portEnv };
  }
  args.push(entry);
  const origin = `http://127.0.0.1:${options.port}`;
  if (options.logFile) mkdirSync(dirname(options.logFile), { recursive: true });

  /**
   * Bieżący proces. Przypisany TUŻ PO `spawn`, przed czekaniem na gotowość
   * (P0.1-FIX, runda 2): `stop()` (także z SIGINT/SIGTERM w trakcie restartu)
   * zawsze trafia w żywy proces, a nie w poprzedni, już zakończony.
   */
  let child: ChildProcess | null = null;
  /** Po `stop()` żaden restart nie uruchamia już nowego procesu. */
  let stopped = false;
  const readyTimeoutMs = options.readyTimeoutMs ?? 60_000;

  /** Start procesu i czekanie na gotowość; `append` = dopisywanie do logu (restart). */
  const launch = async (append: boolean): Promise<void> => {
    if (stopped) throw new Error(`Serwer artefaktu ${root} zatrzymany - bez ponownego startu`);
    let stdio: "ignore" | number = "ignore";
    if (options.logFile) stdio = openSync(options.logFile, append ? "a" : "w");
    const spawned = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: ["ignore", stdio, stdio],
    });
    child = spawned;
    // Dziecko ma własną kopię deskryptora; nasza zamknięta nie przecieka przy restartach.
    if (typeof stdio === "number") closeSync(stdio);
    const exited = new Promise<never>((_, reject) =>
      spawned.once("exit", (code) =>
        reject(new Error(`Serwer artefaktu ${root} zakończył się kodem ${code ?? "?"}`)),
      ),
    );
    exited.catch(() => undefined);
    // Gotowość sprawdzamy na `/robots.txt` (ścieżka z rozszerzeniem omija cache
    // dokumentu), żeby PIERWSZY render mierzonej strony należał do rozgrzewki
    // (`warmDocument`) i to ona wybrała wariant zapisany w cache.
    try {
      await Promise.race([waitForHttp(`${origin}/robots.txt`, readyTimeoutMs), exited]);
    } catch (error) {
      // Proces, który nie wstał w limicie, nie może zostać sierotą na porcie
      // (recenzja: po nieudanym restarcie nowy PID dalej słuchał po stop()).
      await stopChild(spawned);
      throw error;
    }
  };
  const stopCurrent = () => (child ? stopChild(child) : Promise.resolve());

  await launch(false);
  return {
    port: options.port,
    origin,
    get child() {
      if (!child) throw new Error(`Serwer artefaktu ${root} nie został uruchomiony`);
      return child;
    },
    restart: async () => {
      await stopCurrent();
      await launch(true);
    },
    stop: async () => {
      stopped = true;
      await stopCurrent();
    },
  };
}

export interface TlsMaterial {
  readonly key: Buffer;
  readonly cert: Buffer;
}

/**
 * Samopodpisany certyfikat dla `fixture.invalid` i 127.0.0.1, generowany raz
 * przez `openssl` do katalogu tymczasowego (klucz NIGDY nie trafia do repo).
 * Chrome dostaje `--ignore-certificate-errors`.
 */
export function fixtureTls(): TlsMaterial {
  const dir = join(tmpdir(), "nes-lighthouse-tls");
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  if (!existsSync(keyPath) || !existsSync(certPath)) {
    mkdirSync(dir, { recursive: true });
    try {
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          keyPath,
          "-out",
          certPath,
          "-days",
          "365",
          "-subj",
          `/CN=${FIXTURE_HOST}`,
          "-addext",
          `subjectAltName=DNS:${FIXTURE_HOST},IP:127.0.0.1`,
        ],
        { stdio: "ignore" },
      );
    } catch (error) {
      throw new Error(
        `Nie udało się wygenerować certyfikatu TLS (openssl): ${String(error)}. ` +
          "Użyj --transport=h1 albo zainstaluj openssl.",
      );
    }
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

interface FixtureImages {
  readonly jpg: Buffer;
  readonly svg: Buffer;
}

function loadFixtureImages(): FixtureImages {
  return {
    jpg: readFileSync(join(HARNESS_ROOT, "e2e/fixtures/first-visit-cover.jpg")),
    svg: readFileSync(join(HARNESS_ROOT, "e2e/fixtures/first-visit-cover.svg")),
  };
}

/** Ścieżki obrazów fixture (`https://fixture.invalid/cover.jpg|image.svg`). */
const FIXTURE_IMAGE_PATH = /^\/(?:cover\.jpe?g|image\.svg)$/i;

function fixtureImageResponse(
  images: FixtureImages,
  pathname: string,
): { headers: OutgoingHttpHeaders; body: Buffer } {
  const isJpg = /\.jpe?g$/i.test(pathname);
  const body = isJpg ? images.jpg : images.svg;
  return {
    body,
    // Nagłówki jak produkcyjne `/media/*` (immutable, rok).
    headers: {
      "content-type": isJpg ? "image/jpeg" : "image/svg+xml",
      "content-length": String(body.length),
      "cache-control": "public, max-age=31536000, immutable",
      "access-control-allow-origin": "*",
    },
  };
}

type AnyRequest = IncomingMessage | Http2ServerRequest;

/** Wspólny interfejs odpowiedzi HTTP/1.1 i HTTP/2 (API kompatybilności `node:http2`). */
interface ResponseSink {
  writeHead(status: number, headers: OutgoingHttpHeaders): void;
  write(chunk: Buffer): void;
  end(chunk?: Buffer): void;
  onClose(listener: () => void): void;
  ended(): boolean;
}

function sinkOf(res: ServerResponse | Http2ServerResponse): ResponseSink {
  if (res instanceof Http2ServerResponse) {
    return {
      writeHead: (status, headers) => void res.writeHead(status, headers),
      write: (chunk) => void res.write(chunk),
      end: (chunk) => void (chunk ? res.end(chunk) : res.end()),
      onClose: (listener) => void res.on("close", listener),
      ended: () => res.writableEnded,
    };
  }
  return {
    writeHead: (status, headers) => void res.writeHead(status, headers),
    write: (chunk) => void res.write(chunk),
    end: (chunk) => void (chunk ? res.end(chunk) : res.end()),
    onClose: (listener) => void res.on("close", listener),
    ended: () => res.writableEnded,
  };
}

function forwardHeaders(headers: IncomingHttpHeaders, upstreamPort: number): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(":") || HOP_BY_HOP.has(name) || value === undefined) continue;
    out[name] = value;
  }
  // Klucz cache dokumentu to `host::ścieżka` (src/lib/http/documentCache.ts
  // planDocumentCache) - stały Host = rozgrzewka trafia w ten sam wpis co pomiar.
  out["host"] = `127.0.0.1:${upstreamPort}`;
  // Kompresją steruje proxy, nie upstream.
  delete out["accept-encoding"];
  return out;
}

/**
 * Eksperyment „co-jeśli" bez builda: przekształcenie dokumentu HTML i jego
 * nagłówków (np. `Link`) w proxy, zanim dotrze do przeglądarki. Nagłówki wolno
 * mutować. Z transformacją dokument jest buforowany (bez strumieniowania) - HIT
 * z cache i tak wychodzi jednym kawałkiem. Wynik eksperymentu jest HIPOTEZĄ do
 * potwierdzenia zmianą w kodzie i pomiarem A/B artefaktów, nie dowodem.
 */
export type DocumentTransform = (html: string, headers: OutgoingHttpHeaders) => string;

/**
 * Wstrzyknięcie fragmentu HTML zaraz po otwarciu `<head>` BEZ buforowania
 * dokumentu (w przeciwieństwie do `DocumentTransform`): bajty czekają tylko do
 * końca znacznika `<head ...>`, dalej strumień płynie bez zmian. Dzięki temu
 * flaga `__NES_GA_ANY_HOST__` (P0.1 `--third-party fake-gtag`) nie zmienia
 * dostarczania dokumentu - transformacja buforująca dawała stronie B
 * systematycznie inny czas głównego wątku (werdykt M1 #4).
 */
export interface HeadInjector {
  /** Kolejny kawałek odpowiedzi -> bajty do wysłania (może być pusty, gdy czekamy na `<head>`). */
  push(chunk: Buffer): Buffer;
  /** Koniec odpowiedzi: reszta bufora (gdy `<head>` się nie pojawił - bez zmian). */
  flush(): Buffer;
}

const HEAD_OPEN = /<head\b[^>]*>/i;
/** Ile bajtów wolno przetrzymać w poszukiwaniu `<head>`, zanim się poddamy. */
const HEAD_SEARCH_LIMIT = 64 * 1024;

export function createHeadInjector(snippet: string): HeadInjector {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let done = false;
  return {
    push(chunk) {
      if (done) return chunk;
      pending.push(chunk);
      pendingBytes += chunk.length;
      const joined = Buffer.concat(pending);
      const text = joined.toString("latin1");
      const match = HEAD_OPEN.exec(text);
      if (!match && pendingBytes < HEAD_SEARCH_LIMIT) return Buffer.alloc(0);
      done = true;
      pending = [];
      if (!match) return joined;
      const at = match.index + match[0].length;
      return Buffer.concat([
        joined.subarray(0, at),
        Buffer.from(snippet, "utf8"),
        joined.subarray(at),
      ]);
    },
    flush() {
      const rest = Buffer.concat(pending);
      pending = [];
      done = true;
      return rest;
    },
  };
}

/**
 * Odpowiedź dokumentu zarejestrowana przez front (to, co dostała przeglądarka).
 * Wpis powstaje przy nagłówkach; `bytes` (długość body z upstreamu, bez
 * kompresji i przed wstrzyknięciem/transformacją - ta sama miara co
 * rozgrzewka) uzupełnia się na końcu strumienia, do tego czasu null.
 */
export interface FrontDocument extends DocumentObservation {
  readonly path: string;
  readonly at: number;
}

type MutableFrontDocument = { -readonly [K in keyof FrontDocument]: FrontDocument[K] };

interface ProxyOptions {
  readonly transform?: DocumentTransform | null;
  readonly injectHead?: string | null;
  readonly onDocument?: (doc: FrontDocument) => void;
}

function proxyHandler(
  upstreamPort: number,
  images: FixtureImages | null,
  options: ProxyOptions = {},
) {
  const transform = options.transform ?? null;
  return (req: AnyRequest, raw: ServerResponse | Http2ServerResponse): void => {
    const res = sinkOf(raw);
    const url = req.url ?? "/";
    const pathname = url.split("?")[0] ?? "/";
    if (images && FIXTURE_IMAGE_PATH.test(pathname)) {
      const { headers, body } = fixtureImageResponse(images, pathname);
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    const upstream = httpRequest(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: req.method,
        path: url,
        headers: forwardHeaders(req.headers, upstreamPort),
      },
      (ur) => {
        const contentType = String(ur.headers["content-type"] ?? "");
        const isHtml = /^text\/html/i.test(contentType);
        if (isHtml && options.onDocument) {
          const record: MutableFrontDocument = {
            ...observeDocument("front", ur.statusCode ?? 0, ur.headers),
            path: pathname,
            at: Date.now(),
          };
          options.onDocument(record);
          // Odcisk wariantu (B1): długość body z upstreamu, liczona niezależnie od
          // ścieżki niżej (kompresja, wstrzyknięcie, transformacja).
          let bytes = 0;
          ur.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
          });
          ur.on("end", () => {
            record.bytes = bytes;
          });
        }
        const inject = isHtml && options.injectHead ? createHeadInjector(options.injectHead) : null;
        const accept = String(req.headers["accept-encoding"] ?? "");
        const wantBr = /\bbr\b/.test(accept);
        const wantGz = /\bgzip\b/.test(accept);
        const canCompress =
          COMPRESSIBLE.test(contentType) && !ur.headers["content-encoding"] && (wantBr || wantGz);
        const out: OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(ur.headers)) {
          if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
        }
        if (inject) delete out["content-length"];
        if (!canCompress) {
          res.writeHead(ur.statusCode ?? 200, out);
          ur.on("data", (chunk: Buffer) => {
            const bytes = inject ? inject.push(chunk) : chunk;
            if (bytes.length) res.write(bytes);
          });
          ur.on("end", () => {
            const rest = inject?.flush();
            res.end(rest?.length ? rest : undefined);
          });
          return;
        }
        delete out["content-length"];
        if (transform && /^text\/html/i.test(contentType)) {
          const chunks: Buffer[] = [];
          ur.on("data", (chunk: Buffer) => chunks.push(chunk));
          ur.on("end", () => {
            let html = transform(Buffer.concat(chunks).toString("utf8"), out);
            if (options.injectHead)
              html = html.replace(HEAD_OPEN, (m) => `${m}${options.injectHead}`);
            const body = Buffer.from(html, "utf8");
            const encoded = wantBr
              ? brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
              : gzipSync(body, { level: 6 });
            out["content-encoding"] = wantBr ? "br" : "gzip";
            out["vary"] = [out["vary"], "Accept-Encoding"].filter(Boolean).join(", ");
            res.writeHead(ur.statusCode ?? 200, out);
            res.end(encoded);
          });
          return;
        }
        out["content-encoding"] = wantBr ? "br" : "gzip";
        out["vary"] = [out["vary"], "Accept-Encoding"].filter(Boolean).join(", ");
        res.writeHead(ur.statusCode ?? 200, out);
        // Brotli q5 / gzip 6: rząd wielkości kompresji dynamicznej Cloudflare.
        const encoder: BrotliCompress | Gzip = wantBr
          ? createBrotliCompress({ params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } })
          : createGzip({ level: 6 });
        // Dokument SSR jest STRUMIENIEM: bez flush kompresor trzyma powłokę,
        // aż uzbiera blok, i przesuwa obserwowane TTFB/FCP. Cloudflare flushuje.
        const streamed = /^text\/html/i.test(contentType);
        encoder.on("data", (chunk: Buffer) => res.write(chunk));
        encoder.on("end", () => res.end());
        ur.on("data", (chunk: Buffer) => {
          const bytes = inject ? inject.push(chunk) : chunk;
          if (!bytes.length) return;
          encoder.write(bytes);
          if (streamed) encoder.flush();
        });
        ur.on("end", () => {
          const rest = inject?.flush();
          if (rest?.length) encoder.write(rest);
          encoder.end();
        });
      },
    );
    upstream.on("error", (error) => {
      if (res.ended()) return;
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(Buffer.from(`upstream error: ${error.message}`));
    });
    res.onClose(() => upstream.destroy());
    req.on("data", (chunk: Buffer) => upstream.write(chunk));
    req.on("end", () => upstream.end());
  };
}

function listen(
  server: HttpServer | HttpsServer | Http2SecureServer,
  port: number,
): Promise<Stoppable> {
  return new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      done({
        stop: () =>
          new Promise<void>((closed) => {
            server.close(() => closed());
            // Otwarte połączenia keep-alive/h2 nie mogą wstrzymać końca pomiaru.
            if ("closeAllConnections" in server) server.closeAllConnections();
            setTimeout(() => closed(), 1000).unref();
          }),
      }),
    );
  });
}

export interface FrontOptions {
  readonly transport: Transport;
  readonly upstreamPort: number;
  readonly listenPort: number;
  /** Tylko `h1`: port osobnego serwera HTTPS obrazów fixture. */
  readonly imagePort?: number;
  /** Opcjonalne przekształcenie dokumentu (eksperymenty „co-jeśli"). */
  readonly transformHtml?: DocumentTransform;
  /** Fragment wstrzykiwany strumieniowo po `<head>` (np. flaga fałszywego gtag). */
  readonly injectHead?: string;
}

export interface RunningFront extends Stoppable {
  /** URL, który dostaje Lighthouse (bez ścieżki). */
  readonly baseUrl: string;
  /** Flagi Chrome specyficzne dla tego frontu (certyfikat) - BEZ mapowania hostów. */
  readonly chromeFlags: readonly string[];
  /**
   * Reguły `MAP host 127.0.0.1:port` tego frontu. Chrome przyjmuje JEDNĄ flagę
   * `--host-resolver-rules`, więc składa je `hostResolverFlag` razem z regułami
   * innych serwerów (fałszywy Google).
   */
  readonly hostResolverRules: readonly string[];
  readonly transport: Transport;
  /** Odpowiedzi HTML, które przeszły przez front (kolejność przyjścia). */
  documents(): readonly FrontDocument[];
}

/** Jedna flaga `--host-resolver-rules` z reguł wielu serwerów (pusta lista = brak flagi). */
export function hostResolverFlag(rules: readonly string[]): string[] {
  return rules.length ? [`--host-resolver-rules='${rules.join(", ")}'`] : [];
}

/**
 * Front przed artefaktem:
 *  - `h2`: HTTPS + HTTP/2 (z fallbackiem HTTP/1.1) na `https://fixture.invalid`,
 *    obrazy fixture z TEGO SAMEGO originu (parytet z produkcją);
 *  - `h1`: HTTP/1.1 na 127.0.0.1 + osobny HTTPS obrazów (dawny harness).
 */
export async function startFront(options: FrontOptions): Promise<RunningFront> {
  const images = loadFixtureImages();
  const log: FrontDocument[] = [];
  const proxyOptions: ProxyOptions = {
    transform: options.transformHtml ?? null,
    injectHead: options.injectHead ?? null,
    onDocument: (doc) => void log.push(doc),
  };
  const documents = () => log.slice();
  if (options.transport === "h2") {
    const tls = fixtureTls();
    const handler = proxyHandler(options.upstreamPort, images, proxyOptions);
    const server = createSecureServer({ ...tls, allowHTTP1: true }, handler);
    const stoppable = await listen(server, options.listenPort);
    return {
      ...stoppable,
      transport: "h2",
      baseUrl: `https://${FIXTURE_HOST}`,
      chromeFlags: ["--ignore-certificate-errors"],
      hostResolverRules: [`MAP ${FIXTURE_HOST} 127.0.0.1:${options.listenPort}`],
      documents,
    };
  }
  const proxy = await listen(
    createHttpServer(proxyHandler(options.upstreamPort, null, proxyOptions)),
    options.listenPort,
  );
  const imagePort = options.imagePort ?? (await freePort());
  const imageServer = createHttpsServer(fixtureTls(), (req, res) => {
    const pathname = new URL(req.url ?? "/", `https://${FIXTURE_HOST}`).pathname;
    const { headers, body } = fixtureImageResponse(images, pathname);
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  });
  const imageStop = await listen(imageServer, imagePort);
  return {
    transport: "h1",
    baseUrl: `http://127.0.0.1:${options.listenPort}`,
    chromeFlags: ["--ignore-certificate-errors"],
    hostResolverRules: [`MAP ${FIXTURE_HOST} 127.0.0.1:${imagePort}`],
    documents,
    stop: async () => {
      await Promise.all([proxy.stop(), imageStop.stop()]);
    },
  };
}

export interface DocumentResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Buffer;
}

/** Pobiera dokument bezpośrednio z upstreamu (bez kompresji), z UA przeglądarki. */
export async function fetchDocument(
  origin: string,
  path: string,
  acceptLanguage = DEFAULT_ACCEPT_LANGUAGE,
  userAgent = WARM_USER_AGENT,
): Promise<DocumentResponse> {
  const res = await fetch(`${origin}${path}`, {
    redirect: "manual",
    headers: {
      "user-agent": userAgent,
      "accept-language": acceptLanguage,
      "accept-encoding": "identity",
      accept: "text/html,application/xhtml+xml",
    },
  });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Rozgrzewa cache dokumentu (stan ustalony produkcji = HIT): dwa żądania
 * z UA przeglądarki, przerwa 1 s, trzecie zwraca nagłówki do raportu.
 *
 * UWAGA - ZMIERZONE 2026-10-03: klucz cache to `host::ścieżka`, bez rozróżnienia
 * bot/przeglądarka, więc PIERWSZY MISS decyduje o wariancie podawanym potem
 * wszystkim. Pętla gotowości z gołym `curl` (UA bota) w dawnym measure-local.sh
 * zapisywała wariant buforowany (fixture 382 KB, 14 skryptów) i Lighthouse
 * mierzył go zamiast strumieniowego (391 KB, 22 skrypty). Dlatego `waitForHttp`
 * i ta funkcja wysyłają UA przeglądarki; `userAgent` pozwala świadomie
 * zmierzyć wariant bota (`lighthouse-local.mjs --warm-ua bot`). Działa tylko,
 * jeśli rozgrzewka jest PIERWSZYM żądaniem renderującym tę ścieżkę.
 */
export async function warmDocument(
  origin: string,
  path: string,
  acceptLanguage = DEFAULT_ACCEPT_LANGUAGE,
  userAgent = WARM_USER_AGENT,
): Promise<DocumentResponse> {
  await fetchDocument(origin, path, acceptLanguage, userAgent);
  await sleep(1000);
  await fetchDocument(origin, path, acceptLanguage, userAgent);
  return fetchDocument(origin, path, acceptLanguage);
}

export interface RewarmResult {
  /** Odpowiedzi rozgrzewki po kolei (pierwsza = stan wpisu przed przebiegiem). */
  readonly attempts: readonly DocumentObservation[];
  /** Ostatnia odpowiedź; `cache === "HIT"`, jeśli rozgrzewka się udała. */
  readonly final: DocumentObservation;
  /** true = HIT wariantu wzorcowego z zapasem świeżości `minFreshS` (warunek ważności przebiegu). */
  readonly ok: boolean;
  /** Ile sekund czekaliśmy, aż zbyt stary HIT przejdzie w STALE (tryb bez `restore`). */
  readonly waitedForStaleS: number;
  readonly ms: number;
  /** Ile razy przywracaliśmy wariant wzorcowy (`restore`: restart serwera + rozgrzewka). */
  readonly restores: number;
  /** Powód `ok = false` (log i summary.json); null przy `ok`. */
  readonly failure: string | null;
  /** `--allow-uncached` i dokument spoza cache: przebieg idzie bez HIT. */
  readonly uncached: boolean;
}

/** Górny limit świeżości wpisu (s); świeżość konkretnego wpisu = min(s-maxage, limit). */
export { DOCUMENT_FRESH_WINDOW_S };
/**
 * Minimalny zapas świeżości po rozgrzewce: Lighthouse prosi o dokument kilka
 * sekund po starcie Chrome'a (pod obciążeniem do ~10 s). HIT starszy niż
 * świeżość wpisu - zapas przeszedłby w STALE w trakcie przebiegu i uruchomił
 * render SSR.
 */
export const DEFAULT_MIN_FRESH_S = 30;
/** Ile odpowiedzi spoza cache (3xx-5xx, brak `x-nes-cache`, BYPASS) przerywa rozgrzewkę (I3). */
export const MAX_UNCACHED_RESPONSES = 2;
/** Ile razy jedna rozgrzewka może przywracać wariant wzorcowy, zanim się podda. */
export const DEFAULT_MAX_RESTORES = 2;

/**
 * Wpis o świeżości `freshS` ≤ `--min-fresh` nigdy nie da HIT-u z wymaganym
 * zapasem (runda 2). Podpowiedź: zapas = 1/3 świeżości wpisu, co najmniej 1 s.
 */
export function minFreshHint(freshS: number, minFreshS: number): string {
  const suggest = Math.max(1, Math.floor(freshS / 3));
  return (
    `świeżość wpisu ${freshS} s ≤ --min-fresh ${minFreshS} s: żaden HIT nie da zapasu ` +
    `(polityka tej trasy) - obniż zapas, np. --min-fresh ${suggest}`
  );
}

/**
 * Rozgrzewka nie ma szans na HIT (redirect, BYPASS, `no-store`, błąd) - seria
 * jest przerywana z jasnym komunikatem zamiast młócić SSR co 250 ms przez
 * limit czasu (recenzja I3: ~960 renderów na próbę, ok. 2 h na serię).
 */
export class RewarmAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RewarmAbort";
  }
}

export interface RewarmOptions {
  readonly acceptLanguage?: string;
  readonly userAgent?: string;
  readonly minFreshS?: number;
  /** Górny limit świeżości (domyślnie `DOCUMENT_FRESH_WINDOW_S`); zapas liczy się od s-maxage wpisu. */
  readonly freshWindowS?: number;
  readonly timeoutMs?: number;
  /** Wariant wzorcowy serii (B1); HIT innego wariantu nie oddaje sterowania. */
  readonly referenceVariant?: DocumentVariant | null;
  readonly variantToleranceBytes?: number;
  /**
   * Przywrócenie wariantu wzorcowego: restart serwera artefaktu (pusty magazyn)
   * i rozgrzewka. Wołane, gdy wpis ma inny wariant, za mało świeżości albo jest
   * STALE. Czekanie na STALE i rewalidację wzorca NIE przywraca: rewalidacja
   * w tle daje na tym artefakcie wpis ze zdegradowanym chrome'em
   * (`s-maxage=30`; diagnoza w P0.1-FIX.md). Bez `restore` - dawne zachowanie:
   * czekanie na STALE i nowy wpis.
   */
  readonly restore?: () => Promise<void>;
  readonly maxRestores?: number;
  /** `--allow-uncached`: odpowiedź spoza cache kończy rozgrzewkę bez błędu. */
  readonly allowUncached?: boolean;
  /**
   * true (domyślnie) = `MAX_UNCACHED_RESPONSES` odpowiedzi spoza cache rzuca
   * `RewarmAbort` (przerwanie serii). false = rozgrzewka kończy się `ok=false`
   * z tym powodem, a przebieg jest `excluded` i powtarzany. Harness przerywa
   * serię tylko przy rozgrzewce początkowej (`warmReferenceVariant`); w środku
   * serii przerwanie gubiłoby wszystkie ukończone przebiegi (runda 2).
   */
  readonly abortOnUncached?: boolean;
  /** Wstrzykiwany zegar/sen (testy). */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly fetchDocument?: (
    origin: string,
    path: string,
    acceptLanguage: string,
    userAgent: string,
  ) => Promise<{ status: number; headers: Headers; body?: Uint8Array }>;
}

/**
 * Ponowne rozgrzanie PRZED KAŻDYM przebiegiem (werdykt M1 #1, recenzja B1).
 * Rozgrzewka pyta dokument UA wybranego wariantu, aż dostanie HIT wariantu
 * wzorcowego z zapasem świeżości `minFreshS` liczonym od świeżości TEGO wpisu
 * (min(s-maxage, 180 s) - wpis ze zdegradowanym chrome'em żyje świeżo 30 s,
 * nie 180), i dopiero wtedy oddaje sterowanie Lighthouse'owi:
 *   - z `restore` (harness): wpis innego wariantu, bez zapasu albo STALE ->
 *     restart serwera i rozgrzewka od zera (pierwszy MISS na zimnym procesie
 *     zasiewa pełny wariant), najwyżej `maxRestores` razy na przebieg;
 *   - bez `restore`: HIT bez zapasu = czekamy, aż przejdzie w STALE, i
 *     odświeżamy go sami; STALE/MISS = czekamy na zapis nowego wpisu (render
 *     rewalidacji kończy się PRZED HIT-em, więc nie nachodzi na przebieg);
 *     HIT innego wariantu = też czekanie na STALE, najwyżej `maxRestores` razy.
 * Dwie odpowiedzi spoza cache (3xx-5xx, bez `x-nes-cache`, BYPASS) przerywają
 * serię (`RewarmAbort`), chyba że `allowUncached`.
 */
export async function rewarmDocument(
  origin: string,
  path: string,
  options: RewarmOptions = {},
): Promise<RewarmResult> {
  const acceptLanguage = options.acceptLanguage ?? DEFAULT_ACCEPT_LANGUAGE;
  const userAgent = options.userAgent ?? WARM_USER_AGENT;
  const minFreshS = options.minFreshS ?? DEFAULT_MIN_FRESH_S;
  const freshWindowS = options.freshWindowS ?? DOCUMENT_FRESH_WINDOW_S;
  const timeoutMs = options.timeoutMs ?? 240_000;
  const reference = options.referenceVariant ?? null;
  const tolerance = options.variantToleranceBytes ?? VARIANT_BYTES_TOLERANCE;
  const maxRestores = options.maxRestores ?? DEFAULT_MAX_RESTORES;
  const nap = options.sleep ?? sleep;
  const get = options.fetchDocument ?? fetchDocument;
  const started = Date.now();
  const attempts: DocumentObservation[] = [];
  const uncached: string[] = [];
  let waitedForStaleS = 0;
  let restores = 0;
  let variantWaits = 0;
  const finish = (final: DocumentObservation, failure: string | null, isUncached = false) => ({
    attempts,
    final,
    ok: failure === null,
    waitedForStaleS,
    ms: Date.now() - started,
    restores,
    failure,
    uncached: isUncached,
  });
  for (;;) {
    const res = await get(origin, path, acceptLanguage, userAgent);
    const obs = observeDocument("warm", res.status, res.headers, res.body?.byteLength ?? null);
    attempts.push(obs);
    const notCached = uncachedReason(obs);
    if (notCached) {
      if (options.allowUncached) return finish(obs, null, true);
      uncached.push(notCached);
      if (uncached.length >= MAX_UNCACHED_RESPONSES) {
        const what = `${uncached.length} odpowiedzi dokumentu spoza cache (${uncached.join("; ")})`;
        if (options.abortOnUncached === false) return finish(obs, what);
        throw new RewarmAbort(
          `rozgrzewka ${path}: ${what} - ta ścieżka nie da HIT-u (redirect, BYPASS, no-store ` +
            "albo błąd serwera). Zmień --path albo mierz bez cache: --allow-uncached",
        );
      }
      await nap(250);
      continue;
    }
    const fromStore = obs.cache === "HIT" || obs.cache === "STALE";
    const mismatch =
      fromStore && reference ? variantMismatch(reference, documentVariant(obs), tolerance) : null;
    const freshS = Math.min(obs.freshS ?? freshWindowS, freshWindowS);
    const age = obs.ageS ?? 0;
    if (obs.cache === "HIT" && !mismatch && age <= freshS - minFreshS) return finish(obs, null);
    // Wpis wzorca żyje świeżo nie dłużej niż wymagany zapas (np. `/live`,
    // s-maxage=30, przy --min-fresh 30): po restarcie i rozgrzewce ma ≥ 1 s,
    // więc żaden restart nie pomoże - powód od razu, z podpowiedzią (runda 2).
    if (obs.cache === "HIT" && !mismatch && options.restore && freshS <= minFreshS)
      return finish(obs, minFreshHint(freshS, minFreshS));
    if (Date.now() - started >= timeoutMs)
      return finish(
        obs,
        mismatch ?? `limit czasu ${Math.round(timeoutMs / 1000)} s (${obs.cache})`,
      );
    if (fromStore && options.restore) {
      if (restores >= maxRestores)
        return finish(obs, mismatch ?? `brak świeżego HIT po ${restores} restartach serwera`);
      restores += 1;
      await options.restore();
      continue;
    }
    if (obs.cache === "HIT") {
      if (mismatch && ++variantWaits > maxRestores) return finish(obs, mismatch);
      // Za mało świeżości (albo inny wariant): czekamy na koniec świeżości TEGO
      // wpisu (+0,5 s), następne żądanie dostanie STALE i wywoła rewalidację,
      // a pętla poczeka na nowy HIT.
      const waitS = Math.max(0.5, freshS - age + 0.5);
      waitedForStaleS += waitS;
      await nap(waitS * 1000);
      continue;
    }
    await nap(attempts.length === 1 ? 500 : 250);
  }
}

export interface ReferenceWarmOptions {
  readonly acceptLanguage?: string;
  readonly userAgent?: string;
  readonly minFreshS?: number;
  readonly allowUncached?: boolean;
  /** Wstrzykiwana rozgrzewka (testy); domyślnie `warmDocument`. */
  readonly warm?: (
    origin: string,
    path: string,
    acceptLanguage: string,
    userAgent: string,
  ) => Promise<DocumentResponse>;
}

export interface ReferenceWarmResult {
  readonly doc: DocumentResponse;
  /** Wariant wzorcowy serii; null = `--allow-uncached` i dokument spoza cache. */
  readonly reference: DocumentVariant | null;
  /** Restarty serwera przy ustalaniu wzorca (0 albo 1). */
  readonly restores: number;
  /** Jak ustalono wzorzec, gdy nie od razu (do logu); null = pierwszy zimny render był pełny. */
  readonly note: string | null;
}

/**
 * Rozgrzewka początkowa = WZORZEC wariantu serii (B1). Proces jest świeżo
 * uruchomiony, więc pierwszy MISS to zimny render; na `/` daje on pełny
 * wariant (`s-maxage=900`). Krótsza świeżość na zimnym procesie ma dwie
 * przyczyny i JEDEN restart je rozróżnia (runda 2):
 *   - przegrany wyścig chrome'u (wariant zdegradowany) - po restarcie pełny;
 *   - własna polityka trasy (`/live`: s-maxage=30, ta sama co degradacja) -
 *     dwa zimne rendery dają ten sam wariant i to on jest wzorcem (dawniej
 *     2 zbędne restarty i fałszywe „to nie jest pełny render").
 * Dokument spoza cache przerywa serię już tutaj (`RewarmAbort`), chyba że
 * `allowUncached`. Wzorzec o świeżości ≤ `minFreshS` też: żadna rozgrzewka
 * nie da mu zapasu, a komunikat podpowiada niższe `--min-fresh`.
 */
export async function warmReferenceVariant(
  artifact: Pick<RunningArtifact, "origin" | "restart">,
  path: string,
  options: ReferenceWarmOptions = {},
): Promise<ReferenceWarmResult> {
  const acceptLanguage = options.acceptLanguage ?? DEFAULT_ACCEPT_LANGUAGE;
  const userAgent = options.userAgent ?? WARM_USER_AGENT;
  const minFreshS = options.minFreshS ?? DEFAULT_MIN_FRESH_S;
  const warm = options.warm ?? warmDocument;
  const take = async () => {
    const doc = await warm(artifact.origin, path, acceptLanguage, userAgent);
    return { doc, obs: observeDocument("warm", doc.status, doc.headers, doc.body.byteLength) };
  };
  /** true = dokument spoza cache przy `allowUncached`; bez niego - przerwanie serii. */
  const uncached = (obs: DocumentObservation, stage: string): boolean => {
    const why = uncachedReason(obs);
    if (!why) return false;
    if (options.allowUncached) return true;
    throw new RewarmAbort(
      `rozgrzewka początkowa ${path}${stage}: dokument spoza cache (${why}) - ta ścieżka ` +
        "nie da HIT-u (redirect, BYPASS, no-store albo błąd). Zmień --path albo --allow-uncached",
    );
  };
  let { doc, obs } = await take();
  if (uncached(obs, "")) return { doc, reference: null, restores: 0, note: null };
  let restores = 0;
  let note: string | null = null;
  if (!isFullFreshness(obs)) {
    const first = documentVariant(obs);
    await artifact.restart();
    restores = 1;
    ({ doc, obs } = await take());
    if (uncached(obs, " po restarcie")) return { doc, reference: null, restores, note: null };
    const second = documentVariant(obs);
    if (isFullFreshness(obs))
      note = `zimny render ${formatVariant(first)} bez pełnej świeżości, po restarcie pełny`;
    else if (!variantMismatch(first, second))
      note = `polityka trasy ${formatVariant(second)}: 2 zimne rendery zgodne, wzorcem jest ten wariant`;
    else
      note =
        `UWAGA: zimne rendery różnią się (${formatVariant(first)}; ${formatVariant(second)}) ` +
        "- wzorcem jest ostatni";
  }
  if (obs.freshS !== null && obs.freshS <= minFreshS)
    throw new RewarmAbort(
      `wzorzec ${path}${note ? ` (${note})` : ""}: ${minFreshHint(obs.freshS, minFreshS)}`,
    );
  return { doc, reference: documentVariant(obs), restores, note };
}

/**
 * Ścieżki zasobów pierwszej strony z dokumentu: `<script src>`,
 * `<link rel=stylesheet|modulepreload>` i `<link rel=preload>` skryptów,
 * stylów i fontów. Tylko ścieżki originu (`/assets/…`); obrazy fixture
 * (`https://fixture.invalid/…`) serwuje front, nie proces serwera.
 */
export function documentAssetPaths(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const m of tag[0].matchAll(/([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g))
      attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    let url: string | undefined;
    if (tag[1].toLowerCase() === "script") url = attrs.get("src");
    else {
      const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
      const as = (attrs.get("as") ?? "").toLowerCase();
      const wanted =
        rel.includes("stylesheet") ||
        rel.includes("modulepreload") ||
        (rel.includes("preload") && ["script", "style", "font"].includes(as));
      if (wanted) url = attrs.get("href");
    }
    if (url && url.startsWith("/") && !url.startsWith("//")) out.add(url);
  }
  return [...out];
}

/**
 * Po restarcie serwera (`restore`) rozgrzewka dokumentu robi jeden render, ale
 * zasoby statyczne nowego procesu są zimne (JIT ścieżki serwowania plików).
 * Jedno pobranie każdego zasobu z dokumentu, z upstreamu, przed Lighthouse'em
 * (recenzja P0.1-FIX, runda 2). Błędy pojedynczych zasobów nie przerywają.
 */
export async function warmAssets(
  origin: string,
  html: string,
  get: (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }> = (url) =>
    fetch(url, { headers: { "user-agent": WARM_USER_AGENT } }),
): Promise<{ readonly count: number; readonly failed: number; readonly bytes: number }> {
  let count = 0;
  let failed = 0;
  let bytes = 0;
  for (const path of documentAssetPaths(html)) {
    try {
      const res = await get(`${origin}${path}`);
      bytes += (await res.arrayBuffer()).byteLength;
      if (res.ok) count += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { count, failed, bytes };
}

/**
 * Kursor po pliku logu serwera artefaktu: `mark()` przed przebiegiem,
 * `since(mark)` po nim zwraca linie dopisane W TRAKCIE (znacznik rewalidacji
 * `"revalidation":true`, MISS-y). Serwer pisze stdout do pliku synchronicznie.
 */
export interface LogCursor {
  mark(): number;
  since(mark: number): string;
}

export function logCursor(file: string): LogCursor {
  return {
    mark: () => (existsSync(file) ? statSync(file).size : 0),
    since: (mark) => {
      if (!existsSync(file)) return "";
      const size = statSync(file).size;
      if (size <= mark) return "";
      const fd = openSync(file, "r");
      try {
        const buf = Buffer.alloc(size - mark);
        readSync(fd, buf, 0, buf.length, mark);
        return buf.toString("utf8");
      } finally {
        closeSync(fd);
      }
    },
  };
}
