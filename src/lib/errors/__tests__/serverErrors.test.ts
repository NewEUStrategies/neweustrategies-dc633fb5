// Testy mapowania błędów serwera na przyjazne komunikaty i18n (PL/EN).
import { describe, expect, it } from "vitest";
import {
  CsrfError,
  RateLimitError,
  SERVER_ERROR_CODE,
  mapServerError,
} from "@/lib/errors/serverErrors";

describe("mapServerError", () => {
  it("rozpoznaje RateLimitError i podaje PL komunikat", () => {
    const m = mapServerError(new RateLimitError("newsletter.subscribe"), "pl");
    expect(m?.title).toBe("Zbyt wiele żądań");
    expect(m?.description).toContain("Spróbuj ponownie");
  });

  it("dokleja retryAfterSec do opisu gdy dostępny", () => {
    const m = mapServerError(new RateLimitError("scope", 30), "en");
    expect(m?.description).toContain("30");
  });

  it("rozpoznaje CsrfError w EN", () => {
    const m = mapServerError(new CsrfError(), "en");
    expect(m?.title).toBe("Session expired");
  });

  it("łapie surowy Error z prefiksem kodu (server-fn granica)", () => {
    const m = mapServerError(new Error(`${SERVER_ERROR_CODE.csrf}: token missing`), "pl");
    expect(m?.title).toBe("Sesja wygasła");
  });

  it("łapie odpowiedź 429 po statusie", () => {
    const m = mapServerError({ status: 429, message: "Too Many Requests" }, "pl");
    expect(m?.title).toBe("Zbyt wiele żądań");
  });

  it("łapie CSRF po statusie 403 + tekście", () => {
    const m = mapServerError({ status: 403, message: "invalid csrf token" }, "en");
    expect(m?.title).toBe("Session expired");
  });

  it("zwraca null dla nieznanego błędu (caller pokaże generyk)", () => {
    expect(mapServerError(new Error("boom"), "pl")).toBeNull();
    expect(mapServerError(null, "pl")).toBeNull();
  });
});
