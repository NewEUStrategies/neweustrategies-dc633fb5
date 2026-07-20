import { describe, it, expect } from "vitest";
import i18n, { ensureCoreLanguage } from "@/lib/i18n";

// Guards the mechanism behind the per-request SSR fix (getRenderI18n): a clone
// must carry its own language yet share the singleton's resource store, so two
// concurrent requests of different languages can render correctly without the
// singleton's `.language` racing between them.
describe("per-request i18n clone", () => {
  it("isolates language per clone while sharing resources", async () => {
    // Klony per request istnieją tylko na SERWERZE, gdzie init ładuje OBA
    // języki. Vitest inicjalizuje moduł w trybie klienckim (tylko aktywny
    // język), więc dociągamy EN jawnie - test sprawdza izolację języka
    // klona, nie strategię ładowania słowników.
    await ensureCoreLanguage("en");
    await i18n.changeLanguage("pl");

    const en = i18n.cloneInstance({ lng: "en" });
    const pl = i18n.cloneInstance({ lng: "pl" });

    // Each clone keeps its own language...
    expect(en.language).toBe("en");
    expect(pl.language).toBe("pl");
    // ...and cloning does not mutate the shared singleton.
    expect(i18n.language).toBe("pl");

    // Resources are shared (not an empty fresh instance) and language-correct.
    expect(en.t("auth.signin")).toBe("Sign in");
    expect(pl.t("auth.signin")).toBe("Zaloguj się");
  });

  it("a clone's language is unaffected by later singleton changes", async () => {
    await i18n.changeLanguage("pl");
    const en = i18n.cloneInstance({ lng: "en" });
    await i18n.changeLanguage("en");
    // Flipping the singleton must not retro-change an already-created clone.
    expect(en.language).toBe("en");
    await i18n.changeLanguage("pl");
    expect(en.language).toBe("en");
  });
});
