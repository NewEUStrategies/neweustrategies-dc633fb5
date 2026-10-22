import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUILDER_TOUR_STEPS,
  BLOCK_TOUR_STEPS,
  JOURNEYS_TOUR_STEPS,
  JOURNEY_EDITOR_TOUR_STEPS,
} from "@/lib/onboarding/tours";
// `admin.*` żyje w nakładce panelu, nie w rdzeniu `locale/*.ts` (rdzeń niesie
// z tej gałęzi tylko cztery klucze dialogu niezapisanych zmian).
import { adminCorePl as pl, adminCoreEn as en } from "@/lib/i18n-admin-core";

// Walk a dotted key path ("admin.onboarding.builder.widgets.title") through a
// nested dictionary object, returning the string leaf or undefined.
function resolve(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, dict);
}

const ALL_STEPS = [
  ...BUILDER_TOUR_STEPS,
  ...BLOCK_TOUR_STEPS,
  ...JOURNEYS_TOUR_STEPS,
  ...JOURNEY_EDITOR_TOUR_STEPS,
];

describe("onboarding tours", () => {
  it("every step references a title/body key that resolves to a non-empty string in PL and EN", () => {
    for (const step of ALL_STEPS) {
      for (const key of [step.titleKey, step.bodyKey]) {
        const plVal = resolve(pl, key);
        const enVal = resolve(en, key);
        expect(typeof plVal, `PL missing: ${key}`).toBe("string");
        expect((plVal as string).length, `PL empty: ${key}`).toBeGreaterThan(0);
        expect(typeof enVal, `EN missing: ${key}`).toBe("string");
        expect((enVal as string).length, `EN empty: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("resolves the shared common keys in both languages", () => {
    for (const key of [
      "admin.onboarding.common.next",
      "admin.onboarding.common.back",
      "admin.onboarding.common.skip",
      "admin.onboarding.common.done",
      "admin.onboarding.common.stepOf",
      "admin.onboarding.common.close",
    ]) {
      expect(typeof resolve(pl, key), `PL missing: ${key}`).toBe("string");
      expect(typeof resolve(en, key), `EN missing: ${key}`).toBe("string");
    }
  });

  it("uses namespaced anchors so the two tours never spotlight each other", () => {
    expect(BUILDER_TOUR_STEPS.every((s) => s.anchor?.startsWith("builder-"))).toBe(true);
    expect(BLOCK_TOUR_STEPS.every((s) => s.anchor?.startsWith("blocks-"))).toBe(true);
    expect(JOURNEYS_TOUR_STEPS.every((s) => s.anchor?.startsWith("journeys-"))).toBe(true);
    expect(JOURNEY_EDITOR_TOUR_STEPS.every((s) => s.anchor?.startsWith("journey-"))).toBe(true);
  });

  // Integrator S8: kotwice wycieczek Ścieżek to atrybuty `data-tour`, które
  // komponenty S8 naprawdę renderują - zmiana nazwy w komponencie bez zmiany
  // kroku zapala ten test, zamiast zostawić krok bez podświetlenia.
  it("każda kotwica wycieczki Ścieżek istnieje jako data-tour w komponencie S8", () => {
    const sources: Record<string, string> = {
      "journeys-engine": "src/components/admin/journeys/list/JourneyEngineHealthStrip.tsx",
      "journeys-list": "src/components/admin/revenue/tabs/RevenueJourneysTab.tsx",
      "journeys-gallery": "src/components/admin/journeys/list/JourneyTemplateGallery.tsx",
      "journeys-engine-settings": "src/components/admin/journeys/list/JourneySettingsDialog.tsx",
      "journey-canvas": "src/components/admin/journeys/editor/JourneyCanvas.tsx",
      "journey-publish": "src/components/admin/journeys/editor/JourneyToolbar.tsx",
    };
    const anchors = [...JOURNEYS_TOUR_STEPS, ...JOURNEY_EDITOR_TOUR_STEPS].map((s) => s.anchor);
    expect(anchors.sort()).toEqual(Object.keys(sources).sort());
    for (const [anchor, file] of Object.entries(sources)) {
      expect(readFileSync(file, "utf8"), `${anchor} w ${file}`).toContain(`data-tour="${anchor}"`);
    }
  });
});
