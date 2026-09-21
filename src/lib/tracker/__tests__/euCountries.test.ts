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
import { CHART_SEMANTIC, slotAt } from "@/lib/charts/palette";

describe("STANCE_META - awaryjny hex nie odkleja się od tokena", () => {
  it("hex każdego stanowiska jest DOKŁADNIE jasną wartością swojego tokena", () => {
    // `hex` jest kopią wartości jasnej dla miejsc, które nie umieją podać
    // `var()` (kanwa, eksport PNG). Komentarz przy STANCE_META mówi, że przy
    // zmianie palety zmienia się razem z tokenem - dopóki nikt tego nie
    // sprawdza, jest to obietnica, a nie warunek: po przebudowie palety mapa
    // na ekranie pokazywałaby nowy kolor, a wyeksportowany PNG stary.
    const zTokena: Record<string, string> = {
      "var(--chart-positive)": CHART_SEMANTIC.positiveLight,
      "var(--chart-negative)": CHART_SEMANTIC.negativeLight,
    };
    for (const meta of STANCE_META) {
      const slot = /^var\(--chart-(\d+)\)$/.exec(meta.cssVar);
      const oczekiwany = slot ? slotAt(Number(slot[1])).light : zTokena[meta.cssVar];
      // `--chart-axis` nie jest kolorem palety serii i nie ma go w module -
      // ten wpis zostaje poza regułą, bo reguła dotyczy palety.
      if (!oczekiwany) continue;
      expect(meta.hex, meta.key).toBe(oczekiwany);
    }
  });
});

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
    const raw = readFileSync(join(process.cwd(), "public/geo/europe-50m.v2.json"), "utf8");
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
