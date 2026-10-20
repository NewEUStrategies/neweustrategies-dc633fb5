// Podpisy maili ścieżek (S5): token trackingu `jm:` (otwarcie/kliknięcie),
// podpis linku wiążący wiadomość, NUMER linku i dokładny adres, oraz token
// wypisu `ju:` - jedyny, który zmienia zgodę. Domeny HMAC są rozłączne, więc
// żaden z nich nie zastąpi drugiego ani podpisu kampanii.
import { beforeAll, describe, expect, it } from "vitest";
import {
  isJourneyUnsubscribeToken,
  signJourneyLink,
  signJourneyMessageToken,
  signJourneyUnsubscribeToken,
  signTrackingLink,
  verifyJourneyLink,
  verifyJourneyMessageToken,
  verifyJourneyUnsubscribeToken,
} from "../trackingToken.server";

const M = "adcf4729-2d9b-4ef2-bf9a-bdd0cbfe79f9";
const M2 = "11111111-2222-4333-8444-555555555555";
const URL_A = "https://nes.example/analiza";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-journey-secret";
});

describe("token trackingu wiadomości", () => {
  it("round-trip i kształt `<message_id>.<sig32>`", () => {
    const token = signJourneyMessageToken(M);
    expect(token).toMatch(new RegExp(`^${M}\\.[a-f0-9]{32}$`));
    expect(verifyJourneyMessageToken(token)).toBe(M);
    expect(verifyJourneyMessageToken(token.toUpperCase().replace(M.toUpperCase(), M))).toBe(M);
  });

  it("odrzuca podpis innej wiadomości, zły kształt i brak tokenu", () => {
    const other = signJourneyMessageToken(M2).split(".")[1];
    expect(verifyJourneyMessageToken(`${M}.${other}`)).toBeNull();
    expect(verifyJourneyMessageToken(null)).toBeNull();
    expect(verifyJourneyMessageToken("bez-kropki")).toBeNull();
    expect(verifyJourneyMessageToken(`.${"a".repeat(32)}`)).toBeNull();
    expect(verifyJourneyMessageToken(`nie-uuid.${"a".repeat(32)}`)).toBeNull();
    expect(verifyJourneyMessageToken(`${M}.${"z".repeat(32)}`)).toBeNull();
    expect(verifyJourneyMessageToken(`${M}.abc`)).toBeNull();
  });
});

describe("podpis linku", () => {
  it("wiąże wiadomość, numer linku i dokładny adres", () => {
    const sig = signJourneyLink(M, URL_A, 0);
    expect(verifyJourneyLink(M, URL_A, sig, 0)).toBe(true);
    expect(verifyJourneyLink(M, URL_A, sig.toUpperCase(), 0)).toBe(true);
    expect(verifyJourneyLink(M, URL_A, sig, 1)).toBe(false);
    expect(verifyJourneyLink(M2, URL_A, sig, 0)).toBe(false);
    expect(verifyJourneyLink(M, `${URL_A}?x=1`, sig, 0)).toBe(false);
    expect(verifyJourneyLink(M, URL_A, null, 0)).toBe(false);
    expect(verifyJourneyLink(M, URL_A, "abc", 0)).toBe(false);
  });

  it("podpis kampanii nie przechodzi jako podpis ścieżki (inna domena HMAC)", () => {
    expect(verifyJourneyLink(M, URL_A, signTrackingLink(M, M, URL_A), 0)).toBe(false);
  });
});

describe("token wypisu", () => {
  it("`j` + message_id bez myślników + podpis; round-trip", () => {
    const token = signJourneyUnsubscribeToken(M);
    expect(token).toMatch(/^j[0-9a-f]{64}$/);
    expect(isJourneyUnsubscribeToken(token)).toBe(true);
    expect(verifyJourneyUnsubscribeToken(token)).toBe(M);
  });

  it("token trackingu nie jest tokenem wypisu i odwrotnie", () => {
    const tracking = signJourneyMessageToken(M);
    expect(isJourneyUnsubscribeToken(tracking)).toBe(false);
    expect(verifyJourneyUnsubscribeToken(tracking)).toBeNull();
    const unsubscribe = signJourneyUnsubscribeToken(M);
    expect(verifyJourneyMessageToken(unsubscribe)).toBeNull();
    // Podpis `jm:` w miejscu `ju:` odpada.
    const jmSig = tracking.split(".")[1];
    expect(verifyJourneyUnsubscribeToken(`j${M.replace(/-/g, "")}${jmSig}`)).toBeNull();
  });

  it("odrzuca podrobiony podpis, cudzą wiadomość i brak tokenu", () => {
    const token = signJourneyUnsubscribeToken(M);
    expect(verifyJourneyUnsubscribeToken(`${token.slice(0, -1)}0`)).toBeNull();
    expect(verifyJourneyUnsubscribeToken(`j${M2.replace(/-/g, "")}${token.slice(33)}`)).toBeNull();
    expect(verifyJourneyUnsubscribeToken(null)).toBeNull();
    expect(isJourneyUnsubscribeToken(null)).toBe(false);
    expect(isJourneyUnsubscribeToken("0123456789abcdef0123456789abcdef")).toBe(false);
  });
});
