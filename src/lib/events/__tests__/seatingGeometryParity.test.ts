// BRAMKA PARYTETU: geometria planu sali w TS == geometria w SQL.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TEGO TESTU. Podgląd sekcji w dialogu liczy
// `generateSectionSeats()`, a zapis materializuje miejsca przez
// `_event_seat_section_layout()` w migracji. Rozjazd formuł (inny promień stołu,
// inna numeracja „od środka”, inaczej liczone przejścia) daje podgląd, który
// kłamie: organizator zatwierdza jeden układ, a baza zapisuje inny - i sadza
// ludzi na numerach, których nie widział.
//
// SKĄD WZORZEC. Z asercji events-harness (`65_seating.sql`, blok
// GEOMETRY-GOLDEN): tam SQL jest porównywany z tymi samymi wierszami, tu - TS.
// Jedna zmiana formuły po którejkolwiek stronie czerwieni jedną z dwóch bramek.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { SectionLayoutParams } from "@/lib/events/seatingGeometry";
import { generateSectionSeats } from "@/lib/events/seatingGeometry";

const SQL = readFileSync(
  join(process.cwd(), "scripts", "events-harness", "runtime_test.d", "65_seating.sql"),
  "utf8",
);

function goldenBlock(): string {
  const start = SQL.indexOf("-- GEOMETRY-GOLDEN-BEGIN");
  const end = SQL.indexOf("-- GEOMETRY-GOLDEN-END");
  if (start === -1 || end === -1) throw new Error("Brak bloku GEOMETRY-GOLDEN w 65_seating.sql");
  return SQL.slice(start, end);
}

/** Argumenty wywołania rozdzielone przecinkami poza nawiasami kwadratowymi. */
function splitArgs(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of raw) {
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += char;
  }
  out.push(current.trim());
  return out;
}

function value(raw: string): string | number | number[] | null {
  if (raw === "NULL") return null;
  if (raw.startsWith("'")) return raw.slice(1, -1);
  if (raw.startsWith("ARRAY[")) {
    const inner = raw.slice("ARRAY[".length, raw.indexOf("]"));
    return inner.trim() === "" ? [] : inner.split(",").map((part) => Number(part.trim()));
  }
  return Number(raw);
}

interface GoldenCase {
  params: SectionLayoutParams;
  expected: string[];
}

function goldenCases(): GoldenCase[] {
  const block = goldenBlock();
  const out: GoldenCase[] = [];
  const pattern = /_event_seat_section_layout\(([^)]*)\)[\s\S]*?=\s*ARRAY\[([\s\S]*?)\],\s*\n\s*'65\/geometria/g;
  for (const match of block.matchAll(pattern)) {
    const args = splitArgs(match[1]).map(value);
    out.push({
      params: {
        kind: args[0] as SectionLayoutParams["kind"],
        rowsCount: args[1] as number | null,
        seatsPerRow: args[2] as number | null,
        rowLabelScheme: args[3] as SectionLayoutParams["rowLabelScheme"],
        rowLabelStart: args[4] as number,
        seatNumbering: args[5] as SectionLayoutParams["seatNumbering"],
        seatNumberStart: args[6] as number,
        seatPitch: args[7] as number,
        rowPitch: args[8] as number,
        aisleAfter: args[9] as number[],
        tableShape: args[10] as SectionLayoutParams["tableShape"],
        tableSeats: args[11] as number | null,
      },
      expected: [...match[2].matchAll(/'([^']*)'/g)].map((entry) => entry[1]),
    });
  }
  return out;
}

const CASES = goldenCases();

describe("parytet geometrii planu sali (TS == SQL)", () => {
  it("bramka mierzy niepusty wzorzec - rzędy i oba kształty stołu", () => {
    // Zmieniony kształt asercji w harnessie dałby pustą listę i ZIELONĄ bramkę.
    expect(CASES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(CASES.map((entry) => entry.params.kind))).toEqual(new Set(["rows", "table"]));
    expect(new Set(CASES.map((entry) => entry.params.tableShape))).toEqual(
      new Set([null, "round", "rect"]),
    );
  });

  it.each(CASES.map((entry, index) => ({ ...entry, index })))(
    "przypadek $index: ta sama lista miejsc co w SQL",
    ({ params, expected }) => {
      const actual = generateSectionSeats(params)
        .sort((a, b) => a.sortKey - b.sortKey)
        .map(
          (seat) =>
            `${seat.rowLabel ?? "-"}|${seat.seatNumber}|${seat.x.toFixed(2)}|${seat.y.toFixed(2)}|${seat.sortKey}`,
        );
      expect(actual).toEqual(expected);
    },
  );
});
