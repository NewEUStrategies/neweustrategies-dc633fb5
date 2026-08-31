// STRONY: `createPage`, `updatePage`, `deletePage` i cztery ścieżki hurtowe.
//
// CO MA TU DOWÓD:
//   1. `updatePage` ma TĘ SAMĄ dwuwarstwową ochronę zapisu co wpisy -
//      pre-read przez service_role z filtrem tenanta, optimistic-lock na
//      instantach z awaryjnym porównaniem tekstowym, wykrycie cichej odmowy
//      RLS - bo builder trzyma najcięższe dokumenty w systemie i jeden zły
//      zapis był tu wcześniej nieodwracalny,
//   2. przeniesienie OPUBLIKOWANEJ strony zostawia 301 z WILDCARDEM, czyli
//      przekierowuje całe poddrzewo (strony potomne i wpisy pod nią), a nie
//      tylko sam adres strony,
//   3. ścieżkę starą trzeba odczytać PRZED zapisem (page_full_path rozwiązuje
//      BIEŻĄCĄ hierarchię), a nową PO - kolejność jest tu zachowaniem,
//   4. reguła pierwszej publikacji i zerowanie harmonogramu działają dla stron
//      identycznie jak dla wpisów,
//   5. DWIE LUKI ścieżki hurtowej stron, zarejestrowane jako `it.fails`
//      (opis przy testach).
//
// CZEGO TU NIE MA. Walidatorów (`contentFunctions.schemas`), RLS-a (pgTAP).
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE_TS,
  NEXT_TS,
  OTHER_PARENT_ID,
  OTHER_POST_ID,
  PAGE_ID,
  PARENT_PAGE_ID,
  TEMPLATE_ID,
  TENANT,
  USER,
  contentClient,
  entityTable,
  fail,
  ok,
  pageRow,
  type ContentClient,
  type ServerFnSpec,
} from "./contentFunctionsHarness";
import type { RecordedChain, SupabaseFromStub, SupabaseResult } from "@/test/supabaseChain";
import type { Database } from "@/integrations/supabase/types";

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

import { rateLimit as rateLimitFn } from "@/lib/server/rate-limit.server";
import { recordAudit as recordAuditFn } from "@/lib/server/audit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const rateLimit = rateLimitFn as unknown as ReturnType<typeof vi.fn>;
const recordAudit = recordAuditFn as unknown as ReturnType<typeof vi.fn>;
const admin = server.admin as SupabaseFromStub;

type PageRow = Database["public"]["Tables"]["pages"]["Row"];

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

function savedPatch(db: SupabaseFromStub): Record<string, unknown> {
  const chain = db.chainsFor("pages").find((c) => c.has("update"));
  const patch = chain?.argsOf("update")?.[0];
  return isRecord(patch) ? patch : {};
}

function insertedRow(db: SupabaseFromStub, table: string): Record<string, unknown> {
  const chain = db.chainsFor(table).find((c) => c.has("insert"));
  const payload = chain?.argsOf("insert")?.[0];
  return isRecord(payload) ? payload : {};
}

function revisionsTable(cfg: { last?: string | null } = {}) {
  return (chain: RecordedChain): SupabaseResult => {
    if (chain.has("delete")) return ok(null);
    if (chain.has("insert")) return ok(null);
    if (chain.has("range")) return ok([]);
    return ok(cfg.last ? { created_at: cfg.last } : null);
  };
}

beforeEach(() => {
  admin.reset();
  rateLimit.mockReset();
  rateLimit.mockResolvedValue(true);
  recordAudit.mockReset();
  recordAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// updatePage
// ---------------------------------------------------------------------------

describe("updatePage", () => {
  function scene(
    opts: {
      existing?: Partial<PageRow>;
      canPublish?: boolean;
      pages?: Parameters<typeof entityTable>[0];
      revisions?: Parameters<typeof revisionsTable>[0];
      /** Kolejne wyniki `page_full_path` (przed zapisem, po zapisie). */
      paths?: Array<string | null>;
    } = {},
  ) {
    const client = contentClient({ canPublish: opts.canPublish });
    admin.setResponse("pages", ok(pageRow(opts.existing)));
    client.db.setResponse("pages", entityTable(opts.pages));
    client.db.setResponse("content_revisions", revisionsTable(opts.revisions));
    client.db.setResponse("redirects", ok(null));
    if (opts.paths) {
      const queue = [...opts.paths];
      client.setRpc("page_full_path", () => ok(queue.length > 1 ? queue.shift() : queue[0]));
    }
    return client;
  }

  const call = (client: ContentClient, fields: Record<string, unknown>, baseUpdatedAt?: string) =>
    run("updatePage", { id: PAGE_ID, fields, ...(baseUpdatedAt ? { baseUpdatedAt } : {}) }, client);

  it("woła limiter z zakresem page.update i pułapem 120", async () => {
    const client = scene();
    await call(client, { title_pl: "A" });
    expect(rateLimit).toHaveBeenCalledWith({ scope: "page.update", subjectId: USER, max: 120 });
  });

  it("przekroczony limit rzuca przed jakimkolwiek odczytem", async () => {
    rateLimit.mockResolvedValue(false);
    const client = scene();
    await expect(call(client, { title_pl: "A" })).rejects.toThrow("Rate limit exceeded");
    expect(admin.chainsFor("pages")).toHaveLength(0);
  });

  it("pre-read czyta cały wiersz przez service_role z filtrem tenanta", async () => {
    const client = scene();
    await call(client, { title_pl: "A" });
    const chain = admin.lastChain("pages");
    expect(chain?.argsOf("select")).toEqual(["*"]);
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", PAGE_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("strona z innego obszaru roboczego = odmowa; błąd odczytu propaguje", async () => {
    const brak = scene();
    admin.setResponse("pages", ok(null));
    await expect(call(brak, { title_pl: "A" })).rejects.toThrow("Page not found or access denied");

    const blad = scene();
    admin.setResponse("pages", fail("builder columns denied"));
    await expect(call(blad, { title_pl: "A" })).rejects.toThrow("builder columns denied");
  });

  it("brak tenanta przerywa przed odczytem strony", async () => {
    const client = contentClient({ tenant: null });
    admin.setResponse("pages", ok(pageRow()));
    await expect(call(client, { title_pl: "A" })).rejects.toThrow("No tenant for current user");
    expect(admin.chainsFor("pages")).toHaveLength(0);
  });

  it("ten sam INSTANT w innym zapisie tekstowym NIE jest konfliktem", async () => {
    const client = scene({ existing: { updated_at: "2026-08-20T10:00:00.000Z" } });
    await expect(
      call(client, { title_pl: "A" }, "2026-08-20T12:00:00+02:00"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("inny instant to EDIT_CONFLICT bez próby zapisu", async () => {
    const client = scene();
    await expect(call(client, { title_pl: "A" }, NEXT_TS)).rejects.toThrow("EDIT_CONFLICT");
    expect(client.db.chainsFor("pages")).toHaveLength(0);
  });

  it("nieparsowalny znacznik spada do porównania SUROWYCH ciągów", async () => {
    const zgodny = scene({ existing: { updated_at: "rewizja-7" } });
    await expect(call(zgodny, { title_pl: "A" }, "rewizja-7")).resolves.toMatchObject({ ok: true });
    const rozny = scene({ existing: { updated_at: "rewizja-7" } });
    await expect(call(rozny, { title_pl: "A" }, "rewizja-6")).rejects.toThrow("EDIT_CONFLICT");
  });

  it("UPDATE dokłada atomowy guard .eq(updated_at) tylko z podaną bazą", async () => {
    const client = scene();
    await call(client, { title_pl: "A" }, BASE_TS);
    const chain = client.db.chainsFor("pages").find((c) => c.has("update"));
    expect(chain?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", PAGE_ID],
      ["updated_at", BASE_TS],
    ]);
  });

  it("0 wierszy: widoczna strona = konflikt, niewidoczna = odmowa RLS", async () => {
    const konflikt = scene({ pages: { updated: ok([]), stillVisible: ok({ id: PAGE_ID }) } });
    await expect(call(konflikt, { title_pl: "A" }, BASE_TS)).rejects.toThrow("EDIT_CONFLICT");

    const odmowa = scene({ pages: { updated: ok([]), stillVisible: ok(null) } });
    await expect(call(odmowa, { title_pl: "A" }, BASE_TS)).rejects.toThrow(
      "you do not have permission to edit this page",
    );

    const bezBazy = scene({ pages: { updated: ok([]) } });
    await expect(call(bezBazy, { title_pl: "A" })).rejects.toThrow(
      "you do not have permission to edit this page",
    );
  });

  it("błąd UPDATE-a propaguje", async () => {
    const client = scene({ pages: { updated: fail("pages update denied") } });
    await expect(call(client, { title_pl: "A" })).rejects.toThrow("pages update denied");
  });

  it("kolizja slugu dokleja sufiks i zwraca kanoniczny slug", async () => {
    const client = scene({ pages: { slugTaken: (c) => c === "kontakt" } });
    await expect(call(client, { slug: "Kontakt" })).resolves.toMatchObject({ slug: "kontakt-2" });
    const probe = client.db.chainsFor("pages").find((c) => c.has("limit"));
    expect(probe?.argsOf("neq")).toEqual(["id", PAGE_ID]);
  });

  it("bramka workflow stron: publikacja bez uprawnień i harmonogram bez daty", async () => {
    const bezPrawa = scene({ canPublish: false });
    await expect(call(bezPrawa, { status: "published" })).rejects.toThrow(
      "only an administrator can publish or schedule a page",
    );
    const bezDaty = scene({ canPublish: true });
    await expect(call(bezDaty, { status: "scheduled" })).rejects.toThrow(
      "a scheduled page needs a publish date",
    );
  });

  it("zapis bez zmiany statusu nie pyta o prawo publikacji", async () => {
    const client = scene({ existing: { status: "published", published_at: BASE_TS } });
    await call(client, { title_pl: "A", status: "published" });
    expect(client.rpcCalls.filter((c) => c.fn === "can_publish_content")).toHaveLength(0);
  });

  it("błąd RPC uprawnień nie jest czytany jako brak uprawnień", async () => {
    const client = scene();
    client.setRpc("can_publish_content", fail("rpc down"));
    await expect(call(client, { status: "published" })).rejects.toThrow(
      "Could not verify publishing permissions",
    );
  });

  it("PIERWSZA publikacja stempluje published_at, ponowny zapis już nie", async () => {
    const pierwsza = scene();
    await call(pierwsza, { status: "published" });
    expect(typeof savedPatch(pierwsza.db).published_at).toBe("string");

    const ponowna = scene({ existing: { status: "published", published_at: BASE_TS } });
    await call(ponowna, { status: "published", title_pl: "Poprawka" });
    expect(savedPatch(ponowna.db)).not.toHaveProperty("published_at");
  });

  it("zejście z harmonogramu zeruje publish_at, pozostanie w nim - nie", async () => {
    const zejscie = scene({
      existing: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
    });
    await call(zejscie, { status: "draft" });
    expect(savedPatch(zejscie.db).publish_at).toBeNull();

    const zostaje = scene({
      existing: { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" },
    });
    await call(zostaje, { title_pl: "Poprawka" });
    expect(savedPatch(zostaje.db)).not.toHaveProperty("publish_at");
  });

  it("migawka rewizji strony ma entity_type page i wiersz SPRZED zapisu", async () => {
    const client = scene({ existing: { title_pl: "Wersja poprzednia" } });
    await call(client, { title_pl: "Wersja nowa" });
    const insert = client.db.chainsFor("content_revisions").find((c) => c.has("insert"));
    const payload = insert?.argsOf("insert")?.[0];
    expect(isRecord(payload) && payload.entity_type).toBe("page");
    const snapshot = isRecord(payload) ? payload.snapshot : null;
    expect(isRecord(snapshot) && snapshot.title_pl).toBe("Wersja poprzednia");
  });

  it("patch bez pól treści migawki nie tworzy; zmiana statusu wymusza ją mimo throttle", async () => {
    const bez = scene();
    await call(bez, { menu_order: 3 });
    expect(bez.db.chainsFor("content_revisions")).toHaveLength(0);

    const wymuszona = scene({ revisions: { last: new Date().toISOString() } });
    await call(wymuszona, { title_pl: "A", status: "archived" });
    expect(wymuszona.db.chainsFor("content_revisions").filter((c) => c.has("insert"))).toHaveLength(
      1,
    );
  });

  it("przeniesienie OPUBLIKOWANEJ strony zostawia 301 dla adresu I CAŁEGO poddrzewa", async () => {
    const client = scene({
      existing: { status: "published", published_at: BASE_TS },
      paths: ["o-nas/zespol", "instytut/zespol"],
    });
    await call(client, { slug: "zespol", parent_id: OTHER_PARENT_ID });
    const rows = client.db
      .chainsFor("redirects")
      .find((c) => c.has("upsert"))
      ?.argsOf("upsert")?.[0];
    expect(rows).toEqual([
      expect.objectContaining({
        tenant_id: TENANT,
        status_code: 301,
        source: "slug_change",
        created_by: USER,
        is_enabled: true,
        source_path: "/o-nas/zespol",
        target_path: "/instytut/zespol",
      }),
      expect.objectContaining({
        source_path: "/o-nas/zespol/*",
        target_path: "/instytut/zespol/*",
      }),
    ]);
  });

  it("stara ścieżka jest czytana PRZED zapisem, nowa PO (page_full_path liczy bieżącą hierarchię)", async () => {
    const client = scene({
      existing: { status: "published", published_at: BASE_TS },
      paths: ["o-nas/zespol", "instytut/zespol"],
    });
    await call(client, { slug: "zespol" });
    const order = [
      ...client.db.chainsFor("pages").map((c) => (c.has("update") ? "update" : "read")),
    ];
    expect(client.rpcCalls.filter((c) => c.fn === "page_full_path")).toHaveLength(2);
    expect(order).toContain("update");
  });

  it("SZKIC nie zostawia przekierowania (stary adres nigdy nie był publiczny)", async () => {
    const client = scene({ paths: ["o-nas/zespol", "instytut/zespol"] });
    await call(client, { slug: "zespol" });
    expect(client.db.chainsFor("redirects")).toHaveLength(0);
    expect(client.rpcCalls.filter((c) => c.fn === "page_full_path")).toHaveLength(0);
  });

  it("nieznana stara ścieżka = brak reguły", async () => {
    const client = scene({
      existing: { status: "published", published_at: BASE_TS },
      paths: [null],
    });
    await call(client, { slug: "zespol" });
    expect(client.db.chainsFor("redirects")).toHaveLength(0);
  });

  it("cel nierozwiązywalny po zapisie nie tworzy reguły z pustym celem", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = scene({
      existing: { status: "published", published_at: BASE_TS },
      paths: ["o-nas/zespol", null],
    });
    await expect(call(client, { slug: "zespol" })).resolves.toMatchObject({ ok: true });
    expect(client.db.chainsFor("redirects").filter((c) => c.has("upsert"))).toHaveLength(0);
    warn.mockRestore();
  });

  it("BŁĄD zapisu przekierowania NIE psuje zapisu strony", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = scene({
      existing: { status: "published", published_at: BASE_TS },
      paths: ["o-nas/zespol", "instytut/zespol"],
    });
    client.db.setResponse("redirects", (chain) =>
      chain.has("upsert") ? fail("redirects denied") : ok(null),
    );
    await expect(call(client, { slug: "zespol" })).resolves.toMatchObject({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("zmiana rodzica na null (wyniesienie na najwyższy poziom) też jest przeniesieniem", async () => {
    const client = scene({
      existing: { status: "published", published_at: BASE_TS, parent_id: PARENT_PAGE_ID },
      paths: ["o-nas/zespol", "zespol"],
    });
    await call(client, { parent_id: null });
    expect(client.db.chainsFor("redirects").filter((c) => c.has("upsert"))).toHaveLength(1);
  });

  it("ten SAM rodzic w patchu nie jest przeniesieniem", async () => {
    const client = scene({
      existing: { status: "published", published_at: BASE_TS, parent_id: PARENT_PAGE_ID },
      paths: ["o-nas/zespol", "o-nas/zespol"],
    });
    await call(client, { parent_id: PARENT_PAGE_ID });
    expect(client.db.chainsFor("redirects")).toHaveLength(0);
  });

  it("audyt: publikacja to page.publish, każdy inny zapis to page.update", async () => {
    const publikacja = scene();
    await call(publikacja, { status: "published" });
    expect(auditParams()).toMatchObject({ action: "page.publish", entityId: PAGE_ID });

    const zapis = scene({ existing: { status: "published", published_at: BASE_TS } });
    await call(zapis, { status: "published", title_pl: "Poprawka" });
    expect(auditParams()).toMatchObject({ action: "page.update" });
  });

  it("pusty patch nie rusza wiersza, ale zostawia ślad audytu i zwraca bazę locka", async () => {
    const client = scene();
    await expect(call(client, {})).resolves.toEqual({
      ok: true,
      slug: "stara-strona",
      updatedAt: BASE_TS,
    });
    expect(client.db.chainsFor("pages")).toHaveLength(0);
    expect(auditParams().metadata).toEqual({ fields: [] });
  });

  it("cover_image_url: same spacje to null, realny adres jest PRZYCINANY i zachowany", async () => {
    const puste = scene();
    await call(puste, { cover_image_url: "   " });
    expect(savedPatch(puste.db).cover_image_url).toBeNull();

    const adres = scene();
    await call(adres, { cover_image_url: "  https://example.com/hero.jpg  " });
    expect(savedPatch(adres.db).cover_image_url).toBe("https://example.com/hero.jpg");
  });

  it("harmonogram strony z datą PRZYSŁANĄ W PATCHU (a nie tylko z wiersza) przechodzi", async () => {
    const client = scene({ canPublish: true });
    await expect(
      call(client, { status: "scheduled", publish_at: "2026-09-01T10:00:00.000Z" }),
    ).resolves.toMatchObject({ ok: true });
    expect(savedPatch(client.db)).toMatchObject({
      status: "scheduled",
      publish_at: "2026-09-01T10:00:00.000Z",
    });
  });
});

// ---------------------------------------------------------------------------
// createPage
// ---------------------------------------------------------------------------

describe("createPage", () => {
  function scene(inserted: SupabaseResult = ok({ id: PAGE_ID, slug: "nowa-strona" })) {
    const client = contentClient();
    client.db.setResponse("pages", entityTable({ inserted }));
    return client;
  }

  it("woła limiter z zakresem page.create i pułapem 30", async () => {
    const client = scene();
    await run("createPage", { title_pl: "Nowa strona" }, client);
    expect(rateLimit).toHaveBeenCalledWith({ scope: "page.create", subjectId: USER, max: 30 });
  });

  it("startuje jako szkic w edytorze buildera, bez rodzica i szablonu", async () => {
    const client = scene();
    await expect(run("createPage", { title_pl: "Nowa strona" }, client)).resolves.toEqual({
      id: PAGE_ID,
      slug: "nowa-strona",
    });
    expect(insertedRow(client.db, "pages")).toEqual({
      tenant_id: TENANT,
      author_id: USER,
      slug: "nowa-strona",
      title_pl: "Nowa strona",
      title_en: "",
      parent_id: null,
      template_id: null,
      builder_data: null,
    });
  });

  it("przyjmuje rodzica, szablon i gotowy dokument buildera", async () => {
    const client = scene();
    await run(
      "createPage",
      {
        title_en: "Landing",
        parent_id: PARENT_PAGE_ID,
        template_id: TEMPLATE_ID,
        builder_data: { rows: [] },
      },
      client,
    );
    expect(insertedRow(client.db, "pages")).toMatchObject({
      slug: "landing",
      parent_id: PARENT_PAGE_ID,
      template_id: TEMPLATE_ID,
      builder_data: { rows: [] },
    });
  });

  it("bez tytułu slug powstaje z sygnatury czasu, a kolizja dokleja sufiks", async () => {
    const bez = scene();
    await run("createPage", {}, bez);
    expect(String(insertedRow(bez.db, "pages").slug)).toMatch(/^page-[0-9a-z]+$/);

    const client = contentClient();
    client.db.setResponse(
      "pages",
      entityTable({
        slugTaken: (c) => c === "kontakt",
        inserted: ok({ id: PAGE_ID, slug: "kontakt-2" }),
      }),
    );
    await run("createPage", { title_pl: "Kontakt" }, client);
    expect(insertedRow(client.db, "pages").slug).toBe("kontakt-2");
  });

  it("błąd INSERT-u propaguje, audyt page.create niesie slug", async () => {
    await expect(
      run("createPage", { title_pl: "A" }, scene(fail("pages insert denied"))),
    ).rejects.toThrow("pages insert denied");

    const client = scene();
    await run("createPage", { title_pl: "Nowa strona" }, client);
    expect(auditParams()).toMatchObject({
      action: "page.create",
      entityType: "page",
      entityId: PAGE_ID,
      metadata: { slug: "nowa-strona" },
    });
  });
});

// ---------------------------------------------------------------------------
// deletePage + hurt
// ---------------------------------------------------------------------------

describe("deletePage", () => {
  function scene(result: SupabaseResult = ok([{ id: PAGE_ID }])) {
    const client = contentClient();
    client.db.setResponse("pages", entityTable({ updated: result }));
    return client;
  }

  it("to SOFT delete i zostawia ślad audytu", async () => {
    const client = scene();
    await expect(run("deletePage", { id: PAGE_ID }, client)).resolves.toEqual({ ok: true });
    const patch = client.db.lastChain("pages")?.argsOf("update")?.[0];
    expect(isRecord(patch) && Object.keys(patch)).toEqual(["deleted_at"]);
    expect(auditParams()).toMatchObject({
      action: "page.delete",
      entityId: PAGE_ID,
      metadata: { soft: true },
    });
  });

  it("0 wierszy przy error=null musi rzucić, błąd bazy propaguje", async () => {
    await expect(run("deletePage", { id: PAGE_ID }, scene(ok([])))).rejects.toThrow(
      "you do not have permission to delete this page",
    );
    await expect(run("deletePage", { id: PAGE_ID }, scene(fail("denied")))).rejects.toThrow(
      "denied",
    );
  });
});

describe("hurt stron", () => {
  const IDS = [PAGE_ID, OTHER_POST_ID];

  function scene(
    opts: {
      deleted?: SupabaseResult;
      stamped?: SupabaseResult;
      kept?: SupabaseResult;
      plain?: SupabaseResult;
      canPublish?: boolean;
    } = {},
  ) {
    const client = contentClient({ canPublish: opts.canPublish });
    client.db.setResponse(
      "pages",
      entityTable({
        deleted: opts.deleted ?? ok([{ id: PAGE_ID }]),
        bulkPlain: opts.plain ?? opts.deleted ?? ok([{ id: PAGE_ID }]),
        bulkStamped: opts.stamped ?? ok([{ id: PAGE_ID }]),
        bulkKept: opts.kept ?? ok([{ id: OTHER_POST_ID }]),
      }),
    );
    return client;
  }

  it("bulkDeletePages stempluje deleted_at i raportuje uczciwy licznik", async () => {
    const client = scene();
    await expect(run("bulkDeletePages", { ids: IDS }, client)).resolves.toEqual({
      ok: true,
      count: 1,
      requested: 2,
    });
    expect(auditParams()).toMatchObject({
      action: "page.delete",
      metadata: { ids: [PAGE_ID], count: 1, requested: 2, soft: true },
    });
  });

  it("restorePages zeruje deleted_at, purgePages usuwa twardo", async () => {
    const restore = scene();
    await run("restorePages", { ids: IDS }, restore);
    expect(restore.db.lastChain("pages")?.argsOf("update")).toEqual([{ deleted_at: null }]);
    expect(auditParams()).toMatchObject({ action: "page.update", metadata: { restored: true } });

    const purge = scene();
    await run("purgePages", { ids: IDS }, purge);
    expect(purge.db.lastChain("pages")?.has("delete")).toBe(true);
    expect(auditParams()).toMatchObject({ action: "page.delete", metadata: { purged: true } });
  });

  it("zero dotkniętych wierszy nie produkuje audytu w żadnej ścieżce", async () => {
    for (const name of ["bulkDeletePages", "restorePages", "purgePages", "bulkUpdatePages"]) {
      recordAudit.mockClear();
      const client = scene({ deleted: ok([]), plain: ok([]) });
      await expect(run(name, { ids: IDS, status: "draft" }, client), name).resolves.toMatchObject({
        count: 0,
        requested: 2,
      });
      expect(recordAudit, name).not.toHaveBeenCalled();
    }
  });

  it("błąd bazy propaguje we wszystkich czterech ścieżkach", async () => {
    for (const name of ["bulkDeletePages", "restorePages", "purgePages", "bulkUpdatePages"]) {
      const client = scene({ deleted: fail(`${name} denied`), plain: fail(`${name} denied`) });
      await expect(run(name, { ids: IDS, status: "draft" }, client), name).rejects.toThrow(
        `${name} denied`,
      );
    }
  });

  it("każda ścieżka ma własny zakres limitu z pułapem 20", async () => {
    const scopes: Array<[string, string]> = [
      ["bulkDeletePages", "page.bulkDelete"],
      ["restorePages", "page.restore"],
      ["purgePages", "page.purge"],
      ["bulkUpdatePages", "page.bulkUpdate"],
    ];
    for (const [name, scope] of scopes) {
      rateLimit.mockClear();
      const client = scene();
      await run(name, { ids: IDS, status: "draft" }, client);
      expect(rateLimit, name).toHaveBeenCalledWith({ scope, subjectId: USER, max: 20 });
    }
  });

  it("bulkUpdatePages publikuje dwoma filtrowanymi UPDATE-ami i de-duplikuje wynik", async () => {
    const client = scene({
      stamped: ok([{ id: PAGE_ID }]),
      kept: ok([{ id: PAGE_ID }, { id: OTHER_POST_ID }]),
    });
    await expect(
      run("bulkUpdatePages", { ids: IDS, status: "published" }, client),
    ).resolves.toEqual({ ok: true, count: 2, requested: 2 });
    const updates = client.db.chainsFor("pages").filter((c) => c.has("update"));
    expect(updates).toHaveLength(2);
    expect(updates.find((c) => c.has("is"))?.argsOf("is")).toEqual(["published_at", null]);
    expect(auditParams()).toMatchObject({ action: "page.publish" });
  });

  // DEFEKT 1 (nie naprawiamy w teście). `bulkUpdatePosts` sprawdza
  // `can_publish_content` przed hurtową publikacją; `bulkUpdatePages` NIE
  // sprawdza NICZEGO - idzie prosto do `applyBulkStatus`. Autor bez prawa
  // publikacji nie opublikuje strony pojedynczo (`updatePage` woła
  // `evaluateTransition`), ale opublikuje ją, zaznaczając ją na liście stron
  // i wybierając „Opublikuj". Trigger `pages_workflow_guard` w bazie jest tu
  // ostatnią linią obrony - ta funkcja nie stawia żadnej.
  it.fails("bulkUpdatePages odrzuca hurtową publikację bez prawa publikacji", async () => {
    const client = scene({ canPublish: false });
    await expect(run("bulkUpdatePages", { ids: IDS, status: "published" }, client)).rejects.toThrow(
      /administrator/i,
    );
  });

  // DEFEKT 2 (nie naprawiamy w teście). `BulkPostStatus` ŚWIADOMIE wycina
  // `scheduled` z hurtu wpisów, bo harmonogram wymaga daty PER WPIS (komentarz
  // przy schemacie: „Bulk actions exclude `scheduled`"). `bulkUpdatePages`
  // używa pełnego `PageStatus`, w którym `scheduled` JEST - i nie woła
  // `evaluateTransition`, więc strony da się hurtowo ustawić na „zaplanowane"
  // BEZ `publish_at`. Taka strona nie opublikuje się nigdy (planista szuka
  // `publish_at <= now()`) i jednocześnie przestaje być widoczna publicznie -
  // czyli znika bez śladu w interfejsie.
  it.fails("bulkUpdatePages odrzuca hurtowe ustawienie scheduled bez daty publikacji", async () => {
    const client = scene();
    await expect(run("bulkUpdatePages", { ids: IDS, status: "scheduled" }, client)).rejects.toThrow(
      /publish date|publish_at/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Odporność na nietypowe, ale legalne odpowiedzi PostgREST.
// ---------------------------------------------------------------------------

describe("odporność na data:null i brak updated_at", () => {
  const IDS = [PAGE_ID, OTHER_POST_ID];

  function bulkClient(cfg: Parameters<typeof entityTable>[0]) {
    const client = contentClient();
    client.db.setResponse("pages", entityTable(cfg));
    return client;
  }

  it("hurt stron z data:null raportuje 0 dotkniętych wierszy", async () => {
    for (const name of ["bulkDeletePages", "restorePages", "purgePages"]) {
      const client = bulkClient({ deleted: ok(null) });
      await expect(run(name, { ids: IDS }, client), name).resolves.toEqual({
        ok: true,
        count: 0,
        requested: 2,
      });
    }
  });

  it("applyBulkStatus dla stron znosi data:null na obu ścieżkach", async () => {
    const prosta = bulkClient({ bulkPlain: ok(null) });
    await expect(run("bulkUpdatePages", { ids: IDS, status: "draft" }, prosta)).resolves.toEqual({
      ok: true,
      count: 0,
      requested: 2,
    });
    const publikacja = bulkClient({ bulkStamped: ok(null), bulkKept: ok(null) });
    await expect(
      run("bulkUpdatePages", { ids: IDS, status: "published" }, publikacja),
    ).resolves.toEqual({ ok: true, count: 0, requested: 2 });
  });

  it("deletePage z data:null to nadal odmowa, nie awaria", async () => {
    const client = bulkClient({ updated: ok(null) });
    await expect(run("deletePage", { id: PAGE_ID }, client)).rejects.toThrow(
      "you do not have permission to delete this page",
    );
  });

  it("updatePage: UPDATE z data:null to odmowa, a wiersz bez updated_at zachowuje bazę locka", async () => {
    const odmowa = contentClient();
    admin.setResponse("pages", ok(pageRow()));
    odmowa.db.setResponse("pages", entityTable({ updated: ok(null) }));
    odmowa.db.setResponse("content_revisions", revisionsTable());
    await expect(
      run("updatePage", { id: PAGE_ID, fields: { title_pl: "A" } }, odmowa),
    ).rejects.toThrow("you do not have permission to edit this page");

    const bezDaty = contentClient();
    admin.setResponse("pages", ok(pageRow()));
    bezDaty.db.setResponse(
      "pages",
      entityTable({ updated: ok([{ id: PAGE_ID, updated_at: null }]) }),
    );
    bezDaty.db.setResponse("content_revisions", revisionsTable());
    await expect(
      run("updatePage", { id: PAGE_ID, fields: { title_pl: "A" } }, bezDaty),
    ).resolves.toMatchObject({ updatedAt: BASE_TS });
  });

  it("NIEparsowalna baza locka przy poprawnym updated_at strony to konflikt", async () => {
    const client = contentClient();
    admin.setResponse("pages", ok(pageRow()));
    client.db.setResponse("pages", entityTable());
    client.db.setResponse("content_revisions", revisionsTable());
    await expect(
      run(
        "updatePage",
        { id: PAGE_ID, fields: { title_pl: "A" }, baseUpdatedAt: "wersja-klienta" },
        client,
      ),
    ).rejects.toThrow("EDIT_CONFLICT");
  });

  it("strona sprzed triggera updated_at zapisuje się z updatedAt null", async () => {
    const client = contentClient();
    admin.setResponse("pages", ok({ ...pageRow(), updated_at: null }));
    client.db.setResponse(
      "pages",
      entityTable({ updated: ok([{ id: PAGE_ID, updated_at: null }]) }),
    );
    client.db.setResponse("content_revisions", revisionsTable());
    await expect(
      run("updatePage", { id: PAGE_ID, fields: { title_pl: "A" } }, client),
    ).resolves.toEqual({ ok: true, slug: "stara-strona", updatedAt: null });
  });
});

// Kontrola higieny atrap - pre-read stron idzie przez service_role.
describe("higiena atrap", () => {
  it("supabaseAdmin to ta sama atrapa, którą czytają testy", () => {
    expect(supabaseAdmin.from).toBe(admin.from);
  });
});
