import { describe, expect, it } from "vitest";
import { deriveAccountState } from "../accountAdmin.functions";
import { DZIEN, MINUTA, freezeClock, relativeIso } from "@/test/time";

freezeClock();

const BASE = {
  bannedUntil: null,
  emailConfirmedAt: relativeIso(-DZIEN),
  invitedAt: null,
  lastSignInAt: relativeIso(-DZIEN),
  invitationId: "11111111-1111-4111-8111-111111111111",
  invitationStatus: "accepted",
  invitationSentAt: relativeIso(-DZIEN),
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
        lastSignInAt: relativeIso(-DZIEN + MINUTA),
      }),
    ).toBe("active");
  });

  it("zachowuje blokadę jako stan nadrzędny", () => {
    expect(deriveAccountState({ ...BASE, bannedUntil: relativeIso(DZIEN) })).toBe("banned");
  });
});
