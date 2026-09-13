import { describe, it, expect } from "vitest";
import { publicAuthError } from "./publicAuthError";

describe("public auth failures", () => {
  it.each([
    [{ code: "over_email_send_rate_limit" }, "rateLimited"],
    [{ code: "invalid_credentials" }, "invalidCredentials"],
    [new Error("Invalid login credentials"), "invalidCredentials"],
    [{ code: "email_not_confirmed" }, "emailNotConfirmed"],
    [{ message: "User already registered" }, "emailInUse"],
    [{ code: "weak_password" }, "weakPassword"],
    [{ code: "signup_disabled" }, "signupDisabled"],
    [{ code: "email_address_invalid" }, "invalidInput"],
    [new Error("internal db details"), "unavailable"],
    ["transport-down", "unavailable"],
    [null, "unavailable"],
  ])("maps %j to a safe translation key", (error, key) => {
    expect(publicAuthError(error)).toBe(key);
  });
});
