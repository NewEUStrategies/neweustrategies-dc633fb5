import { describe, expect, it } from "vitest";
import { deriveAccountState } from "../accountAdmin.functions";

const BASE = {
  bannedUntil: null,
  emailConfirmedAt: "2026-09-06T20:28:49.000Z",
  invitedAt: null,
  lastSignInAt: "2026-09-06T20:28:49.000Z",
  invitationId: "11111111-1111-4111-8111-111111111111",
  invitationStatus: "accepted",
  invitationSentAt: "2026-09-06T20:28:49.000Z",
  invitationAutoAccepted: true,
} as const;

describe("deriveAccountState", () => {
  it("nie uznaje administracyjnej autoakceptacji za aktywację odbiorcy", () => {
    expect(deriveAccountState(BASE)).toBe("invited");
  });

  it("uznaje konto za aktywne po późniejszym rzeczywistym logowaniu", () => {
    expect(
      deriveAccountState({
        ...BASE,
        lastSignInAt: "2026-09-06T20:30:00.000Z",
      }),
    ).toBe("active");
  });

  it("zachowuje blokadę jako stan nadrzędny", () => {
    expect(deriveAccountState({ ...BASE, bannedUntil: "2027-01-01T00:00:00.000Z" })).toBe("banned");
  });
});
