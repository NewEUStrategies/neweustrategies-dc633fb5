// Zbiorcze rozwiązanie wzmianek powierzchni - `useMentionDirectory`.
//
// CO TEN PLIK DOWODZI.
// (1) JEDNO WYJŚCIE NA OSOBY. Wszystkie slugi osób idą jednym `in("slug", …)`
//     do publicznej projekcji profili - nie zapytanie na wzmiankę.
// (2) FIRMY ROZSTRZYGA SLUG. `org-<uuid>` idzie do `get_mention_target`, reszta
//     do profili; wątek bez firm nie woła RPC wcale, a wątek bez osób nie
//     pyta profili.
// (3) JEDNA FIRMA NIE ZABIERA ETYKIET RESZCIE. Błąd albo pusty wynik RPC dla
//     jednej firmy wypada z katalogu; błąd zapytania o OSOBY jest błędem
//     zapytania (katalog pusty, bez rzucania do widoku).
// (4) KLUCZ CACHE nie zależy od kolejności slugów; limit chroni URL PostgREST.
// (5) BEZ DOSTAWCY zapytań katalog jest pusty i NIC nie leci do bazy.
//
// Mapowanie wierszy na byty ma `directory.test.ts`; tu chodzi o zapytania.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const db = vi.hoisted(() => ({
  personRows: [] as Record<string, unknown>[],
  personError: null as Error | null,
  /** Odpowiedź RPC per slug firmy. */
  orgs: new Map<string, { data: unknown; error: Error | null }>(),
  fromCalls: [] as Array<{ table: string; columns: string; slugs: readonly string[] }>,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: async (_column: string, slugs: readonly string[]) => {
          db.fromCalls.push({ table, columns, slugs });
          return { data: db.personError ? null : db.personRows, error: db.personError };
        },
      }),
    }),
    rpc: async (fn: string, args: { _slug: string }) => {
      db.rpcCalls.push({ fn, args });
      return db.orgs.get(args._slug) ?? { data: [], error: null };
    },
  },
}));

import { useMentionDirectory } from "@/lib/mentions/useMentionDirectory";

const ACME_ID = "123e4567-e89b-12d3-a456-426614174000";
const ACME = `org-${ACME_ID}`;
const GLOBEX = "org-223e4567-e89b-12d3-a456-426614174000";

function wrapperWith(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  db.personRows = [];
  db.personError = null;
  db.orgs = new Map();
  db.fromCalls = [];
  db.rpcCalls = [];
});

describe("useMentionDirectory", () => {
  it("osoby jednym zapytaniem, firmy po RPC - i komplet w jednej mapie", async () => {
    db.personRows = [{ slug: "anna-nowak", display_name: "Anna Nowak", current_company: "ACME" }];
    db.orgs.set(ACME, { data: [{ id: ACME_ID, label: "ACME Polska" }], error: null });

    const { result } = renderHook(() => useMentionDirectory(["anna-nowak", ACME, "jan"], "pl"), {
      wrapper: wrapperWith(freshClient()),
    });

    await waitFor(() => expect(result.current.directory.size).toBe(2));
    expect(db.fromCalls).toHaveLength(1);
    expect(db.fromCalls[0]).toMatchObject({
      table: "profiles_public",
      slugs: ["anna-nowak", "jan"],
    });
    expect(db.fromCalls[0]?.columns).toContain("current_company");
    expect(db.rpcCalls).toEqual([{ fn: "get_mention_target", args: { _slug: ACME } }]);
    expect(result.current.directory.get("anna-nowak")).toMatchObject({
      kind: "person",
      name: "Anna Nowak",
      company: "ACME",
    });
    // Slug firmy w katalogu to slug WZMIANKI, nie samo id z RPC.
    expect(result.current.directory.get(ACME)).toMatchObject({ kind: "org", name: "ACME Polska" });
    expect(result.current.isPending).toBe(false);
  });

  it("wątek bez firm nie woła RPC, wątek bez osób nie pyta profili", async () => {
    const client = freshClient();
    const people = renderHook(() => useMentionDirectory(["anna-nowak"], "pl"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(db.fromCalls).toHaveLength(1));
    expect(db.rpcCalls).toEqual([]);
    people.unmount();

    db.orgs.set(ACME, { data: [{ id: ACME_ID, label: "ACME" }], error: null });
    const orgs = renderHook(() => useMentionDirectory([ACME], "pl"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(orgs.result.current.directory.size).toBe(1));
    expect(db.fromCalls).toHaveLength(1);
  });

  it("nieznana albo odmówiona firma wypada, reszta katalogu zostaje", async () => {
    db.orgs.set(ACME, { data: [{ id: ACME_ID, label: "ACME" }], error: null });
    db.orgs.set(GLOBEX, { data: null, error: new Error("permission denied") });
    const UNKNOWN = "org-323e4567-e89b-12d3-a456-426614174000";

    const { result } = renderHook(() => useMentionDirectory([ACME, GLOBEX, UNKNOWN], "pl"), {
      wrapper: wrapperWith(freshClient()),
    });

    await waitFor(() => expect(result.current.directory.size).toBe(1));
    expect([...result.current.directory.keys()]).toEqual([ACME]);
    expect(db.rpcCalls).toHaveLength(3);
  });

  it("błąd zapytania o osoby daje pusty katalog, nie wyjątek w widoku", async () => {
    db.personError = new Error("network");

    const { result } = renderHook(() => useMentionDirectory(["anna-nowak"], "pl"), {
      wrapper: wrapperWith(freshClient()),
    });

    await waitFor(() => expect(db.fromCalls).toHaveLength(1));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.directory.size).toBe(0);
  });

  it("ta sama treść w innej kolejności trafia w ten sam wpis cache", async () => {
    db.personRows = [{ slug: "a" }, { slug: "b" }];
    const client = freshClient();

    const first = renderHook(() => useMentionDirectory(["a", "b"], "pl"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(first.result.current.directory.size).toBe(2));
    const second = renderHook(() => useMentionDirectory(["b", "a"], "pl"), {
      wrapper: wrapperWith(client),
    });

    expect(second.result.current.directory.size).toBe(2);
    expect(db.fromCalls).toHaveLength(1);
  });

  it("język jest częścią klucza - biogram ma dwie kolumny", async () => {
    db.personRows = [{ slug: "a", bio_pl: "Polski", bio_en: "English" }];
    const client = freshClient();

    const pl = renderHook(() => useMentionDirectory(["a"], "pl"), { wrapper: wrapperWith(client) });
    const en = renderHook(() => useMentionDirectory(["a"], "en"), { wrapper: wrapperWith(client) });

    await waitFor(() => expect(en.result.current.directory.size).toBe(1));
    await waitFor(() => expect(pl.result.current.directory.size).toBe(1));
    expect(pl.result.current.directory.get("a")).toMatchObject({ bio: "Polski" });
    expect(en.result.current.directory.get("a")).toMatchObject({ bio: "English" });
  });

  it("ponad limit slugów idzie tylko pierwsze sześćdziesiąt", async () => {
    const slugs = Array.from({ length: 75 }, (_v, i) => `osoba-${String(i).padStart(2, "0")}`);

    renderHook(() => useMentionDirectory(slugs, "pl"), { wrapper: wrapperWith(freshClient()) });

    await waitFor(() => expect(db.fromCalls).toHaveLength(1));
    expect(db.fromCalls[0]?.slugs).toEqual(slugs.slice(0, 60));
  });

  it("pusta powierzchnia nie pyta o nic i nie wisi w stanie ładowania", async () => {
    const { result } = renderHook(() => useMentionDirectory([], "pl"), {
      wrapper: wrapperWith(freshClient()),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(db.fromCalls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    expect(result.current).toMatchObject({ isPending: false });
    expect(result.current.directory.size).toBe(0);
  });

  it("bez dostawcy zapytań katalog jest pusty i NIC nie leci do bazy", async () => {
    db.personRows = [{ slug: "anna-nowak" }];

    const { result } = renderHook(() => useMentionDirectory(["anna-nowak", ACME], "pl"));

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(db.fromCalls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    expect(result.current.directory.size).toBe(0);
    expect(result.current.isPending).toBe(false);
  });
});
