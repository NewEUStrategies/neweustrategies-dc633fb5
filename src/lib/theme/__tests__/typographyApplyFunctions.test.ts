// SERWEROWA strona migracji typografii - `typographyApply.functions.ts`.
// Do 18.08.2026: 0 z 5 funkcji, 5,6% linii, przy `typographyApply.ts` na 85%.
// Czyli: reguła czyszczenia była przetestowana, a ORKIESTRACJA, która ją
// stosuje do opublikowanych wpisów - nie.
//
// Ta server fn ZAPISUJE do opublikowanych treści, więc niesie trzy ryzyka:
// bramkę uprawnień (kto może uruchomić masową modyfikację), tryb `dryRun`
// (domyślny - raport bez zapisu) i zakres (tylko wpisy opublikowane, tylko
// tenant wołającego, przez klienta użytkownika a nie rolę serwisową).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, fail, type SupabaseFromStub } from "@/test/supabaseChain";
import { callServerFn, asSpec } from "@/test/serverFn";

vi.mock("@tanstack/react-start", async () => (await import("@/test/serverFn")).reactStartStub());
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import {
  applyTypographyToPublished,
  type ApplyTypographyResult,
} from "@/lib/theme/typographyApply.functions";
import { supabaseFromStub } from "@/test/supabaseChain";

const USER = "44444444-4444-4444-8444-444444444444";

let db: SupabaseFromStub;
let isAdmin: boolean | null;
let roleError: { message: string } | null;
const rpcCalls: Array<{ name: string; args: unknown }> = [];

function ctx() {
  return {
    supabase: {
      from: db.from,
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return { data: isAdmin, error: roleError };
      },
    },
    userId: USER,
  };
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

beforeEach(() => {
  db = supabaseFromStub();
  isAdmin = true;
  roleError = null;
  rpcCalls.length = 0;
});

describe("applyTypographyToPublished - bramka uprawnień", () => {
  it("ODMAWIA użytkownikowi bez roli administratora", async () => {
    // Ta operacja modyfikuje WSZYSTKIE opublikowane wpisy naraz - to nie jest
    // akcja dla zwykłego redaktora.
    isAdmin = false;
    db.setResponse("posts", ok([]));
    await expect(callServerFn(applyTypographyToPublished, {}, ctx())).rejects.toThrow(
      "Forbidden: admin required",
    );
  });

  it("ODMAWIA, gdy sprawdzenie roli samo się nie powiodło - fail-closed", async () => {
    isAdmin = true;
    roleError = { message: "RPC niedostępne" };
    db.setResponse("posts", ok([]));
    await expect(callServerFn(applyTypographyToPublished, {}, ctx())).rejects.toThrow(
      "Forbidden: admin required",
    );
  });

  it("pyta o rolę WOŁAJĄCEGO, nie o rolę z parametru", async () => {
    db.setResponse("posts", ok([]));
    await callServerFn(applyTypographyToPublished, {}, ctx());
    expect(rpcCalls[0]).toEqual({ name: "has_role", args: { _user_id: USER, _role: "admin" } });
  });

  it("bramka roli poprzedza JAKIKOLWIEK odczyt wpisów", async () => {
    isAdmin = false;
    db.setResponse("posts", ok([dirtyPost("a")]));
    await expect(callServerFn(applyTypographyToPublished, {}, ctx())).rejects.toThrow();
    expect(db.chainsFor("posts")).toHaveLength(0);
  });
});

describe("applyTypographyToPublished - zakres odczytu", () => {
  it("czyta WYŁĄCZNIE wpisy opublikowane i spoza kosza", async () => {
    db.setResponse("posts", ok([]));
    await callServerFn(applyTypographyToPublished, {}, ctx());

    const chain = db.lastChain("posts");
    expect(chain?.argsOf("eq")).toEqual(["status", "published"]);
    expect(chain?.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("NIE używa select(*) - czyta tylko kolumny, które czyści", async () => {
    db.setResponse("posts", ok([]));
    await callServerFn(applyTypographyToPublished, {}, ctx());
    expect(db.lastChain("posts")?.argsOf("select")?.[0]).not.toBe("*");
  });

  it("błąd odczytu wychodzi na wierzch", async () => {
    db.setResponse("posts", fail("odmowa odczytu"));
    await expect(callServerFn(applyTypographyToPublished, {}, ctx())).rejects.toThrow(
      "odmowa odczytu",
    );
  });

  it("pusta baza daje raport zerowy, nie wyjątek", async () => {
    db.setResponse("posts", ok(null));
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());
    expect(out).toMatchObject({ scanned: 0, affected: 0, updated: 0, posts: [] });
  });
});

describe("applyTypographyToPublished - tryb dry-run", () => {
  it("jest DOMYŚLNY: bez argumentu nic nie zapisuje", async () => {
    // Domyślna wartość jest tu decyzją bezpieczeństwa: wywołanie bez parametru
    // ma raportować, a nie modyfikować opublikowane treści.
    db.setResponse("posts", (chain) => (chain.has("update") ? ok(null) : ok([dirtyPost("a")])));
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.dryRun).toBe(true);
    expect(out.updated).toBe(0);
    expect(db.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });

  it("pozostaje dry-runem także przy jawnym `dryRun: true`", async () => {
    db.setResponse("posts", ok([dirtyPost("a")]));
    const out = await callServerFn<ApplyTypographyResult>(
      applyTypographyToPublished,
      { dryRun: true },
      ctx(),
    );
    expect(out.dryRun).toBe(true);
  });

  it("pozostaje dry-runem dla wartości innej niż jawne `false`", async () => {
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
    db.setResponse("posts", ok([dirtyPost("a"), cleanPost("b"), dirtyPost("c")]));
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.scanned).toBe(3);
    expect(out.affected).toBe(2);
  });

  it("przycina listę podglądu do 20 wpisów, ale licznik obejmuje całość", async () => {
    const many = Array.from({ length: 25 }, (_, i) => dirtyPost(`p${i}`));
    db.setResponse("posts", ok(many));
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.affected).toBe(25);
    expect(out.posts).toHaveLength(20);
  });

  it("podgląd niesie identyfikator, slug i tytuł - bez treści", async () => {
    // Raport wraca do przeglądarki; wysyłanie tam pełnych treści wpisów byłoby
    // odpowiedzią wielomegabajtową bez żadnego pożytku.
    db.setResponse("posts", ok([dirtyPost("a")]));
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());

    expect(out.posts[0]).toEqual({ id: "a", slug: "wpis-a", title: "Wpis a" });
    expect(Object.keys(out.posts[0])).toEqual(["id", "slug", "title"]);
  });

  it("tytuł spada na wersję angielską, a potem na slug", async () => {
    db.setResponse(
      "posts",
      ok([
        dirtyPost("a", { title_pl: "", title_en: "English" }),
        dirtyPost("b", { title_pl: "", title_en: null }),
      ]),
    );
    const out = await callServerFn<ApplyTypographyResult>(applyTypographyToPublished, {}, ctx());
    expect(out.posts.map((p) => p.title)).toEqual(["English", "wpis-b"]);
  });
});

describe("applyTypographyToPublished - zapis", () => {
  it("zapisuje TYLKO wpisy wymagające migracji", async () => {
    db.setResponse("posts", (chain) =>
      chain.has("update") ? ok(null) : ok([dirtyPost("a"), cleanPost("b")]),
    );
    const out = await callServerFn<ApplyTypographyResult>(
      applyTypographyToPublished,
      { dryRun: false },
      ctx(),
    );

    expect(out).toMatchObject({ dryRun: false, scanned: 2, affected: 1, updated: 1 });
    const updates = db.chainsFor("posts").filter((c) => c.has("update"));
    expect(updates).toHaveLength(1);
    expect(updates[0].argsOf("eq")).toEqual(["id", "a"]);
  });

  it("payload NIE zawiera pól raportowych - to nie są kolumny tabeli", async () => {
    // `slug` i `title` służą wyłącznie raportowi; wysłanie ich w UPDATE
    // nadpisałoby slug wpisu jego własną wartością (albo wywaliło zapytanie).
    db.setResponse("posts", (chain) => (chain.has("update") ? ok(null) : ok([dirtyPost("a")])));
    await callServerFn(applyTypographyToPublished, { dryRun: false }, ctx());

    const payload = db
      .chainsFor("posts")
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("slug");
    expect(payload).not.toHaveProperty("title");
    expect(payload.content_pl).toBe('<p style="color:red">a</p>');
  });

  it("zapis zawęża się do JEDNEGO wiersza po identyfikatorze", async () => {
    db.setResponse("posts", (chain) =>
      chain.has("update") ? ok(null) : ok([dirtyPost("a"), dirtyPost("b")]),
    );
    await callServerFn(applyTypographyToPublished, { dryRun: false }, ctx());

    const ids = db
      .chainsFor("posts")
      .filter((c) => c.has("update"))
      .map((c) => c.argsOf("eq")?.[1]);
    expect(ids).toEqual(["a", "b"]);
  });

  it("błąd zapisu PRZERYWA migrację zamiast lecieć dalej", async () => {
    // Cicha kontynuacja zostawiłaby bazę w stanie częściowo zmigrowanym bez
    // żadnego śladu, który wpis się nie udał.
    db.setResponse("posts", (chain) =>
      chain.has("update") ? fail("wiersz zablokowany") : ok([dirtyPost("a"), dirtyPost("b")]),
    );
    await expect(
      callServerFn(applyTypographyToPublished, { dryRun: false }, ctx()),
    ).rejects.toThrow("wiersz zablokowany");
  });

  it("czyści także drzewo bloków i drzewo buildera", async () => {
    db.setResponse("posts", (chain) =>
      chain.has("update")
        ? ok(null)
        : ok([
            dirtyPost("a", {
              content_pl: "<p>czysty</p>",
              blocks_data: [{ attrs: { fontSize: "20px", color: "red" } }],
              builder_data: { w: [{ style: "letter-spacing:2px;margin:4px" }] },
            }),
          ]),
    );
    await callServerFn(applyTypographyToPublished, { dryRun: false }, ctx());

    const payload = db
      .chainsFor("posts")
      .find((c) => c.has("update"))
      ?.argsOf("update")?.[0] as Record<string, unknown>;
    const asText = JSON.stringify(payload);
    expect(asText).not.toContain("fontSize");
    expect(asText).not.toContain("letter-spacing");
    expect(asText).toContain("color");
    expect(asText).toContain("margin");
  });

  it("nic do migracji = zero zapisów mimo `dryRun: false`", async () => {
    db.setResponse("posts", ok([cleanPost("a")]));
    const out = await callServerFn<ApplyTypographyResult>(
      applyTypographyToPublished,
      { dryRun: false },
      ctx(),
    );

    expect(out).toMatchObject({ affected: 0, updated: 0 });
    expect(db.chainsFor("posts").some((c) => c.has("update"))).toBe(false);
  });
});
