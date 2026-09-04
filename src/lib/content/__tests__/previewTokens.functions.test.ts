// Linki podglądu szkiców - warstwa serwerowa `previewTokens.functions.ts`.
//
// DLACZEGO TEN PLIK ISTNIEJE. `fetchPreviewPost` to JEDYNA publiczna (bez
// `requireStaff`) funkcja serwerowa tego pliku: bierze token z adresu URL
// i oddaje pełną treść NIEOPUBLIKOWANEGO wpisu. Obie jej kwerendy idą przez
// rolę serwisową, która OMIJA RLS - a to właśnie RLS
// (`supabase/migrations/20260720131000_post_preview_tokens.sql:31-34`) niesie
// regułę najemcy. Bez jawnego warunku w SQL token wystawiony na domenie
// najemcy A rozwiązywał się na domenie najemcy B i wydawał tam szkic A.
//
// JAK TEN PLIK TO UDOWADNIA. Atrapa bazy NIE zwraca wiersza bezwarunkowo -
// zachowuje się jak baza z regułą najemcy: oddaje wiersz TYLKO wtedy, gdy
// łańcuch PostgREST naprawdę niósł `.eq("tenant_id", <właściciel>)`. Dlatego
// zdjęcie warunku z produkcji zamienia `null` w treść i test PADA na asercji
// docelowej, a nie na przygotowaniu. Kontrpróbka jest opisana w raporcie PR.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  currentTenantHost: vi.fn(),
  resolveTenantIdForHost: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { __mw: "requireStaff" },
}));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: h.currentTenantHost }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: h.resolveTenantIdForHost,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => admin.from(t) },
}));

import {
  createPreviewToken,
  listPreviewTokens,
  revokePreviewToken,
  fetchPreviewPost,
} from "@/lib/content/previewTokens.functions";

const admin = supabaseFromStub();
const db = supabaseFromStub();

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const POST_A = "33333333-3333-4333-8333-333333333333";
const TOKEN_A = "tokenNajemcyA-0123456789abcdef";
const TOKEN_ROW_ID = "44444444-4444-4444-8444-444444444444";

/** Wartość ogniwa `.eq(kolumna, ...)` z zapisanego łańcucha (undefined = brak). */
function eqValue(chain: RecordedChain, column: string): unknown {
  return chain.calls.find((c) => c.method === "eq" && c.args[0] === column)?.args[1];
}

/**
 * Odwzorowanie ROLI SERWISOWEJ: bez jawnego `.eq("tenant_id", ...)` baza oddaje
 * wiersz KAŻDEMU pytającemu, bo rola serwisowa omija RLS. Atrapa MUSI tak
 * działać - gdyby sama filtrowała po najemcy, test przechodziłby również dla
 * kodu, w którym warunku nie ma, czyli nie dowodziłby niczego.
 */
function tenantGate<T>(chain: RecordedChain, row: T): T | null {
  const wanted = eqValue(chain, "tenant_id");
  if (wanted === undefined) return row; // brak warunku = brak reguły najemcy
  return wanted === TENANT_A ? row : null;
}

const POST_ROW = {
  title_pl: "Szkic najemcy A",
  title_en: "Tenant A draft",
  excerpt_pl: null,
  excerpt_en: null,
  editor: "builder",
  content_pl: null,
  content_en: null,
  builder_data: null,
  blocks_data: null,
  cover_image_url: null,
  status: "draft",
  updated_at: "2026-09-01T10:00:00.000Z",
};

/**
 * Atrapa zachowuje się jak baza, w której reguła najemcy DZIAŁA: wiersz wraca
 * tylko wtedy, gdy kwerenda o niego poprosiła warunkiem `tenant_id`.
 * Token i wpis należą do najemcy A.
 */
function seedTenantScopedDb(): void {
  admin.setResponse("post_preview_tokens", (chain) => {
    if (eqValue(chain, "token") !== TOKEN_A) return ok(null);
    return ok(tenantGate(chain, { post_id: POST_A, expires_at: "2026-12-31T23:59:59.000Z" }));
  });
  admin.setResponse("posts", (chain) => {
    if (eqValue(chain, "id") !== POST_A) return ok(null);
    return ok(tenantGate(chain, POST_ROW));
  });
}

beforeEach(() => {
  admin.reset();
  db.reset();
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.currentTenantHost.mockReset().mockResolvedValue("a.example.com");
  h.resolveTenantIdForHost.mockReset().mockResolvedValue(TENANT_A);
  setServerFnContext({ supabase: { from: (t: string) => db.from(t) }, userId: "user-1" });
});

afterEach(() => {
  resetServerFnContext();
  vi.restoreAllMocks();
});

describe("fetchPreviewPost - szkic NIE przechodzi między najemcami", () => {
  it("token najemcy A na hoście najemcy B NIE zwraca treści (null, nie rzut)", async () => {
    seedTenantScopedDb();
    h.currentTenantHost.mockResolvedValue("b.example.com");
    h.resolveTenantIdForHost.mockResolvedValue(TENANT_B);

    const result = await fetchPreviewPost({ data: { token: TOKEN_A } });

    expect(result).toBeNull();
    // Warunek MUSI stać w SQL, a nie w gałęzi po stronie JS: rola serwisowa
    // omija RLS, więc to jedyne miejsce, w którym reguła najemcy obowiązuje.
    expect(eqValue(admin.lastChain("post_preview_tokens") as RecordedChain, "tenant_id")).toBe(
      TENANT_B,
    );
  });

  it('nierozpoznany najemca to ODMOWA, nie „najemca domyślny" (fail-closed)', async () => {
    seedTenantScopedDb();
    h.resolveTenantIdForHost.mockResolvedValue(null);

    const result = await fetchPreviewPost({ data: { token: TOKEN_A } });

    expect(result).toBeNull();
    // Ani jedno zapytanie: odmowa zapada PRZED dotknięciem bazy.
    expect(admin.chains).toHaveLength(0);
  });

  it("brak hosta w kontekście żądania też kończy się odmową", async () => {
    seedTenantScopedDb();
    h.currentTenantHost.mockResolvedValue(null);
    h.resolveTenantIdForHost.mockResolvedValue(null);

    expect(await fetchPreviewPost({ data: { token: TOKEN_A } })).toBeNull();
    expect(h.resolveTenantIdForHost).toHaveBeenCalledWith(null);
  });

  it("na własnej domenie najemcy token oddaje pełną treść szkicu", async () => {
    seedTenantScopedDb();

    const result = await fetchPreviewPost({ data: { token: TOKEN_A } });

    expect(result).not.toBeNull();
    expect(result?.title_pl).toBe("Szkic najemcy A");
    expect(result?.status).toBe("draft");
    // `expires_at` pochodzi z wiersza TOKENA, nie z wpisu - podgląd musi
    // wiedzieć, kiedy link wygasa.
    expect(result?.expires_at).toBe("2026-12-31T23:59:59.000Z");
  });

  it("OBIE kwerendy niosą warunek najemcy, nie tylko pierwsza", async () => {
    seedTenantScopedDb();
    await fetchPreviewPost({ data: { token: TOKEN_A } });

    expect(eqValue(admin.lastChain("post_preview_tokens") as RecordedChain, "tenant_id")).toBe(
      TENANT_A,
    );
    expect(eqValue(admin.lastChain("posts") as RecordedChain, "tenant_id")).toBe(TENANT_A);
    // Wpis w koszu nadal jest odfiltrowany.
    expect(admin.lastChain("posts")?.has("is")).toBe(true);
  });

  it("token nieznany albo wygasły daje null", async () => {
    seedTenantScopedDb();
    expect(await fetchPreviewPost({ data: { token: "innyToken-0123456789abcdef" } })).toBeNull();
  });

  it("wpis usunięty (kwerenda o wpis nic nie zwraca) daje null", async () => {
    seedTenantScopedDb();
    admin.setResponse("posts", () => ok(null));
    expect(await fetchPreviewPost({ data: { token: TOKEN_A } })).toBeNull();
  });

  it("przekroczony limit zapytań przerywa PRZED odczytem bazy", async () => {
    seedTenantScopedDb();
    h.rateLimit.mockResolvedValue(false);
    await expect(fetchPreviewPost({ data: { token: TOKEN_A } })).rejects.toThrow(
      "Rate limit exceeded",
    );
    expect(admin.chains).toHaveLength(0);
  });

  it("limit jest liczony po PRZEDROSTKU tokena, nie po całym tokenie", async () => {
    seedTenantScopedDb();
    await fetchPreviewPost({ data: { token: TOKEN_A } });
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "preview.fetch",
      subjectId: TOKEN_A.slice(0, 16),
      max: 60,
    });
  });

  it("walidator odrzuca token krótszy niż 16 i dłuższy niż 64 znaki", async () => {
    await expect(fetchPreviewPost({ data: { token: "za-krotki" } })).rejects.toThrow();
    await expect(fetchPreviewPost({ data: { token: "x".repeat(65) } })).rejects.toThrow();
    await expect(fetchPreviewPost({ data: {} })).rejects.toThrow();
  });

  it("funkcja jest PUBLICZNA z definicji - bez middleware, z walidatorem", () => {
    const meta = serverFnMeta(fetchPreviewPost);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toEqual([]);
    expect(meta?.hasValidator).toBe(true);
  });
});

describe("createPreviewToken - wystawianie linku (staff)", () => {
  beforeEach(() => {
    db.setResponse("post_preview_tokens", (chain) => {
      const inserted = chain.calls.find((c) => c.method === "insert")?.args[0] as
        { token: string; expires_at: string } | undefined;
      return ok({
        id: "row-1",
        token: inserted?.token ?? "",
        expires_at: inserted?.expires_at ?? "",
      });
    });
  });

  it("token jest base64url i ma co najmniej 32 znaki (24 losowe bajty)", async () => {
    const row = await createPreviewToken({ data: { postId: POST_A } });
    expect(row.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(row.token.length).toBeGreaterThanOrEqual(32);
  });

  it("dwa wywołania dają RÓŻNE tokeny - link nie jest odgadywalny z poprzedniego", async () => {
    const a = await createPreviewToken({ data: { postId: POST_A } });
    const b = await createPreviewToken({ data: { postId: POST_A } });
    expect(a.token).not.toBe(b.token);
  });

  it("domyślny czas życia to 72 godziny, a maksymalny 30 dni", async () => {
    const before = Date.now();
    const row = await createPreviewToken({ data: { postId: POST_A } });
    const hours = (new Date(row.expiresAt).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThan(72.1);

    await expect(createPreviewToken({ data: { postId: POST_A, ttlHours: 721 } })).rejects.toThrow();
    await expect(createPreviewToken({ data: { postId: POST_A, ttlHours: 0 } })).rejects.toThrow();
    await expect(createPreviewToken({ data: { postId: POST_A, ttlHours: 1.5 } })).rejects.toThrow();
  });

  it("własny ttl wchodzi do wiersza", async () => {
    const before = Date.now();
    const row = await createPreviewToken({ data: { postId: POST_A, ttlHours: 24 } });
    const hours = (new Date(row.expiresAt).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });

  it("walidator odrzuca postId, które nie jest UUID", async () => {
    await expect(createPreviewToken({ data: { postId: "nie-uuid" } })).rejects.toThrow();
  });

  it("przekroczony limit przerywa przed zapisem", async () => {
    h.rateLimit.mockResolvedValue(false);
    await expect(createPreviewToken({ data: { postId: POST_A } })).rejects.toThrow(
      "Rate limit exceeded - please slow down",
    );
    expect(db.chains).toHaveLength(0);
  });

  it("błąd zapisu jest podniesiony, a nie połknięty", async () => {
    db.setResponse("post_preview_tokens", () => ({
      data: null,
      error: Object.assign(new Error("insert denied"), { name: "PostgrestError" }),
    }));
    await expect(createPreviewToken({ data: { postId: POST_A } })).rejects.toThrow("insert denied");
  });

  it("funkcja jest za `requireStaff` i ma walidator", () => {
    const meta = serverFnMeta(createPreviewToken);
    expect(meta?.middleware).toEqual([{ __mw: "requireStaff" }]);
    expect(meta?.hasValidator).toBe(true);
  });
});

describe("listPreviewTokens / revokePreviewToken (staff)", () => {
  it("lista oddaje wyłącznie linki NIEWYGASŁE, najnowsze pierwsze", async () => {
    db.setResponse("post_preview_tokens", () =>
      ok([{ id: "a", token: "t1", expires_at: "2026-12-31", created_at: "2026-09-01" }]),
    );
    const rows = await listPreviewTokens({ data: { postId: POST_A } });

    expect(rows).toHaveLength(1);
    const chain = db.lastChain("post_preview_tokens") as RecordedChain;
    expect(eqValue(chain, "post_id")).toBe(POST_A);
    expect(chain.has("gt")).toBe(true);
    expect(chain.argsOf("order")).toEqual(["created_at", { ascending: false }]);
  });

  it("pusty odczyt listy daje pustą tablicę, nie null", async () => {
    db.setResponse("post_preview_tokens", () => ok(null));
    expect(await listPreviewTokens({ data: { postId: POST_A } })).toEqual([]);
  });

  it("błąd odczytu listy jest podniesiony", async () => {
    db.setResponse("post_preview_tokens", () => ({
      data: null,
      error: Object.assign(new Error("select denied"), { name: "PostgrestError" }),
    }));
    await expect(listPreviewTokens({ data: { postId: POST_A } })).rejects.toThrow("select denied");
  });

  it("odwołanie linku kasuje wiersz po id i potwierdza sukces", async () => {
    db.setResponse("post_preview_tokens", () => ok(null));
    expect(await revokePreviewToken({ data: { id: TOKEN_ROW_ID } })).toEqual({ ok: true });
    const chain = db.lastChain("post_preview_tokens") as RecordedChain;
    expect(chain.has("delete")).toBe(true);
    expect(eqValue(chain, "id")).toBe(TOKEN_ROW_ID);
  });

  it("błąd kasowania jest podniesiony, a nie zgłoszony jako sukces", async () => {
    db.setResponse("post_preview_tokens", () => ({
      data: null,
      error: Object.assign(new Error("delete denied"), { name: "PostgrestError" }),
    }));
    await expect(revokePreviewToken({ data: { id: TOKEN_ROW_ID } })).rejects.toThrow(
      "delete denied",
    );
  });

  it("walidatory obu funkcji wymagają UUID", async () => {
    await expect(listPreviewTokens({ data: { postId: "nie-uuid" } })).rejects.toThrow();
    await expect(revokePreviewToken({ data: { id: "nie-uuid" } })).rejects.toThrow();
  });

  it("obie funkcje stoją za `requireStaff`", () => {
    expect(serverFnMeta(listPreviewTokens)?.middleware).toEqual([{ __mw: "requireStaff" }]);
    expect(serverFnMeta(revokePreviewToken)?.middleware).toEqual([{ __mw: "requireStaff" }]);
  });
});
