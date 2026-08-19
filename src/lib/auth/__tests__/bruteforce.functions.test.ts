// Brama prób logowania działa przed Supabase Auth. Testy utrwalają kontrakt
// warstwy TypeScript: zaufany adres jest skracany, dwa niezależne kubełki są
// wywoływane w poprawnej kolejności, a każdy błąd kończy się fail-closed.
// Atomowość licznika i reset okna mają osobny test pgTAP.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetServerFnContext, setServerFnContext, serverFnMeta } from "@/test/serverFn";

const h = vi.hoisted(() => ({
  headers: new Headers() as Headers | null,
  throwOnRequest: false,
  rpc: vi.fn(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => {
    if (h.throwOnRequest) throw new Error("brak kontekstu HTTP");
    return h.headers ? { headers: h.headers } : undefined;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => h.rpc(name, args),
  },
}));

const { preAuthGuard, unlockContentPassword } = await import("@/lib/auth/bruteforce.functions");

const TEST_IP = "203.0.113.10";
const VALID_UNLOCK = {
  entityType: "post" as const,
  entityId: "11111111-1111-4111-8111-111111111111",
  password: "synthetic-password",
};

function allow(hits = 1) {
  return { data: [{ allowed: true, hits }], error: null };
}

function rpcArgs(index: number): Record<string, unknown> {
  return h.rpc.mock.calls[index]?.[1] as Record<string, unknown>;
}

beforeEach(() => {
  h.headers = new Headers({ "x-forwarded-for": TEST_IP });
  h.throwOnRequest = false;
  h.rpc.mockReset().mockResolvedValue(allow());
  process.env.SESSION_SECRET = "synthetic-session-secret";
  setServerFnContext({ supabase: {} });
});

afterEach(() => {
  resetServerFnContext();
  delete process.env.SESSION_SECRET;
});

describe("preAuthGuard", () => {
  it("pierwsza próba przechodzi przez kubełek IP, a następnie loginu", async () => {
    const result = await preAuthGuard({
      data: { kind: "login", email: "person@example.test" },
    });

    expect(result).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(rpcArgs(0)).toMatchObject({ _scope: "auth_login_ip", _max: 15, _window_minutes: 5 });
    expect(rpcArgs(1)).toMatchObject({
      _scope: "auth_login_email",
      _max: 8,
      _window_minutes: 15,
    });
  });

  it("normalizuje alias trybu i wielkość liter adresu przed skróceniem", async () => {
    await preAuthGuard({ data: { kind: "signin", email: "  PERSON@EXAMPLE.TEST " } });
    const firstEmailHash = rpcArgs(1)._subject;

    h.rpc.mockClear();
    await preAuthGuard({ data: { kind: "login", email: "person@example.test" } });

    expect(rpcArgs(1)._scope).toBe("auth_login_email");
    expect(rpcArgs(1)._subject).toBe(firstEmailHash);
    expect(String(firstEmailHash)).not.toContain("person@example.test");
  });

  it("odrzuca próbę, gdy limit IP został osiągnięty", async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ allowed: false, hits: 16 }], error: null });

    await expect(
      preAuthGuard({ data: { kind: "login", email: "person@example.test" } }),
    ).rejects.toThrow("auth: rate_limited");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(rpcArgs(0)._scope).toBe("auth_login_ip");
  });

  it("odrzuca próbę, gdy rozproszony atak osiągnął limit loginu", async () => {
    h.rpc
      .mockResolvedValueOnce(allow(1))
      .mockResolvedValueOnce({ data: { allowed: false, hits: 9 }, error: null });

    await expect(
      preAuthGuard({ data: { kind: "login", email: "victim@example.test" } }),
    ).rejects.toThrow("auth: rate_limited");
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(rpcArgs(1)._scope).toBe("auth_login_email");
  });

  it("brak nagłówka IP odrzuca bez wykonania zapisu", async () => {
    h.headers = new Headers();

    await expect(
      preAuthGuard({ data: { kind: "login", email: "person@example.test" } }),
    ).rejects.toThrow("auth: rate_limited");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("brak kontekstu żądania również działa fail-closed", async () => {
    h.throwOnRequest = true;

    await expect(
      preAuthGuard({ data: { kind: "reset", email: "person@example.test" } }),
    ).rejects.toThrow("auth: rate_limited");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("dwa adresy IP nie dzielą skrótu kubełka", async () => {
    await preAuthGuard({ data: { kind: "signup", email: "one@example.test" } });
    const firstIpHash = rpcArgs(0)._subject;

    h.headers = new Headers({ "x-real-ip": "198.51.100.24" });
    h.rpc.mockClear();
    await preAuthGuard({ data: { kind: "signup", email: "two@example.test" } });

    expect(rpcArgs(0)._subject).not.toBe(firstIpHash);
    expect(rpcArgs(0)).toMatchObject({ _max: 10, _window_minutes: 15 });
  });

  it("ten sam adres z różnymi loginami dzieli IP, lecz nie skrót loginu", async () => {
    await preAuthGuard({ data: { kind: "reset", email: "one@example.test" } });
    const firstIpHash = rpcArgs(0)._subject;
    const firstEmailHash = rpcArgs(1)._subject;

    h.rpc.mockClear();
    await preAuthGuard({ data: { kind: "reset", email: "two@example.test" } });

    expect(rpcArgs(0)._subject).toBe(firstIpHash);
    expect(rpcArgs(1)._subject).not.toBe(firstEmailHash);
    expect(rpcArgs(1)).toMatchObject({ _max: 5, _window_minutes: 30 });
  });

  it("struktura wysyłana do bazy nigdy nie zawiera surowego adresu IP", async () => {
    await preAuthGuard({ data: { kind: "login", email: "person@example.test" } });
    const serialized = JSON.stringify(h.rpc.mock.calls);

    expect(serialized).not.toContain(TEST_IP);
    expect(String(rpcArgs(0)._subject)).toMatch(/^ip:[a-f0-9]{32}$/);
    expect(String(rpcArgs(0)._subject)).not.toBe(String(rpcArgs(1)._subject));
  });

  it("błąd RPC zamyka bramę i nie przechodzi do kolejnego kubełka", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.rpc.mockResolvedValueOnce({ data: null, error: new Error("database offline") });

    await expect(
      preAuthGuard({ data: { kind: "login", email: "person@example.test" } }),
    ).rejects.toThrow("auth: rate_limited");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[bruteforce] auth_login_ip failed:", "database offline");
    warn.mockRestore();
  });

  it("walidator odrzuca błędny tryb i oznacza stabilny kod błędu", async () => {
    const rejected = preAuthGuard({
      data: { kind: "unknown", email: "not-an-email" },
    }).catch((error: Error & { code?: string; issues?: unknown }) => error);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("invalid_input");
    expect(error.issues).toBeTruthy();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("deklaruje metodę POST i walidator na granicy serwera", () => {
    expect(serverFnMeta(preAuthGuard)?.method).toBe("POST");
    expect(serverFnMeta(preAuthGuard)?.hasValidator).toBe(true);
  });
});

describe("unlockContentPassword", () => {
  it("przekazuje wyłącznie skrót IP i mapuje poprawną treść", async () => {
    h.rpc.mockResolvedValueOnce({
      data: [
        {
          ok: true,
          content_pl: "Treść PL",
          content_en: "Content EN",
          builder_data: { version: 1 },
          blocks_data: [{ type: "paragraph" }],
        },
      ],
      error: null,
    });

    const result = await unlockContentPassword({ data: VALID_UNLOCK });

    expect(result).toMatchObject({ ok: true, content_pl: "Treść PL", content_en: "Content EN" });
    expect(h.rpc).toHaveBeenCalledWith(
      "verify_content_password",
      expect.objectContaining({ _entity_type: "post", _ip_hash: expect.stringMatching(/^ip:/) }),
    );
    expect(JSON.stringify(rpcArgs(0))).not.toContain(TEST_IP);
  });

  it("błędne hasło zwraca pustą treść bez ujawniania szczegółów", async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ ok: false }], error: null });

    const result = await unlockContentPassword({ data: VALID_UNLOCK });

    expect(result.ok).toBe(false);
    expect(result.content_pl).toBeNull();
    expect(result.blocks_data).toBeNull();
  });

  it("poprawna odpowiedź bez opcjonalnych treści normalizuje pola do `null`", async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ ok: true }], error: null });

    const result = await unlockContentPassword({ data: VALID_UNLOCK });

    expect(result.ok).toBe(true);
    expect(result.content_pl).toBeNull();
    expect(result.content_en).toBeNull();
    expect(result.builder_data).toBeNull();
    expect(result.blocks_data).toBeNull();
  });

  it("pusta odpowiedź jest traktowana jak błędne hasło", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await unlockContentPassword({ data: VALID_UNLOCK });

    expect(result.ok).toBe(false);
    expect(result.builder_data).toBeNull();
  });

  it("mapuje błąd limitu i pozostałe błędy na odrębne kody", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: new Error("too many attempts") });
    await expect(unlockContentPassword({ data: VALID_UNLOCK })).rejects.toThrow(
      "content_password: rate_limited",
    );

    h.rpc.mockResolvedValueOnce({ data: null, error: new Error("database offline") });
    await expect(unlockContentPassword({ data: VALID_UNLOCK })).rejects.toThrow(
      "content_password: failed",
    );
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });

  it("brak zaufanego IP blokuje próbę jeszcze przed RPC", async () => {
    h.headers = null;

    await expect(unlockContentPassword({ data: VALID_UNLOCK })).rejects.toThrow(
      "content_password: rate_limited",
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("walidator odrzuca nieobsługiwany typ i puste hasło", async () => {
    await expect(
      unlockContentPassword({ data: { ...VALID_UNLOCK, entityType: "video" } }),
    ).rejects.toThrow();
    await expect(
      unlockContentPassword({ data: { ...VALID_UNLOCK, password: "" } }),
    ).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
