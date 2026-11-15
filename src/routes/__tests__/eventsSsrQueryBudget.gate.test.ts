// BUDŻET ZAPYTAŃ SSR MODUŁU WYDARZEŃ - zapadka (roadmapa ładowania 2026-11-14,
// pozycja B3).
//
// CO TU JEST ZAPISANE. Inwentaryzacja B3 policzyła, ile round-tripów planu anon
// dokłada moduł wydarzeń do zimnego renderu dokumentu (ponad chrome korzenia):
//
//   katalog `/events`                     1  (`events`, lista)
//   strona wydarzenia `/events/<slug>`    2  (`event_page_header` + wiersz
//                                             `events`), RÓWNOLEGLE - jedna fala
//   każda zakładka pod powłoką           +0  (liść czeka na rodzica, nie czyta)
//   moduł wyłączony w ustawieniach        0
//
// To jest podłoga bez migracji: dwa odczyty powłoki czytają ten sam wiersz
// z dwóch stron (funkcja definerowa i tabela pod RLS) i scali je dopiero wspólne
// RPC. Liczby stoją tu jako SUFIT, nie jako cel.
//
// PO CO ZAPADKA, SKORO LICZBY SĄ DOBRE. Bo każda z nich rośnie po cichu. Runtime
// Workers ma 6 równoległych połączeń na żądanie, a korzeń zajmuje w pierwszej
// fali 4 (ustawienia, tokeny motywu, dwa menu). Odczyt dopisany do loadera
// powłoki albo liścia nie wydłuża kodu ani nie psuje żadnego testu treści -
// wydłuża kolejkę połączeń o jeden round-trip do eu-west-1 (zmierzone
// 110-360 ms z izolatu w USA) na KAŻDYM zimnym wejściu, pod siedmioma adresami
// naraz, bo powłoka stoi pod wszystkimi zakładkami.
//
// JAK ZMIENIAĆ. W dół - zawsze (wspólne RPC: 2 -> 1). W górę - tylko razem
// z rachunkiem fal i połączeń w opisie zmiany; „dane są potrzebne w HTML-u"
// nie jest rachunkiem.
//
// PRAWDZIWE FABRYKI ZAPYTAŃ, atrapa dopiero na kliencie bazy. Sąsiednie pliki
// (`eventShellLoader.test.ts`, `eventsIndexRoute.test.tsx`) podmieniają cały
// `publicQueries`, więc dowodzą decyzji loadera, ale nie tego, ile razy idzie
// on do bazy ani pod jakim kluczem zostawia wynik. Tutaj klucz w cache'u po
// loaderze jest porównany z kluczem fabryki, którą czyta komponent - rozjazd
// „loader grzeje jedno, render czyta drugie" (wzorzec W4 audytu CWV) nie
// przejdzie.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ts from "typescript";
import type { SupabaseFromStub, SupabaseResult, SupabaseRpcStub } from "@/test/supabase";

const sb = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

const h = vi.hoisted(() => ({
  eventsEnabled: true,
  /** Ile razy loader poszedł po mapę ustawień (bramka modułu). */
  settingsCalls: 0,
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseRpcStub } = await import("@/test/supabase");
  const fromStub = supabaseFromStub();
  const rpcStub = supabaseRpcStub();
  sb.from = fromStub;
  sb.rpc = rpcStub;
  return { supabase: { from: fromStub.from, rpc: rpcStub.rpc } };
});

// Mapa ustawień jest odczytem KORZENIA (ten sam klucz, jeden lot) - bramka
// modułu tylko do niego dołącza, więc nie wchodzi do budżetu modułu wydarzeń.
vi.mock("@/lib/useSiteSetting", () => ({
  siteSettingsQueryOptions: {
    queryKey: ["site_settings_public", "all"],
    queryFn: async () => {
      h.settingsCalls += 1;
      return {};
    },
  },
  resolveSetting: () => ({ events_enabled: h.eventsEnabled }),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => undefined,
  readRouteCacheDirective: () => null,
}));

vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => "https://nes.eu/events/szczyt" }));

import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { ok } from "@/test/supabase";
import { publicEventRow } from "@/test/events/publicEventRow";
import {
  eventPageHeaderQueryOptions,
  publicEventBySlugQueryOptions,
  publicEventsQueryOptions,
} from "@/lib/community/publicQueries";
import { Route as EventShellRoute } from "@/routes/events.$slug";
import { Route as EventsIndexRoute } from "@/routes/events.index";

const SLUG = "szczyt";
const SETTINGS_KEY: QueryKey = ["site_settings_public", "all"];

const db = (): SupabaseFromStub => {
  if (!sb.from) throw new Error("test: atrapa `from` nie została zamontowana");
  return sb.from;
};
const rpc = (): SupabaseRpcStub => {
  if (!sb.rpc) throw new Error("test: atrapa `rpc` nie została zamontowana");
  return sb.rpc;
};

/** Wszystkie round-tripy planu anon wykonane przez loader, w kolejności typów. */
function roundTrips(): string[] {
  return [
    ...rpc().calls.map((call) => `rpc:${call.name}`),
    ...db().chains.map((chain) => `from:${chain.table}`),
  ].sort();
}

/** Klucze, które loader zostawił w cache'u - to one jadą do dehydratacji. */
function cachedKeys(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => JSON.stringify(query.queryKey))
    .sort();
}

const keysOf = (...keys: QueryKey[]): string[] => keys.map((key) => JSON.stringify(key)).sort();

type AnyLoader = (ctx: Record<string, unknown>) => Promise<unknown>;

/** STRAŻNIK, nie rzutowanie - trasa bez loadera ma wywrócić test, nie przejść. */
function loaderOf(route: { options: { loader?: unknown } }): AnyLoader {
  const loader = route.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return (ctx) => Promise.resolve((loader as (ctx: unknown) => unknown)(ctx));
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

async function runShellLoader(queryClient: QueryClient, pathname = `/events/${SLUG}`) {
  return loaderOf(EventShellRoute)({
    context: { queryClient },
    params: { slug: SLUG },
    location: { pathname },
  });
}

/** Obietnica zwalniana z zewnątrz - odczyt „w locie", dopóki test go nie puści. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const HEADER_ROW = {
  id: "e1",
  slug: SLUG,
  title_pl: "Szczyt strategiczny",
  title_en: "Strategic summit",
  description_pl: "Opis po polsku.",
  description_en: null,
  cover_url: "https://cdn.nes.eu/szczyt.jpg",
  published_at: "2026-08-01T10:00:00Z",
};
const EVENT_ROW = publicEventRow({ id: "e1", slug: SLUG });

beforeEach(() => {
  db().reset();
  rpc().reset();
  h.eventsEnabled = true;
  h.settingsCalls = 0;
  h.cacheControl = [];
  // Render SERWEROWY: budżety loaderów liczą się tylko tam (`isSsrRequest`
  // czyta `typeof document` przy każdym wywołaniu), a ta zapadka dotyczy
  // zimnego dokumentu, nie nawigacji SPA.
  vi.stubGlobal("document", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("budżet zapytań SSR: strona wydarzenia `/events/<slug>`", () => {
  it("powłoka wykonuje DOKŁADNIE dwa round-tripy i zostawia dwa klucze treści", async () => {
    rpc().setResponse("event_page_header", ok([HEADER_ROW]));
    db().setResponse("events", ok(EVENT_ROW));
    const queryClient = newQueryClient();

    await runShellLoader(queryClient);

    expect(roundTrips()).toEqual(["from:events", "rpc:event_page_header"]);
    // Bramka modułu dołącza do odczytu korzenia - jeden lot, nie dwa.
    expect(h.settingsCalls).toBe(1);
    // W4: w cache'u stoją DOKŁADNIE klucze, które czytają powłoka i przegląd
    // (`useSuspenseQuery(publicEventBySlugQueryOptions(slug))`,
    // `eventPageHeaderQueryOptions(slug, user?.id ?? "anon")` dla gościa).
    expect(cachedKeys(queryClient)).toEqual(
      keysOf(
        SETTINGS_KEY,
        publicEventBySlugQueryOptions(SLUG).queryKey,
        eventPageHeaderQueryOptions(SLUG, "anon").queryKey,
      ),
    );
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("oba odczyty lecą w JEDNEJ fali - drugi startuje, zanim pierwszy wróci", async () => {
    const headerGate = deferred();
    const eventGate = deferred();
    const started: string[] = [];
    rpc().setResponse("event_page_header", async (): Promise<SupabaseResult> => {
      started.push("header");
      await headerGate.promise;
      return ok([HEADER_ROW]);
    });
    db().setResponse("events", async (): Promise<SupabaseResult> => {
      started.push("event");
      await eventGate.promise;
      return ok(EVENT_ROW);
    });

    const run = runShellLoader(newQueryClient());
    // ŻADEN odczyt jeszcze nie wrócił, a OBA są już w locie. Szeregowe `await`
    // zatrzymałoby się tu na jednym - i kosztowało drugi round-trip w TTFB.
    await vi.waitFor(() => expect([...started].sort()).toEqual(["event", "header"]));

    headerGate.release();
    eventGate.release();
    await run;
    expect(roundTrips()).toEqual(["from:events", "rpc:event_page_header"]);
  });

  it("zakładka pod powłoką kosztuje tyle samo co przegląd", async () => {
    rpc().setResponse("event_page_header", ok([HEADER_ROW]));
    db().setResponse("events", ok(EVENT_ROW));

    await runShellLoader(newQueryClient(), `/events/${SLUG}/agenda`);

    expect(roundTrips()).toEqual(["from:events", "rpc:event_page_header"]);
  });

  it("moduł wyłączony: zero round-tripów i nic w cache'u poza ustawieniami", async () => {
    h.eventsEnabled = false;
    const queryClient = newQueryClient();

    await runShellLoader(queryClient);

    expect(roundTrips()).toEqual([]);
    expect(cachedKeys(queryClient)).toEqual(keysOf(SETTINGS_KEY));
  });
});

describe("budżet zapytań SSR: katalog `/events`", () => {
  it("loader wykonuje DOKŁADNIE jeden round-trip pod kluczem, który czyta lista", async () => {
    db().setResponse("events", ok([EVENT_ROW]));
    const queryClient = newQueryClient();

    await loaderOf(EventsIndexRoute)({ context: { queryClient } });

    expect(roundTrips()).toEqual(["from:events"]);
    expect(h.settingsCalls).toBe(1);
    expect(cachedKeys(queryClient)).toEqual(
      keysOf(SETTINGS_KEY, publicEventsQueryOptions().queryKey),
    );
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("moduł wyłączony: zero round-tripów", async () => {
    h.eventsEnabled = false;

    await loaderOf(EventsIndexRoute)({ context: { queryClient: newQueryClient() } });

    expect(roundTrips()).toEqual([]);
  });
});

// ── LIŚCIE POD POWŁOKĄ ──────────────────────────────────────────────────────
//
// Liść czeka na loader rodzica (`parentMatchPromise`) tylko po projekcję do
// `head()`. Sprawdzamy to na ŹRÓDLE, nie przez import: dziewięć liści wciąga
// całe organizmy zakładek (agenda, katalog uczestników, panel prelegenta),
// a dowód jest strukturalny - loader liścia nie dotyka ani klienta zapytań,
// ani bazy. Parser, nie regex: komentarze w loaderach wymieniają
// `ensureQueryData` z nazwy i regex zgłaszałby je jako odczyty.

const ROUTES_DIR = "src/routes";
/** `events.$slug.<zakładka>.tsx` - bez powłoki i bez tras `events.$slug_.*`. */
const LEAF_FILE = /^events\.\$slug\.[^.]+\.tsx$/;

/** Identyfikatory, przez które loader mógłby pójść do bazy albo do cache'u zapytań. */
const READ_IDENTIFIERS: ReadonlySet<string> = new Set([
  "context",
  "queryClient",
  "ensureQueryData",
  "prefetchQuery",
  "fetchQuery",
  "loadResilient",
  "supabase",
  "fetch",
]);

/** Identyfikatory użyte w ciele właściwości `loader` pliku trasy (`null` = brak loadera). */
function loaderIdentifiers(file: string, source: string): string[] | null {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let loader: ts.Node | null = null;
  const find = (node: ts.Node): void => {
    if (
      loader === null &&
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "loader"
    ) {
      loader = node.initializer;
      return;
    }
    ts.forEachChild(node, find);
  };
  find(sf);
  if (loader === null) return null;
  const names: string[] = [];
  const collect = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.push(node.text);
    ts.forEachChild(node, collect);
  };
  collect(loader);
  return names;
}

describe("budżet zapytań SSR: zakładki pod powłoką wydarzenia", () => {
  const leaves = readdirSync(ROUTES_DIR)
    .filter((name) => LEAF_FILE.test(name))
    .sort();

  it("lista liści jest niepusta i obejmuje przegląd oraz zakładki publiczne", () => {
    // Zabezpieczenie przed pustym dowodem: wzorzec, który nic nie łapie,
    // przepuściłby każdy loader.
    expect(leaves).toEqual(
      expect.arrayContaining([
        "events.$slug.index.tsx",
        "events.$slug.agenda.tsx",
        "events.$slug.speakers.tsx",
        "events.$slug.partners.tsx",
        "events.$slug.participants.tsx",
        "events.$slug.discussions.tsx",
      ]),
    );
    expect(leaves).not.toContain("events.$slug.tsx");
  });

  it("parser widzi odczyty tam, gdzie są - loader powłoki nie jest dla niego pusty", () => {
    // Kontrola pozytywna narzędzia: gdyby parser nie znajdował loadera,
    // przypadek niżej byłby zielony z definicji.
    const shell = loaderIdentifiers(
      "events.$slug.tsx",
      readFileSync(`${ROUTES_DIR}/events.$slug.tsx`, "utf8"),
    );
    expect(shell).not.toBeNull();
    expect(shell).toEqual(expect.arrayContaining(["queryClient", "loadResilient"]));
  });

  it.each(leaves)("%s nie dokłada odczytu do fali powłoki", (file) => {
    const names = loaderIdentifiers(file, readFileSync(`${ROUTES_DIR}/${file}`, "utf8"));
    if (names === null) return; // liść bez loadera - nic nie czyta z definicji
    expect(names.filter((name) => READ_IDENTIFIERS.has(name))).toEqual([]);
  });
});
