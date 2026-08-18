import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getAal: vi.fn(),
  listFactors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: () => h.getAal(),
        listFactors: () => h.listFactors(),
        challenge: (args: unknown) => h.challenge(args),
        verify: (args: unknown) => h.verify(args),
      },
    },
  },
}));

const {
  toQrDataUri,
  isMfaChallengeRequired,
  getVerifiedTotpFactorId,
  verifyTotpCode,
} = await import("@/lib/auth/mfa");

beforeEach(() => {
  h.getAal.mockReset();
  h.listFactors.mockReset();
  h.challenge.mockReset();
  h.verify.mockReset();
});

// Pure QR-normalisation guard.
describe("toQrDataUri", () => {
  it("wraps raw SVG markup as an svg data URI", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(toQrDataUri(svg)).toBe(`data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`);
  });

  it("passes through values that are already data URIs", () => {
    const uri = "data:image/svg+xml;utf-8,%3Csvg%3E%3C/svg%3E";
    expect(toQrDataUri(uri)).toBe(uri);
  });
});

describe("isMfaChallengeRequired", () => {
  it("true tylko dla aal1 z gotowym stepem do aal2", async () => {
    h.getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    expect(await isMfaChallengeRequired()).toBe(true);
  });

  it("false, gdy sesja jest już na aal2 (nic do podniesienia)", async () => {
    h.getAal.mockResolvedValue({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    expect(await isMfaChallengeRequired()).toBe(false);
  });

  it("false, gdy konto nie ma skonfigurowanego czynnika (nextLevel aal1)", async () => {
    h.getAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
    expect(await isMfaChallengeRequired()).toBe(false);
  });

  it("false przy błędzie Supabase (fail-open na ten konkretny odczyt)", async () => {
    h.getAal.mockResolvedValue({ data: null, error: new Error("network down") });
    expect(await isMfaChallengeRequired()).toBe(false);
  });
});

describe("getVerifiedTotpFactorId", () => {
  it("zwraca id pierwszego zweryfikowanego czynnika TOTP", async () => {
    h.listFactors.mockResolvedValue({ data: { totp: [{ id: "factor-1" }] }, error: null });
    expect(await getVerifiedTotpFactorId()).toBe("factor-1");
  });

  it("null, gdy konto nie ma żadnego czynnika TOTP", async () => {
    h.listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
    expect(await getVerifiedTotpFactorId()).toBeNull();
  });

  it("null przy błędzie Supabase", async () => {
    h.listFactors.mockResolvedValue({ data: null, error: new Error("boom") });
    expect(await getVerifiedTotpFactorId()).toBeNull();
  });
});

describe("verifyTotpCode", () => {
  it("challenge + verify w jednym wywołaniu, z ID wyzwania z pierwszego kroku", async () => {
    h.challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    h.verify.mockResolvedValue({ error: null });

    await verifyTotpCode("factor-1", "123456");

    expect(h.challenge).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(h.verify).toHaveBeenCalledWith({
      factorId: "factor-1",
      challengeId: "challenge-1",
      code: "123456",
    });
  });

  it("rzuca błąd Supabase, gdy sam challenge się nie powiedzie", async () => {
    const challengeError = new Error("rate limited");
    h.challenge.mockResolvedValue({ data: null, error: challengeError });

    await expect(verifyTotpCode("factor-1", "123456")).rejects.toBe(challengeError);
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("rzuca błąd zastępczy, gdy challenge zwróci puste dane bez błędu", async () => {
    h.challenge.mockResolvedValue({ data: null, error: null });

    await expect(verifyTotpCode("factor-1", "123456")).rejects.toThrow("MFA challenge failed");
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("rzuca błąd Supabase, gdy weryfikacja kodu się nie powiedzie", async () => {
    h.challenge.mockResolvedValue({ data: { id: "challenge-1" }, error: null });
    const verifyError = new Error("invalid code");
    h.verify.mockResolvedValue({ error: verifyError });

    await expect(verifyTotpCode("factor-1", "000000")).rejects.toBe(verifyError);
  });
});
