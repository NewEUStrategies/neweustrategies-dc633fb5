// Mapa defektów → reguły (S7, SPEC §5.7 „defectMap.ts", §7, §9.4).
//
// Źródłem prawdy jest TABELA SPEC w repozytorium, nie kopia w teście: test
// czyta §7 z `docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md`, więc nowy wiersz
// defektu (albo nowa pozycja „Odłożone świadomie") bez wpisu w mapie zapala
// CI, zamiast zniknąć po cichu. Briefów `brief_01..05.md` w repozytorium nie
// ma (pakiet S7 §1.2) - numery spoza tabeli są w raporcie wycinka.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HUB_SLICE_IDS } from "@/lib/ci/hubDelivery";
import {
  DEFECT_MAP,
  DEFECTS_OUTSIDE_TABLE,
  DEFERRED_DEFECTS,
  defectsOfCheck,
  type DefectTarget,
} from "../defectMap";
import { isRevenueCheckId, REVENUE_CHECK_IDS } from "../registry";

const SPEC = readFileSync(
  join(process.cwd(), "docs/SPEC_MODUL_PRZYCHOD_LEJEK_2026-10-18.md"),
  "utf8",
);

/** Treść sekcji od nagłówka do następnego nagłówka tego samego poziomu. */
function section(heading: string, level: "## " | "### "): string {
  const start = SPEC.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`brak sekcji ${heading} w SPEC`);
  const next = SPEC.indexOf(`\n${level}`, start + heading.length + 1);
  return SPEC.slice(start, next < 0 ? undefined : next);
}

const SECTION_7 = section("## 7. Naprawy paywalla i innych modułów", "## ");
const SECTION_5_7 = section("### 5.7 Diagnostyka (S7)", "### ");

const plain = (cell: string) => cell.replace(/`/g, "").trim();

interface DefectRow {
  id: string;
  slices: string[];
}

/** Wiersze tabeli §7: pierwsza kolumna = ID, kolumna „Wycinek" = lista wycinków. */
function defectRows(): DefectRow[] {
  const lines = SECTION_7.split("\n").filter((line) => line.startsWith("|"));
  const header = lines[0]!.split("|").map(plain);
  const sliceColumn = header.indexOf("Wycinek");
  return lines
    .slice(2)
    .map((line) => line.split("|").map(plain))
    .map((cells) => ({
      id: cells[1]!,
      slices: cells[sliceColumn]!.split(",").map((s) => s.trim()),
    }));
}

/** Pozycje akapitu „Odłożone świadomie" (przecinki poza nawiasami). */
function deferredItems(): string[] {
  const line = SECTION_7.split("\n").find((l) => l.startsWith("**Odłożone świadomie**"));
  if (!line) throw new Error("brak listy „Odłożone świadomie” w SPEC §7");
  const body = plain(line.slice(line.indexOf(":") + 1)).replace(/\.$/, "");
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

const ROWS = defectRows();

function isFixed(target: DefectTarget): target is `fixed:${(typeof HUB_SLICE_IDS)[number]}` {
  return target.startsWith("fixed:");
}

describe("tabela SPEC §7 (czytana z repozytorium)", () => {
  it("parser widzi pełną tabelę (od P01 do email_ctr)", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(49);
    expect(ROWS[0]!.id).toBe("P01");
    expect(ROWS.at(-1)!.id).toBe("email_ctr");
  });

  it.each(ROWS.map((row) => [row.id, row] as const))("%s ma wpis w DEFECT_MAP", (id, row) => {
    const target = DEFECT_MAP[id];
    expect(target, `brak wpisu dla „${id}”`).toBeDefined();
    if (!target) return;
    if (isFixed(target)) {
      // „Naprawione w wycinku X" tylko dla wycinka, który SPEC wskazuje.
      expect(row.slices, `${id}: ${target}`).toContain(target.slice("fixed:".length));
    }
  });

  it("defekt przypisany wyłącznie S7 jest pilnowany regułą, nie wpisem „naprawione”", () => {
    for (const row of ROWS.filter((r) => r.slices.length === 1 && r.slices[0] === "S7")) {
      expect(isRevenueCheckId(DEFECT_MAP[row.id]), row.id).toBe(true);
    }
  });

  it("klucze mapy spoza tabeli to wyłącznie zamknięta lista przywołań z §5.7", () => {
    const tableIds = new Set(ROWS.map((row) => row.id));
    const extra = Object.keys(DEFECT_MAP).filter((id) => !tableIds.has(id));
    expect(extra.sort()).toEqual([...DEFECTS_OUTSIDE_TABLE].sort());
  });
});

describe("cele wpisów", () => {
  it("każdy cel to reguła rejestru, `fixed:<wycinek huba>` albo `deferred`", () => {
    for (const [id, target] of Object.entries(DEFECT_MAP)) {
      const valid =
        isRevenueCheckId(target) ||
        target === "deferred" ||
        (isFixed(target) &&
          (HUB_SLICE_IDS as readonly string[]).includes(target.slice("fixed:".length)));
      expect(valid, `${id} → ${target}`).toBe(true);
    }
  });

  it("defectsOfCheck odwraca mapę (reguła → defekty, których regresji pilnuje)", () => {
    expect(defectsOfCheck("workflows.cancel_recipe_fires_on_pause").sort()).toEqual(
      ["D13 (br. 03)", "P13"].sort(),
    );
    expect(defectsOfCheck("metering.rank_bypass")).toEqual(["P19"]);
    // Reguła bez defektu w tabeli (czysta kontrola konfiguracji).
    expect(defectsOfCheck("crm.leads_without_user_id")).toEqual([]);
    for (const id of REVENUE_CHECK_IDS) {
      for (const defect of defectsOfCheck(id)) expect(DEFECT_MAP[defect]).toBe(id);
    }
  });
});

describe("odłożone świadomie (SPEC §7 koniec, §9.4)", () => {
  it("każda pozycja listy SPEC ma wpis `deferred` - i nic ponad nią", () => {
    expect(Object.keys(DEFERRED_DEFECTS).sort()).toEqual(deferredItems().sort());
    for (const target of Object.values(DEFERRED_DEFECTS)) expect(target).toBe("deferred");
  });
});

describe("przywołania defektów w regułach SPEC §5.7", () => {
  // „`paywall.members_rank_no_cta` (warn, regresja P14)" - reguła i numer w tym
  // samym nawiasie muszą się zgadzać z mapą (w obie strony to ta sama prawda).
  const mentions = [...SECTION_5_7.matchAll(/`([a-z_]+\.[a-z_]+)` \(([^)]*)\)/g)].flatMap(
    ([, checkId, inside]) =>
      [...inside!.matchAll(/\b(P\d{2}|D\d{1,2})\b/g)].map(([, defect]) => [checkId!, defect!]),
  );

  it("SPEC przywołuje defekty przy regułach (parser coś znalazł)", () => {
    expect(mentions.length).toBeGreaterThanOrEqual(10);
  });

  it.each(mentions)("%s pilnuje %s", (checkId, defect) => {
    const keys = Object.keys(DEFECT_MAP).filter(
      (key) => key === defect || key.startsWith(`${defect} (`),
    );
    expect(keys.length, `${defect} bez wpisu`).toBeGreaterThan(0);
    expect(keys.map((key) => DEFECT_MAP[key])).toContain(checkId);
  });
});
