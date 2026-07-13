// Kontrakt modułu państw UE: kody ISO2 muszą istnieć w zasobie geometrii mapy
// (explorer maluje kraje po tych identyfikatorach) i być kompletne (27 państw).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EU_COUNTRIES,
  euCountryName,
  POSITION_STANCES,
  STANCE_META,
  stanceLabel,
  stanceMeta,
} from "@/lib/tracker/euCountries";

describe("EU_COUNTRIES", () => {
  it("zawiera dokładnie 27 unikalnych kodów ISO2", () => {
    const codes = EU_COUNTRIES.map((c) => c.code);
    expect(codes).toHaveLength(27);
    expect(new Set(codes).size).toBe(27);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("ma niepuste nazwy PL i EN dla każdego państwa", () => {
    for (const c of EU_COUNTRIES) {
      expect(c.pl.trim().length).toBeGreaterThan(0);
      expect(c.en.trim().length).toBeGreaterThan(0);
    }
  });

  it("każdy kod istnieje w zasobie geometrii europe-50m (mapa musi umieć go namalować)", () => {
    const raw = readFileSync(join(process.cwd(), "public/geo/europe-50m.v1.json"), "utf8");
    const asset = JSON.parse(raw) as { countries: { id: string }[] };
    const ids = new Set(asset.countries.map((c) => c.id));
    const missing = EU_COUNTRIES.filter((c) => !ids.has(c.code)).map((c) => c.code);
    expect(missing).toEqual([]);
  });

  it("euCountryName degraduje do kodu dla nieznanego państwa", () => {
    expect(euCountryName("PL", "pl")).toBe("Polska");
    expect(euCountryName("PL", "en")).toBe("Poland");
    expect(euCountryName("XX", "pl")).toBe("XX");
  });
});

describe("stanowiska (stance)", () => {
  it("STANCE_META pokrywa dokładnie POSITION_STANCES", () => {
    expect(STANCE_META.map((s) => s.key)).toEqual([...POSITION_STANCES]);
  });

  it("stanceMeta degraduje nieznaną wartość do 'undecided' (mapa nigdy nie pada)", () => {
    expect(stanceMeta("support").key).toBe("support");
    expect(stanceMeta("nonsense").key).toBe("undecided");
  });

  it("etykiety obu języków są niepuste", () => {
    for (const s of STANCE_META) {
      expect(stanceLabel(s.key, "pl").trim().length).toBeGreaterThan(0);
      expect(stanceLabel(s.key, "en").trim().length).toBeGreaterThan(0);
    }
  });
});
