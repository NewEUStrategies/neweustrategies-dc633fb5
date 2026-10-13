// Podpisany identyfikator gościa meteringu (audyt billingowy SUB-17): czysty
// kontrakt formatu. Dowodzimy, że do bazy może dojść WYŁĄCZNIE uuid, który
// wystawił serwer tym sekretem, w oknie ważności - a wszystko inne (brak,
// podróbka, inny sekret, przeterminowanie, token "z przyszłości", śmieci)
// kończy się `null`, czyli nowym gościem, a nie zaufaniem do wejścia z sieci.
import { describe, expect, it } from "vitest";
import {
  METERING_VISITOR_COOKIE,
  VISITOR_TOKEN_MAX_AGE_SECONDS,
  signVisitorToken,
  verifyVisitorToken,
  visitorCookieOptions,
} from "@/lib/access/visitorToken";

const SECRET = "s".repeat(48);
const OTHER_SECRET = "o".repeat(48);
const VISITOR = "0b6f1d2e-3c4a-4b5c-8d6e-7f8091a2b3c4";
const NOW = 1_760_000_000;

describe("signVisitorToken / verifyVisitorToken", () => {
  it("ważny token: zwraca identyfikator i chwilę wystawienia", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW);
    expect(token).toMatch(/^v1\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{22}$/);
    expect(verifyVisitorToken(SECRET, token, NOW + 60)).toEqual({
      visitorId: VISITOR,
      issuedAt: NOW,
    });
  });

  it("brak tokenu (pierwsza wizyta, wyczyszczone cookies): null", () => {
    expect(verifyVisitorToken(SECRET, undefined, NOW)).toBeNull();
    expect(verifyVisitorToken(SECRET, null, NOW)).toBeNull();
    expect(verifyVisitorToken(SECRET, "", NOW)).toBeNull();
  });

  it("niepodpisany uuid (stary klucz z localStorage) nie przechodzi", () => {
    expect(verifyVisitorToken(SECRET, VISITOR, NOW)).toBeNull();
    expect(verifyVisitorToken(SECRET, `v1.${VISITOR}.${NOW}`, NOW)).toBeNull();
  });

  it("podmieniony identyfikator przy zachowanym podpisie: null", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW);
    const forged = token.replace(VISITOR, "11111111-2222-4333-8444-555555555555");
    expect(verifyVisitorToken(SECRET, forged, NOW)).toBeNull();
  });

  it("podmieniona chwila wystawienia (odmłodzenie tokenu): null", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW);
    expect(
      verifyVisitorToken(SECRET, token.replace(`.${NOW}.`, `.${NOW + 1}.`), NOW + 5),
    ).toBeNull();
  });

  it("zmieniony podpis (jeden znak): null", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW);
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyVisitorToken(SECRET, token.slice(0, -1) + last, NOW)).toBeNull();
  });

  it("token podpisany innym sekretem: null", () => {
    expect(
      verifyVisitorToken(SECRET, signVisitorToken(OTHER_SECRET, VISITOR, NOW), NOW),
    ).toBeNull();
  });

  it("przeterminowany (starszy niż okno ważności): null; na granicy okna - ważny", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW);
    expect(verifyVisitorToken(SECRET, token, NOW + VISITOR_TOKEN_MAX_AGE_SECONDS)).not.toBeNull();
    expect(verifyVisitorToken(SECRET, token, NOW + VISITOR_TOKEN_MAX_AGE_SECONDS + 1)).toBeNull();
  });

  it("token z przyszłości ponad tolerancję zegara: null", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW + 3_600);
    expect(verifyVisitorToken(SECRET, token, NOW)).toBeNull();
    expect(
      verifyVisitorToken(SECRET, signVisitorToken(SECRET, VISITOR, NOW + 60), NOW),
    ).not.toBeNull();
  });

  it("brak albo za krótki sekret: nic nie jest ważne (fail-closed)", () => {
    const token = signVisitorToken(SECRET, VISITOR, NOW);
    expect(verifyVisitorToken(null, token, NOW)).toBeNull();
    expect(
      verifyVisitorToken("short-secret", signVisitorToken("short-secret", VISITOR, NOW), NOW),
    ).toBeNull();
  });

  it("śmieci z sieci nie rzucają", () => {
    for (const raw of ["v1", "v1....", "v2.x.y.z", "v1.not-a-uuid.1.abc", "x".repeat(4096)]) {
      expect(verifyVisitorToken(SECRET, raw, NOW)).toBeNull();
    }
  });

  it("podpis odmawia niepoprawnych wejść zamiast podpisać śmieci", () => {
    expect(() => signVisitorToken(SECRET, "nie-uuid", NOW)).toThrow();
    expect(() => signVisitorToken(SECRET, VISITOR, -1)).toThrow();
  });
});

describe("visitorCookieOptions", () => {
  it("cookie zawsze HttpOnly, SameSite=Lax, na całą witrynę, na okres ważności tokenu", () => {
    expect(METERING_VISITOR_COOKIE).toBe("nes_mvid");
    expect(visitorCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: VISITOR_TOKEN_MAX_AGE_SECONDS,
    });
    expect(visitorCookieOptions(false).secure).toBe(false);
  });
});
