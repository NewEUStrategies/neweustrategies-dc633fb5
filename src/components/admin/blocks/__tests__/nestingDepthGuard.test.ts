// ZAGNIEZDZANIE BLOKOW: SCHEMAT DOKUMENTU NIE ZNA GLEBOKOSCI DRZEWA.
//
// Zadanie kazalo pokryc wprost operacje "zagniezdzenie ponad dopuszczalna
// glebokosc". Odpowiedz jest niewygodna: DOPUSZCZALNEJ GLEBOKOSCI NIE MA.
//
// ── PODZIAL DOWODU ───────────────────────────────────────────────────────────
// Ze petla jest osiagalna KLIKANIEM (mini-kanwa kontenera oferuje pelna palete
// razem z kontenerami, klik tworzy kolejny poziom, a nowy poziom ma wlasna,
// rowna palete), dowodzi `nestedBlocksEditor.test.tsx` (describe
// "zagniezdzanie bez limitu glebokosci") - przez interfejs, nie przez tekst
// zrodel. Wczesniejsze asercje tego pliku na tresci plikow `.tsx` (brak stalej
// limitu, brak propsa glebokosci) zostaly usuniete 2026-10-18: czytaly kod
// jako tekst, a dokladnie to samo widac w zachowaniu mini-kanwy.
//
// Ten plik dowodzi drugiej polowy - GRANICY ZAPISU: `BlocksDocSchema`
// ogranicza wylacznie tablice najwyzszego poziomu
// (`blocks: z.array(BlockSchema).max(500)`). Dzieci kontenera nie maja ani
// limitu liczby, ani glebokosci, wiec dokument zagniezdzony dowolnie gleboko
// przechodzi walidacje i zapisuje sie do bazy, a kazda rekurencyjna operacja
// na drzewie (flattenBlockTree, regenerateBlockIds, readChildBlocks) schodzi
// w dol bez licznika.
//
// Bez atrap: prawdziwy schemat i prawdziwe prymitywy drzewa (`lib/blocks/nested`).
import { describe, expect, it } from "vitest";

import { BlocksDocSchema } from "@/lib/blocks/schema";
import { insertChildAt, readChildBlocks, withChildBlocks } from "@/lib/blocks/nested";
import type { Block } from "@/lib/blocks/types";

/** Buduje lancuch `group` o zadanej glebokosci, dokladnie tak jak robi to UI. */
function nestGroups(depth: number): Block {
  let block: Block = { id: "g0", type: "group", data: {} } as Block;
  for (let i = 1; i < depth; i += 1) {
    const child = block;
    block = withChildBlocks({ id: `g${i}`, type: "group", data: {} } as Block, "blocks", [child]);
  }
  return block;
}

/** Glebokosc drzewa liczona przez publiczny odczyt dzieci (bez znajomosci ksztaltu `data`). */
function depthOf(block: Block): number {
  const children = readChildBlocks(block.data, "blocks");
  return 1 + (children.length ? Math.max(...children.map(depthOf)) : 0);
}

describe("glebokosc zagniezdzenia blokow", () => {
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
    const withKids = withChildBlocks(
      { id: "g", type: "group", data: {} } as Block,
      "blocks",
      children,
    );
    const nested = { version: 1, blocks: [withKids] };
    expect(BlocksDocSchema.safeParse(nested).success).toBe(true);
    expect(readChildBlocks(withKids.data, "blocks")).toHaveLength(600);
  });

  // DEFEKT ZAREJESTROWANY (zostaje `it.fails` 2026-10-18 - poza zakresem pakietu).
  // WEJSCIE: dokument z jednym blokiem `group`, w nim `group`, ... - 200 poziomow
  //   (redaktor dochodzi tu klikajac, patrz nestedBlocksEditor.test.tsx).
  // CO PSUJE: walidacja go przyjmuje, zapis trafia do bazy, a rekurencyjne
  //   operacje na drzewie (renderer, kopiowanie, splaszczanie listy dokumentu)
  //   schodza bez licznika.
  // WYMAGANA POPRAWKA: limit glebokosci egzekwowany PRZY ZAPISIE. Nie da sie go
  //   dolozyc lokalnie do `BlocksDocSchema` (`lib/blocks/schema.ts`, inny
  //   pakiet): ten sam schemat czyta opublikowane wpisy, a jego porazka wlacza
  //   tryb ratunkowy `safeParseBlocks`, ktory oddaje `{ version, blocks }` BEZ
  //   `meta` (rejestr encji inline, przypisy) - za gleboki dokument stracilby na
  //   stronie publicznej metadane. Potrzebna decyzja produktowa (wartosc limitu),
  //   miejsce egzekucji (sciezka zapisu vs odczyt) oraz przeglad istniejacych
  //   dokumentow w bazie, zanim limit zacznie obowiazywac.
  it.fails(
    "POWINIEN odrzucac dokument zagniezdzony absurdalnie gleboko (dzis przyjmuje 200 poziomow)",
    () => {
      const doc = { version: 1, blocks: [nestGroups(200)] };
      expect(BlocksDocSchema.safeParse(doc).success).toBe(false);
    },
  );

  it("dzis dokument o 200 poziomach przechodzi walidacje BEZ obciecia drzewa", () => {
    // Stan faktyczny obok `it.fails` wyzej - zeby regresja w druga strone
    // (ciche obciecie drzewa przy parsowaniu, czyli utrata tresci) tez byla
    // widoczna, a nie schowala sie za oczekiwana porazka.
    const doc = { version: 1, blocks: [nestGroups(200)] };
    const parsed = BlocksDocSchema.safeParse(doc);
    expect(parsed.success).toBe(true);
    expect(depthOf(parsed.data!.blocks[0])).toBe(200);
  });
});
