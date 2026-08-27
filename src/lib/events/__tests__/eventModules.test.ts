// Bramka słownika modułów: SEGMENT TRASY MUSI BYĆ WARTOŚCIĄ `event_pages.module`.
//
// PO CO TEN TEST ISTNIEJE. Mapa `EVENT_MODULE_ROUTE` musi trzymać literały,
// bo tylko literał daje typowane `<Link to=…>` w TanStack Router. Literał da
// się jednak wpisać byle jaki - a segment rozjechany ze znacznikiem z bazy
// (`/events/<slug>/prelegenci` przy `module = 'speakers'`) to cicha awaria:
// odnośnik prowadzi do trasy, której nie ma, i widać to dopiero po kliknięciu.
// Tu porównanie jest mechaniczne, więc rozjazd czerwieni się od razu.
//
// DRUGA POŁOWA KONTRAKTU JEST W SQL-u: zbiór pięciu wartości domyka CHECK
// `event_pages_module_values` (migracja 20260826181500). Ten test pilnuje
// wyłącznie strony klienckiej - że lista i mapa mówią to samo i że nic
// z listy nie zostało bez trasy.
import { describe, expect, it } from "vitest";

import {
  EVENT_MODULES,
  EVENT_MODULE_ROUTE,
  eventModuleLabelKey,
  eventModuleOf,
} from "@/lib/events/eventModules";

describe("słownik modułów wydarzenia", () => {
  it("zna dokładnie pięć modułów zasianych przez bazę", () => {
    expect([...EVENT_MODULES]).toEqual([
      "participants",
      "speakers",
      "partners",
      "agenda",
      "discussions",
    ]);
  });

  it("każdy moduł ma trasę, a jej OSTATNI SEGMENT jest wartością modułu", () => {
    for (const module of EVENT_MODULES) {
      const route = EVENT_MODULE_ROUTE[module];
      expect(route).toBe(`/events/$slug/${module}`);
      expect(route.split("/").at(-1)).toBe(module);
    }
  });

  it("mapa tras nie ma pozycji spoza listy modułów", () => {
    expect(Object.keys(EVENT_MODULE_ROUTE).sort()).toEqual([...EVENT_MODULES].sort());
  });

  it("rozpoznaje wartość z bazy", () => {
    expect(eventModuleOf("speakers")).toBe("speakers");
    expect(eventModuleOf("discussions")).toBe("discussions");
  });

  it("nieznaną wartość czyta jak jej brak - pozycja zostaje przy ścieżce splata", () => {
    // Szósty moduł wdrożony migracją PRZED tą wersją klienta nie może zamienić
    // pozycji menu w odnośnik do nieistniejącej trasy.
    expect(eventModuleOf("exhibitors")).toBeNull();
    expect(eventModuleOf(null)).toBeNull();
    expect(eventModuleOf(undefined)).toBeNull();
    expect(eventModuleOf("")).toBeNull();
    // Wielkość liter i spacje to NIE jest ta sama wartość - CHECK w bazie
    // przepuszcza wyłącznie dokładne pięć literałów.
    expect(eventModuleOf("Speakers")).toBeNull();
    expect(eventModuleOf(" speakers")).toBeNull();
  });

  it("klucz etykiety zapasowej celuje w słownik nakładkowy wydarzenia", () => {
    expect(eventModuleLabelKey("partners")).toBe("eventFront.header.tabs.partners");
  });
});
