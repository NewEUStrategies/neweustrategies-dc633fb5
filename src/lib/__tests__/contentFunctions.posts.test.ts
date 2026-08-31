// Wpisy POZA `updatePost`: `createPost`, `deletePost`, `duplicatePost` oraz
// cztery ścieżki hurtowe (kosz, przywrócenie, trwałe usunięcie, zmiana statusu).
//
// CO MA TU DOWÓD:
//   1. `createPost` zawsze podwiesza wpis pod stronę-rodzica - a gdy domyślnej
//      strony „blog" nie ma, TWORZY ją, zamiast zapisać wpis-sierotę bez
//      permalinku,
//   2. cicha odmowa RLS (0 wierszy, error=null) jest RAPORTOWANA: pojedyncze
//      usunięcie rzuca wyjątkiem, hurt zwraca UCZCIWY `count` obok `requested`,
//      więc panel pokazuje częściowe niepowodzenie zamiast „zrobiono N",
//   3. `duplicatePost` kopiuje to, co ma kopiować, i NIE kopiuje tego, co
//      zafałszowałoby nowy byt (kanoniczny URL, karta OG, lektor, numer
//      zlecenia, daty publikacji) - a ujawnienie sponsoringu kopiuje ŚWIADOMIE,
//   4. `bulkUpdatePosts` egzekwuje TE SAME bramki co zapis pojedynczy: prawo
//      publikacji i kompletność deklaracji komercyjnej,
//   5. `applyBulkStatus` publikuje DWOMA filtrowanymi UPDATE-ami (reguła
//      pierwszej publikacji) i DE-DUPLIKUJE wynik - inaczej licznik dotkniętych
//      wierszy byłby zawyżony i psuł kontrolę częściowej odmowy RLS.
//
// CZEGO TU NIE MA. Walidatorów (osobny plik `contentFunctions.schemas`),
// `updatePost` (osobny plik) i samego RLS-a (pgTAP w `supabase/tests`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORY_ID,
  OTHER_POST_ID,
  OTHER_USER,
  PARENT_PAGE_ID,
  POST_ID,
  TAG_ID,
  TEMPLATE_ID,
  TENANT,
  USER,
  contentClient,
  entityTable,
  fail,
  ok,
  postRow,
  type ContentClient,
  type ServerFnSpec,
} from "./contentFunctionsHarness";
import type { SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("./contentFunctionsHarness");
  return { createServerFn: createServerFnStub, createMiddleware: () => ({}) };
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
vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const admin = supabaseFromStub();
  server.admin = admin;
  return { supabaseAdmin: { from: admin.from } };
});

// Importy STATYCZNE atrapowanych modułów, choć produkcyjny kod sięga po
// `client.server` LENIWIE (dynamiczny `await import` w handlerze). Fabryka
// `vi.mock` jest leniwa: bez tej linijki atrapa nie istniałaby jeszcze w chwili,
// gdy `beforeEach` próbuje ją wyzerować.
import { rateLimit as rateLimitFn } from "@/lib/server/rate-limit.server";
import { recordAudit as recordAuditFn } from "@/lib/server/audit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const rateLimit = rateLimitFn as unknown as ReturnType<typeof vi.fn>;
const recordAudit = recordAuditFn as unknown as ReturnType<typeof vi.fn>;
const admin = server.admin as SupabaseFromStub;

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

/** Pierwszy argument INSERT-u dla danej tabeli - bez wygładzania kształtu. */
function insertedPayload(db: SupabaseFromStub, table: string): unknown {
  const chain = db.chainsFor(table).find((c) => c.has("insert"));
  return chain?.argsOf("insert")?.[0];
}

/** INSERT jednego wiersza (`posts`, `pages`). */
function insertedRow(db: SupabaseFromStub, table: string): Record<string, unknown> {
  const value = insertedPayload(db, table);
  return isRecord(value) ? value : {};
}

/** INSERT tablicy wierszy (tabele relacji taksonomii i autorów). */
function insertedRows(db: SupabaseFromStub, table: string): Array<Record<string, unknown>> {
  const value = insertedPayload(db, table);
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

beforeEach(() => {
  admin.reset();
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
  recordAudit.mockReset();
  recordAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// createPost
// ---------------------------------------------------------------------------

describe("createPost", () => {
  function scene(
    opts: {
      blogPage?: SupabaseResult;
      pagesInsert?: SupabaseResult;
      postsInsert?: SupabaseResult;
      slugTaken?: (candidate: string) => boolean;
    } = {},
  ) {
    const client = contentClient();
    client.db.setResponse(
      "posts",
      entityTable({
        slugTaken: opts.slugTaken,
        inserted: opts.postsInsert ?? ok({ id: POST_ID, slug: "nowy-wpis" }),
      }),
    );
    client.db.setResponse("pages", (chain) =>
      chain.has("insert")
        ? (opts.pagesInsert ?? ok({ id: PARENT_PAGE_ID }))
        : (opts.blogPage ?? ok({ id: PARENT_PAGE_ID })),
    );
    return client;
  }

  it("woła limiter z zakresem post.create i pułapem 30", async () => {
    const client = scene();
    await run("createPost", { title_pl: "Nowy wpis" }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "post.create", subjectId: USER, max: 30 });
  });

  it("przekroczony limit rzuca i nie tworzy wpisu", async () => {
    rateLimit.mockResolvedValue(false);
    const client = scene();
    await expect(run("createPost", { title_pl: "A" }, client)).rejects.toThrow(
      "Rate limit exceeded",
    );
    expect(client.db.chainsFor("posts")).toHaveLength(0);
  });

  it("slug bierze z tytułu PL, a INSERT startuje w edytorze blokowym z pustym dokumentem", async () => {
    const client = scene();
    await expect(run("createPost", { title_pl: "Nowy wpis" }, client)).resolves.toEqual({
      id: POST_ID,
      slug: "nowy-wpis",
    });
    expect(insertedRow(client.db, "posts")).toMatchObject({
      tenant_id: TENANT,
      author_id: USER,
      slug: "nowy-wpis",
      title_pl: "Nowy wpis",
      title_en: "",
      parent_page_id: PARENT_PAGE_ID,
      template_id: null,
      editor: "blocks",
      blocks_data: { pl: { version: 1, blocks: [] }, en: { version: 1, blocks: [] } },
    });
  });

  it("gdy nie ma tytułu PL, slug bierze z EN; bez żadnego - z sygnatury czasu", async () => {
    const en = scene();
    await run("createPost", { title_en: "English title" }, en);
    expect(insertedRow(en.db, "posts").slug).toBe("english-title");

    const bez = scene();
    await run("createPost", {}, bez);
    expect(String(insertedRow(bez.db, "posts").slug)).toMatch(/^post-[0-9a-z]+$/);
  });

  it("tytuł bez ANI JEDNEJ litery lub cyfry daje slug awaryjny item", async () => {
    const client = scene();
    await run("createPost", { title_pl: "###" }, client);
    expect(insertedRow(client.db, "posts").slug).toBe("item");
  });

  it("kolizja slugu dokleja sufiks numeryczny", async () => {
    const client = scene({ slugTaken: (c) => c === "nowy-wpis" });
    await run("createPost", { title_pl: "Nowy wpis" }, client);
    expect(insertedRow(client.db, "posts").slug).toBe("nowy-wpis-2");
  });

  it("jawny parent_page_id NIE odpytuje o domyślną stronę bloga", async () => {
    const client = scene();
    await run(
      "createPost",
      { title_pl: "A", parent_page_id: OTHER_POST_ID, template_id: TEMPLATE_ID },
      client,
    );
    expect(client.db.chainsFor("pages")).toHaveLength(0);
    expect(insertedRow(client.db, "posts")).toMatchObject({
      parent_page_id: OTHER_POST_ID,
      template_id: TEMPLATE_ID,
    });
  });

  it("brak strony blog powoduje jej UTWORZENIE (wpis nie zostaje sierotą)", async () => {
    const client = scene({ blogPage: ok(null) });
    await run("createPost", { title_pl: "A" }, client);
    expect(insertedRow(client.db, "pages")).toMatchObject({
      tenant_id: TENANT,
      author_id: USER,
      slug: "blog",
      title_pl: "Blog",
      title_en: "Blog",
      status: "published",
    });
    expect(insertedRow(client.db, "posts").parent_page_id).toBe(PARENT_PAGE_ID);
  });

  it("szuka strony blog w tym tenancie i tylko na najwyższym poziomie", async () => {
    const client = scene();
    await run("createPost", { title_pl: "A" }, client);
    const chain = client.db.lastChain("pages");
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["tenant_id", TENANT],
      ["slug", "blog"],
    ]);
    expect(chain?.argsOf("is")).toEqual(["parent_id", null]);
  });

  it("nieudane utworzenie strony bloga przerywa tworzenie wpisu", async () => {
    const client = scene({ blogPage: ok(null), pagesInsert: fail("pages insert denied") });
    await expect(run("createPost", { title_pl: "A" }, client)).rejects.toThrow(
      "pages insert denied",
    );
    expect(client.db.chainsFor("posts").filter((c) => c.has("insert"))).toHaveLength(0);
  });

  it("błąd INSERT-u wpisu propaguje komunikatem bazy", async () => {
    const client = scene({ postsInsert: fail("posts_tenant_slug_key") });
    await expect(run("createPost", { title_pl: "A" }, client)).rejects.toThrow(
      "posts_tenant_slug_key",
    );
  });

  it("zostawia ślad audytu post.create ze slugiem", async () => {
    const client = scene();
    await run("createPost", { title_pl: "Nowy wpis" }, client);
    expect(auditParams()).toMatchObject({
      tenantId: TENANT,
      action: "post.create",
      entityType: "post",
      entityId: POST_ID,
      metadata: { slug: "nowy-wpis" },
    });
  });
});

// ---------------------------------------------------------------------------
// deletePost
// ---------------------------------------------------------------------------

describe("deletePost", () => {
  function scene(deleted: SupabaseResult = ok([{ id: POST_ID }])) {
    const client = contentClient();
    client.db.setResponse("posts", entityTable({ updated: deleted }));
    return client;
  }

  it("to SOFT delete: stempluje deleted_at, nie usuwa wiersza", async () => {
    const client = scene();
    await expect(run("deletePost", { id: POST_ID }, client)).resolves.toEqual({ ok: true });
    const chain = client.db.lastChain("posts");
    expect(chain?.has("delete")).toBe(false);
    const patch = chain?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["deleted_at"]);
    expect(typeof patch.deleted_at).toBe("string");
  });

  it("0 wierszy przy error=null to CICHA odmowa RLS - musi rzucić", async () => {
    const client = scene(ok([]));
    await expect(run("deletePost", { id: POST_ID }, client)).rejects.toThrow(
      "you do not have permission to delete this post",
    );
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("błąd bazy propaguje", async () => {
    const client = scene(fail("delete denied"));
    await expect(run("deletePost", { id: POST_ID }, client)).rejects.toThrow("delete denied");
  });

  it("zostawia ślad audytu z oznaczeniem miękkiego usunięcia", async () => {
    const client = scene();
    await run("deletePost", { id: POST_ID }, client);
    expect(auditParams()).toMatchObject({
      action: "post.delete",
      entityType: "post",
      entityId: POST_ID,
      metadata: { soft: true },
    });
  });

  // DEFEKT (nie naprawiamy w teście): nagłówek modułu deklaruje, że KAŻDE
  // wywołanie „is rate-limited per user", a pozostałe 17 funkcji owija swój
  // handler w `guard(...)`. Cztery tego nie robią: `deletePost`, `deletePage`,
  // `deleteCategory`, `deleteTag`. Skutek nie jest kosmetyczny: usuwanie to
  // jedyna operacja, której skutek jest trwały, a pętla po `ids` z klienta
  // (albo zapętlony panel) nie ma tu żadnego hamulca poza RLS - ścieżki
  // hurtowe (`bulkDeletePosts` i spółka) limit MAJĄ, więc obejściem limitu
  // jest po prostu wołanie wersji pojedynczej.
  it.fails("deletePost przechodzi przez bramkę rate limit jak pozostałe mutacje", async () => {
    rateLimit.mockResolvedValue(false);
    const client = scene();
    await expect(run("deletePost", { id: POST_ID }, client)).rejects.toThrow("Rate limit exceeded");
  });
});

// ---------------------------------------------------------------------------
// duplicatePost
// ---------------------------------------------------------------------------

describe("duplicatePost", () => {
  const NEW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  function scene(
    opts: {
      meta?: SupabaseResult;
      src?: Record<string, unknown> | null;
      srcError?: string;
      inserted?: SupabaseResult;
      relations?: Partial<Record<string, SupabaseResult>>;
      srcAsSingleObject?: boolean;
    } = {},
  ) {
    const client = contentClient();
    const src = opts.src === undefined ? postRow({ slug: "zrodlo" }) : opts.src;
    client.db.setResponse(
      "posts",
      entityTable({
        meta: opts.meta ?? ok({ id: POST_ID, slug: "zrodlo" }),
        inserted: opts.inserted ?? ok({ id: NEW_ID, slug: "zrodlo-kopia" }),
      }),
    );
    client.setRpc("get_post_for_edit", () => {
      if (opts.srcError) return fail(opts.srcError);
      if (src === null) return ok([]);
      return ok(opts.srcAsSingleObject ? src : [src]);
    });
    const columns: Record<string, string> = {
      post_categories: "category_id",
      post_tags: "tag_id",
      post_programs: "program_id",
      post_regions: "region_id",
    };
    for (const [table, column] of Object.entries(columns)) {
      client.db.setResponse(table, (chain) =>
        chain.has("insert")
          ? (opts.relations?.[table] ?? ok(null))
          : ok([{ [column]: table === "post_tags" ? TAG_ID : CATEGORY_ID }]),
      );
    }
    client.db.setResponse("post_authors", (chain) =>
      chain.has("insert")
        ? (opts.relations?.post_authors ?? ok(null))
        : ok([{ user_id: OTHER_USER, sort_order: 1 }]),
    );
    return client;
  }

  it("czyta metadane z filtrem tenanta i POMIJA wpisy w koszu", async () => {
    const client = scene();
    await run("duplicatePost", { id: POST_ID }, client);
    const meta = client.db.chainsFor("posts").find((c) => c.has("maybeSingle"));
    expect(meta?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", POST_ID],
      ["tenant_id", TENANT],
    ]);
    expect(meta?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("brak metadanych = brak kopii", async () => {
    const client = scene({ meta: ok(null) });
    await expect(run("duplicatePost", { id: POST_ID }, client)).rejects.toThrow("Post not found");
  });

  it("błąd odczytu metadanych propaguje", async () => {
    const client = scene({ meta: fail("meta denied") });
    await expect(run("duplicatePost", { id: POST_ID }, client)).rejects.toThrow("meta denied");
  });

  it("treść czyta przez SECURITY DEFINER get_post_for_edit (kolumny ciała są odcięte)", async () => {
    const client = scene();
    await run("duplicatePost", { id: POST_ID }, client);
    expect(client.rpcCalls).toContainEqual({
      fn: "get_post_for_edit",
      args: { _slug: "zrodlo" },
    });
  });

  it("błąd RPC treści propaguje, pusty wynik RPC to brak wpisu", async () => {
    await expect(
      run("duplicatePost", { id: POST_ID }, scene({ srcError: "rpc denied" })),
    ).rejects.toThrow("rpc denied");
    await expect(run("duplicatePost", { id: POST_ID }, scene({ src: null }))).rejects.toThrow(
      "Post not found",
    );
  });

  it("znosi wynik RPC podany jako POJEDYNCZY obiekt, nie tablica", async () => {
    const client = scene({ srcAsSingleObject: true });
    await expect(run("duplicatePost", { id: POST_ID }, client)).resolves.toEqual({
      id: NEW_ID,
      slug: "zrodlo-kopia",
    });
  });

  it("kopia startuje jako SZKIC, z oznaczonymi tytułami i nowym slugiem", async () => {
    const client = scene({
      src: postRow({
        slug: "zrodlo",
        status: "published",
        published_at: "2026-01-01T00:00:00.000Z",
        publish_at: "2026-01-02T00:00:00.000Z",
        title_pl: "Analiza",
        title_en: "Analysis",
      }),
    });
    await run("duplicatePost", { id: POST_ID }, client);
    const payload = insertedRow(client.db, "posts");
    expect(payload).toMatchObject({
      status: "draft",
      slug: "zrodlo-kopia",
      title_pl: "Analiza (kopia)",
      title_en: "Analysis (copy)",
      author_id: USER,
      tenant_id: TENANT,
    });
    expect(payload).not.toHaveProperty("published_at");
    expect(payload).not.toHaveProperty("publish_at");
  });

  it("puste tytuły zostają puste, bez samotnego (kopia)", async () => {
    const client = scene({ src: postRow({ slug: "zrodlo", title_pl: "", title_en: "" }) });
    await run("duplicatePost", { id: POST_ID }, client);
    expect(insertedRow(client.db, "posts")).toMatchObject({ title_pl: "", title_en: "" });
  });

  it("NIE kopiuje pól, które zafałszowałyby nowy byt", async () => {
    const client = scene({
      src: postRow({
        slug: "zrodlo",
        seo_canonical_url: "https://example.com/oryginal",
        og_image_generated_url: "https://example.com/og.png",
        audio_url_pl: "https://example.com/a.mp3",
        audio_url_en: "https://example.com/b.mp3",
        sponsored_order_ref: "ZL-2026-001",
      }),
    });
    await run("duplicatePost", { id: POST_ID }, client);
    const payload = insertedRow(client.db, "posts");
    for (const key of [
      "seo_canonical_url",
      "og_image_generated_url",
      "audio_url_pl",
      "audio_url_en",
      "sponsored_order_ref",
    ]) {
      expect(payload, key).not.toHaveProperty(key);
    }
    expect(JSON.stringify(payload)).not.toContain("ZL-2026-001");
  });

  it("ŚWIADOMIE kopiuje ujawnienie sponsoringu i przepisuje deklarację na duplikującego", async () => {
    const client = scene({
      src: postRow({
        slug: "zrodlo",
        is_sponsored: true,
        sponsored_kind: "advertisement",
        sponsored_advertiser_name: "Fundacja Przykład",
        sponsored_advertiser_url: "https://example.org/fundacja",
        sponsored_marked_by: OTHER_USER,
        sponsored_marked_at: "2026-01-01T00:00:00.000Z",
      }),
    });
    await run("duplicatePost", { id: POST_ID }, client);
    const payload = insertedRow(client.db, "posts");
    expect(payload).toMatchObject({
      is_sponsored: true,
      sponsored_kind: "advertisement",
      sponsored_advertiser_name: "Fundacja Przykład",
      sponsored_marked_by: USER,
    });
    expect(typeof payload.sponsored_marked_at).toBe("string");
    expect(payload.sponsored_marked_at).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("materiał NIEoznaczony nie dostaje śladu deklaracji", async () => {
    const client = scene();
    await run("duplicatePost", { id: POST_ID }, client);
    expect(insertedRow(client.db, "posts")).toMatchObject({
      sponsored_marked_by: null,
      sponsored_marked_at: null,
    });
  });

  it("przenosi taksonomie i współautorów 1:1", async () => {
    const client = scene();
    await run("duplicatePost", { id: POST_ID }, client);
    expect(insertedRows(client.db, "post_categories")).toEqual([
      { post_id: NEW_ID, category_id: CATEGORY_ID },
    ]);
    expect(insertedRows(client.db, "post_tags")).toEqual([{ post_id: NEW_ID, tag_id: TAG_ID }]);
    expect(insertedRows(client.db, "post_authors")).toEqual([
      { post_id: NEW_ID, user_id: OTHER_USER, sort_order: 1 },
    ]);
  });

  it("brak relacji do skopiowania = brak insertów relacji", async () => {
    const client = scene();
    for (const table of [
      "post_categories",
      "post_tags",
      "post_programs",
      "post_regions",
      "post_authors",
    ]) {
      client.db.setResponse(table, ok([]));
    }
    await run("duplicatePost", { id: POST_ID }, client);
    expect(client.db.chainsFor("post_categories").filter((c) => c.has("insert"))).toHaveLength(0);
  });

  it("awaria kopiowania relacji NIE zostaje cicha", async () => {
    const client = scene({ relations: { post_tags: fail("post_tags copy denied") } });
    await expect(run("duplicatePost", { id: POST_ID }, client)).rejects.toThrow(
      "post_tags copy denied",
    );
  });

  it("błąd INSERT-u kopii propaguje", async () => {
    const client = scene({ inserted: fail("insert denied") });
    await expect(run("duplicatePost", { id: POST_ID }, client)).rejects.toThrow("insert denied");
  });

  it("zostawia ślad audytu wskazujący oryginał", async () => {
    const client = scene();
    await run("duplicatePost", { id: POST_ID }, client);
    expect(auditParams()).toMatchObject({
      action: "post.duplicate",
      entityId: NEW_ID,
      metadata: { from: POST_ID, slug: "zrodlo-kopia" },
    });
  });

  it("woła limiter z zakresem post.duplicate i pułapem 20", async () => {
    const client = scene();
    await run("duplicatePost", { id: POST_ID }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "post.duplicate", subjectId: USER, max: 20 });
  });
});

// ---------------------------------------------------------------------------
// Ścieżki hurtowe kosza
// ---------------------------------------------------------------------------

describe("kosz i trwałe usuwanie hurtem", () => {
  const IDS = [POST_ID, OTHER_POST_ID];

  function scene(deleted: SupabaseResult) {
    const client = contentClient();
    client.db.setResponse("posts", entityTable({ deleted, bulkPlain: deleted }));
    return client;
  }

  it("bulkDeletePosts stempluje deleted_at i raportuje UCZCIWY licznik", async () => {
    const client = scene(ok([{ id: POST_ID }]));
    await expect(run("bulkDeletePosts", { ids: IDS }, client)).resolves.toEqual({
      ok: true,
      count: 1,
      requested: 2,
    });
    const patch = client.db.lastChain("posts")?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["deleted_at"]);
    expect(auditParams()).toMatchObject({
      action: "post.delete",
      entityId: null,
      metadata: { ids: [POST_ID], count: 1, requested: 2, soft: true },
    });
  });

  it("zero dotkniętych wierszy NIE produkuje wpisu audytu (nie było czego zapisać)", async () => {
    const client = scene(ok([]));
    await expect(run("bulkDeletePosts", { ids: IDS }, client)).resolves.toEqual({
      ok: true,
      count: 0,
      requested: 2,
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("restorePosts zeruje deleted_at i audytuje przywrócenie", async () => {
    const client = scene(ok([{ id: POST_ID }]));
    await run("restorePosts", { ids: IDS }, client);
    expect(client.db.lastChain("posts")?.argsOf("update")).toEqual([{ deleted_at: null }]);
    expect(auditParams()).toMatchObject({
      action: "post.update",
      metadata: { ids: [POST_ID], restored: true },
    });
  });

  it("purgePosts usuwa wiersz TWARDO", async () => {
    const client = scene(ok([{ id: POST_ID }]));
    await run("purgePosts", { ids: IDS }, client);
    const chain = client.db.lastChain("posts");
    expect(chain?.has("delete")).toBe(true);
    expect(chain?.has("update")).toBe(false);
    expect(auditParams()).toMatchObject({
      action: "post.delete",
      metadata: { ids: [POST_ID], purged: true },
    });
  });

  it("błąd bazy propaguje w każdej z trzech ścieżek", async () => {
    for (const name of ["bulkDeletePosts", "restorePosts", "purgePosts"]) {
      const client = scene(fail(`${name} denied`));
      await expect(run(name, { ids: IDS }, client), name).rejects.toThrow(`${name} denied`);
    }
  });

  it("każda ścieżka ma własny zakres limitu z pułapem 20", async () => {
    const scopes: Array<[string, string]> = [
      ["bulkDeletePosts", "post.bulkDelete"],
      ["restorePosts", "post.restore"],
      ["purgePosts", "post.purge"],
      ["bulkUpdatePosts", "post.bulkUpdate"],
    ];
    for (const [name, scope] of scopes) {
      rateLimit.mockClear();
      const client = scene(ok([{ id: POST_ID }]));
      await run(name, { ids: IDS, status: "draft" }, client);
      expect(rateLimit, name).toHaveBeenCalledWith({ scope, subjectId: USER, max: 20 });
    }
  });
});

// ---------------------------------------------------------------------------
// bulkUpdatePosts + applyBulkStatus
// ---------------------------------------------------------------------------

describe("bulkUpdatePosts", () => {
  const IDS = [POST_ID, OTHER_POST_ID];

  function scene(
    opts: {
      canPublish?: boolean;
      stamped?: SupabaseResult;
      kept?: SupabaseResult;
      plain?: SupabaseResult;
      adminRows?: Array<Record<string, unknown>>;
      adminError?: string;
    } = {},
  ) {
    const client = contentClient({ canPublish: opts.canPublish });
    client.db.setResponse(
      "posts",
      entityTable({
        bulkStamped: opts.stamped ?? ok([{ id: POST_ID }]),
        bulkKept: opts.kept ?? ok([{ id: OTHER_POST_ID }]),
        bulkPlain: opts.plain ?? ok([{ id: POST_ID }, { id: OTHER_POST_ID }]),
      }),
    );
    admin.setResponse(
      "posts",
      opts.adminError
        ? fail(opts.adminError)
        : ok(
            opts.adminRows ?? [
              { id: POST_ID, slug: "a", is_sponsored: false },
              { id: OTHER_POST_ID, slug: "b", is_sponsored: false },
            ],
          ),
    );
    return client;
  }

  it("ścieżka nie-published to JEDEN filtrowany UPDATE", async () => {
    const client = scene();
    await expect(run("bulkUpdatePosts", { ids: IDS, status: "archived" }, client)).resolves.toEqual(
      {
        ok: true,
        count: 2,
        requested: 2,
      },
    );
    const chains = client.db.chainsFor("posts").filter((c) => c.has("update"));
    expect(chains).toHaveLength(1);
    expect(chains[0].argsOf("update")).toEqual([{ status: "archived" }]);
    expect(chains[0].argsOf("in")).toEqual(["id", IDS]);
    expect(auditParams()).toMatchObject({
      action: "post.update",
      metadata: { ids: IDS, status: "archived", requested: 2 },
    });
  });

  it("publikacja hurtowa to DWA filtrowane UPDATE-y - stempluje tylko nigdy nieopublikowane", async () => {
    const client = scene();
    await run("bulkUpdatePosts", { ids: IDS, status: "published" }, client);
    const chains = client.db.chainsFor("posts").filter((c) => c.has("update"));
    expect(chains).toHaveLength(2);
    const stamping = chains.find((c) => c.has("is"));
    expect(stamping?.argsOf("is")).toEqual(["published_at", null]);
    expect(Object.keys(stamping?.argsOf("update")?.[0] as object).sort()).toEqual([
      "published_at",
      "status",
    ]);
    const keeping = chains.find((c) => c.has("not"));
    expect(keeping?.argsOf("not")).toEqual(["published_at", "is", null]);
    expect(keeping?.argsOf("update")).toEqual([{ status: "published" }]);
    expect(auditParams()).toMatchObject({ action: "post.publish" });
  });

  it("DE-DUPLIKUJE wynik: wiersz ostemplowany pierwszym UPDATE-em wraca też w drugim", async () => {
    // Pierwszy UPDATE commituje się PRZED drugim, więc jego wiersze spełniają
    // już filtr `published_at IS NOT NULL`. Bez zbioru licznik byłby zawyżony,
    // a kontrola częściowej odmowy RLS (count vs requested) przestałaby działać.
    const client = scene({
      stamped: ok([{ id: POST_ID }]),
      kept: ok([{ id: POST_ID }, { id: OTHER_POST_ID }]),
    });
    await expect(
      run("bulkUpdatePosts", { ids: IDS, status: "published" }, client),
    ).resolves.toEqual({ ok: true, count: 2, requested: 2 });
  });

  it("błąd któregokolwiek z dwóch UPDATE-ów przerywa operację", async () => {
    await expect(
      run(
        "bulkUpdatePosts",
        { ids: IDS, status: "published" },
        scene({ stamped: fail("stamp denied") }),
      ),
    ).rejects.toThrow("stamp denied");
    await expect(
      run(
        "bulkUpdatePosts",
        { ids: IDS, status: "published" },
        scene({ kept: fail("keep denied") }),
      ),
    ).rejects.toThrow("keep denied");
    await expect(
      run("bulkUpdatePosts", { ids: IDS, status: "draft" }, scene({ plain: fail("plain denied") })),
    ).rejects.toThrow("plain denied");
  });

  it("bez prawa publikacji hurt publikujący jest odrzucany PRZED zapisem", async () => {
    const client = scene({ canPublish: false });
    await expect(run("bulkUpdatePosts", { ids: IDS, status: "published" }, client)).rejects.toThrow(
      "only an administrator can publish - submit for review instead",
    );
    expect(client.db.chainsFor("posts")).toHaveLength(0);
  });

  it("hurt NIEpublikujący nie pyta o prawo publikacji", async () => {
    const client = scene({ canPublish: false });
    await expect(
      run("bulkUpdatePosts", { ids: IDS, status: "pending_review" }, client),
    ).resolves.toMatchObject({ ok: true });
    expect(client.rpcCalls).toHaveLength(0);
  });

  it("bramka ujawnienia obowiązuje TAKŻE hurt i odrzuca CAŁĄ operację", async () => {
    const client = scene({
      adminRows: [
        { id: POST_ID, slug: "wpis-a", is_sponsored: false },
        {
          id: OTHER_POST_ID,
          slug: "wpis-b",
          is_sponsored: true,
          sponsored_kind: "sponsored",
          sponsored_advertiser_name: null,
          sponsored_advertiser_url: null,
        },
      ],
    });
    await expect(run("bulkUpdatePosts", { ids: IDS, status: "published" }, client)).rejects.toThrow(
      "sponsored_disclosure_incomplete:bulk:wpis-b",
    );
    // Kluczowe: ani jeden wiersz nie został opublikowany.
    expect(client.db.chainsFor("posts")).toHaveLength(0);
  });

  it("kontrola deklaracji czyta przez service_role z filtrem tenanta", async () => {
    const client = scene();
    await run("bulkUpdatePosts", { ids: IDS, status: "published" }, client);
    const chain = admin.lastChain("posts");
    expect(chain?.argsOf("in")).toEqual(["id", IDS]);
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
  });

  it("błąd odczytu deklaracji przerywa hurt, nie publikuje w ciemno", async () => {
    const client = scene({ adminError: "disclosure read denied" });
    await expect(run("bulkUpdatePosts", { ids: IDS, status: "published" }, client)).rejects.toThrow(
      "disclosure read denied",
    );
  });

  it("zero dotkniętych wierszy nie produkuje audytu", async () => {
    const client = scene({ plain: ok([]) });
    await expect(run("bulkUpdatePosts", { ids: IDS, status: "draft" }, client)).resolves.toEqual({
      ok: true,
      count: 0,
      requested: 2,
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Odporność na nietypowe, ale legalne odpowiedzi PostgREST.
// ---------------------------------------------------------------------------

describe("odporność na data:null", () => {
  const IDS = [POST_ID, OTHER_POST_ID];

  it("hurt z data:null raportuje 0 dotkniętych wierszy, a nie awarię", async () => {
    for (const name of ["bulkDeletePosts", "restorePosts", "purgePosts"]) {
      recordAudit.mockClear();
      const client = contentClient();
      client.db.setResponse("posts", entityTable({ deleted: ok(null) }));
      await expect(run(name, { ids: IDS }, client), name).resolves.toEqual({
        ok: true,
        count: 0,
        requested: 2,
      });
      expect(recordAudit, name).not.toHaveBeenCalled();
    }
  });

  it("applyBulkStatus znosi data:null na obu ścieżkach", async () => {
    const prosta = contentClient();
    prosta.db.setResponse("posts", entityTable({ bulkPlain: ok(null) }));
    await expect(run("bulkUpdatePosts", { ids: IDS, status: "draft" }, prosta)).resolves.toEqual({
      ok: true,
      count: 0,
      requested: 2,
    });

    const publikacja = contentClient();
    publikacja.db.setResponse("posts", entityTable({ bulkStamped: ok(null), bulkKept: ok(null) }));
    admin.setResponse("posts", ok(null));
    await expect(
      run("bulkUpdatePosts", { ids: IDS, status: "published" }, publikacja),
    ).resolves.toEqual({ ok: true, count: 0, requested: 2 });
  });

  it("brak wiersza po INSERCIE strony bloga daje czytelny komunikat, nie undefined", async () => {
    const client = contentClient();
    client.db.setResponse("posts", entityTable({ inserted: ok({ id: POST_ID, slug: "a" }) }));
    // INSERT bez błędu i bez wiersza: PostgREST tak odpowiada, gdy RLS
    // odfiltruje `RETURNING`.
    client.db.setResponse("pages", (chain) => (chain.has("insert") ? ok(null) : ok(null)));
    await expect(run("createPost", { title_pl: "A" }, client)).rejects.toThrow(
      "Cannot create default blog page",
    );
  });
});

// Kontrola higieny atrap: `supabaseAdmin` w kodzie produkcyjnym musi być TĄ
// atrapą, po której testy `bulkUpdatePosts` czytają zapisane łańcuchy.
describe("higiena atrap", () => {
  it("supabaseAdmin to ta sama atrapa, którą czytają testy", () => {
    expect(supabaseAdmin.from).toBe(admin.from);
  });
});
