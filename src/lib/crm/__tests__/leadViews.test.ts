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

/* ---------- Filtr domyślny, kolumny, widoki wbudowane ---------- */

import {
  BUILTIN_LEAD_VIEWS,
  LEAD_COLUMNS,
  LEAD_COLUMN_BY_KEY,
  applyLeadFilter,
  applyLeadSort,
  isDefaultLeadFilter,
  leadFilterToListParams,
  leadRowsToCsv,
  type LeadColumnKey,
  type LeadRowShape,
} from "../leadViews";

const NOW_FILTER = Date.parse("2026-08-18T12:00:00.000Z");

const leadRow = (over: Partial<LeadRowShape> & { id: string }): LeadRowShape => ({
  email: `${over.id}@example.test`,
  first_name: "Anna",
  last_name: "Kowalska",
  phone: "+48 500 100 200",
  position: "Dyrektorka",
  company: "Acme",
  country: "Poland",
  stage: "new",
  score: 50,
  score_band: "warm",
  tags: ["eu", "energy"],
  marketing_consent: true,
  newsletter_status: null,
  source_count: 2,
  last_activity_at: "2026-08-17T09:00:00.000Z",
  created_at: "2026-08-15T09:00:00.000Z",
  follow_up_at: null,
  ...over,
});

describe("isDefaultLeadFilter", () => {
  it("filtr domyślny jest rozpoznawany jako domyślny", () => {
    expect(isDefaultLeadFilter(DEFAULT_LEAD_FILTER)).toBe(true);
  });

  it("każde pojedyncze odstępstwo od domyślnego jest wykrywane", () => {
    const variants: LeadFilterOverride[] = [
      { stage: "won" },
      { band: "hot" },
      { source: "newsletter" },
      { country: "Poland" },
      { company: "Acme" },
      { createdRange: "30d" },
      { activityRange: "7d" },
      { consentOnly: true },
    ];
    for (const v of variants) {
      expect(isDefaultLeadFilter({ ...DEFAULT_LEAD_FILTER, ...v })).toBe(false);
    }
  });
});

type LeadFilterOverride = Partial<Parameters<typeof isDefaultLeadFilter>[0]>;

describe("leadFilterToListParams", () => {
  it("zakres „ostatnie N dni” zamienia się w datę graniczną", () => {
    const params = leadFilterToListParams(
      { ...DEFAULT_LEAD_FILTER, createdRange: "365d", activityRange: "90d" },
      NOW_FILTER,
    );
    expect(params.created_from).toBe(new Date(NOW_FILTER - 365 * 86_400_000).toISOString());
    expect(params.activity_from).toBe(new Date(NOW_FILTER - 90 * 86_400_000).toISOString());
  });

  it("pusta nazwa firmy i kraju nie trafia do parametrów", () => {
    const params = leadFilterToListParams(
      { ...DEFAULT_LEAD_FILTER, company: "", country: "" },
      NOW_FILTER,
    );
    expect(params.company).toBeUndefined();
    expect(params.country).toBeUndefined();
  });
});

describe("applyLeadFilter / applyLeadSort (widok panelu)", () => {
  const rows: LeadRowShape[] = [
    leadRow({
      id: "a",
      stage: "new",
      marketing_consent: true,
      created_at: "2026-08-17T09:00:00.000Z",
    }),
    leadRow({
      id: "b",
      stage: "won",
      marketing_consent: false,
      created_at: "2026-01-01T09:00:00.000Z",
    }),
  ];

  it("filtr etapu przepuszcza tylko pasujące wiersze", () => {
    expect(
      applyLeadFilter(rows, { ...DEFAULT_LEAD_FILTER, stage: "won" }, NOW_FILTER),
    ).toHaveLength(1);
  });

  it("zakres utworzenia odcina wiersze sprzed okna", () => {
    const out = applyLeadFilter(rows, { ...DEFAULT_LEAD_FILTER, createdRange: "7d" }, NOW_FILTER);
    expect(out.map((r) => r.email)).toEqual(["a@example.test"]);
  });

  it("sort po etapie idzie kolejnością lejka", () => {
    const out = applyLeadSort(rows, { key: "stage", dir: "asc" });
    expect(out.map((r) => r.stage)).toEqual(["new", "won"]);
  });
});

describe("leadRowsToCsv", () => {
  const ALL_COLUMNS = LEAD_COLUMNS.map((c) => c.key);

  it("nagłówek jest w języku eksportu", () => {
    const pl = leadRowsToCsv([], ["name", "email"], "pl");
    const en = leadRowsToCsv([], ["name", "email"], "en");
    expect(pl).toBe("Osoba,E-mail");
    expect(en).toBe("Contact,Email");
  });

  it("każda kolumna ma swoją wartość w wierszu", () => {
    const csv = leadRowsToCsv(
      [leadRow({ id: "x", follow_up_at: "2026-09-01T09:00:00.000Z" })],
      [...ALL_COLUMNS] as LeadColumnKey[],
      "en",
    );
    const [, dataLine] = csv.split("\n");
    expect(dataLine.split(",")).toHaveLength(ALL_COLUMNS.length);
    expect(dataLine).toContain("Anna Kowalska");
    expect(dataLine).toContain("x@example.test");
    expect(dataLine).toContain("eu | energy");
    expect(dataLine).toContain("yes");
    expect(dataLine).toContain("2026-09-01T09:00:00.000Z");
  });

  it("kontakt bez nazwiska pokazuje e-mail zamiast pustej komórki", () => {
    const csv = leadRowsToCsv(
      [leadRow({ id: "y", first_name: null, last_name: null })],
      ["name"],
      "pl",
    );
    expect(csv.split("\n")[1]).toBe("y@example.test");
  });

  it("puste pola opcjonalne dają pustą komórkę, nie „null”", () => {
    const csv = leadRowsToCsv(
      [
        leadRow({
          id: "z",
          phone: null,
          position: null,
          country: null,
          follow_up_at: null,
          tags: null,
        }),
      ],
      ["phone", "position", "country", "followUp", "tags"],
      "pl",
    );
    expect(csv.split("\n")[1]).toBe(",,,,");
  });

  it("wartość z przecinkiem lub cudzysłowem jest cytowana", () => {
    const csv = leadRowsToCsv(
      [leadRow({ id: "q", company: 'Acme, "EU" Sp. z o.o.' })],
      ["company"],
      "pl",
    );
    expect(csv.split("\n")[1]).toBe('"Acme, ""EU"" Sp. z o.o."');
  });

  it("kolumna źródła pokazuje regułę wspólną z filtrem", () => {
    const csv = leadRowsToCsv(
      [
        leadRow({ id: "n", newsletter_status: "subscribed" }),
        leadRow({ id: "f", newsletter_status: null, source_count: 1 }),
        leadRow({ id: "i", newsletter_status: null, source_count: 0 }),
      ],
      ["source"],
      "pl",
    );
    expect(csv.split("\n").slice(1)).toEqual(["newsletter", "form", "import"]);
  });

  it("score zero eksportuje się jako 0, nie jako pusta komórka", () => {
    const csv = leadRowsToCsv([leadRow({ id: "s", score: 0 })], ["score"], "pl");
    expect(csv.split("\n")[1]).toBe("0");
  });

  it("zgoda marketingowa eksportuje się jako yes/no dla obu stanów", () => {
    const csv = leadRowsToCsv(
      [
        leadRow({ id: "tak", marketing_consent: true }),
        leadRow({ id: "nie", marketing_consent: false }),
      ],
      ["consent"],
      "pl",
    );
    expect(csv.split("\n").slice(1)).toEqual(["yes", "no"]);
  });
});

describe("kolumny i widoki wbudowane", () => {
  it("kolumna „Osoba” jest wymagana i sortowalna", () => {
    expect(LEAD_COLUMN_BY_KEY.name.required).toBe(true);
    expect(LEAD_COLUMN_BY_KEY.name.sortable).toBe(true);
  });

  it("każda kolumna ma etykietę PL i EN", () => {
    for (const c of LEAD_COLUMNS) {
      expect(c.labelPl.length).toBeGreaterThan(0);
      expect(c.labelEn.length).toBeGreaterThan(0);
    }
  });

  it("każdy widok wbudowany ma poprawny config i obie etykiety", () => {
    for (const view of BUILTIN_LEAD_VIEWS) {
      expect(parseLeadViewConfig(view.config)).toEqual(view.config);
      expect(view.labelPl.length).toBeGreaterThan(0);
      expect(view.labelEn.length).toBeGreaterThan(0);
      expect(view.config.columns).toContain("name");
    }
  });
});
