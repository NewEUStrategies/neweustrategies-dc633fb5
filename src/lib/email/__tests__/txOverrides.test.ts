import { describe, expect, it } from "vitest";

import {
  EDITABLE_TX_TYPES,
  interpolate,
  isEditableTxType,
  overrideFor,
  parseTxOverrides,
  resolvedField,
  TX_OVERRIDES_DEFAULTS,
  TxOverridesSchema,
} from "../txOverrides";

describe("txOverrides", () => {
  it("keeps every seat lifecycle type editable", () => {
    expect(EDITABLE_TX_TYPES).toEqual([
      "team_seat_grace",
      "team_seat_grace_reminder",
      "team_seat_access_ended",
    ]);
    expect(isEditableTxType("team_seat_grace")).toBe(true);
    expect(isEditableTxType("subscription_confirmed")).toBe(false);
  });

  it("defaults to empty strings so templates keep their copy", () => {
    const o = overrideFor(TX_OVERRIDES_DEFAULTS, "team_seat_grace", "pl");
    expect(o.subject).toBe("");
    expect(resolvedField(o, "subject", {})).toBeNull();
  });

  it("interpolates event tokens and drops unknown ones", () => {
    expect(
      interpolate("Dostęp w {orgName} kończy się {accessUntil} ({daysLeft} dni) {nope}", {
        orgName: "Acme",
        accessUntil: "29 sierpnia 2026",
        daysLeft: 7,
      }),
    ).toBe("Dostęp w Acme kończy się 29 sierpnia 2026 (7 dni)");
  });

  it("resolves an admin-edited field per language", () => {
    const parsed = TxOverridesSchema.parse({
      team_seat_access_ended: {
        pl: { heading: "Koniec dostępu - {orgName}" },
        en: { heading: "Access ended - {orgName}" },
      },
    });
    expect(
      resolvedField(overrideFor(parsed, "team_seat_access_ended", "pl"), "heading", {
        orgName: "Acme",
      }),
    ).toBe("Koniec dostępu - Acme");
    expect(
      resolvedField(overrideFor(parsed, "team_seat_access_ended", "en"), "heading", {
        orgName: "Acme",
      }),
    ).toBe("Access ended - Acme");
  });

  it("falls back to defaults on malformed stored settings", () => {
    expect(parseTxOverrides({ team_seat_grace: 42 })).toEqual(TX_OVERRIDES_DEFAULTS);
    expect(parseTxOverrides(null)).toEqual(TX_OVERRIDES_DEFAULTS);
  });
});
