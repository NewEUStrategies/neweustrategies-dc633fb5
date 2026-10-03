// BRAMKA LUSTRA: walidacja atrybucji kampanii w TS (`adAttribution.ts`) mierzona
// na TEJ SAMEJ liscie przypadkow co SQL (`_event_ads_clean` / `_event_ads_touch`,
// migracja 20260927000300).
//
// SKAD PRZYPADKI. Jedna lista `fixtures/adAttributionCases.json` napedza ten
// plik i pgTAP `supabase/tests/ad_attribution_mirror_test.sql`, ktory niesie jej
// kopie w literale dollar-quote (job `pgtap` nie widzi `src/`). Ten plik pilnuje,
// ze kopia jest identyczna, a reguly (`rules`) - ze wzorce TS i literaly SQL
// stoja obok siebie: zmiana regexu po jednej stronie bez drugiej jest czerwona
// tu albo w pgTAP.
//
// CO KONKRETNIE PSUJE SIE BEZ TEGO TESTU. Naglowek modulu obiecywal lustro, ale
// nikt go nie mierzyl - testy TS i SQL mialy rozne wejscia, wiec rozjazdy
// semantyki JS i Postgresa przeszly po cichu:
//   1. UTM ciety w jednostkach UTF-16 (`slice`) zamiast w punktach kodowych
//      (`left()`): emoji na granicy 100 zostawialo samotny surogat, Postgres
//      odrzucal CALY ladunek jsonb ("Unicode low surrogate must follow a high
//      surrogate"), a przypiecie atrybucji i krok lejka ginely po cichu
//      (`registrationAttribution.ts` i `/api/public/event-funnel` polykaja blad);
//   2. sciezka wejscia z BEL, DEL albo C1 przechodzila w TS (`\s` ich nie
//      obejmuje), a baza ja gubila (`[[:cntrl:]]`);
//   3. dlugosc sciezki liczona w UTF-16: sciezka z emoji, ktora baza przyjmuje,
//      wypadala w TS.
//
// ASYMETRIE nie sa tu cichymi wyjatkami: przypadek, w ktorym SQL daje co innego
// niz TS, ma `sqlExpected` (roznica deterministyczna w kazdym locale) albo
// `sqlLocaleSensitive` (zalezy od locale bazy) - zawsze z uzasadnieniem
// w `asymmetry`. pgTAP sprawdza dla KAZDEGO przypadku punkt staly: wynik TS
// przechodzi przez SQL bez zmian.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AD_ATTRIBUTION_SQL_MIRROR,
  cleanUtm,
  freshAttribution,
  sanitizeTouch,
  touchWire,
  withoutClickIds,
  type AdTouch,
  type AdTouchWire,
} from "@/lib/analytics/adAttribution";
import { stripSqlLineComments } from "@/lib/ci/pgTapPlan";

const FIXTURE_PATH = join(
  process.cwd(),
  "src",
  "lib",
  "analytics",
  "__tests__",
  "fixtures",
  "adAttributionCases.json",
);
const PGTAP_PATH = join(process.cwd(), "supabase", "tests", "ad_attribution_mirror_test.sql");
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** Tekst w liscie: wprost, powtorzenie albo zlepek (granice 512/513 stoja jawnie w liczbach). */
type FixtureText = string | null | { repeat: string; times: number } | { concat: FixtureText[] };
type WireField = Exclude<keyof AdTouchWire, "ts">;
/** Pola dotkniecia w ksztalcie do bazy; brak pola = null. */
type FixtureTouch = Partial<Record<WireField, FixtureText>>;

interface MirrorRule {
  name: string;
  /** `String()` pola `AD_ATTRIBUTION_SQL_MIRROR`. */
  ts: string;
  /** Sygnatura dla `to_regprocedure` w pgTAP. */
  fn: string;
  /** Literaly, ktore musza stac w definicji funkcji. */
  sql: string[];
}

interface CleanCase {
  name: string;
  input: FixtureText;
  expected: FixtureText;
  sqlExpected?: FixtureText;
  sqlLocaleSensitive?: boolean;
  asymmetry?: string;
}

interface TouchCase {
  name: string;
  adConsent: boolean;
  input: FixtureTouch;
  expected: FixtureTouch | null;
  sqlExpected?: FixtureTouch | null;
  sqlLocaleSensitive?: boolean;
  asymmetry?: string;
}

interface WindowCase {
  name: string;
  ageMs: number;
  fresh: boolean;
}

interface AdAttributionCases {
  version: 1;
  nowMs: number;
  rules: MirrorRule[];
  clean: CleanCase[];
  touch: TouchCase[];
  window: WindowCase[];
}

const FIXTURE_TEXT = readFileSync(FIXTURE_PATH, "utf8");
const CASES: AdAttributionCases = JSON.parse(FIXTURE_TEXT);

function text(value: FixtureText): string | null {
  if (value === null || typeof value === "string") return value;
  if ("repeat" in value) return value.repeat.repeat(value.times);
  return value.concat.map((part) => text(part) ?? "").join("");
}

/** Pole w ksztalcie do bazy -> pole `AdTouch` (te same pary co w `touchWire`). */
const WIRE_TO_TOUCH: readonly (readonly [WireField, keyof AdTouch])[] = [
  ["landing_path", "landingPath"],
  ["referrer_host", "referrerHost"],
  ["utm_source", "utmSource"],
  ["utm_medium", "utmMedium"],
  ["utm_campaign", "utmCampaign"],
  ["utm_term", "utmTerm"],
  ["utm_content", "utmContent"],
  ["gad_source", "gadSource"],
  ["gad_campaign_id", "gadCampaignId"],
  ["click_id_type", "clickType"],
  ["click_id", "clickId"],
];

type WireProjection = Record<string, string | null>;

function expectedWire(fields: FixtureTouch | null): WireProjection | null {
  if (fields === null) return null;
  return Object.fromEntries(WIRE_TO_TOUCH.map(([wire]) => [wire, text(fields[wire] ?? null)]));
}

/**
 * Droga klienta: dotkniecie z magazynu (`sanitizeTouch`), bez zgody reklamowej
 * zdjety identyfikator (`withoutClickIds`), potem ksztalt do bazy (`touchWire`).
 */
function tsTouch(fields: FixtureTouch, adConsent: boolean): WireProjection | null {
  const record: Record<string, unknown> = { ts: CASES.nowMs };
  for (const [wire, key] of WIRE_TO_TOUCH) {
    if (wire in fields) record[key] = text(fields[wire] ?? null);
  }
  const touch = sanitizeTouch(record);
  if (touch === null) return null;
  const sent = adConsent ? touch : withoutClickIds({ v: 1, first: touch, last: touch }).last;
  const wire = touchWire(sent);
  return Object.fromEntries(WIRE_TO_TOUCH.map(([field]) => [field, wire[field]]));
}

describe("wspolna lista - cleanUtm jak _event_ads_clean", () => {
  it.each(CASES.clean)("$name", (c) => {
    const out = text(c.expected);
    expect(cleanUtm(text(c.input))).toBe(out);
    // Idempotencja: wynik czyszczenia jest juz czysty (to samo pgTAP mierzy po
    // stronie SQL jako punkt staly).
    if (out !== null) expect(cleanUtm(out)).toBe(out);
  });
});

describe("wspolna lista - sanitizeTouch jak _event_ads_touch", () => {
  it.each(CASES.touch)("$name", (c) => {
    expect(tsTouch(c.input, c.adConsent)).toEqual(expectedWire(c.expected));
    if (c.expected !== null) {
      expect(tsTouch(c.expected, c.adConsent)).toEqual(expectedWire(c.expected));
    }
  });
});

describe("okno 90 dni jak w SQL", () => {
  it.each(CASES.window)("$name", (w) => {
    const touch = sanitizeTouch({ ts: CASES.nowMs - w.ageMs, utmSource: "x" });
    if (touch === null) throw new Error(`sanitizeTouch odrzucil ts przypadku ${w.name}`);
    const fresh = freshAttribution({ v: 1, first: touch, last: touch }, CASES.nowMs) !== null;
    expect(fresh).toBe(w.fresh);
  });
});

describe("bramka lustra", () => {
  it("plik pgTAP niesie DOKLADNIE te sama liste przypadkow", () => {
    const sql = stripSqlLineComments(readFileSync(PGTAP_PATH, "utf8"));
    const blocks = [...sql.matchAll(/\$cases\$([\s\S]*?)\$cases\$/g)];
    expect(
      blocks,
      "plik pgTAP ma miec dokladnie jeden literal dollar-quote `cases` z lista przypadkow",
    ).toHaveLength(1);
    expect(
      JSON.parse(blocks[0]?.[1] ?? "null"),
      "wklej CALY plik fixtures/adAttributionCases.json miedzy znaczniki `cases` w pliku pgTAP",
    ).toEqual(CASES);
  });

  it("lista jest czystym ASCII bez cudzyslowu w ucieczce", () => {
    // ASCII: niewidoczne znaki (NBSP, U+FEFF) nie gina w edytorze i nie zaleza
    // od client_encoding psql. Bez `\"`: bramka planu pgTAP (`stripSqlLineComments`)
    // liczy parzystosc cudzyslowow i zgubilaby granice komentarzy.
    expect(FIXTURE_TEXT).toMatch(/^[\x20-\x7e\n]*$/);
    expect(FIXTURE_TEXT).not.toContain('\\"');
    expect(FIXTURE_TEXT).not.toContain("$cases$");
  });

  it("kazda asymetria jest jawna i uzasadniona", () => {
    for (const c of [...CASES.clean, ...CASES.touch]) {
      const flagged = "sqlExpected" in c || c.sqlLocaleSensitive === true;
      if (flagged) expect.soft(c.asymmetry ?? "", c.name).not.toBe("");
      else expect.soft(c.asymmetry, c.name).toBeUndefined();
      if ("sqlExpected" in c) expect.soft(c.sqlExpected, c.name).not.toEqual(c.expected);
    }
  });

  it("nazwy przypadkow sa unikalne w kazdej sekcji", () => {
    for (const list of [CASES.rules, CASES.clean, CASES.touch, CASES.window]) {
      const names = list.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("projekcja obejmuje kazde pole ksztaltu do bazy", () => {
    const sample = sanitizeTouch({ ts: CASES.nowMs, utmSource: "x" });
    if (sample === null) throw new Error("sanitizeTouch odrzucil probke");
    const fields = Object.keys(touchWire(sample)).filter((key) => key !== "ts");
    expect(WIRE_TO_TOUCH.map(([wire]) => wire).sort()).toEqual(fields.sort());
  });

  it("wzorce TS przypiete do listy regul", () => {
    const mirror = new Map<string, unknown>(Object.entries(AD_ATTRIBUTION_SQL_MIRROR));
    expect(CASES.rules.map((rule) => rule.name).sort()).toEqual([...mirror.keys()].sort());
    for (const rule of CASES.rules) {
      expect.soft(String(mirror.get(rule.name)), rule.name).toBe(rule.ts);
    }
  });

  it("literaly SQL stoja w OSTATNIEJ definicji funkcji w migracjach", () => {
    // Szybki sygnal bez bazy; pgTAP robi to samo na ZYWEJ definicji
    // (`pg_get_functiondef`). Redefinicja funkcji w przyszlej migracji - nawet
    // samo przeformatowanie - wymaga aktualizacji `rules[].sql` w liscie.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const sources = files.map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    for (const rule of CASES.rules) {
      const name = /^public\.(\w+)\(/.exec(rule.fn)?.[1];
      expect(name, rule.fn).toBeDefined();
      const head = new RegExp(
        String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\(`,
        "gi",
      );
      let body: string | null = null;
      for (const sql of sources) {
        for (const match of sql.matchAll(head)) {
          const end = sql.indexOf("\n$$;", match.index);
          body = sql.slice(match.index, end === -1 ? undefined : end);
        }
      }
      expect(body, `brak definicji ${rule.fn} w supabase/migrations`).not.toBeNull();
      for (const literal of rule.sql) {
        expect.soft(body, `${rule.name}: ${literal}`).toContain(literal);
      }
    }
  });
});
