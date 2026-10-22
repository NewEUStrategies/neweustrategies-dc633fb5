// Reguły obszaru „Synchronizacja" (SPEC §5.7, §3; br. 03 D7 - dryf katalogu
// zdarzeń). Szyna zdarzeń jest kręgosłupem huba: karta w innej zakładce
// odświeża się wyłącznie po zdarzeniu, a ścieżki startują tylko z niego.
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

const OWNER = { to: "/admin/revenue/diagnostics", search: { view: "map" } } as const;

export const SYNC_CHECKS = [
  {
    // Typ zdarzenia z rytmem co najmniej tygodniowym (≥ 11 w 83 dni przed
    // ostatnim tygodniem) bez ani jednego zdarzenia w 7 dni = emiter
    // ucichł; rytm dzienny (≥ 83) bez zdarzeń w tydzień = emiter nie działa.
    id: "sync.emitter_silent",
    area: "sync",
    severity: "warning",
    evaluate(facts) {
      const sync = areaFacts(facts, "sync");
      if (!sync?.silentDaily || !sync.silentWeekly) return UNKNOWN;
      const all = [...sync.silentDaily, ...sync.silentWeekly];
      if (all.length === 0) return OK;
      return finding(sync.silentDaily.length > 0 ? "error" : "warn", {
        count: all.length,
        refs: all,
        evidence: ev("emitterSilent", { count: all.length, daily: sync.silentDaily.length }),
      });
    },
    fix: { kind: "link", to: "/admin/revenue/diagnostics", search: { view: "map" } },
    owner: OWNER,
    snoozable: true,
  },
  {
    // Dryf katalogu (D7): typ w bazie spoza `DOMAIN_EVENT_TYPES` nie trafia
    // do żadnej reguły odświeżania (error); typ katalogu bez zdarzenia
    // w 90 dni to martwy wpis albo funkcja, której najemca nie używa (warn).
    id: "sync.dead_event_types",
    area: "sync",
    severity: "info",
    evaluate(facts) {
      const sync = areaFacts(facts, "sync");
      if (!sync?.deadTypes || !sync.unknownTypes) return UNKNOWN;
      if (sync.unknownTypes.length > 0) {
        return finding("error", {
          count: sync.unknownTypes.length,
          refs: sync.unknownTypes,
          evidence: ev("eventTypesUnknown", { count: sync.unknownTypes.length }),
        });
      }
      if (sync.deadTypes.length > 0) {
        return finding("warn", {
          count: sync.deadTypes.length,
          refs: sync.deadTypes,
          evidence: ev("eventTypesDead", { count: sync.deadTypes.length }),
        });
      }
      return OK;
    },
    fix: { kind: "code", issueRef: "sync.dead_event_types" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // Krytyczna i NIEWYCISZALNA: błąd emitera = zmiana, o której nie wie
    // żadna inna karta ani ścieżka. Odczyt dziennika tylko z funkcji definer
    // (Z-03: `domain_event_emit_errors` czyta wyłącznie admin najemcy).
    id: "sync.emit_errors",
    area: "sync",
    severity: "critical",
    evaluate(facts) {
      const sync = areaFacts(facts, "sync");
      if (sync?.emitErrors24h === undefined || sync.emitErrors7d === undefined) return UNKNOWN;
      if (sync.emitErrors24h > 0) {
        return finding("error", {
          count: sync.emitErrors24h,
          evidence: ev("emitErrors24h", { count: sync.emitErrors24h }),
        });
      }
      if (sync.emitErrors7d > 0) {
        return finding("warn", {
          count: sync.emitErrors7d,
          evidence: ev("emitErrors7d", { count: sync.emitErrors7d }),
        });
      }
      return OK;
    },
    fix: { kind: "code", issueRef: "sync.emit_errors" },
    owner: OWNER,
    snoozable: false,
  },
] as const satisfies readonly RevenueCheck[];
