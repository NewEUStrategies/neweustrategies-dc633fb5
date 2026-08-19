// MIGRACJA TREŚCI WPISÓW DO BLOCKS - warstwa serwerowa
// (`src/lib/posts-migrate.functions.ts`: 0 z 4 funkcji przed tą zmianą).
//
// CZEGO TEN PLIK NIE TESTUJE - świadomie. Samo tłumaczenie HTML/Gutenberga/
// buildera na `BlocksDoc` ma własne testy (`src/lib/blocks/*`), więc
// `migratePostContent` zostaje PRAWDZIWE i nie jest tu asertowane po kształcie
// bloków - tylko po tym, że wynik obu języków trafia do zapisu. Reguł
// egzekwowanych w bazie (RLS na `posts`, rola staff, odebrane prawo SELECT na
// kolumnach ciała) nie testujemy atrapą - to pgTAP w `supabase/tests`.
//
// PIĘĆ RZECZY, KTÓRE MAJĄ TU DOWÓD:
//   1. GRANICA TENANTA NA SERVICE_ROLE. Odczyt idzie `supabaseAdmin` (bo
//      `content_pl`/`content_en`/`builder_data` są odebrane roli
//      `authenticated`), a service_role omija RLS - jawny `.eq("tenant_id")`
//      JEST tu całą granicą. Brak tenanta musi kończyć się wyjątkiem PRZED
//      pierwszym zapytaniem o wpis, nie zapytaniem bez filtra.
//   2. ZAPIS IDZIE KLIENTEM WOŁAJĄCEGO. Gdyby szedł adminem, migracja
//      nadpisywałaby treść z pominięciem RLS.
//   3. IDEMPOTENCJA. Wpis już na `blocks` jest POMIJANY bez zapisu -
//      powtórne uruchomienie migracji nie ma prawa nadpisać treści, którą
//      redaktor zdążył już w nowym edytorze zmienić.
//   4. CICHY FILTR RLS JEST BŁĘDEM. Brak wiersza (obcy tenant / polityka)
//      zgłasza wyjątek, a nie raport „zmigrowano 0, wszystko dobrze".
//   5. PARTIA NIE PRZEWRACA SIĘ NA JEDNYM WIERSZU. Błąd pojedynczego wpisu
//      wraca w raporcie jako `source: "error"`, a pozostałe lecą dalej -
//      inaczej jeden uszkodzony wpis blokowałby migrację całego archiwum.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Validator = (input: unknown) => unknown;
type Handler = (ctx: { data: unknown; context: unknown }) => Promise<unknown>;

interface ServerFnSpec {
  validator?: Validator;
  handler?: Handler;
}

interface ServerFnChain {
  middleware: (middleware: unknown) => ServerFnChain;
  validator: (validator: Validator) => ServerFnChain;
  inputValidator: (validator: Validator) => ServerFnChain;
  handler: (handler: Handler) => ServerFnSpec;
}

// `createServerFn` zastąpiony łańcuchem, który ODDAJE walidator i handler -
// inaczej nie ma jak wywołać server fn w teście jednostkowym. Ten sam wzorzec,
// co w `src/lib/__tests__/revisionsFunctions.test.ts`.
vi.mock("@tanstack/react-start", () => {
  const createServerFn = (): ServerFnChain => {
    const spec: ServerFnSpec = {};
    const chain: ServerFnChain = {
      middleware: () => chain,
      validator: (validator) => {
        spec.validator = validator;
        return chain;
      },
      inputValidator: (validator) => {
        spec.validator = validator;
        return chain;
      },
      handler: (handler) => {
        spec.handler = handler;
        return spec;
      },
    };
    return chain;
  };
  return { createServerFn, createMiddleware: () => ({}) };
});
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));

const server = vi.hoisted(() => ({ admin: null as unknown }));

// Kolumny ciała są odebrane roli `authenticated`, więc kod czyta ŻYWY wiersz
// przez service_role - atrapa musi to odwzorować, bo inaczej test nie zobaczyłby,
// że odczyt idzie INNĄ drogą niż zapis.
vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const admin = supabaseFromStub();
  server.admin = admin;
  return { supabaseAdmin: { from: admin.from } };
});

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabaseChain";
// Import STATYCZNY atrapowanego modułu, choć produkcyjny kod ładuje go leniwie
// w handlerze. Fabryka `vi.mock` jest leniwa: bez tej linijki atrapa nie
// istniałaby jeszcze w chwili, gdy `beforeEach` próbuje ją wyzerować.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const admin = server.admin as SupabaseFromStub;

const POST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_POST_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

interface LegacyRowShape {
  id: string;
  editor: string;
  content_pl: string | null;
  content_en: string | null;
  builder_data: unknown;
}

function legacyRow(overrides: Partial<LegacyRowShape> = {}): LegacyRowShape {
  return {
    id: POST_ID,
    editor: "richtext",
    content_pl: "<p>Polska treść</p>",
    content_en: "<p>English body</p>",
    builder_data: null,
    ...overrides,
  };
}

/** Wszystkie argumenty danego ogniwa łańcucha (`argsOf` oddaje tylko pierwsze). */
function allArgs(chain: RecordedChain | undefined, method: string): unknown[][] {
  return (chain?.calls ?? []).filter((c) => c.method === method).map((c) => [...c.args]);
}

/** Klient „authenticated" - to nim idą ZAPISY (pod RLS wołającego). */
function client(): SupabaseFromStub {
  const db = supabaseFromStub();
  db.setResponse("posts", ok(null));
  return db;
}

async function load(name: string): Promise<ServerFnSpec> {
  const mod = await import("@/lib/posts-migrate.functions");
  return mod[name as keyof typeof mod] as unknown as ServerFnSpec;
}

async function run(name: string, input: unknown, db: SupabaseFromStub) {
  const spec = await load(name);
  const data = spec.validator?.(input);
  // `context` to dokładnie to, co wstrzykuje middleware `requireStaff`:
  // klient pod RLS wołającego plus jego id.
  return spec.handler?.({ data, context: { supabase: { from: db.from }, userId: USER } });
}

/** Profil (rozwiązanie tenanta) czytany jest przez service_role, nie klientem. */
function planTenant(opts: { tenant?: string | null } = {}) {
  const { tenant = TENANT } = opts;
  admin.setResponse("profiles", ok(tenant === null ? {} : { tenant_id: tenant }));
}

beforeEach(() => {
  admin.reset();
  planTenant();
  expect(supabaseAdmin).toBeDefined();
});

// ---------------------------------------------------------------------------
// migratePostToBlocks - jeden wpis
// ---------------------------------------------------------------------------

describe("migratePostToBlocks", () => {
  it("czyta wpis service_role'em Z FILTREM TENANTA, a zapisuje klientem wołającego", async () => {
    // Service_role omija RLS, więc ten jeden `.eq("tenant_id")` jest całą
    // granicą najemcy przy odczycie. Zapis idzie osobnym klientem - inaczej
    // migracja nadpisywałaby treść z pominięciem polityk.
    admin.setResponse("posts", ok(legacyRow()));
    const db = client();

    const result = await run("migratePostToBlocks", { id: POST_ID }, db);

    const read = admin.lastChain("posts");
    expect(allArgs(read, "eq")).toEqual([
      ["id", POST_ID],
      ["tenant_id", TENANT],
    ]);
    expect(read?.has("maybeSingle")).toBe(true);
    // Zapis NIE poszedł adminem: jedyny łańcuch admina na `posts` to odczyt.
    expect(admin.chainsFor("posts")).toHaveLength(1);
    expect(db.lastChain("posts")?.has("update")).toBe(true);
    expect(result).toEqual({ id: POST_ID, source: "html", skipped: false });
  });

  it("zapisuje OBA języki i celuje w id odczytanego wiersza", async () => {
    // Zapis bez `.eq("id")` przepisałby całą tabelę; jednojęzyczny zapis
    // zgubiłby drugą wersję wpisu.
    admin.setResponse("posts", ok(legacyRow()));
    const db = client();

    await run("migratePostToBlocks", { id: POST_ID }, db);

    const write = db.lastChain("posts");
    const patch = write?.argsOf("update")?.[0] as {
      editor: string;
      blocks_data: { pl: { blocks: unknown[] }; en: { blocks: unknown[] } };
    };
    expect(patch.editor).toBe("blocks");
    expect(patch.blocks_data.pl.blocks.length).toBeGreaterThan(0);
    expect(patch.blocks_data.en.blocks.length).toBeGreaterThan(0);
    expect(write?.argsOf("eq")).toEqual(["id", POST_ID]);
  });

  it("wpis JUŻ na blocks jest pomijany BEZ zapisu", async () => {
    // Idempotencja: powtórne uruchomienie migracji nie ma prawa nadpisać
    // treści, którą redaktor zdążył zmienić już w nowym edytorze.
    admin.setResponse("posts", ok(legacyRow({ editor: "blocks" })));
    const db = client();

    const result = await run("migratePostToBlocks", { id: POST_ID }, db);

    expect(result).toEqual({ id: POST_ID, source: "blocks", skipped: true });
    expect(db.chainsFor("posts")).toHaveLength(0);
  });

  it("BRAK TENANTA w profilu rzuca PRZED zapytaniem o wpis", async () => {
    // Fail-closed. Gdyby kod poleciał dalej, zapytanie service_role bez
    // `tenant_id` zobaczyłoby wpisy WSZYSTKICH najemców.
    planTenant({ tenant: null });
    const db = client();

    await expect(run("migratePostToBlocks", { id: POST_ID }, db)).rejects.toThrow(
      "No tenant for current user",
    );
    expect(admin.chainsFor("posts")).toHaveLength(0);
  });

  it("błąd odczytu wiersza wraca jako wyjątek z komunikatem bazy", async () => {
    admin.setResponse("posts", fail("column content_pl does not exist"));
    const db = client();

    await expect(run("migratePostToBlocks", { id: POST_ID }, db)).rejects.toThrow(
      "column content_pl does not exist",
    );
    expect(db.chainsFor("posts")).toHaveLength(0);
  });

  it("BRAK WIERSZA (obcy tenant / polityka) to BŁĄD, nie cichy sukces", async () => {
    // Cichy filtr RLS oddaje `data: null` bez `error`. Raport „zmigrowano"
    // na takim wyniku kłamałby o stanie treści.
    admin.setResponse("posts", ok(null));
    const db = client();

    await expect(run("migratePostToBlocks", { id: POST_ID }, db)).rejects.toThrow(
      "Post not found or access denied",
    );
    expect(db.chainsFor("posts")).toHaveLength(0);
  });

  it("nieudany ZAPIS wraca jako wyjątek, nie jako zmigrowany wpis", async () => {
    admin.setResponse("posts", ok(legacyRow()));
    const db = supabaseFromStub();
    db.setResponse("posts", fail("new row violates row-level security policy"));

    await expect(run("migratePostToBlocks", { id: POST_ID }, db)).rejects.toThrow(
      "new row violates row-level security policy",
    );
  });

  it("walidator odrzuca id, które nie jest UUID", async () => {
    // Bez tego dowolny string wjechałby w zapytanie jako filtr `id`.
    const spec = await load("migratePostToBlocks");
    expect(() => spec.validator?.({ id: "moj-wpis" })).toThrow();
    expect(() => spec.validator?.({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// bulkMigratePostsToBlocks - partia
// ---------------------------------------------------------------------------

describe("bulkMigratePostsToBlocks", () => {
  it("bierze TYLKO wpisy tenanta, nie na blocks i nie w koszu, z limitem partii", async () => {
    // Cztery filtry naraz: bez `neq(editor, blocks)` partia nadpisywałaby
    // treści już zmigrowane, bez `is(deleted_at, null)` wskrzeszałaby wpisy
    // z kosza, bez limitu jedno wywołanie mogłoby zająć całą bazę.
    admin.setResponse("posts", ok([]));
    const db = client();

    await run("bulkMigratePostsToBlocks", {}, db);

    const list = admin.lastChain("posts");
    expect(allArgs(list, "eq")).toEqual([["tenant_id", TENANT]]);
    expect(list?.argsOf("neq")).toEqual(["editor", "blocks"]);
    expect(list?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(list?.argsOf("limit")).toEqual([500]);
    expect(list?.has("in")).toBe(false);
  });

  it("podane `ids` zawężają partię, PUSTA lista nie zawęża jej do zera", async () => {
    // `.in("id", [])` nie zwróciłoby ani jednego wiersza - „migruj wszystko"
    // wywołane z pustą listą wyglądałoby wtedy na bazę bez zaległości.
    admin.setResponse("posts", ok([]));

    await run("bulkMigratePostsToBlocks", { ids: [POST_ID, OTHER_POST_ID] }, client());
    expect(admin.lastChain("posts")?.argsOf("in")).toEqual(["id", [POST_ID, OTHER_POST_ID]]);

    admin.reset();
    planTenant();
    admin.setResponse("posts", ok([]));
    await run("bulkMigratePostsToBlocks", { ids: [] }, client());
    expect(admin.lastChain("posts")?.has("in")).toBe(false);
  });

  it("wywołanie BEZ argumentu przechodzi walidację (migruj wszystko)", async () => {
    // Przycisk „migruj zaległości" woła funkcję bez danych - `parse(undefined)`
    // wysypałby się na wymaganym obiekcie.
    const spec = await load("bulkMigratePostsToBlocks");
    expect(spec.validator?.(undefined)).toEqual({});
  });

  it("walidator ucina partie powyżej 500 identyfikatorów", async () => {
    const spec = await load("bulkMigratePostsToBlocks");
    const tooMany = Array.from({ length: 501 }, () => POST_ID);
    expect(() => spec.validator?.({ ids: tooMany })).toThrow();
  });

  it("JEDEN uszkodzony wpis nie przewraca partii - wraca w raporcie jako błąd", async () => {
    // Bez tej pętli z `try` jeden wpis z zepsutym `builder_data` blokowałby
    // migrację całego archiwum, a redaktor nie dowiedziałby się, KTÓRY to.
    admin.setResponse(
      "posts",
      ok([
        legacyRow({ id: POST_ID }),
        legacyRow({ id: OTHER_POST_ID }),
        legacyRow({ id: POST_ID, editor: "blocks" }),
      ]),
    );
    const db = supabaseFromStub();
    db.setResponse("posts", (chain) =>
      chain.argsOf("eq")?.[1] === OTHER_POST_ID ? fail("zapis odrzucony") : ok(null),
    );

    const result = (await run("bulkMigratePostsToBlocks", {}, db)) as {
      total: number;
      migrated: number;
      results: Array<{ id: string; source: string; skipped: boolean; error?: string }>;
    };

    expect(result.total).toBe(3);
    // Zmigrowany jest tylko pierwszy: drugi padł, trzeci był już na blocks.
    expect(result.migrated).toBe(1);
    expect(result.results[1]).toEqual({
      id: OTHER_POST_ID,
      source: "error",
      skipped: true,
      error: "zapis odrzucony",
    });
    expect(result.results[2].source).toBe("blocks");
  });

  it("rzut NIE będący instancją Error też ma czytelny komunikat w raporcie", async () => {
    // Warstwa transportowa (zerwane połączenie) potrafi rzucić czymkolwiek.
    // Raport partii nie ma prawa pokazać „[object Object]".
    admin.setResponse("posts", ok([legacyRow()]));
    const db = supabaseFromStub();
    db.setResponse("posts", () => {
      throw "socket hang up";
    });

    const result = (await run("bulkMigratePostsToBlocks", {}, db)) as {
      results: Array<{ error?: string }>;
    };

    expect(result.results[0].error).toBe("socket hang up");
  });

  it("błąd LISTY przewraca całe wywołanie - partia bez listy nie ma sensu", async () => {
    admin.setResponse("posts", fail("statement timeout"));

    await expect(run("bulkMigratePostsToBlocks", {}, client())).rejects.toThrow(
      "statement timeout",
    );
  });

  it("brak zaległości daje pusty raport, nie wyjątek", async () => {
    admin.setResponse("posts", ok(null));

    const result = await run("bulkMigratePostsToBlocks", {}, client());

    expect(result).toEqual({ total: 0, migrated: 0, results: [] });
  });
});
