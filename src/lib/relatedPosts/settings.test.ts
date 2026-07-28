// Zapis konfiguracji rekomendacji: normalizacja wiersza + WERYFIKACJA zapisu.
//
// Regresja, którą te testy blokują: panel zapisywał przez
// `update(next).neq("tenant_id", zero-uuid)`. UPDATE, który nie dopasował
// żadnego wiersza, jest dla PostgREST sukcesem (204), więc tenant bez zasianego
// wiersza dostawał toast „Zapisano" przy zerowej zmianie. Test
// `not_persisted` poniżej jest bezpośrednim testem tej klasy błędu: zapis, który
// nie dotknął wiersza, MUSI rzucić.
import { describe, expect, it, vi } from "vitest";
import {
  RELATED_POSTS_LIMITS,
  RelatedPostsSaveError,
  buildRelatedPostsConfigRow,
  saveRelatedPostsConfig,
  type RelatedPostsConfigPort,
  type RelatedPostsConfigRow,
} from "./settings";
import { RELATED_POSTS_DEFAULTS, type RelatedPostsConfig } from "@/lib/relatedPosts";

const TENANT_A = "a1111111-1111-1111-1111-111111111111";
const TENANT_B = "b2222222-2222-2222-2222-222222222222";

/** Port w pamięci - zapisuje wiersze do mapy kluczowanej tenantem. */
function makePort(
  overrides: Partial<RelatedPostsConfigPort> = {},
): RelatedPostsConfigPort & { rows: Map<string, RelatedPostsConfigRow> } {
  const rows = new Map<string, RelatedPostsConfigRow>();
  return {
    rows,
    currentTenantId: async () => ({ tenantId: TENANT_A, error: null }),
    upsert: async (row) => {
      rows.set(row.tenant_id, row);
      return { savedTenantIds: [row.tenant_id], error: null };
    },
    ...overrides,
  };
}

describe("buildRelatedPostsConfigRow", () => {
  it("pins the tenant onto the row", () => {
    const row = buildRelatedPostsConfigRow(RELATED_POSTS_DEFAULTS, TENANT_A);
    expect(row.tenant_id).toBe(TENANT_A);
  });

  it("fills missing keys from the defaults", () => {
    const row = buildRelatedPostsConfigRow({ items_limit: 4 }, TENANT_A);
    expect(row.items_limit).toBe(4);
    expect(row.layout).toBe(RELATED_POSTS_DEFAULTS.layout);
    expect(row.title_pl).toBe(RELATED_POSTS_DEFAULTS.title_pl);
  });

  it("clamps every numeric field into its allowed range", () => {
    const row = buildRelatedPostsConfigRow(
      {
        after_paragraph: -5,
        items_limit: 999,
        recency_boost_days: -1,
        slider_interval_ms: 10,
        min_score: -42,
      },
      TENANT_A,
    );
    expect(row.after_paragraph).toBe(RELATED_POSTS_LIMITS.afterParagraph.min);
    expect(row.items_limit).toBe(RELATED_POSTS_LIMITS.itemsLimit.max);
    expect(row.recency_boost_days).toBe(RELATED_POSTS_LIMITS.recencyBoostDays.min);
    expect(row.slider_interval_ms).toBe(RELATED_POSTS_LIMITS.sliderIntervalMs.min);
    expect(row.min_score).toBe(RELATED_POSTS_LIMITS.minScore.min);
  });

  it("clamps all seven engine weights to 0-10", () => {
    const row = buildRelatedPostsConfigRow(
      {
        weight_categories: -3,
        weight_tags: 99,
        weight_author: 10.6,
        weight_recency: Number.NaN,
        weight_popularity: Number.POSITIVE_INFINITY,
        weight_dwell: 5,
        weight_personalization: 0,
      },
      TENANT_A,
    );
    expect(row.weight_categories).toBe(0);
    expect(row.weight_tags).toBe(10);
    expect(row.weight_author).toBe(10);
    // NaN / Infinity are not numbers we can clamp - fall back to the default.
    expect(row.weight_recency).toBe(RELATED_POSTS_DEFAULTS.weight_recency);
    expect(row.weight_popularity).toBe(RELATED_POSTS_DEFAULTS.weight_popularity);
    expect(row.weight_dwell).toBe(5);
    expect(row.weight_personalization).toBe(0);
  });

  it("rejects out-of-enum position / layout / strategy values", () => {
    const row = buildRelatedPostsConfigRow(
      {
        position: "nowhere" as RelatedPostsConfig["position"],
        layout: "carousel" as RelatedPostsConfig["layout"],
        source_strategy: "magic" as RelatedPostsConfig["source_strategy"],
        columns: 7 as RelatedPostsConfig["columns"],
      },
      TENANT_A,
    );
    expect(row.position).toBe(RELATED_POSTS_DEFAULTS.position);
    expect(row.layout).toBe(RELATED_POSTS_DEFAULTS.layout);
    expect(row.source_strategy).toBe(RELATED_POSTS_DEFAULTS.source_strategy);
    expect(row.columns).toBe(RELATED_POSTS_DEFAULTS.columns);
  });

  it("keeps every valid enum value untouched", () => {
    for (const layout of ["grid", "list", "slider", "cards", "magazine", "timeline"] as const) {
      expect(buildRelatedPostsConfigRow({ layout }, TENANT_A).layout).toBe(layout);
    }
    for (const columns of [2, 3, 4] as const) {
      expect(buildRelatedPostsConfigRow({ columns }, TENANT_A).columns).toBe(columns);
    }
  });

  it("trims titles, caps their length and falls back when blank", () => {
    const row = buildRelatedPostsConfigRow(
      { title_pl: "  Zobacz też  ", title_en: "   " },
      TENANT_A,
    );
    expect(row.title_pl).toBe("Zobacz też");
    expect(row.title_en).toBe(RELATED_POSTS_DEFAULTS.title_en);
    expect(buildRelatedPostsConfigRow({ title_pl: "x".repeat(500) }, TENANT_A).title_pl).toHaveLength(
      200,
    );
  });

  it("coerces booleans strictly (no truthy strings sneaking through)", () => {
    const row = buildRelatedPostsConfigRow(
      {
        enabled: "yes" as unknown as boolean,
        show_cover: 1 as unknown as boolean,
        use_idf: false,
      },
      TENANT_A,
    );
    expect(row.enabled).toBe(false);
    expect(row.show_cover).toBe(false);
    expect(row.use_idf).toBe(false);
  });

  it("produces a row whose keys match the config surface exactly", () => {
    const row = buildRelatedPostsConfigRow(RELATED_POSTS_DEFAULTS, TENANT_A);
    const expected = new Set([...Object.keys(RELATED_POSTS_DEFAULTS), "tenant_id"]);
    expect(new Set(Object.keys(row))).toEqual(expected);
  });
});

describe("saveRelatedPostsConfig", () => {
  it("upserts the normalised row for the caller's own tenant", async () => {
    const port = makePort();
    const saved = await saveRelatedPostsConfig(port, { ...RELATED_POSTS_DEFAULTS, items_limit: 8 });
    expect(saved.tenant_id).toBe(TENANT_A);
    expect(port.rows.get(TENANT_A)?.items_limit).toBe(8);
  });

  it("returns the NORMALISED row, not the raw draft", async () => {
    const saved = await saveRelatedPostsConfig(makePort(), { items_limit: 999 });
    expect(saved.items_limit).toBe(RELATED_POSTS_LIMITS.itemsLimit.max);
  });

  it("throws `not_persisted` when the write matched no row (the reported bug)", async () => {
    // Exactly what UPDATE + neq did: the database reports success, zero rows.
    const port = makePort({ upsert: async () => ({ savedTenantIds: [], error: null }) });
    await expect(saveRelatedPostsConfig(port, RELATED_POSTS_DEFAULTS)).rejects.toMatchObject({
      name: "RelatedPostsSaveError",
      reason: "not_persisted",
    });
  });

  it("throws `not_persisted` when the write landed on a DIFFERENT tenant", async () => {
    // Tenant isolation backstop: a confirmation for someone else's row is NOT
    // a confirmation for ours.
    const port = makePort({ upsert: async () => ({ savedTenantIds: [TENANT_B], error: null }) });
    await expect(saveRelatedPostsConfig(port, RELATED_POSTS_DEFAULTS)).rejects.toMatchObject({
      reason: "not_persisted",
    });
  });

  it("throws `no_tenant` when there is no workspace in context", async () => {
    const port = makePort({ currentTenantId: async () => ({ tenantId: null, error: null }) });
    await expect(saveRelatedPostsConfig(port, RELATED_POSTS_DEFAULTS)).rejects.toMatchObject({
      reason: "no_tenant",
    });
  });

  it("throws `tenant_lookup_failed` and never writes when the tenant lookup errors", async () => {
    const upsert = vi.fn();
    const port = makePort({
      currentTenantId: async () => ({ tenantId: null, error: "rpc down" }),
      upsert,
    });
    await expect(saveRelatedPostsConfig(port, RELATED_POSTS_DEFAULTS)).rejects.toMatchObject({
      reason: "tenant_lookup_failed",
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("throws `write_failed` carrying the database message", async () => {
    const port = makePort({
      upsert: async () => ({ savedTenantIds: [], error: "permission denied for table" }),
    });
    const error = await saveRelatedPostsConfig(port, RELATED_POSTS_DEFAULTS).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RelatedPostsSaveError);
    expect((error as RelatedPostsSaveError).reason).toBe("write_failed");
    expect((error as RelatedPostsSaveError).cause).toBe("permission denied for table");
  });

  it("never sends a tenant_id other than the one it resolved", async () => {
    const seen: string[] = [];
    const port = makePort({
      upsert: async (row) => {
        seen.push(row.tenant_id);
        return { savedTenantIds: [row.tenant_id], error: null };
      },
    });
    // A draft that tries to smuggle a foreign tenant must not influence the row.
    await saveRelatedPostsConfig(port, {
      ...RELATED_POSTS_DEFAULTS,
      ...({ tenant_id: TENANT_B } as Partial<RelatedPostsConfig>),
    });
    expect(seen).toEqual([TENANT_A]);
  });
});
