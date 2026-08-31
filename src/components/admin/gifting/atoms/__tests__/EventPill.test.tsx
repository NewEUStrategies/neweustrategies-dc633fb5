// Atom: pigulka typu zdarzenia w audycie.
//
// PO CO TEN PLIK ISTNIEJE. `event_type` przychodzi z bazy jako OTWARTY string -
// tak jest zadeklarowany `GiftEventAdminRow` i jest to decyzja, nie
// niedopatrzenie ("audyt ma pokazywac takze zdarzenia, ktorych ten build
// jeszcze nie zna"). Cala roznica miedzy "audyt pokazuje nieznane zdarzenie
// szaro" a "audyt nie renderuje sie wcale" siedzi w jednej linijce tego atomu:
// `isKnownEventType(type) ? EVENT_PILL_CLS[type] : EVENT_PILL_CLS.expired`.
// Ta linijka nie ma zadnej ochrony ze strony kompilatora, bo po stronie danych
// typem jest `string` - dlatego dostaje test JAWNY.
//
// Straznik sam w sobie ma osobny plik (`__tests__/model.test.ts`) - tutaj
// dowodzimy JEGO SKUTKU W RENDERZE.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { EventPill } from "@/components/admin/gifting/atoms/EventPill";
import { EVENT_PILL_CLS } from "@/components/admin/gifting/model";
import type { GiftEventType } from "@/lib/gifting-admin.functions";

const TYPES: readonly GiftEventType[] = ["created", "redeemed", "revoked", "expired", "exhausted"];

describe("EventPill - znane typy", () => {
  it.each(TYPES)("typ %s dostaje swoja klase z EVENT_PILL_CLS", (type) => {
    render(<EventPill type={type} label={`etykieta-${type}`} />);
    expect(screen.getByText(`etykieta-${type}`).className).toContain(EVENT_PILL_CLS[type]);
  });

  it("utworzenie i otwarcie roznia sie tonacja", () => {
    // Te dwa zdarzenia sa najczestsze w logu i lezą obok siebie w wierszach;
    // wspolna tonacja czynilaby kolumne "Typ" nieczytelna bez czytania tekstu.
    const { unmount } = render(<EventPill type="created" label="utworzony" />);
    const created = screen.getByText("utworzony").className;
    unmount();
    render(<EventPill type="redeemed" label="otwarty" />);
    expect(screen.getByText("otwarty").className).not.toBe(created);
  });

  it("odbicie od wyczerpanego budzetu ma tonacje ostrzegawcza (amber)", () => {
    // "exhausted" to jedyne zdarzenie, ktore mowi adminowi, ze ktos NIE
    // dostal tresci - nie moze wygladac jak zdarzenie neutralne.
    render(<EventPill type="exhausted" label="odbicie" />);
    expect(screen.getByText("odbicie").className).toContain("amber");
  });
});

describe("EventPill - nieznane typy (straz isKnownEventType)", () => {
  it.each([
    ["typ z przyszlej migracji", "throttled"],
    ["typ z importu historycznego", "legacy_import"],
    ["pusty napis", ""],
    ["inna wielkosc liter", "Created"],
  ])("%s renderuje sie neutralnie zamiast wysypac render", (_opis, type) => {
    render(<EventPill type={type} label="nieznane" />);
    // Fallback celowo pozycza tonacje "expired" (muted) - neutralna szarosc,
    // ktora nie sugeruje ani sukcesu, ani awarii.
    expect(screen.getByText("nieznane").className).toContain(EVENT_PILL_CLS.expired);
  });

  it("nieznany typ nie wpuszcza `undefined` do atrybutu class", () => {
    // Bez straznika `EVENT_PILL_CLS[type]` oddaje `undefined`, a interpolacja
    // wkleja do `class` napis "undefined" - pigulka bez tla i bez ramki,
    // czyli wizualnie znikajaca z wiersza.
    render(<EventPill type="throttled" label="nieznane" />);
    expect(screen.getByText("nieznane").className).not.toContain("undefined");
  });

  it("etykieta nieznanego typu dociera do DOM (audyt nie ukrywa zdarzenia)", () => {
    // AuditPanel podaje tu `defaultValue: e.event_type`, wiec przy braku
    // tlumaczenia admin ma zobaczyc SUROWA nazwe zdarzenia, a nie pusty wiersz.
    render(<EventPill type="throttled" label="throttled" />);
    expect(screen.getByText("throttled")).toBeTruthy();
  });

  it("nie wnosi naruszen dostepnosci", async () => {
    const { container } = render(<EventPill type="redeemed" label="otwarty" />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // DEFEKT NAPRAWIONY (opisany szerzej w
  // `src/components/admin/gifting/__tests__/model.test.ts`).
  //
  // CO BYLO ZLE. `isKnownEventType` uzywal operatora `in`, ktory przeszukuje
  // lancuch prototypow, wiec dla nazw dziedziczonych po `Object.prototype`
  // ("constructor", "toString", "valueOf", ...) zwracal `true`. EventPill
  // wchodzil wtedy w galaz "znany typ" i podstawial
  // `EVENT_PILL_CLS["constructor"]`, czyli FUNKCJE, do atrybutu `class`.
  //
  // JAKIE TO BYLO RYZYKO. Atrybut `class` dostawal zserializowane cialo funkcji
  // (`function Object() { [native code] }`), wiec pigulka tracila tonacje, a do
  // DOM trafial napis, ktory nie jest zadna klasa CSS. Straznik, ktory istnieje
  // WYLACZNIE po to, zeby chronic ten render, w tym przypadku sam go psul.
  // Wartosc byla nieosiagalna przez CHECK w bazie, ale `event_type` jest
  // celowo otwartym stringiem po stronie typow - czyli warstwa aplikacji
  // swiadomie NIE traktuje tego CHECK-a jako gwarancji.
  //
  // JAK NAPRAWIONE. `model.ts` pyta o wlasnosc WLASNA mapy
  // (`Object.hasOwn(EVENT_PILL_CLS, type)`), wiec nazwa z prototypu trafia
  // do galezi "nieznany typ" i pigulka dostaje neutralna tonacje `expired`.
  // Wpis wrocil z `it.fails` do zwyklego `it`.
  // ---------------------------------------------------------------------------
  it("nazwa z prototypu Object nie moze trafic do atrybutu class", () => {
    render(<EventPill type="constructor" label="nieznane" />);
    expect(screen.getByText("nieznane").className).toContain(EVENT_PILL_CLS.expired);
  });
});
