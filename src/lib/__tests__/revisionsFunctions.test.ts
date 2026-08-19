// ORKIESTRACJA SERWEROWA historii wersji wpisów i stron
// (`src/lib/revisions.functions.ts`: 0 z 13 funkcji przed tą zmianą).
//
// CZEGO TEN PLIK NIE TESTUJE - i to jest świadome. Reguły domenowe rewizji
// (limit 50 wpisów, próg 5 minut między migawkami, zestaw pól przywracalnych)
// są już dowiedzione w `src/lib/content/revisions.test.ts` na 100%. Powtórzenie
// ich tutaj nie dodałoby ani jednej informacji, a dodałoby drugie miejsce do
// aktualizacji przy zmianie reguły. Tu testujemy WYŁĄCZNIE to, co warstwa
// serwerowa robi POZA regułami.
//
// Reguł egzekwowanych w bazie (RLS na `content_revisions`, rola staff,
// odebrane prawo SELECT na kolumnach ciała) NIE testujemy atrapą - to pgTAP
// w `supabase/tests`. Atrapa dowiodłaby tylko, że atrapa działa.
//
// SIEDEM RZECZY, KTÓRE TU MAJĄ DOWÓD:
//   1. rozwiązanie tenanta fail-closed (brak profilu / brak tenant_id / błąd
//      zapytania -> wyjątek, nigdy zapytanie bez filtra tenanta),
//   2. bramka rate limit rzuca WYJĄTKIEM, a nie pomija cicho akcji,
//   3. lista rewizji jest PROJEKCJĄ - `snapshot` nie opuszcza serwera,
//   4. cichy filtr RLS (brak wiersza / zero zaktualizowanych wierszy BEZ błędu)
//      jest zgłaszany jako błąd, a nie raportowany jako sukces,
//   5. migawka bezpieczeństwa `pre_restore` powstaje PRZED nadpisaniem treści,
//   6. patch przywracania NIE zawiera `status` - przywrócenie starej treści nie
//      ma prawa (od)publikować wpisu,
//   7. audyt `revision.restore` idzie dopiero po UDANYM zapisie.
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
// co w `src/lib/__tests__/categoryColorSave.test.ts`.
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

vi.mock("@/lib/server/rate-limit.server", async () => {
  const { vi: v } = await import("vitest");
  return { rateLimit: v.fn(async (_opts: unknown) => true) };
});

vi.mock("@/lib/server/audit.server", async () => {
  const { vi: v } = await import("vitest");
  return { recordAudit: v.fn(async (_client: unknown, _params: unknown) => undefined) };
});

// Kolumny ciała są odebrane roli `authenticated`, więc kod czyta ŻYWY wiersz
// przez service_role (`supabaseAdmin`) - atrapa musi to odwzorować, bo inaczej
// test nie zobaczyłby, że odczyt idzie inną drogą niż zapis.
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
// Importy STATYCZNE atrapowanych modułów, choć produkcyjny kod sięga po nie
// leniwie (`revisions.functions.ts` ładujemy dynamicznie w `load()`, a
// `client.server` ładuje się dopiero w handlerze). Fabryka `vi.mock` jest
// leniwa: bez tych trzech linijek atrapy nie istniałyby jeszcze w chwili,
// gdy `beforeEach` próbuje je wyzerować.
import { rateLimit as rateLimitFn } from "@/lib/server/rate-limit.server";
import { recordAudit as recordAuditFn } from "@/lib/server/audit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const rateLimit = rateLimitFn as unknown as ReturnType<typeof vi.fn>;
const recordAudit = recordAuditFn as unknown as ReturnType<typeof vi.fn>;
const admin = server.admin as SupabaseFromStub;

const POST_ID = "11111111-1111-4111-8111-111111111111";
const REVISION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_REVISION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

/**
 * Klient „authenticated" na wspólnej atrapie PostgREST plus zaplanowany profil
 * (rozwiązanie tenanta). `tenant` = null odwzorowuje użytkownika bez tenanta.
 */
function client(opts: { tenant?: string | null; tenantError?: boolean } = {}) {
  const db = supabaseFromStub();
  const { tenant = TENANT, tenantError = false } = opts;
  db.setResponse(
    "profiles",
    tenantError ? fail("profiles unavailable") : ok(tenant === null ? {} : { tenant_id: tenant }),
  );
  return db;
}

async function load(name: string): Promise<ServerFnSpec> {
  const mod = await import("@/lib/revisions.functions");
  return mod[name as keyof typeof mod] as unknown as ServerFnSpec;
}

async function run(name: string, input: unknown, db: SupabaseFromStub) {
  const spec = await load(name);
  const data = spec.validator?.(input);
  // `context` to dokładnie to, co wstrzykuje middleware `requireStaff`:
  // klient pod RLS wołającego plus jego id.
  return spec.handler?.({ data, context: { supabase: { from: db.from }, userId: USER } });
}

beforeEach(() => {
  admin.reset();
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
  recordAudit.mockReset();
  recordAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Walidatory wejścia (Zod) - pierwsza bramka server fn.
// ---------------------------------------------------------------------------

describe("walidatory wejścia", () => {
  it("listRevisions: limit domyślnie 50, zakres 1..100, entityType tylko post|page", async () => {
    const spec = await load("listRevisions");
    // Domyślny limit jest kontraktem z REVISION_KEEP_LIMIT (50) - lista pokazuje
    // całą przechowywaną historię, nie jej wycinek.
    expect(spec.validator?.({ entityType: "post", entityId: POST_ID })).toEqual({
      entityType: "post",
      entityId: POST_ID,
      limit: 50,
    });
    expect(() => spec.validator?.({ entityType: "post", entityId: POST_ID, limit: 0 })).toThrow();
    expect(() => spec.validator?.({ entityType: "post", entityId: POST_ID, limit: 101 })).toThrow();
    expect(() => spec.validator?.({ entityType: "post", entityId: POST_ID, limit: 1.5 })).toThrow();
    expect(() => spec.validator?.({ entityType: "widget", entityId: POST_ID })).toThrow();
    expect(() => spec.validator?.({ entityType: "post", entityId: "nie-uuid" })).toThrow();
    expect(spec.validator?.({ entityType: "page", entityId: POST_ID, limit: 100 })).toMatchObject({
      entityType: "page",
      limit: 100,
    });
  });

  it("getRevisionSnapshots: najwyżej DWIE rewizje, withCurrent domyślnie false", async () => {
    const spec = await load("getRevisionSnapshots");
    // Górna granica 2 to jedyne, co trzyma ładunek diffa w ryzach - to jedyne
    // zapytanie tego modułu, które w ogóle zwraca pełne migawki.
    expect(() =>
      spec.validator?.({
        entityType: "post",
        entityId: POST_ID,
        ids: [REVISION_ID, OTHER_REVISION_ID, POST_ID],
      }),
    ).toThrow();
    expect(spec.validator?.({ entityType: "post", entityId: POST_ID, ids: [] })).toEqual({
      entityType: "post",
      entityId: POST_ID,
      ids: [],
      withCurrent: false,
    });
    expect(() =>
      spec.validator?.({ entityType: "post", entityId: POST_ID, ids: ["nie-uuid"] }),
    ).toThrow();
  });

  it("restoreRevision: przyjmuje wyłącznie uuid", async () => {
    const spec = await load("restoreRevision");
    expect(spec.validator?.({ id: REVISION_ID })).toEqual({ id: REVISION_ID });
    expect(() => spec.validator?.({ id: "nie-uuid" })).toThrow();
    expect(() => spec.validator?.({})).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Rozwiązanie tenanta - fail-closed.
// ---------------------------------------------------------------------------

describe("rozwiązanie tenanta", () => {
  it("brak tenant_id w profilu przerywa akcję", async () => {
    const db = client({ tenant: null });
    await expect(
      run("listRevisions", { entityType: "post", entityId: POST_ID }, db),
    ).rejects.toThrow("No tenant for current user");
    // Kluczowe: NIE doszło do zapytania o rewizje. Zapytanie bez filtra
    // `tenant_id` pokazałoby historię obcego obszaru roboczego.
    expect(db.chainsFor("content_revisions")).toHaveLength(0);
  });

  it("błąd zapytania o profil też przerywa akcję (nie zakłada braku tenanta)", async () => {
    const db = client({ tenantError: true });
    await expect(
      run("listRevisions", { entityType: "post", entityId: POST_ID }, db),
    ).rejects.toThrow("No tenant for current user");
    expect(db.chainsFor("content_revisions")).toHaveLength(0);
  });

  it("czyta profil po id wołającego, nie po czymkolwiek z wejścia", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([]));
    await run("listRevisions", { entityType: "post", entityId: POST_ID }, db);
    expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["id", USER]);
    expect(db.lastChain("profiles")?.argsOf("select")).toEqual(["tenant_id"]);
  });
});

// ---------------------------------------------------------------------------
// Bramka rate limit.
// ---------------------------------------------------------------------------

describe("bramka rate limit", () => {
  const cases: Array<[string, unknown, string, number]> = [
    ["listRevisions", { entityType: "post", entityId: POST_ID }, "revision.list", 120],
    [
      "getRevisionSnapshots",
      { entityType: "post", entityId: POST_ID, ids: [] },
      "revision.diff",
      60,
    ],
    ["restoreRevision", { id: REVISION_ID }, "revision.restore", 30],
  ];

  it.each(cases)("%s: przekroczenie limitu RZUCA, nie pomija cicho", async (name, input) => {
    rateLimit.mockResolvedValue(false);
    const db = client();
    await expect(run(name, input, db)).rejects.toThrow("Rate limit exceeded");
    // Ciche pominięcie byłoby gorsze niż błąd: redaktor widziałby pustą historię
    // i uznał, że wersje przepadły.
    expect(db.chainsFor("content_revisions")).toHaveLength(0);
    // Tenant nie jest nawet rozwiązywany - bramka stoi PRZED zapytaniami.
    expect(db.chainsFor("profiles")).toHaveLength(0);
  });

  it.each(cases)(
    "%s: woła limiter ze swoim zakresem i pułapem",
    async (name, input, scope, max) => {
      const db = client();
      db.setResponse("content_revisions", ok([]));
      await run(name, input, db).catch(() => undefined);
      expect(rateLimit).toHaveBeenCalledWith({ scope, subjectId: USER, max });
    },
  );
});

// ---------------------------------------------------------------------------
// listRevisions - projekcja zamiast pełnych migawek.
// ---------------------------------------------------------------------------

describe("listRevisions", () => {
  const row = (snapshot: unknown) => ({
    id: REVISION_ID,
    created_at: "2026-08-18T10:00:00.000Z",
    author_id: USER,
    note: "autosave",
    snapshot,
  });

  it("zwraca lekką listę BEZ migawek (kilobajty, nie megabajty)", async () => {
    const db = client();
    db.setResponse(
      "content_revisions",
      ok([
        row({
          title_pl: "Tytuł",
          title_en: "Title",
          status: "draft",
          editor: "blocks",
          // Ciężkie pole: dokument buildera potrafi mieć setki kilobajtów.
          builder_data: { version: 1, sections: [{ big: "x".repeat(1000) }] },
        }),
      ]),
    );

    const list = (await run(
      "listRevisions",
      { entityType: "post", entityId: POST_ID },
      db,
    )) as Array<Record<string, unknown>>;

    expect(list).toEqual([
      {
        id: REVISION_ID,
        created_at: "2026-08-18T10:00:00.000Z",
        author_id: USER,
        note: "autosave",
        title_pl: "Tytuł",
        title_en: "Title",
        status: "draft",
        editor: "blocks",
      },
    ]);
    // To jest cały sens projekcji: `snapshot` nie ma prawa opuścić serwera.
    expect(list[0]).not.toHaveProperty("snapshot");
    expect(list[0]).not.toHaveProperty("builder_data");
  });

  it("pole nie-stringowe w migawce projektuje się na null, nie na surową wartość", async () => {
    const db = client();
    db.setResponse(
      "content_revisions",
      ok([row({ title_pl: 42, title_en: null, status: { a: 1 }, editor: ["blocks"] })]),
    );

    const list = (await run(
      "listRevisions",
      { entityType: "post", entityId: POST_ID },
      db,
    )) as Array<Record<string, unknown>>;

    // Lista renderuje te pola jako tekst - obiekt albo liczba dałyby
    // „[object Object]" w historii wersji.
    expect(list[0]).toMatchObject({
      title_pl: null,
      title_en: null,
      status: null,
      editor: null,
    });
  });

  it("migawka null nie wysypuje projekcji", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([row(null)]));
    const list = (await run(
      "listRevisions",
      { entityType: "post", entityId: POST_ID },
      db,
    )) as Array<Record<string, unknown>>;
    expect(list[0]).toMatchObject({ title_pl: null, title_en: null, status: null, editor: null });
  });

  it("filtruje po tenancie, typie i encji oraz sortuje od najnowszej", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([]));
    await run("listRevisions", { entityType: "page", entityId: POST_ID, limit: 7 }, db);

    const chain = db.lastChain("content_revisions") as RecordedChain;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["tenant_id", TENANT],
      ["entity_type", "page"],
      ["entity_id", POST_ID],
    ]);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain.argsOf("limit")).toEqual([7]);
    // Zapytanie pobiera `snapshot`, ale projekcja go zdejmuje - to świadomy
    // kompromis (JSON-path po stronie PostgREST nie da wszystkich czterech pól
    // jednym selectem), więc test pilnuje, by projekcja została.
    expect(chain.argsOf("select")).toEqual(["id, created_at, author_id, note, snapshot"]);
  });

  it("brak wierszy daje pustą listę, błąd zapytania - wyjątek", async () => {
    const dbEmpty = client();
    dbEmpty.setResponse("content_revisions", { data: null, error: null });
    await expect(
      run("listRevisions", { entityType: "post", entityId: POST_ID }, dbEmpty),
    ).resolves.toEqual([]);

    const dbErr = client();
    dbErr.setResponse("content_revisions", fail("revisions denied"));
    await expect(
      run("listRevisions", { entityType: "post", entityId: POST_ID }, dbErr),
    ).rejects.toThrow("revisions denied");
  });
});

// ---------------------------------------------------------------------------
// getRevisionSnapshots - ładunek ograniczony, cichy filtr RLS jako błąd.
// ---------------------------------------------------------------------------

describe("getRevisionSnapshots", () => {
  const revRow = (id: string) => ({
    id,
    created_at: "2026-08-18T10:00:00.000Z",
    note: null,
    snapshot: { title_pl: "T" },
  });

  it("pusta lista id nie odpytuje tabeli rewizji", async () => {
    const db = client();
    const result = await run(
      "getRevisionSnapshots",
      { entityType: "post", entityId: POST_ID, ids: [] },
      db,
    );
    expect(result).toEqual({ revisions: [], current: null });
    expect(db.chainsFor("content_revisions")).toHaveLength(0);
  });

  it("zwraca migawki rosnąco i filtruje po tenancie oraz encji", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([revRow(REVISION_ID), revRow(OTHER_REVISION_ID)]));

    const result = (await run(
      "getRevisionSnapshots",
      { entityType: "post", entityId: POST_ID, ids: [REVISION_ID, OTHER_REVISION_ID] },
      db,
    )) as { revisions: unknown[] };

    expect(result.revisions).toHaveLength(2);
    const chain = db.lastChain("content_revisions") as RecordedChain;
    expect(chain.argsOf("in")).toEqual(["id", [REVISION_ID, OTHER_REVISION_ID]]);
    // Diff czyta „przed -> po", więc kolejność rosnąca jest częścią kontraktu.
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: true }]);
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args[0]);
    expect(eqs).toEqual(["tenant_id", "entity_type", "entity_id"]);
  });

  it("`data: null` dla zamówionych id też jest błędem (a nie pustym diffem)", async () => {
    // Ramię `rows ?? []`: PostgREST potrafi zwrócić `null` bez błędu. Zero
    // wierszy przy dwóch zamówionych id musi skończyć się tak samo, jak jeden -
    // odmową, nie diffem „nic się nie zmieniło".
    const db = client();
    db.setResponse("content_revisions", { data: null, error: null });
    await expect(
      run(
        "getRevisionSnapshots",
        { entityType: "post", entityId: POST_ID, ids: [REVISION_ID] },
        db,
      ),
    ).rejects.toThrow("Revision not found or access denied");
  });

  it("migawka null w wierszu rewizji staje się pustym obiektem, nie nullem", async () => {
    const db = client();
    db.setResponse(
      "content_revisions",
      ok([{ id: REVISION_ID, created_at: "2026-08-18T10:00:00.000Z", note: null, snapshot: null }]),
    );
    const result = (await run(
      "getRevisionSnapshots",
      { entityType: "post", entityId: POST_ID, ids: [REVISION_ID] },
      db,
    )) as { revisions: Array<{ snapshot: unknown }> };
    // Widok diffa iteruje po kluczach migawki - `null` wysypałby porównanie.
    expect(result.revisions[0].snapshot).toEqual({});
  });

  it("mniej wierszy niż zamówionych id to BŁĄD, nie krótszy diff", async () => {
    // Tak wygląda cichy filtr RLS: zapytanie się udaje, ale jeden z id należy do
    // innego tenanta. Bez tego sprawdzenia diff pokazałby jedną stronę i wyglądał
    // na poprawny.
    const db = client();
    db.setResponse("content_revisions", ok([revRow(REVISION_ID)]));
    await expect(
      run(
        "getRevisionSnapshots",
        { entityType: "post", entityId: POST_ID, ids: [REVISION_ID, OTHER_REVISION_ID] },
        db,
      ),
    ).rejects.toThrow("Revision not found or access denied");
  });

  it("withCurrent czyta ŻYWY wiersz przez service_role i rzutuje na kształt migawki", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([]));
    admin.setResponse(
      "posts",
      ok({
        id: POST_ID,
        tenant_id: TENANT,
        slug: "wpis",
        title_pl: "Tytuł",
        status: "published",
        search_vector: "szum",
      }),
    );

    const result = (await run(
      "getRevisionSnapshots",
      { entityType: "post", entityId: POST_ID, ids: [], withCurrent: true },
      db,
    )) as { current: Record<string, unknown> | null };

    // Odczyt idzie przez `supabaseAdmin`, bo kolumny ciała są odebrane roli
    // `authenticated` - zwykły klient dostałby odmowę.
    expect(admin.chainsFor("posts")).toHaveLength(1);
    expect(db.chainsFor("posts")).toHaveLength(0);
    // Rzut przez pickRevisionSnapshot: bez id/tenanta/sluga/szumu FTS, żeby
    // „porównaj z bieżącym" porównywało to samo, co migawka.
    expect(result.current).not.toHaveProperty("id");
    expect(result.current).not.toHaveProperty("tenant_id");
    expect(result.current).not.toHaveProperty("slug");
    expect(result.current).not.toHaveProperty("search_vector");
    expect(result.current).toMatchObject({ title_pl: "Tytuł" });
  });

  it("withCurrent dla strony czyta tabelę `pages`, nie `posts`", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([]));
    admin.setResponse("pages", ok({ id: POST_ID, title_pl: "Strona" }));

    await run(
      "getRevisionSnapshots",
      { entityType: "page", entityId: POST_ID, ids: [], withCurrent: true },
      db,
    );

    expect(admin.chainsFor("pages")).toHaveLength(1);
    expect(admin.chainsFor("posts")).toHaveLength(0);
    const chain = admin.lastChain("pages") as RecordedChain;
    // Filtr tenanta i odsianie kosza są warunkiem, nie ozdobą.
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["id", POST_ID],
      ["tenant_id", TENANT],
    ]);
    expect(chain.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("withCurrent na nieistniejącym / obcym wierszu to błąd", async () => {
    const db = client();
    db.setResponse("content_revisions", ok([]));
    admin.setResponse("posts", ok(null));
    await expect(
      run(
        "getRevisionSnapshots",
        { entityType: "post", entityId: POST_ID, ids: [], withCurrent: true },
        db,
      ),
    ).rejects.toThrow("Content not found or access denied");
  });

  it("błąd którejkolwiek warstwy propaguje", async () => {
    const dbRev = client();
    dbRev.setResponse("content_revisions", fail("rev denied"));
    await expect(
      run(
        "getRevisionSnapshots",
        { entityType: "post", entityId: POST_ID, ids: [REVISION_ID] },
        dbRev,
      ),
    ).rejects.toThrow("rev denied");

    const dbCur = client();
    dbCur.setResponse("content_revisions", ok([]));
    admin.setResponse("posts", fail("live row denied"));
    await expect(
      run(
        "getRevisionSnapshots",
        { entityType: "post", entityId: POST_ID, ids: [], withCurrent: true },
        dbCur,
      ),
    ).rejects.toThrow("live row denied");
  });
});

// ---------------------------------------------------------------------------
// restoreRevision - najdroższa operacja modułu.
// ---------------------------------------------------------------------------

describe("restoreRevision", () => {
  const revision = {
    id: REVISION_ID,
    entity_type: "post",
    entity_id: POST_ID,
    created_at: "2026-08-18T09:00:00.000Z",
    snapshot: {
      title_pl: "Stary tytuł",
      content_pl: "<p>Stara treść</p>",
      // W migawce status JEST (historia go pokazuje), ale przywracanie go
      // pomija - to sedno testu niżej.
      status: "draft",
    },
  };

  /**
   * Klient, w którym `content_revisions` odpowiada RÓŻNIE zależnie od ogniwa:
   * SELECT zwraca rewizję, INSERT (migawka `pre_restore`) zwraca sukces.
   * Zapisany łańcuch pozwala potem sprawdzić KOLEJNOŚĆ operacji.
   */
  function restoreClient(
    opts: {
      revisionRow?: unknown;
      updated?: unknown;
      backupError?: boolean;
      updateError?: boolean;
      liveRow?: unknown;
      entityType?: string;
    } = {},
  ) {
    const {
      revisionRow = revision,
      updated = [{ id: POST_ID }],
      backupError = false,
      updateError = false,
      liveRow = { id: POST_ID, title_pl: "Nowy tytuł", status: "published" },
      entityType = "post",
    } = opts;
    const db = client();
    const order: string[] = [];
    db.setResponse("content_revisions", (chain) => {
      if (chain.has("insert")) {
        order.push("backup");
        return backupError ? fail("backup denied") : ok(null);
      }
      order.push("read-revision");
      return ok(revisionRow);
    });
    const table = entityType === "page" ? "pages" : "posts";
    db.setResponse(table, () => {
      order.push("update");
      return updateError ? fail("update denied") : ok(updated);
    });
    admin.setResponse(table, () => {
      order.push("read-live");
      return ok(liveRow);
    });
    return { db, order };
  }

  it("przywraca treść, zapisuje audyt i zwraca id encji", async () => {
    const { db } = restoreClient();
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).resolves.toEqual({
      ok: true,
      entityId: POST_ID,
    });

    expect(recordAudit).toHaveBeenCalledTimes(1);
    const [, params] = recordAudit.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(params).toMatchObject({
      tenantId: TENANT,
      action: "revision.restore",
      entityType: "post",
      entityId: POST_ID,
      metadata: { revision_id: REVISION_ID, revision_created_at: revision.created_at },
    });
  });

  it("patch przywracania NIE zawiera `status` - restore nie (od)publikuje wpisu", async () => {
    const { db } = restoreClient();
    await run("restoreRevision", { id: REVISION_ID }, db);

    const updateChain = db.chainsFor("posts").find((c) => c.has("update"));
    const [patch] = (updateChain?.argsOf("update") ?? []) as [Record<string, unknown>];
    // Migawka NIOSŁA status "draft". Gdyby trafił do patcha, przywrócenie starej
    // wersji tekstu zdjęłoby opublikowany wpis ze strony - bez ostrzeżenia.
    expect(patch).not.toHaveProperty("status");
    expect(patch).toMatchObject({ title_pl: "Stary tytuł", content_pl: "<p>Stara treść</p>" });
    expect(updateChain?.argsOf("eq")).toEqual(["id", POST_ID]);
  });

  it("migawka bezpieczeństwa `pre_restore` powstaje PRZED nadpisaniem treści", async () => {
    const { db, order } = restoreClient();
    await run("restoreRevision", { id: REVISION_ID }, db);

    // Sama obecność migawki nie wystarcza - gdyby powstała PO UPDATE, zapisałaby
    // treść już nadpisaną i „nieniszczące przywracanie" byłoby fikcją.
    expect(order).toEqual(["read-revision", "read-live", "backup", "update"]);

    const insertChain = db.chainsFor("content_revisions").find((c) => c.has("insert"));
    const [backup] = (insertChain?.argsOf("insert") ?? []) as [Record<string, unknown>];
    expect(backup).toMatchObject({
      tenant_id: TENANT,
      entity_type: "post",
      entity_id: POST_ID,
      author_id: USER,
      note: "pre_restore",
    });
    // Migawka bezpieczeństwa niesie stan ŻYWY (nowy tytuł), nie przywracany.
    expect(backup.snapshot).toMatchObject({ title_pl: "Nowy tytuł" });
  });

  it("nieudana migawka bezpieczeństwa przerywa restore PRZED nadpisaniem", async () => {
    const { db, order } = restoreClient({ backupError: true });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow("backup denied");
    // Brak migawki = brak drogi powrotu, więc nadpisanie nie może się zdarzyć.
    expect(order).not.toContain("update");
  });

  it("pusta migawka nie kasuje treści", async () => {
    const { db, order } = restoreClient({
      revisionRow: { ...revision, snapshot: {} },
    });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow(
      "Revision snapshot is empty",
    );
    // UPDATE z pustym patchem albo z samymi nullami wyczyściłby wpis.
    expect(order).not.toContain("update");
  });

  it("migawka `null` jest traktowana jak pusta, nie jako awaria", async () => {
    // Ramię `revision.snapshot ?? {}`. Rewizja z pustą kolumną migawki to
    // uszkodzony wiersz - ma dać czytelną odmowę, nie `TypeError` z wnętrza
    // `pickRestorableFields`.
    const { db, order } = restoreClient({ revisionRow: { ...revision, snapshot: null } });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow(
      "Revision snapshot is empty",
    );
    expect(order).not.toContain("update");
  });

  it("zero zaktualizowanych wierszy BEZ błędu to porażka, nie sukces", async () => {
    // Cichy filtr RLS: UPDATE nie zwraca błędu, tylko nie pisze nic. Bez tego
    // sprawdzenia użytkownik widziałby „przywrócono", a treść zostałaby stara.
    const { db } = restoreClient({ updated: [] });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow(
      "Restore failed: not found or access denied",
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("błąd UPDATE nie zapisuje audytu udanego przywrócenia", async () => {
    const { db } = restoreClient({ updateError: true });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow("update denied");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("nieistniejąca lub obca rewizja przerywa akcję", async () => {
    const { db, order } = restoreClient({ revisionRow: null });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow(
      "Revision not found or access denied",
    );
    expect(order).toEqual(["read-revision"]);
  });

  it("zniknięty wiersz docelowy przerywa akcję przed migawką", async () => {
    const { db, order } = restoreClient({ liveRow: null });
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow(
      "Content not found or access denied",
    );
    expect(order).toEqual(["read-revision", "read-live"]);
  });

  it("rewizja strony pisze do `pages`, a audyt niesie entityType `page`", async () => {
    const { db } = restoreClient({
      entityType: "page",
      revisionRow: { ...revision, entity_type: "page" },
      liveRow: { id: POST_ID, title_pl: "Zywa strona" },
    });
    await run("restoreRevision", { id: REVISION_ID }, db);

    expect(db.chainsFor("pages").some((c) => c.has("update"))).toBe(true);
    expect(db.chainsFor("posts")).toHaveLength(0);
    const [, params] = recordAudit.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(params.entityType).toBe("page");
  });

  it("czyta rewizję z filtrem tenanta (nie tylko po id)", async () => {
    const { db } = restoreClient();
    await run("restoreRevision", { id: REVISION_ID }, db);
    const readChain = db.chainsFor("content_revisions").find((c) => !c.has("insert"));
    const eqs = readChain?.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["tenant_id", TENANT],
      ["id", REVISION_ID],
    ]);
  });

  it("błąd odczytu rewizji propaguje z komunikatem bazy", async () => {
    const db = client();
    db.setResponse("content_revisions", fail("revision read denied"));
    await expect(run("restoreRevision", { id: REVISION_ID }, db)).rejects.toThrow(
      "revision read denied",
    );
  });
});

// Kontrola higieny atrap: obie muszą być TYMI atrapami, po których testy wyżej
// czytają zapisane łańcuchy. Gdyby fabryka `vi.mock` zwróciła inny obiekt niż
// ten w `server.admin`, asercje „odczyt idzie przez service_role" przechodziłyby
// obok rzeczywistości.
describe("higiena atrap", () => {
  it("supabaseAdmin w kodzie produkcyjnym to ta sama atrapa, którą czytają testy", () => {
    expect(supabaseAdmin.from).toBe(admin.from);
  });
});
