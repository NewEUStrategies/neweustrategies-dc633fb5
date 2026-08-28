import { describe, expect, it } from "vitest";

import {
  isPackageInviteToken,
  readPackageInviteToken,
} from "@/lib/events/packageInviteApi";
import { packageInviteUrl } from "@/lib/events/packagesApi";
import { registrationFailure } from "@/lib/events/publicRegistrationErrors";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

describe("packageInviteApi - ksztalt tokenu", () => {
  it("przyjmuje 32 znaki base64url", () => {
    expect(isPackageInviteToken(TOKEN)).toBe(true);
    expect(isPackageInviteToken(`  ${TOKEN}  `)).toBe(true);
  });

  it("odrzuca zly ksztalt zanim ruszy zapytanie", () => {
    expect(isPackageInviteToken("krotki")).toBe(false);
    expect(isPackageInviteToken(`${TOKEN}!`)).toBe(false);
    expect(readPackageInviteToken(undefined)).toBeNull();
    expect(readPackageInviteToken(42)).toBeNull();
    expect(readPackageInviteToken(TOKEN)).toBe(TOKEN);
  });
});

describe("adres zaproszenia ma trase", () => {
  it("`packageInviteUrl` skalda adres, ktory parsuje sie na token trasy", () => {
    const url = packageInviteUrl("https://example.test", TOKEN);
    expect(url).toBe(`https://example.test/events/invite/${TOKEN}`);
    const segment = decodeURIComponent(url.split("/events/invite/")[1] ?? "");
    expect(readPackageInviteToken(segment)).toBe(TOKEN);
  });
});

describe("odmowy zaproszenia maja zdania", () => {
  it.each([
    ["invalid_token: the invitation is not valid", "eventRegistration.errors.invalidToken"],
    ["seat_taken: this invitation has already been used", "eventRegistration.errors.seatTaken"],
    [
      "invitation_expired: the invitation has expired",
      "eventRegistration.errors.invitationExpired",
    ],
    ["order_cancelled: the order is cancelled", "eventRegistration.errors.orderCancelled"],
    [
      "already_registered: this person already has an active registration",
      "eventRegistration.errors.alreadyRegistered",
    ],
    ["rate_limited: too many attempts", "eventRegistration.errors.rateLimited"],
  ])("%s -> %s", (message, key) => {
    expect(registrationFailure(new Error(message)).key).toBe(key);
  });
});
