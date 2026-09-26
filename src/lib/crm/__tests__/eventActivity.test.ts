// Aktywność z modułu Wydarzeń na osi czasu CRM - funkcje czyste.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. TYP PO FRAGMENCIE, NIE PO PREFIKSIE. `includes("event")` wciągnąłby do
//      typu „event" akcje CRM w rodzaju `crm.event_import.done` - a odnośnik do
//      studia pojawiłby się przy wpisach, które z wydarzeniem nie mają nic
//      wspólnego.
//   2. ZDANIE W ZŁYM JĘZYKU. Panel angielski pokazywałby polskie `summary_pl`
//      mimo obecnego `summary_en`, albo pusty tytuł, gdy brakuje wersji w jego
//      języku.
//   3. ODNOŚNIK ZE ŚMIECIA. `event_id` wstawiony do adresu bez sprawdzenia
//      kształtu prowadzi na przypadkową trasę panelu (`/admin/events/list`).
//   4. WYJĄTEK Z METADANYCH SPOZA KONTRAKTU. Wiersz zapisany ręcznie (tablica,
//      napis, `null`) ma zdegradować do kodu akcji, a nie wywrócić oś czasu.
import { describe, expect, it } from "vitest";

import {
  EVENT_ACTIVITY_ACTION_PREFIX,
  eventActivityEventId,
  eventActivitySummary,
  isEventActivityAction,
} from "@/lib/crm/eventActivity";

const EVENT_ID = "3f1a0c8e-0000-4000-8000-000000000042";

describe("rozpoznanie aktywności z modułu Wydarzeń", () => {
  it("rozpoznaje WYŁĄCZNIE akcje z prefiksem `event.`", () => {
    expect(EVENT_ACTIVITY_ACTION_PREFIX).toBe("event.");
    expect(isEventActivityAction("event.cfp.submitted")).toBe(true);
    expect(isEventActivityAction("event.invoice.issued")).toBe(true);
    expect(isEventActivityAction("crm.event_import.done")).toBe(false);
    expect(isEventActivityAction("events.cfp.submitted")).toBe(false);
    expect(isEventActivityAction("crm_lead.stage_change")).toBe(false);
    expect(isEventActivityAction("")).toBe(false);
  });
});

describe("zdanie wpisu w języku panelu", () => {
  const meta = { summary_pl: "Zgłoszenie wystąpienia", summary_en: "Talk submitted" };

  it("bierze wersję w żądanym języku", () => {
    expect(eventActivitySummary(meta, "pl", "event.cfp.submitted")).toBe("Zgłoszenie wystąpienia");
    expect(eventActivitySummary(meta, "en", "event.cfp.submitted")).toBe("Talk submitted");
  });

  it("przy braku wersji w języku panelu bierze DRUGI język, a nie kod akcji", () => {
    expect(eventActivitySummary({ summary_pl: "Tylko po polsku" }, "en", "x")).toBe(
      "Tylko po polsku",
    );
    expect(eventActivitySummary({ summary_en: "English only", summary_pl: "  " }, "pl", "x")).toBe(
      "English only",
    );
  });

  it("bez zdania i przy metadanych spoza kontraktu oddaje wartość zastępczą", () => {
    for (const value of [null, undefined, "zdanie", 7, ["summary_pl"], {}, { summary_pl: 1 }]) {
      expect(eventActivitySummary(value, "pl", "event.cfp.submitted")).toBe("event.cfp.submitted");
    }
  });
});

describe("identyfikator wydarzenia do odnośnika", () => {
  it("oddaje `event_id` o kształcie uuid", () => {
    expect(eventActivityEventId({ event_id: EVENT_ID, event_slug: "kongres" })).toBe(EVENT_ID);
    expect(eventActivityEventId({ event_id: EVENT_ID.toUpperCase() })).toBe(EVENT_ID.toUpperCase());
  });

  it("odrzuca wszystko, co nie jest uuid - odnośnik do przypadkowej trasy jest gorszy niż brak", () => {
    for (const value of [
      null,
      undefined,
      [],
      "tekst",
      {},
      { event_id: "list" },
      { event_id: `${EVENT_ID}/overview` },
      { event_id: 42 },
      { event_slug: "kongres" },
    ]) {
      expect(eventActivityEventId(value)).toBeNull();
    }
  });
});
