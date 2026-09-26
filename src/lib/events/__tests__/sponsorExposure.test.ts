// Słownik pomiaru ekspozycji sponsorów (`sponsorExposure.ts`).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. PRZEGLĄDARKA WYSYŁA RZECZY SKAZANE NA ODRZUCENIE - klik w znaczek
//      agendy, otwarcie materiału bez materiału, reklama bez reklamy. Baza je
//      odrzuci, ale każda taka pozycja to zmarnowany beacon i fałszywa pewność,
//      że „pomiar działa".
//   2. LISTY ROZJEŻDŻAJĄ SIĘ Z CHECK-AMI BAZY - nowe miejsce po jednej stronie
//      daje albo ciche odrzucenie, albo wartość, której UI nie umie nazwać.
//   3. KSZTAŁT PRZEWODU - baza czyta snake_case, puste pola mają wypadać.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SPONSOR_EXPOSURE_KINDS,
  SPONSOR_PLACEMENTS,
  exposureToWire,
  isAcceptableExposure,
  isSponsorExposureKind,
  isSponsorPlacement,
  type SponsorExposureItem,
} from "@/lib/events/sponsorExposure";

const S = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";

function item(patch: Partial<SponsorExposureItem>): SponsorExposureItem {
  return { sponsorId: S, placement: "home_strip", kind: "view", ...patch };
}

describe("rozpoznawanie wartości", () => {
  it("miejsca i rodzaje - tylko wartości z listy, tylko napisy", () => {
    for (const placement of SPONSOR_PLACEMENTS) expect(isSponsorPlacement(placement)).toBe(true);
    for (const kind of SPONSOR_EXPOSURE_KINDS) expect(isSponsorExposureKind(kind)).toBe(true);
    expect(isSponsorPlacement("banner")).toBe(false);
    expect(isSponsorPlacement(7)).toBe(false);
    expect(isSponsorExposureKind("hover")).toBe(false);
    expect(isSponsorExposureKind(null)).toBe(false);
  });
});

describe("macierz miejsce x rodzaj (lustro bazy)", () => {
  it.each([
    ["pas partnerów - wyświetlenie", item({}), true],
    ["pas partnerów - kliknięcie", item({ kind: "click" }), true],
    ["sekcja - kliknięcie", item({ placement: "partners_section", kind: "click" }), true],
    ["zakładka - wyświetlenie", item({ placement: "partners_tab" }), true],
    ["agenda - wyświetlenie", item({ placement: "agenda_session" }), true],
    ["agenda - KLIKNIĘCIE odrzucone", item({ placement: "agenda_track", kind: "click" }), false],
    ["materiały - wyświetlenie grupy", item({ placement: "materials" }), true],
    [
      "materiały - kliknięcie bez materiału",
      item({ placement: "materials", kind: "click" }),
      false,
    ],
    [
      "materiały - otwarcie materiału",
      item({ placement: "materials", kind: "material_open", materialId: M }),
      true,
    ],
    [
      "otwarcie materiału poza materiałami",
      item({ placement: "home_strip", kind: "material_open", materialId: M }),
      false,
    ],
    ["otwarcie bez materiału", item({ placement: "materials", kind: "material_open" }), false],
    ["materiał przy zwykłym wyświetleniu", item({ materialId: M }), false],
    ["bez sponsora (nie reklama)", item({ sponsorId: null }), false],
    ["reklama przy logotypie", item({ homeAdId: A }), false],
    [
      "reklama - wyświetlenie bez sponsora",
      item({ placement: "home_ad", sponsorId: null, homeAdId: A }),
      true,
    ],
    ["reklama - kliknięcie", item({ placement: "home_ad", kind: "click", homeAdId: A }), true],
    ["reklama bez identyfikatora", item({ placement: "home_ad" }), false],
    ["reklama z materiałem", item({ placement: "home_ad", homeAdId: A, materialId: M }), false],
    [
      "reklama - otwarcie materiału",
      item({ placement: "home_ad", homeAdId: A, kind: "material_open" }),
      false,
    ],
  ] as const)("%s", (_label, input, expected) => {
    expect(isAcceptableExposure(input)).toBe(expected);
  });
});

describe("kształt przewodu", () => {
  it("snake_case, puste pola wypadają", () => {
    expect(exposureToWire(item({}))).toEqual({
      placement: "home_strip",
      kind: "view",
      sponsor_id: S,
    });
    expect(
      exposureToWire(item({ placement: "materials", kind: "material_open", materialId: M })),
    ).toEqual({ placement: "materials", kind: "material_open", sponsor_id: S, material_id: M });
    expect(
      exposureToWire({ sponsorId: null, placement: "home_ad", kind: "view", homeAdId: A }),
    ).toEqual({ placement: "home_ad", kind: "view", home_ad_id: A });
  });
});

describe("parytet z CHECK-ami migracji (ostatnia definicja wygrywa)", () => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");

  function lastIn(constraint: string): string[] {
    const re = new RegExp(
      `CONSTRAINT\\s+${constraint}\\s+CHECK\\s*\\(\\s*\\w+\\s+IN\\s*\\(([^)]*)\\)`,
      "gi",
    );
    const all = [...sql.matchAll(re)];
    expect(all.length, `brak ${constraint}`).toBeGreaterThan(0);
    return all[all.length - 1][1]
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .sort();
  }

  it("miejsca = event_sponsor_exposures_placement_values", () => {
    expect(lastIn("event_sponsor_exposures_placement_values")).toEqual(
      [...SPONSOR_PLACEMENTS].sort(),
    );
  });

  it("rodzaje = event_sponsor_exposures_kind_values", () => {
    expect(lastIn("event_sponsor_exposures_kind_values")).toEqual(
      [...SPONSOR_EXPOSURE_KINDS].sort(),
    );
  });
});
