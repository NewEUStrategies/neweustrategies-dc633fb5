// BRAMKA KOLEJNOŚCI KOLUMN - czyste funkcje (`@/lib/builder/columnOrderGate`).
//
// Dowód, że kolumna jest wstrzymana DOKŁADNIE wtedy, gdy w dokumencie po niej
// stoi kolumna, która wizualnie ją wyprzedza (i tylko w tym zakresie szerokości),
// że zwolnienie wisi na OSTATNIEJ takiej kolumnie, że kolumny w kolejności (w tym
// slider - kandydat LCP strony głównej) nie czekają, oraz że reguły mobilnej
// kolejności mają bajt w bajt ten sam zapis co przed wydzieleniem.
import { describe, expect, it } from "vitest";
import type { ColumnNode, InnerSectionNode, ResponsiveValue } from "@/lib/builder/types";
import {
  columnOrderGate,
  completingSiblings,
  cssAttrValue,
  cssOrder,
  mobileColumnOrderCss,
} from "@/lib/builder/columnOrderGate";

const col = (
  id: string,
  order?: ResponsiveValue<number>,
  extra: Partial<ColumnNode> = {},
): ColumnNode => ({
  id,
  kind: "column",
  span: { desktop: 4 },
  ...(order ? { order } : {}),
  children: [],
  ...extra,
});
const inner = (id: string): InnerSectionNode =>
  ({ id, kind: "inner-section", columns: [] }) as unknown as InnerSectionNode;
const slot = (sec: string, id: string) =>
  `[data-sec-id="${sec}"] [data-column-slot][data-col-id="${id}"]`;

describe("completingSiblings", () => {
  it("rosnąca albo stała kolejność nie wstrzymuje nikogo (remis zostawia DOM)", () => {
    expect(completingSiblings([])).toEqual([]);
    expect(completingSiblings([0, 0, 0])).toEqual([-1, -1, -1]);
    expect(completingSiblings([1, 2, 2, 5])).toEqual([-1, -1, -1, -1]);
  });

  it("domykająca to OSTATNIA późniejsza kolumna z mniejszą kolejnością", () => {
    expect(completingSiblings([2, 1, 3])).toEqual([1, -1, -1]);
    expect(completingSiblings([3, 1, 2, 0])).toEqual([3, 3, 3, -1]);
    expect(completingSiblings([1, 3, 2])).toEqual([-1, 2, -1]);
  });

  it("dziecko poza układem (`null`) ani nie czeka, ani nie wstrzymuje", () => {
    expect(completingSiblings([2, null, 3])).toEqual([-1, -1, -1]);
    expect(completingSiblings([null, 0])).toEqual([-1, -1]);
  });
});

describe("mobileColumnOrderCss", () => {
  it("zapis reguł bez zmian wobec renderera sprzed wydzielenia", () => {
    expect(
      mobileColumnOrderCss("s", [col("a", { mobile: 2 }), col("b", { desktop: 5 }), col("c")]),
    ).toBe(
      '@media (max-width: 767px){[data-sec-id="s"] [data-col-id="a"]{order:2 !important;}' +
        '[data-sec-id="s"] [data-col-id="b"]{order:0 !important;}}',
    );
  });

  it("bez żadnej kolumny z `order` - pusty napis (brak `<style>`)", () => {
    expect(mobileColumnOrderCss("s", [col("a"), inner("i")])).toBe("");
  });
});

describe("columnOrderGate", () => {
  it("strona główna [2|1|3]: tylko A czeka, zwalnia ją slot slidera B", () => {
    const gate = columnOrderGate("hero", [
      col("a", { mobile: 2 }),
      col("b", { mobile: 1 }),
      col("c", { mobile: 3 }),
    ]);
    expect(gate?.hold).toBe(`@media (max-width: 767px){${slot("hero", "a")}{visibility:hidden}}`);
    expect([...(gate?.release ?? new Map())]).toEqual([
      ["b", `@media (max-width: 767px){${slot("hero", "a")}{visibility:inherit}}`],
    ]);
  });

  it("kilka wstrzymanych z tą samą domykającą - jeden blok zwolnienia", () => {
    const gate = columnOrderGate("s", [
      col("a", { mobile: 3 }),
      col("b", { mobile: 2 }),
      col("c", { mobile: 1 }),
    ]);
    expect(gate?.hold).toBe(
      `@media (max-width: 767px){${slot("s", "a")}{visibility:hidden}${slot("s", "b")}{visibility:hidden}}`,
    );
    expect([...(gate?.release.keys() ?? [])]).toEqual(["c"]);
  });

  it("kolejność zgodna z dokumentem (także jawna) - bez bramki", () => {
    expect(columnOrderGate("s", [col("a"), col("b"), col("c")])).toBeNull();
    expect(
      columnOrderGate("s", [col("a"), col("b", { mobile: 1 }), col("c", { mobile: 2 })]),
    ).toBeNull();
    // Kolumna bez `order` po kolumnie z `order.mobile: 1` ma na telefonie 0,
    // czyli wyprzedza ją - to JEST odwrócenie.
    expect(columnOrderGate("s", [col("a", { mobile: 1 }), col("b")])).not.toBeNull();
  });

  it("odwrócenie tylko na desktopie (inline `order.desktop` z SSR) - zakres min-width: 768px", () => {
    const gate = columnOrderGate("s", [col("a", { desktop: 2 }), col("b", { desktop: 1 })]);
    expect(gate?.hold).toBe(
      `@media not all and (max-width: 767px){${slot("s", "a")}{visibility:hidden}}`,
    );
    expect(gate?.release.get("b")).toBe(
      `@media not all and (max-width: 767px){${slot("s", "a")}{visibility:inherit}}`,
    );
  });

  it("różne domykające w dwóch zakresach - każde zwolnienie tylko w swoim zakresie", () => {
    const gate = columnOrderGate("s", [
      col("a", { mobile: 2, desktop: 3 }),
      col("b", { mobile: 1, desktop: 3 }),
      col("c", { mobile: 2, desktop: 1 }),
    ]);
    expect(gate?.release.get("b")).toBe(
      `@media (max-width: 767px){${slot("s", "a")}{visibility:inherit}}`,
    );
    expect(gate?.release.get("c")).toBe(
      `@media not all and (max-width: 767px){${slot("s", "a")}{visibility:inherit}${slot("s", "b")}{visibility:inherit}}`,
    );
  });

  it("`order.tablet` nie wpływa na parsowanie: SSR maluje porządek desktopu", () => {
    expect(columnOrderGate("s", [col("a", { tablet: 2 }), col("b", { tablet: 1 })])).toBeNull();
  });

  it("kolumna `hideOn.mobile` (display:none na telefonie) nikogo nie wyprzedza", () => {
    const hidden = col("b", undefined, { advanced: { hideOn: { mobile: true } } });
    expect(columnOrderGate("s", [col("a", { mobile: 1 }), hidden])).toBeNull();
  });

  it("sekcja zagnieżdżona liczy się jako `order` 0, a śmieci z bazy nie dają NaN", () => {
    expect(columnOrderGate("s", [inner("i"), col("a", { mobile: 1 })])).toBeNull();
    expect(columnOrderGate("s", [col("a", { mobile: 1 }), inner("i")])?.release.has("i")).toBe(
      true,
    );
    const bad = { mobile: "x" } as unknown as ResponsiveValue<number>;
    expect(columnOrderGate("s", [col("a", bad), col("b", bad)])).toBeNull();
  });
});

describe("cssOrder / cssAttrValue", () => {
  it("przepuszcza wyłącznie liczby całkowite (także zapisane napisem)", () => {
    expect(cssOrder(2)).toBe(2);
    expect(cssOrder(-1)).toBe(-1);
    expect(cssOrder("3")).toBe(3);
    expect(cssOrder(1.5)).toBeUndefined();
    expect(cssOrder("1.5")).toBeUndefined();
    expect(cssOrder("1;}x{color:red")).toBeUndefined();
    expect(cssOrder(null)).toBeUndefined();
    expect(cssOrder({})).toBeUndefined();
    expect(cssOrder(Number.NaN)).toBeUndefined();
  });

  it("wartość z bazy nie wstrzykuje CSS-a ani nie wychodzi z selektora", () => {
    const bad = { mobile: "1;}body{display:none" } as unknown as ResponsiveValue<number>;
    expect(mobileColumnOrderCss("s", [col("a", bad)])).toBe(
      '@media (max-width: 767px){[data-sec-id="s"] [data-col-id="a"]{order:0 !important;}}',
    );
    expect(cssAttrValue('x"]{}*[a="')).toBe('x\\"]{}*[a=\\"');
    expect(cssAttrValue("a\\b")).toBe("a\\\\b");
    const css = mobileColumnOrderCss('s"', [col('c"', { mobile: 1 })]);
    expect(css).toBe(
      '@media (max-width: 767px){[data-sec-id="s\\""] [data-col-id="c\\""]{order:1 !important;}}',
    );
  });

  it("ułamek w `order` to brak wartości - jak w przeglądarce, która go odrzuca", () => {
    // `order: 1.5` nie jest poprawnym CSS-em, więc kolumna ma 0 i stoi przed `a`.
    expect(
      columnOrderGate("s", [col("a", { mobile: 1 }), col("b", { mobile: 1.5 })]),
    ).not.toBeNull();
  });
});

describe("columnOrderGate - symulacja parsowania (właściwość)", () => {
  // Deterministyczny generator: ten sam zestaw przypadków przy każdym przebiegu.
  function* cases(): Generator<Array<number | null>> {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    for (let n = 1; n <= 6; n++) {
      for (let k = 0; k < 120; k++) {
        yield Array.from({ length: n }, () => {
          const r = next() % 9;
          return r === 8 ? null : (r % 4) - 1;
        });
      }
    }
  }

  it("widoczna kolumna nigdy nie zyskuje nowego wizualnego poprzednika; domykające nie czekają", () => {
    for (const orders of cases()) {
      const completing = completingSiblings(orders);
      // Kolejność wizualna: stabilne sortowanie po `order` (remis = dokument).
      const before = (a: number, b: number) =>
        orders[a] !== null &&
        orders[b] !== null &&
        (orders[a]! < orders[b]! || (orders[a] === orders[b] && a < b));
      for (let parsed = 0; parsed < orders.length; parsed++) {
        for (let x = 0; x <= parsed; x++) {
          if (orders[x] === null) continue;
          const visible = completing[x] < 0 || completing[x] <= parsed;
          if (!visible) continue;
          // Każdy wizualny poprzednik X jest już w całości wczytany.
          for (let y = 0; y < orders.length; y++) {
            if (before(y, x)) expect(y <= parsed, `${JSON.stringify(orders)} x=${x}`).toBe(true);
          }
        }
      }
      // Kolumna domykająca sama nigdy nie jest wstrzymana.
      for (const j of completing) if (j >= 0) expect(completing[j]).toBe(-1);
    }
  });
});
