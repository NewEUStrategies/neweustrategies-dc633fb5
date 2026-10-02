// Historia rewizji `site_settings` (`useSiteSettingsRevisions`) - do tego pliku
// 9 z 11 linii na zerze: jedyny konsument z testem (`SiteSettingsHistoryDialog`)
// zastępuje hook atrapą.
//
// PRZEDMIOT DOWODU - to, na czym operator wybiera wersję do PRZYWRÓCENIA:
//   * odczyt jest zawężony do JEDNEGO klucza, najnowsze najpierw, z limitem;
//   * autor rewizji jest dociągany JEDNYM zapytaniem, bez duplikatów i bez
//     pytania o profile, gdy rewizje nie mają autorów;
//   * odmowa odczytu rewizji jest błędem zapytania, nie pustą historią
//     (pusta historia = „nie ma czego przywrócić" - fałszywie uspokaja);
//   * brak profilu autora (usunięte konto) degraduje do `null`, nie wywraca listy.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({ db: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
  },
}));

import { useSiteSettingsRevisions } from "@/lib/admin/useSiteSettingsRevisions";

const ANNA = "11111111-1111-4111-8111-111111111111";
const PIOTR = "22222222-2222-4222-8222-222222222222";

function revision(id: string, changedBy: string | null) {
  return {
    id,
    key: "theme_options",
    value: { primary: id },
    changed_by: changedBy,
    changed_at: `2026-06-0${id.slice(-1)}T10:00:00.000Z`,
    operation: "update",
    note: null,
  };
}

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
  return h.db;
}

beforeEach(() => {
  h.db = supabaseFromStub();
});

describe("useSiteSettingsRevisions", () => {
  it("czyta rewizje JEDNEGO klucza, najnowsze najpierw, z podanym limitem", async () => {
    db().setResponse("site_settings_revisions", ok([]));
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useSiteSettingsRevisions("theme_options", 10),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const chain = db().lastChain("site_settings_revisions");
    expect(chain?.argsOf("eq")).toEqual(["key", "theme_options"]);
    expect(chain?.argsOf("order")).toEqual(["changed_at", { ascending: false }]);
    expect(chain?.argsOf("limit")).toEqual([10]);
    expect(result.current.data).toEqual([]);
    // Klucz cache niesie klucz ustawienia i limit - dwa okna nie dzielą wyniku.
    expect(queryClient.getQueryData(["site_settings_revisions", "theme_options", 10])).toEqual([]);
    // Bez autorów nie ma o kogo pytać.
    expect(db().chainsFor("profiles")).toHaveLength(0);
  });

  it("domyślny limit to 50", async () => {
    db().setResponse("site_settings_revisions", ok(null));
    const { result } = renderHookWithQueryClient(() =>
      useSiteSettingsRevisions("cookie_banner_config"),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db().lastChain("site_settings_revisions")?.argsOf("limit")).toEqual([50]);
    expect(result.current.data).toEqual([]);
  });

  it("dociąga autorów JEDNYM zapytaniem bez duplikatów i dokleja nazwę oraz awatar", async () => {
    db().setResponse(
      "site_settings_revisions",
      ok([revision("r3", ANNA), revision("r2", PIOTR), revision("r1", ANNA), revision("r0", null)]),
    );
    db().setResponse(
      "profiles",
      ok([
        { id: ANNA, display_name: "Anna Kowalska", avatar_url: "https://cdn.example.com/a.png" },
        { id: PIOTR, display_name: null, avatar_url: null },
      ]),
    );
    const { result } = renderHookWithQueryClient(() => useSiteSettingsRevisions("theme_options"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(db().chainsFor("profiles")).toHaveLength(1);
    expect(db().lastChain("profiles")?.argsOf("in")).toEqual(["id", [ANNA, PIOTR]]);
    expect(result.current.data?.map((r) => [r.id, r.author_name, r.author_avatar])).toEqual([
      ["r3", "Anna Kowalska", "https://cdn.example.com/a.png"],
      ["r2", null, null],
      ["r1", "Anna Kowalska", "https://cdn.example.com/a.png"],
      ["r0", null, null],
    ]);
    // Wartość rewizji i metadane przechodzą bez zmian - to z nich robi się przywrócenie.
    expect(result.current.data?.[0]).toMatchObject({
      key: "theme_options",
      value: { primary: "r3" },
      changed_by: ANNA,
      operation: "update",
      note: null,
    });
  });

  it("autor bez profilu (usunięte konto) i nieudany odczyt profili degradują do `null`", async () => {
    db().setResponse("site_settings_revisions", ok([revision("r1", ANNA)]));
    db().setResponse("profiles", fail("permission denied"));
    const { result } = renderHookWithQueryClient(() => useSiteSettingsRevisions("theme_options"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ author_name: null, author_avatar: null });
  });

  it("odmowa odczytu rewizji jest BŁĘDEM zapytania, nie pustą historią", async () => {
    db().setResponse(
      "site_settings_revisions",
      fail("permission denied for table site_settings_revisions"),
    );
    const { result } = renderHookWithQueryClient(() => useSiteSettingsRevisions("theme_options"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe(
      "permission denied for table site_settings_revisions",
    );
    expect(result.current.data).toBeUndefined();
  });
});
