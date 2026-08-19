// Scalanie po zalogowaniu jest jednorazową migracją danych użytkownika z
// localStorage do tabel konta. Najważniejszy kontrakt: lokalna kopia znika
// dopiero po sukcesie, a powtórka nie tworzy duplikatów.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/chat/fixtures";
import { GUEST_SAVED_ARTICLES_KEY } from "@/lib/storageKeys";

const h = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => h.from(table) },
}));

const {
  MAX_ANON_MERGE_ITEMS,
  hasAnonPersonalization,
  mergeAnonPersonalization,
  readAnonInterestIds,
} = await import("@/lib/personalization/anonMerge");

const INTERESTS_KEY = "nes.interests.anon.v1";
const NOW = Date.parse("2026-08-19T12:00:00.000Z");
let db: SupabaseFromStub;

function seedInterests(categoryIds: unknown[], tagIds: unknown[] = []): void {
  window.localStorage.setItem(INTERESTS_KEY, JSON.stringify({ categoryIds, tagIds }));
}

function seedSaved(items: Array<{ url: string; title?: string; savedAt?: number }>): void {
  window.localStorage.setItem(
    GUEST_SAVED_ARTICLES_KEY.key,
    JSON.stringify(items.map((item) => ({ title: "Syntetyczny artykuł", ...item }))),
  );
}

function stored<T>(key: string): T {
  return JSON.parse(window.localStorage.getItem(key) ?? "null") as T;
}

function installSuccessfulDb(): void {
  db.setResponse("user_follows", ok(null));
  db.setResponse("posts", (recorded) => {
    const slugs = (recorded.argsOf("in")?.[1] ?? []) as string[];
    return ok(slugs.map((slug) => ({ id: `post-${slug}`, slug })));
  });
  db.setResponse("user_bookmarks", ok(null));
}

function queryClient(options?: { ttl?: number; reject?: boolean }) {
  const ensureQueryData = options?.reject
    ? vi.fn().mockRejectedValue(new Error("settings offline"))
    : vi.fn().mockResolvedValue({
        personalized_system: { guestExpirationDays: options?.ttl ?? 14 },
      });
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  return {
    client: { ensureQueryData, invalidateQueries } as unknown as QueryClient,
    ensureQueryData,
    invalidateQueries,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  db = supabaseFromStub();
  h.from.mockReset().mockImplementation((table: string) => db.from(table));
  installSuccessfulDb();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("odczyt danych anonimowych", () => {
  it("zwraca kategorie i tagi bez duplikatów", () => {
    seedInterests(["cat-1", "cat-1", 42], ["tag-1", "tag-1", null]);

    expect(readAnonInterestIds()).toEqual({ categoryIds: ["cat-1"], tagIds: ["tag-1"] });
    expect(hasAnonPersonalization()).toBe(true);
  });

  it("uszkodzony JSON nie wywraca logowania", async () => {
    window.localStorage.setItem(INTERESTS_KEY, "{nie-json");
    window.localStorage.setItem(GUEST_SAVED_ARTICLES_KEY.key, "{też-nie-json");

    expect(readAnonInterestIds()).toEqual({ categoryIds: [], tagIds: [] });
    expect(hasAnonPersonalization()).toBe(false);
    await expect(mergeAnonPersonalization("user-1")).resolves.toEqual({
      mergedInterests: 0,
      mergedBookmarks: 0,
    });
    expect(db.chains).toHaveLength(0);
  });

  it("brak obiektu window zachowuje się jak pusty magazyn", async () => {
    vi.stubGlobal("window", undefined);

    expect(readAnonInterestIds()).toEqual({ categoryIds: [], tagIds: [] });
    expect(hasAnonPersonalization()).toBe(false);
    await expect(mergeAnonPersonalization("user-1")).resolves.toEqual({
      mergedInterests: 0,
      mergedBookmarks: 0,
    });
  });
});

describe("mergeAnonPersonalization", () => {
  it("scala zainteresowania i zakładkę bez kolizji", async () => {
    seedInterests(["cat-1"], ["tag-1"]);
    seedSaved([{ url: "/post/alpha", savedAt: NOW }]);

    const result = await mergeAnonPersonalization("user-1");

    expect(result).toEqual({ mergedInterests: 2, mergedBookmarks: 1 });
    expect(db.lastChain("user_follows")?.argsOf("upsert")?.[0]).toEqual([
      { user_id: "user-1", target_type: "category", target_id: "cat-1" },
      { user_id: "user-1", target_type: "tag", target_id: "tag-1" },
    ]);
    expect(db.lastChain("user_bookmarks")?.argsOf("upsert")?.[0]).toEqual([
      { user_id: "user-1", entity_type: "post", entity_id: "post-alpha" },
    ]);
    expect(stored(INTERESTS_KEY)).toEqual({ categoryIds: [], tagIds: [] });
    expect(stored(GUEST_SAVED_ARTICLES_KEY.key)).toEqual([]);
  });

  it("duplikaty lokalne nie powodują podwójnego zapisu", async () => {
    seedInterests(["cat-1", "cat-1"], ["tag-1", "tag-1"]);
    seedSaved([
      { url: "/post/alpha", savedAt: NOW },
      { url: "/post/alpha", savedAt: NOW - 1 },
    ]);

    const result = await mergeAnonPersonalization("user-1");

    expect(result).toEqual({ mergedInterests: 2, mergedBookmarks: 1 });
    expect(db.lastChain("user_follows")?.argsOf("upsert")?.[0] as unknown[]).toHaveLength(2);
    expect(db.lastChain("user_bookmarks")?.argsOf("upsert")?.[0] as unknown[]).toHaveLength(1);
  });

  it("istniejące dane konta wygrywają, a gość tylko uzupełnia brakujące", async () => {
    seedInterests(["cat-existing", "cat-new"]);
    seedSaved([{ url: "/post/existing", savedAt: NOW }]);

    await mergeAnonPersonalization("user-1");

    expect(db.lastChain("user_follows")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "user_id,target_type,target_id",
      ignoreDuplicates: true,
    });
    expect(db.lastChain("user_bookmarks")?.argsOf("upsert")?.[1]).toEqual({
      onConflict: "user_id,entity_type,entity_id",
      ignoreDuplicates: true,
    });
    expect(db.lastChain("user_follows")?.has("delete")).toBe(false);
  });

  it("gość bez danych nie wykonuje żadnego zapytania", async () => {
    const result = await mergeAnonPersonalization("user-empty");

    expect(result).toEqual({ mergedInterests: 0, mergedBookmarks: 0 });
    expect(db.chains).toHaveLength(0);
    expect(hasAnonPersonalization()).toBe(false);
  });

  it("odrzuca wpis po TTL, lecz scala świeży", async () => {
    seedSaved([
      { url: "/post/expired", savedAt: NOW - 8 * 86_400_000 },
      { url: "/post/fresh", savedAt: NOW - 2 * 86_400_000 },
    ]);
    const qc = queryClient({ ttl: 7 });

    const result = await mergeAnonPersonalization("user-1", qc.client);

    expect(result).toEqual({ mergedInterests: 0, mergedBookmarks: 1 });
    expect(db.lastChain("posts")?.argsOf("in")).toEqual(["slug", ["fresh"]]);
    expect(stored(GUEST_SAVED_ARTICLES_KEY.key)).toEqual([]);
    expect(qc.ensureQueryData).toHaveBeenCalledTimes(1);
  });

  it("wartość TTL spoza zakresu wyłącza wygasanie", async () => {
    seedSaved([{ url: "/post/legacy", savedAt: NOW - 365 * 86_400_000 }]);
    const qc = queryClient({ ttl: 0 });

    const result = await mergeAnonPersonalization("user-1", qc.client);

    expect(result.mergedBookmarks).toBe(1);
    expect(db.lastChain("posts")?.argsOf("in")).toEqual(["slug", ["legacy"]]);
    expect(stored(GUEST_SAVED_ARTICLES_KEY.key)).toEqual([]);
  });

  it("błąd ustawień korzysta z domyślnego TTL i nie blokuje logowania", async () => {
    seedSaved([{ url: "/post/fresh", savedAt: NOW }]);
    const qc = queryClient({ reject: true });

    const result = await mergeAnonPersonalization("user-1", qc.client);

    expect(result.mergedBookmarks).toBe(1);
    expect(qc.ensureQueryData).toHaveBeenCalledTimes(1);
    expect(qc.invalidateQueries).toHaveBeenCalled();
  });

  it("nieznany slug pozostaje na urządzeniu", async () => {
    seedSaved([
      { url: "/post/found", savedAt: NOW },
      { url: "/", savedAt: NOW },
    ]);

    const result = await mergeAnonPersonalization("user-1");

    expect(result.mergedBookmarks).toBe(1);
    expect(stored<Array<{ url: string }>>(GUEST_SAVED_ARTICLES_KEY.key)).toEqual([
      expect.objectContaining({ url: "/" }),
    ]);
    expect(db.lastChain("user_bookmarks")?.has("upsert")).toBe(true);
  });

  it("brak rozwiązanego posta zachowuje wszystkie zakładki", async () => {
    seedSaved([{ url: "/post/missing", savedAt: NOW }]);
    db.setResponse("posts", ok([]));

    const result = await mergeAnonPersonalization("user-1");

    expect(result.mergedBookmarks).toBe(0);
    expect(stored<Array<{ url: string }>>(GUEST_SAVED_ARTICLES_KEY.key)).toHaveLength(1);
    expect(db.chainsFor("user_bookmarks")).toHaveLength(0);
  });

  it("błąd rozwiązywania sluga zachowuje lokalną kopię", async () => {
    seedSaved([{ url: "/post/alpha", savedAt: NOW }]);
    db.setResponse("posts", fail("posts offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await mergeAnonPersonalization("user-1");

    expect(result.mergedBookmarks).toBe(0);
    expect(stored<Array<{ url: string }>>(GUEST_SAVED_ARTICLES_KEY.key)).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      "[anonMerge] bookmark slug resolution failed",
      "posts offline",
    );
  });

  it("nieudany zapis zachowuje dane, a kolejna runda scala je dokładnie raz", async () => {
    seedInterests(["cat-1"], ["tag-1"]);
    seedSaved([{ url: "/post/alpha", savedAt: NOW }]);
    db.setResponse("user_follows", fail("follows offline"));
    db.setResponse("user_bookmarks", fail("bookmarks offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failed = await mergeAnonPersonalization("user-1");

    expect(failed).toEqual({ mergedInterests: 0, mergedBookmarks: 0 });
    expect(stored<{ categoryIds: string[] }>(INTERESTS_KEY).categoryIds).toEqual(["cat-1"]);
    expect(stored<Array<{ url: string }>>(GUEST_SAVED_ARTICLES_KEY.key)).toHaveLength(1);

    db.reset();
    installSuccessfulDb();
    const succeeded = await mergeAnonPersonalization("user-1");

    expect(succeeded).toEqual({ mergedInterests: 2, mergedBookmarks: 1 });
    expect(stored(INTERESTS_KEY)).toEqual({ categoryIds: [], tagIds: [] });
    expect(stored(GUEST_SAVED_ARTICLES_KEY.key)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("ogranicza każdą migrację do 200 pozycji", async () => {
    seedInterests(Array.from({ length: MAX_ANON_MERGE_ITEMS + 5 }, (_, index) => `cat-${index}`));
    seedSaved(
      Array.from({ length: MAX_ANON_MERGE_ITEMS + 5 }, (_, index) => ({
        url: `/post/article-${index}`,
        savedAt: NOW,
      })),
    );

    const result = await mergeAnonPersonalization("user-1");

    expect(result).toEqual({
      mergedInterests: MAX_ANON_MERGE_ITEMS,
      mergedBookmarks: MAX_ANON_MERGE_ITEMS,
    });
    expect(db.lastChain("posts")?.argsOf("in")?.[1] as unknown[]).toHaveLength(
      MAX_ANON_MERGE_ITEMS,
    );
    expect(db.lastChain("user_follows")?.argsOf("upsert")?.[0] as unknown[]).toHaveLength(
      MAX_ANON_MERGE_ITEMS,
    );
  });

  it("unieważnia wszystkie rodziny cache po skutecznym scaleniu", async () => {
    seedInterests(["cat-1"]);
    seedSaved([{ url: "/post/alpha", savedAt: NOW }]);
    const qc = queryClient();

    await mergeAnonPersonalization("user-1", qc.client);

    const keys = qc.invalidateQueries.mock.calls.map((call) => call[0].queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["my-interests"],
        ["follows"],
        ["bookmarks"],
        ["profile-counts"],
        ["followed-feed"],
      ]),
    );
    expect(keys).toHaveLength(6);
  });

  it("dwa równoległe wywołania wykonują jedną migrację", async () => {
    seedInterests(["cat-1"]);
    const qc = queryClient();
    let release!: (value: Record<string, unknown>) => void;
    qc.ensureQueryData.mockImplementationOnce(
      () => new Promise<Record<string, unknown>>((resolve) => (release = resolve)),
    );

    const first = mergeAnonPersonalization("user-1", qc.client);
    const second = mergeAnonPersonalization("user-1", qc.client);
    release({ personalized_system: { guestExpirationDays: 14 } });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { mergedInterests: 1, mergedBookmarks: 0 },
      { mergedInterests: 1, mergedBookmarks: 0 },
    ]);
    expect(db.chainsFor("user_follows")).toHaveLength(1);
    expect(qc.ensureQueryData).toHaveBeenCalledTimes(1);
  });

  it("błąd zapisu localStorage nie przerywa zakończonego merge'u", async () => {
    seedInterests(["cat-1"]);
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const result = await mergeAnonPersonalization("user-1");

    expect(result.mergedInterests).toBe(1);
    expect(setItem).toHaveBeenCalled();
    expect(window.localStorage.getItem(INTERESTS_KEY)).not.toBeNull();
  });
});
