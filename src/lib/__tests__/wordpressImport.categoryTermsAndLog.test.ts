// Import z WordPress.com - KATEGORIE i LOG ZADANIA w przypadkach, których
// główny plik (`wordpressImport.functions.test.ts`) nie dowodzi.
//
// CO TEN PLIK DOWODZI (i dlaczego to zachowanie, a nie linie):
//   * NAZWY i SLUGI terminów przychodzą z WP.com zakodowane (`&#x17c;`,
//     `%c5%bc`). Kategoria lokalna musi dostać nazwę czytelną dla redakcji
//     i ten sam slug, jaki dałby `slugify` - inaczej każdy bieg zakłada
//     duplikat. Kod znaku spoza Unicode i zepsute `%` nie mogą wywrócić wpisu.
//   * BŁĄD ODCZYTU kategorii jest PRZEJŚCIOWY: wpis się importuje, błąd trafia
//     do logu, a kolejny wpis próbuje ponownie (w odróżnieniu od odmowy
//     założenia, którą raportujemy raz na bieg).
//   * WYŚCIG: kategoria „założona" przez upsert, ale niewidoczna także po
//     ponownym odczycie, jest raportowana z nazwą sluga i powodem.
//   * LOG ZADANIA ma sufit 500 wpisów: przy długim biegu odpadają NAJSTARSZE.
//   * TYTUŁ z dosłownym „&lt;" (WP: `&amp;lt;`) nie rozwija się dwa razy do
//     znacznika (`&amp;` rozwijane jako ostatnie - naprawione 2026-10-18).
//
// GRANICE (atrapy): `createServerFn` (`@/test/serverFn`), klient PostgREST
// (`@/test/supabaseChain`), `fetch` do WP.com, limiter, audyt, strażnik
// egress, klient service_role. Mapowanie terminów, resolver kategorii
// i logger biegną prawdziwe.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { resetServerFnContext, setServerFnContext } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  recordAudit: vi.fn(),
  rateLimit: vi.fn(),
  assertPublicHttpUrl: vi.fn(),
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
  supabaseAdmin: { from: (t: string) => admin.from(t), storage: { from: () => ({}) } },
}));

import { runWpImportJob } from "@/lib/wordpress-import.functions";

const db = supabaseFromStub();
const admin = supabaseFromStub();

const TENANT = "tenant-1";
const JOB_ID = "11111111-2222-3333-4444-555555555555";
const JOB_INPUT = {
  jobId: JOB_ID,
  site: "blog.test",
  number: 20,
  offset: 0,
  status: "publish" as const,
  type: "post" as const,
  language: "pl" as const,
  sync_existing: false,
  import_media: false,
};

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

function wpPost(id: number, categories: unknown): Record<string, unknown> {
  return {
    ID: id,
    slug: `wpis-${id}`,
    title: `Wpis ${id}`,
    excerpt: "",
    content: "<p>Treść</p>",
    status: "publish",
    date: "2024-05-01T10:00:00Z",
    modified: "2024-05-02T10:00:00Z",
    URL: `https://blog.test/wpis-${id}/`,
    featured_image: null,
    categories,
  };
}

/** Szczęśliwa ścieżka biegu; `log` = log zadania zapisany przed biegiem. */
function planRun(log: unknown[] = []): void {
  db.setResponse("wp_import_jobs", (chain) => {
    if (chain.has("update")) return ok(null);
    const fields = String(chain.argsOf("select")?.[0] ?? "");
    if (fields.includes("log")) return ok({ log });
    if (fields === "status") return ok({ status: "running" });
    return ok({ id: JOB_ID, status: "running", tenant_id: TENANT });
  });
  db.setResponse("profiles", ok({ tenant_id: TENANT }));
  db.setResponse("pages", ok({ id: "page-blog" }));
  db.setResponse("posts", (chain) => {
    if (chain.has("insert")) {
      const row = chain.argsOf("insert")?.[0] as { slug: string };
      return ok({ id: `post-${row.slug}`, slug: row.slug });
    }
    if (chain.has("contains") || chain.has("limit")) return ok([]);
    return ok(null);
  });
  db.setResponse("redirects", ok(null));
  db.setResponse("post_categories", ok(null));
}

/** Ostatni zapis logu zawiera cały bufor (logger zapisuje go przy każdym wpisie). */
function lastLog(): Array<{ msg: string }> {
  const patches = db
    .chainsFor("wp_import_jobs")
    .filter((c) => c.has("update"))
    .map((c) => c.argsOf("update")?.[0] as { log?: Array<{ msg: string }> });
  return patches.filter((p) => p.log).at(-1)?.log ?? [];
}

const upsertedCategories = (): Array<{ slug: string; name_pl: string }> =>
  db
    .chainsFor("categories")
    .filter((c) => c.has("upsert"))
    .flatMap((c) => c.argsOf("upsert")?.[0] as Array<{ slug: string; name_pl: string }>);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-19T12:00:00.000Z"));
  db.reset();
  admin.reset();
  h.rpc.mockReset().mockResolvedValue({ data: "blog" });
  h.recordAudit.mockReset().mockResolvedValue(undefined);
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.assertPublicHttpUrl.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("LOVABLE_API_KEY", "platform-key");
  vi.stubEnv("WORDPRESS_COM_API_KEY", "wp-key");
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "warn").mockImplementation(() => {});
  setServerFnContext({
    supabase: { from: (t: string) => db.from(t), rpc: h.rpc },
    userId: "user-1",
  });
});

afterEach(() => {
  resetServerFnContext();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fetchPosts = (posts: unknown[]): void => {
  vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ found: posts.length, posts }));
};

describe("runWpImportJob - zakodowane nazwy i slugi terminów", () => {
  beforeEach(() => {
    planRun();
    db.setResponse("categories", (chain) => {
      if (!chain.has("upsert")) return ok([]);
      const rows = chain.argsOf("upsert")?.[0] as Array<{ slug: string }>;
      return ok(rows.map((r) => ({ id: `cat-${r.slug}`, slug: r.slug })));
    });
  });

  it("zakłada kategorie z rozkodowaną nazwą i slugiem zgodnym ze slugify", async () => {
    fetchPosts([
      wpPost(1, {
        a: { name: "&#x17b;ycie &#38; praca", slug: "%c5%bcycie-praca" },
        b: { name: "<b>Gospodarka</b> &#8211; UE" },
        c: { name: "Zepsute %", slug: "%E0%A4%A" },
        d: { name: "Znak &#x110000;spoza", slug: "" },
        e: "nie-obiekt",
        f: null,
      }),
    ]);
    const res = await runWpImportJob({ data: JOB_INPUT });

    expect(res).toMatchObject({ imported: 1, failed: 0 });
    expect(upsertedCategories().map((r) => [r.slug, r.name_pl])).toEqual([
      ["zycie-praca", "Życie & praca"],
      // Półpauza z WP jest spłaszczana do „-" jak w tytułach wpisów.
      ["gospodarka-ue", "Gospodarka - UE"],
      ["e0-a4-a", "Zepsute %"],
      ["znak-spoza", "Znak spoza"],
    ]);
  });

  it("dwa terminy normalizujące się do jednego sluga dają JEDNĄ kategorię", async () => {
    fetchPosts([
      wpPost(1, {
        a: { name: "Polityka", slug: "polityka" },
        b: { name: "POLITYKA", slug: "Polityka" },
      }),
    ]);
    await runWpImportJob({ data: JOB_INPUT });
    expect(upsertedCategories().map((r) => r.slug)).toEqual(["polityka"]);
  });
});

describe("runWpImportJob - encje w tytule wpisu", () => {
  it("dosłowny tekst &lt;b&gt; w tytule NIE rozwija się dwa razy do znacznika", async () => {
    planRun();
    db.setResponse("categories", ok([]));
    fetchPosts([{ ...wpPost(1, {}), title: "Kod &amp;lt;b&amp;gt; i R&amp;D" }]);
    await runWpImportJob({ data: JOB_INPUT });
    const insert = db.chainsFor("posts").find((c) => c.has("insert"));
    expect((insert?.argsOf("insert")?.[0] as { title_pl: string }).title_pl).toBe(
      "Kod &lt;b&gt; i R&D",
    );
  });
});

describe("runWpImportJob - błędy resolvera kategorii", () => {
  it("błąd odczytu jest przejściowy: wpis wchodzi, błąd w logu, kolejny wpis próbuje znowu", async () => {
    planRun();
    let lookups = 0;
    db.setResponse("categories", () => {
      lookups += 1;
      return lookups === 1 ? fail("statement timeout") : ok([{ id: "cat-pol", slug: "polityka" }]);
    });
    const cats = { p: { name: "Polityka", slug: "polityka" } };
    fetchPosts([wpPost(1, cats), wpPost(2, cats)]);

    const res = await runWpImportJob({ data: JOB_INPUT });

    expect(res).toMatchObject({ imported: 2, failed: 0 });
    expect(lastLog().map((e) => e.msg)).toContain("Categories lookup failed: statement timeout");
    const links = db
      .chainsFor("post_categories")
      .map((c) => c.argsOf("upsert")?.[0] as Array<{ post_id: string; category_id: string }>);
    expect(links).toEqual([[{ post_id: "post-wpis-2", category_id: "cat-pol" }]]);
  });

  it("kategoria niewidoczna także po ponownym odczycie jest raportowana ze slugiem i powodem", async () => {
    planRun();
    db.setResponse("categories", ok([]));
    fetchPosts([wpPost(1, { p: { name: "Polityka", slug: "polityka" } })]);

    const res = await runWpImportJob({ data: JOB_INPUT });

    expect(res).toMatchObject({ imported: 1, failed: 0 });
    expect(lastLog().map((e) => e.msg)).toContain(
      "Categories not created (polityka): not visible after insert",
    );
    expect(db.chainsFor("post_categories")).toHaveLength(0);
  });
});

describe("runWpImportJob - sufit logu zadania", () => {
  it("log z poprzednich biegów jest przycinany do 500 NAJNOWSZYCH wpisów", async () => {
    const stary = Array.from({ length: 520 }, (_, i) => ({
      ts: "2026-08-18T00:00:00.000Z",
      level: "info",
      msg: `stary-${i}`,
    }));
    planRun(stary);
    db.setResponse("categories", ok([]));
    fetchPosts([]);

    await runWpImportJob({ data: JOB_INPUT });

    const log = lastLog();
    expect(log).toHaveLength(500);
    expect(log.some((e) => e.msg === "stary-0")).toBe(false);
    expect(log.at(-1)?.msg).not.toMatch(/^stary-/);
  });
});
