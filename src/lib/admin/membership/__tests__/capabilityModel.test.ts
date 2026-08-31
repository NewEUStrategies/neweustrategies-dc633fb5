// Model „Bramek i limitów" warstwy członkostwa. Każda funkcja decyduje o tym,
// co płacący członek realnie dostaje, więc pilnujemy tu czterech inwariantów:
//   - błędny JSON nigdy nie wywraca panelu (pusty zestaw flag),
//   - wyłączenie flagi USUWA klucz (a nie zapisuje `false`, co bramki czytają
//     inaczej niż brak klucza),
//   - limit 0 / ujemny znika z JSON-a (brak świadczenia, nie „zero biletów"),
//   - flaga spoza rejestru pozostaje widoczna, żeby nie zniknęła po cichu.
import { describe, expect, it } from "vitest";

import {
  GATE_ORDER,
  TIER_LIMIT_KEYS,
  groupCapabilities,
  parseFeatureFlags,
  readLimit,
  serializeFeatureFlags,
  summarizeCapabilities,
  toggleCapability,
  unknownFlagKeys,
  writeLimit,
} from "@/lib/admin/membership/capabilityModel";
import { TIER_CAPABILITIES } from "@/lib/billing/capabilities";

describe("parseFeatureFlags", () => {
  it("czyta poprawny obiekt", () => {
    expect(parseFeatureFlags('{"premium_content":true}')).toEqual({ premium_content: true });
  });

  it("pusty string i błędny JSON dają pusty obiekt", () => {
    expect(parseFeatureFlags("")).toEqual({});
    expect(parseFeatureFlags("{nope")).toEqual({});
  });

  it("tablica i null nie są zestawem flag", () => {
    expect(parseFeatureFlags("[1,2]")).toEqual({});
    expect(parseFeatureFlags("null")).toEqual({});
  });

  it("zwraca kopię - mutacja wyniku nie dotyka wejścia", () => {
    const json = '{"a":true}';
    const flags = parseFeatureFlags(json);
    flags.b = true;
    expect(parseFeatureFlags(json)).toEqual({ a: true });
  });
});

describe("serializeFeatureFlags", () => {
  it("zapisuje płaski JSON bez wcięć", () => {
    expect(serializeFeatureFlags({ a: true })).toBe('{"a":true}');
  });
});

describe("groupCapabilities", () => {
  const json = JSON.stringify({ premium_content: true, working_groups: true });

  it("grupuje po obszarze w kolejności GATE_ORDER", () => {
    const gates = groupCapabilities(json, "pl").map((g) => g.gate);
    expect(gates).toEqual(GATE_ORDER.filter((g) => gates.includes(g)));
  });

  it("nie gubi żadnej flagi z rejestru", () => {
    const total = groupCapabilities(json, "pl").reduce((sum, g) => sum + g.totalCount, 0);
    expect(total).toBe(TIER_CAPABILITIES.length);
  });

  it("liczy włączone flagi w grupie", () => {
    const content = groupCapabilities(json, "pl").find((g) => g.gate === "content");
    expect(content?.enabledCount).toBe(1);
    expect(content?.items.find((i) => i.key === "premium_content")?.enabled).toBe(true);
  });

  it("egzekwowane idą przed dekoracyjnymi", () => {
    for (const group of groupCapabilities(json, "pl")) {
      const flags = group.items.map((i) => i.enforced);
      expect([...flags].sort((a, b) => Number(b) - Number(a))).toEqual(flags);
    }
  });

  it("opis punktu egzekwowania jest w języku panelu", () => {
    const pl = groupCapabilities(json, "pl")
      .flatMap((g) => g.items)
      .find((i) => i.key === "premium_content");
    const en = groupCapabilities(json, "en")
      .flatMap((g) => g.items)
      .find((i) => i.key === "premium_content");
    expect(pl?.where).toContain("Paywall treści");
    expect(en?.where).toContain("Content paywall");
  });
});

describe("summarizeCapabilities", () => {
  it("rozdziela włączone na egzekwowane i deklarowane", () => {
    const summary = summarizeCapabilities(
      JSON.stringify({ premium_content: true, working_groups: true, vip_concierge: true }),
    );
    expect(summary).toEqual({
      enabled: 3,
      enforced: 1,
      decorative: 2,
      total: TIER_CAPABILITIES.length,
    });
  });

  it("pusty draft = zero włączonych", () => {
    expect(summarizeCapabilities("{}").enabled).toBe(0);
  });

  it("wartość inna niż true nie liczy się jako włączona", () => {
    expect(summarizeCapabilities('{"premium_content":"yes"}').enabled).toBe(0);
  });
});

describe("toggleCapability", () => {
  it("włącza flagę", () => {
    expect(toggleCapability("{}", "recordings")).toBe('{"recordings":true}');
  });

  it("wyłączenie USUWA klucz zamiast zapisywać false", () => {
    expect(toggleCapability('{"recordings":true}', "recordings")).toBe("{}");
  });

  it("nie rusza pozostałych flag", () => {
    expect(JSON.parse(toggleCapability('{"a":true}', "recordings"))).toEqual({
      a: true,
      recordings: true,
    });
  });
});

describe("readLimit / writeLimit", () => {
  it("czyta liczbę i liczbę w stringu", () => {
    expect(readLimit('{"included_event_tickets":3}', "included_event_tickets")).toBe(3);
    expect(readLimit('{"included_event_tickets":"4"}', "included_event_tickets")).toBe(4);
  });

  it("brak klucza, pusty string i śmieci dają 0", () => {
    expect(readLimit("{}", "included_event_tickets")).toBe(0);
    expect(readLimit('{"included_event_tickets":""}', "included_event_tickets")).toBe(0);
    expect(readLimit('{"included_event_tickets":"abc"}', "included_event_tickets")).toBe(0);
    expect(readLimit('{"included_event_tickets":true}', "included_event_tickets")).toBe(0);
  });

  it("zapisuje limit i obcina do liczby całkowitej", () => {
    expect(writeLimit("{}", "included_event_tickets", 2.7)).toBe('{"included_event_tickets":2}');
  });

  it("zero i wartość ujemna usuwają klucz", () => {
    expect(writeLimit('{"included_event_tickets":3}', "included_event_tickets", 0)).toBe("{}");
    expect(writeLimit('{"included_event_tickets":3}', "included_event_tickets", -5)).toBe("{}");
    expect(writeLimit('{"included_event_tickets":3}', "included_event_tickets", Number.NaN)).toBe(
      "{}",
    );
  });

  it("górny limit to 9999", () => {
    expect(writeLimit("{}", "included_event_tickets", 100000)).toBe(
      '{"included_event_tickets":9999}',
    );
  });
});

describe("TIER_LIMIT_KEYS", () => {
  it("pomija expert_request_quota (ma własny edytor)", () => {
    expect(TIER_LIMIT_KEYS).not.toContain("expert_request_quota");
    expect(TIER_LIMIT_KEYS).toContain("included_event_tickets");
  });
});

describe("unknownFlagKeys", () => {
  it("pokazuje wyłącznie flagi spoza rejestru, posortowane", () => {
    const json = JSON.stringify({
      premium_content: true,
      expert_request_quota: 3,
      zeta_flag: true,
      alpha_flag: true,
    });
    expect(unknownFlagKeys(json)).toEqual(["alpha_flag", "zeta_flag"]);
  });

  it("pusty draft nie ma flag nieznanych", () => {
    expect(unknownFlagKeys("{}")).toEqual([]);
  });
});
