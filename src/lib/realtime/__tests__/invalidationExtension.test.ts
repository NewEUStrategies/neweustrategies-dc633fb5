// ROZSZERZENIE MAPY INWALIDACJI: rdzeń dla każdego, panel tylko w panelu.
//
// DLACZEGO PODZIAŁ JEST KONTRAKTEM. Rdzeń mapy jedzie do każdego zalogowanego
// (także czytelnika na stronie publicznej), więc każdy klucz huba wpisany
// w rdzeń to kod panelu w bundlu `public`. Odwrotny błąd jest cichszy: klucz
// modułu wpisany tylko w rozszerzenie odświeża się wyłącznie wtedy, gdy
// gdzieś w karcie jest otwarty panel - druga karta modułu zostaje na starym
// cache. Ten plik pilnuje obu kierunków i mechaniki rejestru (StrictMode,
// dwóch właścicieli, wyrejestrowanie bez śladu w rdzeniu).
import { StrictMode, createElement, useEffect } from "react";
import { render } from "@testing-library/react";
import type { QueryKey } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { DOMAIN_EVENT_TYPES, type DomainEventRow } from "@/lib/realtime/domainEvents";
import {
  invalidationKeysFor,
  registerInvalidationExtension,
  type InvalidationExtension,
} from "@/lib/realtime/eventInvalidationMap";
import {
  ADMIN_HUB_INVALIDATION,
  PANEL_ONLY_EVENT_TYPES,
} from "@/lib/realtime/eventInvalidationMap.admin";

const TENANT = "11111111-1111-4111-a111-111111111111";
const CTX = { userId: "22222222-2222-4222-a222-222222222222" };

function eventOf(type: string, overrides: Partial<DomainEventRow> = {}): DomainEventRow {
  return {
    id: "33333333-3333-4333-a333-333333333333",
    tenant_id: TENANT,
    aggregate_type: type.split(".")[0],
    aggregate_id: "44444444-4444-4444-a444-444444444444",
    event_type: type,
    payload: { event_id: "e1", lead_id: "l1", entity_type: "post", entity_id: "p1" },
    correlation_id: null,
    actor_id: null,
    created_at: "2026-10-19T10:00:00.000Z",
    ...overrides,
  };
}

/** Prefiks panelu huba: agregaty przychodu albo ścieżki komunikacji. */
function isPanelKey(key: QueryKey): boolean {
  return key[0] === "admin-revenue" || (key[0] === "admin" && key[1] === "journeys");
}

const EXTENSION_TYPES = Object.keys(ADMIN_HUB_INVALIDATION) as (keyof InvalidationExtension)[];

// Każdy test sprząta swoje rejestracje; zostawiona rejestracja zmieniłaby
// wynik rdzenia w następnym teście i ten mierzyłby nie to, co deklaruje.
const disposers: (() => void)[] = [];
function register(ext: InvalidationExtension): () => void {
  const dispose = registerInvalidationExtension(ext);
  disposers.push(dispose);
  return dispose;
}
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("podział rdzeń / rozszerzenie panelu", () => {
  it("rozszerzenie zna wyłącznie typy z katalogu szyny", () => {
    const catalog = new Set<string>(DOMAIN_EVENT_TYPES);
    expect(EXTENSION_TYPES.filter((type) => !catalog.has(type))).toEqual([]);
  });

  it.each(EXTENSION_TYPES)("%s: rozszerzenie oddaje WYŁĄCZNIE prefiksy panelu", (type) => {
    const rule = ADMIN_HUB_INVALIDATION[type];
    for (const event of [eventOf(type), eventOf(type, { aggregate_id: "", payload: {} })]) {
      const keys = rule?.(event, CTX) ?? [];
      expect(keys.length, type).toBeGreaterThan(0);
      expect(keys.filter((key) => !isPanelKey(key))).toEqual([]);
    }
  });

  it("agregaty huba z rozszerzenia są zawsze kluczowane najemcą ZDARZENIA", () => {
    // Najemca na pozycji 2 (`["admin-revenue", dziedzina, najemca, …]`): bez
    // niego zdarzenie jednego obszaru roboczego unieważniałoby cache drugiego.
    for (const type of EXTENSION_TYPES) {
      const keys = ADMIN_HUB_INVALIDATION[type]?.(eventOf(type), CTX) ?? [];
      for (const key of keys.filter((k) => k[0] === "admin-revenue")) {
        expect(key[2], `${type} ${JSON.stringify(key)}`).toBe(TENANT);
      }
    }
  });

  it("rdzeń (bez rejestracji) nie oddaje ani jednego klucza panelu - dla żadnego typu", () => {
    for (const type of DOMAIN_EVENT_TYPES) {
      const keys = invalidationKeysFor(eventOf(type), CTX);
      expect(keys.filter(isPanelKey), type).toEqual([]);
    }
  });

  it("typy czysto panelowe mają w rozszerzeniu regułę, a w rdzeniu - pustą", () => {
    for (const type of PANEL_ONLY_EVENT_TYPES) {
      expect(invalidationKeysFor(eventOf(type), CTX), type).toEqual([]);
      expect(ADMIN_HUB_INVALIDATION[type], type).toBeTypeOf("function");
    }
  });
});

describe("rejestr rozszerzeń", () => {
  it("rejestracja dokłada klucze rozszerzenia ZA rdzeniem, wyrejestrowanie je zdejmuje", () => {
    const event = eventOf("access_plan.changed.v1");
    const core = invalidationKeysFor(event, CTX);

    const dispose = register(ADMIN_HUB_INVALIDATION);
    const union = invalidationKeysFor(event, CTX);
    // Rdzeń nietknięty i na początku: suma nie może zgubić klucza modułu.
    expect(union.slice(0, core.length)).toEqual(core);
    expect(union.slice(core.length)).toEqual(
      ADMIN_HUB_INVALIDATION["access_plan.changed.v1"]?.(event, CTX),
    );

    dispose();
    expect(invalidationKeysFor(event, CTX)).toEqual(core);
  });

  it("suma nie modyfikuje tablic rdzenia współdzielonych między wywołaniami", () => {
    // `event.published.v1` oddaje stałą listę modułu; dopisanie do niej
    // rozszerzałoby rdzeń na stałe - także po wyrejestrowaniu.
    const event = eventOf("event.published.v1");
    const snapshot = invalidationKeysFor(event, CTX).map((key) => [...key]);
    const dispose = register({ "event.published.v1": () => [["admin-revenue", "events", TENANT]] });
    expect(invalidationKeysFor(event, CTX)).toHaveLength(snapshot.length + 1);

    dispose();
    expect(invalidationKeysFor(event, CTX)).toEqual(snapshot);
  });

  it("dwa rozszerzenia sumują się w kolejności rejestracji", () => {
    const event = eventOf("journey.changed.v1");
    register({ "journey.changed.v1": () => [["admin", "journeys", "a"]] });
    register({ "journey.changed.v1": () => [["admin", "journeys", "b"]] });
    expect(invalidationKeysFor(event, CTX)).toEqual([
      ["admin", "journeys", "a"],
      ["admin", "journeys", "b"],
    ]);
  });

  it("nieznany typ zostaje pusty także z zarejestrowanym rozszerzeniem", () => {
    register(ADMIN_HUB_INVALIDATION);
    expect(invalidationKeysFor(eventOf("hologram.materialized.v9"), CTX)).toEqual([]);
  });

  it("dwóch właścicieli tego samego rozszerzenia: znika dopiero z ostatnim", () => {
    const event = eventOf("revenue_input.changed.v1");
    const first = register(ADMIN_HUB_INVALIDATION);
    const second = register(ADMIN_HUB_INVALIDATION);

    first();
    // Ponowne wywołanie tego samego sprzątania nie odbiera rejestracji drugiemu.
    first();
    expect(invalidationKeysFor(event, CTX).length).toBeGreaterThan(0);

    second();
    expect(invalidationKeysFor(event, CTX)).toEqual([]);
  });

  it("efekt w StrictMode (montaż → sprzątanie → montaż) zostawia rozszerzenie aktywne do odmontowania", () => {
    const event = eventOf("journey.stats_changed.v1");
    function Panel() {
      // Dokładnie wywołanie z `routes/admin.tsx` (`AdminSession`).
      useEffect(() => registerInvalidationExtension(ADMIN_HUB_INVALIDATION), []);
      return null;
    }

    const view = render(createElement(StrictMode, null, createElement(Panel)));
    expect(invalidationKeysFor(event, CTX).length).toBeGreaterThan(0);

    view.unmount();
    expect(invalidationKeysFor(event, CTX)).toEqual([]);
  });
});
