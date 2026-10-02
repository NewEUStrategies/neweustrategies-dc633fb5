// Warstwy danych panelu wołane KLIENTEM (pod RLS), które do tego pliku stały
// na zerze: biblioteka materiałów członkowskich (`library.ts`), odznaki
// profilu (`badges.ts`), klient podszywania super admina (`impersonation.ts`)
// i wspólne toasty (`adminToasts.ts`). Konsumenci w testach tras mockują je
// w całości, więc ich własne reguły nie były wykonywane ani razu.
//
// NAPRAWY TEJ KAMPANII PRZYPIĘTE NIŻEJ:
//   * `deleteResource` usuwał PLIK przed WIERSZEM - odmowa usunięcia wiersza
//     zostawiała w bibliotece materiał z martwym plikiem;
//   * `stopImpersonation` nie czytał wyniku `setSession` (który nie rzuca) -
//     nieudany powrót zostawiał przeglądarkę zalogowaną jako podszywana osoba,
//     bez banera.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabaseChain";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  session: null as null | { access_token: string; refresh_token: string; user: { id: string } },
  rpc: [] as { name: string; args: unknown }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  storageCalls: [] as { op: string; bucket: string; args: unknown[] }[],
  uploadError: null as unknown,
  verifyOtpError: null as null | { message: string },
  setSessionResult: { error: null } as { error: null | { message: string } } | "throw",
  authCalls: [] as { op: string; args: unknown }[],
  startResult: { sessionId: "sess-1", tokenHash: "hash-1" },
  startError: null as Error | null,
  endCalls: [] as unknown[],
  endFails: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
      return h.db.from(table);
    },
    rpc: async (name: string, args: unknown) => {
      h.rpc.push({ name, args });
      return h.rpcResult;
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (...args: unknown[]) => {
          h.storageCalls.push({ op: "upload", bucket, args });
          return { data: null, error: h.uploadError };
        },
        remove: async (...args: unknown[]) => {
          h.storageCalls.push({ op: "remove", bucket, args });
          return { data: null, error: null };
        },
      }),
    },
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      verifyOtp: async (args: unknown) => {
        h.authCalls.push({ op: "verifyOtp", args });
        return { data: null, error: h.verifyOtpError };
      },
      setSession: async (args: unknown) => {
        h.authCalls.push({ op: "setSession", args });
        if (h.setSessionResult === "throw") throw new Error("network down");
        return { data: null, ...h.setSessionResult };
      },
      signOut: async (args: unknown) => {
        h.authCalls.push({ op: "signOut", args });
        return { error: null };
      },
    },
  },
}));

vi.mock("@/lib/admin/impersonation.functions", () => ({
  startImpersonation: async () => {
    if (h.startError) throw h.startError;
    return h.startResult;
  },
  endImpersonation: async (input: unknown) => {
    h.endCalls.push(input);
    if (h.endFails) throw new Error("end failed");
    return { ok: true };
  },
}));

import i18n from "@/lib/i18n";
import { adminToast } from "@/lib/adminToasts";
import { fetchBadges, grantBadge, revokeBadge, revokeUserBadge } from "@/lib/admin/badges";
import {
  RESOURCE_BUCKET,
  createResource,
  deleteResource,
  fetchAdminResources,
  removeResourceObject,
  updateResource,
  uploadResourceFile,
  type ResourceInput,
} from "@/lib/admin/library";
import {
  getImpersonationState,
  impersonateUser,
  stopImpersonation,
} from "@/lib/admin/impersonation";
import { IMPERSONATION_STORAGE_KEY } from "@/lib/storageKeys";

const USER = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function db(): SupabaseFromStub {
  if (!h.db) throw new Error("test: atrapa bazy nieustawiona");
  return h.db;
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.session = { access_token: "admin-at", refresh_token: "admin-rt", user: { id: USER } };
  h.rpc = [];
  h.rpcResult = { data: null, error: null };
  h.storageCalls = [];
  h.uploadError = null;
  h.verifyOtpError = null;
  h.setSessionResult = { error: null };
  h.authCalls = [];
  h.startError = null;
  h.endCalls = [];
  h.endFails = false;
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// Biblioteka materiałów członkowskich
// ---------------------------------------------------------------------------

describe("library - biblioteka materiałów członkowskich", () => {
  const INPUT: ResourceInput = {
    title_pl: "Raport",
    title_en: "Report",
    description_pl: null,
    description_en: null,
    category: "report",
    file_path: `${TENANT}/${USER}/1-raport.pdf`,
    file_name: "raport.pdf",
    file_size: 1024,
    mime_type: "application/pdf",
    min_tier_rank: 10,
    published: true,
    sort_order: 0,
  };

  it("lista: kolejność ręczna, potem najnowsze; limit 500; odmowa = błąd", async () => {
    db().setResponse("member_resources", ok([{ id: "r-1" }]));
    await expect(fetchAdminResources()).resolves.toEqual([{ id: "r-1" }]);
    const chain = db().lastChain("member_resources");
    expect(chain?.calls.filter((c) => c.method === "order").map((c) => c.args)).toEqual([
      ["sort_order", { ascending: true }],
      ["created_at", { ascending: false }],
    ]);
    expect(chain?.argsOf("limit")).toEqual([500]);

    db().setResponse("member_resources", ok(null));
    await expect(fetchAdminResources()).resolves.toEqual([]);
    db().setResponse("member_resources", fail("permission denied"));
    await expect(fetchAdminResources()).rejects.toThrow("permission denied");
  });

  it("upload: ścieżka zaczyna się od NAJEMCY i osoby, nazwa pliku jest oczyszczona", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
    db().setResponse("profiles", ok({ tenant_id: TENANT }));
    const file = new File(["%PDF"], "Raport roczny (2026)!.pdf", { type: "application/pdf" });
    await expect(uploadResourceFile(file)).resolves.toEqual({
      path: `${TENANT}/${USER}/1750000000000-Raport_roczny_2026_.pdf`,
      size: 4,
    });
    expect(h.storageCalls).toEqual([
      {
        op: "upload",
        bucket: RESOURCE_BUCKET,
        args: [
          `${TENANT}/${USER}/1750000000000-Raport_roczny_2026_.pdf`,
          file,
          { upsert: false, contentType: "application/pdf" },
        ],
      },
    ]);
    vi.restoreAllMocks();
  });

  it("upload: nazwa z samych znaków specjalnych staje się `_`, brak typu - bez contentType", async () => {
    db().setResponse("profiles", ok({ tenant_id: TENANT }));
    const file = new File(["x"], "", { type: "" });
    const { path } = await uploadResourceFile(file);
    expect(path).toMatch(new RegExp(`^${TENANT}/${USER}/\\d+-file$`));
    expect((h.storageCalls[0].args[2] as { contentType?: string }).contentType).toBeUndefined();
  });

  it("upload: bez sesji, bez najemcy, z odmową profilu albo bucketu - błąd i nic w buckecie", async () => {
    const file = new File(["x"], "a.pdf");
    h.session = null;
    await expect(uploadResourceFile(file)).rejects.toThrow("Not authenticated");

    h.session = { access_token: "a", refresh_token: "r", user: { id: USER } };
    db().setResponse("profiles", ok({ tenant_id: null }));
    await expect(uploadResourceFile(file)).rejects.toThrow("Missing tenant for current user");

    db().setResponse("profiles", fail("permission denied"));
    await expect(uploadResourceFile(file)).rejects.toThrow("permission denied");
    expect(h.storageCalls).toHaveLength(0);

    db().setResponse("profiles", ok({ tenant_id: TENANT }));
    h.uploadError = new Error("Payload too large");
    await expect(uploadResourceFile(file)).rejects.toThrow("Payload too large");
  });

  it("tworzenie dopisuje autora z sesji; aktualizacja zawęża do id; odmowy są błędami", async () => {
    db().setResponse("member_resources", ok({ id: "r-1" }));
    await expect(createResource(INPUT)).resolves.toEqual({ id: "r-1" });
    expect(db().lastChain("member_resources")?.argsOf("insert")).toEqual([
      { ...INPUT, created_by: USER },
    ]);

    await updateResource("r-1", { published: false });
    const update = db().lastChain("member_resources");
    expect(update?.argsOf("update")).toEqual([{ published: false }]);
    expect(update?.argsOf("eq")).toEqual(["id", "r-1"]);

    db().setResponse("member_resources", fail("duplicate key"));
    await expect(createResource(INPUT)).rejects.toThrow("duplicate key");
    await expect(updateResource("r-1", {})).rejects.toThrow("duplicate key");
  });

  it("usunięcie obiektu pojedynczego idzie do prywatnego bucketu", async () => {
    await removeResourceObject("t/u/x.pdf");
    expect(h.storageCalls).toEqual([
      { op: "remove", bucket: RESOURCE_BUCKET, args: [["t/u/x.pdf"]] },
    ]);
  });

  it("NAPRAWA: usunięcie materiału kasuje NAJPIERW wiersz, potem plik", async () => {
    const order: string[] = [];
    db().setResponse("member_resources", () => {
      order.push("row");
      return ok(null);
    });
    const remove = h.storageCalls;
    await deleteResource("r-1", "t/u/x.pdf");
    order.push(...remove.map((call) => call.op));
    expect(order).toEqual(["row", "remove"]);
    expect(db().lastChain("member_resources")?.has("delete")).toBe(true);
  });

  it("NAPRAWA: odmowa usunięcia wiersza zostawia plik w buckecie - materiał nie zostaje z martwym plikiem", async () => {
    db().setResponse("member_resources", fail("permission denied"));
    await expect(deleteResource("r-1", "t/u/x.pdf")).rejects.toThrow("permission denied");
    expect(h.storageCalls).toHaveLength(0);
  });

  it("materiał bez pliku: tylko wiersz", async () => {
    db().setResponse("member_resources", ok(null));
    await deleteResource("r-1", null);
    expect(h.storageCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Odznaki profilu
// ---------------------------------------------------------------------------

describe("badges - odznaki profilu w panelu", () => {
  it("lista: limit przycięty do 1-500, wiersze o nieznanej odznace albo źródle są odrzucane", async () => {
    h.rpcResult = {
      data: [
        { id: "b-1", badge: "expert", grant_source: "manual" },
        { id: "b-2", badge: "nie-istnieje", grant_source: "manual" },
        { id: "b-3", badge: "expert", grant_source: "hack" },
      ],
      error: null,
    };
    const rows = await fetchBadges(9999);
    expect(h.rpc.at(-1)).toEqual({ name: "admin_list_profile_badges", args: { p_limit: 500 } });
    expect(rows.map((row) => row.id)).toEqual(["b-1"]);

    await fetchBadges(0);
    expect(h.rpc.at(-1)?.args).toEqual({ p_limit: 1 });
    await fetchBadges(12.9);
    expect(h.rpc.at(-1)?.args).toEqual({ p_limit: 12 });
    await fetchBadges();
    expect(h.rpc.at(-1)?.args).toEqual({ p_limit: 300 });

    h.rpcResult = { data: null, error: null };
    await expect(fetchBadges()).resolves.toEqual([]);
    h.rpcResult = { data: null, error: new Error("permission denied") };
    await expect(fetchBadges()).rejects.toThrow("permission denied");
  });

  it("nadanie: UUID przycięty, notatka przycięta albo pominięta, wynik bazy jest wymagany", async () => {
    h.rpcResult = { data: "badge-id", error: null };
    await expect(grantBadge(`  ${TARGET}  `, "expert", "  za raport  ")).resolves.toBe("badge-id");
    expect(h.rpc.at(-1)).toEqual({
      name: "admin_grant_profile_badge",
      args: { p_user_id: TARGET, p_badge: "expert", p_note: "za raport" },
    });
    await grantBadge(TARGET, "expert", "   ");
    expect((h.rpc.at(-1)?.args as { p_note?: string }).p_note).toBeUndefined();

    h.rpcResult = { data: null, error: null };
    await expect(grantBadge(TARGET, "expert")).rejects.toThrow("Badge grant was not persisted");
    h.rpcResult = { data: null, error: new Error("not_authorized") };
    await expect(grantBadge(TARGET, "expert")).rejects.toThrow("not_authorized");
  });

  it("nadanie odrzuca bez pytania bazy: zły UUID, nieznaną odznakę i notatkę ponad 500 znaków", async () => {
    await expect(grantBadge("nie-uuid", "expert")).rejects.toThrow("userId: invalid UUID");
    await expect(
      grantBadge(TARGET, "nieznana" as Parameters<typeof grantBadge>[1]),
    ).rejects.toThrow("Unsupported badge kind");
    await expect(grantBadge(TARGET, "expert", "x".repeat(501))).rejects.toThrow(
      "Badge note cannot exceed 500 characters",
    );
    expect(h.rpc).toHaveLength(0);
  });

  it("cofnięcie po id i po (osoba, odznaka): brak wiersza w najemcy to błąd, nie cichy sukces", async () => {
    h.rpcResult = { data: true, error: null };
    await revokeBadge(TARGET);
    expect(h.rpc.at(-1)).toEqual({
      name: "admin_revoke_profile_badge",
      args: { p_badge_id: TARGET },
    });
    await revokeUserBadge(TARGET, "expert");
    expect(h.rpc.at(-1)).toEqual({
      name: "admin_revoke_user_profile_badge",
      args: { p_user_id: TARGET, p_badge: "expert" },
    });

    h.rpcResult = { data: false, error: null };
    await expect(revokeBadge(TARGET)).rejects.toThrow("Badge was not found in the active tenant");
    await expect(revokeUserBadge(TARGET, "expert")).rejects.toThrow(
      "Badge was not found in the active tenant",
    );
    h.rpcResult = { data: null, error: new Error("not_authorized") };
    await expect(revokeBadge(TARGET)).rejects.toThrow("not_authorized");
    await expect(revokeUserBadge(TARGET, "expert")).rejects.toThrow("not_authorized");

    await expect(revokeBadge("x")).rejects.toThrow("badgeId: invalid UUID");
    await expect(
      revokeUserBadge(TARGET, "nieznana" as Parameters<typeof revokeUserBadge>[1]),
    ).rejects.toThrow("Unsupported badge kind");
  });
});

// ---------------------------------------------------------------------------
// Klient podszywania super admina
// ---------------------------------------------------------------------------

describe("impersonation - klient podszywania", () => {
  function storedState(): unknown {
    const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY.key);
    return raw === null ? null : JSON.parse(raw);
  }

  it("start: wymienia sesję tokenem jednorazowym i zapamiętuje sesję super admina", async () => {
    await impersonateUser(TARGET, "Anna Kowalska");
    expect(h.authCalls).toEqual([
      { op: "verifyOtp", args: { token_hash: "hash-1", type: "magiclink" } },
    ]);
    expect(storedState()).toEqual({
      sessionId: "sess-1",
      targetUserId: TARGET,
      targetLabel: "Anna Kowalska",
      original: { access_token: "admin-at", refresh_token: "admin-rt" },
    });
    expect(getImpersonationState()).toEqual(storedState());
  });

  it("start bez sesji - błąd, zanim cokolwiek trafi na serwer", async () => {
    h.session = null;
    await expect(impersonateUser(TARGET, "x")).rejects.toThrow(/Brak aktywnej sesji/);
    expect(h.authCalls).toHaveLength(0);
    expect(storedState()).toBeNull();
  });

  it("odmowa tokenu: audyt jest zamykany, stan NIE jest zapisywany, błąd idzie dalej", async () => {
    h.verifyOtpError = { message: "Token has expired" };
    h.endFails = true;
    await expect(impersonateUser(TARGET, "x")).rejects.toThrow("Token has expired");
    expect(h.endCalls).toEqual([{ data: { sessionId: "sess-1" } }]);
    expect(storedState()).toBeNull();
  });

  it("odmowa serwera przy starcie przechodzi wprost", async () => {
    h.startError = new Error("Forbidden");
    await expect(impersonateUser(TARGET, "x")).rejects.toThrow("Forbidden");
  });

  it("stan zepsuty w magazynie czyta się jak brak podszywania", () => {
    sessionStorage.setItem(IMPERSONATION_STORAGE_KEY.key, "{nie-json");
    expect(getImpersonationState()).toBeNull();
  });

  it("wyjście bez stanu nie robi niczego", async () => {
    await stopImpersonation();
    expect(h.authCalls).toHaveLength(0);
    expect(h.endCalls).toHaveLength(0);
  });

  it("udane wyjście: sesja super admina wraca, audyt jest zamykany, stan czyszczony", async () => {
    await impersonateUser(TARGET, "Anna");
    h.authCalls = [];
    await stopImpersonation();
    expect(h.authCalls).toEqual([
      { op: "setSession", args: { access_token: "admin-at", refresh_token: "admin-rt" } },
    ]);
    expect(h.endCalls).toEqual([{ data: { sessionId: "sess-1" } }]);
    expect(storedState()).toBeNull();
  });

  it("awaria zamknięcia audytu po udanym powrocie nie blokuje wyjścia", async () => {
    await impersonateUser(TARGET, "Anna");
    h.endFails = true;
    await expect(stopImpersonation()).resolves.toBeUndefined();
    expect(storedState()).toBeNull();
  });

  it.each([
    ["błąd oddany przez `setSession`", { error: { message: "Invalid Refresh Token" } }],
    ["wyjątek z `setSession`", "throw"],
  ] as const)(
    "NAPRAWA: %s - lokalne wylogowanie zamiast zostania na cudzym koncie bez banera",
    async (_label, result) => {
      await impersonateUser(TARGET, "Anna");
      h.authCalls = [];
      h.setSessionResult = result;
      await expect(stopImpersonation()).resolves.toBeUndefined();
      expect(h.authCalls.map((call) => call.op)).toEqual(["setSession", "signOut"]);
      // Tylko ta karta - globalne wylogowanie unieważniłoby sesje podszywanej osoby.
      expect(h.authCalls[1].args).toEqual({ scope: "local" });
      // Audytu nie da się zamknąć cudzą sesją - zostaje otwarty, i to jest prawda.
      expect(h.endCalls).toHaveLength(0);
      expect(storedState()).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// Wspólne toasty panelu
// ---------------------------------------------------------------------------

describe("adminToast - komunikaty bez hooka", () => {
  it.each(["pl", "en"])(
    "każdy komunikat ma tłumaczenie w języku %s (nie surowy klucz)",
    async (lang) => {
      await i18n.changeLanguage(lang);
      for (const [name, message] of Object.entries(adminToast)) {
        const text = message();
        expect(text, name).not.toBe(`adminToasts.${name}`);
        expect(text.trim().length, name).toBeGreaterThan(0);
      }
      await i18n.changeLanguage("pl");
    },
  );

  it("komunikat jest czytany przy WYWOŁANIU, więc nadąża za zmianą języka", async () => {
    await i18n.changeLanguage("pl");
    const pl = adminToast.saved();
    await i18n.changeLanguage("en");
    expect(adminToast.saved()).not.toBe(pl);
    await i18n.changeLanguage("pl");
  });
});
