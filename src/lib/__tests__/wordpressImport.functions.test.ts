// Import z WordPress.com - ścieżka, którą uruchamia się RAZ i której nikt nie
// sprawdza ręcznie wpis po wpisie. Redaktor klika „importuj", patrzy na licznik
// i wierzy podsumowaniu. Dlatego każda cicha gałąź jest tu droższa niż awaria:
//
//   * zły `slugify` duplikuje adresy WSZYSTKICH zaimportowanych wpisów,
//   * `ensureUniqueSlug`, który nie zauważy kolizji, nadpisze cudzy wpis,
//   * `mergeLocalizedImport` pominięty przy `sync_existing` KASUJE ręcznie
//     napisaną wersję EN - i nikt tego nie zobaczy, dopóki ktoś nie otworzy
//     strony w drugim języku,
//   * `captureWpRedirect`, który nie zapisze przekierowania, gubi wszystkie
//     linki zewnętrzne i pozycje w wyszukiwarce w chwili przełączenia DNS.
//
// Suita idzie przez PRAWDZIWE handlery server fn (atrapa `createServerFn`
// z `@/test/serverFn` nie udaje middleware - autoryzacji pilnuje
// `check:authz-snapshot` i pgTAP), a warstwę danych przez `supabaseFromStub`,
// więc asercje czytają dokładnie te ogniwa PostgREST, które kod naprawdę wołał.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, fail, pgError, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  recordAudit: vi.fn(),
  rateLimit: vi.fn(),
  assertPublicHttpUrl: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
  requireAdminEditor: { __mw: "requireAdminEditor" },
}));
vi.mock("@/lib/server/audit.server", () => ({ recordAudit: h.recordAudit }));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/http/egressGuard.server", () => ({ assertPublicHttpUrl: h.assertPublicHttpUrl }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => admin.from(t),
    storage: {
      from: () => ({ upload: h.upload, getPublicUrl: h.getPublicUrl }),
    },
  },
}));

import {
  listWpComSites,
  previewWpComPosts,
  createWpImportJob,
  runWpImportJob,
  getWpImportJob,
  cancelWpImportJob,
} from "@/lib/wordpress-import.functions";

const db = supabaseFromStub();
const admin = supabaseFromStub();

const TENANT = "tenant-1";
const USER = "user-1";
const JOB_ID = "11111111-2222-3333-4444-555555555555";
const PAGE_ID = "page-blog-1";
const NOW = new Date("2026-08-19T12:00:00.000Z");

/** Odpowiedź `fetch` w kształcie, jaki czyta `wpFetch` (tekst + status). */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    headers: new Headers(),
  } as unknown as Response;
}

function binaryResponse(bytes: Uint8Array, contentType: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  } as unknown as Response;
}

/** Wpis WP.com w kształcie odpowiedzi REST v1.1. */
function wpPost(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ID: 101,
    slug: "moj-wpis",
    title: "Mój wpis",
    excerpt: "<p>Zajawka</p>",
    content: "<p>Treść wpisu</p>",
    status: "publish",
    date: "2024-05-01T10:00:00Z",
    modified: "2024-05-02T10:00:00Z",
    URL: "https://blog.test/2024/05/moj-wpis/",
    featured_image: null,
    ...overrides,
  };
}

const JOB_INPUT = {
  site: "blog.test",
  number: 20,
  offset: 0,
  status: "publish" as const,
  type: "post" as const,
  language: "pl" as const,
  sync_existing: false,
  import_media: false,
};

/** Domyślne odpowiedzi tabel dla szczęśliwej ścieżki `runWpImportJob`. */
function planHappyPath(opts: { existingPost?: Record<string, unknown> | null } = {}): void {
  db.setResponse("wp_import_jobs", (chain) => {
    if (chain.has("update")) return ok(null);
    const fields = String(chain.argsOf("select")?.[0] ?? "");
    if (fields.includes("log")) return ok({ log: [] });
    if (fields === "status") return ok({ status: "running" });
    return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
  });
  db.setResponse("profiles", ok({ tenant_id: TENANT }));
  db.setResponse("pages", ok({ id: PAGE_ID }));
  db.setResponse("posts", (chain) => {
    if (chain.has("insert")) return ok({ id: "post-new", slug: "moj-wpis" });
    if (chain.has("update")) return ok(null);
    // `ensureUniqueSlug` czyta listą (bez `.maybeSingle()`), odczyt istniejącego
    // wpisu - pojedynczym wierszem. Rozróżniamy po ogniwie `limit`.
    if (chain.has("limit")) return ok([]);
    return ok(opts.existingPost ?? null);
  });
  db.setResponse("redirects", ok(null));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.reset();
  admin.reset();
  h.rpc.mockReset();
  h.recordAudit.mockReset().mockResolvedValue(undefined);
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.assertPublicHttpUrl.mockReset().mockResolvedValue(undefined);
  h.upload.mockReset().mockResolvedValue({ error: null });
  h.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: "https://cdn.test/a.jpg" } });
  vi.stubEnv("LOVABLE_API_KEY", "platform-key");
  vi.stubEnv("WORDPRESS_COM_API_KEY", "wp-key");
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setServerFnContext({
    supabase: { from: (t: string) => db.from(t), rpc: h.rpc },
    userId: USER,
  });
});

afterEach(() => {
  resetServerFnContext();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fetchMock = (): ReturnType<typeof vi.fn> => globalThis.fetch as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------

describe("obudowa server fn", () => {
  it.each([
    ["listWpComSites", listWpComSites, "GET"],
    ["previewWpComPosts", previewWpComPosts, "POST"],
    ["createWpImportJob", createWpImportJob, "POST"],
    ["runWpImportJob", runWpImportJob, "POST"],
    ["getWpImportJob", getWpImportJob, "POST"],
    ["cancelWpImportJob", cancelWpImportJob, "POST"],
  ])("%s deklaruje metodę %s i middleware requireStaff", (_name, fn, method) => {
    const meta = serverFnMeta(fn);
    expect(meta?.method).toBe(method);
    expect(meta?.middleware).toEqual([{ __mw: "requireStaff" }]);
  });

  it.each([
    ["previewWpComPosts", previewWpComPosts],
    ["createWpImportJob", createWpImportJob],
    ["runWpImportJob", runWpImportJob],
    ["getWpImportJob", getWpImportJob],
    ["cancelWpImportJob", cancelWpImportJob],
  ])("%s waliduje wejście", (_name, fn) => {
    expect(serverFnMeta(fn)?.hasValidator).toBe(true);
  });
});

describe("authHeaders - konfiguracja połączenia", () => {
  it("wysyła oba klucze i nagłówek Accept", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ sites: [] }));
    await listWpComSites();
    const [, init] = fetchMock().mock.calls[0];
    expect(init.headers).toEqual({
      Authorization: "Bearer platform-key",
      "X-Connection-Api-Key": "wp-key",
      Accept: "application/json",
    });
  });

  it("BRAK klucza platformy jest raportowany jako ostrzeżenie, nie cichy pusty wynik", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    const res = await listWpComSites();
    expect(res.sites).toEqual([]);
    expect(res.warning).toContain("LOVABLE_API_KEY");
    // Bez klucza NIE wolno wykonać żądania.
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("BRAK klucza WordPressa mówi wprost, co podłączyć", async () => {
    vi.stubEnv("WORDPRESS_COM_API_KEY", "");
    const res = await listWpComSites();
    expect(res.warning).toContain("WORDPRESS_COM_API_KEY");
    expect(res.warning).toContain("Connectors");
  });

  it("brak klucza WordPressa zatrzymuje podgląd wyjątkiem (nie zwraca pustej listy)", async () => {
    vi.stubEnv("WORDPRESS_COM_API_KEY", "");
    await expect(previewWpComPosts({ data: { site: "blog.test" } })).rejects.toThrow(
      /WORDPRESS_COM_API_KEY/,
    );
  });
});

describe("wpFetch - odpowiedzi bramki", () => {
  it("200 z JSON-em przechodzi", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 0, posts: [] }));
    await expect(previewWpComPosts({ data: { site: "blog.test" } })).resolves.toMatchObject({
      found: 0,
    });
  });

  it.each([401, 403, 404, 429, 500, 502])(
    "status %i rzuca błąd z kodem w treści",
    async (status) => {
      fetchMock().mockResolvedValue(textResponse("odmowa dostępu", status));
      await expect(previewWpComPosts({ data: { site: "blog.test" } })).rejects.toThrow(
        new RegExp(`WordPress.com API ${status}`),
      );
    },
  );

  it("obcina długi komunikat błędu (log nie może puchnąć bez granic)", async () => {
    fetchMock().mockResolvedValue(textResponse("x".repeat(1000), 500));
    await expect(previewWpComPosts({ data: { site: "blog.test" } })).rejects.toThrow(
      /^WordPress\.com API 500: x{300}$/,
    );
  });

  it("odpowiedź NIE-JSON rzuca osobny, rozpoznawalny błąd", async () => {
    fetchMock().mockResolvedValue(textResponse("<html>Bad Gateway</html>"));
    await expect(previewWpComPosts({ data: { site: "blog.test" } })).rejects.toThrow(
      /returned non-JSON/,
    );
  });

  it("timeout sieci propaguje się do wołającego", async () => {
    fetchMock().mockRejectedValue(new Error("network timeout"));
    await expect(previewWpComPosts({ data: { site: "blog.test" } })).rejects.toThrow(
      /network timeout/,
    );
  });
});

describe("listWpComSites", () => {
  it("mapuje listę witryn na kształt panelu", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        sites: [
          { ID: 1, name: "Blog", description: "Opis", URL: "https://blog.test", jetpack: false },
        ],
      }),
    );
    const res = await listWpComSites();
    expect(res.sites).toEqual([
      { id: 1, name: "Blog", url: "https://blog.test", description: "Opis" },
    ]);
    expect(res.warning).toBeNull();
  });

  it("odpowiedź BEZ pola sites daje pustą listę, nie wyjątek", async () => {
    fetchMock().mockResolvedValue(jsonResponse({}));
    const res = await listWpComSites();
    expect(res.sites).toEqual([]);
    expect(res.warning).toBeNull();
  });

  it("token o zasięgu jednej witryny degraduje się z ostrzeżeniem (400 z bramki)", async () => {
    fetchMock().mockResolvedValue(textResponse("authorization_required", 400));
    const res = await listWpComSites();
    expect(res.sites).toEqual([]);
    expect(res.warning).toContain("authorization_required");
  });

  it("błąd NIE-Error też staje się czytelnym ostrzeżeniem", async () => {
    fetchMock().mockRejectedValue("awaria bez obiektu Error");
    const res = await listWpComSites();
    expect(res.warning).toBe("awaria bez obiektu Error");
  });
});

describe("previewWpComPosts - walidacja i mapowanie", () => {
  beforeEach(() => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
  });

  it("uzupełnia domyślne wartości wejścia", async () => {
    await previewWpComPosts({ data: { site: "blog.test" } });
    const url = String(fetchMock().mock.calls[0][0]);
    expect(url).toContain("number=20");
    expect(url).toContain("offset=0");
    expect(url).toContain("status=publish");
    // Domyślny typ to `post` - bez tego import wciągnąłby strony i załączniki.
    expect(url).toContain("type=post");
  });

  it("koduje nazwę witryny w ścieżce", async () => {
    await previewWpComPosts({ data: { site: "blog.test/sub" } });
    expect(String(fetchMock().mock.calls[0][0])).toContain("sites/blog.test%2Fsub/posts");
  });

  it.each([
    ["site pusty", { site: "" }],
    ["site za długi", { site: "x".repeat(256) }],
    ["number poniżej zakresu", { site: "s", number: 0 }],
    ["number powyżej zakresu", { site: "s", number: 101 }],
    ["number niecałkowity", { site: "s", number: 1.5 }],
    ["offset ujemny", { site: "s", offset: -1 }],
    ["offset powyżej zakresu", { site: "s", offset: 10_001 }],
    ["status nieznany", { site: "s", status: "queued" }],
    ["type nieznany", { site: "s", type: "attachment" }],
  ])("%s jest ODRZUCANE przez walidator", async (_l, data) => {
    await expect(previewWpComPosts({ data })).rejects.toThrow();
  });

  it("zdejmuje znaczniki i rozwija encje w tytule i zajawce", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [
          wpPost({
            title: "A &amp; B &#8211; C&nbsp;D",
            excerpt: "<p>Za&#8217;jawka &lt;b&gt;</p>",
          }),
        ],
      }),
    );
    const res = await previewWpComPosts({ data: { site: "blog.test" } });
    expect(res.posts[0].title).toBe("A & B - C D");
    expect(res.posts[0].excerpt).toBe("Za'jawka <b>");
  });

  it.each([
    ["&#8212;", "-"],
    ["&#8216;", "'"],
    ["&#8220;", '"'],
    ["&#8221;", '"'],
    ["&quot;", '"'],
    ["&gt;", ">"],
    ["&#39;", "'"],
  ])("rozwija encję %s", async (entity, expected) => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost({ title: entity })] }));
    const res = await previewWpComPosts({ data: { site: "blog.test" } });
    expect(res.posts[0].title).toBe(expected);
  });

  it("obcina zajawkę do 240 znaków (podgląd, nie treść)", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ excerpt: "z".repeat(500) })] }),
    );
    const res = await previewWpComPosts({ data: { site: "blog.test" } });
    expect(res.posts[0].excerpt).toHaveLength(240);
  });

  it("odpowiedź BEZ pola posts daje pustą listę", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 7 }));
    const res = await previewWpComPosts({ data: { site: "blog.test" } });
    expect(res).toEqual({ found: 7, posts: [] });
  });

  it("przepisuje featured_image i URL bez zmian", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ featured_image: "https://wp.test/a.jpg" })] }),
    );
    const res = await previewWpComPosts({ data: { site: "blog.test" } });
    expect(res.posts[0].featured_image).toBe("https://wp.test/a.jpg");
    expect(res.posts[0].url).toBe("https://blog.test/2024/05/moj-wpis/");
  });
});

describe("createWpImportJob", () => {
  beforeEach(() => {
    db.setResponse("profiles", ok({ tenant_id: TENANT }));
    db.setResponse("wp_import_jobs", ok({ id: JOB_ID }));
  });

  it("zapisuje zadanie i zwraca jego identyfikator", async () => {
    const res = await createWpImportJob({ data: JOB_INPUT });
    expect(res).toEqual({ jobId: JOB_ID });
    const chain = db.lastChain("wp_import_jobs");
    const row = chain?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(row.tenant_id).toBe(TENANT);
    expect(row.actor_id).toBe(USER);
    expect(row.status).toBe("running");
    expect(row.language).toBe("pl");
  });

  it("zapisuje opcje zadania, w tym only_ids jako null gdy nie podano", async () => {
    await createWpImportJob({ data: JOB_INPUT });
    const row = db.lastChain("wp_import_jobs")?.argsOf("insert")?.[0] as {
      options: Record<string, unknown>;
    };
    expect(row.options).toEqual({
      number: 20,
      offset: 0,
      status: "publish",
      type: "post",
      sync_existing: false,
      import_media: false,
      only_ids: null,
    });
  });

  it("zapisuje only_ids, gdy podano wybór wpisów", async () => {
    await createWpImportJob({ data: { ...JOB_INPUT, only_ids: [1, 2] } });
    const row = db.lastChain("wp_import_jobs")?.argsOf("insert")?.[0] as {
      options: { only_ids: number[] };
    };
    expect(row.options.only_ids).toEqual([1, 2]);
  });

  it("zapisuje pierwszy wpis logu z nazwą witryny", async () => {
    await createWpImportJob({ data: JOB_INPUT });
    const row = db.lastChain("wp_import_jobs")?.argsOf("insert")?.[0] as {
      log: Array<{ ts: string; level: string; msg: string }>;
    };
    expect(row.log[0].msg).toContain("blog.test");
    expect(row.log[0].level).toBe("info");
    expect(row.log[0].ts).toBe(NOW.toISOString());
  });

  it("LIMIT ŻĄDAŃ zatrzymuje zadanie z czytelnym komunikatem", async () => {
    h.rateLimit.mockResolvedValue(false);
    await expect(createWpImportJob({ data: JOB_INPUT })).rejects.toThrow(/Rate limit exceeded/);
    // Zadanie NIE MOŻE powstać w bazie, gdy limit odrzucił żądanie.
    expect(db.chainsFor("wp_import_jobs")).toHaveLength(0);
  });

  it("limit jest liczony per użytkownik i per zakres wp.import", async () => {
    await createWpImportJob({ data: JOB_INPUT });
    expect(h.rateLimit).toHaveBeenCalledWith({ scope: "wp.import", subjectId: USER, max: 10 });
  });

  it("BRAK najemcy dla użytkownika zatrzymuje zadanie", async () => {
    db.setResponse("profiles", ok(null));
    await expect(createWpImportJob({ data: JOB_INPUT })).rejects.toThrow(/No tenant/);
  });

  it("profil BEZ tenant_id też zatrzymuje zadanie", async () => {
    db.setResponse("profiles", ok({ tenant_id: null }));
    await expect(createWpImportJob({ data: JOB_INPUT })).rejects.toThrow(/No tenant/);
  });

  it("błąd Postgresa przy czytaniu profilu zatrzymuje zadanie", async () => {
    db.setResponse("profiles", fail("permission denied", "42501"));
    await expect(createWpImportJob({ data: JOB_INPUT })).rejects.toThrow(/No tenant/);
  });

  it("błąd zapisu zadania propaguje komunikat Postgresa", async () => {
    db.setResponse("wp_import_jobs", fail("insert violates policy", "42501"));
    await expect(createWpImportJob({ data: JOB_INPUT })).rejects.toThrow(/insert violates policy/);
  });

  it("brak wiersza po zapisie daje komunikat zastępczy", async () => {
    db.setResponse("wp_import_jobs", ok(null));
    await expect(createWpImportJob({ data: JOB_INPUT })).rejects.toThrow(/cannot create job/);
  });

  it.each([
    ["only_ids powyżej limitu", { only_ids: Array.from({ length: 101 }, (_v, i) => i) }],
    ["only_ids z wartością niecałkowitą", { only_ids: [1.5] }],
    ["język nieznany", { language: "de" }],
    ["sync_existing nie-boolean", { sync_existing: "tak" }],
  ])("%s jest odrzucane przez walidator", async (_l, patch) => {
    await expect(createWpImportJob({ data: { ...JOB_INPUT, ...patch } })).rejects.toThrow();
  });
});

describe("getWpImportJob", () => {
  it("zwraca wiersz zadania", async () => {
    db.setResponse("wp_import_jobs", ok({ id: JOB_ID, status: "completed", processed: 3 }));
    await expect(getWpImportJob({ data: { jobId: JOB_ID } })).resolves.toMatchObject({
      status: "completed",
      processed: 3,
    });
  });

  it("błąd Postgresa propaguje komunikat", async () => {
    db.setResponse("wp_import_jobs", fail("row level security"));
    await expect(getWpImportJob({ data: { jobId: JOB_ID } })).rejects.toThrow(/row level security/);
  });

  it("brak wiersza daje komunikat Job not found", async () => {
    db.setResponse("wp_import_jobs", ok(null));
    await expect(getWpImportJob({ data: { jobId: JOB_ID } })).rejects.toThrow(/Job not found/);
  });

  it.each([
    ["jobId nie-uuid", "abc"],
    ["jobId pusty", ""],
  ])("%s jest odrzucane przez walidator", async (_l, jobId) => {
    await expect(getWpImportJob({ data: { jobId } })).rejects.toThrow();
  });
});

describe("cancelWpImportJob", () => {
  beforeEach(() => {
    db.setResponse("profiles", ok({ tenant_id: TENANT }));
  });

  it("przestawia status na canceled i zapisuje ślad audytowy", async () => {
    db.setResponse("wp_import_jobs", (chain) =>
      chain.has("update") ? ok(null) : ok({ id: JOB_ID, status: "running", tenant_id: TENANT }),
    );
    const res = await cancelWpImportJob({ data: { jobId: JOB_ID } });
    expect(res).toEqual({ jobId: JOB_ID, status: "canceled" });
    expect(h.recordAudit).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      action: "wp_import.cancel",
      entityType: "wp_import_job",
      entityId: JOB_ID,
    });
  });

  it("zadanie NIEISTNIEJĄCE daje Job not found", async () => {
    db.setResponse("wp_import_jobs", ok(null));
    await expect(cancelWpImportJob({ data: { jobId: JOB_ID } })).rejects.toThrow(/Job not found/);
  });

  it("zadanie INNEGO najemcy daje Job not found (nie ujawnia istnienia)", async () => {
    db.setResponse("wp_import_jobs", ok({ id: JOB_ID, status: "running", tenant_id: "obcy" }));
    await expect(cancelWpImportJob({ data: { jobId: JOB_ID } })).rejects.toThrow(/Job not found/);
  });

  it.each(["completed", "failed", "canceled"])(
    "zadanie ze statusem %s zwraca ten status BEZ zapisu",
    async (status) => {
      db.setResponse("wp_import_jobs", ok({ id: JOB_ID, status, tenant_id: TENANT }));
      const res = await cancelWpImportJob({ data: { jobId: JOB_ID } });
      expect(res).toEqual({ jobId: JOB_ID, status });
      expect(db.lastChain("wp_import_jobs")?.has("update")).toBe(false);
      expect(h.recordAudit).not.toHaveBeenCalled();
    },
  );

  it("błąd zapisu statusu propaguje komunikat i pomija audyt", async () => {
    db.setResponse("wp_import_jobs", (chain) =>
      chain.has("update")
        ? fail("update denied")
        : ok({ id: JOB_ID, status: "running", tenant_id: TENANT }),
    );
    await expect(cancelWpImportJob({ data: { jobId: JOB_ID } })).rejects.toThrow(/update denied/);
    expect(h.recordAudit).not.toHaveBeenCalled();
  });
});

describe("runWpImportJob - warunki wstępne", () => {
  beforeEach(() => {
    db.setResponse("profiles", ok({ tenant_id: TENANT }));
  });

  it("BRAK najemcy zatrzymuje bieg", async () => {
    db.setResponse("profiles", ok(null));
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).rejects.toThrow(
      /No tenant/,
    );
  });

  it("zadanie nieistniejące daje Job not found", async () => {
    db.setResponse("wp_import_jobs", ok(null));
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).rejects.toThrow(
      /Job not found/,
    );
  });

  it("zadanie innego najemcy daje Job not found", async () => {
    db.setResponse("wp_import_jobs", ok({ id: JOB_ID, status: "running", tenant_id: "obcy" }));
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).rejects.toThrow(
      /Job not found/,
    );
  });

  it.each(["completed", "failed", "canceled"])(
    "zadanie ze statusem %s nie daje się uruchomić ponownie",
    async (status) => {
      db.setResponse("wp_import_jobs", ok({ id: JOB_ID, status, tenant_id: TENANT }));
      await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).rejects.toThrow(
        new RegExp(`Job already ${status}`),
      );
    },
  );

  it("wczytuje istniejący log zadania, zamiast go nadpisać", async () => {
    const stary = [{ ts: "2026-01-01T00:00:00.000Z", level: "info", msg: "wcześniejszy wpis" }];
    db.setResponse("wp_import_jobs", (chain) => {
      if (chain.has("update")) return ok(null);
      const fields = String(chain.argsOf("select")?.[0] ?? "");
      if (fields.includes("log")) return ok({ log: stary });
      if (fields === "status") return ok({ status: "running" });
      return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
    });
    db.setResponse("pages", ok({ id: PAGE_ID }));
    db.setResponse("posts", ok(null));
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 0, posts: [] }));

    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const logPatch = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> })
      .find((p) => p.log);
    expect(logPatch?.log?.[0].msg).toBe("wcześniejszy wpis");
  });

  it("log NIE-tablicowy w bazie nie wywala biegu", async () => {
    db.setResponse("wp_import_jobs", (chain) => {
      if (chain.has("update")) return ok(null);
      const fields = String(chain.argsOf("select")?.[0] ?? "");
      if (fields.includes("log")) return ok({ log: "uszkodzony" });
      if (fields === "status") return ok({ status: "running" });
      return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
    });
    db.setResponse("pages", ok({ id: PAGE_ID }));
    db.setResponse("posts", ok(null));
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 0, posts: [] }));
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).resolves.toMatchObject({
      status: "completed",
    });
  });
});

describe("runWpImportJob - strona nadrzędna bloga", () => {
  beforeEach(() => {
    db.setResponse("wp_import_jobs", (chain) => {
      if (chain.has("update")) return ok(null);
      const fields = String(chain.argsOf("select")?.[0] ?? "");
      if (fields.includes("log")) return ok({ log: [] });
      if (fields === "status") return ok({ status: "running" });
      return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
    });
    db.setResponse("profiles", ok({ tenant_id: TENANT }));
    db.setResponse("posts", ok(null));
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 0, posts: [] }));
  });

  it("używa ISTNIEJĄCEJ strony blog, zamiast tworzyć drugą", async () => {
    db.setResponse("pages", ok({ id: PAGE_ID }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(db.chainsFor("pages").some((c) => c.has("insert"))).toBe(false);
  });

  it("TWORZY stronę blog, gdy jej nie ma", async () => {
    let seen = 0;
    db.setResponse("pages", (chain) => {
      if (chain.has("insert")) return ok({ id: "page-created" });
      seen += 1;
      return ok(null);
    });
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(seen).toBe(1);
    const row = db
      .chainsFor("pages")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: TENANT,
      author_id: USER,
      slug: "blog",
      status: "published",
    });
    expect(row.published_at).toBe(NOW.toISOString());
  });

  it("błąd tworzenia strony przewraca całe zadanie na failed", async () => {
    db.setResponse("pages", (chain) =>
      chain.has("insert") ? fail("pages insert denied") : ok(null),
    );
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).rejects.toThrow(
      /pages insert denied/,
    );
    const patches = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown>);
    const failed = patches.find((p) => p.status === "failed");
    expect(failed?.error).toContain("pages insert denied");
    expect(failed?.finished_at).toBe(NOW.toISOString());
  });

  it("brak wiersza po utworzeniu strony daje komunikat zastępczy", async () => {
    db.setResponse("pages", ok(null));
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).rejects.toThrow(
      /Cannot create default blog page/,
    );
  });

  it.each([
    ["ścieżka jako string", "blog", true],
    ["ścieżka pusta", "", false],
    ["ścieżka nie-string", 7, false],
    ["ścieżka null", null, false],
  ])("%s decyduje, czy powstaną przekierowania", async (_l, rpcData, expectRedirects) => {
    db.setResponse("pages", ok({ id: PAGE_ID }));
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return ok({ id: "p1", slug: "moj-wpis" });
      if (chain.has("limit")) return ok([]);
      return ok(null);
    });
    db.setResponse("redirects", ok(null));
    h.rpc.mockResolvedValue({ data: rpcData });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(db.chainsFor("redirects").length > 0).toBe(expectRedirects);
  });
});

describe("runWpImportJob - nowy wpis", () => {
  beforeEach(() => {
    planHappyPath();
    h.rpc.mockResolvedValue({ data: "blog" });
  });

  it("wstawia wpis z parą blocks_data/builder_data i zwraca podsumowanie", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res).toMatchObject({
      jobId: JOB_ID,
      status: "completed",
      processed: 1,
      imported: 1,
      updated_count: 0,
      skipped: 0,
      failed: 0,
      media_imported: 0,
    });
    const row = db
      .chainsFor("posts")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: TENANT,
      author_id: USER,
      slug: "moj-wpis",
      parent_page_id: PAGE_ID,
      editor: "builder",
      status: "published",
      published_at: "2024-05-01T10:00:00Z",
      title_pl: "Mój wpis",
    });
    expect(row.blocks_data).toBeDefined();
    expect(row.builder_data).toBeDefined();
  });

  it.each([
    ["publish", "published", "2024-05-01T10:00:00Z"],
    ["draft", "draft", null],
    ["pending", "draft", null],
    ["private", "draft", null],
    ["trash", "archived", null],
  ])("status WP %s mapuje się na %s", async (wpStatus, expected, publishedAt) => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ status: wpStatus })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const row = db
      .chainsFor("posts")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(row.status).toBe(expected);
    expect(row.published_at).toBe(publishedAt);
  });

  it("zapisuje ślad audytowy utworzenia wpisu", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(h.recordAudit).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      action: "post.create",
      entityType: "post",
      entityId: "post-new",
      metadata: { source: "wordpress_com", wp_id: 101 },
    });
  });

  it("błąd wstawienia liczy się jako failed i NIE przewraca całego zadania", async () => {
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return fail("duplicate key value");
      if (chain.has("limit")) return ok([]);
      return ok(null);
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res).toMatchObject({ status: "completed", failed: 1, imported: 0, processed: 1 });
  });

  it("brak wiersza po wstawieniu też liczy się jako failed", async () => {
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return ok(null);
      if (chain.has("limit")) return ok([]);
      return ok(null);
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res.failed).toBe(1);
  });

  it("błąd NIE-Error w pętli też jest zapisywany jako nieznany", async () => {
    db.setResponse("posts", () => {
      throw "awaria bez Error";
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res.failed).toBe(1);
  });

  it("filtruje wpisy po only_ids", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 2,
        posts: [wpPost({ ID: 101 }), wpPost({ ID: 202, slug: "drugi" })],
      }),
    );
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, only_ids: [202] },
    });
    expect(res.processed).toBe(1);
    const row = db
      .chainsFor("posts")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as { slug: string };
    expect(row.slug).toBe("drugi");
  });

  it("BEZ only_ids przetwarza wszystkie wpisy z odpowiedzi", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 2, posts: [wpPost({ ID: 1 }), wpPost({ ID: 2, slug: "b" })] }),
    );
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res.processed).toBe(2);
  });

  it("zapisuje łączną liczbę wpisów do przetworzenia", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const totalPatch = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown>)
      .find((p) => "total" in p);
    expect(totalPatch?.total).toBe(1);
  });

  it("kończy zadanie statusem completed i znacznikiem czasu", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 0, posts: [] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const patches = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown>);
    expect(patches.find((p) => p.status === "completed")?.finished_at).toBe(NOW.toISOString());
  });

  it("nieudany zapis postępu jest logowany ostrzeżeniem, ale nie zatrzymuje biegu", async () => {
    db.setResponse("wp_import_jobs", (chain) => {
      if (chain.has("update")) return fail("job patch denied");
      const fields = String(chain.argsOf("select")?.[0] ?? "");
      if (fields.includes("log")) return ok({ log: [] });
      if (fields === "status") return ok({ status: "running" });
      return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).resolves.toMatchObject({
      status: "completed",
      imported: 1,
    });
    expect(console.warn).toHaveBeenCalledWith("[wp-import] job patch failed:", "job patch denied");
  });
});

describe("runWpImportJob - slug", () => {
  beforeEach(() => {
    planHappyPath();
    h.rpc.mockResolvedValue({ data: "blog" });
  });

  const insertedSlug = (): string =>
    (
      db
        .chainsFor("posts")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0] as {
        slug: string;
      }
    ).slug;

  it("bierze slug z WordPressa, gdy jest", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ slug: "z-wordpressa" })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toBe("z-wordpressa");
  });

  it.each([
    ["wielkie litery", "WIELKIE Litery", "wielkie-litery"],
    ["spacje wielokrotne", "a    b", "a-b"],
    ["myślniki na brzegach", "---brzegi---", "brzegi"],
    ["cyfry", "Rok 2026", "rok-2026"],
    ["kropki i przecinki", "Wersja 2.0, wydanie III", "wersja-2-0-wydanie-iii"],
    // Alfabet spoza łacinki znika W CAŁOŚCI - stąd zapasowe `wp-<ID>` niżej.
    ["znaki cyrylicy", "Привет мир", ""],
    // Diakrytyki ROZKŁADALNE (NFD) tracą znak diakrytyczny, litera zostaje.
    ["diakrytyki rozkładalne", "gęślą jaźń", "gesla-jazn"],
    ["diakrytyki francuskie", "Café très", "cafe-tres"],
  ])("BEZ sluga buduje go z tytułu: %s", async (_l, title, expected) => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost({ slug: "", title })] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    // Pusty wynik `slugify` musi mieć zapasową nazwę - inaczej wpis dostaje
    // pusty adres i przestaje być osiągalny.
    expect(insertedSlug()).toBe(expected || "wp-101");
  });

  // DEFEKT PRODUKCYJNY (zgłoszony, nie obejściony) - KALECZENIE POLSKICH ADRESÓW.
  // `slugify` liczy na `normalize("NFD")`, żeby zdjąć znaki diakrytyczne, ale
  // polskie `ł`/`Ł` (U+0142/U+0141) NIE MAJĄ rozkładu kanonicznego: NFD zostawia
  // je bez zmian, a następne `replace(/[^a-z0-9]+/g, "-")` zamienia je na
  // MYŚLNIK. W CMS-ie pisanym po polsku to nie przypadek brzegowy:
  //   „Łódź Śródmieście" -> „odz-srodmiescie"  (wiodąca Ł wypada bez śladu)
  //   „Tytuł: podtytuł"  -> „tytu-podtytu"
  //   „Żółw"             -> „zo-w"
  // Adres przestaje przypominać tytuł, a przy okazji rośnie ryzyko kolizji:
  // „Tytuł" i „Tytu" dają ten sam rdzeń, więc drugi wpis dostaje sufiks `-2`
  // i adres inny niż ten, który autor podał w komunikacji.
  // Naprawa to mapa transliteracji przed NFD (ł->l, Ł->L, a przy okazji ø, đ,
  // ß) - zmiana zachowania produkcyjnego, więc poza zakresem zadania
  // pokryciowego. Testy STOJĄ jako dowód.
  it.fails.each([
    ["Łódź Śródmieście", "lodz-srodmiescie"],
    ["Tytuł: podtytuł, cz. 2!", "tytul-podtytul-cz-2"],
    ["Zażółć gęślą jaźń", "zazolc-gesla-jazn"],
    ["Żółw", "zolw"],
  ])("POWINNO transliterować polskie ł w %s na %s", async (title, expected) => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost({ slug: "", title })] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toBe(expected);
  });

  it.each([
    ["Łódź Śródmieście", "odz-srodmiescie"],
    ["Tytuł: podtytuł, cz. 2!", "tytu-podtytu-cz-2"],
    ["Zażółć gęślą jaźń", "zazo-c-gesla-jazn"],
    ["Żółw", "zo-w"],
  ])("dziś %s daje okaleczony slug %s", async (title, expected) => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost({ slug: "", title })] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toBe(expected);
  });

  it("obcina slug do 120 znaków", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ slug: "", title: "a".repeat(200) })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toHaveLength(120);
  });

  it("BEZ sluga i BEZ tytułu używa identyfikatora WordPressa", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ slug: "", title: "", ID: 555 })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toBe("wp-555");
  });

  it("KOLIZJA sluga daje wariant z sufiksem -2", async () => {
    let probes = 0;
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return ok({ id: "p1", slug: "moj-wpis-2" });
      if (chain.has("limit")) {
        probes += 1;
        return probes === 1 ? ok([{ id: "kolizja" }]) : ok([]);
      }
      return ok(null);
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toBe("moj-wpis-2");
  });

  it("KOLIZJA WIELOKROTNA idzie dalej po numerach", async () => {
    let probes = 0;
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return ok({ id: "p1", slug: "x" });
      if (chain.has("limit")) {
        probes += 1;
        return probes <= 3 ? ok([{ id: "kolizja" }]) : ok([]);
      }
      return ok(null);
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    // Trzy kolizje: base, base-2, base-3 zajęte -> wolne jest base-4.
    expect(insertedSlug()).toBe("moj-wpis-4");
  });

  it("po wyczerpaniu prób dokleja znacznik czasu, zamiast nadpisać cudzy wpis", async () => {
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return ok({ id: "p1", slug: "x" });
      if (chain.has("limit")) return ok([{ id: "zawsze-kolizja" }]);
      return ok(null);
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedSlug()).toBe(`moj-wpis-${NOW.getTime().toString(36)}`);
  });

  it("BŁĄD sprawdzania kolizji liczy się jako failed (nie ryzykujemy nadpisania)", async () => {
    db.setResponse("posts", (chain) => {
      if (chain.has("limit")) return fail("select denied");
      return ok(null);
    });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res).toMatchObject({ failed: 1, imported: 0 });
  });

  it("zapytanie o kolizję filtruje po najemcy i slugu", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const probe = db.chainsFor("posts").find((c) => c.has("limit")) as RecordedChain;
    const eqArgs = probe.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toEqual([
      ["tenant_id", TENANT],
      ["slug", "moj-wpis"],
    ]);
  });
});

describe("runWpImportJob - wpis istniejący", () => {
  const existing = {
    id: "post-existing",
    cover_image_url: null,
    editor: "builder",
    title_pl: "Stary PL",
    title_en: "Ręcznie napisany EN",
    excerpt_pl: "Zajawka PL",
    excerpt_en: "Hand-written EN excerpt",
    blocks_data: {
      pl: { version: 1, blocks: [] },
      en: { version: 1, blocks: [{ id: "b", type: "paragraph", data: { html: "EN" } }] },
    },
    builder_data: null,
  };

  beforeEach(() => {
    planHappyPath({ existingPost: existing });
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
  });

  it("BEZ sync_existing wpis jest POMIJANY, nie nadpisywany", async () => {
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res).toMatchObject({ skipped: 1, imported: 0, updated_count: 0 });
    expect(db.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
    expect(db.chainsFor("posts").some((c) => c.has("insert"))).toBe(false);
  });

  it("Z sync_existing wpis jest AKTUALIZOWANY", async () => {
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true },
    });
    expect(res).toMatchObject({ updated_count: 1, imported: 0, skipped: 0 });
  });

  it("aktualizacja ZACHOWUJE ręcznie napisaną wersję w drugim języku", async () => {
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    const patch = db
      .chainsFor("posts")
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(patch.title_pl).toBe("Mój wpis");
    // To jest sedno kontraktu językowego: import PL nie ma prawa wyczyścić EN.
    expect(patch.title_en).toBe("Ręcznie napisany EN");
    expect(patch.excerpt_en).toBe("Hand-written EN excerpt");
  });

  it("aktualizacja filtruje po id ORAZ po najemcy", async () => {
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    const chain = db.chainsFor("posts").find((c) => c.has("update")) as RecordedChain;
    const eqArgs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqArgs).toEqual([
      ["id", "post-existing"],
      ["tenant_id", TENANT],
    ]);
  });

  it("aktualizacja loguje zachowanie drugiego języka", async () => {
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Kept existing EN version"))).toBe(true);
    expect(messages.some((m) => m.includes("Updated: moj-wpis"))).toBe(true);
  });

  it("zapisuje ślad audytowy aktualizacji z informacją o zachowanym języku", async () => {
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "post.update",
        entityId: "post-existing",
        metadata: expect.objectContaining({
          source: "wordpress_com",
          wp_id: 101,
          language: "pl",
          counterpart_preserved: true,
        }),
      }),
    );
  });

  it("wpis BEZ wersji w drugim języku nie zgłasza jej zachowania", async () => {
    planHappyPath({
      existingPost: { ...existing, title_en: "", excerpt_en: null, blocks_data: null },
    });
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    expect(h.recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({ counterpart_preserved: false }),
      }),
    );
  });

  it("BŁĄD aktualizacji liczy się jako failed", async () => {
    db.setResponse("posts", (chain) => {
      if (chain.has("update")) return fail("update denied");
      if (chain.has("limit")) return ok([]);
      return ok(existing);
    });
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true },
    });
    expect(res).toMatchObject({ failed: 1, updated_count: 0 });
  });

  it("ZMIANA okładki jest logowana", async () => {
    planHappyPath({ existingPost: { ...existing, cover_image_url: "https://stara.test/a.jpg" } });
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ featured_image: "https://nowa.test/b.jpg" })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Cover updated"))).toBe(true);
  });

  it("USUNIĘCIE okładki jest logowane osobnym komunikatem", async () => {
    planHappyPath({ existingPost: { ...existing, cover_image_url: "https://stara.test/a.jpg" } });
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [wpPost({ featured_image: null, content: "<p>bez obrazu</p>" })],
      }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Cover cleared"))).toBe(true);
  });

  it("BEZ zmiany okładki nie loguje jej wcale", async () => {
    planHappyPath({ existingPost: { ...existing, cover_image_url: null } });
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [wpPost({ featured_image: null, content: "<p>bez obrazu</p>" })],
      }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Cover"))).toBe(false);
  });

  it("wpis w statusie draft NIE dostaje przekierowania (nie ma czego przekierować)", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost({ status: "draft" })] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, sync_existing: true } });
    expect(db.chainsFor("redirects")).toHaveLength(0);
  });
});

describe("runWpImportJob - okładka", () => {
  beforeEach(() => {
    planHappyPath();
    h.rpc.mockResolvedValue({ data: "blog" });
  });

  const insertedCover = (): unknown =>
    (
      db
        .chainsFor("posts")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0] as {
        cover_image_url: unknown;
      }
    ).cover_image_url;

  it("bierze featured_image, gdy jest", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ featured_image: "https://wp.test/a.jpg" })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedCover()).toBe("https://wp.test/a.jpg");
  });

  it.each([
    ["featured_image null", null],
    ["featured_image pusty", ""],
    ["featured_image z samych spacji", "   "],
  ])("%s spada na PIERWSZY obraz z treści", async (_l, featured) => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [
          wpPost({
            featured_image: featured,
            content:
              '<p>a</p><img src="https://wp.test/z-tresci.jpg"><img src="https://wp.test/druga.jpg">',
          }),
        ],
      }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedCover()).toBe("https://wp.test/z-tresci.jpg");
  });

  it("BEZ featured_image i BEZ obrazu w treści okładka jest null, nie pustym stringiem", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [wpPost({ featured_image: null, content: "<p>tekst</p>" })],
      }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(insertedCover()).toBeNull();
  });

  it("treść PUSTA nie wywala szukania okładki", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ content: "", featured_image: null })] }),
    );
    await expect(runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } })).resolves.toMatchObject({
      imported: 1,
    });
  });
});

describe("runWpImportJob - przekierowania z dawnych adresów", () => {
  beforeEach(() => {
    planHappyPath();
    h.rpc.mockResolvedValue({ data: "blog" });
  });

  it("zapisuje przekierowanie 301 ze starego adresu WordPressa", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const row = db.lastChain("redirects")?.argsOf("upsert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: TENANT,
      source_path: "/2024/05/moj-wpis",
      target_path: "/blog/moj-wpis",
      status_code: 301,
      source: "wp_import",
      created_by: USER,
      is_enabled: true,
    });
  });

  it("upsert idzie po kluczu (tenant, source_path) - drugi import nie duplikuje wpisu", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(db.lastChain("redirects")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "tenant_id,source_path",
    });
  });

  it.each([
    ["adres WP nieobecny", undefined],
    ["adres WP pusty", ""],
  ])("%s nie tworzy przekierowania", async (_l, url) => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost({ URL: url })] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(db.chainsFor("redirects")).toHaveLength(0);
  });

  it("przekierowanie NA SIEBIE nie jest zapisywane (pętla 301)", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [wpPost({ URL: "https://blog.test/blog/moj-wpis" })],
      }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(db.chainsFor("redirects")).toHaveLength(0);
  });

  it("przekierowanie ze STRONY GŁÓWNEJ nie jest zapisywane", async () => {
    fetchMock().mockResolvedValue(
      jsonResponse({ found: 1, posts: [wpPost({ URL: "https://blog.test/" })] }),
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(db.chainsFor("redirects")).toHaveLength(0);
  });

  it("BŁĄD zapisu przekierowania NIE przewraca importu wpisu", async () => {
    db.setResponse("redirects", fail("redirects upsert denied"));
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res).toMatchObject({ imported: 1, failed: 0 });
    expect(console.warn).toHaveBeenCalledWith(
      "[wp-import] redirect capture failed:",
      expect.any(Error),
    );
  });

  it("liczba przekierowań trafia do podsumowania w logu", async () => {
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("redirects=1"))).toBe(true);
  });
});

describe("runWpImportJob - anulowanie w trakcie", () => {
  it("przerywa pętlę i finalizuje zadanie jako canceled", async () => {
    db.setResponse("wp_import_jobs", (chain) => {
      if (chain.has("update")) return ok(null);
      const fields = String(chain.argsOf("select")?.[0] ?? "");
      if (fields.includes("log")) return ok({ log: [] });
      if (fields === "status") return ok({ status: "canceled" });
      return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
    });
    db.setResponse("profiles", ok({ tenant_id: TENANT }));
    db.setResponse("pages", ok({ id: PAGE_ID }));
    db.setResponse("posts", ok(null));
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));

    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res).toMatchObject({ status: "canceled", processed: 0, imported: 0 });
    // Anulowanie NIE MOŻE zapisać wpisu.
    expect(db.chainsFor("posts").some((c) => c.has("insert"))).toBe(false);
    const patches = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("update")?.[0] as Record<string, unknown>);
    expect(patches.find((p) => p.status === "canceled")?.finished_at).toBe(NOW.toISOString());
  });

  it("status null z bazy NIE jest traktowany jako anulowanie", async () => {
    db.setResponse("wp_import_jobs", (chain) => {
      if (chain.has("update")) return ok(null);
      const fields = String(chain.argsOf("select")?.[0] ?? "");
      if (fields.includes("log")) return ok({ log: [] });
      if (fields === "status") return ok(null);
      return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
    });
    db.setResponse("profiles", ok({ tenant_id: TENANT }));
    db.setResponse("pages", ok({ id: PAGE_ID }));
    db.setResponse("posts", (chain) => {
      if (chain.has("insert")) return ok({ id: "p1", slug: "moj-wpis" });
      if (chain.has("limit")) return ok([]);
      return ok(null);
    });
    db.setResponse("redirects", ok(null));
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 1, posts: [wpPost()] }));
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res.status).toBe("completed");
  });
});

describe("runWpImportJob - host witryny", () => {
  beforeEach(() => {
    planHappyPath();
    h.rpc.mockResolvedValue({ data: "blog" });
    fetchMock().mockResolvedValue(jsonResponse({ found: 0, posts: [] }));
  });

  it.each([
    ["nazwa bez schematu", "blog.test"],
    ["adres z https", "https://blog.test"],
    ["adres z http", "http://blog.test/sciezka"],
    ["nazwa z portem", "blog.test:8443"],
  ])("%s nie wywala biegu", async (_l, site) => {
    await expect(
      runWpImportJob({ data: { ...JOB_INPUT, site, jobId: JOB_ID } }),
    ).resolves.toMatchObject({ status: "completed" });
  });
});

describe("runWpImportJob - import mediów", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  beforeEach(() => {
    planHappyPath();
    h.rpc.mockResolvedValue({ data: "blog" });
    admin.setResponse("media", (chain) => (chain.has("insert") ? ok(null) : ok(null)));
  });

  /** Pierwsze wywołanie `fetch` to bramka WP.com, kolejne to pliki mediów. */
  function planFetch(postsBody: unknown, mediaResponses: Response[]): void {
    const queue = [...mediaResponses];
    fetchMock().mockImplementation((url: string) => {
      if (String(url).includes("connector-gateway")) {
        return Promise.resolve(jsonResponse(postsBody));
      }
      return Promise.resolve(queue.shift() ?? binaryResponse(bytes, "image/jpeg"));
    });
  }

  it("BEZ import_media nie pobiera żadnego pliku", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, []);
    const res = await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID } });
    expect(res.media_imported).toBe(0);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("Z import_media pobiera okładkę i podmienia adres na własny", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(1);
    const row = db
      .chainsFor("posts")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as { cover_image_url: string };
    expect(row.cover_image_url).toBe("https://cdn.test/a.jpg");
  });

  it("ścieżka w koszyku zawiera najemcę i skrót treści (deduplikacja)", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    const [path, , options] = h.upload.mock.calls[0];
    expect(String(path)).toMatch(new RegExp(`^${TENANT}/wp-import/[0-9a-f]{32}\\.jpg$`));
    expect(options).toEqual({ contentType: "image/jpeg", upsert: true });
  });

  it("SSRF: każdy adres przechodzi przez bramkę wyjścia przed pobraniem", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    expect(h.assertPublicHttpUrl).toHaveBeenCalledWith("https://blog.test/a.jpg");
  });

  it("SSRF: odrzucenie przez bramkę wyjścia loguje ostrzeżenie i zostawia stary adres", async () => {
    h.assertPublicHttpUrl.mockRejectedValue(new Error("blocked private host"));
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, []);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res).toMatchObject({ imported: 1, media_imported: 0 });
    const row = db
      .chainsFor("posts")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as { cover_image_url: string };
    expect(row.cover_image_url).toBe("https://blog.test/a.jpg");
  });

  it.each([
    ["https://blog.test/a.jpg", "host witryny"],
    ["https://i0.wp.com/a.jpg", "CDN wp.com"],
    ["https://x.files.wordpress.com/a.jpg", "files.wordpress.com"],
    ["https://blog.wordpress.com/a.jpg", "wordpress.com"],
  ])("%s (%s) jest uznawany za media WordPressa", async (url) => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: url })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(1);
  });

  it.each([
    ["https://obcy.test/a.jpg", "obcy host"],
    ["ftp://wp.test/a.jpg", "schemat nie-HTTP"],
    ["to nie adres", "adres nieparsowalny"],
  ])("%s (%s) NIE jest pobierany, adres zostaje bez zmian", async (url) => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: url })] }, []);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(0);
    const row = db
      .chainsFor("posts")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as { cover_image_url: string };
    expect(row.cover_image_url).toBe(url);
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["image/svg+xml", "svg"],
    ["image/avif", "avif"],
  ])("typ %s bez rozszerzenia w adresie dostaje rozszerzenie %s", async (mime, ext) => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/plik" })] }, [
      binaryResponse(bytes, mime),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    expect(String(h.upload.mock.calls[0][0])).toMatch(new RegExp(`\\.${ext}$`));
  });

  it("rozszerzenie z adresu ma pierwszeństwo nad typem MIME", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.webp?v=2" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    expect(String(h.upload.mock.calls[0][0])).toMatch(/\.webp$/);
  });

  it("typ MIME POZA listą dozwolonych jest odrzucany z komunikatem", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "application/pdf"),
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(0);
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("mime not allowed: application/pdf"))).toBe(true);
  });

  it("odpowiedź BEZ nagłówka content-type nie przechodzi listy dozwolonych typów", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => bytes.buffer,
      } as unknown as Response,
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(0);
  });

  it("PLIK ZA DUŻY jest odrzucany, a wpis importuje się dalej", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(big, "image/jpeg"),
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res).toMatchObject({ imported: 1, media_imported: 0 });
  });

  it("nieudane pobranie pliku (404) nie przewraca importu wpisu", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg", 404),
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res).toMatchObject({ imported: 1, media_imported: 0 });
  });

  it("błąd zapisu do koszyka jest raportowany, wpis importuje się dalej", async () => {
    h.upload.mockResolvedValue({ error: pgError("storage full") });
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res).toMatchObject({ imported: 1, media_imported: 0 });
  });

  it("zapisuje wiersz w tabeli mediów, gdy pliku jeszcze nie ma", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    const row = admin
      .chainsFor("media")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenant_id: TENANT,
      uploader_id: USER,
      public_url: "https://cdn.test/a.jpg",
      filename: "a.jpg",
      mime_type: "image/jpeg",
      size_bytes: 4,
    });
  });

  it("NIE dubluje wiersza mediów, gdy plik już jest w bazie", async () => {
    admin.setResponse("media", (chain) => (chain.has("insert") ? ok(null) : ok({ id: "media-1" })));
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/a.jpg" })] }, [
      binaryResponse(bytes, "image/jpeg"),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    expect(admin.chainsFor("media").some((c) => c.has("insert"))).toBe(false);
  });

  it("nazwa pliku bez czytelnego ogona spada na skrót treści", async () => {
    planFetch({ found: 1, posts: [wpPost({ featured_image: "https://blog.test/" })] }, [
      binaryResponse(bytes, "image/png"),
    ]);
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    const row = admin
      .chainsFor("media")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0] as { filename: string };
    expect(row.filename).toMatch(/^[0-9a-f]{32}\.png$/);
  });

  it.each([
    ["src", '<img src="https://blog.test/a.jpg">'],
    ["href", '<a href="https://blog.test/a.jpg">l</a>'],
    ["data-src", '<img data-src="https://blog.test/a.jpg">'],
    ["data-large-file", '<img data-large-file="https://blog.test/a.jpg">'],
    ["data-medium-file", '<img data-medium-file="https://blog.test/a.jpg">'],
    ["data-orig-file", '<img data-orig-file="https://blog.test/a.jpg">'],
    ["poster", '<video poster="https://blog.test/a.jpg"></video>'],
  ])("przepisuje media z atrybutu %s w treści", async (_l, snippet) => {
    planFetch(
      { found: 1, posts: [wpPost({ featured_image: null, content: `<p>a</p>${snippet}` })] },
      [binaryResponse(bytes, "image/jpeg")],
    );
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(1);
  });

  it("przepisuje media z atrybutu srcset (wiele adresów w jednym atrybucie)", async () => {
    planFetch(
      {
        found: 1,
        posts: [
          wpPost({
            featured_image: null,
            content: '<img srcset="https://blog.test/a.jpg 1x, https://blog.test/b.jpg 2x">',
          }),
        ],
      },
      [binaryResponse(bytes, "image/jpeg"), binaryResponse(new Uint8Array([9, 9]), "image/jpeg")],
    );
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(2);
  });

  it("srcset z pustym wpisem nie wywala przepisywania", async () => {
    planFetch(
      { found: 1, posts: [wpPost({ featured_image: null, content: '<img srcset=" , ">' })] },
      [],
    );
    await expect(
      runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } }),
    ).resolves.toMatchObject({ imported: 1 });
  });

  it("treść BEZ mediów WordPressa nie uruchamia ani jednego pobrania", async () => {
    planFetch(
      {
        found: 1,
        posts: [wpPost({ featured_image: null, content: '<img src="https://obcy.test/a.jpg">' })],
      },
      [],
    );
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(0);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("ten sam adres pobierany DWA razy idzie z pamięci (jeden zapis)", async () => {
    planFetch(
      {
        found: 1,
        posts: [
          wpPost({
            featured_image: "https://blog.test/a.jpg",
            content: '<img src="https://blog.test/a.jpg">',
          }),
        ],
      },
      [binaryResponse(bytes, "image/jpeg")],
    );
    const res = await runWpImportJob({
      data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true },
    });
    expect(res.media_imported).toBe(1);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it("błąd pobrania obrazu Z TREŚCI jest logowany z adresem", async () => {
    planFetch(
      {
        found: 1,
        posts: [wpPost({ featured_image: null, content: '<img src="https://blog.test/zly.jpg">' })],
      },
      [binaryResponse(bytes, "image/jpeg", 500)],
    );
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Media skipped https://blog.test/zly.jpg"))).toBe(true);
  });

  it("błąd NIE-Error przy pobieraniu obrazu z treści też jest logowany", async () => {
    fetchMock().mockImplementation((url: string) => {
      if (String(url).includes("connector-gateway")) {
        return Promise.resolve(
          jsonResponse({
            found: 1,
            posts: [
              wpPost({ featured_image: null, content: '<img src="https://blog.test/z.jpg">' }),
            ],
          }),
        );
      }
      return Promise.reject("awaria bez Error");
    });
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Media skipped") && m.includes("unknown"))).toBe(true);
  });

  it("błąd NIE-Error przy pobieraniu OKŁADKI jest logowany osobnym komunikatem", async () => {
    fetchMock().mockImplementation((url: string) => {
      if (String(url).includes("connector-gateway")) {
        return Promise.resolve(
          jsonResponse({
            found: 1,
            posts: [wpPost({ featured_image: "https://blog.test/c.jpg" })],
          }),
        );
      }
      return Promise.reject("awaria bez Error");
    });
    await runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } });
    const messages = db
      .chainsFor("wp_import_jobs")
      .filter((c) => c.has("update"))
      .flatMap((c) => {
        const patch = c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> };
        return patch.log?.map((e) => e.msg) ?? [];
      });
    expect(messages.some((m) => m.includes("Cover image failed") && m.includes("unknown"))).toBe(
      true,
    );
  });

  it("treść PUSTA z włączonym importem mediów nie uruchamia przepisywania", async () => {
    planFetch({ found: 1, posts: [wpPost({ content: "", featured_image: null })] }, []);
    await expect(
      runWpImportJob({ data: { ...JOB_INPUT, jobId: JOB_ID, import_media: true } }),
    ).resolves.toMatchObject({ imported: 1, media_imported: 0 });
  });
});
