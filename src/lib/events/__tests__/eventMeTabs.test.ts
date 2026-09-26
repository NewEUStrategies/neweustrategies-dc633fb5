// Zakładki panelu „moje wydarzenie": lista, parser i ZERO importów modułu.
//
// ZERO IMPORTÓW to wymóg paczki startowej: `validateSearch` trasy wykonuje się
// w chunku wejściowym, a każdy import tego modułu wciągnąłby tam swój graf.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EVENT_ME_TABS, parseEventMeTab } from "@/lib/events/eventMeTabs";

describe("eventMeTabs", () => {
  it("kolejność zakładek jest kontraktem panelu", () => {
    expect(EVENT_ME_TABS).toEqual([
      "profile",
      "schedule",
      "contacts",
      "networking",
      "registration",
      "follow-up",
    ]);
  });

  it.each(EVENT_ME_TABS.map((tab) => [tab]))("przyjmuje %s", (tab) => {
    expect(parseEventMeTab(tab)).toBe(tab);
  });

  it.each([undefined, null, "", "Profile", "follow_up", 1, ["schedule"], { tab: "profile" }])(
    "odrzuca %j (undefined = zakładka domyślna)",
    (value) => {
      expect(parseEventMeTab(value)).toBeUndefined();
    },
  );

  it("moduł nie ma żadnego importu", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/events/eventMeTabs.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bimport\(/);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
