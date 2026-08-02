// Kontrakt mapowania widoku listy leadów (saved_views) na parametry serwera
// listCrmLeads. Przy paginacji serwerowej filtr/sort MUSZĄ liczyć się w SQL -
// ten test pilnuje, że każdy filtr LeadFilterSchema ma swoje odwzorowanie
// i że defaulty nie wysyłają zbędnych parametrów.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEAD_FILTER,
  DEFAULT_LEAD_SORT,
  DEFAULT_LEAD_VIEW_CONFIG,
  leadViewToServerParams,
  parseLeadViewConfig,
  type LeadViewConfig,
} from "../leadViews";

const NOW = Date.parse("2026-08-02T12:00:00Z");

describe("leadViewToServerParams", () => {
  it("domyślny widok wysyła tylko sort (activity desc)", () => {
    expect(leadViewToServerParams(DEFAULT_LEAD_VIEW_CONFIG, NOW)).toEqual({
      sort: "activity",
      sort_dir: "desc",
    });
  });

  it("mapuje komplet filtrów i sortowania na parametry SQL", () => {
    const config: LeadViewConfig = {
      columns: ["name"],
      filter: {
        stage: "qualified",
        band: "hot",
        source: "newsletter",
        country: "Poland",
        company: "Example Sp. z o.o.",
        createdRange: "30d",
        activityRange: "7d",
        consentOnly: true,
      },
      sort: { key: "followUp", dir: "asc" },
    };
    const params = leadViewToServerParams(config, NOW);
    expect(params).toMatchObject({
      stage: "qualified",
      band: "hot",
      source: "newsletter",
      country: "Poland",
      company: "Example Sp. z o.o.",
      consent_only: true,
      sort: "followUp",
      sort_dir: "asc",
    });
    expect(params.created_from).toBe(new Date(NOW - 30 * 86_400_000).toISOString());
    expect(params.activity_from).toBe(new Date(NOW - 7 * 86_400_000).toISOString());
  });

  it("każdy klucz LeadSort ma odwzorowanie serwerowe", () => {
    const keys = [
      ["name", "name"],
      ["company", "company"],
      ["country", "country"],
      ["stage", "stage"],
      ["score", "score"],
      ["lastActivity", "activity"],
      ["created", "created"],
      ["followUp", "followUp"],
    ] as const;
    for (const [key, server] of keys) {
      const params = leadViewToServerParams(
        { ...DEFAULT_LEAD_VIEW_CONFIG, sort: { key, dir: "desc" } },
        NOW,
      );
      expect(params.sort).toBe(server);
    }
  });
});

describe("parseLeadViewConfig", () => {
  it("niepoprawny config wraca do domyślnego (odporność na zepsute saved_views)", () => {
    expect(parseLeadViewConfig(null)).toEqual(DEFAULT_LEAD_VIEW_CONFIG);
    expect(parseLeadViewConfig({ columns: [] })).toEqual(DEFAULT_LEAD_VIEW_CONFIG);
  });

  it("poprawny config przechodzi bez zmian", () => {
    const cfg = {
      columns: ["name", "score"],
      filter: { ...DEFAULT_LEAD_FILTER, band: "hot" },
      sort: DEFAULT_LEAD_SORT,
    };
    expect(parseLeadViewConfig(cfg)).toEqual(cfg);
  });
});
