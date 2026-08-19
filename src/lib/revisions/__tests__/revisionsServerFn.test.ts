// Server functions historii zmian: `listRevisions`, `getRevisionSnapshots`,
// `restoreRevision`. Plik stał na 0% mimo 61 mierzonych linii i 11 funkcji -
// był największym nieprzetestowanym nośnikiem reguł w module 2.
//
// Czysta część domeny (`content/revisions.ts`: co wchodzi do migawki, kiedy
// warto ją pisać, czego NIE wolno przywrócić) ma własne testy. Tutaj testujemy
// to, czego tamte z definicji nie widzą: SKŁADANIE reguł w server fn - kolejność
// zapisów, zakres filtrów i to, czy błąd bazy dociera do wywołującego.
//
// Trzy gwarancje są tu ważniejsze od pozostałych:
//   1. przywrócenie NIE rusza `status` (nie publikuje i nie cofa publikacji),
//   2. migawka zabezpieczająca powstaje PRZED nadpisaniem, nie po,
//   3. UPDATE odfiltrowany przez RLS (zero wierszy, zero błędu) jest zgłaszany
//      jako porażka, a nie raportowany jako udane przywrócenie.
//
// `createServerFn` nie da się wywołać bez kontekstu żądania frameworka, więc
// łańcuch jest podmieniony na taki, który ODDAJE walidator i handler - wzorzec
// z `src/lib/__tests__/categoryColorSave.test.ts`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, supabaseFromStub } from "@/test/supabaseChain";
import { PRE_RESTORE_NOTE } from "../listProjection";

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

/** Limiter przepustnicy - domyślnie przepuszcza, pojedynczy test go zamyka. */
const rateLimitAllowed = { value: true };
vi.mock("@/lib/server/rate-limit.server", () => ({
  rateLimit: async () => rateLimitAllowed.value,
}));

const auditCalls: Array<Record<string, unknown>> = [];
vi.mock("@/lib/server/audit.server", () => ({
  recordAudit: async (_client: unknown, entry: Record<string, unknown>) => {
    auditCalls.push(entry);
  },
}));

/** Klient uprawniony (service_role) - czyta ŻYWY wiersz do migawki. */
const admin = supabaseFromStub();
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => admin.from(table) },
}));

const client = supabaseFromStub();
const TENANT = "tenant-1";
const USER = "user-1";
const ENTITY = "11111111-1111-4111-8111-111111111111";
const REVISION = "22222222-2222-4222-8222-222222222222";

const context = { supabase: { from: (t: string) => client.from(t) }, userId: USER };

async function fns() {
  return (await import("@/lib/revisions.functions")) as unknown as {
    listRevisions: ServerFnSpec;
    getRevisionSnapshots: ServerFnSpec;
    restoreRevision: ServerFnSpec;
  };
}

async function call(spec: ServerFnSpec, input: unknown) {
  return spec.handler?.({ data: spec.validator?.(input), context });
}

/** Wiersz wpisu w kształcie, jaki oddaje `select("*")`. */
function liveRow(over: Record<string, unknown> = {}) {
  return {
    id: ENTITY,
    title_pl: "Tytuł bieżący",
    content_pl: "Treść bieżąca",
    status: "published",
    // Kolumna spoza katalogu rewizji - migawka ma ją POMINĄĆ.
    view_count: 512,
    ...over,
  };
}

beforeEach(() => {
  client.reset();
  admin.reset();
  auditCalls.length = 0;
  rateLimitAllowed.value = true;
  client.setResponse("profiles", ok({ tenant_id: TENANT }));
});

describe("listRevisions - walidacja wejścia", () => {
  it("domyślny limit to 50 - tyle, ile wynosi limit przycinania historii", async () => {
    const { listRevisions } = await fns();
    expect(listRevisions.validator?.({ entityType: "post", entityId: ENTITY })).toMatchObject({
      limit: 50,
    });
  });

  it("odrzuca limit poza zakresem 1-100 i identyfikator, który nie jest UUID", async () => {
    // Limit bez górnej granicy to zaproszenie do wyciągnięcia całej historii
    // jednym żądaniem; `entityId` bez walidacji trafia wprost do filtra.
    const { listRevisions } = await fns();
    expect(() =>
      listRevisions.validator?.({ entityType: "post", entityId: ENTITY, limit: 0 }),
    ).toThrow();
    expect(() =>
      listRevisions.validator?.({ entityType: "post", entityId: ENTITY, limit: 101 }),
    ).toThrow();
    expect(() => listRevisions.validator?.({ entityType: "post", entityId: "12" })).toThrow();
  });

  it("zna DOKŁADNIE dwa typy encji", async () => {
    const { listRevisions } = await fns();
    expect(() => listRevisions.validator?.({ entityType: "page", entityId: ENTITY })).not.toThrow();
    expect(() => listRevisions.validator?.({ entityType: "widget", entityId: ENTITY })).toThrow();
  });
});

describe("listRevisions - zapytanie", () => {
  it("filtruje po tenancie, typie i encji oraz sortuje od najnowszej", async () => {
    // Brak któregokolwiek z trzech filtrów oznacza historię CUDZEGO wpisu
    // (albo cudzego najemcy) na ekranie porównania wersji.
    client.setResponse("content_revisions", ok([]));
    const { listRevisions } = await fns();
    await call(listRevisions, { entityType: "post", entityId: ENTITY, limit: 7 });

    const chain = client.lastChain("content_revisions");
    const eqs = chain?.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["tenant_id", TENANT],
      ["entity_type", "post"],
      ["entity_id", ENTITY],
    ]);
    expect(chain?.argsOf("order")).toEqual(["created_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([7]);
  });

  it("REGUŁA ŁADUNKU: migawki NIE wychodzą na drut, wychodzi projekcja", async () => {
    // Lista może mieć 50 wierszy z pełnym JSON-em buildera. Oddanie ich wprost
    // zamieniłoby kilkubajtową listę w megabajty i wypuściłoby treść, której
    // ekran listy nie pokazuje.
    client.setResponse(
      "content_revisions",
      ok([
        {
          id: REVISION,
          created_at: "2026-08-18T10:00:00.000Z",
          author_id: USER,
          note: null,
          snapshot: { content_pl: "cała treść", builder_data: { sections: [1, 2, 3] } },
        },
      ]),
    );
    const { listRevisions } = await fns();
    const result = (await call(listRevisions, {
      entityType: "post",
      entityId: ENTITY,
    })) as Array<Record<string, unknown>>;

    expect(result).toHaveLength(1);
    expect(result[0].snapshot).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("cała treść");
  });

  it("błąd odczytu leci wyjątkiem, nie pustą listą", async () => {
    // Pusta lista przy błędzie wygląda jak „brak historii" - redaktor uzna, że
    // nie ma czego przywracać.
    client.setResponse("content_revisions", fail("naruszenie RLS"));
    const { listRevisions } = await fns();
    await expect(call(listRevisions, { entityType: "post", entityId: ENTITY })).rejects.toThrow(
      "naruszenie RLS",
    );
  });
});

describe("przepustnica i tenant", () => {
  it("przekroczony limit żądań zatrzymuje pracę PRZED zapytaniem", async () => {
    rateLimitAllowed.value = false;
    client.setResponse("content_revisions", ok([]));
    const { listRevisions } = await fns();

    await expect(call(listRevisions, { entityType: "post", entityId: ENTITY })).rejects.toThrow(
      "Rate limit exceeded",
    );
    expect(client.chainsFor("content_revisions")).toHaveLength(0);
  });

  it("użytkownik bez tenanta nie czyta niczego", async () => {
    // Brak `tenant_id` w profilu przy zapytaniu BEZ filtra tenanta oznaczałby
    // odczyt przez granicę najemcy - dlatego to twardy błąd, nie `null`.
    client.setResponse("profiles", ok({ tenant_id: null }));
    client.setResponse("content_revisions", ok([]));
    const { listRevisions } = await fns();

    await expect(call(listRevisions, { entityType: "post", entityId: ENTITY })).rejects.toThrow(
      "No tenant",
    );
    expect(client.chainsFor("content_revisions")).toHaveLength(0);
  });
});

describe("getRevisionSnapshots", () => {
  it("przyjmuje najwyżej dwie rewizje - widok porównania zestawia parę", async () => {
    const { getRevisionSnapshots } = await fns();
    expect(() =>
      getRevisionSnapshots.validator?.({
        entityType: "post",
        entityId: ENTITY,
        ids: [REVISION, ENTITY, REVISION],
      }),
    ).toThrow();
  });

  it("pusta lista identyfikatorów nie odpytuje historii", async () => {
    const { getRevisionSnapshots } = await fns();
    const result = await call(getRevisionSnapshots, {
      entityType: "post",
      entityId: ENTITY,
      ids: [],
    });

    expect(result).toEqual({ revisions: [], current: null });
    expect(client.chainsFor("content_revisions")).toHaveLength(0);
  });

  it("REGUŁA DOSTĘPU: brak choćby jednej rewizji unieważnia CAŁĄ odpowiedź", async () => {
    // Oddanie tego, co się udało odczytać, zamieniłoby filtr RLS w cichy wynik
    // częściowy: użytkownik podstawia dwa identyfikatory, dostaje ten jeden,
    // do którego ma prawo, i nie dowiaduje się, że drugi istnieje. Jawny błąd
    // nie rozróżnia „nie ma" od „nie wolno".
    client.setResponse("content_revisions", ok([{ id: REVISION, created_at: "x", note: null }]));
    const { getRevisionSnapshots } = await fns();

    await expect(
      call(getRevisionSnapshots, { entityType: "post", entityId: ENTITY, ids: [REVISION, ENTITY] }),
    ).rejects.toThrow("not found or access denied");
  });

  it("oddaje migawki posortowane rosnąco - „przed” przed „po”", async () => {
    client.setResponse(
      "content_revisions",
      ok([
        { id: REVISION, created_at: "2026-08-01T00:00:00.000Z", note: "a", snapshot: null },
        { id: ENTITY, created_at: "2026-08-02T00:00:00.000Z", note: null, snapshot: { x: 1 } },
      ]),
    );
    const { getRevisionSnapshots } = await fns();
    const result = (await call(getRevisionSnapshots, {
      entityType: "post",
      entityId: ENTITY,
      ids: [REVISION, ENTITY],
    })) as { revisions: Array<{ id: string; snapshot: unknown }> };

    expect(client.lastChain("content_revisions")?.argsOf("order")).toEqual([
      "created_at",
      { ascending: true },
    ]);
    expect(result.revisions.map((r) => r.id)).toEqual([REVISION, ENTITY]);
    // Pusta migawka jako `{}`, nie `null` - widok diffa iteruje po kluczach.
    expect(result.revisions[0].snapshot).toEqual({});
  });

  it("stan bieżący jest RZUTOWANY na kształt migawki, nie oddawany surowo", async () => {
    // Porównanie „wersja vs bieżący" ma zestawiać te same pola. Surowy wiersz
    // wniósłby kolumny, których żadna migawka nie ma (liczniki, znaczniki), i
    // każda z nich pokazałaby się jako zmiana.
    client.setResponse("content_revisions", ok([]));
    admin.setResponse("posts", ok(liveRow()));
    const { getRevisionSnapshots } = await fns();
    const result = (await call(getRevisionSnapshots, {
      entityType: "post",
      entityId: ENTITY,
      ids: [],
      withCurrent: true,
    })) as { current: Record<string, unknown> };

    expect(result.current.title_pl).toBe("Tytuł bieżący");
    expect(result.current.view_count).toBeUndefined();
    expect(result.current.id).toBeUndefined();
  });

  it("stan bieżący czyta się z tabeli zgodnej z typem encji i pomija kosz", async () => {
    client.setResponse("content_revisions", ok([]));
    admin.setResponse("pages", ok(liveRow()));
    const { getRevisionSnapshots } = await fns();
    await call(getRevisionSnapshots, {
      entityType: "page",
      entityId: ENTITY,
      ids: [],
      withCurrent: true,
    });

    const chain = admin.lastChain("pages");
    expect(chain).toBeTruthy();
    expect(admin.chainsFor("posts")).toHaveLength(0);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    // Filtr tenanta stoi także na kliencie uprawnionym - service_role omija RLS.
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", ENTITY],
      ["tenant_id", TENANT],
    ]);
  });

  it("brak żywego wiersza jest błędem, nie pustym porównaniem", async () => {
    client.setResponse("content_revisions", ok([]));
    admin.setResponse("posts", ok(null));
    const { getRevisionSnapshots } = await fns();

    await expect(
      call(getRevisionSnapshots, {
        entityType: "post",
        entityId: ENTITY,
        ids: [],
        withCurrent: true,
      }),
    ).rejects.toThrow("Content not found");
  });
});

describe("restoreRevision", () => {
  /** Domyślny scenariusz: rewizja istnieje, żywy wiersz istnieje, UPDATE trafia. */
  function happyPath(snapshot: Record<string, unknown>, entityType: "post" | "page" = "post") {
    client.setResponse("content_revisions", (chain) =>
      chain.has("insert")
        ? ok(null)
        : ok({
            id: REVISION,
            entity_type: entityType,
            entity_id: ENTITY,
            snapshot,
            created_at: "2026-08-01T00:00:00.000Z",
          }),
    );
    admin.setResponse(entityType === "page" ? "pages" : "posts", ok(liveRow()));
    client.setResponse(entityType === "page" ? "pages" : "posts", ok([{ id: ENTITY }]));
  }

  it("REGUŁA: przywrócenie NIE rusza `status`", async () => {
    // To jest cała stawka tej funkcji. Migawka niesie `status` (bo historia ma
    // pokazywać, czy wpis był wtedy opublikowany), ale zapis go pomija:
    // przywrócenie starej treści nie może po cichu opublikować szkicu ani cofnąć
    // publikacji artykułu, który jest już w obiegu.
    happyPath({ title_pl: "Stary tytuł", content_pl: "Stara treść", status: "draft" });
    const { restoreRevision } = await fns();
    await call(restoreRevision, { id: REVISION });

    const patch = client.lastChain("posts")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch).toEqual({ title_pl: "Stary tytuł", content_pl: "Stara treść" });
    expect(patch.status).toBeUndefined();
  });

  it("REGUŁA KOLEJNOŚCI: migawka zabezpieczająca powstaje PRZED nadpisaniem", async () => {
    // Zapis „po" znaczy, że awaria między UPDATE a INSERT zostawia stan bez
    // kopii tego, co właśnie zniknęło - a przywracanie ma być odwracalne.
    happyPath({ title_pl: "Stary tytuł" });
    const { restoreRevision } = await fns();
    await call(restoreRevision, { id: REVISION });

    const order = client.chains.map((c) => `${c.table}:${c.has("insert") ? "insert" : "read"}`);
    const backupAt = order.indexOf("content_revisions:insert");
    const updateAt = client.chains.findIndex((c) => c.table === "posts" && c.has("update"));
    expect(backupAt).toBeGreaterThanOrEqual(0);
    expect(updateAt).toBeGreaterThan(backupAt);
  });

  it("migawka zabezpieczająca jest OZNACZONA i niesie stan bieżący", async () => {
    // Bez noty wpis w historii wygląda jak zwykła wersja redaktora, a to
    // po niej ekran przywracania odróżnia „stan sprzed cofnięcia".
    happyPath({ title_pl: "Stary tytuł" });
    const { restoreRevision } = await fns();
    await call(restoreRevision, { id: REVISION });

    const backup = client
      .chainsFor("content_revisions")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(backup.note).toBe(PRE_RESTORE_NOTE);
    expect(backup.tenant_id).toBe(TENANT);
    expect(backup.author_id).toBe(USER);
    expect(backup.entity_id).toBe(ENTITY);
    // Migawka bierze się z ŻYWEGO wiersza, nie z przywracanej rewizji.
    expect((backup.snapshot as Record<string, unknown>).title_pl).toBe("Tytuł bieżący");
    // ...i przechodzi przez tę samą projekcję, co reszta historii.
    expect((backup.snapshot as Record<string, unknown>).view_count).toBeUndefined();
  });

  it("REGRESJA: UPDATE odfiltrowany przez RLS to PORAŻKA, nie ciche powodzenie", async () => {
    // PostgREST przy odfiltrowanym wierszu nie zwraca błędu - zwraca zero
    // wierszy. Bez tej gałęzi ekran pokazałby „przywrócono", a treść zostałaby
    // ta sama.
    happyPath({ title_pl: "Stary tytuł" });
    client.setResponse("posts", ok([]));
    const { restoreRevision } = await fns();

    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow("Restore failed");
    expect(auditCalls).toHaveLength(0);
  });

  it("pusta migawka nie kasuje treści", async () => {
    // Rewizja bez pól nadających się do zapisu dałaby UPDATE z pustym patchem
    // albo - gorzej - z samymi `undefined`. Zatrzymujemy się przed zapisem.
    happyPath({ status: "draft" });
    const { restoreRevision } = await fns();

    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow("snapshot is empty");
    expect(client.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });

  it("nieistniejąca rewizja nie odpala żadnego zapisu", async () => {
    client.setResponse("content_revisions", ok(null));
    const { restoreRevision } = await fns();

    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow(
      "Revision not found or access denied",
    );
    expect(client.chainsFor("content_revisions").some((c) => c.has("insert"))).toBe(false);
  });

  it("błąd zapisu migawki zabezpieczającej WSTRZYMUJE przywracanie", async () => {
    // Skoro kopia bezpieczeństwa nie powstała, nadpisanie byłoby nieodwracalne.
    client.setResponse("content_revisions", (chain) =>
      chain.has("insert")
        ? fail("brak uprawnień do zapisu")
        : ok({
            id: REVISION,
            entity_type: "post",
            entity_id: ENTITY,
            snapshot: { title_pl: "Stary tytuł" },
            created_at: "2026-08-01T00:00:00.000Z",
          }),
    );
    admin.setResponse("posts", ok(liveRow()));
    client.setResponse("posts", ok([{ id: ENTITY }]));
    const { restoreRevision } = await fns();

    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow(
      "brak uprawnień do zapisu",
    );
    expect(client.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });

  it("strona przywraca się do tabeli `pages`, nie `posts`", async () => {
    happyPath({ title_pl: "Stary tytuł strony" }, "page");
    const { restoreRevision } = await fns();
    const result = await call(restoreRevision, { id: REVISION });

    expect(client.chainsFor("pages").some((c) => c.has("update"))).toBe(true);
    expect(client.chainsFor("posts")).toHaveLength(0);
    expect(result).toEqual({ ok: true, entityId: ENTITY });
  });

  it("zapisuje ślad audytowy z identyfikatorem i DATĄ przywróconej wersji", async () => {
    // Sam identyfikator rewizji nie mówi audytorowi, do jakiego stanu cofnięto
    // treść - data przywróconej wersji jest tu połową informacji.
    happyPath({ title_pl: "Stary tytuł" });
    const { restoreRevision } = await fns();
    await call(restoreRevision, { id: REVISION });

    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      tenantId: TENANT,
      action: "revision.restore",
      entityType: "post",
      entityId: ENTITY,
      metadata: { revision_id: REVISION, revision_created_at: "2026-08-01T00:00:00.000Z" },
    });
  });

  it("rewizja z pustą kolumną `snapshot` też nie kasuje treści", async () => {
    // `snapshot` jest kolumną `jsonb` dopuszczającą NULL - wiersz sprzed zmiany
    // kształtu albo nieudany zapis dałby tu `null`, a nie `{}`.
    happyPath({});
    client.setResponse("content_revisions", (chain) =>
      chain.has("insert")
        ? ok(null)
        : ok({
            id: REVISION,
            entity_type: "post",
            entity_id: ENTITY,
            snapshot: null,
            created_at: "2026-08-01T00:00:00.000Z",
          }),
    );
    const { restoreRevision } = await fns();

    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow("snapshot is empty");
    expect(client.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });

  it("odrzuca identyfikator, który nie jest UUID", async () => {
    const { restoreRevision } = await fns();
    expect(() => restoreRevision.validator?.({ id: "ostatnia" })).toThrow();
  });
});

// Ścieżki błędu bazy. Każda z nich jest osobną gałęzią, w której CICHE
// połknięcie wygląda dla użytkownika jak powodzenie: pusty diff zamiast błędu
// odczytu, „przywrócono" zamiast odmowy zapisu. Dlatego mają własne testy,
// mimo że kod każdej z nich to jedna linia.
describe("błędy bazy docierają do wywołującego", () => {
  it("odczyt migawek do porównania", async () => {
    client.setResponse("content_revisions", fail("timeout odczytu"));
    const { getRevisionSnapshots } = await fns();
    await expect(
      call(getRevisionSnapshots, { entityType: "post", entityId: ENTITY, ids: [REVISION] }),
    ).rejects.toThrow("timeout odczytu");
  });

  it("odczyt stanu bieżącego do porównania", async () => {
    client.setResponse("content_revisions", ok([]));
    admin.setResponse("posts", fail("połączenie zerwane"));
    const { getRevisionSnapshots } = await fns();
    await expect(
      call(getRevisionSnapshots, {
        entityType: "post",
        entityId: ENTITY,
        ids: [],
        withCurrent: true,
      }),
    ).rejects.toThrow("połączenie zerwane");
  });

  it("odczyt przywracanej rewizji", async () => {
    client.setResponse("content_revisions", fail("naruszenie RLS"));
    const { restoreRevision } = await fns();
    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow("naruszenie RLS");
  });

  it("odczyt żywego wiersza przed nadpisaniem", async () => {
    // Bez migawki zabezpieczającej nie wolno ruszyć treści - a migawki nie ma
    // z czego zrobić, skoro odczyt padł.
    client.setResponse(
      "content_revisions",
      ok({
        id: REVISION,
        entity_type: "post",
        entity_id: ENTITY,
        snapshot: { title_pl: "Stary tytuł" },
        created_at: "2026-08-01T00:00:00.000Z",
      }),
    );
    admin.setResponse("posts", fail("timeout"));
    const { restoreRevision } = await fns();
    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow("timeout");
    expect(client.chainsFor("content_revisions").some((c) => c.has("insert"))).toBe(false);
  });

  it("żywy wiersz w koszu = brak wiersza, nie przywracanie do usuniętego wpisu", async () => {
    client.setResponse(
      "content_revisions",
      ok({
        id: REVISION,
        entity_type: "post",
        entity_id: ENTITY,
        snapshot: { title_pl: "Stary tytuł" },
        created_at: "2026-08-01T00:00:00.000Z",
      }),
    );
    admin.setResponse("posts", ok(null));
    const { restoreRevision } = await fns();
    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow("Content not found");
  });

  it("sam UPDATE przywracający treść", async () => {
    client.setResponse("content_revisions", (chain) =>
      chain.has("insert")
        ? ok(null)
        : ok({
            id: REVISION,
            entity_type: "post",
            entity_id: ENTITY,
            snapshot: { title_pl: "Stary tytuł" },
            created_at: "2026-08-01T00:00:00.000Z",
          }),
    );
    admin.setResponse("posts", ok(liveRow()));
    client.setResponse("posts", fail("kolumna tylko do odczytu"));
    const { restoreRevision } = await fns();
    await expect(call(restoreRevision, { id: REVISION })).rejects.toThrow(
      "kolumna tylko do odczytu",
    );
    expect(auditCalls).toHaveLength(0);
  });

  it("pusta odpowiedź listy migawek nie wywraca pętli projekcji", async () => {
    // PostgREST przy braku trafień oddaje `null`, nie `[]`.
    client.setResponse("content_revisions", (chain) => (chain.has("in") ? ok(null) : ok([])));
    const { getRevisionSnapshots } = await fns();
    await expect(
      call(getRevisionSnapshots, { entityType: "post", entityId: ENTITY, ids: [REVISION] }),
    ).rejects.toThrow("not found or access denied");
  });
});
