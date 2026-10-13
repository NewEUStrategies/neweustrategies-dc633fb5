// Zgody uczestnika - funkcje serwerowe (`eventConsent.functions.ts`) i ich
// logika (`eventConsent.server.ts`), REG-02 / REG-14.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TOŻSAMOŚĆ Z CIAŁA ŻĄDANIA - identyfikator osoby albo adres z ładunku
//      pozwalałby wycofać (albo sprawdzić) cudze zgody po samym e-mailu.
//      Walidator odrzuca każdy klucz spoza kontraktu, a ładunek do bazy jest
//      budowany od zera (cele + klucz samoobsługi).
//   2. NAJEMCA DOMYŚLNY - `supabaseAdmin` nie niesie hosta, więc najemca idzie
//      jawnie z zaufanego hosta; host bez najemcy to awaria BEZ pytania bazy.
//   3. SUROWY ADRES W BAZIE - dowód zgody i kubełek prób dostają solony skrót
//      `ip:<32 hex>`, nigdy nagłówek; przeglądarka przycięta do 400 znaków.
//   4. GET POTWIERDZA ZGODĘ - potwierdzenie i podgląd to POST (token w ciele,
//      nie w adresie), a podgląd woła WYŁĄCZNIE funkcję podglądu.
//   5. WYROCZNIA STANU - wynik wycofania jest stały; serwer nie dokleja niczego.
//   6. OKNO WDROŻENIA - PGRST202/42883 to `unavailable`, nie „link wygasł".
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
} from "@/test/serverFnHarness";
import { requestRateSubject } from "@/lib/server/rateSubject.server";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  callerRpc: vi.fn(),
  userId: null as string | null,
  tenant: "aaaaaaaa-0000-4000-8000-00000000000a" as string | null,
  hosts: [] as (string | null)[],
  request: new Request("https://nes.example/_serverFn", {
    headers: {
      "cf-connecting-ip": "192.0.2.7",
      "x-forwarded-for": "203.0.113.5",
      "user-agent": `Mozilla/5.0 ${"x".repeat(600)}`,
    },
  }),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@tanstack/react-start/server", () => ({ getRequest: () => h.request }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));
vi.mock("@/lib/auth/optionalUser.server", () => ({
  optionalUserIdFromRequest: async () => h.userId,
}));
vi.mock("@/lib/http/requestHost", () => ({ currentTenantHost: async () => "nes.example" }));
vi.mock("@/lib/server/tenant.server", () => ({
  resolveTenantIdForHost: async (host: string | null) => {
    h.hosts.push(host);
    return h.tenant;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: h.rpc } }));
vi.mock("@/lib/events/callerClient.server", () => ({
  callerSupabase: async () => ({ client: { rpc: h.callerRpc }, userId: h.userId }),
}));

import {
  confirmEventConsent,
  listMyEventConsents,
  previewEventConsent,
  withdrawEventConsents,
} from "@/lib/events/eventConsent.functions";

const TENANT = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER = "bbbbbbbb-0000-4000-8000-00000000000b";
const PERSON = "cccccccc-0000-4000-8000-00000000000c";
/** 24 bajty w base64url - kształt tokenu DOI i klucza samoobsługi. */
const TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";
const MANAGE = "Zz9y_Xw8-Vu7tSr6QpO5nMl4KjI3hGf2";

const call = <T>(fn: unknown, data?: unknown) =>
  callServerFn<T>(fn, { data, context: { supabase: null } });

beforeEach(() => {
  h.rpc.mockReset();
  h.callerRpc.mockReset();
  h.userId = null;
  h.tenant = TENANT;
  h.hosts = [];
});

describe("previewEventConsent - podgląd linku z maila", () => {
  it("POST, najemca z hosta, tylko token - i wyłącznie funkcja podglądu", async () => {
    h.rpc.mockResolvedValue({
      data: {
        state: "open",
        purposes: ["marketing", "partner_sharing"],
        lang: "pl",
        expires_at: "2030-01-08T10:00:00Z",
        event: { slug: "kongres", title_pl: "Kongres", title_en: "Congress" },
        texts: [{ purpose: "marketing", body: "Chcę otrzymywać informacje." }],
      },
      error: null,
    });

    const result = await call(previewEventConsent, { token: TOKEN });

    expect(Reflect.get(previewEventConsent as object, "method")).toBe("POST");
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("event_consent_confirmation_preview", {
      _tenant_id: TENANT,
      p_token: TOKEN,
    });
    expect(h.hosts).toEqual(["nes.example"]);
    expect(result).toEqual({
      ok: true,
      preview: {
        state: "open",
        purposes: ["marketing", "partner_sharing"],
        lang: "pl",
        expiresAt: "2030-01-08T10:00:00Z",
        event: {
          slug: "kongres",
          titlePl: "Kongres",
          titleEn: "Congress",
          startsAt: null,
          timezone: null,
        },
        texts: [{ purpose: "marketing", body: "Chcę otrzymywać informacje." }],
      },
    });
  });

  it("token o złym kształcie i klucz spoza kontraktu nie dochodzą do serwera", () => {
    expect(() => validateServerFnInput(previewEventConsent, { token: "krotki" })).toThrow();
    expect(() =>
      validateServerFnInput(previewEventConsent, { token: TOKEN, tenant_id: TENANT }),
    ).toThrow();
  });

  it("host bez najemcy = awaria BEZ pytania bazy; okno wdrożenia = unavailable", async () => {
    h.tenant = null;
    expect(await call(previewEventConsent, { token: TOKEN })).toEqual({
      ok: false,
      reason: "error",
    });
    expect(h.rpc).not.toHaveBeenCalled();

    h.tenant = TENANT;
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    expect(await call(previewEventConsent, { token: TOKEN })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    h.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await call(previewEventConsent, { token: TOKEN })).toEqual({
      ok: false,
      reason: "error",
    });
  });

  it("nieznany stan z bazy nie udaje znanego (not_found)", async () => {
    h.rpc.mockResolvedValue({ data: { state: "cos-nowego" }, error: null });
    const result = await call<{ ok: boolean; preview: { state: string } }>(previewEventConsent, {
      token: TOKEN,
    });
    expect(result.preview.state).toBe("not_found");
  });
});

describe("confirmEventConsent - potwierdzenie (POST z przycisku)", () => {
  it("POST; konto z sesji, solony skrót adresu, przeglądarka przycięta do 400 znaków", async () => {
    h.userId = USER;
    h.rpc.mockResolvedValue({
      data: { ok: true, state: "confirmed", purposes: ["marketing"] },
      error: null,
    });

    const result = await call(confirmEventConsent, { token: TOKEN });

    expect(Reflect.get(confirmEventConsent as object, "method")).toBe("POST");
    expect(result).toEqual({ ok: true, state: "confirmed", purposes: ["marketing"] });
    const [name, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("event_consent_confirm_for_request");
    expect(args).toEqual({
      _tenant_id: TENANT,
      _user_id: USER,
      _ip_subject: requestRateSubject(h.request.headers),
      _user_agent: `Mozilla/5.0 ${"x".repeat(600)}`.slice(0, 400),
      p_token: TOKEN,
    });
    expect(args._ip_subject).toMatch(/^ip:[0-9a-f]{32}$/);
    // Surowy adres (ani prawdziwy, ani podrobiony XFF) nie wychodzi do bazy.
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain("192.0.2.7");
    expect(JSON.stringify(h.rpc.mock.calls)).not.toContain("203.0.113.5");
  });

  it("bez sesji link działa (konto NULL)", async () => {
    h.rpc.mockResolvedValue({ data: { ok: true, state: "already", purposes: [] }, error: null });
    expect(await call(confirmEventConsent, { token: TOKEN })).toEqual({
      ok: true,
      state: "already",
      purposes: [],
    });
    expect((h.rpc.mock.calls[0] as [string, Record<string, unknown>])[1]._user_id).toBeNull();
  });

  it.each([
    [
      { ok: false, state: "expired" },
      { ok: false, state: "expired" },
    ],
    [
      { ok: false, state: "not_found" },
      { ok: false, state: "not_found" },
    ],
    [
      { ok: false, state: "rate_limited" },
      { ok: false, state: "rate_limited" },
    ],
    [
      { ok: false, state: "cos" },
      { ok: false, state: "error" },
    ],
  ])("odpowiedź bazy %j -> %j", async (data, expected) => {
    h.rpc.mockResolvedValue({ data, error: null });
    expect(await call(confirmEventConsent, { token: TOKEN })).toEqual(expected);
  });

  it("identyfikator osoby ani adres nie przechodzą walidatora", () => {
    expect(() =>
      validateServerFnInput(confirmEventConsent, { token: TOKEN, person_id: PERSON }),
    ).toThrow();
    expect(() =>
      validateServerFnInput(confirmEventConsent, { token: TOKEN, email: "ofiara@example.org" }),
    ).toThrow();
  });

  it("okno wdrożenia = unavailable (nie: link wygasł)", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "missing" } });
    expect(await call(confirmEventConsent, { token: TOKEN })).toEqual({
      ok: false,
      state: "unavailable",
    });
  });
});

describe("withdrawEventConsents - wycofanie (klucz samoobsługi albo sesja)", () => {
  it("klucz samoobsługi: ładunek = WYŁĄCZNIE cele i klucz, wynik stały", async () => {
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null });

    const result = await call(withdrawEventConsents, { purposes: "all", manageToken: MANAGE });

    expect(Reflect.get(withdrawEventConsents as object, "method")).toBe("POST");
    expect(result).toEqual({ ok: true });
    const [name, args] = h.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("event_consent_withdraw_for_request");
    expect(args).toEqual({
      _tenant_id: TENANT,
      _user_id: null,
      _ip_subject: requestRateSubject(h.request.headers),
      _user_agent: `Mozilla/5.0 ${"x".repeat(600)}`.slice(0, 400),
      p_payload: { purposes: "all", manage_token: MANAGE },
    });
  });

  it("sesja bez klucza: osobę wskazuje konto z sesji, ładunek bez klucza", async () => {
    h.userId = USER;
    h.rpc.mockResolvedValue({ data: { ok: true }, error: null });

    await call(withdrawEventConsents, { purposes: "marketing" });

    const args = (h.rpc.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(args._user_id).toBe(USER);
    expect(args.p_payload).toEqual({ purposes: "marketing" });
  });

  it("identyfikator osoby, adres i konto z ładunku odrzucone - nie ma ich w kontrakcie", () => {
    for (const extra of [
      { person_id: PERSON },
      { email: "ofiara@example.org" },
      { user_id: USER },
      { tenant_id: TENANT },
    ]) {
      expect(() =>
        validateServerFnInput(withdrawEventConsents, { purposes: "all", ...extra }),
      ).toThrow();
    }
    expect(() =>
      validateServerFnInput(withdrawEventConsents, { purposes: "data_processing" }),
    ).toThrow();
  });

  it("bez klucza i bez sesji: odmowa bez pytania bazy (nie ma czyich zgód wycofać)", async () => {
    expect(await call(withdrawEventConsents, { purposes: "all" })).toEqual({
      ok: false,
      reason: "no_credential",
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("odmowy bazy i okno wdrożenia", async () => {
    h.rpc.mockResolvedValue({ data: { ok: false, error: "rate_limited" }, error: null });
    expect(await call(withdrawEventConsents, { purposes: "all", manageToken: MANAGE })).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    h.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    expect(await call(withdrawEventConsents, { purposes: "all", manageToken: MANAGE })).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("listMyEventConsents - stan zgód zalogowanego uczestnika", () => {
  it("wymaga sesji (requireSupabaseAuth) i pyta klientem wołającego z hostem", async () => {
    h.callerRpc.mockResolvedValue({
      data: {
        linked: true,
        email: "uczestnik@example.org",
        consents: { marketing_at: "2026-10-01T10:00:00Z", partner_sharing_at: null },
        open_confirmation: null,
        ledger: [
          {
            purpose: "marketing",
            status: "confirmed",
            evidence: "email_double_opt_in",
            created_at: "2026-10-01T10:00:00Z",
            text_version: 1,
            text_lang: "pl",
          },
          { purpose: "nieznany", status: "confirmed", evidence: "x", created_at: "2026" },
        ],
      },
      error: null,
    });

    const result = await call<{ ok: true; state: { ledger: unknown[]; linked: boolean } }>(
      listMyEventConsents,
    );

    expect(serverFnMiddlewareNames(listMyEventConsents)).toEqual(["requireSupabaseAuth"]);
    expect(h.callerRpc).toHaveBeenCalledWith("event_my_consent_state");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.state.linked).toBe(true);
    // Wpis o nieznanym celu nie udaje znanego.
    expect(result.state.ledger).toHaveLength(1);
  });

  it("okno wdrożenia = unavailable", async () => {
    h.callerRpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "x" } });
    expect(await call(listMyEventConsents)).toEqual({ ok: false, reason: "unavailable" });
  });
});
