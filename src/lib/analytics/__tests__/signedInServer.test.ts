// Flaga „zalogowany" ingestu analityki: `signedInFromRequest`
// (src/lib/analytics/signedIn.server.ts).
//
// PO CO OSOBNY PLIK. Test trasy (`src/routes/api/public/-track.test.ts`)
// dowodzi, że bit trafia do wiersza i że ciało żądania nie ma na niego wpływu.
// Tu pilnujemy PAMIĘCI werdyktów, bo to ona decyduje o koszcie i o tym, jak
// długo żyje stary werdykt:
//   * brak bearera nie dotyka Auth wcale (droga każdego anonimowego beaconu),
//   * ten sam token w TTL jest weryfikowany RAZ (zalogowana karta wysyła
//     partię co 5 s, a weryfikacja tokenu HS to round-trip `getUser`),
//   * werdykt NEGATYWNY też jest pamiętany - inaczej zalew podrobionymi
//     bearerami kosztuje round-trip na żądanie,
//   * werdykt nie przeżywa `exp` tokenu ani pięciu minut,
//   * limit wpisów czyści pamięć w całości (żadnego wzrostu bez granic),
//   * wynik to bit, nie `sub` - identyfikator konta nie wychodzi z helpera.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  token: null as string | null,
  bearerThrows: false,
  verifyUser: vi.fn<() => Promise<string | null>>(),
}));

vi.mock("@/lib/auth/optionalUser.server", () => ({
  optionalBearerFromRequest: async () => {
    if (h.bearerThrows) throw new Error("brak kontekstu żądania");
    return h.token;
  },
  optionalUserIdFromRequest: h.verifyUser,
}));

import {
  SIGNED_IN_VERDICT_CACHE_LIMIT,
  SIGNED_IN_VERDICT_TTL_MS,
  resetSignedInVerdictCacheForTests,
  signedInFromRequest,
} from "@/lib/analytics/signedIn.server";

const USER_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
/** Stały punkt startu zegara - bez literału daty (bramka check:clock-freeze). */
const T0 = 1_800_000_000_000;

/** JWT o zadanym `exp` (sekundy). Podpis jest atrapą - weryfikację robi mock. */
function jwt(expSeconds: number | null, salt = "a"): string {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const payload = expSeconds === null ? { sub: "x" } : { sub: "x", exp: expSeconds };
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.podpis-${salt}`;
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  h.token = null;
  h.bearerThrows = false;
  h.verifyUser.mockReset();
  h.verifyUser.mockResolvedValue(USER_ID);
  resetSignedInVerdictCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signedInFromRequest", () => {
  it("BRAK bearera = false bez weryfikacji", async () => {
    expect(await signedInFromRequest()).toBe(false);
    expect(h.verifyUser).not.toHaveBeenCalled();
  });

  it("zweryfikowany bearer = true; wynik to BIT, nie identyfikator konta", async () => {
    h.token = jwt(null);

    const result = await signedInFromRequest();

    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("odrzucony podpis = false", async () => {
    h.token = jwt(null);
    h.verifyUser.mockResolvedValue(null);

    expect(await signedInFromRequest()).toBe(false);
  });

  it("weryfikacja RZUCA = false, nie wyjątek", async () => {
    h.token = jwt(null);
    h.verifyUser.mockRejectedValue(new Error("Auth nie odpowiada"));

    await expect(signedInFromRequest()).resolves.toBe(false);
  });

  it("odczyt nagłówka RZUCA = false, nie wyjątek", async () => {
    h.bearerThrows = true;

    await expect(signedInFromRequest()).resolves.toBe(false);
    expect(h.verifyUser).not.toHaveBeenCalled();
  });

  it("ten sam token w TTL jest weryfikowany RAZ", async () => {
    h.token = jwt(null);

    expect(await signedInFromRequest()).toBe(true);
    vi.advanceTimersByTime(SIGNED_IN_VERDICT_TTL_MS - 1);
    expect(await signedInFromRequest()).toBe(true);

    expect(h.verifyUser).toHaveBeenCalledTimes(1);
  });

  it("po TTL werdykt jest liczony od nowa - wylogowanie dociera najpóźniej po 5 min", async () => {
    h.token = jwt(null);
    await signedInFromRequest();

    vi.advanceTimersByTime(SIGNED_IN_VERDICT_TTL_MS);
    h.verifyUser.mockResolvedValue(null);

    expect(await signedInFromRequest()).toBe(false);
    expect(h.verifyUser).toHaveBeenCalledTimes(2);
  });

  it("INNY token to inny wpis - werdykt jednego nie przechodzi na drugi", async () => {
    h.token = jwt(null, "a");
    expect(await signedInFromRequest()).toBe(true);

    h.token = jwt(null, "b");
    h.verifyUser.mockResolvedValue(null);
    expect(await signedInFromRequest()).toBe(false);

    expect(h.verifyUser).toHaveBeenCalledTimes(2);
  });

  it("werdykt NEGATYWNY też jest pamiętany - podróbka nie kosztuje round-tripu na żądanie", async () => {
    h.token = jwt(null);
    h.verifyUser.mockResolvedValue(null);

    for (let i = 0; i < 5; i += 1) expect(await signedInFromRequest()).toBe(false);

    expect(h.verifyUser).toHaveBeenCalledTimes(1);
  });

  it("werdykt pozytywny NIE przeżywa `exp` tokenu krótszego niż TTL", async () => {
    // Token ważny jeszcze minutę: po niej ten sam bearer jest już anonimem,
    // więc pamięć nie może go dalej liczyć jako zalogowanego.
    h.token = jwt(T0 / 1000 + 60);
    expect(await signedInFromRequest()).toBe(true);

    vi.advanceTimersByTime(59_000);
    expect(await signedInFromRequest()).toBe(true);
    expect(h.verifyUser).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_000);
    h.verifyUser.mockResolvedValue(null);
    expect(await signedInFromRequest()).toBe(false);
    expect(h.verifyUser).toHaveBeenCalledTimes(2);
  });

  it("`exp` DALEKI nie wydłuża werdyktu ponad TTL", async () => {
    h.token = jwt(T0 / 1000 + 24 * 3600);
    await signedInFromRequest();

    vi.advanceTimersByTime(SIGNED_IN_VERDICT_TTL_MS);
    await signedInFromRequest();

    expect(h.verifyUser).toHaveBeenCalledTimes(2);
  });

  it("token z nieczytelnym ładunkiem dostaje zwykły TTL (exp jest tylko skróceniem)", async () => {
    h.token = "nie-jwt.%%%.podpis";
    expect(await signedInFromRequest()).toBe(true);

    vi.advanceTimersByTime(SIGNED_IN_VERDICT_TTL_MS - 1);
    expect(await signedInFromRequest()).toBe(true);
    expect(h.verifyUser).toHaveBeenCalledTimes(1);
  });

  it("LIMIT wpisów czyści pamięć w całości - zero wzrostu bez granic", async () => {
    for (let i = 0; i < SIGNED_IN_VERDICT_CACHE_LIMIT; i += 1) {
      h.token = jwt(null, `t${i}`);
      await signedInFromRequest();
    }
    expect(h.verifyUser).toHaveBeenCalledTimes(SIGNED_IN_VERDICT_CACHE_LIMIT);

    // Pierwszy wpis jest jeszcze w pamięci - limit nie został przekroczony.
    h.token = jwt(null, "t0");
    await signedInFromRequest();
    expect(h.verifyUser).toHaveBeenCalledTimes(SIGNED_IN_VERDICT_CACHE_LIMIT);

    // Wpis ponad limit czyści pamięć...
    h.token = jwt(null, "ponad-limit");
    await signedInFromRequest();
    expect(h.verifyUser).toHaveBeenCalledTimes(SIGNED_IN_VERDICT_CACHE_LIMIT + 1);

    // ...więc pierwszy token jest weryfikowany ponownie.
    h.token = jwt(null, "t0");
    await signedInFromRequest();
    expect(h.verifyUser).toHaveBeenCalledTimes(SIGNED_IN_VERDICT_CACHE_LIMIT + 2);
  });

  it("hook testowy czyści pamięć", async () => {
    h.token = jwt(null);
    await signedInFromRequest();

    resetSignedInVerdictCacheForTests();
    await signedInFromRequest();

    expect(h.verifyUser).toHaveBeenCalledTimes(2);
  });
});
