// Globalny mostek warstwy spójności - montowany raz w __root (obok
// WidgetLiveSync / SiteSettingsLiveSync). Wyłącznie dla ZALOGOWANYCH:
// anonimowi odwiedzający nie mogą trzymać websocketów Realtime (kwoty
// połączeń - ta sama doktryna co siteSettingsLiveSync).
//
//   * useDomainEventInvalidation - jeden kanał domain_events; mapa
//     eventInvalidationMap odświeża cache modułów, a strumień przy okazji
//     zasila tracker korelacji (potwierdzenia optymistycznych mutacji);
//   * usePendingCountersRealtime - badge'e liczników na żywo.
import { useDomainEventInvalidation } from "./useModuleRealtime";
import { usePendingCountersRealtime } from "@/lib/counters/usePendingCounters";

export function CohesionLiveSync() {
  useDomainEventInvalidation();
  usePendingCountersRealtime();
  return null;
}
