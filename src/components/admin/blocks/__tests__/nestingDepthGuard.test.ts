// ZAGNIEZDZANIE BLOKOW: DOWOD, ZE NIE MA ZADNEGO LIMITU GLEBOKOSCI.
//
// Zadanie kazalo pokryc wprost cztery operacje grozace cicha utrata tresci
// redaktora, w tym "zagniezdzenie ponad dopuszczalna glebokosc". Ten plik
// odpowiada na to zadanie i odpowiedz jest niewygodna: NIE MA DOPUSZCZALNEJ
// GLEBOKOSCI. Nie ma stalej, nie ma stroza, nie ma nawet miejsca, w ktorym
// daloby sie go dzis postawic bez zmiany kontraktu propsow.
//
// ── ZWERYFIKOWANA PETLA ──────────────────────────────────────────────────────
// Rekurencja jest DOMKNIETA i przechodzi w calosci przez normalne UI:
//
//   BlockEditRenderer  case "group"/"row"/"stack"/"grid" (l. 267, 285-288)
//                      -> GroupBlock
//   GroupBlock         (edit/Group.tsx:51)      -> NestedBlocksEditor
//   NestedBlocksEditor (molecules/...:172,187,233) -> BlockInserter
//                      (molecules/...:215)      -> BlockEditRenderer
//
// i to samo przez `case "columns"` (l. 229) -> ColumnsBlock
// (edit/Columns.tsx:27) -> NestedBlocksEditor.
//
// Zaden element tej petli nie zna swojej glebokosci:
//   * `NestedBlocksEditor` przyjmuje WYLACZNIE { blocks, onChange, emptyLabel }
//     (molecules/NestedBlocksEditor.tsx:36-42) - nie dostaje ani depth, ani
//     sciezki, ani rodzica,
//   * `BlockInserter` przyjmuje { onInsert, onInsertBlocks, variant, open,
//     onOpenChange, autoFocus } (BlockInserter.tsx:41-49) - nie ma parametru
//     glebokosci ANI filtra typow, wiec zagniezdzony inserter oferuje
//     DOKLADNIE TE SAMA palete co inserter top-level, razem z kontenerami,
//   * `BlockEditRenderer` dostaje `block`, nie sciezke.
//
// ── DLACZEGO TO JEST RYZYKO UTRATY TRESCI, A NIE TYLKO BRZYDOTA ──────────────
// `BlocksDocSchema` ogranicza WYLACZNIE tablice najwyzszego poziomu:
// `blocks: z.array(BlockSchema).max(500)` (lib/blocks/schema.ts:140). Dzieci
// nie maja zadnego ograniczenia liczby ani glebokosci. Dokument zagniezdzony
// dostatecznie gleboko przechodzi wiec walidacje, zapisuje sie do bazy - a przy
// odczycie kazda rekurencyjna operacja na drzewie (flattenBlockTree,
// regenerateBlockIds, readChildBlocks) schodzi w dol bez licznika.
//
// ── CZEGO TEN PLIK NIE ROBI ─────────────────────────────────────────────────
// NIE dokladam stroza. Byloby to zmiana zachowania produkcyjnego, czego tej
// galezi nie wolno, a do tego wybor miejsca jest realna decyzja projektowa
// z trzema kandydatami (paleta insertera / NestedBlocksEditor / dyspozytor)
// i kazdy z nich wymaga przewleczenia glebokosci przez kontrakt propsow
// wspoldzielony przez kanwe top-level i kanwe zagniezdzona. To osobne zadanie.
// Tutaj defekt dostaje DOWOD i tripwire.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { BlocksDocSchema } from "@/lib/blocks/schema";
import { insertChildAt, readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import type { Block } from "@/lib/blocks/types";

const NESTED_EDITOR = "src/components/admin/blocks/molecules/NestedBlocksEditor.tsx";
const INSERTER = "src/components/admin/blocks/BlockInserter.tsx";
const EDIT_RENDERER = "src/components/admin/blocks/BlockEditRenderer.tsx";
const GROUP = "src/components/admin/blocks/edit/Group.tsx";
const COLUMNS = "src/components/admin/blocks/edit/Columns.tsx";

/** Buduje lancuch `group` o zadanej glebokosci, dokladnie tak jak robi to UI. */
function nestGroups(depth: number): Block {
  let block: Block = { id: "g0", type: "group", data: {} } as Block;
  for (let i = 1; i < depth; i += 1) {
    const child = block;
    block = withChildBlocks({ id: `g${i}`, type: "group", data: {} } as Block, "blocks", [child]);
  }
  return block;
}

describe("glebokosc zagniezdzenia blokow", () => {
  it("w calym module NIE ISTNIEJE zadna stala limitu glebokosci", () => {
    // Gdyby ktos ja dodal, ten test padnie i bedzie to POWOD DO USUNIECIA tego
    // pliku, nie do poprawienia asercji.
    const sources = [NESTED_EDITOR, INSERTER, EDIT_RENDERER, GROUP, COLUMNS].map((p) =>
      readFileSync(p, "utf8"),
    );
    const guardish = /max_?depth|maxdepth|depthlimit|max_nest|nestlimit/i;
    expect(sources.filter((s) => guardish.test(s))).toEqual([]);
  });

  it("NestedBlocksEditor nie zna swojej glebokosci - nie dostaje jej w propsach", () => {
    const src = readFileSync(NESTED_EDITOR, "utf8");
    const props = src.slice(src.indexOf("interface Props"), src.indexOf("export function"));
    expect(props).toContain("blocks");
    expect(props).toContain("onChange");
    expect(props).not.toMatch(/depth|level|path|parent/i);
  });

  it("zagniezdzony inserter oferuje te sama palete co top-level - bez filtra typow", () => {
    const inserter = readFileSync(INSERTER, "utf8");
    const props = inserter.slice(inserter.indexOf("interface Props"), inserter.indexOf("export function"));
    expect(props).not.toMatch(/depth|level|allowed|exclude|filter/i);
    // I ten sam komponent jest realnie uzyty wewnatrz kanwy zagniezdzonej.
    expect(readFileSync(NESTED_EDITOR, "utf8")).toContain("BlockInserter");
  });

  it("petla rekurencji jest domknieta: kontener -> kanwa zagniezdzona -> dyspozytor -> kontener", () => {
    expect(readFileSync(GROUP, "utf8")).toContain("NestedBlocksEditor");
    expect(readFileSync(COLUMNS, "utf8")).toContain("NestedBlocksEditor");
    expect(readFileSync(NESTED_EDITOR, "utf8")).toContain("BlockEditRenderer");
    const renderer = readFileSync(EDIT_RENDERER, "utf8");
    for (const container of ["group", "row", "stack", "grid", "columns"]) {
      expect(renderer).toContain(`case "${container}":`);
    }
  });

  it("schemat ogranicza TYLKO najwyzszy poziom - dzieci sa nieograniczone", () => {
    // 600 blokow na najwyzszym poziomie: odrzucone (cap 500).
    const flat = {
      version: 1,
      blocks: Array.from({ length: 600 }, (_, i) => ({
        id: `p${i}`,
        type: "paragraph",
        data: { html: "x" },
      })),
    };
    expect(BlocksDocSchema.safeParse(flat).success).toBe(false);

    // 600 DZIECI jednego kontenera: przyjete bez slowa.
    let children: Block[] = [];
    for (let i = 0; i < 600; i += 1) {
      children = insertChildAt(children, i, {
        id: `c${i}`,
        type: "paragraph",
        data: { html: "x" },
      } as Block);
    }
    const withKids = withChildBlocks({ id: "g", type: "group", data: {} } as Block, "blocks", children);
    const nested = { version: 1, blocks: [withKids] };
    expect(BlocksDocSchema.safeParse(nested).success).toBe(true);
    expect(readChildBlocks(withKids.data, "blocks")).toHaveLength(600);
  });

  it.fails(
    "POWINIEN odrzucac dokument zagniezdzony absurdalnie gleboko (dzis przyjmuje 200 poziomow)",
    () => {
      // Dwiescie poziomow `group` w sobie. Redaktor dojdzie tu klikajac, bo
      // zagniezdzony inserter oferuje kontenery bez konca. Dokument przechodzi
      // walidacje i zapisuje sie do bazy.
      const doc = { version: 1, blocks: [nestGroups(200)] };
      expect(BlocksDocSchema.safeParse(doc).success).toBe(false);
    },
  );

  it("dzis dokument o 200 poziomach zagniezdzenia przechodzi walidacje", () => {
    // Dokumentacja STANU FAKTYCZNEGO obok `it.fails` wyzej - zeby regresja
    // w druga strone (np. ciche obciecie drzewa przy parsowaniu, czyli utrata
    // tresci) tez byla widoczna, a nie schowala sie za oczekiwana porazka.
    const doc = { version: 1, blocks: [nestGroups(200)] };
    const parsed = BlocksDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
  });
});
