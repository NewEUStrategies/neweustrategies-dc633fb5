// FABRYKA WEZLA WIDGETU - `makeWidget` z rejestru.
//
// `schema.test.ts` pilnuje juz, ze `WIDGET_TYPES` i `WIDGET_MAP` maja te same
// KLUCZE. To jednak dowod na spis tresci, a nie na to, ze kazdy wpis daje sie
// UZYC: `makeWidget` wola `WIDGET_MAP[type].defaults()`, wiec dopiero
// wykonanie fabryki dla KAZDEGO typu pokazuje, czy ktorys wpis nie jest
// wydmuszka (brak `defaults`, rzucajaca fabryka, wspoldzielony obiekt tresci).
// To jest jedyne wejscie, ktorym powstaje nowy widget na kanwie - dokladnie te
// obiekty ida potem do zapisu w bazie.
//
// CO TU JEST DO OBRONY
//
// 1. PARYTET PO WYKONANIU, nie po kluczach: `makeWidget(t)` dla kazdego `t`
//    z `WIDGET_TYPES` musi dac wezel o wlasnym identyfikatorze, rodzaju
//    "widget", zgodnym typie i tresci bedacej OBIEKTEM (nie tablica, nie null)
//    - bo taki ksztalt zaklada `safeParseBuilderDoc` i caly renderer.
// 2. IZOLACJA TRESCI: dwa widgety tego samego typu nie moga wspoldzielic
//    obiektu `content`. Wspoldzielenie oznaczaloby, ze edycja naglowka
//    w jednej sekcji zmienia naglowek w kazdej innej.
// 3. ODMOWA DLA TYPU SPOZA REJESTRU (`null`, nie wyjatek) - patrz blok nizej.
//
// GRANICA DOWODU: ten plik nie sprawdza TRESCI wartosci domyslnych
// poszczegolnych widgetow (te maja wlasne testy powierzchniowe), tylko ksztalt
// wezla wspolny dla wszystkich typow.
import { describe, expect, it } from "vitest";
import { WIDGET_MAP, makeWidget } from "@/lib/builder/registry";
import { WIDGET_TYPES } from "@/lib/builder/schema";

describe("makeWidget - parytet po WSZYSTKICH typach z WIDGET_TYPES", () => {
  it("kazdy typ ze spisu daje wezel o poprawnym ksztalcie", () => {
    const zle: string[] = [];

    for (const type of WIDGET_TYPES) {
      const node = makeWidget(type);
      if (node.kind !== "widget") zle.push(`${type}: kind=${String(node.kind)}`);
      if (node.type !== type) zle.push(`${type}: type=${String(node.type)}`);
      if (typeof node.id !== "string" || node.id.length === 0) zle.push(`${type}: pusty id`);
      if (
        typeof node.content !== "object" ||
        node.content === null ||
        Array.isArray(node.content)
      ) {
        zle.push(`${type}: content nie jest obiektem`);
      }
    }

    expect(zle).toEqual([]);
  });

  it("kazdy typ ze spisu ma w rejestrze fabryke wartosci domyslnych", () => {
    const bezFabryki = WIDGET_TYPES.filter(
      (type) => typeof WIDGET_MAP[type]?.defaults !== "function",
    );

    expect(bezFabryki).toEqual([]);
  });

  it("kazdy wezel dostaje WLASNY identyfikator - zero kolizji na calym spisie", () => {
    // Dwa wezly o tym samym `id` w jednym dokumencie sprawiaja, ze zaznaczenie,
    // usuniecie i przesuniecie trafiaja w losowy z nich.
    const ids = WIDGET_TYPES.flatMap((type) => [makeWidget(type).id, makeWidget(type).id]);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("dwa widgety tego samego typu NIE dziela obiektu tresci", () => {
    const wspoldzielone: string[] = [];

    for (const type of WIDGET_TYPES) {
      const a = makeWidget(type);
      const b = makeWidget(type);
      if (a.content === b.content) wspoldzielone.push(type);
    }

    expect(wspoldzielone).toEqual([]);
  });

  it("zmiana tresci jednego wezla nie przecieka do nastepnego tego samego typu", () => {
    const a = makeWidget("heading");
    a.content.text_pl = "Zmienione w pierwszym";
    const b = makeWidget("heading");

    expect(b.content.text_pl).not.toBe("Zmienione w pierwszym");
  });
});

describe("makeWidget - typ spoza rejestru", () => {
  // NAPRAWIONE 2026-10-18 (byl `it.fails`, a obok przypiety "STAN FAKTYCZNY"
  // z `TypeError`): nieznany typ widgetu wywalal kanwe zamiast zostac odrzucony.
  //
  // WEJSCIE: upuszczenie na kanwe ladunku `application/x-widget-type` spoza
  //   rejestru (typ usuniety w nowszym wydaniu, literowka, karta z inna wersja
  //   aplikacji). `makeWidget` siegal od razu po `WIDGET_MAP[type].defaults()`
  //   i rzucal `TypeError` w srodku uchwytu `drop`, ubijajac edytor razem
  //   z niezapisanymi zmianami.
  // KONTRAKT: `makeWidget` odmawia tak samo jak `coerceWidget` (schema.ts) -
  //   typ spoza rejestru (takze klucz z prototypu) daje `null`, a przeciazenie
  //   dla `string` ma typ nullowalny. Kanwa odsiewa nieznany ladunek juz przy
  //   upuszczeniu (`isKnownWidgetType` w `VisualCanvas.tsx`, dowod:
  //   `visualCanvasUnknownWidgetDrop.test.tsx`).
  it("makeWidget dla typu spoza rejestru NIE rzuca, tylko odmawia null", () => {
    expect(() => makeWidget("nie-ma-takiego-widgetu")).not.toThrow();
    expect(makeWidget("nie-ma-takiego-widgetu")).toBeNull();
    // Klucz z prototypu nie jest wpisem rejestru, choc `WIDGET_MAP[k]` jest "prawdziwe".
    expect(makeWidget("constructor")).toBeNull();
    expect(makeWidget("")).toBeNull();
  });

  it("znany typ podany jako niezaufany napis nadal daje pelny wezel", () => {
    const zNapisu: string = "heading";

    const node = makeWidget(zNapisu);

    expect(node).toMatchObject({ kind: "widget", type: "heading" });
    expect(node?.content).toEqual(WIDGET_MAP.heading.defaults());
  });
});
