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
  resolveCrawlerTenantForHost: vi.fn(),
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
  resolveCrawlerTenantForHost: h.resolveCrawlerTenantForHost,
  // Wystawiony WYŁĄCZNIE po to, żeby dowieść, że NIE jest wołany - patrz
  // przypadek „płaszczyzna treści jest tu fail-OPEN" niżej.
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

/** Wpis katalogu najemców w kształcie, w jakim oddaje go rezolwer. */
const entry = (id: string, domain: string, isDefault = false) => ({
  id,
  slug: domain.split(".")[0],
  domain,
  isDefault,
});
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
  h.resolveCrawlerTenantForHost.mockReset().mockResolvedValue(entry(TENANT_A, "a.example.com"));
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
    h.resolveCrawlerTenantForHost.mockResolvedValue(entry(TENANT_B, "b.example.com"));

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
    h.resolveCrawlerTenantForHost.mockResolvedValue(null);

    const result = await fetchPreviewPost({ data: { token: TOKEN_A } });

    expect(result).toBeNull();
    // Ani jedno zapytanie: odmowa zapada PRZED dotknięciem bazy.
    expect(admin.chains).toHaveLength(0);
  });

  it("brak hosta w kontekście żądania też kończy się odmową", async () => {
    seedTenantScopedDb();
    h.currentTenantHost.mockResolvedValue(null);
    h.resolveCrawlerTenantForHost.mockResolvedValue(null);

    expect(await fetchPreviewPost({ data: { token: TOKEN_A } })).toBeNull();
    expect(h.resolveCrawlerTenantForHost).toHaveBeenCalledWith(null);
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

  it("host NIEPRZYPISANY nie dostaje najemcy domyślnego - rezolwer jest fail-CLOSED", async () => {
    // REGRESJA ZGŁOSZONA W REVIEW PR #329 (Codex, P1).
    // Pierwsze podejście do tej poprawki wołało `resolveTenantIdForHost`, czyli
    // płaszczyznę TREŚCI. Ta jest z założenia fail-OPEN: `resolveTenantForHost`
    // (`tenant.server.ts:224-228`) kończy się na `?? directory.defaultTenant`,
    // więc dla domeny spoza katalogu ZWRACAŁA najemcę domyślnego zamiast `null`.
    // Warunek `.eq("tenant_id", ...)` był wtedy spełniony przez szkice najemcy
    // domyślnego, a strażnik `if (!tenant)` nie odpalał się nigdy - podgląd
    // wydawał SZKIC na każdej nieprzypisanej domenie kierowanej na to wdrożenie.
    seedTenantScopedDb();
    // Tak zachowuje się `resolveCrawlerTenantForHost` dla obcego hosta.
    h.currentTenantHost.mockResolvedValue("nieprzypisana.example.com");
    h.resolveCrawlerTenantForHost.mockResolvedValue(null);

    expect(await fetchPreviewPost({ data: { token: TOKEN_A } })).toBeNull();
    expect(admin.chains).toHaveLength(0);
  });

  it("płaszczyzna TREŚCI (fail-OPEN) NIE jest tu używana ani razu", async () => {
    seedTenantScopedDb();
    await fetchPreviewPost({ data: { token: TOKEN_A } });

    expect(h.resolveCrawlerTenantForHost).toHaveBeenCalledWith("a.example.com");
    // Gdyby ktoś wrócił do rezolwera płaszczyzny treści „dla zgodności
    // z feedback.functions.ts", ten przypadek pada - i o to chodzi.
    expect(h.resolveTenantIdForHost).not.toHaveBeenCalled();
  });

  it("host PODGLĄDOWY platformy nadal działa - fail-closed nie zabija podglądu", async () => {
    // `resolveCrawlerTenantForHost` dopuszcza najemcę domyślnego dokładnie
    // w dwóch nieszkodliwych przypadkach: host podglądowy platformy oraz
    // katalog bez ani jednej zajętej domeny. Bez tego poprawka bezpieczeństwa
    // wyłączyłaby podgląd szkiców na środowisku deweloperskim.
    seedTenantScopedDb();
    h.currentTenantHost.mockResolvedValue("localhost");
    h.resolveCrawlerTenantForHost.mockResolvedValue(entry(TENANT_A, "a.example.com", true));

    const result = await fetchPreviewPost({ data: { token: TOKEN_A } });
    expect(result?.title_pl).toBe("Szkic najemcy A");
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

// ---------------------------------------------------------------------------
// GAŁĘZIE WALIDATORÓW I ENTROPIA TOKENA - część C (gałęziowa).
//
// Każda z czterech funkcji tego pliku zaczyna się od `.parse(i ?? {})`. Człon
// `?? {}` to jedyna bariera przed żądaniem BEZ ciała - a takie żądanie potrafi
// przyjść z gołego `fetch` na endpoint server fn. Testy wyżej zawsze podają
// obiekt `data`, więc ta gałąź nie była wykonana w żadnej z czterech funkcji.
// ---------------------------------------------------------------------------
describe("walidatory - żądanie BEZ ciała kończy się odmową walidacji", () => {
  it.each([
    ["createPreviewToken", () => createPreviewToken({ data: undefined })],
    ["listPreviewTokens", () => listPreviewTokens({ data: undefined })],
    ["revokePreviewToken", () => revokePreviewToken({ data: undefined })],
    ["fetchPreviewPost", () => fetchPreviewPost({ data: undefined })],
  ])("%s odrzuca brak danych, zamiast wywracać się na `undefined`", async (_name, call) => {
    await expect(call()).rejects.toThrow();
  });

  it("odmowa walidacji `fetchPreviewPost` następuje PRZED limiterem i przed bazą", async () => {
    // Kolejność ma znaczenie: walidator jest darmowy, limiter i baza nie.
    await expect(fetchPreviewPost({ data: undefined })).rejects.toThrow();
    expect(h.rateLimit).not.toHaveBeenCalled();
    expect(admin.chains).toHaveLength(0);
  });

  it("`createPreviewToken` odrzuca ttl poza zakresem 1..720 godzin", async () => {
    await expect(createPreviewToken({ data: { postId: POST_A, ttlHours: 0 } })).rejects.toThrow();
    await expect(createPreviewToken({ data: { postId: POST_A, ttlHours: 721 } })).rejects.toThrow();
    await expect(createPreviewToken({ data: { postId: POST_A, ttlHours: 1.5 } })).rejects.toThrow();
  });
});

describe("generateToken - dowód wykonawczy i entropia linku podglądu", () => {
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

  it("token jest base64url BEZ wypełnienia i bez znaków wymagających kodowania w URL", async () => {
    const { token } = await createPreviewToken({ data: { postId: POST_A } });
    // `+`, `/` i `=` z klasycznego base64 są w adresie albo znakiem sterującym,
    // albo wymagają procentowego kodowania - link z e-maila przestaje działać
    // po pierwszym przepisaniu przez klienta pocztowego.
    expect(token).not.toContain("+");
    expect(token).not.toContain("/");
    expect(token).not.toContain("=");
    expect(encodeURIComponent(token)).toBe(token);
    // 24 bajty -> 32 znaki base64 po zdjęciu wypełnienia.
    expect(token).toHaveLength(32);
  });

  it("token mieści się w zakresie przyjmowanym przez walidator odczytu (16..64)", async () => {
    // Kontrakt między funkcją wystawiającą a publicznym odczytem: token, który
    // sam wygenerowaliśmy, MUSI przejść przez `fetchPreviewPost`. Rozjazd tych
    // dwóch miejsc dawałby linki niedziałające od chwili wystawienia.
    const { token } = await createPreviewToken({ data: { postId: POST_A } });
    expect(token.length).toBeGreaterThanOrEqual(16);
    expect(token.length).toBeLessThanOrEqual(64);

    admin.setResponse("post_preview_tokens", () => ok(null));
    await expect(fetchPreviewPost({ data: { token } })).resolves.toBeNull();
    expect(h.rateLimit).toHaveBeenLastCalledWith({
      scope: "preview.fetch",
      subjectId: token.slice(0, 16),
      max: 60,
    });
  });

  it("dwadzieścia kolejnych tokenów jest PARAMI różnych - brak licznika w miejsce losowości", async () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const { token } = await createPreviewToken({ data: { postId: POST_A } });
      tokens.add(token);
    }
    expect(tokens.size).toBe(20);
    // Żaden token nie jest przedrostkiem innego - to wykluczałoby zgadywanie
    // kolejnego linku z jednego przechwyconego.
    const list = [...tokens];
    for (const a of list) {
      expect(list.filter((b) => b !== a && b.startsWith(a.slice(0, 16)))).toHaveLength(0);
    }
  });
});
