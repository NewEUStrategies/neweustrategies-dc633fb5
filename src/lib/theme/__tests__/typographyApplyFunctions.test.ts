// SERWEROWA strona migracji typografii - `typographyApply.functions.ts`.
// Do 18.08.2026: 0 z 5 funkcji, 5,6% linii, przy `typographyApply.ts` na 85%.
// Czyli: reguła czyszczenia była przetestowana, a ORKIESTRACJA, która ją
// stosuje do opublikowanych wpisów - nie.
//
// Ta server fn ZAPISUJE do opublikowanych treści, więc niesie cztery ryzyka:
// bramkę uprawnień (kto może uruchomić masową modyfikację), tryb `dryRun`
// (domyślny - raport bez zapisu), zakres (tylko wpisy opublikowane, tylko
// tenant wołającego) i ścieżkę danych.
//
// ŚCIEŻKA DANYCH (wydanie 11 -> 12). Wcześniejsza wersja tego pliku dowodziła,
// że odczyt idzie „klientem użytkownika, a nie rolą serwisową" - i to był
// dowód na DEFEKT, nie na poprawność: kolumny ciała są odebrane roli
// `authenticated` (20260702200000), więc w produkcji skan kończył się
// `permission denied`, a opublikowane wpisy innych tenantów są dla RLS
// czytelne publicznie. Atrapa klienta nie zna uprawnień kolumnowych, więc
// zieleń była fałszywa. Teraz test pilnuje kontraktu `posts-migrate`:
//   1. odczyt service_role z JAWNYM filtrem tenanta z profilu,
//   2. brak tenanta = wyjątek PRZED pierwszym zapytaniem o wpisy,
//   3. zapis klientem wołającego, zawężony po id i tenancie,
//   4. cichy filtr RLS przy zapisie (0 wierszy) to błąd, nie „zaktualizowano",
//   5. skan idzie partiami - archiwum nie ląduje w pamięci workera naraz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import { callServerFn, asSpec } from "@/test/serverFn";
import { serverFnMiddlewareNames } from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => (await import("@/test/serverFn")).reactStartStub());
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));

const server = vi.hoisted(() => ({ admin: null as unknown }));

vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const admin = supabaseFromStub();
  server.admin = admin;
  return { supabaseAdmin: { from: admin.from } };
});

import {
  applyTypographyToPublished,
  TYPOGRAPHY_SCAN_BATCH,
  type ApplyTypographyResult,
} from "@/lib/theme/typographyApply.functions";
import { supabaseFromStub } from "@/test/supabaseChain";
// Import statyczny: fabryka `vi.mock` jest leniwa, a `beforeEach` musi mieć
// atrapę service_role w ręku, zanim handler załaduje ją dynamicznie.
import "@/integrations/supabase/client.server";

const USER = "44444444-4444-4444-8444-444444444444";
const TENANT = "55555555-5555-4555-8555-555555555555";

const admin = server.admin as SupabaseFromStub;
let db: SupabaseFromStub;

function ctx() {
  return { supabase: { from: db.from }, userId: USER };
}

/** Wpis z zaszytą inline typografią - wymaga migracji. */
function dirtyPost(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    slug: `wpis-${id}`,
    title_pl: `Wpis ${id}`,
    title_en: null,
    content_pl: `<p style="font-size:19px;color:red">${id}</p>`,
    content_en: null,
    blocks_data: null,
    builder_data: null,
    ...overrides,
  };
}

/** Wpis już dziedziczący motyw - migracja ma go pominąć. */
function cleanPost(id: string) {
  return {
    id,
    slug: `czysty-${id}`,
    title_pl: `Czysty ${id}`,
    title_en: null,
    content_pl: "<p>zwykły tekst</p>",
    content_en: null,
    blocks_data: null,
    builder_data: null,
  };
}

/** Zaplanuj odczyt wpisów po stronie service_role. */
function posts(rows: unknown) {
  admin.setResponse("posts", ok(rows));
}

/** Wszystkie argumenty danego ogniwa (argsOf oddaje tylko pierwsze). */
function allArgs(chain: RecordedChain | undefined, method: string): unknown[][] {
  return (chain?.calls ?? []).filter((c) => c.method === method).map((c) => [...c.args]);
}

const updates = () => db.chainsFor("posts").filter((c) => c.has("update"));

beforeEach(() => {
  admin.reset();
  admin.setResponse("profiles", ok({ tenant_id: TENANT }));
  db = supabaseFromStub();
  // Zapis pod RLS trafia w jeden wiersz - domyślny, szczęśliwy przypadek.
  db.setResponse("posts", (chain) => ok([{ id: chain.argsOf("eq")?.[1] }]));
});

describe("applyTypographyToPublished - bramka uprawnień", () => {
  it("deklaruje `requireAdmin` (rola admina w tenancie + MFA), nie samo uwierzytelnienie", () => {
    // Masowa modyfikacja WSZYSTKICH opublikowanych wpisów nie jest akcją dla
    // redaktora. `requireAdmin` sprawdza rolę w tenancie z profilu i krok MFA;
    // wcześniejszy `has_role("admin")` przez RPC pomijał MFA i super_admina.
    expect(serverFnMiddlewareNames(applyTypographyToPublished)).toEqual(["requireAdmin"]);
  });

  it("brak tenanta w profilu PRZERYWA operację przed odczytem wpisów (fail-closed)", async () => {
    admin.setResponse("profiles", ok(null));
    posts([dirtyPost("a")]);
    await expect(callServerFn(applyTypographyToPublished, {}, ctx())).rejects.toThrow(
      "No tenant for current user",
    );
    expect(admin.chainsFor("posts")).toHaveLength(0);
  });

  it("tenant pochodzi z profilu WOŁAJĄCEGO", async () => {
    posts([]);
    await callServerFn(applyTypographyToPublished, {}, ctx());
    expect(admin.lastChain("profiles")?.argsOf("eq")).toEqual(["id", USER]);
  });
});

describe("applyTypographyToPublished - zakres odczytu", () => {
  it("czyta service_role, przypięty do tenanta, tylko opublikowane i spoza kosza", async () => {
    posts([]);
    await callServerFn(applyTypographyToPublished, {}, ctx());

    const chain = admin.lastChain("posts");
    expect(allArgs(chain, "eq")).toEqual([
      ["tenant_id", TENANT],
      ["status", "published"],
    ]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
    // Klient użytkownika NIE czyta kolumn ciała - one są mu odebrane.
    expect(db.chainsFor("posts").filter((c) => !c.has("update"))).toHaveLength(0);
  });

  it("NIE używa select(*) - czyta tylko kolumny, które czyści", async () => {
    posts([]);
    await callServerFn(applyTypographyToPublished, {}, ctx());
    expect(admin.lastChain("posts")?.argsOf("select")?.[0]).not.toBe("*");
  });

  it("skanuje PARTIAMI w stabilnym porządku po kluczu", async () => {
    const first = Array.from({ length: TYPOGRAPHY_SCAN_BATCH }, (_, i) => cleanPost(`a${i}`));
    const second = [dirtyPost("z")];
    admin.setResponse("posts", (chain) =>
      ok(chain.argsOf("range")?.[0] === 0 ? first : chain.argsOf("range")?.[0] ? second : []),
    );
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    const chains = admin.chainsFor("posts");
    expect(chains.map((c) => c.argsOf("range"))).toEqual([
      [0, TYPOGRAPHY_SCAN_BATCH - 1],
      [TYPOGRAPHY_SCAN_BATCH, 2 * TYPOGRAPHY_SCAN_BATCH - 1],
    ]);
    expect(chains.every((c) => c.argsOf("order")?.[0] === "id")).toBe(true);
    expect(out).toMatchObject({ scanned: TYPOGRAPHY_SCAN_BATCH + 1, affected: 1 });
  });

  it("niepełna partia kończy skan - bez zbędnego zapytania o pustą stronę", async () => {
    posts([dirtyPost("a")]);
    await callServerFn(applyTypographyToPublished, {}, ctx());
    expect(admin.chainsFor("posts")).toHaveLength(1);
  });

  it("błąd odczytu wychodzi na wierzch", async () => {
    admin.setResponse("posts", fail("odmowa odczytu"));
    await expect(callServerFn(applyTypographyToPublished, {}, ctx())).rejects.toThrow(
      "odmowa odczytu",
    );
  });

  it("pusta baza daje raport zerowy, nie wyjątek", async () => {
    posts(null);
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());
    expect(out).toMatchObject({ scanned: 0, affected: 0, updated: 0, posts: [] });
  });
});

describe("applyTypographyToPublished - tryb dry-run", () => {
  it("jest DOMYŚLNY: bez argumentu nic nie zapisuje", async () => {
    // Domyślna wartość jest tu decyzją bezpieczeństwa: wywołanie bez parametru
    // ma raportować, a nie modyfikować opublikowane treści.
    posts([dirtyPost("a")]);
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.dryRun).toBe(true);
    expect(out.updated).toBe(0);
    expect(updates()).toHaveLength(0);
    expect(admin.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });

  it("pozostaje dry-runem także przy jawnym `dryRun: true`", async () => {
    posts([dirtyPost("a")]);
    const out = await callServerFn<ApplyTypographyResult>(
      applyTypographyToPublished,
      { dryRun: true },
      ctx(),
    );
    expect(out.dryRun).toBe(true);
  });

  it("pozostaje dry-runem dla wartości innej niż jawne `false`", () => {
    // Walidator wymaga DOKŁADNIE `false`; "false", 0 czy undefined nie mogą
    // przypadkiem uruchomić masowego zapisu.
    const spec = asSpec<{ dryRun: boolean }>(applyTypographyToPublished);
    expect(spec.validator?.(undefined)).toEqual({ dryRun: true });
    expect(spec.validator?.({})).toEqual({ dryRun: true });
    expect(spec.validator?.({ dryRun: 0 })).toEqual({ dryRun: true });
    expect(spec.validator?.({ dryRun: "false" })).toEqual({ dryRun: true });
    expect(spec.validator?.({ dryRun: false })).toEqual({ dryRun: false });
  });

  it("raportuje LICZBĘ wpisów wymagających migracji, nie wszystkich", async () => {
    posts([dirtyPost("a"), cleanPost("b"), dirtyPost("c")]);
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.scanned).toBe(3);
    expect(out.affected).toBe(2);
  });

  it("przycina listę podglądu do 20 wpisów, ale licznik obejmuje całość", async () => {
    posts(Array.from({ length: 25 }, (_, i) => dirtyPost(`p${i}`)));
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.affected).toBe(25);
    expect(out.posts).toHaveLength(20);
  });

  it("podgląd niesie identyfikator, slug i tytuł - bez treści", async () => {
    // Raport wraca do przeglądarki; wysyłanie tam pełnych treści wpisów byłoby
    // odpowiedzią wielomegabajtową bez żadnego pożytku.
    posts([dirtyPost("a")]);
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.posts[0]).toEqual({ id: "a", slug: "wpis-a", title: "Wpis a" });
    expect(Object.keys(out.posts[0])).toEqual(["id", "slug", "title"]);
  });

  it("tytuł spada na wersję angielską, a potem na slug", async () => {
    posts([
      dirtyPost("a", { title_pl: "", title_en: "English" }),
      dirtyPost("b", { title_pl: "", title_en: null }),
    ]);
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());
    expect(out.posts.map((p) => p.title)).toEqual(["English", "wpis-b"]);
  });
});

describe("applyTypographyToPublished - zapis", () => {
  it("zapisuje TYLKO wpisy wymagające migracji, klientem wołającego", async () => {
    posts([dirtyPost("a"), cleanPost("b")]);
    const out = await callServerFn<ApplyTypographyResult>(
      applyTypographyToPublished,
      { dryRun: false },
      ctx(),
    );

    expect(out).toMatchObject({ dryRun: false, scanned: 2, affected: 1, updated: 1 });
    expect(updates()).toHaveLength(1);
    // Service_role omija RLS - gdyby to on zapisywał, migracja nadpisywałaby
    // treść z pominięciem polityk wołającego.
    expect(admin.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });

  it("zapis zawęża się do JEDNEGO wiersza po identyfikatorze i tenancie", async () => {
    posts([dirtyPost("a"), dirtyPost("b")]);
    await callServerFn(applyTypographyToPublished, { dryRun: false }, ctx());

    expect(updates().map((c) => allArgs(c, "eq"))).toEqual([
      [
        ["id", "a"],
        ["tenant_id", TENANT],
      ],
      [
        ["id", "b"],
        ["tenant_id", TENANT],
      ],
    ]);
  });

  it("payload NIE zawiera pól raportowych - to nie są kolumny tabeli", async () => {
    // `slug` i `title` służą wyłącznie raportowi; wysłanie ich w UPDATE
    // nadpisałoby slug wpisu jego własną wartością (albo wywaliło zapytanie).
    posts([dirtyPost("a")]);
    await callServerFn(applyTypographyToPublished, { dryRun: false }, ctx());

    const payload = updates()[0]?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("slug");
    expect(payload).not.toHaveProperty("title");
    expect(payload.content_pl).toBe('<p style="color:red">a</p>');
  });

  it("cichy filtr RLS (0 zapisanych wierszy) jest BŁĘDEM, nie sukcesem", async () => {
    // PostgREST nie zgłasza błędu, gdy polityka odfiltruje UPDATE. Bez
    // `select("id")` raport pokazałby „zaktualizowano 1", a treść by stała.
    posts([dirtyPost("a")]);
    db.setResponse("posts", ok([]));
    await expect(
      callServerFn(applyTypographyToPublished, { dryRun: false }, ctx()),
    ).rejects.toThrow("Post a was not updated");
    expect(updates()[0]?.argsOf("select")).toEqual(["id"]);
  });

  it("błąd zapisu PRZERYWA migrację zamiast lecieć dalej", async () => {
    // Cicha kontynuacja zostawiłaby bazę w stanie częściowo zmigrowanym bez
    // żadnego śladu, który wpis się nie udał.
    posts([dirtyPost("a"), dirtyPost("b")]);
    db.setResponse("posts", fail("wiersz zablokowany"));
    await expect(
      callServerFn(applyTypographyToPublished, { dryRun: false }, ctx()),
    ).rejects.toThrow("wiersz zablokowany");
    expect(updates()).toHaveLength(1);
  });

  it("czyści także drzewo bloków i drzewo buildera", async () => {
    posts([
      dirtyPost("a", {
        content_pl: "<p>czysty</p>",
        blocks_data: [{ attrs: { fontSize: "20px", color: "red" } }],
        builder_data: { w: [{ style: "letter-spacing:2px;margin:4px" }] },
      }),
    ]);
    await callServerFn(applyTypographyToPublished, { dryRun: false }, ctx());

    const asText = JSON.stringify(updates()[0]?.argsOf("update")?.[0]);
    expect(asText).not.toContain("fontSize");
    expect(asText).not.toContain("letter-spacing");
    expect(asText).toContain("color");
    expect(asText).toContain("margin");
  });

  it("nic do migracji = zero zapisów mimo `dryRun: false`", async () => {
    posts([cleanPost("a")]);
    const out = await callServerFn<ApplyTypographyResult>(
      applyTypographyToPublished,
      { dryRun: false },
      ctx(),
    );

    expect(out).toMatchObject({ affected: 0, updated: 0 });
    expect(updates()).toHaveLength(0);
  });
});
