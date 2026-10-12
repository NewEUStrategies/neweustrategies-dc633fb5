// @vitest-environment node
// Zadanie tła: obiekty Google Wallet unieważnionych biletów -> INACTIVE (OPS-14).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW. Zadanie, które zajmuje kolejkę bez
// konfiguracji Google, spala próby (po ośmiu baza przestaje ponawiać) i obiekty
// zostają ACTIVE na zawsze. Zadanie, które 404 liczy jako błąd, ponawia
// w nieskończoność obiekt, którego nie ma. Rozliczenie bez dzierżawy albo
// z kodem odpowiedzi Google w treści błędu to odpowiednio podwójna praca
// i wyciek treści odpowiedzi do bazy. Sieć jest tu zamockowana w całości,
// baza - atrapą RPC (`supabaseRpcStub`) z odpowiedziami w kształcie migracji
// 20261012130100 (ich prawdziwe zachowanie dowodzi harness 55).
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import { GOOGLE_CONFIG_FIXTURE } from "@/test/events/walletFixtures";
import { TEST_SIGNER_KEY_PKCS8_PEM } from "@/test/fixtures/walletTestPki";
import { fail, supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase";
import { advanceClock, freezeClock } from "@/test/time";

import { GOOGLE_WALLET_API, GoogleWalletError } from "../googleWallet.server";
import { resetWalletConfigMemoForTests } from "../walletConfig.server";
import { revokeErrorLabel, runWalletPassRevocations } from "../walletRevocationJob.server";

freezeClock();

const CLAIMED_AT = "2099-06-15T11:59:59.123456+00:00";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface Call {
  url: string;
  method: string;
  body: string;
}

let calls: Call[];
let responder: (call: Call) => Response | Promise<Response>;
let rpc: SupabaseRpcStub;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let emailSeq = 0;

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status });
}

function itemUrl(objectId: string): string {
  return `${GOOGLE_WALLET_API}/eventTicketObject/${encodeURIComponent(objectId)}`;
}

/** Klient service role z samą powierzchnią `rpc` - jedyną, której dotyka zadanie. */
function admin(): SupabaseClient<Database> {
  return { rpc: rpc.rpc } as unknown as SupabaseClient<Database>;
}

/** Świeże konto usługi = pusty cache tokenu (cache jest per izolat i per e-mail). */
function stubGoogleConfig() {
  emailSeq += 1;
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", GOOGLE_CONFIG_FIXTURE.issuerId);
  vi.stubEnv(
    "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON",
    JSON.stringify({
      client_email: `revoke-${emailSeq}@example-project.iam.gserviceaccount.com`,
      private_key: TEST_SIGNER_KEY_PKCS8_PEM,
    }),
  );
}

function claim(passes: { id: string; object_id: string }[], closed = 0) {
  rpc.setData("_event_wallet_pass_revocations_claim", {
    claimed_at: CLAIMED_AT,
    passes: passes.map((p, i) => ({ ...p, reason: "code_changed", attempt: i + 1 })),
    closed,
  });
}

/** Rozliczenie odpowiada tym, co dostało (jak funkcja w bazie dla świeżej dzierżawy). */
function settleEcho(reactivate: string[] = [], gaveUp = 0) {
  rpc.setResponse("_event_wallet_pass_revocations_settle", (call) => ({
    data: {
      revoked: (call.arg("p_revoked") as string[]).length,
      failed: (call.arg("p_failed") as unknown[]).length,
      gave_up: gaveUp,
      deferred: (call.arg("p_deferred") as string[]).length,
      reactivate,
    },
    error: null,
  }));
}

beforeEach(() => {
  calls = [];
  rpc = supabaseRpcStub();
  responder = (call) =>
    call.url === TOKEN_URL ? json(200, { access_token: "tok-rev", expires_in: 3600 }) : json(200);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { url, method: String(init.method), body: String(init.body) };
    calls.push(call);
    return responder(call);
  });
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  stubGoogleConfig();
});

afterEach(() => {
  // Żaden log nie niesie klucza konta usługi ani tokenu.
  for (const line of [...warn.mock.calls, ...error.mock.calls]) {
    const text = line.map(String).join(" ");
    expect(text).not.toContain("tok-rev");
    expect(text).not.toContain(TEST_SIGNER_KEY_PKCS8_PEM.split("\n")[1]);
  }
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetWalletConfigMemoForTests();
});

describe("runWalletPassRevocations - kiedy nic nie robi", () => {
  it("Google nieskonfigurowany -> skipped, bez zajęcia kolejki (próby nie przepadają)", async () => {
    vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", "");
    await expect(runWalletPassRevocations(admin())).resolves.toMatchObject({
      skipped: "not_configured",
      claimed: 0,
    });
    expect(rpc.calls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("miniony termin -> nic nie zajmuje", async () => {
    const result = await runWalletPassRevocations(admin(), { deadlineAt: Date.now() - 1 });
    expect(result).toMatchObject({ claimed: 0, revoked: 0 });
    expect(rpc.calls).toEqual([]);
  });

  it("baza bez kolejki (kod przed migracją) -> skipped migration_pending; inny błąd zajęcia rzuca", async () => {
    rpc.setError("_event_wallet_pass_revocations_claim", "no function", "PGRST202");
    await expect(runWalletPassRevocations(admin())).resolves.toMatchObject({
      skipped: "migration_pending",
    });
    rpc.setError("_event_wallet_pass_revocations_claim", "permission denied", "42501");
    await expect(runWalletPassRevocations(admin())).rejects.toThrow("permission denied");
  });

  it("pusta partia -> bez tokenu, bez rozliczenia; zamknięte bez sieci są w wyniku", async () => {
    claim([], 3);
    const result = await runWalletPassRevocations(admin(), { limit: 7 });
    expect(result).toEqual({
      claimed: 0,
      revoked: 0,
      failed: 0,
      deferred: 0,
      gaveUp: 0,
      closed: 3,
      reactivated: 0,
    });
    expect(rpc.lastCall("_event_wallet_pass_revocations_claim")?.args).toEqual({ p_limit: 7 });
    expect(rpc.names()).toEqual(["_event_wallet_pass_revocations_claim"]);
    expect(calls).toEqual([]);
  });
});

describe("runWalletPassRevocations - partia", () => {
  it("INACTIVE częściowym PATCH-em; 404 to unieważniony; inny status to błąd z samym kodem HTTP", async () => {
    claim([
      { id: "w-1", object_id: "3388.reg_a.111" },
      { id: "w-2", object_id: "3388.reg_b.222" },
      { id: "w-3", object_id: "3388.reg_c.333" },
    ]);
    settleEcho();
    responder = (call) => {
      if (call.url === TOKEN_URL) return json(200, { access_token: "tok-rev", expires_in: 3600 });
      if (call.url === itemUrl("3388.reg_b.222")) return json(404, { error: { message: "gone" } });
      if (call.url === itemUrl("3388.reg_c.333")) {
        return json(403, { error: { message: "secret-ish upstream detail" } });
      }
      return json(200);
    };

    const result = await runWalletPassRevocations(admin());

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${TOKEN_URL}`,
      `PATCH ${itemUrl("3388.reg_a.111")}`,
      `PATCH ${itemUrl("3388.reg_b.222")}`,
      `PATCH ${itemUrl("3388.reg_c.333")}`,
    ]);
    for (const call of calls.slice(1)) expect(JSON.parse(call.body)).toEqual({ state: "INACTIVE" });
    expect(rpc.lastCall("_event_wallet_pass_revocations_settle")?.args).toEqual({
      p_claimed_at: CLAIMED_AT,
      p_revoked: ["w-1", "w-2"],
      p_failed: [{ id: "w-3", error: "http 403" }],
      p_deferred: [],
    });
    expect(result).toEqual({
      claimed: 3,
      revoked: 2,
      failed: 1,
      deferred: 0,
      gaveUp: 0,
      closed: 0,
      reactivated: 0,
    });
    expect(JSON.stringify(rpc.calls.map((c) => c.args))).not.toContain("secret-ish");
    expect(warn).toHaveBeenCalledWith("[wallet] google revocations failed:", 1, "http 403");
  });

  it("termin w trakcie partii -> reszta odłożona (próba wraca do kolejki)", async () => {
    claim([
      { id: "w-1", object_id: "o-1" },
      { id: "w-2", object_id: "o-2" },
      { id: "w-3", object_id: "o-3" },
    ]);
    settleEcho();
    const deadlineAt = Date.now() + 5_000;
    responder = (call) => {
      if (call.url === TOKEN_URL) return json(200, { access_token: "tok-rev", expires_in: 3600 });
      advanceClock(6_000);
      return json(200);
    };
    const result = await runWalletPassRevocations(admin(), { deadlineAt });
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(rpc.lastCall("_event_wallet_pass_revocations_settle")?.arg("p_deferred")).toEqual([
      "w-2",
      "w-3",
    ]);
    expect(result).toMatchObject({ revoked: 1, deferred: 2 });
  });

  it("nieudany token -> cała partia jako błąd tokenu, bez wywołań obiektów", async () => {
    claim([
      { id: "w-1", object_id: "o-1" },
      { id: "w-2", object_id: "o-2" },
    ]);
    settleEcho();
    responder = () => json(401, { error: "invalid_grant" });
    const result = await runWalletPassRevocations(admin());
    expect(calls.map((c) => c.url)).toEqual([TOKEN_URL]);
    expect(rpc.lastCall("_event_wallet_pass_revocations_settle")?.arg("p_failed")).toEqual([
      { id: "w-1", error: "token http 401" },
      { id: "w-2", error: "token http 401" },
    ]);
    expect(result).toMatchObject({ failed: 2, revoked: 0 });
  });

  it("ósma nieudana próba -> gaveUp z rozliczenia w wyniku przebiegu", async () => {
    claim([{ id: "w-1", object_id: "o-1" }]);
    settleEcho([], 1);
    responder = (call) =>
      call.url === TOKEN_URL ? json(200, { access_token: "tok-rev", expires_in: 3600 }) : json(500);
    await expect(runWalletPassRevocations(admin())).resolves.toMatchObject({
      failed: 1,
      gaveUp: 1,
    });
  });

  it("obiekt wydany ponownie w trakcie próby -> przywrócony ACTIVE; błąd przywrócenia tylko ostrzega", async () => {
    claim([
      { id: "w-1", object_id: "o-1" },
      { id: "w-2", object_id: "o-2" },
    ]);
    settleEcho(["o-1", "o-2"]);
    responder = (call) => {
      if (call.url === TOKEN_URL) return json(200, { access_token: "tok-rev", expires_in: 3600 });
      if (call.url === itemUrl("o-2") && JSON.parse(call.body).state === "ACTIVE") return json(502);
      return json(200);
    };
    const result = await runWalletPassRevocations(admin());
    const reactivations = calls.filter(
      (c) => c.url !== TOKEN_URL && (JSON.parse(c.body) as { state?: string }).state === "ACTIVE",
    );
    expect(reactivations.map((c) => c.url)).toEqual([itemUrl("o-1"), itemUrl("o-2")]);
    expect(result.reactivated).toBe(1);
    expect(warn).toHaveBeenCalledWith("[wallet] google reactivation failed:", "http 502");
  });

  it("błąd rozliczenia -> wynik z własnych list, log; dzierżawa w bazie wygaśnie sama", async () => {
    claim([{ id: "w-1", object_id: "o-1" }]);
    rpc.setResponse("_event_wallet_pass_revocations_settle", fail("connection reset"));
    const result = await runWalletPassRevocations(admin());
    expect(result).toMatchObject({ revoked: 1, failed: 0, reactivated: 0 });
    expect(error).toHaveBeenCalledWith(
      "[wallet] google revocations settle failed:",
      "connection reset",
    );
  });

  it("wiersze zajęcia bez identyfikatora albo obiektu są pomijane", async () => {
    rpc.setData("_event_wallet_pass_revocations_claim", {
      claimed_at: CLAIMED_AT,
      passes: [{ id: "w-1" }, { object_id: "o-2" }, "x", { id: "w-3", object_id: "o-3" }],
      closed: "2",
    });
    settleEcho();
    const result = await runWalletPassRevocations(admin());
    expect(result).toMatchObject({ claimed: 1, revoked: 1, closed: 2 });
  });
});

describe("revokeErrorLabel", () => {
  it("status HTTP, przekroczony czas albo „network” - nic z treści błędu", () => {
    expect(revokeErrorLabel(new GoogleWalletError(429, "google wallet x"))).toBe("http 429");
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    expect(revokeErrorLabel(timeout)).toBe("timeout");
    expect(revokeErrorLabel(new TypeError("fetch failed: getaddrinfo ENOTFOUND"))).toBe("network");
    expect(revokeErrorLabel("boom")).toBe("network");
  });
});
