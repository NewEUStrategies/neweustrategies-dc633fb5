// SERWEROWA ORKIESTRACJA IMPORTU STRON Z WORDPRESSA - implementacja B
// (`src/lib/wp-import.functions.ts`, 0% przed tą zmianą; 5 server functions:
// wpListPages, wpPreviewPage, listExistingPages, wpImportPages,
// wpImportFromWxr). To DRUGA, niezależna ścieżka importu w repo: pierwsza
// (`wordpress-import.functions.ts`) wciąga WPISY blogowe, ta wciąga STRONY do
// `builder_data` i jest JEDYNĄ drogą wejścia dla pliku WXR.
//
// JAK TE FUNKCJE SĄ TU WOŁANE. `createServerFn` nie da się uruchomić bez
// kontekstu żądania frameworka, więc `@tanstack/react-start` jest podmieniony
// na łańcuch, który ODDAJE walidator i handler - ten sam wzorzec, co
// `revisionsFunctions.test.ts` i `categoryColorSave.test.ts`. Handler dostaje
// kontekst, który w produkcji wstawia `requireStaff` (`supabase` + `userId`).
//
// CO MA TU DOWÓD:
//   1. BRAMKA KONEKTORA: bez obu kluczy w środowisku żadne zapytanie nie wychodzi,
//      a komunikat mówi, czego brakuje; nagłówki autoryzacyjne i parametry
//      zapytania są dokładnie te, których oczekuje gateway,
//   2. FAIL-CLOSED NA TENANCIE: brak profilu / brak `tenant_id` / błąd zapytania
//      kończy się wyjątkiem, nigdy zapytaniem bez filtra najemcy,
//   3. TWARDE POMINIĘCIE `/main` we WSZYSTKICH CZTERECH miejscach, w których
//      istnieje (slug źródłowy i slug strony docelowej, osobno dla konektora
//      i dla WXR) - `main` to strona główna, nadpisanie jej kasuje witrynę,
//   4. MIGAWKA PRZED NADPISANIEM: wpis do `content_revisions` powstaje PRZED
//      UPDATE na `pages`, z notatką `wp_import_pre_overwrite` (konektor) albo
//      `wxr_import_pre_overwrite` (WXR); kolejność jest asercją, nie założeniem,
//   5. NORMALIZACJA I UNIKALNOŚĆ SLUGA: diakrytyki, znaki spoza [a-z0-9], limit
//      120 znaków, pusty slug -> `wp-page`, kolizje -> `-2`, `-3`, a po
//      50 nieudanych próbach sufiks ze znacznikiem czasu,
//   6. RAPORT PER WIERSZ: `imported` / `overwritten` / `skipped` / `error` -
//      błąd JEDNEGO wpisu nie przerywa całej partii,
//   7. LIMITY WALIDATORA WXR: 200 pozycji, 5 MB HTML na język, sluggi i tytuły.
//
// CZEGO TU NIE MA - świadomie:
//   - RLS i uprawnień w bazie (pgTAP w `supabase/tests`); atrapa PostgREST
//     dowiodłaby tylko, że atrapa działa,
//   - konwersji HTML -> widgety (`wp-import/convert.test.ts`,
//     `elementor.test.ts`, `wxr.test.ts`) i budowy strony z pary PL/EN
//     (`wp-import/__tests__/buildPage*.test.ts`) - te warstwy działają tu
//     PRAWDZIWE, nie są atrapowane,
//   - ściągania mediów: `@/lib/server/wp-media.server` NAPRAWDĘ pobiera pliki
//     po HTTP i zapisuje w storage, więc jest atrapowany jako granica.
//
// RODO: żadnych realnych danych osobowych; domeny wyłącznie example.com /
// example.org, klucze API są jawnie fałszywe.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";

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

const media = vi.hoisted(() => ({
  calls: [] as Array<{ html: string; extraUrls?: string[]; includeExternal?: boolean }>,
  throwRaw: null as string | null,
  mirroredCount: 0,
  reusedCount: 0,
  warnings: [] as string[],
}));

// GRANICA: ten moduł pobiera pliki po HTTP i zapisuje je w storage.
vi.mock("@/lib/server/wp-media.server", () => ({
  mirrorWpMedia: async (opts: {
    html: string;
    extraUrls?: string[];
    includeExternal?: boolean;
  }) => {
    if (media.throwRaw) throw media.throwRaw;
    media.calls.push({
      html: opts.html,
      extraUrls: opts.extraUrls,
      includeExternal: opts.includeExternal,
    });
    return {
      map: new Map(),
      warnings: [...media.warnings],
      mirroredCount: media.mirroredCount,
      reusedCount: media.reusedCount,
      failed: [],
    };
  },
  rewriteHtml: (html: string) => html,
  rewriteBuilderDoc: <T>(doc: T) => doc,
}));

import {
  fail,
  ok,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseResult,
} from "@/test/supabaseChain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PAGE_ID = "33333333-3333-4333-8333-333333333333";
const MAIN_PAGE_ID = "44444444-4444-4444-8444-444444444444";

type PageSnapshot = Pick<
  Database["public"]["Tables"]["pages"]["Row"],
  | "id"
  | "slug"
  | "title_pl"
  | "title_en"
  | "cover_image_url"
  | "excerpt_pl"
  | "excerpt_en"
  | "content_pl"
  | "content_en"
>;

const existingPage: PageSnapshot = {
  id: PAGE_ID,
  slug: "o-nas",
  title_pl: "O nas (stare)",
  title_en: "About (old)",
  cover_image_url: "https://example.com/wp-content/uploads/stara-okladka.jpg",
  excerpt_pl: "Stara zapowiedź",
  excerpt_en: "Old excerpt",
  content_pl: "<p>Stara treść PL.</p>",
  content_en: "<p>Old EN body.</p>",
};

/* =============================== atrapa fetch ============================= */

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function jsonRes(body: unknown): FakeResponse {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function errRes(status: number, body: string): FakeResponse {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

interface WpPageBody {
  ID: number;
  title: string;
  slug: string;
  status: string;
  content: string;
  excerpt: string;
  featured_image?: string | null;
  URL: string;
}

function wpPage(over: Partial<WpPageBody> & { ID: number }): WpPageBody {
  return {
    title: `Strona ${over.ID}`,
    slug: `strona-${over.ID}`,
    status: "publish",
    content: "<p>Treść z WordPressa.</p>",
    excerpt: "<p>Zapowiedź</p>",
    featured_image: null,
    URL: `https://example.com/strona-${over.ID}`,
    ...over,
  };
}

const net = {
  calls: [] as Array<{ url: string; headers: Record<string, string> }>,
  /**
   * Częściowy kształt ODPOWIEDZI, nie naszego modelu: gateway potrafi nie
   * przysłać `content`, `title` czy `slug`, a kod produkcyjny ma na to osłony
   * `?? ""`. Fixture musi umieć taki brak odwzorować.
   */
  pages: new Map<number, Partial<WpPageBody> & { ID: number }>(),
  listBody: {} as unknown,
  /** Nadpisanie odpowiedzi - do ścieżek błędu HTTP. */
  override: null as null | ((url: string) => FakeResponse),
  /** Rzut CZYMŚ INNYM niż Error - `useServerFn` i fetch potrafią tak zrobić. */
  rawThrow: null as string | null,
};

function installFetch(): void {
  vi.stubGlobal(
    "fetch",
    async (input: unknown, init?: { headers?: Record<string, string> }): Promise<FakeResponse> => {
      const url = String(input);
      net.calls.push({ url, headers: init?.headers ?? {} });
      if (net.override) return net.override(url);
      if (url.includes("/posts?")) return jsonRes(net.listBody);
      const m = url.match(/\/posts\/(\d+)/);
      if (m) {
        const page = net.pages.get(Number(m[1]));
        if (net.rawThrow) throw net.rawThrow;
        if (!page) return errRes(404, `{"error":"unknown_post","id":${m[1]}}`);
        return jsonRes(page);
      }
      return errRes(500, "unexpected url");
    },
  );
}

/* ============================ atrapa Supabase ============================= */

interface PagesPlan {
  /** Odpowiedź na sprawdzanie unikalności sluga (select id + eq slug). */
  slugTaken: (slug: string) => boolean;
  /** Wiersz zwracany przy odczycie strony docelowej (maybeSingle). */
  current: PageSnapshot | null;
  currentError: string | null;
  updateError: string | null;
  insertError: string | null;
  slugSelectError: string | null;
}

function makeClient(
  plan: Partial<PagesPlan> = {},
  profile: { tenant_id: string | null } | null = { tenant_id: TENANT },
  profileError: string | null = null,
) {
  const p: PagesPlan = {
    slugTaken: () => false,
    current: null,
    currentError: null,
    updateError: null,
    insertError: null,
    slugSelectError: null,
    ...plan,
  };
  const stub = supabaseFromStub();
  stub.setResponse("profiles", () => (profileError ? fail(profileError) : ok(profile)));
  stub.setResponse("content_revisions", () => ok(null));
  stub.setResponse("pages", (chain: RecordedChain): SupabaseResult => {
    if (chain.has("insert")) return p.insertError ? fail(p.insertError) : ok({ id: PAGE_ID });
    if (chain.has("update")) return p.updateError ? fail(p.updateError) : ok(null);
    if (chain.has("maybeSingle")) {
      if (p.currentError) return fail(p.currentError);
      return ok(p.current);
    }
    if (chain.has("order")) {
      // listExistingPages
      return ok([
        { id: PAGE_ID, title_pl: "O nas", title_en: "About", slug: "o-nas", status: "published" },
      ]);
    }
    if (p.slugSelectError) return fail(p.slugSelectError);
    const slugArg = chain.calls.find((c) => c.method === "eq" && c.args[0] === "slug")?.args[1];
    return ok(p.slugTaken(String(slugArg)) ? [{ id: "inny" }] : []);
  });
  return { stub, context: { supabase: { from: stub.from }, userId: USER } };
}

/* ============================== ładowanie fn ============================== */

async function fns(): Promise<{
  wpListPages: ServerFnSpec;
  wpPreviewPage: ServerFnSpec;
  listExistingPages: ServerFnSpec;
  wpImportPages: ServerFnSpec;
  wpImportFromWxr: ServerFnSpec;
}> {
  const mod = await import("@/lib/wp-import.functions");
  return {
    wpListPages: mod.wpListPages as unknown as ServerFnSpec,
    wpPreviewPage: mod.wpPreviewPage as unknown as ServerFnSpec,
    listExistingPages: mod.listExistingPages as unknown as ServerFnSpec,
    wpImportPages: mod.wpImportPages as unknown as ServerFnSpec,
    wpImportFromWxr: mod.wpImportFromWxr as unknown as ServerFnSpec,
  };
}

async function call(spec: ServerFnSpec, input: unknown, context: unknown): Promise<unknown> {
  const data = spec.validator ? spec.validator(input) : input;
  if (!spec.handler) throw new Error("test: brak handlera server fn");
  return spec.handler({ data, context });
}

beforeEach(() => {
  process.env.LOVABLE_API_KEY = "test-platform-key-not-real";
  process.env.WORDPRESS_COM_API_KEY = "test-wp-key-not-real";
  net.calls.length = 0;
  net.pages.clear();
  net.listBody = { posts: [] };
  net.override = null;
  net.rawThrow = null;
  media.calls.length = 0;
  media.throwRaw = null;
  media.mirroredCount = 0;
  media.reusedCount = 0;
  media.warnings = [];
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ================================= wpListPages ============================ */

describe("wpListPages", () => {
  it("nie wychodzi w sieć bez OBU kluczy i mówi, czego brakuje", async () => {
    const { wpListPages } = await fns();
    delete process.env.WORDPRESS_COM_API_KEY;
    await expect(call(wpListPages, { siteDomain: "example.wordpress.com" }, {})).rejects.toThrow(
      /Konektor WordPress nie jest gotowy/,
    );
    delete process.env.LOVABLE_API_KEY;
    process.env.WORDPRESS_COM_API_KEY = "test-wp-key-not-real";
    await expect(call(wpListPages, { siteDomain: "example.wordpress.com" }, {})).rejects.toThrow(
      /LOVABLE_API_KEY \/ WORDPRESS_COM_API_KEY/,
    );
    expect(net.calls).toHaveLength(0);
  });

  it("pyta gateway o strony z nagłówkami autoryzacji i domyślną liczbą 100", async () => {
    const { wpListPages } = await fns();
    net.listBody = { posts: [] };
    await call(wpListPages, { siteDomain: "example.wordpress.com" }, {});
    expect(net.calls).toHaveLength(1);
    const { url, headers } = net.calls[0];
    expect(url).toContain("connector-gateway.lovable.dev/wordpress_com");
    expect(url).toContain("/rest/v1.1/sites/example.wordpress.com/posts");
    expect(url).toContain("type=page");
    expect(url).toContain("status=publish%2Cdraft%2Cprivate");
    expect(url).toContain("number=100");
    expect(headers.Authorization).toBe("Bearer test-platform-key-not-real");
    expect(headers["X-Connection-Api-Key"]).toBe("test-wp-key-not-real");
  });

  it("przekazuje własne perPage", async () => {
    const { wpListPages } = await fns();
    await call(wpListPages, { siteDomain: "example.wordpress.com", perPage: 7 }, {});
    expect(net.calls[0].url).toContain("number=7");
  });

  it("uzupełnia braki w wierszach listy i przycina do znanych pól", async () => {
    const { wpListPages } = await fns();
    net.listBody = {
      posts: [
        {
          ID: 1,
          title: "Kontakt",
          slug: "kontakt",
          status: "draft",
          URL: "https://example.com/k",
          modified: "2026-02-01",
        },
        { ID: 2 },
      ],
    };
    const res = await call(wpListPages, { siteDomain: "example.wordpress.com" }, {});
    expect(res).toEqual({
      pages: [
        {
          ID: 1,
          title: "Kontakt",
          slug: "kontakt",
          status: "draft",
          URL: "https://example.com/k",
          modified: "2026-02-01",
        },
        { ID: 2, title: "", slug: "2", status: "publish", URL: "", modified: "" },
      ],
    });
  });

  it("odpowiedź bez pola posts daje pustą listę, a nie wyjątek", async () => {
    const { wpListPages } = await fns();
    net.listBody = {};
    expect(await call(wpListPages, { siteDomain: "example.wordpress.com" }, {})).toEqual({
      pages: [],
    });
  });

  it("błąd HTTP gateway'a przechodzi do komunikatu wraz ze statusem", async () => {
    const { wpListPages } = await fns();
    net.override = () => errRes(403, "brak dostępu do witryny");
    await expect(call(wpListPages, { siteDomain: "example.wordpress.com" }, {})).rejects.toThrow(
      /WordPress zwrócił błąd 403: brak dostępu do witryny/,
    );
  });

  it("waliduje domenę: bez schematu, bez ukośników, 3-200 znaków", async () => {
    const { wpListPages } = await fns();
    expect(() => wpListPages.validator?.({ siteDomain: "https://example.com" })).toThrow();
    expect(() => wpListPages.validator?.({ siteDomain: "example.com/blog" })).toThrow();
    expect(() => wpListPages.validator?.({ siteDomain: "ab" })).toThrow();
    expect(() => wpListPages.validator?.({ siteDomain: "example.com", perPage: 0 })).toThrow();
    expect(() => wpListPages.validator?.({ siteDomain: "example.com", perPage: 101 })).toThrow();
    expect(wpListPages.validator?.({ siteDomain: "example.wordpress.com" })).toEqual({
      siteDomain: "example.wordpress.com",
    });
  });
});

/* ================================ wpPreviewPage =========================== */

describe("wpPreviewPage", () => {
  it("zwraca oryginał, wynik konwersji, pokrycie i znormalizowany slug", async () => {
    const { wpPreviewPage } = await fns();
    net.pages.set(
      10,
      wpPage({
        ID: 10,
        title: "<h1>Nasz  <em>zespół</em></h1>",
        slug: "Nasza Firma - Ćwiczenia",
        content:
          '<p><img src="https://example.com/wp-content/uploads/foto.jpg" /></p><p>Treść.</p>',
      }),
    );
    const res = await call(wpPreviewPage, { siteDomain: "example.com", wpId: 10 }, {});
    expect(res).toMatchObject({
      wpId: 10,
      title: "Nasz  zespół",
      slug: "nasza-firma-cwiczenia",
      source: "html",
      coverage: { elementorMapped: 0, gutenbergMapped: 0 },
    });
    expect(res).toMatchObject({
      original: { mediaUrls: ["https://example.com/wp-content/uploads/foto.jpg"] },
    });
    expect(res).not.toHaveProperty("translationEn.title");
    expect(net.calls[0].url).toContain(
      "fields=ID%2Ctitle%2Cslug%2Cstatus%2Ccontent%2Cexcerpt%2Cfeatured_image%2CURL",
    );
  });

  it("slug pusty po normalizacji zastępuje identyfikator WP", async () => {
    const { wpPreviewPage } = await fns();
    net.pages.set(11, wpPage({ ID: 11, slug: "" }));
    expect(await call(wpPreviewPage, { siteDomain: "example.com", wpId: 11 }, {})).toMatchObject({
      slug: "11",
    });
  });

  it("z wpIdEn dokłada tłumaczenie: tytuł, zapowiedź i osobny dokument", async () => {
    const { wpPreviewPage } = await fns();
    net.pages.set(12, wpPage({ ID: 12, content: "<p>Wersja polska.</p>" }));
    net.pages.set(
      13,
      wpPage({
        ID: 13,
        title: "<span>English title</span>",
        excerpt: "<p>English excerpt</p>",
        content: "<p>English body.</p>",
      }),
    );
    const res = await call(wpPreviewPage, { siteDomain: "example.com", wpId: 12, wpIdEn: 13 }, {});
    expect(res).toMatchObject({
      translationEn: { title: "English title", excerpt: "English excerpt" },
    });
    expect(JSON.stringify(res)).toContain("English body");
    expect(net.calls).toHaveLength(2);
  });

  it("błąd pobrania strony z WP zwraca status i wycinek odpowiedzi", async () => {
    const { wpPreviewPage } = await fns();
    await expect(call(wpPreviewPage, { siteDomain: "example.com", wpId: 999 }, {})).rejects.toThrow(
      /WordPress 404: \{"error":"unknown_post","id":999\}/,
    );
  });

  it("waliduje identyfikatory: dodatnie liczby całkowite", async () => {
    const { wpPreviewPage } = await fns();
    expect(() => wpPreviewPage.validator?.({ siteDomain: "example.com", wpId: 0 })).toThrow();
    expect(() => wpPreviewPage.validator?.({ siteDomain: "example.com", wpId: 1.5 })).toThrow();
    expect(() =>
      wpPreviewPage.validator?.({ siteDomain: "example.com", wpId: 1, wpIdEn: -2 }),
    ).toThrow();
  });
});

/* ============================= listExistingPages ========================== */

describe("listExistingPages", () => {
  it("filtruje po tenancie, pomija usunięte i stronę /main, sortuje po title_pl", async () => {
    const { listExistingPages } = await fns();
    const { stub, context } = makeClient();
    const res = await call(listExistingPages, undefined, context);
    expect(res).toEqual({
      pages: [
        { id: PAGE_ID, title_pl: "O nas", title_en: "About", slug: "o-nas", status: "published" },
      ],
    });
    const chain = stub.lastChain("pages");
    expect(chain?.argsOf("select")).toEqual(["id, title_pl, title_en, slug, status"]);
    expect(chain?.argsOf("eq")).toEqual(["tenant_id", TENANT]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    expect(chain?.argsOf("neq")).toEqual(["slug", "main"]);
    expect(chain?.argsOf("order")).toEqual(["title_pl", { ascending: true }]);
    expect(chain?.argsOf("limit")).toEqual([500]);
  });

  it("fail-closed: brak profilu, brak tenant_id i błąd zapytania kończą się wyjątkiem", async () => {
    const { listExistingPages } = await fns();
    for (const [profile, error] of [
      [null, null],
      [{ tenant_id: null }, null],
      [{ tenant_id: TENANT }, "PostgREST padł"],
    ] as Array<[{ tenant_id: string | null } | null, string | null]>) {
      const { stub, context } = makeClient({}, profile, error);
      await expect(call(listExistingPages, undefined, context)).rejects.toThrow(
        /Brak tenanta dla bieżącego użytkownika/,
      );
      // Zapytanie o strony nie poszło - to jest sens fail-closed.
      expect(stub.chainsFor("pages")).toHaveLength(0);
    }
  });

  it("błąd odczytu stron jest zgłaszany, a nie raportowany jako pusta lista", async () => {
    const { listExistingPages } = await fns();
    const { stub, context } = makeClient();
    stub.setResponse("pages", () => fail("odmowa RLS"));
    await expect(call(listExistingPages, undefined, context)).rejects.toThrow("odmowa RLS");
  });

  it("brak wierszy daje pustą listę", async () => {
    const { listExistingPages } = await fns();
    const { stub, context } = makeClient();
    stub.setResponse("pages", () => ok(null));
    expect(await call(listExistingPages, undefined, context)).toEqual({ pages: [] });
  });

  it("walidator ignoruje wejście - ta funkcja nie przyjmuje parametrów", async () => {
    const { listExistingPages } = await fns();
    expect(listExistingPages.validator?.({ cokolwiek: 1 })).toEqual({});
  });
});

/* ================================ wpImportPages =========================== */

describe("wpImportPages - nowa strona", () => {
  it("zapisuje stronę buildera z konwersji i raportuje slug oraz pageId", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(
      20,
      wpPage({
        ID: 20,
        title: "Raport <b>2026</b>",
        slug: "raport-2026",
        content: "<h2>Wnioski</h2><p>Treść raportu.</p>",
        featured_image: "https://example.com/wp-content/uploads/okladka.jpg",
      }),
    );
    const { stub, context } = makeClient();
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 20 }], mirrorMedia: false },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          wpId: 20,
          status: "imported",
          slug: "raport-2026",
          pageId: PAGE_ID,
          mediaMirrored: 0,
          enBody: "none",
          message:
            "Treść nie została rozpoznana jako Elementor ani Gutenberg - użyto fallbacku HTML.",
        },
      ],
    });
    const insert = stub.chainsFor("pages").find((c) => c.has("insert"));
    expect(insert?.argsOf("insert")?.[0]).toMatchObject({
      tenant_id: TENANT,
      slug: "raport-2026",
      title_pl: "Raport 2026",
      title_en: "",
      editor: "builder",
      status: "draft",
      cover_image_url: "https://example.com/wp-content/uploads/okladka.jpg",
    });
  });

  it("z parą EN zapisuje tytuł, zapowiedź i TREŚĆ angielską", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(21, wpPage({ ID: 21, slug: "o-nas", content: "<p>Polska treść.</p>" }));
    net.pages.set(
      22,
      wpPage({ ID: 22, title: "About us", excerpt: "EN excerpt", content: "<p>English body.</p>" }),
    );
    const { stub, context } = makeClient();
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 21, enId: 22 }],
        mirrorMedia: false,
        targetStatus: "published",
      },
      context,
    );
    expect(res).toMatchObject({
      results: [{ status: "imported", wpIdEn: 22, enBody: "persisted" }],
    });
    const insert = stub.chainsFor("pages").find((c) => c.has("insert"));
    const payload = insert?.argsOf("insert")?.[0];
    expect(payload).toMatchObject({
      title_en: "About us",
      excerpt_en: "EN excerpt",
      status: "published",
    });
    expect(JSON.stringify(payload)).toContain("English body");
  });

  it("ściąganie mediów jest domyślnie WŁĄCZONE i widzi treść obu języków", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(
      23,
      wpPage({
        ID: 23,
        content: '<p><img src="https://example.com/wp-content/uploads/pl.jpg" /></p>',
      }),
    );
    net.pages.set(
      24,
      wpPage({
        ID: 24,
        content: '<p><img src="https://example.com/wp-content/uploads/en.jpg" /></p>',
      }),
    );
    media.mirroredCount = 2;
    media.reusedCount = 1;
    media.warnings = ["Nie udało się ściągnąć https://example.com/wp-content/uploads/brak.png"];
    const { context } = makeClient();
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 23, enId: 24 }] },
      context,
    );
    expect(media.calls).toHaveLength(1);
    expect(media.calls[0].html).toContain("pl.jpg");
    expect(media.calls[0].html).toContain("en.jpg");
    expect(media.calls[0].includeExternal).toBe(false);
    expect(res).toMatchObject({ results: [{ mediaMirrored: 3 }] });
    expect(JSON.stringify(res)).toContain("Nie udało się ściągnąć");
  });

  it("normalizuje slug: diakrytyki rozkładalne, znaki specjalne i limit 120 znaków", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(25, wpPage({ ID: 25 }));
    const { stub, context } = makeClient();
    await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 25, slugOverride: "ĆMA & Ósemka -- Ważne!" }],
        mirrorMedia: false,
      },
      context,
    );
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "cma-osemka-wazne" });

    // Limit 120 znaków da się wywołać tylko slugiem Z WORDPRESSA - walidator
    // przycina `slugOverride` już na 120 znakach.
    net.pages.set(251, wpPage({ ID: 251, slug: "a".repeat(200) }));
    const second = makeClient();
    await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 251 }], mirrorMedia: false },
      second.context,
    );
    const slug = second.stub
      .chainsFor("pages")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0];
    expect(slug).toMatchObject({ slug: "a".repeat(120) });
  });

  it("slug bez ani jednego dozwolonego znaku spada do wp-page", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(26, wpPage({ ID: 26, slug: "!!!" }));
    const { stub, context } = makeClient();
    await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 26 }], mirrorMedia: false },
      context,
    );
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "wp-page" });
  });

  it("kolizja sluga dokłada kolejne numery, aż trafi wolny", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(27, wpPage({ ID: 27, slug: "kontakt" }));
    const { stub, context } = makeClient({
      slugTaken: (slug) => slug === "kontakt" || slug === "kontakt-2",
    });
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 27 }], mirrorMedia: false },
      context,
    );
    expect(res).toMatchObject({ results: [{ slug: "kontakt-3" }] });
  });

  it("po 50 kolizjach slug dostaje sufiks ze znacznikiem czasu", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(28, wpPage({ ID: 28, slug: "kontakt" }));
    const { stub, context } = makeClient({ slugTaken: () => true });
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 28 }], mirrorMedia: false },
      context,
    );
    expect(res).toMatchObject({ results: [{ status: "imported" }] });
    expect(JSON.stringify(res)).toMatch(/"slug":"kontakt-\d{13}"/);
    // 50 prób unikalności + INSERT.
    expect(stub.chainsFor("pages").filter((c) => !c.has("insert"))).toHaveLength(50);
  });

  it("błąd zapytania o unikalność sluga kończy wiersz statusem error", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(29, wpPage({ ID: 29 }));
    const { context } = makeClient({ slugSelectError: "timeout zapytania" });
    expect(
      await call(
        wpImportPages,
        { siteDomain: "example.com", items: [{ plId: 29 }], mirrorMedia: false },
        context,
      ),
    ).toEqual({ results: [{ wpId: 29, status: "error", message: "timeout zapytania" }] });
  });

  it("błąd INSERT-a raportuje wiersz error i nie przerywa partii", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(30, wpPage({ ID: 30, slug: "pierwsza" }));
    net.pages.set(31, wpPage({ ID: 31, slug: "druga" }));
    const { context } = makeClient({ insertError: "duplicate key value" });
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 30 }, { plId: 31 }], mirrorMedia: false },
      context,
    );
    expect(res).toEqual({
      results: [
        { wpId: 30, status: "error", message: "duplicate key value" },
        { wpId: 31, status: "error", message: "duplicate key value" },
      ],
    });
  });

  it("błąd pobrania jednego wpisu nie psuje pozostałych", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(33, wpPage({ ID: 33, slug: "zywa" }));
    const { context } = makeClient();
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 32 }, { plId: 33 }], mirrorMedia: false },
      context,
    );
    expect(res).toMatchObject({
      results: [
        { wpId: 32, status: "error" },
        { wpId: 33, status: "imported" },
      ],
    });
    expect(JSON.stringify(res)).toContain("WordPress 404");
  });

  it("fail-closed na tenancie: żaden wiersz nie jest importowany", async () => {
    const { wpImportPages } = await fns();
    const { stub, context } = makeClient({}, null);
    await expect(
      call(
        wpImportPages,
        { siteDomain: "example.com", items: [{ plId: 20 }], mirrorMedia: false },
        context,
      ),
    ).rejects.toThrow(/Brak tenanta/);
    expect(stub.chainsFor("pages")).toHaveLength(0);
    expect(net.calls).toHaveLength(0);
  });
});

describe("wpImportPages - strona /main jest nietykalna", () => {
  it("pomija wpis, którego slug źródłowy to main", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(40, wpPage({ ID: 40, slug: "main" }));
    const { stub, context } = makeClient();
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 40 }], mirrorMedia: false },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          wpId: 40,
          status: "skipped",
          slug: "main",
          message: "Strona /main jest zawsze pomijana.",
        },
      ],
    });
    expect(stub.chainsFor("pages")).toHaveLength(0);
  });

  it("pomija też wpis, którego slugOverride to main", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(41, wpPage({ ID: 41, slug: "o-nas" }));
    const { stub, context } = makeClient();
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 41, slugOverride: "MAIN" }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ status: "skipped", slug: "main" }] });
    expect(stub.chainsFor("pages")).toHaveLength(0);
  });

  it("nie nadpisuje istniejącej strony o slug main", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(42, wpPage({ ID: 42, slug: "o-nas" }));
    const { stub, context } = makeClient({
      current: { ...existingPage, id: MAIN_PAGE_ID, slug: "main" },
    });
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 42, targetPageId: MAIN_PAGE_ID }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          wpId: 42,
          status: "skipped",
          slug: "main",
          message: "Nie można nadpisać strony /main.",
        },
      ],
    });
    // Odczyt był, ale ANI migawki, ANI update-u.
    expect(stub.chainsFor("content_revisions")).toHaveLength(0);
    expect(stub.chainsFor("pages").some((c) => c.has("update"))).toBe(false);
  });
});

describe("wpImportPages - nadpisanie istniejącej strony", () => {
  it("robi migawkę do content_revisions PRZED update-em i zachowuje slug", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(50, wpPage({ ID: 50, title: "Nowy tytuł", content: "<p>Nowa treść.</p>" }));
    const { stub, context } = makeClient({ current: existingPage });
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 50, targetPageId: PAGE_ID }],
        mirrorMedia: false,
        targetStatus: "published",
      },
      context,
    );
    expect(res).toMatchObject({
      results: [{ wpId: 50, status: "overwritten", slug: "o-nas", pageId: PAGE_ID }],
    });

    // KOLEJNOŚĆ: migawka przed nadpisaniem.
    const order = stub.chains.map((c) => `${c.table}:${c.calls[0]?.method}`);
    expect(order).toEqual([
      "profiles:select",
      "pages:select",
      "content_revisions:insert",
      "pages:update",
    ]);
    const snapshot = stub.lastChain("content_revisions")?.argsOf("insert")?.[0];
    expect(snapshot).toMatchObject({
      tenant_id: TENANT,
      entity_type: "page",
      entity_id: PAGE_ID,
      author_id: USER,
      note: "wp_import_pre_overwrite",
    });
    expect(JSON.stringify(snapshot)).toContain("Stara treść PL");

    const update = stub.chainsFor("pages").find((c) => c.has("update"));
    expect(update?.argsOf("update")?.[0]).toMatchObject({
      slug: "o-nas",
      title_pl: "Nowy tytuł",
      editor: "builder",
      status: "published",
    });
    // UPDATE jest zawężony do id ORAZ tenanta.
    expect(update?.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["id", PAGE_ID],
      ["tenant_id", TENANT],
    ]);
  });

  it("puste pola z importu nie kasują danych istniejącej strony", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(
      51,
      wpPage({ ID: 51, title: "", excerpt: "", content: "", featured_image: null }),
    );
    const { stub, context } = makeClient({ current: existingPage });
    await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 51, targetPageId: PAGE_ID }],
        mirrorMedia: false,
      },
      context,
    );
    const patch = stub
      .chainsFor("pages")
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0];
    expect(patch).toMatchObject({
      title_pl: "O nas (stare)",
      title_en: "About (old)",
      cover_image_url: "https://example.com/wp-content/uploads/stara-okladka.jpg",
      excerpt_pl: "Stara zapowiedź",
      content_pl: "<p>Stara treść PL.</p>",
      content_en: "<p>Old EN body.</p>",
    });
  });

  it("slugOverride inny niż obecny przechodzi przez sprawdzenie unikalności z wykluczeniem siebie", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(52, wpPage({ ID: 52 }));
    const { stub, context } = makeClient({
      current: existingPage,
      slugTaken: (slug) => slug === "nowy-slug",
    });
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 52, targetPageId: PAGE_ID, slugOverride: "nowy-slug" }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ slug: "nowy-slug-2" }] });
    const uniqueness = stub
      .chainsFor("pages")
      .filter((c) => c.has("neq") && !c.has("update") && !c.has("insert"));
    expect(uniqueness.length).toBeGreaterThan(0);
    expect(uniqueness[0].argsOf("neq")).toEqual(["id", PAGE_ID]);
  });

  it("brak strony docelowej w tym tenancie to error, nie ciche utworzenie nowej", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(53, wpPage({ ID: 53 }));
    const { stub, context } = makeClient({ current: null });
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 53, targetPageId: PAGE_ID }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          wpId: 53,
          status: "error",
          message: "Nie znaleziono docelowej strony w tym tenancie.",
        },
      ],
    });
    expect(stub.chainsFor("pages").some((c) => c.has("insert"))).toBe(false);
  });

  it("błąd odczytu strony docelowej wchodzi do komunikatu wiersza", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(54, wpPage({ ID: 54 }));
    const { context } = makeClient({ currentError: "odmowa RLS na pages" });
    expect(
      await call(
        wpImportPages,
        {
          siteDomain: "example.com",
          items: [{ plId: 54, targetPageId: PAGE_ID }],
          mirrorMedia: false,
        },
        context,
      ),
    ).toEqual({
      results: [{ wpId: 54, status: "error", message: "odmowa RLS na pages" }],
    });
  });

  it("błąd UPDATE-u raportuje error - po zrobionej migawce", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(55, wpPage({ ID: 55 }));
    const { stub, context } = makeClient({
      current: existingPage,
      updateError: "naruszenie ograniczenia",
    });
    const res = await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 55, targetPageId: PAGE_ID }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({
      results: [{ status: "error", message: "naruszenie ograniczenia" }],
    });
    expect(stub.chainsFor("content_revisions")).toHaveLength(1);
  });

  it("walidator importu: 1-100 pozycji, uuid celu, slug do 120 znaków, domyślne flagi", async () => {
    const { wpImportPages } = await fns();
    expect(() => wpImportPages.validator?.({ siteDomain: "example.com", items: [] })).toThrow();
    expect(() =>
      wpImportPages.validator?.({
        siteDomain: "example.com",
        items: Array.from({ length: 101 }, (_, i) => ({ plId: i + 1 })),
      }),
    ).toThrow();
    expect(() =>
      wpImportPages.validator?.({
        siteDomain: "example.com",
        items: [{ plId: 1, targetPageId: "nie-uuid" }],
      }),
    ).toThrow();
    expect(() =>
      wpImportPages.validator?.({
        siteDomain: "example.com",
        items: [{ plId: 1, slugOverride: "x".repeat(121) }],
      }),
    ).toThrow();
    expect(() =>
      wpImportPages.validator?.({
        siteDomain: "example.com",
        items: [{ plId: 1 }],
        targetStatus: "archived",
      }),
    ).toThrow();
    expect(wpImportPages.validator?.({ siteDomain: "example.com", items: [{ plId: 1 }] })).toEqual({
      siteDomain: "example.com",
      items: [{ plId: 1 }],
      targetStatus: "draft",
      mirrorMedia: true,
      includeExternalMedia: false,
    });
  });
});

/* ============================== wpImportFromWxr =========================== */

const wxrItem = {
  clientId: 100,
  slug: "o-nas",
  title_pl: "O nas",
  content_pl_html: "<h2>Kim jesteśmy</h2><p>Treść z eksportu.</p>",
  excerpt_pl: "Zapowiedź",
};

describe("wpImportFromWxr - nowa strona", () => {
  it("importuje pozycję z pliku WXR, raportuje źródło konwersji i enBody", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient();
    const res = await call(wpImportFromWxr, { items: [wxrItem], mirrorMedia: false }, context);
    expect(res).toMatchObject({
      results: [
        {
          clientId: 100,
          status: "imported",
          slug: "o-nas",
          pageId: PAGE_ID,
          source: "html",
          enBody: "none",
        },
      ],
    });
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({
      tenant_id: TENANT,
      slug: "o-nas",
      title_pl: "O nas",
      editor: "builder",
      status: "draft",
    });
    // Ta ścieżka NIE wychodzi do WordPressa - plik dał już całą treść.
    expect(net.calls).toHaveLength(0);
  });

  it("treść Elementora z eksportu jest mapowana na widgety, nie na worek HTML", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient();
    const res = await call(
      wpImportFromWxr,
      {
        items: [
          {
            ...wxrItem,
            content_pl_html:
              '<section class="elementor-section elementor-top-section"><div class="elementor-column elementor-col-50"><div class="elementor-widget elementor-widget-heading"><h2>Nagłówek</h2></div></div></section>',
          },
        ],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ source: "elementor" }] });
    const payload = stub
      .chainsFor("pages")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0];
    expect(JSON.stringify(payload)).toContain('"type":"heading"');
  });

  it("para PL/EN z eksportu zapisuje treść EN i mirroruje media obu wersji", async () => {
    const { wpImportFromWxr } = await fns();
    media.mirroredCount = 4;
    const { stub, context } = makeClient();
    const res = await call(
      wpImportFromWxr,
      {
        items: [
          {
            ...wxrItem,
            content_pl_html: '<p><img src="https://example.com/wp-content/uploads/pl.jpg" /></p>',
            title_en: "About us",
            content_en_html: '<p><img src="https://example.com/wp-content/uploads/en.jpg" /></p>',
            excerpt_en: "EN excerpt",
            cover_image_url: "https://example.com/wp-content/uploads/hero.jpg",
          },
        ],
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ enBody: "persisted", mediaMirrored: 4 }] });
    expect(media.calls[0].html).toContain("pl.jpg");
    expect(media.calls[0].html).toContain("en.jpg");
    expect(media.calls[0].extraUrls).toEqual(["https://example.com/wp-content/uploads/hero.jpg"]);
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ title_en: "About us", excerpt_en: "EN excerpt" });
  });

  it("pozycja EN podana bez treści raportuje enBody = empty z ostrzeżeniem", async () => {
    const { wpImportFromWxr } = await fns();
    const { context } = makeClient();
    const res = await call(
      wpImportFromWxr,
      {
        items: [{ ...wxrItem, title_en: "About", content_en_html: "   ", excerpt_en: "x" }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ enBody: "empty" }] });
    expect(JSON.stringify(res)).toContain("Wersja EN nie zawierała treści po konwersji");
  });

  it("kolizja sluga i błąd INSERT-a zachowują się jak w ścieżce konektora", async () => {
    const { wpImportFromWxr } = await fns();
    const collide = makeClient({ slugTaken: (s) => s === "o-nas" });
    expect(
      await call(wpImportFromWxr, { items: [wxrItem], mirrorMedia: false }, collide.context),
    ).toMatchObject({ results: [{ slug: "o-nas-2" }] });

    const broken = makeClient({ insertError: "kolumna nie istnieje" });
    expect(
      await call(wpImportFromWxr, { items: [wxrItem], mirrorMedia: false }, broken.context),
    ).toEqual({
      results: [{ clientId: 100, status: "error", message: "kolumna nie istnieje" }],
    });
  });

  it("błąd w środku partii nie przerywa pozostałych pozycji", async () => {
    const { wpImportFromWxr } = await fns();
    const { context } = makeClient({ slugSelectError: "padło zapytanie" });
    const res = await call(
      wpImportFromWxr,
      {
        items: [
          { ...wxrItem, clientId: 101, slug: "a" },
          { ...wxrItem, clientId: 102, slug: "b" },
        ],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toEqual({
      results: [
        { clientId: 101, status: "error", message: "padło zapytanie" },
        { clientId: 102, status: "error", message: "padło zapytanie" },
      ],
    });
  });

  it("fail-closed na tenancie: nic nie jest zapisywane", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient({}, { tenant_id: null });
    await expect(
      call(wpImportFromWxr, { items: [wxrItem], mirrorMedia: false }, context),
    ).rejects.toThrow(/Brak tenanta/);
    expect(stub.chainsFor("pages")).toHaveLength(0);
  });
});

describe("wpImportFromWxr - strona /main jest nietykalna", () => {
  it("pomija pozycję o slug main (traktowaną jako strona główna)", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient();
    const res = await call(
      wpImportFromWxr,
      { items: [{ ...wxrItem, slug: "main" }], mirrorMedia: false },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          clientId: 100,
          status: "skipped",
          slug: "main",
          message: "Strona /main jest zawsze pomijana (traktowana jako home).",
        },
      ],
    });
    expect(stub.chainsFor("pages")).toHaveLength(0);
  });

  it("pomija pozycję, której slugOverride to main", async () => {
    const { wpImportFromWxr } = await fns();
    const { context } = makeClient();
    expect(
      await call(
        wpImportFromWxr,
        { items: [{ ...wxrItem, slugOverride: "Main" }], mirrorMedia: false },
        context,
      ),
    ).toMatchObject({ results: [{ status: "skipped", slug: "main" }] });
  });

  it("nie nadpisuje istniejącej strony o slug main", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient({
      current: { ...existingPage, id: MAIN_PAGE_ID, slug: "main" },
    });
    const res = await call(
      wpImportFromWxr,
      { items: [{ ...wxrItem, targetPageId: MAIN_PAGE_ID }], mirrorMedia: false },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          clientId: 100,
          status: "skipped",
          slug: "main",
          message: "Nie można nadpisać strony /main.",
        },
      ],
    });
    expect(stub.chainsFor("content_revisions")).toHaveLength(0);
  });
});

describe("wpImportFromWxr - nadpisanie istniejącej strony", () => {
  it("migawka z notatką wxr_import_pre_overwrite powstaje PRZED update-em", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient({ current: existingPage });
    const res = await call(
      wpImportFromWxr,
      {
        items: [
          {
            ...wxrItem,
            targetPageId: PAGE_ID,
            title_en: "About",
            content_en_html: "<p>EN body.</p>",
          },
        ],
        mirrorMedia: false,
        targetStatus: "published",
      },
      context,
    );
    expect(res).toMatchObject({
      results: [{ status: "overwritten", slug: "o-nas", pageId: PAGE_ID, enBody: "persisted" }],
    });
    expect(stub.chains.map((c) => `${c.table}:${c.calls[0]?.method}`)).toEqual([
      "profiles:select",
      "pages:select",
      "content_revisions:insert",
      "pages:update",
    ]);
    expect(stub.lastChain("content_revisions")?.argsOf("insert")?.[0]).toMatchObject({
      note: "wxr_import_pre_overwrite",
      entity_type: "page",
      entity_id: PAGE_ID,
      author_id: USER,
    });
    const patch = stub
      .chainsFor("pages")
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0];
    expect(patch).toMatchObject({ status: "published", title_en: "About", slug: "o-nas" });
    expect(JSON.stringify(patch)).toContain("EN body");
  });

  it("slugOverride przy nadpisaniu przechodzi kontrolę unikalności z wykluczeniem siebie", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient({
      current: existingPage,
      slugTaken: (slug) => slug === "inny-slug",
    });
    const res = await call(
      wpImportFromWxr,
      {
        items: [{ ...wxrItem, targetPageId: PAGE_ID, slugOverride: "inny-slug" }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ slug: "inny-slug-2" }] });
    const uniqueness = stub.chainsFor("pages").find((c) => c.has("neq"));
    expect(uniqueness?.argsOf("neq")).toEqual(["id", PAGE_ID]);
  });

  it("brak strony docelowej i błąd odczytu kończą się wierszem error", async () => {
    const { wpImportFromWxr } = await fns();
    const missing = makeClient({ current: null });
    expect(
      await call(
        wpImportFromWxr,
        { items: [{ ...wxrItem, targetPageId: PAGE_ID }], mirrorMedia: false },
        missing.context,
      ),
    ).toEqual({
      results: [
        {
          clientId: 100,
          status: "error",
          message: "Nie znaleziono docelowej strony w tym tenancie.",
        },
      ],
    });

    const broken = makeClient({ currentError: "brak uprawnień" });
    expect(
      await call(
        wpImportFromWxr,
        { items: [{ ...wxrItem, targetPageId: PAGE_ID }], mirrorMedia: false },
        broken.context,
      ),
    ).toMatchObject({ results: [{ status: "error", message: "brak uprawnień" }] });
  });

  it("błąd UPDATE-u raportuje error po zrobionej migawce", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient({
      current: existingPage,
      updateError: "wiersz zablokowany",
    });
    expect(
      await call(
        wpImportFromWxr,
        { items: [{ ...wxrItem, targetPageId: PAGE_ID }], mirrorMedia: false },
        context,
      ),
    ).toMatchObject({ results: [{ status: "error", message: "wiersz zablokowany" }] });
    expect(stub.chainsFor("content_revisions")).toHaveLength(1);
  });

  it("puste pola z eksportu nie kasują danych istniejącej strony", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient({ current: existingPage });
    await call(
      wpImportFromWxr,
      {
        items: [
          {
            clientId: 100,
            slug: "o-nas",
            targetPageId: PAGE_ID,
            title_pl: "",
            content_pl_html: "",
            excerpt_pl: "",
          },
        ],
        mirrorMedia: false,
      },
      context,
    );
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("update"))
        ?.argsOf("update")?.[0],
    ).toMatchObject({
      title_pl: "O nas (stare)",
      excerpt_pl: "Stara zapowiedź",
      content_pl: "<p>Stara treść PL.</p>",
      content_en: "<p>Old EN body.</p>",
    });
  });
});

describe("wpImportFromWxr - limity walidatora", () => {
  it("przyjmuje 200 pozycji, odrzuca 201 i pustą listę", async () => {
    const { wpImportFromWxr } = await fns();
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ clientId: i + 1, slug: `strona-${i + 1}` }));
    expect(() => wpImportFromWxr.validator?.({ items: [] })).toThrow();
    expect(() => wpImportFromWxr.validator?.({ items: many(201) })).toThrow();
    const parsed = wpImportFromWxr.validator?.({ items: many(200) });
    expect(parsed).toMatchObject({
      targetStatus: "draft",
      mirrorMedia: true,
      includeExternalMedia: false,
    });
  });

  it("HTML do 5 MB na język przechodzi, powyżej jest odrzucany", async () => {
    const { wpImportFromWxr } = await fns();
    const base = { clientId: 1, slug: "duza" };
    expect(() =>
      wpImportFromWxr.validator?.({
        items: [{ ...base, content_pl_html: "x".repeat(5_000_000) }],
      }),
    ).not.toThrow();
    expect(() =>
      wpImportFromWxr.validator?.({
        items: [{ ...base, content_pl_html: "x".repeat(5_000_001) }],
      }),
    ).toThrow();
    expect(() =>
      wpImportFromWxr.validator?.({
        items: [{ ...base, content_en_html: "x".repeat(5_000_001) }],
      }),
    ).toThrow();
  });

  it("pilnuje slugów, tytułów, zapowiedzi i adresu okładki", async () => {
    const { wpImportFromWxr } = await fns();
    expect(() => wpImportFromWxr.validator?.({ items: [{ clientId: 1, slug: "" }] })).toThrow();
    expect(() =>
      wpImportFromWxr.validator?.({ items: [{ clientId: 1, slug: "x".repeat(161) }] }),
    ).toThrow();
    expect(() => wpImportFromWxr.validator?.({ items: [{ clientId: 0, slug: "a" }] })).toThrow();
    expect(() =>
      wpImportFromWxr.validator?.({
        items: [{ clientId: 1, slug: "a", title_pl: "t".repeat(501) }],
      }),
    ).toThrow();
    expect(() =>
      wpImportFromWxr.validator?.({
        items: [{ clientId: 1, slug: "a", excerpt_pl: "e".repeat(5_001) }],
      }),
    ).toThrow();
    expect(() =>
      wpImportFromWxr.validator?.({
        items: [{ clientId: 1, slug: "a", cover_image_url: "nie-url" }],
      }),
    ).toThrow();
    expect(
      wpImportFromWxr.validator?.({
        items: [{ clientId: 1, slug: "a", cover_image_url: null }],
      }),
    ).toMatchObject({ items: [{ cover_image_url: null }] });
  });

  it("brakujące pola tekstowe dostają wartości domyślne, nie undefined", async () => {
    const { wpImportFromWxr } = await fns();
    expect(wpImportFromWxr.validator?.({ items: [{ clientId: 1, slug: "a" }] })).toMatchObject({
      items: [{ title_pl: "", content_pl_html: "", excerpt_pl: "" }],
    });
  });
});

/* ====================== braki w danych i wyjątki nie-Error ================ */

describe("odporność na braki w danych i na wyjątki nie-Error", () => {
  it("odpowiedź WP bez content/title/slug/excerpt nie wysadza podglądu", async () => {
    const { wpPreviewPage } = await fns();
    net.pages.set(300, { ID: 300 });
    net.pages.set(301, { ID: 301 });
    const res = await call(
      wpPreviewPage,
      { siteDomain: "example.com", wpId: 300, wpIdEn: 301 },
      {},
    );
    expect(res).toMatchObject({
      wpId: 300,
      title: "",
      slug: "300",
      original: { html: "", cleanedHtml: "", mediaUrls: [] },
      translationEn: { title: "", excerpt: "" },
      warnings: [],
    });
  });

  it("odpowiedź WP bez pól nie wysadza importu - slug bierze się z wpId", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(310, { ID: 310 });
    net.pages.set(311, { ID: 311 });
    const { stub, context } = makeClient();
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 310, enId: 311 }], mirrorMedia: false },
      context,
    );
    expect(res).toMatchObject({ results: [{ status: "imported", slug: "310" }] });
    // Brak tytułu w źródle: tytułem NOWEJ strony zostaje slug, a nie pusty łańcuch.
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "310", title_pl: "310", title_en: "", cover_image_url: null });
  });

  it("pusty tytuł w źródle I w bazie: przy nadpisaniu tytułem zostaje slug", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(320, { ID: 320 });
    const { stub, context } = makeClient({
      current: { ...existingPage, title_pl: "", title_en: "" },
    });
    await call(
      wpImportPages,
      {
        siteDomain: "example.com",
        items: [{ plId: 320, targetPageId: PAGE_ID }],
        mirrorMedia: false,
      },
      context,
    );
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("update"))
        ?.argsOf("update")?.[0],
    ).toMatchObject({ title_pl: "o-nas", title_en: "" });
  });

  it("ten sam brak tytułu w ścieżce WXR daje ten sam wynik", async () => {
    const { wpImportFromWxr } = await fns();
    const overwrite = makeClient({ current: { ...existingPage, title_pl: "", title_en: "" } });
    await call(
      wpImportFromWxr,
      {
        items: [{ clientId: 1, slug: "o-nas", targetPageId: PAGE_ID }],
        mirrorMedia: false,
      },
      overwrite.context,
    );
    expect(
      overwrite.stub
        .chainsFor("pages")
        .find((c) => c.has("update"))
        ?.argsOf("update")?.[0],
    ).toMatchObject({ title_pl: "o-nas" });

    const fresh = makeClient();
    await call(
      wpImportFromWxr,
      { items: [{ clientId: 2, slug: "nowa" }], mirrorMedia: false },
      fresh.context,
    );
    expect(
      fresh.stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ slug: "nowa", title_pl: "nowa" });
  });

  it("treść EN bez tytułu EN w eksporcie zapisuje się z pustym tytułem", async () => {
    const { wpImportFromWxr } = await fns();
    const { stub, context } = makeClient();
    const res = await call(
      wpImportFromWxr,
      {
        items: [{ ...wxrItem, content_en_html: "<p>EN body only.</p>" }],
        mirrorMedia: false,
      },
      context,
    );
    expect(res).toMatchObject({ results: [{ enBody: "persisted" }] });
    expect(
      stub
        .chainsFor("pages")
        .find((c) => c.has("insert"))
        ?.argsOf("insert")?.[0],
    ).toMatchObject({ title_en: "" });
  });

  it("import bez ostrzeżeń nie dokleja pustego komunikatu do wyniku", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(
      330,
      wpPage({
        ID: 330,
        slug: "elementor",
        content:
          '<section class="elementor-section elementor-top-section"><div class="elementor-column elementor-col-100"><div class="elementor-widget elementor-widget-heading"><h2>Bez ostrzeżeń</h2></div></div></section>',
      }),
    );
    const { context } = makeClient();
    const res = await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 330 }], mirrorMedia: false },
      context,
    );
    expect(res).toEqual({
      results: [
        {
          wpId: 330,
          status: "imported",
          slug: "elementor",
          pageId: PAGE_ID,
          mediaMirrored: 0,
          enBody: "none",
          message: undefined,
        },
      ],
    });
  });

  it("wyjątek NIE-Error z konektora jest raportowany jako tekst", async () => {
    const { wpImportPages } = await fns();
    net.rawThrow = "gateway zwrócił nie-JSON";
    const { context } = makeClient();
    expect(
      await call(
        wpImportPages,
        { siteDomain: "example.com", items: [{ plId: 340 }], mirrorMedia: false },
        context,
      ),
    ).toEqual({
      results: [{ wpId: 340, status: "error", message: "gateway zwrócił nie-JSON" }],
    });
  });

  it("wyjątek NIE-Error z mirroru mediów jest raportowany jako tekst (WXR)", async () => {
    const { wpImportFromWxr } = await fns();
    media.throwRaw = "storage odrzucił zapis";
    const { context } = makeClient();
    expect(await call(wpImportFromWxr, { items: [wxrItem] }, context)).toEqual({
      results: [{ clientId: 100, status: "error", message: "storage odrzucił zapis" }],
    });
  });
});

/* ============================== DEFEKT ZAREJESTROWANY ===================== */

describe("DEFEKTY ZAREJESTROWANE (it.fails) - bramka nadużycia, audyt i slug z literą ł", () => {
  // ZAREJESTROWANY, NIE NAPRAWIONY. Implementacja A tego samego importu
  // (`src/lib/wordpress-import.functions.ts`) ma wszystkie trzy zabezpieczenia:
  // `rateLimit({ scope: "wp.import", subjectId: userId, max: 10 })`, wiersz
  // postępu w `wp_import_jobs` i `recordAudit` po zapisie. Implementacja B
  // (ten moduł) nie ma ŻADNEGO z nich, a jest ścieżką GRUBSZĄ:
  //   * walidator dopuszcza 200 pozycji po 5 MB HTML na język, czyli do ~2 GB
  //     treści w JEDNYM żądaniu,
  //   * cała partia leci SYNCHRONICZNIE w jednym handlerze, a przy
  //     `mirrorMedia: true` (wartość DOMYŚLNA) każda pozycja robi dodatkowo
  //     wyjścia HTTP po media,
  //   * po stronie bazy zostaje 200 UPDATE-ów/INSERT-ów bez jednego wpisu
  //     audytowego - po fakcie nie da się ustalić, kto nadpisał które strony.
  // Migawki `content_revisions` ratują TREŚĆ (i są tu przetestowane), ale nie
  // mówią, kto i czym ją nadpisał, ani nie ograniczają częstotliwości.
  // Naprawa to zmiana produkcyjna (dodanie rateLimit + recordAudit, najlepiej
  // wspólnych z implementacją A) - poza zakresem testów.
  // DRUGI DEFEKT, ten sam wzorzec „zarejestrowany, nie naprawiony".
  // `normalizeSlug` (L58) to DOKŁADNA kopia starego `slugify` z implementacji A:
  // toLowerCase -> NFD -> usunięcie znaków łączących -> reszta na dywizy.
  // Unicode NIE ROZKŁADA liter z kreską (ł, ø, đ, ħ), więc po NFD „ł" zostaje
  // sobą, a następny krok zamienia ją na DYWIZ. Repo ma na to gotowe lekarstwo:
  // `replaceStrokeLetters` z `@/lib/text/strokeLetters`, wprowadzone 18.08
  // właśnie po tym, że slug taksonomii ZJADAŁ tę literę („Łódź" -> `odz`) -
  // patrz nagłówek `src/lib/content/taxonomySlug.ts`. Import stron WordPressa
  // (obie ścieżki: konektor i WXR, a także slug w podglądzie `wpPreviewPage`)
  // tej poprawki nie dostał, więc każda polska strona z „ł" w tytule dostaje
  // slug z dywizem w środku: „Człowiek i władza" -> `cz-owiek-i-w-adza`,
  // „Łódź" -> `odz`. To trafia do adresu URL opublikowanej strony, a po
  // publikacji zmiana sluga to już zmiana adresu (i przekierowania).
  // Naprawa = jedna linia w kodzie produkcyjnym (transliteracja PRZED NFD),
  // więc świadomie nie robię jej w ramach pisania testów.
  it.fails("normalizeSlug transliteruje litery z kreską tak jak slugifyTaxonomy", async () => {
    const { wpImportPages } = await fns();
    net.pages.set(26_000, wpPage({ ID: 26_000, slug: "Człowiek i władza" }));
    const { stub, context } = makeClient();
    await call(
      wpImportPages,
      { siteDomain: "example.com", items: [{ plId: 26_000 }], mirrorMedia: false },
      context,
    );
    const payload = stub
      .chainsFor("pages")
      .find((c) => c.has("insert"))
      ?.argsOf("insert")?.[0];
    expect(payload).toMatchObject({ slug: "czlowiek-i-wladza" });
  });

  it.fails("wpImportFromWxr jest bramkowany rate-limitem i zostawia wpis w audycie", () => {
    const src = readFileSync("src/lib/wp-import.functions.ts", "utf8");
    expect(src).toContain("rate-limit.server");
    expect(src).toContain("recordAudit");
  });
});
