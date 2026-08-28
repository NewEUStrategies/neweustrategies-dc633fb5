// Nadania stawek: stan wiersza i ksztalt tokenu zaproszenia kupujacego.
import { describe, expect, it } from "vitest";

import {
  AUDIENCE_GRANT_AUDIENCES,
  AUDIENCE_GRANT_STATES,
  audienceGrantState,
  type EventAudienceGrantRow,
} from "@/lib/events/audienceGrantsApi";
import { isPackageInviteToken } from "@/lib/events/packageInviteApi";

function row(state: string): EventAudienceGrantRow {
  return {
    audience: "academic",
    company_id: "",
    company_name: "",
    created_at: "2026-01-01T00:00:00Z",
    event_id: "",
    event_title: "",
    evidence: "student card 1",
    id: "1",
    person_id: "",
    revoked_at: "",
    state,
    subject_email: "",
    subject_name: "",
    user_id: "",
    valid_from: "",
    valid_until: "",
  };
}

describe("audienceGrantState", () => {
  it("passes through every state the database can compute", () => {
    for (const state of AUDIENCE_GRANT_STATES) {
      expect(audienceGrantState(row(state))).toBe(state);
    }
  });

  it("falls back to active for a state it does not know", () => {
    expect(audienceGrantState(row("pending-approval"))).toBe("active");
  });

  it("knows exactly the three audiences the database accepts", () => {
    expect([...AUDIENCE_GRANT_AUDIENCES]).toEqual(["academic", "ngo", "company"]);
  });
});

describe("isPackageInviteToken", () => {
  it("accepts the organiser token (32 chars, base64url)", () => {
    expect(isPackageInviteToken("abcdefghijklmnopqrstuvwxyz012345")).toBe(true);
  });

  it("accepts the buyer token (two UUIDs without dashes, 64 chars)", () => {
    expect(isPackageInviteToken("a".repeat(64))).toBe(true);
  });

  it("rejects a truncated or padded link", () => {
    expect(isPackageInviteToken("short")).toBe(false);
    expect(isPackageInviteToken(`${"a".repeat(32)}=`)).toBe(false);
  });
});
