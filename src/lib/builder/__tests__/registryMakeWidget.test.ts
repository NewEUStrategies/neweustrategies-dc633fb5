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
// 3. ODMOWA DLA TYPU SPOZA REJESTRU - patrz blok defektu nizej.
//
// GRANICA DOWODU: ten plik nie sprawdza TRESCI wartosci domyslnych
// poszczegolnych widgetow (te maja wlasne testy powierzchniowe), tylko ksztalt
// wezla wspolny dla wszystkich typow.
import { describe, expect, it } from "vitest";
import { WIDGET_MAP, makeWidget } from "@/lib/builder/registry";
import { WIDGET_TYPES } from "@/lib/builder/schema";
import type { WidgetType } from "@/lib/builder/types";

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
  it("STAN FAKTYCZNY: nieznany typ konczy sie wyjatkiem TypeError", () => {
    // `WIDGET_MAP["nie-ma-takiego"]` jest `undefined`, wiec `.defaults()`
    // rzuca. Przypiete jako stan faktyczny, zeby zmiana tego zachowania
    // (na null, na wezel zastepczy) byla decyzja, a nie przypadkiem.
    expect(() => makeWidget("nie-ma-takiego-widgetu" as unknown as WidgetType)).toThrow(TypeError);
  });

  // DEFEKT: NIEZNANY TYP WIDGETU WYWALA KANWE ZAMIAST ZOSTAC ODRZUCONY.
  //
  // WEJSCIE: upuszczenie na kanwe przeciaganego elementu, ktorego ladunek
  //   `application/x-widget-type` niesie lancuch spoza rejestru - np. typ
  //   usuniety w nowszym wydaniu, literowka, albo przeciagniecie z karty
  //   z inna wersja aplikacji.
  // CO PSUJE: `VisualCanvas.tsx:684` rzutuje odczytany lancuch na `WidgetType`
  //   BEZ sprawdzenia (`e.dataTransfer?.getData(...) as WidgetType`), bramka
  //   `if (newType)` (:685) odsiewa jedynie pusty lancuch, a `makeWidget`
  //   (src/lib/builder/registry.tsx:2295-2300) siega od razu po
  //   `WIDGET_MAP[type].defaults()`. Dla nieznanego typu `WIDGET_MAP[type]`
  //   jest `undefined` i wywolanie rzuca TypeError - w srodku uchwytu `drop`,
  //   czyli poza jakimkolwiek `try`.
  // KONSEKWENCJA: wyjatek w uchwycie zdarzenia ubija render kanwy (granica
  //   bledu Reacta zamiast edytora), a niezapisane zmiany z biezacej sesji
  //   przepadaja. Ten sam rejestr ma juz na to gotowa odpowiedz po drugiej
  //   stronie: `coerceWidget` (src/lib/builder/schema.ts:199-207) nieznany typ
  //   swiadomie ODRZUCA i zapisuje w komentarzu dlaczego. Dwa wejscia do tego
  //   samego rejestru odpowiadaja na to samo wejscie zupelnie inaczej.
  // WYMAGANA POPRAWKA: `makeWidget` musi odmowic tak samo jak `coerceWidget` -
  //   sprawdzic obecnosc wpisu (`isKnownWidgetType` / `WIDGET_MAP[type]`)
  //   i zwrocic `null` dla typu spoza rejestru, zeby wolajacy mogl zignorowac
  //   upuszczenie, zamiast tracic edytor.
  it.fails("DEFEKT: makeWidget dla typu spoza rejestru NIE moze rzucac wyjatkiem", () => {
    expect(() => makeWidget("nie-ma-takiego-widgetu" as unknown as WidgetType)).not.toThrow();
  });
});
