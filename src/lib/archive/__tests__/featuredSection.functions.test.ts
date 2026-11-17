// Sekcja wyróżniona archiwum - funkcja serwerowa dla GOŚCIA.
//
// DEFEKT (17.11.2026, odtworzony na lokalnym PG16 jako anon). Archiwum
// czytało `builder_templates(data)` klientem przeglądarki, a `anon` nie ma na
// tej tabeli grantu: 42501, odrzucone `Promise.all` i strona „brak danych"
// na każdej kategorii i tagu z ustawionym szablonem wyróżnionym.
//
// CO PRZYPINA (handler przez atrapę `createServerFn`, odczyty przez atrapę
// łańcucha PostgREST, która odgrywa filtr najemcy jak baza):
//   * szablon wynika z PUBLICZNEGO wiersza terminu (kategorii albo tagu), nie
//     z ładunku - `templateId` w ładunku niczego nie zmienia;
//   * oba odczyty spod service-role niosą `.eq("tenant_id", <najemca hosta>)`;
//     termin i szablon obcego najemcy nie wracają;
//   * bez najemcy hosta - odmowa przed jakimkolwiek odczytem;
//   * wychodzi wyłącznie dokument sekcji (`kind: "section"`), jako tekst JSON;
//   * odmowa bazy rzuca (czytelnik w `archives.ts` zamienia ją w archiwum
//     bez sekcji z flagą degradacji).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabase/chain";
import { callServerFn } from "@/test/serverFnHarness";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CATEGORY = "c0000000-0000-4000-8000-000000000001";
const TAG = "c0000000-0000-4000-8000-000000000002";
const TEMPLATE = "f0000000-0000-4000-8000-000000000001";
const FOREIGN_TEMPLATE = "f0000000-0000-4000-8000-0000000000b1";
const SECTION = { id: "s1", kind: "section", children: [] };

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  /** Najemca, którego `resolveTenantIdForHost` zwraca dla hosta żądania. */
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as string | null,
  /** Host widziany przez `currentTenantHost` i hosty podane resolverowi. */
  host: "nes.example.org" as string | null,
  resolvedHosts: [] as Array<string | null>,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/client.server", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const db = supabaseFromStub();
  h.db = db;
  return { supabaseAdmin: { from: db.from } };
});

vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.resolvedHosts.push(host);
    return h.tenant;
  },
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: async () => h.host,
}));

const { getArchiveFeaturedSection } = await import("@/lib/archive/featuredSection.functions");
// Handler sięga po klienta service-role dynamicznym importem - fabryka atrapy
// musi ruszyć, zanim `beforeEach` zaplanuje odpowiedzi tabel.
await import("@/integrations/supabase/client.server");

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa service-role nie została podpięta");
  return h.db;
}

/** Wszystkie pary `.eq(kolumna, wartość)` łańcucha. */
function eqs(chain: RecordedChain): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const call of chain.calls) {
    if (call.method === "eq" && typeof call.args[0] === "string") out[call.args[0]] = call.args[1];
  }
  return out;
}

/** Wiersze „bazy" - atrapa zwraca wiersz tylko przy zgodnym id I najemcy, jak filtr. */
const rows = {
  categories: [{ id: CATEGORY, tenant_id: TENANT_A, featured_template_id: TEMPLATE }],
  tags: [{ id: TAG, tenant_id: TENANT_A, featured_template_id: TEMPLATE }],
  builder_templates: [
    { id: TEMPLATE, tenant_id: TENANT_A, data: SECTION as unknown },
    { id: FOREIGN_TEMPLATE, tenant_id: TENANT_B, data: { id: "sB", kind: "section" } },
  ],
};

function planTables(): void {
  for (const table of ["categories", "tags", "builder_templates"] as const) {
    db().setResponse(table, (chain) => {
      const f = eqs(chain);
      // Bez filtra najemcy atrapa NIE odsiewa obcych wierszy - tak jak baza
      // pod service-role. Brak `.eq("tenant_id")` musi więc być widoczny.
      const hit = rows[table].find(
        (r) => r.id === f.id && (!("tenant_id" in f) || r.tenant_id === f.tenant_id),
      );
      if (!hit) return ok(null);
      return ok(
        table === "builder_templates"
          ? { data: (hit as { data: unknown }).data }
          : {
              featured_template_id: (hit as { featured_template_id: string | null })
                .featured_template_id,
            },
      );
    });
  }
}

async function call(data: unknown): Promise<{ json: string | null }> {
  return callServerFn<{ json: string | null }>(getArchiveFeaturedSection, {
    data,
    context: { supabase: null },
  });
}

beforeEach(() => {
  db().reset();
  h.tenant = TENANT_A;
  h.host = "nes.example.org";
  h.resolvedHosts = [];
  rows.categories[0].featured_template_id = TEMPLATE;
  rows.builder_templates[0].data = SECTION;
  planTables();
});

describe("getArchiveFeaturedSection - szablon z publicznego terminu, najemca z hosta", () => {
  it("kategoria: termin i szablon czytane w najemcy HOSTA, wynik to dokument sekcji", async () => {
    const res = await call({ kind: "category", termId: CATEGORY });

    expect(JSON.parse(res.json ?? "null")).toEqual(SECTION);
    expect(h.resolvedHosts).toEqual(["nes.example.org"]);
    const term = db().lastChain("categories");
    expect(term?.argsOf("select")?.[0]).toBe("featured_template_id");
    expect(eqs(term as RecordedChain)).toEqual({ id: CATEGORY, tenant_id: TENANT_A });
    expect(term?.has("maybeSingle")).toBe(true);
    const template = db().lastChain("builder_templates");
    expect(template?.argsOf("select")?.[0]).toBe("data");
    expect(eqs(template as RecordedChain)).toEqual({ id: TEMPLATE, tenant_id: TENANT_A });
    expect(db().chainsFor("tags")).toHaveLength(0);
  });

  it("tag czyta wiersz TAGU, nie kategorii", async () => {
    const res = await call({ kind: "tag", termId: TAG });
    expect(JSON.parse(res.json ?? "null")).toEqual(SECTION);
    expect(eqs(db().lastChain("tags") as RecordedChain)).toEqual({ id: TAG, tenant_id: TENANT_A });
    expect(db().chainsFor("categories")).toHaveLength(0);
  });

  it("identyfikator szablonu z ŁADUNKU jest ignorowany - czytany jest wyłącznie szablon terminu", async () => {
    const res = await call({ kind: "category", termId: CATEGORY, templateId: FOREIGN_TEMPLATE });
    expect(JSON.parse(res.json ?? "null")).toEqual(SECTION);
    expect(eqs(db().lastChain("builder_templates") as RecordedChain).id).toBe(TEMPLATE);
  });

  it("termin bez szablonu: `null` i ZERO odczytów biblioteki szablonów", async () => {
    rows.categories[0].featured_template_id = null as unknown as string;
    const res = await call({ kind: "category", termId: CATEGORY });
    expect(res).toEqual({ json: null });
    expect(db().chainsFor("builder_templates")).toHaveLength(0);
  });

  it("termin OBCEGO najemcy (host innego serwisu) nie wraca - `null`, bez odczytu szablonu", async () => {
    h.tenant = TENANT_B;
    const res = await call({ kind: "category", termId: CATEGORY });
    expect(res).toEqual({ json: null });
    expect(eqs(db().lastChain("categories") as RecordedChain).tenant_id).toBe(TENANT_B);
    expect(db().chainsFor("builder_templates")).toHaveLength(0);
  });

  it("szablon wskazany przez termin, ale należący do OBCEGO najemcy - `null`", async () => {
    rows.categories[0].featured_template_id = FOREIGN_TEMPLATE;
    const res = await call({ kind: "category", termId: CATEGORY });
    expect(res).toEqual({ json: null });
    expect(eqs(db().lastChain("builder_templates") as RecordedChain)).toEqual({
      id: FOREIGN_TEMPLATE,
      tenant_id: TENANT_A,
    });
  });

  it.each([
    ["dokument innego rodzaju", { id: "r1", kind: "row" }],
    ["tablica", [SECTION]],
    ["tekst", "to nie jest sekcja"],
    ["null", null],
  ])("%s nie wychodzi z funkcji", async (_label, data) => {
    rows.builder_templates[0].data = data;
    expect(await call({ kind: "category", termId: CATEGORY })).toEqual({ json: null });
  });

  it("bez najemcy hosta - odmowa PRZED jakimkolwiek odczytem spod service-role", async () => {
    h.tenant = null;
    await expect(call({ kind: "category", termId: CATEGORY })).rejects.toThrow("tenant unresolved");
    expect(db().chains).toHaveLength(0);
  });

  it("odmowa odczytu terminu albo szablonu RZUCA, a nie udaje braku sekcji", async () => {
    db().setResponse("categories", fail("odmowa categories"));
    await expect(call({ kind: "category", termId: CATEGORY })).rejects.toThrow("odmowa categories");
    planTables();
    db().setResponse("builder_templates", fail("odmowa builder_templates"));
    await expect(call({ kind: "category", termId: CATEGORY })).rejects.toThrow(
      "odmowa builder_templates",
    );
  });

  it.each([
    ["termin spoza UUID", { kind: "category", termId: "kat-1" }],
    ["rodzaj spoza kategorii i tagu", { kind: "page", termId: CATEGORY }],
    ["brak terminu", { kind: "tag" }],
  ])("walidator odrzuca: %s", async (_label, data) => {
    await expect(call(data)).rejects.toThrow();
    expect(db().chains).toHaveLength(0);
  });
});
