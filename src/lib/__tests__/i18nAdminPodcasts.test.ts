import { describe, expect, it } from "vitest";
import { adminPodcastsPl, adminPodcastsEn } from "@/lib/i18n-admin-podcasts";

function keyPaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyPaths(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const PL = adminPodcastsPl as unknown as Record<string, unknown>;
const EN = adminPodcastsEn as unknown as Record<string, unknown>;

// Ta sama reguła co w pozostałych bundlach: polski ma więcej kategorii mnogości
// (one/few/many/other) niż angielski (one/other), więc porównujemy klucz bazowy.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const baseKeys = (paths: string[]): Set<string> =>
  new Set(paths.map((k) => k.replace(PLURAL_SUFFIX, "")));

describe("i18n admin podcasts bundle (pl/en)", () => {
  it("PL and EN expose an identical key structure", () => {
    const plKeys = baseKeys(keyPaths(PL));
    const enKeys = baseKeys(keyPaths(EN));
    const onlyPl = [...plKeys].filter((k) => !enKeys.has(k)).sort();
    const onlyEn = [...enKeys].filter((k) => !plKeys.has(k)).sort();
    expect({ onlyPl, onlyEn }).toEqual({ onlyPl: [], onlyEn: [] });
  });

  it("has no empty leaf strings", () => {
    for (const [label, tree] of [
      ["pl", PL],
      ["en", EN],
    ] as const) {
      const empties = keyPaths(tree).filter((path) => {
        const value = path
          .split(".")
          .reduce<unknown>(
            (acc, seg) =>
              acc && typeof acc === "object" ? (acc as Record<string, unknown>)[seg] : undefined,
            tree,
          );
        return typeof value === "string" && value.trim() === "";
      });
      expect({ [label]: empties }).toEqual({ [label]: [] });
    }
  });

  it("covers every Apple Podcasts Connect field and readiness code", () => {
    // Karta gotowości i formularz tłumaczą kody z `podcastFeedReadiness`
    // dynamicznie (`t(\`...blocking.${code}\`)`), więc brak klucza objawiłby się
    // dopiero surowym kodem w interfejsie.
    const required = [
      "author",
      "ownerName",
      "ownerEmail",
      "category",
      "subcategory",
      "explicit",
      "showType",
      "image",
      "copyright",
    ];
    const blocking = ["title", "description", "language", "image", "ownerEmail", "episodes"];
    const warnings = ["author", "ownerName", "copyright", "enclosureLength", "duration"];

    for (const [label, tree] of [
      ["pl", adminPodcastsPl],
      ["en", adminPodcastsEn],
    ] as const) {
      const apple = tree.adminPodcasts.settings.apple as unknown as Record<string, unknown>;
      for (const key of required) expect(apple[key], `${label}.${key}`).toBeTruthy();
      const blockingTree = apple.blocking as Record<string, unknown>;
      for (const key of blocking)
        expect(blockingTree[key], `${label}.blocking.${key}`).toBeTruthy();
      const warningTree = apple.warnings as Record<string, unknown>;
      for (const key of warnings) expect(warningTree[key], `${label}.warnings.${key}`).toBeTruthy();
    }
  });
});
