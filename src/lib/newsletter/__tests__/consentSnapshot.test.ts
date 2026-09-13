import { describe, it, expect } from "vitest";
import { snapshotConsents, type ConsentSnapshotInput } from "../consentSnapshot";

const entry: ConsentSnapshotInput = {
  key: "privacy",
  text: "Polityka prywatności",
  lang: "pl",
  given: true,
};
const at = "2026-09-13T20:00:00.000Z";

describe("consent content revision", () => {
  it("preserves the displayed content and interaction time", async () => {
    const [result] = await snapshotConsents([entry], at);
    expect(result).toMatchObject({ ...entry, timestamp: at });
    expect(result.version).toMatch(/^sha256:[a-f0-9]{24}$/);
  });
  it("is stable across submissions and changes with text, language or purpose", async () => {
    const [original] = await snapshotConsents([entry], at);
    const [later] = await snapshotConsents([entry], "2026-09-14T20:00:00.000Z");
    expect(later.version).toBe(original.version);
    const changed = await snapshotConsents(
      [
        { ...entry, text: "Zmieniona polityka" },
        { ...entry, lang: "en" },
        { ...entry, key: "terms" },
      ],
      at,
    );
    for (const result of changed) expect(result.version).not.toBe(original.version);
  });
});
