// Głos „czy przydatne" pod wpisem - `feedback.functions.ts`.
//
// DLACZEGO TEN PLIK MUSI ISTNIEĆ. To jest ścieżka RODO: dedup drugiego głosu
// tego samego czytelnika stoi na SKRÓCIE adresu IP i user-agenta
// (`feedback.functions.ts:57`). Plik nie miał ŻADNEGO pliku testowego, więc
// `sha256Hex` nie było w pomiarze wywołane ani razu - a stała zasada tej serii
// brzmi: jeśli kod hashuje IP, test sprawdza, że wynik nie zawiera oryginału.
//
// `sha256Hex` jest prywatne dla modułu i takie zostaje. Test dosięga go przez
// `submitPostFeedback`, przechwytując `voter_hash` z wiersza, który trafia do
// `insert` - czyli dokładnie tą drogą, którą chodzi produkcja. Eksport „na
// potrzeby testu" poszerzyłby powierzchnię modułu bez powodu.
//
// DANE W FIXTURE'ACH: wyłącznie adresy z bloków dokumentacyjnych
// (RFC 5737: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) i domeny
// `example.com`. Żadnych prawdziwych danych osobowych.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ok, supabaseFromStub, type RecordedChain } from "@/test/supabaseChain";
import { setServerFnContext, resetServerFnContext, serverFnMeta } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  currentTenantHost: vi.fn(),
  resolveTenantIdForHost: vi.fn(),
  getRequest: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@tanstack/react-start/server", () => ({ getRequest: h.getRequest }));
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: h.currentTenantHost }));
vi.mock("@/lib/server/tenant.server", () => ({ resolveTenantIdForHost: h.resolveTenantIdForHost }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => admin.from(t) },
}));

import { submitPostFeedback } from "@/lib/content/feedback.functions";

const admin = supabaseFromStub();

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_POST_ID = "55555555-5555-4555-8555-555555555555";

// RFC 5737 - adresy przeznaczone WYŁĄCZNIE do dokumentacji.
const IP_DOC = "192.0.2.10";
const IP_DOC_OTHER = "198.51.100.77";
const UA_DOC = "Mozilla/5.0 (compatible; ExampleBot/1.0; +https://bot.example.com/info)";

/** Nagłówki żądania w kształcie, w jakim czyta je handler. */
function requestWith(headers: Record<string, string>): { headers: Headers } {
  return { headers: new Headers(headers) };
}

/** Ostatni `voter_hash`, jaki poszedł do `insert`. */
function insertedHash(): string {
  const chain = admin
    .chainsFor("post_feedback")
    .reverse()
    .find((c) => c.has("insert")) as RecordedChain | undefined;
  const row = chain?.calls.find((c) => c.method === "insert")?.args[0] as
    { voter_hash?: string } | undefined;
  return row?.voter_hash ?? "";
}

/** Domyślny stan bazy: wpis istnieje i opublikowany, brak wcześniejszego głosu. */
function seedDb(): void {
  admin.setResponse("posts", () => ok({ id: POST_ID }));
  admin.setResponse("post_feedback", (chain) => (chain.has("insert") ? ok(null) : ok([])));
}

/** Jedno oddanie głosu; zwraca skrót, który trafił do bazy. */
async function voteAndHash(over?: {
  tenantId?: string;
  postId?: string;
  ip?: string;
  ua?: string;
}): Promise<string> {
  admin.reset();
  seedDb();
  h.resolveTenantIdForHost.mockResolvedValue(over?.tenantId ?? TENANT_A);
  h.getRequest.mockReturnValue(
    requestWith({
      "cf-connecting-ip": over?.ip ?? IP_DOC,
      "user-agent": over?.ua ?? UA_DOC,
    }),
  );
  await submitPostFeedback({ data: { postId: over?.postId ?? POST_ID, helpful: true } });
  return insertedHash();
}

beforeEach(() => {
  admin.reset();
  h.rateLimit.mockReset().mockResolvedValue(true);
  h.currentTenantHost.mockReset().mockResolvedValue("a.example.com");
  h.resolveTenantIdForHost.mockReset().mockResolvedValue(TENANT_A);
  h.getRequest
    .mockReset()
    .mockReturnValue(requestWith({ "cf-connecting-ip": IP_DOC, "user-agent": UA_DOC }));
  setServerFnContext({ supabase: { from: (t: string) => admin.from(t) } });
  seedDb();
});

afterEach(() => {
  resetServerFnContext();
  vi.restoreAllMocks();
});

describe("sha256Hex - skrót głosującego NIE niesie danych osobowych", () => {
  it("skrót NIE zawiera adresu IP ani user-agenta w ŻADNEJ postaci", async () => {
    const hash = await voteAndHash();

    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // 1. dosłownie
    expect(hash).not.toContain(IP_DOC);
    expect(hash).not.toContain(UA_DOC);
    // 2. szesnastkowo (ktoś mógłby „zahaszować" przez zwykłe kodowanie)
    const toHex = (s: string) =>
      [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(hash).not.toContain(toHex(IP_DOC));
    expect(hash).not.toContain(toHex(UA_DOC));
    // 3. w base64
    const toB64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    expect(hash).not.toContain(toB64(IP_DOC));
    expect(hash).not.toContain(toB64(UA_DOC));
    // 4. i żaden fragment adresu dłuższy niż oktet
    expect(hash).not.toContain("192.0.2");
    expect(hash).not.toContain("ExampleBot");
  });

  it("skrót jest STABILNY dla tego samego wejścia - inaczej dedup na 30 dni nie działa", async () => {
    const first = await voteAndHash();
    const second = await voteAndHash();
    expect(second).toBe(first);
  });

  it("ten sam adres IP u INNEGO najemcy daje INNY skrót", async () => {
    const inA = await voteAndHash({ tenantId: TENANT_A });
    const inB = await voteAndHash({ tenantId: TENANT_B });
    // `tenantId` jest PIERWSZYM segmentem klucza właśnie po to: kubełki
    // dedupu nie mogą przeciekać między obszarami roboczymi firm.
    expect(inB).not.toBe(inA);
  });

  it("ten sam czytelnik pod INNYM wpisem daje INNY skrót", async () => {
    const onPost = await voteAndHash({ postId: POST_ID });
    const onOther = await voteAndHash({ postId: OTHER_POST_ID });
    expect(onOther).not.toBe(onPost);
  });

  it("inne IP oraz inny user-agent zmieniają skrót niezależnie od siebie", async () => {
    const base = await voteAndHash();
    expect(await voteAndHash({ ip: IP_DOC_OTHER })).not.toBe(base);
    expect(await voteAndHash({ ua: "Mozilla/5.0 (compatible; OtherBot/2.0)" })).not.toBe(base);
  });

  it('IP zastępcze „unknown-ip" daje JEDEN WSPÓLNY kubełek - i to jest świadome', async () => {
    // Gałąź bez kontekstu HTTP (:31 i :38-40). Fail-closed jak `contact.submit`:
    // czytelnicy bez rozpoznanego IP dzielą kubełek, więc drugi głos z tej
    // grupy jest odrzucany jako duplikat. To PRZYPIĘCIE, nie życzenie: gdyby
    // ktoś „naprawił" to losowym identyfikatorem, dedup przestałby istnieć,
    // a limit zapytań przestałby cokolwiek ograniczać.
    h.getRequest.mockImplementation(() => {
      throw new Error("brak kontekstu HTTP");
    });

    admin.reset();
    seedDb();
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    const firstAnon = insertedHash();

    admin.reset();
    seedDb();
    await submitPostFeedback({ data: { postId: POST_ID, helpful: false } });
    const secondAnon = insertedHash();

    expect(firstAnon).toBe(secondAnon);
    expect(firstAnon).toMatch(/^[0-9a-f]{64}$/);
    // Limit zapytań też leci na wspólny kubełek, nie na losowy identyfikator.
    expect(h.rateLimit).toHaveBeenLastCalledWith({
      scope: "post.feedback",
      subjectId: "unknown-ip",
      max: 20,
    });
  });

  it("brak nagłówka z adresem również ląduje we wspólnym kubełku", async () => {
    h.getRequest.mockReturnValue(requestWith({ "user-agent": UA_DOC }));
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    expect(h.rateLimit).toHaveBeenLastCalledWith({
      scope: "post.feedback",
      subjectId: "unknown-ip",
      max: 20,
    });
  });
});

describe("submitPostFeedback - rozpoznawanie adresu i najemcy", () => {
  it("`cf-connecting-ip` ma pierwszeństwo przed `x-forwarded-for`", async () => {
    h.getRequest.mockReturnValue(
      requestWith({
        "cf-connecting-ip": IP_DOC,
        "x-forwarded-for": `${IP_DOC_OTHER}, 203.0.113.9`,
        "user-agent": UA_DOC,
      }),
    );
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "post.feedback",
      subjectId: IP_DOC,
      max: 20,
    });
  });

  it("z `x-forwarded-for` bierzemy PIERWSZY adres i przycinamy spacje", async () => {
    h.getRequest.mockReturnValue(
      requestWith({ "x-forwarded-for": `  ${IP_DOC_OTHER} , 203.0.113.9`, "user-agent": UA_DOC }),
    );
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    expect(h.rateLimit).toHaveBeenCalledWith({
      scope: "post.feedback",
      subjectId: IP_DOC_OTHER,
      max: 20,
    });
  });

  it("nierozpoznany najemca przerywa PRZED odczytem bazy", async () => {
    h.resolveTenantIdForHost.mockResolvedValue(null);
    await expect(submitPostFeedback({ data: { postId: POST_ID, helpful: true } })).rejects.toThrow(
      "tenant unresolved",
    );
    expect(admin.chains).toHaveLength(0);
  });

  it("wpis musi być opublikowany I w TYM najemcy - inaczej odmowa", async () => {
    admin.setResponse("posts", () => ok(null));
    await expect(submitPostFeedback({ data: { postId: POST_ID, helpful: true } })).rejects.toThrow(
      "post not found",
    );

    const chain = admin.lastChain("posts") as RecordedChain;
    const eqs = chain.calls.filter((c) => c.method === "eq").map((c) => c.args);
    expect(eqs).toContainEqual(["tenant_id", TENANT_A]);
    expect(eqs).toContainEqual(["status", "published"]);
    expect(chain.has("is")).toBe(true);
  });
});

describe("submitPostFeedback - dedup, limit i zapis", () => {
  it("pierwszy głos zapisuje wiersz z najemcą, wpisem i oceną", async () => {
    const result = await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });

    expect(result).toEqual({ ok: true, duplicate: false });
    const chain = admin.chainsFor("post_feedback").find((c) => c.has("insert")) as RecordedChain;
    const row = chain.calls.find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.post_id).toBe(POST_ID);
    expect(row.helpful).toBe(true);
    expect(row.voter_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("głos NEGATYWNY zapisuje się tak samo, tylko z inną oceną", async () => {
    await submitPostFeedback({ data: { postId: POST_ID, helpful: false } });
    const chain = admin.chainsFor("post_feedback").find((c) => c.has("insert")) as RecordedChain;
    const row = chain.calls.find((c) => c.method === "insert")?.args[0] as Record<string, unknown>;
    expect(row.helpful).toBe(false);
  });

  it("drugi głos w oknie 30 dni jest CICHO zignorowany, bez błędu w interfejsie", async () => {
    admin.setResponse("post_feedback", (chain) =>
      chain.has("insert") ? ok(null) : ok([{ id: "istniejacy" }]),
    );
    const result = await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });

    expect(result).toEqual({ ok: true, duplicate: true });
    // ...i nic nie zostało dopisane.
    expect(admin.chainsFor("post_feedback").some((c) => c.has("insert"))).toBe(false);
  });

  it("okno dedupu liczy się od 30 dni wstecz", async () => {
    const before = Date.now();
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    const lookup = admin.chainsFor("post_feedback").find((c) => c.has("gte")) as RecordedChain;
    const since = new Date(lookup.argsOf("gte")?.[1] as string).getTime();
    const days = (before - since) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("przekroczony limit zapytań przerywa PRZED odczytem wpisu", async () => {
    h.rateLimit.mockResolvedValue(false);
    await expect(submitPostFeedback({ data: { postId: POST_ID, helpful: true } })).rejects.toThrow(
      "rate_limited",
    );
    expect(admin.chains).toHaveLength(0);
  });

  it("błąd zapisu jest podniesiony, a nie zgłoszony jako sukces", async () => {
    admin.setResponse("post_feedback", (chain) =>
      chain.has("insert")
        ? {
            data: null,
            error: Object.assign(new Error("insert denied"), { name: "PostgrestError" }),
          }
        : ok([]),
    );
    await expect(submitPostFeedback({ data: { postId: POST_ID, helpful: true } })).rejects.toThrow(
      "insert denied",
    );
  });

  it("walidator wymaga UUID wpisu i logicznej oceny", async () => {
    await expect(
      submitPostFeedback({ data: { postId: "nie-uuid", helpful: true } }),
    ).rejects.toThrow();
    await expect(submitPostFeedback({ data: { postId: POST_ID } })).rejects.toThrow();
    await expect(submitPostFeedback({ data: {} })).rejects.toThrow();
  });

  it("funkcja jest PUBLICZNA (bez middleware) i ma walidator", () => {
    const meta = serverFnMeta(submitPostFeedback);
    expect(meta?.method).toBe("POST");
    expect(meta?.middleware).toEqual([]);
    expect(meta?.hasValidator).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAŁĘZIE BRAKU DANYCH - część C (gałęziowa).
//
// Powyższe przypadki zawsze podają user-agenta i zawsze dostają z bazy TABLICĘ.
// Poniżej wchodzimy w trzy ścieżki, które produkcja widuje, a pomiar dotąd nie:
// żądanie bez nagłówka `user-agent`, odczyt dedupu oddający `null` zamiast
// pustej listy oraz wywołanie funkcji BEZ pola `data`.
// ---------------------------------------------------------------------------
describe("sha256Hex - gałąź braku user-agenta (RODO: nadal bez danych w wyniku)", () => {
  it("żądanie BEZ nagłówka user-agent daje poprawny skrót RÓŻNY od skrótu z UA", async () => {
    // Gałąź `req.headers.get("user-agent") ?? ""`. Klienci bez UA to realny
    // ruch (curl, część czytników, przeglądarki z wyciętym nagłówkiem), więc
    // dedup musi dla nich działać, a nie wywracać się na `null`.
    const withUa = await voteAndHash();

    admin.reset();
    seedDb();
    h.resolveTenantIdForHost.mockResolvedValue(TENANT_A);
    h.getRequest.mockReturnValue(requestWith({ "cf-connecting-ip": IP_DOC }));
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    const withoutUa = insertedHash();

    expect(withoutUa).toMatch(/^[0-9a-f]{64}$/);
    expect(withoutUa).not.toBe(withUa);
    // RODO: pusty user-agent nie może "przepuścić" adresu IP do wyniku.
    expect(withoutUa).not.toContain(IP_DOC);
    expect(withoutUa).not.toContain("192.0.2");
  });

  it("brak UA jest STABILNY - dwa głosy tego samego klienta dają ten sam skrót", async () => {
    const headers = requestWith({ "cf-connecting-ip": IP_DOC });

    admin.reset();
    seedDb();
    h.getRequest.mockReturnValue(headers);
    await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });
    const first = insertedHash();

    admin.reset();
    seedDb();
    h.getRequest.mockReturnValue(headers);
    await submitPostFeedback({ data: { postId: POST_ID, helpful: false } });
    const second = insertedHash();

    expect(second).toBe(first);
  });
});

describe("submitPostFeedback - odczyt dedupu bez tablicy i wywołanie bez danych", () => {
  it("odczyt dedupu oddający `null` NIE blokuje zapisu głosu", async () => {
    // Człon `existing &&`. PostgREST oddaje `data: null` przy błędzie zapytania
    // - traktujemy to jak brak duplikatu (fail-open), bo alternatywą byłoby
    // ciche zjadanie KAŻDEGO głosu, gdy tylko odczyt dedupu przestanie działać.
    // To PRZYPIĘCIE decyzji, nie życzenie.
    admin.setResponse("post_feedback", () => ok(null));

    const result = await submitPostFeedback({ data: { postId: POST_ID, helpful: true } });

    expect(result).toEqual({ ok: true, duplicate: false });
    expect(admin.chainsFor("post_feedback").some((c) => c.has("insert"))).toBe(true);
    expect(insertedHash()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pusta LISTA z odczytu dedupu też przepuszcza głos", async () => {
    admin.setResponse("post_feedback", (chain) => (chain.has("insert") ? ok(null) : ok([])));
    await expect(submitPostFeedback({ data: { postId: POST_ID, helpful: true } })).resolves.toEqual(
      { ok: true, duplicate: false },
    );
  });

  it("wywołanie BEZ pola `data` przechodzi przez walidator i kończy się odmową", async () => {
    // Gałąź `i ?? {}` w walidatorze: brak ciała żądania nie może dać wyjątku
    // typu "Cannot read properties of undefined", tylko czytelny błąd walidacji.
    await expect(submitPostFeedback({ data: undefined })).rejects.toThrow();
    // ...i nic nie poszło do bazy.
    expect(admin.chains).toHaveLength(0);
  });
});
