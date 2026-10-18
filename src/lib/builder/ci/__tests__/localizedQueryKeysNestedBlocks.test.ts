// Analizator bramki „język w kluczu zapytania" a granice obiektu `useQuery`.
//
// `auditInlineQueries` wyznacza obiekt opcji zapytania, cofając się od
// `queryKey:` do niedomkniętej klamry. Dwa kształty kodu, których syntetyczne
// wejścia w `localizedQueryKeys.gate.test.ts` nie obejmują, a które realnie
// stoją w komponentach:
//  1. OBIEKT ZAGNIEŻDŻONY PRZED `queryKey` (`meta: { … }`, `placeholderData`):
//     jego klamry nie mogą zostać wzięte za granicę opcji - inaczej `queryFn`
//     leży „poza blokiem" i bramka milczy o zapytaniu bez języka w kluczu
//     (fałszywie zielony CI).
//  2. PLIK UCIĘTY / NIEDOMKNIĘTY (analiza w trakcie edycji, błąd składni):
//     blok sięga do końca tekstu, analizator nie rzuca i nadal raportuje.
// Bez atrap - analizator jest czystą funkcją tekstu.
import { describe, expect, it } from "vitest";
import { auditInlineQueries } from "../localizedQueryKeys";

describe("auditInlineQueries - granice obiektu opcji", () => {
  it("obiekt zagnieżdżony przed queryKey nie ukrywa zlokalizowanego queryFn", () => {
    const findings = auditInlineQueries([
      {
        path: "Widget.tsx",
        text: `useQuery({
          meta: { source: { widget: "cats" } },
          queryKey: ["cats"],
          queryFn: async () => fetchCats(lang),
        });`,
      },
    ]);
    expect(findings).toEqual([{ path: "Widget.tsx", line: 3, keyExpression: '["cats"]' }]);
  });

  it("obiekt zagnieżdżony nie wywołuje fałszywego alarmu, gdy klucz niesie język", () => {
    expect(
      auditInlineQueries([
        {
          path: "Widget.tsx",
          text: `useQuery({
            meta: { source: "cats" },
            queryKey: ["cats", lang],
            queryFn: async () => fetchCats(lang),
          });`,
        },
      ]),
    ).toEqual([]);
  });

  it("niedomknięty obiekt na końcu pliku nadal jest analizowany", () => {
    const findings = auditInlineQueries([
      {
        path: "Uciety.tsx",
        text: `useQuery({
          queryKey: ["tags"],
          queryFn: () => fetchTags(lang),`,
      },
    ]);
    expect(findings.map((f) => f.keyExpression)).toEqual(['["tags"]']);
  });
});
