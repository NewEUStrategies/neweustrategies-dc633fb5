// TAKSONOMIE I AUTORZY: `upsertCategory`, `updateCategoryColor`, `deleteCategory`,
// `createTag`, `deleteTag`, `setPostAuthors`.
//
// CO MA TU DOWÓD:
//   1. slug kategorii ma DWA różne kontrakty i to jest zamierzone: podany
//      jawnie musi być wolny (twardy błąd, bo redaktor go widzi w formularzu),
//      a wyliczony z nazwy dostaje sufiks numeryczny (cicha rozbieżność jest
//      lepsza niż odrzucony zapis),
//   2. kategoria nie może być swoim rodzicem - hierarchia region → państwo
//      musi pozostać drzewem,
//   3. `setPostAuthors` pilnuje TRZECH niezależnych rzeczy: kolejności
//      (element [0] to autor główny), przynależności KAŻDEGO autora do tego
//      obszaru roboczego oraz zastrzeżenia zmiany autora głównego dla ról
//      publikujących - bez tego autor oddawałby sobie prawa do cudzego wpisu,
//   4. `updateCategoryColor` dotyka WYŁĄCZNIE kolumny `color` (bramka defektu
//      K10 ma osobny plik `categoryColorSave.test.ts`; tutaj sprawdzamy resztę
//      handlera: limit, propagację błędu i ślad audytu),
//   5. DWIE LUKI kasowania taksonomii, zarejestrowane jako `it.fails`.
//
// CZEGO TU NIE MA. Walidatorów (`contentFunctions.schemas`), RLS-a (pgTAP),
// helperów kolejności autorów (`content/postAuthors` ma własne testy - tutaj
// biegną PRAWDZIWE).
//
// DWIE GAŁĘZIE ZOSTAJĄ BEZ TESTU, BO SĄ NIEOSIĄGALNE - i to jest ustalenie, nie
// zaniedbanie:
//   * `uniqueSlug(..., data.fields.name_pl || data.fields.name_en, ...)` -
//     prawa strona alternatywy nie ma jak zadziałać, bo `NonEmptyTrimmed`
//     gwarantuje, że `name_pl` po trimie ma co najmniej jeden znak (pusta
//     nazwa odpada w walidatorze),
//   * `if (!main) throw new Error("A post needs at least one author")` w
//     `setPostAuthors` - `authorIds` to `z.array(UUID).min(1)`, a `splitAuthors`
//     deduplikuje niepuste ciągi, więc `main` zawsze istnieje.
// Test, który by je „pokrył", musiałby ominąć walidator - czyli sprawdzać coś,
// czego produkcja nigdy nie wykona.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORY_ID,
  OTHER_POST_ID,
  OTHER_USER,
  POST_ID,
  TAG_ID,
  TENANT,
  USER,
  contentClient,
  fail,
  ok,
  type ContentClient,
  type ServerFnSpec,
} from "./contentFunctionsHarness";
import type { RecordedChain, SupabaseResult } from "@/test/supabaseChain";

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("./contentFunctionsHarness");
  return { createServerFn: createServerFnStub, createMiddleware: () => ({}) };
});
vi.mock("@/integrations/supabase/require-staff", () => ({ requireStaff: {} }));
vi.mock("@/lib/server/rate-limit.server", async () => {
  const { vi: v } = await import("vitest");
  return { rateLimit: v.fn(async (_opts: unknown) => true) };
});
vi.mock("@/lib/server/audit.server", async () => {
  const { vi: v } = await import("vitest");
  return { recordAudit: v.fn(async (_client: unknown, _params: unknown) => undefined) };
});
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({}) } }));

import { rateLimit as rateLimitFn } from "@/lib/server/rate-limit.server";
import { recordAudit as recordAuditFn } from "@/lib/server/audit.server";

const rateLimit = rateLimitFn as unknown as ReturnType<typeof vi.fn>;
const recordAudit = recordAuditFn as unknown as ReturnType<typeof vi.fn>;

async function run(name: string, input: unknown, client: ContentClient) {
  const mod = await import("@/lib/content.functions");
  const spec = mod[name as keyof typeof mod] as unknown as ServerFnSpec;
  const data = spec.validator?.(input);
  return spec.handler?.({ data, context: { supabase: client.supabase, userId: USER } });
}

function auditParams(): Record<string, unknown> {
  const call = recordAudit.mock.calls.at(-1) as [unknown, Record<string, unknown>] | undefined;
  return call?.[1] ?? {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstArg(chain: RecordedChain | undefined, method: string): Record<string, unknown> {
  const value = chain?.argsOf(method)?.[0];
  return isRecord(value) ? value : {};
}

beforeEach(() => {
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
  recordAudit.mockReset();
  recordAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// upsertCategory
// ---------------------------------------------------------------------------

describe("upsertCategory", () => {
  const FIELDS = { name_pl: "Obszar tematyczny", name_en: "Thematic area" };

  function scene(
    opts: {
      slugTaken?: (candidate: string) => boolean;
      probeError?: string;
      written?: SupabaseResult;
    } = {},
  ) {
    const client = contentClient();
    client.db.setResponse("categories", (chain: RecordedChain): SupabaseResult => {
      if (chain.has("limit")) {
        if (opts.probeError) return fail(opts.probeError);
        const candidate = chain.calls.filter((c) => c.method === "eq").at(-1)?.args[1];
        return opts.slugTaken?.(String(candidate)) ? ok([{ id: OTHER_POST_ID }]) : ok([]);
      }
      if (chain.has("insert")) return opts.written ?? ok({ id: CATEGORY_ID });
      if (chain.has("update")) return opts.written ?? ok(null);
      return ok([]);
    });
    return client;
  }

  it("woła limiter z zakresem category.upsert i pułapem 60", async () => {
    const client = scene();
    await run("upsertCategory", { fields: FIELDS }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "category.upsert", subjectId: USER, max: 60 });
  });

  it("przekroczony limit rzuca i nie tworzy kategorii", async () => {
    rateLimit.mockResolvedValue(false);
    const client = scene();
    await expect(run("upsertCategory", { fields: FIELDS }, client)).rejects.toThrow(
      "Rate limit exceeded",
    );
    expect(client.db.chainsFor("categories")).toHaveLength(0);
  });

  it("kategoria nie może być własnym rodzicem (hierarchia musi zostać drzewem)", async () => {
    const client = scene();
    await expect(
      run(
        "upsertCategory",
        { id: CATEGORY_ID, fields: { ...FIELDS, parent_id: CATEGORY_ID } },
        client,
      ),
    ).rejects.toThrow("Kategoria nie może być własnym rodzicem");
    expect(client.db.chainsFor("categories")).toHaveLength(0);
  });

  it("wskazanie SIEBIE jako rodzica przy TWORZENIU nie jest możliwe do wykrycia i przechodzi", async () => {
    // Bez `id` nie ma z czym porównać - nowa kategoria nie ma jeszcze
    // identyfikatora, a wskazany rodzic to po prostu inny wiersz.
    const client = scene();
    await expect(
      run("upsertCategory", { fields: { ...FIELDS, parent_id: CATEGORY_ID } }, client),
    ).resolves.toMatchObject({ id: CATEGORY_ID });
  });

  it("slug PODANY JAWNIE i zajęty to twardy błąd z nazwą slugu", async () => {
    const client = scene({ slugTaken: (c) => c === "obszar" });
    await expect(
      run("upsertCategory", { fields: { ...FIELDS, slug: "Obszar" } }, client),
    ).rejects.toThrow('Slug "obszar" jest już używany przez inną kategorię');
    expect(client.db.chainsFor("categories").filter((c) => c.has("insert"))).toHaveLength(0);
  });

  it("kontrola jawnego slugu przy EDYCJI pomija własny wiersz", async () => {
    const client = scene();
    await run("upsertCategory", { id: CATEGORY_ID, fields: { ...FIELDS, slug: "obszar" } }, client);
    const probe = client.db.chainsFor("categories").find((c) => c.has("limit"));
    expect(probe?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["slug", "obszar"],
    ]);
    expect(probe?.argsOf("neq")).toEqual(["id", CATEGORY_ID]);
  });

  it("błąd kontroli slugu przerywa zapis", async () => {
    const client = scene({ probeError: "categories probe denied" });
    await expect(
      run("upsertCategory", { fields: { ...FIELDS, slug: "obszar" } }, client),
    ).rejects.toThrow("categories probe denied");
  });

  it("slug PUSTY powstaje z nazwy PL i przy kolizji dostaje sufiks (bez odrzucenia zapisu)", async () => {
    const client = scene({ slugTaken: (c) => c === "obszar-tematyczny" });
    await expect(run("upsertCategory", { fields: FIELDS }, client)).resolves.toEqual({
      id: CATEGORY_ID,
      slug: "obszar-tematyczny-2",
    });
    expect(
      firstArg(
        client.db.chainsFor("categories").find((c) => c.has("insert")),
        "insert",
      ),
    ).toMatchObject({ slug: "obszar-tematyczny-2", tenant_id: TENANT });
  });

  it("INSERT niesie tenant_id z serwera i wszystkie pola formularza", async () => {
    const client = scene();
    await run(
      "upsertCategory",
      {
        fields: {
          ...FIELDS,
          description_pl: "Opis obszaru",
          color: "#0a1b2c",
          kind: "region",
          logo_url: "https://example.com/logo.png",
        },
      },
      client,
    );
    expect(
      firstArg(
        client.db.chainsFor("categories").find((c) => c.has("insert")),
        "insert",
      ),
    ).toEqual({
      name_pl: "Obszar tematyczny",
      name_en: "Thematic area",
      description_pl: "Opis obszaru",
      color: "#0a1b2c",
      kind: "region",
      logo_url: "https://example.com/logo.png",
      slug: "obszar-tematyczny",
      tenant_id: TENANT,
    });
  });

  it("z podanym id to UPDATE po id, a nie kolejny INSERT", async () => {
    const client = scene();
    await expect(
      run("upsertCategory", { id: CATEGORY_ID, fields: FIELDS }, client),
    ).resolves.toEqual({ id: CATEGORY_ID, slug: "obszar-tematyczny" });
    const write = client.db.chainsFor("categories").find((c) => c.has("update"));
    expect(write?.argsOf("eq")).toEqual(["id", CATEGORY_ID]);
    expect(client.db.chainsFor("categories").filter((c) => c.has("insert"))).toHaveLength(0);
    expect(auditParams()).toMatchObject({
      action: "category.update",
      entityId: CATEGORY_ID,
      metadata: { slug: "obszar-tematyczny" },
    });
  });

  it("bez id audyt zapisuje tworzenie", async () => {
    const client = scene();
    await run("upsertCategory", { fields: FIELDS }, client);
    expect(auditParams()).toMatchObject({
      action: "category.create",
      entityType: "category",
      entityId: CATEGORY_ID,
    });
  });

  it("błąd zapisu propaguje w obu ścieżkach", async () => {
    await expect(
      run("upsertCategory", { fields: FIELDS }, scene({ written: fail("insert denied") })),
    ).rejects.toThrow("insert denied");
    await expect(
      run(
        "upsertCategory",
        { id: CATEGORY_ID, fields: FIELDS },
        scene({ written: fail("update denied") }),
      ),
    ).rejects.toThrow("update denied");
  });
});

// ---------------------------------------------------------------------------
// updateCategoryColor - handler poza bramką defektu K10
// ---------------------------------------------------------------------------

describe("updateCategoryColor", () => {
  function scene(result: SupabaseResult = ok(null)) {
    const client = contentClient();
    client.db.setResponse("categories", result);
    return client;
  }

  it("woła limiter z zakresem category.color i pułapem 120", async () => {
    const client = scene();
    await run("updateCategoryColor", { id: CATEGORY_ID, color: "#ff0055" }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "category.color", subjectId: USER, max: 120 });
  });

  it("zwraca zapisany kolor i zostawia go w śladzie audytu", async () => {
    const client = scene();
    await expect(
      run("updateCategoryColor", { id: CATEGORY_ID, color: "#ff0055" }, client),
    ).resolves.toEqual({ id: CATEGORY_ID, color: "#ff0055" });
    expect(auditParams()).toMatchObject({
      action: "category.update",
      entityId: CATEGORY_ID,
      metadata: { color: "#ff0055" },
    });
  });

  it("kolor null (powrót do domyślnej pigułki) też przechodzi", async () => {
    const client = scene();
    await expect(
      run("updateCategoryColor", { id: CATEGORY_ID, color: null }, client),
    ).resolves.toEqual({ id: CATEGORY_ID, color: null });
  });

  it("błąd bazy propaguje i NIE zostawia śladu audytu", async () => {
    const client = scene(fail("color update denied"));
    await expect(
      run("updateCategoryColor", { id: CATEGORY_ID, color: "#ff0055" }, client),
    ).rejects.toThrow("color update denied");
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteCategory / createTag / deleteTag
// ---------------------------------------------------------------------------

describe("deleteCategory", () => {
  function scene(result: SupabaseResult = ok([])) {
    const client = contentClient();
    client.db.setResponse("categories", result);
    return client;
  }

  it("usuwa TWARDO po id i zostawia ślad audytu", async () => {
    const client = scene();
    await expect(run("deleteCategory", { id: CATEGORY_ID }, client)).resolves.toEqual({ ok: true });
    const chain = client.db.lastChain("categories");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.argsOf("eq")).toEqual(["id", CATEGORY_ID]);
    expect(auditParams()).toMatchObject({
      action: "category.delete",
      entityType: "category",
      entityId: CATEGORY_ID,
    });
  });

  it("błąd bazy propaguje", async () => {
    const client = scene(fail("categories delete denied"));
    await expect(run("deleteCategory", { id: CATEGORY_ID }, client)).rejects.toThrow(
      "categories delete denied",
    );
  });

  // DEFEKT (nie naprawiamy w teście). Reszta modułu konsekwentnie dokłada
  // `.select("id")` do mutacji i sprawdza, czy wróciły wiersze - bo PostgREST
  // zwraca 0 wierszy z error=null, gdy RLS odfiltruje cel. Komentarz przy
  // `deletePost` mówi to wprost: „bez .select() klient widziałby »Usunięto«
  // przy nietkniętym wierszu". `deleteCategory` (i `deleteTag`) NIE ma tego
  // guardu ani `.select()`, więc odmowa polityki wraca do panelu jako
  // `{ ok: true }`: kategoria zostaje na liście po odświeżeniu, a redaktor
  // widział potwierdzenie. Ten sam brak dotyczy ścieżki UPDATE w
  // `upsertCategory`.
  it.fails("deleteCategory zgłasza cichą odmowę RLS jako błąd, nie jako sukces", async () => {
    const client = scene();
    await expect(run("deleteCategory", { id: CATEGORY_ID }, client)).rejects.toThrow(
      /permission|odmow/i,
    );
  });
});

describe("createTag", () => {
  function scene(
    opts: { slugTaken?: (candidate: string) => boolean; inserted?: SupabaseResult } = {},
  ) {
    const client = contentClient();
    client.db.setResponse("tags", (chain: RecordedChain): SupabaseResult => {
      if (chain.has("insert")) {
        return opts.inserted ?? ok({ id: TAG_ID, slug: "bezpieczenstwo", name: "Bezpieczeństwo" });
      }
      if (chain.has("limit")) {
        const candidate = chain.calls.filter((c) => c.method === "eq").at(-1)?.args[1];
        return opts.slugTaken?.(String(candidate)) ? ok([{ id: OTHER_POST_ID }]) : ok([]);
      }
      return ok([]);
    });
    return client;
  }

  it("woła limiter z zakresem tag.create i pułapem 120", async () => {
    const client = scene();
    await run("createTag", { name: "Bezpieczeństwo" }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "tag.create", subjectId: USER, max: 120 });
  });

  it("zapisuje nazwę PRZYCIĘTĄ, slug wyliczony i tenant z serwera", async () => {
    const client = scene();
    await expect(run("createTag", { name: "  Bezpieczeństwo  " }, client)).resolves.toEqual({
      id: TAG_ID,
      slug: "bezpieczenstwo",
      name: "Bezpieczeństwo",
    });
    expect(
      firstArg(
        client.db.chainsFor("tags").find((c) => c.has("insert")),
        "insert",
      ),
    ).toEqual({
      name: "Bezpieczeństwo",
      slug: "bezpieczenstwo",
      tenant_id: TENANT,
    });
  });

  it("kolizja slugu dokleja sufiks", async () => {
    const client = scene({ slugTaken: (c) => c === "bezpieczenstwo" });
    await run("createTag", { name: "Bezpieczeństwo" }, client);
    expect(
      firstArg(
        client.db.chainsFor("tags").find((c) => c.has("insert")),
        "insert",
      ).slug,
    ).toBe("bezpieczenstwo-2");
  });

  it("błąd INSERT-u propaguje, sukces zostawia ślad audytu", async () => {
    await expect(
      run("createTag", { name: "A" }, scene({ inserted: fail("tags insert denied") })),
    ).rejects.toThrow("tags insert denied");

    const client = scene();
    await run("createTag", { name: "Bezpieczeństwo" }, client);
    expect(auditParams()).toMatchObject({
      action: "tag.create",
      entityType: "tag",
      entityId: TAG_ID,
      metadata: { slug: "bezpieczenstwo" },
    });
  });
});

describe("deleteTag", () => {
  function scene(result: SupabaseResult = ok([])) {
    const client = contentClient();
    client.db.setResponse("tags", result);
    return client;
  }

  it("usuwa twardo po id i audytuje", async () => {
    const client = scene();
    await expect(run("deleteTag", { id: TAG_ID }, client)).resolves.toEqual({ ok: true });
    expect(client.db.lastChain("tags")?.has("delete")).toBe(true);
    expect(auditParams()).toMatchObject({ action: "tag.delete", entityId: TAG_ID });
  });

  it("błąd bazy propaguje", async () => {
    await expect(
      run("deleteTag", { id: TAG_ID }, scene(fail("tags delete denied"))),
    ).rejects.toThrow("tags delete denied");
  });

  // DEFEKT (nie naprawiamy w teście) - ten sam brak, co w `deleteCategory`:
  // brak `.select()` i brak kontroli liczby dotkniętych wierszy, więc odmowa
  // RLS wraca jako `{ ok: true }`.
  it.fails("deleteTag zgłasza cichą odmowę RLS jako błąd, nie jako sukces", async () => {
    const client = scene();
    await expect(run("deleteTag", { id: TAG_ID }, client)).rejects.toThrow(/permission|odmow/i);
  });
});

// ---------------------------------------------------------------------------
// setPostAuthors
// ---------------------------------------------------------------------------

describe("setPostAuthors", () => {
  const CO_AUTHOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  function scene(
    opts: {
      existingAuthor?: string | null;
      postFound?: boolean;
      postError?: string;
      profileIds?: readonly string[];
      profilesError?: string;
      touched?: SupabaseResult;
      canPublish?: boolean;
      authorsDelete?: SupabaseResult;
      authorsInsert?: SupabaseResult;
    } = {},
  ) {
    const known = opts.profileIds ?? [USER, CO_AUTHOR, OTHER_USER];
    const client = contentClient({ canPublish: opts.canPublish, profileIds: known });
    if (opts.profilesError) {
      client.db.setResponse("profiles", (chain) =>
        chain.has("maybeSingle") ? ok({ tenant_id: TENANT }) : fail(opts.profilesError ?? ""),
      );
    }
    client.db.setResponse("posts", (chain: RecordedChain): SupabaseResult => {
      if (chain.has("update"))
        return opts.touched ?? ok([{ id: POST_ID, updated_at: "2026-08-21T00:00:00.000Z" }]);
      if (opts.postError) return fail(opts.postError);
      return opts.postFound === false
        ? ok(null)
        : ok({ id: POST_ID, author_id: opts.existingAuthor ?? USER });
    });
    client.db.setResponse("post_authors", (chain: RecordedChain): SupabaseResult => {
      if (chain.has("insert")) return opts.authorsInsert ?? ok(null);
      return opts.authorsDelete ?? ok(null);
    });
    return client;
  }

  it("woła limiter z zakresem post.authors i pułapem 60", async () => {
    const client = scene();
    await run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "post.authors", subjectId: USER, max: 60 });
  });

  it("element [0] zostaje autorem GŁÓWNYM, reszta trafia do post_authors w kolejności", async () => {
    const client = scene();
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER, CO_AUTHOR, OTHER_USER] }, client),
    ).resolves.toEqual({ ok: true, updatedAt: "2026-08-21T00:00:00.000Z" });
    const patch = firstArg(
      client.db.chainsFor("posts").find((c) => c.has("update")),
      "update",
    );
    expect(patch.author_id).toBe(USER);
    const inserted = client.db.chainsFor("post_authors").find((c) => c.has("insert"));
    expect(inserted?.argsOf("insert")?.[0]).toEqual([
      { post_id: POST_ID, user_id: CO_AUTHOR, sort_order: 1 },
      { post_id: POST_ID, user_id: OTHER_USER, sort_order: 2 },
    ]);
  });

  it("duplikaty na liście są zwijane z zachowaniem kolejności wprowadzenia", async () => {
    const client = scene();
    await run("setPostAuthors", { id: POST_ID, authorIds: [USER, CO_AUTHOR, USER] }, client);
    const inserted = client.db.chainsFor("post_authors").find((c) => c.has("insert"));
    expect(inserted?.argsOf("insert")?.[0]).toEqual([
      { post_id: POST_ID, user_id: CO_AUTHOR, sort_order: 1 },
    ]);
  });

  it("sam autor główny nie generuje INSERT-u współautorów, ale CZYŚCI poprzednich", async () => {
    const client = scene();
    await run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client);
    const chains = client.db.chainsFor("post_authors");
    expect(chains.filter((c) => c.has("delete"))).toHaveLength(1);
    expect(chains.filter((c) => c.has("insert"))).toHaveLength(0);
  });

  it("wpis z innego obszaru roboczego = odmowa; błąd odczytu propaguje", async () => {
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, scene({ postFound: false })),
    ).rejects.toThrow("Post not found or access denied");
    await expect(
      run(
        "setPostAuthors",
        { id: POST_ID, authorIds: [USER] },
        scene({ postError: "post denied" }),
      ),
    ).rejects.toThrow("post denied");
  });

  it("czyta wpis z filtrem id ORAZ tenanta", async () => {
    const client = scene();
    await run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client);
    const read = client.db.chainsFor("posts").find((c) => c.has("maybeSingle"));
    expect(read?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", POST_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("autor z INNEGO obszaru roboczego jest odrzucany, zanim cokolwiek się zapisze", async () => {
    const client = scene({ profileIds: [USER] });
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER, CO_AUTHOR] }, client),
    ).rejects.toThrow("Author not found in this workspace");
    expect(client.db.chainsFor("posts").filter((c) => c.has("update"))).toHaveLength(0);
    expect(client.db.chainsFor("post_authors")).toHaveLength(0);
  });

  it("sprawdza przynależność autorów zapytaniem ZAWĘŻONYM tenantem", async () => {
    const client = scene();
    await run("setPostAuthors", { id: POST_ID, authorIds: [USER, CO_AUTHOR] }, client);
    const check = client.db.chainsFor("profiles").find((c) => c.has("in"));
    expect(check?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(check?.argsOf("in")).toEqual(["id", [USER, CO_AUTHOR]]);
  });

  it("błąd odczytu profili przerywa (nie zakłada, że autorzy są w porządku)", async () => {
    const client = scene({ profilesError: "profiles denied" });
    await expect(run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client)).rejects.toThrow(
      "profiles denied",
    );
  });

  it("zmiana autora GŁÓWNEGO jest zastrzeżona dla ról publikujących", async () => {
    const client = scene({ existingAuthor: OTHER_USER, canPublish: false });
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER, OTHER_USER] }, client),
    ).rejects.toThrow("Only an administrator can change the main author");
    expect(client.db.chainsFor("posts").filter((c) => c.has("update"))).toHaveLength(0);
  });

  it("z prawem publikacji zmiana autora głównego przechodzi i jest widoczna w audycie", async () => {
    const client = scene({ existingAuthor: OTHER_USER, canPublish: true });
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER, OTHER_USER] }, client),
    ).resolves.toMatchObject({ ok: true });
    expect(auditParams()).toMatchObject({
      action: "post.update",
      entityId: POST_ID,
      metadata: { authors: [USER, OTHER_USER], mainAuthorChanged: true },
    });
  });

  it("SAMA zmiana kolejności współautorów NIE wymaga prawa publikacji", async () => {
    const client = scene({ existingAuthor: USER, canPublish: false });
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER, CO_AUTHOR] }, client),
    ).resolves.toMatchObject({ ok: true });
    expect(client.rpcCalls).toHaveLength(0);
    expect(auditParams()).toMatchObject({ metadata: { mainAuthorChanged: false } });
  });

  it("cicha odmowa RLS na wpisie blokuje przepisanie autorów", async () => {
    const client = scene({ touched: ok([]) });
    await expect(run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client)).rejects.toThrow(
      "you do not have permission to edit this post",
    );
    expect(client.db.chainsFor("post_authors")).toHaveLength(0);
  });

  it("odczyt profili z data:null nie jest czytany jako autorzy w porzadku", async () => {
    const client = scene();
    client.db.setResponse("profiles", (chain) =>
      chain.has("maybeSingle") ? ok({ tenant_id: TENANT }) : ok(null),
    );
    await expect(run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client)).rejects.toThrow(
      "Author not found in this workspace",
    );
  });

  it("wpis sprzed triggera updated_at zwraca updatedAt null, nie undefined", async () => {
    const client = scene({ touched: ok([{ id: POST_ID, updated_at: null }]) });
    await expect(
      run("setPostAuthors", { id: POST_ID, authorIds: [USER] }, client),
    ).resolves.toEqual({ ok: true, updatedAt: null });
  });

  it("błędy zapisu propagują z każdego z trzech kroków", async () => {
    await expect(
      run(
        "setPostAuthors",
        { id: POST_ID, authorIds: [USER] },
        scene({ touched: fail("touch denied") }),
      ),
    ).rejects.toThrow("touch denied");
    await expect(
      run(
        "setPostAuthors",
        { id: POST_ID, authorIds: [USER] },
        scene({ authorsDelete: fail("authors delete denied") }),
      ),
    ).rejects.toThrow("authors delete denied");
    await expect(
      run(
        "setPostAuthors",
        { id: POST_ID, authorIds: [USER, CO_AUTHOR] },
        scene({ authorsInsert: fail("authors insert denied") }),
      ),
    ).rejects.toThrow("authors insert denied");
  });
});
