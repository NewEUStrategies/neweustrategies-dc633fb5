import { describe, expect, it } from "vitest";
import { homeLabel } from "../commonLabels";
import { uiLang } from "../format";

describe("homeLabel - etykieta „start” okruszków i JSON-LD", () => {
  it.each([
    ["pl", "Start"],
    ["pl-PL", "Start"],
    ["en", "Home"],
    ["en-GB", "Home"],
    ["en-US", "Home"],
  ])("%s -> %s", (lang, expected) => {
    expect(homeLabel(lang)).toBe(expected);
  });

  it("brak języka to język domyślny serwisu (polski)", () => {
    expect(homeLabel(undefined)).toBe("Start");
    // `head()` i JSON-LD potrafią dostać `null` z danych nieotypowanych -
    // etykieta ma się wtedy zdegradować, nie wywrócić SSR.
    expect(homeLabel(null as unknown as undefined)).toBe("Start");
  });

  it("język spoza pary pl/en dostaje etykietę polską", () => {
    expect(homeLabel("de")).toBe("Start");
    expect(homeLabel("")).toBe("Start");
  });

  it("rozstrzyga język tą samą regułą co uiLang (jedna normalizacja w repozytorium)", () => {
    for (const raw of [undefined, "", "pl", "pl-PL", "en", "en-GB", "en-US", "de", "EN"]) {
      expect(homeLabel(raw)).toBe(uiLang(raw) === "en" ? "Home" : "Start");
    }
  });
});
