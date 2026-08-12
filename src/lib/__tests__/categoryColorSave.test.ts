// Bramka defektu K10 (audyt 12.08, moduł Treści): ekran /admin/category-colors
// zapisywał kolor pigułki przez `upsertCategory`, którego UPDATE pisze CAŁY
// wiersz z przesłanego payloadu. Ekran kolorów nie wczytuje opisów kategorii,
// więc wysyłał `description_pl/description_en: null` - każda zmiana koloru
// kasowała opisy, których archiwa używają w meta description i w hero.
//
// DWIE WARSTWY TESTU, BO DWIE RÓŻNE RZECZY MOGĄ WRÓCIĆ DO STANU PRZED NAPRAWĄ:
//
//   1. ZAPIS (runtime). `updateCategoryColor` musi dotknąć WYŁĄCZNIE kolumny
//      `color`. Sprawdzane fałszywym klientem, który trzyma wiersz z opisami i
//      nakłada na niego dokładnie ten patch, który poszedł do `update()`.
//   2. PODŁĄCZENIE (statycznie, z treści źródła). `createServerFn` i komponent
//      trasy nie dadzą się wywołać bez kontekstu żądania frameworka, a znikającym
//      elementem jest tu JEDNA linia: import wąskiej ścieżki zapisu. Powrót do
//      `upsertCategory` z payloadem opisów nie zmieniłby niczego, co widzi
//      warstwa 1.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

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

// `createServerFn` zastąpiony łańcuchem, który ODDAJE walidator i handler -
// inaczej nie ma jak wywołać server fn w teście jednostkowym.
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
vi.mock("@/lib/server/rate-limit.server", () => ({ rateLimit: async () => true }));
vi.mock("@/lib/server/audit.server", () => ({ recordAudit: async () => undefined }));

const CATEGORY_ID = "11111111-1111-4111-8111-111111111111";

interface CategoryRow {
  id: string;
  color: string | null;
  description_pl: string | null;
  description_en: string | null;
  logo_url: string | null;
}

/** Klient, który zachowuje się jak PostgREST: UPDATE nakłada TYLKO wysłane kolumny. */
function fakeSupabase(row: CategoryRow) {
  const patches: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { tenant_id: "tenant-1" }, error: null }),
            }),
          }),
        };
      }
      if (table === "categories") {
        return {
          update(patch: Record<string, unknown>) {
            patches.push(patch);
            return {
              eq: async (_column: string, id: string) => {
                if (id === row.id) Object.assign(row, patch);
                return { error: null };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
  return { client, patches };
}

async function loadUpdateCategoryColor(): Promise<ServerFnSpec> {
  const mod = await import("@/lib/content.functions");
  return mod.updateCategoryColor as unknown as ServerFnSpec;
}

async function saveColor(row: CategoryRow, color: string) {
  const spec = await loadUpdateCategoryColor();
  const { client, patches } = fakeSupabase(row);
  const data = spec.validator?.({ id: row.id, color });
  await spec.handler?.({ data, context: { supabase: client, userId: "user-1" } });
  return patches;
}

describe("updateCategoryColor", () => {
  it("zapisuje kolor i NIE rusza opisów PL/EN ani logo", async () => {
    const row: CategoryRow = {
      id: CATEGORY_ID,
      color: "#111827",
      description_pl: "Opis polski obszaru tematycznego",
      description_en: "English description of the area",
      logo_url: "https://example.com/logo.png",
    };

    const patches = await saveColor(row, "#ff0055");

    expect(row.color).toBe("#ff0055");
    expect(row.description_pl).toBe("Opis polski obszaru tematycznego");
    expect(row.description_en).toBe("English description of the area");
    expect(row.logo_url).toBe("https://example.com/logo.png");
    // Kluczowe: patch zawiera DOKŁADNIE jedną kolumnę.
    expect(patches).toEqual([{ color: "#ff0055" }]);
  });

  it("odrzuca kolor poza formatem #rrggbb", async () => {
    const spec = await loadUpdateCategoryColor();
    expect(() => spec.validator?.({ id: CATEGORY_ID, color: "red" })).toThrow();
    expect(() => spec.validator?.({ id: "nie-uuid", color: "#ffffff" })).toThrow();
  });
});

describe("/admin/category-colors", () => {
  const source = readFileSync("src/routes/admin.category-colors.tsx", "utf8");

  it("zapisuje przez wąską ścieżkę koloru, nie przez pełny upsert kategorii", () => {
    expect(source).toContain("updateCategoryColor");
    expect(source).not.toContain("upsertCategory");
  });

  it("nie wysyła opisów kategorii z ekranu, który ich nie wczytuje", () => {
    expect(source).not.toContain("description_pl");
    expect(source).not.toContain("description_en");
  });
});
