// PARYTET BLOKU BACKFILLU: migracja ⇄ pgTAP (S2, migracja 20261020110200).
//
// Backfill księgi (saldo otwarcia `reason='backfill'`, `backfilled=true`
// i środowisko dokumentów) wykonuje się w migracji RAZ. pgTAP nie może
// odtworzyć migracji na bazie testowej, więc kopiuje jej blok DOSŁOWNIE
// (między `-- backfill:begin` i `-- backfill:end`) i uruchamia go dwa razy -
// dowodząc idempotencji i poprawności na fixture. Ten test pilnuje, że kopia
// jest kopią: zmiana bloku w migracji bez zmiany w pgTAP (albo odwrotnie)
// sprawdzałaby w CI kod, który nigdy nie trafi na produkcję.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRACJA = "supabase/migrations/20261020110200_revenue_backfill.sql";
const PGTAP = "supabase/tests/revenue_backfill_test.sql";

/** Wszystkie bloki między znacznikami stojącymi w osobnych liniach. */
function bloki(tekst: string): string[] {
  const re = /^[ \t]*-- backfill:begin[ \t]*$([\s\S]*?)^[ \t]*-- backfill:end[ \t]*$/gm;
  return [...tekst.matchAll(re)].map((m) => m[1]);
}

const czytaj = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("blok backfillu: pgTAP = migracja, bajt w bajt", () => {
  const zMigracji = bloki(czytaj(MIGRACJA));
  const zPgtap = bloki(czytaj(PGTAP));

  it("migracja ma dokładnie jeden blok, pgTAP - dwa przebiegi (idempotencja)", () => {
    expect(zMigracji).toHaveLength(1);
    expect(zPgtap).toHaveLength(2);
  });

  it.each([0, 1])("przebieg pgTAP nr %i = blok migracji", (i) => {
    expect(zPgtap[i]).toBe(zMigracji[0]);
  });

  it("blok znakuje saldo otwarcia jako backfill (nie jako sprzedaż)", () => {
    expect(zMigracji[0]).toContain("'backfill'");
    expect(zMigracji[0]).toMatch(/\btrue\b/);
    expect(zMigracji[0]).toMatch(/NOT EXISTS/);
  });
});
